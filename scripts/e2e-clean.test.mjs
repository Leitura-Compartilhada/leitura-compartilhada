import assert from "node:assert/strict";
import { test } from "node:test";
import { isE2eDatabase, isE2eStorageDir } from "./e2e-clean.mjs";

test("casa os bancos que o E2E cria", () => {
  for (const name of ["leitura_e2e", "leitura_pipe_e2e", "leitura_dast_e2e", "leitura_a1b2_e2e"]) {
    assert.equal(isE2eDatabase(name), true, name);
  }
});

test("nunca casa o banco de verdade nem os de teste", () => {
  for (const name of [
    "leitura",
    "leitura_test",
    "leitura_worker_test",
    "postgres",
    "template1",
    "outro_e2e",
    "leitura_e2e_backup",
    "leitura_MAIUSCULA_e2e",
    "leitura_instancia_com_nome_muito_longo_e2e",
    "leitura__e2e",
  ]) {
    assert.equal(isE2eDatabase(name), false, name);
  }
});

test("casa só as pastas de storage do E2E", () => {
  for (const name of [
    "leitura-e2e-storage",
    "pipe-leitura-e2e-storage",
    "dast-leitura-e2e-storage",
  ]) {
    assert.equal(isE2eStorageDir(name), true, name);
  }
  for (const name of [
    "storage",
    "leitura-storage",
    "leitura-e2e-storage-velho",
    "x-y-leitura-e2e-storage",
  ]) {
    assert.equal(isE2eStorageDir(name), false, name);
  }
});
