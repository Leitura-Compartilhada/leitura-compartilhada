import path from "node:path";
import type { StorageDriver } from "./driver.js";
import { LocalStorageDriver } from "./local.js";

export * from "./driver.js";
export { LocalStorageDriver } from "./local.js";

export type StorageConfig = {
  STORAGE_DRIVER: "local";
  STORAGE_DIR: string;
};

export function createStorage(config: StorageConfig): StorageDriver {
  switch (config.STORAGE_DRIVER) {
    case "local":
      return new LocalStorageDriver(config.STORAGE_DIR);
  }
}

/**
 * Driver a partir das variáveis de ambiente (`STORAGE_DRIVER`, `STORAGE_DIR`). Um `STORAGE_DIR`
 * relativo vale a partir de `baseDir` (a raiz do monorepo), não do diretório em que o processo
 * foi iniciado, e API e worker precisam chegar à mesma pasta.
 */
export function storageFromEnv(
  env: Record<string, string | undefined>,
  baseDir: string,
): StorageDriver {
  const driver = env.STORAGE_DRIVER ?? "local";
  if (driver !== "local") throw new Error(`STORAGE_DRIVER desconhecido: ${driver}`);
  return createStorage({
    STORAGE_DRIVER: "local",
    STORAGE_DIR: path.resolve(baseDir, env.STORAGE_DIR ?? "./storage"),
  });
}
