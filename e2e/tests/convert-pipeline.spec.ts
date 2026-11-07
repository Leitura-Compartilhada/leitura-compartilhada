import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext, TestInfo } from "@playwright/test";
import {
  type Book,
  bookSchema,
  type ConversionJob,
  conversionJobSchema,
  listConversionsResponseSchema,
} from "../../packages/shared/src/index.js";
import { SYNTHETIC_EPUB, signUp, uniqueEmail } from "../fixtures/account.js";
import { calibreAvailable } from "../fixtures/calibre.js";
import { expect, test } from "../fixtures/devtools.js";
import { openBookOnAnyPage, visibleText } from "../fixtures/reader.js";

// O caminho inteiro, com o worker e o Calibre de verdade: enviar, converter, virar livro, ler.
// Não passa pela tela (isso é dos specs conversion-*): prova que o pipeline entrega um livro legível.

const FB2_NAMESPACE = "http://www.gribuser.ru/xml/fictionbook/2.0"; // com ".com" o Calibre devolve livro vazio
const fb2 = (namespace: string) => `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="${namespace}"><description><title-info><genre>sf</genre>
<author><first-name>Fulana</first-name><last-name>Teste</last-name></author>
<book-title>Livro FB2 do Pipeline</book-title><lang>pt</lang></title-info></description>
<body><section><title><p>Capítulo 1</p></title><p>MARCADOR-PIPELINE-fb2 primeiro parágrafo do capítulo.</p></section></body></FictionBook>`;

async function sendConversion(request: APIRequestContext, name: string, buffer: Buffer) {
  const response = await request.post("/api/conversions", {
    multipart: { file: { name, mimeType: "application/octet-stream", buffer } },
  });
  return response;
}

async function waitForJob(
  request: APIRequestContext,
  id: string,
  status: "done" | "failed" | RegExp,
): Promise<ConversionJob> {
  let last: ConversionJob | undefined;
  await expect
    .poll(
      async () => {
        const body = listConversionsResponseSchema.parse(
          await (await request.get("/api/conversions")).json(),
        );
        last = body.jobs.find((job) => job.id === id);
        return last?.status;
      },
      { timeout: 90_000, intervals: [500, 1_000, 2_000] },
    )
    .toMatch(typeof status === "string" ? new RegExp(`^${status}$`) : status);
  return last as ConversionJob;
}

async function bookOf(request: APIRequestContext, bookId: string): Promise<Book> {
  const { books } = (await (await request.get("/api/books")).json()) as { books: unknown[] };
  const book = books.map((b) => bookSchema.parse(b)).find((b) => b.id === bookId);
  expect(book, "o livro convertido não está na estante").toBeDefined();
  return book as Book;
}

/** Gera MOBI/AZW3/DOCX de verdade a partir do EPUB sintético, com o próprio Calibre. */
function makeWithCalibre(testInfo: TestInfo, ext: string): Buffer {
  const dir = testInfo.outputPath("gerados");
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `origem.${ext}`);
  const result = spawnSync(process.env.CALIBRE_BIN ?? "ebook-convert", [SYNTHETIC_EPUB, target], {
    windowsHide: true,
  });
  expect(result.status, String(result.stderr)).toBe(0);
  return readFileSync(target);
}

test.describe("conversão de formatos (pipeline real)", () => {
  test.skip(!calibreAvailable, "Calibre (ebook-convert) não encontrado nesta máquina");

  const handWritten: [string, string, string][] = [
    [
      "txt",
      "Meu Texto.txt",
      "Título do Texto\n\nMARCADOR-PIPELINE-txt primeiro parágrafo.\n\nOutro parágrafo.\n",
    ],
    [
      "md",
      "Minhas Notas.md",
      "# Notas\n\nMARCADOR-PIPELINE-md com **negrito**.\n\n## Seção\n\nMais texto.\n",
    ],
    [
      "html",
      "Pagina.html",
      "<html><head><title>Página</title></head><body><h1>Cap</h1><p>MARCADOR-PIPELINE-html texto.</p></body></html>",
    ],
    ["fb2", "Livro Fb2.fb2", fb2(FB2_NAMESPACE)],
  ];

  for (const [key, name, content] of handWritten) {
    test(`${key}: vira um livro na estante e abre no leitor com o texto`, async ({
      desktop,
      baseURL,
    }) => {
      const { request } = desktop.context;
      await signUp(request, uniqueEmail("pipeline"), baseURL ?? "");

      const sent = await sendConversion(request, name, Buffer.from(content));
      expect(sent.status(), await sent.text()).toBe(202);
      const job = conversionJobSchema.parse(await sent.json());

      const done = await waitForJob(request, job.id, "done");
      expect(done.bookId).not.toBeNull();
      const book = await bookOf(request, done.bookId as string);
      expect(book.sourceFormat).toBe("epub");
      // sem metadados na origem o título cai para o nome do arquivo, nunca "input" nem "Unknown"
      if (key !== "fb2" && key !== "html") {
        expect(book.title.toLowerCase()).not.toBe("input");
        expect(book.authors).toEqual([]);
      }

      await openBookOnAnyPage(desktop.page, book.id);
      // No FB2 o título da seção ocupa a primeira página; o texto vem na seguinte.
      const expected = key === "fb2" ? "Capítulo 1" : `MARCADOR-PIPELINE-${key}`;
      await expect.poll(() => visibleText(desktop.page), { timeout: 15_000 }).toContain(expected);
    });
  }

  for (const ext of ["mobi", "azw3", "docx"]) {
    test(`${ext} (gerado pelo Calibre) vira livro e abre no leitor`, async ({
      desktop,
      baseURL,
    }, testInfo) => {
      const { request } = desktop.context;
      await signUp(request, uniqueEmail("pipeline"), baseURL ?? "");
      const sent = await sendConversion(request, `Origem.${ext}`, makeWithCalibre(testInfo, ext));
      expect(sent.status(), await sent.text()).toBe(202);
      const job = conversionJobSchema.parse(await sent.json());

      const done = await waitForJob(request, job.id, "done");
      await openBookOnAnyPage(desktop.page, done.bookId as string);
      await expect
        .poll(() => visibleText(desktop.page), { timeout: 15_000 })
        .toMatch(/Cap[ií]tulo|Livro/);
    });
  }

  test("o mesmo arquivo enviado duas vezes conclui na hora, apontando para o mesmo livro", async ({
    desktop,
    baseURL,
  }) => {
    const { request } = desktop.context;
    await signUp(request, uniqueEmail("pipeline"), baseURL ?? "");
    const conteudo = Buffer.from("Texto repetido\n\nMARCADOR-PIPELINE-repetido.\n");
    const um = conversionJobSchema.parse(
      await (await sendConversion(request, "Repetido.txt", conteudo)).json(),
    );
    const primeiro = await waitForJob(request, um.id, "done");

    // O Calibre grava um EPUB diferente a cada conversão; por isso a repetição é reconhecida pelo original.
    const resposta = await sendConversion(request, "Com Outro Nome.txt", conteudo);
    expect(resposta.status()).toBe(202);
    const dois = conversionJobSchema.parse(await resposta.json());
    expect(dois).toMatchObject({ status: "done", bookId: primeiro.bookId });
    const { books } = (await (await request.get("/api/books")).json()) as { books: unknown[] };
    expect(books).toHaveLength(1);
  });

  test("FB2 com namespace errado nunca vira livro vazio (falha, ou converte com texto)", async ({
    desktop,
    baseURL,
  }) => {
    // O Calibre 9.16 devolve sucesso com um EPUB vazio para este arquivo; o do apt (CI) o aceita e
    // converte. O que importa nas duas versões: ou falha com OUTPUT_INVALID, ou o livro tem texto.
    // (O caso do livro vazio, de forma determinística, está em apps/api/test/conversions.test.ts.)
    const { request } = desktop.context;
    await signUp(request, uniqueEmail("pipeline"), baseURL ?? "");
    const wrong = fb2("http://www.gribuser.com/xml/fictionbook/2.0");
    const job = conversionJobSchema.parse(
      await (await sendConversion(request, "Errado.fb2", Buffer.from(wrong))).json(),
    );

    const finished = await waitForJob(request, job.id, /done|failed/);
    const { books } = (await (await request.get("/api/books")).json()) as { books: unknown[] };
    if (finished.status === "failed") {
      expect(finished.errorCode).toBe("OUTPUT_INVALID");
      expect(books).toEqual([]);
    } else {
      await openBookOnAnyPage(desktop.page, finished.bookId as string);
      await expect
        .poll(() => visibleText(desktop.page), { timeout: 15_000 })
        .toMatch(/Cap[ií]tulo|MARCADOR-PIPELINE-fb2/);
    }
  });

  test("MOBI corrompido falha, tentar de novo falha de novo e descartar limpa a lista", async ({
    desktop,
    baseURL,
  }) => {
    const { request } = desktop.context;
    await signUp(request, uniqueEmail("pipeline"), baseURL ?? "");
    const head = Buffer.alloc(200);
    head.write("BOOKMOBI", 60, "latin1"); // passa no reconhecimento, mas não é um MOBI de verdade
    const job = conversionJobSchema.parse(
      await (await sendConversion(request, "Quebrado.mobi", head)).json(),
    );

    expect((await waitForJob(request, job.id, "failed")).errorCode).toBe("CONVERSION_FAILED");

    const retry = await request.post(`/api/conversions/${job.id}/retry`);
    expect(retry.status()).toBe(202);
    expect((await waitForJob(request, job.id, "failed")).errorCode).toBe("CONVERSION_FAILED");

    expect((await request.delete(`/api/conversions/${job.id}`)).status()).toBe(204);
    const { jobs } = listConversionsResponseSchema.parse(
      await (await request.get("/api/conversions")).json(),
    );
    expect(jobs).toEqual([]);
  });

  test("PDF e arquivo que só finge ser de outro formato são recusados na hora", async ({
    desktop,
    baseURL,
  }) => {
    const { request } = desktop.context;
    desktop.watcher.expectStatus(415); // a recusa é justamente o que o teste espera
    await signUp(request, uniqueEmail("pipeline"), baseURL ?? "");
    for (const [name, content] of [
      ["Documento.pdf", Buffer.from("%PDF-1.7\n conteúdo")],
      ["Falso.mobi", Buffer.from("isto é só texto ".repeat(30))],
      ["Falso.docx", readFileSync(SYNTHETIC_EPUB)],
    ] as const) {
      const response = await sendConversion(request, name, content);
      expect(response.status(), name).toBe(415);
    }
  });
});
