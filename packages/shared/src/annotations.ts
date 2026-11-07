import { z } from "zod";

export const annotationTypeSchema = z.enum(["highlight", "note", "bookmark"]);
export type AnnotationType = z.infer<typeof annotationTypeSchema>;

export const annotationSchema = z.object({
  /** UUID gerado no cliente, para criar offline sem colisão. */
  id: z.string().uuid(),
  bookId: z.string().uuid(),
  type: annotationTypeSchema,
  cfiRange: z.string(),
  text: z.string().nullable(),
  note: z.string().nullable(),
  color: z.string().nullable(),
  updatedAt: z.number().int(),
  /** Tombstone: exclusões também sincronizam. */
  deletedAt: z.number().int().nullable(),
});
export type Annotation = z.infer<typeof annotationSchema>;
