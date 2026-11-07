import { ApiRequestError } from "@/lib/api";
import { describeApiError } from "@/lib/messages";

/** O texto genérico fala de "livro" e de "item"; aqui dizemos qual é o caso. */
export function describeShelfError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === "CONFLICT") return "Já existe uma estante com esse nome.";
    if (error.code === "NOT_FOUND") return "Essa estante não existe mais. Atualize a página.";
  }
  return describeApiError(error);
}

export function describeBookError(error: unknown): string {
  if (error instanceof ApiRequestError && error.code === "VALIDATION") {
    return "O servidor não aceitou esses dados. Confira os campos.";
  }
  return describeApiError(error);
}
