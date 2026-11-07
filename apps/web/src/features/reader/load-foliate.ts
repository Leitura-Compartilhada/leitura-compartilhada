import type { View } from "@/vendor/foliate-js/view.js";

export type FoliateView = View;

let loading: Promise<void> | null = null;

/**
 * Carrega o foliate-js sob demanda (registra o elemento `<foliate-view>`). O resto do app não
 * paga o custo de bytes da biblioteca enquanto o usuário não abre um livro.
 */
export function loadFoliate(): Promise<void> {
  loading ??= import("@/vendor/foliate-js/view.js").then(() => undefined);
  return loading;
}
