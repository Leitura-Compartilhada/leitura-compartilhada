import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { Db } from "@leitura/db";
import {
  CONVERSION_DONE_VISIBLE_MS,
  type ConversionJob,
  convertibleFormatOf,
  extensionOf,
  MAX_ACTIVE_CONVERSIONS,
  MAX_CONVERT_SOURCE_BYTES,
  MAX_FAILED_CONVERSIONS,
} from "@leitura/shared";
import type { StorageDriver } from "@leitura/storage";
import { AppError } from "../../lib/errors.js";
import { isSafeZipExpansion } from "../../lib/formats.js";
import { lockUserConversions } from "../../lib/locks.js";
import { readAllCapped } from "../../lib/read-all.js";
import { findConvertedBook } from "../books/service.js";
import { sourceStorageKey, toConversionJob } from "./mapper.js";
import {
  countActiveJobs,
  deleteJob,
  deleteOldFailedJobs,
  findDoneJobBySource,
  findOwnedJob,
  insertJob,
  type JobRow,
  listVisibleJobs,
  markDone,
  markFailed,
  requeueJob,
  setSourceReady,
} from "./queries.js";
import type { ConversionQueue } from "./queue.js";
import { inspectSource } from "./source-stream.js";

export type ConversionsDeps = { db: Db; storage: StorageDriver; queue: ConversionQueue };

const notFound = () => new AppError("NOT_FOUND", "conversão não encontrada");

/**
 * Nome para mostrar: sem caminho, sem caracteres de controle e sem os que invertem o sentido do
 * texto (U+202E faria "fdp.exe" parecer "exe.pdf"), em tamanho razoável.
 */
function displayName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const printable = Array.from(base, (ch) => {
    const code = ch.charCodeAt(0);
    const control = code < 0x20 || code === 0x7f;
    const bidi = (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
    return control || bidi || code === 0x200e || code === 0x200f ? "" : ch;
  }).join("");
  return printable.trim().slice(0, 200);
}

/** Apaga os arquivos que um job deixou no storage. */
async function removeFiles(storage: StorageDriver, row: JobRow): Promise<void> {
  for (const key of [row.sourceKey, row.resultKey]) {
    if (key) await storage.delete(key).catch(() => {});
  }
}

/** Enfileira o job; se a fila estiver fora do ar o job falha de forma visível (e dá para tentar de novo). */
async function enqueueOrFail({ db, queue }: ConversionsDeps, jobId: string): Promise<void> {
  try {
    await queue.enqueueConvert(jobId);
  } catch (error) {
    await markFailed(
      db,
      jobId,
      "CONVERSION_FAILED",
      `fila indisponível: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Passa os bytes adiante calculando o SHA-256 do original. */
async function* hashing(source: AsyncIterable<Buffer>, hash: ReturnType<typeof createHash>) {
  for await (const chunk of source) {
    hash.update(chunk);
    yield chunk;
  }
}

/**
 * Guarda o original (conferido pelos bytes), cria o job e enfileira a conversão.
 *
 * A vaga é reservada **antes** do envio, numa transação com lock do usuário: sem isso, vários
 * envios simultâneos passam todos pela contagem e furam o limite de conversões ativas. O job só
 * vai para a fila depois de o original estar no storage. Se o mesmo arquivo (mesmo SHA-256) já
 * virou livro, o job conclui na hora apontando para ele, sem converter de novo: o Calibre grava
 * um EPUB diferente a cada conversão (id e data), então só o hash do original reconhece a repetição.
 */
export async function createConversion(
  deps: ConversionsDeps,
  input: {
    userId: string;
    filename: string;
    file: AsyncIterable<Buffer> & { truncated?: boolean };
  },
): Promise<ConversionJob> {
  const { db, storage } = deps;
  const { userId } = input;
  const format = convertibleFormatOf(input.filename);
  const ext = extensionOf(input.filename);
  if (!format || !ext) {
    throw new AppError("INVALID_FILE", "formato não suportado para conversão");
  }

  const jobId = randomUUID();
  const pruned = await db.transaction(async (tx) => {
    await lockUserConversions(tx, userId);
    if ((await countActiveJobs(tx, userId)) >= MAX_ACTIVE_CONVERSIONS) {
      throw new AppError("VALIDATION", "há conversões demais em andamento; espere terminar");
    }
    const old = await deleteOldFailedJobs(tx, userId, MAX_FAILED_CONVERSIONS);
    await insertJob(tx, {
      id: jobId,
      ownerId: userId,
      sourceFormat: format,
      strategy: "calibre",
      sourceFilename: displayName(input.filename),
    });
    return old;
  });
  for (const row of pruned) await removeFiles(storage, row);

  const sourceKey = sourceStorageKey(userId, jobId, ext);
  const hash = createHash("sha256");
  try {
    await storage.put(sourceKey, Readable.from(hashing(inspectSource(input.file, format), hash)));
    if (format === "docx") await assertSafeDocx(storage, sourceKey);
    const sourceHash = hash.digest("hex");

    // O livro guarda o hash do original: vale mesmo depois de "Fechar" apagar o job antigo.
    const existingBook = await findConvertedBook(db, userId, sourceHash);
    const previous = existingBook ? null : await findDoneJobBySource(db, userId, sourceHash);
    const reuseBookId = existingBook?.id ?? previous?.bookId;
    if (reuseBookId) {
      await storage.delete(sourceKey).catch(() => {});
      await markDone(db, jobId, reuseBookId, { sourceHash });
    } else {
      if (!(await setSourceReady(db, jobId, { sourceKey, sourceHash }))) {
        throw notFound(); // o usuário descartou o job enquanto o arquivo subia
      }
      await enqueueOrFail(deps, jobId);
    }
    const row = await findOwnedJob(db, userId, jobId);
    if (!row) throw notFound();
    return toConversionJob(row);
  } catch (error) {
    // Não deixa job nem original órfãos se o envio ou o banco falharem.
    await deleteJob(db, userId, jobId).catch(() => {});
    await storage.delete(sourceKey).catch(() => {});
    throw error;
  }
}

/** DOCX é um ZIP que o Calibre descompacta na memória: recusa o que se expande demais. */
async function assertSafeDocx(storage: StorageDriver, key: string): Promise<void> {
  const bytes = await readAllCapped(await storage.get(key), MAX_CONVERT_SOURCE_BYTES);
  if (!isSafeZipExpansion(bytes)) {
    throw new AppError("INVALID_FILE", "o arquivo DOCX se expande demais para ser convertido");
  }
}

export async function listConversions(db: Db, userId: string): Promise<ConversionJob[]> {
  const since = new Date(Date.now() - CONVERSION_DONE_VISIBLE_MS);
  return (await listVisibleJobs(db, userId, since)).map(toConversionJob);
}

/** "Tentar de novo": só para job falho; o original continua no storage. */
export async function retryConversion(
  deps: ConversionsDeps,
  userId: string,
  jobId: string,
): Promise<ConversionJob> {
  const { db, storage } = deps;
  const current = await findOwnedJob(db, userId, jobId);
  if (!current) throw notFound();
  if (current.status !== "failed" || !current.sourceKey) {
    throw new AppError("CONFLICT", "só dá para tentar de novo uma conversão que falhou");
  }
  const requeued = await requeueJob(db, userId, jobId);
  if (!requeued) throw new AppError("CONFLICT", "a conversão mudou de estado; atualize a lista");
  if (current.resultKey) await storage.delete(current.resultKey).catch(() => {});
  await enqueueOrFail(deps, jobId);
  return toConversionJob((await findOwnedJob(db, userId, jobId)) ?? requeued);
}

/**
 * Descarta o job e apaga os arquivos dele. Se ainda está rodando, a linha some e o worker, ao
 * terminar, vê que o job não existe mais e apaga o que gerou.
 */
export async function dismissConversion(
  { db, storage }: ConversionsDeps,
  userId: string,
  jobId: string,
): Promise<void> {
  const removed = await deleteJob(db, userId, jobId);
  if (!removed) throw notFound();
  await removeFiles(storage, removed);
}
