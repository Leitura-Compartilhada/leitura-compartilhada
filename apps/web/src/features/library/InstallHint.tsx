import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstall } from "@/lib/install";

/** Mostra como instalar o app: o botão do navegador (Chrome, Edge, Android) ou a dica do iPhone. */
export function InstallHint() {
  const { state, install } = useInstall();
  if (state === "prompt") {
    return (
      <Button variant="outline" size="sm" onClick={() => void install()}>
        <Download className="size-4" aria-hidden="true" />
        Instalar app
      </Button>
    );
  }
  if (state === "ios-hint") {
    return (
      <p className="basis-full text-sm text-muted-foreground">
        Para instalar no iPhone ou iPad: toque em Compartilhar e depois em “Adicionar à Tela de
        Início”.
      </p>
    );
  }
  return null;
}
