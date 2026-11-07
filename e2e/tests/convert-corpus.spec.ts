import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";
import {
  bookSchema,
  conversionJobSchema,
  listConversionsResponseSchema,
} from "../../packages/shared/src/index.js";
import { signUp, uniqueEmail } from "../fixtures/account.js";
import { calibreAvailable } from "../fixtures/calibre.js";
import { expect, test } from "../fixtures/devtools.js";
import { jumpToFraction, openBookOnAnyPage, visibleText } from "../fixtures/reader.js";

// Roda só na máquina do usuário: pega um livro real de `_local/corpus` (nunca vai ao git), faz o
// Calibre gerar MOBI, AZW3 e FB2 a partir dele numa pasta temporária do teste, envia cada um pelo
// pipeline e confere que volta um livro legível, com capa quando a origem tem. Mede o tempo.

const roots = (process.env.LEITURA_CORPUS_DIRS ?? "_local/corpus")
  .split(path.delimiter === ":" ? /[:;]/ : ";")
  .map((dir) => path.resolve(dir))
  .filter((dir) => existsSync(dir));

function findEpubs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return findEpubs(full);
    return /\.epub$/i.test(name) ? [full] : [];
  });
}

const epubs = roots.flatMap(findEpubs).sort();
// Por padrão o menor livro do acervo: o teste mede o pipeline, não a paciência de quem roda.
// `CONVERT_CORPUS=largest` usa o maior, para medir o tempo no pior caso.
const bySize = [...epubs].sort((a, b) => statSync(a).size - statSync(b).size);
const smallest = process.env.CONVERT_CORPUS === "largest" ? bySize.at(-1) : bySize[0];

async function waitDone(request: APIRequestContext, id: string) {
  let last: ReturnType<typeof conversionJobSchema.parse> | undefined;
  await expect
    .poll(
      async () => {
        const { jobs } = listConversionsResponseSchema.parse(
          await (await request.get("/api/conversions")).json(),
        );
        last = jobs.find((job) => job.id === id);
        return last?.status;
      },
      { timeout: 280_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toMatch(/done|failed/);
  return last as NonNullable<typeof last>;
}

test.describe("acervo real: conversão de ida e volta", () => {
  test.skip(!calibreAvailable || !smallest, "precisa do Calibre e de um EPUB em _local/corpus");

  for (const ext of ["azw3", "mobi", "fb2"]) {
    test(`${path.basename(smallest ?? "")} → ${ext} → EPUB`, async ({
      desktop,
      baseURL,
    }, testInfo) => {
      test.slow();
      const { request } = desktop.context;
      await signUp(request, uniqueEmail("corpus-conv"), baseURL ?? "");

      const generated = testInfo.outputPath(`origem.${ext}`);
      const made = spawnSync(
        process.env.CALIBRE_BIN ?? "ebook-convert",
        [smallest as string, generated],
        { windowsHide: true },
      );
      expect(made.status, String(made.stderr).slice(-300)).toBe(0);
      const buffer = readFileSync(generated);

      const started = Date.now();
      const sent = await request.post("/api/conversions", {
        multipart: {
          file: { name: `Livro Real.${ext}`, mimeType: "application/octet-stream", buffer },
        },
      });
      expect(sent.status(), await sent.text()).toBe(202);
      const job = await waitDone(request, conversionJobSchema.parse(await sent.json()).id);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `[corpus] ${path.basename(smallest as string)} → ${ext}: ${(buffer.length / 1024 / 1024).toFixed(1)} MiB, ${job.status} em ${seconds} s`,
      );
      expect(job.status, `código: ${job.errorCode}`).toBe("done");

      const { books } = (await (await request.get("/api/books")).json()) as { books: unknown[] };
      const book = books.map((b) => bookSchema.parse(b)).find((b) => b.id === job.bookId);
      expect(book?.title.length).toBeGreaterThan(0);
      console.log(
        `[corpus]   título: "${book?.title}", capa: ${book?.hasCover}, autores: ${book?.authors.join(", ")}`,
      );

      await openBookOnAnyPage(desktop.page, job.bookId as string);
      // A primeira página de um livro real costuma ser só a capa: confere o texto no meio do livro.
      await jumpToFraction(desktop.page, 0.4);
      await expect
        .poll(async () => (await visibleText(desktop.page)).length, { timeout: 30_000 })
        .toBeGreaterThan(20);
    });
  }
});
