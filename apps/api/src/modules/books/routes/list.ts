import { listBooksResponseSchema } from "@leitura/shared";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { ModuleRoutes } from "../../../context.js";
import { requireUser } from "../../../lib/require-user.js";
import { listBooks } from "../service.js";

export const listRoute: ModuleRoutes =
  ({ db, auth }) =>
  async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.get("/", { schema: { response: { 200: listBooksResponseSchema } } }, async (request) => {
      const user = await requireUser(auth, request);
      return { books: await listBooks(db, user.id) };
    });
  };
