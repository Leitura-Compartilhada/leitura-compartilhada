import { useSyncExternalStore } from "react";

/** Preferência do usuário: seguir o sistema ou fixar claro/escuro. */
export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];
export const THEME_STORAGE_KEY = "leitura.theme";

/**
 * Cores do `<meta name="theme-color">`. `public/theme-init.js` repete estes valores (roda antes
 * do bundle, para a página não piscar); um teste confere que os dois arquivos concordam.
 */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#ffffff",
  dark: "#18181b",
};

export function parseThemeChoice(value: unknown): ThemeChoice {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ResolvedTheme {
  if (choice === "system") return systemPrefersDark ? "dark" : "light";
  return choice;
}

/** Ordem do botão: sistema → claro → escuro → sistema. */
export function nextThemeChoice(choice: ThemeChoice): ThemeChoice {
  const index = THEME_CHOICES.indexOf(choice);
  return THEME_CHOICES[(index + 1) % THEME_CHOICES.length] ?? "system";
}

export const THEME_LABELS: Record<ThemeChoice, string> = {
  system: "Automático (segue o sistema)",
  light: "Claro",
  dark: "Escuro",
};

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
  return globalThis.matchMedia?.(DARK_QUERY).matches ?? false;
}

function readStoredChoice(): ThemeChoice {
  try {
    return parseThemeChoice(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

let choice: ThemeChoice = readStoredChoice();
let resolved: ResolvedTheme = resolveTheme(choice, systemPrefersDark());
const listeners = new Set<() => void>();

function applyToDocument(theme: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

function refresh(): void {
  resolved = resolveTheme(choice, systemPrefersDark());
  applyToDocument(resolved);
  for (const listener of listeners) listener();
}

/** Muda a preferência, guarda no aparelho e aplica na hora. */
export function setThemeChoice(next: ThemeChoice): void {
  choice = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch (error) {
    // Sem armazenamento, a escolha vale só até recarregar.
    console.warn("não foi possível guardar o tema", error);
  }
  refresh();
}

// Seguir o sistema de verdade: quando ele troca (escurece à noite), o app acompanha.
globalThis.matchMedia?.(DARK_QUERY).addEventListener("change", () => {
  if (choice === "system") refresh();
});
applyToDocument(resolved);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    subscribe,
    () => choice,
    () => "system",
  );
}

/** O tema que está de fato aplicado (claro ou escuro). */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(
    subscribe,
    () => resolved,
    () => "light",
  );
}
