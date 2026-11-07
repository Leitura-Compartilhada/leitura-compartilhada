import { books, readingStates } from "@leitura/db";
import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { Executor } from "../../lib/db-types.js";
import type { BookRow } from "./mapper.js";

export type { BookRow };

/** Livro do usuário que veio da conversão deste original (hash do arquivo de origem). */
export async function findBookBySourceHash(
  db: Executor,
  userId: string,
  sourceHash: string,
): Promise<BookRow | null> {
  const [row] = await db
    .select()
    .from(books)
    .where(and(eq(books.ownerId, userId), eq(books.sourceHash, sourceHash)))
    .limit(1);
  return row ?? null;
}

/** Dos hashes pedidos, os que o usuário já tem (como arquivo da estante ou como original convertido). */
export async function findKnownHashes(
  db: Executor,
  userId: string,
  hashes: string[],
): Promise<string[]> {
  if (hashes.length === 0) return [];
  const rows = await db
    .select({ fileHash: books.fileHash, sourceHash: books.sourceHash })
    .from(books)
    .where(
      and(
        eq(books.ownerId, userId),
        or(inArray(books.fileHash, hashes), inArray(books.sourceHash, hashes)),
      ),
    );
  const wanted = new Set(hashes);
  const known = new Set<string>();
  for (const row of rows) {
    if (row.fileHash && wanted.has(row.fileHash)) known.add(row.fileHash);
    if (row.sourceHash && wanted.has(row.sourceHash)) known.add(row.sourceHash);
  }
  return [...known];
}

/** Campos que o dono pode alterar à mão (`PATCH`). */
export type BookPatch = Partial<
  Pick<BookRow, "title" | "authors" | "series" | "seriesIndex" | "readingStatus">
>;

/**
 * Livro do usuário, ou `null`. Livro de outra pessoa também dá `null`, e quem chama responde 404:
 * a API nunca confirma que um id alheio existe.
 */
export async function findOwnedBook(
  db: Executor,
  userId: string,
  bookId: string,
  lock?: "update",
): Promise<BookRow | null> {
  const query = db
    .select()
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.ownerId, userId)))
    .limit(1);
  const [row] = await (lock ? query.for("update") : query);
  return row ?? null;
}

/** Dos ids pedidos, os que são do usuário. `FOR KEY SHARE` impede um `DELETE` concorrente de passar. */
export async function findOwnedBookIds(
  db: Executor,
  userId: string,
  bookIds: string[],
): Promise<Set<string>> {
  if (bookIds.length === 0) return new Set();
  const rows = await db
    .select({ id: books.id })
    .from(books)
    .where(and(eq(books.ownerId, userId), inArray(books.id, bookIds)))
    .for("key share");
  return new Set(rows.map((row) => row.id));
}

/** `want_to_read` → `reading` para os livros pedidos (só quem ainda está em `want_to_read`). */
export async function markReading(db: Executor, userId: string, bookIds: string[]) {
  if (bookIds.length === 0) return;
  await db
    .update(books)
    .set({ readingStatus: "reading" })
    .where(
      and(
        eq(books.ownerId, userId),
        inArray(books.id, bookIds),
        eq(books.readingStatus, "want_to_read"),
      ),
    );
}

/** `want_to_read`/`reading` → `read` para os livros pedidos; `read` e `abandoned` ficam como estão. */
export async function markRead(db: Executor, userId: string, bookIds: string[]) {
  if (bookIds.length === 0) return;
  await db
    .update(books)
    .set({ readingStatus: "read" })
    .where(
      and(
        eq(books.ownerId, userId),
        inArray(books.id, bookIds),
        inArray(books.readingStatus, ["want_to_read", "reading"]),
      ),
    );
}

export async function findBookByHash(
  db: Executor,
  userId: string,
  fileHash: string,
): Promise<BookRow | null> {
  const [row] = await db
    .select()
    .from(books)
    .where(and(eq(books.ownerId, userId), eq(books.fileHash, fileHash)))
    .limit(1);
  return row ?? null;
}

export async function findPercentage(
  db: Executor,
  userId: string,
  bookId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ percentage: readingStates.percentage })
    .from(readingStates)
    .where(and(eq(readingStates.userId, userId), eq(readingStates.bookId, bookId)))
    .limit(1);
  return row?.percentage ?? null;
}

/** Livros prontos do usuário com o progresso dele, do mais novo para o mais antigo. */
export async function listReadyBooks(
  db: Executor,
  userId: string,
): Promise<{ book: BookRow; percentage: number | null }[]> {
  return db
    .select({ book: books, percentage: readingStates.percentage })
    .from(books)
    .leftJoin(
      readingStates,
      and(eq(readingStates.bookId, books.id), eq(readingStates.userId, userId)),
    )
    .where(
      and(eq(books.ownerId, userId), eq(books.ingestStatus, "ready"), isNotNull(books.fileHash)),
    )
    .orderBy(desc(books.createdAt));
}

export async function updateBookRow(
  db: Executor,
  userId: string,
  bookId: string,
  patch: BookPatch,
): Promise<BookRow | null> {
  const [row] = await db
    .update(books)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(books.id, bookId), eq(books.ownerId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteBookRow(
  db: Executor,
  userId: string,
  bookId: string,
): Promise<BookRow | null> {
  const [row] = await db
    .delete(books)
    .where(and(eq(books.id, bookId), eq(books.ownerId, userId)))
    .returning();
  return row ?? null;
}
