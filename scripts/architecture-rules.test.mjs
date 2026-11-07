import assert from "node:assert/strict";
import { test } from "node:test";
import { checkArchitecture, importEdgesFromGraph } from "./architecture-rules.mjs";

const edge = (from, to) => ({ from, to });

test("aceita as dependências permitidas", () => {
  const ok = checkArchitecture([
    edge("apps/api/src/modules/books/routes/upload.ts", "apps/api/src/modules/books/service.ts"),
    edge("apps/api/src/modules/books/service.ts", "apps/api/src/modules/books/queries.ts"),
    edge("apps/api/src/modules/books/routes/cover.ts", "apps/api/src/lib/epub/index.ts"),
    edge("apps/web/src/features/reader/input.ts", "apps/web/src/lib/api.ts"),
    edge("apps/api/src/app.ts", "packages/shared/src/index.ts"),
    edge("packages/db/src/index.ts", "packages/db/src/schema/index.ts"),
  ]);
  assert.deepEqual(ok, []);
});

test("rota importando queries.ts é violação", () => {
  const found = checkArchitecture([
    edge("apps/api/src/modules/books/routes/list.ts", "apps/api/src/modules/books/queries.ts"),
  ]);
  assert.equal(found.length, 1);
  assert.match(found[0].rule, /rotas/);
});

test("lib/ importando módulo de domínio é violação", () => {
  const found = checkArchitecture([
    edge("apps/api/src/lib/epub/metadata.ts", "apps/api/src/modules/books/mapper.ts"),
  ]);
  assert.equal(found.length, 1);
});

test("app importando de outro app é violação, do próprio app não", () => {
  const found = checkArchitecture([
    edge("apps/web/src/lib/api.ts", "apps/api/src/app.ts"),
    edge("apps/web/src/lib/api.ts", "apps/web/src/lib/db.ts"),
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].to, "apps/api/src/app.ts");
});

test("shared e db não importam de apps nem um do outro", () => {
  const found = checkArchitecture([
    edge("packages/shared/src/books.ts", "apps/api/src/env.ts"),
    edge("packages/shared/src/books.ts", "packages/db/src/index.ts"),
    edge("packages/db/src/index.ts", "packages/shared/src/index.ts"),
  ]);
  assert.equal(found.length, 3);
});

test("storage não importa de apps nem de outros pacotes", () => {
  const found = checkArchitecture([
    edge("packages/storage/src/local.ts", "apps/api/src/env.ts"),
    edge("packages/storage/src/local.ts", "packages/shared/src/index.ts"),
    edge("packages/storage/src/index.ts", "packages/storage/src/local.ts"),
    edge("apps/worker/src/main.ts", "packages/storage/src/index.ts"),
  ]);
  assert.equal(found.length, 2);
});

test("extrai só as arestas de import do grafo", () => {
  const graph = {
    nodes: [
      { id: "a", source_file: "apps/api\\src\\a.ts" },
      { id: "b", source_file: "apps/api/src/b.ts" },
    ],
    links: [
      { source: "a", target: "b", relation: "imports" },
      { source: "a", target: "b", relation: "calls" },
      { source: "a", target: "x", relation: "imports" },
    ],
  };
  assert.deepEqual(importEdgesFromGraph(graph), [
    { from: "apps/api/src/a.ts", to: "apps/api/src/b.ts" },
  ]);
});
