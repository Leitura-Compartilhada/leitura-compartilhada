import {
  type ConversionErrorCode,
  type ConversionJob,
  type ConvertibleFormat,
  convertibleFormatOf,
  extensionOf,
} from "@leitura/shared";
import { ApiRequestError } from "@/lib/api";
import { describeApiError } from "@/lib/messages";

/** Intervalo entre consultas enquanto há conversão na fila ou rodando. */
export const CONVERSION_POLL_MS = 2000;

export type UploadRoute =
  | { kind: "epub" }
  | { kind: "convert"; format: ConvertibleFormat }
  | { kind: "pdf" }
  | { kind: "unsupported" };

/** Decide para onde o arquivo vai pela extensão: EPUB direto, conversão, ou recusa no cliente. */
export function routeUpload(filename: string): UploadRoute {
  const ext = extensionOf(filename);
  if (ext === "epub") return { kind: "epub" };
  if (ext === "pdf") return { kind: "pdf" };
  const format = convertibleFormatOf(filename);
  return format ? { kind: "convert", format } : { kind: "unsupported" };
}

export const PDF_NOT_SUPPORTED = "PDF ainda não é suportado; vai chegar numa próxima versão.";
export const FORMAT_NOT_SUPPORTED = "Formato não suportado.";

const isActive = (job: ConversionJob) => job.status === "queued" || job.status === "running";

/** `refetchInterval` do TanStack Query: consulta de 2 em 2 s só enquanto algo está ativo. */
export function conversionRefetchInterval(jobs: ConversionJob[] | undefined): number | false {
  return jobs?.some(isActive) ? CONVERSION_POLL_MS : false;
}

/** Jobs que passaram a `done` desde a consulta anterior (ignora os que já vieram prontos). */
export function newlyDone(
  previous: ConversionJob[] | undefined,
  next: ConversionJob[],
): ConversionJob[] {
  if (!previous) return [];
  const before = new Map(previous.map((job) => [job.id, job.status]));
  return next.filter((job) => {
    return job.status === "done" && before.get(job.id) !== "done";
  });
}

const FAILURE_TEXT: Record<ConversionErrorCode, string> = {
  DRM: "Este livro tem DRM (proteção contra cópia) e não pode ser convertido.",
  UNSUPPORTED: "O formato deste arquivo não é suportado.",
  CONVERSION_FAILED: "A conversão falhou. O arquivo pode estar corrompido.",
  TIMEOUT: "A conversão demorou demais e foi interrompida.",
  OUTPUT_INVALID: "A conversão não gerou um livro legível.",
  INGEST_FAILED: "O livro foi convertido, mas não pôde ser adicionado à estante.",
};

export function describeConversionFailure(code: ConversionErrorCode | null): string {
  return code ? FAILURE_TEXT[code] : "A conversão falhou.";
}

/** Erro do envio de um arquivo para conversão (o texto genérico fala só de EPUB). */
export function describeConversionUploadError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === "INVALID_FILE") {
      return "Este arquivo não é do formato indicado pela extensão ou está corrompido.";
    }
    if (error.code === "VALIDATION") {
      return "Há conversões demais em andamento. Aguarde algumas terminarem.";
    }
  }
  return describeApiError(error);
}

export const STATUS_LABEL: Record<ConversionJob["status"], string> = {
  queued: "Na fila",
  running: "Convertendo…",
  done: "Concluído",
  failed: "Falhou",
};

/** Texto para a região `aria-live`: o que concluiu ou falhou entre duas consultas. */
export function announceChanges(
  previous: ConversionJob[] | undefined,
  next: ConversionJob[],
): string {
  if (!previous) return "";
  const before = new Map(previous.map((job) => [job.id, job.status]));
  const parts: string[] = [];
  for (const job of next) {
    const was = before.get(job.id);
    if (was === job.status) continue;
    if (job.status === "done") parts.push(`${job.filename}: conversão concluída.`);
    if (job.status === "failed") parts.push(`${job.filename}: a conversão falhou.`);
  }
  return parts.join(" ");
}
