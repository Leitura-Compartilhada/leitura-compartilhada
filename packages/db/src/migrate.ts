import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./index.js";

const url = process.env.DATABASE_URL ?? "postgres://leitura:leitura@localhost:5432/leitura";
const { db, pool } = createDb(url);

await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
console.log("migrations aplicadas");
await pool.end();
