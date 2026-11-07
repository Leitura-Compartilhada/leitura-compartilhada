import assert from "node:assert/strict";
import { test } from "node:test";
import { checkArchitecture } from "./architecture-rules.mjs";
import { buildEdges, extractSpecifiers, resolveSpecifier } from "./import-graph.mjs";

test("extrai os vários jeitos de importar", () => {
  const source = `
import a from "./a.js";
import type { B } from "./b.js";
import { c,
  d } from "../c/index.js";
import "./efeito.js";
export { e } from "./e.js";
export * from "./f.js";
const g = await import("./g.js");
import externo from "fastify";
`;
  assert.deepEqual(
    extractSpecifiers(source).sort(),
    [
      "./a.js",
      "./b.js",
      "../c/index.js",
      "./efeito.js",
      "./e.js",
      "./f.js",
      "./g.js",
      "fastify",
    ].sort(),
  );
});

test("ignora import que só aparece em comentário e em texto", () => {
  const source = `
// import x from "./de-comentario.js";
/**
 * import y from "./de-jsdoc.js";
 */
const texto = "import z from './de-string' mas sem from de verdade";
const real = 1;
`;
  assert.deepEqual(extractSpecifiers(source), []);
});

test("resolve relativo (.js → .ts), pasta, alias @/ e pacote do workspace", () => {
  const files = new Set([
    "apps/api/src/modules/books/service.ts",
    "apps/api/src/lib/epub/index.ts",
    "apps/web/src/lib/api.ts",
    "packages/shared/src/index.ts",
    "packages/storage/src/index.ts",
  ]);
  const r = (from, spec) => resolveSpecifier(from, spec, files);
  assert.equal(
    r("apps/api/src/modules/books/routes/list.ts", "../service.js"),
    "apps/api/src/modules/books/service.ts",
  );
  assert.equal(
    r("apps/api/src/modules/books/service.ts", "../../lib/epub"),
    "apps/api/src/lib/epub/index.ts",
  );
  assert.equal(r("apps/web/src/features/x/Y.tsx", "@/lib/api"), "apps/web/src/lib/api.ts");
  assert.equal(r("apps/api/src/app.ts", "@leitura/shared"), "packages/shared/src/index.ts");
  assert.equal(r("apps/worker/src/main.ts", "@leitura/storage"), "packages/storage/src/index.ts");
  assert.equal(r("apps/api/src/app.ts", "fastify"), null);
  assert.equal(r("apps/api/src/app.ts", "./nao-existe.js"), null);
});

test("importar o pacote de outro app vira aresta, mesmo sem o arquivo", () => {
  const edges = buildEdges({
    "apps/web/src/lib/x.ts": 'import { app } from "@leitura/api";',
  });
  assert.deepEqual(edges, [{ from: "apps/web/src/lib/x.ts", to: "apps/api/src/index.ts" }]);
  assert.equal(checkArchitecture(edges).length, 1);
});

test("o grafo montado dispara as regras de verdade", () => {
  const ok = buildEdges({
    "apps/api/src/modules/books/routes/list.ts": 'import { listBooks } from "../service.js";',
    "apps/api/src/modules/books/service.ts": 'import { q } from "./queries.js";',
    "apps/api/src/modules/books/queries.ts": "export const q = 1;",
  });
  assert.deepEqual(checkArchitecture(ok), []);

  const bad = buildEdges({
    "apps/api/src/modules/books/routes/list.ts": 'import { q } from "../queries.js";',
    "apps/api/src/modules/books/queries.ts": "export const q = 1;",
    "apps/worker/src/main.ts": 'import { env } from "../../api/src/env.js";',
    "apps/api/src/env.ts": "export const env = 1;",
  });
  const rules = checkArchitecture(bad).map((v) => v.rule);
  assert.equal(rules.length, 2);
  assert.ok(rules.some((rule) => /rotas/.test(rule)));
  assert.ok(rules.some((rule) => /outro app/.test(rule)));
});
