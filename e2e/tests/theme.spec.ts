import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/devtools.js";
import { openBook } from "../fixtures/reader.js";
import {
  bookFrame,
  closePanel,
  openAppearancePanel,
  uploadGeneratedBook,
} from "./reader-support.js";

const DARK_BG = "rgb(24, 24, 27)";
const SEPIA_BG = "rgb(244, 236, 216)";

async function isDark(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.classList.contains("dark"));
}

async function storedTheme(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem("leitura.theme"));
}

async function themeColor(page: Page): Promise<string | null> {
  return page.locator('meta[name="theme-color"]').getAttribute("content");
}

async function chapterBackground(page: Page): Promise<string> {
  const frame = await bookFrame(page);
  return frame.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
}

test.describe("tema do app", () => {
  test("segue o sistema por padrão, inclusive quando ele muda", async ({ desktop, baseURL }) => {
    const { page } = desktop;
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`${baseURL}/login`);
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("data-theme-choice", "system");
    expect(await isDark(page)).toBe(true);
    expect(await themeColor(page)).toBe("#18181b");

    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => isDark(page)).toBe(false);
    expect(await themeColor(page)).toBe("#ffffff");
  });

  test("o botão gira sistema, claro e escuro, e a escolha sobrevive a recarregar", async ({
    desktop,
    baseURL,
  }) => {
    const { page } = desktop;
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`${baseURL}/login`);
    const toggle = page.getByTestId("theme-toggle");

    await toggle.click(); // sistema -> claro
    await expect(toggle).toHaveAttribute("data-theme-choice", "light");
    expect(await isDark(page)).toBe(false);

    await toggle.click(); // claro -> escuro
    await expect(toggle).toHaveAttribute("data-theme-choice", "dark");
    expect(await isDark(page)).toBe(true);
    expect(await storedTheme(page)).toBe("dark");
    expect(await themeColor(page)).toBe("#18181b");

    // Escuro fixo vale mesmo com o sistema claro, e depois de recarregar.
    await page.reload();
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("data-theme-choice", "dark");
    expect(await isDark(page)).toBe(true);

    await page.getByTestId("theme-toggle").click(); // escuro -> sistema
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("data-theme-choice", "system");
    expect(await isDark(page)).toBe(false);
  });

  test("o tema já está aplicado antes de o app carregar (sem piscar)", async ({
    browser,
    baseURL,
  }) => {
    // Sem service worker (ele serviria o pacote do app por cima da interceptação) e com o pacote
    // do app trocado por um vazio: se a página ficar escura, foi só o theme-init.js.
    const context = await browser.newContext({ serviceWorkers: "block", colorScheme: "light" });
    try {
      const page = await context.newPage();
      await page.goto(`${baseURL}/login`);
      await page.evaluate(() => localStorage.setItem("leitura.theme", "dark"));
      await page.route("**/assets/*.js", (route) =>
        route.fulfill({ status: 200, contentType: "text/javascript", body: "" }),
      );
      await page.reload();
      expect(await isDark(page)).toBe(true);
      expect(await themeColor(page)).toBe("#18181b");
      await expect(page.locator("#root")).toBeEmpty();
    } finally {
      await context.close();
    }
  });

  test("o leitor segue o tema do app e deixa fixar claro, escuro ou sépia", async ({
    desktop,
    baseURL,
  }, testInfo) => {
    const { page } = desktop;
    await page.emulateMedia({ colorScheme: "dark" });
    const { book } = await uploadGeneratedBook(desktop, baseURL ?? "", testInfo, {
      chapters: 1,
      paragraphs: 10,
    });
    await openBook(page, book.id);
    expect(await chapterBackground(page)).toBe(DARK_BG);

    // O sistema volta ao claro e o capítulo acompanha, sem recarregar.
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => chapterBackground(page)).toBe("rgb(255, 255, 255)");

    // Sépia fixa o tema do leitor, independente do app.
    const panel = await openAppearancePanel(page);
    await panel.getByRole("button", { name: "Sépia" }).click();
    await closePanel(page);
    await expect.poll(() => chapterBackground(page)).toBe(SEPIA_BG);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(300);
    expect(await chapterBackground(page)).toBe(SEPIA_BG);

    // "Do app" devolve o acompanhamento.
    const again = await openAppearancePanel(page);
    await again.getByRole("button", { name: "Do app" }).click();
    await expect.poll(() => chapterBackground(page)).toBe(DARK_BG);
  });
});
