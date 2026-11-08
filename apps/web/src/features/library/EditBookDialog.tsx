import type { Book, ReadingStatus, Shelf } from "@leitura/shared";
import { Loader2 } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type BookFormState, buildPatch, type FormErrors, formFromBook } from "./book-form";
import { describeBookError } from "./library-messages";
import { STATUS_LABELS, STATUS_ORDER } from "./library-model";
import { TagInput } from "./TagInput";
import { useUpdateBook } from "./use-library";

type Props = {
  /** `null` fecha o diálogo. */
  book: Book | null;
  shelves: readonly Shelf[];
  knownTags: readonly string[];
  onClose: () => void;
};

export function EditBookDialog({ book, shelves, knownTags, onClose }: Props) {
  return (
    <Dialog open={book !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar livro</DialogTitle>
          <DialogDescription>
            As mudanças valem para este livro em todos os seus aparelhos.
          </DialogDescription>
        </DialogHeader>
        {book ? (
          <EditForm
            key={book.id}
            book={book}
            shelves={shelves}
            knownTags={knownTags}
            onDone={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

const TEXTAREA_CLASS =
  "min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm";

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function EditForm({
  book,
  shelves,
  knownTags,
  onDone,
}: Omit<Props, "book" | "onClose"> & { book: Book; onDone: () => void }) {
  const uid = useId();
  const [form, setForm] = useState<BookFormState>(() => formFromBook(book));
  const [errors, setErrors] = useState<FormErrors>({});
  const update = useUpdateBook({ optimistic: false });
  const set = <K extends keyof BookFormState>(key: K, value: BookFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const id = (name: string) => `${uid}-${name}`;
  const describe = (name: keyof FormErrors) => (errors[name] ? `${id(name)}-error` : undefined);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = buildPatch(book, form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    if (result.patch === null) {
      onDone();
      return;
    }
    update.mutate({ bookId: book.id, patch: result.patch }, { onSuccess: onDone });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field id={id("title")} label="Título" error={errors.title}>
        <Input
          id={id("title")}
          value={form.title}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={describe("title")}
          onChange={(event) => set("title", event.target.value)}
        />
      </Field>
      <Field id={id("authors")} label="Autores" hint="Um autor por linha." error={errors.authors}>
        <textarea
          id={id("authors")}
          className={TEXTAREA_CLASS}
          value={form.authors}
          aria-invalid={errors.authors ? true : undefined}
          aria-describedby={describe("authors")}
          onChange={(event) => set("authors", event.target.value)}
        />
      </Field>
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <Field id={id("series")} label="Série" error={errors.series}>
          <Input
            id={id("series")}
            value={form.series}
            aria-invalid={errors.series ? true : undefined}
            aria-describedby={describe("series")}
            onChange={(event) => set("series", event.target.value)}
          />
        </Field>
        <Field id={id("seriesIndex")} label="Volume" error={errors.seriesIndex}>
          <Input
            id={id("seriesIndex")}
            inputMode="decimal"
            value={form.seriesIndex}
            aria-invalid={errors.seriesIndex ? true : undefined}
            aria-describedby={describe("seriesIndex")}
            onChange={(event) => set("seriesIndex", event.target.value)}
          />
        </Field>
      </div>
      <Field id={id("status")} label="Status de leitura">
        <Select
          value={form.status}
          onValueChange={(value) => set("status", value as ReadingStatus)}
        >
          <SelectTrigger id={id("status")} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_ORDER.map((status) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field id={id("tags")} label="Tags" hint="Separe com vírgula ou Enter." error={errors.tags}>
        <TagInput
          id={id("tags")}
          tags={form.tags}
          suggestions={knownTags}
          onChange={(tags) => set("tags", tags)}
          describedBy={describe("tags")}
          invalid={Boolean(errors.tags)}
        />
      </Field>
      {shelves.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Estantes</legend>
          {shelves.map((shelf) => (
            <div key={shelf.id} className="flex items-center gap-2">
              <Checkbox
                id={id(`shelf-${shelf.id}`)}
                checked={form.shelfIds.includes(shelf.id)}
                onCheckedChange={(checked) =>
                  set(
                    "shelfIds",
                    checked === true
                      ? [...form.shelfIds, shelf.id]
                      : form.shelfIds.filter((item) => item !== shelf.id),
                  )
                }
              />
              <Label htmlFor={id(`shelf-${shelf.id}`)} className="font-normal">
                {shelf.name}
              </Label>
            </div>
          ))}
          {errors.shelfIds ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.shelfIds}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {update.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {describeBookError(update.error)}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}
