import { expect, test } from "../fixtures/devtools.js";
import { openBook } from "../fixtures/reader.js";
import {
  closePanel,
  computedFontSize,
  openAppearancePanel,
  uploadGeneratedBook,
} from "./reader-support.js";

// Bug do Lord of Mysteries: o capítulo traz `font-size: 15px` inline num <div>, e o CSS do leitor
// só mudava títulos. O texto precisa crescer junto, e os títulos continuar proporcionais.
test.describe("tamanho da fonte", () => {
  test("escala o texto de um livro com font-size inline, e os títulos juntos", async ({
    desktop,
    baseURL,
  }, testInfo) => {
    const { book } = await uploadGeneratedBook(desktop, baseURL ?? "", testInfo, {
      inlinePx: true,
      chapters: 2,
      paragraphs: 20,
    });
    await openBook(desktop.page, book.id);

    const text100 = await computedFontSize(desktop.page, "p");
    const title100 = await computedFontSize(desktop.page, "h1");
    expect(text100).toBeGreaterThan(0);

    const panel = await openAppearancePanel(desktop.page);
    const increase = panel.getByRole("button", { name: "Aumentar a fonte" });
    for (let i = 0; i < 5; i++) await increase.click();
    await expect(panel.getByText("150%")).toBeVisible();
    await closePanel(desktop.page);

    await expect.poll(() => computedFontSize(desktop.page, "p")).toBeCloseTo(text100 * 1.5, 1);
    await expect.poll(() => computedFontSize(desktop.page, "h1")).toBeCloseTo(title100 * 1.5, 1);

    // Diminuir também vale, e a preferência sobrevive a recarregar.
    await desktop.page.reload();
    await openBook(desktop.page, book.id);
    await expect.poll(() => computedFontSize(desktop.page, "p")).toBeCloseTo(text100 * 1.5, 1);

    const reopened = await openAppearancePanel(desktop.page);
    const decrease = reopened.getByRole("button", { name: "Diminuir a fonte" });
    for (let i = 0; i < 7; i++) await decrease.click();
    await expect(reopened.getByText("80%")).toBeVisible();
    await expect.poll(() => computedFontSize(desktop.page, "p")).toBeCloseTo(text100 * 0.8, 1);
  });
});
