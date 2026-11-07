import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StorageKeyError, StorageNotFoundError } from "./driver.js";
import { LocalStorageDriver } from "./local.js";

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe("LocalStorageDriver", () => {
  let base: string;
  let root: string;
  let driver: LocalStorageDriver;

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "leitura-storage-"));
    root = path.join(base, "storage");
    driver = new LocalStorageDriver(root);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("grava e lê de volta (Buffer)", async () => {
    await driver.put("books/u1/a.epub", Buffer.from("conteudo"));
    expect((await readAll(await driver.get("books/u1/a.epub"))).toString()).toBe("conteudo");
  });

  it("grava a partir de um stream", async () => {
    await driver.put("covers/c.jpg", Readable.from([Buffer.from("ab"), Buffer.from("cd")]));
    expect((await readAll(await driver.get("covers/c.jpg"))).toString()).toBe("abcd");
  });

  it("cria pastas aninhadas e sobrescreve", async () => {
    await driver.put("a/b/c/d.txt", Buffer.from("um"));
    await driver.put("a/b/c/d.txt", Buffer.from("dois"));
    expect((await readAll(await driver.get("a/b/c/d.txt"))).toString()).toBe("dois");
  });

  it("não deixa arquivos temporários depois de gravar", async () => {
    await driver.put("x/y.bin", Buffer.from("1"));
    expect(await readdir(path.join(root, "x"))).toEqual(["y.bin"]);
  });

  it("exists distingue arquivo, ausente e pasta", async () => {
    await driver.put("pasta/arquivo.txt", Buffer.from("1"));
    expect(await driver.exists("pasta/arquivo.txt")).toBe(true);
    expect(await driver.exists("pasta/outro.txt")).toBe(false);
    expect(await driver.exists("pasta")).toBe(false);
    expect(await driver.exists("nada/disso")).toBe(false);
  });

  it("delete remove e é idempotente", async () => {
    await driver.put("k.txt", Buffer.from("1"));
    await driver.delete("k.txt");
    expect(await driver.exists("k.txt")).toBe(false);
    await expect(driver.delete("k.txt")).resolves.toBeUndefined();
  });

  it("get de chave ausente lança StorageNotFoundError", async () => {
    await expect(driver.get("nao/existe.txt")).rejects.toBeInstanceOf(StorageNotFoundError);
    await driver.put("pasta/a.txt", Buffer.from("1"));
    await expect(driver.get("pasta")).rejects.toBeInstanceOf(StorageNotFoundError);
  });

  describe("chaves inválidas", () => {
    const invalid: [string, string][] = [
      ["vazia", ""],
      ["caminho absoluto", "/etc/passwd"],
      ["unidade do Windows", "C:/Windows/x"],
      ["segmento ..", "../fora.txt"],
      ["segmento .. no meio", "a/../../fora.txt"],
      ["segmento .", "./a.txt"],
      ["barra invertida", "a\\b.txt"],
      ["caractere NUL", "a\0b.txt"],
      ["segmento vazio", "a//b.txt"],
      ["termina em barra", "a/"],
      ["dois-pontos (fluxo do NTFS)", "livro.epub:stream"],
      ["nome reservado do Windows", "CON"],
      ["nome reservado com extensão", "pasta/nul.txt"],
      ["dispositivo COM1", "com1"],
      ["termina em ponto", "arquivo."],
      ["termina em espaço", "arquivo "],
    ];

    it.each(invalid)("rejeita chave %s", async (_nome, key) => {
      await expect(driver.put(key, Buffer.from("x"))).rejects.toBeInstanceOf(StorageKeyError);
      await expect(driver.get(key)).rejects.toBeInstanceOf(StorageKeyError);
      await expect(driver.exists(key)).rejects.toBeInstanceOf(StorageKeyError);
      await expect(driver.delete(key)).rejects.toBeInstanceOf(StorageKeyError);
    });

    it("não grava nada fora da raiz ao receber ..", async () => {
      await driver.put("ok.txt", Buffer.from("1"));
      await expect(driver.put("../fora.txt", Buffer.from("x"))).rejects.toBeInstanceOf(
        StorageKeyError,
      );
      expect(existsSync(path.join(base, "fora.txt"))).toBe(false);
    });

    it("aceita nomes que só começam com pontos", async () => {
      await driver.put("..oculto/.arquivo", Buffer.from("1"));
      expect(await driver.exists("..oculto/.arquivo")).toBe(true);
    });

    it("aceita nomes que apenas contêm um nome reservado", async () => {
      await driver.put("console/communicate.txt", Buffer.from("1"));
      expect(await driver.exists("console/communicate.txt")).toBe(true);
    });
  });

  it("rejeita symlink dentro da raiz que aponta para fora", async (ctx) => {
    const outside = path.join(base, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "segredo.txt"), "segredo");
    await mkdir(root, { recursive: true });
    try {
      await symlink(outside, path.join(root, "link"), "junction");
    } catch {
      ctx.skip(); // sem permissão para criar link neste ambiente
    }

    await expect(driver.put("link/novo/arquivo.txt", Buffer.from("x"))).rejects.toBeInstanceOf(
      StorageKeyError,
    );
    await expect(driver.get("link/segredo.txt")).rejects.toBeInstanceOf(StorageKeyError);
    expect(existsSync(path.join(outside, "novo"))).toBe(false);
    expect(await readFile(path.join(outside, "segredo.txt"), "utf8")).toBe("segredo");
  });
});
