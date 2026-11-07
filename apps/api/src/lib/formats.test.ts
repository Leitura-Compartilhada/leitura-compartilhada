import { describe, expect, it } from "vitest";
import { matchesFormat } from "./formats.js";

function mobiHead(typeAndCreator: string): Buffer {
  const head = Buffer.alloc(200);
  head.write(typeAndCreator, 60, "latin1");
  return head;
}

function zipHead(firstEntry: string): Buffer {
  const head = Buffer.alloc(200);
  head.set([0x50, 0x4b, 0x03, 0x04], 0);
  head.writeUInt16LE(Buffer.byteLength(firstEntry), 26);
  head.write(firstEntry, 30, "utf8");
  return head;
}

describe("matchesFormat", () => {
  it("reconhece MOBI/AZW3 pelo tipo e criador do cabeçalho Palm", () => {
    expect(matchesFormat(mobiHead("BOOKMOBI"), "mobi")).toBe(true);
    expect(matchesFormat(mobiHead("TEXtREAd"), "mobi")).toBe(true);
    expect(matchesFormat(mobiHead("OUTRACOISA"), "mobi")).toBe(false);
    expect(matchesFormat(Buffer.from("BOOKMOBI"), "mobi")).toBe(false); // curto demais
    expect(matchesFormat(Buffer.from("texto qualquer ".repeat(20)), "mobi")).toBe(false);
  });

  it("reconhece FB2 pela raiz, com ou sem BOM e declaração XML", () => {
    const fb2 = '<?xml version="1.0"?><FictionBook xmlns="x"><body/></FictionBook>';
    expect(matchesFormat(Buffer.from(fb2), "fb2")).toBe(true);
    expect(
      matchesFormat(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(fb2)]), "fb2"),
    ).toBe(true);
    expect(matchesFormat(Buffer.from("<html><body>oi</body></html>"), "fb2")).toBe(false);
  });

  it("reconhece DOCX por ser ZIP com [Content_Types].xml na frente", () => {
    expect(matchesFormat(zipHead("[Content_Types].xml"), "docx")).toBe(true);
    // um EPUB (primeira entrada "mimetype") ou outro ZIP com extensão .docx não passa
    expect(matchesFormat(zipHead("mimetype"), "docx")).toBe(false);
    expect(matchesFormat(zipHead("qualquer.txt"), "docx")).toBe(false);
    expect(matchesFormat(Buffer.from("PK isto não é zip de verdade"), "docx")).toBe(false);
  });

  it.each(["txt", "md", "html"] as const)("%s: texto passa, binário e vazio não", (format) => {
    expect(matchesFormat(Buffer.from("Olá, mundo!\nSegunda linha.\n"), format)).toBe(true);
    expect(matchesFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]), format)).toBe(false);
    expect(matchesFormat(Buffer.alloc(0), format)).toBe(false);
    // UTF-16 sem BOM tem bytes nulos: recusado; com BOM é texto que o Calibre lê
    expect(matchesFormat(Buffer.from("o\0l\0á\0", "latin1"), format)).toBe(false);
    expect(matchesFormat(Buffer.from([0xff, 0xfe, 0x6f, 0x00, 0x6c, 0x00]), format)).toBe(true);
  });

  it("um PDF não passa como nenhum formato de texto", () => {
    const pdf = Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n\0\0 conteúdo binário");
    for (const format of ["mobi", "fb2", "docx", "txt", "md", "html"] as const) {
      expect(matchesFormat(pdf, format), format).toBe(false);
    }
  });
});
