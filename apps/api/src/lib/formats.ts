import type { ConvertibleFormat } from "@leitura/shared";
import { ZipArchive } from "./epub/zip.js";

/** Quantos bytes do começo do arquivo bastam para reconhecer o formato. */
export const SNIFF_BYTES = 8 * 1024;

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

const startsWith = (bytes: Buffer, signature: number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte);

/** MOBI, AZW e AZW3 são bancos de dados Palm: tipo e criador (8 bytes) ficam no offset 60. */
function isMobi(head: Buffer): boolean {
  if (head.length < 68) return false;
  const typeAndCreator = head.toString("latin1", 60, 68);
  return typeAndCreator === "BOOKMOBI" || typeAndCreator === "TEXtREAd";
}

/** FB2 é XML com a raiz `<FictionBook>`; aceita BOM e qualquer codificação ASCII-compatível. */
function isFb2(head: Buffer): boolean {
  return head.toString("latin1").includes("<FictionBook");
}

/**
 * DOCX é um ZIP cuja primeira entrada é `[Content_Types].xml` (assim o Word, o LibreOffice e o
 * Google Docs gravam). Um ZIP qualquer, ou um EPUB com a extensão trocada, não passa.
 */
function isDocx(head: Buffer): boolean {
  if (!startsWith(head, ZIP_SIGNATURE)) return false;
  const nameLength = head.readUInt16LE(26);
  return head.toString("utf8", 30, 30 + nameLength) === "[Content_Types].xml";
}

/**
 * Texto puro: sem NUL (binário) e sem UTF-16 sem marca. Aceita UTF-16 apenas com BOM, que o
 * Calibre lê. Serve para TXT, Markdown e HTML.
 */
function isText(head: Buffer): boolean {
  const utf16Bom = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff);
  if (utf16Bom) return true;
  return !head.includes(0x00);
}

/** O começo do arquivo corresponde ao formato que o nome diz? Não confia só na extensão. */
export function matchesFormat(head: Buffer, format: ConvertibleFormat): boolean {
  if (head.length === 0) return false;
  switch (format) {
    case "mobi":
      return isMobi(head);
    case "fb2":
      return isFb2(head);
    case "docx":
      return isDocx(head);
    case "txt":
    case "md":
    case "html":
      return isText(head);
  }
}

/** Descomprimido acima disto, ou mais de 200× o tamanho do arquivo, é tratado como ZIP bomb. */
const MAX_EXPANDED_BYTES = 500 * 1024 * 1024;
const MAX_EXPANSION_RATIO = 200;

/** O ZIP (DOCX) é lido por inteiro pelo Calibre: recusa os que se expandem demais. */
export function isSafeZipExpansion(zip: Buffer): boolean {
  try {
    const { size, compressedSize } = ZipArchive.open(zip).stats();
    if (size > MAX_EXPANDED_BYTES) return false;
    return size <= Math.max(compressedSize, 1) * MAX_EXPANSION_RATIO || size < 1024 * 1024;
  } catch {
    return false;
  }
}
