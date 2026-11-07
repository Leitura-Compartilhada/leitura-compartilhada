import { createDb } from "@leitura/db";
import type { ReadingState } from "@leitura/shared";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { type BuildAppOptions, buildApp } from "../src/app.js";
import { env } from "../src/env.js";

export const PASSWORD = "senha-segura-123";
const ORIGIN = env.WEB_URL;

/** Banco de teste: apaga tudo entre os testes. `user` em cascata leva livros, estados e anotações. */
const testDb = createDb(env.DATABASE_URL);

export async function resetDatabase(): Promise<void> {
  await testDb.db.execute(sql`truncate table "user", "verification" restart identity cascade`);
}

export async function closeTestDb(): Promise<void> {
  await testDb.pool.end();
}

export async function createTestApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = await buildApp(options);
  await app.ready();
  return app;
}

export type TestUser = { id: string; email: string; cookie: string };

/** Cria um usuário pela rota real de cadastro e devolve o cookie de sessão. */
export async function signUp(app: FastifyInstance, email: string): Promise<TestUser> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { "content-type": "application/json", origin: ORIGIN },
    payload: { name: "Teste", email, password: PASSWORD },
  });
  if (response.statusCode !== 200) {
    throw new Error(`cadastro falhou (${response.statusCode}): ${response.body}`);
  }
  const raw = response.headers["set-cookie"];
  const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const cookie = cookies.map((line) => line.split(";")[0]).join("; ");
  if (!cookie) throw new Error("o cadastro não devolveu cookie de sessão");
  const user = (response.json() as { user: { id: string } }).user;
  return { id: user.id, email, cookie };
}

/** Conteúdo que passa na checagem de assinatura ZIP. `seed` muda o hash. */
export function fakeEpub(seed: string): Buffer {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from(`epub de teste ${seed}`),
  ]);
}

export function multipartBody(
  filename: string,
  content: Buffer,
  fieldName = "file",
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = "----leitura-test-boundary";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      "Content-Type: application/epub+zip\r\n\r\n",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, content, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

export async function uploadBook(
  app: FastifyInstance,
  user: TestUser,
  filename: string,
  content: Buffer,
) {
  const { payload, headers } = multipartBody(filename, content);
  return app.inject({
    method: "POST",
    url: "/api/books",
    headers: { ...headers, cookie: user.cookie },
    payload,
  });
}

export function readingState(bookId: string, overrides: Partial<ReadingState> = {}): ReadingState {
  return {
    bookId,
    status: "reading",
    cfi: "epubcfi(/6/4!/4/2/1:0)",
    percentage: 0.25,
    textSnippet: "um trecho do livro com tamanho suficiente",
    fileHash: "a".repeat(64),
    deviceId: "device-a",
    updatedAt: 1_000,
    ...overrides,
  };
}
