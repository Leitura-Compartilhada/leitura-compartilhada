import type { FoliateResolved } from "@/vendor/foliate-js/view.js";
import type { FoliateView } from "./load-foliate";
import type { ObservedLocation, ReaderPort, ResolvedCfi } from "./restore";

/** O âncora resolvida é um Range ou um Element? Range de iframe não é `instanceof Range` daqui. */
function isRangeLike(anchor: Range | Element | number): anchor is Range {
  return typeof anchor === "object" && "startContainer" in anchor;
}

/** O ponto do âncora está dentro do trecho visível? Qualquer erro de DOM conta como "não". */
function visibleContainsAnchor(visible: Range, anchor: Range | Element | number): boolean {
  try {
    if (typeof anchor === "number") return false;
    if (isRangeLike(anchor))
      return visible.isPointInRange(anchor.startContainer, anchor.startOffset);
    return visible.isPointInRange(anchor, 0);
  } catch {
    return false;
  }
}

function anchorIn(resolved: FoliateResolved, doc: Document): Range | Element | number | null {
  if (typeof resolved.anchor !== "function") return null;
  try {
    return resolved.anchor(doc);
  } catch {
    return null;
  }
}

/** Adapta o `<foliate-view>` à interface que a cascata de restauração usa. */
export function createFoliatePort(view: FoliateView): ReaderPort {
  return {
    resolveCfi(cfi): ResolvedCfi | null {
      const resolved = view.resolveNavigation(cfi);
      if (!resolved || typeof resolved.index !== "number") return null;
      return { index: resolved.index, sectionCount: view.book.sections.length };
    },

    async initAt(cfi) {
      await view.init({ lastLocation: cfi });
    },

    readLocation(expectedCfi): ObservedLocation | null {
      const location = view.lastLocation;
      const resolved = view.resolveNavigation(expectedCfi);
      if (!location?.range || !location.section || !resolved) return null;
      const doc = view.renderer
        .getContents()
        .find((content) => content.index === resolved.index)?.doc;
      const anchor = doc ? anchorIn(resolved, doc) : null;
      return {
        sectionIndex: location.section.current,
        containsCfiPoint: anchor !== null && visibleContainsAnchor(location.range, anchor),
      };
    },

    sectionIndexAt(fraction) {
      return view.resolveNavigation({ fraction })?.index ?? null;
    },

    sectionCount() {
      return view.book.sections.length;
    },

    async searchSnippet(snippet, sectionIndex) {
      try {
        for await (const result of view.search({ query: snippet, index: sectionIndex })) {
          if (result === "done") break;
          if ("cfi" in result) return result.cfi;
        }
      } catch (error) {
        // Seção sem documento (imagem, por exemplo): segue para a próxima.
        console.warn(`busca do trecho falhou na seção ${sectionIndex}`, error);
      }
      return null;
    },

    clearSearch() {
      view.clearSearch();
    },

    async goTo(cfi) {
      const resolved = await view.goTo(cfi);
      if (!resolved) throw new Error("o leitor não conseguiu ir ao trecho encontrado");
    },

    async goToFraction(fraction) {
      await view.goToFraction(fraction);
    },

    async start() {
      await view.init({ showTextStart: true });
    },
  };
}
