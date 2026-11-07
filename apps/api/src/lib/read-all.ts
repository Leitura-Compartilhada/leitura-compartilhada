import type { Readable } from "node:stream";

/** Lê o fluxo inteiro para a memória, recusando o que passar de `maxBytes`. */
export async function readAllCapped(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) {
      stream.destroy();
      throw new Error(`arquivo maior que o limite de ${maxBytes} bytes`);
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}
