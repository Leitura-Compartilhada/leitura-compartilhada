import type { Book, ReadingStatus, UpdateBookRequest } from "@leitura/shared";

/** Valor que significa "sem filtro" nos seletores (o Select não aceita string vazia). */
export const ALL = "__all__";

export const STATUS_ORDER: readonly ReadingStatus[] = [
  "want_to_read",
  "reading",
  "read",
  "abandoned",
];

export const STATUS_LABELS: Record<ReadingStatus, string> = {
  want_to_read: "Quero ler",
  reading: "Lendo",
  read: "Lido",
  abandoned: "Abandonado",
};

export type Filters = {
  status: ReadingStatus | typeof ALL;
  shelfId: string;
  tag: string;
};

export const NO_FILTERS: Filters = { status: ALL, shelfId: ALL, tag: ALL };

export function hasActiveFilter(filters: Filters): boolean {
  return filters.status !== ALL || filters.shelfId !== ALL || filters.tag !== ALL;
}

function matches(book: Book, filters: Filters, ignoreStatus: boolean): boolean {
  if (!ignoreStatus && filters.status !== ALL && book.status !== filters.status) return false;
  if (filters.shelfId !== ALL && !book.shelfIds.includes(filters.shelfId)) return false;
  if (filters.tag !== ALL && !book.tags.includes(filters.tag)) return false;
  return true;
}

export function filterBooks(books: readonly Book[], filters: Filters): Book[] {
  return books.filter((book) => matches(book, filters, false));
}

export type StatusCounts = Record<ReadingStatus | typeof ALL, number>;

/** Quantos livros cada status teria com os outros filtros (estante e tag) aplicados. */
export function countByStatus(books: readonly Book[], filters: Filters): StatusCounts {
  const counts: StatusCounts = { [ALL]: 0, want_to_read: 0, reading: 0, read: 0, abandoned: 0 };
  for (const book of books) {
    if (!matches(book, filters, true)) continue;
    counts[ALL] += 1;
    counts[book.status] += 1;
  }
  return counts;
}

/** Todas as tags em uso, sem repetição, em ordem alfabética. */
export function collectTags(books: readonly Book[]): string[] {
  return [...new Set(books.flatMap((book) => book.tags))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
}

const byTitle = (a: Book, b: Book) =>
  a.title.localeCompare(b.title, "pt-BR", { sensitivity: "base", numeric: true }) ||
  a.id.localeCompare(b.id);

/** Volumes por `seriesIndex` (aceita decimais como 1.5); sem índice vão ao fim, por título. */
export function sortVolumes(books: readonly Book[]): Book[] {
  return [...books].sort((a, b) => {
    if (a.seriesIndex !== null && b.seriesIndex !== null) {
      return a.seriesIndex - b.seriesIndex || byTitle(a, b);
    }
    if (a.seriesIndex !== null) return -1;
    if (b.seriesIndex !== null) return 1;
    return byTitle(a, b);
  });
}

export type BookGroup = {
  /** Nome da série, ou `null` para "Sem série". */
  series: string | null;
  books: Book[];
};

/**
 * Séries em ordem alfabética, cada uma com os volumes ordenados; livros sem série formam o
 * último grupo. O nome da série é comparado como veio (o servidor já o devolve aparado).
 */
export function groupBySeries(books: readonly Book[]): BookGroup[] {
  const bySeries = new Map<string, Book[]>();
  const loose: Book[] = [];
  for (const book of books) {
    if (book.series === null) {
      loose.push(book);
      continue;
    }
    const list = bySeries.get(book.series);
    if (list) list.push(book);
    else bySeries.set(book.series, [book]);
  }
  const groups: BookGroup[] = [...bySeries.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true }))
    .map(([series, list]) => ({ series, books: sortVolumes(list) }));
  if (loose.length > 0) groups.push({ series: null, books: [...loose].sort(byTitle) });
  return groups;
}

/** Lista plana: ordem alfabética por título. */
export function sortFlat(books: readonly Book[]): Book[] {
  return [...books].sort(byTitle);
}

/** Aplica uma edição ao livro como o servidor a aplicaria (usado na atualização otimista). */
export function applyBookPatch(book: Book, patch: UpdateBookRequest): Book {
  return {
    ...book,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.authors !== undefined ? { authors: patch.authors } : {}),
    ...(patch.series !== undefined ? { series: patch.series } : {}),
    ...(patch.seriesIndex !== undefined ? { seriesIndex: patch.seriesIndex } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.tags !== undefined
      ? { tags: [...patch.tags].sort((a, b) => a.localeCompare(b, "pt-BR")) }
      : {}),
    ...(patch.shelfIds !== undefined ? { shelfIds: patch.shelfIds } : {}),
  };
}

export function replaceBook(books: readonly Book[], next: Book): Book[] {
  return books.map((book) => (book.id === next.id ? next : book));
}

/** Tira a estante apagada de todos os livros (o servidor também a remove deles). */
export function removeShelfFromBooks(books: readonly Book[], shelfId: string): Book[] {
  return books.map((book) =>
    book.shelfIds.includes(shelfId)
      ? { ...book, shelfIds: book.shelfIds.filter((id) => id !== shelfId) }
      : book,
  );
}
