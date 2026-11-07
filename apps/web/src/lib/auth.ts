import { createAuthClient } from "better-auth/react";

/** Mesma origem: o cookie de sessão vai em toda requisição para `/api/auth/*`. */
export const authClient = createAuthClient();

type AuthErrorLike = { code?: string; status?: number; message?: string } | null | undefined;

const AUTH_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha incorretos.",
  INVALID_PASSWORD: "E-mail ou senha incorretos.",
  INVALID_EMAIL: "Informe um e-mail válido.",
  USER_NOT_FOUND: "E-mail ou senha incorretos.",
  USER_ALREADY_EXISTS: "Já existe uma conta com este e-mail.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Já existe uma conta com este e-mail.",
  PASSWORD_TOO_SHORT: "A senha é curta demais (mínimo de 8 caracteres).",
  PASSWORD_TOO_LONG: "A senha é longa demais.",
  EMAIL_PASSWORD_SIGN_UP_DISABLED: "O cadastro está desativado neste servidor.",
  EMAIL_AND_PASSWORD_SIGN_UP_IS_NOT_ENABLED: "O cadastro está desativado neste servidor.",
};

/** Mensagem em português para um erro do Better Auth. O texto original do servidor é em inglês. */
export function describeAuthError(error: AuthErrorLike): string {
  if (!error) return "Não foi possível concluir. Tente novamente.";
  const known = error.code ? AUTH_MESSAGES[error.code] : undefined;
  if (known) return known;
  if (error.status === 401 || error.status === 403) return "E-mail ou senha incorretos.";
  if (error.status === 429) return "Muitas tentativas. Aguarde um instante e tente de novo.";
  if (error.status && error.status >= 500) return "O servidor falhou. Tente de novo em instantes.";
  if (error.status === 0 || error.status === undefined) {
    return "Sem conexão com o servidor. Verifique a rede e tente novamente.";
  }
  return "Não foi possível concluir. Verifique os dados e tente novamente.";
}
