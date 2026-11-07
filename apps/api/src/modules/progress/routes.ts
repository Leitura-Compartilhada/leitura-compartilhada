import { readingStates } from "@leitura/db";
import { progressResponseSchema } from "@leitura/shared";
import { and, eq } from "drizzle-orm";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { ModuleRoutes } from "../../context.js";
import { AppError } from "../../lib/errors.js";
import { requireUser } from "../../lib/require-user.js";
import { findOwnedBook } from "../books/queries.js";
import { toReadingState } from "./mapper.js";

export const progressRoutes: ModuleRoutes =
  ({ db, auth }) =>
  async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    // Leitura rápida de um livro só, para o leitor abrir sem esperar um sync completo.
    app.get(
      "/:bookId",
      {
        schema: {
          params: z.object({ bookId: z.string().uuid() }),
          response: { 200: progressResponseSchema },
        },
      },
      async (request) => {
        const user = await requireUser(auth, request);
        const book = await findOwnedBook(db, user.id, request.params.bookId);
        if (!book) throw new AppError("NOT_FOUND", "livro não encontrado");

        const [row] = await db
          .select()
          .from(readingStates)
          .where(and(eq(readingStates.userId, user.id), eq(readingStates.bookId, book.id)))
          .limit(1);
        return { readingState: row ? toReadingState(row) : null };
      },
    );
  };
