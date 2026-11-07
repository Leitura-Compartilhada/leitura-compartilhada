import { z } from "zod";
import {
  MAX_AUTHOR_LENGTH,
  MAX_AUTHORS,
  MAX_SERIES_INDEX,
  MAX_SERIES_LENGTH,
  MAX_SHELVES_PER_BOOK,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_BOOK,
  MAX_TITLE_LENGTH,
} from "./constants.js";
import { readingStatusSchema } from "./reading.js";
import { cleanText, visibleText } from "./text.js";

export const bookSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  authors: z.array(z.string()),
  /** SHA-256 em hexadecimal. Também é o ETag do download. */
  fileHash: z.string(),
  fileSize: z.number().int().nonnegative(),
  sourceFormat: z.string(),
  /** `true` quando o servidor achou uma capa no EPUB: `GET /api/books/:id/cover` a devolve. */
  hasCover: z.boolean(),
  /** Status de leitura do dono. Muda à mão (`PATCH`) ou sozinho, para a frente, ao ler. */
  status: readingStatusSchema,
  /** Nome da série e posição do volume nela; `null` quando o livro não pertence a uma série. */
  series: z.string().nullable(),
  seriesIndex: z.number().nullable(),
  /** Tags já normalizadas (minúsculas, sem espaços nas pontas), em ordem alfabética. */
  tags: z.array(z.string()),
  /** Estantes em que o livro está. */
  shelfIds: z.array(z.string().uuid()),
  /** ms desde a época. */
  createdAt: z.number().int(),
  /** Progresso do usuário atual (0 a 1), ou `null` se ainda não abriu o livro. */
  percentage: z.number().min(0).max(1).nullable(),
});
export type Book = z.infer<typeof bookSchema>;

export const listBooksResponseSchema = z.object({ books: z.array(bookSchema) });
export type ListBooksResponse = z.infer<typeof listBooksResponseSchema>;

/**
 * `PATCH /api/books/:id`. Todo campo é opcional e o que não vier fica como está. `tags` e
 * `shelfIds` substituem o conjunto inteiro. `series` e `seriesIndex` aceitam `null` para limpar.
 */
export const updateBookRequestSchema = z
  .object({
    title: visibleText(MAX_TITLE_LENGTH),
    authors: z.array(visibleText(MAX_AUTHOR_LENGTH)).max(MAX_AUTHORS),
    series: visibleText(MAX_SERIES_LENGTH).nullable(),
    seriesIndex: z.number().min(0).max(MAX_SERIES_INDEX).nullable(),
    status: readingStatusSchema,
    tags: z.array(visibleText(MAX_TAG_LENGTH)).max(MAX_TAGS_PER_BOOK),
    shelfIds: z.array(z.string().uuid()).max(MAX_SHELVES_PER_BOOK),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "envie ao menos um campo" });
export type UpdateBookRequest = z.infer<typeof updateBookRequestSchema>;

/** Forma única de uma tag: NFC, sem invisíveis nem espaços nas pontas, minúscula, espaços colapsados. */
export function normalizeTag(tag: string): string {
  return cleanText(tag).replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
}

/** `POST /api/books/known-hashes`: quais destes arquivos (SHA-256 em hexadecimal) já estão na estante. */
export const MAX_KNOWN_HASHES = 500;
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
export const knownHashesRequestSchema = z.object({
  hashes: z.array(sha256Hex).max(MAX_KNOWN_HASHES),
});
export type KnownHashesRequest = z.infer<typeof knownHashesRequestSchema>;
export const knownHashesResponseSchema = z.object({ known: z.array(sha256Hex) });
export type KnownHashesResponse = z.infer<typeof knownHashesResponseSchema>;
