import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ConvertibleFormat } from "@leitura/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConversionFailure, calibreEnv, runCalibre } from "../src/calibre.js";

// Testes com o Calibre de verdade. Só rodam onde existe um `ebook-convert` (o CI instala um).
// As versões mudam de uma máquina para outra: afirmamos EPUB válido e texto presente, nunca bytes.
const BIN = process.env.CALIBRE_BIN ?? "ebook-convert";
const SYNTHETIC_EPUB = fileURLToPath(
  new URL("../../../e2e/fixtures/sintetico.epub", import.meta.url),
);
const available =
  spawnSync(BIN, ["--version"], { stdio: "ignore", windowsHide: true }).status === 0;

const FB2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info>
<genre>sf</genre><author><first-name>Fulana</first-name><last-name>Teste</last-name></author>
<book-title>Livro FB2 de Teste</book-title><lang>pt</lang></title-info></description>
<body><section><title><p>Capítulo 1</p></title><p>MARCADOR-REAL-fb2 texto do primeiro capítulo.</p></section></body></FictionBook>`;

const HAND_WRITTEN: Record<string, { name: string; format: ConvertibleFormat; content: string }> = {
  txt: {
    name: "livro.txt",
    format: "txt",
    content: "Título do Texto\n\nMARCADOR-REAL-txt primeiro parágrafo.\n\nSegundo parágrafo.\n",
  },
  md: {
    name: "livro.md",
    format: "md",
    content:
      "# Título em Markdown\n\nMARCADOR-REAL-md **negrito** e um parágrafo.\n\n## Seção\n\nOutro texto.\n",
  },
  html: {
    name: "livro.html",
    format: "html",
    content:
      "<html><head><title>Título HTML</title></head><body><h1>Capítulo</h1><p>MARCADOR-REAL-html parágrafo.</p></body></html>",
  },
  fb2: { name: "livro.fb2", format: "fb2", content: FB2 },
};

describe.skipIf(!available)("Calibre real", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "leitura-calibre-real-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function newWorkDir(): Promise<string> {
    const dir = await mkdtemp(path.join(root, "job-"));
    for (const sub of ["tmp", "config", "cache"]) await mkdir(path.join(dir, sub));
    return dir;
  }

  /** Converte `input` para EPUB com a mesma função que o worker usa. */
  async function toEpub(input: string, format: ConvertibleFormat) {
    const workDir = await newWorkDir();
    const output = path.join(workDir, "output.epub");
    await runCalibre({ bin: BIN, input, output, format, workDir, timeoutMs: 120_000 });
    return { output, workDir };
  }

  /** Texto do EPUB, lido pelo próprio Calibre (EPUB → TXT). */
  async function textOf(epub: string, workDir: string): Promise<string> {
    const txt = path.join(workDir, "saida.txt");
    const result = spawnSync(BIN, [epub, txt], { env: calibreEnv(workDir), windowsHide: true });
    expect(result.status, String(result.stderr)).toBe(0);
    return readFile(txt, "utf8");
  }

  for (const [key, sample] of Object.entries(HAND_WRITTEN)) {
    it(`converte ${key} escrito à mão para um EPUB com o texto`, async () => {
      const dir = await newWorkDir();
      const input = path.join(dir, `input.${sample.name.split(".").pop()}`);
      await writeFile(input, sample.content);
      const { output, workDir } = await toEpub(input, sample.format);

      expect((await readFile(output)).subarray(0, 2).toString()).toBe("PK");
      expect(await textOf(output, workDir)).toContain(`MARCADOR-REAL-${key}`);
    });
  }

  // MOBI, AZW3 e DOCX são binários: geramos a partir do EPUB sintético com o próprio Calibre.
  for (const [ext, format] of [
    ["mobi", "mobi"],
    ["azw3", "mobi"],
    ["docx", "docx"],
  ] as const) {
    it(`converte ${ext} (gerado do EPUB sintético) de volta para EPUB, com o texto`, async () => {
      const dir = await newWorkDir();
      const source = path.join(dir, `input.${ext}`);
      const made = spawnSync(BIN, [SYNTHETIC_EPUB, source], {
        env: calibreEnv(dir),
        windowsHide: true,
      });
      expect(made.status, String(made.stderr)).toBe(0);

      const { output, workDir } = await toEpub(source, format);
      expect((await readFile(output)).subarray(0, 2).toString()).toBe("PK");
      expect(await textOf(output, workDir)).toContain("marcador-c1-p1");
    });
  }

  it("HTML com links para arquivos fora da pasta do job não os traz para o EPUB", async () => {
    // O Calibre 9.16 segue <a href="../outro.html"> por padrão e embutiria o arquivo de fora.
    const workDir = await newWorkDir();
    const outside = path.join(path.dirname(workDir), "segredo-fora-da-pasta.html");
    await writeFile(outside, "<html><body><p>SEGREDO-FORA-DA-PASTA</p></body></html>");
    const input = path.join(workDir, "input.html");
    await writeFile(
      input,
      '<html><body><p>Início do livro de teste</p><a href="../segredo-fora-da-pasta.html">link</a></body></html>',
    );
    const { output } = await toEpub(input, "html");
    expect(await textOf(output, workDir)).not.toContain("SEGREDO-FORA-DA-PASTA");
  });

  it("arquivo corrompido com extensão .mobi falha com CONVERSION_FAILED", async () => {
    const dir = await newWorkDir();
    const input = path.join(dir, "input.mobi");
    await writeFile(input, Buffer.from("isto de longe não é um livro mobi ".repeat(40)));
    const failure = await toEpub(input, "mobi").then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(ConversionFailure);
    expect((failure as ConversionFailure).code).toBe("CONVERSION_FAILED");
  });
});
