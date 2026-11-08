import { describe, expect, it } from "vitest";
import { headerTitle } from "./header-title";

describe("headerTitle", () => {
  it("mostra o capítulo quando o livro tem sumário", () => {
    expect(headerTitle("Capítulo 2", "Meu livro", 5)).toBe("Capítulo 2");
  });

  it("cai para o título se o capítulo é desconhecido", () => {
    expect(headerTitle(null, "Meu livro", 5)).toBe("Meu livro");
  });

  it("com sumário de 1 item (livro convertido) mostra o título, não o item único", () => {
    expect(headerTitle("Começar", "Anotacoes", 1)).toBe("Anotacoes");
  });

  it("sem sumário mostra o título", () => {
    expect(headerTitle("Qualquer coisa", "Meu livro", 0)).toBe("Meu livro");
  });
});
