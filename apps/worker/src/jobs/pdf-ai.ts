export const QUEUE_PDF_AI = "book.pdf-ai";

// TODO(F6): dividir o PDF em lotes de páginas, enviar à Claude API (PDF_AI_MODEL),
// receber capítulos em XHTML limpo, montar o EPUB e enfileirar a ingestão.
export async function pdfAiJob(_data: unknown): Promise<void> {
  console.log("[pdf-ai] não implementado");
}
