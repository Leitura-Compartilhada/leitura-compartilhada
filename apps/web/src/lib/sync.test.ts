import "fake-indexeddb/auto";
import type { ReadingState, SyncRequest, SyncResponse } from "@leitura/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalDb, type LocalDb, readLocalState } from "./db";
import { KEEPALIVE_MAX_ITEMS, SyncEngine } from "./sync";

const HASH = "d".repeat(64);
const BOOK_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOOK_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type PostFn = (request: SyncRequest, keepalive: boolean) => Promise<SyncResponse>;

function position(cfi: string, percentage = 0.1) {
  return { cfi, percentage, textSnippet: null, fileHash: HASH, status: "reading" as const };
}

function response(overrides: Partial<SyncResponse> = {}): SyncResponse {
  return {
    cursor: 10,
    serverTime: 1_000_000,
    readingStates: [],
    rejected: [],
    annotations: [],
    ...overrides,
  };
}

function remoteState(overrides: Partial<ReadingState> = {}): ReadingState {
  return {
    bookId: BOOK_A,
    cfi: "epubcfi(/6/2)",
    percentage: 0.5,
    textSnippet: null,
    fileHash: HASH,
    status: "reading",
    deviceId: "outro-aparelho",
    updatedAt: 5_000_000,
    ...overrides,
  };
}

let db: LocalDb;
let clock: number;
let dbCounter = 0;

function makeEngine(post: PostFn) {
  return new SyncEngine({ db, post, now: () => clock, deviceId: "este-aparelho" });
}

beforeEach(() => {
  db = createLocalDb(`teste-${dbCounter++}`);
  clock = 1_000_000;
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe("envio com keepalive (pagehide)", () => {
  it("manda um lote pequeno, que cabe nos 64 KiB do navegador, e deixa o resto na outbox", async () => {
    const post = vi.fn(async (_request: SyncRequest, _keepalive: boolean) => response());
    const engine = makeEngine(post);
    for (let i = 0; i < KEEPALIVE_MAX_ITEMS + 10; i++) {
      const id = `${i.toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
      await engine.recordProgress(id, position(`epubcfi(/6/${i + 2})`));
    }

    await engine.flush({ keepalive: true });

    expect(post.mock.calls[0]?.[0].readingStates).toHaveLength(KEEPALIVE_MAX_ITEMS);
    expect(post.mock.calls[0]?.[1]).toBe(true);
    expect(await engine.pendingCount()).toBe(10);
  });
});

describe("recordProgress", () => {
  it("grava o estado e põe um item na outbox", async () => {
    const engine = makeEngine(async () => response());
    const state = await engine.recordProgress(BOOK_A, position("epubcfi(/6/2)"));
    expect(state).toMatchObject({
      bookId: BOOK_A,
      deviceId: "este-aparelho",
      updatedAt: 1_000_000,
    });
    expect(await readLocalState(db, BOOK_A)).toEqual(state);
    expect(await db.outbox.count()).toBe(1);
  });

  it("não duplica a outbox: o último estado do livro substitui o anterior", async () => {
    const engine = makeEngine(async () => response());
    await engine.recordProgress(BOOK_A, position("epubcfi(/6/2)"));
    await engine.recordProgress(BOOK_A, position("epubcfi(/6/4)"));
    await engine.recordProgress(BOOK_A, position("epubcfi(/6/6)"));
    await engine.recordProgress(BOOK_B, position("epubcfi(/6/2)"));
    expect(await db.outbox.count()).toBe(2);
    expect((await readLocalState(db, BOOK_A))?.cfi).toBe("epubcfi(/6/6)");
  });

  it("updatedAt nunca regride quando o relógio volta", async () => {
    const engine = makeEngine(async () => response());
    const first = await engine.recordProgress(BOOK_A, position("epubcfi(/6/2)"));
    clock -= 3_600_000; // relógio atrasou uma hora
    const second = await engine.recordProgress(BOOK_A, position("epubcfi(/6/4)"));
    const third = await engine.recordProgress(BOOK_A, position("epubcfi(/6/6)"));
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(third.updatedAt).toBeGreaterThan(second.updatedAt);
  });

  it("supera o estado já visto do mesmo livro, mesmo com o relógio local atrasado", async () => {
    const engine = makeEngine(vi.fn());
    // Outro aparelho gravou num horário à frente do que este relógio acredita ser agora.
    await engine.adoptRemoteState(remoteState({ bookId: BOOK_A, updatedAt: 9_000_000 }));
    clock = 1_000_000;

    const mine = await engine.recordProgress(BOOK_A, position("epubcfi(/6/10)"));

    expect(mine.updatedAt).toBe(9_000_001);
  });

  it("o estado visto de um livro não afeta o horário de outro livro", async () => {
    const engine = makeEngine(vi.fn());
    await engine.adoptRemoteState(remoteState({ bookId: BOOK_A, updatedAt: 9_000_000 }));
    clock = 1_000_000;

    const other = await engine.recordProgress(BOOK_B, position("epubcfi(/6/10)"));

    expect(other.updatedAt).toBe(1_000_000);
  });

  it("sobrevive a uma nova instância (lastStamp fica no Dexie)", async () => {
    const first = await makeEngine(async () => response()).recordProgress(
      BOOK_A,
      position("epubcfi(/6/2)"),
    );
    clock -= 10_000;
    const second = await makeEngine(async () => response()).recordProgress(
      BOOK_A,
      position("epubcfi(/6/4)"),
    );
    expect(second.updatedAt).toBe(first.updatedAt + 1);
  });

  it("aplica o desvio de relógio guardado", async () => {
    await db.meta.put({ key: "clockOffset", value: 2_500 });
    const state = await makeEngine(async () => response()).recordProgress(
      BOOK_A,
      position("epubcfi(/6/2)"),
    );
    expect(state.updatedAt).toBe(1_002_500);
  });
});

describe("flush", () => {
  it("envia a outbox, remove o que foi enviado e guarda o cursor", async () => {
    const post = vi.fn<PostFn>(async () => response({ cursor: 42 }));
    const engine = makeEngine(post);
    await engine.recordProgress(BOOK_A, position("epubcfi(/6/2)"));

    const result = await engine.flush();

    expect(result.sent).toBe(1);
    const [request, keepalive] = post.mock.calls[0] ?? [];
    expect(request).toMatchObject({ deviceId: "este-aparelho", since: 0, annotations: [] });
    expect(request?.readingStates).toHaveLength(1);
    expect(keepalive).toBe(false);
    expect(await db.outbox.count()).toBe(0);
    expect((await db.meta.get("cursor"))?.value).toBe(42);
  });

  it("usa o cursor guardado como since na vez seguinte", async () => {
    const post = vi.fn<PostFn>(async () => response({ cursor: 42 }));
    const engine = makeEngine(post);
    await engine.recordProgress(BOOK_A, position("epubcfi(/6/2)"));
    await engine.flush();
    await engine.recordProgress(BOOK_A, position("epubcfi(/6/4)"));
    await engine.flush();
    expect(post.mock.calls[1]?.[0].since).toBe(42);
  });

  it("não chama a rede com a outbox vazia, a menos que peça pull", async () => {
    const post = vi.fn<PostFn>(async () => response());
    const engine = makeEngine(post);
    await engine.flush();
    expect(post).not.toHaveBeenCalled();
    await engine.flush({ pull: true });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("repassa keepalive", async () => {
    const post = vi.fn<PostFn>(async () => response());
    const engine = makeEngine(post);
    await engine.recordProgress(BOOK_A, position("epubcfi(/6/2)"));
    await engine.flush({ keepalive: true });
    expect(post.mock.calls[0]?.[1]).toBe(true);
  });

  it("só remove da outbox o que não mudou durante o envio", async () => {
    let engine: SyncEngine;
    const post = vi.fn<PostFn>(async () => {
      // enquanto a requisição está no ar, o usuário vira a página
      await engine.recordProgress(BOOK_A, position("epubcfi(/6/99)", 0.9));
      return response();
    });
    engine = makeEngine(post);
    await engine.recordProgress(BOOK_A, position("epubcfi(/6/2)"));
    await engine.recordProgress(BOOK_B, position("epubcfi(/6/2)"));

    await engine.flush();

    const remaining = await db.outbox.toArray();
    expect(remaining.map((item) => item.payloadId)).toEqual([BOOK_A]);
    expect((await readLocalState(db, BOOK_A))?.cfi).toBe("epubcfi(/6/99)");
  });

  it("falha de rede não perde nada: a outbox fica e o erro sobe", async () => {
    const engine = makeEngine(async () => {
      throw new Error("sem rede");
    });
    await engine.recordProgress(BOOK_A, position("epubcfi(/6/2)"));
    await expect(engine.flush()).rejects.toThrow("sem rede");
    expect(await db.outbox.count()).toBe(1);
    expect((await db.meta.get("cursor"))?.value).toBeUndefined();
  });

  it("depois de uma falha, a próxima tentativa funciona", async () => {
    const post = vi
      .fn<PostFn>()
      .mockRejectedValueOnce(new Error("sem rede"))
      .mockResolvedValue(response());
    const engine = makeEngine(post);
    await engine.recordProgress(BOOK_A, position("epubcfi(/6/2)"));
    await expect(engine.flush()).rejects.toThrow();
    await expect(engine.flush()).resolves.toMatchObject({ sent: 1 });
    expect(await db.outbox.count()).toBe(0);
  });

  it("itens rejeitados saem da outbox (senão seriam reenviados para sempre)", async () => {
    const post = vi.fn<PostFn>(async () =>
      response({ rejected: [{ bookId: BOOK_A, code: "NOT_FOUND" }] }),
    );
    const engine = makeEngine(post);
    await engine.recordProgress(BOOK_A, position("epubcfi(/6/2)"));
    await engine.recordProgress(BOOK_B, position("epubcfi(/6/2)"));
    await engine.flush();
    expect(await db.outbox.count()).toBe(0);
  });

  it("aplica estados do servidor com last-write-wins", async () => {
    const newer = remoteState({ bookId: BOOK_A, updatedAt: 9_000_000, cfi: "epubcfi(/6/8)" });
    const older = remoteState({ bookId: BOOK_B, updatedAt: 1, cfi: "epubcfi(/6/8)" });
    const post = vi.fn<PostFn>(async () => response({ readingStates: [newer, older] }));
    const engine = makeEngine(post);
    await engine.recordProgress(BOOK_A, position("epubcfi(/6/2)"));
    await engine.recordProgress(BOOK_B, position("epubcfi(/6/2)"));

    await engine.flush();

    expect((await readLocalState(db, BOOK_A))?.cfi).toBe("epubcfi(/6/8)"); // o servidor era mais novo
    expect((await readLocalState(db, BOOK_B))?.cfi).toBe("epubcfi(/6/2)"); // o local era mais novo
  });

  it("estado do servidor que ganhou o conflito não deixa a outbox reenviando", async () => {
    const winner = remoteState({ bookId: BOOK_A, updatedAt: 9_000_000 });
    const post = vi.fn<PostFn>(async () => response({ readingStates: [winner] }));
    const engine = makeEngine(post);
    await engine.recordProgress(BOOK_A, position("epubcfi(/6/2)"));
    await engine.flush();
    expect(await db.outbox.count()).toBe(0);
  });

  it("estados de livros que nunca foram abertos aqui entram no Dexie", async () => {
    const post = vi.fn<PostFn>(async () =>
      response({ readingStates: [remoteState({ bookId: BOOK_B })] }),
    );
    await makeEngine(post).flush({ pull: true });
    expect((await readLocalState(db, BOOK_B))?.deviceId).toBe("outro-aparelho");
    expect(await db.outbox.count()).toBe(0);
  });

  it("estima o desvio do relógio com serverTime e ignora medida ruim", async () => {
    const times = [1_000_000, 1_000_200];
    const engine = new SyncEngine({
      db,
      post: async () => response({ serverTime: 1_005_100 }),
      now: () => times.shift() ?? 1_000_200,
      deviceId: "este-aparelho",
    });
    await engine.flush({ pull: true });
    // (1_000_000 + 1_000_200) / 2 = 1_000_100; 1_005_100 - 1_000_100 = 5_000
    expect((await db.meta.get("clockOffset"))?.value).toBe(5_000);

    const slow = [1_000_000, 1_090_000];
    const slowEngine = new SyncEngine({
      db,
      post: async () => response({ serverTime: 2_000_000 }),
      now: () => slow.shift() ?? 1_090_000,
      deviceId: "este-aparelho",
    });
    await slowEngine.flush({ pull: true });
    expect((await db.meta.get("clockOffset"))?.value).toBe(5_000); // não mudou
  });

  it("serializa: nunca há dois envios simultâneos e pedidos repetidos se juntam", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const post = vi.fn<PostFn>(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight--;
      return response();
    });
    const engine = makeEngine(post);
    await engine.recordProgress(BOOK_A, position("epubcfi(/6/2)"));

    await Promise.all([engine.flush(), engine.flush(), engine.flush(), engine.flush()]);

    expect(maxInFlight).toBe(1);
    expect(post.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe("adoptRemoteState", () => {
  it("adota o remoto mais novo sem tocar na outbox", async () => {
    const engine = makeEngine(async () => response());
    const adopted = await engine.adoptRemoteState(remoteState({ updatedAt: 7_000_000 }));
    expect(adopted.updatedAt).toBe(7_000_000);
    expect(await db.outbox.count()).toBe(0);
  });

  it("mantém o local quando ele é mais novo", async () => {
    const engine = makeEngine(async () => response());
    const local = await engine.recordProgress(BOOK_A, position("epubcfi(/6/2)"));
    const kept = await engine.adoptRemoteState(remoteState({ updatedAt: 1 }));
    expect(kept).toEqual(local);
  });
});
