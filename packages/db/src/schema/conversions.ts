import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { books } from "./books.js";
import { conversionStatus } from "./enums.js";

// Conversões (a fila em si é do pg-boss; aqui fica o estado visível na UI).

export const conversionJobs = pgTable(
  "conversion_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    bookId: uuid("book_id").references(() => books.id, { onDelete: "set null" }),
    sourceFormat: text("source_format").notNull(),
    /** "calibre" ou "pdf-ai" */
    strategy: text("strategy").notNull(),
    status: conversionStatus("status").notNull().default("queued"),
    /** Nome do arquivo enviado, para mostrar na lista e dar nome ao livro. */
    sourceFilename: text("source_filename").notNull().default(""),
    /** Chave do original no storage; vira `null` quando o original é apagado após o sucesso. */
    sourceKey: text("source_key"),
    /** Número da execução atual; cada vez que um worker pega o job soma 1. Só a execução mais nova grava o resultado. */
    attempt: integer("attempt").notNull().default(0),
    /** SHA-256 do original: o mesmo arquivo enviado de novo não é convertido outra vez. */
    sourceHash: text("source_hash"),
    /** Chave do EPUB convertido, entre o fim do Calibre e a ingestão. */
    resultKey: text("result_key"),
    /** Código estável da falha (DRM, TIMEOUT...); o texto para o usuário sai do código. */
    errorCode: text("error_code"),
    /** Detalhe técnico da falha, só para o log e a depuração: nunca vai ao cliente. */
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [
    index("conversion_jobs_owner_idx").on(t.ownerId),
    index("conversion_jobs_owner_hash_idx").on(t.ownerId, t.sourceHash),
  ],
);
