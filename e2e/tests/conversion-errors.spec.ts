import { calibreAvailable } from "../fixtures/calibre.js";
import { expect, test } from "../fixtures/devtools.js";
import { corruptMobi, openFreshLibrary, pickFile } from "./conversion-support.js";

// Recusas no cliente e falhas de conversão: mensagem em português, tentar de novo e descartar.

test("PDF e outras extensões são recusados sem chamar a API", async ({ desktop, baseURL }) => {
  const { page } = desktop;
  await openFreshLibrary(desktop, baseURL ?? "");
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/(books|conversions)/.test(request.url())) {
      calls.push(request.url());
    }
  });

  await pickFile(page, "Livro.pdf", "application/pdf", "%PDF-1.4 fake");
  await expect(page.getByRole("alert")).toHaveText(
    "PDF ainda não é suportado; vai chegar numa próxima versão.",
  );

  await pickFile(page, "programa.exe", "application/octet-stream", "MZ");
  await expect(page.getByRole("alert")).toHaveText("Formato não suportado.");

  expect(calls).toEqual([]);
  await expect(page.getByRole("region", { name: "Conversões" })).toHaveCount(0);
  desktop.watcher.assertClean();
});

test("um MOBI corrompido falha com o motivo; tentar de novo falha outra vez; descartar remove o painel", async ({
  desktop,
  baseURL,
}) => {
  test.skip(!calibreAvailable, "Calibre (ebook-convert) não está disponível nesta máquina");
  test.setTimeout(180_000);
  const { page } = desktop;
  await openFreshLibrary(desktop, baseURL ?? "");

  await pickFile(page, "Quebrado.mobi", "application/x-mobipocket-ebook", corruptMobi());
  const panel = page.getByRole("region", { name: "Conversões" });
  const reason = panel.getByText(/^A conversão falhou|O formato deste arquivo/);
  await expect(panel.getByText("Falhou", { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(reason).toBeVisible();

  await panel.getByRole("button", { name: "Tentar de novo Quebrado.mobi" }).click();
  // Volta a andar e falha de novo.
  await expect(panel.getByText("Falhou", { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(reason).toBeVisible();

  await panel.getByRole("button", { name: "Descartar Quebrado.mobi" }).click();
  await expect(panel).toHaveCount(0);
  desktop.watcher.assertClean();
});
