import { conversionJobs } from "@leitura/db";
import type { ConversionErrorCode } from "@leitura/shared";
import { and, count, desc, eq, gt, inArray, isNotNull, or } from "drizzle-orm";
import type { Executor } from "../../lib/db-types.js";

export type JobRow = typeof conversionJobs.$inferSelect;

const ACTIVE = ["queued", "running"] as const;

export async function insertJob(
  db: Executor,
  values: typeof conversionJobs.$inferInsert,
): Promise<JobRow> {
  const [row] = await db.insert(conversionJobs).values(values).returning();
  if (!row) throw new Error("não foi possível criar o job de conversão");
  return row;
}

/** Job do usuário, ou `null` (também para o job de outra pessoa: a API responde 404). */
export async function findOwnedJob(
  db: Executor,
  userId: string,
  jobId: string,
): Promise<JobRow | null> {
  const [row] = await db
    .select()
    .from(conversionJobs)
    .where(and(eq(conversionJobs.id, jobId), eq(conversionJobs.ownerId, userId)))
    .limit(1);
  return row ?? null;
}

/** Conversão anterior do mesmo original que já virou livro (e o livro ainda existe). */
export async function findDoneJobBySource(
  db: Executor,
  userId: string,
  sourceHash: string,
): Promise<JobRow | null> {
  const [row] = await db
    .select()
    .from(conversionJobs)
    .where(
      and(
        eq(conversionJobs.ownerId, userId),
        eq(conversionJobs.sourceHash, sourceHash),
        eq(conversionJobs.status, "done"),
        isNotNull(conversionJobs.bookId),
      ),
    )
    .orderBy(desc(conversionJobs.finishedAt))
    .limit(1);
  return row ?? null;
}

/** Job a ingerir: em andamento e com o EPUB convertido já guardado. Sem filtro de dono (é o sistema). */
export async function findJobToIngest(db: Executor, jobId: string): Promise<JobRow | null> {
  const [row] = await db
    .select()
    .from(conversionJobs)
    .where(
      and(
        eq(conversionJobs.id, jobId),
        eq(conversionJobs.status, "running"),
        isNotNull(conversionJobs.resultKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** O que a tela mostra: em andamento, falhos e concluídos há pouco. */
export async function listVisibleJobs(
  db: Executor,
  userId: string,
  doneSince: Date,
  limit = 50,
): Promise<JobRow[]> {
  return db
    .select()
    .from(conversionJobs)
    .where(
      and(
        eq(conversionJobs.ownerId, userId),
        or(
          inArray(conversionJobs.status, [...ACTIVE, "failed"]),
          and(eq(conversionJobs.status, "done"), gt(conversionJobs.finishedAt, doneSince)),
        ),
      ),
    )
    .orderBy(desc(conversionJobs.createdAt))
    .limit(limit);
}

export async function countActiveJobs(db: Executor, userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(conversionJobs)
    .where(and(eq(conversionJobs.ownerId, userId), inArray(conversionJobs.status, [...ACTIVE])));
  return Number(row?.value ?? 0);
}

/**
 * Apaga os jobs falhos além dos `keep` mais recentes do usuário e devolve as linhas apagadas, para
 * quem chama limpar os arquivos. Sem isso um usuário acumularia originais de falhas para sempre.
 */
export async function deleteOldFailedJobs(
  db: Executor,
  userId: string,
  keep: number,
): Promise<JobRow[]> {
  const old = await db
    .select({ id: conversionJobs.id })
    .from(conversionJobs)
    .where(and(eq(conversionJobs.ownerId, userId), eq(conversionJobs.status, "failed")))
    .orderBy(desc(conversionJobs.createdAt))
    .offset(keep);
  if (old.length === 0) return [];
  return db
    .delete(conversionJobs)
    .where(
      and(
        eq(conversionJobs.ownerId, userId),
        inArray(
          conversionJobs.id,
          old.map((row) => row.id),
        ),
      ),
    )
    .returning();
}

/** O original foi guardado: o job passa a ter arquivo e hash, e só então pode ir para a fila. */
export async function setSourceReady(
  db: Executor,
  jobId: string,
  values: { sourceKey: string; sourceHash: string },
): Promise<boolean> {
  const rows = await db
    .update(conversionJobs)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(conversionJobs.id, jobId), eq(conversionJobs.status, "queued")))
    .returning({ id: conversionJobs.id });
  return rows.length > 0;
}

/** `failed` → `queued` para tentar de novo. Só falhos; devolve `null` se o job não está assim. */
export async function requeueJob(
  db: Executor,
  userId: string,
  jobId: string,
): Promise<JobRow | null> {
  const [row] = await db
    .update(conversionJobs)
    .set({
      status: "queued",
      errorCode: null,
      error: null,
      resultKey: null,
      finishedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(conversionJobs.id, jobId),
        eq(conversionJobs.ownerId, userId),
        eq(conversionJobs.status, "failed"),
        isNotNull(conversionJobs.sourceKey),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteJob(
  db: Executor,
  userId: string,
  jobId: string,
): Promise<JobRow | null> {
  const [row] = await db
    .delete(conversionJobs)
    .where(and(eq(conversionJobs.id, jobId), eq(conversionJobs.ownerId, userId)))
    .returning();
  return row ?? null;
}

/** Conclui o job (só se ainda está em andamento: não sobrescreve um job falho ou concluído). */
export async function markDone(
  db: Executor,
  jobId: string,
  bookId: string,
  extra: { sourceHash?: string } = {},
): Promise<void> {
  const now = new Date();
  await db
    .update(conversionJobs)
    .set({
      status: "done",
      bookId,
      sourceKey: null,
      resultKey: null,
      errorCode: null,
      error: null,
      finishedAt: now,
      updatedAt: now,
      ...extra,
    })
    .where(and(eq(conversionJobs.id, jobId), inArray(conversionJobs.status, [...ACTIVE])));
}

/** Falha de um job ainda em andamento (nunca ressuscita um job descartado ou já concluído). */
export async function markFailed(
  db: Executor,
  jobId: string,
  code: ConversionErrorCode,
  detail: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(conversionJobs)
    .set({
      status: "failed",
      errorCode: code,
      error: detail.slice(0, 2000),
      finishedAt: now,
      updatedAt: now,
    })
    .where(and(eq(conversionJobs.id, jobId), inArray(conversionJobs.status, [...ACTIVE])));
}
