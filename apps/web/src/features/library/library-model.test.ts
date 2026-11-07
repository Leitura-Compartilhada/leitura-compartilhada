import type { Book } from "@leitura/shared";
import { describe, expect, it } from "vitest";
import {
  ALL,
  applyBookPatch,
  collectTags,
  countByStatus,
  filterBooks,
  groupBySeries,
  hasActiveFilter,
  NO_FILTERS,
  removeShelfFromBooks,
  replaceBook,
  sortFlat,
  sortVolumes,
} from "./library-model";

let counter = 0;
function book(overrides: Partial<Book> = {}): Book {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    title: `Livro ${counter}`,
    authors: [],
    fileHash: "a".repeat(64),
    fileSize: 1,
    sourceFormat: "epub",
    hasCover: false,
    status: "want_to_read",
    series: null,
    seriesIndex: null,
    tags: [],
    shelfIds: [],
    createdAt: 0,
    percentage: null,
    ...overrides,
  };
}

describe("filtros", () => {
  const a = book({ status: "reading", tags: ["fantasia"], shelfIds: ["s1"] });
  const b = book({ status: "read", tags: ["fantasia", "clássico"], shelfIds: ["s1", "s2"] });
  const c = book({ status: "read" });
  const all = [a, b, c];

  it("sem filtro devolve tudo e não conta como filtro ativo", () => {
    expect(filterBooks(all, NO_FILTERS)).toEqual(all);
    expect(hasActiveFilter(NO_FILTERS)).toBe(false);
  });

  it("combina status, estante e tag", () => {
    expect(filterBooks(all, { ...NO_FILTERS, status: "read" })).toEqual([b, c]);
    expect(filterBooks(all, { ...NO_FILTERS, shelfId: "s2" })).toEqual([b]);
    expect(filterBooks(all, { ...NO_FILTERS, tag: "fantasia" })).toEqual([a, b]);
    expect(filterBooks(all, { status: "read", shelfId: "s1", tag: "fantasia" })).toEqual([b]);
    expect(hasActiveFilter({ ...NO_FILTERS, tag: "x" })).toBe(true);
  });

  it("conta por status respeitando estante e tag, mas não o próprio status", () => {
    const counts = countByStatus(all, { status: "reading", shelfId: "s1", tag: ALL });
    expect(counts).toEqual({
      [ALL]: 2,
      want_to_read: 0,
      reading: 1,
      read: 1,
      abandoned: 0,
    });
  });

  it("junta as tags sem repetir, em ordem alfabética", () => {
    expect(collectTags(all)).toEqual(["clássico", "fantasia"]);
  });
});

describe("volumes de uma série", () => {
  it("ordena por índice, aceita decimais e põe sem índice no fim, por título", () => {
    const v2 = book({ title: "B", series: "S", seriesIndex: 2 });
    const v10 = book({ title: "J", series: "S", seriesIndex: 10 });
    const v15 = book({ title: "M", series: "S", seriesIndex: 1.5 });
    const semB = book({ title: "Zebra", series: "S" });
    const semA = book({ title: "Abelha", series: "S" });
    expect(sortVolumes([semB, v10, v2, semA, v15]).map((x) => x.title)).toEqual([
      "M",
      "B",
      "J",
      "Abelha",
      "Zebra",
    ]);
  });

  it("desempata volumes repetidos por título, de forma estável", () => {
    const x = book({ title: "Beta", series: "S", seriesIndex: 1 });
    const y = book({ title: "Alfa", series: "S", seriesIndex: 1 });
    expect(sortVolumes([x, y]).map((v) => v.title)).toEqual(["Alfa", "Beta"]);
    expect(sortVolumes([y, x]).map((v) => v.title)).toEqual(["Alfa", "Beta"]);
  });

  it("não altera o array recebido", () => {
    const list = [book({ seriesIndex: 2 }), book({ seriesIndex: 1 })];
    const copy = [...list];
    sortVolumes(list);
    expect(list).toEqual(copy);
  });
});

describe("agrupamento por série", () => {
  it("séries em ordem alfabética e 'sem série' por último", () => {
    const groups = groupBySeries([
      book({ title: "Solto B" }),
      book({ title: "Z2", series: "Zeta", seriesIndex: 2 }),
      book({ title: "A1", series: "Alfa", seriesIndex: 1 }),
      book({ title: "Z1", series: "Zeta", seriesIndex: 1 }),
      book({ title: "Solto A" }),
    ]);
    expect(groups.map((g) => g.series)).toEqual(["Alfa", "Zeta", null]);
    expect(groups[1]?.books.map((b) => b.title)).toEqual(["Z1", "Z2"]);
    expect(groups[2]?.books.map((b) => b.title)).toEqual(["Solto A", "Solto B"]);
  });

  it("sem livros não há grupos", () => {
    expect(groupBySeries([])).toEqual([]);
  });

  it("a ordem plana é por título, ignorando maiúsculas e acentos", () => {
    expect(
      sortFlat([book({ title: "ágata" }), book({ title: "Abelha" })]).map((b) => b.title),
    ).toEqual(["Abelha", "ágata"]);
  });
});

describe("atualização otimista", () => {
  it("aplica só os campos enviados e ordena as tags", () => {
    const original = book({ status: "reading", title: "Antes" });
    const next = applyBookPatch(original, { status: "read", tags: ["b", "a"] });
    expect(next).toMatchObject({ status: "read", title: "Antes", tags: ["a", "b"] });
    expect(original.status).toBe("reading");
  });

  it("limpa a série com null", () => {
    const original = book({ series: "S", seriesIndex: 3 });
    expect(applyBookPatch(original, { series: null, seriesIndex: null })).toMatchObject({
      series: null,
      seriesIndex: null,
    });
  });

  it("troca um livro na lista e tira uma estante apagada de todos", () => {
    const a = book({ shelfIds: ["s1", "s2"] });
    const b = book({ shelfIds: ["s2"] });
    const c = book();
    expect(replaceBook([a, b], { ...b, title: "Novo" })[1]?.title).toBe("Novo");
    const result = removeShelfFromBooks([a, b, c], "s2");
    expect(result.map((x) => x.shelfIds)).toEqual([["s1"], [], []]);
    expect(result[2]).toBe(c);
  });
});
