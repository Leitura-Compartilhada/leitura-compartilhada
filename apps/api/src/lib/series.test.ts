import { describe, expect, it } from "vitest";
import { inferSeries } from "./series.js";

describe("inferSeries", () => {
  it.each([
    // título do OPF com palavra-chave de volume
    ["Lord of Mysteries - Volume 1", "Lord_of_Mysteries_Volume_1.epub", "Lord of Mysteries", 1],
    ["Lord of Mysteries - Volume 8", "x.epub", "Lord of Mysteries", 8],
    ["Harry Potter, Book 3", "x.epub", "Harry Potter", 3],
    ["A Roda do Tempo - Livro 12", "x.epub", "A Roda do Tempo", 12],
    ["Mistborn Vol. 2", "x.epub", "Mistborn", 2],
    ["Série Legal #4", "x.epub", "Série Legal", 4],
    // título sem pista, nome do arquivo com palavra-chave (e o " (1)" do download repetido)
    [
      "Lord of Mysteries - Side Story 1 e 2",
      "Lord_of_Mysteries_Volume_9 (1).epub",
      "Lord of Mysteries",
      9,
    ],
    [
      "Lord of Mysteries - Side Story 1 e 2",
      "Lord_of_Mysteries_Volume_9.epub",
      "Lord of Mysteries",
      9,
    ],
    // título com intervalo de capítulos; só o nome do arquivo traz o volume
    [
      "The Beginning After The End c1-23",
      "The Beginning After The End 1.epub",
      "The Beginning After The End",
      1,
    ],
    [
      "The Beginning After The End c348-408",
      "The Beginning After The End 10.epub",
      "The Beginning After The End",
      10,
    ],
    [
      "The Beginning After The End c457-493",
      "The Beginning After The End 12.epub",
      "The Beginning After The End",
      12,
    ],
  ])("%s + %s", (title, filename, series, index) => {
    expect(inferSeries({ title, filename })).toEqual({ series, index });
  });

  it.each([
    ["Fahrenheit 451", "Fahrenheit 451.epub"],
    ["Catch-22", "Catch 22.epub"],
    ["Duna", "Duna.epub"],
    ["Um livro qualquer", "arquivo.epub"],
    ["1984", "1984.epub"],
    // a série do nome do arquivo não bate com o título: não arrisca
    ["Outro Título", "Alguma Coisa Legal 3.epub"],
    ["Volume 3", "x.epub"],
    ["Série - Volume 500", "x.epub"],
  ])("não sugere série para %s (%s)", (title, filename) => {
    expect(inferSeries({ title, filename })).toBeNull();
  });
});
