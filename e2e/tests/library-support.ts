import { writeFileSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import { type Book, bookSchema, type UpdateBookRequest } from "../../packages/shared/src/index.js";
import { signUp, uniqueEmail, uploadEpub } from "../fixtures/account.js";
import type { Device } from "../fixtures/devtools.js";
import { expect } from "../fixtures/devtools.js";
import { buildEpub } from "../fixtures/make-epub.mjs";

// Apoio dos specs da estante (F2): cria a conta, envia livros sintéticos e ajusta seus dados pela API.

export type SeedBook = { title: string; patch?: UpdateBookRequest };

/** Cria a conta no aparelho e envia os livros (um EPUB por título), já com os dados ajustados. */
export async function seedLibrary(
  device: Device,
  baseURL: string,
  testInfo: TestInfo,
  seeds: SeedBook[],
): Promise<Book[]> {
  const { request } = device.context;
  await signUp(request, uniqueEmail("estante"), baseURL);
  const books: Book[] = [];
  for (const [index, seed] of seeds.entries()) {
    const file = testInfo.outputPath(`livro-${index}.epub`);
    writeFileSync(file, buildEpub({ title: seed.title, paragraphs: 3, chapters: 1 }));
    const { book } = await uploadEpub(request, file);
    if (!seed.patch) {
      books.push(book);
      continue;
    }
    const response = await request.patch(`/api/books/${book.id}`, { data: seed.patch });
    expect(response.status(), await response.text()).toBe(200);
    books.push(bookSchema.parse(await response.json()));
  }
  return books;
}

export async function fetchBooks(device: Device): Promise<Book[]> {
  const response = await device.context.request.get("/api/books");
  expect(response.status()).toBe(200);
  return ((await response.json()) as { books: unknown[] }).books.map((b) => bookSchema.parse(b));
}

/** O card da estante com este título (a lista de livros é a única com `listitem` de card). */
export function card(page: Page, title: string) {
  return page.getByRole("listitem").filter({ hasText: title }).first();
}

/** Abre o menu do card e escolhe um item. */
export async function openBookMenu(page: Page, title: string, itemName: string | RegExp) {
  await page.getByRole("button", { name: `Ações de ${title}` }).click();
  await page.getByRole("menuitem", { name: itemName }).click();
}
