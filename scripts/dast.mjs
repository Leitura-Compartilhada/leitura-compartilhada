// Análise de segurança dinâmica (DAST) sob demanda: o OWASP ZAP (baseline, passivo) olha o app NO AR.
// Sobe uma instância descartável (banco, storage e porta próprios; nunca a sua estante), cria uma
// conta de teste, entrega a sessão ao ZAP e grava o relatório em _local/dast/.
//   pnpm dast                  porta 3300, instância "dast"
//   DAST_PORT=3310 pnpm dast   outra porta
// Precisa do Docker, do Postgres do docker-compose no ar e do web buildado (pnpm build).
// Informativo: não bloqueia o CI. Os achados viram lista no cofre (docs/projeto/quality-gate.md).
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.DAST_PORT ?? 3300);
const IMAGE = process.env.ZAP_IMAGE ?? "ghcr.io/zaproxy/zaproxy:stable";
const SPIDER_MINUTES = process.env.DAST_SPIDER_MINUTES ?? "2";
const DATABASE_URL = `postgres://leitura:leitura@localhost:5432/leitura_dast_e2e`;
// O sufixo fixo é a trava do prepare-cli: ele só apaga pastas com este final.
const STORAGE_DIR = path.join(os.tmpdir(), "dast-leitura-e2e-storage");
const BASE = `http://localhost:${PORT}`;
const outDir = path.join(root, "_local", "dast");

const run = (command, options = {}) =>
  spawnSync(command, { cwd: root, shell: true, encoding: "utf8", ...options });

function fail(message) {
  console.error(`dast: ${message}`);
  process.exit(1);
}

if (run("docker info").status !== 0) fail("o Docker não está rodando (abra o Docker Desktop).");

const env = {
  ...process.env,
  NODE_ENV: "test",
  API_PORT: String(PORT),
  // O contêiner do ZAP chega ao PC por host.docker.internal, então a API precisa ouvir fora do loopback.
  API_HOST: "0.0.0.0",
  API_URL: BASE,
  WEB_URL: BASE,
  DATABASE_URL,
  ALLOW_SIGNUP: "true",
  BETTER_AUTH_SECRET: "segredo-do-dast-com-mais-de-dezesseis-caracteres",
  STORAGE_DIR,
};

console.log("Preparando o banco descartável…");
const prepare = run(`pnpm --filter @leitura/db prepare:disposable ${DATABASE_URL}`, { env });
if (prepare.status !== 0) fail(`não consegui preparar o banco:\n${prepare.stderr}`);

const server = spawn("pnpm --filter @leitura/api start", {
  cwd: root,
  shell: true,
  env,
  stdio: "ignore",
});
const stopServer = () => {
  if (process.platform === "win32") spawnSync(`taskkill /pid ${server.pid} /T /F`, { shell: true });
  else server.kill("SIGTERM");
};
process.on("exit", stopServer);

async function waitForHealth() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail("a API de teste não respondeu em 60 s");
}
await waitForHealth();

// Conta de teste e sessão: o ZAP varre também o que só quem entrou vê.
const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE },
  body: JSON.stringify({
    name: "DAST",
    email: `dast-${Date.now()}@example.com`,
    password: "senha-segura-123",
  }),
});
if (!signUp.ok) fail(`cadastro de teste falhou (${signUp.status})`);
const cookie = signUp.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join(";"); // sem espaço: o ZAP separa o -z por espaços

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log(`Rodando o ZAP baseline (${IMAGE}) contra ${BASE}. A 1ª vez baixa a imagem (~1 GB).`);
const zapConfig = [
  "-config replacer.full_list(0).description=sessao-de-teste",
  "-config replacer.full_list(0).enabled=true",
  "-config replacer.full_list(0).matchtype=REQ_HEADER",
  "-config replacer.full_list(0).matchstr=Cookie",
  "-config replacer.full_list(0).regex=false",
  `-config replacer.full_list(0).replacement=${cookie}`,
].join(" ");
const zap = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "--add-host=host.docker.internal:host-gateway",
    "-v",
    `${outDir}:/zap/wrk:rw`,
    IMAGE,
    "zap-baseline.py",
    "-t",
    `http://host.docker.internal:${PORT}`,
    "-m",
    SPIDER_MINUTES,
    "-r",
    "relatorio.html",
    "-J",
    "relatorio.json",
    "-I",
    "-z",
    zapConfig,
  ],
  { stdio: "inherit" },
);

stopServer();
// 0 = sem alertas, 1 = falhas, 2 = avisos. Para nós tudo é informativo; só erro de execução falha.
if (zap.status === null || zap.status > 2) fail(`o ZAP terminou com código ${zap.status}`);
console.log(`\nRelatório: ${path.join(outDir, "relatorio.html")} (e relatorio.json).`);
