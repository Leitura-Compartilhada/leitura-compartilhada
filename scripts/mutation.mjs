// Teste de mutação (Stryker) sob demanda: troca pedaços do código e confere se os testes reclamam.
// Um mutante que sobrevive aponta um teste que não pegaria aquele bug. Informativo: não bloqueia o CI
// (leva minutos e o placar varia). Relatórios em _local/mutation/<pacote>/index.html.
//   pnpm mutation                   shared e web
//   pnpm mutation web               só o web
//   pnpm mutation web --mutate src/features/library/import/import-queue.ts
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = { shared: "packages/shared", web: "apps/web" };

const args = process.argv.slice(2);
const split = args.findIndex((arg) => arg.startsWith("--"));
const names = (split === -1 ? args : args.slice(0, split)).filter(Boolean);
const passthrough = split === -1 ? [] : args.slice(split);
const selected = names.length > 0 ? names : Object.keys(TARGETS);

function score(report) {
  const count = { killed: 0, survived: 0, none: 0 };
  for (const file of Object.values(report.files)) {
    for (const mutant of file.mutants) {
      if (mutant.status === "Killed" || mutant.status === "Timeout") count.killed += 1;
      else if (mutant.status === "Survived") count.survived += 1;
      else if (mutant.status === "NoCoverage") count.none += 1;
    }
  }
  const total = count.killed + count.survived + count.none;
  return { ...count, pct: total === 0 ? 100 : (100 * count.killed) / total };
}

const rows = [];
for (const name of selected) {
  const dir = TARGETS[name];
  if (!dir) {
    console.error(`pacote desconhecido: ${name} (use ${Object.keys(TARGETS).join(", ")})`);
    process.exit(2);
  }
  console.log(`\n== ${name} ==`);
  const command = ["pnpm exec stryker run", ...passthrough].join(" ");
  const result = spawnSync(command, { cwd: path.join(root, dir), stdio: "inherit", shell: true });
  const reportFile = path.join(root, "_local", "mutation", name, "mutation.json");
  if (result.status !== 0 || !existsSync(reportFile)) {
    rows.push({ name, text: "falhou" });
    continue;
  }
  const s = score(JSON.parse(readFileSync(reportFile, "utf8")));
  rows.push({
    name,
    text: `${s.pct.toFixed(1)}% (mortos ${s.killed}, sobreviveram ${s.survived}, sem teste ${s.none})`,
  });
}

console.log("\nMutação (informativa; relatório HTML em _local/mutation/<pacote>/)");
for (const row of rows) console.log(row.name.padEnd(8), row.text);
