import {
  apiErrorSchema,
  type Book,
  bookSchema,
  listBooksResponseSchema,
  type ReadingState,
  syncResponseSchema,
} from "@leitura/shared";
import { createStorage } from "@leitura/storage";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildEpub } from "../../../e2e/fixtures/make-epub.mjs";
import { env } from "../src/env.js";
import {
  closeTestDb,
  createTestApp,
  fakeEpub,
  readingState,
  resetDatabase,
  signUp,
  type TestUser,
  uploadBook,
} from "./helpers.js";

let clock = 1_000_000;
const now = () => clock;

describe("ciclo de vida do livro: status, série e exclusão", () => {
  let app: FastifyInstance;
  let ana: TestUser;
  let beto: TestUser;
  const storage = createStorage(env);

  const upload = async (user: TestUser, filename: string, content: Buffer): Promise<Book> =>
    bookSchema.parse((await uploadBook(app, user, filename, content)).json());
  const find = async (user: TestUser, id: string): Promise<Book | undefined> =>
    listBooksResponseSchema
      .parse(
        (
          await app.inject({ method: "GET", url: "/api/books", headers: { cookie: user.cookie } })
        ).json(),
      )
      .books.find((book) => book.id === id);
  const sync = (user: TestUser, readingStates: ReadingState[]) =>
    app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { cookie: user.cookie, "content-type": "application/json" },
      payload: { deviceId: "device-a", since: 0, readingStates, annotations: [] },
    });
  const read = async (user: TestUser, book: Book, percentage: number, at: number) => {
    clock = at;
    const response = await sync(user, [
      readingState(book.id, { percentage, updatedAt: at, fileHash: book.fileHash }),
    ]);
    expect(response.statusCode, response.body).toBe(200);
    return syncResponseSchema.parse(response.json());
  };
  const setStatus = (user: TestUser, id: string, status: string) =>
    app.inject({
      method: "PATCH",
      url: `/api/books/${id}`,
      headers: { cookie: user.cookie, "content-type": "application/json" },
      payload: { status },
    });

  beforeAll(async () => {
    app = await createTestApp({ now });
  });
  beforeEach(async () => {
    clock = 1_000_000;
    await resetDatabase();
    ana = await signUp(app, "ana@example.com");
    beto = await signUp(app, "beto@example.com");
  });
  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  describe("status automático ao ler", () => {
    it("quero ler vira lendo na primeira posição e lido perto do fim", async () => {
      const livro = await upload(ana, "Livro.epub", fakeEpub("status"));
      expect(livro.status).toBe("want_to_read");

      await read(ana, livro, 0.3, 2_000_000);
      expect((await find(ana, livro.id))?.status).toBe("reading");
      await read(ana, livro, 0.97, 3_000_000);
      expect((await find(ana, livro.id))?.status).toBe("reading");
      await read(ana, livro, 0.98, 4_000_000);
      expect((await find(ana, livro.id))?.status).toBe("read");
    });

    it("começar já perto do fim vai direto para lido", async () => {
      const livro = await upload(ana, "Livro.epub", fakeEpub("direto"));
      await read(ana, livro, 0.99, 2_000_000);
      expect((await find(ana, livro.id))?.status).toBe("read");
    });

    it("nunca volta sozinho: reler do começo não tira de lido", async () => {
      const livro = await upload(ana, "Livro.epub", fakeEpub("volta"));
      await read(ana, livro, 1, 2_000_000);
      await read(ana, livro, 0.1, 3_000_000);
      expect((await find(ana, livro.id))?.status).toBe("read");
    });

    it("abandonado e lido marcados à mão não são mexidos pela leitura", async () => {
      const abandonado = await upload(ana, "A.epub", fakeEpub("abandonado"));
      await setStatus(ana, abandonado.id, "abandoned");
      await read(ana, abandonado, 0.99, 2_000_000);
      expect((await find(ana, abandonado.id))?.status).toBe("abandoned");

      const lido = await upload(ana, "B.epub", fakeEpub("lido-a-mao"));
      await setStatus(ana, lido.id, "read");
      await read(ana, lido, 0.2, 2_000_000);
      expect((await find(ana, lido.id))?.status).toBe("read");
    });

    it("uma posição que perde o conflito não muda o status", async () => {
      const livro = await upload(ana, "Livro.epub", fakeEpub("perde"));
      await read(ana, livro, 0.2, 5_000_000);
      await setStatus(ana, livro.id, "want_to_read");
      // posição mais antiga que a já gravada: perde o last-write-wins
      await read(ana, livro, 0.99, 4_000_000);
      expect((await find(ana, livro.id))?.status).toBe("want_to_read");
    });

    it("o status é de cada dono: ler o livro de um não mexe no do outro", async () => {
      const daAna = await upload(ana, "Livro.epub", fakeEpub("igual"));
      const doBeto = await upload(beto, "Livro.epub", fakeEpub("igual"));
      await read(ana, daAna, 0.5, 2_000_000);
      expect((await find(beto, doBeto.id))?.status).toBe("want_to_read");
    });
  });

  describe("série sugerida no upload", () => {
    it("usa o título e o nome do arquivo, e o usuário pode corrigir depois", async () => {
      const volume = await upload(ana, "Lord_of_Mysteries_Volume_3.epub", fakeEpub("v3"));
      expect(volume).toMatchObject({ series: "Lord of Mysteries", seriesIndex: 3 });

      const numerado = await upload(ana, "The Beginning After The End 10.epub", fakeEpub("t10"));
      expect(numerado).toMatchObject({ series: "The Beginning After The End", seriesIndex: 10 });

      const solto = await upload(ana, "Duna.epub", fakeEpub("duna"));
      expect(solto).toMatchObject({ series: null, seriesIndex: null });
    });
  });

  describe("excluir livro", () => {
    it("apaga a linha, o arquivo, a capa, o progresso e a tag que ficou sem livro", async () => {
      const livro = await upload(ana, "Com capa.epub", buildEpub({ cover: "epub3-property" }));
      expect(livro.hasCover).toBe(true);
      await app.inject({
        method: "PATCH",
        url: `/api/books/${livro.id}`,
        headers: { cookie: ana.cookie, "content-type": "application/json" },
        payload: { tags: ["so-neste"] },
      });
      await read(ana, livro, 0.4, 2_000_000);
      const keys = [`books/${ana.id}/${livro.id}.epub`, `covers/${ana.id}/${livro.id}.png`];
      for (const key of keys) expect(await storage.exists(key), key).toBe(true);

      const resposta = await app.inject({
        method: "DELETE",
        url: `/api/books/${livro.id}`,
        headers: { cookie: ana.cookie },
      });
      expect(resposta.statusCode).toBe(204);

      expect(await find(ana, livro.id)).toBeUndefined();
      for (const key of keys) expect(await storage.exists(key), key).toBe(false);
      for (const path of ["file", "cover"]) {
        const gone = await app.inject({
          method: "GET",
          url: `/api/books/${livro.id}/${path}`,
          headers: { cookie: ana.cookie },
        });
        expect(gone.statusCode, path).toBe(404);
      }
      const progress = await app.inject({
        method: "GET",
        url: `/api/progress/${livro.id}`,
        headers: { cookie: ana.cookie },
      });
      expect(progress.statusCode).toBe(404);

      // a tag foi apagada junto: criar de novo o mesmo nome em outro livro funciona do zero
      const outro = await upload(ana, "Outro.epub", fakeEpub("outro"));
      const comTag = await app.inject({
        method: "PATCH",
        url: `/api/books/${outro.id}`,
        headers: { cookie: ana.cookie, "content-type": "application/json" },
        payload: { tags: ["so-neste"] },
      });
      expect(comTag.statusCode).toBe(200);
    });

    it("uma posição enviada depois da exclusão volta rejeitada, sem travar a fila", async () => {
      const livro = await upload(ana, "Livro.epub", fakeEpub("sync-apagado"));
      await app.inject({
        method: "DELETE",
        url: `/api/books/${livro.id}`,
        headers: { cookie: ana.cookie },
      });
      const resposta = await sync(ana, [readingState(livro.id, { updatedAt: 2_000_000 })]);
      expect(resposta.statusCode).toBe(200);
      expect(syncResponseSchema.parse(resposta.json()).rejected).toEqual([
        { bookId: livro.id, code: "NOT_FOUND" },
      ]);
    });

    it("livro de outro usuário e id inexistente dão 404 e nada é apagado", async () => {
      const doBeto = await upload(beto, "Do Beto.epub", fakeEpub("beto"));
      for (const id of [doBeto.id, "0b6f0e4e-3f0e-4b7a-9d38-6a2f6f1d2c11"]) {
        const resposta = await app.inject({
          method: "DELETE",
          url: `/api/books/${id}`,
          headers: { cookie: ana.cookie },
        });
        expect(resposta.statusCode).toBe(404);
        expect(apiErrorSchema.parse(resposta.json()).error.code).toBe("NOT_FOUND");
      }
      expect(await find(beto, doBeto.id)).toBeDefined();
      expect(await storage.exists(`books/${beto.id}/${doBeto.id}.epub`)).toBe(true);
    });

    it("mandar o mesmo arquivo de novo depois de excluir cria um livro novo", async () => {
      const conteudo = fakeEpub("reenvio");
      const primeiro = await upload(ana, "Livro.epub", conteudo);
      await app.inject({
        method: "DELETE",
        url: `/api/books/${primeiro.id}`,
        headers: { cookie: ana.cookie },
      });
      const resposta = await uploadBook(app, ana, "Livro.epub", conteudo);
      expect(resposta.statusCode).toBe(201);
      expect(bookSchema.parse(resposta.json()).id).not.toBe(primeiro.id);
    });
  });
});
