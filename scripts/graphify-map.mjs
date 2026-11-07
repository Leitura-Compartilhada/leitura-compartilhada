// Gera o mapa do código com o Graphify (só análise local, sem modelo) em _local/mapa/ e confere
// as regras de dependência de docs/arquitetura.md sobre o grafo.
//
//   pnpm map            relatório, graph.html, graph.json e _local/mapa/ARQUITETURA.md
//   pnpm map --notas    também exporta as notas do Obsidian (~1000 notas; enchem o grafo do cofre)
//
// O Graphify não vai no projeto: fica num ambiente próprio (ver docs/arquitetura.md, "Mapa do
// código"). Use GRAPHIFY_BIN para apontar outro executável. Nenhuma skill nem hook é registrada.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkArchitecture, importEdgesFromGraph } from "./architecture-rules.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "_local", "mapa");
const withNotes = process.argv.includes("--notas");

/** Fora do mapa: código de terceiros, gerado ou sem interesse. */
const SKIP = [
  /(^|\/)vendor\//,
  /(^|\/)components\/ui\//,
  /(^|\/)drizzle\//,
  /^\.claude\//,
  /\.(epub|pdf|png|jpg|webp|svg|ico)$/i,
  /pnpm-lock\.yaml$/,
];

function graphifyBin() {
  if (process.env.GRAPHIFY_BIN) return process.env.GRAPHIFY_BIN;
  return process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA ?? "", "graphify", "venv", "Scripts", "graphify.exe")
    : path.join(os.homedir(), ".local", "share", "graphify", "venv", "bin", "graphify");
}

function copyTrackedFiles(target) {
  const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file && !SKIP.some((pattern) => pattern.test(file)));
  let copied = 0;
  for (const file of files) {
    const from = path.join(root, file);
    if (!existsSync(from)) continue; // apagado e ainda não commitado
    mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
    copyFileSync(from, path.join(target, file));
    copied++;
  }
  return copied;
}

function main() {
  const bin = graphifyBin();
  if (!existsSync(bin)) {
    console.error(
      `Graphify não encontrado em ${bin}.\n` +
        "Instale num ambiente próprio (fora do projeto):\n" +
        "  python -m venv <pasta>/venv && <pasta>/venv/Scripts/pip install --only-binary=:all: graphifyy==0.9.94\n" +
        "e defina GRAPHIFY_BIN com o caminho do executável.",
    );
    process.exit(2);
  }

  const work = mkdtempSync(path.join(os.tmpdir(), "leitura-map-"));
  try {
    const count = copyTrackedFiles(work);
    console.log(`analisando ${count} arquivos (cópia temporária, sem _local nem livros)...`);
    const env = { ...process.env, GRAPHIFY_BACKEND: "none", GRAPHIFY_QUERY_LOG_DISABLE: "1" };
    const run = (...args) => execFileSync(bin, args, { cwd: work, env, stdio: "inherit" });
    run("extract", ".", "--code-only", "--no-cluster");
    run("cluster-only", ".", "--no-label");

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const name of ["GRAPH_REPORT.md", "graph.html", "graph.json"]) {
      copyFileSync(path.join(work, "graphify-out", name), path.join(outDir, name));
    }
    if (withNotes) run("export", "obsidian", "--dir", path.join(outDir, "notas"));

    const graph = JSON.parse(readFileSync(path.join(outDir, "graph.json"), "utf8"));
    const violations = checkArchitecture(importEdgesFromGraph(graph));
    writeFileSync(path.join(outDir, "ARQUITETURA.md"), architectureNote(graph, violations));

    if (violations.length > 0) {
      console.error(`\n${violations.length} violação(ões) das regras de docs/arquitetura.md:`);
      for (const v of violations) console.error(`  - ${v.rule}: ${v.from} -> ${v.to}`);
      process.exit(1);
    }
    console.log(
      "regras de arquitetura ok. Mapa em _local/mapa/ (abra graph.html ou GRAPH_REPORT.md).",
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function architectureNote(graph, violations) {
  const links = graph.links ?? graph.edges ?? [];
  const rows = violations.map((v) => `| ${v.rule} | \`${v.from}\` | \`${v.to}\` |`).join("\n");
  return `---
tags:
  - projeto/arquitetura
  - gerado
data: ${new Date().toISOString().slice(0, 10)}
nos: ${graph.nodes.length}
arestas: ${links.length}
violacoes: ${violations.length}
---

# Checagem de arquitetura

Gerada por \`pnpm map\` a partir do grafo do Graphify. Regras em \`docs/arquitetura.md\`.
Relatório completo: [[GRAPH_REPORT]].

${violations.length === 0 ? "> [!success] Nenhuma violação das regras de dependência." : `> [!warning] ${violations.length} violação(ões)\n\n| Regra | De | Para |\n|---|---|---|\n${rows}`}
`;
}

main();
