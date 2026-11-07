import { randomUUID } from "node:crypto";
import { conversionJobs, createDb } from "@leitura/db";
import {
  apiErrorSchema,
  bookSchema,
  type ConversionJob,
  conversionJobSchema,
  listBooksResponseSchema,
  listConversionsResponseSchema,
} from "@leitura/shared";
import { createStorage } from "@leitura/storage";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildEpub, buildZip } from "../../../e2e/fixtures/make-epub.mjs";
import { env } from "../src/env.js";
import { createMemoryQueue } from "../src/modules/conversions/queue.js";
import {
  closeTestDb,
  createTestApp,
  multipartBody,
  resetDatabase,
  signUp,
  type TestUser,
} from "./helpers.js";

const { db, pool } = createDb(env.DATABASE_URL);
const storage = createStorage(env);

// Conteúdos mínimos que passam no reconhecimento por bytes de cada formato.
const mobi = () => {
  const head = Buffer.alloc(200);
  head.write("BOOKMOBI", 60, "latin1");
  return head;
};
const docx = () =>
  buildZip([
    { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
    { name: "word/document.xml", data: Buffer.from("<w/>") },
  ]);
const SAMPLES: Record<string, () => Buffer> = {
  "livro.mobi": mobi,
  "livro.azw3": mobi,
  "livro.fb2": () => Buffer.from('<?xml version="1.0"?><FictionBook><body/></FictionBook>'),
  "livro.docx": docx,
  "livro.txt": () => Buffer.from("Um texto simples.\n"),
  "livro.md": () => Buffer.from("# Título\n\nTexto.\n"),
  "livro.html": () => Buffer.from("<html><body><p>oi</p></body></html>"),
};

describe("conversões", () => {
  let app: FastifyInstance;
  let memory: ReturnType<typeof createMemoryQueue>;
  let ana: TestUser;
  let beto: TestUser;

  const post = (user: TestUser | null, filename: string, content: Buffer, target = app) => {
    const { payload, headers } = multipartBody(filename, content);
    return target.inject({
      method: "POST",
      url: "/api/conversions",
      headers: { ...headers, ...(user ? { cookie: user.cookie } : {}) },
      payload,
    });
  };
  const send = async (
    user: TestUser,
    filename: string,
    content: Buffer,
  ): Promise<ConversionJob> => {
    const response = await post(user, filename, content);
    expect(response.statusCode, response.body).toBe(202);
    return conversionJobSchema.parse(response.json());
  };
  const call = (user: TestUser, method: "GET" | "POST" | "DELETE", url: string) =>
    app.inject({ method, url, headers: { cookie: user.cookie } });
  const rowOf = async (id: string) =>
    (await db.select().from(conversionJobs).where(eq(conversionJobs.id, id)))[0];
  const books = async (user: TestUser) =>
    listBooksResponseSchema.parse((await call(user, "GET", "/api/books")).json()).books;

  /** Faz o papel do worker: guarda o EPUB convertido e deixa o job "em andamento com resultado". */
  async function workerFinishes(job: ConversionJob, owner: TestUser, epub: Buffer) {
    const resultKey = `converted/${owner.id}/${job.id}.epub`;
    await storage.put(resultKey, epub);
    await db
      .update(conversionJobs)
      .set({ status: "running", resultKey })
      .where(eq(conversionJobs.id, job.id));
    return resultKey;
  }

  beforeAll(async () => {
    memory = createMemoryQueue();
    app = await createTestApp({ queue: memory.queue });
  });
  beforeEach(async () => {
    await resetDatabase();
    memory.converting.length = 0;
    ana = await signUp(app, "ana@example.com");
    beto = await signUp(app, "beto@example.com");
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
    await closeTestDb();
  });

  it("exige login em todas as rotas", async () => {
    const id = randomUUID();
    const calls = [
      app.inject({ method: "GET", url: "/api/conversions" }),
      post(null, "livro.txt", Buffer.from("oi\n")),
      app.inject({ method: "POST", url: `/api/conversions/${id}/retry` }),
      app.inject({ method: "DELETE", url: `/api/conversions/${id}` }),
    ];
    for (const response of await Promise.all(calls)) expect(response.statusCode).toBe(401);
  });

  describe("enviar", () => {
    it.each(Object.keys(SAMPLES))("aceita %s: guarda o original e enfileira", async (filename) => {
      const job = await send(ana, filename, (SAMPLES[filename] as () => Buffer)());
      expect(job).toMatchObject({ filename, status: "queued", errorCode: null, bookId: null });
      expect(memory.converting).toEqual([job.id]);
      const row = await rowOf(job.id);
      expect(row?.sourceKey).toBe(`sources/${ana.id}/${job.id}.${filename.split(".").pop()}`);
      expect(await storage.exists(row?.sourceKey as string)).toBe(true);
    });

    it("guarda só o nome do arquivo, sem caminho nem caracteres de controle", async () => {
      const nome = String.raw`..\..\pasta/outra`.concat(String.fromCharCode(7), "/Meu Livro.txt");
      const job = await send(ana, nome, Buffer.from("texto\n"));
      expect(job.filename).toBe("Meu Livro.txt");
      const row = await rowOf(job.id);
      expect(row?.sourceKey).toBe(`sources/${ana.id}/${job.id}.txt`); // a chave nunca usa o nome do cliente
    });

    it("recusa PDF, EPUB e extensões desconhecidas com 415", async () => {
      for (const filename of ["livro.pdf", "livro.epub", "programa.exe", "semextensao"]) {
        const response = await post(ana, filename, Buffer.from("conteúdo qualquer\n"));
        expect(response.statusCode, filename).toBe(415);
        expect(apiErrorSchema.parse(response.json()).error.code).toBe("INVALID_FILE");
      }
      expect(memory.converting).toEqual([]);
    });

    it("recusa arquivo que não é do formato que o nome diz", async () => {
      const mentiras: [string, Buffer][] = [
        ["falso.mobi", Buffer.from("só texto, nada de MOBI ".repeat(20))],
        ["falso.fb2", Buffer.from("<html><body>não é fb2</body></html>")],
        ["falso.docx", buildEpub()], // um EPUB com a extensão trocada
        ["falso.txt", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01])],
        ["vazio.txt", Buffer.alloc(0)],
      ];
      for (const [filename, content] of mentiras) {
        const response = await post(ana, filename, content);
        expect(response.statusCode, filename).toBe(415);
      }
      expect(await db.select().from(conversionJobs)).toEqual([]);
    });

    it("recusa arquivo acima do limite, sem job nem original órfão", async () => {
      // fila própria: a fila em memória guarda um só consumidor, e este app é fechado no fim
      const small = await createTestApp({
        queue: createMemoryQueue().queue,
        maxUploadBytes: 4_000,
      });
      try {
        const response = await post(ana, "grande.txt", Buffer.alloc(20_000, 0x61), small);
        expect(response.statusCode).toBe(413);
        expect(apiErrorSchema.parse(response.json()).error.code).toBe("TOO_LARGE");
        expect(await db.select().from(conversionJobs)).toEqual([]);
      } finally {
        await small.close();
      }
    });

    it("limita as conversões ativas de cada usuário, sem afetar o outro", async () => {
      for (let i = 0; i < 10; i++) await send(ana, `livro${i}.txt`, Buffer.from(`texto ${i}\n`));
      const demais = await post(ana, "um-a-mais.txt", Buffer.from("texto\n"));
      expect(demais.statusCode).toBe(400);
      expect(apiErrorSchema.parse(demais.json()).error.code).toBe("VALIDATION");
      expect((await post(beto, "do-beto.txt", Buffer.from("texto\n"))).statusCode).toBe(202);
    });

    it("se a fila estiver fora do ar o job aparece como falho, e dá para tentar de novo", async () => {
      memory.failNextEnqueue();
      const job = await send(ana, "livro.txt", Buffer.from("texto\n"));
      expect(job).toMatchObject({ status: "failed", errorCode: "CONVERSION_FAILED" });
      const retry = await call(ana, "POST", `/api/conversions/${job.id}/retry`);
      expect(retry.statusCode).toBe(202);
      expect(conversionJobSchema.parse(retry.json()).status).toBe("queued");
      expect(memory.converting).toEqual([job.id]);
    });
  });

  describe("listar, tentar de novo e descartar", () => {
    it("lista só os jobs do usuário, do mais novo ao mais antigo, e esconde concluídos antigos", async () => {
      const a = await send(ana, "a.txt", Buffer.from("a\n"));
      const b = await send(ana, "b.txt", Buffer.from("b\n"));
      await send(beto, "c.txt", Buffer.from("c\n"));
      const antigo = await send(ana, "d.txt", Buffer.from("d\n"));
      await db
        .update(conversionJobs)
        .set({ status: "done", finishedAt: new Date(Date.now() - 60 * 60_000) })
        .where(eq(conversionJobs.id, antigo.id));

      const lista = listConversionsResponseSchema.parse(
        (await call(ana, "GET", "/api/conversions")).json(),
      );
      expect(lista.jobs.map((j) => j.id)).toEqual([b.id, a.id]);
    });

    it("tentar de novo só vale para job falho; devolve à fila e enfileira", async () => {
      const job = await send(ana, "livro.txt", Buffer.from("texto\n"));
      expect((await call(ana, "POST", `/api/conversions/${job.id}/retry`)).statusCode).toBe(409);

      await db
        .update(conversionJobs)
        .set({ status: "failed", errorCode: "TIMEOUT", error: "x" })
        .where(eq(conversionJobs.id, job.id));
      memory.converting.length = 0;
      const retry = await call(ana, "POST", `/api/conversions/${job.id}/retry`);
      expect(retry.statusCode).toBe(202);
      expect(conversionJobSchema.parse(retry.json())).toMatchObject({
        status: "queued",
        errorCode: null,
      });
      expect(memory.converting).toEqual([job.id]);
    });

    it("descartar apaga a linha e os arquivos, inclusive de um job em andamento", async () => {
      const job = await send(ana, "livro.txt", Buffer.from("texto\n"));
      const resultKey = await workerFinishes(job, ana, buildEpub());
      const sourceKey = (await rowOf(job.id))?.sourceKey as string;

      expect((await call(ana, "DELETE", `/api/conversions/${job.id}`)).statusCode).toBe(204);
      expect(await rowOf(job.id)).toBeUndefined();
      expect(await storage.exists(sourceKey)).toBe(false);
      expect(await storage.exists(resultKey)).toBe(false);
    });

    it("job de outro usuário e id inexistente dão 404 e nada muda", async () => {
      const doBeto = await send(beto, "livro.txt", Buffer.from("texto\n"));
      for (const id of [doBeto.id, randomUUID()]) {
        for (const [method, url] of [
          ["POST", `/api/conversions/${id}/retry`],
          ["DELETE", `/api/conversions/${id}`],
        ] as const) {
          const response = await call(ana, method, url);
          expect(response.statusCode, `${method} ${id}`).toBe(404);
          expect(apiErrorSchema.parse(response.json()).error.code).toBe("NOT_FOUND");
        }
      }
      expect(await rowOf(doBeto.id)).toBeDefined();
      expect((await call(beto, "GET", "/api/conversions")).json().jobs).toHaveLength(1);
    });
  });

  describe("proteções do envio", () => {
    it("o mesmo original enviado de novo, depois de virar livro, não é convertido outra vez", async () => {
      const conteudo = Buffer.from("Texto igual nas duas vezes.\n");
      const primeiro = await send(ana, "Livro.txt", conteudo);
      await workerFinishes(primeiro, ana, buildEpub({ title: "Único" }));
      await memory.deliverIngest(primeiro.id);
      memory.converting.length = 0;

      const segundo = await send(ana, "Outro Nome.txt", conteudo);
      expect(segundo).toMatchObject({ status: "done", bookId: (await rowOf(primeiro.id))?.bookId });
      expect(memory.converting).toEqual([]); // nada foi para a fila
      expect((await rowOf(segundo.id))?.sourceKey).toBeNull();
      expect(await books(ana)).toHaveLength(1);
    });

    it("se o livro foi excluído, o mesmo original é convertido de novo", async () => {
      const conteudo = Buffer.from("Texto para converter duas vezes.\n");
      const primeiro = await send(ana, "Livro.txt", conteudo);
      await workerFinishes(primeiro, ana, buildEpub({ title: "Apagado" }));
      await memory.deliverIngest(primeiro.id);
      const livro = (await books(ana))[0];
      await call(ana, "DELETE", `/api/books/${livro?.id}`);

      const segundo = await send(ana, "Livro.txt", conteudo);
      expect(segundo.status).toBe("queued");
      expect(memory.converting).toContain(segundo.id);
    });

    it("reenviar o mesmo original depois de fechar o job não duplica o livro", async () => {
      const conteudo = Buffer.from("Texto que será reenviado depois de Fechar.\n");
      const primeiro = await send(ana, "Livro.txt", conteudo);
      await workerFinishes(primeiro, ana, buildEpub({ title: "Sem duplicar" }));
      await memory.deliverIngest(primeiro.id);
      expect((await call(ana, "DELETE", `/api/conversions/${primeiro.id}`)).statusCode).toBe(204);
      memory.converting.length = 0;

      const segundo = await send(ana, "Livro.txt", conteudo);
      expect(segundo.status).toBe("done");
      expect(segundo.bookId).toBe((await books(ana))[0]?.id);
      expect(memory.converting).toEqual([]);
      expect(await books(ana)).toHaveLength(1);
    });

    it("duas conversões do mesmo original que terminam juntas viram um livro só", async () => {
      const conteudo = Buffer.from("Original convertido em dois jobs ao mesmo tempo.\n");
      const a = await send(ana, "A.txt", conteudo);
      const b = await send(ana, "B.txt", conteudo); // o primeiro ainda não é livro: entra na fila
      expect(b.status).toBe("queued");
      await workerFinishes(a, ana, buildEpub({ title: "Primeira" }));
      await workerFinishes(b, ana, buildEpub({ title: "Segunda" })); // EPUB diferente (o Calibre muda a cada vez)
      await memory.deliverIngest(a.id);
      await memory.deliverIngest(b.id);

      expect(await books(ana)).toHaveLength(1);
      expect((await rowOf(b.id))?.bookId).toBe((await rowOf(a.id))?.bookId);
      expect((await rowOf(b.id))?.status).toBe("done");
    });

    it("envios simultâneos não furam o limite de conversões ativas", async () => {
      const respostas = await Promise.all(
        Array.from({ length: 14 }, (_, i) =>
          post(ana, `livro${i}.txt`, Buffer.from(`texto ${i}\n`)),
        ),
      );
      const aceitos = respostas.filter((r) => r.statusCode === 202).length;
      expect(aceitos).toBe(10);
      expect(respostas.filter((r) => r.statusCode === 400)).toHaveLength(4);
      expect(await db.select().from(conversionJobs)).toHaveLength(10); // as recusas não deixam job
    });

    it("recusa DOCX que se expande demais (ZIP bomb) sem deixar job nem original", async () => {
      const bomba = Buffer.from(docx());
      // a central diz que a entrada tem 600 MiB descomprimida; o arquivo real tem poucos bytes
      const central = bomba.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      bomba.writeUInt32LE(600 * 1024 * 1024, central + 24);
      const resposta = await post(ana, "bomba.docx", bomba);
      expect(resposta.statusCode).toBe(415);
      expect(await db.select().from(conversionJobs)).toEqual([]);
    });

    it("guarda só os 20 jobs falhos mais recentes e apaga os arquivos dos mais antigos", async () => {
      const antigos: string[] = [];
      for (let i = 0; i < 21; i++) {
        const id = randomUUID();
        const sourceKey = `sources/${ana.id}/${id}.txt`;
        await storage.put(sourceKey, Buffer.from("x\n"));
        await db.insert(conversionJobs).values({
          id,
          ownerId: ana.id,
          sourceFormat: "txt",
          strategy: "calibre",
          sourceFilename: `antigo${i}.txt`,
          sourceKey,
          status: "failed",
          errorCode: "CONVERSION_FAILED",
          createdAt: new Date(Date.now() - (100 - i) * 60_000),
        });
        antigos.push(sourceKey);
      }
      await send(ana, "novo.txt", Buffer.from("texto novo\n"));

      const falhos = (await db.select().from(conversionJobs)).filter((j) => j.status === "failed");
      expect(falhos).toHaveLength(20);
      expect(await storage.exists(antigos[0] as string)).toBe(false); // o mais antigo saiu
      expect(await storage.exists(antigos[20] as string)).toBe(true);
    });

    it("tira do nome exibido os caracteres que invertem o sentido do texto", async () => {
      const job = await send(ana, "relato\u202Efdp.txt", Buffer.from("texto\n"));
      expect(job.filename).toBe("relatofdp.txt");
    });
  });

  describe("ingestão do EPUB convertido", () => {
    it("vira livro da estante, conclui o job e apaga o original e o resultado", async () => {
      const job = await send(ana, "Meu Livro.txt", Buffer.from("texto\n"));
      const sourceKey = (await rowOf(job.id))?.sourceKey as string;
      const resultKey = await workerFinishes(
        job,
        ana,
        buildEpub({ title: "Título do EPUB", creator: "Fulana" }),
      );

      await memory.deliverIngest(job.id);

      const done = await rowOf(job.id);
      expect(done).toMatchObject({
        status: "done",
        sourceKey: null,
        resultKey: null,
        errorCode: null,
      });
      const [livro] = await books(ana);
      expect(livro).toMatchObject({
        id: done?.bookId,
        title: "Título do EPUB",
        authors: ["Fulana"],
      });
      expect(await storage.exists(sourceKey)).toBe(false);
      expect(await storage.exists(resultKey)).toBe(false);
      expect((await books(beto)).length).toBe(0);
    });

    it("é idempotente: entregar duas vezes não duplica o livro", async () => {
      const job = await send(ana, "Livro.txt", Buffer.from("texto\n"));
      await workerFinishes(job, ana, buildEpub({ title: "Único" }));
      await Promise.all([memory.deliverIngest(job.id), memory.deliverIngest(job.id)]);
      await memory.deliverIngest(job.id);
      expect(await books(ana)).toHaveLength(1);
      expect((await rowOf(job.id))?.status).toBe("done");
    });

    it("EPUB repetido conclui o job apontando para o livro que já existia", async () => {
      const epub = buildEpub({ title: "Repetido" });
      const primeiro = await send(ana, "um.txt", Buffer.from("um\n"));
      await workerFinishes(primeiro, ana, epub);
      await memory.deliverIngest(primeiro.id);
      const segundo = await send(ana, "dois.txt", Buffer.from("dois\n"));
      await workerFinishes(segundo, ana, epub);
      await memory.deliverIngest(segundo.id);

      expect(await books(ana)).toHaveLength(1);
      expect((await rowOf(segundo.id))?.bookId).toBe((await rowOf(primeiro.id))?.bookId);
    });

    it('Markdown sem título sai do Calibre como "index": vira o nome do arquivo', async () => {
      const job = await send(ana, "Minhas Notas.md", Buffer.from("texto\n"));
      await workerFinishes(job, ana, buildEpub({ title: "index" }));
      await memory.deliverIngest(job.id);
      expect((await books(ana))[0]?.title).toBe("Minhas Notas");
    });

    it("troca o título e o autor inventados pelo Calibre e sugere a série pelo nome do arquivo", async () => {
      const job = await send(ana, "Saga Épica Volume 3.txt", Buffer.from("texto\n"));
      await workerFinishes(job, ana, buildEpub({ title: "input", creator: "Unknown" }));
      await memory.deliverIngest(job.id);

      const [livro] = await books(ana);
      expect(bookSchema.parse(livro)).toMatchObject({
        title: "Saga Épica Volume 3",
        authors: [],
        series: "Saga Épica",
        seriesIndex: 3,
      });
    });

    it("EPUB sem texto (o Calibre não entendeu a entrada) vira falha OUTPUT_INVALID e não entra", async () => {
      const job = await send(ana, "livro.fb2", SAMPLES["livro.fb2"]?.() as Buffer);
      const vazio = buildZip([
        { name: "mimetype", data: Buffer.from("application/epub+zip"), store: true },
        {
          name: "index.xhtml",
          data: Buffer.from('<html><body><ul class="calibre1"></ul></body></html>'),
        },
      ]);
      const resultKey = await workerFinishes(job, ana, vazio);
      await memory.deliverIngest(job.id);

      expect(await rowOf(job.id)).toMatchObject({ status: "failed", errorCode: "OUTPUT_INVALID" });
      expect(await books(ana)).toEqual([]);
      expect(await storage.exists(resultKey)).toBe(false);
    });

    it("resultado que não é um ZIP também falha, sem derrubar a fila", async () => {
      const job = await send(ana, "livro.txt", Buffer.from("texto\n"));
      await workerFinishes(job, ana, Buffer.from("isto não é um epub"));
      await memory.deliverIngest(job.id);
      expect(await rowOf(job.id)).toMatchObject({ status: "failed", errorCode: "OUTPUT_INVALID" });
    });

    it("ignora job que não está esperando ingestão (na fila, falho ou inexistente)", async () => {
      const naFila = await send(ana, "livro.txt", Buffer.from("texto\n"));
      await memory.deliverIngest(naFila.id);
      await memory.deliverIngest(randomUUID());
      expect((await rowOf(naFila.id))?.status).toBe("queued");
      expect(await books(ana)).toEqual([]);
    });
  });
});
