import { conversionJobSchema } from "@leitura/shared";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { ModuleRoutes } from "../../../context.js";
import { requireUser } from "../../../lib/require-user.js";
import { retryConversion } from "../service.js";

export const retryRoute: ModuleRoutes =
  ({ db, auth, storage, queue }) =>
  async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/:id/retry",
      {
        schema: {
          params: z.object({ id: z.string().uuid() }),
          response: { 202: conversionJobSchema },
        },
      },
      async (request, reply) => {
        const user = await requireUser(auth, request);
        const job = await retryConversion({ db, storage, queue }, user.id, request.params.id);
        return reply.status(202).send(job);
      },
    );
  };
