import { afterEach, describe, expect, it, vi } from "vitest";

describe("env do worker", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("em produção exige o Calibre por caminho absoluto", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CALIBRE_BIN", "ebook-convert");
    await expect(import("../src/env.js")).rejects.toThrow(/caminho absoluto/);
  });

  it("em produção aceita caminho absoluto; em desenvolvimento aceita só o nome", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CALIBRE_BIN", process.execPath);
    expect((await import("../src/env.js")).env.calibreBin).toBe(process.execPath);

    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CALIBRE_BIN", "ebook-convert");
    expect((await import("../src/env.js")).env.calibreBin).toBe("ebook-convert");
  });

  it("lê o timeout do ambiente e cai no padrão se vier lixo", async () => {
    vi.stubEnv("CONVERT_TIMEOUT_MS", "90000");
    expect((await import("../src/env.js")).env.convertTimeoutMs).toBe(90_000);
    vi.resetModules();
    vi.stubEnv("CONVERT_TIMEOUT_MS", "abc");
    expect((await import("../src/env.js")).env.convertTimeoutMs).toBe(5 * 60 * 1000);
  });
});
