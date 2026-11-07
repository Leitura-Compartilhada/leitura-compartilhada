// Confere o cofre Obsidian (docs/): wikilinks quebrados reprovam; nota sem link de entrada ou sem
// propriedades (frontmatter) só avisa. Roda no `pnpm lint`, então o CI não deixa um link quebrar.
//   node scripts/check-docs.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Tira blocos de código e código em linha, onde `[[nota]]` aparece como exemplo. */
function withoutCode(text) {
  return text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

/** Nomes que apontam para a nota: o nome do arquivo e os `aliases` do frontmatter. */
function namesOf(file, text) {
  const names = [path.posix.basename(file, ".md")];
  const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const aliases = /aliases:\n((?:\s+- .*\n?)+)/.exec(`${front}\n`)?.[1] ?? "";
  for (const line of aliases.split("\n")) {
    const value = line.replace(/^\s+- /, "").trim();
    if (value) names.push(value);
  }
  return names;
}

/**
 * @param {Record<string, string>} notes caminho (ex.: docs/projeto/x.md) → conteúdo
 * @returns {{ broken: string[], orphans: string[], noFrontmatter: string[] }}
 */
export function checkDocs(notes) {
  const owner = new Map();
  for (const [file, text] of Object.entries(notes)) {
    for (const name of namesOf(file, text)) owner.set(name.toLowerCase(), file);
  }
  const inbound = new Map(Object.keys(notes).map((file) => [file, 0]));
  const broken = [];
  for (const [file, text] of Object.entries(notes)) {
    for (const match of withoutCode(text).matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
      const target = match[1].trim();
      const dest = owner.get(target.toLowerCase());
      if (!dest) broken.push(`${file}: [[${target}]]`);
      else if (dest !== file) inbound.set(dest, (inbound.get(dest) ?? 0) + 1);
    }
  }
  const orphans = [...inbound]
    .filter(([file, count]) => count === 0 && !/(^|\/)_[^/]*\.md$/.test(file))
    .map(([file]) => file);
  const noFrontmatter = Object.entries(notes)
    .filter(([file, text]) => !text.startsWith("---\n") && !/(^|\/)_[^/]*\.md$/.test(file))
    .map(([file]) => file);
  return { broken, orphans, noFrontmatter };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  // Arquivos rastreados e novos (ainda não adicionados), sem os ignorados (.obsidian/workspace etc.).
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", "docs"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\n")
    .filter((file) => file.endsWith(".md"));
  const notes = Object.fromEntries(
    listed.map((file) => [file, readFileSync(path.join(root, file), "utf8")]),
  );
  const { broken, orphans, noFrontmatter } = checkDocs(notes);

  for (const file of orphans) console.warn(`aviso: nota sem nenhum link de entrada: ${file}`);
  for (const file of noFrontmatter) console.warn(`aviso: nota sem propriedades no topo: ${file}`);
  if (broken.length > 0) {
    console.error(`Cofre: ${broken.length} link(s) quebrado(s)`);
    for (const item of broken) console.error(`  ${item}`);
    process.exit(1);
  }
  console.log(`Cofre ok: ${listed.length} notas, nenhum link quebrado.`);
}
