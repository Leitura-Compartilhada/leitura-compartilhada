import { expect, test } from "../fixtures/devtools.js";
import { card, fetchBooks, seedLibrary } from "./library-support.js";

// Estantes: criar, pôr livro nela, filtrar, renomear, apagar e o nome repetido.

test("criar uma estante, pôr um livro nela e filtrar por ela", async ({
  desktop,
  baseURL,
}, testInfo) => {
  const { page } = desktop;
  await seedLibrary(desktop, baseURL ?? "", testInfo, [
    { title: "Livro Na Estante" },
    { title: "Livro Fora" },
  ]);
  await page.goto("/");

  await page.getByRole("button", { name: "Gerenciar estantes" }).click();
  const shelves = page.getByRole("dialog", { name: "Estantes" });
  await shelves.getByLabel("Nome da nova estante").fill("Favoritos");
  await shelves.getByRole("button", { name: "Criar" }).click();
  await expect(shelves.getByRole("list", { name: "Suas estantes" })).toContainText("Favoritos");
  await expect(shelves.getByLabel("Nome da nova estante")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(shelves).toBeHidden();

  // Pelo diálogo de edição.
  await page.getByRole("button", { name: "Ações de Livro Na Estante" }).click();
  await page.getByRole("menuitem", { name: "Editar" }).click();
  const dialog = page.getByRole("dialog", { name: "Editar livro" });
  await dialog.getByRole("checkbox", { name: "Favoritos" }).click();
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("combobox", { name: "Filtrar por estante" }).click();
  await page.getByRole("option", { name: "Favoritos" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(card(page, "Livro Na Estante")).toBeVisible();

  const books = await fetchBooks(desktop);
  const inShelf = books.find((b) => b.title === "Livro Na Estante");
  expect(inShelf?.shelfIds).toHaveLength(1);

  // Pelo menu do card (troca rápida): tira o livro da estante e o filtro fica vazio.
  await page.getByRole("button", { name: "Ações de Livro Na Estante" }).click();
  await page.getByRole("menuitem", { name: "Estantes" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Favoritos" }).click();
  await expect(page.getByText("Nenhum livro com esses filtros.")).toBeVisible();
  await expect.poll(async () => (await fetchBooks(desktop))[0]?.shelfIds).toEqual([]);
  desktop.watcher.assertClean();
});

test("nome de estante repetido mostra o erro, e renomear e apagar não apagam livros", async ({
  desktop,
  baseURL,
}, testInfo) => {
  const { page, watcher } = desktop;
  watcher.expectStatus(409);
  watcher.allowConsoleError(/Failed to load resource/);
  const [book] = await seedLibrary(desktop, baseURL ?? "", testInfo, [{ title: "Livro Guardado" }]);
  await page.goto("/");

  await page.getByRole("button", { name: "Gerenciar estantes" }).click();
  const shelves = page.getByRole("dialog", { name: "Estantes" });
  const name = shelves.getByLabel("Nome da nova estante");
  await name.fill("Para ler");
  await shelves.getByRole("button", { name: "Criar" }).click();
  await expect(shelves.getByRole("list", { name: "Suas estantes" })).toContainText("Para ler");

  await name.fill("Para ler");
  await shelves.getByRole("button", { name: "Criar" }).click();
  await expect(shelves.getByRole("alert")).toHaveText("Já existe uma estante com esse nome.");
  await expect(shelves.getByRole("listitem")).toHaveCount(1);

  // Renomear.
  await shelves.getByRole("button", { name: "Renomear Para ler" }).click();
  await shelves.getByLabel("Novo nome para Para ler").fill("Lidos em 2026");
  await shelves.getByRole("button", { name: "Salvar" }).click();
  await expect(shelves.getByRole("list", { name: "Suas estantes" })).toContainText("Lidos em 2026");

  // Põe o livro nela por API e apaga a estante: o livro continua.
  const list = await desktop.context.request.get("/api/shelves");
  const { shelves: all } = (await list.json()) as { shelves: { id: string }[] };
  const patched = await desktop.context.request.patch(`/api/books/${book?.id}`, {
    data: { shelfIds: [all[0]?.id] },
  });
  expect(patched.status()).toBe(200);
  await page.reload();
  await page.getByRole("button", { name: "Gerenciar estantes" }).click();
  await expect(shelves).toContainText("1 livro");
  await shelves.getByRole("button", { name: "Apagar Lidos em 2026" }).click();
  await expect(shelves).toContainText("continuam na sua estante geral");
  await shelves.getByRole("button", { name: "Apagar estante" }).click();
  await expect(shelves.getByRole("list", { name: "Suas estantes" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await expect(card(page, "Livro Guardado")).toBeVisible();
  const books = await fetchBooks(desktop);
  expect(books).toHaveLength(1);
  expect(books[0]?.shelfIds).toEqual([]);
  watcher.assertClean();
});
