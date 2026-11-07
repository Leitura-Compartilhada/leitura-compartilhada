import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  nextThemeChoice,
  parseThemeChoice,
  resolveTheme,
  THEME_COLORS,
  THEME_STORAGE_KEY,
} from "./theme";

describe("tema do app", () => {
  it("resolve 'system' pelo sistema e respeita a escolha fixa", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("cai em 'system' com valor inválido", () => {
    expect(parseThemeChoice("roxo")).toBe("system");
    expect(parseThemeChoice(null)).toBe("system");
    expect(parseThemeChoice("dark")).toBe("dark");
  });

  it("gira sistema, claro, escuro", () => {
    expect(nextThemeChoice("system")).toBe("light");
    expect(nextThemeChoice("light")).toBe("dark");
    expect(nextThemeChoice("dark")).toBe("system");
  });

  it("o script de pré-carga usa a mesma chave e as mesmas cores do módulo", () => {
    const file = path.join(import.meta.dirname, "../../public/theme-init.js");
    const script = readFileSync(file, "utf8");
    expect(script).toContain(`"${THEME_STORAGE_KEY}"`);
    expect(script).toContain(THEME_COLORS.dark);
    expect(script).toContain(THEME_COLORS.light);
  });
});
