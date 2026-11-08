/**
 * Título do cabeçalho do leitor: o capítulo atual, mas só quando o livro tem um sumário de verdade.
 * Livros convertidos de TXT ou Markdown saem do Calibre com um único item ("Start", traduzido como
 * "Começar"); com 0 ou 1 item o capítulo não diz nada, então mostramos o título do livro.
 */
export function headerTitle(chapter: string | null, bookTitle: string, tocLength: number): string {
  if (tocLength <= 1) return bookTitle;
  return chapter ?? bookTitle;
}
