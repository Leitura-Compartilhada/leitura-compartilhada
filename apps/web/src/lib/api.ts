import {
  type ApiErrorCode,
  apiErrorSchema,
  type Book,
  bookSchema,
  type ConfigResponse,
  type ConversionJob,
  configResponseSchema,
  conversionJobSchema,
  type KnownHashesResponse,
  knownHashesResponseSchema,
  type ListBooksResponse,
  listBooksResponseSchema,
  listConversionsResponseSchema,
  listShelvesResponseSchema,
  type ProgressResponse,
  progressResponseSchema,
  type Shelf,
  type SyncRequest,
  type SyncResponse,
  shelfSchema,
  syncResponseSchema,
  type UpdateBookRequest,
  type UpdateShelfRequest,
} from "@leitura/shared";

/** Qualquer coisa com `parse` serve (os schemas Zod do contrato). */
type Schema<T> = { parse(data: unknown): T };

/** Falhas que não vêm do servidor: sem rede, ou resposta fora do contrato. */
export type ClientErrorCode = "NETWORK" | "BAD_RESPONSE" | "TIMEOUT";

export class ApiRequestError extends Error {
  readonly code: ApiErrorCode | ClientErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode | ClientErrorCode, message: string, status = 0) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
  }
}

/** Código de erro por status quando o corpo não segue o contrato (ex.: erro do proxy). */
function codeFromStatus(status: number): ApiErrorCode {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 413) return "TOO_LARGE";
  if (status === 400 || status === 422) return "VALIDATION";
  return "INTERNAL";
}

async function toRequestError(response: Response): Promise<ApiRequestError> {
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  if (parsed.success) {
    const { code, message } = parsed.data.error;
    return new ApiRequestError(code, message, response.status);
  }
  return new ApiRequestError(
    codeFromStatus(response.status),
    `erro ${response.status}`,
    response.status,
  );
}

async function send(path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "include", ...init });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiRequestError("TIMEOUT", "o servidor demorou demais para responder");
    }
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiRequestError("NETWORK", "sem conexão com o servidor");
  }
  if (!response.ok) throw await toRequestError(response);
  return response;
}

async function requestJson<T>(path: string, schema: Schema<T>, init: RequestInit = {}): Promise<T> {
  const response = await send(path, init);
  const body: unknown = await response.json().catch(() => null);
  try {
    return schema.parse(body);
  } catch {
    throw new ApiRequestError("BAD_RESPONSE", "resposta fora do contrato", response.status);
  }
}

export function getConfig(): Promise<ConfigResponse> {
  return requestJson("/api/config", configResponseSchema);
}

export async function listBooks(): Promise<ListBooksResponse["books"]> {
  const { books } = await requestJson("/api/books", listBooksResponseSchema);
  return books;
}

export function uploadBook(file: File): Promise<Book> {
  const form = new FormData();
  form.append("file", file);
  return requestJson("/api/books", bookSchema, { method: "POST", body: form });
}

/** Dos hashes (SHA-256) pedidos, os que já estão na estante. */
export async function fetchKnownHashes(hashes: string[]): Promise<KnownHashesResponse["known"]> {
  if (hashes.length === 0) return [];
  const { known } = await requestJson(
    "/api/books/known-hashes",
    knownHashesResponseSchema,
    jsonInit("POST", { hashes }),
  );
  return known;
}

export async function downloadBookFile(bookId: string, signal?: AbortSignal): Promise<Blob> {
  const response = await send(`/api/books/${encodeURIComponent(bookId)}/file`, { signal });
  return response.blob();
}

export function getProgress(bookId: string, timeoutMs: number): Promise<ProgressResponse> {
  return requestJson(`/api/progress/${encodeURIComponent(bookId)}`, progressResponseSchema, {
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** `keepalive` deixa o envio terminar mesmo que a página esteja sendo fechada. */
export function postSync(request: SyncRequest, keepalive = false): Promise<SyncResponse> {
  return requestJson("/api/sync", syncResponseSchema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    keepalive,
  });
}

export function updateBook(bookId: string, patch: UpdateBookRequest): Promise<Book> {
  return requestJson(
    `/api/books/${encodeURIComponent(bookId)}`,
    bookSchema,
    jsonInit("PATCH", patch),
  );
}

export async function deleteBook(bookId: string): Promise<void> {
  await send(`/api/books/${encodeURIComponent(bookId)}`, { method: "DELETE" });
}

export async function listShelves(): Promise<Shelf[]> {
  const { shelves } = await requestJson("/api/shelves", listShelvesResponseSchema);
  return shelves;
}

export function createShelf(name: string): Promise<Shelf> {
  return requestJson("/api/shelves", shelfSchema, jsonInit("POST", { name }));
}

export function updateShelf(shelfId: string, patch: UpdateShelfRequest): Promise<Shelf> {
  return requestJson(
    `/api/shelves/${encodeURIComponent(shelfId)}`,
    shelfSchema,
    jsonInit("PATCH", patch),
  );
}

export async function deleteShelf(shelfId: string): Promise<void> {
  await send(`/api/shelves/${encodeURIComponent(shelfId)}`, { method: "DELETE" });
}

export function uploadConversion(file: File): Promise<ConversionJob> {
  const form = new FormData();
  form.append("file", file);
  return requestJson("/api/conversions", conversionJobSchema, { method: "POST", body: form });
}

export async function listConversions(): Promise<ConversionJob[]> {
  const { jobs } = await requestJson("/api/conversions", listConversionsResponseSchema);
  return jobs;
}

export function retryConversion(jobId: string): Promise<ConversionJob> {
  return requestJson(`/api/conversions/${encodeURIComponent(jobId)}/retry`, conversionJobSchema, {
    method: "POST",
  });
}

export async function dismissConversion(jobId: string): Promise<void> {
  await send(`/api/conversions/${encodeURIComponent(jobId)}`, { method: "DELETE" });
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
