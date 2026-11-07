import {
  type Book,
  MAX_AUTHORS,
  MAX_TAGS_PER_BOOK,
  normalizeTag,
  type ReadingStatus,
  type UpdateBookRequest,
  updateBookRequestSchema,
} from "@leitura/shared";

/** O que o diálogo de edição guarda enquanto a pessoa digita (tudo texto, como nos campos). */
export type BookFormState = {
  title: string;
  /** Um autor por linha. */
  authors: string;
  series: string;
  seriesIndex: string;
  status: ReadingStatus;
  tags: string[];
  shelfIds: string[];
};

export function formFromBook(book: Book): BookFormState {
  return {
    title: book.title,
    authors: book.authors.join("\n"),
    series: book.series ?? "",
    seriesIndex: book.seriesIndex === null ? "" : String(book.seriesIndex),
    status: book.status,
    tags: book.tags,
    shelfIds: book.shelfIds,
  };
}

export function splitAuthors(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Normaliza e tira repetidas, mantendo a ordem em que foram escritas. */
export function cleanTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (normalized) seen.add(normalized);
  }
  return [...seen];
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item) => b.includes(item));

export type FormField = "title" | "authors" | "series" | "seriesIndex" | "tags" | "shelfIds";
export type FormErrors = Partial<Record<FormField, string>>;
export type BuildResult =
  | { ok: true; patch: UpdateBookRequest | null }
  | { ok: false; errors: FormErrors };

/** Número com vírgula ou ponto decimal; `null` se vazio; `NaN` quando não é número. */
export function parseSeriesIndex(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "") return null;
  return /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

const FIELD_MESSAGES: Record<FormField, string> = {
  title: "Informe um título de até 300 caracteres.",
  authors: `Use até ${MAX_AUTHORS} autores, um por linha, com até 200 caracteres cada.`,
  series: "O nome da série pode ter até 200 caracteres.",
  seriesIndex: "O volume deve ser um número de 0 a 10000 (pode ter decimais, como 1.5).",
  tags: `Use até ${MAX_TAGS_PER_BOOK} tags de até 40 caracteres.`,
  shelfIds: "Escolha menos estantes.",
};

/**
 * Monta o PATCH só com o que mudou e o valida com o mesmo schema do servidor.
 * `patch: null` quer dizer que nada mudou.
 */
export function buildPatch(book: Book, form: BookFormState): BuildResult {
  const index = parseSeriesIndex(form.seriesIndex);
  if (Number.isNaN(index)) {
    return { ok: false, errors: { seriesIndex: FIELD_MESSAGES.seriesIndex } };
  }

  const draft: UpdateBookRequest = {};
  const title = form.title.trim();
  if (title !== book.title) draft.title = title;
  const authors = splitAuthors(form.authors);
  if (authors.join("\n") !== book.authors.join("\n")) draft.authors = authors;
  const series = form.series.trim() === "" ? null : form.series.trim();
  if (series !== book.series) draft.series = series;
  if (index !== book.seriesIndex) draft.seriesIndex = index;
  if (form.status !== book.status) draft.status = form.status;
  const tags = cleanTags(form.tags);
  if (!sameSet(tags, book.tags)) draft.tags = tags;
  if (!sameSet(form.shelfIds, book.shelfIds)) draft.shelfIds = form.shelfIds;

  if (Object.keys(draft).length === 0) return { ok: true, patch: null };
  const parsed = updateBookRequestSchema.safeParse(draft);
  if (parsed.success) return { ok: true, patch: parsed.data };
  const errors: FormErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && field in FIELD_MESSAGES) {
      errors[field as FormField] = FIELD_MESSAGES[field as FormField];
    }
  }
  return { ok: false, errors };
}
