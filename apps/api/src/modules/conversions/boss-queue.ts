import { QUEUE_CONVERT, QUEUE_INGEST } from "@leitura/shared";
import PgBoss from "pg-boss";
import type { ConversionQueue } from "./queue.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fila de conversões sobre o pg-boss, no mesmo Postgres. O worker consome `book.convert`. */
export function createBossQueue(databaseUrl: string): ConversionQueue {
  const boss = new PgBoss(databaseUrl);
  boss.on("error", (error) => console.error("[pg-boss]", error));
  let started: Promise<void> | null = null;

  const start = () =>
    (started ??= (async () => {
      await boss.start();
      await boss.createQueue(QUEUE_CONVERT);
      await boss.createQueue(QUEUE_INGEST);
      // Sem repetição automática: uma ingestão que falha já marca o job como falho (o usuário tenta
      // de novo pela tela), então repetir só reencontraria o job fora de "em andamento".
      await boss.updateQueue(QUEUE_INGEST, { retryLimit: 0 });
    })());

  return {
    async enqueueConvert(jobId) {
      await start();
      await boss.send(QUEUE_CONVERT, { jobId });
    },
    async onIngest(handler) {
      await start();
      await boss.work(QUEUE_INGEST, async ([job]) => {
        const jobId = (job?.data as { jobId?: unknown } | undefined)?.jobId;
        if (typeof jobId === "string" && UUID.test(jobId)) await handler(jobId);
      });
    },
    async stop() {
      if (started) await boss.stop();
    },
  };
}
