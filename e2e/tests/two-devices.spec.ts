import { SYNTHETIC_EPUB, signIn, signUp, uniqueEmail, uploadEpub } from "../fixtures/account.js";
import { expect, test } from "../fixtures/devtools.js";
import {
  openBook,
  savedCfiOnServer,
  startOf,
  turnPages,
  visibleText,
  waitForServerToHold,
} from "../fixtures/reader.js";

// O produto em uma frase: ler no PC, abrir no celular e cair no mesmo trecho.
test.describe("dois aparelhos, mesma conta", () => {
  test("a posição lida num aparelho aparece no outro, nos dois sentidos", async ({
    desktop,
    mobile,
    baseURL,
  }) => {
    const origin = baseURL ?? "";
    const email = uniqueEmail();
    await signUp(desktop.context.request, email, origin);
    const { book } = await uploadEpub(desktop.context.request, SYNTHETIC_EPUB);
    await signIn(mobile.context.request, email, origin);

    // O PC lê um pedaço e espera o servidor guardar a posição em que parou.
    await openBook(desktop.page, book.id);
    const textoDoPc = await turnPages(desktop.page, 6);
    await waitForServerToHold(desktop.page, desktop.context.request, book.id);

    // O celular abre o mesmo livro e cai no trecho em que o PC parou.
    const textoDoCelular = await openBook(mobile.page, book.id);
    expect(textoDoCelular).toContain(startOf(textoDoPc));

    // Agora o celular avança, e o PC, ao recarregar, o acompanha.
    const adiante = await turnPages(mobile.page, 5);
    await waitForServerToHold(mobile.page, mobile.context.request, book.id);

    await desktop.page.reload();
    await expect
      .poll(() => visibleText(desktop.page), { message: "o PC deveria seguir o celular" })
      .toContain(startOf(adiante));
  });

  test("abrir e fechar sem virar página não muda a posição no servidor", async ({
    desktop,
    mobile,
    baseURL,
  }) => {
    const origin = baseURL ?? "";
    const email = uniqueEmail();
    await signUp(desktop.context.request, email, origin);
    const { book } = await uploadEpub(desktop.context.request, SYNTHETIC_EPUB);
    await signIn(mobile.context.request, email, origin);

    // Cria uma posição de verdade no servidor e espera ela assentar.
    await openBook(desktop.page, book.id);
    await turnPages(desktop.page, 4);
    const cfiDoPc = await waitForServerToHold(desktop.page, desktop.context.request, book.id);

    // Ida e volta PC → celular → PC, três vezes, sem virar nenhuma página.
    for (let i = 0; i < 3; i++) {
      await openBook(mobile.page, book.id);
      await openBook(desktop.page, book.id);
    }
    // Espera passar do debounce (3 s) para um salvamento indevido aparecer, se existisse.
    await desktop.page.waitForTimeout(4_000);

    // O servidor continua com a posição do PC: restaurar não pode regravar a posição.
    expect(await savedCfiOnServer(desktop.context.request, book.id)).toBe(cfiDoPc);
  });
});
