import { describe, expect, it } from "vitest";
import { pgErrorCode } from "./errors.js";

describe("pgErrorCode", () => {
  it("lê o SQLSTATE direto ou embrulhado em `cause` (como o Drizzle faz)", () => {
    expect(pgErrorCode({ code: "23505" })).toBe("23505");
    expect(pgErrorCode(new Error("x", { cause: { code: "23503" } }))).toBe("23503");
  });

  it("ignora códigos que não são SQLSTATE e erros sem código", () => {
    expect(pgErrorCode({ code: "FST_REQ_FILE_TOO_LARGE" })).toBeNull();
    expect(pgErrorCode(new Error("sem código"))).toBeNull();
    expect(pgErrorCode(null)).toBeNull();
  });
});
