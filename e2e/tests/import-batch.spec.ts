import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { signUp, uniqueEmail } from "../fixtures/account.js";
import { calibreAvailable } from "../fixtures/calibre.js";
import { type Device, expect, test } from "../fixtures/devtools.js";
import { buildEpub } from "../fixtures/make-epub.mjs";
import { card } from "./library-support.js";

// Importar vários arquivos ou uma pasta: revisão, envio em fila e reimportação sem duplicar.

const epub = (title: string) => ({
  name: `${title}.epub`,
  mimeType: "application/epub+zip",
  buffer: buildEpub({ title, paragraphs: 3, chapters: 1 }),
});
const fakePdf = {
  name: "Manual.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4"),
};

async function openLibrary(device: Device, baseURL: string): Promise<Page> {
  await signUp(device.context.request, uniqueEmail("lote"), baseURL);
  await device.page.goto("/");
  return device.page;
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "Importar livros" });
const row = (page: Page, name: string) =>
  dialog(page).getByRole("listitem").filter({ hasText: name });

test.describe("importar em lote", () => {
  test("revisar, importar e reimportar sem duplicar", async ({ desktop, baseURL }) => {
    const page = await openLibrary(desktop, baseURL ?? "");
    const files = [epub("Lote Um"), epub("Lote Dois"), fakePdf];

    await page.getByLabel("Escolher arquivo de livro").setInputFiles(files);
    await expect(dialog(page)).toBeVisible();
    await expect(row(page, "Lote Um.epub")).toContainText("novo");
    await expect(row(page, "Lote Dois.epub")).toContainText("novo");
    await expect(row(page, "Manual.pdf")).toContainText("PDF ainda não é suportado");
    await expect(row(page, "Manual.pdf").getByRole("checkbox")).toBeDisabled();

    // Desmarcar um e importar só o outro.
    await row(page, "Lote Dois.epub").getByRole("checkbox").uncheck();
    await dialog(page).getByRole("button", { name: "Importar 1 livro" }).click();
    await expect(dialog(page)).toContainText("1 de 1 enviados");
    await dialog(page).getByRole("button", { name: "Fechar", exact: true }).click();
    await expect(card(page, "Lote Um")).toBeVisible();
    await expect(card(page, "Lote Dois")).toHaveCount(0);

    // Reimportar os mesmos: o que já está na estante vem desmarcado, o novo marcado.
    await page.getByLabel("Escolher arquivo de livro").setInputFiles(files);
    await expect(row(page, "Lote Um.epub")).toContainText("já na estante");
    await expect(row(page, "Lote Um.epub").getByRole("checkbox")).not.toBeChecked();
    await expect(row(page, "Lote Dois.epub").getByRole("checkbox")).toBeChecked();
    await dialog(page).getByRole("button", { name: "Importar 1 livro" }).click();
    await expect(dialog(page)).toContainText("1 de 1 enviados");
    await dialog(page).getByRole("button", { name: "Fechar", exact: true }).click();
    await expect(card(page, "Lote Dois")).toBeVisible();

    // Tudo marcado de novo e nada novo: o botão fica desabilitado.
    await page.getByLabel("Escolher arquivo de livro").setInputFiles(files);
    await expect(dialog(page).getByRole("button", { name: "Importar 0 livros" })).toBeDisabled();
    desktop.watcher.assertClean();
  });

  test("pasta: ignora arquivos de sistema e mostra o caminho", async ({
    desktop,
    baseURL,
  }, testInfo: TestInfo) => {
    const page = await openLibrary(desktop, baseURL ?? "");
    const root = testInfo.outputPath("Minha Biblioteca");
    mkdirSync(path.join(root, "Serie"), { recursive: true });
    writeFileSync(path.join(root, "Solto.epub"), epub("Solto").buffer);
    writeFileSync(path.join(root, "Serie", "Volume 1.epub"), epub("Volume 1").buffer);
    writeFileSync(path.join(root, ".DS_Store"), "lixo");
    writeFileSync(path.join(root, "Thumbs.db"), "lixo");

    await page.getByLabel("Escolher pasta de livros").setInputFiles(root);
    await expect(dialog(page)).toBeVisible();
    await expect(row(page, "Minha Biblioteca/Solto.epub")).toContainText("novo");
    await expect(row(page, "Minha Biblioteca/Serie/Volume 1.epub")).toContainText("novo");
    await expect(dialog(page).getByRole("listitem")).toHaveCount(2); // sem .DS_Store nem Thumbs.db

    await dialog(page).getByRole("button", { name: "Importar 2 livros" }).click();
    await expect(dialog(page)).toContainText("2 de 2 enviados");
    await dialog(page).getByRole("button", { name: "Fechar", exact: true }).click();
    await expect(card(page, "Solto")).toBeVisible();
    await expect(card(page, "Volume 1")).toBeVisible();
    desktop.watcher.assertClean();
  });

  test("reenviar um TXT convertido depois de Fechar o painel não duplica o livro", async ({
    desktop,
    baseURL,
  }) => {
    test.skip(!calibreAvailable, "Calibre (ebook-convert) não está disponível nesta máquina");
    test.setTimeout(180_000);
    const page = await openLibrary(desktop, baseURL ?? "");
    const txt = {
      name: "Anotacoes Reenvio.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Texto que será enviado duas vezes. ".repeat(40)),
    };
    const panel = page.getByRole("region", { name: "Conversões" });

    await page.getByLabel("Escolher arquivo de livro").setInputFiles(txt);
    await panel.getByRole("link", { name: `Abrir ${txt.name}` }).waitFor({ timeout: 120_000 });
    await panel.getByRole("button", { name: `Fechar ${txt.name}` }).click();
    await expect(card(page, "Anotacoes Reenvio")).toHaveCount(1);

    await page.getByLabel("Escolher arquivo de livro").setInputFiles(txt);
    await expect(panel.getByRole("link", { name: `Abrir ${txt.name}` })).toBeVisible({
      timeout: 30_000,
    });
    await expect(card(page, "Anotacoes Reenvio")).toHaveCount(1);
    desktop.watcher.assertClean();
  });
});
