import { describe, expect, it } from "vitest";
import { titleFromFilename } from "./title.js";

describe("titleFromFilename", () => {
  it("troca underscores por espaços e tira a extensão", () => {
    expect(titleFromFilename("Lord_of_Mysteries_Volume_1.epub")).toBe("Lord of Mysteries Volume 1");
  });

  it("mantém o sufixo de cópia", () => {
    expect(titleFromFilename("Lord_of_Mysteries_Volume_9 (1).epub")).toBe(
      "Lord of Mysteries Volume 9 (1)",
    );
  });

  it("aceita nomes com espaços e extensão em maiúsculas", () => {
    expect(titleFromFilename("The Beginning After The End 10.EPUB")).toBe(
      "The Beginning After The End 10",
    );
  });

  it("ignora o caminho que vier junto do nome", () => {
    expect(titleFromFilename("C:\\livros\\sub\\Meu_Livro.epub")).toBe("Meu Livro");
    expect(titleFromFilename("../../etc/Meu_Livro.epub")).toBe("Meu Livro");
  });

  it("usa um título padrão quando não sobra nada", () => {
    expect(titleFromFilename(".epub")).toBe("Sem título");
    expect(titleFromFilename("___.epub")).toBe("Sem título");
    expect(titleFromFilename("")).toBe("Sem título");
  });
});
