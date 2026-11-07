import type { Book, ConversionJob } from "@leitura/shared";
import { ApiRequestError } from "@/lib/api";
import { describeApiError } from "@/lib/messages";
import { describeConversionUploadError } from "../conversions/conversion-model";
import { IMPORT_CONCURRENCY, type ImportCandidate, type ItemOutcome } from "./import-model";

/** Quanto esperar, e quantas vezes, quando o servidor está com conversões demais. */
export const BUSY_RETRY_MS = 3000;
export const BUSY_MAX_RETRIES = 100;

export type ImportDeps = {
  uploadBook: (file: File) => Promise<Book>;
  uploadConversion: (file: File) => Promise<ConversionJob>;
  sleep: (ms: number) => Promise<void>;
  /** Avisa a tela a cada mudança de um item. */
  onUpdate: (id: string, outcome: ItemOutcome) => void;
  /** Quando `true`, a fila para de pegar itens novos (o que já foi enviado fica). */
  isCancelled: () => boolean;
};

/** O servidor recusa conversão nova quando há 10 ativas: espera uma terminar e tenta de novo. */
export function isServerBusy(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === "VALIDATION";
}

async function sendOne(item: ImportCandidate, deps: ImportDeps): Promise<ItemOutcome> {
  try {
    if (item.kind === "epub") {
      const book = await deps.uploadBook(item.file);
      return { status: "book", title: book.title };
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        await deps.uploadConversion(item.file);
        return { status: "converting" };
      } catch (error) {
        if (!isServerBusy(error) || attempt >= BUSY_MAX_RETRIES || deps.isCancelled()) throw error;
        deps.onUpdate(item.id, { status: "sending" });
        await deps.sleep(BUSY_RETRY_MS);
      }
    }
  } catch (error) {
    const message =
      item.kind === "convert" ? describeConversionUploadError(error) : describeApiError(error);
    return { status: "failed", message };
  }
}

/**
 * Envia os itens na ordem, `IMPORT_CONCURRENCY` por vez. Um item que falha não para os outros.
 * Resolve quando todos terminaram ou, se foi cancelada, quando os que já saíram terminaram.
 */
export async function runImport(items: ImportCandidate[], deps: ImportDeps): Promise<void> {
  let next = 0;
  async function worker() {
    while (!deps.isCancelled()) {
      const item = items[next];
      next += 1;
      if (!item) return;
      deps.onUpdate(item.id, { status: "sending" });
      deps.onUpdate(item.id, await sendOne(item, deps));
    }
  }
  await Promise.all(Array.from({ length: IMPORT_CONCURRENCY }, worker));
}
