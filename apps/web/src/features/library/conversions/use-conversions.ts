import type { ConversionJob } from "@leitura/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { dismissConversion, listConversions, retryConversion } from "@/lib/api";
import { BOOKS_QUERY_KEY, CONVERSIONS_QUERY_KEY } from "@/lib/queries";
import { announceChanges, conversionRefetchInterval, newlyDone } from "./conversion-model";

/**
 * Lista de conversões com polling enquanto algo está na fila ou rodando. Quando um job conclui, a
 * lista de livros é invalidada (a estante se atualiza) e `announcement` traz o texto para o leitor
 * de tela.
 */
export function useConversions() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: CONVERSIONS_QUERY_KEY,
    queryFn: listConversions,
    retry: false,
    refetchInterval: (q) => conversionRefetchInterval(q.state.data),
  });

  const previous = useRef<ConversionJob[] | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");
  const jobs = query.data;
  useEffect(() => {
    if (!jobs) return;
    if (newlyDone(previous.current, jobs).length > 0) {
      void client.invalidateQueries({ queryKey: BOOKS_QUERY_KEY });
    }
    const text = announceChanges(previous.current, jobs);
    if (text) setAnnouncement(text);
    previous.current = jobs;
  }, [jobs, client]);

  return { ...query, announcement };
}

/** "Tentar de novo" e "Descartar"; as duas atualizam a lista logo depois. */
export function useConversionActions() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: CONVERSIONS_QUERY_KEY });
  const retry = useMutation({ mutationFn: retryConversion, onSettled: refresh });
  const dismiss = useMutation({ mutationFn: dismissConversion, onSettled: refresh });
  return { retry, dismiss };
}
