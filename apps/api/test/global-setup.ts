import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { prepareDisposableDatabase } from "@leitura/db/prepare";

/** Prepara o banco de teste, um "web buildado" mínimo e o storage limpo. */
export default async function setup(): Promise<void> {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("TEST_DATABASE_URL não definida");
  await prepareDisposableDatabase(testUrl);

  // Um "web buildado" mínimo, para testar o servidor de arquivos estáticos e o fallback de SPA.
  const webDist = process.env.WEB_DIST;
  if (webDist?.endsWith("leitura-test-web")) {
    await rm(webDist, { recursive: true, force: true });
    await mkdir(path.join(webDist, "assets"), { recursive: true });
    await writeFile(path.join(webDist, "index.html"), "<!doctype html><title>spa de teste</title>");
    await writeFile(path.join(webDist, "assets", "app-abc123.js"), "console.log('app');");
    await writeFile(path.join(webDist, "sw.js"), "// service worker de teste");
  }

  // Trava de segurança: só apaga a pasta de teste, nunca um STORAGE_DIR herdado do ambiente.
  const storageDir = process.env.STORAGE_DIR;
  if (storageDir?.endsWith("leitura-test-storage")) {
    await rm(storageDir, { recursive: true, force: true });
  }
}
