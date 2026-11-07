import type { Book, Shelf } from "@leitura/shared";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { BOOKS_QUERY_KEY, SHELVES_QUERY_KEY } from "@/lib/queries";
import {
  applyOptimistic,
  removeBookFromCache,
  removeShelfFromCache,
  rollbackOptimistic,
  storeServerBook,
} from "./library-cache";

function makeBook(n: number, overrides: Partial<Book> = {}): Book {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    title: `Livro ${n}`,
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

const [one, two] = [makeBook(1), makeBook(2)] as [Book, Book];
let client: QueryClient;
const books = () => client.getQueryData<Book[]>(BOOKS_QUERY_KEY) ?? [];

beforeEach(() => {
  client = new QueryClient();
  client.setQueryData(BOOKS_QUERY_KEY, [one, two]);
});

describe("cache da estante", () => {
  it("aplica a edição na hora e devolve o estado anterior", () => {
    const previous = applyOptimistic(client, one.id, { status: "read" });
    expect(previous).toEqual(one);
    expect(books()[0]?.status).toBe("read");
    expect(books()[1]).toEqual(two);
  });

  it("volta atrás só nos campos tocados, sem desfazer a troca de outro livro", () => {
    const patch = { status: "read" } as const;
    const previous = applyOptimistic(client, one.id, patch);
    applyOptimistic(client, two.id, { status: "reading" }); // outra troca rápida
    rollbackOptimistic(client, previous, patch);
    expect(books()[0]?.status).toBe("want_to_read");
    expect(books()[1]?.status).toBe("reading");
  });

  it("volta atrás sem apagar outro campo do mesmo livro", () => {
    const first = applyOptimistic(client, one.id, { status: "read" });
    applyOptimistic(client, one.id, { shelfIds: ["s1"] });
    rollbackOptimistic(client, first, { status: "read" });
    expect(books()[0]).toMatchObject({ status: "want_to_read", shelfIds: ["s1"] });
  });

  it("livro fora do cache não quebra nada", () => {
    expect(applyOptimistic(client, "x", { status: "read" })).toBeUndefined();
    expect(() => rollbackOptimistic(client, undefined, { status: "read" })).not.toThrow();
    expect(books()).toEqual([one, two]);
  });

  it("guarda a resposta do servidor e remove livro excluído", () => {
    storeServerBook(client, { ...one, title: "Do servidor" });
    expect(books()[0]?.title).toBe("Do servidor");
    removeBookFromCache(client, one.id);
    expect(books().map((b) => b.id)).toEqual([two.id]);
  });

  it("apagar uma estante tira ela da lista e dos livros", () => {
    const shelf: Shelf = { id: "s1", name: "A", position: 0, bookCount: 1 };
    client.setQueryData(SHELVES_QUERY_KEY, [shelf]);
    client.setQueryData(BOOKS_QUERY_KEY, [{ ...one, shelfIds: ["s1"] }, two]);
    removeShelfFromCache(client, "s1");
    expect(client.getQueryData(SHELVES_QUERY_KEY)).toEqual([]);
    expect(books()[0]?.shelfIds).toEqual([]);
  });
});
