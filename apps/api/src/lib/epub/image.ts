/** Tamanho máximo aceito para uma capa. */
export const MAX_COVER_BYTES = 10 * 1024 * 1024;

export type CoverImage = {
  bytes: Buffer;
  /** Extensão usada na chave do storage; também decide o `Content-Type` ao servir. */
  ext: "jpg" | "png" | "gif" | "webp";
};

export const COVER_CONTENT_TYPES: Readonly<Record<CoverImage["ext"], string>> = {
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

/**
 * Descobre o tipo da imagem pelos primeiros bytes, ignorando o que o OPF declara (alguns EPUBs
 * trazem WebP marcado como `image/jpeg`). Só JPEG, PNG, GIF e WebP: SVG fica de fora de
 * propósito, porque pode carregar script e seria servido na origem do app.
 */
export function sniffImage(bytes: Buffer): CoverImage["ext"] | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  const head = bytes.toString("latin1", 0, 6);
  if (head === "GIF87a" || head === "GIF89a") return "gif";
  if (bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    return "webp";
  }
  return null;
}
