import { describe, expect, it } from "vitest";
import { installState, isIos } from "./install";

describe("installState", () => {
  it("já instalado não mostra nada de instalar", () => {
    expect(installState({ standalone: true, ios: true, hasPrompt: true })).toBe("installed");
  });

  it("com o pedido do navegador, mostra o botão", () => {
    expect(installState({ standalone: false, ios: false, hasPrompt: true })).toBe("prompt");
  });

  it("no iPhone não há pedido: mostra a dica de Compartilhar", () => {
    expect(installState({ standalone: false, ios: true, hasPrompt: false })).toBe("ios-hint");
  });

  it("nos outros casos não mostra nada", () => {
    expect(installState({ standalone: false, ios: false, hasPrompt: false })).toBe("none");
  });
});

describe("isIos", () => {
  it("reconhece iPhone e iPad", () => {
    expect(isIos("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5)).toBe(true);
    expect(isIos("Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)", 5)).toBe(true);
  });

  it("reconhece o iPad que se apresenta como Mac, mas não um Mac de verdade", () => {
    expect(isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
  });

  it("Android e Windows não são iOS", () => {
    expect(isIos("Mozilla/5.0 (Linux; Android 14; Pixel 8)", 5)).toBe(false);
    expect(isIos("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0)).toBe(false);
  });
});
