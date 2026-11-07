import { afterEach, describe, expect, it, vi } from "vitest";
import { createChapterNav, type FoliateView } from "./chapter-nav";

type Section = { linear?: string } | null;

/** Um `foliate-view` de mentira com só o que o `chapter-nav` lê. */
function fakeView(options: {
  sections: Section[];
  current?: number;
  viewSize?: number;
  start?: number;
  end?: number;
  frame?: unknown;
}): FoliateView {
  const contents =
    options.current === undefined
      ? []
      : [{ index: options.current, doc: { defaultView: { frameElement: options.frame ?? null } } }];
  const view = {
    book: { sections: options.sections },
    renderer: {
      getContents: () => contents,
      viewSize: options.viewSize ?? 1000,
      start: options.start ?? 0,
      end: options.end ?? 0,
    },
  };
  return view as unknown as FoliateView;
}

afterEach(() => vi.unstubAllGlobals());

describe("hasAdjacent", () => {
  const sections: Section[] = [{}, { linear: "no" }, {}, { linear: "no" }];

  it("acha o próximo e o anterior capítulo de leitura, pulando os que não são lineares", () => {
    const nav = createChapterNav(fakeView({ sections, current: 0 }), () => true);
    expect(nav.hasAdjacent(1)).toBe(true); // pula o 1 (linear "no") e chega ao 2
    expect(nav.hasAdjacent(-1)).toBe(false);
  });

  it("não conta capítulos que só têm itens fora da leitura adiante", () => {
    const nav = createChapterNav(fakeView({ sections, current: 2 }), () => true);
    expect(nav.hasAdjacent(1)).toBe(false); // o 3 é linear "no"
    expect(nav.hasAdjacent(-1)).toBe(true); // o 0 conta
  });

  it("ignora seções que não são objetos e trata a falta de capítulo aberto como o índice -1", () => {
    const nav = createChapterNav(fakeView({ sections: [null, {}] }), () => true);
    expect(nav.hasAdjacent(1)).toBe(true); // de -1 chega ao 0 (null) e ao 1
    const onlyNull = createChapterNav(fakeView({ sections: [null], current: -1 }), () => true);
    expect(onlyNull.hasAdjacent(1)).toBe(false);
  });
});

describe("atChapterEdge", () => {
  it("fim: falta até 2 px para o fim conta como chegou", () => {
    const at = (end: number) =>
      createChapterNav(fakeView({ sections: [], viewSize: 1000, end }), () => true).atChapterEdge(
        1,
      );
    expect(at(998)).toBe(true);
    expect(at(1000)).toBe(true);
    expect(at(997)).toBe(false);
  });

  it("começo: só quando o início é 0 ou negativo", () => {
    const at = (start: number) =>
      createChapterNav(fakeView({ sections: [], start }), () => true).atChapterEdge(-1);
    expect(at(0)).toBe(true);
    expect(at(-5)).toBe(true);
    expect(at(1)).toBe(false);
  });
});

describe("canTurn", () => {
  it("fora da rolagem contínua sempre pode virar", () => {
    const view = fakeView({ sections: [{}], current: 0, viewSize: 1000, end: 1000 });
    expect(createChapterNav(view, () => false).canTurn(1)).toBe(true);
  });

  it("na rolagem, no fim do último capítulo não vira (evita travar o foliate)", () => {
    const view = fakeView({ sections: [{}, {}], current: 1, viewSize: 1000, end: 1000 });
    expect(createChapterNav(view, () => true).canTurn(1)).toBe(false);
  });

  it("na rolagem, no meio do capítulo ou com capítulo adiante pode virar", () => {
    const middle = fakeView({ sections: [{}, {}], current: 1, viewSize: 1000, end: 500 });
    expect(createChapterNav(middle, () => true).canTurn(1)).toBe(true);
    const hasNext = fakeView({ sections: [{}, {}], current: 0, viewSize: 1000, end: 1000 });
    expect(createChapterNav(hasNext, () => true).canTurn(1)).toBe(true);
  });

  it("no começo do primeiro capítulo não volta", () => {
    const view = fakeView({ sections: [{}, {}], current: 0, start: 0 });
    expect(createChapterNav(view, () => true).canTurn(-1)).toBe(false);
  });
});

describe("findScroller", () => {
  const element = (overflowY: string, parent: unknown = null) => ({
    overflowY,
    parentElement: parent,
  });

  it("sobe pelos ancestrais do iframe até achar o que rola, e guarda o resultado", () => {
    const scroller = element("auto");
    const frame = { parentElement: element("visible", scroller) };
    const calls: string[] = [];
    vi.stubGlobal("getComputedStyle", (el: { overflowY: string }) => {
      calls.push(el.overflowY);
      return { overflowY: el.overflowY };
    });
    const nav = createChapterNav(fakeView({ sections: [{}], current: 0, frame }), () => true);
    expect(nav.findScroller()).toBe(scroller);
    const before = calls.length;
    expect(nav.findScroller()).toBe(scroller);
    expect(calls.length).toBe(before); // segunda chamada usa o cache
  });

  it("aceita overflow scroll e devolve null sem iframe ou sem ancestral que role", () => {
    const frame = { parentElement: element("scroll") };
    vi.stubGlobal("getComputedStyle", (el: { overflowY: string }) => ({ overflowY: el.overflowY }));
    expect(
      createChapterNav(fakeView({ sections: [{}], current: 0, frame }), () => true).findScroller(),
    ).toBe(frame.parentElement);
    expect(
      createChapterNav(fakeView({ sections: [{}], current: 0 }), () => true).findScroller(),
    ).toBe(null);
    const hidden = { parentElement: element("hidden") };
    expect(
      createChapterNav(
        fakeView({ sections: [{}], current: 0, frame: hidden }),
        () => true,
      ).findScroller(),
    ).toBe(null);
  });
});
