import { apiErrorSchema, bookSchema, listBooksResponseSchema } from "@leitura/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeTestDb,
  createTestApp,
  fakeEpub,
  multipartBody,
  resetDatabase,
  signUp,
  type TestUser,
  uploadBook,
} from "./helpers.js";

describe("livros", () => {
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

  it("exige login em todas as rotas", async () => {
    const lista = await app.inject({ method: "GET", url: "/api/books" });
    expect(lista.statusCode).toBe(401);
    expect(apiErrorSchema.parse(lista.json()).error.code).toBe("UNAUTHENTICATED");

    const { payload, headers } = multipartBody("a.epub", fakeEpub("x"));
    const envio = await app.inject({ method: "POST", url: "/api/books", headers, payload });
    expect(envio.statusCode).toBe(401);

    const arquivo = await app.inject({
      method: "GET",
      url: "/api/books/0b6f0e4e-3f0e-4b7a-9d38-6a2f6f1d2c11/file",
    });
    expect(arquivo.statusCode).toBe(401);
  });

  it("recebe um EPUB novo, com título vindo do nome do arquivo", async () => {
    const resposta = await uploadBook(app, ana, "Lord_of_Mysteries_Volume_1.epub", fakeEpub("1"));
    expect(resposta.statusCode).toBe(201);
    const livro = bookSchema.parse(resposta.json());
    expect(livro.title).toBe("Lord of Mysteries Volume 1");
    expect(livro.sourceFormat).toBe("epub");
    expect(livro.percentage).toBeNull();
    expect(livro.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(livro.fileSize).toBe(fakeEpub("1").length);
  });

  it("lista só os livros do usuário, do mais novo para o mais antigo", async () => {
    await uploadBook(app, ana, "Primeiro.epub", fakeEpub("a"));
    await uploadBook(app, ana, "Segundo.epub", fakeEpub("b"));
    await uploadBook(app, beto, "Do_Beto.epub", fakeEpub("c"));

    const resposta = await app.inject({
      method: "GET",
      url: "/api/books",
      headers: { cookie: ana.cookie },
    });
    expect(resposta.statusCode).toBe(200);
    const { books } = listBooksResponseSchema.parse(resposta.json());
    expect(books.map((b) => b.title)).toEqual(["Segundo", "Primeiro"]);
  });

  it("não duplica o mesmo arquivo, mesmo com outro nome", async () => {
    const primeiro = await uploadBook(app, ana, "Volume_9.epub", fakeEpub("9"));
    const segundo = await uploadBook(app, ana, "Volume_9 (1).epub", fakeEpub("9"));
    expect(primeiro.statusCode).toBe(201);
    expect(segundo.statusCode).toBe(200);
    expect(bookSchema.parse(segundo.json()).id).toBe(bookSchema.parse(primeiro.json()).id);

    const lista = await app.inject({
      method: "GET",
      url: "/api/books",
      headers: { cookie: ana.cookie },
    });
    expect(listBooksResponseSchema.parse(lista.json()).books).toHaveLength(1);
  });

  it("cada usuário guarda a sua cópia do mesmo arquivo", async () => {
    const daAna = await uploadBook(app, ana, "Livro.epub", fakeEpub("igual"));
    const doBeto = await uploadBook(app, beto, "Livro.epub", fakeEpub("igual"));
    expect(daAna.statusCode).toBe(201);
    expect(doBeto.statusCode).toBe(201);
    expect(bookSchema.parse(doBeto.json()).id).not.toBe(bookSchema.parse(daAna.json()).id);
  });

  it("recusa o que não é EPUB", async () => {
    const semExtensao = await uploadBook(app, ana, "livro.pdf", fakeEpub("p"));
    expect(semExtensao.statusCode).toBe(415);
    expect(apiErrorSchema.parse(semExtensao.json()).error.code).toBe("INVALID_FILE");

    const assinaturaErrada = await uploadBook(app, ana, "falso.epub", Buffer.from("isto é texto"));
    expect(assinaturaErrada.statusCode).toBe(415);

    const vazio = await uploadBook(app, ana, "vazio.epub", Buffer.alloc(0));
    expect(vazio.statusCode).toBe(415);

    const lista = await app.inject({
      method: "GET",
      url: "/api/books",
      headers: { cookie: ana.cookie },
    });
    expect(listBooksResponseSchema.parse(lista.json()).books).toHaveLength(0);
  });

  it("pede o campo 'file'", async () => {
    const { payload, headers } = multipartBody("a.epub", fakeEpub("x"), "outro");
    const resposta = await app.inject({
      method: "POST",
      url: "/api/books",
      headers: { ...headers, cookie: ana.cookie },
      payload,
    });
    expect(resposta.statusCode).toBe(400);
    expect(apiErrorSchema.parse(resposta.json()).error.code).toBe("VALIDATION");
  });

  describe("download", () => {
    it("entrega o mesmo conteúdo ao dono, com ETag", async () => {
      const conteudo = fakeEpub("download");
      const criado = bookSchema.parse((await uploadBook(app, ana, "D.epub", conteudo)).json());

      const resposta = await app.inject({
        method: "GET",
        url: `/api/books/${criado.id}/file`,
        headers: { cookie: ana.cookie },
      });
      expect(resposta.statusCode).toBe(200);
      expect(resposta.headers["content-type"]).toBe("application/epub+zip");
      expect(resposta.headers.etag).toBe(`"${criado.fileHash}"`);
      expect(resposta.rawPayload.equals(conteudo)).toBe(true);
    });

    it("responde 304 quando o ETag não mudou", async () => {
      const criado = bookSchema.parse(
        (await uploadBook(app, ana, "D.epub", fakeEpub("etag"))).json(),
      );
      const resposta = await app.inject({
        method: "GET",
        url: `/api/books/${criado.id}/file`,
        headers: { cookie: ana.cookie, "if-none-match": `"${criado.fileHash}"` },
      });
      expect(resposta.statusCode).toBe(304);
    });

    it("responde 404 (nunca 403) para o livro de outra pessoa", async () => {
      const daAna = bookSchema.parse(
        (await uploadBook(app, ana, "Privado.epub", fakeEpub("privado"))).json(),
      );
      const resposta = await app.inject({
        method: "GET",
        url: `/api/books/${daAna.id}/file`,
        headers: { cookie: beto.cookie },
      });
      expect(resposta.statusCode).toBe(404);
      expect(apiErrorSchema.parse(resposta.json()).error.code).toBe("NOT_FOUND");
    });

    it("responde 404 para um id que não existe e 400 para um id mal formado", async () => {
      const inexistente = await app.inject({
        method: "GET",
        url: "/api/books/0b6f0e4e-3f0e-4b7a-9d38-6a2f6f1d2c11/file",
        headers: { cookie: ana.cookie },
      });
      expect(inexistente.statusCode).toBe(404);

      const malFormado = await app.inject({
        method: "GET",
        url: "/api/books/nao-e-uuid/file",
        headers: { cookie: ana.cookie },
      });
      expect(malFormado.statusCode).toBe(400);
      expect(apiErrorSchema.parse(malFormado.json()).error.code).toBe("VALIDATION");
    });
  });
});
