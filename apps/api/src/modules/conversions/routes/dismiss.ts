import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { ModuleRoutes } from "../../../context.js";
import { requireUser } from "../../../lib/require-user.js";
import { dismissConversion } from "../service.js";

export const dismissRoute: ModuleRoutes =
  ({ db, auth, storage, queue }) =>
  async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.delete(
      "/:id",
      { schema: { params: z.object({ id: z.string().uuid() }) } },
      async (request, reply) => {
        const user = await requireUser(auth, request);
        await dismissConversion({ db, storage, queue }, user.id, request.params.id);
        return reply.status(204).send();
      },
    );
  };
