import { readingStates } from "@leitura/db";
import {
  clampFutureStamp,
  pickLatest,
  type ReadingState,
  type SyncRejection,
  type SyncRequest,
  type SyncResponse,
} from "@leitura/shared";
import { and, eq, gt, inArray, max, or, sql } from "drizzle-orm";
import type { Tx } from "../../lib/db-types.js";
import { advanceStatusOnRead, ownedBookIds } from "../books/service.js";
import { toReadingState } from "../progress/mapper.js";

export type { Tx };

/**
 * Junta os itens do pedido por livro (last-write-wins dentro do próprio pedido, senão o Postgres
 * recusa o upsert que atinge a mesma linha duas vezes), aplica o `deviceId` do pedido e rebaixa
 * horários que passam da tolerância à frente do relógio do servidor.
 */
function normalize(request: SyncRequest, serverNow: number): Map<string, ReadingState> {
  const byBook = new Map<string, ReadingState>();
  for (const item of request.readingStates) {
    const candidate: ReadingState = {
      ...item,
      deviceId: request.deviceId,
      updatedAt: clampFutureStamp(item.updatedAt, serverNow),
    };
    const current = byBook.get(candidate.bookId);
    byBook.set(candidate.bookId, current ? pickLatest(current, candidate) : candidate);
  }
  return byBook;
}

async function maxSyncedAt(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx
    .select({ value: max(readingStates.syncedAt) })
    .from(readingStates)
    .where(eq(readingStates.userId, userId));
  return Number(row?.value ?? 0);
}

/**
 * Um ciclo de sync de progresso. Roda em transação e começa com um lock por usuário: sem ele,
 * duas requisições concorrentes poderiam confirmar fora da ordem dos cursores, e uma gravação
 * ficaria atrás de um cursor que outro aparelho já recebeu, para nunca mais ser entregue.
 *
 * O cursor é `max(agora, último + 1)`: cresce a cada gravação aplicada, mesmo que o relógio do
 * servidor volte no tempo.
 */
export async function runSync(
  tx: Tx,
  userId: string,
  request: SyncRequest,
  serverNow: number,
): Promise<SyncResponse> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);

  const incoming = normalize(request, serverNow);
  const bookIds = [...incoming.keys()];
  const owned = await ownedBookIds(tx, userId, bookIds);

  // Livro de outra pessoa, apagado ou inexistente: recusa só o item. Se a requisição inteira
  // falhasse, um único livro apagado travaria a outbox do aparelho para sempre.
  const rejected: SyncRejection[] = bookIds
    .filter((id) => !owned.has(id))
    .map((bookId) => ({ bookId, code: "NOT_FOUND" }));
  const accepted = [...incoming.values()].filter((state) => owned.has(state.bookId));

  const previousMax = await maxSyncedAt(tx, userId);
  const stamp = Math.max(serverNow, previousMax + 1);

  const applied = new Set<string>();
  if (accepted.length > 0) {
    const written = await tx
      .insert(readingStates)
      .values(
        accepted.map((state) => ({
          userId,
          bookId: state.bookId,
          status: state.status,
          cfi: state.cfi,
          percentage: state.percentage,
          textSnippet: state.textSnippet,
          fileHash: state.fileHash,
          deviceId: state.deviceId,
          updatedAt: state.updatedAt,
          syncedAt: stamp,
        })),
      )
      .onConflictDoUpdate({
        target: [readingStates.userId, readingStates.bookId],
        set: {
          status: sql`excluded.status`,
          cfi: sql`excluded.cfi`,
          percentage: sql`excluded.percentage`,
          textSnippet: sql`excluded.text_snippet`,
          fileHash: sql`excluded.file_hash`,
          deviceId: sql`excluded.device_id`,
          updatedAt: sql`excluded.updated_at`,
          syncedAt: sql`excluded.synced_at`,
        },
        // Mesma regra do `isNewer` em @leitura/shared: horário e, em empate, deviceId por bytes.
        setWhere: sql`(${readingStates.updatedAt}, ${readingStates.deviceId} collate "C")
          < (excluded.updated_at, excluded.device_id collate "C")`,
      })
      .returning({ bookId: readingStates.bookId });
    for (const row of written) applied.add(row.bookId);
    await advanceStatusOnRead(
      tx,
      userId,
      accepted.filter((state) => applied.has(state.bookId)),
    );
  }

  // Estados que perderam o conflito voltam na resposta, para o aparelho convergir já.
  const lost = accepted.map((state) => state.bookId).filter((id) => !applied.has(id));
  // Cursor do cliente à frente do servidor (banco recriado, por exemplo): sincroniza tudo de novo.
  const since = request.since > previousMax ? 0 : request.since;
  const newer = gt(readingStates.syncedAt, since);
  const rows = await tx
    .select()
    .from(readingStates)
    .where(
      and(
        eq(readingStates.userId, userId),
        lost.length > 0 ? or(newer, inArray(readingStates.bookId, lost)) : newer,
      ),
    );

  return {
    cursor: applied.size > 0 ? stamp : previousMax,
    serverTime: serverNow,
    readingStates: rows.map(toReadingState),
    rejected,
    annotations: [],
  };
}
