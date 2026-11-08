import { expect, test } from "../fixtures/devtools.js";
import { card, seedLibrary } from "./library-support.js";

// Filtros e agrupamento por série da estante.

test("filtrar por status mostra só os livros daquele status e a contagem", async ({
  desktop,
  baseURL,
}, testInfo) => {
  const { page } = desktop;
  await seedLibrary(desktop, baseURL ?? "", testInfo, [
    { title: "Livro Lendo", patch: { status: "reading" } },
    { title: "Livro Lido", patch: { status: "read" } },
    { title: "Livro Abandonado", patch: { status: "abandoned" } },
    { title: "Livro Quero Ler" },
  ]);
  await page.goto("/");
  await expect(page.getByRole("listitem")).toHaveCount(4);
  await expect(page.getByText("4 livros", { exact: true })).toBeVisible();

  const lendo = page.getByRole("button", { name: /^Lendo/ });
  await expect(lendo).toHaveAttribute("aria-pressed", "false");
  await lendo.click();
  await expect(lendo).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(card(page, "Livro Lendo")).toBeVisible();
  await expect(page.getByText("Mostrando 1 de 4 livros")).toBeVisible();

  await page.getByRole("button", { name: /^Lido/ }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(card(page, "Livro Lido")).toBeVisible();
  await expect(card(page, "Livro Lido").locator('[data-status="read"]')).toBeVisible();

  // Limpar os filtros traz todos os livros de volta.
  await page.getByRole("button", { name: /^Quero ler/ }).click();
  await expect(card(page, "Livro Quero Ler")).toBeVisible();
  await page.getByRole("button", { name: "Limpar filtros" }).first().click();
  await expect(page.getByRole("listitem")).toHaveCount(4);
  desktop.watcher.assertClean();
});

test("séries viram grupos recolhíveis, com volumes em ordem; sem série vem por último", async ({
  desktop,
  baseURL,
}, testInfo) => {
  const { page } = desktop;
  await seedLibrary(desktop, baseURL ?? "", testInfo, [
    { title: "Saga Vol Dez", patch: { series: "Saga", seriesIndex: 10 } },
    { title: "Saga Vol Dois", patch: { series: "Saga", seriesIndex: 2 } },
    { title: "Saga Vol Um e Meio", patch: { series: "Saga", seriesIndex: 1.5 } },
    { title: "Saga Especial", patch: { series: "Saga" } },
    { title: "Saga Vol Um", patch: { series: "Saga", seriesIndex: 1 } },
    { title: "Alfa Primeiro", patch: { series: "Alfa", seriesIndex: 1 } },
    { title: "Livro Solto" },
  ]);
  await page.goto("/");

  const groups = page.getByTestId("series-group");
  await expect(groups).toHaveCount(3);
  await expect(groups.nth(0)).toHaveAccessibleName("Alfa");
  await expect(groups.nth(1)).toHaveAccessibleName("Saga");
  await expect(groups.nth(2)).toHaveAccessibleName("Sem série");

  await expect(groups.nth(1).getByRole("listitem")).toContainText([
    "Saga Vol Um",
    "Saga Vol Um e Meio",
    "Saga Vol Dois",
    "Saga Vol Dez",
    "Saga Especial",
  ]);
  await expect(card(page, "Saga Vol Um e Meio")).toContainText("Vol. 1.5");

  // Recolher e abrir de novo.
  const toggle = groups.nth(1).getByRole("button", { name: /^Saga \d+ livros/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(groups.nth(1).getByRole("listitem")).toHaveCount(0);
  await toggle.click();
  await expect(groups.nth(1).getByRole("listitem")).toHaveCount(5);

  // Lista plana: sem grupos, todos os livros.
  await page.getByRole("button", { name: "Ver lista plana" }).click();
  await expect(groups).toHaveCount(0);
  await expect(page.getByRole("listitem")).toHaveCount(7);
  await page.getByRole("button", { name: "Agrupar por série" }).click();
  await expect(groups).toHaveCount(3);
  desktop.watcher.assertClean();
});

test("filtro por tag e por status se combinam", async ({ desktop, baseURL }, testInfo) => {
  const { page } = desktop;
  await seedLibrary(desktop, baseURL ?? "", testInfo, [
    { title: "Fantasia Lida", patch: { tags: ["fantasia"], status: "read" } },
    { title: "Fantasia Nova", patch: { tags: ["Fantasia", "épico"] } },
    { title: "Ficção Lida", patch: { tags: ["ficção"], status: "read" } },
  ]);
  await page.goto("/");
  await page.getByRole("combobox", { name: "Filtrar por tag" }).click();
  await page.getByRole("option", { name: "fantasia" }).click();
  await expect(page.getByRole("listitem")).toHaveCount(2);

  // A contagem de cada status respeita a tag escolhida.
  await expect(page.getByRole("button", { name: /^Lido/ })).toContainText("1");
  await page.getByRole("button", { name: /^Lido/ }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(card(page, "Fantasia Lida")).toBeVisible();
  desktop.watcher.assertClean();
});

test("buscar por título ou autor filtra sem acento, junto dos outros filtros, e dá para limpar", async ({
  desktop,
  baseURL,
}, testInfo) => {
  const { page } = desktop;
  await seedLibrary(desktop, baseURL ?? "", testInfo, [
    { title: "O Pequeno Príncipe", patch: { authors: ["Antoine de Saint-Exupéry"] } },
    { title: "Dom Casmurro", patch: { authors: ["Machado de Assis"], status: "read" } },
    { title: "Memórias Póstumas", patch: { authors: ["Machado de Assis"] } },
  ]);
  await page.goto("/");
  await expect(page.getByRole("listitem")).toHaveCount(3);

  const search = page.getByRole("searchbox", { name: "Buscar por título ou autor" });
  await search.fill("principe");
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(card(page, "O Pequeno Príncipe")).toBeVisible();

  await search.fill("machado");
  await expect(page.getByRole("listitem")).toHaveCount(2);
  // A busca soma com o status: só o Dom Casmurro está "Lido".
  await page.getByRole("button", { name: /^Lido/ }).click();
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(card(page, "Dom Casmurro")).toBeVisible();

  await search.fill("nada disso existe");
  await expect(page.getByText("Nenhum livro com esses filtros.")).toBeVisible();
  await page.getByRole("button", { name: "Limpar filtros" }).first().click();
  await expect(search).toHaveValue("");
  await expect(page.getByRole("listitem")).toHaveCount(3);
  desktop.watcher.assertClean();
});
