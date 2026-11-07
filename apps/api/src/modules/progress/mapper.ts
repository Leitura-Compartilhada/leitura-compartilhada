import type { readingStates } from "@leitura/db";
import type { ReadingState } from "@leitura/shared";

export type ReadingStateRow = typeof readingStates.$inferSelect;

export function toReadingState(row: ReadingStateRow): ReadingState {
  return {
    bookId: row.bookId,
    status: row.status,
    cfi: row.cfi,
    percentage: row.percentage,
    textSnippet: row.textSnippet,
    fileHash: row.fileHash,
    deviceId: row.deviceId,
    updatedAt: row.updatedAt,
  };
}
