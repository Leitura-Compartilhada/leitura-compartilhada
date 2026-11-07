import { knownHashesRequestSchema, knownHashesResponseSchema } from "@leitura/shared";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { ModuleRoutes } from "../../../context.js";
import { requireUser } from "../../../lib/require-user.js";
import { knownHashes } from "../service.js";

export const knownHashesRoute: ModuleRoutes =
  ({ db, auth }) =>
  async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/known-hashes",
      { schema: { body: knownHashesRequestSchema, response: { 200: knownHashesResponseSchema } } },
      async (request) => {
        const user = await requireUser(auth, request);
        return { known: await knownHashes(db, user.id, request.body.hashes) };
      },
    );
  };
