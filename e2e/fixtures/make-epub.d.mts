export const REPEATED_SENTENCE: string;
export const WEBP_1X1: Buffer;
export const HOSTILE_SVG: Buffer;

export type CoverStyle =
  | "none"
  | "epub3-property"
  | "epub2-meta"
  | "guide"
  | "by-name-webp-lie"
  | "first-image"
  | "svg";

export type ZipEntry = { name: string; data: Buffer; store?: boolean };

export function paragraphText(chapter: number, paragraph: number): string;
export function makePng(size?: number, rgb?: [number, number, number]): Buffer;
export function buildZip(entries: ZipEntry[]): Buffer;
export function buildEpub(options?: {
  chapters?: number;
  paragraphs?: number;
  hostile?: boolean;
  inlinePx?: boolean;
  cover?: CoverStyle;
  title?: string;
  creator?: string;
  language?: string;
}): Buffer;
