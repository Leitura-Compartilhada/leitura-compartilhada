import { createHash } from "node:crypto";
import { books, createDb } from "@leitura/db";
import { bookSchema } from "@leitura/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildEpub } from "../../../e2e/fixtures/make-epub.mjs";
import { env } from "../src/env.js";
import {
  closeTestDb,
  createTestApp,
  multipartBody,
  resetDatabase,
  signUp,
  type TestUser,
} from "./helpers.js";

const { db, pool } = createDb(env.DATABASE_URL);
const sha = (buffer: Buffer | string) => createHash("sha256").update(buffer).digest("hex");

describe("POST /api/books/known-hashes", () => {
  let app: FastifyInstance;
  let ana: TestUser;
  let beto: TestUser;

  const known = (user: TestUser | null, hashes: unknown) =>
    app.inject({
      method: "POST",
      url: "/api/books/known-hashes",
      headers: user ? { cookie: user.cookie } : {},
      payload: { hashes },
    });
  const upload = async (user: TestUser, title: string) => {
    const { payload, headers } = multipartBody(`${title}.epub`, buildEpub({ title }));
    const response = await app.inject({
      method: "POST",
      url: "/api/books",
      headers: { ...headers, cookie: user.cookie },
      payload,
    });
    expect(response.statusCode, response.body).toBe(201);
    return bookSchema.parse(response.json());
  };

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase();
    ana = await signUp(app, "ana@example.com");
    beto = await signUp(app, "beto@example.com");
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
    await closeTestDb();
  });

  it("exige login", async () => {
    expect((await known(null, [])).statusCode).toBe(401);
  });

  it("reconhece o hash do EPUB e o do original convertido, e ignora o que não tem", async () => {
    const livro = await upload(ana, "Conhecido");
    const original = sha("original que foi convertido");
    await db.update(books).set({ sourceHash: original }).where(eq(books.id, livro.id));

    const response = await known(ana, [livro.fileHash, original, sha("nunca enviado")]);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().known.sort()).toEqual([livro.fileHash, original].sort());
  });

  it("não revela o que é de outra pessoa", async () => {
    const livro = await upload(ana, "Só da Ana");
    expect((await known(beto, [livro.fileHash])).json()).toEqual({ known: [] });
  });

  it("recusa hash malformado e lista grande demais", async () => {
    expect((await known(ana, ["abc"])).statusCode).toBe(400);
    const demais = Array.from({ length: 501 }, (_, i) => sha(String(i)));
    expect((await known(ana, demais)).statusCode).toBe(400);
  });
});
