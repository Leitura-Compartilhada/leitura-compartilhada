import type { ReadingPosition } from "@leitura/shared";
import { describe, expect, it, vi } from "vitest";
import type { ProgressInput } from "@/lib/sync";
import type { RelocateReason } from "./progress-gate";
import type { ReaderPort } from "./restore";
import { ReaderSession, type SessionView } from "./session";

const HASH = "c".repeat(64);
const BOOK_ID = "11111111-1111-4111-8111-111111111111";
const LONG_TEXT = "Era uma vez um texto longo o bastante para virar trecho de busca.";

type Location = NonNullable<SessionView["lastLocation"]>;

function makeView(): SessionView & { renderer: EventTarget } {
  return { renderer: new EventTarget(), lastLocation: undefined };
}

function location(cfi: string, fraction = 0.25): Location {
  return { cfi, fraction, range: { toString: () => LONG_TEXT } };
}

function fire(view: SessionView, reason: string | null, loc: Location) {
  view.lastLocation = loc; // o <foliate-view> atualiza antes de o app ver o evento
  view.renderer.dispatchEvent(new CustomEvent("relocate", { detail: { reason } }));
}

/** Porta que "restaura" disparando relocates, como o foliate faz de verdade. */
function makePort(onNavigate: () => void): ReaderPort {
  return {
    resolveCfi: () => ({ index: 0, sectionCount: 3 }),
    initAt: async () => onNavigate(),
    readLocation: () => ({ sectionIndex: 0, containsCfiPoint: true }),
    sectionIndexAt: () => 0,
    sectionCount: () => 3,
    searchSnippet: async () => null,
    clearSearch: () => undefined,
    goTo: async () => onNavigate(),
    goToFraction: async () => onNavigate(),
    start: async () => onNavigate(),
  };
}

function setup(savedCfi: string | null = "epubcfi(/6/2!/4/2)") {
  const view = makeView();
  const record = vi.fn(async (_id: string, _input: ProgressInput) => undefined);
  const afterSave = vi.fn();
  const port = makePort(() => fire(view, "navigation", location("epubcfi(/6/2!/4/2)", 0)));
  const session = new ReaderSession(view, port, {
    bookId: BOOK_ID,
    fileHash: HASH,
    record,
    afterSave,
  });
  const saved: ReadingPosition | null = savedCfi
    ? { cfi: savedCfi, percentage: 0.4, textSnippet: null, fileHash: HASH }
    : null;
  return { view, record, afterSave, session, saved };
}

describe("regra de persistência do progresso", () => {
  it("não grava o relocate causado pela restauração", async () => {
    const { session, record } = setup();
    // o gate começa "restaurando": mesmo antes de restore() nada é gravado
    await session.restore({
      cfi: "epubcfi(/6/2!/4/2)",
      percentage: 0.4,
      textSnippet: null,
      fileHash: HASH,
    });
    await session.settled();
    expect(record).not.toHaveBeenCalled();
  });

  it("não grava nem quando a restauração falha e cai na primeira página", async () => {
    const { session, record, view } = setup();
    view.lastLocation = location("epubcfi(/6/2)", 0);
    await session.restore(null); // "start" dispara relocate de navigation
    await session.settled();
    expect(record).not.toHaveBeenCalled();
  });

  it("grava depois da restauração quando o usuário vira a página", async () => {
    const { session, record, afterSave, view, saved } = setup();
    await session.restore(saved);
    fire(view, "page", location("epubcfi(/6/2!/4/10)", 0.31));
    await session.settled();
    expect(record).toHaveBeenCalledTimes(1);
    const [bookId, input] = record.mock.calls[0] ?? [];
    expect(bookId).toBe(BOOK_ID);
    expect(input).toEqual({
      cfi: "epubcfi(/6/2!/4/10)",
      percentage: 0.31,
      textSnippet: LONG_TEXT,
      fileHash: HASH,
      status: "reading",
    });
    expect(afterSave).toHaveBeenCalledTimes(1);
  });

  it.each(["page", "scroll", "snap"] as const)("grava no motivo %s", async (reason) => {
    const { session, record, view, saved } = setup();
    await session.restore(saved);
    fire(view, reason, location(`epubcfi(/6/2!/4/${reason.length})`));
    await session.settled();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it.each(["navigation", "anchor", "selection", null] as const)(
    "não grava no motivo %s",
    async (reason) => {
      const { session, record, view, saved } = setup();
      await session.restore(saved);
      fire(view, reason satisfies RelocateReason, location("epubcfi(/6/2!/4/99)"));
      await session.settled();
      expect(record).not.toHaveBeenCalled();
    },
  );

  it("redimensionar (anchor) depois da restauração não grava", async () => {
    const { session, record, view, saved } = setup();
    await session.restore(saved);
    fire(view, "anchor", location("epubcfi(/6/2!/4/50)", 0.9));
    await session.settled();
    expect(record).not.toHaveBeenCalled();
  });

  it("salto pedido pelo usuário (navigation marcado) grava uma vez", async () => {
    const { session, record, view, saved } = setup();
    await session.restore(saved);
    await session.userJump(async () =>
      fire(view, "navigation", location("epubcfi(/6/8!/4/2)", 0.5)),
    );
    // um segundo relocate de navigation, sem marcar, não grava
    fire(view, "navigation", location("epubcfi(/6/8!/4/4)", 0.5));
    await session.settled();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("viradas sobrepostas: a que termina primeiro não apaga a marca da outra", async () => {
    // Regressão achada no E2E: ao cruzar o capítulo, o relocate de "navigation" chegava depois de
    // uma segunda tecla (descartada pelo foliate durante a animação) já ter terminado.
    const { session, record, view, saved } = setup();
    await session.restore(saved);

    let release: () => void = () => undefined;
    const animation = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = session.userJump(async () => {
      await animation;
      fire(view, "navigation", location("epubcfi(/6/4!/4,/2,/32/1:153)", 0.4));
    });
    await session.userJump(async () => undefined); // a segunda tecla termina na hora
    release();
    await first;
    await session.settled();

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[1].cfi).toBe("epubcfi(/6/4!/4,/2,/32/1:153)");
  });

  it("rolagem pedida pelo usuário no modo contínuo (motivo nulo marcado) grava", async () => {
    const { session, record, view, saved } = setup();
    await session.restore(saved);
    await session.userJump(async () => fire(view, null, location("epubcfi(/6/8!/4/8)", 0.5)));
    await session.settled();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("depois que todas as ações terminam, um navigation sem marca volta a não gravar", async () => {
    const { session, record, view, saved } = setup();
    await session.restore(saved);
    await Promise.all([
      session.userJump(async () => undefined),
      session.userJump(async () => undefined),
    ]);
    fire(view, "navigation", location("epubcfi(/6/8!/4/6)", 0.5));
    await session.settled();
    expect(record).not.toHaveBeenCalled();
  });

  it("a marca do salto não vaza quando nenhum relocate acontece", async () => {
    const { session, record, view, saved } = setup();
    await session.restore(saved);
    await session.userJump(async () => undefined);
    fire(view, "navigation", location("epubcfi(/6/8!/4/6)", 0.5));
    await session.settled();
    expect(record).not.toHaveBeenCalled();
  });

  it("não grava o CFI igual ao último salvo", async () => {
    const { session, record, view, saved } = setup();
    await session.restore(saved);
    fire(view, "page", location("epubcfi(/6/2!/4/10)", 0.3));
    fire(view, "page", location("epubcfi(/6/2!/4/10)", 0.3));
    await session.settled();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("não grava o CFI que acabou de ser restaurado", async () => {
    const { session, record, view, saved } = setup("epubcfi(/6/2!/4/2)");
    await session.restore(saved);
    fire(view, "page", location("epubcfi(/6/2!/4/2)", 0.4));
    await session.settled();
    expect(record).not.toHaveBeenCalled();
  });

  it("ignora relocate sem fração (livro sem progresso calculado)", async () => {
    const { session, record, view, saved } = setup();
    await session.restore(saved);
    fire(view, "page", { cfi: "epubcfi(/6/2!/4/12)" });
    await session.settled();
    expect(record).not.toHaveBeenCalled();
  });

  it("depois de dispose não grava mais", async () => {
    const { session, record, view, saved } = setup();
    await session.restore(saved);
    await session.dispose();
    fire(view, "page", location("epubcfi(/6/2!/4/14)"));
    await session.settled();
    expect(record).not.toHaveBeenCalled();
  });

  it("falha ao gravar não derruba a sessão nem impede as próximas gravações", async () => {
    const { session, record, view, saved } = setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    record.mockRejectedValueOnce(new Error("disco cheio"));
    await session.restore(saved);
    fire(view, "page", location("epubcfi(/6/2!/4/20)"));
    fire(view, "page", location("epubcfi(/6/2!/4/22)"));
    await session.settled();
    expect(record).toHaveBeenCalledTimes(2);
  });
});
