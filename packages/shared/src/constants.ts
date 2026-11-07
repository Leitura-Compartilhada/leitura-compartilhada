/** Tamanho máximo do trecho de texto guardado junto da posição (em caracteres Unicode). */
export const SNIPPET_LENGTH = 120;

/** Trechos mais curtos que isso são ambíguos demais para servir de busca. */
export const MIN_SNIPPET_LENGTH = 20;

/** Espera depois do último `relocate` antes de enviar o progresso ao servidor. */
export const PROGRESS_DEBOUNCE_MS = 3_000;

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** Limite de itens por requisição de sync, para o corpo não crescer sem controle. */
export const MAX_SYNC_ITEMS = 500;

/** Um CFI real tem algumas dezenas de caracteres; isto só barra lixo. */
export const MAX_CFI_LENGTH = 2048;

/** Identificador do aparelho: ASCII, para a ordenação ser igual no navegador e no Postgres. */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Hash SHA-256 em hexadecimal minúsculo. */
export const FILE_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Quanto o `updatedAt` de um cliente pode estar à frente do relógio do servidor. Acima disso o
 * servidor o rebaixa para a hora dele; sem isso um celular adiantado ganharia todo conflito.
 */
export const MAX_FUTURE_SKEW_MS = 60_000;

/** Medidas de ida e volta acima disso são descartadas ao estimar o desvio do relógio. */
export const MAX_RTT_FOR_OFFSET_MS = 2_000;

/** Limites da edição de um livro e da organização da estante (F2). */
export const MAX_TITLE_LENGTH = 300;
export const MAX_AUTHOR_LENGTH = 200;
export const MAX_AUTHORS = 20;
export const MAX_SERIES_LENGTH = 200;
export const MAX_SERIES_INDEX = 10_000;
export const MAX_TAG_LENGTH = 40;
export const MAX_TAGS_PER_BOOK = 20;
export const MAX_SHELF_NAME_LENGTH = 60;
export const MAX_SHELVES_PER_BOOK = 50;

/** A partir deste progresso um livro "Lendo" vira "Lido" sozinho (só para a frente). */
export const AUTO_READ_THRESHOLD = 0.98;

/** Tempo máximo de uma conversão no Calibre; passado disso o processo é morto e o job falha. */
export const DEFAULT_CONVERT_TIMEOUT_MS = 5 * 60 * 1000;

/** Um job concluído continua na lista de conversões por este tempo, para o usuário ver o resultado. */
export const CONVERSION_DONE_VISIBLE_MS = 5 * 60 * 1000;

/** `CONVERT_TIMEOUT_MS` do ambiente (API e worker leem o mesmo valor), ou o padrão se ausente ou inválido. */
export function convertTimeoutFromEnv(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_CONVERT_TIMEOUT_MS;
}

/** Job "em andamento" há mais que 2× o timeout foi abandonado por uma queda. */
export function conversionStaleMs(timeoutMs: number): number {
  return 2 * timeoutMs;
}

/** Tamanho máximo de um original enviado para conversão (menor que o de um EPUB: o Calibre carrega tudo). */
export const MAX_CONVERT_SOURCE_BYTES = 100 * 1024 * 1024;

/** Conversões que falharam e continuam guardadas por usuário; as mais antigas além disso são apagadas. */
export const MAX_FAILED_CONVERSIONS = 20;

/** Nomes das filas do pg-boss compartilhadas entre API e worker. */
export const QUEUE_CONVERT = "book.convert";
export const QUEUE_INGEST = "book.ingest";

/** Conversões em andamento (na fila ou rodando) que um usuário pode ter ao mesmo tempo. */
export const MAX_ACTIVE_CONVERSIONS = 10;
