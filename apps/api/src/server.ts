import { createDb, failStaleConversionJobs } from "@leitura/db";
import { conversionStaleMs, convertTimeoutFromEnv } from "@leitura/shared";
import { buildApp } from "./app.js";
import { env } from "./env.js";
import { createBossQueue } from "./modules/conversions/boss-queue.js";

// Conversão que ficou "em andamento" porque o processo caiu vira falha em vez de ficar presa.
const maintenance = createDb(env.DATABASE_URL);
const abandoned = await failStaleConversionJobs(
  maintenance.db,
  conversionStaleMs(convertTimeoutFromEnv(process.env.CONVERT_TIMEOUT_MS)),
);
await maintenance.pool.end();
if (abandoned > 0) console.warn(`${abandoned} conversão(ões) abandonada(s) marcada(s) como falha`);

const app = await buildApp({ queue: createBossQueue(env.DATABASE_URL) });

try {
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Cookie de sessão `Secure` e prefixo `__Secure-` dependem de HTTPS; sem ele o login falha.
if (env.NODE_ENV === "production" && !env.API_URL.startsWith("https://")) {
  app.log.warn(`API_URL (${env.API_URL}) não é https: o cookie de sessão não será seguro`);
}
if (env.API_HOST === "0.0.0.0") {
  app.log.warn(
    "a API escuta em todas as interfaces; atrás do Tailscale prefira API_HOST=127.0.0.1",
  );
}
