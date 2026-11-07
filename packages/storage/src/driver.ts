import type { Readable } from "node:stream";

export type StorageBody = Buffer | Uint8Array | Readable;

/**
 * Armazenamento de arquivos (livros, capas). As chaves usam "/" como separador, por exemplo
 * `books/<ownerId>/<bookId>.epub`. Em dev o driver grava em disco; depois pode virar S3/R2.
 */
export interface StorageDriver {
  /** Grava (ou sobrescreve) o conteúdo da chave. */
  put(key: string, body: StorageBody): Promise<void>;
  /**
   * Abre o conteúdo como stream. Lança `StorageNotFoundError` se não existir.
   * Quem chama deve consumir ou destruir o stream, senão o arquivo fica aberto.
   */
  get(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  /** Idempotente: apagar uma chave que não existe não é erro. */
  delete(key: string): Promise<void>;
}

/** Chave inválida ou que tenta sair da raiz do armazenamento. */
export class StorageKeyError extends Error {
  override readonly name = "StorageKeyError";
}

/**
 * A chave fica em `key` para o log, mas não na mensagem: ela carrega o id do dono, e mensagens
 * podem acabar numa resposta ao cliente.
 */
export class StorageNotFoundError extends Error {
  override readonly name = "StorageNotFoundError";
  constructor(readonly key: string) {
    super("arquivo não encontrado no armazenamento");
  }
}
