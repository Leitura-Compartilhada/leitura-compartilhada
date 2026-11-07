import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, evaluate } from "./check-file-size.mjs";

test("classifica código, teste e o que é ignorado", () => {
  assert.equal(classify("apps/api/src/app.ts"), "source");
  assert.equal(classify("apps/api/test/books.test.ts"), "test");
  assert.equal(classify("e2e/tests/theme.spec.ts"), "test");
  assert.equal(classify("apps/web/src/vendor/foliate-js/view.js"), null);
  assert.equal(classify("apps/web/src/components/ui/button.tsx"), null);
  assert.equal(classify("packages/db/drizzle/0001.sql"), null);
  assert.equal(classify("README.md"), null);
});

test("aviso acima de 250 e erro acima de 400 no código", () => {
  const result = evaluate([
    { file: "a/ok.ts", lines: 250 },
    { file: "a/aviso.ts", lines: 251 },
    { file: "a/limite.ts", lines: 400 },
    { file: "a/erro.ts", lines: 401 },
  ]);
  // 251 e 400 avisam (400 ainda é aceito); 401 é erro.
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /aviso\.ts/);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /erro\.ts/);
});

test("teste tem erro só acima de 500", () => {
  const result = evaluate([
    { file: "a/x.test.ts", lines: 500 },
    { file: "a/y.test.ts", lines: 501 },
  ]);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /y\.test\.ts/);
});

test("exceção vale até o teto e avisa quando deixa de ser necessária", () => {
  const exceptions = { "a/velho.ts": { max: 455, reason: "dividir" } };
  assert.equal(evaluate([{ file: "a/velho.ts", lines: 455 }], exceptions).errors.length, 0);
  assert.equal(evaluate([{ file: "a/velho.ts", lines: 456 }], exceptions).errors.length, 1);
  assert.equal(evaluate([{ file: "a/velho.ts", lines: 300 }], exceptions).warnings.length, 1);
});
