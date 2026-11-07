import { apiErrorSchema, bookSchema, progressResponseSchema } from "@leitura/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeTestDb,
  createTestApp,
  fakeEpub,
  resetDatabase,
  signUp,
  type TestUser,
  uploadBook,
} from "./helpers.js";

describe("progresso de um livro", () => {
  let app: FastifyInstance;
  let ana: TestUser;
  let beto: TestUser;
  let livroDaAna: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    ana = await signUp(app, "ana@example.com");
    beto = await signUp(app, "beto@example.com");
    livroDaAna = bookSchema.parse((await uploadBook(app, ana, "A.epub", fakeEpub("a"))).json()).id;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("exige login", async () => {
    const resposta = await app.inject({ method: "GET", url: `/api/progress/${livroDaAna}` });
    expect(resposta.statusCode).toBe(401);
  });

  it("devolve null quando o usuário nunca abriu o livro", async () => {
    const resposta = await app.inject({
      method: "GET",
      url: `/api/progress/${livroDaAna}`,
      headers: { cookie: ana.cookie },
    });
    expect(resposta.statusCode).toBe(200);
    expect(progressResponseSchema.parse(resposta.json()).readingState).toBeNull();
  });

  it("responde 404 para o livro de outra pessoa", async () => {
    const resposta = await app.inject({
      method: "GET",
      url: `/api/progress/${livroDaAna}`,
      headers: { cookie: beto.cookie },
    });
    expect(resposta.statusCode).toBe(404);
    expect(apiErrorSchema.parse(resposta.json()).error.code).toBe("NOT_FOUND");
  });
});
