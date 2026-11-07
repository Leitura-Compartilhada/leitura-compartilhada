import type { Book } from "@leitura/shared";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { describeBookError } from "./library-messages";
import { useDeleteBook } from "./use-library";

type Props = {
  /** `null` fecha o diálogo. */
  book: Book | null;
  onClose: () => void;
};

export function DeleteBookDialog({ book, onClose }: Props) {
  const remove = useDeleteBook();

  function close() {
    remove.reset();
    onClose();
  }

  return (
    <AlertDialog
      open={book !== null}
      onOpenChange={(open) => !open && !remove.isPending && close()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir “{book?.title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            O arquivo, a capa e o progresso de leitura deste livro serão apagados de todos os seus
            aparelhos. Não dá para desfazer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {describeBookError(remove.error)}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancelar</AlertDialogCancel>
          <Button
            variant="outline"
            className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={remove.isPending}
            onClick={() => book && remove.mutate(book.id, { onSuccess: close })}
          >
            {remove.isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Excluir livro
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
