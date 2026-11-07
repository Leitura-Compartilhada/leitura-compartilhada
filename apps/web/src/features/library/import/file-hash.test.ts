import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "./file-hash";
import { MAX_HASH_BYTES } from "./import-model";

afterEach(() => vi.unstubAllGlobals());

describe("sha256Hex", () => {
  it("calcula o SHA-256 em hexadecimal", async () => {
    // Valor conhecido do SHA-256 de "abc".
    expect(await sha256Hex(new File(["abc"], "a.txt"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("arquivo acima do limite não é lido (vira não conferido)", async () => {
    const big = new File(["x"], "grande.epub");
    Object.defineProperty(big, "size", { value: MAX_HASH_BYTES + 1 });
    const read = vi.spyOn(big, "arrayBuffer");
    expect(await sha256Hex(big)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("no limite exato ainda calcula", async () => {
    const edge = new File(["x"], "limite.epub");
    Object.defineProperty(edge, "size", { value: MAX_HASH_BYTES });
    expect(await sha256Hex(edge)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sem crypto.subtle ou com falha de leitura devolve null em vez de lançar", async () => {
    vi.stubGlobal("crypto", {});
    expect(await sha256Hex(new File(["abc"], "a.txt"))).toBeNull();
    vi.unstubAllGlobals();
    const broken = new File(["abc"], "b.txt");
    vi.spyOn(broken, "arrayBuffer").mockRejectedValue(new Error("falha de leitura"));
    expect(await sha256Hex(broken)).toBeNull();
  });
});
