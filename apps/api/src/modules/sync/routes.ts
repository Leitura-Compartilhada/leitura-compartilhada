import { syncRequestSchema, syncResponseSchema } from "@leitura/shared";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { ModuleRoutes } from "../../context.js";
import { AppError } from "../../lib/errors.js";
import { requireUser } from "../../lib/require-user.js";
import { runSync } from "./service.js";

export const syncRoutes: ModuleRoutes =
  ({ db, auth, now }) =>
  async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.post(
      "/",
      { schema: { body: syncRequestSchema, response: { 200: syncResponseSchema } } },
      async (request) => {
        const user = await requireUser(auth, request);
        if (request.body.annotations.length > 0) {
          // Anotações entram na F3. Recusar é melhor que aceitar e descartar em silêncio.
          throw new AppError("VALIDATION", "anotações ainda não são sincronizadas");
        }
        return db.transaction((tx) => runSync(tx, user.id, request.body, now()));
      },
    );
  };
