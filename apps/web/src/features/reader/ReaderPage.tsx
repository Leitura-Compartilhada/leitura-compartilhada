import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, List, Pause, Play, Type, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { ApiRequestError, listBooks } from "@/lib/api";
import { describeApiError, isUnauthenticated } from "@/lib/messages";
import { BOOKS_QUERY_KEY } from "@/lib/queries";
import { useResolvedTheme } from "@/lib/theme";
import type { FoliateTocItem } from "@/vendor/foliate-js/view.js";
import { openReader, type ReaderHandle, type ReaderLocation } from "./open-reader";
import { loadPrefs, PALETTES, type ReaderPrefs, resolveReaderTheme, savePrefs } from "./prefs";
import { SettingsPanel } from "./SettingsPanel";
import { loadSavedState } from "./saved-position";

type Status = "loading" | "ready" | "error";
type Panel = "toc" | "settings" | null;

const PROGRESS_SLIDER_MAX = 1000;

function flattenToc(
  items: FoliateTocItem[],
  depth = 0,
): Array<{ item: FoliateTocItem; depth: number }> {
  return items.flatMap((item) => [{ item, depth }, ...flattenToc(item.subitems ?? [], depth + 1)]);
}

function describeOpenError(error: unknown): string {
  if (error instanceof ApiRequestError) return describeApiError(error);
  return "Não foi possível abrir este livro. O arquivo pode estar corrompido.";
}

export function ReaderPage() {
  const { bookId } = useParams();
  const books = useQuery({ queryKey: BOOKS_QUERY_KEY, queryFn: listBooks, retry: false });
  const book = books.data?.find((candidate) => candidate.id === bookId);
  const openBookId = book?.id;
  const openFileHash = book?.fileHash;

  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ReaderHandle | null>(null);
  const [prefs, setPrefs] = useState<ReaderPrefs>(loadPrefs);
  const prefsRef = useRef(prefs);
  const appTheme = useResolvedTheme();
  const appThemeRef = useRef(appTheme);
  appThemeRef.current = appTheme;
  const [autoScrolling, setAutoScrolling] = useState(false);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [location, setLocation] = useState<ReaderLocation>({ fraction: 0, chapter: null });
  const [toc, setToc] = useState<FoliateTocItem[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [scrub, setScrub] = useState<number | null>(null);

  useEffect(() => {
    if (!openBookId || !openFileHash) return;
    const container = containerRef.current;
    if (!container) return;

    const controller = new AbortController();
    setStatus("loading");
    setErrorMessage(null);
    const saved = loadSavedState(openBookId).catch((error: unknown) => {
      console.warn("não foi possível ler a posição salva", error);
      return null;
    });

    const opening = openReader({
      container,
      bookId: openBookId,
      fileHash: openFileHash,
      prefs: prefsRef.current,
      appTheme: appThemeRef.current,
      saved,
      signal: controller.signal,
      onLocation: setLocation,
      onCenterTap: () => setChromeVisible((visible) => !visible),
      onAutoScrollChange: setAutoScrolling,
    })
      .then((handle) => {
        if (!handle) return null;
        handleRef.current = handle;
        void handle.applyPrefs(prefsRef.current, appThemeRef.current);
        setToc(handle.toc);
        setStatus("ready");
        return handle;
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return null;
        console.error("falha ao abrir o livro", error);
        setErrorMessage(describeOpenError(error));
        setStatus("error");
        return null;
      });

    return () => {
      controller.abort();
      handleRef.current = null;
      setAutoScrolling(false);
      void opening.then((handle) => handle?.dispose());
    };
  }, [openBookId, openFileHash]);

  function updatePrefs(next: ReaderPrefs) {
    prefsRef.current = next;
    setPrefs(next);
    savePrefs(next);
    void handleRef.current?.applyPrefs(next, appThemeRef.current);
  }

  // O tema do app mudou (botão ou sistema) e o leitor segue o app: reaplica o CSS dos capítulos.
  useEffect(() => {
    void handleRef.current?.applyPrefs(prefsRef.current, appTheme);
  }, [appTheme]);

  function onPanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") setPanel(null);
  }

  function commitScrub() {
    if (scrub === null) return;
    const fraction = scrub / PROGRESS_SLIDER_MAX;
    setScrub(null);
    void handleRef.current?.goToFraction(fraction);
  }

  if (isUnauthenticated(books.error)) return <Navigate to="/login" replace />;

  const palette = PALETTES[resolveReaderTheme(prefs.theme, appTheme)];
  const percent = Math.round(location.fraction * 100);
  const barStyle = { background: palette.background, color: palette.foreground };
  const missingBook = books.isSuccess && !book;
  const title = book?.title ?? "Livro";
  const fatal = missingBook
    ? "Livro não encontrado."
    : books.isError
      ? describeApiError(books.error)
      : errorMessage;

  return (
    // `data-reader-status` é o sinal de que a restauração terminou; os testes E2E esperam por ele.
    <div
      className="fixed inset-0 flex flex-col"
      style={barStyle}
      data-reader-status={status}
      data-reader-flow={prefs.flow}
      data-reader-autoscroll={autoScrolling}
    >
      {/* Escondido (mas com layout) até a restauração terminar: se ela cai para o trecho de texto ou
          o percentual, a primeira página do livro não pisca na tela antes do salto. */}
      <div
        ref={containerRef}
        className={`min-h-0 flex-1 ${status === "ready" ? "" : "invisible"}`}
      />

      {status === "loading" && !fatal ? (
        <p className="absolute inset-0 flex items-center justify-center" role="status">
          Abrindo o livro…
        </p>
      ) : null}

      {fatal ? (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <p>{fatal}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Tentar de novo
          </Button>
        </div>
      ) : null}

      <header
        className={`absolute inset-x-0 top-0 flex h-12 items-center gap-1 border-b border-current/10 px-2 transition-opacity ${chromeVisible || fatal ? "opacity-100" : "pointer-events-none opacity-0"}`}
        style={barStyle}
      >
        <Link
          to="/"
          aria-label="Voltar à estante"
          className="inline-flex size-9 items-center justify-center rounded-md outline-none hover:bg-black/10 focus-visible:ring-[3px] focus-visible:ring-current/50"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-center text-sm font-medium">
          {location.chapter ?? title}
        </h1>
        <Button
          variant="ghost"
          size="sm"
          aria-label={
            autoScrolling ? "Pausar a rolagem automática" : "Iniciar a rolagem automática"
          }
          aria-pressed={autoScrolling}
          disabled={status !== "ready"}
          onClick={() => {
            handleRef.current?.setAutoScroll(!autoScrolling);
            if (!autoScrolling) setChromeVisible(false);
          }}
        >
          {autoScrolling ? (
            <Pause className="size-5" aria-hidden="true" />
          ) : (
            <Play className="size-5" aria-hidden="true" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Sumário"
          aria-expanded={panel === "toc"}
          disabled={status !== "ready"}
          onClick={() => setPanel(panel === "toc" ? null : "toc")}
        >
          <List className="size-5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Aparência e tamanho da fonte"
          aria-expanded={panel === "settings"}
          disabled={status !== "ready"}
          onClick={() => setPanel(panel === "settings" ? null : "settings")}
        >
          <Type className="size-5" aria-hidden="true" />
        </Button>
      </header>

      <footer
        className={`absolute inset-x-0 bottom-0 flex h-12 items-center gap-3 border-t border-current/10 px-4 transition-opacity ${chromeVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
        style={barStyle}
      >
        <input
          type="range"
          min={0}
          max={PROGRESS_SLIDER_MAX}
          value={scrub ?? Math.round(location.fraction * PROGRESS_SLIDER_MAX)}
          aria-label="Posição no livro"
          aria-valuetext={`${scrub === null ? percent : Math.round((scrub / PROGRESS_SLIDER_MAX) * 100)}%`}
          disabled={status !== "ready"}
          onChange={(event) => setScrub(Number(event.target.value))}
          onPointerUp={commitScrub}
          onKeyUp={commitScrub}
          onBlur={commitScrub}
          className="h-6 min-w-0 flex-1 cursor-pointer accent-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        />
        <span className="w-12 text-right text-sm tabular-nums" aria-live="off">
          {scrub === null ? percent : Math.round((scrub / PROGRESS_SLIDER_MAX) * 100)}%
        </span>
      </footer>

      {panel ? (
        <div
          role="dialog"
          aria-label={panel === "toc" ? "Sumário" : "Aparência e fonte"}
          onKeyDown={onPanelKeyDown}
          // No celular é uma folha na parte de baixo (o livro continua visível em cima e muda ao vivo);
          // a partir de `sm` volta a ser a gaveta lateral.
          className="absolute inset-x-0 bottom-12 flex max-h-[50dvh] flex-col rounded-t-xl border-t border-current/10 shadow-lg sm:inset-x-auto sm:inset-y-12 sm:right-0 sm:max-h-none sm:w-full sm:max-w-sm sm:rounded-none sm:border-l sm:border-t-0"
          style={barStyle}
        >
          <div className="flex items-center justify-between border-b border-current/10 px-4 py-2">
            <h2 className="text-sm font-semibold">{panel === "toc" ? "Sumário" : "Aparência"}</h2>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Fechar painel"
              onClick={() => setPanel(null)}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>

          {panel === "toc" ? (
            <ul className="min-h-0 flex-1 overflow-y-auto p-2">
              {toc.length === 0 ? (
                <li className="p-2 text-sm opacity-70">Este livro não tem sumário.</li>
              ) : (
                flattenToc(toc).map(({ item, depth }) => (
                  <li key={`${item.href}-${item.label}-${depth}`}>
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-black/10 focus-visible:ring-[3px] focus-visible:ring-current/50"
                      style={{ paddingLeft: `${0.5 + depth}rem` }}
                      onClick={() => {
                        setPanel(null);
                        void handleRef.current?.goToHref(item.href);
                      }}
                    >
                      {item.label.trim() || "(sem título)"}
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : (
            <SettingsPanel prefs={prefs} appTheme={appTheme} onChange={updatePrefs} />
          )}
        </div>
      ) : null}
    </div>
  );
}
