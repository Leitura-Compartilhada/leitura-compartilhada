// Confere o tamanho dos arquivos de código (regra em docs/arquitetura.md).
//   código-fonte: aviso acima de 250 linhas, erro acima de 400
//   testes:       erro acima de 500
// Arquivos antigos que já passam do limite entram em scripts/file-size-exceptions.json com um teto
// (não podem crescer) e um motivo; a lista só deve diminuir.
//
// Uso:  node scripts/check-file-size.mjs [--root <pasta>]   (a pasta serve para o teste do script)

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE_WARN = 250;
export const SOURCE_ERROR = 400;
export const TEST_ERROR = 500;

const CODE = /\.(?:ts|tsx|mts|mjs|js|jsx)$/;
const IGNORED = [
  /(^|\/)vendor\//,
  /(^|\/)components\/ui\//,
  /(^|\/)drizzle\//,
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /\.d\.m?ts$/,
  /(^|\/)public\//,
  /^\.claude\//,
];
const TEST = /(?:\.test\.|\.spec\.)|(^|\/)e2e\/tests\/|(^|\/)test\//;

/** @param {string} file */
export function classify(file) {
  if (!CODE.test(file) || IGNORED.some((pattern) => pattern.test(file))) return null;
  return TEST.test(file) ? "test" : "source";
}

/**
 * @param {{ file: string, lines: number }[]} files
 * @param {Record<string, { max: number, reason: string }>} exceptions
 */
export function evaluate(files, exceptions = {}) {
  const errors = [];
  const warnings = [];
  for (const { file, lines } of files) {
    const kind = classify(file);
    if (!kind) continue;
    const limit = kind === "test" ? TEST_ERROR : SOURCE_ERROR;
    const exception = exceptions[file];
    if (exception) {
      if (lines > exception.max) {
        errors.push(`${file}: ${lines} linhas, acima do teto da exceção (${exception.max})`);
      } else if (lines <= limit) {
        warnings.push(`${file}: já cabe no limite (${lines} ≤ ${limit}); remova a exceção`);
      }
      continue;
    }
    if (lines > limit) {
      errors.push(
        `${file}: ${lines} linhas (máximo ${limit} para ${kind === "test" ? "teste" : "código"})`,
      );
    } else if (kind === "source" && lines > SOURCE_WARN) {
      warnings.push(`${file}: ${lines} linhas (acima de ${SOURCE_WARN}; pense em dividir)`);
    }
  }
  return { errors, warnings };
}

function countLines(text) {
  if (text === "") return 0;
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

function main() {
  const rootArg = process.argv.indexOf("--root");
  const root = path.resolve(
    rootArg > 0
      ? process.argv[rootArg + 1]
      : path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const tracked = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  const files = tracked
    .filter((file) => classify(file) && existsSync(path.join(root, file)))
    .map((file) => ({ file, lines: countLines(readFileSync(path.join(root, file), "utf8")) }));

  const exceptionsPath = path.join(root, "scripts", "file-size-exceptions.json");
  const exceptions = existsSync(exceptionsPath)
    ? JSON.parse(readFileSync(exceptionsPath, "utf8"))
    : {};

  const { errors, warnings } = evaluate(files, exceptions);
  for (const message of warnings) console.warn(`aviso: ${message}`);
  for (const message of errors) console.error(`erro: ${message}`);
  if (errors.length > 0) {
    console.error(
      `\n${errors.length} arquivo(s) grande(s) demais. Divida-o (docs/arquitetura.md).`,
    );
    process.exit(1);
  }
  console.log(`tamanho dos arquivos ok (${files.length} arquivos, ${warnings.length} avisos)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
