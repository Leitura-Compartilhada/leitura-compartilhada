import type { Book } from "../../packages/shared/src/index.js";
import { SYNTHETIC_EPUB, signUp, uniqueEmail, uploadEpub } from "../fixtures/account.js";
import { expect, test } from "../fixtures/devtools.js";
import { paragraphText, REPEATED_SENTENCE } from "../fixtures/make-epub.mjs";
import { openBook } from "../fixtures/reader.js";

// O foliate NÃO lança erro quando o CFI não resolve: cai calado na primeira página. Estes testes
// provam que o app percebe isso e usa o trecho de texto, depois o percentual.
const CFIS_QUE_NAO_RESOLVEM = {
  "seção que não existe": "epubcfi(/6/999!/4/2/1:0)",
  "CFI que nem faz parse": "epubcfi(isto-nao-e-um-cfi",
  "deslocamento inválido": "epubcfi(/6/2!/4/2/1:99999)",
} as const;

test.describe("restauração com fallback", () => {
  async function bookWithSavedPosition(
    desktop: Parameters<Parameters<typeof test>[2]>[0]["desktop"],
    baseURL: string,
    saved: { cfi: string; textSnippet: string; percentage: number },
  ): Promise<Book> {
    await signUp(desktop.context.request, uniqueEmail(), baseURL);
    const { book } = await uploadEpub(desktop.context.request, SYNTHETIC_EPUB);
    const gravado = await desktop.context.request.post("/api/sync", {
      data: {
        deviceId: "outro-aparelho",
        since: 0,
        annotations: [],
        readingStates: [
          {
            bookId: book.id,
            status: "reading",
            fileHash: book.fileHash,
            deviceId: "outro-aparelho",
            updatedAt: Date.now(),
            ...saved,
          },
        ],
      },
    });
    expect(gravado.status()).toBe(200);
    return book;
  }

  for (const [nome, cfi] of Object.entries(CFIS_QUE_NAO_RESOLVEM)) {
    test(`CFI com ${nome}: cai para o trecho de texto`, async ({ desktop, baseURL }) => {
      // O foliate escreve o erro no console ao falhar; aqui isso é esperado.
      desktop.watcher.allowConsoleError(/./);
      const book = await bookWithSavedPosition(desktop, baseURL ?? "", {
        cfi,
        textSnippet: paragraphText(2, 17),
        percentage: 0.2,
      });

      const texto = await openBook(desktop.page, book.id);
      expect(texto).toContain("marcador-c2-p17");
    });
  }

  test("trecho repetido em todos os capítulos: escolhe o da seção mais perto do percentual", async ({
    desktop,
    baseURL,
  }) => {
    desktop.watcher.allowConsoleError(/./);
    const book = await bookWithSavedPosition(desktop, baseURL ?? "", {
      cfi: CFIS_QUE_NAO_RESOLVEM["seção que não existe"],
      textSnippet: REPEATED_SENTENCE,
      percentage: 0.9, // fim do livro: capítulo 3
    });

    const texto = await openBook(desktop.page, book.id);
    expect(texto).toContain(REPEATED_SENTENCE);
    // Os parágrafos vizinhos mostram em qual capítulo a página caiu.
    expect(texto).toMatch(/Capítulo 3, parágrafo (9|11)/);
  });

  test("sem CFI nem trecho útil, usa o percentual", async ({ desktop, baseURL }) => {
    desktop.watcher.allowConsoleError(/./);
    const book = await bookWithSavedPosition(desktop, baseURL ?? "", {
      cfi: CFIS_QUE_NAO_RESOLVEM["seção que não existe"],
      textSnippet: "curto",
      percentage: 0.9,
    });

    const texto = await openBook(desktop.page, book.id);
    expect(texto).toMatch(/Capítulo 3/);
  });
});
