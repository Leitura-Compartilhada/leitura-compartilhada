/**
 * Motivos de `relocate` do renderer do foliate (paginator.js). Só os três primeiros vêm de uma
 * ação de leitura (virar página, rolar). Os demais são navegação programática ou redimensionamento.
 */
export const RELOCATE_REASONS = [
  "page",
  "scroll",
  "snap",
  "navigation",
  "anchor",
  "selection",
] as const;
/** `null` aparece no modo rolagem, quando o app pede `prev`/`next`. */
export type RelocateReason = (typeof RELOCATE_REASONS)[number] | null;

export function isRelocateReason(value: unknown): value is (typeof RELOCATE_REASONS)[number] {
  return RELOCATE_REASONS.some((reason) => reason === value);
}

const READING_REASONS: ReadonlySet<RelocateReason> = new Set(["page", "scroll", "snap"]);

/**
 * Decide quais `relocate` viram progresso salvo. Regra bloqueante: a restauração, o
 * redimensionamento e saltos programáticos NÃO podem gravar. Uma restauração que falhou
 * gravaria "primeira página" com horário novo e apagaria a posição boa; e cada ida e volta
 * entre aparelhos faria a posição andar para trás.
 */
export class ProgressGate {
  #restoring = true;
  /**
   * Quantas ações do usuário (virar página, saltar) estão em andamento. É um contador, e não um
   * booleano, porque as ações se sobrepõem: ao segurar a seta, a segunda tecla é descartada pelo
   * foliate durante a animação e termina na hora. Com um booleano, ela apagaria a marca da
   * primeira, e o `relocate` que atravessa o capítulo chegaria sem marca e não seria gravado.
   */
  #pendingUserActions = 0;
  #lastSavedCfi: string | null = null;

  /** O leitor volta a "restaurando" (ao abrir outro livro, por exemplo). */
  beginRestore(): void {
    this.#restoring = true;
    this.#pendingUserActions = 0;
  }

  /** `restoredCfi`: a posição que já está salva, para não regravar o mesmo CFI. */
  finishRestore(restoredCfi: string | null): void {
    this.#restoring = false;
    this.#pendingUserActions = 0;
    this.#lastSavedCfi = restoredCfi;
  }

  /**
   * O usuário pediu o salto (sumário, barra de progresso, botão de página). Chame antes de
   * `goTo`: o `relocate` de reason "navigation" que se segue passa a valer como leitura.
   */
  markUserAction(): void {
    this.#pendingUserActions += 1;
  }

  /** Terminou um salto pedido. Quando o último termina, a marca some e não vaza para depois. */
  clearUserAction(): void {
    this.#pendingUserActions = Math.max(0, this.#pendingUserActions - 1);
  }

  shouldPersist(reason: RelocateReason, cfi: string): boolean {
    if (this.#restoring) return false;
    // `null` é a rolagem pedida por `next()`/`prev()` no modo de rolagem contínua; como
    // `navigation`, só vale durante uma ação do usuário.
    const fromUserJump =
      (reason === "navigation" || reason === null) && this.#pendingUserActions > 0;
    if (!READING_REASONS.has(reason) && !fromUserJump) return false;
    if (cfi === this.#lastSavedCfi) return false;
    this.#lastSavedCfi = cfi;
    return true;
  }
}
