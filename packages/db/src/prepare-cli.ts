import { prepareDisposableDatabase } from "./prepare.js";

// Uso: pnpm --filter @leitura/db prepare:disposable <postgres://.../nome_e2e>
const url = process.argv[2];
if (!url) {
  console.error("informe a URL do banco descartável (nome terminando em _test ou _e2e)");
  process.exit(1);
}

await prepareDisposableDatabase(url);
console.log("banco descartável pronto");
