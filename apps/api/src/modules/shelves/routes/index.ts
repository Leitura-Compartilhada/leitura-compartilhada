import {
  createShelfRequestSchema,
  listShelvesResponseSchema,
  shelfSchema,
  updateShelfRequestSchema,
} from "@leitura/shared";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { ModuleRoutes } from "../../../context.js";
import { requireUser } from "../../../lib/require-user.js";
import { createShelf, deleteShelf, listShelves, updateShelf } from "../service.js";

const idParams = z.object({ id: z.string().uuid() });

/** Rotas de `/api/shelves`. Só HTTP: as regras ficam em `../service.ts`. */
export const shelvesRoutes: ModuleRoutes =
  ({ db, auth }) =>
  async (instance) => {
    const app = instance.withTypeProvider<ZodTypeProvider>();

    app.get("/", { schema: { response: { 200: listShelvesResponseSchema } } }, async (request) => {
      const user = await requireUser(auth, request);
      return { shelves: await listShelves(db, user.id) };
    });

    app.post(
      "/",
      { schema: { body: createShelfRequestSchema, response: { 201: shelfSchema } } },
      async (request, reply) => {
        const user = await requireUser(auth, request);
        const shelf = await createShelf(db, user.id, request.body.name);
        return reply.status(201).send(shelf);
      },
    );

    app.patch(
      "/:id",
      {
        schema: {
          params: idParams,
          body: updateShelfRequestSchema,
          response: { 200: shelfSchema },
        },
      },
      async (request) => {
        const user = await requireUser(auth, request);
        return updateShelf(db, user.id, request.params.id, request.body);
      },
    );

    app.delete("/:id", { schema: { params: idParams } }, async (request, reply) => {
      const user = await requireUser(auth, request);
      await deleteShelf(db, user.id, request.params.id);
      return reply.status(204).send();
    });
  };
