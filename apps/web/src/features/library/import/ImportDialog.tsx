import { Loader2 } from "lucide-react";
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
import {
  describeCandidate,
  type ImportCandidate,
  type ItemOutcome,
  outcomeLabel,
  STATE_LABEL,
  summarize,
} from "./import-model";
import type { useImport } from "./use-import";

type Props = { importer: ReturnType<typeof useImport> };

function Row({
  candidate,
  checked,
  disabled,
  outcome,
  onToggle,
}: {
  candidate: ImportCandidate;
  checked: boolean;
  disabled: boolean;
  outcome: ItemOutcome | undefined;
  onToggle: () => void;
}) {
  const id = `import-${candidate.id}`;
  const refused = candidate.state === "refused";
  const failed = outcome?.status === "failed";
  return (
    <li className="flex items-start gap-3 py-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled || refused}
        onCheckedChange={onToggle}
        className="mt-1"
      />
      <label htmlFor={id} className="min-w-0 flex-1 text-sm">
        <span className="block break-words font-medium">{describeCandidate(candidate)}</span>
        <span
          className={`block text-xs ${failed ? "text-destructive" : "text-muted-foreground"}`}
          role={failed ? "alert" : undefined}
        >
          {outcome ? outcomeLabel(outcome) : (candidate.reason ?? STATE_LABEL[candidate.state])}
        </span>
      </label>
    </li>
  );
}

/** Revisão do lote: o que vai ser importado, o que já está na estante e o andamento do envio. */
export function ImportDialog({ importer }: Props) {
  const { phase, candidates, cut, selected, outcomes } = importer;
  const open = phase !== "idle";
  const locked = phase === "running" || phase === "done";
  const shown = locked ? candidates.filter((c) => outcomes.has(c.id)) : candidates;
  const list = [...outcomes.values()];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && importer.close()}>
      <DialogContent className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar livros</DialogTitle>
          <DialogDescription>
            {phase === "checking"
              ? "Conferindo o que já está na estante…"
              : locked
                ? summarize(list)
                : "Escolha o que quer importar. O que já está na estante vem desmarcado."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto">
          {phase === "checking" ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Lendo os arquivos…
            </p>
          ) : (
            <ul className="divide-y" aria-label="Arquivos para importar">
              {shown.map((candidate) => (
                <Row
                  key={candidate.id}
                  candidate={candidate}
                  checked={selected.has(candidate.id)}
                  disabled={locked}
                  outcome={outcomes.get(candidate.id)}
                  onToggle={() => importer.toggle(candidate.id)}
                />
              ))}
            </ul>
          )}
          {cut > 0 && phase === "review" ? (
            <p className="pt-2 text-xs text-muted-foreground">
              {cut} arquivo(s) ficaram de fora: o limite é de uma vez só. Importe o resto depois.
            </p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {phase === "review" ? (
            <>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => importer.setAll(true)}>
                  Marcar todos
                </Button>
                <Button variant="outline" size="sm" onClick={() => importer.setAll(false)}>
                  Desmarcar todos
                </Button>
              </div>
              <Button disabled={selected.size === 0} onClick={() => void importer.start()}>
                Importar {selected.size} {selected.size === 1 ? "livro" : "livros"}
              </Button>
            </>
          ) : (
            <Button
              className="sm:ml-auto"
              variant={phase === "done" ? "default" : "outline"}
              onClick={importer.close}
            >
              {phase === "running" ? "Parar e fechar" : "Fechar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
