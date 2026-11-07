import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { fetchKnownHashes, uploadBook, uploadConversion } from "@/lib/api";
import { BOOKS_QUERY_KEY, CONVERSIONS_QUERY_KEY } from "@/lib/queries";
import { sha256Hex } from "./file-hash";
import {
  applyKnown,
  buildCandidates,
  type ImportCandidate,
  type ItemOutcome,
  initialSelection,
} from "./import-model";
import { runImport } from "./import-queue";

export type ImportPhase = "idle" | "checking" | "review" | "running" | "done";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Importação em lote: escolher arquivos ou uma pasta, revisar o que entra e enviar em fila. */
export function useImport() {
  const client = useQueryClient();
  const [phase, setPhase] = useState<ImportPhase>("idle");
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [cut, setCut] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outcomes, setOutcomes] = useState<Map<string, ItemOutcome>>(new Map());
  const cancelled = useRef(false);

  async function begin(files: File[]) {
    cancelled.current = false;
    const built = buildCandidates(files);
    setCut(built.cut);
    setOutcomes(new Map());
    setPhase("checking");

    // Hash de um arquivo por vez (cada um é lido inteiro na memória).
    const hashes = new Map<string, string | null>();
    for (const candidate of built.candidates) {
      if (candidate.state === "refused") continue;
      hashes.set(candidate.id, await sha256Hex(candidate.file));
    }
    let known = new Set<string>();
    try {
      known = new Set(await fetchKnownHashes([...new Set([...hashes.values()].filter(isString))]));
    } catch {
      // Sem a conferência, tudo vira "não conferido" e o servidor ainda deduplica no envio.
    }
    const checked = applyKnown(built.candidates, hashes, known);
    setCandidates(checked);
    setSelected(initialSelection(checked));
    setPhase("review");
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function setAll(on: boolean) {
    setSelected(
      on
        ? new Set(candidates.filter((c) => c.state !== "refused").map((c) => c.id))
        : new Set<string>(),
    );
  }

  async function start() {
    const chosen = candidates.filter((c) => selected.has(c.id));
    if (chosen.length === 0) return;
    setOutcomes(new Map(chosen.map((c) => [c.id, { status: "waiting" } as ItemOutcome])));
    setPhase("running");
    await runImport(chosen, {
      uploadBook,
      uploadConversion,
      sleep,
      isCancelled: () => cancelled.current,
      onUpdate: (id, outcome) => {
        setOutcomes((current) => new Map(current).set(id, outcome));
        if (outcome.status === "book") void client.invalidateQueries({ queryKey: BOOKS_QUERY_KEY });
        if (outcome.status === "converting") {
          void client.invalidateQueries({ queryKey: CONVERSIONS_QUERY_KEY });
        }
      },
    });
    setPhase("done");
  }

  function close() {
    cancelled.current = true;
    setPhase("idle");
    setCandidates([]);
    setSelected(new Set());
    setOutcomes(new Map());
  }

  return {
    phase,
    candidates,
    cut,
    selected,
    outcomes,
    begin,
    toggle,
    setAll,
    start,
    close,
  };
}

const isString = (value: string | null): value is string => value !== null;
