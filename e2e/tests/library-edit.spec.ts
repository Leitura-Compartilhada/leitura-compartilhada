import { expect, test } from "../fixtures/devtools.js";
import { card, fetchBooks, openBookMenu, seedLibrary } from "./library-support.js";

// Edição, troca rápida de status e exclusão de livros pela estante.

test("editar um livro reflete na estante e no servidor", async ({ desktop, baseURL }, testInfo) => {
  const { page } = desktop;
  await seedLibrary(desktop, baseURL ?? "", testInfo, [{ title: "Livro Original" }]);
  await page.goto("/");

  await openBookMenu(page, "Livro Original", "Editar");
  const dialog = page.getByRole("dialog", { name: "Editar livro" });
  await expect(dialog).toBeVisible();
  // O foco vai para dentro do diálogo (o primeiro campo).
  await expect(dialog.getByLabel("Título")).toBeFocused();

  await dialog.getByLabel("Título").fill("Livro Editado");
  await dialog.getByLabel("Autores").fill("Ana Souza\nBruno Lima");
  await dialog.getByLabel("Série", { exact: true }).fill("Crônicas");
  await dialog.getByLabel("Volume").fill("2,5");
  await dialog.getByRole("combobox", { name: "Status de leitura" }).click();
  await page.getByRole("option", { name: "Lido" }).click();
  await dialog.getByLabel("Tags").fill("  Épico ,fantasia");
  await dialog.getByLabel("Tags").press("Enter");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();

  const edited = card(page, "Livro Editado");
  await expect(edited).toContainText("Ana Souza, Bruno Lima");
  await expect(edited).toContainText("Vol. 2.5");
  await expect(edited.locator('[data-status="read"]')).toBeVisible();
  await expect(page.getByTestId("series-group")).toHaveAccessibleName("Crônicas");
  // Depois de fechar, o foco volta para a página (não fica preso no diálogo).
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const [saved] = await fetchBooks(desktop);
  expect(saved).toMatchObject({
    title: "Livro Editado",
    authors: ["Ana Souza", "Bruno Lima"],
    series: "Crônicas",
    seriesIndex: 2.5,
    status: "read",
    tags: ["épico", "fantasia"],
  });
  desktop.watcher.assertClean();
});

test("o diálogo valida antes de enviar e mantém o que foi digitado quando o servidor recusa", async ({
  desktop,
  baseURL,
}, testInfo) => {
  const { page, watcher } = desktop;
  watcher.expectStatus(500);
  watcher.allowConsoleError(/Failed to load resource/);
  await seedLibrary(desktop, baseURL ?? "", testInfo, [{ title: "Livro Teimoso" }]);
  await page.goto("/");

  await openBookMenu(page, "Livro Teimoso", "Editar");
  const dialog = page.getByRole("dialog", { name: "Editar livro" });

  // Validação local (nenhum pedido sai).
  let patches = 0;
  await page.route("**/api/books/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    patches += 1;
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "INTERNAL", message: "falhou" } }),
    });
  });
  await dialog.getByLabel("Volume").fill("dois");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog.getByRole("alert")).toContainText("O volume deve ser um número");
  expect(patches).toBe(0);

  // Erro do servidor: a mensagem aparece e o texto digitado continua lá.
  await dialog.getByLabel("Volume").fill("3");
  await dialog.getByLabel("Série", { exact: true }).fill("Série Teimosa");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog.getByRole("alert")).toContainText("O servidor falhou");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Série", { exact: true })).toHaveValue("Série Teimosa");
  await expect(dialog.getByLabel("Volume")).toHaveValue("3");
  expect(patches).toBe(1);

  // O Esc fecha e nada mudou no servidor.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const [book] = await fetchBooks(desktop);
  expect(book?.series).toBeNull();
  watcher.assertClean();
});

test("trocar o status pelo menu aparece na hora e volta atrás se o servidor recusar", async ({
  desktop,
  baseURL,
}, testInfo) => {
  const { page, watcher } = desktop;
  watcher.expectStatus(500);
  watcher.allowConsoleError(/Failed to load resource/);
  await seedLibrary(desktop, baseURL ?? "", testInfo, [{ title: "Livro de Status" }]);
  await page.goto("/");
  const badge = card(page, "Livro de Status").locator("[data-status]");
  await expect(badge).toHaveAttribute("data-status", "want_to_read");

  // Resposta lenta e correta: a tela já mudou antes de o servidor responder.
  await page.route("**/api/books/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await new Promise((resolve) => setTimeout(resolve, 800));
    return route.fallback();
  });
  await openBookMenu(page, "Livro de Status", "Marcar como");
  await page.getByRole("menuitemradio", { name: "Lendo" }).click();
  await expect(badge).toHaveAttribute("data-status", "reading", { timeout: 500 });
  await expect.poll(async () => (await fetchBooks(desktop))[0]?.status).toBe("reading");
  await page.unroute("**/api/books/*");

  // Servidor recusa: volta ao status anterior e avisa.
  await page.route("**/api/books/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "INTERNAL", message: "falhou" } }),
    });
  });
  await openBookMenu(page, "Livro de Status", "Marcar como");
  await page.getByRole("menuitemradio", { name: "Lido" }).click();
  await expect(page.getByRole("alert")).toContainText("foi desfeita");
  await expect(badge).toHaveAttribute("data-status", "reading");
  watcher.assertClean();
});

test("excluir pede confirmação com o título e apaga de vez", async ({
  desktop,
  baseURL,
}, testInfo) => {
  const { page } = desktop;
  await seedLibrary(desktop, baseURL ?? "", testInfo, [
    { title: "Livro Para Apagar" },
    { title: "Livro Que Fica" },
  ]);
  await page.goto("/");

  await openBookMenu(page, "Livro Para Apagar", "Excluir");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Excluir “Livro Para Apagar”?");
  await expect(dialog).toContainText("Não dá para desfazer");

  // Cancelar não apaga.
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("listitem")).toHaveCount(2);
  expect(await fetchBooks(desktop)).toHaveLength(2);

  await openBookMenu(page, "Livro Para Apagar", "Excluir");
  await page.getByRole("alertdialog").getByRole("button", { name: "Excluir livro" }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(card(page, "Livro Que Fica")).toBeVisible();
  const remaining = await fetchBooks(desktop);
  expect(remaining.map((b) => b.title)).toEqual(["Livro Que Fica"]);
  desktop.watcher.assertClean();
});

test("no tema escuro a estante, o menu e o diálogo usam as cores do tema", async ({
  desktop,
  baseURL,
}, testInfo) => {
  const { page } = desktop;
  await page.emulateMedia({ colorScheme: "dark" });
  await seedLibrary(desktop, baseURL ?? "", testInfo, [
    { title: "Livro no Escuro", patch: { status: "reading", series: "Saga", seriesIndex: 1 } },
  ]);
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/dark/);
  const background = (locator: ReturnType<typeof page.locator>) =>
    locator.evaluate((el) => getComputedStyle(el).backgroundColor);

  const pageBackground = await background(page.locator("body"));
  expect(pageBackground).not.toBe("rgb(255, 255, 255)");
  await page.screenshot({ path: testInfo.outputPath("escuro-estante.png") });

  await page.getByRole("button", { name: "Ações de Livro no Escuro" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  expect(await background(menu)).not.toBe("rgb(255, 255, 255)");
  await page.screenshot({ path: testInfo.outputPath("escuro-menu.png") });
  await page.getByRole("menuitem", { name: "Editar" }).click();

  const dialog = page.getByRole("dialog", { name: "Editar livro" });
  await expect(dialog).toBeVisible();
  expect(await background(dialog)).toBe(pageBackground);
  await page.screenshot({ path: testInfo.outputPath("escuro-dialogo.png") });
  desktop.watcher.assertClean();
});
