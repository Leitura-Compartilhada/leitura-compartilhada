import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertSafeDestination,
  binaryNotAllowed,
  decodeText,
  diffSnapshots,
  historyProblems,
  isDevRemote,
  isPublicRemote,
  isVersion,
  looksBinary,
  PUBLIC_IDENTITY,
  parseDenylist,
  parseGithubRemote,
  remoteProblems,
  scanPath,
  scanText,
  selectFiles,
  signingProblems,
} from "./publish-lib.mjs";

// Os valores sensíveis são montados aos pedaços: o próprio teste vai para o público e não pode conter
// um endereço, e-mail ou caminho que a varredura barra.
const tsnet = ["meu-host", "tail1234", "ts", "net"].join(".");
const mail = `fulano@${["gmail", "com"].join(".")}`;
const winPath = `${"C:"}\\Users\\fulano\\projeto`;
const keyBlock = `${"-----BEGIN "}${"PRIVATE KEY-----"}`;
const ghToken = `ghp_${"a".repeat(36)}`;

const manifest = {
  include: ["apps/", "packages/", "package.json", "LICENSE", ".github/workflows/"],
  never: ["CLAUDE.md", "docs/", "apps/secreto/", ".github/dependabot.yml"],
  neverAnywhere: ["CLAUDE.md", ".claude", "docs", "_local"],
  approvedBinaries: ["e2e/a.epub"],
  map: { "public-template/README.md": "README.md" },
};

test("só entra o que está na lista permitida, e a proibida sempre vence", () => {
  const tracked = [
    "apps/api/src/app.ts",
    "apps/secreto/chave.ts",
    "package.json",
    "LICENSE",
    "CLAUDE.md",
    "docs/projeto/estado.md",
    "README.md",
    "public-template/README.md",
    ".github/workflows/ci.yml",
    ".github/dependabot.yml",
    "outra-coisa.txt",
  ];
  const out = selectFiles(tracked, manifest);
  assert.deepEqual(
    out.map((f) => f.to),
    [".github/workflows/ci.yml", "LICENSE", "README.md", "apps/api/src/app.ts", "package.json"],
  );
  // O README público vem do modelo, não do README do dev.
  assert.equal(out.find((f) => f.to === "README.md")?.from, "public-template/README.md");
});

test("um modelo que não está no git é erro", () => {
  assert.throws(() => selectFiles(["package.json"], manifest), /não está no git/);
});

test("a varredura acha os padrões genéricos e diz a linha", () => {
  const text = ["linha limpa", `host: ${tsnet}`, `mail: ${mail}`, `path: ${winPath}`].join("\n");
  const found = scanText("x.md", text);
  assert.deepEqual(
    found.map((f) => [f.line, f.what]),
    [
      [2, "endereço da tailnet"],
      [3, "e-mail"],
      [4, "caminho de usuário do Windows"],
    ],
  );
  assert.equal(scanText("k.pem", keyBlock).length, 1);
  assert.equal(scanText("t.txt", `token ${ghToken}`).length, 1);
});

test("o host de exemplo do projeto é permitido, o real não", () => {
  const placeholder = ["pc", "tailnet", "ts", "net"].join(".");
  assert.deepEqual(scanText("env.example", `URL=https://${placeholder}`), []);
  assert.equal(scanText("x.md", `https://${tsnet}`).length, 1);
});

test("texto comum e e-mails de exemplo não disparam nada", () => {
  const text =
    'const email = "ana@example.com";\nconst url = "https://github.com/org/repo";\nfoo.ts.map';
  assert.deepEqual(scanText("ok.ts", text), []);
});

test("a lista local acha termos sem diferenciar maiúsculas, também no nome do arquivo", () => {
  const literals = parseDenylist("# comentário\n\nTermoSecreto\n  outro termo  \n");
  assert.deepEqual(literals, ["TermoSecreto", "outro termo"]);
  assert.equal(scanText("a.md", "um termosecreto aqui", literals)[0]?.what, "termo da lista local");
  assert.equal(scanPath("docs/termosecreto.md", literals).length, 1);
  assert.deepEqual(scanText("a.md", "nada demais", literals), []);
});

test("arquivo com byte nulo é binário", () => {
  assert.equal(looksBinary(Buffer.from([1, 2, 0, 3])), true);
  assert.equal(looksBinary(Buffer.from("texto")), false);
});

test("o origin do clone tem de ser o -dev, e o do público, o público", () => {
  const org = "github.com/Leitura-Compartilhada";
  assert.equal(isDevRemote(`https://${org}/leitura-compartilhada-dev.git`), true);
  assert.equal(isDevRemote(`https://${org}/leitura-compartilhada.git`), false);
  assert.equal(isDevRemote("https://github.com/Outra/leitura-compartilhada-dev.git"), false);
  assert.equal(isPublicRemote(`https://${org}/leitura-compartilhada.git`), true);
  assert.equal(isPublicRemote(`https://${org}/leitura-compartilhada-dev.git`), false);
});

test("versão no formato X.Y.Z", () => {
  for (const ok of ["0.4.0", "1.0.0", "1.0.0-rc.1"]) assert.equal(isVersion(ok), true, ok);
  for (const bad of ["v0.4.0", "0.4", "1.0.0.0", "", "latest"])
    assert.equal(isVersion(bad), false, bad);
});

test("a configuração de assinatura do clone público é conferida", () => {
  const good = {
    "user.name": PUBLIC_IDENTITY.name,
    "user.email": PUBLIC_IDENTITY.email,
    "gpg.format": "ssh",
    "commit.gpgsign": "true",
    "tag.gpgsign": "true",
    "user.signingkey": "/algum/caminho.pub",
    "gpg.ssh.allowedsignersfile": "/algum/allowed_signers",
  };
  assert.deepEqual(signingProblems(good), []);
  const bad = {
    ...good,
    "user.email": "outro@example.com",
    "commit.gpgsign": "false",
    "user.signingkey": "",
  };
  assert.equal(signingProblems(bad).length, 3);
});

test("diferença entre o público atual e o que vai sair", () => {
  const before = new Map([
    ["a", "1"],
    ["b", "2"],
    ["c", "3"],
  ]);
  const after = new Map([
    ["a", "1"],
    ["b", "9"],
    ["d", "4"],
  ]);
  assert.deepEqual(diffSnapshots(before, after), { added: ["d"], removed: ["c"], changed: ["b"] });
});

test("a lista proibida vale em qualquer pasta e sem diferenciar maiúsculas", () => {
  const tracked = [
    "apps/web/CLAUDE.md",
    "apps/x/.claude/settings.local.json",
    "apps/x/.Claude/a",
    "apps/x/.env",
    "apps/x/.env.local",
    "apps/x/.env.example",
    "packages/y/docs/n.md",
    "apps/_local/z",
    "packages/storage/src/a.ts",
  ];
  assert.deepEqual(
    selectFiles(tracked, { ...manifest, map: {} }).map((f) => f.to),
    ["apps/x/.env.example", "packages/storage/src/a.ts"],
  );
});

test("o map só aceita modelos de public-template/ e destinos seguros", () => {
  for (const bad of ["../x", "/abs", "a\\b", ".git/hooks/post-commit", "C:/x", "a/../b", "a//b"])
    assert.throws(() => assertSafeDestination(bad), /inseguro/, bad);
  assertSafeDestination("docs/ARQUITETURA.md");
  const tracked = ["docs/projeto/estado.md", "public-template/README.md"];
  assert.throws(
    () => selectFiles(tracked, { ...manifest, map: { "docs/projeto/estado.md": "docs/x.md" } }),
    /public-template/,
  );
});

test("a varredura pega caminhos em outros formatos", () => {
  const user = "fulano";
  const cases = [
    `c:\\users\\${user}\\x`,
    `/c/Users/${user}/x`,
    `file:///c%3A/Users/${user}/x`,
    `/home/${user}/x`,
    `"C:\\Users\\${user}"`,
  ];
  for (const text of cases) assert.ok(scanText("x", text).length > 0, text);
});

test("a varredura pega e-mails de qualquer provedor, mas não os de exemplo", () => {
  for (const at of ["icloud.com", "proton.me", "uol.com.br", "meudominio.dev"])
    assert.ok(scanText("x", `fulano@${at}`).length > 0, at);
  assert.ok(scanText("x", `fulano%40${["gmail", "com"].join(".")}`).length > 0);
  assert.deepEqual(
    scanText("x", "a@example.com e git@github.com e 1+2@users.noreply.github.com"),
    [],
  );
});

test("IP da tailnet e chaves entram na varredura", () => {
  for (const text of [
    `host ${[100, 64, 1, 2].join(".")}`,
    `ip ${[100, 127, 0, 9].join(".")}`,
    `tskey-auth-${"a".repeat(12)}`,
    `github_pat_${"a".repeat(30)}`,
    ["postgres://app:segredo123", "db.interno/x"].join("@"),
  ])
    assert.ok(scanText("x", text).length > 0, text);
  assert.deepEqual(
    scanText("x", `${[100, 128, 0, 1].join(".")} e ${[100, 63, 0, 1].join(".")}`),
    [],
  );
  assert.deepEqual(scanText("x", "postgres://leitura:leitura@localhost:5432/db"), []);
});

test("o host de exemplo só vale inteiro: sufixo de host real é achado", () => {
  const real = `meupc.${["tailnet", "ts", "net"].join(".")}`;
  assert.ok(scanText("x", `https://${real}`).length > 0);
});

test("texto em UTF-16 é decodificado e varrido", () => {
  const text = `mail: ${mail}`;
  const bom = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  const noBom = Buffer.from(text.padEnd(40, " "), "utf16le");
  for (const buffer of [bom, noBom]) {
    assert.equal(looksBinary(buffer), false);
    assert.ok(scanText("x", decodeText(buffer)).length > 0);
  }
  assert.equal(looksBinary(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 0])), true);
});

test("termos da lista: acento decomposto e espaços diferentes", () => {
  const literals = ["Getúlio Vagner"];
  assert.ok(scanText("x", `Getu${"́"}lio Vagner`, literals).length > 0);
  assert.ok(scanText("x", "getúlio   vagner", literals).length > 0);
  assert.ok(scanText("x", `Getúlio${"\n"}Vagner`, literals).length > 0);
  assert.deepEqual(scanText("x", "nada a ver", literals), []);
});

test("binários: só extensões permitidas ou aprovadas", () => {
  assert.equal(binaryNotAllowed("a/b.png", manifest), false);
  assert.equal(binaryNotAllowed("e2e/a.epub", manifest), false);
  assert.equal(binaryNotAllowed("e2e/b.epub", manifest), true);
  assert.equal(binaryNotAllowed("x.pdf", manifest), true);
});

test("remotos: só o github.com, em https ou ssh, e o nome antigo não vale", () => {
  const dev = "Leitura-Compartilhada/leitura-compartilhada-dev";
  assert.equal(parseGithubRemote(`git@github.com:${dev}.git`), dev.toLowerCase());
  assert.equal(parseGithubRemote(`ssh://git@github.com/${dev}`), dev.toLowerCase());
  assert.equal(parseGithubRemote(`https://github.com/${dev}/`), dev.toLowerCase());
  assert.equal(parseGithubRemote(`https://outro.host/${dev}`), null);
  const old = `https://github.com/${["Getulio", "vm", "Santos"].join("")}/leitura-compartilhada.git`;
  assert.equal(isDevRemote(old), false);
  assert.equal(isPublicRemote(old), false);
});

test("o clone do público precisa de um endereço só, de busca e de envio", () => {
  const pub = "https://github.com/Leitura-Compartilhada/leitura-compartilhada.git";
  const dev = "https://github.com/Leitura-Compartilhada/leitura-compartilhada-dev.git";
  assert.deepEqual(remoteProblems([pub], [pub]), []);
  assert.equal(remoteProblems([pub], [dev]).length, 1);
  assert.equal(remoteProblems([pub], [pub, pub]).length, 1);
});

test("a história do público: 1 commit novo e só a identidade pública", () => {
  const ok = `${PUBLIC_IDENTITY.name}|${PUBLIC_IDENTITY.email}|${PUBLIC_IDENTITY.name}|${PUBLIC_IDENTITY.email}`;
  assert.deepEqual(historyProblems(1, [ok]), []);
  assert.equal(historyProblems(149, [ok]).length, 1);
  assert.equal(
    historyProblems(1, [ok, "Outro|outro@example.com|Outro|outro@example.com"]).length,
    1,
  );
});

test("versão: nome de tag válido", () => {
  for (const bad of ["1.0.0-a..b", "1.0.0-x.lock", "1.0.0-", "1.0.0-.a"])
    assert.equal(isVersion(bad), false, bad);
  assert.equal(isVersion("1.0.0-rc.1"), true);
});

test("signingProblems: cada campo sozinho é apontado", () => {
  const good = {
    "user.name": PUBLIC_IDENTITY.name,
    "user.email": PUBLIC_IDENTITY.email,
    "gpg.format": "ssh",
    "commit.gpgsign": "true",
    "tag.gpgsign": "true",
    "user.signingkey": "k",
    "gpg.ssh.allowedsignersfile": "f",
  };
  for (const key of Object.keys(good))
    assert.equal(signingProblems({ ...good, [key]: "" }).length, 1, key);
});

test("diffSnapshots com o público vazio (primeiro uso)", () => {
  assert.deepEqual(diffSnapshots(new Map(), new Map([["a", "1"]])), {
    added: ["a"],
    removed: [],
    changed: [],
  });
});
