import { z } from "zod";
import { readingStateSchema } from "./reading.js";

/** Códigos estáveis de erro. O cliente decide pelo código, nunca pelo texto da mensagem. */
export const apiErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "INVALID_FILE",
  "TOO_LARGE",
  "VALIDATION",
  "CONFLICT",
  "INTERNAL",
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({ code: apiErrorCodeSchema, message: z.string() }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** `GET /api/config`: público, para a tela de login saber se mostra "criar conta". */
export const configResponseSchema = z.object({ allowSignup: z.boolean() });
export type ConfigResponse = z.infer<typeof configResponseSchema>;

/** `GET /api/progress/:bookId`: `readingState` é `null` se o usuário nunca abriu o livro. */
export const progressResponseSchema = z.object({ readingState: readingStateSchema.nullable() });
export type ProgressResponse = z.infer<typeof progressResponseSchema>;
