import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// apps/api/src/env.ts -> raiz do monorepo. Caminhos relativos no .env valem a partir daqui,
// e não do diretório em que o processo foi iniciado (pnpm roda a API dentro de apps/api).
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

const DEFAULT_SECRET = "dev-only-secret-troque-em-producao";
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** A URL aponta para esta própria máquina? Só nesse caso o segredo de desenvolvimento é tolerável. */
function isLocalUrl(value: string): boolean {
  try {
    return LOCAL_HOSTNAMES.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().default("postgres://leitura:leitura@localhost:5432/leitura"),
    API_PORT: z.coerce.number().default(3000),
    /**
     * Interface de rede em que a API escuta. O padrão é só esta máquina: o acesso de fora passa por
     * `tailscale serve` (HTTPS), que fala com a API em 127.0.0.1. Em container, use 0.0.0.0.
     */
    API_HOST: z.string().default("127.0.0.1"),
    API_URL: z.string().default("http://localhost:3000"),
    WEB_URL: z.string().default("http://localhost:5173"),
    BETTER_AUTH_SECRET: z.string().min(16).default(DEFAULT_SECRET),
    /**
     * Cadastro aberto. Crie a sua conta e depois desligue (`ALLOW_SIGNUP=false`). Sem a variável, o
     * padrão é aberto em desenvolvimento e **fechado em produção**.
     */
    ALLOW_SIGNUP: z.enum(["true", "false"]).optional(),
    STORAGE_DRIVER: z.enum(["local"]).default("local"),
    STORAGE_DIR: z
      .string()
      .default("./storage")
      .transform((dir) => path.resolve(repoRoot, dir)),
    /** Pasta do web já buildado. Se existir, a API a serve (uma origem só). */
    WEB_DIST: z
      .string()
      .default("./apps/web/dist")
      .transform((dir) => path.resolve(repoRoot, dir)),
  })
  .superRefine((value, ctx) => {
    // Não depende só de NODE_ENV: quem esquece de defini-lo não pode subir com o segredo de dev
    // numa URL pública.
    const reachableFromOutside =
      value.NODE_ENV === "production" || !isLocalUrl(value.API_URL) || !isLocalUrl(value.WEB_URL);
    if (reachableFromOutside && value.BETTER_AUTH_SECRET === DEFAULT_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["BETTER_AUTH_SECRET"],
        message: "defina um BETTER_AUTH_SECRET próprio: a API não é só local ou está em produção",
      });
    }
  })
  .transform((value) => ({
    ...value,
    ALLOW_SIGNUP:
      value.ALLOW_SIGNUP === undefined
        ? value.NODE_ENV !== "production"
        : value.ALLOW_SIGNUP === "true",
  }));

/** Lê e valida as variáveis de ambiente. Falha na partida se algo estiver errado ou inseguro. */
export function parseEnv(source: Record<string, string | undefined>) {
  return envSchema.parse(source);
}

export const env = parseEnv(process.env);
