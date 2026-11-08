import { signUp, uniqueEmail } from "../fixtures/account.js";
import { expect, test } from "../fixtures/devtools.js";

// "Instalar app": o botão só aparece quando o navegador oferece a instalação (beforeinstallprompt).

test("sem oferta do navegador não há botão de instalar; com a oferta, o botão chama a instalação", async ({
  desktop,
  baseURL,
}) => {
  const { page, context } = desktop;
  await signUp(context.request, uniqueEmail("instalar"), baseURL ?? "");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Minha estante" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Instalar app" })).toHaveCount(0);

  // O Chrome dispara este evento quando o app pode ser instalado; aqui ele é simulado.
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: () => {
        (window as unknown as { __installPrompted: boolean }).__installPrompted = true;
        return Promise.resolve();
      },
    });
    window.dispatchEvent(event);
  });
  const button = page.getByRole("button", { name: "Instalar app" });
  await expect(button).toBeVisible();
  await button.click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __installPrompted?: boolean }).__installPrompted),
    )
    .toBe(true);
  // O pedido vale uma vez: depois de usado, o botão some.
  await expect(button).toHaveCount(0);
  desktop.watcher.assertClean();
});
