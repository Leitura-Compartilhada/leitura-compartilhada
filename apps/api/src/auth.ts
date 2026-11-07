import type { Db } from "@leitura/db";
import * as schema from "@leitura/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env } from "./env.js";

export type AuthOptions = {
  /** Sobrescreve `ALLOW_SIGNUP` (os testes ligam e desligam o cadastro). */
  allowSignup?: boolean;
};

export function createAuth(db: Db, options: AuthOptions = {}) {
  return betterAuth({
    baseURL: env.API_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.WEB_URL],
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !(options.allowSignup ?? env.ALLOW_SIGNUP),
    },
    // Por padrão o limite de tentativas só liga com NODE_ENV=production; aqui não depende disso.
    rateLimit: { enabled: env.NODE_ENV !== "test" },
  });
}

export type Auth = ReturnType<typeof createAuth>;
