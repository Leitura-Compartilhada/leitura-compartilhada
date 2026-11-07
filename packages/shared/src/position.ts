import {
  MAX_FUTURE_SKEW_MS,
  MAX_RTT_FOR_OFFSET_MS,
  MIN_SNIPPET_LENGTH,
  SNIPPET_LENGTH,
} from "./constants.js";
import type { ReadingPosition } from "./reading.js";

/**
 * Formas de recolocar o leitor onde ele parou, da mais precisa para a mais grosseira.
 * Este módulo só decide a ordem. Aplicar cada uma (foliate, rede) é com quem chama.
 */
export type RestoreStrategy = "cfi" | "snippet" | "percentage" | "start";

/**
 * Lista, em ordem de tentativa, o que ainda vale para a posição salva.
 * - O CFI só vale se o arquivo é o mesmo: com outra edição o endereço aponta para outro lugar.
 * - O trecho de texto sobrevive à troca de arquivo, desde que seja longo o bastante para ser buscado.
 * - O percentual zero não informa nada. "start" fecha a lista e nunca falha.
 */
export function restoreStrategies(
  saved: ReadingPosition | null,
  currentFileHash: string,
): RestoreStrategy[] {
  if (!saved) return ["start"];
  const strategies: RestoreStrategy[] = [];
  if (saved.cfi && saved.fileHash === currentFileHash) strategies.push("cfi");
  if (saved.textSnippet && characters(saved.textSnippet).length >= MIN_SNIPPET_LENGTH) {
    strategies.push("snippet");
  }
  if (saved.percentage > 0) strategies.push("percentage");
  strategies.push("start");
  return strategies;
}

/**
 * Trecho de texto para gravar junto da posição. Junta espaços e quebras de linha e corta por
 * caractere Unicode (não por unidade UTF-16, que partiria emojis e ideogramas raros ao meio).
 * Devolve `null` quando sobra pouco texto para ser útil na busca.
 */
export function makeTextSnippet(text: string): string | null {
  const flat = characters(text.replace(/\s+/g, " ").trim());
  if (flat.length < MIN_SNIPPET_LENGTH) return null;
  return flat.slice(0, SNIPPET_LENGTH).join("");
}

/**
 * Desvio estimado entre o relógio do servidor e o do cliente, em ms (servidor − cliente).
 * Assume que ida e volta levam o mesmo tempo, então o servidor respondeu no meio do trajeto; o
 * erro dessa hipótese é no máximo metade do tempo de ida e volta. Medidas lentas demais, ou com
 * relógio que andou para trás durante a chamada, são descartadas (`null`).
 */
export function estimateClockOffset(
  sentAt: number,
  receivedAt: number,
  serverTime: number,
): number | null {
  const roundTrip = receivedAt - sentAt;
  if (roundTrip < 0 || roundTrip > MAX_RTT_FOR_OFFSET_MS) return null;
  return Math.round(serverTime - (sentAt + receivedAt) / 2);
}

/** Horário local corrigido pelo desvio. */
export function correctedNow(now: number, offset: number): number {
  return now + offset;
}

/**
 * `updatedAt` para gravar numa mudança: o horário corrigido, mas nunca menor ou igual ao último
 * gravado neste aparelho. Sem isso, um relógio que volta (ajuste de NTP, troca de fuso mal feita)
 * faria uma leitura nova perder para a antiga.
 */
export function nextUpdatedAt(now: number, offset: number, lastStamp: number): number {
  return Math.max(correctedNow(now, offset), lastStamp + 1);
}

/**
 * O servidor rebaixa para a própria hora um `updatedAt` que passa da tolerância à frente do seu
 * relógio. Um celular adiantado em uma hora, antes de conhecer o desvio, ganharia todo conflito.
 */
export function clampFutureStamp(updatedAt: number, serverNow: number): number {
  return updatedAt > serverNow + MAX_FUTURE_SKEW_MS ? serverNow : updatedAt;
}

function characters(text: string): string[] {
  return Array.from(text);
}
