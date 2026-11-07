import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  type StorageBody,
  type StorageDriver,
  StorageKeyError,
  StorageNotFoundError,
} from "./driver.js";

// Nomes que o Windows trata como dispositivo, com ou sem extensão (CON, nul.txt, COM1...).
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

function hasCode(err: unknown, ...codes: string[]): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    codes.includes(String((err as { code: unknown }).code))
  );
}

/** `true` se `relative` (resultado de `path.relative(raiz, alvo)`) aponta para fora da raiz. */
function escapesRoot(relative: string): boolean {
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

/** Valida a chave e devolve seus segmentos. Não aceita nada que lembre caminho do sistema. */
export function validateKey(key: string): string[] {
  if (typeof key !== "string" || key.length === 0) throw new StorageKeyError("chave vazia");
  if (key.includes("\0")) throw new StorageKeyError("chave com caractere NUL");
  if (key.includes("\\")) throw new StorageKeyError("chave com barra invertida");
  if (key.includes(":")) {
    throw new StorageKeyError("chave com dois-pontos (unidade do Windows ou fluxo do NTFS)");
  }
  if (key.startsWith("/")) throw new StorageKeyError("chave não pode ser um caminho absoluto");
  const segments = key.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new StorageKeyError(`segmento inválido na chave: "${segment}"`);
    }
    // O Windows descarta ponto e espaço no fim do nome, então "a." e "a" seriam o mesmo arquivo.
    if (segment.endsWith(".") || segment.endsWith(" ") || WINDOWS_RESERVED.test(segment)) {
      throw new StorageKeyError(`nome não portável na chave: "${segment}"`);
    }
  }
  return segments;
}

export class LocalStorageDriver implements StorageDriver {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  /** Caminho absoluto da chave, conferido depois de resolvido (não basta filtrar a string). */
  private resolveKey(key: string): string {
    const full = path.resolve(this.root, ...validateKey(key));
    if (escapesRoot(path.relative(this.root, full)) || full === this.root) {
      throw new StorageKeyError("chave resolve para fora da raiz do armazenamento");
    }
    return full;
  }

  /**
   * Falha se o caminho real (seguindo symlinks) sair da raiz real. Sobe até o ancestral que já
   * existe, então pode ser chamado antes do `mkdir`, que seguiria o link e criaria pastas fora.
   */
  private async assertInsideRoot(target: string): Promise<void> {
    let realRoot: string;
    try {
      realRoot = await realpath(this.root);
    } catch (err) {
      if (hasCode(err, "ENOENT")) return; // raiz ainda não existe: não há link para seguir
      throw err;
    }
    let current = target;
    for (;;) {
      try {
        const real = await realpath(current);
        if (escapesRoot(path.relative(realRoot, real))) {
          throw new StorageKeyError("caminho real fora da raiz do armazenamento (symlink)");
        }
        return;
      } catch (err) {
        if (err instanceof StorageKeyError) throw err;
        if (!hasCode(err, "ENOENT", "ENOTDIR")) throw err;
        const parent = path.dirname(current);
        if (parent === current) return;
        current = parent;
      }
    }
  }

  async put(key: string, body: StorageBody): Promise<void> {
    const full = this.resolveKey(key);
    const dir = path.dirname(full);
    await mkdir(this.root, { recursive: true });
    await this.assertInsideRoot(dir);
    await mkdir(dir, { recursive: true });
    await this.assertInsideRoot(dir); // de novo: um link criado entre a checagem e o mkdir

    // Escrita atômica: o temporário fica na mesma pasta, então o rename não cruza volumes.
    const tmp = `${full}.${randomUUID()}.tmp`;
    try {
      if (body instanceof Readable) {
        await pipeline(body, createWriteStream(tmp, { flags: "wx" }));
      } else {
        await writeFile(tmp, body, { flag: "wx" });
      }
      await rename(tmp, full);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      throw err;
    }
  }

  async get(key: string): Promise<Readable> {
    const full = this.resolveKey(key);
    await this.assertInsideRoot(full);
    try {
      if (!(await stat(full)).isFile()) throw new StorageNotFoundError(key);
      const handle = await open(full, "r");
      return handle.createReadStream();
    } catch (err) {
      if (hasCode(err, "ENOENT", "ENOTDIR")) throw new StorageNotFoundError(key);
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    const full = this.resolveKey(key);
    await this.assertInsideRoot(full);
    try {
      return (await stat(full)).isFile();
    } catch (err) {
      if (hasCode(err, "ENOENT", "ENOTDIR")) return false;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const full = this.resolveKey(key);
    await this.assertInsideRoot(full);
    try {
      await unlink(full);
    } catch (err) {
      if (!hasCode(err, "ENOENT", "ENOTDIR")) throw err;
    }
  }
}
