import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// A API serve o web já buildado (uma origem só), em porta e banco próprios do E2E.
//
// Duas pessoas (ou agentes) rodando o E2E ao mesmo tempo precisam de instâncias separadas:
//   E2E_INSTANCE=sonnet E2E_PORT=3201 pnpm e2e
// usa o banco `leitura_sonnet_e2e`, a pasta `sonnet-leitura-e2e-storage` e a porta 3201.
const INSTANCE = process.env.E2E_INSTANCE ?? "";
if (INSTANCE && !/^[a-z0-9]{1,16}$/.test(INSTANCE)) {
  throw new Error(
    `E2E_INSTANCE inválida: "${INSTANCE}" (use de 1 a 16 letras minúsculas ou dígitos)`,
  );
}
const PORT = Number(process.env.E2E_PORT ?? 3200);
const BASE_URL = `http://localhost:${PORT}`;
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  `postgres://leitura:leitura@localhost:5432/leitura${INSTANCE ? `_${INSTANCE}` : ""}_e2e`;
// O sufixo fixo é uma trava: o setup só apaga pastas com este final.
export const E2E_STORAGE_DIR = path.join(
  os.tmpdir(),
  `${INSTANCE ? `${INSTANCE}-` : ""}leitura-e2e-storage`,
);

// Mesmo ambiente para a API e o worker: banco, storage e segredos do E2E.
const SERVER_ENV = {
  NODE_ENV: "test",
  API_PORT: String(PORT),
  API_URL: BASE_URL,
  WEB_URL: BASE_URL,
  DATABASE_URL,
  ALLOW_SIGNUP: "true",
  BETTER_AUTH_SECRET: "segredo-do-e2e-com-mais-de-dezesseis-caracteres",
  STORAGE_DIR: E2E_STORAGE_DIR,
};

export default defineConfig({
  testDir: "./e2e/tests",
  globalSetup: "./e2e/global-setup.ts",
  // Os testes compartilham um banco e uma API, então rodam um de cada vez.
  fullyParallel: false,
  workers: 1,
  // Um test.only esquecido não pode passar o CI pulando o resto.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    // Localmente não há retry, então "on-first-retry" nunca gravaria nada.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Prepara o banco descartável (cria, migra, limpa) e sobe a API.
      command: `pnpm --filter @leitura/db prepare:disposable ${DATABASE_URL} && pnpm --filter @leitura/api start`,
      url: `${BASE_URL}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: SERVER_ENV,
    },
    {
      // O worker converte formatos com o Calibre (se não houver, os specs de conversão pulam).
      // Sobe depois da API, que já deixou o banco pronto.
      command: "pnpm --filter @leitura/worker start",
      wait: { stdout: /\[worker\] pronto/ },
      reuseExistingServer: false,
      timeout: 120_000,
      env: { ...SERVER_ENV, CONVERT_TIMEOUT_MS: "120000" },
    },
  ],
});
