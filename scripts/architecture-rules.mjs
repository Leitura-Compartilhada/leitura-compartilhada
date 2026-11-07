// Regras de dependência de docs/arquitetura.md, conferidas sobre as arestas de import do
// grafo do Graphify (graph.json). Funções puras: recebem arestas { from, to } com caminhos
// relativos à raiz do repositório e devolvem as violações.

const RULES = [
  {
    name: "rotas não importam queries.ts (usam o serviço)",
    from: /^apps\/api\/src\/modules\/[^/]+\/routes\//,
    to: /^apps\/api\/src\/modules\/[^/]+\/queries\.ts$/,
  },
  {
    name: "lib/ da API não conhece os módulos de domínio",
    from: /^apps\/api\/src\/lib\//,
    to: /^apps\/api\/src\/modules\//,
  },
  {
    name: "um app não importa de outro app",
    from: /^apps\/(web|api|worker)\//,
    to: /^apps\/(web|api|worker)\//,
    // permitido: o próprio app (checado em `violates`)
    sameAppAllowed: true,
  },
  {
    name: "packages/shared não importa de apps nem do banco",
    from: /^packages\/shared\//,
    to: /^(apps\/|packages\/db\/)/,
  },
  {
    name: "packages/storage não importa de apps nem de outros pacotes",
    from: /^packages\/storage\//,
    to: /^(apps\/|packages\/(shared|db)\/)/,
  },
  {
    name: "packages/db não importa de apps nem de shared",
    from: /^packages\/db\//,
    to: /^(apps\/|packages\/shared\/)/,
  },
];

const appOf = (file) => /^apps\/([^/]+)\//.exec(file)?.[1] ?? null;

function violates(rule, edge) {
  if (!rule.from.test(edge.from) || !rule.to.test(edge.to)) return false;
  if (rule.sameAppAllowed) return appOf(edge.from) !== appOf(edge.to);
  return true;
}

/**
 * @param {{ from: string, to: string }[]} edges
 * @returns {{ rule: string, from: string, to: string }[]}
 */
export function checkArchitecture(edges) {
  const found = [];
  const seen = new Set();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    for (const rule of RULES) {
      const key = `${rule.name}|${edge.from}|${edge.to}`;
      if (violates(rule, edge) && !seen.has(key)) {
        seen.add(key);
        found.push({ rule: rule.name, from: edge.from, to: edge.to });
      }
    }
  }
  return found;
}

/** Arestas de import entre arquivos a partir do `graph.json` do Graphify. */
export function importEdgesFromGraph(graph) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const links = graph.links ?? graph.edges ?? [];
  const edges = [];
  for (const link of links) {
    if (link.relation !== "imports") continue;
    const from = nodes.get(link.source)?.source_file;
    const to = nodes.get(link.target)?.source_file;
    if (from && to) {
      edges.push({ from: from.replaceAll("\\", "/"), to: to.replaceAll("\\", "/") });
    }
  }
  return edges;
}
