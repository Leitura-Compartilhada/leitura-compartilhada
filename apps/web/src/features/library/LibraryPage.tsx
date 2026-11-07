import type { Book, UpdateBookRequest } from "@leitura/shared";
import { useMemo, useState } from "react";
import { Navigate } from "react-router";
import { Button } from "@/components/ui/button";
import { describeApiError, isUnauthenticated } from "@/lib/messages";
import { BookList } from "./BookList";
import { ConversionsPanel } from "./conversions/ConversionsPanel";
import { DeleteBookDialog } from "./DeleteBookDialog";
import { EditBookDialog } from "./EditBookDialog";
import { ImportDialog } from "./import/ImportDialog";
import { useImport } from "./import/use-import";
import { LibraryFilters } from "./LibraryFilters";
import { describeBookError } from "./library-messages";
import {
  ALL,
  collectTags,
  countByStatus,
  type Filters,
  filterBooks,
  hasActiveFilter,
  NO_FILTERS,
} from "./library-model";
import { ShelvesDialog } from "./ShelvesDialog";
import { UploadControl } from "./UploadControl";
import { useBooks, useShelves, useUpdateBook } from "./use-library";
import { useUpload } from "./use-upload";

export function LibraryPage() {
  const books = useBooks();
  const shelves = useShelves();
  const upload = useUpload();
  const importer = useImport();
  const quickUpdate = useUpdateBook({ optimistic: true });

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [grouped, setGrouped] = useState(true);
  const [editing, setEditing] = useState<Book | null>(null);
  const [deleting, setDeleting] = useState<Book | null>(null);
  const [managingShelves, setManagingShelves] = useState(false);

  const allBooks = books.data;
  const shelfList = shelves.data ?? [];
  const knownTags = useMemo(() => collectTags(allBooks ?? []), [allBooks]);

  if (isUnauthenticated(books.error) || isUnauthenticated(upload.failure)) {
    return <Navigate to="/login" replace />;
  }

  // Estante ou tag que sumiu (apagada, ou sem livros) não pode prender a lista num filtro vazio.
  const effective: Filters = {
    ...filters,
    shelfId:
      filters.shelfId === ALL || shelfList.some((shelf) => shelf.id === filters.shelfId)
        ? filters.shelfId
        : ALL,
    tag: filters.tag === ALL || knownTags.includes(filters.tag) ? filters.tag : ALL,
  };
  const visible = filterBooks(allBooks ?? [], effective);
  const counts = countByStatus(allBooks ?? [], effective);

  const onQuickUpdate = (bookId: string, patch: UpdateBookRequest) =>
    quickUpdate.mutate({ bookId, patch });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Minha estante</h1>
        <UploadControl
          onPick={(files) => {
            const [only] = files;
            if (files.length === 1 && only) upload.pick(only);
            else void importer.begin(files);
          }}
          onPickFolder={(files) => void importer.begin(files)}
          isPending={upload.isPending}
          error={upload.message}
          success={upload.success}
        />
      </div>

      <ImportDialog importer={importer} />

      <ConversionsPanel />

      {books.isPending ? (
        <p className="text-muted-foreground" role="status">
          Carregando a estante…
        </p>
      ) : null}

      {books.isError ? (
        <div role="alert" className="flex flex-col gap-2">
          <p className="text-destructive">{describeApiError(books.error)}</p>
          <Button
            className="self-start"
            variant="outline"
            size="sm"
            onClick={() => books.refetch()}
          >
            Tentar de novo
          </Button>
        </div>
      ) : null}

      {quickUpdate.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível salvar a mudança, e ela foi desfeita.{" "}
          {describeBookError(quickUpdate.error)}
        </p>
      ) : null}

      {allBooks && allBooks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">Sua estante está vazia.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Use “Adicionar livro” para enviar um EPUB, ou um MOBI, FB2, DOCX, TXT, Markdown ou HTML
            para converter.
          </p>
        </div>
      ) : null}

      {allBooks && allBooks.length > 0 ? (
        <>
          <LibraryFilters
            filters={effective}
            onChange={setFilters}
            counts={counts}
            shelves={shelfList}
            tags={knownTags}
            grouped={grouped}
            onGroupedChange={setGrouped}
            onManageShelves={() => setManagingShelves(true)}
          />
          <p className="text-sm text-muted-foreground" role="status">
            {hasActiveFilter(effective)
              ? `Mostrando ${visible.length} de ${allBooks.length} livros`
              : `${allBooks.length} ${allBooks.length === 1 ? "livro" : "livros"}`}
          </p>
          {visible.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="font-medium">Nenhum livro com esses filtros.</p>
              <Button
                className="mt-3"
                variant="outline"
                size="sm"
                onClick={() => setFilters(NO_FILTERS)}
              >
                Limpar filtros
              </Button>
            </div>
          ) : (
            <BookList
              books={visible}
              grouped={grouped}
              shelves={shelfList}
              onEdit={setEditing}
              onDelete={setDeleting}
              onQuickUpdate={onQuickUpdate}
            />
          )}
        </>
      ) : null}

      <EditBookDialog
        book={editing}
        shelves={shelfList}
        knownTags={knownTags}
        onClose={() => setEditing(null)}
      />
      <DeleteBookDialog book={deleting} onClose={() => setDeleting(null)} />
      <ShelvesDialog
        open={managingShelves}
        shelves={shelfList}
        onClose={() => setManagingShelves(false)}
      />
    </section>
  );
}
