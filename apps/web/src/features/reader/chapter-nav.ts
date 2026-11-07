export type FoliateView = HTMLElementTagNameMap["foliate-view"];

/** Rolagem contínua: folga (px) para considerar que o capítulo chegou ao fim ou ao começo. */
const EDGE_SLACK_PX = 2;

type SectionLike = { linear?: string };

export type ChapterNav = {
  /** Há outro capítulo de leitura (`linear`) adiante (+1) ou atrás (-1) do atual? */
  hasAdjacent(direction: 1 | -1): boolean;
  /** Rolagem contínua: o capítulo está no fim (+1) ou no começo (-1)? */
  atChapterEdge(direction: 1 | -1): boolean;
  /**
   * Na rolagem contínua, pedir `next()`/`prev()` no fim do último capítulo (ou no começo do
   * primeiro) faz o foliate tentar abrir um capítulo que não existe e travar a navegação para
   * sempre (`#locked` nunca volta a falso). Por isso a checagem é nossa.
   */
  canTurn(direction: 1 | -1): boolean;
  /** O elemento que rola na rolagem contínua: ancestral do iframe, no shadow DOM do foliate. */
  findScroller(): HTMLElement | null;
};

export function createChapterNav(view: FoliateView, isScrolled: () => boolean): ChapterNav {
  let cachedScroller: { frame: Element; scroller: HTMLElement } | null = null;

  const hasAdjacent: ChapterNav["hasAdjacent"] = (direction) => {
    const sections: SectionLike[] = view.book.sections.filter(
      (section): section is SectionLike => typeof section === "object" && section !== null,
    );
    const current = view.renderer.getContents()[0]?.index ?? -1;
    for (let i = current + direction; i >= 0 && i < sections.length; i += direction) {
      if (sections[i]?.linear !== "no") return true;
    }
    return false;
  };

  const atChapterEdge: ChapterNav["atChapterEdge"] = (direction) =>
    direction > 0
      ? view.renderer.viewSize - view.renderer.end <= EDGE_SLACK_PX
      : view.renderer.start <= 0;

  const canTurn: ChapterNav["canTurn"] = (direction) =>
    !isScrolled() || !atChapterEdge(direction) || hasAdjacent(direction);

  const findScroller: ChapterNav["findScroller"] = () => {
    const frame = view.renderer.getContents()[0]?.doc.defaultView?.frameElement ?? null;
    if (!frame) return null;
    if (cachedScroller?.frame === frame) return cachedScroller.scroller;
    for (let el = frame.parentElement; el; el = el.parentElement) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === "auto" || overflow === "scroll") {
        cachedScroller = { frame, scroller: el };
        return el;
      }
    }
    return null;
  };

  return { hasAdjacent, atChapterEdge, canTurn, findScroller };
}
