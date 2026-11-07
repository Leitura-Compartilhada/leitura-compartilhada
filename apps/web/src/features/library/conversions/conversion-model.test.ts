import type { ConversionJob } from "@leitura/shared";
import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@/lib/api";
import {
  announceChanges,
  CONVERSION_POLL_MS,
  conversionRefetchInterval,
  describeConversionFailure,
  describeConversionUploadError,
  newlyDone,
  routeUpload,
} from "./conversion-model";

function job(n: number, status: ConversionJob["status"]): ConversionJob {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    filename: `livro${n}.txt`,
    sourceFormat: "txt",
    status,
    errorCode: status === "failed" ? "DRM" : null,
    bookId: status === "done" ? "00000000-0000-4000-8000-0000000000aa" : null,
    createdAt: 1,
    updatedAt: 1,
    finishedAt: null,
  };
}

describe("routeUpload", () => {
  it("separa EPUB, conversão, PDF e o resto", () => {
    expect(routeUpload("a.epub")).toEqual({ kind: "epub" });
    expect(routeUpload("A.EPUB")).toEqual({ kind: "epub" });
    expect(routeUpload("a.azw3")).toEqual({ kind: "convert", format: "mobi" });
    expect(routeUpload("a.fb2")).toEqual({ kind: "convert", format: "fb2" });
    expect(routeUpload("a.markdown")).toEqual({ kind: "convert", format: "md" });
    expect(routeUpload("a.htm")).toEqual({ kind: "convert", format: "html" });
    expect(routeUpload("a.PDF")).toEqual({ kind: "pdf" });
    expect(routeUpload("a.exe")).toEqual({ kind: "unsupported" });
    expect(routeUpload("semextensao")).toEqual({ kind: "unsupported" });
  });
});

describe("conversionRefetchInterval", () => {
  it("consulta só enquanto há job ativo", () => {
    expect(conversionRefetchInterval(undefined)).toBe(false);
    expect(conversionRefetchInterval([])).toBe(false);
    expect(conversionRefetchInterval([job(1, "done"), job(2, "failed")])).toBe(false);
    expect(conversionRefetchInterval([job(1, "done"), job(2, "queued")])).toBe(CONVERSION_POLL_MS);
    expect(conversionRefetchInterval([job(1, "running")])).toBe(CONVERSION_POLL_MS);
  });
});

describe("newlyDone", () => {
  it("devolve só quem passou a concluído", () => {
    const next = [job(1, "done"), job(2, "done"), job(3, "queued")];
    const found = newlyDone([job(1, "running"), job(2, "done")], next);
    expect(found.map((j) => j.id)).toEqual([next[0]?.id]);
  });
  it("na primeira consulta não dispara nada", () => {
    expect(newlyDone(undefined, [job(1, "done")])).toEqual([]);
  });
  it("job que aparece já concluído (conversão rápida) conta", () => {
    expect(newlyDone([], [job(1, "done")])).toHaveLength(1);
  });
});

describe("mensagens", () => {
  it("cada código tem texto próprio e null tem um genérico", () => {
    expect(describeConversionFailure("DRM")).toContain("DRM");
    expect(describeConversionFailure("TIMEOUT")).toContain("demorou demais");
    expect(describeConversionFailure("INGEST_FAILED")).toContain("estante");
    expect(describeConversionFailure(null)).toBe("A conversão falhou.");
  });
  it("erros do envio", () => {
    const err = (code: ConstructorParameters<typeof ApiRequestError>[0]) =>
      new ApiRequestError(code, "x", 400);
    expect(describeConversionUploadError(err("INVALID_FILE"))).toContain("extensão");
    expect(describeConversionUploadError(err("VALIDATION"))).toContain("demais");
    expect(describeConversionUploadError(err("TOO_LARGE"))).toContain("limite");
  });
});

describe("announceChanges", () => {
  it("anuncia conclusão e falha, não o que não mudou", () => {
    const text = announceChanges(
      [job(1, "running"), job(2, "running"), job(3, "done")],
      [job(1, "done"), job(2, "failed"), job(3, "done")],
    );
    expect(text).toContain("livro1.txt: conversão concluída.");
    expect(text).toContain("livro2.txt: a conversão falhou.");
    expect(text).not.toContain("livro3");
  });
});
