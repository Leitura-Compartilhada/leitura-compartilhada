import { calibreAvailable } from "../fixtures/calibre.js";
import { expect, test } from "../fixtures/devtools.js";
import { openFreshLibrary, pickFile, SAMPLES } from "./conversion-support.js";
import { card } from "./library-support.js";

// Enviar cada formato de texto, ver o painel andar e o livro aparecer na estante.

test.skip(!calibreAvailable, "Calibre (ebook-convert) não está disponível nesta máquina");
test.setTimeout(180_000);

for (const key of ["txt", "md", "html", "fb2"] as const) {
  const sample = SAMPLES[key];
  test(`${key.toUpperCase()}: converte e o livro aparece na estante`, async ({
    desktop,
    baseURL,
  }) => {
    const { page } = desktop;
    await openFreshLibrary(desktop, baseURL ?? "");

    await pickFile(page, sample.name, sample.mimeType, sample.body);

    const panel = page.getByRole("region", { name: "Conversões" });
    await expect(panel).toContainText(sample.name);
    await expect(panel.getByRole("link", { name: `Abrir ${sample.name}` })).toBeVisible({
      timeout: 120_000,
    });
    await expect(panel).toContainText("Concluído");
    await expect(card(page, sample.title)).toBeVisible();

    // "Fechar" descarta o registro e o painel some.
    await panel.getByRole("button", { name: `Fechar ${sample.name}` }).click();
    await expect(panel).toHaveCount(0);
    await expect(card(page, sample.title)).toBeVisible();
    desktop.watcher.assertClean();
  });
}
