import { CONVERTIBLE_ACCEPT } from "@leitura/shared";
import { BookPlus, FolderOpen, Loader2 } from "lucide-react";
import { type ChangeEvent, useRef } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  /** Arquivos escolhidos: um só segue o envio direto; vários abrem a revisão. */
  onPick: (files: File[]) => void;
  /** Pasta escolhida (só no PC): sempre abre a revisão. */
  onPickFolder: (files: File[]) => void;
  isPending: boolean;
  /** Erro ou recusa, em português. */
  error: string | null;
  success: string | null;
};

const ACCEPT = `.epub,application/epub+zip,${CONVERTIBLE_ACCEPT}`;

/** Botão "Adicionar livros" e as mensagens do envio. */
export function UploadControl({ onPick, onPickFolder, isPending, error, success }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  function pickFrom(event: ChangeEvent<HTMLInputElement>, deliver: (files: File[]) => void) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // permite escolher o mesmo arquivo de novo depois de um erro
    if (files.length > 0) deliver(files);
  }

  // Os campos de arquivo ficam escondidos (os botões abaixo os acionam). `aria-hidden` evita que leitor de
  // tela e robôs os anunciem como botões extras ("Escolher pasta" aparecia até no celular, sem botão).
  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        aria-label="Escolher arquivo de livro"
        onChange={(event) => pickFrom(event, onPick)}
      />
      <input
        ref={folderInput}
        type="file"
        // @ts-expect-error: atributo não padrão, aceito pelo Chrome, Edge e Firefox
        webkitdirectory=""
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        aria-label="Escolher pasta de livros"
        onChange={(event) => pickFrom(event, onPickFolder)}
      />
      {/* aria-disabled (e não disabled) mantém o foco no botão durante o envio. */}
      {/* Pasta só onde há mouse: no celular o seletor do sistema não abre pastas. */}
      <Button
        className="ml-auto hidden [@media(pointer:fine)]:inline-flex"
        variant="outline"
        onClick={() => folderInput.current?.click()}
      >
        <FolderOpen className="size-4" aria-hidden="true" />
        Importar pasta
      </Button>
      <Button
        className="ml-auto [@media(pointer:fine)]:ml-0"
        aria-disabled={isPending}
        onClick={() => {
          if (!isPending) fileInput.current?.click();
        }}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <BookPlus className="size-4" aria-hidden="true" />
        )}
        {isPending ? "Enviando…" : "Adicionar livros"}
      </Button>
      <div aria-live="polite" className="basis-full empty:hidden">
        {isPending ? <p className="text-sm text-muted-foreground">Enviando o livro…</p> : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {success ? <p className="text-sm text-muted-foreground">{success}</p> : null}
      </div>
    </>
  );
}
