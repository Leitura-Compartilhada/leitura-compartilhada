import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { signUp, uniqueEmail, uploadEpub } from "../fixtures/account.js";
import { expect, test } from "../fixtures/devtools.js";
import { buildEpub, type CoverStyle } from "../fixtures/make-epub.mjs";

// A estante mostra a capa de cada livro (ou iniciais quando não há) e a API entrega a imagem com o
// tipo certo, decidido pelos bytes. O acervo real roda só na máquina do usuário.

test("a estante mostra a capa, as iniciais quando não há, e o título do próprio EPUB", async ({
  desktop,
  baseURL,
}, testInfo) => {
  const { page, context } = desktop;
  await signUp(context.request, uniqueEmail("capas"), baseURL ?? "");

  const withCover = testInfo.outputPath("com-capa.epub");
  writeFileSync(withCover, buildEpub({ cover: "epub3-property", title: "Livro Com Capa" }));
  const without = testInfo.outputPath("sem-capa.epub");
  writeFileSync(without, buildEpub({ title: "Livro Sem Capa" }));
  const a = await uploadEpub(context.request, withCover);
  await uploadEpub(context.request, without);
  expect(a.book.hasCover).toBe(true);

  await page.goto("/");
  const cards = page.getByRole("listitem");
  await expect(cards).toHaveCount(2);

  const comCapa = cards.filter({ hasText: "Livro Com Capa" });
  const image = comCapa.locator("img");
  await expect(image).toBeVisible();
  // Só passa se a imagem foi decodificada de verdade (não é um ícone quebrado).
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  const semCapa = cards.filter({ hasText: "Livro Sem Capa" });
  await expect(semCapa.locator("img")).toHaveCount(0);
  await expect(semCapa).toContainText("LS");
});

const STYLES: [CoverStyle, string][] = [
  ["epub3-property", "image/png"],
  ["epub2-meta", "image/png"],
  ["guide", "image/png"],
  ["first-image", "image/png"],
  ["by-name-webp-lie", "image/webp"],
];

for (const [cover, contentType] of STYLES) {
  test(`capa declarada como ${cover} sai como ${contentType}`, async ({
    desktop,
    baseURL,
  }, testInfo) => {
    await signUp(desktop.context.request, uniqueEmail("capas"), baseURL ?? "");
    const file = testInfo.outputPath(`${cover}.epub`);
    writeFileSync(file, buildEpub({ cover }));
    const { book } = await uploadEpub(desktop.context.request, file);
    expect(book.hasCover).toBe(true);
    const response = await desktop.context.request.get(`/api/books/${book.id}/cover`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe(contentType);
  });
}

// Acervo real (_local/corpus, fora do git): todo livro precisa ter uma capa utilizável.
const roots = (process.env.LEITURA_CORPUS_DIRS ?? "_local/corpus")
  .split(path.delimiter === ":" ? /[:;]/ : ";")
  .map((dir) => path.resolve(dir))
  .filter((dir) => existsSync(dir));

function findEpubs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return findEpubs(full);
    return /\.epub$/i.test(name) ? [full] : [];
  });
}

const files = roots.flatMap(findEpubs).sort();

test.describe("acervo real do usuário: capas", () => {
  test.skip(files.length === 0, "acervo local ausente (_local/corpus)");

  for (const file of files) {
    test(`extrai capa e metadados de ${path.basename(file)}`, async ({ desktop, baseURL }) => {
      await signUp(desktop.context.request, uniqueEmail("acervo-capa"), baseURL ?? "");
      const { book } = await uploadEpub(desktop.context.request, file);
      expect(book.hasCover, `sem capa: ${path.basename(file)}`).toBe(true);
      expect(book.title.length).toBeGreaterThan(0);

      const response = await desktop.context.request.get(`/api/books/${book.id}/cover`);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toMatch(/^image\/(jpeg|png|gif|webp)$/);
      expect((await response.body()).length).toBeGreaterThan(100);
    });
  }
});
