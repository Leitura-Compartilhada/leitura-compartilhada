import { bookSchema, updateBookRequestSchema } from "@leitura/shared";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { ModuleRoutes } from "../../../context.js";
import { requireUser } from "../../../lib/require-user.js";
import { deleteBook, updateBook } from "../manage.js";

const idParams = z.object({ id: z.string().uuid() });

export const manageRoute: ModuleRoutes =
  ({ db, auth, storage }) =>
  async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.patch(
      "/:id",
      {
        schema: {
          params: idParams,
          body: updateBookRequestSchema,
          response: { 200: bookSchema },
        },
      },
      async (request) => {
        const user = await requireUser(auth, request);
        return updateBook({ db, storage }, user.id, request.params.id, request.body);
      },
    );

    app.delete("/:id", { schema: { params: idParams } }, async (request, reply) => {
      const user = await requireUser(auth, request);
      await deleteBook({ db, storage }, user.id, request.params.id, request.log);
      return reply.status(204).send();
    });
  };
