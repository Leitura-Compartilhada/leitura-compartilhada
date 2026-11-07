import {
  DEVICE_ID_PATTERN,
  estimateClockOffset,
  MAX_SYNC_ITEMS,
  nextUpdatedAt,
  PROGRESS_DEBOUNCE_MS,
  pickLatest,
  type ReadingPosition,
  type ReadingState,
  type ReadingStatus,
  readingStateSchema,
  type SyncRequest,
  type SyncResponse,
} from "@leitura/shared";
import { postSync } from "./api";
import { type LocalDb, localDb, type MetaKey, readLocalState } from "./db";

const DEVICE_ID_STORAGE_KEY = "leitura.deviceId";
/** Com a outbox cheia e sem eventos, tenta de novo neste intervalo. */
export const OUTBOX_RETRY_INTERVAL_MS = 30_000;
/**
 * O navegador limita o corpo de uma requisição `keepalive` a 64 KiB (o envio de `pagehide`). Um
 * estado ocupa algumas centenas de bytes, então um lote pequeno cabe com folga; o que sobrar
 * continua na outbox e sai no próximo envio.
 */
export const KEEPALIVE_MAX_ITEMS = 25;

let memoryDeviceId: string | null = null;

/**
 * Identificador deste aparelho, estável entre sessões. Se o `localStorage` não estiver disponível
 * (modo privado), vale um id por sessão: o desempate do last-write-wins continua correto.
 */
export function getDeviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (stored && DEVICE_ID_PATTERN.test(stored)) return stored;
    const created = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
    return created;
  } catch {
    memoryDeviceId ??= crypto.randomUUID();
    return memoryDeviceId;
  }
}

export type SyncDeps = {
  db: LocalDb;
  post: (request: SyncRequest, keepalive: boolean) => Promise<SyncResponse>;
  /** Relógio local, sem correção. Injetável para os testes. */
  now: () => number;
  deviceId: string;
};

export type FlushOptions = {
  /** Envia mesmo com a outbox vazia, só para buscar o que mudou nos outros aparelhos. */
  pull?: boolean;
  /** Para `pagehide`: deixa a requisição terminar com a página sendo fechada. */
  keepalive?: boolean;
};

export type FlushResult = { sent: number; received: number };

export type ProgressInput = ReadingPosition & { status: ReadingStatus };

const READING = "reading" as const;

export class SyncEngine {
  readonly #deps: SyncDeps;
  /** Última execução em andamento ou concluída; a próxima só começa depois dela. */
  #current: Promise<unknown> = Promise.resolve();
  /** Execução já agendada e ainda não iniciada: chamadas novas se juntam a ela. */
  #queued: Promise<FlushResult> | null = null;
  #queuedPull = false;
  #queuedKeepalive = false;

  constructor(deps: SyncDeps) {
    this.#deps = deps;
  }

  async #meta(key: MetaKey): Promise<number> {
    return (await this.#deps.db.meta.get(key))?.value ?? 0;
  }

  /**
   * Grava o progresso localmente e o põe na outbox (no máximo um item por livro: o último vence).
   * O `updatedAt` nunca regride, mesmo que o relógio volte.
   */
  recordProgress(bookId: string, input: ProgressInput): Promise<ReadingState> {
    const { db, now, deviceId } = this.#deps;
    return db.transaction("rw", db.readingStates, db.outbox, db.meta, async () => {
      const [offset, lastStamp] = await Promise.all([
        this.#meta("clockOffset"),
        this.#meta("lastStamp"),
      ]);
      // Quem lê depois de ver um estado deste livro (o local, ou o que veio de outro aparelho)
      // tem de superá-lo, mesmo que a estimativa do relógio esteja errada por alguns segundos.
      const seen = await db.readingStates.get(bookId);
      const updatedAt = Math.max(
        nextUpdatedAt(now(), offset, lastStamp),
        (seen?.updatedAt ?? 0) + 1,
      );
      const state = readingStateSchema.parse({ ...input, bookId, deviceId, updatedAt });
      await db.readingStates.put(state);
      const existing = await db.outbox.where("[kind+payloadId]").equals([READING, bookId]).first();
      await db.outbox.put({ id: existing?.id, kind: READING, payloadId: bookId });
      await db.meta.put({ key: "lastStamp", value: updatedAt });
      return state;
    });
  }

  /**
   * Guarda no Dexie um estado vindo do servidor (fora do sync), se for mais novo que o local.
   * Não entra na outbox: o servidor já o tem. Devolve o que ficou valendo.
   */
  adoptRemoteState(remote: ReadingState): Promise<ReadingState> {
    const { db } = this.#deps;
    return db.transaction("rw", db.readingStates, async () => {
      const local = await readLocalState(db, remote.bookId);
      if (local && pickLatest(local, remote) === local) return local;
      await db.readingStates.put(remote);
      return remote;
    });
  }

  pendingCount(): Promise<number> {
    return this.#deps.db.outbox.where("kind").equals(READING).count();
  }

  /** Serializa: nunca há dois envios ao mesmo tempo, e pedidos repetidos viram um só. */
  flush(options: FlushOptions = {}): Promise<FlushResult> {
    this.#queuedPull ||= options.pull === true;
    this.#queuedKeepalive ||= options.keepalive === true;
    if (this.#queued) return this.#queued;

    const run = this.#current
      .catch(() => undefined)
      .then(() => {
        const pull = this.#queuedPull;
        const keepalive = this.#queuedKeepalive;
        this.#queued = null;
        this.#queuedPull = false;
        this.#queuedKeepalive = false;
        return this.#flushOnce(pull, keepalive);
      });
    this.#queued = run;
    this.#current = run;
    return run;
  }

  async #flushOnce(pull: boolean, keepalive: boolean): Promise<FlushResult> {
    const { db, post, now, deviceId } = this.#deps;

    const sent = await this.#collectOutbox(keepalive ? KEEPALIVE_MAX_ITEMS : MAX_SYNC_ITEMS);
    if (sent.length === 0 && !pull) return { sent: 0, received: 0 };

    const request: SyncRequest = {
      deviceId,
      since: await this.#meta("cursor"),
      readingStates: sent,
      annotations: [],
    };
    const sentAt = now();
    const response = await post(request, keepalive);
    const receivedAt = now();

    await db.transaction("rw", db.readingStates, db.outbox, db.meta, async () => {
      const offset = estimateClockOffset(sentAt, receivedAt, response.serverTime);
      if (offset !== null) await db.meta.put({ key: "clockOffset", value: offset });

      // Primeiro a outbox, com o estado local como estava: tirar só o que foi enviado sem
      // mudança nova no meio do caminho. Depois aplicar o que veio do servidor.
      for (const item of sent) {
        const local = await db.readingStates.get(item.bookId);
        if (local && local.updatedAt !== item.updatedAt) continue;
        await db.outbox.where("[kind+payloadId]").equals([READING, item.bookId]).delete();
      }
      for (const rejection of response.rejected) {
        await db.outbox.where("[kind+payloadId]").equals([READING, rejection.bookId]).delete();
      }

      for (const remote of response.readingStates) {
        const local = await db.readingStates.get(remote.bookId);
        if (!local || pickLatest(local, remote) === remote) await db.readingStates.put(remote);
      }
      await db.meta.put({ key: "cursor", value: response.cursor });
    });

    return { sent: sent.length, received: response.readingStates.length };
  }

  /** Estados a enviar. Item da outbox sem estado válido não tem o que enviar e é descartado. */
  async #collectOutbox(limit: number): Promise<ReadingState[]> {
    const { db } = this.#deps;
    const items = await db.outbox.where("kind").equals(READING).limit(limit).toArray();
    const states: ReadingState[] = [];
    for (const item of items) {
      const row = await db.readingStates.get(item.payloadId);
      const parsed = readingStateSchema.safeParse(row);
      if (parsed.success) {
        states.push(parsed.data);
      } else {
        console.warn("item da outbox sem estado válido, descartado", item.payloadId);
        if (item.id !== undefined) await db.outbox.delete(item.id);
      }
    }
    return states;
  }
}

export function createSyncEngine(overrides: Partial<SyncDeps> = {}): SyncEngine {
  return new SyncEngine({
    db: localDb,
    post: postSync,
    now: () => Date.now(),
    deviceId: getDeviceId(),
    ...overrides,
  });
}

export const syncEngine = createSyncEngine();

function logFailure(error: unknown): void {
  // A outbox guarda tudo; a falha só atrasa o envio.
  console.warn("sync adiado", error);
}

/** Envia sem deixar a rejeição escapar (para gatilhos que ninguém aguarda). */
export function flushQuietly(options: FlushOptions = {}): void {
  syncEngine.flush(options).catch(logFailure);
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

/** Depois de salvar o progresso: espera o usuário parar de virar páginas antes de enviar. */
export function scheduleProgressFlush(): void {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => flushQuietly(), PROGRESS_DEBOUNCE_MS);
}

/** Cancela o envio com atraso e o executa já (ao sair do leitor). */
export function flushNow(options: FlushOptions = {}): void {
  clearTimeout(debounceTimer);
  flushQuietly(options);
}

/**
 * Liga os gatilhos de sync: ao abrir, ao voltar a rede, ao esconder/fechar a página e, com a
 * outbox cheia, a cada 30 s. Devolve a função que desliga tudo.
 */
export function startSyncTriggers(): () => void {
  const onHidden = () => {
    if (document.visibilityState === "hidden") flushNow({ keepalive: true });
  };
  const onPageHide = () => flushNow({ keepalive: true });
  const onOnline = () => flushQuietly({ pull: true });

  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("online", onOnline);
  const interval = setInterval(() => {
    syncEngine
      .pendingCount()
      .then((pending) => {
        if (pending > 0) flushQuietly();
      })
      .catch(logFailure);
  }, OUTBOX_RETRY_INTERVAL_MS);
  flushQuietly({ pull: true });

  return () => {
    document.removeEventListener("visibilitychange", onHidden);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("online", onOnline);
    clearInterval(interval);
    clearTimeout(debounceTimer);
  };
}
