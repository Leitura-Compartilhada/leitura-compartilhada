import { bigint, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { books } from "./books.js";
import { annotationType } from "./enums.js";

// Anotações (destaques, notas e marcadores).

export const annotations = pgTable(
  "annotations",
  {
    /** UUID gerado no cliente. */
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    type: annotationType("type").notNull(),
    cfiRange: text("cfi_range").notNull(),
    text: text("text"),
    note: text("note"),
    color: text("color"),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    deletedAt: bigint("deleted_at", { mode: "number" }),
    syncedAt: bigint("synced_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("annotations_user_book_idx").on(t.userId, t.bookId),
    index("annotations_synced_idx").on(t.userId, t.syncedAt),
  ],
);
