// Confere as regras de dependência de docs/arquitetura.md sobre os imports reais do código.
// Roda no `pnpm lint` (e portanto no CI). Complementa o `pnpm map`, que desenha o mapa visual.
//   node scripts/check-architecture.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkArchitecture } from "./architecture-rules.mjs";
import { buildEdges } from "./import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Só o que o git rastreia (sem node_modules, dist nem vendor), como o check-file-size.
const tracked = execFileSync("git", ["ls-files", "--", "apps", "packages"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\n")
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/(^|\/)vendor\//.test(file));

const sources = Object.fromEntries(
  tracked.map((file) => [file, readFileSync(path.join(root, file), "utf8")]),
);
const edges = buildEdges(sources);
const violations = checkArchitecture(edges);

if (violations.length > 0) {
  console.error(`Arquitetura: ${violations.length} violação(ões) de docs/arquitetura.md`);
  for (const v of violations) console.error(`  ${v.rule}\n    ${v.from} → ${v.to}`);
  process.exit(1);
}
console.log(`Arquitetura ok: ${edges.length} imports entre ${tracked.length} arquivos.`);
