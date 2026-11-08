// Sobe o app numa instância descartável para o júri de usabilidade (banco, storage e porta próprios;
// nunca a sua estante nem o seu .env). Fica no ar até você parar (Ctrl+C) ou matar o processo.
//   pnpm juri:server                  porta 3210, instância "juri"
//   JURI_PORT=3220 pnpm juri:server   outra porta
// Precisa do Docker, do Postgres do docker-compose no ar e do web buildado (pnpm build).
// Limpeza depois: pnpm e2e:clean --yes (apaga o banco leitura_juri_e2e e a pasta de storage).
import { spawn, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.JURI_PORT ?? 3210);
const BASE = `http://localhost:${PORT}`;
const DATABASE_URL = "postgres://leitura:leitura@localhost:5432/leitura_juri_e2e";
// O sufixo fixo é a trava do prepare-cli: ele só apaga pastas com este final.
const STORAGE_DIR = path.join(os.tmpdir(), "juri-leitura-e2e-storage");

const run = (command, options = {}) =>
  spawnSync(command, { cwd: root, shell: true, encoding: "utf8", ...options });

function fail(message) {
  console.error(`juri-server: ${message}`);
  process.exit(1);
}

if (run("docker info").status !== 0) fail("o Docker não está rodando (abra o Docker Desktop).");

const env = {
  ...process.env,
  NODE_ENV: "test",
  API_PORT: String(PORT),
  API_URL: BASE,
  WEB_URL: BASE,
  DATABASE_URL,
  ALLOW_SIGNUP: "true",
  BETTER_AUTH_SECRET: "segredo-do-juri-com-mais-de-dezesseis-caracteres",
  STORAGE_DIR,
  CONVERT_TIMEOUT_MS: "120000",
};

console.log("Preparando o banco descartável…");
const prepare = run(`pnpm --filter @leitura/db prepare:disposable ${DATABASE_URL}`, { env });
if (prepare.status !== 0) fail(`não consegui preparar o banco:\n${prepare.stderr}`);

const children = ["pnpm --filter @leitura/api start", "pnpm --filter @leitura/worker start"].map(
  (command) => spawn(command, { cwd: root, shell: true, env, stdio: "ignore" }),
);
const stop = () => {
  for (const child of children) {
    if (process.platform === "win32")
      spawnSync(`taskkill /pid ${child.pid} /T /F`, { shell: true });
    else child.kill("SIGTERM");
  }
};
process.on("exit", stop);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

for (let i = 0; i < 90; i += 1) {
  try {
    if ((await fetch(`${BASE}/health`)).ok) break;
  } catch {
    // ainda subindo
  }
  if (i === 89) fail("a API de teste não respondeu em 90 s");
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
console.log(`Júri: app no ar em ${BASE} (banco leitura_juri_e2e). Ctrl+C para parar.`);
await new Promise(() => {});
