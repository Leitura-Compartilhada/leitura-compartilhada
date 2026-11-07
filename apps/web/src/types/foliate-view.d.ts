/**
 * Tipos mínimos do foliate-js (código de terceiros em JS, vendored). Cobrem só o que o app usa.
 * Fonte: apps/web/src/vendor/foliate-js/view.js e paginator.js.
 */

declare module "*/foliate-js/view.js" {
  export type FoliateTocItem = {
    label: string;
    href: string;
    subitems?: FoliateTocItem[] | null;
  };

  /** `lastLocation` do `<foliate-view>`. `fraction` é do livro inteiro (SectionProgress). */
  export type FoliateLocation = {
    fraction?: number;
    section?: { current: number; total: number };
    tocItem?: FoliateTocItem | null;
    cfi: string;
    range?: Range;
  };

  /** Alvo resolvido por `resolveNavigation`. `anchor` devolve um Range/Element (EPUB) ou fração. */
  export type FoliateResolved = {
    index: number;
    anchor?: ((doc: Document) => Range | Element | number) | number;
  };

  export type FoliateRelocateReason =
    | "page"
    | "scroll"
    | "snap"
    | "navigation"
    | "anchor"
    | "selection"
    | null;

  /** Detalhe do evento `relocate` do renderer (o do `<foliate-view>` traz `FoliateLocation`). */
  export type FoliateRendererRelocate = {
    reason: FoliateRelocateReason;
    range: Range;
    index: number;
    fraction?: number;
    size?: number;
  };

  export type FoliateSearchResult =
    | "done"
    | { cfi: string; excerpt: { pre: string; match: string; post: string } }
    | { progress: number }
    | { label: string; subitems: { cfi: string }[] };

  export type FoliateBook = {
    sections: unknown[];
    toc?: FoliateTocItem[];
    metadata?: { title?: string | Record<string, string> };
    dir?: string;
  };

  export class View extends HTMLElement {
    book: FoliateBook;
    lastLocation: FoliateLocation | null | undefined;
    renderer: HTMLElement & {
      setStyles(css: string | [string, string]): void;
      getContents(): { index: number; doc: Document }[];
      setAttribute(name: string, value: string): void;
      removeAttribute(name: string): void;
      /** Posição de rolagem (px), tamanho do capítulo e da janela; na rolagem contínua é vertical. */
      readonly start: number;
      readonly end: number;
      readonly size: number;
      readonly viewSize: number;
      readonly atStart: boolean;
      readonly atEnd: boolean;
    };
    open(book: File | Blob | string): Promise<void>;
    close(): void;
    init(opts: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
    resolveNavigation(target: string | number | { fraction: number }): FoliateResolved | undefined;
    goTo(target: string | number | { fraction: number }): Promise<FoliateResolved | undefined>;
    goToFraction(fraction: number): Promise<void>;
    search(opts: { query: string; index?: number }): AsyncGenerator<FoliateSearchResult>;
    clearSearch(): void;
    prev(distance?: number): Promise<void>;
    next(distance?: number): Promise<void>;
    goLeft(): Promise<void>;
    goRight(): Promise<void>;
  }
}
