import type { ReadingState } from "@leitura/shared";
import { downloadBookFile } from "@/lib/api";
import { flushNow, scheduleProgressFlush, syncEngine } from "@/lib/sync";
import type { FoliateLocation, FoliateTocItem } from "@/vendor/foliate-js/view.js";
import { AutoScroller } from "./auto-scroll";
import { createChapterNav } from "./chapter-nav";
import { nextFrame, sleep } from "./dom-guards";
import { handleExternalLink } from "./external-link";
import { createFoliatePort } from "./foliate-port";
import { createReaderInput } from "./input";
import { loadFoliate } from "./load-foliate";
import { type AppTheme, buildBookCss, layoutAttributes, type ReaderPrefs } from "./prefs";
import { ReaderSession } from "./session";
import { WakeLockHolder } from "./wake-lock";

export type ReaderLocation = { fraction: number; chapter: string | null };

export type OpenReaderParams = {
  container: HTMLElement;
  bookId: string;
  fileHash: string;
  prefs: ReaderPrefs;
  appTheme: AppTheme;
  saved: Promise<ReadingState | null>;
  signal: AbortSignal;
  onLocation: (location: ReaderLocation) => void;
  /** Toque no centro da tela: mostrar/esconder as barras. */
  onCenterTap: () => void;
  /** A rolagem automática começou ou parou (inclusive quando o usuário a interrompe). */
  onAutoScrollChange: (running: boolean) => void;
};

export type ReaderHandle = {
  toc: FoliateTocItem[];
  next(): Promise<void>;
  prev(): Promise<void>;
  goToHref(href: string): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  /** Aplica tema, tipografia e layout. Ao trocar o modo de leitura, mantém o trecho visível. */
  applyPrefs(prefs: ReaderPrefs, appTheme: AppTheme): Promise<void>;
  setAutoScroll(on: boolean): void;
  /** Descarrega o salvamento pendente, fecha o livro e remove ouvintes e elemento. */
  dispose(): Promise<void>;
};

/**
 * Monta o `<foliate-view>`, abre o EPUB e restaura a posição. Devolve `null` se a tela foi
 * fechada no meio (`signal`), depois de limpar o que já tinha criado. Erros sobem para a tela.
 *
 * Este arquivo só coordena: teclado/roda/toque ficam em `input.ts`, navegação entre capítulos em
 * `chapter-nav.ts`, a tela acesa em `wake-lock.ts` e a rolagem automática em `auto-scroll.ts`.
 */
export async function openReader(params: OpenReaderParams): Promise<ReaderHandle | null> {
  const { container, bookId, fileHash, signal } = params;

  await loadFoliate();
  const [blob, saved] = await Promise.all([downloadBookFile(bookId, signal), params.saved]);
  if (signal.aborted) return null;

  const view = document.createElement("foliate-view");
  view.style.cssText = "display:block;width:100%;height:100%";
  const cleanups: Array<() => void> = [];
  let session: ReaderSession | null = null;
  let currentPrefs = params.prefs;
  const wakeLock = new WakeLockHolder();

  const run = (action: () => Promise<unknown>): Promise<void> =>
    session ? session.userJump(action) : Promise.resolve();
  const isScrolled = () => currentPrefs.flow === "scrolled";
  const nav = createChapterNav(view, isScrolled);

  const autoScroller = new AutoScroller({
    flow: () => currentPrefs.flow,
    speedLevel: () => currentPrefs.autoScrollSpeed,
    findScroller: nav.findScroller,
    atChapterEnd: () => nav.atChapterEdge(1),
    hasMore: () => (isScrolled() ? nav.hasAdjacent(1) : !view.renderer.atEnd),
    advance: () => run(() => view.next()),
    // `next(1)` anda 1 px: serve só para o foliate emitir um `relocate` e a posição ser gravada.
    checkpoint: () => run(() => view.next(1)),
    onStop: () => {
      void wakeLock.release();
      params.onAutoScrollChange(false);
    },
  });

  const input = createReaderInput({
    view,
    nav,
    run,
    isScrolled,
    stopAutoScroll: () => autoScroller.stop(),
    onCenterTap: params.onCenterTap,
  });

  /** Aplica os atributos do paginador; só mexe no que mudou, porque cada troca refaz o layout. */
  const applyLayout = (prefs: ReaderPrefs): void => {
    const { renderer } = view;
    for (const [name, value] of Object.entries(layoutAttributes(prefs))) {
      if (value === null) {
        if (renderer.hasAttribute(name)) renderer.removeAttribute(name);
      } else if (renderer.getAttribute(name) !== value) {
        renderer.setAttribute(name, value);
      }
    }
  };

  /**
   * Trocar de modo refaz o layout e o foliate reancora no trecho visível. Se mesmo assim o ponto
   * de leitura saiu da tela, volta pelo CFI (que não depende do layout). Não grava nada: é a
   * mesma posição.
   */
  const keepPosition = async (cfi: string): Promise<void> => {
    const port = createFoliatePort(view);
    for (let attempt = 0; attempt < 3; attempt++) {
      await nextFrame();
      await nextFrame();
      await sleep(80);
      if (port.readLocation(cfi)?.containsCfiPoint) return;
    }
    await view.goTo(cfi);
  };

  const teardown = async (): Promise<void> => {
    autoScroller.halt();
    void wakeLock.release();
    for (const cleanup of cleanups.splice(0)) cleanup();
    await session?.dispose();
    try {
      view.close();
    } catch (error) {
      // O renderer do foliate lança se nenhum capítulo chegou a ser exibido (abertura que falhou).
      console.warn("falha ao fechar o leitor", error);
    }
    view.remove();
    flushNow();
  };

  try {
    const onRelocateUi = () => {
      const location: FoliateLocation | null | undefined = view.lastLocation;
      if (!location || typeof location.fraction !== "number") return;
      params.onLocation({
        fraction: Math.min(1, Math.max(0, location.fraction)),
        chapter: location.tocItem?.label?.trim() || null,
      });
    };

    const onVisibility = () => {
      if (autoScroller.running && document.visibilityState === "visible") {
        void wakeLock.acquire();
      }
    };

    view.addEventListener("load", input.onSectionLoad);
    view.addEventListener("relocate", onRelocateUi);
    view.addEventListener("click", input.onHostClick);
    // Link externo dentro do livro: sem este ouvinte o foliate faz `window.open(href)` na janela
    // do app, e um `javascript:` do EPUB rodaria com a nossa origem.
    view.addEventListener("external-link", handleExternalLink);
    window.addEventListener("keydown", input.onKey);
    document.addEventListener("visibilitychange", onVisibility);
    cleanups.push(
      () => view.removeEventListener("load", input.onSectionLoad),
      () => view.removeEventListener("relocate", onRelocateUi),
      () => view.removeEventListener("click", input.onHostClick),
      () => view.removeEventListener("external-link", handleExternalLink),
      () => window.removeEventListener("keydown", input.onKey),
      () => document.removeEventListener("visibilitychange", onVisibility),
    );

    container.append(view);
    await view.open(new File([blob], "book.epub", { type: "application/epub+zip" }));
    applyLayout(params.prefs);
    view.renderer.setStyles(buildBookCss(params.prefs, params.appTheme));
    if (signal.aborted) {
      await teardown();
      return null;
    }

    // A sessão nasce depois do open(): o ouvinte do <foliate-view> precisa vir antes do dela.
    session = new ReaderSession(view, createFoliatePort(view), {
      bookId,
      fileHash,
      record: (id, progress) => syncEngine.recordProgress(id, progress),
      afterSave: scheduleProgressFlush,
    });
    await session.restore(saved);
    if (signal.aborted) {
      await teardown();
      return null;
    }
    onRelocateUi();

    return {
      toc: view.book.toc ?? [],
      next: () => input.turn("next"),
      prev: () => input.turn("prev"),
      goToHref: (href) => run(() => view.goTo(href)),
      goToFraction: (fraction) => run(() => view.goToFraction(fraction)),
      applyPrefs: async (prefs, appTheme) => {
        const flowChanged = prefs.flow !== currentPrefs.flow;
        const cfi = flowChanged ? view.lastLocation?.cfi : undefined;
        currentPrefs = prefs;
        view.renderer.setStyles(buildBookCss(prefs, appTheme));
        applyLayout(prefs);
        if (cfi) await keepPosition(cfi);
      },
      setAutoScroll: (on) => {
        if (on === autoScroller.running) return;
        if (!on) {
          autoScroller.stop();
          return;
        }
        autoScroller.start();
        void wakeLock.acquire();
        params.onAutoScrollChange(true);
      },
      dispose: teardown,
    };
  } catch (error) {
    await teardown();
    throw error;
  }
}
