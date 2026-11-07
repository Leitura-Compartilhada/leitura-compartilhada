import type { ApiError, ApiErrorCode } from "@leitura/shared";
import { StorageNotFoundError } from "@leitura/storage";
import type { FastifyError, FastifyInstance } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  INVALID_FILE: 415,
  TOO_LARGE: 413,
  VALIDATION: 400,
  CONFLICT: 409,
  INTERNAL: 500,
};

/** Erro esperado, com um código estável que o cliente entende. */
export class AppError extends Error {
  override readonly name = "AppError";

  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }

  get statusCode(): number {
    return STATUS_BY_CODE[this.code];
  }
}

/** Código SQLSTATE do Postgres, venha direto no erro ou embrulhado pelo Drizzle em `cause`. */
export function pgErrorCode(error: unknown): string | null {
  for (let current: unknown = error, depth = 0; current && depth < 3; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

function body(code: ApiErrorCode, message: string): ApiError {
  return { error: { code, message } };
}

/**
 * Todo erro da API sai no formato `{ error: { code, message } }`.
 * Com `serveSpa`, um GET fora de `/api/` que não casa com nenhum arquivo devolve o `index.html`
 * do web, para o roteador do navegador resolver a rota.
 */
export function registerErrorHandler(
  app: FastifyInstance,
  options: { serveSpa: boolean } = { serveSpa: false },
): void {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(body(error.code, error.message));
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send(body("VALIDATION", "requisição inválida"));
    }
    if (error instanceof StorageNotFoundError) {
      // Registro apontando para um arquivo que sumiu do disco: o cliente só precisa saber que não há livro.
      request.log.warn({ key: error.key }, "arquivo do livro ausente no armazenamento");
      return reply.status(404).send(body("NOT_FOUND", "livro não encontrado"));
    }
    // Corrida entre dois pedidos: duplicata (23505) é conflito; chave estrangeira (23503) quer
    // dizer que o livro ou a estante foi apagado no meio, e o cliente só precisa saber que sumiu.
    const pgCode = pgErrorCode(error);
    if (pgCode === "23505") return reply.status(409).send(body("CONFLICT", "o item já existe"));
    if (pgCode === "23503") return reply.status(404).send(body("NOT_FOUND", "não encontrado"));
    if (error.code === "FST_REQ_FILE_TOO_LARGE") {
      return reply.status(413).send(body("TOO_LARGE", "o arquivo passa do tamanho máximo"));
    }
    const status = error.statusCode ?? 500;
    if (status === 404) return reply.status(404).send(body("NOT_FOUND", "não encontrado"));
    // O Fastify já escolheu o status certo para estes; reescrevê-los em 400 esconderia a causa.
    if (status === 413) {
      return reply.status(413).send(body("TOO_LARGE", "a requisição passa do tamanho máximo"));
    }
    if (status === 415) {
      return reply.status(415).send(body("INVALID_FILE", "tipo de conteúdo não suportado"));
    }
    if (status < 500) return reply.status(400).send(body("VALIDATION", "requisição inválida"));
    // Erro inesperado: o detalhe vai para o log e nunca para o cliente.
    request.log.error(error);
    return reply.status(500).send(body("INTERNAL", "erro interno"));
  });

  app.setNotFoundHandler((request, reply) => {
    if (options.serveSpa && request.method === "GET" && !request.url.startsWith("/api/")) {
      return reply.sendFile("index.html");
    }
    return reply.status(404).send(body("NOT_FOUND", "não encontrado"));
  });
}
