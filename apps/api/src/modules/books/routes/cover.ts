import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { ModuleRoutes } from "../../../context.js";
import { COVER_CONTENT_TYPES } from "../../../lib/epub/index.js";
import { AppError } from "../../../lib/errors.js";
import { requireUser } from "../../../lib/require-user.js";
import { requireOwnedBook } from "../service.js";

export const coverRoute: ModuleRoutes =
  ({ db, auth, storage }) =>
  async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.get(
      "/:id/cover",
      { schema: { params: z.object({ id: z.string().uuid() }) } },
      async (request, reply) => {
        const user = await requireUser(auth, request);
        const book = await requireOwnedBook(db, user.id, request.params.id);
        if (!book.coverPath) throw new AppError("NOT_FOUND", "capa não encontrada");

        const ext = book.coverPath.split(".").pop() as keyof typeof COVER_CONTENT_TYPES;
        const contentType = COVER_CONTENT_TYPES[ext];
        if (!contentType) throw new AppError("NOT_FOUND", "capa não encontrada");

        // A capa só muda se o arquivo mudar; a extensão entra no ETag por causa do backfill.
        const etag = `"${book.fileHash}-${ext}"`;
        if (request.headers["if-none-match"] === etag) {
          return reply
            .header("etag", etag)
            .header("cache-control", "private, no-cache")
            .status(304)
            .send();
        }
        const image = await storage.get(book.coverPath);
        reply.header("etag", etag).header("cache-control", "private, no-cache");

        // Imagem de terceiros: tipo decidido pelos bytes no upload, `nosniff` vem do hook global,
        // e a CSP própria impede qualquer execução caso alguém abra a URL direto.
        return reply
          .header("content-type", contentType)
          .header("content-security-policy", "default-src 'none'; sandbox")
          .header("cross-origin-resource-policy", "same-origin")
          .send(image);
      },
    );
  };
