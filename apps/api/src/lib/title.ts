const FALLBACK_TITLE = "Sem título";

/**
 * Título provisório a partir do nome do arquivo (a leitura do OPF chega na F2).
 * "Lord_of_Mysteries_Volume_9 (1).epub" vira "Lord of Mysteries Volume 9 (1)".
 */
export function titleFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const title = base
    .replace(/\.epub$/i, "")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title === "" ? FALLBACK_TITLE : title;
}
