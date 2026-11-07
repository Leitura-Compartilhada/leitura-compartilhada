export type SeriesGuess = { series: string; index: number };

/** "Série - Volume 3", "Série, Vol. 3", "Série Book 3", "Série Livro 3", "Série #3". */
const WITH_KEYWORD =
  /^(.*?\S)[\s:,_-]+(?:volume|vol\.?|book|livro|v|#)\s*\.?\s*(\d{1,3}(?:\.\d)?)\s*$/i;
/** "Série 10": só vale no nome do arquivo e com o título do livro começando pela série. */
const TRAILING_NUMBER = /^(.*\S)\s+(\d{1,2})$/;

const MAX_INDEX = 99;

/** "Lord_of_Mysteries_Volume_9 (1).epub" → "Lord of Mysteries Volume 9". */
function cleanFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  return base
    .replace(/\.epub$/i, "")
    .replace(/_+/g, " ")
    .replace(/\s*\(\d+\)\s*$/, "") // " (1)" que o navegador acrescenta a downloads repetidos
    .replace(/\s+-\s*c[óo]pia$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fromKeyword(text: string): SeriesGuess | null {
  const match = WITH_KEYWORD.exec(text);
  const series = match?.[1]?.replace(/[\s:,-]+$/, "").trim();
  const index = Number(match?.[2]);
  if (!series || !Number.isFinite(index) || index > MAX_INDEX) return null;
  return { series, index };
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * Sugere a série e o volume de um livro quando o EPUB não diz. Ordem: título com palavra-chave
 * de volume, nome do arquivo com palavra-chave, nome do arquivo terminado em número (aí o título
 * precisa começar pelo nome da série e a série ter ao menos duas palavras, para "Catch 22" ou
 * "Fahrenheit 451" não virarem série). Sem padrão claro devolve `null`: o usuário edita à mão.
 */
export function inferSeries(input: { title: string; filename: string }): SeriesGuess | null {
  const fromTitle = fromKeyword(input.title.trim());
  if (fromTitle) return fromTitle;

  const name = cleanFilename(input.filename);
  const fromName = fromKeyword(name);
  if (fromName) return fromName;

  const trailing = TRAILING_NUMBER.exec(name);
  const series = trailing?.[1]?.trim();
  const index = Number(trailing?.[2]);
  if (!series || wordCount(series) < 2 || index < 1) return null;
  if (!input.title.trim().toLocaleLowerCase().startsWith(series.toLocaleLowerCase())) return null;
  return { series, index };
}
