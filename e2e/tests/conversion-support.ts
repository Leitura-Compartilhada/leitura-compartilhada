import type { Page } from "@playwright/test";
import { signUp, uniqueEmail } from "../fixtures/account.js";
import type { Device } from "../fixtures/devtools.js";

// Apoio dos specs de conversão (F5): conta nova, envio pelo seletor e arquivos de teste escritos aqui.

const SENTENCE = "Era uma vez um leitor paciente que abria o livro todas as noites. ";
const BODY = SENTENCE.repeat(40);

export const SAMPLES = {
  txt: {
    name: "Anotacoes.txt",
    mimeType: "text/plain",
    title: "Anotacoes",
    body: `${BODY}\n\n${BODY}`,
  },
  md: {
    name: "Guia.md",
    mimeType: "text/markdown",
    // O Calibre não acha título no Markdown e usa "index"; a ingestão troca pelo nome do arquivo.
    title: "Guia",
    body: `# Guia de Teste\n\n${BODY}\n\n## Segunda parte\n\n${BODY}`,
  },
  html: {
    name: "Pagina.html",
    mimeType: "text/html",
    title: "Pagina Titulada",
    body: `<html><head><title>Pagina Titulada</title></head><body><h1>Capitulo</h1><p>${BODY}</p></body></html>`,
  },
  fb2: {
    name: "Romance.fb2",
    mimeType: "application/x-fictionbook+xml",
    title: "Romance Sintetico",
    body: `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
<description><title-info><genre>prose</genre>
<author><first-name>Ana</first-name><last-name>Souza</last-name></author>
<book-title>Romance Sintetico</book-title><lang>pt</lang></title-info></description>
<body><section><title><p>Capitulo Um</p></title><p>${BODY}</p></section></body>
</FictionBook>`,
  },
} as const;

/** Cria a conta (o contexto já nasce logado) e abre a estante. */
export async function openFreshLibrary(device: Device, baseURL: string) {
  await signUp(device.context.request, uniqueEmail("conv"), baseURL);
  await device.page.goto("/");
}

/** Escolhe um arquivo escrito em memória no seletor da estante. */
export async function pickFile(
  page: Page,
  name: string,
  mimeType: string,
  content: string | Buffer,
) {
  await page
    .getByLabel("Escolher arquivo de livro")
    .setInputFiles({ name, mimeType, buffer: Buffer.from(content) });
}

/** MOBI que passa na conferência de bytes do servidor mas não é um livro: o Calibre falha. */
export function corruptMobi(): Buffer {
  const head = Buffer.alloc(400, 0x41);
  head.fill(0, 0, 60);
  head.write("BOOKMOBI", 60, "latin1");
  return head;
}
