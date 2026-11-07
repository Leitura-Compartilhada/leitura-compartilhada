import { bookSchema } from "@leitura/shared";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { ModuleRoutes } from "../../../context.js";
import { AppError } from "../../../lib/errors.js";
import { requireUser } from "../../../lib/require-user.js";
import { ingestUpload } from "../service.js";

export const uploadRoute: ModuleRoutes =
  ({ db, auth, storage }) =>
  async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/",
      { schema: { response: { 200: bookSchema, 201: bookSchema } } },
      async (request, reply) => {
        const user = await requireUser(auth, request);
        const part = await request.file();
        if (part?.fieldname !== "file") {
          part?.file.resume(); // descarta o corpo para a requisição terminar
          throw new AppError("VALIDATION", "envie o arquivo no campo 'file'");
        }
        const filename = part.filename ?? "";
        if (!/\.epub$/i.test(filename)) {
          part.file.resume(); // descarta o corpo para a requisição terminar
          throw new AppError("INVALID_FILE", "envie um arquivo .epub");
        }

        const { book, created } = await ingestUpload(
          { db, storage },
          { userId: user.id, filename, file: part.file },
        );
        return reply.status(created ? 201 : 200).send(book);
      },
    );
  };
