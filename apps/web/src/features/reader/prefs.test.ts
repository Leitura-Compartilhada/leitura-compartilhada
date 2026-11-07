import { describe, expect, it } from "vitest";
import {
  buildBookCss,
  DEFAULT_PREFS,
  layoutAttributes,
  nearestWidth,
  parsePrefs,
  resolveReaderTheme,
} from "./prefs";

describe("parsePrefs", () => {
  it("usa os padrões para lixo ou ausência", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("texto")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ flow: "diagonal", columns: 7, theme: "neon", justify: "sim" })).toEqual(
      DEFAULT_PREFS,
    );
  });

  it("migra o formato antigo (só tema e fonte) sem perder esses dois campos", () => {
    const prefs = parsePrefs({ theme: "sepia", fontPercent: 140 });
    expect(prefs).toEqual({ ...DEFAULT_PREFS, theme: "sepia", fontPercent: 140 });
  });

  it("limita números fora da faixa e arredonda para o passo", () => {
    const prefs = parsePrefs({
      fontPercent: 999,
      lineHeight: 0.2,
      margin: -5,
      autoScrollSpeed: 99,
      maxWidth: 700,
    });
    expect(prefs.fontPercent).toBe(200);
    expect(prefs.lineHeight).toBe(1.2);
    expect(prefs.margin).toBe(0);
    expect(prefs.autoScrollSpeed).toBe(10);
    expect(prefs.maxWidth).toBe(720);
  });

  it("aceita valores válidos de cada campo", () => {
    const valid = {
      theme: "app",
      fontPercent: 120,
      flow: "scrolled",
      columns: 2,
      maxWidth: 960,
      margin: 12,
      fontFamily: "sans",
      lineHeight: 1.8,
      justify: true,
      autoScrollSpeed: 7,
    };
    expect(parsePrefs(valid)).toEqual(valid);
  });
});

describe("nearestWidth", () => {
  it("escolhe a largura permitida mais próxima", () => {
    expect(nearestWidth(10)).toBe(480);
    expect(nearestWidth(790)).toBe(840);
    expect(nearestWidth(Number.NaN)).toBe(720);
  });
});

describe("resolveReaderTheme", () => {
  it("segue o app só quando a escolha é 'app'", () => {
    expect(resolveReaderTheme("app", "dark")).toBe("dark");
    expect(resolveReaderTheme("sepia", "dark")).toBe("sepia");
  });
});

describe("layoutAttributes", () => {
  it("remove os atributos que voltam ao padrão do foliate", () => {
    expect(layoutAttributes(DEFAULT_PREFS)).toEqual({
      flow: null,
      "max-column-count": null,
      "max-inline-size": "720px",
      gap: "7%",
    });
    expect(layoutAttributes({ ...DEFAULT_PREFS, flow: "scrolled", columns: 1 })).toMatchObject({
      flow: "scrolled",
      "max-column-count": "1",
    });
  });
});

describe("buildBookCss", () => {
  it("faz o texto herdar o tamanho do corpo, menos títulos e notas", () => {
    const css = buildBookCss({ ...DEFAULT_PREFS, fontPercent: 150 }, "light");
    expect(css).toContain("font-size: 150% !important");
    expect(css).toMatch(
      /body :not\(h1, h2[^)]*sup, sub, small[^)]*\)\s*\{[^}]*font-size: inherit !important/,
    );
  });

  it("só mexe na família e no alinhamento quando pedido", () => {
    const plain = buildBookCss(DEFAULT_PREFS, "light");
    expect(plain).not.toContain("font-family");
    expect(plain).not.toContain("justify");
    const custom = buildBookCss({ ...DEFAULT_PREFS, fontFamily: "serif", justify: true }, "light");
    expect(custom).toContain("Georgia");
    expect(custom).toContain("text-align: justify");
  });

  it("usa o tema do app quando a escolha é 'app'", () => {
    expect(buildBookCss(DEFAULT_PREFS, "dark")).toContain("color-scheme: dark");
    expect(buildBookCss({ ...DEFAULT_PREFS, theme: "sepia" }, "dark")).toContain("#f4ecd8");
  });
});
