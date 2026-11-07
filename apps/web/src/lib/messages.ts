import { MAX_UPLOAD_BYTES } from "@leitura/shared";
import { ApiRequestError } from "./api";

const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

/** Texto para o usuário, decidido pelo `code` (nunca pela mensagem do servidor). */
export function describeApiError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "Algo deu errado. Tente novamente.";
  switch (error.code) {
    case "INVALID_FILE":
      return "Este arquivo não é um EPUB válido.";
    case "TOO_LARGE":
      return `O arquivo passa do limite de ${MAX_UPLOAD_MB} MB.`;
    case "UNAUTHENTICATED":
      return "Sua sessão expirou. Entre novamente.";
    case "NOT_FOUND":
      return "Livro não encontrado.";
    case "VALIDATION":
      return "O servidor não aceitou os dados enviados.";
    case "CONFLICT":
      return "Já existe um item com esse nome.";
    case "NETWORK":
      return "Sem conexão com o servidor.";
    case "TIMEOUT":
      return "O servidor demorou demais para responder.";
    case "BAD_RESPONSE":
    case "INTERNAL":
      return "O servidor falhou. Tente de novo em instantes.";
  }
}

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === "UNAUTHENTICATED";
}
