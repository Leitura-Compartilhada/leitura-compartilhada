import { progressResponseSchema } from "../../packages/shared/src/index.js";
import { SYNTHETIC_EPUB, signUp, uniqueEmail, uploadEpub } from "../fixtures/account.js";
import { expect, test } from "../fixtures/devtools.js";
import { openBook, startOf, turnPages, waitForServerToHold } from "../fixtures/reader.js";

test.describe("sem internet", () => {
  test("a leitura feita offline chega ao servidor quando a rede volta", async ({
    desktop,
    baseURL,
  }) => {
    const origin = baseURL ?? "";
    await signUp(desktop.context.request, uniqueEmail(), origin);
    const { book } = await uploadEpub(desktop.context.request, SYNTHETIC_EPUB);
    await openBook(desktop.page, book.id);

    // Vira páginas sem rede. O progresso fica guardado no aparelho (outbox).
    const textoOffline = await desktop.watcher.whileOffline(desktop.context, async () => {
      const texto = await turnPages(desktop.page, 5);
      await desktop.page.waitForTimeout(4_000); // passa do debounce e a tentativa falha em silêncio
      return texto;
    });

    // Rede de volta: o aparelho reenvia sozinho, e o servidor passa a guardar a posição lida offline.
    await waitForServerToHold(desktop.page, desktop.context.request, book.id);

    const estado = progressResponseSchema.parse(
      await (await desktop.context.request.get(`/api/progress/${book.id}`)).json(),
    ).readingState;
    expect(estado?.textSnippet ?? "").toContain(startOf(textoOffline).slice(0, 30));
    expect(estado?.percentage ?? 0).toBeGreaterThan(0);

    // A outbox esvaziou: não sobrou nada para reenviar.
    const pendentes = await desktop.page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const open = indexedDB.open("leitura");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const count = db.transaction("outbox").objectStore("outbox").count();
            count.onsuccess = () => resolve(count.result);
            count.onerror = () => reject(count.error);
          };
        }),
    );
    expect(pendentes).toBe(0);
  });
});
