import { type Annotation, type ReadingState, readingStateSchema } from "@leitura/shared";
import Dexie, { type EntityTable } from "dexie";

/** Cache local (offline-first): livros baixados e outbox de alterações pendentes de sync. */
export type CachedBook = { id: string; fileHash: string; blob: Blob; cachedAt: number };

export type OutboxKind = "reading" | "annotation";
export type OutboxItem = { id?: number; kind: OutboxKind; payloadId: string };

/** Estado do motor de sync que precisa sobreviver a recarregar a página. */
export type MetaKey = "cursor" | "clockOffset" | "lastStamp";
export type MetaRow = { key: MetaKey; value: number };

export type LocalDb = Dexie & {
  books: EntityTable<CachedBook, "id">;
  readingStates: EntityTable<ReadingState, "bookId">;
  annotations: EntityTable<Annotation, "id">;
  outbox: EntityTable<OutboxItem, "id">;
  meta: EntityTable<MetaRow, "key">;
};

export function createLocalDb(name = "leitura"): LocalDb {
  const db = new Dexie(name) as LocalDb;
  db.version(1).stores({
    books: "id, fileHash",
    readingStates: "bookId, updatedAt",
    annotations: "id, bookId, updatedAt",
    outbox: "++id, kind, payloadId",
  });
  // v2: a outbox guarda no máximo um item por (kind, payloadId): só o último estado de cada livro
  // interessa. `meta` guarda cursor, desvio de relógio e o último `updatedAt` gravado.
  db.version(2).stores({
    outbox: "++id, &[kind+payloadId]",
    meta: "key",
  });
  return db;
}

export const localDb = createLocalDb();

/**
 * Lê o estado local de um livro. O IndexedDB é fronteira de dados: um registro corrompido ou
 * de versão antiga vira "sem estado" em vez de derrubar o leitor.
 */
export async function readLocalState(db: LocalDb, bookId: string): Promise<ReadingState | null> {
  const row = await db.readingStates.get(bookId);
  if (!row) return null;
  const parsed = readingStateSchema.safeParse(row);
  if (!parsed.success) {
    console.warn("estado local de leitura inválido, ignorado", bookId);
    return null;
  }
  return parsed.data;
}
