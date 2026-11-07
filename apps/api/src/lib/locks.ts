import { sql } from "drizzle-orm";
import type { Tx } from "./db-types.js";

/**
 * Trava, até o fim da transação, as mudanças de tags e estantes deste usuário. Sem ela, dois
 * pedidos do mesmo usuário (duas abas, dois aparelhos) se pisam: um apaga como "órfã" a tag que o
 * outro acabou de ligar a um livro. Pedidos de usuários diferentes não se bloqueiam.
 */
export async function lockUserLabels(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`labels:${userId}`}, 0))`);
}

/**
 * Trava, até o fim da transação, a criação de conversões deste usuário. Sem ela, vários envios
 * simultâneos passam todos pela contagem de conversões ativas e furam o limite.
 */
export async function lockUserConversions(tx: Tx, userId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`conversions:${userId}`}, 0))`,
  );
}
