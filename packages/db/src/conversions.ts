import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { Db } from "./index.js";
import { conversionJobs } from "./schema/index.js";

/**
 * Marca como falhos (`TIMEOUT`) os jobs abandonados por uma queda:
 * - "em andamento" há mais de `staleMs` (o processo que os executava caiu no meio);
 * - na fila, sem original, há mais de `staleMs` (a API caiu no meio do envio).
 * Jobs na fila com original não entram: esperar a vez atrás de outras conversões é normal.
 * Devolve quantos eram.
 */
export async function failStaleConversionJobs(
  db: Db,
  staleMs: number,
  now: number = Date.now(),
): Promise<number> {
  const cutoff = new Date(now - staleMs);
  const rows = await db
    .update(conversionJobs)
    .set({
      status: "failed",
      errorCode: "TIMEOUT",
      error: "a conversão foi interrompida (o processo caiu antes de terminar)",
      finishedAt: new Date(now),
      updatedAt: new Date(now),
    })
    .where(
      and(
        lt(conversionJobs.updatedAt, cutoff),
        or(
          eq(conversionJobs.status, "running"),
          and(eq(conversionJobs.status, "queued"), isNull(conversionJobs.sourceKey)),
        ),
      ),
    )
    .returning({ id: conversionJobs.id });
  return rows.length;
}
