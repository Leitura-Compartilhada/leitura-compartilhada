import { describe, expect, it } from "vitest";
import {
  applyKnown,
  buildCandidates,
  describeCandidate,
  formatBytes,
  type ImportCandidate,
  type ItemOutcome,
  initialSelection,
  isDone,
  isIgnoredFile,
  MAX_IMPORT_FILES,
  outcomeLabel,
  summarize,
} from "./import-model";

const file = (name: string, relative?: string) => {
  const f = new File(["x"], name);
  if (relative) Object.defineProperty(f, "webkitRelativePath", { value: relative });
  return f;
};

describe("isIgnoredFile", () => {
  it("ignora arquivos de sistema e ocultos", () => {
    for (const name of [
      ".DS_Store",
      "Thumbs.db",
      "desktop.ini",
      ".oculto.epub",
      "~$rascunho.docx",
    ]) {
      expect(isIgnoredFile(name), name).toBe(true);
    }
    expect(isIgnoredFile("Livro.epub")).toBe(false);
  });
});

describe("buildCandidates", () => {
  it("classifica pela extensão e guarda o caminho da pasta", () => {
    const { candidates, cut } = buildCandidates([
      file("a.epub", "Minha pasta/a.epub"),
      file("b.mobi", "Minha pasta/sub/b.mobi"),
      file("c.pdf"),
      file("d.xyz"),
      file(".DS_Store"),
    ]);
    expect(cut).toBe(0);
    expect(candidates.map((c) => [c.path, c.kind, c.state])).toEqual([
      ["Minha pasta/a.epub", "epub", "new"],
      ["Minha pasta/sub/b.mobi", "convert", "new"],
      ["c.pdf", "refused", "refused"],
      ["d.xyz", "refused", "refused"],
    ]);
    expect(candidates[2]?.reason).toMatch(/PDF/);
  });

  it("corta o que passa do limite e diz quantos ficaram de fora", () => {
    const many = Array.from({ length: MAX_IMPORT_FILES + 7 }, (_, i) => file(`l${i}.epub`));
    const { candidates, cut } = buildCandidates(many);
    expect(candidates).toHaveLength(MAX_IMPORT_FILES);
    expect(cut).toBe(7);
  });
});

describe("applyKnown e initialSelection", () => {
  it("desmarca o que já está na estante e deixa marcado o novo e o não conferido", () => {
    const { candidates } = buildCandidates([
      file("a.epub"),
      file("b.epub"),
      file("c.epub"),
      file("d.pdf"),
    ]);
    const [a, b, c] = candidates;
    const hashes = new Map<string, string | null>([
      [a?.id ?? "", "aa"],
      [b?.id ?? "", "bb"],
      [c?.id ?? "", null],
    ]);
    const result = applyKnown(candidates, hashes, new Set(["aa"]));
    expect(result.map((r) => r.state)).toEqual(["known", "new", "unchecked", "refused"]);
    expect([...initialSelection(result)]).toEqual([b?.id, c?.id]);
  });
});

describe("resumo", () => {
  it("conta enviados e erros, e sabe quando terminou", () => {
    const outcomes = [
      { status: "book", title: "A" },
      { status: "failed", message: "x" },
      { status: "sending" },
    ] as const;
    expect(summarize([...outcomes])).toBe("2 de 3 enviados, 1 com erro");
    expect(isDone([...outcomes])).toBe(false);
    expect(isDone([{ status: "converting" }, { status: "book", title: "B" }])).toBe(true);
  });

  it("formata tamanhos", () => {
    expect(formatBytes(10)).toBe("1 KB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2,5 MB");
  });
});

describe("o que a tela mostra", () => {
  it("descreve o candidato com o caminho e o tamanho", () => {
    const { candidates } = buildCandidates([file("a.epub", "Pasta/a.epub")]);
    expect(describeCandidate(candidates[0] as ImportCandidate)).toBe("Pasta/a.epub (1 KB)");
  });

  it("dá um rótulo para cada situação do envio", () => {
    expect(outcomeLabel({ status: "waiting" })).toBe("Aguardando");
    expect(outcomeLabel({ status: "sending" })).toBe("Enviando…");
    expect(outcomeLabel({ status: "book", title: "X" })).toBe("Na estante");
    expect(outcomeLabel({ status: "converting" })).toBe("Enviado para conversão");
    expect(outcomeLabel({ status: "failed", message: "deu ruim" })).toBe("deu ruim");
  });

  it("caminho vazio da pasta cai para o nome do arquivo", () => {
    const f = file("solto.epub", "");
    expect(buildCandidates([f]).candidates[0]?.path).toBe("solto.epub");
  });

  it("PDF e formato desconhecido têm motivos diferentes", () => {
    const { candidates } = buildCandidates([file("a.pdf"), file("b.xyz")]);
    expect(candidates[0]?.reason).toMatch(/PDF/);
    expect(candidates[1]?.reason).not.toMatch(/PDF/);
    expect(candidates[1]?.reason).toBeTruthy();
  });

  it("tamanho: 1 MB exato já é MB", () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe("1024 KB");
    expect(formatBytes(1024 * 1024)).toBe("1,0 MB");
  });

  it("o resumo conta cada situação certa", () => {
    const only = (...o: ItemOutcome[]) => summarize(o);
    expect(only({ status: "book", title: "A" })).toBe("1 de 1 enviados");
    expect(only({ status: "converting" })).toBe("1 de 1 enviados");
    expect(only({ status: "failed", message: "x" })).toBe("1 de 1 enviados, 1 com erro");
    expect(only({ status: "waiting" })).toBe("0 de 1 enviados");
    expect(only({ status: "sending" })).toBe("0 de 1 enviados");
    expect(only({ status: "book", title: "A" }, { status: "book", title: "B" })).toBe(
      "2 de 2 enviados",
    );
  });

  it("só termina quando ninguém espera nem envia", () => {
    expect(isDone([{ status: "waiting" }])).toBe(false);
    expect(isDone([{ status: "sending" }])).toBe(false);
    expect(isDone([{ status: "failed", message: "x" }])).toBe(true);
    expect(isDone([])).toBe(true);
  });
});
