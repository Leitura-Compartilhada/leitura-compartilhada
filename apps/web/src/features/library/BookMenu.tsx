import type { Book, ReadingStatus, Shelf, UpdateBookRequest } from "@leitura/shared";
import { Check, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STATUS_LABELS, STATUS_ORDER } from "./library-model";

type Props = {
  book: Book;
  shelves: readonly Shelf[];
  onEdit: (book: Book) => void;
  onDelete: (book: Book) => void;
  /** Troca rápida (status ou estantes), com atualização otimista. */
  onQuickUpdate: (bookId: string, patch: UpdateBookRequest) => void;
};

/** Menu do card: Editar, Marcar como (status), Estantes e Excluir. */
export function BookMenu({ book, shelves, onEdit, onDelete, onQuickUpdate }: Props) {
  function toggleShelf(shelfId: string, checked: boolean) {
    const shelfIds = checked
      ? [...book.shelfIds, shelfId]
      : book.shelfIds.filter((id) => id !== shelfId);
    onQuickUpdate(book.id, { shelfIds });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="absolute top-1 right-1 size-8 px-0"
          aria-label={`Ações de ${book.title}`}
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onSelect={() => onEdit(book)}>
          <Pencil aria-hidden="true" />
          Editar
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Check aria-hidden="true" />
            Marcar como
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={book.status}
              onValueChange={(value) => onQuickUpdate(book.id, { status: value as ReadingStatus })}
            >
              {STATUS_ORDER.map((status) => (
                <DropdownMenuRadioItem key={status} value={status}>
                  {STATUS_LABELS[status]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {shelves.length > 0 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Estantes</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {shelves.map((shelf) => (
                <DropdownMenuCheckboxItem
                  key={shelf.id}
                  checked={book.shelfIds.includes(shelf.id)}
                  onCheckedChange={(checked) => toggleShelf(shelf.id, checked === true)}
                >
                  {shelf.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(book)}>
          <Trash2 aria-hidden="true" />
          Excluir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
