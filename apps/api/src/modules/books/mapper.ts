import type { books } from "@leitura/db";
import type { Book } from "@leitura/shared";
import type { BookLabels } from "../shelves/service.js";

export type BookRow = typeof books.$inferSelect;

const NO_LABELS: BookLabels = { tags: [], shelfIds: [] };

/**
 * Livro como o cliente enxerga. `percentage` é o progresso do usuário que pede, não do dono do
 * arquivo; `labels` traz as tags e estantes do livro.
 */
export function toBookDto(
  row: BookRow,
  percentage: number | null,
  labels: BookLabels = NO_LABELS,
): Book {
  if (!row.fileHash) throw new Error(`livro ${row.id} sem hash: a ingestão não terminou`);
  return {
    id: row.id,
    title: row.title,
    authors: row.authors,
    fileHash: row.fileHash,
    fileSize: row.fileSize ?? 0,
    sourceFormat: row.sourceFormat,
    hasCover: row.coverPath !== null,
    status: row.readingStatus,
    series: row.series,
    seriesIndex: row.seriesIndex,
    tags: labels.tags,
    shelfIds: labels.shelfIds,
    createdAt: row.createdAt.getTime(),
    percentage,
  };
}

/** Chave do arquivo no storage. Usa o id do livro (e não o hash) porque o hash só existe depois do upload. */
export function bookStorageKey(ownerId: string, bookId: string): string {
  return `books/${ownerId}/${bookId}.epub`;
}

/** Chave da capa. A extensão vem dos bytes da imagem e depois decide o `Content-Type` ao servir. */
export function coverStorageKey(ownerId: string, bookId: string, ext: string): string {
  return `covers/${ownerId}/${bookId}.${ext}`;
}
