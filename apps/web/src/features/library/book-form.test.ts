import type { Book } from "@leitura/shared";
import { describe, expect, it } from "vitest";
import { buildPatch, cleanTags, formFromBook, parseSeriesIndex, splitAuthors } from "./book-form";

const base: Book = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Título",
  authors: ["Ana", "Bia"],
  fileHash: "a".repeat(64),
  fileSize: 1,
  sourceFormat: "epub",
  hasCover: false,
  status: "reading",
  series: "Saga",
  seriesIndex: 2,
  tags: ["fantasia"],
  shelfIds: ["b8c3b1de-0000-4000-8000-000000000001"],
  createdAt: 0,
  percentage: null,
};

describe("formulário do livro", () => {
  it("sem mudança não há o que enviar", () => {
    expect(buildPatch(base, formFromBook(base))).toEqual({ ok: true, patch: null });
  });

  it("envia só os campos alterados", () => {
    const form = { ...formFromBook(base), title: "  Novo  ", status: "read" as const };
    expect(buildPatch(base, form)).toEqual({ ok: true, patch: { title: "Novo", status: "read" } });
  });

  it("limpar série e volume manda null", () => {
    const form = { ...formFromBook(base), series: "  ", seriesIndex: "" };
    expect(buildPatch(base, form)).toEqual({
      ok: true,
      patch: { series: null, seriesIndex: null },
    });
  });

  it("autores: um por linha, sem linhas vazias", () => {
    expect(splitAuthors("Ana\r\n\n  Bia  \n")).toEqual(["Ana", "Bia"]);
    const form = { ...formFromBook(base), authors: "Ana\nCris" };
    expect(buildPatch(base, form)).toEqual({ ok: true, patch: { authors: ["Ana", "Cris"] } });
  });

  it("tags: normaliza e remove repetidas; trocar a ordem não conta como mudança", () => {
    expect(cleanTags(["  Fantasia ", "fantasia", "Ação  Rápida", " "])).toEqual([
      "fantasia",
      "ação rápida",
    ]);
    const same = { ...formFromBook(base), tags: ["FANTASIA"] };
    expect(buildPatch(base, same)).toEqual({ ok: true, patch: null });
  });

  it("volume aceita vírgula decimal e recusa texto", () => {
    expect(parseSeriesIndex("1,5")).toBe(1.5);
    expect(parseSeriesIndex(" ")).toBeNull();
    expect(parseSeriesIndex("dois")).toBeNaN();
    expect(parseSeriesIndex("-1")).toBeNaN();
    const bad = buildPatch(base, { ...formFromBook(base), seriesIndex: "dois" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.seriesIndex).toBeDefined();
  });

  it("valida com o schema do servidor: título vazio e volume grande demais", () => {
    const empty = buildPatch(base, { ...formFromBook(base), title: "   " });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors.title).toBeDefined();
    const big = buildPatch(base, { ...formFromBook(base), seriesIndex: "99999" });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.errors.seriesIndex).toBeDefined();
  });
});
