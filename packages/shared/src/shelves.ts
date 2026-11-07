import { z } from "zod";
import { MAX_SHELF_NAME_LENGTH } from "./constants.js";
import { visibleText } from "./text.js";

export const shelfSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** Ordem de exibição (menor primeiro). */
  position: z.number().int(),
  /** Quantos livros do usuário estão na estante. */
  bookCount: z.number().int().nonnegative(),
});
export type Shelf = z.infer<typeof shelfSchema>;

export const listShelvesResponseSchema = z.object({ shelves: z.array(shelfSchema) });
export type ListShelvesResponse = z.infer<typeof listShelvesResponseSchema>;

const shelfName = visibleText(MAX_SHELF_NAME_LENGTH);

export const createShelfRequestSchema = z.object({ name: shelfName }).strict();
export type CreateShelfRequest = z.infer<typeof createShelfRequestSchema>;

export const updateShelfRequestSchema = z
  .object({ name: shelfName, position: z.number().int().min(0).max(10_000) })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "envie ao menos um campo" });
export type UpdateShelfRequest = z.infer<typeof updateShelfRequestSchema>;
