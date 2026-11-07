// Gera um EPUB 3 sintético e determinístico (mesmos bytes a cada execução, sem dependências).
// Serve de fixture nos testes: o texto de cada parágrafo é conhecido, então dá para afirmar
// exatamente o que a tela deve mostrar. Não contém conteúdo com direitos autorais.
//
// Uso:  node e2e/fixtures/make-epub.mjs [saida.epub]
//
// Variantes (opções de `buildEpub`), todas fora do padrão para o arquivo versionado não mudar:
//   hostile   capítulo malicioso (script, onerror, link javascript:)
//   inlinePx  texto dentro de um <div> com font-size/line-height/font-family inline, como nos
//             capítulos do Lord of Mysteries (o CSS do leitor precisa vencer o estilo inline)
//   cover     como a capa é declarada: "epub3-property", "epub2-meta", "guide", "by-name-webp-lie"
//             (imagem sem extensão, WebP declarada como JPEG, como no Lord of Mysteries),
//             "first-image", "svg" (deve ser recusada) ou "none"
//   title, creator, language   metadados do OPF

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync, deflateSync } from "node:zlib";

export const REPEATED_SENTENCE =
  "Esta frase idêntica aparece em todos os capítulos para testar a busca ambígua do leitor.";

/** Parágrafo `p` do capítulo `c` (ambos a partir de 1). O décimo de cada capítulo é o repetido. */
export function paragraphText(c, p) {
  if (p === 10) return REPEATED_SENTENCE;
  return (
    `Capítulo ${c}, parágrafo ${p}: marcador-c${c}-p${p} ` +
    "o leitor atravessa a página devagar, observa o horizonte e anota cada detalhe " +
    "que pode ajudar a reconhecer este exato ponto da história mais tarde."
  );
}

// Data fixa (2026-01-01 00:00:00) no formato do MS-DOS, para o ZIP ser reproduzível.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** Monta um ZIP em memória. Entradas: `{ name, data: Buffer, store?: boolean }`. */
export function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, store } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const body = store ? data : deflateRawSync(data);
    const method = store ? 0 : 8;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + body.length;
  }

  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

/** WebP de 1x1 pixel (lossy), o mesmo usado para detectar suporte a WebP em navegadores. */
export const WEBP_1X1 = Buffer.from(
  "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
  "base64",
);

/** PNG sólido de `size` x `size` pixels, gerado na hora: decodificável de verdade, sem dependências. */
export function makePng(size = 8, [r, g, b] = [200, 60, 60]) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.writeUInt8(8, 8); // 8 bits por canal
  header.writeUInt8(2, 9); // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(size).fill([r, g, b]).flat())]);
  const raw = Buffer.concat(Array(size).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** SVG com script: uma "capa" que nunca deve ser aceita nem servida. */
export const HOSTILE_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><rect width="10" height="10"/></svg>',
);

const xhtml = (title, body) =>
  `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="pt-BR">
<head><meta charset="utf-8"/><title>${title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>
`;

/** Página extra com uma imagem, usada por algumas variantes de capa. */
const imagePage = (name, img) => ({
  name: `OEBPS/${name}`,
  data: Buffer.from(
    xhtml("Abertura", `<p>Abertura do livro.</p>\n<p><img src="${img}" alt=""/></p>`),
  ),
});

/**
 * Peças do pacote que variam conforme o estilo de declaração da capa: arquivos, itens do
 * manifesto, itens que entram no início da lista de leitura, `<meta>` e `<guide>`.
 */
function coverParts(cover) {
  const parts = { files: [], manifest: [], spineFirst: [], meta: "", guide: "" };
  if (cover === "epub3-property") {
    parts.files.push({ name: "OEBPS/images/capa.png", data: makePng() });
    parts.manifest.push(
      '<item id="capa" href="images/capa.png" media-type="image/png" properties="cover-image"/>',
    );
  } else if (cover === "epub2-meta") {
    parts.files.push({ name: "OEBPS/images/capa.png", data: makePng() });
    parts.meta = '\n<meta name="cover" content="capaimg"/>';
    parts.manifest.push('<item id="capaimg" href="images/capa.png" media-type="image/png"/>');
  } else if (cover === "guide") {
    parts.files.push(
      { name: "OEBPS/images/arte-1.png", data: makePng() },
      imagePage("capa.xhtml", "images/arte-1.png"),
    );
    parts.manifest.push(
      '<item id="arte1" href="images/arte-1.png" media-type="image/png"/>',
      '<item id="paginacapa" href="capa.xhtml" media-type="application/xhtml+xml"/>',
    );
    parts.guide = '\n<guide><reference type="cover" title="Capa" href="capa.xhtml"/></guide>';
  } else if (cover === "by-name-webp-lie") {
    // Como o Lord of Mysteries: sem metadado de capa, imagem "cover_image" sem extensão, WebP
    // declarada como JPEG, usada na primeira página da leitura.
    parts.files.push(
      { name: "OEBPS/cover_image", data: WEBP_1X1 },
      imagePage("cover_title.xhtml", "cover_image"),
    );
    parts.manifest.push(
      '<item id="image_0" href="cover_image" media-type="image/jpeg"/>',
      '<item id="chapter_0" href="cover_title.xhtml" media-type="application/xhtml+xml"/>',
    );
    parts.spineFirst.push('<itemref idref="chapter_0"/>');
  } else if (cover === "first-image") {
    parts.files.push(
      { name: "OEBPS/images/arte-1.png", data: makePng() },
      imagePage("abertura.xhtml", "images/arte-1.png"),
    );
    parts.manifest.push(
      '<item id="arte1" href="images/arte-1.png" media-type="image/png"/>',
      '<item id="abertura" href="abertura.xhtml" media-type="application/xhtml+xml"/>',
    );
    parts.spineFirst.push('<itemref idref="abertura"/>');
  } else if (cover === "svg") {
    parts.files.push({ name: "OEBPS/images/capa.svg", data: HOSTILE_SVG });
    parts.manifest.push(
      '<item id="capa" href="images/capa.svg" media-type="image/svg+xml" properties="cover-image"/>',
    );
  }
  return parts;
}

/** Monta o EPUB em memória. `chapters` capítulos de `paragraphs` parágrafos cada. */
export function buildEpub({
  chapters = 3,
  paragraphs = 60,
  hostile = false,
  inlinePx = false,
  cover = "none",
  title = "Livro Sintético de Teste",
  creator = "Gerador de fixtures",
  language = "pt-BR",
} = {}) {
  const ids = Array.from({ length: chapters }, (_, i) => i + 1);
  const coverPart = coverParts(cover);

  const chapterFiles = ids.map((c) => {
    const body = Array.from(
      { length: paragraphs },
      (_, i) => `<p>${paragraphText(c, i + 1)}</p>`,
    ).join("\n");
    const content = inlinePx
      ? `<div style="font-family: 'Fira Sans',sans-serif;font-size: 15px;line-height: 160%;">\n${body}\n</div>`
      : body;
    return {
      name: `OEBPS/cap${c}.xhtml`,
      data: Buffer.from(xhtml(`Capítulo ${c}`, `<h1>Capítulo ${c}</h1>\n${content}`)),
    };
  });

  // Capítulo hostil, só quando pedido: simula um EPUB malicioso. Cada vetor deixa um rastro
  // observável (`window.__pwned` do app e uma requisição com `pwned-probe`) se conseguir executar.
  // A URL é absoluta porque, num documento blob:, um caminho relativo não resolve.
  const hostileFile = hostile
    ? {
        name: "OEBPS/hostil.xhtml",
        data: Buffer.from(
          xhtml(
            "Capítulo hostil",
            `<h1>Capítulo hostil</h1>
<p>Texto hostil visível.</p>
<script>window.parent.__pwned = "inline"; fetch(window.parent.location.origin + "/api/config?pwned-probe=inline");</script>
<img src="nao-existe.png" alt="" onerror="window.parent.__pwned = 'onerror'; fetch(window.parent.location.origin + '/api/config?pwned-probe=onerror')"/>
<p><a id="js-link" href="javascript:window.parent.__pwned='javascript-link'">executar</a></p>
<p><a id="ext-link" href="https://example.com/externo">externo</a></p>`,
          ),
        ),
      }
    : null;

  const nav = xhtml(
    "Sumário",
    `<nav epub:type="toc" id="toc"><h1>Sumário</h1><ol>\n${ids
      .map((c) => `<li><a href="cap${c}.xhtml">Capítulo ${c}</a></li>`)
      .join(
        "\n",
      )}${hostile ? '\n<li><a href="hostil.xhtml">Capítulo hostil</a></li>' : ""}\n</ol></nav>`,
  );

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="pt-BR">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:uuid:5d9b1d1e-6a52-4c53-9c8e-0f7e3c0a1b11</dc:identifier>
<dc:title>${title}</dc:title>
<dc:creator>${creator}</dc:creator>
<dc:language>${language}</dc:language>
<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>${coverPart.meta}
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
${ids.map((c) => `<item id="cap${c}" href="cap${c}.xhtml" media-type="application/xhtml+xml"/>`).join("\n")}${hostile ? '\n<item id="hostil" href="hostil.xhtml" media-type="application/xhtml+xml"/>' : ""}${coverPart.manifest.map((item) => `\n${item}`).join("")}
</manifest>
<spine>
${coverPart.spineFirst.map((item) => `${item}\n`).join("")}${ids.map((c) => `<itemref idref="cap${c}"/>`).join("\n")}${hostile ? '\n<itemref idref="hostil"/>' : ""}
</spine>${coverPart.guide}
</package>
`;

  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`;

  return buildZip([
    // O `mimetype` precisa ser a primeira entrada e vir sem compressão.
    { name: "mimetype", data: Buffer.from("application/epub+zip"), store: true },
    { name: "META-INF/container.xml", data: Buffer.from(container) },
    { name: "OEBPS/content.opf", data: Buffer.from(opf) },
    { name: "OEBPS/nav.xhtml", data: Buffer.from(nav) },
    {
      name: "OEBPS/style.css",
      data: Buffer.from("body { font-family: serif; line-height: 1.5; }\nh1 { margin: 1em 0; }\n"),
    },
    ...chapterFiles,
    ...(hostileFile ? [hostileFile] : []),
    ...coverPart.files,
  ]);
}

const executedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (executedDirectly) {
  const out = path.resolve(
    process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "sintetico.epub"),
  );
  mkdirSync(path.dirname(out), { recursive: true });
  const epub = buildEpub();
  writeFileSync(out, epub);
  console.log(`${out} (${epub.length} bytes)`);
}
