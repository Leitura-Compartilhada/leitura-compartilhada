import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type CalibreOptions, ConversionFailure, calibreArgs, runCalibre } from "../src/calibre.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-calibre.mjs", import.meta.url));

describe("runCalibre (com um Calibre de mentira)", () => {
  let root: string;
  let workDir: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "leitura-calibre-test-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });
  beforeEach(async () => {
    workDir = await mkdtemp(path.join(root, "job-"));
    for (const dir of ["tmp", "config", "cache"]) await mkdir(path.join(workDir, dir));
  });

  const run = async (mode: string, extra: Partial<CalibreOptions> = {}) => {
    const input = path.join(workDir, "input.txt");
    await writeFile(input, mode);
    const options: CalibreOptions = {
      bin: process.execPath,
      binArgs: [FAKE],
      input,
      output: path.join(workDir, "output.epub"),
      format: "txt",
      workDir,
      timeoutMs: 15_000,
      ...extra,
    };
    return { options, promise: runCalibre(options) };
  };

  const failureOf = async (promise: Promise<void>): Promise<ConversionFailure> => {
    const error = await promise.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConversionFailure);
    return error as ConversionFailure;
  };

  it("converte quando o Calibre termina bem", async () => {
    const { options, promise } = await run("OK");
    await promise;
    expect((await readFile(options.output)).subarray(0, 2).toString()).toBe("PK");
  });

  it("falha com CONVERSION_FAILED e guarda o final da saída", async () => {
    const { promise } = await run("FAIL");
    const failure = await failureOf(promise);
    expect(failure.code).toBe("CONVERSION_FAILED");
    expect(failure.detail).toContain("boom");
  });

  it("reconhece DRM pela saída do Calibre", async () => {
    const { promise } = await run("DRM");
    expect((await failureOf(promise)).code).toBe("DRM");
  });

  it("executável inexistente vira CONVERSION_FAILED, não uma exceção solta", async () => {
    const { promise } = await run("OK", { bin: path.join(root, "nao-existe"), binArgs: [] });
    const failure = await failureOf(promise);
    expect(failure.code).toBe("CONVERSION_FAILED");
    expect(failure.detail).toContain("não encontrado");
  });

  it("estoura o tempo, vira TIMEOUT e mata também o processo neto", async () => {
    const { promise } = await run("HANG", { timeoutMs: 1_500 });
    const started = Date.now();
    expect((await failureOf(promise)).code).toBe("TIMEOUT");
    expect(Date.now() - started).toBeLessThan(10_000);

    const pid = Number(await readFile(path.join(workDir, "tmp", "grandchild.pid"), "utf8"));
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 40 && alive(); i++) await new Promise((r) => setTimeout(r, 100));
    expect(alive(), "o processo neto continua vivo").toBe(false);
  });

  it("roda isolado: HOME e configuração na pasta do job, sem segredos do servidor", async () => {
    process.env.DATABASE_URL = "postgres://segredo@banco/leitura";
    try {
      const { options, promise } = await run("ENV");
      await promise;
      const report = JSON.parse((await readFile(options.output)).subarray(4).toString());
      expect(report.HOME).toBe(workDir);
      expect(report.CONFIG).toBe(path.join(workDir, "config"));
      expect(report.QT).toBe("offscreen");
      expect(report.DB).toBeNull();
    } finally {
      delete process.env.DATABASE_URL;
    }
  });

  it("monta os argumentos por formato, sem shell e sem capa gerada", () => {
    const base = { bin: "x", input: "in.md", output: "out.epub", workDir: "w", timeoutMs: 1 };
    expect(calibreArgs({ ...base, format: "txt" })).toEqual([
      "in.md",
      "out.epub",
      "--no-default-epub-cover",
    ]);
    expect(calibreArgs({ ...base, format: "md" })).toEqual([
      "in.md",
      "out.epub",
      "--no-default-epub-cover",
      "--formatting-type",
      "markdown",
    ]);
  });

  it("HTML não segue links (o Calibre os seguiria até arquivos de fora da pasta do job)", () => {
    const base = { bin: "x", input: "in.html", output: "out.epub", workDir: "w", timeoutMs: 1 };
    expect(calibreArgs({ ...base, format: "html" })).toEqual([
      "in.html",
      "out.epub",
      "--no-default-epub-cover",
      "--max-levels",
      "0",
    ]);
    for (const format of ["txt", "md", "mobi", "fb2", "docx"] as const) {
      expect(calibreArgs({ ...base, format })).not.toContain("--max-levels");
    }
  });

  it("nome de arquivo estranho não vira comando (argumento único, sem shell)", async () => {
    const weird = path.join(workDir, "a b & echo pwned.txt");
    await writeFile(weird, "OK");
    const output = path.join(workDir, "out ; rm -rf.epub");
    await runCalibre({
      bin: process.execPath,
      binArgs: [FAKE],
      input: weird,
      output,
      format: "txt",
      workDir,
      timeoutMs: 15_000,
    });
    expect((await readFile(output)).subarray(0, 2).toString()).toBe("PK");
  });
});
