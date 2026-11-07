import { apiErrorSchema, configResponseSchema } from "@leitura/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeTestDb, createTestApp } from "./helpers.js";

// A API serve o web buildado (uma origem só). O setup cria um web mínimo em WEB_DIST.
describe("web servido pela API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("entrega o index.html na raiz, sem cache", async () => {
    const resposta = await app.inject({ method: "GET", url: "/" });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.body).toContain("spa de teste");
    expect(resposta.headers["cache-control"]).toBe("no-cache");
  });

  it("devolve o index.html em rota do roteador do navegador (fallback de SPA)", async () => {
    const resposta = await app.inject({
      method: "GET",
      url: "/read/0b6f0e4e-3f0e-4b7a-9d38-6a2f6f1d2c11",
    });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.body).toContain("spa de teste");
  });

  it("marca os arquivos de assets/ como imutáveis e o service worker como revalidável", async () => {
    const asset = await app.inject({ method: "GET", url: "/assets/app-abc123.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");

    const sw = await app.inject({ method: "GET", url: "/sw.js" });
    expect(sw.statusCode).toBe(200);
    expect(sw.headers["cache-control"]).toBe("no-cache");
  });

  it("rota de API que não existe responde 404 em JSON, nunca o index.html", async () => {
    const resposta = await app.inject({ method: "GET", url: "/api/nao-existe" });
    expect(resposta.statusCode).toBe(404);
    expect(apiErrorSchema.parse(resposta.json()).error.code).toBe("NOT_FOUND");
  });

  it("não serve o web por métodos que não são GET", async () => {
    const resposta = await app.inject({ method: "POST", url: "/qualquer-coisa" });
    expect(resposta.statusCode).toBe(404);
    expect(apiErrorSchema.parse(resposta.json()).error.code).toBe("NOT_FOUND");
  });

  it("não deixa sair da pasta do web com caminho relativo", async () => {
    // O caminho é normalizado antes de chegar ao servidor de arquivos. O que importa é que o
    // resultado nunca seja um arquivo de fora da pasta do web: cai no fallback da SPA.
    const resposta = await app.inject({ method: "GET", url: "/assets/../../etc/passwd" });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.body).toContain("spa de teste");
    expect(resposta.body).not.toContain("root:");

    const codificado = await app.inject({ method: "GET", url: "/assets/%2e%2e/%2e%2e/etc/passwd" });
    expect(codificado.body).not.toContain("root:");
    expect([200, 400, 404]).toContain(codificado.statusCode);
  });

  it("informa se o cadastro está aberto, sem exigir login", async () => {
    const resposta = await app.inject({ method: "GET", url: "/api/config" });
    expect(resposta.statusCode).toBe(200);
    expect(configResponseSchema.parse(resposta.json()).allowSignup).toBe(true);
  });

  it("responde o health check", async () => {
    const resposta = await app.inject({ method: "GET", url: "/health" });
    expect(resposta.json()).toEqual({ ok: true, db: "up" });
  });
});
