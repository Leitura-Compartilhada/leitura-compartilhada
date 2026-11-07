import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDocs } from "./check-docs.mjs";

const note = (body, front = "tipo: x") => `---\n${front}\n---\n${body}\n`;

test("aceita links por nome, com texto, com seção e por alias", () => {
  const result = checkDocs({
    "docs/a.md": note("vai para [[b]] e [[b|o texto]] e [[b#seção]] e [[apelido]]"),
    "docs/pasta/b.md": note("volta para [[a]]"),
    "docs/c.md": note("sou o c", "tipo: x\naliases:\n  - apelido"),
  });
  assert.deepEqual(result.broken, []);
});

test("link quebrado é erro, ignorando exemplo dentro de código", () => {
  const result = checkDocs({
    "docs/a.md": note(
      "existe [[b]], não existe [[fantasma]] e `[[em-codigo]]`\n```\n[[em-bloco]]\n```",
    ),
    "docs/b.md": note("oi [[a]]"),
  });
  assert.deepEqual(result.broken, ["docs/a.md: [[fantasma]]"]);
});

test("nota sem link de entrada e sem propriedades só aparece como aviso", () => {
  const result = checkDocs({
    "docs/a.md": note("ligo [[b]]"),
    "docs/b.md": "sem propriedades, ligo [[a]]",
    "docs/solta.md": note("ninguém me liga"),
    "docs/specs/_template.md": "modelo sem link nem propriedades",
  });
  assert.deepEqual(result.orphans, ["docs/solta.md"]);
  assert.deepEqual(result.noFrontmatter, ["docs/b.md"]);
  assert.deepEqual(result.broken, []);
});

test("maiúsculas não importam no nome do link", () => {
  const result = checkDocs({
    "docs/Estado.md": note("ligo [[outra]]"),
    "docs/outra.md": note("ligo [[estado]]"),
  });
  assert.deepEqual(result.broken, []);
});
