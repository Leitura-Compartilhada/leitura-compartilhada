import { conversionJobSchema } from "@leitura/shared";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { ModuleRoutes } from "../../../context.js";
import { AppError } from "../../../lib/errors.js";
import { requireUser } from "../../../lib/require-user.js";
import { createConversion } from "../service.js";

export const uploadRoute: ModuleRoutes =
  ({ db, auth, storage, queue }) =>
  async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/",
      { schema: { response: { 202: conversionJobSchema } } },
      async (request, reply) => {
        const user = await requireUser(auth, request);
        const part = await request.file();
        if (part?.fieldname !== "file") {
          part?.file.resume(); // descarta o corpo para a requisição terminar
          throw new AppError("VALIDATION", "envie o arquivo no campo 'file'");
        }
        try {
          const job = await createConversion(
            { db, storage, queue },
            { userId: user.id, filename: part.filename ?? "", file: part.file },
          );
          return reply.status(202).send(job);
        } catch (error) {
          part.file.resume(); // se recusou antes de ler tudo, esvazia o resto do envio
          throw error;
        }
      },
    );
  };
