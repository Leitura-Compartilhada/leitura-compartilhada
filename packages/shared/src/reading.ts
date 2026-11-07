import { z } from "zod";
import { DEVICE_ID_PATTERN, FILE_HASH_PATTERN, MAX_CFI_LENGTH } from "./constants.js";

export const readingStatusSchema = z.enum(["want_to_read", "reading", "read", "abandoned"]);
export type ReadingStatus = z.infer<typeof readingStatusSchema>;

/**
 * Posição de leitura. O CFI é a fonte principal; percentual, trecho de texto e
 * hash do arquivo servem de fallback quando o CFI não resolve (ex.: arquivo trocado).
 */
export const readingPositionSchema = z.object({
  cfi: z.string().min(1).max(MAX_CFI_LENGTH).nullable(),
  percentage: z.number().min(0).max(1),
  textSnippet: z.string().max(200).nullable(),
  fileHash: z.string().regex(FILE_HASH_PATTERN),
});
export type ReadingPosition = z.infer<typeof readingPositionSchema>;

export const readingStateSchema = readingPositionSchema.extend({
  bookId: z.string().uuid(),
  status: readingStatusSchema,
  deviceId: z.string().regex(DEVICE_ID_PATTERN),
  /** ms desde a época, no relógio já corrigido do cliente. Base do last-write-wins. */
  updatedAt: z.number().int().nonnegative(),
});
export type ReadingState = z.infer<typeof readingStateSchema>;

/** O que decide o last-write-wins: o horário e, em empate, o aparelho. */
export type Stamp = { updatedAt: number; deviceId: string };

/**
 * `a` é mais novo que `b`? O maior `updatedAt` vence; com `updatedAt` igual, o maior `deviceId`
 * (ordem de bytes, que no ASCII é a do Postgres com `COLLATE "C"`). Sem desempate, cliente e
 * servidor ficariam cada um com o seu valor para sempre.
 */
export function isNewer(a: Stamp, b: Stamp): boolean {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return a.deviceId > b.deviceId;
}

/** Last-write-wins. Em empate total os dois são iguais para este fim, e fica o primeiro. */
export function pickLatest<T extends Stamp>(a: T, b: T): T {
  return isNewer(b, a) ? b : a;
}
