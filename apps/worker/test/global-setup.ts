import { prepareDisposableDatabase } from "@leitura/db/prepare";

/** Prepara o banco de teste do worker (cria, migra e limpa). */
export default async function setup(): Promise<void> {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("TEST_DATABASE_URL não definida");
  await prepareDisposableDatabase(testUrl);
}
