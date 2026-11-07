import { existsSync } from "node:fs";
import path from "node:path";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { createDb } from "@leitura/db";
import { configResponseSchema, MAX_UPLOAD_BYTES } from "@leitura/shared";
import { createStorage } from "@leitura/storage";
import { sql } from "drizzle-orm";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { createAuth } from "./auth.js";
import { env } from "./env.js";
import { registerErrorHandler } from "./lib/errors.js";
import { toHeaders } from "./lib/http.js";
import { SECURITY_HEADERS } from "./lib/security-headers.js";
import { annotationsRoutes } from "./modules/annotations/routes.js";
import { booksRoutes } from "./modules/books/routes/index.js";
import { ingestConverted } from "./modules/conversions/ingest.js";
import { type ConversionQueue, createUnavailableQueue } from "./modules/conversions/queue.js";
import { conversionsRoutes } from "./modules/conversions/routes/index.js";
import { progressRoutes } from "./modules/progress/routes.js";
import { shelvesRoutes } from "./modules/shelves/routes/index.js";
import { syncRoutes } from "./modules/sync/routes.js";

export type BuildAppOptions = {
  /** Relógio do servidor. Os testes o fazem andar para trás. */
  now?: () => number;
  /** Sobrescreve `ALLOW_SIGNUP`. */
  allowSignup?: boolean;
  /** Sobrescreve o tamanho máximo de upload. */
  maxUploadBytes?: number;
  /** Fila de conversões. Sem ela, as rotas de conversão respondem erro interno. */
  queue?: ConversionQueue;
};

export async function buildApp(options: BuildAppOptions = {}) {
  const fastify = Fastify({ logger: env.NODE_ENV !== "test" });
  const serveSpa = existsSync(path.join(env.WEB_DIST, "index.html"));
  registerErrorHandler(fastify, { serveSpa });
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // CSP e demais cabeçalhos em TODA resposta (JSON, arquivos do web e download de livro). Fica
  // antes de qualquer rota para os plugins filhos herdarem. Ver lib/security-headers.ts.
  app.addHook("onSend", async (_request, reply, payload) => {
    // Uma rota pode endurecer um cabeçalho (a capa usa uma CSP ainda mais restrita); nunca afrouxa.
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!reply.hasHeader(name)) reply.header(name, value);
    }
    return payload;
  });

  const allowSignup = options.allowSignup ?? env.ALLOW_SIGNUP;
  const { db, pool } = createDb(env.DATABASE_URL);
  const auth = createAuth(db, { allowSignup });

  await app.register(cors, {
    origin: env.WEB_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  app.addHook("onClose", async () => {
    await pool.end();
  });

  app.get("/health", async () => {
    let dbStatus: "up" | "down" = "up";
    try {
      await db.execute(sql`select 1`);
    } catch {
      dbStatus = "down";
    }
    return { ok: dbStatus === "up", db: dbStatus };
  });

  app.get("/api/config", { schema: { response: { 200: configResponseSchema } } }, async () => ({
    allowSignup,
  }));

  // Better Auth: repassa /api/auth/* para o handler fetch-style.
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    handler: async (request, reply) => {
      const response = await auth.handler(
        new Request(new URL(request.url, env.API_URL), {
          method: request.method,
          headers: toHeaders(request.headers),
          body: request.body ? JSON.stringify(request.body) : undefined,
        }),
      );
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        reply.header(key, value);
      });
      return reply.send(response.body ? await response.text() : null);
    },
  });

  const storage = createStorage(env);
  const ctx = {
    db,
    auth,
    storage,
    now: options.now ?? Date.now,
    maxUploadBytes: options.maxUploadBytes ?? MAX_UPLOAD_BYTES,
    queue: options.queue ?? createUnavailableQueue(),
  };
  await app.register(booksRoutes(ctx), { prefix: "/api/books" });
  await app.register(conversionsRoutes(ctx), { prefix: "/api/conversions" });
  // O worker converte; quando termina avisa por aqui e a API transforma o EPUB em livro.
  await ctx.queue.onIngest((jobId) => ingestConverted({ db, storage }, jobId));
  app.addHook("onClose", async () => {
    await ctx.queue.stop();
  });
  await app.register(shelvesRoutes(ctx), { prefix: "/api/shelves" });
  await app.register(progressRoutes(ctx), { prefix: "/api/progress" });
  await app.register(annotationsRoutes(ctx), { prefix: "/api/annotations" });
  await app.register(syncRoutes(ctx), { prefix: "/api/sync" });

  if (serveSpa) {
    // Arquivos com hash no nome (assets/) nunca mudam; o resto sempre revalida.
    await app.register(fastifyStatic, {
      root: env.WEB_DIST,
      wildcard: false,
      cacheControl: false,
      setHeaders(reply, filePath) {
        const immutable = filePath.split(path.sep).includes("assets");
        reply.header(
          "cache-control",
          immutable ? "public, max-age=31536000, immutable" : "no-cache",
        );
      },
    });
  }

  return app;
}
