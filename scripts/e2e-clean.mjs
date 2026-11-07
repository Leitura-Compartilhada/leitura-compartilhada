// Limpa o que o E2E deixa para trás: bancos `leitura_<instancia>_e2e` no Postgres de desenvolvimento e
// as pastas `<instancia>-leitura-e2e-storage` do diretório temporário. Cada instância de E2E (agentes,
// rodadas paralelas, `pnpm dast`) cria as suas e nada as apaga.
//   pnpm e2e:clean           só lista o que apagaria
//   pnpm e2e:clean --yes     apaga
// Nunca toca em `leitura`, `leitura_test` nem `leitura_worker_test`: só o que casa com os padrões abaixo,
// que são os mesmos nomes que o playwright.config.ts e o prepare-cli criam. Só fala com um Postgres local.
import { readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** `leitura_e2e` (padrão) ou `leitura_<instancia>_e2e`, instância de 1 a 16 letras minúsculas ou dígitos. */
export const isE2eDatabase = (name) => /^leitura(_[a-z0-9]{1,16})?_e2e$/.test(name);

/** `leitura-e2e-storage` ou `<instancia>-leitura-e2e-storage` (o sufixo é a trava do setup do E2E). */
export const isE2eStorageDir = (name) => /^([a-z0-9]{1,16}-)?leitura-e2e-storage$/.test(name);

const isLocalHost = (host) => host === "localhost" || host === "127.0.0.1" || host === "::1";

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const apply = process.argv.includes("--yes");
  const adminUrl = new URL(
    process.env.E2E_CLEAN_URL ?? "postgres://leitura:leitura@localhost:5432/postgres",
  );
  if (!isLocalHost(adminUrl.hostname)) {
    console.error(`e2e-clean: só limpo um Postgres local (recebi ${adminUrl.hostname})`);
    process.exit(1);
  }

  // `pg` mora no pacote do banco; resolve a partir de lá.
  const pg = createRequire(path.join(root, "packages", "db", "package.json"))("pg");
  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const { rows } = await client.query("select datname from pg_database order by datname");
    const databases = rows.map((row) => row.datname).filter(isE2eDatabase);
    const folders = readdirSync(os.tmpdir()).filter(isE2eStorageDir);

    console.log(`Bancos de E2E: ${databases.length}`);
    for (const name of databases) console.log(`  ${name}`);
    console.log(`Pastas de storage de E2E em ${os.tmpdir()}: ${folders.length}`);
    for (const name of folders) console.log(`  ${name}`);

    if (!apply) {
      console.log("\nNada foi apagado. Rode com --yes para apagar.");
    } else {
      for (const name of databases) {
        // `with (force)` derruba conexões que sobraram de uma instância que travou.
        await client.query(`drop database "${name}" with (force)`);
      }
      for (const name of folders) {
        rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
      }
      console.log(`\nApagados: ${databases.length} banco(s) e ${folders.length} pasta(s).`);
    }
  } finally {
    await client.end();
  }
}
