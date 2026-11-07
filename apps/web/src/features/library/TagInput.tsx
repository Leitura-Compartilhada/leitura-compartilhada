import { MAX_TAG_LENGTH, MAX_TAGS_PER_BOOK } from "@leitura/shared";
import { X } from "lucide-react";
import { type KeyboardEvent, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { cleanTags } from "./book-form";

type Props = {
  id: string;
  tags: string[];
  /** Tags que já existem na estante, oferecidas como sugestão. */
  suggestions: readonly string[];
  onChange: (tags: string[]) => void;
  describedBy?: string;
  invalid?: boolean;
};

/** Entrada livre de tags: Enter ou vírgula confirmam; as já usadas aparecem como sugestão. */
export function TagInput({ id, tags, suggestions, onChange, describedBy, invalid }: Props) {
  const [draft, setDraft] = useState("");
  const listId = useId();

  function commit(text: string) {
    const added = cleanTags(text.split(","));
    setDraft("");
    if (added.length > 0) onChange(cleanTags([...tags, ...added]));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault(); // Enter não pode enviar o formulário
      commit(draft);
    } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  const available = suggestions.filter((tag) => !tags.includes(tag));
  return (
    <div className="flex flex-col gap-2">
      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags do livro">
          {tags.map((tag) => (
            <li
              key={tag}
              className="flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-2.5 text-sm text-secondary-foreground"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remover a tag ${tag}`}
                onClick={() => onChange(tags.filter((item) => item !== tag))}
                className="rounded-full p-0.5 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        id={id}
        value={draft}
        list={listId}
        maxLength={MAX_TAG_LENGTH}
        disabled={tags.length >= MAX_TAGS_PER_BOOK}
        placeholder="Digite e aperte Enter"
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
      />
      <datalist id={listId}>
        {available.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
    </div>
  );
}
