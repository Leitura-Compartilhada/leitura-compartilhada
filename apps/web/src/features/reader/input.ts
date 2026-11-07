import type { ChapterNav, FoliateView } from "./chapter-nav";
import { isDocumentLike, isInteractive, isTypingTarget } from "./dom-guards";

/** Faixa da largura onde um toque vira "página anterior" (esquerda) ou "próxima" (direita). */
export const TAP_ZONE_FRACTION = 0.3;

/** Rolagem contínua: quanto as setas para cima e para baixo rolam, em px. */
const KEY_SCROLL_PX = 80;
/** Rolagem contínua: quanto de roda "além do fim" faz passar de capítulo. */
const EDGE_WHEEL_THRESHOLD = 60;
/** Rolagem contínua: quanto o dedo precisa subir/descer "além do fim" para passar de capítulo. */
const EDGE_SWIPE_PX = 70;
/**
 * Depois de rolar livremente (ou de trocar de capítulo) a roda precisa parar um instante: a
 * inércia do trackpad não pode atravessar o capítulo sozinha.
 */
const EDGE_QUIET_MS = 300;

export type TurnDirection = "left" | "right" | "next" | "prev";

export type InputDeps = {
  view: FoliateView;
  nav: ChapterNav;
  /** Executa a ação como salto do usuário (o `relocate` que ela causa é gravado). */
  run: (action: () => Promise<unknown>) => Promise<void>;
  isScrolled: () => boolean;
  stopAutoScroll: () => void;
  /** Toque no centro da tela: mostrar/esconder as barras. */
  onCenterTap: () => void;
};

/**
 * Teclado, roda, toque e clique do leitor. Em páginas vira "virar página"; na rolagem contínua,
 * "além do fim do capítulo" passa ao próximo (ou ao anterior).
 */
export function createReaderInput(deps: InputDeps) {
  const { view, nav, run, isScrolled, stopAutoScroll } = deps;
  const isRtl = () => view.book.dir === "rtl";

  const turn = (direction: TurnDirection): Promise<void> => {
    const actions = {
      left: () => view.goLeft(),
      right: () => view.goRight(),
      next: () => view.next(),
      prev: () => view.prev(),
    };
    const forward =
      direction === "next" || (direction === "right" ? !isRtl() : direction === "left" && isRtl());
    if (!nav.canTurn(forward ? 1 : -1)) return Promise.resolve();
    return run(actions[direction]);
  };

  const scrollKey = (direction: 1 | -1): Promise<void> => {
    if (!nav.canTurn(direction)) return Promise.resolve();
    return run(() => (direction > 0 ? view.next(KEY_SCROLL_PX) : view.prev(KEY_SCROLL_PX)));
  };

  let edgeAccumulated = 0;
  let edgeBusy = false;
  let quietUntil = 0;
  const crossChapter = (direction: 1 | -1): void => {
    edgeBusy = true;
    edgeAccumulated = 0;
    void run(() => (direction > 0 ? view.next() : view.prev())).finally(() => {
      edgeBusy = false;
      quietUntil = performance.now() + EDGE_QUIET_MS;
    });
  };

  const onWheel = (event: WheelEvent) => {
    stopAutoScroll();
    if (!isScrolled() || event.ctrlKey || event.deltaY === 0) return;
    const direction = event.deltaY > 0 ? 1 : -1;
    const now = performance.now();
    if (!nav.atChapterEdge(direction)) {
      quietUntil = now + EDGE_QUIET_MS;
      edgeAccumulated = 0;
      return;
    }
    if (now < quietUntil || edgeBusy || !nav.hasAdjacent(direction)) return;
    edgeAccumulated += Math.abs(event.deltaY);
    if (edgeAccumulated >= EDGE_WHEEL_THRESHOLD) crossChapter(direction);
  };

  let touch: { y: number; atBottom: boolean; atTop: boolean } | null = null;
  const onTouchStart = (event: TouchEvent) => {
    stopAutoScroll();
    const first = event.touches[0];
    touch =
      first && isScrolled()
        ? { y: first.screenY, atBottom: nav.atChapterEdge(1), atTop: nav.atChapterEdge(-1) }
        : null;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touch;
    touch = null;
    const last = event.changedTouches[0];
    if (!start || !last || edgeBusy || !isScrolled()) return;
    const swiped = start.y - last.screenY; // positivo: o dedo subiu (quer ler adiante)
    if (swiped > EDGE_SWIPE_PX && start.atBottom && nav.hasAdjacent(1)) crossChapter(1);
    else if (swiped < -EDGE_SWIPE_PX && start.atTop && nav.hasAdjacent(-1)) crossChapter(-1);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.altKey || event.metaKey || isTypingTarget(event.target)) return;
    stopAutoScroll();
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        if (!isScrolled()) break;
        event.preventDefault();
        void scrollKey(event.key === "ArrowDown" ? 1 : -1);
        break;
      case "ArrowLeft":
      case "PageUp":
        event.preventDefault();
        void turn(event.key === "PageUp" ? "prev" : "left");
        break;
      case "ArrowRight":
      case "PageDown":
        event.preventDefault();
        void turn(event.key === "PageDown" ? "next" : "right");
        break;
      case " ":
        event.preventDefault();
        void turn(event.shiftKey ? "prev" : "next");
        break;
    }
  };

  /** `x` em coordenadas da janela do app. */
  const onTapAt = (x: number) => {
    const rect = view.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = (x - rect.left) / rect.width;
    if (ratio < TAP_ZONE_FRACTION) void turn("left");
    else if (ratio > 1 - TAP_ZONE_FRACTION) void turn("right");
    else deps.onCenterTap();
  };

  const onHostClick = (event: MouseEvent) => {
    if (!isInteractive(event.target)) onTapAt(event.clientX);
  };

  /** Liga os ouvintes ao documento de cada capítulo carregado (um iframe por capítulo). */
  const onSectionLoad = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const doc: unknown = event.detail?.doc;
    if (!isDocumentLike(doc)) return;
    doc.addEventListener("keydown", onKey);
    doc.addEventListener("wheel", onWheel, { passive: true });
    doc.addEventListener("touchstart", onTouchStart, { passive: true });
    doc.addEventListener("touchend", onTouchEnd, { passive: true });
    doc.addEventListener("pointerdown", () => stopAutoScroll());
    doc.addEventListener("click", (click) => {
      if (isInteractive(click.target) || doc.getSelection()?.type === "Range") return;
      // O iframe é mais largo que a tela (colunas): somar o deslocamento do quadro dá a posição real.
      const frameLeft = doc.defaultView?.frameElement?.getBoundingClientRect().left ?? 0;
      onTapAt(frameLeft + click.clientX);
    });
  };

  return { turn, onKey, onHostClick, onSectionLoad };
}
