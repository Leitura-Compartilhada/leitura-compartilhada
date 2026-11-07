// Gera o ícone do app a partir de UM desenho ("Lugar exato": uma página com a linha onde você parou
// marcada por um ponto) e escreve os arquivos em apps/web/public/. Rodar de novo só quando o desenho
// mudar:   pnpm icons
// O Chromium do Playwright (já usado no E2E) rasteriza os PNGs, então não há dependência nova.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "apps", "web", "public");
const iconsDir = path.join(publicDir, "icons");

// Cores da direção escolhida (contrastes conferidos em docs/projeto/guia-e-artefatos.md).
const BACKGROUND = "#1f5f6b";
const PAGE = "#f2fbfc";
const MUTED_LINE = "#9cc9d1";

/** O desenho em um quadro de 96 x 96. `scale` encolhe o miolo em torno do centro (zona segura). */
function glyph(scale = 1) {
  const g = `
    <rect x="24" y="16" width="48" height="64" rx="6" fill="${PAGE}"/>
    <path d="M32 29h32M32 41h32M32 67h22" stroke="${MUTED_LINE}" stroke-width="4.5" stroke-linecap="round" fill="none"/>
    <path d="M32 54h18" stroke="${BACKGROUND}" stroke-width="6" stroke-linecap="round" fill="none"/>
    <circle cx="61" cy="54" r="6.5" fill="${BACKGROUND}"/>`;
  if (scale === 1) return g;
  return `<g transform="translate(48 48) scale(${scale}) translate(-48 -48)">${g}</g>`;
}

/** `rounded`: cantos arredondados (ícone comum). Sem ele: fundo até a borda (o sistema recorta). */
function svg({ rounded, scale = 1, title }) {
  const bg = rounded
    ? `<rect width="96" height="96" rx="22" fill="${BACKGROUND}"/>`
    : `<rect width="96" height="96" fill="${BACKGROUND}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><title>${title}</title>${bg}${glyph(scale)}</svg>\n`;
}

const rounded = svg({ rounded: true, title: "Leitura Compartilhada" });
// 0,85 deixa o miolo dentro do círculo de 80% que o Android garante (zona segura do maskable).
const maskable = svg({ rounded: false, scale: 0.85, title: "Leitura Compartilhada" });

mkdirSync(iconsDir, { recursive: true });
writeFileSync(path.join(publicDir, "icon.svg"), rounded);
writeFileSync(path.join(iconsDir, "maskable.svg"), maskable);

const targets = [
  { file: "icon-192.png", size: 192, source: rounded, transparent: true },
  { file: "icon-512.png", size: 512, source: rounded, transparent: true },
  { file: "maskable-192.png", size: 192, source: maskable },
  { file: "maskable-512.png", size: 512, source: maskable },
  // O iOS aplica a própria máscara: precisa de fundo cheio, sem transparência.
  { file: "apple-touch-icon.png", size: 180, source: maskable },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const { file, size, source, transparent } of targets) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`,
    );
    const png = await page.screenshot({ omitBackground: Boolean(transparent), type: "png" });
    writeFileSync(path.join(iconsDir, file), png);
    console.log(`apps/web/public/icons/${file} (${size} px, ${png.length} bytes)`);
  }
} finally {
  await browser.close();
}
console.log("apps/web/public/icon.svg e icons/maskable.svg escritos");
