import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * O `view.js` do foliate importa `pdf.js` por `import()` literal, e o `pdf.js` usa
 * `new URL(`vendor/pdfjs/${x}`, import.meta.url)`, que o Vite não consegue empacotar (glob sem "./").
 * O app só abre EPUB na F1, então o módulo é trocado por um stub que recusa o formato. Não dá para
 * editar o código vendored, por isso a troca é feita aqui.
 */
function stubFoliatePdf(): Plugin {
  const stubId = "\0foliate-pdf-stub";
  return {
    name: "stub-foliate-pdf",
    enforce: "pre",
    resolveId(source, importer) {
      const fromFoliateView = importer !== undefined && /foliate-js[\\/]view\.js$/.test(importer);
      return fromFoliateView && source === "./pdf.js" ? stubId : null;
    },
    load(id) {
      if (id !== stubId) return null;
      return 'export const makePDF = () => { throw new Error("PDF não é suportado nesta versão"); };';
    },
  };
}

const apiProxyTarget = process.env.VITE_API_PROXY ?? "http://localhost:3000";

export default defineConfig({
  plugins: [
    stubFoliatePdf(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Leitura Compartilhada",
        short_name: "Leitura",
        description: "Leitor de EPUB com progresso sincronizado entre dispositivos",
        lang: "pt-BR",
        display: "standalone",
        start_url: "/",
        // Cor da marca ("Lugar exato", ver docs/projeto/guia-e-artefatos.md). Ícones gerados por
        // `pnpm icons`: os "any" têm cantos arredondados; os "maskable" vão até a borda, com o
        // desenho dentro da zona segura, para o Android recortar no formato que quiser.
        theme_color: "#1f5f6b",
        background_color: "#1f5f6b",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "icons/maskable-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: { "/api": apiProxyTarget },
  },
});
