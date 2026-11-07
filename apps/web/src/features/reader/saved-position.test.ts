import "fake-indexeddb/auto";
import type { ReadingState } from "@leitura/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api";
import { createLocalDb, type LocalDb, readLocalState } from "@/lib/db";
import { SyncEngine } from "@/lib/sync";
import { loadSavedState, type SavedPositionDeps } from "./saved-position";

const HASH = "e".repeat(64);
const BOOK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function state(updatedAt: number, cfi: string): ReadingState {
  return {
    bookId: BOOK,
    cfi,
    percentage: 0.3,
    textSnippet: null,
    fileHash: HASH,
    status: "reading",
    deviceId: "aparelho",
    updatedAt,
  };
}

let db: LocalDb;
let counter = 0;

function deps(overrides: Partial<SavedPositionDeps> = {}): SavedPositionDeps {
  const engine = new SyncEngine({
    db,
    post: async () => {
      throw new Error("não deveria enviar");
    },
    now: () => 1,
    deviceId: "este",
  });
  return {
    db,
    engine,
    fetchRemote: async () => ({ readingState: null }),
    isOnline: () => true,
    ...overrides,
  };
}

beforeEach(() => {
  db = createLocalDb(`saved-${counter++}`);
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe("loadSavedState", () => {
  it("sem nada em lugar nenhum, devolve null", async () => {
    expect(await loadSavedState(BOOK, deps())).toBeNull();
  });

  it("fica com o mais novo entre local e servidor", async () => {
    await db.readingStates.put(state(100, "epubcfi(/6/2)"));
    const remote = state(200, "epubcfi(/6/8)");
    const result = await loadSavedState(
      BOOK,
      deps({ fetchRemote: async () => ({ readingState: remote }) }),
    );
    expect(result?.cfi).toBe("epubcfi(/6/8)");
    expect((await readLocalState(db, BOOK))?.cfi).toBe("epubcfi(/6/8)");
  });

  it("mantém o local quando ele é mais novo que o servidor", async () => {
    await db.readingStates.put(state(300, "epubcfi(/6/2)"));
    const result = await loadSavedState(
      BOOK,
      deps({ fetchRemote: async () => ({ readingState: state(200, "epubcfi(/6/8)") }) }),
    );
    expect(result?.cfi).toBe("epubcfi(/6/2)");
  });

  it("sem rede, nem tenta o servidor e usa o local", async () => {
    await db.readingStates.put(state(100, "epubcfi(/6/2)"));
    const fetchRemote = vi.fn(async () => ({ readingState: state(999, "epubcfi(/6/8)") }));
    const result = await loadSavedState(BOOK, deps({ isOnline: () => false, fetchRemote }));
    expect(fetchRemote).not.toHaveBeenCalled();
    expect(result?.cfi).toBe("epubcfi(/6/2)");
  });

  it("servidor lento ou fora do ar: usa o local", async () => {
    await db.readingStates.put(state(100, "epubcfi(/6/2)"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await loadSavedState(
      BOOK,
      deps({
        fetchRemote: async () => {
          throw new ApiRequestError("TIMEOUT", "demorou");
        },
      }),
    );
    expect(result?.cfi).toBe("epubcfi(/6/2)");
  });

  it("registro local inválido no IndexedDB é ignorado", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await db.readingStates.put({ ...state(100, "x"), fileHash: "curto" });
    expect(await loadSavedState(BOOK, deps())).toBeNull();
  });
});
