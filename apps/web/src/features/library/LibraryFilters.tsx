import type { Shelf } from "@leitura/shared";
import { Layers, Library, List, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ALL,
  type Filters,
  hasActiveFilter,
  NO_FILTERS,
  STATUS_LABELS,
  STATUS_ORDER,
  type StatusCounts,
} from "./library-model";

type Props = {
  filters: Filters;
  onChange: (filters: Filters) => void;
  counts: StatusCounts;
  shelves: readonly Shelf[];
  tags: readonly string[];
  grouped: boolean;
  onGroupedChange: (grouped: boolean) => void;
  onManageShelves: () => void;
};

export function LibraryFilters({
  filters,
  onChange,
  counts,
  shelves,
  tags,
  grouped,
  onGroupedChange,
  onManageShelves,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={filters.query}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          placeholder="Buscar por título, autor ou série"
          aria-label="Buscar por título ou autor"
          className="pl-9"
        />
      </div>
      <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
        <legend className="sr-only">Filtrar por status</legend>
        {[ALL, ...STATUS_ORDER].map((status) => {
          const key = status as keyof StatusCounts;
          const active = filters.status === status;
          return (
            <Button
              key={status}
              size="sm"
              variant={active ? "default" : "outline"}
              aria-pressed={active}
              onClick={() => onChange({ ...filters, status: status as Filters["status"] })}
            >
              {status === ALL ? "Todos" : STATUS_LABELS[status as keyof typeof STATUS_LABELS]}
              <span className="text-xs opacity-80">{counts[key]}</span>
            </Button>
          );
        })}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.shelfId}
          onValueChange={(shelfId) => onChange({ ...filters, shelfId })}
        >
          <SelectTrigger size="sm" aria-label="Filtrar por estante" className="min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as estantes</SelectItem>
            {shelves.map((shelf) => (
              <SelectItem key={shelf.id} value={shelf.id}>
                {shelf.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filters.tag} onValueChange={(tag) => onChange({ ...filters, tag })}>
          <SelectTrigger size="sm" aria-label="Filtrar por tag" className="min-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as tags</SelectItem>
            {tags.map((tag) => (
              <SelectItem key={tag} value={tag}>
                {tag}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilter(filters) ? (
          <Button size="sm" variant="ghost" onClick={() => onChange(NO_FILTERS)}>
            <X className="size-4" aria-hidden="true" />
            Limpar filtros
          </Button>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onManageShelves}>
            <Library className="size-4" aria-hidden="true" />
            Gerenciar estantes
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-pressed={grouped}
            onClick={() => onGroupedChange(!grouped)}
          >
            {grouped ? (
              <List className="size-4" aria-hidden="true" />
            ) : (
              <Layers className="size-4" aria-hidden="true" />
            )}
            {grouped ? "Ver lista plana" : "Agrupar por série"}
          </Button>
        </div>
      </div>
    </div>
  );
}
