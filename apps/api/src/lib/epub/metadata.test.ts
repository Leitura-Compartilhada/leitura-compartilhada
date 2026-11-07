import { describe, expect, it } from "vitest";
import {
  buildEpub,
  buildZip,
  type CoverStyle,
  makePng,
  WEBP_1X1,
} from "../../../../../e2e/fixtures/make-epub.mjs";
import { sniffImage } from "./image.js";
import { readEpubMetadata, resolveHref } from "./metadata.js";

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

/** EPUB mínimo com o OPF e as entradas extras que o teste quiser. */
function customEpub(opf: string, extra: { name: string; data: Buffer }[] = []): Buffer {
  return buildZip([
    { name: "mimetype", data: Buffer.from("application/epub+zip"), store: true },
    { name: "META-INF/container.xml", data: Buffer.from(CONTAINER) },
    { name: "OEBPS/content.opf", data: Buffer.from(opf) },
    ...extra,
  ]);
}

const opfWith = (manifest: string, metadata = "") => `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title>${metadata}</metadata>
<manifest>${manifest}</manifest><spine></spine></package>`;

describe("readEpubMetadata", () => {
  it("lê título, autor e idioma", () => {
    const meta = readEpubMetadata(
      buildEpub({ title: "Meu Livro", creator: "Fulana", language: "en" }),
    );
    expect(meta).toMatchObject({ title: "Meu Livro", authors: ["Fulana"], language: "en" });
    expect(meta.cover).toBeNull();
  });

  it.each<[CoverStyle, "png" | "webp"]>([
    ["epub3-property", "png"],
    ["epub2-meta", "png"],
    ["guide", "png"],
    ["first-image", "png"],
    // O OPF declara image/jpeg, mas os bytes são WebP: vale o que está nos bytes.
    ["by-name-webp-lie", "webp"],
  ])("acha a capa no estilo %s", (cover, ext) => {
    const meta = readEpubMetadata(buildEpub({ cover }));
    expect(meta.cover?.ext).toBe(ext);
    expect(meta.cover?.bytes.length).toBeGreaterThan(0);
  });

  it("não acha capa quando o EPUB não tem imagem", () => {
    expect(readEpubMetadata(buildEpub({ cover: "none" })).cover).toBeNull();
  });

  it("recusa SVG como capa", () => {
    expect(readEpubMetadata(buildEpub({ cover: "svg" })).cover).toBeNull();
  });

  it("resolve href com %20 e ../ dentro do pacote", () => {
    const epub = customEpub(
      opfWith(
        '<item id="c" href="../Imagens/minha%20capa.png" media-type="image/png" properties="cover-image"/>',
      ),
      [{ name: "Imagens/minha capa.png", data: makePng() }],
    );
    expect(readEpubMetadata(epub).cover?.ext).toBe("png");
  });

  it("não segue href que sai da raiz do ZIP nem URL externa", () => {
    const epub = customEpub(
      opfWith(
        '<item id="a" href="../../etc/passwd" media-type="image/png" properties="cover-image"/>' +
          '<item id="b" href="http://exemplo.com/capa.png" media-type="image/png"/>',
        '<meta name="cover" content="b"/>',
      ),
      [{ name: "capa.png", data: makePng() }],
    );
    expect(readEpubMetadata(epub).cover).toBeNull();
  });

  it("ignora um arquivo que não é imagem mesmo declarado como capa", () => {
    const epub = customEpub(
      opfWith('<item id="c" href="capa.png" media-type="image/png" properties="cover-image"/>'),
      [{ name: "OEBPS/capa.png", data: Buffer.from("isto não é uma imagem de verdade") }],
    );
    expect(readEpubMetadata(epub).cover).toBeNull();
  });

  it("devolve vazio com XML malformado ou ZIP truncado, sem lançar", () => {
    expect(readEpubMetadata(customEpub("<package><metadata><dc:title>")).cover).toBeNull();
    const epub = buildEpub({ cover: "epub3-property" });
    expect(() => readEpubMetadata(epub.subarray(0, epub.length - 40))).not.toThrow();
    expect(readEpubMetadata(Buffer.from("não é zip"))).toEqual({
      title: null,
      authors: [],
      language: null,
      series: null,
      seriesIndex: null,
      cover: null,
    });
  });

  it("não expande entidades de um DOCTYPE (billion laughs)", () => {
    const bomb = `<?xml version="1.0"?>
<!DOCTYPE lolz [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]>
<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>&c;</dc:title></metadata><manifest/><spine/></package>`;
    const started = Date.now();
    const meta = readEpubMetadata(customEpub(bomb));
    expect(Date.now() - started).toBeLessThan(2_000);
    expect((meta.title ?? "").length).toBeLessThan(50);
  });

  it("rejeita tamanho declarado mentiroso (bomba de descompressão)", () => {
    // Entrada que descompacta para 20 MiB mas declara 100 bytes.
    const big = Buffer.alloc(20 * 1024 * 1024, 0x61);
    const epub = customEpub(
      opfWith('<item id="c" href="capa.png" media-type="image/png" properties="cover-image"/>'),
      [{ name: "OEBPS/capa.png", data: big }],
    );
    // Reescreve o tamanho original (central e local) para um valor pequeno.
    const lie = Buffer.from(epub);
    const needle = Buffer.alloc(4);
    needle.writeUInt32LE(big.length);
    for (let i = lie.indexOf(needle); i >= 0; i = lie.indexOf(needle, i + 1))
      lie.writeUInt32LE(100, i);
    const started = Date.now();
    expect(readEpubMetadata(lie).cover).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("recusa entradas duplicadas e ZIP criptografado", () => {
    const duplicated = buildZip([
      { name: "a.txt", data: Buffer.from("1") },
      { name: "a.txt", data: Buffer.from("2") },
    ]);
    expect(readEpubMetadata(duplicated).title).toBeNull();

    const encrypted = Buffer.from(buildEpub());
    const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
    expect(readEpubMetadata(encrypted).title).toBeNull();
  });

  it("limita tamanho e quantidade de autores e título", () => {
    const creators = Array.from(
      { length: 40 },
      (_, i) => `<dc:creator>Autor ${i}</dc:creator>`,
    ).join("");
    const meta = readEpubMetadata(
      customEpub(
        opfWith("", creators).replace(
          "<dc:title>T</dc:title>",
          `<dc:title>${"x".repeat(5000)}</dc:title>`,
        ),
      ),
    );
    expect(meta.authors).toHaveLength(20);
    expect(meta.title).toHaveLength(300);
  });
});

describe("robustez (revisão do Opus)", () => {
  it("página cheia de <img sem fechar não trava (sem backtracking)", () => {
    const page = `<html><body>${"<img ".repeat(100_000)}</body></html>`;
    const epub = customEpub(
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata/>
<manifest><item id="p" href="p.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="p"/></spine></package>`,
      [{ name: "OEBPS/p.xhtml", data: Buffer.from(page) }],
    );
    const started = Date.now();
    expect(readEpubMetadata(epub).cover).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("decodifica entidades em título, autor e href", () => {
    const epub = customEpub(
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>Tom &amp; Jerry</dc:title><dc:creator>Jos&#233; &#xE9;</dc:creator></metadata>
<manifest><item id="c" href="capa&amp;1.png" media-type="image/png" properties="cover-image"/></manifest><spine/></package>`,
      [{ name: "OEBPS/capa&1.png", data: makePng() }],
    );
    const meta = readEpubMetadata(epub);
    expect(meta.title).toBe("Tom & Jerry");
    expect(meta.authors).toEqual(["José é"]);
    expect(meta.cover?.ext).toBe("png");
  });

  it("título numérico continua texto", () => {
    expect(readEpubMetadata(buildEpub({ title: "007" })).title).toBe("007");
  });

  it("ignora entradas com nome fora da raiz", () => {
    const epub = buildZip([{ name: "../fora.txt", data: Buffer.from("x") }]);
    expect(() => readEpubMetadata(epub)).not.toThrow();
  });
});

describe("série no OPF", () => {
  const withMeta = (meta: string) => customEpub(opfWith("", meta));

  it("lê calibre:series e calibre:series_index", () => {
    const meta = readEpubMetadata(
      withMeta(
        '<meta name="calibre:series" content="  Lord of   Mysteries "/><meta name="calibre:series_index" content="3.0"/>',
      ),
    );
    expect(meta).toMatchObject({ series: "Lord of Mysteries", seriesIndex: 3 });
  });

  it("lê belongs-to-collection e group-position do EPUB 3", () => {
    const meta = readEpubMetadata(
      withMeta(
        '<meta property="belongs-to-collection" id="c1">Mistborn</meta><meta refines="#c1" property="collection-type">series</meta><meta refines="#c1" property="group-position">2</meta>',
      ),
    );
    expect(meta).toMatchObject({ series: "Mistborn", seriesIndex: 2 });
  });

  it("série sem índice fica sem índice; índice inválido é ignorado", () => {
    expect(
      readEpubMetadata(withMeta('<meta name="calibre:series" content="Só Nome"/>')),
    ).toMatchObject({
      series: "Só Nome",
      seriesIndex: null,
    });
    const bad = withMeta(
      '<meta name="calibre:series" content="X"/><meta name="calibre:series_index" content="abc"/>',
    );
    expect(readEpubMetadata(bad).seriesIndex).toBeNull();
    const huge = withMeta(
      '<meta name="calibre:series" content="X"/><meta name="calibre:series_index" content="99999"/>',
    );
    expect(readEpubMetadata(huge).seriesIndex).toBeNull();
  });

  it("sem metadado de série devolve nulos", () => {
    expect(readEpubMetadata(buildEpub())).toMatchObject({ series: null, seriesIndex: null });
  });
});

describe("sniffImage", () => {
  it("decide pelos bytes", () => {
    expect(sniffImage(makePng())).toBe("png");
    expect(sniffImage(WEBP_1X1)).toBe("webp");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(20).fill(0)]))).toBe("jpg");
    expect(sniffImage(Buffer.from(`GIF89a${"\0".repeat(20)}`, "latin1"))).toBe("gif");
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
  });
});

describe("resolveHref", () => {
  it.each([
    ["OEBPS", "img/a.png", "OEBPS/img/a.png"],
    ["OEBPS", "../img/a.png", "img/a.png"],
    ["OEBPS", "/img/a.png", "img/a.png"],
    ["OEBPS", "a%20b.png#frag", "OEBPS/a b.png"],
    ["", "a.png", "a.png"],
  ])("%s + %s", (base, href, expected) => {
    expect(resolveHref(base, href)).toBe(expected);
  });

  it.each([
    ["OEBPS", "../../x.png"],
    ["", "../x.png"],
    ["OEBPS", "https://e.com/a.png"],
    ["OEBPS", "file:///etc/passwd"],
    ["OEBPS", "a\\b.png"],
    ["OEBPS", "%2e%2e/%2e%2e/x.png"],
    ["OEBPS", "%zz.png"],
    ["OEBPS", ""],
  ])("recusa %s + %s", (base, href) => {
    expect(resolveHref(base, href)).toBeNull();
  });
});
