import { makeTextSnippet, type ReadingPosition } from "@leitura/shared";
import type { ProgressInput } from "@/lib/sync";
import { isRelocateReason, ProgressGate, type RelocateReason } from "./progress-gate";
import { type ReaderPort, type RestoreOutcome, restorePosition } from "./restore";

/** O que a sessão precisa do `<foliate-view>`: o renderer (eventos) e a última posição. */
export type SessionView = {
  renderer: EventTarget;
  lastLocation:
    | { fraction?: number; cfi: string; range?: { toString(): string } }
    | null
    | undefined;
};

export type SessionDeps = {
  bookId: string;
  fileHash: string;
  /** Grava no Dexie e na outbox. */
  record: (bookId: string, input: ProgressInput) => Promise<unknown>;
  /** Chamado depois de cada gravação (agenda o envio com debounce). */
  afterSave: () => void;
};

/** O `reason` vem de código de terceiros: confere antes de confiar. */
function readReason(detail: unknown): RelocateReason {
  if (typeof detail !== "object" || detail === null || !("reason" in detail)) return null;
  return isRelocateReason(detail.reason) ? detail.reason : null;
}

/**
 * Uma sessão de leitura: restaura a posição e grava o progresso. Escuta o `relocate` do
 * **renderer** (só ele traz o `reason`) e lê `view.lastLocation`, que o `<foliate-view>` já
 * atualizou: ele registrou o ouvinte dele em `open()`, antes de a sessão registrar o dela.
 * Crie a sessão depois de `view.open()`.
 */
export class ReaderSession {
  readonly #view: SessionView;
  readonly #port: ReaderPort;
  readonly #deps: SessionDeps;
  readonly #gate = new ProgressGate();
  #saving: Promise<void> = Promise.resolve();
  #disposed = false;
  readonly #onRelocate = (event: Event) => {
    this.handleRelocate(event instanceof CustomEvent ? readReason(event.detail) : null);
  };

  constructor(view: SessionView, port: ReaderPort, deps: SessionDeps) {
    this.#view = view;
    this.#port = port;
    this.#deps = deps;
    view.renderer.addEventListener("relocate", this.#onRelocate);
  }

  /** Restaura a posição. Nada é gravado enquanto isso corre, nem se todos os passos falharem. */
  async restore(saved: ReadingPosition | null): Promise<RestoreOutcome> {
    this.#gate.beginRestore();
    try {
      return await restorePosition(this.#port, saved, this.#deps.fileHash);
    } finally {
      this.#gate.finishRestore(saved?.cfi ?? null);
    }
  }

  /**
   * Executa um salto pedido pelo usuário (sumário, barra de progresso, botões de página).
   * O `relocate` de "navigation" que ele causa vale como leitura e é gravado.
   */
  async userJump(action: () => Promise<unknown>): Promise<void> {
    this.#gate.markUserAction();
    try {
      await action();
    } finally {
      this.#gate.clearUserAction();
    }
  }

  /** Público para teste: o que fazer com um `relocate` de motivo `reason`. */
  handleRelocate(reason: RelocateReason): void {
    if (this.#disposed) return;
    const location = this.#view.lastLocation;
    if (!location || typeof location.fraction !== "number") return;
    if (!this.#gate.shouldPersist(reason, location.cfi)) return;

    const input: ProgressInput = {
      cfi: location.cfi,
      percentage: Math.min(1, Math.max(0, location.fraction)),
      textSnippet: makeTextSnippet(location.range?.toString() ?? ""),
      fileHash: this.#deps.fileHash,
      status: "reading",
    };
    this.#saving = this.#saving
      .then(() => this.#deps.record(this.#deps.bookId, input))
      .then(() => this.#deps.afterSave())
      .catch((error: unknown) => {
        console.error("não foi possível gravar o progresso", error);
      });
  }

  /** Espera as gravações pendentes. */
  settled(): Promise<void> {
    return this.#saving;
  }

  dispose(): Promise<void> {
    this.#disposed = true;
    this.#view.renderer.removeEventListener("relocate", this.#onRelocate);
    return this.#saving;
  }
}
