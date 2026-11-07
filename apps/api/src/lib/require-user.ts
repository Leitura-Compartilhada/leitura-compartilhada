import type { FastifyRequest } from "fastify";
import type { Auth } from "../auth.js";
import { AppError } from "./errors.js";
import { toHeaders } from "./http.js";

export type AuthUser = { id: string; email: string; name: string };

/**
 * Devolve o usuário da sessão (cookie) ou lança `UNAUTHENTICATED`.
 * Cada rota chama no começo do handler, então nenhuma esquece de proteger o recurso.
 */
export async function requireUser(auth: Auth, request: FastifyRequest): Promise<AuthUser> {
  const session = await auth.api.getSession({ headers: toHeaders(request.headers) });
  if (!session) throw new AppError("UNAUTHENTICATED", "entre na sua conta para continuar");
  const { id, email, name } = session.user;
  return { id, email, name };
}
