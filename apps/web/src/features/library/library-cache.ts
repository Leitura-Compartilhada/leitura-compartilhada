import type { Book, Shelf, UpdateBookRequest } from "@leitura/shared";
import type { QueryClient } from "@tanstack/react-query";
import { BOOKS_QUERY_KEY, SHELVES_QUERY_KEY } from "@/lib/queries";
import { applyBookPatch, removeShelfFromBooks, replaceBook } from "./library-model";

/**
 * Operações sobre o cache do TanStack Query, sem React, para a atualização otimista poder ser
 * testada. Cada troca mexe só no livro afetado: voltar atrás nunca desfaz a troca de outro livro
 * que aconteceu enquanto o pedido estava no ar.
 */

/** Aplica a edição no cache e devolve o livro como estava (ou `undefined` se não está no cache). */
export function applyOptimistic(
  client: QueryClient,
  bookId: string,
  patch: UpdateBookRequest,
): Book | undefined {
  const books = client.getQueryData<Book[]>(BOOKS_QUERY_KEY);
  const previous = books?.find((book) => book.id === bookId);
  if (books && previous) {
    client.setQueryData<Book[]>(
      BOOKS_QUERY_KEY,
      replaceBook(books, applyBookPatch(previous, patch)),
    );
  }
  return previous;
}

/**
 * Desfaz só os campos que a edição tocou, para não apagar o que outra edição mudou no meio
 * tempo. Sem `previous` (livro que não estava no cache) não há o que desfazer.
 */
export function rollbackOptimistic(
  client: QueryClient,
  previous: Book | undefined,
  patch: UpdateBookRequest,
): void {
  if (!previous) return;
  const books = client.getQueryData<Book[]>(BOOKS_QUERY_KEY);
  const current = books?.find((book) => book.id === previous.id);
  if (!books || !current) return;
  const revert: UpdateBookRequest = {};
  for (const key of Object.keys(patch) as (keyof UpdateBookRequest)[]) {
    Object.assign(revert, { [key]: previous[key] });
  }
  client.setQueryData<Book[]>(BOOKS_QUERY_KEY, replaceBook(books, applyBookPatch(current, revert)));
}

/** Guarda a resposta do servidor (a verdade) no lugar do livro. */
export function storeServerBook(client: QueryClient, saved: Book): void {
  client.setQueryData<Book[]>(BOOKS_QUERY_KEY, (books) => books && replaceBook(books, saved));
}

export function removeBookFromCache(client: QueryClient, bookId: string): void {
  client.setQueryData<Book[]>(BOOKS_QUERY_KEY, (books) =>
    books?.filter((book) => book.id !== bookId),
  );
}

export function removeShelfFromCache(client: QueryClient, shelfId: string): void {
  client.setQueryData<Book[]>(
    BOOKS_QUERY_KEY,
    (books) => books && removeShelfFromBooks(books, shelfId),
  );
  client.setQueryData<Shelf[]>(SHELVES_QUERY_KEY, (shelves) =>
    shelves?.filter((shelf) => shelf.id !== shelfId),
  );
}
