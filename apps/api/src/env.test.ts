import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const OWN_SECRET = "um-segredo-proprio-bem-longo-e-aleatorio";

describe("parseEnv", () => {
  it("aceita o ambiente de desenvolvimento local sem configurar nada", () => {
    const env = parseEnv({});
    expect(env.NODE_ENV).toBe("development");
    expect(env.API_HOST).toBe("127.0.0.1");
    expect(env.ALLOW_SIGNUP).toBe(true);
  });

  describe("segredo da sessão", () => {
    it("recusa o segredo de desenvolvimento em produção", () => {
      expect(() => parseEnv({ NODE_ENV: "production" })).toThrow(/BETTER_AUTH_SECRET/);
    });

    it("recusa o segredo de desenvolvimento quando a URL não é local, mesmo sem NODE_ENV", () => {
      // O caso real: esquecer de definir NODE_ENV e expor a API por uma URL do Tailscale.
      const publica = {
        API_URL: "https://pc.tailnet.ts.net",
        WEB_URL: "https://pc.tailnet.ts.net",
      };
      expect(() => parseEnv(publica)).toThrow(/BETTER_AUTH_SECRET/);
      expect(() => parseEnv({ API_URL: "https://pc.tailnet.ts.net" })).toThrow(
        /BETTER_AUTH_SECRET/,
      );
    });

    it("aceita um segredo próprio em produção", () => {
      const env = parseEnv({ NODE_ENV: "production", BETTER_AUTH_SECRET: OWN_SECRET });
      expect(env.NODE_ENV).toBe("production");
    });

    it("aceita um segredo próprio numa URL pública", () => {
      expect(() =>
        parseEnv({
          API_URL: "https://pc.tailnet.ts.net",
          WEB_URL: "https://pc.tailnet.ts.net",
          BETTER_AUTH_SECRET: OWN_SECRET,
        }),
      ).not.toThrow();
    });

    it("recusa segredo curto", () => {
      expect(() => parseEnv({ BETTER_AUTH_SECRET: "curto" })).toThrow();
    });
  });

  describe("cadastro", () => {
    it("fica aberto em desenvolvimento e fechado em produção quando não foi configurado", () => {
      expect(parseEnv({}).ALLOW_SIGNUP).toBe(true);
      const prod = parseEnv({ NODE_ENV: "production", BETTER_AUTH_SECRET: OWN_SECRET });
      expect(prod.ALLOW_SIGNUP).toBe(false);
    });

    it("a variável explícita sempre vence", () => {
      expect(parseEnv({ ALLOW_SIGNUP: "false" }).ALLOW_SIGNUP).toBe(false);
      const prod = parseEnv({
        NODE_ENV: "production",
        BETTER_AUTH_SECRET: OWN_SECRET,
        ALLOW_SIGNUP: "true",
      });
      expect(prod.ALLOW_SIGNUP).toBe(true);
    });

    it("recusa valor que não seja true ou false", () => {
      expect(() => parseEnv({ ALLOW_SIGNUP: "talvez" })).toThrow();
    });
  });

  it("a API escuta só nesta máquina por padrão, e API_HOST muda isso", () => {
    expect(parseEnv({}).API_HOST).toBe("127.0.0.1");
    expect(parseEnv({ API_HOST: "0.0.0.0" }).API_HOST).toBe("0.0.0.0");
  });
});
