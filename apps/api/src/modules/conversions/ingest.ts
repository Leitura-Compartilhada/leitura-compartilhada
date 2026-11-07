import { Readable } from "node:stream";
import type { Db } from "@leitura/db";
import { MAX_UPLOAD_BYTES } from "@leitura/shared";
import type { StorageDriver } from "@leitura/storage";
import { hasReadableText } from "../../lib/epub/content.js";
import { readAllCapped } from "../../lib/read-all.js";
import { titleFromFilename } from "../../lib/title.js";
import { updateBook } from "../books/manage.js";
import { findConvertedBook, ingestUpload } from "../books/service.js";
import { findJobToIngest, markDone, markFailed } from "./queries.js";

/** Título e autor que o Calibre inventa quando a origem (TXT, HTML...) não tem metadados. */
const PLACEHOLDER_TITLES = new Set(["input", "index", "unknown", "desconhecido", "unknown title"]);
const PLACEHOLDER_AUTHORS = new Set(["unknown", "desconhecido", "unknown author"]);

/**
 * Transforma o EPUB que o worker converteu em livro da estante, pelo mesmo caminho do upload
 * (hash, deduplicação, capa, metadados, série). Idempotente: um job que não está mais "em
 * andamento com resultado" (já ingerido, falho ou descartado) é ignorado, então uma entrega
 * repetida da fila não duplica o livro.
 */
export async function ingestConverted(
  deps: { db: Db; storage: StorageDriver },
  jobId: string,
): Promise<void> {
  const { db, storage } = deps;
  const job = await findJobToIngest(db, jobId);
  if (!job?.resultKey) return;

  try {
    const epub = await readAllCapped(await storage.get(job.resultKey), MAX_UPLOAD_BYTES);
    if (!hasReadableText(epub)) {
      // O Calibre devolve sucesso com um livro vazio quando não entende a entrada.
      await markFailed(db, job.id, "OUTPUT_INVALID", "o EPUB convertido não tem texto");
      await storage.delete(job.resultKey).catch(() => {});
      return;
    }

    // Outra conversão do mesmo original já virou livro (as duas rodaram juntas): reaproveita.
    const converted = job.sourceHash
      ? await findConvertedBook(db, job.ownerId, job.sourceHash)
      : null;
    if (converted) {
      await markDone(db, job.id, converted.id);
      for (const key of [job.sourceKey, job.resultKey]) {
        if (key) await storage.delete(key).catch(() => {});
      }
      return;
    }

    const originalName = job.sourceFilename.replace(/\.[^.]+$/, "");
    const { book, created } = await ingestUpload(deps, {
      userId: job.ownerId,
      filename: `${originalName}.epub`,
      file: Readable.from(epub),
      sourceHash: job.sourceHash ?? undefined,
    });

    if (created) {
      const patch: { title?: string; authors?: string[] } = {};
      if (PLACEHOLDER_TITLES.has(book.title.trim().toLowerCase())) {
        patch.title = titleFromFilename(`${originalName}.epub`);
      }
      if (
        book.authors.length > 0 &&
        book.authors.every((a) => PLACEHOLDER_AUTHORS.has(a.trim().toLowerCase()))
      ) {
        patch.authors = [];
      }
      if (Object.keys(patch).length > 0) await updateBook(deps, job.ownerId, book.id, patch);
    }

    await markDone(db, job.id, book.id);
    for (const key of [job.sourceKey, job.resultKey]) {
      if (key) await storage.delete(key).catch(() => {});
    }
  } catch (error) {
    await markFailed(
      db,
      job.id,
      "INGEST_FAILED",
      error instanceof Error ? error.message : String(error),
    );
    // Não relança: o job já está marcado como falho e o usuário pode tentar de novo. Relançar
    // faria a fila repetir uma ingestão que não encontra mais o job "em andamento".
    console.error(`[ingest] job ${job.id} falhou`, error);
  }
}
