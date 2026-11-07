import type { Db } from "@leitura/db";
import { normalizeTag, type Shelf } from "@leitura/shared";
import type { Executor } from "../../lib/db-types.js";
import { AppError } from "../../lib/errors.js";
import {
  type BookLabels,
  countOwnedShelves,
  deleteOrphanTags,
  deleteShelfRow,
  findShelfByName,
  insertShelf,
  listShelvesWithCount,
  loadLabels,
  nextShelfPosition,
  replaceBookShelves,
  replaceBookTags,
  type ShelfRow,
  updateShelfRow,
} from "./queries.js";

export type { BookLabels };

const toShelf = (row: ShelfRow, bookCount: number): Shelf => ({
  id: row.id,
  name: row.name,
  position: row.position,
  bookCount,
});

export async function listShelves(db: Db, userId: string): Promise<Shelf[]> {
  const rows = await listShelvesWithCount(db, userId);
  return rows.map((row) => toShelf(row.shelf, row.bookCount));
}

export async function createShelf(db: Db, userId: string, name: string): Promise<Shelf> {
  const position = await nextShelfPosition(db, userId);
  const created = await insertShelf(db, { ownerId: userId, name, position });
  if (!created) throw new AppError("CONFLICT", "já existe uma estante com esse nome");
  return toShelf(created, 0);
}

export async function updateShelf(
  db: Db,
  userId: string,
  shelfId: string,
  patch: { name?: string; position?: number },
): Promise<Shelf> {
  if (patch.name !== undefined) {
    const same = await findShelfByName(db, userId, patch.name);
    if (same && same.id !== shelfId) {
      throw new AppError("CONFLICT", "já existe uma estante com esse nome");
    }
  }
  const updated = await updateShelfRow(db, userId, shelfId, patch);
  if (!updated) throw new AppError("NOT_FOUND", "estante não encontrada");
  const counted = (await listShelvesWithCount(db, userId)).find((row) => row.shelf.id === shelfId);
  return toShelf(updated, counted?.bookCount ?? 0);
}

/** Apaga a estante; os livros continuam existindo. */
export async function deleteShelf(db: Db, userId: string, shelfId: string): Promise<void> {
  const deleted = await deleteShelfRow(db, userId, shelfId);
  if (!deleted) throw new AppError("NOT_FOUND", "estante não encontrada");
}

/** Tags normalizadas, sem repetição e em ordem alfabética. */
export function normalizeTags(names: string[]): string[] {
  return [...new Set(names.map(normalizeTag).filter((name) => name !== ""))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
}

/**
 * Troca as tags e/ou as estantes de um livro do usuário (já conferido por quem chama). Estante de
 * outro usuário ou inexistente é recusada com a mesma resposta, sem revelar qual dos dois é.
 */
export async function applyBookLabels(
  tx: Executor,
  userId: string,
  bookId: string,
  labels: { tags?: string[]; shelfIds?: string[] },
): Promise<void> {
  if (labels.shelfIds !== undefined) {
    const ids = [...new Set(labels.shelfIds)];
    if ((await countOwnedShelves(tx, userId, ids)) !== ids.length) {
      throw new AppError("VALIDATION", "estante inválida");
    }
    await replaceBookShelves(tx, bookId, ids);
  }
  if (labels.tags !== undefined) {
    await replaceBookTags(tx, userId, bookId, normalizeTags(labels.tags));
    await deleteOrphanTags(tx, userId);
  }
}

/** Tags e estantes dos livros pedidos (ou de todos), para montar o DTO do livro. */
export const labelsForBooks = loadLabels;

/** Remove as tags que ficaram sem livro (depois de excluir um livro). */
export const cleanupTags = deleteOrphanTags;
