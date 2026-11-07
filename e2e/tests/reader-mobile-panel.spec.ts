import { expect, test } from "../fixtures/devtools.js";
import { openBook } from "../fixtures/reader.js";
import {
  closePanel,
  computedFontSize,
  openAppearancePanel,
  uploadGeneratedBook,
} from "./reader-support.js";

// No celular o painel de aparência é uma folha na parte de baixo: o livro continua visível em cima
// e muda ao vivo enquanto se mexe nos controles.
test("celular: a folha de aparência deixa o livro visível e a fonte muda ao vivo", async ({
  mobile,
  baseURL,
}, testInfo) => {
  const { book } = await uploadGeneratedBook(mobile, baseURL ?? "", testInfo, {
    chapters: 2,
    paragraphs: 20,
  });
  await openBook(mobile.page, book.id);
  const before = await computedFontSize(mobile.page, "p");

  const panel = await openAppearancePanel(mobile.page);
  await expect(panel).toBeVisible();
  const viewport = mobile.page.viewportSize();
  const box = await panel.boundingBox();
  if (!viewport || !box) throw new Error("sem medidas da tela ou do painel");
  expect(box.y, "a folha deve começar na parte de baixo").toBeGreaterThanOrEqual(
    viewport.height * 0.4,
  );
  expect(box.width).toBeGreaterThanOrEqual(viewport.width - 2);

  // O texto do livro, na metade de cima, não está coberto.
  const frame = mobile.page
    .frames()
    .filter((f) => f.url().startsWith("blob:"))
    .at(-1);
  const paragraph = await frame?.locator("p").first().boundingBox();
  expect(paragraph, "o livro precisa estar visível com o painel aberto").not.toBeNull();

  await panel.getByRole("button", { name: "Aumentar a fonte" }).click();
  await expect.poll(() => computedFontSize(mobile.page, "p")).toBeGreaterThan(before);

  await closePanel(mobile.page);
  await expect(panel).toBeHidden();
  mobile.watcher.assertClean();
});
