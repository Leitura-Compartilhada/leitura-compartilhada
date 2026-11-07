import type { Hash } from "node:crypto";
import { AppError } from "../../lib/errors.js";

/** Todo ZIP (e portanto todo EPUB) começa com estes quatro bytes. */
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export type UploadStats = { hash: Hash; size: number };

/**
 * Repassa o arquivo enviado ao storage enquanto calcula tamanho e SHA-256, e recusa o que não
 * começa como ZIP. Um erro aqui derruba o stream e o driver apaga o temporário.
 *
 * `truncated` é o jeito de o @fastify/multipart avisar que o arquivo passou do limite: no modo
 * stream ele não interrompe a leitura, apenas corta no limite e termina "normalmente". Sem esta
 * checagem, um arquivo grande demais seria guardado cortado, como um EPUB corrompido.
 */
export async function* inspectUpload(
  source: AsyncIterable<Buffer> & { truncated?: boolean },
  stats: UploadStats,
): AsyncGenerator<Buffer> {
  const emit = (chunk: Buffer): Buffer => {
    stats.hash.update(chunk);
    stats.size += chunk.length;
    return chunk;
  };

  let pending: Buffer[] = [];
  let pendingLength = 0;
  let verified = false;
  for await (const chunk of source) {
    if (verified) {
      yield emit(chunk);
      continue;
    }
    pending.push(chunk);
    pendingLength += chunk.length;
    if (pendingLength < ZIP_SIGNATURE.length) continue;
    const head = Buffer.concat(pending);
    if (!head.subarray(0, ZIP_SIGNATURE.length).equals(ZIP_SIGNATURE)) {
      throw new AppError("INVALID_FILE", "o arquivo não é um EPUB válido");
    }
    verified = true;
    pending = [];
    yield emit(head);
  }
  if (source.truncated) throw new AppError("TOO_LARGE", "o arquivo passa do tamanho máximo");
  if (!verified) throw new AppError("INVALID_FILE", "o arquivo está vazio ou truncado");
}
