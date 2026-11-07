import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Os testes de integração usam um Postgres de verdade, em um banco separado do de desenvolvimento.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://leitura:leitura@localhost:5432/leitura_test";

// O storage de teste tem um nome próprio: o setup apaga esta pasta, então ela nunca pode ser a de dev.
export const TEST_STORAGE_DIR = path.join(os.tmpdir(), "leitura-test-storage");

// Web "buildado" de mentira, criado pelo setup. Também só é apagado se tiver este nome.
export const TEST_WEB_DIST = path.join(os.tmpdir(), "leitura-test-web");

// `globalSetup` roda no processo principal, que não recebe `test.env`. Por isso também fixamos aqui.
process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;
process.env.STORAGE_DIR = TEST_STORAGE_DIR;
process.env.WEB_DIST = TEST_WEB_DIST;

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // Os arquivos de teste compartilham o mesmo banco, então rodam um de cada vez.
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      TEST_DATABASE_URL,
      DATABASE_URL: TEST_DATABASE_URL,
      BETTER_AUTH_SECRET: "segredo-de-teste-com-mais-de-dezesseis-caracteres",
      STORAGE_DIR: TEST_STORAGE_DIR,
      WEB_DIST: TEST_WEB_DIST,
      ALLOW_SIGNUP: "true",
      NODE_ENV: "test",
    },
  },
});
