import { writeFileSync } from "node:fs";
import type { Frame, Page, TestInfo } from "@playwright/test";
import { signUp, uniqueEmail, uploadEpub } from "../fixtures/account.js";
import type { Device } from "../fixtures/devtools.js";
import { expect } from "../fixtures/devtools.js";
import { buildEpub } from "../fixtures/make-epub.mjs";

// Apoio dos specs de leitura da F1.1 (modos de leitura, fonte, rolagem automática, tema).

export type EpubOptions = Parameters<typeof buildEpub>[0];

/** Cria a conta no aparelho, envia um EPUB gerado com `options` e devolve o livro. */
export async function uploadGeneratedBook(
  device: Device,
  baseURL: string,
  testInfo: TestInfo,
  options: EpubOptions = {},
  email = uniqueEmail("leitor"),
) {
  const file = testInfo.outputPath(`livro-${Date.now()}.epub`);
  writeFileSync(file, buildEpub(options));
  await signUp(device.context.request, email, baseURL);
  const { book } = await uploadEpub(device.context.request, file);
  return { book, email };
}

/** Preferências do leitor já gravadas antes de a página abrir (por aparelho, no `localStorage`). */
export async function seedReaderPrefs(page: Page, prefs: Record<string, unknown>): Promise<void> {
  await page.addInitScript((value) => {
    localStorage.setItem("leitura.readerPrefs", JSON.stringify(value));
  }, prefs);
}

/** O iframe do capítulo aberto agora (o shadow DOM do foliate é fechado, mas os quadros aparecem). */
export async function bookFrame(page: Page): Promise<Frame> {
  let found: Frame | null = null;
  await expect
    .poll(
      async () => {
        const frames = page.frames().filter((frame) => frame.url().startsWith("blob:"));
        for (const frame of frames.reverse()) {
          if (!frame.isDetached() && (await frame.locator("p").count()) > 0) {
            found = frame;
            return true;
          }
        }
        return false;
      },
      { message: "o capítulo deveria estar num iframe" },
    )
    .toBe(true);
  if (!found) throw new Error("iframe do capítulo não encontrado");
  return found;
}

export async function computedFontSize(page: Page, selector: string): Promise<number> {
  const frame = await bookFrame(page);
  return frame.evaluate(
    (sel) => Number.parseFloat(getComputedStyle(document.querySelector(sel) as Element).fontSize),
    selector,
  );
}

export async function openAppearancePanel(page: Page) {
  const button = page.getByRole("button", { name: "Aparência e tamanho da fonte" });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  return page.getByRole("dialog", { name: "Aparência e fonte" });
}

export async function closePanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Fechar painel" }).click();
}

/** Marcador `marcador-cN-pM` do primeiro parágrafo que aparece no texto, ou `null`. */
export function firstMarker(text: string): string | null {
  return /marcador-c\d+-p\d+/.exec(text)?.[0] ?? null;
}

/** Centraliza o mouse sobre o leitor para a roda cair no capítulo. */
export async function hoverReader(page: Page): Promise<void> {
  const size = page.viewportSize() ?? { width: 1280, height: 800 };
  await page.mouse.move(size.width / 2, size.height / 2);
}

export async function readerFlow(page: Page): Promise<string | null> {
  return page.locator("[data-reader-flow]").getAttribute("data-reader-flow");
}
