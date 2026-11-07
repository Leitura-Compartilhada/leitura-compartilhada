import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { uploadBook, uploadConversion } from "@/lib/api";
import { describeApiError } from "@/lib/messages";
import { BOOKS_QUERY_KEY, CONVERSIONS_QUERY_KEY } from "@/lib/queries";
import {
  describeConversionUploadError,
  FORMAT_NOT_SUPPORTED,
  PDF_NOT_SUPPORTED,
  routeUpload,
} from "./conversions/conversion-model";

/** Envio de arquivo: EPUB vai direto, os outros formatos viram uma conversão, PDF/outros são recusados. */
export function useUpload() {
  const client = useQueryClient();
  const [refusal, setRefusal] = useState<string | null>(null);
  const epub = useMutation({
    mutationFn: uploadBook,
    onSuccess: () => client.invalidateQueries({ queryKey: BOOKS_QUERY_KEY }),
  });
  const convert = useMutation({
    mutationFn: uploadConversion,
    onSuccess: () => client.invalidateQueries({ queryKey: CONVERSIONS_QUERY_KEY }),
  });

  function pick(file: File) {
    epub.reset();
    convert.reset();
    const route = routeUpload(file.name);
    if (route.kind === "pdf") return setRefusal(PDF_NOT_SUPPORTED);
    if (route.kind === "unsupported") return setRefusal(FORMAT_NOT_SUPPORTED);
    setRefusal(null);
    if (route.kind === "epub") epub.mutate(file);
    else convert.mutate(file);
  }

  const failure = epub.error ?? convert.error;
  let message: string | null = refusal;
  if (epub.error) message = describeApiError(epub.error);
  else if (convert.error) message = describeConversionUploadError(convert.error);

  let success: string | null = null;
  if (epub.isSuccess) success = `“${epub.data.title}” está na estante.`;
  else if (convert.isSuccess) success = `“${convert.data.filename}” foi enviado para conversão.`;

  return {
    pick,
    isPending: epub.isPending || convert.isPending,
    /** Erro cru da última chamada (para detectar sessão expirada). */
    failure,
    /** Texto de erro ou de recusa, em português. */
    message,
    success,
  };
}
