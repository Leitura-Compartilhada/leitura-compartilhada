import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { conversionJobs, createDb, failStaleConversionJobs, user } from "@leitura/db";
import { LocalStorageDriver } from "@leitura/storage";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runCalibre } from "../src/calibre.js";
import { type ConvertDeps, convertJob } from "../src/jobs/convert.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-calibre.mjs", import.meta.url));
const { db, pool } = createDb(process.env.TEST_DATABASE_URL as string);

describe("convertJob", () => {
  let root: string;
  let storage: LocalStorageDriver;
  let tmpRoot: string;
  let ingested: string[];
  let calibreCalls: number;

  const deps = (overrides: Partial<ConvertDeps> = {}): ConvertDeps => ({
    db,
    storage,
    calibre: async (options) => {
      calibreCalls++;
      await runCalibre(options);
    },
    calibreBin: process.execPath,
    binArgs: [FAKE],
    timeoutMs: 15_000,
    enqueueIngest: async (jobId) => {
      ingested.push(jobId);
    },
    tmpRoot,
    log: { info() {}, warn() {}, error() {} },
    ...overrides,
  });

  /** Cria um job `queued` com o original no storage. `content` decide o que o Calibre falso faz. */
  async function newJob(content: string | null, filename = "livro.txt") {
    const id = randomUUID();
    const sourceKey = content === null ? null : `sources/u1/${id}.txt`;
    if (sourceKey) await storage.put(sourceKey, Buffer.from(content ?? ""));
    await db.insert(conversionJobs).values({
      id,
      ownerId: "u1",
      sourceFormat: "txt",
      strategy: "calibre",
      sourceFilename: filename,
      sourceKey,
    });
    return id;
  }
  const jobRow = async (id: string) =>
    (await db.select().from(conversionJobs).where(eq(conversionJobs.id, id)))[0];

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "leitura-worker-test-"));
    storage = new LocalStorageDriver(path.join(root, "storage"));
    tmpRoot = path.join(root, "tmp");
    await db.execute(sql`truncate table "user" restart identity cascade`);
  });
  afterAll(async () => {
    await pool.end();
    await rm(root, { recursive: true, force: true });
  });
  beforeEach(async () => {
    ingested = [];
    calibreCalls = 0;
    await db.execute(sql`truncate table "user" restart identity cascade`);
    await db
      .insert(user)
      .values({ id: "u1", name: "A", email: "a@example.com", emailVerified: false });
    await rm(tmpRoot, { recursive: true, force: true });
    await import("node:fs/promises").then((fs) => fs.mkdir(tmpRoot, { recursive: true }));
  });

  it("converte, guarda o EPUB, avisa a ingestão e limpa a pasta temporária", async () => {
    const id = await newJob("OK");
    await convertJob(deps(), { jobId: id });

    const job = await jobRow(id);
    expect(job).toMatchObject({
      status: "running",
      resultKey: `converted/u1/${id}-1.epub`,
      errorCode: null,
    });
    expect(await storage.exists(`converted/u1/${id}-1.epub`)).toBe(true);
    expect(await storage.exists(`sources/u1/${id}.txt`)).toBe(true); // o original só sai depois da ingestão
    expect(ingested).toEqual([id]);
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it.each([
    ["FAIL", "CONVERSION_FAILED"],
    ["DRM", "DRM"],
    ["EMPTY", "OUTPUT_INVALID"],
    ["NOZIP", "OUTPUT_INVALID"],
  ])(
    "modo %s vira falha %s, sem EPUB nem ingestão, e o original fica para tentar de novo",
    async (mode, code) => {
      const id = await newJob(mode);
      await convertJob(deps(), { jobId: id });

      const job = await jobRow(id);
      expect(job).toMatchObject({ status: "failed", errorCode: code });
      expect(job?.finishedAt).not.toBeNull();
      expect(await storage.exists(`converted/u1/${id}-1.epub`)).toBe(false);
      expect(await storage.exists(`sources/u1/${id}.txt`)).toBe(true);
      expect(ingested).toEqual([]);
      expect(await readdir(tmpRoot)).toEqual([]);
    },
  );

  it("estoura o tempo: TIMEOUT e nada sobra na pasta temporária", async () => {
    const id = await newJob("HANG");
    await convertJob(deps({ timeoutMs: 1_500 }), { jobId: id });
    expect(await jobRow(id)).toMatchObject({ status: "failed", errorCode: "TIMEOUT" });
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it("job sem original ou com extensão desconhecida falha como UNSUPPORTED", async () => {
    const semOriginal = await newJob(null);
    const estranho = await newJob("OK", "livro.exe");
    await convertJob(deps(), { jobId: semOriginal });
    await convertJob(deps(), { jobId: estranho });
    expect(await jobRow(semOriginal)).toMatchObject({ status: "failed", errorCode: "UNSUPPORTED" });
    expect(await jobRow(estranho)).toMatchObject({ status: "failed", errorCode: "UNSUPPORTED" });
    expect(calibreCalls).toBe(0);
  });

  it("não converte duas vezes quando a fila entrega o mesmo job duas vezes ao mesmo tempo", async () => {
    const id = await newJob("OK");
    await Promise.all([convertJob(deps(), { jobId: id }), convertJob(deps(), { jobId: id })]);
    expect(calibreCalls).toBe(1);
    expect(ingested).toEqual([id]);
  });

  it("ignora job que não está na fila e dados inválidos", async () => {
    const id = await newJob("OK");
    await db.update(conversionJobs).set({ status: "failed" }).where(eq(conversionJobs.id, id));
    await convertJob(deps(), { jobId: id });
    await convertJob(deps(), {});
    await convertJob(deps(), null);
    await convertJob(deps(), { jobId: "não-é-uuid" });
    await convertJob(deps(), { jobId: randomUUID() });
    expect(calibreCalls).toBe(0);
    expect((await jobRow(id))?.status).toBe("failed");
  });

  it("job descartado durante a conversão não é ressuscitado e o EPUB não fica órfão", async () => {
    const id = await newJob("OK");
    await convertJob(
      deps({
        calibre: async (options) => {
          await runCalibre(options);
          await db.delete(conversionJobs).where(eq(conversionJobs.id, id)); // o usuário descartou
        },
      }),
      { jobId: id },
    );
    expect(await jobRow(id)).toBeUndefined();
    expect(await storage.exists(`converted/u1/${id}-1.epub`)).toBe(false);
    expect(ingested).toEqual([]);
  });

  it("tentar de novo é uma execução nova, com resultado em outro arquivo", async () => {
    const id = await newJob("FAIL");
    await convertJob(deps(), { jobId: id });
    expect(await jobRow(id)).toMatchObject({ status: "failed", attempt: 1 });

    await storage.put(`sources/u1/${id}.txt`, Buffer.from("OK")); // o usuário corrigiu o problema
    await db
      .update(conversionJobs)
      .set({ status: "queued", errorCode: null })
      .where(eq(conversionJobs.id, id));
    await convertJob(deps(), { jobId: id });
    expect(await jobRow(id)).toMatchObject({ attempt: 2, resultKey: `converted/u1/${id}-2.epub` });
  });

  it("uma execução antiga, já substituída por outra, não grava resultado nem falha por cima", async () => {
    const id = await newJob("OK");
    await convertJob(
      deps({
        calibre: async (options) => {
          await runCalibre(options);
          // enquanto esta execução termina, o usuário reiniciou o job e outra a substituiu
          await db.update(conversionJobs).set({ attempt: 2 }).where(eq(conversionJobs.id, id));
        },
      }),
      { jobId: id },
    );
    expect(await jobRow(id)).toMatchObject({ status: "running", attempt: 2, resultKey: null });
    expect(await storage.exists(`converted/u1/${id}-1.epub`)).toBe(false); // sem arquivo órfão
    expect(ingested).toEqual([]);

    // a falha da execução antiga também não marca a nova como falha
    const id2 = await newJob("OK");
    await convertJob(
      deps({
        calibre: async () => {
          await db.update(conversionJobs).set({ attempt: 2 }).where(eq(conversionJobs.id, id2));
          throw new Error("falha da execução antiga");
        },
      }),
      { jobId: id2 },
    );
    expect(await jobRow(id2)).toMatchObject({ status: "running", attempt: 2, errorCode: null });
  });

  it("varre também o job que ficou na fila sem original (a API caiu no meio do envio)", async () => {
    const id = await newJob(null);
    await db
      .update(conversionJobs)
      .set({ updatedAt: new Date(Date.now() - 20 * 60_000) })
      .where(eq(conversionJobs.id, id));
    expect(await failStaleConversionJobs(db, 10 * 60_000)).toBe(1);
    expect(await jobRow(id)).toMatchObject({ status: "failed", errorCode: "TIMEOUT" });
  });

  it("varre jobs 'em andamento' abandonados, mas não os da fila nem os recentes", async () => {
    const velho = await newJob("OK");
    const recente = await newJob("OK");
    const naFila = await newJob("OK");
    const now = Date.now();
    await db
      .update(conversionJobs)
      .set({ status: "running", updatedAt: new Date(now - 20 * 60_000) })
      .where(eq(conversionJobs.id, velho));
    await db
      .update(conversionJobs)
      .set({ status: "running", updatedAt: new Date(now - 60_000) })
      .where(eq(conversionJobs.id, recente));
    await db
      .update(conversionJobs)
      .set({ updatedAt: new Date(now - 20 * 60_000) })
      .where(eq(conversionJobs.id, naFila));

    expect(await failStaleConversionJobs(db, 10 * 60_000, now)).toBe(1);
    expect(await jobRow(velho)).toMatchObject({ status: "failed", errorCode: "TIMEOUT" });
    expect((await jobRow(recente))?.status).toBe("running");
    expect((await jobRow(naFila))?.status).toBe("queued");
  });
});
