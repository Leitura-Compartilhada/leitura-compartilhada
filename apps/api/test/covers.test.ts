import { apiErrorSchema, bookSchema, listBooksResponseSchema } from "@leitura/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildEpub } from "../../../e2e/fixtures/make-epub.mjs";
import {
  closeTestDb,
  createTestApp,
  fakeEpub,
  resetDatabase,
  signUp,
  type TestUser,
  uploadBook,
} from "./helpers.js";

describe("capas e metadados do EPUB", () => {
  let app: FastifyInstance;
  let ana: TestUser;
  let beto: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    ana = await signUp(app, "ana@example.com");
    beto = await signUp(app, "beto@example.com");
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const getCover = (user: TestUser, id: string, headers: Record<string, string> = {}) =>
    app.inject({
      method: "GET",
      url: `/api/books/${id}/cover`,
      headers: { cookie: user.cookie, ...headers },
    });

  it("preenche título, autor, idioma e capa a partir do EPUB", async () => {
    const epub = buildEpub({
      cover: "epub3-property",
      title: "O Livro Verdadeiro",
      creator: "Maria",
      language: "pt-BR",
    });
    const resposta = await uploadBook(app, ana, "arquivo_qualquer.epub", epub);
    expect(resposta.statusCode).toBe(201);
    const livro = bookSchema.parse(resposta.json());
    expect(livro).toMatchObject({
      title: "O Livro Verdadeiro",
      authors: ["Maria"],
      hasCover: true,
    });

    const capa = await getCover(ana, livro.id);
    expect(capa.statusCode).toBe(200);
    expect(capa.headers["content-type"]).toBe("image/png");
    expect(capa.headers["cache-control"]).toBe("private, no-cache");
    expect(capa.headers["x-content-type-options"]).toBe("nosniff");
    expect(capa.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(capa.rawPayload.subarray(1, 4).toString()).toBe("PNG");
  });

  it("serve pelo tipo real dos bytes: WebP declarada como JPEG sai como image/webp", async () => {
    const livro = bookSchema.parse(
      (await uploadBook(app, ana, "lom.epub", buildEpub({ cover: "by-name-webp-lie" }))).json(),
    );
    const capa = await getCover(ana, livro.id);
    expect(capa.statusCode).toBe(200);
    expect(capa.headers["content-type"]).toBe("image/webp");
  });

  it("responde 304 quando o ETag não mudou", async () => {
    const livro = bookSchema.parse(
      (await uploadBook(app, ana, "a.epub", buildEpub({ cover: "epub2-meta" }))).json(),
    );
    const primeira = await getCover(ana, livro.id);
    const etag = String(primeira.headers.etag);
    expect((await getCover(ana, livro.id, { "if-none-match": etag })).statusCode).toBe(304);
  });

  it("EPUB sem capa: hasCover falso, 404 na rota e título do arquivo quando o OPF não ajuda", async () => {
    const livro = bookSchema.parse(
      (await uploadBook(app, ana, "Sem_Capa.epub", buildEpub({ title: "  " }))).json(),
    );
    expect(livro.hasCover).toBe(false);
    expect(livro.title).toBe("Sem Capa");
    const capa = await getCover(ana, livro.id);
    expect(capa.statusCode).toBe(404);
    expect(apiErrorSchema.parse(capa.json()).error.code).toBe("NOT_FOUND");
  });

  it("recusa SVG como capa, mas aceita o livro", async () => {
    const resposta = await uploadBook(app, ana, "svg.epub", buildEpub({ cover: "svg" }));
    expect(resposta.statusCode).toBe(201);
    expect(bookSchema.parse(resposta.json()).hasCover).toBe(false);
  });

  it("arquivo que só parece ZIP continua entrando, sem metadados", async () => {
    const resposta = await uploadBook(app, ana, "Quase.epub", fakeEpub("quase"));
    expect(resposta.statusCode).toBe(201);
    const livro = bookSchema.parse(resposta.json());
    expect(livro).toMatchObject({ title: "Quase", authors: [], hasCover: false });
  });

  it("devolve 404 (nunca 403) para a capa de outra pessoa e exige login", async () => {
    const daAna = bookSchema.parse(
      (await uploadBook(app, ana, "a.epub", buildEpub({ cover: "epub3-property" }))).json(),
    );
    expect((await getCover(beto, daAna.id)).statusCode).toBe(404);
    const anonimo = await app.inject({ method: "GET", url: `/api/books/${daAna.id}/cover` });
    expect(anonimo.statusCode).toBe(401);
  });

  it("cada usuário tem a própria cópia da capa", async () => {
    const epub = buildEpub({ cover: "epub3-property" });
    const daAna = bookSchema.parse((await uploadBook(app, ana, "a.epub", epub)).json());
    const doBeto = bookSchema.parse((await uploadBook(app, beto, "a.epub", epub)).json());
    expect((await getCover(beto, doBeto.id)).statusCode).toBe(200);
    expect((await getCover(ana, daAna.id)).statusCode).toBe(200);
  });

  it("a lista traz hasCover", async () => {
    await uploadBook(app, ana, "a.epub", buildEpub({ cover: "guide" }));
    await uploadBook(app, ana, "b.epub", buildEpub({ title: "Outro" }));
    const lista = listBooksResponseSchema.parse(
      (
        await app.inject({ method: "GET", url: "/api/books", headers: { cookie: ana.cookie } })
      ).json(),
    );
    expect(lista.books.map((b) => b.hasCover).sort()).toEqual([false, true]);
  });
});
