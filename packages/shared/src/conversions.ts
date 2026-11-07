import { z } from "zod";

/**
 * Formatos que o Calibre converte para EPUB na F5 (PDF fica para a F6, com IA). Cada formato
 * reúne as extensões aceitas; o arquivo é conferido pelos bytes, não só pelo nome.
 */
export const CONVERTIBLE_FORMATS = {
  mobi: ["mobi", "azw", "azw3"],
  fb2: ["fb2"],
  docx: ["docx"],
  txt: ["txt"],
  md: ["md", "markdown"],
  html: ["html", "htm"],
} as const;

export const convertibleFormatSchema = z.enum(["mobi", "fb2", "docx", "txt", "md", "html"]);
export type ConvertibleFormat = z.infer<typeof convertibleFormatSchema>;

/** Extensão do nome do arquivo (sem o ponto, minúscula), ou `null`. */
export function extensionOf(filename: string): string | null {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : null;
}

/** Formato de conversão pela extensão, ou `null` se o app não converte esse tipo. */
export function convertibleFormatOf(filename: string): ConvertibleFormat | null {
  const ext = extensionOf(filename);
  if (!ext) return null;
  for (const [format, extensions] of Object.entries(CONVERTIBLE_FORMATS)) {
    if ((extensions as readonly string[]).includes(ext)) return format as ConvertibleFormat;
  }
  return null;
}

/** Extensões aceitas pelo seletor de arquivo, com o ponto (".mobi,.azw3,..."). */
export const CONVERTIBLE_ACCEPT = Object.values(CONVERTIBLE_FORMATS)
  .flat()
  .map((ext) => `.${ext}`)
  .join(",");

export const conversionStatusSchema = z.enum(["queued", "running", "done", "failed"]);
export type ConversionStatus = z.infer<typeof conversionStatusSchema>;

/** Motivo estável de uma falha. O cliente escolhe o texto pelo código, nunca pela mensagem. */
export const conversionErrorCodeSchema = z.enum([
  "DRM",
  "UNSUPPORTED",
  "CONVERSION_FAILED",
  "TIMEOUT",
  "OUTPUT_INVALID",
  "INGEST_FAILED",
]);
export type ConversionErrorCode = z.infer<typeof conversionErrorCodeSchema>;

export const conversionJobSchema = z.object({
  id: z.string().uuid(),
  /** Nome do arquivo enviado. */
  filename: z.string(),
  sourceFormat: convertibleFormatSchema,
  status: conversionStatusSchema,
  /** Só em `failed`. */
  errorCode: conversionErrorCodeSchema.nullable(),
  /** Livro criado (ou já existente, se o EPUB convertido era repetido). Só em `done`. */
  bookId: z.string().uuid().nullable(),
  /** ms desde a época. */
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  finishedAt: z.number().int().nullable(),
});
export type ConversionJob = z.infer<typeof conversionJobSchema>;

export const listConversionsResponseSchema = z.object({ jobs: z.array(conversionJobSchema) });
export type ListConversionsResponse = z.infer<typeof listConversionsResponseSchema>;
