import type { ProgressResponse, ReadingState } from "@leitura/shared";
import { getProgress } from "@/lib/api";
import { type LocalDb, localDb, readLocalState } from "@/lib/db";
import { type SyncEngine, syncEngine } from "@/lib/sync";

/** Quanto esperar o servidor ao abrir um livro. Passou disso, vale o que há no aparelho. */
export const REMOTE_POSITION_TIMEOUT_MS = 3_000;

export type SavedPositionDeps = {
  db: LocalDb;
  engine: Pick<SyncEngine, "adoptRemoteState">;
  fetchRemote: (bookId: string, timeoutMs: number) => Promise<ProgressResponse>;
  isOnline: () => boolean;
};

const defaultDeps: SavedPositionDeps = {
  db: localDb,
  engine: syncEngine,
  fetchRemote: getProgress,
  isOnline: () => navigator.onLine,
};

/**
 * Posição salva a usar ao abrir um livro: a mais nova entre o aparelho e o servidor (last-write-wins
 * de `pickLatest`). Sem rede, ou se o servidor demorar mais de 3 s, só o local.
 */
export async function loadSavedState(
  bookId: string,
  deps: SavedPositionDeps = defaultDeps,
): Promise<ReadingState | null> {
  const local = await readLocalState(deps.db, bookId);
  if (!deps.isOnline()) return local;
  try {
    const { readingState } = await deps.fetchRemote(bookId, REMOTE_POSITION_TIMEOUT_MS);
    if (!readingState) return local;
    return await deps.engine.adoptRemoteState(readingState);
  } catch (error) {
    console.warn("posição do servidor indisponível, usando a do aparelho", error);
    return local;
  }
}
