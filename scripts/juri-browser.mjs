// Navegador do cliente do júri de usabilidade: um Chromium com perfil descartável, controlado por comandos
// simples de texto (o agente cliente os roda no Bash). Cada comando entra no diário da sessão.
//
//   node scripts/juri-browser.mjs iniciar <sessão> <desktop|celular> [urlBase]   fica rodando (use em segundo plano)
//   node scripts/juri-browser.mjs <sessão> abrir <url>
//   node scripts/juri-browser.mjs <sessão> ver                  o que há na tela (árvore de acessibilidade)
//   node scripts/juri-browser.mjs <sessão> clicar "<nome visível>"
//   node scripts/juri-browser.mjs <sessão> digitar "<campo>" "<texto>"
//   node scripts/juri-browser.mjs <sessão> enviar-arquivo "<campo ou vazio>" <arquivo[,arquivo2,...]>
//   node scripts/juri-browser.mjs <sessão> enviar-pasta <pasta de teste>
//   node scripts/juri-browser.mjs <sessão> tocar <x> <y>   toque (celular) ou clique (PC) em coordenadas da tela
//   node scripts/juri-browser.mjs <sessão> voltar | rolar | esperar | captura <nome> | parar
//
// Só navega no servidor de teste (urlBase, padrão http://localhost:3210). Diário e capturas ficam em
// _local/juri/<sessão>/ (fora do git). Arquivos para enviar: só e2e/fixtures/ e _local/juri/arquivos/.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  clip,
  diaryEntry,
  isAllowedUrl,
  isSessionName,
  PROFILES,
  parseCommand,
  safeFileName,
} from "./juri-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const juriDir = path.join(root, "_local", "juri");
const allowedUploadDirs = [path.join(root, "e2e", "fixtures"), path.join(juriDir, "arquivos")];

const isUploadable = (file) => allowedUploadDirs.some((dir) => file.startsWith(dir + path.sep));

const die = (message) => {
  console.error(`juri-browser: ${message}`);
  process.exit(1);
};

const [first, second, third, fourth] = process.argv.slice(2);

// ------------------------------------------------------------------ cliente: manda o comando ao navegador
if (first !== "iniciar") {
  const session = first;
  if (!session || !isSessionName(session)) die("informe a sessão (letras minúsculas e dígitos)");
  const parsed = parseCommand(process.argv.slice(3));
  if (parsed.error) die(parsed.error);
  const infoFile = path.join(juriDir, session, "daemon.json");
  if (!existsSync(infoFile)) die(`a sessão "${session}" não está aberta (use "iniciar")`);
  const { port } = JSON.parse(readFileSync(infoFile, "utf8"));
  try {
    const response = await fetch(`http://127.0.0.1:${port}/cmd`, {
      method: "POST",
      body: JSON.stringify({ name: parsed.name, args: parsed.args }),
    });
    const body = await response.json();
    console.log(body.texto);
    process.exit(body.ok ? 0 : 2);
  } catch {
    die("não consegui falar com o navegador (a sessão foi encerrada?)");
  }
}

// ------------------------------------------------------------------ servidor: o navegador de verdade
const session = second;
const profileName = third;
const baseUrl = fourth ?? "http://localhost:3210";
if (!session || !isSessionName(session))
  die("sessão inválida (letras minúsculas e dígitos, até 16)");
if (!(profileName in PROFILES)) die('perfil inválido: use "desktop" ou "celular"');
if (!isAllowedUrl(baseUrl, baseUrl) || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(baseUrl))
  die("a urlBase precisa ser http://localhost:<porta>");

const sessionDir = path.join(juriDir, session);
const shotsDir = path.join(sessionDir, "capturas");
mkdirSync(shotsDir, { recursive: true });
mkdirSync(path.join(juriDir, "arquivos"), { recursive: true });
const diaryFile = path.join(sessionDir, "diario.jsonl");

const profile = PROFILES[profileName];
const context = await chromium.launchPersistentContext(
  path.join(os.tmpdir(), `juri-${session}-perfil`),
  { headless: true, ...profile, locale: "pt-BR", acceptDownloads: false },
);
const page = context.pages()[0] ?? (await context.newPage());

let consoleErrors = [];
let failedRequests = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(clip(message.text(), 300));
});
page.on("pageerror", (error) => consoleErrors.push(clip(`erro na página: ${error.message}`, 300)));
page.on("requestfailed", (request) =>
  failedRequests.push(
    `${request.method()} ${new URL(request.url()).pathname} (${request.failure()?.errorText})`,
  ),
);
page.on("response", (response) => {
  if (response.status() >= 400)
    failedRequests.push(
      `${response.request().method()} ${new URL(response.url()).pathname} -> ${response.status()}`,
    );
});
// O cliente não sai do servidor de teste: qualquer pedido para outro endereço é cortado.
await context.route("**/*", (route) => {
  const url = route.request().url();
  if (url.startsWith("data:") || url.startsWith("blob:") || isAllowedUrl(url, baseUrl))
    return route.continue();
  return route.abort();
});

/** Acha o elemento pelo nome que um leigo veria: botão, link, campo, rótulo, texto. */
async function locate(target, { field = false } = {}) {
  // Campo: só o que aceita texto. Clique: botões, links e afins. Nome exato antes de parcial.
  const build = (exact) =>
    field
      ? [
          page.getByRole("textbox", { name: target, exact }),
          page.getByRole("combobox", { name: target, exact }),
          page.getByLabel(target, { exact }),
          page.getByPlaceholder(target, { exact }),
        ]
      : [
          page.getByRole("button", { name: target, exact }),
          page.getByRole("link", { name: target, exact }),
          page.getByRole("tab", { name: target, exact }),
          page.getByRole("checkbox", { name: target, exact }),
          page.getByRole("switch", { name: target, exact }),
          page.getByRole("menuitem", { name: target, exact }),
          page.getByRole("combobox", { name: target, exact }),
          page.getByLabel(target, { exact }),
          page.getByText(target, { exact }),
        ];
  for (const exact of [true, false]) {
    for (const strategy of build(exact)) {
      const visible = strategy.filter({ visible: true });
      if ((await visible.count()) > 0) return visible.first();
    }
  }
  return null;
}

/**
 * O que existe na página mas o usuário não enxerga ou não consegue tocar (transparente, `inert`,
 * `aria-hidden`, sem tamanho, escondido) e o valor em texto dos controles deslizantes. A árvore de
 * acessibilidade sozinha engana: lista botões que o olho não vê.
 */
async function invisibleAndValues() {
  return page.evaluate(() => {
    const lines = [];
    for (const el of document.querySelectorAll(
      "button, a[href], input, select, textarea, [role=button]",
    )) {
      const name =
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        (el.textContent || "").trim().slice(0, 60);
      if (!name) continue;
      let why = null;
      for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (node.inert) why = "inert";
        else if (node.getAttribute("aria-hidden") === "true") why = "aria-hidden";
        else if (style.display === "none" || style.visibility === "hidden") why = "escondido";
        else if (style.opacity === "0") why = "transparente";
        if (why) break;
      }
      if (!why) {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) why = "sem tamanho";
      }
      if (why) lines.push(`[invisível: ${why}] ${el.tagName.toLowerCase()} "${name}"`);
    }
    for (const range of document.querySelectorAll("input[type=range]")) {
      const label = range.getAttribute("aria-label") || "controle";
      const text = range.getAttribute("aria-valuetext");
      lines.push(
        `[controle] "${label}": valor ${range.value}${text ? `, o usuário lê "${text}"` : ""}`,
      );
    }
    return lines;
  });
}

async function snapshot() {
  const tree = await page
    .locator("body")
    .ariaSnapshot()
    .catch(() => "(não consegui ler a tela)");
  const frames = [];
  for (const frame of page.frames().slice(1, 4)) {
    const text = await frame
      .locator("body")
      .textContent({ timeout: 1500 })
      .catch(() => "");
    if (text.trim()) frames.push(`[conteúdo do livro] ${clip(text.trim(), 600)}`);
  }
  const extras = await invisibleAndValues().catch(() => []);
  const note = extras.length ? `\n\nObservações da tela:\n${extras.join("\n")}` : "";
  return `Endereço: ${page.url()}\nTítulo: ${await page.title()}\n\n${clip(tree, 3500)}${note}${frames.length ? `\n\n${frames.join("\n")}` : ""}`;
}

let count = 0;
async function execute(name, args) {
  switch (name) {
    case "abrir": {
      if (!isAllowedUrl(args[0], baseUrl))
        return { ok: false, texto: "Só abro endereços do app de teste." };
      await page.goto(new URL(args[0], baseUrl).href, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      return { ok: true, texto: `Abri ${page.url()}` };
    }
    case "ver":
      return { ok: true, texto: await snapshot() };
    case "clicar": {
      const element = await locate(args[0]);
      if (!element)
        return { ok: false, texto: `Não encontrei nada na tela com o nome "${args[0]}".` };
      await element.click({ timeout: 5000 });
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
      return { ok: true, texto: `Cliquei em "${args[0]}". Agora estou em ${page.url()}` };
    }
    case "digitar": {
      const element = await locate(args[0], { field: true });
      if (!element) return { ok: false, texto: `Não encontrei o campo "${args[0]}".` };
      await element.fill(args.slice(1).join(" "), { timeout: 5000 });
      return { ok: true, texto: `Digitei no campo "${args[0]}".` };
    }
    case "enviar-arquivo": {
      // Vários arquivos de uma vez: nomes separados por vírgula.
      const files = args[1].split(",").map((name) => path.resolve(root, name.trim()));
      if (files.some((file) => !isUploadable(file) || !existsSync(file)))
        return {
          ok: false,
          texto: "Só envio arquivos de teste (e2e/fixtures ou _local/juri/arquivos) que existam.",
        };
      const named = args[0] ? await locate(args[0]) : null;
      const input =
        named && (await named.evaluate((el) => el.tagName === "INPUT").catch(() => false))
          ? named
          : page.locator('input[type="file"]:not([webkitdirectory])').first();
      if ((await input.count()) === 0)
        return { ok: false, texto: "Não há campo para enviar arquivo nesta tela." };
      await input.setInputFiles(files, { timeout: 5000 });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      return { ok: true, texto: `Enviei ${files.length} arquivo(s).` };
    }
    case "enviar-pasta": {
      const dir = path.resolve(root, args[0]);
      if (!isUploadable(dir) || !existsSync(dir))
        return { ok: false, texto: "Só envio pastas de teste (_local/juri/arquivos) que existam." };
      const input = page.locator("input[webkitdirectory]").first();
      if ((await input.count()) === 0)
        return { ok: false, texto: "Não há campo para enviar pasta nesta tela." };
      await input.setInputFiles(dir, { timeout: 5000 });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      return { ok: true, texto: "Enviei a pasta." };
    }
    case "voltar":
      await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
      return { ok: true, texto: `Voltei. Estou em ${page.url()}` };
    case "tocar": {
      const x = Number(args[0]);
      const y = Number(args[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y))
        return { ok: false, texto: "Use: tocar <x> <y> (números, em pixels)." };
      if (profile.hasTouch) await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      return { ok: true, texto: `Toquei na tela em ${x},${y}.` };
    }
    case "rolar":
      await page.mouse.wheel(0, 600);
      return { ok: true, texto: "Rolei a tela para baixo." };
    case "esperar":
      await page.waitForTimeout(Math.min(Number(args[0] ?? 2) || 2, 5) * 1000);
      return { ok: true, texto: "Esperei." };
    case "captura": {
      const file = `${String(count).padStart(3, "0")}-${safeFileName(args[0])}.png`;
      await page.screenshot({ path: path.join(shotsDir, file) });
      return { ok: true, texto: `Captura salva: ${file}`, captura: file };
    }
    default:
      return { ok: false, texto: "Comando não implementado." };
  }
}

const server = http.createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const { name, args } = JSON.parse(body || "{}");
  count += 1;
  consoleErrors = [];
  failedRequests = [];
  let result;
  try {
    if (name === "parar") {
      result = { ok: true, texto: "Sessão encerrada." };
    } else {
      result = await execute(name, args);
    }
  } catch (error) {
    result = {
      ok: false,
      texto: `Não deu certo: ${clip(String(error.message).split("\n")[0], 200)}`,
    };
  }
  appendFileSync(
    diaryFile,
    `${JSON.stringify(
      diaryEntry({
        n: count,
        session,
        command: name,
        args,
        url: page.url(),
        ok: result.ok,
        message: result.texto,
        consoleErrors,
        failedRequests,
        screenshot: result.captura,
      }),
    )}\n`,
  );
  // Console e pedidos que falharam ficam só no diário: um leigo não os vê.
  response.end(JSON.stringify({ ok: result.ok, texto: `[passo ${count}] ${result.texto}` }));
  if (name === "parar") {
    server.close();
    await context.close();
    process.exit(0);
  }
});
server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  writeFileSync(
    path.join(sessionDir, "daemon.json"),
    JSON.stringify({ port, perfil: profileName }),
  );
  console.log(`juri-browser: sessão "${session}" (${profileName}) pronta; diário em ${diaryFile}`);
});
