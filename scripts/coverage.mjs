// Cobertura de testes por pacote (informativa: não bloqueia o CI). Relatórios em _local/coverage/.
//   pnpm coverage              todos os pacotes
//   pnpm coverage shared web   só os citados
// Imprime uma tabela com linhas e ramos cobertos; o HTML de cada pacote fica em _local/coverage/<pacote>/.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = {
  shared: "packages/shared",
  storage: "packages/storage",
  web: "apps/web",
  api: "apps/api",
  worker: "apps/worker",
};

const wanted = process.argv.slice(2);
const names = wanted.length > 0 ? wanted : Object.keys(TARGETS);
const rows = [];

for (const name of names) {
  const dir = TARGETS[name];
  if (!dir) {
    console.error(`pacote desconhecido: ${name} (use ${Object.keys(TARGETS).join(", ")})`);
    process.exit(2);
  }
  const out = path.join(root, "_local", "coverage", name);
  console.log(`\n== ${name} ==`);
  // Caminho relativo à pasta do pacote (todos estão a dois níveis da raiz) e sem espaços, para o shell.
  const relativeOut = `../../_local/coverage/${name}`;
  const command = [
    "pnpm --filter",
    `./${dir}`,
    "exec vitest run --coverage --coverage.provider=v8",
    "--coverage.reporter=json-summary --coverage.reporter=html",
    `--coverage.reportsDirectory=${relativeOut}`,
  ].join(" ");
  const result = spawnSync(command, { cwd: root, stdio: "inherit", shell: true });
  const summaryFile = path.join(out, "coverage-summary.json");
  if (result.status !== 0 || !existsSync(summaryFile)) {
    rows.push({ name, lines: "falhou", branches: "-" });
    continue;
  }
  const { total } = JSON.parse(readFileSync(summaryFile, "utf8"));
  rows.push({ name, lines: `${total.lines.pct}%`, branches: `${total.branches.pct}%` });
}

console.log("\nCobertura (informativa)");
console.log("pacote".padEnd(10), "linhas".padEnd(10), "ramos");
for (const row of rows) console.log(row.name.padEnd(10), row.lines.padEnd(10), row.branches);
