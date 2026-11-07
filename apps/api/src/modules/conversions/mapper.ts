import {
  type ConversionJob,
  type ConversionStatus,
  conversionErrorCodeSchema,
  convertibleFormatSchema,
} from "@leitura/shared";
import type { JobRow } from "./queries.js";

/** Chave do original no storage; a extensão vem da lista conhecida, nunca do cliente. */
export function sourceStorageKey(ownerId: string, jobId: string, ext: string): string {
  return `sources/${ownerId}/${jobId}.${ext}`;
}

export function toConversionJob(row: JobRow): ConversionJob {
  const errorCode = conversionErrorCodeSchema.safeParse(row.errorCode);
  return {
    id: row.id,
    filename: row.sourceFilename,
    sourceFormat: convertibleFormatSchema.parse(row.sourceFormat),
    status: row.status as ConversionStatus,
    errorCode: row.status === "failed" && errorCode.success ? errorCode.data : null,
    bookId: row.bookId,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    finishedAt: row.finishedAt ? row.finishedAt.getTime() : null,
  };
}
