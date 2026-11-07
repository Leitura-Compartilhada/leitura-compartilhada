import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { ModuleRoutes } from "../../../context.js";
import { AppError } from "../../../lib/errors.js";
import { requireUser } from "../../../lib/require-user.js";
import { requireOwnedBook } from "../service.js";

export const fileRoute: ModuleRoutes =
  ({ db, auth, storage }) =>
  async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.get(
      "/:id/file",
      { schema: { params: z.object({ id: z.string().uuid() }) } },
      async (request, reply) => {
        const user = await requireUser(auth, request);
        const book = await requireOwnedBook(db, user.id, request.params.id);
        if (!book.filePath || !book.fileHash)
          throw new AppError("NOT_FOUND", "livro não encontrado");

        const etag = `"${book.fileHash}"`;
        if (request.headers["if-none-match"] === etag) {
          return reply
            .header("etag", etag)
            .header("cache-control", "private, no-cache")
            .status(304)
            .send();
        }
        // Abre antes de definir ETag/cache: um erro do storage não pode sair com cabeçalho de cache.
        const stream = await storage.get(book.filePath);
        reply.header("etag", etag).header("cache-control", "private, no-cache");
        // `attachment` + nome fixo: o arquivo é de terceiros e nunca deve ser exibido como página.
        return reply
          .header("content-type", "application/epub+zip")
          .header("content-disposition", 'attachment; filename="livro.epub"')
          .header("content-length", book.fileSize ?? undefined)
          .send(stream);
      },
    );
  };
