import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { type CoverImage, MAX_COVER_BYTES, sniffImage } from "./image.js";
import { ZipArchive, ZipError } from "./zip.js";

/** Container e OPF (milhares de itens já cabem em 1 MiB). */
const MAX_XML_BYTES = 1024 * 1024;
/** Página lida só para achar a primeira imagem. */
const MAX_PAGE_BYTES = 512 * 1024;
/** Uma tag `<img ...>` maior que isto não é procurada. */
const MAX_TAG_LENGTH = 4096;
const MAX_TITLE = 300;
const MAX_AUTHOR = 200;
const MAX_AUTHORS = 20;
const MAX_SERIES = 200;

export type EpubMetadata = {
  title: string | null;
  authors: string[];
  language: string | null;
  /** Série e posição do volume, quando o OPF declara (Calibre ou EPUB 3). */
  series: string | null;
  seriesIndex: number | null;
  cover: CoverImage | null;
};

const EMPTY: EpubMetadata = {
  title: null,
  authors: [],
  language: null,
  series: null,
  seriesIndex: null,
  cover: null,
};

// Entidades desligadas: um DOCTYPE com entidades aninhadas (billion laughs) não é expandido.
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  processEntities: false,
  parseTagValue: false,
  isArray: (name) => ["item", "itemref", "meta", "creator", "reference", "rootfile"].includes(name),
});

type Node = Record<string, unknown>;

const PREDEFINED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * O parser roda sem entidades (protege contra DOCTYPE malicioso), então as cinco predefinidas e as
 * referências numéricas são decodificadas aqui, só nos textos e atributos que o módulo usa.
 */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos));/g,
    (match, dec, hex, name) => {
      if (name) return PREDEFINED_ENTITIES[name] ?? match;
      const code = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
      return String.fromCodePoint(code);
    },
  );
}

/** Atributo de texto já decodificado, ou "". */
const attr = (node: Node, name: string): string => {
  const value = node[`@_${name}`];
  return typeof value === "string" ? decodeEntities(value) : "";
};

const asNode = (value: unknown): Node =>
  typeof value === "object" && value !== null ? (value as Node) : {};

/** Texto de um elemento que pode vir como string ou como `{ "#text": ..., "@_id": ... }`. */
function textOf(value: unknown): string {
  const single = Array.isArray(value) ? value[0] : value;
  const raw = typeof single === "object" && single !== null ? (single as Node)["#text"] : single;
  if (typeof raw !== "string" && typeof raw !== "number") return "";
  // Controles de metadados externos viram espaço (sem regex de controle, que o linter proíbe).
  const printable = Array.from(decodeEntities(String(raw)), (ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? " " : ch;
  }).join("");
  return printable.replace(/\s+/g, " ").trim();
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * Resolve um `href` do pacote para o nome da entrada no ZIP. Devolve `null` para qualquer coisa
 * que não seja um arquivo dentro do EPUB: URL com esquema, `\`, e `..` que sai da raiz.
 */
export function resolveHref(baseDir: string, href: string): string | null {
  const clean = href.split("#")[0]?.split("?")[0] ?? "";
  if (clean === "" || clean.includes("\\") || /^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const joined = decoded.startsWith("/")
    ? path.posix.normalize(decoded.slice(1))
    : path.posix.normalize(path.posix.join(baseDir, decoded));
  if (joined === "." || joined.startsWith("../") || joined === "..") return null;
  return joined;
}

/** Série pelo `calibre:series` (+ `calibre:series_index`) ou pelo `belongs-to-collection` do EPUB 3. */
function readSeries(metadata: Node): { series: string | null; seriesIndex: number | null } {
  const metas = list(metadata.meta).map(asNode);
  const toIndex = (raw: string): number | null => {
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value >= 0 && value <= 10_000 ? value : null;
  };

  const calibre = metas.find((meta) => attr(meta, "name") === "calibre:series");
  const calibreName = calibre ? attr(calibre, "content").replace(/\s+/g, " ").trim() : "";
  if (calibreName) {
    const index = metas.find((meta) => attr(meta, "name") === "calibre:series_index");
    return {
      series: calibreName.slice(0, MAX_SERIES),
      seriesIndex: index ? toIndex(attr(index, "content")) : null,
    };
  }

  const collection = metas.find((meta) => attr(meta, "property") === "belongs-to-collection");
  const name = collection ? textOf(collection) : "";
  if (!collection || !name) return { series: null, seriesIndex: null };
  const id = attr(collection, "id");
  const position = id
    ? metas.find(
        (meta) => attr(meta, "refines") === `#${id}` && attr(meta, "property") === "group-position",
      )
    : undefined;
  return {
    series: name.slice(0, MAX_SERIES),
    seriesIndex: position ? toIndex(textOf(position)) : null,
  };
}

type ManifestItem = { id: string; href: string; mediaType: string; properties: string };

function readImage(zip: ArchiveReader, entry: string | null): CoverImage | null {
  if (!entry) return null;
  try {
    const bytes = zip.read(entry, MAX_COVER_BYTES);
    const ext = bytes && sniffImage(bytes);
    return bytes && ext ? { bytes, ext } : null;
  } catch (error) {
    // Um candidato corrompido não impede os próximos.
    if (error instanceof ZipError) return null;
    throw error;
  }
}

type ArchiveReader = Pick<ZipArchive, "read" | "has">;

/**
 * Primeira `<img>` (ou `<image>` de SVG embutido) de uma página, resolvida contra a pasta dela.
 * Varredura linear: cada candidato olha no máximo `MAX_TAG_LENGTH` caracteres, então uma página
 * cheia de `<img ` sem fechar não causa backtracking.
 */
function firstImageOfPage(zip: ArchiveReader, pagePath: string | null): string | null {
  if (!pagePath) return null;
  let page: Buffer | null;
  try {
    page = zip.read(pagePath, MAX_PAGE_BYTES);
  } catch {
    return null;
  }
  if (!page) return null;
  const html = page.toString("utf8");
  const lower = html.toLowerCase();
  for (let i = lower.indexOf("<im"); i >= 0; i = lower.indexOf("<im", i + 3)) {
    const tag = html.slice(i, i + MAX_TAG_LENGTH);
    const end = tag.indexOf(">");
    if (end < 0 || !/^<(?:img|image)[\s/]/i.test(tag)) continue;
    const match = /\b(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(tag.slice(0, end));
    const target = match?.[1]
      ? resolveHref(path.posix.dirname(pagePath), decodeEntities(match[1]))
      : null;
    if (target) return target;
  }
  return null;
}

function findCover(
  zip: ArchiveReader,
  baseDir: string,
  manifest: ManifestItem[],
  pkg: Node,
): CoverImage | null {
  const byId = new Map(manifest.map((item) => [item.id, item]));
  const itemPath = (item: ManifestItem | undefined) =>
    item ? resolveHref(baseDir, item.href) : null;

  // 1) EPUB 3: propriedade cover-image.
  for (const item of manifest) {
    if (item.properties.split(/\s+/).includes("cover-image")) {
      const found = readImage(zip, itemPath(item));
      if (found) return found;
    }
  }

  // 2) EPUB 2: <meta name="cover" content="id-do-item">.
  for (const meta of list(asNode(pkg.metadata).meta)) {
    const node = asNode(meta);
    if (attr(node, "name") === "cover") {
      const found = readImage(zip, itemPath(byId.get(attr(node, "content"))));
      if (found) return found;
    }
  }

  // 3) <guide><reference type="cover">: página de capa, e a primeira imagem dela.
  for (const ref of list(asNode(pkg.guide).reference)) {
    const node = asNode(ref);
    if (attr(node, "type") === "cover" && attr(node, "href") !== "") {
      const page = resolveHref(baseDir, attr(node, "href"));
      const found = readImage(zip, firstImageOfPage(zip, page));
      if (found) return found;
    }
  }

  // 4) Imagem do manifesto cujo id ou nome contém "cover".
  for (const item of manifest) {
    if (/cover|capa/i.test(item.id) || /cover|capa/i.test(path.posix.basename(item.href))) {
      if (item.mediaType.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/i.test(item.href)) {
        const found = readImage(zip, itemPath(item));
        if (found) return found;
      }
    }
  }

  // 5) Primeira imagem do primeiro item da leitura.
  const first = list(asNode(pkg.spine).itemref)
    .map((ref) => attr(asNode(ref), "idref"))
    .find((id) => id !== "");
  return readImage(zip, firstImageOfPage(zip, itemPath(first ? byId.get(first) : undefined)));
}

function parseXml(zip: ArchiveReader, entry: string): Node | null {
  try {
    const bytes = zip.read(entry, MAX_XML_BYTES);
    if (!bytes) return null;
    return asNode(xml.parse(bytes.toString("utf8")));
  } catch {
    return null;
  }
}

/**
 * Lê título, autores, idioma e capa de um EPUB. Melhor esforço: qualquer problema (ZIP
 * corrompido, XML inválido, limite estourado) devolve o que já foi achado, nunca lança.
 */
export function readEpubMetadata(file: Buffer): EpubMetadata {
  let zip: ZipArchive;
  try {
    zip = ZipArchive.open(file);
  } catch {
    return { ...EMPTY };
  }
  const result: EpubMetadata = { ...EMPTY };
  try {
    const container = parseXml(zip, "META-INF/container.xml");
    const rootfiles = list(asNode(asNode(container?.container).rootfiles).rootfile).map(asNode);
    const rootfile =
      rootfiles.find((r) => attr(r, "media-type") === "application/oebps-package+xml") ??
      rootfiles[0];
    const opfPath = resolveHref("", attr(rootfile ?? {}, "full-path"));
    if (!opfPath) return result;
    const pkg = asNode(parseXml(zip, opfPath)?.package);
    const baseDir = path.posix.dirname(opfPath) === "." ? "" : path.posix.dirname(opfPath);
    const metadata = asNode(pkg.metadata);

    result.title = textOf(metadata.title).slice(0, MAX_TITLE) || null;
    result.authors = list(metadata.creator)
      .map((creator) => textOf(creator).slice(0, MAX_AUTHOR))
      .filter((name) => name !== "")
      .slice(0, MAX_AUTHORS);
    const language = textOf(metadata.language);
    result.language = /^[A-Za-z0-9-]{2,35}$/.test(language) ? language : null;
    Object.assign(result, readSeries(metadata));

    const manifest: ManifestItem[] = list(asNode(pkg.manifest).item).map((raw) => {
      const item = asNode(raw);
      return {
        id: attr(item, "id"),
        href: attr(item, "href"),
        mediaType: attr(item, "media-type"),
        properties: attr(item, "properties"),
      };
    });
    result.cover = findCover(zip, baseDir, manifest, pkg);
  } catch {
    // Melhor esforço: devolve o que já foi achado.
  }
  return result;
}
