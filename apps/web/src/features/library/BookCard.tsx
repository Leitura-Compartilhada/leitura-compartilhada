import type { Book, Shelf, UpdateBookRequest } from "@leitura/shared";
import { Link } from "react-router";
import { BookMenu } from "./BookMenu";
import { Cover } from "./Cover";
import { StatusBadge } from "./StatusBadge";

function formatPercentage(percentage: number | null): string {
  if (percentage === null) return "Ainda não aberto";
  return `${Math.round(percentage * 100)}% lido`;
}

type Props = {
  book: Book;
  shelves: readonly Shelf[];
  showVolume: boolean;
  onEdit: (book: Book) => void;
  onDelete: (book: Book) => void;
  onQuickUpdate: (bookId: string, patch: UpdateBookRequest) => void;
};

export function BookCard({ book, shelves, showVolume, onEdit, onDelete, onQuickUpdate }: Props) {
  const percent = book.percentage === null ? 0 : Math.round(book.percentage * 100);
  return (
    <li className="relative">
      <Link
        to={`/read/${book.id}`}
        className="flex h-full gap-3 rounded-lg border bg-card p-3 pr-10 text-card-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Cover book={book} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="line-clamp-2 font-medium">{book.title}</span>
          {book.authors.length > 0 ? (
            <span className="line-clamp-1 text-sm text-muted-foreground">
              {book.authors.join(", ")}
            </span>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={book.status} />
            {showVolume && book.seriesIndex !== null ? (
              <span className="text-xs text-muted-foreground">Vol. {book.seriesIndex}</span>
            ) : null}
          </div>
          <div className="mt-auto flex flex-col gap-1 pt-1">
            <div
              role="progressbar"
              aria-label={`Progresso de ${book.title}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
            </div>
            <span className="text-xs text-muted-foreground">
              {formatPercentage(book.percentage)}
            </span>
          </div>
        </div>
      </Link>
      <BookMenu
        book={book}
        shelves={shelves}
        onEdit={onEdit}
        onDelete={onDelete}
        onQuickUpdate={onQuickUpdate}
      />
    </li>
  );
}
