import { type APIRequestContext, expect, type Page } from "@playwright/test";
import { progressResponseSchema } from "../../packages/shared/src/index.js";

/**
 * O `<foliate-view>` usa shadow DOM fechado, então o Playwright não enxerga o texto dentro dele.
 * O que o leitor mostra é lido pela API do próprio elemento: `lastLocation.range` é a área visível.
 */
type FoliateView = {
  lastLocation?: { range?: Range; cfi?: string; fraction?: number };
  goToFraction(fraction: number): Promise<void>;
};

const SNIPPET_PREVIEW = 60;

/** Texto hoje visível no leitor, com espaços normalizados. Vazio enquanto o livro não abriu. */
export async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as FoliateView | null;
    return (view?.lastLocation?.range?.toString() ?? "").replace(/\s+/g, " ").trim();
  });
}

export async function currentCfi(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const view = document.querySelector("foliate-view") as unknown as FoliateView | null;
    return view?.lastLocation?.cfi ?? null;
  });
}

/**
 * Espera a restauração da posição terminar. O leitor marca `data-reader-status="ready"` só depois
 * disso; olhar o texto não basta, porque numa restauração com fallback a primeira página do livro
 * aparece por instantes antes do salto (e num runner lento esse instante dura o suficiente).
 */
async function waitForReaderReady(page: Page): Promise<void> {
  await expect(
    page.locator('[data-reader-status="ready"]'),
    "o leitor deveria terminar de abrir e restaurar a posição",
  ).toBeVisible({ timeout: 20_000 });
}

/** Abre o livro e espera o leitor mostrar texto (a restauração já terminou quando ele aparece). */
export async function openBook(page: Page, bookId: string): Promise<string> {
  await page.goto(`/read/${bookId}`);
  await waitForReaderReady(page);
  await expect
    .poll(() => visibleText(page), { message: "o leitor deveria mostrar texto" })
    .not.toBe("");
  return visibleText(page);
}

/**
 * Para livros reais, cuja primeira página pode ser só uma capa (imagem, sem texto). Espera o
 * leitor ter uma posição e ela parar de mudar, em vez de exigir texto visível.
 */
export async function openBookOnAnyPage(page: Page, bookId: string): Promise<void> {
  await page.goto(`/read/${bookId}`);
  await waitForReaderReady(page);
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const now = await currentCfi(page);
        const settled = now !== null && now === previous;
        previous = now;
        return settled;
      },
      { message: "o leitor deveria abrir e estabilizar a posição", intervals: [400] },
    )
    .toBe(true);
}

/** Quanto esperar a página mudar antes de apertar a seta de novo. */
const PAGE_TURN_WAIT_MS = 1_500;
const PAGE_TURN_ATTEMPTS = 6;

/**
 * Vira `count` páginas com a seta para a direita. O foliate ignora uma virada pedida enquanto a
 * animação da anterior ainda corre, então, se a página não mudou, aperta a seta de novo em vez
 * de esperar para sempre por uma tecla que foi descartada.
 */
export async function turnPages(page: Page, count: number): Promise<string> {
  let text = await visibleText(page);
  for (let i = 0; i < count; i++) {
    const before = text;
    let turned = false;
    for (let attempt = 0; attempt < PAGE_TURN_ATTEMPTS && !turned; attempt++) {
      await page.keyboard.press("ArrowRight");
      turned = await expect
        .poll(() => visibleText(page), { timeout: PAGE_TURN_WAIT_MS })
        .not.toBe(before)
        .then(
          () => true,
          () => false,
        );
    }
    expect(turned, `a página ${i + 1} deveria mudar`).toBe(true);
    text = await visibleText(page);
  }
  return text;
}

/** Os primeiros caracteres do texto visível, que é o que o outro aparelho precisa reencontrar. */
export function startOf(text: string): string {
  return text.slice(0, SNIPPET_PREVIEW);
}

/**
 * Pula para uma fração do livro. Espera a posição (CFI) mudar, e não o texto: a página de destino
 * pode ser uma imagem. Devolve o texto visível, que pode estar vazio.
 */
export async function jumpToFraction(page: Page, fraction: number): Promise<string> {
  const before = await currentCfi(page);
  await page.evaluate(async (value) => {
    const view = document.querySelector("foliate-view") as unknown as FoliateView;
    await view.goToFraction(value);
  }, fraction);
  await expect
    .poll(() => currentCfi(page), { message: "o salto deveria mudar a posição" })
    .not.toBe(before);
  return visibleText(page);
}

export function isSyncRequest(url: string, method: string): boolean {
  return method === "POST" && new URL(url).pathname === "/api/sync";
}

/** CFI que o servidor guarda hoje para o livro, ou `null` se ainda não há posição salva. */
export async function savedCfiOnServer(
  request: APIRequestContext,
  bookId: string,
): Promise<string | null> {
  const response = await request.get(`/api/progress/${bookId}`);
  return progressResponseSchema.parse(await response.json()).readingState?.cfi ?? null;
}

/**
 * Espera o servidor guardar a posição em que o leitor está **agora**. É a condição certa antes de
 * abrir o livro em outro aparelho: esperar "a primeira resposta de sync" não serve, porque o
 * debounce pode disparar no meio da leitura e enviar uma posição intermediária.
 */
export async function waitForServerToHold(
  page: Page,
  request: APIRequestContext,
  bookId: string,
): Promise<string> {
  const cfi = await currentCfi(page);
  expect(cfi, "o leitor deveria ter uma posição").not.toBeNull();
  await expect
    .poll(() => savedCfiOnServer(request, bookId), {
      timeout: 20_000,
      intervals: [500],
      message: "o servidor deveria guardar a posição atual do leitor",
    })
    .toBe(cfi);
  return cfi ?? "";
}
