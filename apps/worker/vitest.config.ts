import { defineConfig } from "vitest/config";

// Os testes de job usam um Postgres de verdade, em um banco só do worker (as suítes da API rodam
// em paralelo no `pnpm test` da raiz e não podem dividir o mesmo banco).
const TEST_DATABASE_URL =
  process.env.WORKER_TEST_DATABASE_URL ??
  "postgres://leitura:leitura@localhost:5432/leitura_worker_test";

process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: { TEST_DATABASE_URL, DATABASE_URL: TEST_DATABASE_URL, NODE_ENV: "test" },
  },
});
