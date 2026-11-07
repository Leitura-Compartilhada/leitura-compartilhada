import { pgEnum } from "drizzle-orm/pg-core";

// Tipos enumerados compartilhados entre as tabelas.

export const ingestStatus = pgEnum("ingest_status", ["pending", "processing", "ready", "failed"]);

export const readingStatus = pgEnum("reading_status", [
  "want_to_read",
  "reading",
  "read",
  "abandoned",
]);

export const annotationType = pgEnum("annotation_type", ["highlight", "note", "bookmark"]);

export const conversionStatus = pgEnum("conversion_status", [
  "queued",
  "running",
  "done",
  "failed",
]);
