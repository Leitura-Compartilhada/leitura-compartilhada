import { AppError } from "../../lib/errors.js";

/**
 * Porta para a fila de conversões. Em produção é o pg-boss (`boss-queue.ts`); nos testes, uma fila
 * em memória. Assim os testes da API não dependem do pg-boss nem do Calibre.
 */
export interface ConversionQueue {
  /** Pede ao worker para converter o job. */
  enqueueConvert(jobId: string): Promise<void>;
  /** Registra quem ingere o EPUB convertido; o worker avisa por aqui quando termina. */
  onIngest(handler: (jobId: string) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}

/** Fila que recusa tudo: padrão quando ninguém configurou uma (rotas de conversão ficam 500). */
export function createUnavailableQueue(): ConversionQueue {
  return {
    async enqueueConvert() {
      throw new AppError("INTERNAL", "a fila de conversões não está configurada");
    },
    async onIngest() {},
    async stop() {},
  };
}

/** Fila em memória para os testes: guarda os pedidos e entrega a ingestão quando o teste mandar. */
export function createMemoryQueue() {
  const converting: string[] = [];
  let ingest: ((jobId: string) => Promise<void>) | null = null;
  let failNext = false;
  return {
    converting,
    /** Faz o próximo `enqueueConvert` falhar, como se o pg-boss estivesse fora do ar. */
    failNextEnqueue() {
      failNext = true;
    },
    async deliverIngest(jobId: string) {
      if (!ingest) throw new Error("ninguém registrou a ingestão");
      await ingest(jobId);
    },
    queue: {
      async enqueueConvert(jobId) {
        if (failNext) {
          failNext = false;
          throw new Error("fila fora do ar");
        }
        converting.push(jobId);
      },
      async onIngest(handler) {
        ingest = handler;
      },
      async stop() {},
    } satisfies ConversionQueue,
  };
}
