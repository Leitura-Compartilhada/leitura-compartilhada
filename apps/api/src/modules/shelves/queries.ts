import { books, bookTags, shelfBooks, shelves, tags } from "@leitura/db";
import { and, asc, count, eq, inArray, notExists, sql } from "drizzle-orm";
import type { Executor } from "../../lib/db-types.js";

export type ShelfRow = typeof shelves.$inferSelect;
export type BookLabels = { tags: string[]; shelfIds: string[] };

/** Estantes do usuário com a contagem de livros dele. */
export async function listShelvesWithCount(
  db: Executor,
  userId: string,
): Promise<{ shelf: ShelfRow; bookCount: number }[]> {
  return db
    .select({ shelf: shelves, bookCount: count(books.id) })
    .from(shelves)
    .leftJoin(shelfBooks, eq(shelfBooks.shelfId, shelves.id))
    .leftJoin(books, and(eq(books.id, shelfBooks.bookId), eq(books.ownerId, userId)))
    .where(eq(shelves.ownerId, userId))
    .groupBy(shelves.id)
    .orderBy(asc(shelves.position), asc(shelves.name));
}

export async function findShelfByName(
  db: Executor,
  userId: string,
  name: string,
): Promise<ShelfRow | null> {
  const [row] = await db
    .select()
    .from(shelves)
    .where(and(eq(shelves.ownerId, userId), eq(shelves.name, name)))
    .limit(1);
  return row ?? null;
}

export async function nextShelfPosition(db: Executor, userId: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`coalesce(max(${shelves.position}), -1) + 1` })
    .from(shelves)
    .where(eq(shelves.ownerId, userId));
  return Number(row?.value ?? 0);
}

export async function insertShelf(
  db: Executor,
  values: { ownerId: string; name: string; position: number },
): Promise<ShelfRow | null> {
  const [row] = await db
    .insert(shelves)
    .values(values)
    .onConflictDoNothing({ target: [shelves.ownerId, shelves.name] })
    .returning();
  return row ?? null;
}

export async function updateShelfRow(
  db: Executor,
  userId: string,
  shelfId: string,
  patch: { name?: string; position?: number },
): Promise<ShelfRow | null> {
  const [row] = await db
    .update(shelves)
    .set(patch)
    .where(and(eq(shelves.id, shelfId), eq(shelves.ownerId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteShelfRow(
  db: Executor,
  userId: string,
  shelfId: string,
): Promise<boolean> {
  const rows = await db
    .delete(shelves)
    .where(and(eq(shelves.id, shelfId), eq(shelves.ownerId, userId)))
    .returning({ id: shelves.id });
  return rows.length > 0;
}

/** Quantas das estantes pedidas pertencem ao usuário (para recusar ids alheios ou inexistentes). */
export async function countOwnedShelves(
  db: Executor,
  userId: string,
  shelfIds: string[],
): Promise<number> {
  if (shelfIds.length === 0) return 0;
  const [row] = await db
    .select({ value: count() })
    .from(shelves)
    .where(and(eq(shelves.ownerId, userId), inArray(shelves.id, shelfIds)));
  return Number(row?.value ?? 0);
}

/** Troca o conjunto de estantes de um livro. O livro já foi conferido como do usuário. */
export async function replaceBookShelves(
  db: Executor,
  bookId: string,
  shelfIds: string[],
): Promise<void> {
  await db.delete(shelfBooks).where(eq(shelfBooks.bookId, bookId));
  if (shelfIds.length > 0) {
    await db.insert(shelfBooks).values(shelfIds.map((shelfId) => ({ shelfId, bookId })));
  }
}

/** Troca as tags de um livro, criando as que faltam. Os nomes já vêm normalizados e sem repetição. */
export async function replaceBookTags(
  db: Executor,
  userId: string,
  bookId: string,
  names: string[],
): Promise<void> {
  await db.delete(bookTags).where(eq(bookTags.bookId, bookId));
  if (names.length === 0) return;
  // O upsert devolve o id de todas as tags (as novas e as que já existiam) numa só instrução.
  const rows = await db
    .insert(tags)
    .values(names.map((name) => ({ ownerId: userId, name })))
    .onConflictDoUpdate({ target: [tags.ownerId, tags.name], set: { name: sql`excluded.name` } })
    .returning({ id: tags.id });
  if (rows.length > 0) {
    await db.insert(bookTags).values(rows.map((row) => ({ bookId, tagId: row.id })));
  }
}

/** Tag que nenhum livro usa mais é apagada. */
export async function deleteOrphanTags(db: Executor, userId: string): Promise<void> {
  await db
    .delete(tags)
    .where(
      and(
        eq(tags.ownerId, userId),
        notExists(db.select({ one: sql`1` }).from(bookTags).where(eq(bookTags.tagId, tags.id))),
      ),
    );
}

/** Tags e estantes de cada livro (só do usuário), em duas consultas, sem N+1. */
export async function loadLabels(
  db: Executor,
  userId: string,
  bookIds?: string[],
): Promise<Map<string, BookLabels>> {
  const result = new Map<string, BookLabels>();
  if (bookIds && bookIds.length === 0) return result;
  const entry = (bookId: string): BookLabels => {
    let found = result.get(bookId);
    if (!found) {
      found = { tags: [], shelfIds: [] };
      result.set(bookId, found);
    }
    return found;
  };

  const tagRows = await db
    .select({ bookId: bookTags.bookId, name: tags.name })
    .from(bookTags)
    .innerJoin(tags, eq(tags.id, bookTags.tagId))
    .innerJoin(books, eq(books.id, bookTags.bookId))
    .where(
      and(
        eq(tags.ownerId, userId),
        eq(books.ownerId, userId),
        bookIds ? inArray(bookTags.bookId, bookIds) : undefined,
      ),
    )
    .orderBy(asc(tags.name));
  for (const row of tagRows) entry(row.bookId).tags.push(row.name);
  // A ordem do banco depende da collation; o contrato promete ordem alfabética em pt-BR.
  for (const labels of result.values()) labels.tags.sort((a, b) => a.localeCompare(b, "pt-BR"));

  const shelfRows = await db
    .select({ bookId: shelfBooks.bookId, shelfId: shelfBooks.shelfId })
    .from(shelfBooks)
    .innerJoin(shelves, eq(shelves.id, shelfBooks.shelfId))
    .innerJoin(books, eq(books.id, shelfBooks.bookId))
    .where(
      and(
        eq(shelves.ownerId, userId),
        eq(books.ownerId, userId),
        bookIds ? inArray(shelfBooks.bookId, bookIds) : undefined,
      ),
    )
    .orderBy(asc(shelves.position), asc(shelves.name));
  for (const row of shelfRows) entry(row.bookId).shelfIds.push(row.shelfId);
  return result;
}
