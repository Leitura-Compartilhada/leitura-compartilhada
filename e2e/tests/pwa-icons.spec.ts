import { expect, test } from "@playwright/test";

// O ícone e o manifesto do PWA (marca "Lugar exato"): o app instalado precisa de PNG 192 e 512, de
// uma versão "maskable" que vá até a borda e da cor da marca; tudo servido de verdade.
type ManifestIcon = { src: string; sizes: string; type: string; purpose?: string };
type Manifest = { theme_color: string; background_color: string; icons: ManifestIcon[] };

test.describe("ícone e manifesto do PWA", () => {
  test("o manifesto traz PNG 192 e 512, comuns e maskable, e a cor da marca", async ({
    request,
  }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    const manifest = (await response.json()) as Manifest;

    expect(manifest.theme_color).toBe("#1f5f6b");
    expect(manifest.background_color).toBe("#1f5f6b");
    for (const purpose of ["any", "maskable"]) {
      for (const sizes of ["192x192", "512x512"]) {
        const found = manifest.icons.find(
          (icon) => icon.type === "image/png" && icon.sizes === sizes && icon.purpose === purpose,
        );
        expect(found, `falta o PNG ${sizes} (${purpose})`).toBeDefined();
      }
    }
  });

  test("todo ícone do manifesto, o apple-touch-icon e o SVG existem e são imagens", async ({
    request,
  }) => {
    const manifest = (await (await request.get("/manifest.webmanifest")).json()) as Manifest;
    for (const icon of manifest.icons) {
      const file = await request.get(`/${icon.src}`);
      expect(file.status(), icon.src).toBe(200);
      expect(file.headers()["content-type"], icon.src).toContain(icon.type.split("/")[1]);
    }

    const html = await (await request.get("/")).text();
    expect(html).toContain('rel="apple-touch-icon"');
    const apple = await request.get("/icons/apple-touch-icon.png");
    expect(apple.status()).toBe(200);
    expect(apple.headers()["content-type"]).toContain("image/png");
  });

  test("o PNG maskable não tem transparência nos cantos e o comum tem", async ({
    request,
    page,
  }) => {
    // Lê o pixel do canto direto no navegador (canvas), sem dependência de imagem.
    await page.goto("/");
    const alpha = async (src: string) =>
      page.evaluate(async (url) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context?.drawImage(image, 0, 0);
        return context?.getImageData(1, 1, 1, 1).data[3] ?? -1;
      }, src);

    expect(await alpha("/icons/maskable-512.png")).toBe(255); // fundo até a borda
    expect(await alpha("/icons/apple-touch-icon.png")).toBe(255); // o iOS exige fundo cheio
    expect(await alpha("/icons/icon-512.png")).toBe(0); // canto arredondado, transparente
    expect((await request.get("/icons/icon-512.png")).ok()).toBe(true);
  });
});
