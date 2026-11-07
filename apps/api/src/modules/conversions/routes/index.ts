import multipart from "@fastify/multipart";
import { MAX_CONVERT_SOURCE_BYTES } from "@leitura/shared";
import type { ModuleRoutes } from "../../../context.js";
import { dismissRoute } from "./dismiss.js";
import { listRoute } from "./list.js";
import { retryRoute } from "./retry.js";
import { uploadRoute } from "./upload.js";

/** Rotas de `/api/conversions`. Só HTTP: as regras ficam em `../service.ts`. */
export const conversionsRoutes: ModuleRoutes = (ctx) => async (instance) => {
  await instance.register(multipart, {
    limits: { fileSize: Math.min(ctx.maxUploadBytes, MAX_CONVERT_SOURCE_BYTES), files: 1 },
  });
  await instance.register(uploadRoute(ctx));
  await instance.register(listRoute(ctx));
  await instance.register(retryRoute(ctx));
  await instance.register(dismissRoute(ctx));
};
