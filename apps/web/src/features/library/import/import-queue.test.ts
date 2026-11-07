import type { Book, ConversionJob } from "@leitura/shared";
import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@/lib/api";
import { buildCandidates, type ItemOutcome } from "./import-model";
import { BUSY_MAX_RETRIES, BUSY_RETRY_MS, type ImportDeps, runImport } from "./import-queue";

const fileOf = (name: string) => new File(["x"], name);
const book = (title: string) => ({ title }) as Book;
const job = () => ({}) as ConversionJob;

function setup(overrides: Partial<ImportDeps> = {}) {
  const outcomes = new Map<string, ItemOutcome>();
  const sleeps: number[] = [];
  const deps: ImportDeps = {
    uploadBook: async (f) => book(f.name),
    uploadConversion: async () => job(),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    onUpdate: (id, outcome) => outcomes.set(id, outcome),
    isCancelled: () => false,
    ...overrides,
  };
  return { deps, outcomes, sleeps };
}

describe("runImport", () => {
  it("envia EPUB e conversão e registra o resultado de cada um", async () => {
    const { candidates } = buildCandidates([fileOf("a.epub"), fileOf("b.txt")]);
    const { deps, outcomes } = setup();
    await runImport(candidates, deps);
    expect(outcomes.get(candidates[0]?.id ?? "")).toEqual({ status: "book", title: "a.epub" });
    expect(outcomes.get(candidates[1]?.id ?? "")).toEqual({ status: "converting" });
  });

  it("um item que falha não para os outros", async () => {
    const { candidates } = buildCandidates([fileOf("a.epub"), fileOf("b.epub"), fileOf("c.epub")]);
    const { deps, outcomes } = setup({
      uploadBook: async (f) => {
        if (f.name === "b.epub") throw new ApiRequestError("INVALID_FILE", "ruim", 400);
        return book(f.name);
      },
    });
    await runImport(candidates, deps);
    const statuses = candidates.map((c) => outcomes.get(c.id)?.status);
    expect(statuses).toEqual(["book", "failed", "book"]);
  });

  it("espera e tenta de novo quando o servidor está com conversões demais", async () => {
    const { candidates } = buildCandidates([fileOf("a.txt")]);
    let calls = 0;
    const { deps, outcomes, sleeps } = setup({
      uploadConversion: async () => {
        calls += 1;
        if (calls < 3) throw new ApiRequestError("VALIDATION", "há conversões demais", 400);
        return job();
      },
    });
    await runImport(candidates, deps);
    expect(calls).toBe(3);
    expect(sleeps).toHaveLength(2);
    expect(outcomes.get(candidates[0]?.id ?? "")).toEqual({ status: "converting" });
  });

  it("não deixa mais de dois EPUBs em voo ao mesmo tempo", async () => {
    const { candidates } = buildCandidates(
      Array.from({ length: 6 }, (_, i) => fileOf(`l${i}.epub`)),
    );
    let inFlight = 0;
    let peak = 0;
    const { deps } = setup({
      uploadBook: async (f) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return book(f.name);
      },
    });
    await runImport(candidates, deps);
    expect(peak).toBe(2);
  });

  it("depois de cancelado, não começa itens novos", async () => {
    const { candidates } = buildCandidates(
      Array.from({ length: 5 }, (_, i) => fileOf(`l${i}.epub`)),
    );
    let cancelled = false;
    const { deps, outcomes } = setup({
      isCancelled: () => cancelled,
      uploadBook: async (f) => {
        cancelled = true;
        return book(f.name);
      },
    });
    await runImport(candidates, deps);
    expect(outcomes.size).toBeLessThan(candidates.length);
  });
});

describe("runImport: erros e repetições", () => {
  const busy = () => new ApiRequestError("VALIDATION", "há conversões demais", 400);

  it("só repete quando o erro é o de servidor ocupado", async () => {
    for (const error of [new ApiRequestError("INVALID_FILE", "ruim", 400), new Error("rede")]) {
      const { candidates } = buildCandidates([fileOf("a.txt")]);
      let calls = 0;
      const { deps, outcomes, sleeps } = setup({
        uploadConversion: async () => {
          calls += 1;
          throw error;
        },
      });
      await runImport(candidates, deps);
      expect(calls).toBe(1);
      expect(sleeps).toEqual([]);
      expect(outcomes.get(candidates[0]?.id ?? "")?.status).toBe("failed");
    }
  });

  it("desiste depois de BUSY_MAX_RETRIES esperas", async () => {
    const { candidates } = buildCandidates([fileOf("a.txt")]);
    let calls = 0;
    const { deps, outcomes, sleeps } = setup({
      uploadConversion: async () => {
        calls += 1;
        throw busy();
      },
    });
    await runImport(candidates, deps);
    expect(calls).toBe(BUSY_MAX_RETRIES + 1);
    expect(sleeps).toHaveLength(BUSY_MAX_RETRIES);
    expect(sleeps.every((ms) => ms === BUSY_RETRY_MS)).toBe(true);
    expect(outcomes.get(candidates[0]?.id ?? "")?.status).toBe("failed");
  });

  it("cancelar durante a espera para de tentar", async () => {
    const { candidates } = buildCandidates([fileOf("a.txt")]);
    let calls = 0;
    let cancelled = false;
    const { deps, outcomes } = setup({
      isCancelled: () => cancelled,
      uploadConversion: async () => {
        calls += 1;
        cancelled = true;
        throw busy();
      },
    });
    await runImport(candidates, deps);
    expect(calls).toBe(1);
    expect(outcomes.get(candidates[0]?.id ?? "")?.status).toBe("failed");
  });

  it("a mensagem de falha depende de ser conversão ou EPUB", async () => {
    const invalid = () => new ApiRequestError("INVALID_FILE", "x", 400);
    const { candidates } = buildCandidates([fileOf("a.txt"), fileOf("b.epub")]);
    const { deps, outcomes } = setup({
      uploadConversion: async () => {
        throw invalid();
      },
      uploadBook: async () => {
        throw invalid();
      },
    });
    await runImport(candidates, deps);
    const convert = outcomes.get(candidates[0]?.id ?? "");
    const epub = outcomes.get(candidates[1]?.id ?? "");
    expect(convert).toMatchObject({ status: "failed" });
    expect(epub).toMatchObject({ status: "failed" });
    const text = (o: ItemOutcome | undefined) => (o?.status === "failed" ? o.message : "");
    expect(text(convert)).toMatch(/formato indicado/);
    expect(text(epub)).not.toBe(text(convert));
  });

  it("avisa a tela: enviando, esperando e o resultado, nessa ordem", async () => {
    const { candidates } = buildCandidates([fileOf("a.txt")]);
    let calls = 0;
    const seen: string[] = [];
    const { deps } = setup({
      onUpdate: (_id, outcome) => seen.push(outcome.status),
      uploadConversion: async () => {
        calls += 1;
        if (calls === 1) throw busy();
        return job();
      },
    });
    await runImport(candidates, deps);
    expect(seen).toEqual(["sending", "sending", "converting"]);
  });
});
