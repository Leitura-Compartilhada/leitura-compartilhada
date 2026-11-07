import type { Book, UpdateBookRequest } from "@leitura/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createShelf,
  deleteBook,
  deleteShelf,
  listBooks,
  listShelves,
  updateBook,
  updateShelf,
} from "@/lib/api";
import { BOOKS_QUERY_KEY, SHELVES_QUERY_KEY } from "@/lib/queries";
import {
  applyOptimistic,
  removeBookFromCache,
  removeShelfFromCache,
  rollbackOptimistic,
  storeServerBook,
} from "./library-cache";

export function useBooks() {
  return useQuery({ queryKey: BOOKS_QUERY_KEY, queryFn: listBooks, retry: false });
}

export function useShelves() {
  return useQuery({ queryKey: SHELVES_QUERY_KEY, queryFn: listShelves, retry: false });
}

type EditVariables = { bookId: string; patch: UpdateBookRequest };

/**
 * Edita um livro. Com `optimistic` a tela muda na hora e volta atrás se o servidor recusar (troca
 * rápida de status ou estante pelo menu); sem ele a tela espera a resposta (diálogo de edição, que
 * precisa mostrar o erro sem perder o que foi digitado).
 */
export function useUpdateBook({ optimistic }: { optimistic: boolean }) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ bookId, patch }: EditVariables) => updateBook(bookId, patch),
    onMutate: async ({ bookId, patch }) => {
      if (!optimistic) return { previous: undefined };
      await client.cancelQueries({ queryKey: BOOKS_QUERY_KEY });
      return { previous: applyOptimistic(client, bookId, patch) };
    },
    onError: (_error, { patch }, context) => {
      if (optimistic) rollbackOptimistic(client, context?.previous, patch);
    },
    onSuccess: (saved: Book) => storeServerBook(client, saved),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: BOOKS_QUERY_KEY });
      void client.invalidateQueries({ queryKey: SHELVES_QUERY_KEY });
    },
  });
}

export function useDeleteBook() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (bookId: string) => deleteBook(bookId),
    onSuccess: (_data, bookId) => removeBookFromCache(client, bookId),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: BOOKS_QUERY_KEY });
      void client.invalidateQueries({ queryKey: SHELVES_QUERY_KEY });
    },
  });
}

export function useShelfMutations() {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: SHELVES_QUERY_KEY });
  };
  const create = useMutation({ mutationFn: createShelf, onSuccess: refresh });
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateShelf(id, { name }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: deleteShelf,
    onSuccess: (_data, shelfId) => {
      removeShelfFromCache(client, shelfId);
      void client.invalidateQueries({ queryKey: BOOKS_QUERY_KEY });
      refresh();
    },
  });
  return { create, rename, remove };
}
