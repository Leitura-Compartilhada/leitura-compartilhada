import { readdir } from "node:fs/promises";
import path from "node:path";
import { apiErrorSchema, bookSchema, configResponseSchema } from "@leitura/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../src/env.js";
import {
  closeTestDb,
  createTestApp,
  fakeEpub,
  PASSWORD,
  resetDatabase,
  signUp,
  type TestUser,
  uploadBook,
} from "./helpers.js";

/** Arquivos que o storage guarda para um usuário (ou nenhum, se a pasta nem existe). */
async function storedFiles(userId: string): Promise<string[]> {
  try {
    return await readdir(path.join(env.STORAGE_DIR, "books", userId));
  } catch {
    return [];
  }
}

// Os blocos abaixo dividem a conexão de teste: ela só pode ser fechada quando todos terminam.
afterAll(async () => {
  await closeTestDb();
});

describe("cabeçalhos de segurança", () => {
  let app: FastifyInstance;
  let ana: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    ana = await signUp(app, "ana@example.com");
  });

  afterAll(async () => {
    await app.close();
  });

  function expectHardened(headers: Record<string, unknown>) {
    const csp = String(headers["content-security-policy"]);
    // Sem 'unsafe-inline' em script-src, `<script>`, `on*=` e `javascript:` de um EPUB não rodam.
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(scriptSrc.trim()).toBe("script-src 'self'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("same-origin");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["permissions-policy"]).toBe(
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
    expect(headers["permissions-policy"]).not.toMatch(/wake/); // a rolagem automática usa a tela acesa
  }

  it("estão em toda resposta: web, fallback da SPA, JSON, health e erro", async () => {
    for (const url of [
      "/",
      "/read/0b6f0e4e-3f0e-4b7a-9d38-6a2f6f1d2c11",
      "/assets/app-abc123.js",
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(200);
      expectHardened(response.headers);
    }
    for (const url of ["/api/config", "/health", "/api/nao-existe", "/api/books"]) {
      const response = await app.inject({ method: "GET", url });
      expectHardened(response.headers);
    }
  });

  it("o CSP libera o que o leitor precisa e nada que execute código do livro", async () => {
    const csp = String(
      (await app.inject({ method: "GET", url: "/" })).headers["content-security-policy"],
    );
    // O foliate injeta <style> e carrega capítulos, imagens e fontes como blob:.
    expect(csp).toMatch(/style-src [^;]*'unsafe-inline'/);
    expect(csp).toMatch(/frame-src [^;]*blob:/);
    expect(csp).toMatch(/img-src [^;]*blob:/);
    // Mas script nunca vem de blob: nem de inline.
    expect(csp).not.toMatch(/script-src [^;]*blob:/);
    expect(csp).not.toMatch(/script-src [^;]*'unsafe-(inline|eval)'/);
  });

  it("o download do livro vai como anexo, com nosniff e os mesmos cabeçalhos", async () => {
    const criado = bookSchema.parse((await uploadBook(app, ana, "L.epub", fakeEpub("l"))).json());
    const response = await app.inject({
      method: "GET",
      url: `/api/books/${criado.id}/file`,
      headers: { cookie: ana.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(response.headers["content-type"]).toBe("application/epub+zip");
    expectHardened(response.headers);
  });
});

describe("cadastro desligado", () => {
  let closed: FastifyInstance;

  beforeAll(async () => {
    closed = await createTestApp({ allowSignup: false });
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closed.close();
  });

  it("informa à tela de login que não há cadastro", async () => {
    const response = await closed.inject({ method: "GET", url: "/api/config" });
    expect(configResponseSchema.parse(response.json()).allowSignup).toBe(false);
  });

  it("recusa criar conta pela API, e não cria o usuário", async () => {
    const response = await closed.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json", origin: env.WEB_URL },
      payload: { name: "Intruso", email: "intruso@example.com", password: PASSWORD },
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);

    const login = await closed.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { "content-type": "application/json", origin: env.WEB_URL },
      payload: { email: "intruso@example.com", password: PASSWORD },
    });
    expect(login.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe("limites de upload e corridas", () => {
  const LIMIT = 2 * 1024;
  let small: FastifyInstance;
  let open: FastifyInstance;
  let ana: TestUser;

  beforeAll(async () => {
    small = await createTestApp({ maxUploadBytes: LIMIT });
    open = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    ana = await signUp(open, "ana@example.com");
  });

  afterAll(async () => {
    await small.close();
    await open.close();
  });

  it("recusa arquivo acima do limite com 413 e não deixa lixo no storage", async () => {
    const grande = Buffer.concat([fakeEpub("grande"), Buffer.alloc(LIMIT * 3, 0x61)]);
    const response = await uploadBook(small, ana, "grande.epub", grande);
    expect(response.statusCode).toBe(413);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe("TOO_LARGE");
    // Nem o arquivo final, nem o temporário `.tmp` da escrita atômica.
    expect(await storedFiles(ana.id)).toEqual([]);
  });

  it("aceita arquivo dentro do limite", async () => {
    const response = await uploadBook(small, ana, "pequeno.epub", fakeEpub("pequeno"));
    expect(response.statusCode).toBe(201);
  });

  it("dois envios idênticos ao mesmo tempo viram um livro só, com um arquivo no storage", async () => {
    const conteudo = fakeEpub("corrida");
    const [a, b] = await Promise.all([
      uploadBook(open, ana, "Corrida.epub", conteudo),
      uploadBook(open, ana, "Corrida (1).epub", conteudo),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(bookSchema.parse(a.json()).id).toBe(bookSchema.parse(b.json()).id);
    expect(await storedFiles(ana.id)).toHaveLength(1);
  });

  it("corpo JSON grande demais responde 413 TOO_LARGE, não 400", async () => {
    const enorme = "x".repeat(1.5 * 1024 * 1024);
    const response = await open.inject({
      method: "POST",
      url: "/api/sync",
      headers: { cookie: ana.cookie, "content-type": "application/json" },
      payload: JSON.stringify({
        deviceId: "d",
        since: 0,
        readingStates: [],
        annotations: [],
        x: enorme,
      }),
    });
    expect(response.statusCode).toBe(413);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe("TOO_LARGE");
  });
});
