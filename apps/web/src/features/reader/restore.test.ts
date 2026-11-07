import type { ReadingPosition } from "@leitura/shared";
import { describe, expect, it } from "vitest";
import {
  type ObservedLocation,
  type ReaderPort,
  type ResolvedCfi,
  restorePosition,
  sectionsByDistance,
} from "./restore";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const SNIPPET = "uma frase longa o bastante para servir de busca no livro";

function position(overrides: Partial<ReadingPosition> = {}): ReadingPosition {
  return {
    cfi: "epubcfi(/6/4!/4/2)",
    percentage: 0.5,
    textSnippet: SNIPPET,
    fileHash: HASH,
    ...overrides,
  };
}

type FakeOptions = {
  resolved?: ResolvedCfi | null;
  initThrows?: boolean;
  observed?: ObservedLocation | null;
  /** seção -> cfi encontrado pela busca */
  matches?: Record<number, string>;
  searchThrowsAt?: number;
  sections?: number;
  sectionAtFraction?: number | null;
  goToThrows?: boolean;
};

class FakePort implements ReaderPort {
  calls: string[] = [];
  searched: number[] = [];
  readonly #o: FakeOptions;

  constructor(options: FakeOptions = {}) {
    this.#o = options;
  }

  resolveCfi(cfi: string) {
    this.calls.push(`resolve:${cfi}`);
    return this.#o.resolved === undefined ? { index: 2, sectionCount: 5 } : this.#o.resolved;
  }
  async initAt(cfi: string) {
    this.calls.push(`init:${cfi}`);
    if (this.#o.initThrows) throw new Error("init falhou");
  }
  readLocation() {
    return this.#o.observed === undefined
      ? { sectionIndex: 2, containsCfiPoint: true }
      : this.#o.observed;
  }
  sectionIndexAt() {
    return this.#o.sectionAtFraction === undefined ? 2 : this.#o.sectionAtFraction;
  }
  sectionCount() {
    return this.#o.sections ?? 5;
  }
  async searchSnippet(_snippet: string, index: number) {
    this.searched.push(index);
    if (this.#o.searchThrowsAt === index) throw new Error("busca falhou");
    return this.#o.matches?.[index] ?? null;
  }
  clearSearch() {
    this.calls.push("clearSearch");
  }
  async goTo(cfi: string) {
    this.calls.push(`goTo:${cfi}`);
    if (this.#o.goToThrows) throw new Error("goTo falhou");
  }
  async goToFraction(fraction: number) {
    this.calls.push(`fraction:${fraction}`);
  }
  async start() {
    this.calls.push("start");
  }
}

describe("sectionsByDistance", () => {
  it("vai do centro para fora, dos dois lados", () => {
    expect(sectionsByDistance(2, 5)).toEqual([2, 1, 3, 0, 4]);
  });
  it("respeita as bordas", () => {
    expect(sectionsByDistance(0, 3)).toEqual([0, 1, 2]);
    expect(sectionsByDistance(2, 3)).toEqual([2, 1, 0]);
  });
});

describe("restorePosition", () => {
  it("usa o CFI quando ele resolve e a conferência passa", async () => {
    const port = new FakePort();
    const outcome = await restorePosition(port, position(), HASH);
    expect(outcome).toEqual({ strategy: "cfi", verified: true, failed: [] });
    expect(port.calls).toContain("init:epubcfi(/6/4!/4/2)");
  });

  it("CFI que não resolve cai para o trecho de texto", async () => {
    const port = new FakePort({ resolved: null, matches: { 2: "epubcfi(/6/6!/4/8)" } });
    const outcome = await restorePosition(port, position(), HASH);
    expect(outcome.strategy).toBe("snippet");
    expect(outcome.failed).toEqual(["cfi"]);
    expect(port.calls).toContain("goTo:epubcfi(/6/6!/4/8)");
    expect(port.calls).not.toContain("init:epubcfi(/6/4!/4/2)");
  });

  it("index fora da faixa não é aceito, nem chega a navegar", async () => {
    const port = new FakePort({ resolved: { index: 9, sectionCount: 5 } });
    const outcome = await restorePosition(port, position({ textSnippet: null }), HASH);
    expect(outcome.strategy).toBe("percentage");
    expect(port.calls.some((call) => call.startsWith("init:"))).toBe(false);
  });

  it("index negativo também é recusado", async () => {
    const port = new FakePort({ resolved: { index: -1, sectionCount: 5 } });
    const outcome = await restorePosition(port, position({ textSnippet: null }), HASH);
    expect(outcome.strategy).toBe("percentage");
  });

  it("falha na verificação (seção errada) passa ao próximo passo", async () => {
    const port = new FakePort({ observed: { sectionIndex: 0, containsCfiPoint: true } });
    const outcome = await restorePosition(port, position({ textSnippet: null }), HASH);
    expect(outcome.strategy).toBe("percentage");
    expect(outcome.failed).toEqual(["cfi"]);
  });

  it("falha na verificação (ponto fora do trecho visível) passa ao próximo passo", async () => {
    const port = new FakePort({ observed: { sectionIndex: 2, containsCfiPoint: false } });
    const outcome = await restorePosition(port, position({ textSnippet: null }), HASH);
    expect(outcome.strategy).toBe("percentage");
  });

  it("leitor sem localização lida como falha", async () => {
    const port = new FakePort({ observed: null });
    const outcome = await restorePosition(port, position({ textSnippet: null }), HASH);
    expect(outcome.strategy).toBe("percentage");
  });

  it("exceção ao navegar para o CFI também passa ao próximo passo", async () => {
    const port = new FakePort({ initThrows: true });
    const outcome = await restorePosition(port, position({ textSnippet: null }), HASH);
    expect(outcome.strategy).toBe("percentage");
  });

  it("arquivo trocado (fileHash diferente) ignora o CFI e usa o trecho", async () => {
    const port = new FakePort({ matches: { 2: "epubcfi(/6/2!/4/4)" } });
    const outcome = await restorePosition(port, position({ fileHash: OTHER_HASH }), HASH);
    expect(outcome.strategy).toBe("snippet");
    expect(outcome.failed).toEqual([]);
    expect(port.calls.some((call) => call.startsWith("resolve:"))).toBe(false);
  });

  it("busca o trecho da seção estimada para as vizinhas e para no primeiro achado", async () => {
    const port = new FakePort({ resolved: null, matches: { 3: "epubcfi(/6/8!/4/2)" } });
    await restorePosition(port, position(), HASH);
    expect(port.searched).toEqual([2, 1, 3]);
  });

  it("sempre limpa a busca, mesmo quando o trecho não é achado", async () => {
    const port = new FakePort({ resolved: null, matches: {} });
    const outcome = await restorePosition(port, position(), HASH);
    expect(outcome.strategy).toBe("percentage");
    expect(port.calls).toContain("clearSearch");
  });

  it("limpa a busca também quando ela ou o goTo lançam", async () => {
    const throwing = new FakePort({ resolved: null, searchThrowsAt: 2 });
    const first = await restorePosition(throwing, position(), HASH);
    expect(first.strategy).toBe("percentage");
    expect(throwing.calls).toContain("clearSearch");

    const goToFails = new FakePort({ resolved: null, matches: { 2: "x" }, goToThrows: true });
    const second = await restorePosition(goToFails, position(), HASH);
    expect(second.strategy).toBe("percentage");
    expect(goToFails.calls).toContain("clearSearch");
  });

  it("só percentual salvo vai direto para a fração", async () => {
    const port = new FakePort();
    const outcome = await restorePosition(
      port,
      position({ cfi: null, textSnippet: null, percentage: 0.37 }),
      HASH,
    );
    expect(outcome).toEqual({ strategy: "percentage", verified: false, failed: [] });
    expect(port.calls).toEqual(["fraction:0.37"]);
  });

  it("nada salvo abre no início do texto", async () => {
    const port = new FakePort();
    const outcome = await restorePosition(port, null, HASH);
    expect(outcome).toEqual({ strategy: "start", verified: false, failed: [] });
    expect(port.calls).toEqual(["start"]);
  });

  it("posição com percentual zero e sem CFI nem trecho abre no início", async () => {
    const port = new FakePort();
    const outcome = await restorePosition(
      port,
      position({ cfi: null, textSnippet: null, percentage: 0 }),
      HASH,
    );
    expect(outcome.strategy).toBe("start");
  });
});
