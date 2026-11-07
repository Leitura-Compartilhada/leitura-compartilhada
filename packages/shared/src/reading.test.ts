import { describe, expect, it } from "vitest";
import { isNewer, pickLatest } from "./reading.js";

const a = { updatedAt: 10, deviceId: "device-a", cfi: "a" };
const b = { updatedAt: 20, deviceId: "device-b", cfi: "b" };

describe("pickLatest", () => {
  it("mantém o registro mais recente", () => {
    expect(pickLatest(a, b)).toBe(b);
    expect(pickLatest(b, a)).toBe(b);
  });

  it("em empate de horário, vence o maior deviceId, não importa a ordem", () => {
    const x = { updatedAt: 10, deviceId: "device-a", cfi: "x" };
    const y = { updatedAt: 10, deviceId: "device-b", cfi: "y" };
    expect(pickLatest(x, y)).toBe(y);
    expect(pickLatest(y, x)).toBe(y);
  });

  it("em empate total, mantém o primeiro", () => {
    const x = { updatedAt: 10, deviceId: "device-a", cfi: "x" };
    const y = { updatedAt: 10, deviceId: "device-a", cfi: "y" };
    expect(pickLatest(x, y)).toBe(x);
  });
});

describe("isNewer", () => {
  it("é estritamente assimétrico, então os dois lados concordam sobre quem venceu", () => {
    for (const [p, q] of [
      [a, b],
      [b, a],
      [
        { updatedAt: 5, deviceId: "z" },
        { updatedAt: 5, deviceId: "a" },
      ],
    ] as const) {
      expect(isNewer(p, q) && isNewer(q, p)).toBe(false);
    }
  });

  it("compara o deviceId por bytes: maiúscula vem antes de minúscula", () => {
    expect(isNewer({ updatedAt: 1, deviceId: "a" }, { updatedAt: 1, deviceId: "B" })).toBe(true);
  });

  it("empate total não é mais novo para nenhum dos lados", () => {
    const s = { updatedAt: 1, deviceId: "x" };
    expect(isNewer(s, { ...s })).toBe(false);
  });
});
