import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { books, type Db } from "@leitura/db";
import { AUTO_READ_THRESHOLD, type Book } from "@leitura/shared";
import type { StorageDriver } from "@leitura/storage";
import type { Executor } from "../../lib/db-types.js";
import { AppError } from "../../lib/errors.js";
import { inferSeries } from "../../lib/series.js";
import { titleFromFilename } from "../../lib/title.js";
import { labelsForBooks } from "../shelves/service.js";
import { bookStorageKey, toBookDto } from "./mapper.js";
import { extractAndStoreMetadata } from "./metadata.js";
import {
  type BookRow,
  findBookByHash,
  findBookBySourceHash,
  findKnownHashes,
  findOwnedBook,
  findOwnedBookIds,
  findPercentage,
  listReadyBooks,
  markRead,
  markReading,
} from "./queries.js";
import { inspectUpload, type UploadStats } from "./upload-stream.js";

export type BooksDeps = { db: Db; storage: StorageDriver };

export type UploadResult = { book: Book; created: boolean };

/**
 * Guarda um EPUB enviado: grava no storage enquanto calcula o hash, deduplica por dono e hash,
 * extrai metadados e capa (melhor esforço) e insere o livro. Nunca deixa arquivo órfão.
 */
export async function ingestUpload(
  { db, storage }: BooksDeps,
  input: {
    userId: string;
    filename: string;
    file: AsyncIterable<Buffer> & { truncated?: boolean };
    /** Hash do arquivo original, quando o EPUB vem de uma conversão. */
    sourceHash?: string;
  },
): Promise<UploadResult> {
  const { userId } = input;
  const bookId = randomUUID();
  const key = bookStorageKey(userId, bookId);
  const stats: UploadStats = { hash: createHash("sha256"), size: 0 };
  await storage.put(key, Readable.from(inspectUpload(input.file, stats)));
  const fileHash = stats.hash.digest("hex");

  let coverKey: string | null = null;
  try {
    const existing = await findBookByHash(db, userId, fileHash);
    if (existing) {
      await storage.delete(key); // o mesmo livro já está guardado
      return { book: await toDtoWithProgress(db, userId, existing), created: false };
    }

    // Título, autores, idioma e capa do próprio EPUB; se falhar, vale o nome do arquivo.
    const meta = await extractAndStoreMetadata(storage, { ownerId: userId, bookId, fileKey: key });
    coverKey = meta.coverPath;

    const title = meta.title ?? titleFromFilename(input.filename);
    // Série do OPF; sem ela, sugerida pelo título e pelo nome do arquivo (o usuário pode editar).
    const guess = meta.series ? null : inferSeries({ title, filename: input.filename });
    const [created] = await db
      .insert(books)
      .values({
        id: bookId,
        ownerId: userId,
        title,
        authors: meta.authors,
        language: meta.language,
        series: meta.series ?? guess?.series ?? null,
        seriesIndex: meta.series ? meta.seriesIndex : (guess?.index ?? null),
        coverPath: meta.coverPath,
        filePath: key,
        fileHash,
        fileSize: stats.size,
        sourceHash: input.sourceHash ?? null,
        sourceFormat: "epub",
        ingestStatus: "ready",
      })
      .onConflictDoNothing({ target: [books.ownerId, books.fileHash] })
      .returning();
    if (created) return { book: toBookDto(created, null), created: true };

    // Dois envios iguais ao mesmo tempo: o outro ganhou a corrida.
    await storage.delete(key);
    if (coverKey) await storage.delete(coverKey).catch(() => {});
    const winner = await findBookByHash(db, userId, fileHash);
    if (!winner) throw new Error("conflito de hash sem livro correspondente");
    return { book: await toDtoWithProgress(db, userId, winner), created: false };
  } catch (error) {
    await storage.delete(key).catch(() => {}); // não deixa arquivo órfão se o banco falhar
    if (coverKey) await storage.delete(coverKey).catch(() => {});
    throw error;
  }
}

/** Livro que já veio da conversão deste original, ou `null`. */
export async function findConvertedBook(
  db: Db,
  userId: string,
  sourceHash: string,
): Promise<BookRow | null> {
  return findBookBySourceHash(db, userId, sourceHash);
}

/** Dos hashes pedidos, os que o usuário já tem na estante. Só devolve hashes do próprio dono. */
export async function knownHashes(db: Db, userId: string, hashes: string[]): Promise<string[]> {
  return findKnownHashes(db, userId, [...new Set(hashes)]);
}

export async function toDtoWithProgress(db: Db, userId: string, row: BookRow): Promise<Book> {
  const [percentage, labels] = await Promise.all([
    findPercentage(db, userId, row.id),
    labelsForBooks(db, userId, [row.id]),
  ]);
  return toBookDto(row, percentage, labels.get(row.id));
}

export async function listBooks(db: Db, userId: string): Promise<Book[]> {
  const [rows, labels] = await Promise.all([
    listReadyBooks(db, userId),
    labelsForBooks(db, userId),
  ]);
  return rows.map((row) => toBookDto(row.book, row.percentage, labels.get(row.book.id)));
}

/** Livro do usuário, ou 404 (também para o livro de outra pessoa). */
export async function requireOwnedBook(db: Db, userId: string, bookId: string): Promise<BookRow> {
  const book = await findOwnedBook(db, userId, bookId);
  if (!book) throw new AppError("NOT_FOUND", "livro não encontrado");
  return book;
}

/** Dos ids pedidos, os livros que pertencem ao usuário (usado pelo sync para recusar o resto). */
export const ownedBookIds = findOwnedBookIds;

/**
 * Status de leitura que acompanha a posição, só para a frente: "quero ler" vira "lendo" ao gravar
 * uma posição, e "lendo" (ou "quero ler") vira "lido" ao passar de `AUTO_READ_THRESHOLD`. "Lido" e
 * "abandonado" marcados à mão nunca são mexidos. Chamado pelo sync, na mesma transação do upsert,
 * só para posições que ganharam o conflito.
 */
export async function advanceStatusOnRead(
  tx: Executor,
  userId: string,
  positions: { bookId: string; percentage: number }[],
): Promise<void> {
  await markReading(
    tx,
    userId,
    positions.map((position) => position.bookId),
  );
  await markRead(
    tx,
    userId,
    positions.filter((position) => position.percentage >= AUTO_READ_THRESHOLD).map((p) => p.bookId),
  );
}
