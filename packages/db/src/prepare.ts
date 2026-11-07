import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./index.js";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Só bancos descartáveis: as suítes de teste apagam tabelas inteiras. */
const DISPOSABLE_DATABASE = /^[a-z0-9_]+_(test|e2e)$/;

/**
 * Garante que o banco descartável exista e esteja com todas as migrations aplicadas.
 * Recusa qualquer banco cujo nome não termine em `_test` ou `_e2e`.
 */
export async function prepareDisposableDatabase(connectionString: string): Promise<void> {
  const url = new URL(connectionString);
  const name = url.pathname.slice(1);
  if (!DISPOSABLE_DATABASE.test(name)) {
    throw new Error(`o banco precisa terminar em _test ou _e2e, recebi: "${name}"`);
  }

  const adminUrl = new URL(connectionString);
  adminUrl.pathname = "/postgres";
  const admin = createDb(adminUrl.toString());
  try {
    const found = await admin.db.execute(sql`select 1 from pg_database where datname = ${name}`);
    if (found.rows.length === 0) await admin.db.execute(sql.raw(`create database "${name}"`));
  } finally {
    await admin.pool.end();
  }

  const target = createDb(connectionString);
  try {
    await migrate(target.db, { migrationsFolder: MIGRATIONS_FOLDER });
    await target.db.execute(sql`truncate table "user", "verification" restart identity cascade`);
  } finally {
    await target.pool.end();
  }
}
