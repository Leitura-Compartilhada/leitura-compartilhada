import { describe, expect, it } from "vitest";
import { apiErrorSchema, configResponseSchema, progressResponseSchema } from "./api.js";
import {
  bookSchema,
  listBooksResponseSchema,
  normalizeTag,
  updateBookRequestSchema,
} from "./books.js";
import { MAX_SYNC_ITEMS } from "./constants.js";
import {
  CONVERTIBLE_ACCEPT,
  conversionJobSchema,
  convertibleFormatOf,
  extensionOf,
} from "./conversions.js";
import type { ReadingState } from "./reading.js";
import { createShelfRequestSchema, shelfSchema, updateShelfRequestSchema } from "./shelves.js";
import { syncRequestSchema, syncResponseSchema } from "./sync.js";

const BOOK_ID = "0b6f0e4e-3f0e-4b7a-9d38-6a2f6f1d2c11";

const state: ReadingState = {
  bookId: BOOK_ID,
  status: "reading",
  cfi: "epubcfi(/6/4!/4/2)",
  percentage: 0.5,
  textSnippet: "um trecho qualquer do livro",
  fileHash: "a".repeat(64),
  deviceId: "device-1",
  updatedAt: 1_000,
};

describe("contrato compartilhado entre web e API", () => {
  it("aceita um pedido de sync válido", () => {
    const pedido = { deviceId: "d", since: 0, readingStates: [state], annotations: [] };
    expect(syncRequestSchema.safeParse(pedido).success).toBe(true);
  });

  it("rejeita sync com itens demais", () => {
    const demais = Array.from({ length: MAX_SYNC_ITEMS + 1 }, () => state);
    const pedido = { deviceId: "d", since: 0, readingStates: demais, annotations: [] };
    expect(syncRequestSchema.safeParse(pedido).success).toBe(false);
  });

  it("rejeita cursor negativo e percentual fora de 0 a 1", () => {
    const base = { deviceId: "d", readingStates: [], annotations: [] };
    expect(syncRequestSchema.safeParse({ ...base, since: -1 }).success).toBe(false);
    const fora = { ...base, since: 0, readingStates: [{ ...state, percentage: 1.2 }] };
    expect(syncRequestSchema.safeParse(fora).success).toBe(false);
  });

  it("rejeita bookId que não é UUID", () => {
    const pedido = {
      deviceId: "d",
      since: 0,
      readingStates: [{ ...state, bookId: "nao-e-uuid" }],
      annotations: [],
    };
    expect(syncRequestSchema.safeParse(pedido).success).toBe(false);
  });

  it("a resposta de sync traz cursor e serverTime", () => {
    const ok = syncResponseSchema.safeParse({
      cursor: 10,
      serverTime: 20,
      readingStates: [state],
      rejected: [{ bookId: BOOK_ID, code: "NOT_FOUND" }],
      annotations: [],
    });
    expect(ok.success).toBe(true);
    expect(
      syncResponseSchema.safeParse({
        cursor: 10,
        readingStates: [],
        rejected: [],
        annotations: [],
      }).success,
    ).toBe(false);
  });

  it("exige hash em hexadecimal e limita cfi e deviceId", () => {
    const base = { deviceId: "d", since: 0, annotations: [] };
    const com = (parte: object) => ({ ...base, readingStates: [{ ...state, ...parte }] });
    expect(syncRequestSchema.safeParse(com({ fileHash: "curto" })).success).toBe(false);
    expect(syncRequestSchema.safeParse(com({ fileHash: "A".repeat(64) })).success).toBe(false);
    expect(syncRequestSchema.safeParse(com({ cfi: "x".repeat(2049) })).success).toBe(false);
    expect(syncRequestSchema.safeParse(com({ cfi: "" })).success).toBe(false);
    expect(syncRequestSchema.safeParse(com({ deviceId: "com espaço" })).success).toBe(false);
    expect(syncRequestSchema.safeParse(com({ deviceId: "d".repeat(65) })).success).toBe(false);
    expect(syncRequestSchema.safeParse(com({ updatedAt: -1 })).success).toBe(false);
    expect(syncRequestSchema.safeParse(com({})).success).toBe(true);
  });

  it("valida livro e listagem", () => {
    const livro = {
      id: BOOK_ID,
      title: "Lord of Mysteries Volume 1",
      authors: [],
      fileHash: "a".repeat(64),
      fileSize: 1_300_000,
      sourceFormat: "epub",
      hasCover: false,
      status: "want_to_read",
      series: null,
      seriesIndex: null,
      tags: [],
      shelfIds: [],
      createdAt: 1_000,
      percentage: null,
    };
    expect(bookSchema.safeParse(livro).success).toBe(true);
    expect(listBooksResponseSchema.safeParse({ books: [livro] }).success).toBe(true);
    expect(bookSchema.safeParse({ ...livro, percentage: 2 }).success).toBe(false);
    expect(bookSchema.safeParse({ ...livro, hasCover: true }).success).toBe(true);
    expect(bookSchema.safeParse({ ...livro, hasCover: undefined }).success).toBe(false);
    expect(bookSchema.safeParse({ ...livro, status: "lendo" }).success).toBe(false);
    expect(bookSchema.safeParse({ ...livro, shelfIds: ["não-é-uuid"] }).success).toBe(false);
    const daSerie = { ...livro, series: "Lord of Mysteries", seriesIndex: 1, tags: ["fantasia"] };
    expect(bookSchema.safeParse(daSerie).success).toBe(true);
  });

  it("valida a edição de um livro", () => {
    const ok = (value: unknown) => updateBookRequestSchema.safeParse(value).success;
    expect(ok({ title: "  Novo título  " })).toBe(true);
    expect(ok({ series: null, seriesIndex: null })).toBe(true);
    expect(ok({ status: "read", tags: ["a", "b"], shelfIds: [BOOK_ID] })).toBe(true);
    expect(updateBookRequestSchema.parse({ title: "  x  " }).title).toBe("x");
    // vazio, campo desconhecido e valores fora dos limites
    expect(ok({})).toBe(false);
    expect(ok({ owner: "outro" })).toBe(false);
    expect(ok({ title: "   " })).toBe(false);
    expect(ok({ title: "x".repeat(301) })).toBe(false);
    expect(ok({ authors: Array(21).fill("a") })).toBe(false);
    expect(ok({ seriesIndex: -1 })).toBe(false);
    expect(ok({ seriesIndex: 10_001 })).toBe(false);
    expect(ok({ status: "lido" })).toBe(false);
    expect(ok({ tags: Array(21).fill("a") })).toBe(false);
    expect(ok({ tags: ["x".repeat(41)] })).toBe(false);
    expect(ok({ shelfIds: ["não-é-uuid"] })).toBe(false);
  });

  it("normaliza tags", () => {
    expect(normalizeTag("  Ficção   Científica ")).toBe("ficção científica");
    expect(normalizeTag("FANTASIA")).toBe("fantasia");
    // "é" decomposto (e + acento) vira o mesmo "é"; invisíveis somem
    expect(normalizeTag("café")).toBe(normalizeTag("café"));
    expect(normalizeTag("a​b")).toBe("ab");
  });

  it("recusa texto sem caractere visível e normaliza para NFC", () => {
    const ok = (value: unknown) => updateBookRequestSchema.safeParse(value);
    expect(ok({ tags: ["​​"] }).success).toBe(false);
    expect(ok({ title: "⁠ " }).success).toBe(false);
    expect(createShelfRequestSchema.safeParse({ name: "​" }).success).toBe(false);
    expect(createShelfRequestSchema.parse({ name: "café" }).name).toBe("café");
    expect(ok({ title: "ti​tulo" }).success && ok({ title: "ti​tulo" }).data?.title).toBe("titulo");
  });

  it("valida estantes", () => {
    const shelf = { id: BOOK_ID, name: "Favoritos", position: 0, bookCount: 3 };
    expect(shelfSchema.safeParse(shelf).success).toBe(true);
    expect(shelfSchema.safeParse({ ...shelf, bookCount: -1 }).success).toBe(false);
    expect(createShelfRequestSchema.safeParse({ name: "  Fantasia " }).success).toBe(true);
    expect(createShelfRequestSchema.safeParse({ name: " " }).success).toBe(false);
    expect(createShelfRequestSchema.safeParse({ name: "x".repeat(61) }).success).toBe(false);
    expect(updateShelfRequestSchema.safeParse({}).success).toBe(false);
    expect(updateShelfRequestSchema.safeParse({ position: 2 }).success).toBe(true);
    expect(updateShelfRequestSchema.safeParse({ position: -1 }).success).toBe(false);
  });

  it("erros usam códigos conhecidos", () => {
    expect(apiErrorSchema.safeParse({ error: { code: "NOT_FOUND", message: "x" } }).success).toBe(
      true,
    );
    expect(apiErrorSchema.safeParse({ error: { code: "FORBIDDEN", message: "x" } }).success).toBe(
      false,
    );
  });

  it("config e progresso", () => {
    expect(configResponseSchema.safeParse({ allowSignup: false }).success).toBe(true);
    expect(progressResponseSchema.safeParse({ readingState: null }).success).toBe(true);
    expect(progressResponseSchema.safeParse({ readingState: state }).success).toBe(true);
  });

  it("reconhece o formato de conversão pela extensão", () => {
    expect(convertibleFormatOf("Livro.MOBI")).toBe("mobi");
    expect(convertibleFormatOf("Livro.azw3")).toBe("mobi");
    expect(convertibleFormatOf("a.b.c.fb2")).toBe("fb2");
    expect(convertibleFormatOf("notas.markdown")).toBe("md");
    expect(convertibleFormatOf("pagina.htm")).toBe("html");
    expect(convertibleFormatOf("texto.txt")).toBe("txt");
    expect(convertibleFormatOf("relatorio.docx")).toBe("docx");
    // epub não é convertido (vai direto), pdf fica para a F6, e nome sem extensão não conta
    for (const name of ["livro.epub", "livro.pdf", "livro", ".mobi", "livro.", "livro.exe"]) {
      expect(convertibleFormatOf(name), name).toBeNull();
    }
    expect(extensionOf("C:pastaLivro.TXT")).toBe("txt");
    expect(CONVERTIBLE_ACCEPT).toContain(".azw3");
    expect(CONVERTIBLE_ACCEPT).not.toContain("epub");
  });

  it("valida o job de conversão", () => {
    const job = {
      id: BOOK_ID,
      filename: "Livro.mobi",
      sourceFormat: "mobi",
      status: "failed",
      errorCode: "DRM",
      bookId: null,
      createdAt: 1,
      updatedAt: 2,
      finishedAt: 3,
    };
    expect(conversionJobSchema.safeParse(job).success).toBe(true);
    expect(conversionJobSchema.safeParse({ ...job, errorCode: "OUTRO" }).success).toBe(false);
    expect(conversionJobSchema.safeParse({ ...job, sourceFormat: "pdf" }).success).toBe(false);
    expect(conversionJobSchema.safeParse({ ...job, status: "ingesting" }).success).toBe(false);
  });
});
