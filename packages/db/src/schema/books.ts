import { sql } from "drizzle-orm";
import {
  bigint,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { ingestStatus, readingStatus } from "./enums.js";

// Livros.

export const books = pgTable(
  "books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    authors: text("authors").array().notNull().default(sql`'{}'::text[]`),
    series: text("series"),
    seriesIndex: doublePrecision("series_index"),
    language: text("language"),
    description: text("description"),
    /** Chave no StorageDriver (não é caminho absoluto). */
    filePath: text("file_path"),
    fileHash: text("file_hash"),
    fileSize: bigint("file_size", { mode: "number" }),
    /** SHA-256 do arquivo original quando o livro veio de uma conversão (o EPUB do Calibre muda a cada vez). */
    sourceHash: text("source_hash"),
    coverPath: text("cover_path"),
    sourceFormat: text("source_format").notNull().default("epub"),
    ingestStatus: ingestStatus("ingest_status").notNull().default("pending"),
    /** Status de leitura do dono (um livro tem um único dono). Muda à mão ou ao ler, para a frente. */
    readingStatus: readingStatus("reading_status").notNull().default("want_to_read"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("books_owner_idx").on(t.ownerId),
    uniqueIndex("books_owner_hash_uq").on(t.ownerId, t.fileHash),
    // O Postgres ignora NULL em índice único: livros que não vieram de conversão não colidem.
    uniqueIndex("books_owner_source_hash_uq").on(t.ownerId, t.sourceHash),
  ],
);
