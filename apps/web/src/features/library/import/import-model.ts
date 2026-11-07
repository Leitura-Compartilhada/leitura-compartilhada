import {
  FORMAT_NOT_SUPPORTED,
  PDF_NOT_SUPPORTED,
  routeUpload,
} from "../conversions/conversion-model";

/** Acima disto o arquivo não é conferido (o hash lê tudo na memória do navegador). */
export const MAX_HASH_BYTES = 100 * 1024 * 1024;
/** Uma pasta com mais arquivos que isto é cortada, para a lista continuar leve. */
export const MAX_IMPORT_FILES = 500;
/** Envios de EPUB ao mesmo tempo. */
export const IMPORT_CONCURRENCY = 2;

export type CandidateKind = "epub" | "convert" | "refused";
export type CandidateState = "new" | "known" | "unchecked" | "refused";

export type ImportCandidate = {
  id: string;
  file: File;
  /** Caminho dentro da pasta escolhida (ou só o nome, quando vieram arquivos soltos). */
  path: string;
  kind: CandidateKind;
  state: CandidateState;
  /** Por que o arquivo não pode ser importado (só quando `state` é `refused`). */
  reason: string | null;
};

/** Arquivos que o sistema cria e que nunca são livros. */
const SYSTEM_FILES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

export function isIgnoredFile(name: string): boolean {
  const lower = name.toLowerCase();
  return SYSTEM_FILES.has(lower) || lower.startsWith(".") || lower.startsWith("~$");
}

function pathOf(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return relative && relative.length > 0 ? relative : file.name;
}

/** Monta a lista de candidatos: tira arquivos de sistema, classifica pela extensão e corta o excesso. */
export function buildCandidates(files: File[]): { candidates: ImportCandidate[]; cut: number } {
  const usable = files.filter((file) => !isIgnoredFile(file.name));
  const kept = usable.slice(0, MAX_IMPORT_FILES);
  const candidates = kept.map((file, index): ImportCandidate => {
    const route = routeUpload(file.name);
    const base = { id: `${index}-${pathOf(file)}`, file, path: pathOf(file) };
    if (route.kind === "epub") return { ...base, kind: "epub", state: "new", reason: null };
    if (route.kind === "convert") return { ...base, kind: "convert", state: "new", reason: null };
    const reason = route.kind === "pdf" ? PDF_NOT_SUPPORTED : FORMAT_NOT_SUPPORTED;
    return { ...base, kind: "refused", state: "refused", reason };
  });
  return { candidates, cut: usable.length - kept.length };
}

/** Marca como "já na estante" os candidatos cujo hash o servidor disse que conhece. */
export function applyKnown(
  candidates: ImportCandidate[],
  hashes: Map<string, string | null>,
  known: Set<string>,
): ImportCandidate[] {
  return candidates.map((candidate) => {
    if (candidate.state === "refused") return candidate;
    const hash = hashes.get(candidate.id);
    if (!hash) return { ...candidate, state: "unchecked" };
    return { ...candidate, state: known.has(hash) ? "known" : "new" };
  });
}

/** O que vem marcado quando a lista abre: só o que é novo ou não pôde ser conferido. */
export function initialSelection(candidates: ImportCandidate[]): Set<string> {
  return new Set(
    candidates
      .filter((candidate) => candidate.state === "new" || candidate.state === "unchecked")
      .map((candidate) => candidate.id),
  );
}

export const STATE_LABEL: Record<CandidateState, string> = {
  new: "novo",
  known: "já na estante",
  unchecked: "não conferido",
  refused: "não suportado",
};

/** Tamanho legível: "850 KB", "2,4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

export function describeCandidate(candidate: ImportCandidate): string {
  return `${candidate.path} (${formatBytes(candidate.file.size)})`;
}

export type ItemOutcome =
  | { status: "waiting" }
  | { status: "sending" }
  | { status: "book"; title: string }
  | { status: "converting" }
  | { status: "failed"; message: string };

export function outcomeLabel(outcome: ItemOutcome): string {
  switch (outcome.status) {
    case "waiting":
      return "Aguardando";
    case "sending":
      return "Enviando…";
    case "book":
      return "Na estante";
    case "converting":
      return "Enviado para conversão";
    case "failed":
      return outcome.message;
  }
}

/** Resumo para a linha de progresso: "12 de 30 enviados, 2 com erro". */
export function summarize(outcomes: ItemOutcome[]): string {
  const finished = outcomes.filter(
    (o) => o.status === "book" || o.status === "converting" || o.status === "failed",
  ).length;
  const failed = outcomes.filter((o) => o.status === "failed").length;
  const base = `${finished} de ${outcomes.length} enviados`;
  return failed > 0 ? `${base}, ${failed} com erro` : base;
}

export const isDone = (outcomes: ItemOutcome[]): boolean =>
  outcomes.every((o) => o.status !== "waiting" && o.status !== "sending");
