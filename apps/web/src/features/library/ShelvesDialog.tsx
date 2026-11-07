import { MAX_SHELF_NAME_LENGTH, type Shelf } from "@leitura/shared";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { describeShelfError } from "./library-messages";
import { useShelfMutations } from "./use-library";

type Props = {
  open: boolean;
  shelves: readonly Shelf[];
  onClose: () => void;
};

export function ShelvesDialog({ open, shelves, onClose }: Props) {
  const { create, rename, remove } = useShelfMutations();
  const [name, setName] = useState("");

  function onCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(trimmed, { onSuccess: () => setName("") });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Estantes</DialogTitle>
          <DialogDescription>
            Crie, renomeie ou apague estantes. Apagar uma estante não apaga os livros dela.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onCreate} className="flex gap-2" noValidate>
          <Input
            aria-label="Nome da nova estante"
            placeholder="Nova estante"
            value={name}
            maxLength={MAX_SHELF_NAME_LENGTH}
            aria-invalid={create.isError ? true : undefined}
            onChange={(event) => {
              setName(event.target.value);
              if (create.isError) create.reset();
            }}
          />
          <Button type="submit" disabled={create.isPending || name.trim() === ""}>
            {create.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-4" aria-hidden="true" />
            )}
            Criar
          </Button>
        </form>
        {create.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {describeShelfError(create.error)}
          </p>
        ) : null}

        {shelves.length === 0 ? (
          <p className="text-sm text-muted-foreground">Você ainda não criou nenhuma estante.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Suas estantes">
            {shelves.map((shelf) => (
              <ShelfRow
                key={shelf.id}
                shelf={shelf}
                rename={(newName, options) =>
                  rename.mutate({ id: shelf.id, name: newName }, options)
                }
                renameState={{
                  pending: rename.isPending,
                  error: rename.error,
                  reset: rename.reset,
                }}
                remove={(options) => remove.mutate(shelf.id, options)}
                removeState={{
                  pending: remove.isPending,
                  error: remove.error,
                  reset: remove.reset,
                }}
              />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

type MutationOptions = { onSuccess?: () => void };
type RowProps = {
  shelf: Shelf;
  rename: (name: string, options: MutationOptions) => void;
  renameState: { pending: boolean; error: unknown; reset: () => void };
  remove: (options: MutationOptions) => void;
  removeState: { pending: boolean; error: unknown; reset: () => void };
};

type Mode = "view" | "rename" | "confirm-delete";

function ShelfRow({ shelf, rename, renameState, remove, removeState }: RowProps) {
  const [mode, setMode] = useState<Mode>("view");
  const [draft, setDraft] = useState(shelf.name);
  // Os estados das mutações são compartilhados pela lista: só esta linha mostra o erro se
  // ela é a que está em edição.
  const error =
    (mode === "rename" && renameState.error) || (mode === "confirm-delete" && removeState.error);

  function submitRename(event: FormEvent) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || trimmed === shelf.name) {
      setMode("view");
      return;
    }
    rename(trimmed, { onSuccess: () => setMode("view") });
  }

  function cancel() {
    renameState.reset();
    removeState.reset();
    setDraft(shelf.name);
    setMode("view");
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border p-2">
      {mode === "rename" ? (
        <form onSubmit={submitRename} className="flex gap-2" noValidate>
          <Input
            aria-label={`Novo nome para ${shelf.name}`}
            value={draft}
            maxLength={MAX_SHELF_NAME_LENGTH}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && event.stopPropagation()}
          />
          <Button type="submit" size="sm" disabled={renameState.pending}>
            Salvar
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={cancel}>
            Cancelar
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{shelf.name}</span>
          <span className="text-xs text-muted-foreground">
            {shelf.bookCount} {shelf.bookCount === 1 ? "livro" : "livros"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Renomear ${shelf.name}`}
            onClick={() => {
              renameState.reset();
              setDraft(shelf.name);
              setMode("rename");
            }}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Apagar ${shelf.name}`}
            onClick={() => {
              removeState.reset();
              setMode("confirm-delete");
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      {mode === "confirm-delete" ? (
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0 text-sm">
          <legend className="sr-only">Apagar {shelf.name}</legend>
          <p>
            Apagar a estante “{shelf.name}”? Os livros dela ({shelf.bookCount}) continuam na sua
            estante geral; só deixam de estar nesta.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={removeState.pending}
              onClick={() => remove({ onSuccess: () => setMode("view") })}
            >
              Apagar estante
            </Button>
            <Button size="sm" variant="outline" onClick={cancel}>
              Cancelar
            </Button>
          </div>
        </fieldset>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {describeShelfError(error)}
        </p>
      ) : null}
    </li>
  );
}
