import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { makeTextSnippet } from "../../packages/shared/src/index.js";
import { signUp, uniqueEmail, uploadEpub } from "../fixtures/account.js";
import { expect, test } from "../fixtures/devtools.js";
import { jumpToFraction, openBookOnAnyPage, startOf, visibleText } from "../fixtures/reader.js";

/** Abaixo disso o "trecho" seria quase vazio e `toContain` passaria sem provar nada. */
const MIN_TEXT_TO_PROVE_RESTORE = 60;

// Roda só na máquina do usuário: o acervo tem direitos autorais e nunca vai para o git nem para o CI.
// Padrão: _local/corpus. Para outro lugar: LEITURA_CORPUS_DIRS=pasta1;pasta2
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

const files = roots.flatMap(findEpubs).sort();

test.describe("acervo real do usuário", () => {
  test.skip(files.length === 0, "acervo local ausente (_local/corpus)");

  for (const file of files) {
    test(`restaura a posição em ${path.basename(file)}`, async ({ desktop, baseURL }) => {
      test.slow(); // livros de 200+ seções
      // Alguns livros reais disparam avisos do próprio foliate; o que importa aqui é restaurar.
      desktop.watcher.allowConsoleError(/./);
      await signUp(desktop.context.request, uniqueEmail("acervo"), baseURL ?? "");
      const { book } = await uploadEpub(desktop.context.request, file);

      // A primeira página de um livro real costuma ser a capa, sem texto.
      await openBookOnAnyPage(desktop.page, book.id);

      // Vai até o meio do livro e guarda o que o leitor mostra ali. Se cair numa página só de
      // imagem, tenta outro ponto: sem texto o teste não provaria nada.
      let noMeio = "";
      for (const alvo of [0.5, 0.55, 0.45, 0.6, 0.4]) {
        noMeio = await jumpToFraction(desktop.page, alvo);
        if (noMeio.length >= MIN_TEXT_TO_PROVE_RESTORE) break;
      }
      expect(
        noMeio.length,
        "precisa de uma página com texto para provar a restauração",
      ).toBeGreaterThanOrEqual(MIN_TEXT_TO_PROVE_RESTORE);
      const posicao = await desktop.page.evaluate(() => {
        const view = document.querySelector("foliate-view") as unknown as {
          lastLocation: { cfi: string; fraction: number; range: Range };
        };
        return {
          cfi: view.lastLocation.cfi,
          fraction: view.lastLocation.fraction,
          text: view.lastLocation.range.toString(),
        };
      });
      expect(posicao.fraction).toBeGreaterThan(0.2);
      expect(posicao.fraction).toBeLessThan(0.9);

      // O salto programático (reason "navigation") não é gravado pelo app, de propósito. Então a
      // posição é gravada pela API, como se um uso anterior a tivesse salvado, e testamos a restauração.
      const gravado = await desktop.context.request.post("/api/sync", {
        data: {
          deviceId: "teste-acervo",
          since: 0,
          annotations: [],
          readingStates: [
            {
              bookId: book.id,
              status: "reading",
              cfi: posicao.cfi,
              percentage: posicao.fraction,
              textSnippet: makeTextSnippet(posicao.text),
              fileHash: book.fileHash,
              deviceId: "teste-acervo",
              updatedAt: Date.now(),
            },
          ],
        },
      });
      expect(gravado.status()).toBe(200);

      await desktop.page.reload();
      await expect
        .poll(() => visibleText(desktop.page), { message: "deveria voltar ao trecho salvo" })
        .toContain(startOf(noMeio));
    });
  }

  const volume9 = files.filter((f) => /Volume_9( \(1\))?\.epub$/i.test(f));
  test("o mesmo livro enviado duas vezes não duplica", async ({ desktop, baseURL }) => {
    test.skip(volume9.length < 2, "precisa de Volume_9.epub e Volume_9 (1).epub no acervo");
    await signUp(desktop.context.request, uniqueEmail("duplicata"), baseURL ?? "");
    const primeiro = await uploadEpub(desktop.context.request, volume9[0] ?? "");
    const segundo = await uploadEpub(desktop.context.request, volume9[1] ?? "");
    expect(primeiro.status).toBe(201);
    expect(segundo.status).toBe(200);
    expect(segundo.book.id).toBe(primeiro.book.id);
  });
});
