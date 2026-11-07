import { signIn } from "../fixtures/account.js";
import { expect, test } from "../fixtures/devtools.js";
import {
  currentCfi,
  jumpToFraction,
  openBook,
  startOf,
  turnPages,
  visibleText,
  waitForServerToHold,
} from "../fixtures/reader.js";
import {
  closePanel,
  firstMarker,
  hoverReader,
  openAppearancePanel,
  readerFlow,
  seedReaderPrefs,
  uploadGeneratedBook,
} from "./reader-support.js";

const SCROLLED = { flow: "scrolled" };

test.describe("rolagem contínua", () => {
  test("trocar de modo mantém o trecho visível, nos dois sentidos", async ({
    desktop,
    baseURL,
  }, testInfo) => {
    const { book } = await uploadGeneratedBook(desktop, baseURL ?? "", testInfo);
    await openBook(desktop.page, book.id);
    const before = await turnPages(desktop.page, 4);
    const marker = firstMarker(before);
    expect(marker, "a página deveria ter um parágrafo identificável").not.toBeNull();

    const panel = await openAppearancePanel(desktop.page);
    await panel.getByRole("button", { name: "Rolagem contínua" }).click();
    await closePanel(desktop.page);
    await expect.poll(() => readerFlow(desktop.page)).toBe("scrolled");
    await expect
      .poll(() => visibleText(desktop.page), { message: "o trecho deveria continuar à vista" })
      .toContain(marker ?? "");

    const scrolledText = await visibleText(desktop.page);
    const scrolledMarker = firstMarker(scrolledText);
    expect(scrolledMarker).not.toBeNull();

    const back = await openAppearancePanel(desktop.page);
    await back.getByRole("button", { name: "Páginas" }).click();
    await closePanel(desktop.page);
    await expect.poll(() => readerFlow(desktop.page)).toBe("paginated");
    await expect
      .poll(() => visibleText(desktop.page), {
        message: "voltar ao modo em páginas mantém o lugar",
      })
      .toContain(scrolledMarker ?? "");
  });

  test("passa de capítulo ao rolar além do fim e volta ao rolar além do topo", async ({
    desktop,
    baseURL,
  }, testInfo) => {
    await seedReaderPrefs(desktop.page, SCROLLED);
    const { book } = await uploadGeneratedBook(desktop, baseURL ?? "", testInfo);
    await openBook(desktop.page, book.id);
    expect(await readerFlow(desktop.page)).toBe("scrolled");

    // Perto do fim do capítulo 1 (cada capítulo vale um terço do livro).
    await jumpToFraction(desktop.page, 0.32);
    await hoverReader(desktop.page);

    await expect
      .poll(
        async () => {
          await desktop.page.mouse.wheel(0, 700);
          await desktop.page.waitForTimeout(150);
          return visibleText(desktop.page);
        },
        { message: "a roda deveria levar ao capítulo 2", timeout: 30_000, intervals: [100] },
      )
      .toContain("Capítulo 2,");

    // E para cima: o capítulo 2 acabou de abrir no topo, então rolar além do topo volta ao 1.
    await expect
      .poll(
        async () => {
          await desktop.page.mouse.wheel(0, -700);
          await desktop.page.waitForTimeout(150);
          return visibleText(desktop.page);
        },
        {
          message: "a roda para cima deveria voltar ao capítulo 1",
          timeout: 30_000,
          intervals: [100],
        },
      )
      .toContain("Capítulo 1,");
  });

  test("a posição lida em rolagem contínua chega ao outro aparelho", async ({
    desktop,
    mobile,
    baseURL,
  }, testInfo) => {
    const origin = baseURL ?? "";
    await seedReaderPrefs(desktop.page, SCROLLED);
    const { book, email } = await uploadGeneratedBook(desktop, origin, testInfo);
    await signIn(mobile.context.request, email, origin);

    await openBook(desktop.page, book.id);
    await jumpToFraction(desktop.page, 0.32);
    await hoverReader(desktop.page);
    await expect
      .poll(
        async () => {
          await desktop.page.mouse.wheel(0, 700);
          await desktop.page.waitForTimeout(150);
          return visibleText(desktop.page);
        },
        { timeout: 30_000, intervals: [100] },
      )
      .toContain("Capítulo 2,");
    // Rola um pouco dentro do capítulo 2 e espera o servidor guardar exatamente onde parou.
    await desktop.page.mouse.wheel(0, 500);
    await desktop.page.waitForTimeout(600);
    const cfi = await waitForServerToHold(desktop.page, desktop.context.request, book.id);
    expect(cfi).not.toBe("");
    const marker = firstMarker(await visibleText(desktop.page));
    expect(marker).not.toBeNull();

    // O celular (modo em páginas) abre no mesmo ponto.
    const mobileText = await openBook(mobile.page, book.id);
    expect(mobileText).toContain(marker ?? "");
    expect(startOf(mobileText).length).toBeGreaterThan(0);
  });

  test("no fim do último capítulo a roda não trava a navegação", async ({
    desktop,
    baseURL,
  }, testInfo) => {
    await seedReaderPrefs(desktop.page, SCROLLED);
    const { book } = await uploadGeneratedBook(desktop, baseURL ?? "", testInfo, {
      chapters: 2,
      paragraphs: 20,
    });
    await openBook(desktop.page, book.id);
    await jumpToFraction(desktop.page, 0.99);
    await hoverReader(desktop.page);
    for (let i = 0; i < 8; i++) {
      await desktop.page.mouse.wheel(0, 800);
      await desktop.page.waitForTimeout(120);
    }
    await desktop.page.keyboard.press("PageDown");
    await desktop.page.keyboard.press("ArrowDown");
    await desktop.page.waitForTimeout(400);

    // Continua navegável: subir ainda funciona.
    const atEnd = await currentCfi(desktop.page);
    await desktop.page.keyboard.press("PageUp");
    await expect.poll(() => currentCfi(desktop.page)).not.toBe(atEnd);
  });

  test("o teclado rola e atravessa o capítulo", async ({ desktop, baseURL }, testInfo) => {
    await seedReaderPrefs(desktop.page, SCROLLED);
    const { book } = await uploadGeneratedBook(desktop, baseURL ?? "", testInfo, {
      chapters: 2,
      paragraphs: 12,
    });
    await openBook(desktop.page, book.id);
    const start = await currentCfi(desktop.page);
    await desktop.page.keyboard.press("ArrowDown");
    await expect.poll(() => currentCfi(desktop.page)).not.toBe(start);

    await expect
      .poll(
        async () => {
          await desktop.page.keyboard.press("PageDown");
          await desktop.page.waitForTimeout(250);
          return visibleText(desktop.page);
        },
        { message: "PageDown repetido deveria chegar ao capítulo 2", timeout: 30_000 },
      )
      .toContain("Capítulo 2,");
  });
});
