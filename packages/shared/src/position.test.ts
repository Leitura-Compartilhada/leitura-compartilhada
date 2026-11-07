import { describe, expect, it } from "vitest";
import {
  MAX_FUTURE_SKEW_MS,
  MAX_RTT_FOR_OFFSET_MS,
  MIN_SNIPPET_LENGTH,
  SNIPPET_LENGTH,
} from "./constants.js";
import {
  clampFutureStamp,
  correctedNow,
  estimateClockOffset,
  makeTextSnippet,
  nextUpdatedAt,
  restoreStrategies,
} from "./position.js";
import type { ReadingPosition } from "./reading.js";

const HASH = "a".repeat(64);
const LONG_TEXT = "Era uma vez um leitor que queria voltar exatamente ao mesmo parágrafo.";

function saved(overrides: Partial<ReadingPosition> = {}): ReadingPosition {
  return {
    cfi: "epubcfi(/6/4!/4/2)",
    percentage: 0.4,
    textSnippet: LONG_TEXT,
    fileHash: HASH,
    ...overrides,
  };
}

describe("restoreStrategies", () => {
  it("sem posição salva começa do início", () => {
    expect(restoreStrategies(null, HASH)).toEqual(["start"]);
  });

  it("usa a ordem CFI, trecho, percentual, início quando tudo vale", () => {
    expect(restoreStrategies(saved(), HASH)).toEqual(["cfi", "snippet", "percentage", "start"]);
  });

  it("descarta o CFI quando o arquivo mudou, mas mantém os fallbacks", () => {
    expect(restoreStrategies(saved(), "b".repeat(64))).toEqual(["snippet", "percentage", "start"]);
  });

  it("descarta o CFI ausente", () => {
    expect(restoreStrategies(saved({ cfi: null }), HASH)).toEqual([
      "snippet",
      "percentage",
      "start",
    ]);
  });

  it("descarta trecho curto demais ou vazio", () => {
    const curto = "x".repeat(MIN_SNIPPET_LENGTH - 1);
    expect(restoreStrategies(saved({ textSnippet: curto }), HASH)).toEqual([
      "cfi",
      "percentage",
      "start",
    ]);
    expect(restoreStrategies(saved({ textSnippet: null }), HASH)).toEqual([
      "cfi",
      "percentage",
      "start",
    ]);
  });

  it("descarta percentual zero, que não diz nada", () => {
    expect(restoreStrategies(saved({ percentage: 0 }), HASH)).toEqual(["cfi", "snippet", "start"]);
  });

  it("termina sempre em início", () => {
    const todas = [
      restoreStrategies(null, HASH),
      restoreStrategies(saved(), HASH),
      restoreStrategies(saved({ cfi: null, textSnippet: null, percentage: 0 }), HASH),
    ];
    for (const lista of todas) expect(lista.at(-1)).toBe("start");
  });
});

describe("makeTextSnippet", () => {
  it("junta espaços e quebras de linha", () => {
    expect(makeTextSnippet(`  ${LONG_TEXT}\n\n   Outra   linha  `)).toBe(
      `${LONG_TEXT} Outra linha`,
    );
  });

  it("corta no limite de caracteres", () => {
    const resultado = makeTextSnippet("palavra ".repeat(100));
    expect(resultado).not.toBeNull();
    expect(Array.from(resultado ?? "").length).toBe(SNIPPET_LENGTH);
  });

  it("devolve null para texto curto demais", () => {
    expect(makeTextSnippet("curto")).toBeNull();
    expect(makeTextSnippet("   \n  ")).toBeNull();
  });

  it("não parte um caractere fora do plano básico no corte", () => {
    const resultado = makeTextSnippet("😀".repeat(SNIPPET_LENGTH + 10)) ?? "";
    expect(Array.from(resultado).length).toBe(SNIPPET_LENGTH);
    expect(resultado.endsWith("😀")).toBe(true);
  });

  it("conta caracteres Unicode, não unidades UTF-16, no mínimo", () => {
    expect(makeTextSnippet("😀".repeat(MIN_SNIPPET_LENGTH))).not.toBeNull();
  });
});

describe("correção de relógio", () => {
  it("estima o desvio com latência simétrica", () => {
    // cliente enviou em 1000 e recebeu em 1200; o servidor respondeu 5100 (meio do trajeto = 1100)
    expect(estimateClockOffset(1000, 1200, 5100)).toBe(4000);
  });

  it("desvio negativo quando o relógio do cliente está adiantado", () => {
    expect(estimateClockOffset(10_000, 10_100, 5_050)).toBe(-5000);
  });

  it("aplica o desvio ao horário local", () => {
    expect(correctedNow(1000, 4000)).toBe(5000);
    expect(correctedNow(1000, -250)).toBe(750);
  });

  it("descarta medida com ida e volta lenta demais", () => {
    expect(estimateClockOffset(0, MAX_RTT_FOR_OFFSET_MS, 1000)).toBe(0);
    expect(estimateClockOffset(0, MAX_RTT_FOR_OFFSET_MS + 1, 1000)).toBeNull();
  });

  it("descarta medida em que o relógio local andou para trás durante a chamada", () => {
    expect(estimateClockOffset(1000, 900, 1000)).toBeNull();
  });
});

describe("nextUpdatedAt", () => {
  it("usa o horário corrigido quando ele está à frente do último gravado", () => {
    expect(nextUpdatedAt(10_000, 500, 9_000)).toBe(10_500);
  });

  it("nunca regride nem repete, mesmo com o relógio voltando no tempo", () => {
    let ultimo = 0;
    const relogio = [5_000, 5_100, 4_000, 4_000, 3_000]; // o relógio volta duas vezes
    const gravados = relogio.map((agora) => {
      ultimo = nextUpdatedAt(agora, 0, ultimo);
      return ultimo;
    });
    expect(gravados).toEqual([5_000, 5_100, 5_101, 5_102, 5_103]);
    expect(new Set(gravados).size).toBe(gravados.length);
  });
});

describe("clampFutureStamp", () => {
  const agora = 1_000_000;

  it("mantém horários dentro da tolerância", () => {
    expect(clampFutureStamp(agora - 5_000, agora)).toBe(agora - 5_000);
    expect(clampFutureStamp(agora + MAX_FUTURE_SKEW_MS, agora)).toBe(agora + MAX_FUTURE_SKEW_MS);
  });

  it("rebaixa para a hora do servidor o que passa da tolerância", () => {
    const adiantado = agora + 60 * 60 * 1000; // celular uma hora à frente
    expect(clampFutureStamp(adiantado, agora)).toBe(agora);
    expect(clampFutureStamp(agora + MAX_FUTURE_SKEW_MS + 1, agora)).toBe(agora);
  });
});
