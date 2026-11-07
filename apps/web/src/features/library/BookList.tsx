import type { Book, Shelf, UpdateBookRequest } from "@leitura/shared";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useId, useState } from "react";
import { BookCard } from "./BookCard";
import { type BookGroup, groupBySeries, sortFlat } from "./library-model";

type Actions = {
  shelves: readonly Shelf[];
  onEdit: (book: Book) => void;
  onDelete: (book: Book) => void;
  onQuickUpdate: (bookId: string, patch: UpdateBookRequest) => void;
};

const GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3";

function Cards({
  books,
  showVolume,
  ...actions
}: Actions & { books: Book[]; showVolume: boolean }) {
  return (
    <ul className={GRID}>
      {books.map((book) => (
        <BookCard key={book.id} book={book} showVolume={showVolume} {...actions} />
      ))}
    </ul>
  );
}

function Group({ group, ...actions }: Actions & { group: BookGroup }) {
  const [open, setOpen] = useState(true);
  const regionId = useId();
  const name = group.series ?? "Sem série";
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <section className="flex flex-col gap-2" data-testid="series-group" aria-label={name}>
      <h2 className="text-base font-semibold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 rounded-md px-1 py-0.5 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Icon className="size-4" aria-hidden="true" />
          {name}
          <span className="text-sm font-normal text-muted-foreground">
            {group.books.length} {group.books.length === 1 ? "livro" : "livros"}
          </span>
        </button>
      </h2>
      <div id={regionId} hidden={!open}>
        <Cards books={group.books} showVolume={group.series !== null} {...actions} />
      </div>
    </section>
  );
}

type Props = Actions & { books: Book[]; grouped: boolean };

/**
 * Agrupado por série (recolhível) ou lista plana. Se nenhum livro tem série, mostra a lista plana
 * mesmo com o agrupamento ligado: um único grupo "Sem série" seria só ruído.
 */
export function BookList({ books, grouped, ...actions }: Props) {
  const anySeries = books.some((book) => book.series !== null);
  if (!grouped || !anySeries) {
    return <Cards books={sortFlat(books)} showVolume={false} {...actions} />;
  }
  return (
    <div className="flex flex-col gap-5">
      {groupBySeries(books).map((group) => (
        <Group key={group.series ?? "\u0000none"} group={group} {...actions} />
      ))}
    </div>
  );
}
