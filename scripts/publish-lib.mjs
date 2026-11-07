// Funções puras da publicação (dev privado -> cópia pública). Sem I/O: tudo recebe os dados e devolve
// o resultado, para testar sem git nem rede. A CLI está em publish-public.mjs.

/** Endereço do repositório público e do dev, e a identidade de quem assina a cópia pública. */
export const PUBLIC_REPO = "Leitura-Compartilhada/leitura-compartilhada";
export const DEV_REPO = "Leitura-Compartilhada/leitura-compartilhada-dev";
export const PUBLIC_IDENTITY = {
  name: "Getulio Vagner",
  email: "184105176+GetuliovmSantos@users.noreply.github.com",
};

const startsWithAny = (file, prefixes) =>
  prefixes.some((prefix) => (prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix));

/** Nome de arquivo de ambiente (.env, .env.local...) que não seja o exemplo: nunca sai, em qualquer pasta. */
const isEnvFile = (segment) =>
  segment === ".env" || (segment.startsWith(".env.") && segment !== ".env.example");

/**
 * Caminho proibido em qualquer profundidade: casa por segmento, sem diferenciar maiúsculas
 * (apps/web/CLAUDE.md e packages/x/.Claude/a também são barrados).
 */
function isNeverAnywhere(file, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  return file
    .split("/")
    .some((segment) => wanted.has(segment.toLowerCase()) || isEnvFile(segment.toLowerCase()));
}

/** Destino do `map` seguro: relativo, sem `..`, sem barra invertida e fora de `.git`. */
export function assertSafeDestination(to) {
  const segments = to.split("/");
  if (
    to === "" ||
    to.startsWith("/") ||
    to.includes("\\") ||
    /^[A-Za-z]:/.test(to) ||
    segments.some((s) => s === ".." || s === "." || s === "" || s.toLowerCase() === ".git")
  )
    throw new Error(`destino inseguro no map: ${to}`);
}

/**
 * Do que o git rastreia, escolhe o que vai para o público. Só entra o que está na lista permitida
 * (`include`) e não está na proibida (`never` na raiz; `neverAnywhere` em qualquer pasta); a proibida
 * sempre vence. `map` copia modelos de `public-template/` para o destino público.
 * @returns {{ from: string, to: string }[]} ordenado pelo destino
 */
export function selectFiles(tracked, manifest) {
  const trackedSet = new Set(tracked);
  const picked = new Map();
  const neverAnywhere = manifest.neverAnywhere ?? [];
  for (const file of tracked) {
    if (startsWithAny(file, manifest.never)) continue;
    if (isNeverAnywhere(file, neverAnywhere)) continue;
    if (startsWithAny(file, manifest.include)) picked.set(file, file);
  }
  for (const [from, to] of Object.entries(manifest.map)) {
    if (!from.startsWith("public-template/"))
      throw new Error(`o modelo ${from} não está em public-template/`);
    assertSafeDestination(to);
    if (!trackedSet.has(from)) throw new Error(`o modelo ${from} não está no git`);
    picked.set(to, from);
  }
  return [...picked.entries()]
    .map(([to, from]) => ({ from, to }))
    .sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
}

/** Domínios de e-mail que podem aparecer (exemplos, a identidade pública e o co-autor do Claude). */
export const ALLOWED_EMAIL_DOMAINS = [
  "example.com",
  "example.org",
  "example.net",
  "users.noreply.github.com",
  "noreply.github.com",
  "anthropic.com",
  "izs.me", // aviso de depreciação do npm (glob), dentro do pnpm-lock.yaml
  "github.com", // o usuário "git" do SSH (git@github.com), não um e-mail
];

/** Padrões genéricos de dado pessoal ou segredo. Os específicos vêm de `_local/publish-denylist.txt`. */
export const GENERIC_PATTERNS = [
  { name: "endereço da tailnet", regex: /\.ts\.net\b/i },
  { name: "IP da tailnet", regex: /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/ },
  { name: "chave do Tailscale", regex: /\btskey-[A-Za-z0-9-]{8,}/ },
  { name: "caminho de usuário do Windows", regex: /[A-Za-z](?::|%3A)[\\/]+Users[\\/]+[\w.-]+/i },
  { name: "caminho de usuário (Git Bash)", regex: /(?:^|[^\w])\/[a-z]\/Users\/[\w.-]+/i },
  {
    name: "caminho de usuário (home)",
    regex: /(?:^|[^\w.-])\/(?:home|Users)\/(?!web_user\b)[\w.-]+/,
  },
  { name: "chave privada", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "token do GitHub", regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "token do GitHub (fino)", regex: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { name: "chave da Anthropic", regex: /\bsk-(?:ant|proj)-[A-Za-z0-9_-]{20,}/ },
  { name: "chave do Google", regex: /\bAIza[0-9A-Za-z_-]{30,}/ },
  { name: "chave da AWS", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "token do Slack", regex: /\bxox[bp]-[A-Za-z0-9-]{10,}/ },
  { name: "token do npm", regex: /\bnpm_[A-Za-z0-9]{30,}/ },
  { name: "JWT", regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/ },
  {
    name: "URL de banco com senha",
    regex:
      /\b[a-z]+:\/\/[^\s:/@]+:[^\s@/]{3,}@(?!localhost\b|127\.0\.0\.1|postgres\b|db\b|[$<{])[^\s/]+/i,
  },
  { name: "segredo de login real", regex: /BETTER_AUTH_SECRET=(?!troque)[A-Za-z0-9+/=_-]{32,}/ },
];

/** Endereços de exemplo que o próprio projeto usa em testes e no .env.example: não são o servidor real. */
export const ALLOWED_PLACEHOLDERS = ["pc.tailnet." + "ts.net"];

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lê o texto do arquivo de padrões locais: um literal por linha, `#` comenta, vazias são ignoradas. */
export function parseDenylist(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/** Decodifica o conteúdo: UTF-8, ou UTF-16 (com BOM ou com bytes nulos alternados). */
export function decodeText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe)
    return buffer.subarray(2).toString("utf16le");
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff)
    return Buffer.from(buffer.subarray(2)).swap16().toString("utf16le");
  const head = buffer.subarray(0, 400);
  if (head.length >= 8) {
    let nulls = 0;
    for (let i = 1; i < head.length; i += 2) if (head[i] === 0) nulls++;
    if (nulls > head.length / 4) return buffer.toString("utf16le");
  }
  return buffer.toString("utf8");
}

const safe = (fn, fallback) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/** O mesmo texto em outras codificações em que o dado pode se esconder: %xx, \uXXXX e normalizado. */
function variantsOf(text) {
  const normalized = text.normalize("NFKC");
  const percent = safe(() => decodeURIComponent(normalized), normalized);
  const unicode = normalized.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  return [...new Set([normalized, percent, unicode])];
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/** Procura os padrões num texto. Devolve uma lista de achados (nome do padrão e número da linha). */
export function scanText(file, rawText, literals = []) {
  const findings = [];
  const seen = new Set();
  const add = (line, what) => {
    const key = `${line}|${what}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ file, line, what });
  };
  const placeholder = new RegExp(
    `(?<![\\w.-])(?:${ALLOWED_PLACEHOLDERS.map(escapeRegex).join("|")})(?![\\w-])`,
    "gi",
  );
  for (const variant of variantsOf(rawText)) {
    const text = variant.replace(placeholder, "");
    const lower = text.toLowerCase();
    const squashed = lower.replace(/\s+/g, " ");
    for (const literal of literals) {
      const wanted = literal.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
      const at = lower.indexOf(wanted);
      if (at !== -1) add(lineOf(text, at), "termo da lista local");
      else if (squashed.includes(wanted))
        add(lineOf(text, lower.indexOf(wanted.split(" ")[0])), "termo da lista local");
    }
    text.split("\n").forEach((line, index) => {
      for (const { name, regex } of GENERIC_PATTERNS) if (regex.test(line)) add(index + 1, name);
      if (!file.includes("/vendor/pdfjs/"))
        for (const match of line.matchAll(/[\w.+%-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g)) {
          if (!ALLOWED_EMAIL_DOMAINS.includes(match[1].toLowerCase())) add(index + 1, "e-mail");
        }
    });
  }
  return findings.sort((a, b) => a.line - b.line);
}

/** Arquivo binário: tem byte nulo e não é texto UTF-16. A varredura de texto usa os bytes como latin1. */
export const looksBinary = (buffer) => {
  if (!buffer.subarray(0, 8000).includes(0)) return false;
  const text = decodeText(buffer.subarray(0, 8000));
  return hasControlChars(text, 8);
};

/** Tem caractere de controle (código menor que `limit`; 32 pega também a barra invertida se `backslash`). */
export function hasControlChars(text, limit = 32, backslash = false) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < limit || (backslash && code === 92)) return true;
  }
  return false;
}

/** Extensões binárias que podem sair; qualquer outra (zip, pdf, epub...) precisa estar em `approvedBinaries`. */
export const BINARY_EXTENSIONS = [".png", ".bcmap", ".ico", ".woff2", ".pfb", ".ttf"];

/** Binário sem permissão (extensão fora da lista e fora de `approvedBinaries`). */
export function binaryNotAllowed(file, manifest) {
  if ((manifest.approvedBinaries ?? []).includes(file)) return false;
  return !BINARY_EXTENSIONS.some((ext) => file.toLowerCase().endsWith(ext));
}

/** O nome do arquivo também vaza: confere o caminho contra os termos locais e os padrões genéricos. */
export function scanPath(file, literals = []) {
  return scanText(`${file} (nome)`, file, literals);
}

/** Separa "dono/repo" de uma URL do GitHub (https, git@ ou ssh://). Qualquer outro servidor dá `null`. */
export function parseGithubRemote(url) {
  const match = url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .match(
      /^(?:https:\/\/(?:[^@/\s]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+)$/i,
    );
  return match ? match[1].toLowerCase() : null;
}

/** O `origin` do clone tem de ser o repositório de desenvolvimento, nunca o público. */
export const isDevRemote = (url) => parseGithubRemote(url) === DEV_REPO.toLowerCase();

/** O clone do público tem de apontar para o repositório público (e para nenhum outro). */
export const isPublicRemote = (url) => parseGithubRemote(url) === PUBLIC_REPO.toLowerCase();

/** Versão no formato X.Y.Z (com pré-lançamento opcional, como 1.0.0-rc.1) que dá um nome de tag válido. */
export const isVersion = (value) =>
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/.test(value) &&
  !/\.lock(?:\.|$)/.test(value);

/** A configuração do clone público precisa ser a da autoria assinada. Devolve o que está errado. */
export function signingProblems(config) {
  const problems = [];
  if (config["user.email"] !== PUBLIC_IDENTITY.email)
    problems.push("user.email não é o noreply do GitHub");
  if (config["user.name"] !== PUBLIC_IDENTITY.name)
    problems.push("user.name diferente do esperado");
  if (config["gpg.format"] !== "ssh") problems.push("gpg.format não é ssh");
  if (config["commit.gpgsign"] !== "true") problems.push("commit.gpgsign desligado");
  if (config["tag.gpgsign"] !== "true") problems.push("tag.gpgsign desligado");
  if (!config["user.signingkey"]) problems.push("user.signingkey vazio");
  if (!config["gpg.ssh.allowedsignersfile"])
    problems.push("gpg.ssh.allowedSignersFile vazio (sem ele não dá para verificar a assinatura)");
  return problems;
}

/** Os remotos de busca e de envio do clone público: todos têm de ser o público, e só um. */
export function remoteProblems(fetchUrls, pushUrls) {
  const problems = [];
  for (const [label, urls] of [
    ["busca", fetchUrls],
    ["envio", pushUrls],
  ]) {
    if (urls.length !== 1) problems.push(`o origin tem ${urls.length} endereços de ${label}`);
    for (const url of urls)
      if (!isPublicRemote(url)) problems.push(`endereço de ${label} não é o público: ${url}`);
  }
  return problems;
}

/**
 * Depois do commit: o público tem de ter exatamente 1 commit novo, e todo commit do clone precisa ter a
 * identidade pública (autor e quem commitou). `authors` = linhas "autor|e-mail|committer|e-mail".
 */
export function historyProblems(aheadCount, authors) {
  const problems = [];
  if (aheadCount !== 1) problems.push(`o público teria ${aheadCount} commits novos (esperado: 1)`);
  for (const line of authors) {
    const [an, ae, cn, ce] = line.split("|");
    if (
      ae !== PUBLIC_IDENTITY.email ||
      ce !== PUBLIC_IDENTITY.email ||
      an !== PUBLIC_IDENTITY.name ||
      cn !== PUBLIC_IDENTITY.name
    )
      problems.push(`commit com identidade que não é a pública: ${line}`);
  }
  return problems;
}

/** Compara duas listas de arquivos (nome -> hash) e diz o que entra, sai ou muda no público. */
export function diffSnapshots(before, after) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [file, hash] of after) {
    if (!before.has(file)) added.push(file);
    else if (before.get(file) !== hash) changed.push(file);
  }
  for (const file of before.keys()) if (!after.has(file)) removed.push(file);
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}
