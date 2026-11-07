import { expect, test } from "../fixtures/devtools.js";

// O "olhinho" mostra e esconde a senha sem enviar o formulário.
test("olhinho alterna a senha entre oculta e visível", async ({ desktop }) => {
  const { page } = desktop;
  await page.goto("/login");

  const password = page.getByLabel("Senha", { exact: true });
  await password.fill("segredo-123");
  await expect(password).toHaveAttribute("type", "password");

  const show = page.getByRole("button", { name: "Mostrar senha" });
  await expect(show).toHaveAttribute("aria-pressed", "false");
  await show.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(password).toHaveValue("segredo-123");

  const hide = page.getByRole("button", { name: "Ocultar senha" });
  await expect(hide).toHaveAttribute("aria-pressed", "true");
  await hide.click();
  await expect(password).toHaveAttribute("type", "password");

  await expect(page).toHaveURL(/\/login/); // não enviou o formulário
  desktop.watcher.assertClean();
});
