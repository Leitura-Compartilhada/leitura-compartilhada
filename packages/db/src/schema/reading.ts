import { sql } from "drizzle-orm";
import {
  bigint,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { books } from "./books.js";
import { readingStatus } from "./enums.js";

// Progresso de leitura e preferências do leitor.

export const readingStates = pgTable(
  "reading_states",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    status: readingStatus("status").notNull().default("want_to_read"),
    cfi: text("cfi"),
    percentage: doublePrecision("percentage").notNull().default(0),
    textSnippet: text("text_snippet"),
    fileHash: text("file_hash").notNull(),
    deviceId: text("device_id").notNull(),
    /** ms desde epoch, definido pelo cliente; base do last-write-wins. */
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    /**
     * Cursor de sync: inteiro crescente por usuário, atribuído sob lock. Parece um horário em ms
     * (é `max(agora, último + 1)`), mas nunca regride mesmo que o relógio do servidor volte.
     */
    syncedAt: bigint("synced_at", { mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.bookId] }),
    index("reading_states_synced_idx").on(t.userId, t.syncedAt),
    // a chave primária começa por user_id; a cascata de excluir um livro procura por book_id
    index("reading_states_book_idx").on(t.bookId),
  ],
);

export const readerPreferences = pgTable("reader_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** tema, família/tamanho da fonte, margens etc. */
  data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(0),
});
