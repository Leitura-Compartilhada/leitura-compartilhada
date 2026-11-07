import type { Db } from "@leitura/db";
import type { StorageDriver } from "@leitura/storage";
import type { FastifyPluginAsync } from "fastify";
import type { Auth } from "./auth.js";
import type { ConversionQueue } from "./modules/conversions/queue.js";

export type AppContext = {
  db: Db;
  auth: Auth;
  storage: StorageDriver;
  /** Relógio do servidor em ms. Injetável para os testes simularem um relógio que volta no tempo. */
  now: () => number;
  /** Tamanho máximo de um upload. Injetável para os testes não enviarem centenas de MB. */
  maxUploadBytes: number;
  /** Fila das conversões de formato (pg-boss em produção, memória nos testes). */
  queue: ConversionQueue;
};

/** Fábrica de plugin de módulo: cada módulo recebe o contexto (db, auth, storage, now). */
export type ModuleRoutes = (ctx: AppContext) => FastifyPluginAsync;
