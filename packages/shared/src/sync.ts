import { z } from "zod";
import { annotationSchema } from "./annotations.js";
import { apiErrorCodeSchema } from "./api.js";
import { DEVICE_ID_PATTERN, MAX_SYNC_ITEMS } from "./constants.js";
import { readingStateSchema } from "./reading.js";

/**
 * `POST /api/sync`. Na F1 só `readingStates` é tratado: um `annotations` não vazio recebe
 * `VALIDATION`, para nada ser descartado em silêncio. Anotações entram na F3.
 */
export const syncRequestSchema = z.object({
  /** Vale para todos os itens do pedido: o servidor ignora o `deviceId` de cada item. */
  deviceId: z.string().regex(DEVICE_ID_PATTERN),
  /**
   * Cursor devolvido na última resposta; 0 na primeira vez. É um inteiro opaco e crescente por
   * usuário. Não é um horário, mesmo que os valores pareçam um.
   */
  since: z.number().int().min(0),
  readingStates: z.array(readingStateSchema).max(MAX_SYNC_ITEMS),
  annotations: z.array(annotationSchema).max(MAX_SYNC_ITEMS),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;

/** Item que o servidor não aceitou. O cliente deve tirá-lo da outbox, senão tenta para sempre. */
export const syncRejectionSchema = z.object({
  bookId: z.string().uuid(),
  code: apiErrorCodeSchema,
});
export type SyncRejection = z.infer<typeof syncRejectionSchema>;

export const syncResponseSchema = z.object({
  /** Guardar e enviar como `since` na próxima vez. */
  cursor: z.number().int().nonnegative(),
  /** Relógio do servidor (ms). O cliente usa para corrigir o próprio relógio. */
  serverTime: z.number().int(),
  /**
   * Estados com cursor acima de `since`, mais o estado atual do servidor para cada item do
   * pedido que perdeu o conflito. Assim o aparelho que perdeu converge na mesma resposta.
   */
  readingStates: z.array(readingStateSchema),
  rejected: z.array(syncRejectionSchema),
  annotations: z.array(annotationSchema),
});
export type SyncResponse = z.infer<typeof syncResponseSchema>;
