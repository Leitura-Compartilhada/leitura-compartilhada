import {
  type Browser,
  type BrowserContext,
  test as base,
  devices,
  expect,
  type Page,
} from "@playwright/test";

/**
 * Erros que o foliate-js escreve no console quando uma restauração cai para o próximo passo da
 * cascata. São esperados nos testes de fallback e só neles; por isso começam fora da lista e cada
 * teste os libera com `allowConsoleError`.
 */
export const FOLIATE_FALLBACK_ERRORS = [/Could not resolve target/, /Could not go to/];

/**
 * Corrida conhecida do foliate-js ao desmontar a página: `paginator.js` agenda
 * `doc.fonts.ready.then(() => this.expand())` e tem um `ResizeObserver`; se o documento do capítulo
 * já está sendo descarregado (recarregar, sair do leitor), `expand()` roda sem `body` e
 * `setStylesImportant(null)` lança. Ninguém vê isso na tela. Só é aceito **logo depois de uma
 * navegação do quadro principal**; a mesma mensagem no meio da leitura continua reprovando o teste.
 */
const FOLIATE_UNLOAD_RACE = /Cannot destructure property 'style' of .* as it is null/;
const UNLOAD_RACE_WINDOW_MS = 3_000;

/**
 * Observa um contexto do navegador como o DevTools faria e transforma o que o DevTools mostraria em
 * vermelho em falha de teste: `console.error`, exceções da página, respostas 4xx/5xx e requisições
 * que falham. Olhar a tela não pega nada disso.
 */
export class PageWatcher {
  private readonly problems: string[] = [];
  private readonly allowedConsole: RegExp[] = [];
  private readonly expectedStatuses = new Set<number>();
  private ignoreNetworkFailures = false;

  constructor(
    readonly label: string,
    context: BrowserContext,
  ) {
    for (const page of context.pages()) this.attach(page);
    context.on("page", (page) => this.attach(page));
  }

  /** Libera um `console.error` esperado neste teste. */
  allowConsoleError(...patterns: RegExp[]): void {
    this.allowedConsole.push(...patterns);
  }

  /** Libera um status HTTP esperado (por exemplo, o 401 de um teste de acesso negado). */
  expectStatus(...statuses: number[]): void {
    for (const status of statuses) this.expectedStatuses.add(status);
  }

  /** Executa `action` com o contexto sem rede e sem acusar as requisições que falharem por isso. */
  async whileOffline<T>(context: BrowserContext, action: () => Promise<T>): Promise<T> {
    this.ignoreNetworkFailures = true;
    await context.setOffline(true);
    try {
      return await action();
    } finally {
      await context.setOffline(false);
      this.ignoreNetworkFailures = false;
    }
  }

  assertClean(): void {
    expect(this.problems, `erros de console ou de rede (${this.label})`).toEqual([]);
  }

  private attach(page: Page): void {
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (this.allowedConsole.some((pattern) => pattern.test(text))) return;
      // Ficar offline de propósito faz o Chrome registrar cada requisição que falha como erro.
      if (this.ignoreNetworkFailures && /Failed to load resource: net::ERR_/.test(text)) return;
      this.problems.push(`[${this.label}] console.error: ${text}`);
    });
    let lastNavigationAt = Number.NEGATIVE_INFINITY;
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        lastNavigationAt = Date.now();
      }
    });
    page.on("pageerror", (error) => {
      const justNavigated = Date.now() - lastNavigationAt < UNLOAD_RACE_WINDOW_MS;
      if (justNavigated && FOLIATE_UNLOAD_RACE.test(error.message)) return;
      this.problems.push(`[${this.label}] exceção na página: ${error.message}`);
    });
    page.on("response", (response) => {
      const status = response.status();
      if (status < 400 || this.expectedStatuses.has(status)) return;
      this.problems.push(
        `[${this.label}] HTTP ${status} ${response.request().method()} ${response.url()}`,
      );
    });
    page.on("requestfailed", (request) => {
      const reason = request.failure()?.errorText ?? "desconhecido";
      // ERR_ABORTED acontece em navegação normal (requisição cancelada ao trocar de página).
      if (this.ignoreNetworkFailures || reason.includes("ERR_ABORTED")) return;
      this.problems.push(`[${this.label}] requisição falhou (${reason}): ${request.url()}`);
    });
  }
}

export type Device = { context: BrowserContext; page: Page; watcher: PageWatcher };

async function openDevice(
  browser: Browser,
  label: string,
  options: Parameters<Browser["newContext"]>[0],
): Promise<Device> {
  const context = await browser.newContext(options);
  const watcher = new PageWatcher(label, context);
  const page = await context.newPage();
  // Estresse opcional: `E2E_CPU_THROTTLE=6 pnpm e2e` deixa a CPU 6 vezes mais lenta, como um runner
  // de CI ou um celular fraco. É assim que se reproduz uma corrida que só aparece em máquina lenta.
  const throttle = Number(process.env.E2E_CPU_THROTTLE ?? 0);
  if (throttle > 1) {
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  }
  return { context, page, watcher };
}

/** Dois aparelhos com a mesma conta: um desktop e um Pixel 7. Cada teste os usa como quiser. */
export const test = base.extend<{ desktop: Device; mobile: Device }>({
  desktop: async ({ browser, baseURL }, use) => {
    const device = await openDevice(browser, "desktop", {
      baseURL,
      viewport: { width: 1280, height: 800 },
    });
    await use(device);
    try {
      device.watcher.assertClean();
    } finally {
      await device.context.close();
    }
  },
  mobile: async ({ browser, baseURL }, use) => {
    const device = await openDevice(browser, "celular", { ...devices["Pixel 7"], baseURL });
    await use(device);
    try {
      device.watcher.assertClean();
    } finally {
      await device.context.close();
    }
  },
});

export { expect };
