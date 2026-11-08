import { useCallback, useEffect, useState } from "react";

/** O que mostrar sobre instalar o app: nada, o botão do navegador, a dica do iPhone ou "já instalado". */
export type InstallState = "installed" | "prompt" | "ios-hint" | "none";

export function installState(input: {
  standalone: boolean;
  ios: boolean;
  hasPrompt: boolean;
}): InstallState {
  if (input.standalone) return "installed";
  if (input.hasPrompt) return "prompt";
  if (input.ios) return "ios-hint";
  return "none";
}

/** iPhone, iPad e iPad que se apresenta como Mac (iPadOS 13+). */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** Evento não padrão do Chrome, Edge e Android: guarda o pedido de instalação até o usuário clicar. */
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void> };

function runningStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function useInstall(): { state: InstallState; install: () => Promise<void> } {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault(); // o navegador não mostra a própria barra; o botão do app faz isso
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!promptEvent) return;
    setPromptEvent(null); // o evento só vale uma vez
    await promptEvent.prompt();
  }, [promptEvent]);

  const state = installState({
    standalone: installed || runningStandalone(),
    ios: isIos(navigator.userAgent, navigator.maxTouchPoints),
    hasPrompt: promptEvent !== null,
  });
  return { state, install };
}
