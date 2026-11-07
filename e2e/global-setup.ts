import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { E2E_STORAGE_DIR } from "../playwright.config.js";

/** O E2E testa o web buildado servido pela API; sem o build não há o que testar. */
export default async function globalSetup(): Promise<void> {
  const index = path.resolve("apps/web/dist/index.html");
  if (!existsSync(index)) {
    throw new Error(
      "apps/web/dist não existe: rode `pnpm --filter @leitura/web build` antes do E2E",
    );
  }

  // Storage do E2E começa vazio. O nome fixo evita apagar outra pasta por engano.
  if (E2E_STORAGE_DIR.endsWith("leitura-e2e-storage")) {
    await rm(E2E_STORAGE_DIR, { recursive: true, force: true });
  }
}
