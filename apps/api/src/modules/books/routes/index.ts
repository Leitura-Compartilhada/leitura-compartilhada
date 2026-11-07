import multipart from "@fastify/multipart";
import type { ModuleRoutes } from "../../../context.js";
import { coverRoute } from "./cover.js";
import { fileRoute } from "./file.js";
import { knownHashesRoute } from "./known-hashes.js";
import { listRoute } from "./list.js";
import { manageRoute } from "./manage.js";
import { uploadRoute } from "./upload.js";

/** Rotas de `/api/books`: cada grupo vive no seu arquivo e só fala HTTP; as regras ficam em `../service.ts`. */
export const booksRoutes: ModuleRoutes = (ctx) => async (instance) => {
  await instance.register(multipart, { limits: { fileSize: ctx.maxUploadBytes, files: 1 } });
  await instance.register(uploadRoute(ctx));
  await instance.register(listRoute(ctx));
  await instance.register(knownHashesRoute(ctx));
  await instance.register(fileRoute(ctx));
  await instance.register(coverRoute(ctx));
  await instance.register(manageRoute(ctx));
};
