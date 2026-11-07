import { ZipArchive } from "./zip.js";

/** Abaixo disto de caracteres visíveis o livro é considerado vazio. */
const MIN_VISIBLE_CHARS = 20;
const MAX_DOCUMENTS = 60;
const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const DOCUMENT = /\.(?:x?html?)$/i;
// Sumário (nav/toc) lista títulos e não é leitura; páginas de capa só têm imagem.
const NOT_CONTENT = /(?:^|\/)(?:nav|toc|titlepage|cover)[^/]*$/i;

/**
 * Quantas letras e números visíveis tem um documento (X)HTML, sem tags, scripts, estilos nem
 * entidades. Varredura linear: uma regex preguiçosa `<script ... </script>` seria quadrática
 * diante de muitos `<script` sem fechamento.
 */
function visibleChars(markup: string): number {
  const lower = markup.toLowerCase();
  let text = "";
  let position = 0;
  while (position < markup.length) {
    const open = markup.indexOf("<", position);
    if (open < 0) {
      text += markup.slice(position);
      break;
    }
    text += `${markup.slice(position, open)} `;
    const raw = /^<(script|style)\b/.exec(lower.slice(open, open + 10));
    // script e style: pula até o fechamento; se não fechar, descarta o resto do documento
    const close = raw ? lower.indexOf(`</${raw[1]}`, open) : -1;
    if (raw && close < 0) break;
    const tagEnd = markup.indexOf(">", close >= 0 ? close : open);
    position = tagEnd < 0 ? markup.length : tagEnd + 1;
  }
  const letters = text.replace(/&[a-z0-9#]+;/gi, " ").match(/[\p{L}\p{N}]/gu);
  return letters?.length ?? 0;
}

/**
 * O EPUB tem texto de verdade? O Calibre devolve sucesso (código 0) com um livro vazio quando não
 * entende a entrada (um FB2 com o namespace errado, por exemplo), e esse livro não pode entrar na
 * estante. Lê os documentos até somar o mínimo de caracteres visíveis, sem ler o livro inteiro.
 * Em caso de dúvida (ZIP ilegível) devolve `false`.
 */
export function hasReadableText(epub: Buffer): boolean {
  try {
    const zip = ZipArchive.open(epub);
    const documents = zip
      .names()
      .filter((name) => DOCUMENT.test(name) && !NOT_CONTENT.test(name))
      .slice(0, MAX_DOCUMENTS);
    let total = 0;
    for (const name of documents) {
      try {
        const bytes = zip.read(name, MAX_DOCUMENT_BYTES);
        if (bytes) total += visibleChars(bytes.toString("utf8"));
      } catch {
        // documento corrompido: os outros ainda podem ter texto
      }
      if (total >= MIN_VISIBLE_CHARS) return true;
    }
    return false;
  } catch {
    return false;
  }
}
