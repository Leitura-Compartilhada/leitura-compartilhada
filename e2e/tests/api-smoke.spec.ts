import { expect, test } from "@playwright/test";
import { type ReadingState, syncResponseSchema } from "../../packages/shared/src/index.js";
import { SYNTHETIC_EPUB, signIn, signUp, uniqueEmail, uploadEpub } from "../fixtures/account.js";

// Fumaça do servidor real (HTTP de verdade, cookie de verdade, web buildado). Sem navegador de tela:
// confirma que a infraestrutura do E2E funciona e que dois aparelhos convergem pela API.
test.describe("API real", () => {
  test("serve o web buildado e a configuração pública", async ({ request, baseURL }) => {
    const page = await request.get("/");
    expect(page.status()).toBe(200);
    expect(await page.text()).toContain('<div id="root">');

    const config = await request.get("/api/config");
    expect(await config.json()).toEqual({ allowSignup: true });
    expect(baseURL).toMatch(/^http:\/\/localhost:\d+$/);
  });

  test("dois aparelhos da mesma conta convergem pela API", async ({ playwright, baseURL }) => {
    const origin = baseURL ?? "";
    const email = uniqueEmail();
    const pc = await playwright.request.newContext({ baseURL });
    const celular = await playwright.request.newContext({ baseURL });
    try {
      await signUp(pc, email, origin);
      const { book, status } = await uploadEpub(pc, SYNTHETIC_EPUB);
      expect(status).toBe(201);

      // O PC lê e sincroniza.
      const estado: ReadingState = {
        bookId: book.id,
        status: "reading",
        cfi: "epubcfi(/6/4!/4/2/1:0)",
        percentage: 0.4,
        textSnippet: "Capítulo 2, parágrafo 17: marcador-c2-p17",
        fileHash: book.fileHash,
        deviceId: "pc",
        updatedAt: Date.now(),
      };
      const enviado = await pc.post("/api/sync", {
        data: { deviceId: "pc", since: 0, readingStates: [estado], annotations: [] },
      });
      expect(enviado.status()).toBe(200);

      // O celular entra com a mesma conta e vê o livro e a posição.
      await signIn(celular, email, origin);
      const lista = await celular.get("/api/books");
      expect((await lista.json()).books).toHaveLength(1);

      const recebido = syncResponseSchema.parse(
        await (
          await celular.post("/api/sync", {
            data: { deviceId: "celular", since: 0, readingStates: [], annotations: [] },
          })
        ).json(),
      );
      expect(recebido.readingStates).toHaveLength(1);
      expect(recebido.readingStates[0]).toMatchObject({ cfi: estado.cfi, deviceId: "pc" });

      // O mesmo arquivo enviado de novo não duplica.
      const denovo = await uploadEpub(celular, SYNTHETIC_EPUB);
      expect(denovo.status).toBe(200);
      expect(denovo.book.id).toBe(book.id);
    } finally {
      await pc.dispose();
      await celular.dispose();
    }
  });

  test("sem login, as rotas protegidas respondem 401", async ({ request }) => {
    for (const url of ["/api/books", "/api/progress/0b6f0e4e-3f0e-4b7a-9d38-6a2f6f1d2c11"]) {
      const response = await request.get(url);
      expect(response.status(), url).toBe(401);
    }
    const sync = await request.post("/api/sync", {
      data: { deviceId: "x", since: 0, readingStates: [], annotations: [] },
    });
    expect(sync.status()).toBe(401);
  });
});
