import { randomUUID } from "node:crypto";
import {
  apiErrorSchema,
  bookSchema,
  MAX_FUTURE_SKEW_MS,
  type ReadingState,
  type SyncRequest,
  type SyncResponse,
  syncResponseSchema,
} from "@leitura/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

// Relógio do servidor controlado pelo teste. Pode voltar no tempo.
let clock = 1_000_000;
const now = () => clock;

describe("sync de progresso", () => {
  let app: FastifyInstance;
  let ana: TestUser;
  let beto: TestUser;
  let livro: string;

  async function sync(
    user: TestUser,
    parts: Partial<SyncRequest> & { readingStates?: ReadingState[] },
  ): Promise<{ status: number; body: SyncResponse }> {
    const request: SyncRequest = {
      deviceId: "device-a",
      since: 0,
      readingStates: [],
      annotations: [],
      ...parts,
    };
    const response = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { cookie: user.cookie, "content-type": "application/json" },
      payload: request,
    });
    return { status: response.statusCode, body: response.json() as SyncResponse };
  }

  beforeAll(async () => {
    app = await createTestApp({ now });
  });

  beforeEach(async () => {
    clock = 1_000_000;
    await resetDatabase();
    ana = await signUp(app, "ana@example.com");
    beto = await signUp(app, "beto@example.com");
    livro = bookSchema.parse((await uploadBook(app, ana, "A.epub", fakeEpub("a"))).json()).id;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("exige login e valida o corpo", async () => {
    const semLogin = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { "content-type": "application/json" },
      payload: { deviceId: "d", since: 0, readingStates: [], annotations: [] },
    });
    expect(semLogin.statusCode).toBe(401);

    const invalido = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { cookie: ana.cookie, "content-type": "application/json" },
      payload: { deviceId: "tem espaço", since: -1 },
    });
    expect(invalido.statusCode).toBe(400);
    expect(apiErrorSchema.parse(invalido.json()).error.code).toBe("VALIDATION");
  });

  it("grava o progresso e devolve cursor, serverTime e o próprio estado", async () => {
    const { status, body } = await sync(ana, { readingStates: [readingState(livro)] });
    expect(status).toBe(200);
    syncResponseSchema.parse(body);
    expect(body.serverTime).toBe(clock);
    expect(body.cursor).toBe(clock);
    expect(body.rejected).toEqual([]);
    expect(body.readingStates).toHaveLength(1);
    expect(body.readingStates[0]?.cfi).toBe("epubcfi(/6/4!/4/2/1:0)");
  });

  it("entrega a outro aparelho só o que passou do cursor dele", async () => {
    clock = 2_000_000;
    const primeiro = await sync(ana, {
      deviceId: "pc",
      readingStates: [readingState(livro, { updatedAt: 1_999_000 })],
    });

    const celular = await sync(ana, { deviceId: "celular", since: 0 });
    expect(celular.body.readingStates.map((s) => s.deviceId)).toEqual(["pc"]);

    const denovo = await sync(ana, { deviceId: "celular", since: celular.body.cursor });
    expect(denovo.body.readingStates).toEqual([]);
    expect(denovo.body.cursor).toBe(primeiro.body.cursor);
  });

  describe("conflitos (last-write-wins)", () => {
    it("ignora uma gravação mais antiga e devolve o estado vencedor", async () => {
      const primeiro = await sync(ana, {
        deviceId: "pc",
        readingStates: [readingState(livro, { updatedAt: 5_000, percentage: 0.5 })],
      });
      // Com o cursor já em dia, a única forma de o estado do PC voltar é a regra do perdedor.
      const { body } = await sync(ana, {
        deviceId: "celular",
        since: primeiro.body.cursor,
        readingStates: [readingState(livro, { updatedAt: 4_000, percentage: 0.1 })],
      });
      expect(body.readingStates).toHaveLength(1);
      expect(body.readingStates[0]).toMatchObject({ percentage: 0.5, deviceId: "pc" });
    });

    it("aplica uma gravação mais nova", async () => {
      await sync(ana, {
        readingStates: [readingState(livro, { updatedAt: 5_000, percentage: 0.5 })],
      });
      const { body } = await sync(ana, {
        deviceId: "celular",
        readingStates: [readingState(livro, { updatedAt: 6_000, percentage: 0.7 })],
      });
      expect(body.readingStates[0]).toMatchObject({ percentage: 0.7, deviceId: "celular" });
    });

    it("em empate de horário vence o maior deviceId, qualquer que seja a ordem de chegada", async () => {
      const gravar = async (primeiro: string, segundo: string) => {
        await resetDatabase();
        const dono = await signUp(app, "dono@example.com");
        const id = bookSchema.parse(
          (await uploadBook(app, dono, "T.epub", fakeEpub(`t-${primeiro}`))).json(),
        ).id;
        await sync(dono, {
          deviceId: primeiro,
          readingStates: [readingState(id, { updatedAt: 7_000 })],
        });
        const { body } = await sync(dono, {
          deviceId: segundo,
          readingStates: [readingState(id, { updatedAt: 7_000 })],
        });
        return body.readingStates[0]?.deviceId;
      };
      expect(await gravar("device-a", "device-b")).toBe("device-b");
      expect(await gravar("device-b", "device-a")).toBe("device-b");
    });

    it("usa o deviceId do pedido e ignora o do item", async () => {
      const { body } = await sync(ana, {
        deviceId: "celular",
        readingStates: [readingState(livro, { deviceId: "outro-aparelho" })],
      });
      expect(body.readingStates[0]?.deviceId).toBe("celular");
    });

    it("rebaixa um horário muito à frente do relógio do servidor", async () => {
      const adiantado = clock + 60 * 60 * 1000; // celular uma hora à frente
      const { body } = await sync(ana, {
        readingStates: [readingState(livro, { updatedAt: adiantado })],
      });
      expect(body.readingStates[0]?.updatedAt).toBe(clock);
    });

    it("aceita um horário dentro da tolerância à frente", async () => {
      const quaseLa = clock + MAX_FUTURE_SKEW_MS;
      const { body } = await sync(ana, {
        readingStates: [readingState(livro, { updatedAt: quaseLa })],
      });
      expect(body.readingStates[0]?.updatedAt).toBe(quaseLa);
    });

    it("junta itens repetidos do mesmo livro no pedido, ficando com o mais novo", async () => {
      const { status, body } = await sync(ana, {
        readingStates: [
          readingState(livro, { updatedAt: 3_000, percentage: 0.3 }),
          readingState(livro, { updatedAt: 9_000, percentage: 0.9 }),
          readingState(livro, { updatedAt: 6_000, percentage: 0.6 }),
        ],
      });
      expect(status).toBe(200);
      expect(body.readingStates).toHaveLength(1);
      expect(body.readingStates[0]?.percentage).toBe(0.9);
    });
  });

  describe("cursor", () => {
    it("só cresce, mesmo com o relógio do servidor voltando no tempo", async () => {
      clock = 5_000_000;
      const a = await sync(ana, {
        deviceId: "pc",
        readingStates: [readingState(livro, { updatedAt: 1 })],
      });
      clock = 4_000_000; // NTP puxou o relógio 1000 s para trás
      const b = await sync(ana, {
        deviceId: "celular",
        since: a.body.cursor,
        readingStates: [readingState(livro, { updatedAt: 2 })],
      });
      expect(b.body.cursor).toBeGreaterThan(a.body.cursor);
      // O aparelho que já estava no cursor `a` recebe a gravação nova, e não a perde.
      const c = await sync(ana, { deviceId: "pc", since: a.body.cursor });
      expect(c.body.readingStates.map((s) => s.deviceId)).toEqual(["celular"]);
    });

    it("não perde gravações de duas requisições simultâneas do mesmo usuário", async () => {
      const outros = await Promise.all(
        ["b", "c", "d", "e"].map(async (nome) => {
          const id = bookSchema.parse(
            (await uploadBook(app, ana, `${nome}.epub`, fakeEpub(`livro-${nome}`))).json(),
          ).id;
          return id;
        }),
      );
      // Todas ao mesmo tempo, cada uma gravando um livro, a partir do mesmo cursor.
      const respostas = await Promise.all(
        outros.map((id, i) =>
          sync(ana, {
            deviceId: `device-${i}`,
            since: 0,
            readingStates: [readingState(id, { updatedAt: 10_000 + i })],
          }),
        ),
      );
      expect(respostas.every((r) => r.status === 200)).toBe(true);
      const cursores = respostas.map((r) => r.body.cursor);
      expect(new Set(cursores).size).toBe(cursores.length); // todos distintos: houve ordem

      // Um aparelho novo, vindo do zero, vê os quatro.
      const novo = await sync(ana, { deviceId: "novo", since: 0 });
      expect(novo.body.readingStates).toHaveLength(4);
    });

    it("trata um cursor à frente do servidor como pedido de sincronização completa", async () => {
      await sync(ana, { readingStates: [readingState(livro)] });
      const { body } = await sync(ana, { deviceId: "restaurado", since: 9_999_999_999_999 });
      expect(body.readingStates).toHaveLength(1);
    });
  });

  describe("propriedade", () => {
    it("recusa só o item do livro alheio ou inexistente, sem derrubar o pedido", async () => {
      const doBeto = bookSchema.parse(
        (await uploadBook(app, beto, "B.epub", fakeEpub("beto"))).json(),
      ).id;
      const fantasma = randomUUID();
      const { status, body } = await sync(ana, {
        readingStates: [readingState(livro), readingState(doBeto), readingState(fantasma)],
      });
      expect(status).toBe(200);
      expect(body.readingStates.map((s) => s.bookId)).toEqual([livro]);
      expect(body.rejected).toEqual(
        expect.arrayContaining([
          { bookId: doBeto, code: "NOT_FOUND" },
          { bookId: fantasma, code: "NOT_FOUND" },
        ]),
      );
      expect(body.rejected).toHaveLength(2);

      // O Beto não ficou com o progresso da Ana, nem o contrário.
      const doBetoDepois = await sync(beto, { since: 0 });
      expect(doBetoDepois.body.readingStates).toEqual([]);
    });

    it("cada usuário só vê o próprio progresso", async () => {
      await sync(ana, { readingStates: [readingState(livro)] });
      const { body } = await sync(beto, { since: 0 });
      expect(body.readingStates).toEqual([]);
    });
  });

  it("recusa anotações enquanto elas não forem suportadas", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { cookie: ana.cookie, "content-type": "application/json" },
      payload: {
        deviceId: "device-a",
        since: 0,
        readingStates: [],
        annotations: [
          {
            id: randomUUID(),
            bookId: livro,
            type: "highlight",
            cfiRange: "epubcfi(/6/4!/4,/2/1:0,/2/1:5)",
            text: "trecho",
            note: null,
            color: null,
            updatedAt: 1,
            deletedAt: null,
          },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json()).error.code).toBe("VALIDATION");
  });
});
