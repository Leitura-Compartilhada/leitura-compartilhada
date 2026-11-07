import { MAX_HASH_BYTES } from "./import-model";

/**
 * SHA-256 do arquivo em hexadecimal, ou `null` quando não dá para calcular (arquivo grande demais,
 * contexto sem `crypto.subtle`, falha de leitura). `null` vira "não conferido", nunca um erro.
 */
export async function sha256Hex(file: File): Promise<string | null> {
  if (file.size > MAX_HASH_BYTES || !globalThis.crypto?.subtle) return null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  } catch {
    return null;
  }
}
