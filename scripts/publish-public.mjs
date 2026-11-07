// Publica uma versão no repositório PÚBLICO a partir do dev privado: monta uma cópia só com o que a lista
// permitida (scripts/publish-manifest.json) deixa sair, varre atrás de dado pessoal e segredo, e entrega
// 1 commit assinado + tag assinada. O histórico do dev nunca vai para fora.
//
//   pnpm publish:public                      só mostra o que mudaria (padrão, não altera nada)
//   pnpm publish:public --version 0.4.0      idem, com a versão
//   pnpm publish:public --version 0.4.0 --lista <hash> --yes    publica (commit assinado, tag, push, Release)
//   pnpm publish:public --export <pasta>     só gera a cópia numa pasta (para testar o público sozinho)
//
// O <hash> sai do modo de listagem e identifica os arquivos NOVOS: publicar exige ter visto a lista.
// Variáveis: PUBLIC_REPO_DIR (clone do público; padrão ../publico). Termos específicos a barrar ficam em
// _local/publish-denylist.txt (um por linha), que NÃO vai para o git.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  binaryNotAllowed,
  DEV_REPO,
  decodeText,
  diffSnapshots,
  hasControlChars,
  historyProblems,
  isDevRemote,
  isVersion,
  looksBinary,
  PUBLIC_REPO,
  parseDenylist,
  remoteProblems,
  scanPath,
  scanText,
  selectFiles,
  signingProblems,
} from "./publish-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const apply = args.includes("--yes");
const argValue = (flag) => {
  const at = args.indexOf(flag);
  return at === -1 ? null : (args[at + 1] ?? "");
};
const version = argValue("--version");
const listHash = argValue("--lista");
const exportDir = argValue("--export") === null ? null : path.resolve(argValue("--export"));
const publicDir = path.resolve(process.env.PUBLIC_REPO_DIR ?? path.join(root, "..", "publico"));

// O git roda sem GIT_* e EMAIL do ambiente: a identidade vem só da configuração conferida do clone.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^GIT_(AUTHOR|COMMITTER)_/.test(key) && key !== "EMAIL",
  ),
);
const run = (cmd, cwd, a) =>
  execFileSync(cmd, a, { cwd, encoding: "utf8", env: cleanEnv }).replace(/\r?\n$/, "");
const git = (cwd, ...a) => run("git", cwd, a);
const gh = (...a) => run("gh", root, a);
const tryGit = (cwd, ...a) => {
  try {
    return git(cwd, ...a);
  } catch {
    return "";
  }
};
const lines = (text) => text.split("\n").filter(Boolean);
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

const problems = [];
const fail = (message) => problems.push(message);
// Estado do clone (branch, mudanças soltas): só barra quando for publicar; para exportar/ver, não.
const failState = (message) => (exportDir ? console.warn(`aviso: ${message}`) : fail(message));

// ---------------------------------------------------------------- 1. o dev está como deve
const origin = git(root, "remote", "get-url", "origin");
if (!isDevRemote(origin)) fail(`o origin deste clone não é o repositório -dev: ${origin}`);
if (lines(git(root, "remote", "get-url", "--push", "--all", "origin")).some((u) => !isDevRemote(u)))
  fail("algum endereço de envio do origin não é o repositório -dev");
if (git(root, "branch", "--show-current") !== "main")
  failState("este clone não está na branch main");
if (git(root, "status", "--porcelain") !== "") failState("há mudanças não commitadas");
if (apply) {
  if (!version || !isVersion(version)) fail("informe --version X.Y.Z");
  try {
    git(root, "fetch", "origin", "main");
    if (git(root, "rev-parse", "HEAD") !== git(root, "rev-parse", "origin/main"))
      fail("a main local não é igual à origin/main (envie ou atualize antes)");
    const head = git(root, "rev-parse", "HEAD");
    const ci = JSON.parse(
      gh(
        "run",
        "list",
        "--branch",
        "main",
        "--workflow",
        "ci.yml",
        "--limit",
        "1",
        "--json",
        "conclusion,headSha",
      ),
    )[0];
    if (!ci || ci.headSha !== head || ci.conclusion !== "success")
      fail("o CI da main não está verde para este commit");
    if (gh("api", `repos/${DEV_REPO}`, "--jq", ".visibility") !== "private")
      fail("o repositório -dev não está privado");
  } catch (error) {
    fail(`não consegui conferir a origin/main e o CI: ${String(error.message).split("\n")[0]}`);
  }
}

// ---------------------------------------------------------------- 2. a cópia (lista permitida)
const manifest = JSON.parse(
  readFileSync(path.join(root, "scripts", "publish-manifest.json"), "utf8"),
);
// -z: nomes com acento, aspas ou quebra de linha chegam inteiros (sem escapes entre aspas).
const trackedRaw = git(root, "ls-files", "-z", "--stage").split("\0").filter(Boolean);
const tracked = [];
for (const entry of trackedRaw) {
  const [meta, name] = [entry.slice(0, entry.indexOf("\t")), entry.slice(entry.indexOf("\t") + 1)];
  if (meta.startsWith("120000")) fail(`link simbólico rastreado: ${name}`);
  if (hasControlChars(name, 32, true))
    fail(`nome de arquivo com caractere de controle: ${JSON.stringify(name)}`);
  tracked.push(name);
}
const files = selectFiles(tracked, manifest);

const denylistFile = path.join(root, "_local", "publish-denylist.txt");
const literals = existsSync(denylistFile) ? parseDenylist(readFileSync(denylistFile, "utf8")) : [];
if (literals.length === 0) {
  const message =
    "_local/publish-denylist.txt não existe ou está vazio (só valem os padrões genéricos)";
  if (apply) fail(message);
  else console.warn(`aviso: ${message}`);
}

// O que foi varrido é exatamente o que será gravado: guardamos os bytes lidos (nada é copiado de novo).
const contents = new Map(); // destino -> Buffer
const findings = [];
for (const { from, to } of files) {
  findings.push(...scanPath(to, literals));
  const buffer = readFileSync(path.join(root, from));
  contents.set(to, buffer);
  if (looksBinary(buffer)) {
    if (binaryNotAllowed(to, manifest))
      fail(`${to}: binário fora da lista de extensões permitidas`);
    findings.push(...scanText(to, buffer.toString("latin1"), literals));
  } else {
    findings.push(...scanText(to, decodeText(buffer), literals));
  }
}
for (const f of findings) fail(`${f.file}:${f.line}: ${f.what}`);
const snapshot = new Map([...contents].map(([to, buffer]) => [to, sha(buffer)]));

// ---------------------------------------------------------------- 3. o clone do público
const before = new Map();
if (existsSync(path.join(publicDir, ".git"))) {
  const fetchUrls = lines(git(publicDir, "remote", "get-url", "--all", "origin"));
  const pushUrls = lines(git(publicDir, "remote", "get-url", "--push", "--all", "origin"));
  for (const p of remoteProblems(fetchUrls, pushUrls)) fail(`clone do público: ${p}`);
  const config = {};
  for (const key of [
    "user.name",
    "user.email",
    "gpg.format",
    "commit.gpgsign",
    "tag.gpgsign",
    "user.signingkey",
    "gpg.ssh.allowedsignersfile",
  ]) {
    config[key] = tryGit(publicDir, "config", "--get", key);
  }
  for (const p of signingProblems(config)) fail(`assinatura no clone do público: ${p}`);
  if (apply) {
    if (git(publicDir, "branch", "--show-current") !== "main")
      fail("o clone do público não está na main");
    if (git(publicDir, "status", "--porcelain") !== "")
      fail("o clone do público tem mudanças soltas");
    try {
      git(publicDir, "fetch", "origin");
    } catch {
      /* repositório ainda vazio: sem main remota */
    }
    const hasRemoteMain = tryGit(publicDir, "rev-parse", "--verify", "origin/main") !== "";
    const hasLocalHead = tryGit(publicDir, "rev-parse", "--verify", "HEAD") !== "";
    if (hasLocalHead && !hasRemoteMain)
      fail(
        "o clone do público tem commits locais, mas o público remoto está vazio (histórico estranho)",
      );
    if (
      hasLocalHead &&
      hasRemoteMain &&
      git(publicDir, "rev-parse", "HEAD") !== git(publicDir, "rev-parse", "origin/main")
    )
      fail("a main do clone do público não é igual à origin/main");
    if (hasLocalHead) {
      for (const p of historyProblems(1, lines(git(publicDir, "log", "--format=%an|%ae|%cn|%ce"))))
        if (!p.startsWith("o público teria")) fail(`clone do público: ${p}`);
    }
    if (version) {
      try {
        git(publicDir, "check-ref-format", `refs/tags/v${version}`);
      } catch {
        fail(`v${version} não é um nome de tag válido`);
      }
      if (tryGit(publicDir, "tag", "--list", `v${version}`) !== "")
        fail(`a tag v${version} já existe`);
      if (tryGit(publicDir, "ls-remote", "--tags", "origin", `refs/tags/v${version}`) !== "")
        fail(`a tag v${version} já existe no público`);
    }
  }
  for (const file of lines(git(publicDir, "ls-files"))) {
    before.set(file, sha(readFileSync(path.join(publicDir, file))));
  }
} else {
  console.warn(
    `aviso: ainda não há clone do público em ${publicDir} (git clone https://github.com/${PUBLIC_REPO}.git)`,
  );
  if (apply) fail("sem clone do público para publicar");
}

// ---------------------------------------------------------------- 4. relatório
const diff = diffSnapshots(before, snapshot);
// Quem publica precisa ter visto a lista dos arquivos NOVOS: o hash dela é o que --lista exige.
const newListHash = sha(Buffer.from(diff.added.join("\n"))).slice(0, 12);
console.log(`Arquivos que sairiam: ${snapshot.size}`);
console.log(
  `Em relação ao público atual: +${diff.added.length} novos, ~${diff.changed.length} alterados, -${diff.removed.length} removidos`,
);
mkdirSync(path.join(root, "_local"), { recursive: true });
writeFileSync(
  path.join(root, "_local", "publish-lista.txt"),
  [
    ...diff.added.map((f) => `novo      ${f}`),
    ...diff.changed.map((f) => `alterado  ${f}`),
    ...diff.removed.map((f) => `removido  ${f}`),
  ].join("\n") + "\n",
);
for (const [label, list] of [
  ["novos", diff.added],
  ["alterados", diff.changed],
  ["removidos", diff.removed],
]) {
  if (list.length > 0 && list.length <= 60) console.log(`  ${label}: ${list.join(", ")}`);
  else if (list.length > 60)
    console.log(`  ${label}: ${list.length} (lista completa em _local/publish-lista.txt)`);
}
console.log(`Hash da lista de arquivos novos: ${newListHash}`);
if (apply && listHash !== newListHash)
  fail(`informe --lista ${newListHash} depois de conferir _local/publish-lista.txt`);
if (problems.length > 0) {
  console.error(`\nPUBLICAÇÃO BLOQUEADA (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
if (!apply && !exportDir) {
  console.log(
    "\nNada foi alterado. Para publicar: pnpm publish:public --version X.Y.Z --lista <hash> --yes",
  );
  process.exit(0);
}

// Grava os MESMOS bytes que foram varridos (não copia de novo do disco).
const write = (dir) => {
  for (const [to, buffer] of contents) {
    const target = path.join(dir, to);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, buffer);
  }
};

if (exportDir) {
  if (existsSync(exportDir) && readdirSync(exportDir).length > 0) {
    console.error(`a pasta de exportação não está vazia: ${exportDir}`);
    process.exit(1);
  }
  write(exportDir);
  console.log(`
Cópia gerada em ${exportDir} (${files.length} arquivos). Nada foi publicado.`);
  process.exit(0);
}

// ---------------------------------------------------------------- 5. publicar (commit assinado, tag, Release)
// O repositório público tem de ser o que dizemos (o nome antigo pode redirecionar para outro).
if (
  gh("api", `repos/${PUBLIC_REPO}`, "--jq", ".full_name").toLowerCase() !==
  PUBLIC_REPO.toLowerCase()
) {
  console.error(
    "o repositório público respondeu com outro nome (redirecionamento?). Nada foi publicado.",
  );
  process.exit(1);
}
for (const entry of readdirSync(publicDir)) {
  if (entry !== ".git") rmSync(path.join(publicDir, entry), { recursive: true, force: true });
}
write(publicDir);
git(publicDir, "add", "-A");
if (git(publicDir, "status", "--porcelain") === "") {
  console.log("Nada mudou em relação ao público: nenhuma versão nova.");
  process.exit(0);
}
const title = `Leitura Compartilhada ${version}`;
git(publicDir, "commit", "-S", "-m", title);
git(publicDir, "tag", "-s", `v${version}`, "-m", title);
// Conferência do que foi criado, antes de enviar qualquer coisa.
const last = git(publicDir, "log", "-1", "--format=%an|%ae|%cn|%ce|%G?");
const ahead = tryGit(publicDir, "rev-parse", "--verify", "origin/main")
  ? Number(git(publicDir, "rev-list", "--count", "origin/main..HEAD"))
  : lines(git(publicDir, "rev-list", "HEAD")).length;
const after = [
  ...historyProblems(ahead, lines(git(publicDir, "log", "--format=%an|%ae|%cn|%ce"))),
  ...(last.endsWith("|G") ? [] : [`o commit não está com assinatura válida (${last})`]),
];
try {
  git(publicDir, "verify-tag", `v${version}`);
} catch {
  after.push("a tag não tem assinatura válida");
}
if (after.length > 0) {
  console.error(`\nNADA FOI ENVIADO. Problemas no commit local do público (${publicDir}):`);
  for (const p of after) console.error(`  - ${p}`);
  console.error("Desfaça o commit e a tag locais no clone do público antes de tentar de novo.");
  process.exit(1);
}
git(publicDir, "push", "origin", "HEAD:refs/heads/main", `refs/tags/v${version}`);
const notesFile = path.join(publicDir, ".release-notes.tmp");
writeFileSync(notesFile, `${title}\n\nTag assinada. Verifique com: git tag -v v${version}\n`);
try {
  gh(
    "release",
    "create",
    `v${version}`,
    "--repo",
    PUBLIC_REPO,
    "--title",
    title,
    "--notes-file",
    notesFile,
    "--verify-tag",
  );
} finally {
  rmSync(notesFile, { force: true });
}
console.log(`\nPublicado ${title}: https://github.com/${PUBLIC_REPO}/releases/tag/v${version}`);
