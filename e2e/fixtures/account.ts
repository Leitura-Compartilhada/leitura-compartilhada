import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, expect } from "@playwright/test";
import { type Book, bookSchema } from "../../packages/shared/src/index.js";

export const PASSWORD = "senha-segura-123";

const here = path.dirname(fileURLToPath(import.meta.url));

/** O EPUB sintético versionado (texto conhecido, sem direitos autorais). */
export const SYNTHETIC_EPUB = path.join(here, "sintetico.epub");

let counter = 0;

/** E-mail único por teste: os testes dividem um banco e não limpam entre si. */
export function uniqueEmail(prefix = "leitor"): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.com`;
}

/**
 * Cria a conta pela API. O `request` do contexto guarda o cookie de sessão, então o navegador
 * desse contexto já nasce logado e os testes de tela não precisam passar pelo login.
 */
export async function signUp(request: APIRequestContext, email: string, origin: string) {
  const response = await request.post("/api/auth/sign-up/email", {
    data: { name: "Leitor de Teste", email, password: PASSWORD },
    headers: { origin },
  });
  expect(response.status(), await response.text()).toBe(200);
}

export async function signIn(request: APIRequestContext, email: string, origin: string) {
  const response = await request.post("/api/auth/sign-in/email", {
    data: { email, password: PASSWORD },
    headers: { origin },
  });
  expect(response.status(), await response.text()).toBe(200);
}

/** Envia um EPUB pela API e devolve o livro. */
export async function uploadEpub(
  request: APIRequestContext,
  file: string,
  name = path.basename(file),
): Promise<{ book: Book; status: number }> {
  const response = await request.post("/api/books", {
    multipart: {
      file: { name, mimeType: "application/epub+zip", buffer: readFileSync(file) },
    },
  });
  const status = response.status();
  expect([200, 201], await response.text()).toContain(status);
  return { book: bookSchema.parse(await response.json()), status };
}
