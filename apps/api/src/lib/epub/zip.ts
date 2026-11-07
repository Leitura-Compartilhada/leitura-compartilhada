import { crc32, inflateRawSync } from "node:zlib";

/**
 * Leitor mínimo de ZIP para EPUBs enviados por usuários, ou seja, entrada não confiável.
 *
 * Só lê o diretório central e descompacta as entradas pedidas, cada uma com limite de saída
 * (`maxOutputLength` do zlib), então um tamanho declarado mentiroso ou uma bomba de descompressão
 * estoura o limite em vez de a memória. Recusa ZIP64, criptografia, entradas duplicadas e nomes que
 * escapam da raiz. Nunca grava nada em disco: os nomes servem apenas de chave de busca.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;

export const MAX_ENTRIES = 10_000;
/** Soma de tudo que uma única leitura de EPUB pode descompactar. */
export const MAX_TOTAL_OUTPUT = 32 * 1024 * 1024;

export class ZipError extends Error {
  override readonly name = "ZipError";
}

type Entry = {
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
};

export class ZipArchive {
  private readonly entries = new Map<string, Entry>();
  private totalOutput = 0;

  private constructor(private readonly data: Buffer) {}

  static open(data: Buffer): ZipArchive {
    const archive = new ZipArchive(data);
    archive.readCentralDirectory();
    return archive;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Soma dos tamanhos declarados (descomprimido e comprimido): serve para recusar ZIP bomb antes de usar o arquivo. */
  stats(): { entries: number; size: number; compressedSize: number } {
    let size = 0;
    let compressedSize = 0;
    for (const entry of this.entries.values()) {
      size += entry.size;
      compressedSize += entry.compressedSize;
    }
    return { entries: this.entries.size, size, compressedSize };
  }

  /** Nomes de todas as entradas (arquivos, sem pastas), na ordem do diretório central. */
  names(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Conteúdo da entrada, ou `null` se ela não existe. Lança `ZipError` se o arquivo estiver
   * corrompido, passar de `maxBytes` ou esgotar o orçamento total de descompressão.
   */
  read(name: string, maxBytes: number): Buffer | null {
    const entry = this.entries.get(name);
    if (!entry) return null;
    if (entry.size > maxBytes) throw new ZipError(`entrada grande demais: ${name}`);

    const header = this.data.subarray(entry.localOffset, entry.localOffset + 30);
    if (header.length < 30 || header.readUInt32LE(0) !== LOCAL_SIGNATURE) {
      throw new ZipError(`cabeçalho local inválido: ${name}`);
    }
    const start = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    const end = start + entry.compressedSize;
    if (end > this.data.length) throw new ZipError(`dados fora do arquivo: ${name}`);
    const packed = this.data.subarray(start, end);

    // O orçamento é reservado antes de descompactar, pelo pior caso (`maxBytes`).
    this.totalOutput += Math.min(entry.size, maxBytes);
    if (this.totalOutput > MAX_TOTAL_OUTPUT) throw new ZipError("limite total de descompressão");

    let out: Buffer;
    if (entry.method === 0) {
      if (entry.compressedSize !== entry.size) throw new ZipError(`tamanhos divergem: ${name}`);
      out = packed;
    } else {
      try {
        out = inflateRawSync(packed, { maxOutputLength: Math.min(entry.size, maxBytes) + 1 });
      } catch {
        throw new ZipError(`dados comprimidos inválidos ou acima do declarado: ${name}`);
      }
    }
    // Tamanho e CRC precisam bater com o diretório central: tamanho mentiroso = arquivo suspeito.
    if (out.length !== entry.size || crc32(out) !== entry.crc) {
      throw new ZipError(`tamanho ou CRC não confere: ${name}`);
    }
    return out;
  }

  private readCentralDirectory(): void {
    const { data } = this;
    if (data.length < EOCD_SIZE) throw new ZipError("arquivo pequeno demais");

    let eocd = -1;
    const lowest = Math.max(0, data.length - EOCD_SIZE - MAX_COMMENT);
    for (let i = data.length - EOCD_SIZE; i >= lowest; i--) {
      if (data.readUInt32LE(i) === EOCD_SIGNATURE) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipError("fim do diretório central não encontrado");

    const total = data.readUInt16LE(eocd + 10);
    const centralSize = data.readUInt32LE(eocd + 12);
    const centralOffset = data.readUInt32LE(eocd + 16);
    if (total === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new ZipError("ZIP64 não suportado");
    }
    if (total > MAX_ENTRIES) throw new ZipError("entradas demais");
    if (centralOffset + centralSize > eocd) throw new ZipError("diretório central fora do arquivo");

    let pos = centralOffset;
    for (let i = 0; i < total; i++) {
      if (pos + 46 > data.length || data.readUInt32LE(pos) !== CENTRAL_SIGNATURE) {
        throw new ZipError("entrada do diretório central inválida");
      }
      const flags = data.readUInt16LE(pos + 8);
      const nameLength = data.readUInt16LE(pos + 28);
      const extraLength = data.readUInt16LE(pos + 30);
      const commentLength = data.readUInt16LE(pos + 32);
      const next = pos + 46 + nameLength + extraLength + commentLength;
      if (next > data.length) throw new ZipError("entrada do diretório central truncada");

      if (flags & 0x1) throw new ZipError("entrada criptografada");
      // Sem o bit 11 o nome não é UTF-8 (CP437 na especificação); latin1 cobre os acentos comuns.
      const name = data.toString(
        flags & 0x800 ? "utf8" : "latin1",
        pos + 46,
        pos + 46 + nameLength,
      );
      const method = data.readUInt16LE(pos + 10);
      const entry: Entry = {
        method,
        crc: data.readUInt32LE(pos + 16),
        compressedSize: data.readUInt32LE(pos + 20),
        size: data.readUInt32LE(pos + 24),
        localOffset: data.readUInt32LE(pos + 42),
      };
      // Nomes que escapam da raiz ficam fora do mapa: nada aqui vai a disco, mas o contrato vale.
      const unsafe =
        name.includes("\\") ||
        name.includes("\0") ||
        name.startsWith("/") ||
        name.split("/").includes("..");
      if (!unsafe && !name.endsWith("/")) {
        if (method !== 0 && method !== 8) throw new ZipError(`método não suportado: ${name}`);
        if (this.entries.has(name)) throw new ZipError(`entrada duplicada: ${name}`);
        this.entries.set(name, entry);
      }
      pos = next;
    }
  }
}
