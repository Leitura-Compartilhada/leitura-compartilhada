import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/devtools.js";
import { currentCfi, openBook, savedCfiOnServer, visibleText } from "../fixtures/reader.js";
import { bookFrame, seedReaderPrefs, uploadGeneratedBook } from "./reader-support.js";

const PLAY = { name: "Iniciar a rolagem automática" };
const PAUSE = { name: "Pausar a rolagem automática" };

/** Posição (px) do contêiner que rola na rolagem contínua, lida de dentro do iframe do capítulo. */
async function scrollTop(page: Page): Promise<number> {
  const frame = await bookFrame(page);
  return frame.evaluate(() => {
    for (let el = window.frameElement?.parentElement ?? null; el; el = el.parentElement) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === "auto" || overflow === "scroll") return el.scrollTop;
    }
    return -1;
  });
}

test.describe("rolagem automática", () => {
  test("rola de forma suave (um passo por quadro), grava a posição e pausa ao tocar", async ({
    desktop,
    baseURL,
  }, testInfo) => {
    // Nível 10 = 120 px/s.
    await seedReaderPrefs(desktop.page, { flow: "scrolled", autoScrollSpeed: 10 });
    const { book } = await uploadGeneratedBook(desktop, baseURL ?? "", testInfo);
    await openBook(desktop.page, book.id);
    const startCfi = await currentCfi(desktop.page);

    await desktop.page.getByRole("button", PLAY).click();
    await expect(desktop.page.getByRole("button", PAUSE)).toBeVisible();
    await expect(desktop.page.locator("[data-reader-autoscroll]")).toHaveAttribute(
      "data-reader-autoscroll",
      "true",
    );

    // Amostra a posição a cada ~50 ms durante 1,5 s. Suave = muitos valores distintos,
    // nunca para trás e sem saltos (o `next(distance)` do foliate daria uns 10 passos por segundo).
    const samples: number[] = [];
    const started = Date.now();
    while (Date.now() - started < 1_500) {
      samples.push(await scrollTop(desktop.page));
      await desktop.page.waitForTimeout(50);
    }
    const distinct = new Set(samples).size;
    const moved = (samples.at(-1) ?? 0) - (samples[0] ?? 0);
    const biggestStep = Math.max(...samples.slice(1).map((value, i) => value - (samples[i] ?? 0)));
    testInfo.annotations.push({
      type: "spike",
      description: `amostras=${samples.length} distintas=${distinct} andou=${moved.toFixed(0)}px maiorPasso=${biggestStep.toFixed(1)}px`,
    });
    expect(distinct, "deveria haver muitas posições distintas").toBeGreaterThanOrEqual(
      Math.floor(samples.length * 0.7),
    );
    expect(samples.every((value, i) => i === 0 || value >= (samples[i - 1] ?? 0))).toBe(true);
    expect(moved, "120 px/s por 1,5 s").toBeGreaterThan(80);
    expect(moved).toBeLessThan(300);
    // Com CPU lenta (E2E_CPU_THROTTLE) o intervalo entre amostras cresce; o passo é proporcional.
    expect(biggestStep).toBeLessThan(120);

    // A posição vai para o servidor sem precisar parar (ponto de salvamento a cada 5 s).
    await expect
      .poll(() => savedCfiOnServer(desktop.context.request, book.id), {
        timeout: 20_000,
        intervals: [500],
        message: "o servidor deveria receber a posição durante a rolagem",
      })
      .not.toBeNull();
    expect(await currentCfi(desktop.page)).not.toBe(startCfi);

    // Tocar no texto pausa; depois disso a posição não anda mais.
    await desktop.page.mouse.click(640, 400);
    await expect(desktop.page.locator("[data-reader-autoscroll]")).toHaveAttribute(
      "data-reader-autoscroll",
      "false",
    );
    const stopped = await scrollTop(desktop.page);
    await desktop.page.waitForTimeout(600);
    expect(Math.abs((await scrollTop(desktop.page)) - stopped)).toBeLessThan(3);
  });

  test("passa de capítulo sozinha e a tecla pausa", async ({ desktop, baseURL }, testInfo) => {
    await seedReaderPrefs(desktop.page, { flow: "scrolled", autoScrollSpeed: 10 });
    const { book } = await uploadGeneratedBook(desktop, baseURL ?? "", testInfo, {
      chapters: 2,
      paragraphs: 6,
    });
    await openBook(desktop.page, book.id);
    await desktop.page.getByRole("button", PLAY).click();
    await expect
      .poll(() => visibleText(desktop.page), {
        message: "a rolagem deveria atravessar o capítulo 1",
        timeout: 45_000,
      })
      .toContain("Capítulo 2,");

    await desktop.page.keyboard.press("Shift");
    await expect(desktop.page.locator("[data-reader-autoscroll]")).toHaveAttribute(
      "data-reader-autoscroll",
      "false",
    );
  });

  test("no fim do livro para sozinha, sem erro", async ({ desktop, baseURL }, testInfo) => {
    await seedReaderPrefs(desktop.page, { flow: "scrolled", autoScrollSpeed: 10 });
    const { book } = await uploadGeneratedBook(desktop, baseURL ?? "", testInfo, {
      chapters: 1,
      paragraphs: 4,
    });
    await openBook(desktop.page, book.id);
    await desktop.page.getByRole("button", PLAY).click();
    await expect(desktop.page.locator("[data-reader-autoscroll]")).toHaveAttribute(
      "data-reader-autoscroll",
      "false",
      { timeout: 45_000 },
    );
  });

  test("no modo em páginas vira a página de tempos em tempos", async ({
    desktop,
    baseURL,
  }, testInfo) => {
    // Nível 10 = uma página a cada 9 s.
    await seedReaderPrefs(desktop.page, { flow: "paginated", autoScrollSpeed: 10 });
    const { book } = await uploadGeneratedBook(desktop, baseURL ?? "", testInfo);
    const first = await openBook(desktop.page, book.id);
    await desktop.page.getByRole("button", PLAY).click();
    await expect
      .poll(() => visibleText(desktop.page), { timeout: 30_000, intervals: [500] })
      .not.toBe(first);
    // A barra some ao iniciar; tocar no centro pausa e a traz de volta.
    await desktop.page.mouse.click(640, 400);
    await expect(desktop.page.locator("[data-reader-autoscroll]")).toHaveAttribute(
      "data-reader-autoscroll",
      "false",
    );
  });

  for (const device of ["desktop", "mobile"] as const) {
    test(`com as barras escondidas há um botão à vista que pausa e devolve as barras (${device})`, async ({
      desktop,
      mobile,
      baseURL,
    }, testInfo) => {
      const d = device === "desktop" ? desktop : mobile;
      await seedReaderPrefs(d.page, { flow: "scrolled", autoScrollSpeed: 10 });
      const { book } = await uploadGeneratedBook(d, baseURL ?? "", testInfo);
      await openBook(d.page, book.id);
      const header = d.page.locator("header");
      const floatingPause = d.page.locator(
        "[data-reader-status] > button[aria-label='Parar a rolagem automática']",
      );

      await d.page.getByRole("button", PLAY).click();
      // Barras escondidas: fora do foco e da árvore de acessibilidade (`inert`), e a saída está à vista.
      await expect(header).toHaveJSProperty("inert", true);
      await expect(d.page.locator("footer")).toHaveJSProperty("inert", true);
      await expect(floatingPause).toBeVisible();

      await floatingPause.click();
      await expect(d.page.locator("[data-reader-autoscroll]")).toHaveAttribute(
        "data-reader-autoscroll",
        "false",
      );
      // Ao parar, as barras voltam e a navegação responde.
      await expect(header).toHaveJSProperty("inert", false);
      await expect(floatingPause).toHaveCount(0);
      await d.page.getByRole("link", { name: "Voltar à estante" }).click();
      await expect(d.page.getByRole("heading", { name: "Minha estante" })).toBeVisible();
    });
  }

  test("pausar rolando ou com a tecla também devolve as barras", async ({
    desktop,
    baseURL,
  }, testInfo) => {
    await seedReaderPrefs(desktop.page, { flow: "scrolled", autoScrollSpeed: 10 });
    const { book } = await uploadGeneratedBook(desktop, baseURL ?? "", testInfo);
    await openBook(desktop.page, book.id);
    await desktop.page.getByRole("button", PLAY).click();
    await expect(desktop.page.locator("header")).toHaveJSProperty("inert", true);
    await desktop.page.keyboard.press("Shift");
    await expect(desktop.page.locator("header")).toHaveJSProperty("inert", false);
    await expect(desktop.page.getByRole("button", PLAY)).toBeVisible();
  });
});
