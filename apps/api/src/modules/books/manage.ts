import type { Book, UpdateBookRequest } from "@leitura/shared";
import { AppError } from "../../lib/errors.js";
import { lockUserLabels } from "../../lib/locks.js";
import { applyBookLabels, cleanupTags } from "../shelves/service.js";
import { type BookPatch, deleteBookRow, findOwnedBook, updateBookRow } from "./queries.js";
import { type BooksDeps, toDtoWithProgress } from "./service.js";

type Logger = { warn: (details: object, message: string) => void };

const notFound = () => new AppError("NOT_FOUND", "livro não encontrado");

/**
 * Edição do dono (`PATCH`): título, autores, série, status, tags e estantes, tudo numa transação.
 * O que não vier no pedido fica como está; `tags` e `shelfIds` substituem o conjunto inteiro.
 *
 * O livro é lido com `FOR UPDATE`: um `DELETE` do mesmo livro espera (ou este pedido vê que ele
 * sumiu e responde 404) em vez de falhar numa chave estrangeira com 500.
 */
export async function updateBook(
  { db }: BooksDeps,
  userId: string,
  bookId: string,
  request: UpdateBookRequest,
): Promise<Book> {
  await db.transaction(async (tx) => {
    await lockUserLabels(tx, userId);
    const current = await findOwnedBook(tx, userId, bookId, "update");
    if (!current) throw notFound();

    const patch: BookPatch = {};
    if (request.title !== undefined) patch.title = request.title;
    if (request.authors !== undefined) patch.authors = request.authors;
    if (request.status !== undefined) patch.readingStatus = request.status;
    if (request.series !== undefined) patch.series = request.series;
    if (request.seriesIndex !== undefined) patch.seriesIndex = request.seriesIndex;
    // Sem série não há volume: limpar a série limpa o índice, e um índice sozinho é ignorado.
    const finalSeries = request.series !== undefined ? request.series : current.series;
    if (finalSeries === null && (request.seriesIndex !== undefined || request.series === null)) {
      patch.seriesIndex = null;
    }
    if (Object.keys(patch).length > 0 && !(await updateBookRow(tx, userId, bookId, patch))) {
      throw notFound();
    }

    await applyBookLabels(tx, userId, bookId, {
      tags: request.tags,
      shelfIds: request.shelfIds,
    });
  });

  const updated = await findOwnedBook(db, userId, bookId);
  if (!updated) throw notFound();
  return toDtoWithProgress(db, userId, updated);
}

/**
 * Exclui o livro do dono: a linha (e, em cascata, progresso, estantes e tags dele), depois o
 * arquivo e a capa do storage. Se a limpeza do storage falhar, o livro já foi excluído para o
 * usuário e só sobra um arquivo órfão, que não aparece em lugar nenhum; a chave vai para o log.
 */
export async function deleteBook(
  { db, storage }: BooksDeps,
  userId: string,
  bookId: string,
  log?: Logger,
): Promise<void> {
  const removed = await db.transaction(async (tx) => {
    await lockUserLabels(tx, userId);
    const row = await deleteBookRow(tx, userId, bookId);
    if (!row) throw notFound();
    await cleanupTags(tx, userId);
    return row;
  });
  for (const key of [removed.filePath, removed.coverPath]) {
    if (!key) continue;
    await storage.delete(key).catch((error: unknown) => {
      log?.warn({ key, error }, "arquivo órfão: não foi possível apagar do armazenamento");
    });
  }
}
