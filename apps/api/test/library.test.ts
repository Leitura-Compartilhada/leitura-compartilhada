import {
  apiErrorSchema,
  type Book,
  bookSchema,
  listBooksResponseSchema,
  listShelvesResponseSchema,
  type Shelf,
  shelfSchema,
} from "@leitura/shared";
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

const UNKNOWN_ID = "0b6f0e4e-3f0e-4b7a-9d38-6a2f6f1d2c11";

describe("estante: edição, estantes e tags", () => {
  let app: FastifyInstance;
  let ana: TestUser;
  let beto: TestUser;

  const call = (
    user: TestUser,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    body?: unknown,
  ) =>
    app.inject({
      method,
      url,
      headers: { cookie: user.cookie, ...(body ? { "content-type": "application/json" } : {}) },
      payload: body as object | undefined,
    });

  const upload = async (user: TestUser, name: string, seed = name): Promise<Book> =>
    bookSchema.parse((await uploadBook(app, user, `${name}.epub`, fakeEpub(seed))).json());
  const patchBook = (user: TestUser, id: string, body: unknown) =>
    call(user, "PATCH", `/api/books/${id}`, body);
  const newShelf = async (user: TestUser, name: string): Promise<Shelf> => {
    const response = await call(user, "POST", "/api/shelves", { name });
    expect(response.statusCode, response.body).toBe(201);
    return shelfSchema.parse(response.json());
  };
  const listBooks = async (user: TestUser) =>
    listBooksResponseSchema.parse((await call(user, "GET", "/api/books")).json()).books;

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

  it("exige login nas rotas novas", async () => {
    // Corpos válidos: a validação do corpo roda antes da checagem de sessão do handler.
    for (const [method, url, payload] of [
      ["PATCH", `/api/books/${UNKNOWN_ID}`, { title: "x" }],
      ["DELETE", `/api/books/${UNKNOWN_ID}`, undefined],
      ["GET", "/api/shelves", undefined],
      ["POST", "/api/shelves", { name: "x" }],
      ["PATCH", `/api/shelves/${UNKNOWN_ID}`, { name: "x" }],
      ["DELETE", `/api/shelves/${UNKNOWN_ID}`, undefined],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: payload ? { "content-type": "application/json" } : {},
        payload,
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  describe("editar livro", () => {
    it("troca título, autores, série, status, tags e estantes", async () => {
      const livro = await upload(ana, "Livro");
      expect(livro).toMatchObject({ status: "want_to_read", tags: [], shelfIds: [] });
      const estante = await newShelf(ana, "Favoritos");

      const resposta = await patchBook(ana, livro.id, {
        title: "  Novo título  ",
        authors: ["Fulana", "Beltrano"],
        series: "Minha Série",
        seriesIndex: 2.5,
        status: "abandoned",
        tags: ["  Fantasia ", "ficção   científica", "FANTASIA"],
        shelfIds: [estante.id],
      });
      expect(resposta.statusCode, resposta.body).toBe(200);
      expect(bookSchema.parse(resposta.json())).toMatchObject({
        id: livro.id,
        title: "Novo título",
        authors: ["Fulana", "Beltrano"],
        series: "Minha Série",
        seriesIndex: 2.5,
        status: "abandoned",
        tags: ["fantasia", "ficção científica"],
        shelfIds: [estante.id],
      });
      expect((await listBooks(ana))[0]).toMatchObject({
        title: "Novo título",
        tags: ["fantasia", "ficção científica"],
      });
    });

    it("o que não vem no pedido fica como está", async () => {
      const livro = await upload(ana, "Livro");
      await patchBook(ana, livro.id, { series: "S", seriesIndex: 1, tags: ["a"] });
      const resposta = await patchBook(ana, livro.id, { status: "read" });
      expect(bookSchema.parse(resposta.json())).toMatchObject({
        title: livro.title,
        series: "S",
        seriesIndex: 1,
        tags: ["a"],
        status: "read",
      });
    });

    it("um volume sem série é ignorado", async () => {
      const livro = await upload(ana, "Livro");
      const resposta = bookSchema.parse(
        (await patchBook(ana, livro.id, { seriesIndex: 3 })).json(),
      );
      expect(resposta).toMatchObject({ series: null, seriesIndex: null });
    });

    it("devolve as tags em ordem alfabética de português, não da collation do banco", async () => {
      const livro = await upload(ana, "Livro");
      const resposta = bookSchema.parse(
        (await patchBook(ana, livro.id, { tags: ["zebra", "ábaco", "casa"] })).json(),
      );
      expect(resposta.tags).toEqual(["ábaco", "casa", "zebra"]);
      expect((await listBooks(ana))[0]?.tags).toEqual(["ábaco", "casa", "zebra"]);
    });

    it("pedidos simultâneos do mesmo usuário não dão 500 nem perdem tags", async () => {
      const a = await upload(ana, "Livro A", "a");
      const b = await upload(ana, "Livro B", "b");
      await patchBook(ana, b.id, { tags: ["x"] });
      // A liga a tag "x" enquanto B a solta (e ela ficaria "órfã"), repetidas vezes ao mesmo tempo.
      const respostas = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          i % 2 === 0
            ? patchBook(ana, a.id, { tags: ["x", `t${i}`] })
            : patchBook(ana, b.id, { tags: i % 4 === 1 ? [] : ["x"] }),
        ),
      );
      expect(respostas.map((r) => r.statusCode)).toEqual(Array(12).fill(200));
      const [livroA] = (await listBooks(ana)).filter((l) => l.id === a.id);
      expect(livroA?.tags).toContain("x");
    });

    it("editar e excluir o mesmo livro ao mesmo tempo dá 200 ou 404, nunca 500", async () => {
      for (let round = 0; round < 5; round++) {
        const livro = await upload(ana, `Livro ${round}`, `corrida-${round}`);
        const estante = await newShelf(ana, `Estante ${round}`);
        const [edicao, exclusao] = await Promise.all([
          patchBook(ana, livro.id, { tags: [`t${round}`], shelfIds: [estante.id] }),
          call(ana, "DELETE", `/api/books/${livro.id}`),
        ]);
        expect([200, 404]).toContain(edicao.statusCode);
        expect([204, 404]).toContain(exclusao.statusCode);
      }
    });

    it("limpar a série limpa o volume, a menos que venha um novo", async () => {
      const livro = await upload(ana, "Livro");
      await patchBook(ana, livro.id, { series: "S", seriesIndex: 4 });
      const limpo = bookSchema.parse((await patchBook(ana, livro.id, { series: null })).json());
      expect(limpo).toMatchObject({ series: null, seriesIndex: null });
    });

    it("recusa pedido vazio, campo desconhecido e valores fora dos limites", async () => {
      const livro = await upload(ana, "Livro");
      for (const body of [
        {},
        { dono: "outro" },
        { title: "  " },
        { title: "x".repeat(301) },
        { status: "lido" },
        { tags: Array(21).fill("t") },
        { seriesIndex: -1 },
        { shelfIds: ["nao-e-uuid"] },
      ]) {
        const resposta = await patchBook(ana, livro.id, body);
        expect(resposta.statusCode, JSON.stringify(body)).toBe(400);
        expect(apiErrorSchema.parse(resposta.json()).error.code).toBe("VALIDATION");
      }
    });

    it("livro de outro usuário e id inexistente dão 404", async () => {
      const doBeto = await upload(beto, "Do Beto");
      for (const id of [doBeto.id, UNKNOWN_ID]) {
        const resposta = await patchBook(ana, id, { title: "invadido" });
        expect(resposta.statusCode).toBe(404);
        expect(apiErrorSchema.parse(resposta.json()).error.code).toBe("NOT_FOUND");
      }
      expect((await listBooks(beto))[0]?.title).toBe("Do Beto");
    });

    it("recusa estante de outro usuário ou inexistente, com a mesma resposta, sem alterar nada", async () => {
      const livro = await upload(ana, "Livro");
      const doBeto = await newShelf(beto, "Do Beto");
      const respostas = [];
      for (const shelfIds of [[doBeto.id], [UNKNOWN_ID]]) {
        const resposta = await patchBook(ana, livro.id, { title: "mudou?", tags: ["x"], shelfIds });
        expect(resposta.statusCode).toBe(400);
        respostas.push(resposta.json());
      }
      expect(respostas[0]).toEqual(respostas[1]);
      // a transação inteira foi desfeita: nem o título nem as tags mudaram
      expect((await listBooks(ana))[0]).toMatchObject({ title: "Livro", tags: [], shelfIds: [] });
    });

    it("tags de cada usuário são separadas e a tag sem livro some", async () => {
      const a = await upload(ana, "Livro A");
      const b = await upload(beto, "Livro B", "outro");
      await patchBook(ana, a.id, { tags: ["Comum", "so-da-ana"] });
      await patchBook(beto, b.id, { tags: ["comum"] });
      expect((await listBooks(ana))[0]?.tags).toEqual(["comum", "so-da-ana"]);
      expect((await listBooks(beto))[0]?.tags).toEqual(["comum"]);

      await patchBook(ana, a.id, { tags: ["comum"] });
      await patchBook(ana, a.id, { tags: [] });
      // a tag "comum" do Beto continua existindo
      expect((await listBooks(beto))[0]?.tags).toEqual(["comum"]);
      expect((await listBooks(ana))[0]?.tags).toEqual([]);
    });
  });

  describe("estantes", () => {
    it("cria, lista com a contagem, renomeia, reordena e apaga sem apagar livros", async () => {
      const livro = await upload(ana, "Livro");
      const um = await newShelf(ana, "  Fantasia ");
      const dois = await newShelf(ana, "Clássicos");
      expect(um).toMatchObject({ name: "Fantasia", position: 0, bookCount: 0 });
      expect(dois.position).toBe(1);

      await patchBook(ana, livro.id, { shelfIds: [um.id, dois.id] });
      const lista = listShelvesResponseSchema.parse(
        (await call(ana, "GET", "/api/shelves")).json(),
      );
      expect(lista.shelves.map((s) => [s.name, s.bookCount])).toEqual([
        ["Fantasia", 1],
        ["Clássicos", 1],
      ]);

      const renomeada = await call(ana, "PATCH", `/api/shelves/${dois.id}`, {
        name: "Cânone",
        position: 0,
      });
      expect(shelfSchema.parse(renomeada.json())).toMatchObject({
        name: "Cânone",
        position: 0,
        bookCount: 1,
      });
      const ordem = listShelvesResponseSchema.parse(
        (await call(ana, "GET", "/api/shelves")).json(),
      );
      expect(ordem.shelves[0]?.name).toBe("Cânone");

      expect((await call(ana, "DELETE", `/api/shelves/${um.id}`)).statusCode).toBe(204);
      const depois = (await listBooks(ana))[0];
      expect(depois?.shelfIds).toEqual([dois.id]);
    });

    it("nome repetido dá 409, também ao renomear", async () => {
      const a = await newShelf(ana, "Mesma");
      const b = await newShelf(ana, "Outra");
      const criar = await call(ana, "POST", "/api/shelves", { name: "Mesma" });
      expect(criar.statusCode).toBe(409);
      expect(apiErrorSchema.parse(criar.json()).error.code).toBe("CONFLICT");
      expect((await call(ana, "PATCH", `/api/shelves/${b.id}`, { name: "Mesma" })).statusCode).toBe(
        409,
      );
      // renomear para o próprio nome é permitido, e outro usuário pode usar o mesmo nome
      expect((await call(ana, "PATCH", `/api/shelves/${a.id}`, { name: "Mesma" })).statusCode).toBe(
        200,
      );
      expect((await call(beto, "POST", "/api/shelves", { name: "Mesma" })).statusCode).toBe(201);
    });

    it("estante de outro usuário dá 404 e não aparece na lista", async () => {
      const doBeto = await newShelf(beto, "Do Beto");
      expect(
        (await call(ana, "PATCH", `/api/shelves/${doBeto.id}`, { name: "x" })).statusCode,
      ).toBe(404);
      expect((await call(ana, "DELETE", `/api/shelves/${doBeto.id}`)).statusCode).toBe(404);
      const lista = listShelvesResponseSchema.parse(
        (await call(ana, "GET", "/api/shelves")).json(),
      );
      expect(lista.shelves).toEqual([]);
      expect((await call(beto, "GET", "/api/shelves")).json().shelves).toHaveLength(1);
    });

    it("dois renomeios para o mesmo nome ao mesmo tempo não dão 500", async () => {
      const a = await newShelf(ana, "A");
      const b = await newShelf(ana, "B");
      const respostas = await Promise.all([
        call(ana, "PATCH", `/api/shelves/${a.id}`, { name: "Igual" }),
        call(ana, "PATCH", `/api/shelves/${b.id}`, { name: "Igual" }),
      ]);
      const codigos = respostas.map((r) => r.statusCode).sort();
      expect(codigos).toEqual([200, 409]);
    });

    it("valida o corpo", async () => {
      for (const body of [{}, { name: "  " }, { name: "x".repeat(61) }, { name: "ok", extra: 1 }]) {
        expect(
          (await call(ana, "POST", "/api/shelves", body)).statusCode,
          JSON.stringify(body),
        ).toBe(400);
      }
      const estante = await newShelf(ana, "Ok");
      expect((await call(ana, "PATCH", `/api/shelves/${estante.id}`, {})).statusCode).toBe(400);
      expect((await call(ana, "PATCH", "/api/shelves/nao-e-uuid", { name: "x" })).statusCode).toBe(
        400,
      );
    });
  });
});
