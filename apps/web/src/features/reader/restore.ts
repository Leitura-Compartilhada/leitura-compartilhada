import { type ReadingPosition, type RestoreStrategy, restoreStrategies } from "@leitura/shared";

/** Alvo de um CFI já resolvido pelo leitor. */
export type ResolvedCfi = { index: number; sectionCount: number };

/** O que o leitor mostra depois de navegar até um CFI. */
export type ObservedLocation = {
  sectionIndex: number;
  /** O ponto do CFI está dentro do trecho visível? */
  containsCfiPoint: boolean;
};

/**
 * Fronteira fina entre a lógica de restauração e o foliate-js. A cascata só conversa com esta
 * interface, então é testável com um falso, sem navegador.
 */
export type ReaderPort = {
  /** `null` se o CFI não resolve. O foliate não lança erro nesse caso, por isso a conferência. */
  resolveCfi(cfi: string): ResolvedCfi | null;
  /** Navega até o CFI. Pode lançar. */
  initAt(cfi: string): Promise<void>;
  /** Onde o leitor está agora, para conferir se o CFI de fato foi alcançado. */
  readLocation(expectedCfi: string): ObservedLocation | null;
  /** Seção que contém esta fração do livro (0 a 1), ou `null` se não souber. */
  sectionIndexAt(fraction: number): number | null;
  sectionCount(): number;
  /** CFI da primeira ocorrência do trecho na seção, ou `null`. */
  searchSnippet(snippet: string, sectionIndex: number): Promise<string | null>;
  clearSearch(): void;
  goTo(cfi: string): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  /** Abre no início do texto. Nunca deve falhar. */
  start(): Promise<void>;
};

export type RestoreOutcome = {
  strategy: RestoreStrategy;
  /** `true` quando o passo foi conferido (CFI verificado). Os demais são aproximações. */
  verified: boolean;
  /** Passos tentados que falharam, na ordem. */
  failed: RestoreStrategy[];
};

/** Seções da mais próxima de `center` para as mais distantes (vizinhas dos dois lados). */
export function sectionsByDistance(center: number, count: number): number[] {
  const order: number[] = [];
  for (let distance = 0; distance < count; distance++) {
    const before = center - distance;
    const after = center + distance;
    if (before >= 0 && before < count) order.push(before);
    if (distance > 0 && after >= 0 && after < count) order.push(after);
  }
  return order;
}

async function tryCfi(port: ReaderPort, cfi: string): Promise<boolean> {
  const resolved = port.resolveCfi(cfi);
  if (!resolved || resolved.index < 0 || resolved.index >= resolved.sectionCount) return false;
  await port.initAt(cfi);
  const observed = port.readLocation(cfi);
  return observed?.sectionIndex === resolved.index && observed.containsCfiPoint;
}

async function trySnippet(port: ReaderPort, snippet: string, percentage: number): Promise<boolean> {
  const count = port.sectionCount();
  if (count <= 0) return false;
  const guess = port.sectionIndexAt(percentage) ?? 0;
  try {
    for (const index of sectionsByDistance(Math.min(Math.max(guess, 0), count - 1), count)) {
      const cfi = await port.searchSnippet(snippet, index);
      if (cfi) {
        await port.goTo(cfi);
        return true;
      }
    }
    return false;
  } finally {
    port.clearSearch();
  }
}

async function runStrategy(
  port: ReaderPort,
  strategy: RestoreStrategy,
  saved: ReadingPosition | null,
): Promise<boolean> {
  switch (strategy) {
    case "cfi":
      return saved?.cfi ? tryCfi(port, saved.cfi) : false;
    case "snippet":
      return saved?.textSnippet ? trySnippet(port, saved.textSnippet, saved.percentage) : false;
    case "percentage":
      await port.goToFraction(saved?.percentage ?? 0);
      return true;
    case "start":
      await port.start();
      return true;
  }
}

/**
 * Cascata de restauração: CFI (conferido) -> trecho de texto -> percentual -> início. Qualquer
 * falha ou exceção de um passo leva ao próximo; "start" fecha a lista. A ordem e a validade de
 * cada passo vêm de `restoreStrategies`, em @leitura/shared.
 */
export async function restorePosition(
  port: ReaderPort,
  saved: ReadingPosition | null,
  currentFileHash: string,
): Promise<RestoreOutcome> {
  const failed: RestoreStrategy[] = [];
  let lastError: unknown;
  for (const strategy of restoreStrategies(saved, currentFileHash)) {
    try {
      if (await runStrategy(port, strategy, saved)) {
        return { strategy, verified: strategy === "cfi", failed };
      }
    } catch (error) {
      lastError = error;
      console.warn(`restauração por "${strategy}" falhou`, error);
    }
    failed.push(strategy);
  }
  // "start" costuma terminar a lista com sucesso; chegar aqui é uma falha do próprio leitor.
  throw new Error("não foi possível abrir o livro em nenhuma posição", { cause: lastError });
}
