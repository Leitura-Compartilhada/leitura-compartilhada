import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clip,
  diaryEntry,
  isAllowedUrl,
  isSessionName,
  PROFILES,
  parseCommand,
  safeFileName,
} from "./juri-lib.mjs";

test("sessão: só letras minúsculas e dígitos, sem caminho", () => {
  for (const ok of ["desk", "cel1", "a"]) assert.equal(isSessionName(ok), true, ok);
  for (const bad of ["", "../x", "a/b", "Desk", "com espaco", "a".repeat(17)])
    assert.equal(isSessionName(bad), false, bad);
});

test("o cliente só navega no servidor de teste", () => {
  const base = "http://localhost:3210";
  assert.equal(isAllowedUrl("/library", base), true);
  assert.equal(isAllowedUrl("http://localhost:3210/login", base), true);
  assert.equal(isAllowedUrl("http://localhost:3000/", base), false);
  assert.equal(isAllowedUrl("https://exemplo.com/", base), false);
  assert.equal(isAllowedUrl("file:///etc/passwd", base), false);
});

test("comandos: nome conhecido e argumentos suficientes", () => {
  assert.deepEqual(parseCommand(["clicar", "Entrar"]), { name: "clicar", args: ["Entrar"] });
  assert.deepEqual(parseCommand(["ver"]), { name: "ver", args: [] });
  assert.match(parseCommand([]).error, /informe um comando/);
  assert.match(parseCommand(["apagar"]).error, /desconhecido/);
  assert.match(parseCommand(["digitar", "Email"]).error, /2 argumento/);
  assert.deepEqual(parseCommand(["tocar", "640", "400"]), { name: "tocar", args: ["640", "400"] });
  assert.match(parseCommand(["tocar", "640"]).error, /2 argumento/);
});

test("o diário guarda só o que existe", () => {
  const base = { n: 1, session: "desk", command: "ver", args: [], url: "http://x/", ok: true };
  const plain = diaryEntry(base);
  assert.equal(plain.comando, "ver");
  assert.equal("erros_console" in plain, false);
  const full = diaryEntry({
    ...base,
    ok: false,
    message: "não achei",
    consoleErrors: ["boom"],
    failedRequests: ["GET /x 500"],
    screenshot: "c.png",
  });
  assert.deepEqual(full.erros_console, ["boom"]);
  assert.equal(full.captura, "c.png");
  assert.equal(full.ok, false);
});

test("textos longos são cortados, nomes de captura são seguros", () => {
  assert.equal(clip("abc", 10), "abc");
  assert.match(clip("a".repeat(50), 10), /cortado, 50 caracteres/);
  assert.equal(safeFileName("../../etc passwd!"), "-etc-passwd-");
  assert.equal(safeFileName("???"), "-");
  assert.equal(safeFileName(""), "captura");
});

test("o celular tem toque e tela estreita", () => {
  assert.equal(PROFILES.celular.hasTouch, true);
  assert.equal(PROFILES.celular.viewport.width, 390);
  assert.equal(PROFILES.desktop.isMobile, false);
});
