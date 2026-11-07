import { createDb, failStaleConversionJobs } from "@leitura/db";
import { conversionStaleMs, QUEUE_CONVERT, QUEUE_INGEST } from "@leitura/shared";
import PgBoss from "pg-boss";
import { runCalibre } from "./calibre.js";
import { env } from "./env.js";
import { convertJob } from "./jobs/convert.js";
import { pdfAiJob, QUEUE_PDF_AI } from "./jobs/pdf-ai.js";

const QUEUE_PING = "ping";
const SWEEP_EVERY_MS = 5 * 60 * 1000;

const { db, pool } = createDb(env.databaseUrl);
const storage = env.storage();
const boss = new PgBoss(env.databaseUrl);
boss.on("error", (err) => console.error("[pg-boss]", err));
await boss.start();

for (const name of [QUEUE_PING, QUEUE_CONVERT, QUEUE_INGEST, QUEUE_PDF_AI]) {
  await boss.createQueue(name);
}
// Conversão falha de forma determinística: sem repetição automática (há "tentar de novo" na
// tela). O prazo do job precisa passar do timeout do Calibre, senão a fila o dá por perdido.
await boss.updateQueue(QUEUE_CONVERT, {
  retryLimit: 0,
  expireInSeconds: Math.ceil((env.convertTimeoutMs * 2) / 1000),
});

// Cada `work` processa um job por vez: uma conversão de cada vez (o Calibre é pesado).
await boss.work(QUEUE_PING, async ([job]) => {
  console.log("[worker] ping recebido", job?.data);
});
await boss.work(QUEUE_CONVERT, async ([job]) =>
  convertJob(
    {
      db,
      storage,
      calibre: runCalibre,
      calibreBin: env.calibreBin,
      timeoutMs: env.convertTimeoutMs,
      enqueueIngest: async (jobId) => {
        await boss.send(QUEUE_INGEST, { jobId });
      },
    },
    job?.data,
  ),
);
await boss.work(QUEUE_PDF_AI, async ([job]) => pdfAiJob(job?.data));

// Job "em andamento" de um processo que caiu vira falha em vez de ficar preso para sempre.
const sweep = async () => {
  const failed = await failStaleConversionJobs(db, conversionStaleMs(env.convertTimeoutMs));
  if (failed > 0)
    console.warn(`[worker] ${failed} conversão(ões) abandonada(s) marcada(s) como falha`);
};
await sweep();
const sweeper = setInterval(
  () => void sweep().catch((e) => console.error("[worker] varredura", e)),
  SWEEP_EVERY_MS,
);

await boss.send(QUEUE_PING, { at: new Date().toISOString() });
console.log(`[worker] pronto (Calibre: ${env.calibreBin}, timeout ${env.convertTimeoutMs} ms)`);

const shutdown = async () => {
  clearInterval(sweeper);
  await boss.stop();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
