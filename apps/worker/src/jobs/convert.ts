import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, open, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { conversionJobs, type Db } from "@leitura/db";
import {
  type ConversionErrorCode,
  convertibleFormatOf,
  extensionOf,
  MAX_UPLOAD_BYTES,
} from "@leitura/shared";
import type { StorageDriver } from "@leitura/storage";
import { and, eq, sql } from "drizzle-orm";
import { type CalibreOptions, ConversionFailure } from "../calibre.js";

export type ConvertDeps = {
  db: Db;
  storage: StorageDriver;
  /** Roda o Calibre; nos testes é trocado por uma função falsa. */
  calibre: (options: CalibreOptions) => Promise<void>;
  calibreBin: string;
  binArgs?: string[];
  timeoutMs: number;
  /** Avisa a API que há um EPUB convertido esperando ingestão. */
  enqueueIngest: (jobId: string) => Promise<void>;
  /** Pasta onde ficam as pastas temporárias dos jobs. */
  tmpRoot?: string;
  log?: Pick<Console, "info" | "warn" | "error">;
};

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const MAX_ERROR_DETAIL = 2000;

function jobIdOf(data: unknown): string | null {
  const id = (data as { jobId?: unknown } | null)?.jobId;
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/** O resultado precisa ser um arquivo não vazio, dentro do limite, que começa como ZIP (EPUB). */
async function assertValidOutput(file: string): Promise<void> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile() || info.size === 0) {
    throw new ConversionFailure("OUTPUT_INVALID", "o Calibre não gerou o EPUB");
  }
  if (info.size > MAX_UPLOAD_BYTES) {
    throw new ConversionFailure("OUTPUT_INVALID", `EPUB gerado grande demais: ${info.size} bytes`);
  }
  const handle = await open(file, "r");
  try {
    const head = Buffer.alloc(ZIP_SIGNATURE.length);
    await handle.read(head, 0, head.length, 0);
    if (!ZIP_SIGNATURE.every((byte, i) => head[i] === byte)) {
      throw new ConversionFailure("OUTPUT_INVALID", "o arquivo gerado não é um EPUB (ZIP)");
    }
  } finally {
    await handle.close();
  }
}

function failureOf(error: unknown): { code: ConversionErrorCode; detail: string } {
  if (error instanceof ConversionFailure) return { code: error.code, detail: error.detail };
  const message = error instanceof Error ? error.message : String(error);
  return { code: "CONVERSION_FAILED", detail: message };
}

/**
 * Converte um job `queued`. Reivindica o job de forma atômica (`queued → running`), então uma
 * entrega repetida da fila não converte duas vezes, e um job descartado no meio não é ressuscitado.
 * O original continua no storage em caso de falha (para "tentar de novo"); a API o apaga depois
 * que o EPUB convertido virar livro.
 */
export async function convertJob(deps: ConvertDeps, data: unknown): Promise<void> {
  const { db, storage } = deps;
  const log = deps.log ?? console;
  const jobId = jobIdOf(data);
  if (!jobId) {
    log.warn("[convert] job sem identificador válido; ignorado");
    return;
  }

  const [job] = await db
    .update(conversionJobs)
    .set({ status: "running", attempt: sql`${conversionJobs.attempt} + 1`, updatedAt: new Date() })
    .where(and(eq(conversionJobs.id, jobId), eq(conversionJobs.status, "queued")))
    .returning();
  if (!job) return; // já em andamento, concluído ou descartado

  // Só a execução que reivindicou o job (e ainda é a mais nova) pode gravar o resultado ou a falha.
  const ownRun = and(
    eq(conversionJobs.id, job.id),
    eq(conversionJobs.status, "running"),
    eq(conversionJobs.attempt, job.attempt),
  );

  const workDir = await mkdtemp(path.join(deps.tmpRoot ?? os.tmpdir(), "leitura-convert-"));
  try {
    const format = convertibleFormatOf(job.sourceFilename);
    const ext = extensionOf(job.sourceFilename);
    if (!job.sourceKey || !format || !ext) {
      throw new ConversionFailure("UNSUPPORTED", "job sem original ou com formato desconhecido");
    }
    await mkdir(path.join(workDir, "tmp"), { recursive: true });
    await mkdir(path.join(workDir, "config"), { recursive: true });
    await mkdir(path.join(workDir, "cache"), { recursive: true });

    // O Calibre decide o formato de entrada pela extensão; ela vem da lista conhecida, nunca do cliente.
    const input = path.join(workDir, `input.${ext}`);
    await pipeline(await storage.get(job.sourceKey), createWriteStream(input));
    const output = path.join(workDir, "output.epub");

    await deps.calibre({
      bin: deps.calibreBin,
      binArgs: deps.binArgs,
      input,
      output,
      format,
      workDir,
      timeoutMs: deps.timeoutMs,
    });
    await assertValidOutput(output);

    // A chave leva o número da execução: se o usuário reiniciar o job, duas execuções nunca escrevem no mesmo arquivo.
    const resultKey = `converted/${job.ownerId}/${job.id}-${job.attempt}.epub`;
    await storage.put(resultKey, createReadStream(output));
    const saved = await db
      .update(conversionJobs)
      .set({ resultKey, updatedAt: new Date() })
      .where(ownRun)
      .returning({ id: conversionJobs.id });
    if (saved.length === 0) {
      await storage.delete(resultKey).catch(() => {}); // o job foi descartado durante a conversão
      return;
    }
    await deps.enqueueIngest(job.id);
  } catch (error) {
    const { code, detail } = failureOf(error);
    log.warn(`[convert] job ${job.id} falhou (${code}): ${detail}`);
    const now = new Date();
    await db
      .update(conversionJobs)
      .set({
        status: "failed",
        errorCode: code,
        error: detail.slice(0, MAX_ERROR_DETAIL),
        finishedAt: now,
        updatedAt: now,
      })
      .where(ownRun);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
