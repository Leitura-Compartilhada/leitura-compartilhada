import type { Db } from "@leitura/db";

/** Transação do Drizzle. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Aceita o banco ou uma transação: as consultas funcionam nos dois. */
export type Executor = Db | Tx;
