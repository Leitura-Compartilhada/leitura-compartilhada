import {
  AUTO_SCROLL_PAGE_SECONDS,
  AUTO_SCROLL_PX_PER_LEVEL,
  clampAutoScrollSpeed,
  type ReaderFlow,
} from "./prefs";

/** Pixels por segundo na rolagem contínua. */
export function scrollSpeedPxPerSecond(level: number): number {
  return clampAutoScrollSpeed(level) * AUTO_SCROLL_PX_PER_LEVEL;
}

/** Intervalo entre páginas no modo em páginas, em milissegundos. */
export function pageIntervalMs(level: number): number {
  return (AUTO_SCROLL_PAGE_SECONDS / clampAutoScrollSpeed(level)) * 1000;
}

/** Ritmo do "ponto de salvamento". Maior que o debounce do envio (3 s) de propósito: senão cada gravação adia o envio e o servidor nunca recebe nada durante a leitura. */
const CHECKPOINT_MS = 5_000;
/** Depois de uma pausa longa (aba escondida), não pular: conta só um quadro. */
const MAX_FRAME_MS = 250;
const FRAME_MS = 16;
/** Se o scroll andou mais que isto por fora (o usuário rolou), o controlador se ressincroniza. */
const EXTERNAL_MOVE_PX = 2;

export type AutoScrollDeps = {
  flow(): ReaderFlow;
  speedLevel(): number;
  /** O elemento que de fato rola na rolagem contínua (dentro do shadow DOM do foliate). */
  findScroller(): HTMLElement | null;
  /** Rolagem contínua: o fim do capítulo foi alcançado? */
  atChapterEnd(): boolean;
  /** Há mais livro adiante (outro capítulo, ou outra página no modo em páginas)? */
  hasMore(): boolean;
  /** Vira a página ou entra no próximo capítulo, como uma ação do usuário (grava a posição). */
  advance(): Promise<unknown>;
  /** Grava a posição atual sem andar de verdade (`next(1)`), como uma ação do usuário. */
  checkpoint(): Promise<unknown>;
  /** A rolagem automática parou sozinha (fim do livro) ou foi interrompida. */
  onStop(): void;
  /** Agendador de quadros. Em produção é `requestAnimationFrame`; nos testes, manual. */
  schedule?: (callback: (now: number) => void) => number;
  cancel?: (handle: number) => void;
};

/**
 * Rolagem automática. Na rolagem contínua move o `scrollTop` do contêiner a cada quadro (suave,
 * 60 fps). Chamar `view.next(distance)` a cada tique não serve: o foliate trava a navegação por
 * 100 ms depois de cada chamada, o que dá no máximo ~10 passos por segundo. No modo em páginas
 * vira uma página a cada N segundos, por tempo.
 */
export class AutoScroller {
  readonly #deps: AutoScrollDeps;
  #running = false;
  #handle: number | null = null;
  #last: number | null = null;
  #lastAction: number | null = null;
  #busy = false;
  #position: number | null = null;
  #lastSet = 0;

  constructor(deps: AutoScrollDeps) {
    this.#deps = deps;
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#last = null;
    this.#lastAction = null;
    this.#position = null;
    this.#busy = false;
    this.#queue();
  }

  /** Para sem avisar quem chamou (o chamador já sabe). */
  halt(): void {
    this.#running = false;
    if (this.#handle !== null) (this.#deps.cancel ?? cancelAnimationFrame)(this.#handle);
    this.#handle = null;
  }

  /** Para e avisa (`onStop`). */
  stop(): void {
    if (!this.#running) return;
    this.halt();
    this.#deps.onStop();
  }

  #queue(): void {
    this.#handle = (this.#deps.schedule ?? requestAnimationFrame)((now) => {
      this.#handle = null;
      this.tick(now);
      if (this.#running) this.#queue();
    });
  }

  /** Um quadro. Público para teste. */
  tick(now: number): void {
    if (!this.#running) return;
    const previous = this.#last ?? now - FRAME_MS;
    this.#last = now;
    this.#lastAction ??= now;
    if (this.#busy) return;
    const elapsed = Math.min(MAX_FRAME_MS, Math.max(0, now - previous));

    if (this.#deps.flow() === "scrolled") this.#tickScrolled(now, elapsed);
    else this.#tickPaginated(now);
  }

  #tickScrolled(now: number, elapsed: number): void {
    const scroller = this.#deps.findScroller();
    if (!scroller) return;
    // Se o scroll andou por fora (o usuário rolou, o foliate saltou), recomeça de onde está.
    if (
      this.#position === null ||
      Math.abs(scroller.scrollTop - this.#lastSet) > EXTERNAL_MOVE_PX
    ) {
      this.#position = scroller.scrollTop;
    }
    if (this.#deps.atChapterEnd()) {
      if (!this.#deps.hasMore()) {
        this.stop();
        return;
      }
      this.#run(() => this.#deps.advance());
      return;
    }
    this.#position += (scrollSpeedPxPerSecond(this.#deps.speedLevel()) * elapsed) / 1000;
    scroller.scrollTop = this.#position;
    this.#lastSet = scroller.scrollTop;
    if (now - (this.#lastAction ?? now) >= CHECKPOINT_MS) {
      this.#lastAction = now;
      this.#run(() => this.#deps.checkpoint());
    }
  }

  #tickPaginated(now: number): void {
    if (now - (this.#lastAction ?? now) < pageIntervalMs(this.#deps.speedLevel())) return;
    this.#lastAction = now;
    if (!this.#deps.hasMore()) {
      this.stop();
      return;
    }
    this.#run(() => this.#deps.advance());
  }

  #run(action: () => Promise<unknown>): void {
    this.#busy = true;
    void action()
      .catch((error: unknown) => {
        console.warn("falha na rolagem automática", error);
        this.stop();
      })
      .finally(() => {
        this.#busy = false;
        this.#position = null;
      });
  }
}
