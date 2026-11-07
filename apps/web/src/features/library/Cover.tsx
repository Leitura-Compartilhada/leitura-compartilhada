import type { Book } from "@leitura/shared";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** Até duas iniciais do título, para a capa substituta. */
function initials(title: string): string {
  const letters = title
    .split(/\s+/)
    .filter((word) => /^\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase());
  return letters.join("") || "?";
}

export function Cover({ book }: { book: Book }) {
  const [failed, setFailed] = useState(false);
  const box = "h-28 w-20 shrink-0 overflow-hidden rounded-md border bg-muted";
  if (!book.hasCover || failed) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          box,
          "flex items-center justify-center text-xl font-semibold text-muted-foreground",
        )}
      >
        {initials(book.title)}
      </div>
    );
  }
  return (
    <img
      src={`/api/books/${encodeURIComponent(book.id)}/cover`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn(box, "object-cover")}
    />
  );
}
