export const THEMES = ["light", "dark", "sepia"] as const;
export type ReaderTheme = (typeof THEMES)[number];
/** `app` segue o tema do app (claro/escuro); os outros três fixam o tema do leitor. */
export type ReaderThemeChoice = "app" | ReaderTheme;
export type AppTheme = "light" | "dark";

export const THEME_LABELS: Record<ReaderTheme, string> = {
  light: "Claro",
  dark: "Escuro",
  sepia: "Sépia",
};

export const FLOWS = ["paginated", "scrolled"] as const;
export type ReaderFlow = (typeof FLOWS)[number];
export const FLOW_LABELS: Record<ReaderFlow, string> = {
  paginated: "Páginas",
  scrolled: "Rolagem contínua",
};

export const COLUMN_CHOICES = ["auto", 1, 2] as const;
export type ReaderColumns = (typeof COLUMN_CHOICES)[number];

/** Largura máxima do texto, em px (por coluna). */
export const WIDTH_CHOICES = [480, 600, 720, 840, 960] as const;
export type ReaderWidth = (typeof WIDTH_CHOICES)[number];

/** Margem lateral: fração da largura (em %, o `gap` do foliate). */
export const MARGIN_CHOICES = [
  { label: "Pequena", value: 3 },
  { label: "Normal", value: 7 },
  { label: "Grande", value: 12 },
] as const;
export const MIN_MARGIN = 0;
export const MAX_MARGIN = 20;

export const FONT_FAMILIES = ["book", "serif", "sans"] as const;
export type ReaderFontFamily = (typeof FONT_FAMILIES)[number];
export const FONT_FAMILY_LABELS: Record<ReaderFontFamily, string> = {
  book: "Padrão do livro",
  serif: "Com serifa",
  sans: "Sem serifa",
};
const FONT_STACKS: Record<Exclude<ReaderFontFamily, "book">, string> = {
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
};

export const MIN_FONT_PERCENT = 80;
export const MAX_FONT_PERCENT = 200;
export const FONT_STEP_PERCENT = 10;
export const DEFAULT_FONT_PERCENT = 100;

export const MIN_LINE_HEIGHT = 1.2;
export const MAX_LINE_HEIGHT = 2;
export const LINE_HEIGHT_STEP = 0.05;
export const DEFAULT_LINE_HEIGHT = 1.55;

/** Velocidade da rolagem automática: nível de 1 a 10. */
export const MIN_AUTO_SCROLL_SPEED = 1;
export const MAX_AUTO_SCROLL_SPEED = 10;
export const DEFAULT_AUTO_SCROLL_SPEED = 4;
/** Rolagem contínua: px por segundo, por nível. */
export const AUTO_SCROLL_PX_PER_LEVEL = 12;
/** Modo em páginas: uma página a cada `AUTO_SCROLL_PAGE_SECONDS / nível` segundos. */
export const AUTO_SCROLL_PAGE_SECONDS = 90;

export type ReaderPrefs = {
  theme: ReaderThemeChoice;
  fontPercent: number;
  flow: ReaderFlow;
  columns: ReaderColumns;
  maxWidth: ReaderWidth;
  margin: number;
  fontFamily: ReaderFontFamily;
  lineHeight: number;
  justify: boolean;
  autoScrollSpeed: number;
};

export const DEFAULT_PREFS: ReaderPrefs = {
  theme: "app",
  fontPercent: DEFAULT_FONT_PERCENT,
  flow: "paginated",
  columns: "auto",
  maxWidth: 720,
  margin: 7,
  fontFamily: "book",
  lineHeight: DEFAULT_LINE_HEIGHT,
  justify: false,
  autoScrollSpeed: DEFAULT_AUTO_SCROLL_SPEED,
};

type Palette = { background: string; foreground: string; link: string };

export const PALETTES: Record<ReaderTheme, Palette> = {
  light: { background: "#ffffff", foreground: "#1c1c1e", link: "#0b57d0" },
  dark: { background: "#18181b", foreground: "#e4e4e7", link: "#8ab4f8" },
  sepia: { background: "#f4ecd8", foreground: "#4a3b2a", link: "#7a4a12" },
};

const STORAGE_KEY = "leitura.readerPrefs";

export function isTheme(value: unknown): value is ReaderTheme {
  return THEMES.some((theme) => theme === value);
}

function isThemeChoice(value: unknown): value is ReaderThemeChoice {
  return value === "app" || isTheme(value);
}

/** O tema concreto do leitor, dado o que o usuário escolheu e o tema atual do app. */
export function resolveReaderTheme(choice: ReaderThemeChoice, appTheme: AppTheme): ReaderTheme {
  return choice === "app" ? appTheme : choice;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampFontPercent(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FONT_PERCENT;
  const stepped = Math.round(value / FONT_STEP_PERCENT) * FONT_STEP_PERCENT;
  return clamp(stepped, MIN_FONT_PERCENT, MAX_FONT_PERCENT);
}

export function clampLineHeight(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LINE_HEIGHT;
  const stepped = Math.round(value / LINE_HEIGHT_STEP) * LINE_HEIGHT_STEP;
  return Number(clamp(stepped, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT).toFixed(2));
}

export function clampMargin(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PREFS.margin;
  return clamp(Math.round(value), MIN_MARGIN, MAX_MARGIN);
}

export function clampAutoScrollSpeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_AUTO_SCROLL_SPEED;
  return clamp(Math.round(value), MIN_AUTO_SCROLL_SPEED, MAX_AUTO_SCROLL_SPEED);
}

/** A largura válida mais próxima (valor salvo à mão ou de uma versão antiga). */
export function nearestWidth(value: number): ReaderWidth {
  if (!Number.isFinite(value)) return DEFAULT_PREFS.maxWidth;
  return WIDTH_CHOICES.reduce((best, candidate) =>
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best,
  );
}

function pick<T extends string>(choices: readonly T[], value: unknown, fallback: T): T {
  return choices.find((choice) => choice === value) ?? fallback;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" ? value : null;
}

/**
 * Valida o que veio do armazenamento, campo a campo: o `localStorage` pode ter lixo, ou o
 * formato antigo (só `theme` e `fontPercent`). O que faltar ou estiver inválido vira o padrão.
 */
export function parsePrefs(raw: unknown): ReaderPrefs {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_PREFS };
  const source: Record<string, unknown> = { ...raw };
  const fontPercent = readNumber(source, "fontPercent");
  const lineHeight = readNumber(source, "lineHeight");
  const width = readNumber(source, "maxWidth");
  const margin = readNumber(source, "margin");
  const speed = readNumber(source, "autoScrollSpeed");
  const columns = source.columns;
  return {
    theme: isThemeChoice(source.theme) ? source.theme : DEFAULT_PREFS.theme,
    fontPercent: fontPercent === null ? DEFAULT_PREFS.fontPercent : clampFontPercent(fontPercent),
    flow: pick(FLOWS, source.flow, DEFAULT_PREFS.flow),
    columns: COLUMN_CHOICES.find((choice) => choice === columns) ?? DEFAULT_PREFS.columns,
    maxWidth: width === null ? DEFAULT_PREFS.maxWidth : nearestWidth(width),
    margin: margin === null ? DEFAULT_PREFS.margin : clampMargin(margin),
    fontFamily: pick(FONT_FAMILIES, source.fontFamily, DEFAULT_PREFS.fontFamily),
    lineHeight: lineHeight === null ? DEFAULT_PREFS.lineHeight : clampLineHeight(lineHeight),
    justify: typeof source.justify === "boolean" ? source.justify : DEFAULT_PREFS.justify,
    autoScrollSpeed: speed === null ? DEFAULT_PREFS.autoScrollSpeed : clampAutoScrollSpeed(speed),
  };
}

/** Lê as preferências. O `localStorage` pode faltar ou conter lixo: nos dois casos valem os padrões. */
export function loadPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parsePrefs(JSON.parse(raw)) : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: ReaderPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (error) {
    // Preferência é conveniência: sem armazenamento, vale só nesta sessão.
    console.warn("não foi possível guardar as preferências do leitor", error);
  }
}

/**
 * Atributos do `<foliate-paginator>` que dependem das preferências. `null` remove o atributo e
 * devolve o padrão do foliate.
 */
export function layoutAttributes(prefs: ReaderPrefs): Record<string, string | null> {
  return {
    flow: prefs.flow === "scrolled" ? "scrolled" : null,
    "max-column-count": prefs.columns === "auto" ? null : String(prefs.columns),
    "max-inline-size": `${prefs.maxWidth}px`,
    gap: `${prefs.margin}%`,
  };
}

/**
 * Elementos que mantêm o tamanho próprio (proporcional ao `html`): títulos, índices, código.
 * Todo o resto herda o tamanho do corpo, para o texto do livro escalar mesmo quando o capítulo
 * traz `font-size: 15px` inline.
 */
const KEEP_OWN_SIZE = "h1, h2, h3, h4, h5, h6, sup, sub, small, code, pre, kbd, samp, tt, rt, rp";

/** CSS injetado em cada capítulo via `renderer.setStyles`. */
export function buildBookCss(prefs: ReaderPrefs, appTheme: AppTheme): string {
  const theme = resolveReaderTheme(prefs.theme, appTheme);
  const { background, foreground, link } = PALETTES[theme];
  const family = prefs.fontFamily === "book" ? null : FONT_STACKS[prefs.fontFamily];
  return `
    html {
      color-scheme: ${theme === "dark" ? "dark" : "light"};
      font-size: ${prefs.fontPercent}% !important;
      background: ${background} !important;
      color: ${foreground} !important;
    }
    body {
      font-size: 1rem !important;
      line-height: ${prefs.lineHeight} !important;
      ${family ? `font-family: ${family} !important;` : ""}
      background: ${background} !important;
      color: ${foreground} !important;
    }
    body :not(${KEEP_OWN_SIZE}) {
      font-size: inherit !important;
      line-height: inherit !important;
      ${family ? "font-family: inherit !important;" : ""}
    }
    ${family ? "code, pre, kbd, samp, tt { font-family: ui-monospace, Consolas, monospace !important; }" : ""}
    ${
      prefs.justify
        ? "body p, body li, body blockquote, body dd { text-align: justify !important; hyphens: auto; }"
        : ""
    }
    a:link, a:visited { color: ${link} !important; }
  `;
}
