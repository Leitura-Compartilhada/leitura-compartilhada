import path from "node:path";
import { fileURLToPath } from "node:url";
import { convertTimeoutFromEnv } from "@leitura/shared";
import { storageFromEnv } from "@leitura/storage";

// apps/worker/src/env.ts -> raiz do monorepo. Caminhos relativos do .env valem a partir daqui,
// igual à API, para os dois chegarem à mesma pasta de storage.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Em produção o Calibre tem de vir por caminho absoluto: com só o nome, o sistema procura o
 * executável primeiro na pasta de trabalho do processo, que é onde ficam os arquivos do usuário.
 */
function calibreBin(): string {
  const bin = process.env.CALIBRE_BIN ?? "ebook-convert";
  if (process.env.NODE_ENV === "production" && !path.isAbsolute(bin)) {
    throw new Error(`em produção CALIBRE_BIN precisa ser um caminho absoluto (recebi "${bin}")`);
  }
  return bin;
}

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? "postgres://leitura:leitura@localhost:5432/leitura",
  calibreBin: calibreBin(),
  convertTimeoutMs: convertTimeoutFromEnv(process.env.CONVERT_TIMEOUT_MS),
  storage: () => storageFromEnv(process.env, repoRoot),
};
