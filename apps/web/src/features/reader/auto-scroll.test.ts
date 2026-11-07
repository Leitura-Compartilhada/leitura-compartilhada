import { describe, expect, it, vi } from "vitest";
import {
  type AutoScrollDeps,
  AutoScroller,
  pageIntervalMs,
  scrollSpeedPxPerSecond,
} from "./auto-scroll";

function setup(overrides: Partial<AutoScrollDeps> = {}) {
  const scroller = { scrollTop: 0 } as HTMLElement;
  const advance = vi.fn(async () => undefined);
  const checkpoint = vi.fn(async () => undefined);
  const onStop = vi.fn();
  const deps: AutoScrollDeps = {
    flow: () => "scrolled",
    speedLevel: () => 5, // 60 px/s
    findScroller: () => scroller,
    atChapterEnd: () => false,
    hasMore: () => true,
    advance,
    checkpoint,
    onStop,
    schedule: () => 1,
    cancel: () => undefined,
    ...overrides,
  };
  const auto = new AutoScroller(deps);
  return { auto, scroller, advance, checkpoint, onStop };
}

describe("velocidades", () => {
  it("crescem com o nível e respeitam os limites", () => {
    expect(scrollSpeedPxPerSecond(1)).toBeLessThan(scrollSpeedPxPerSecond(5));
    expect(scrollSpeedPxPerSecond(99)).toBe(scrollSpeedPxPerSecond(10));
    expect(pageIntervalMs(10)).toBeLessThan(pageIntervalMs(1));
  });
});

describe("AutoScroller (rolagem contínua)", () => {
  it("anda em px por segundo, de forma proporcional ao tempo", () => {
    const { auto, scroller } = setup();
    auto.start();
    auto.tick(4000);
    for (let t = 1016; t <= 2000; t += 16) auto.tick(t);
    // 1 s a 60 px/s, com o primeiro quadro contando 16 ms.
    expect(scroller.scrollTop).toBeGreaterThan(55);
    expect(scroller.scrollTop).toBeLessThan(65);
    auto.halt();
  });

  it("junta frações de pixel em vez de perdê-las", () => {
    const { auto, scroller } = setup({ speedLevel: () => 1 }); // 12 px/s: 0,19 px por quadro
    auto.start();
    auto.tick(0);
    for (let t = 16; t <= 1600; t += 16) auto.tick(t);
    expect(scroller.scrollTop).toBeGreaterThan(15);
    auto.halt();
  });

  it("no fim do capítulo avança para o próximo", () => {
    const { auto, advance } = setup({ atChapterEnd: () => true });
    auto.start();
    auto.tick(0);
    auto.tick(16);
    expect(advance).toHaveBeenCalledTimes(1);
    auto.halt();
  });

  it("no fim do livro para e avisa", () => {
    const { auto, onStop, advance } = setup({ atChapterEnd: () => true, hasMore: () => false });
    auto.start();
    auto.tick(0);
    auto.tick(16);
    expect(advance).not.toHaveBeenCalled();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(auto.running).toBe(false);
  });

  it("grava a posição de tempos em tempos", () => {
    const { auto, checkpoint } = setup();
    auto.start();
    auto.tick(0);
    auto.tick(4000);
    expect(checkpoint).not.toHaveBeenCalled();
    auto.tick(5100);
    expect(checkpoint).toHaveBeenCalledTimes(1);
    auto.halt();
  });

  it("se o usuário rola por fora, continua de onde ele parou", () => {
    const { auto, scroller } = setup();
    auto.start();
    auto.tick(0);
    auto.tick(16);
    scroller.scrollTop = 500;
    auto.tick(32);
    expect(scroller.scrollTop).toBeGreaterThan(500);
    expect(scroller.scrollTop).toBeLessThan(502);
    auto.halt();
  });

  it("uma pausa longa (aba escondida) não vira um salto", () => {
    const { auto, scroller } = setup();
    auto.start();
    auto.tick(0);
    auto.tick(60_000);
    expect(scroller.scrollTop).toBeLessThan(20);
    auto.halt();
  });

  it("uma falha na ação para a rolagem automática", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { auto, onStop } = setup({
      atChapterEnd: () => true,
      advance: async () => {
        throw new Error("falhou");
      },
    });
    auto.start();
    auto.tick(0);
    auto.tick(16);
    await vi.waitFor(() => expect(onStop).toHaveBeenCalled());
    warn.mockRestore();
  });
});

describe("AutoScroller (páginas)", () => {
  it("vira a página só quando o intervalo passa", () => {
    const { auto, advance } = setup({ flow: () => "paginated", speedLevel: () => 10 }); // 9 s
    auto.start();
    auto.tick(0);
    auto.tick(8_000);
    expect(advance).not.toHaveBeenCalled();
    auto.tick(9_100);
    expect(advance).toHaveBeenCalledTimes(1);
    auto.halt();
  });

  it("no fim do livro para", () => {
    const { auto, onStop } = setup({
      flow: () => "paginated",
      speedLevel: () => 10,
      hasMore: () => false,
    });
    auto.start();
    auto.tick(0);
    auto.tick(9_100);
    expect(onStop).toHaveBeenCalled();
  });
});
