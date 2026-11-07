import { describe, expect, it } from "vitest";
import { buildEpub, buildZip } from "../../../../../e2e/fixtures/make-epub.mjs";
import { hasReadableText } from "./content.js";

const page = (body: string) => Buffer.from(`<html><body>${body}</body></html>`);
const epubWith = (entries: { name: string; data: Buffer }[]) =>
  buildZip([
    { name: "mimetype", data: Buffer.from("application/epub+zip"), store: true },
    ...entries,
  ]);

describe("hasReadableText", () => {
  it("aceita um livro com texto", () => {
    expect(hasReadableText(buildEpub())).toBe(true);
  });

  it("recusa o livro vazio que o Calibre gera quando não entende a entrada", () => {
    const vazio = epubWith([
      { name: "index.xhtml", data: page('<ul class="calibre1"></ul><hr class="calibre2"/>') },
      { name: "titlepage.xhtml", data: page('<div><svg><image href="cover.jpg"/></svg></div>') },
    ]);
    expect(hasReadableText(vazio)).toBe(false);
  });

  it("não conta sumário nem capa como leitura", () => {
    const soSumario = epubWith([
      {
        name: "nav.xhtml",
        data: page("<nav><ol><li>Capítulo um muito longo</li><li>Capítulo dois</li></ol></nav>"),
      },
      { name: "cover.xhtml", data: page("<h1>Título do livro de teste</h1>") },
    ]);
    expect(hasReadableText(soSumario)).toBe(false);
  });

  it("ignora tags, scripts, estilos e entidades; conta letras e números", () => {
    const ruido = epubWith([
      {
        name: "a.xhtml",
        data: page(
          "<style>p { color: red }</style><script>var x = 1234567890123456789</script>&nbsp;&amp;<p> </p>",
        ),
      },
    ]);
    expect(hasReadableText(ruido)).toBe(false);
    const curto = epubWith([
      { name: "a.xhtml", data: page("<p>Um parágrafo curto, mas real.</p>") },
    ]);
    expect(hasReadableText(curto)).toBe(true);
  });

  it("soma o texto de vários documentos e devolve false para lixo", () => {
    const dividido = epubWith([
      { name: "a.xhtml", data: page("<p>Primeiro</p>") },
      { name: "b.xhtml", data: page("<p>Segundo pedaço</p>") },
    ]);
    expect(hasReadableText(dividido)).toBe(true);
    expect(hasReadableText(Buffer.from("não é um zip"))).toBe(false);
  });
});
