// Retroaplica título, autores, idioma e capa nos livros já enviados.
//   pnpm --filter @leitura/api backfill:metadata            # só quem ainda não tem capa
//   pnpm --filter @leitura/api backfill:metadata --dry-run  # mostra o que mudaria
// Depois da capa, sugere a série (pelo título) dos livros que ainda não têm uma; nunca sobrescreve.
import { books, createDb } from "@leitura/db";
import { createStorage } from "@leitura/storage";
import { and, eq, isNull } from "drizzle-orm";
import { env } from "../env.js";
import { inferSeries } from "../lib/series.js";
import { extractAndStoreMetadata } from "../modules/books/metadata.js";

const dryRun = process.argv.includes("--dry-run");
const { db, pool } = createDb(env.DATABASE_URL);
const storage = createStorage(env);

try {
  const pending = await db
    .select()
    .from(books)
    .where(and(isNull(books.coverPath), eq(books.ingestStatus, "ready")));
  let updated = 0;
  for (const book of pending) {
    if (!book.filePath) continue;
    const meta = await extractAndStoreMetadata(storage, {
      ownerId: book.ownerId,
      bookId: book.id,
      fileKey: book.filePath,
    });
    const changes = {
      title: meta.title ?? book.title,
      authors: meta.authors.length > 0 ? meta.authors : book.authors,
      language: meta.language ?? book.language,
      // A série já preenchida (à mão ou por upload) não é sobrescrita.
      series: book.series ?? meta.series,
      seriesIndex: book.series ? book.seriesIndex : meta.seriesIndex,
      coverPath: meta.coverPath,
    };
    console.log(
      `${dryRun ? "[simulação] " : ""}${book.title} -> ${changes.title} | capa: ${changes.coverPath ?? "nenhuma"}`,
    );
    if (dryRun) {
      if (meta.coverPath) await storage.delete(meta.coverPath); // a simulação não deixa arquivos
      continue;
    }
    const rows = await db
      .update(books)
      .set(changes)
      .where(eq(books.id, book.id))
      .returning({ id: books.id });
    if (rows.length === 0 && meta.coverPath)
      await storage.delete(meta.coverPath); // livro sumiu
    else updated++;
  }
  console.log(`${pending.length} livro(s) sem capa examinado(s), ${updated} atualizado(s).`);

  // Série: só quem ainda não tem. O nome original do arquivo não foi guardado, então vale o título.
  const noSeries = await db
    .select()
    .from(books)
    .where(and(isNull(books.series), eq(books.ingestStatus, "ready")));
  let seriesSet = 0;
  for (const book of noSeries) {
    const guess = inferSeries({ title: book.title, filename: book.title });
    if (!guess) continue;
    console.log(
      `${dryRun ? "[simulação] " : ""}série: ${book.title} -> ${guess.series} #${guess.index}`,
    );
    if (!dryRun) {
      await db
        .update(books)
        .set({ series: guess.series, seriesIndex: guess.index })
        .where(and(eq(books.id, book.id), isNull(books.series)));
    }
    seriesSet++;
  }
  console.log(`${seriesSet} livro(s) com série sugerida.`);
} finally {
  await pool.end();
}
