import { writeFileSync } from "node:fs";
import type { Frame, Page, TestInfo } from "@playwright/test";
import { signUp, uniqueEmail, uploadEpub } from "../fixtures/account.js";
import { type Device, expect, test } from "../fixtures/devtools.js";
import { buildEpub } from "../fixtures/make-epub.mjs";
import { jumpToFraction, openBookOnAnyPage, visibleText } from "../fixtures/reader.js";

// Um EPUB é HTML de terceiros. O foliate mostra cada capítulo num iframe com
// `sandbox="allow-same-origin allow-scripts"` e URL `blob:` (que herda a origem do app), então,
// sem CSP, um <script>, um onerror ou um link javascript: do livro rodaria como o app: com a
// sessão do usuário, o IndexedDB e o cache do service worker. Estes testes provam, no navegador,
// que a CSP enviada pela API impede isso, e que o teste sabe detectar o risco quando ela falta.

const PROBE = "pwned-probe";

type AppWindow = { __pwned?: string };

async function appFlag(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as unknown as AppWindow).__pwned ?? null);
}

/** Abre o livro hostil e vai até o capítulo malicioso, que é o último. */
async function openHostileBook(device: Device, baseURL: string, testInfo: TestInfo) {
  const file = testInfo.outputPath("hostil.epub");
  writeFileSync(file, buildEpub({ hostile: true }));
  await signUp(device.context.request, uniqueEmail("hostil"), baseURL);
  const { book } = await uploadEpub(device.context.request, file);
  await openBookOnAnyPage(device.page, book.id);
  await jumpToFraction(device.page, 0.99);
  await expect
    .poll(() => visibleText(device.page), { message: "o capítulo hostil deveria aparecer" })
    .toContain("Texto hostil visível");
  return book;
}

/** O iframe do capítulo malicioso. O shadow DOM do foliate é fechado, mas os frames são visíveis. */
async function hostileFrame(page: Page): Promise<Frame> {
  let found: Frame | null = null;
  await expect
    .poll(
      async () => {
        for (const frame of page.frames()) {
          if (frame.url().startsWith("blob:") && (await frame.locator("#js-link").count()) > 0) {
            found = frame;
            return true;
          }
        }
        return false;
      },
      { message: "o iframe do capítulo hostil deveria existir" },
    )
    .toBe(true);
  if (!found) throw new Error("iframe do capítulo hostil não encontrado");
  return found;
}

function watchProbes(page: Page): string[] {
  const probes: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(PROBE)) probes.push(request.url());
  });
  return probes;
}

test.describe("EPUB hostil", () => {
  test("a CSP impede que o livro execute script na origem do app", async ({
    desktop,
    baseURL,
  }, testInfo) => {
    // As recusas da CSP aparecem no console como erro; são a prova de que ela agiu.
    desktop.watcher.allowConsoleError(/Content Security Policy/i);
    const refusals: string[] = [];
    desktop.page.on("console", (message) => {
      if (message.type() === "error" && /Content Security Policy/i.test(message.text())) {
        refusals.push(message.text());
      }
    });
    const probes = watchProbes(desktop.page);
    // O link externo não pode ir à internet de verdade nos testes.
    await desktop.context.route("https://example.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<title>externo</title>" }),
    );

    await openHostileBook(desktop, baseURL ?? "", testInfo);
    const frame = await hostileFrame(desktop.page);

    // <script> inline e onerror: a CSP recusa os dois.
    await expect
      .poll(() => refusals.length, { message: "a CSP deveria recusar o script" })
      .toBeGreaterThan(0);
    expect(await appFlag(desktop.page)).toBeNull();
    expect(probes).toEqual([]);

    // Link `javascript:`: o app o descarta e não abre janela nenhuma.
    const pagesBefore = desktop.context.pages().length;
    await frame.locator("#js-link").click();
    await desktop.page.waitForTimeout(500); // dá tempo de um popup indevido, se existisse, aparecer
    expect(desktop.context.pages()).toHaveLength(pagesBefore);
    expect(await appFlag(desktop.page)).toBeNull();

    // Link externo de verdade: abre, mas sem acesso ao app (noopener) e sem tirar o leitor do lugar.
    const popupPromise = desktop.context.waitForEvent("page");
    await frame.locator("#ext-link").click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await popup.close();
    expect(desktop.page.url()).toContain("/read/");

    expect(await appFlag(desktop.page)).toBeNull();
    expect(probes).toEqual([]);
  });

  test("controle: sem a CSP o mesmo livro executa script (prova que o teste enxerga o risco)", async ({
    desktop,
    baseURL,
  }, testInfo) => {
    // Remove a CSP das respostas, como estaria o app sem a correção.
    await desktop.context.route("**/*", async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers["content-security-policy"];
      await route.fulfill({ response, headers });
    });
    const probes = watchProbes(desktop.page);

    await openHostileBook(desktop, baseURL ?? "", testInfo);

    await expect
      .poll(() => appFlag(desktop.page), {
        message: "sem CSP o script do livro deveria conseguir marcar a janela do app",
      })
      .not.toBeNull();
    expect(probes.length).toBeGreaterThan(0);
  });
});
