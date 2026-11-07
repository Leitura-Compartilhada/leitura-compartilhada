import type { Readable } from "node:stream";
import type { StorageDriver } from "@leitura/storage";
import { readEpubMetadata } from "../../lib/epub/index.js";
import { coverStorageKey } from "./mapper.js";

/** Acima disto o EPUB não é carregado na memória para extrair metadados (o upload vale mesmo assim). */
export const MAX_EXTRACT_BYTES = 128 * 1024 * 1024;

export type StoredMetadata = {
  title: string | null;
  authors: string[];
  language: string | null;
  series: string | null;
  seriesIndex: number | null;
  /** Chave da capa no storage, ou `null` se o EPUB não tem uma capa utilizável. */
  coverPath: string | null;
};

const NONE: StoredMetadata = {
  title: null,
  authors: [],
  language: null,
  series: null,
  seriesIndex: null,
  coverPath: null,
};

async function readAll(stream: Readable, maxBytes: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) {
      stream.destroy();
      return null;
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** No máximo duas extrações ao mesmo tempo: cada uma pode segurar até 128 MiB e roda código síncrono. */
const MAX_CONCURRENT = 2;
let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/**
 * Lê o EPUB já guardado, extrai título, autores, idioma e capa, e grava a capa no storage.
 * Melhor esforço: qualquer falha devolve o que houver (no limite, nada) e quem chama segue com
 * o título do nome do arquivo. Nunca lança.
 */
export async function extractAndStoreMetadata(
  storage: StorageDriver,
  input: { ownerId: string; bookId: string; fileKey: string },
): Promise<StoredMetadata> {
  try {
    return await withSlot(async () => {
      const file = await readAll(await storage.get(input.fileKey), MAX_EXTRACT_BYTES);
      if (!file) return NONE;
      const meta = readEpubMetadata(file);
      let coverPath: string | null = null;
      if (meta.cover) {
        const key = coverStorageKey(input.ownerId, input.bookId, meta.cover.ext);
        await storage.put(key, meta.cover.bytes);
        coverPath = key;
      }
      return {
        title: meta.title,
        authors: meta.authors,
        language: meta.language,
        series: meta.series,
        seriesIndex: meta.seriesIndex,
        coverPath,
      };
    });
  } catch {
    return NONE;
  }
}
