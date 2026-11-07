// Arestas de import entre os arquivos do repositório, sem Graphify nem Python: lê o código-fonte
// (.ts/.tsx), acha `import`/`export ... from`/`import()` e resolve cada caminho para um arquivo.
// Funções puras: `buildEdges` recebe { caminho: conteúdo } e devolve [{ from, to }] com caminhos
// relativos à raiz, no formato que `architecture-rules.mjs` espera. Erra para o lado de não ver
// uma aresta (nunca de inventar uma), então o pior caso é uma violação rara escapar.

const STATEMENT =
  /(?:^|[\s;{}])(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC = /\bimport\(\s*["']([^"']+)["']\s*\)/g;
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];

/** Tira as linhas que são só comentário (`//`, `/*`, ` *`), onde aparecem imports de exemplo. */
function withoutCommentLines(source) {
  return source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

/** Os caminhos que o arquivo importa, na ordem em que aparecem. */
export function extractSpecifiers(source) {
  const code = withoutCommentLines(source);
  const found = [];
  for (const pattern of [STATEMENT, DYNAMIC]) {
    for (const match of code.matchAll(pattern)) found.push(match[1]);
  }
  return found;
}

/** `a/b/../c` → `a/c`; devolve `null` se sair da raiz. */
function normalize(path) {
  const out = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

/** Tenta o caminho como está, com a extensão trocada (`.js` → `.ts`) e como pasta (`/index`). */
function pick(base, files) {
  if (base === null) return null;
  const stem = base.replace(/\.(m?js|tsx?)$/, "");
  const candidates = [base, ...EXTENSIONS.map((ext) => stem + ext)];
  candidates.push(...EXTENSIONS.map((ext) => `${base}/index${ext}`));
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

function dirOf(file) {
  return file.slice(0, Math.max(0, file.lastIndexOf("/")));
}

/** Resolve um import de `from` para um arquivo do repositório, ou `null` (pacote externo). */
export function resolveSpecifier(from, specifier, files) {
  if (specifier.startsWith(".")) return pick(normalize(`${dirOf(from)}/${specifier}`), files);

  // Alias `@/` do web.
  if (specifier.startsWith("@/") && from.startsWith("apps/web/")) {
    return pick(normalize(`apps/web/src/${specifier.slice(2)}`), files);
  }

  // Pacotes do workspace: `@leitura/shared` → packages/shared/src/index.ts.
  const workspace = /^@leitura\/([^/]+)(?:\/(.+))?$/.exec(specifier);
  if (workspace) {
    const [, name, sub] = workspace;
    const root = /^(web|api|worker)$/.test(name) ? `apps/${name}` : `packages/${name}`;
    const target = sub ? `${root}/src/${sub}` : `${root}/src/index`;
    // Sem arquivo achado, ainda vale a aresta: importar um app de dentro de outro é a violação.
    return pick(target, files) ?? `${root}/src/index.ts`;
  }
  return null;
}

/**
 * @param {Record<string, string>} sources caminho relativo à raiz → conteúdo
 * @returns {{ from: string, to: string }[]}
 */
export function buildEdges(sources) {
  const files = new Set(Object.keys(sources));
  const edges = [];
  const seen = new Set();
  for (const [from, source] of Object.entries(sources)) {
    for (const specifier of extractSpecifiers(source)) {
      const to = resolveSpecifier(from, specifier, files);
      const key = `${from}|${to}`;
      if (to && !seen.has(key)) {
        seen.add(key);
        edges.push({ from, to });
      }
    }
  }
  return edges;
}
