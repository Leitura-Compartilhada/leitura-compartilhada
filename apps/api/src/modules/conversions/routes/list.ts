import { listConversionsResponseSchema } from "@leitura/shared";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { ModuleRoutes } from "../../../context.js";
import { requireUser } from "../../../lib/require-user.js";
import { listConversions } from "../service.js";

export const listRoute: ModuleRoutes =
  ({ db, auth }) =>
  async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.get(
      "/",
      { schema: { response: { 200: listConversionsResponseSchema } } },
      async (request) => {
        const user = await requireUser(auth, request);
        return { jobs: await listConversions(db, user.id) };
      },
    );
  };
