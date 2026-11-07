import type { ConvertibleFormat } from "@leitura/shared";
import { AppError } from "../../lib/errors.js";
import { matchesFormat, SNIFF_BYTES } from "../../lib/formats.js";

/**
 * Repassa o arquivo enviado ao storage depois de conferir, pelos primeiros bytes, que ele é mesmo
 * do formato que o nome diz. Recusa o que não bate, o vazio e o que passou do limite (o
 * `@fastify/multipart` em modo stream corta no limite e termina "normalmente", ver `inspectUpload`).
 */
export async function* inspectSource(
  source: AsyncIterable<Buffer> & { truncated?: boolean },
  format: ConvertibleFormat,
): AsyncGenerator<Buffer> {
  let pending: Buffer[] = [];
  let pendingLength = 0;
  let verified = false;
  for await (const chunk of source) {
    if (verified) {
      yield chunk;
      continue;
    }
    pending.push(chunk);
    pendingLength += chunk.length;
    if (pendingLength < SNIFF_BYTES) continue;
    const head = Buffer.concat(pending);
    if (!matchesFormat(head, format)) throw notThisFormat(format);
    verified = true;
    pending = [];
    yield head;
  }
  if (source.truncated) throw new AppError("TOO_LARGE", "o arquivo passa do tamanho máximo");
  if (!verified) {
    const head = Buffer.concat(pending);
    if (!matchesFormat(head, format)) throw notThisFormat(format);
    yield head; // arquivo menor que o trecho de reconhecimento
  }
}

function notThisFormat(format: ConvertibleFormat): AppError {
  return new AppError("INVALID_FILE", `o arquivo não parece ser um ${format.toUpperCase()} válido`);
}
