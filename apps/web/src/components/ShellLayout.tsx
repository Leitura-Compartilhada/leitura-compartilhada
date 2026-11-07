import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { Link, Outlet, useNavigate } from "react-router";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth";
import { localDb } from "@/lib/db";
import { syncEngine } from "@/lib/sync";

/** Apaga o cache local: outra pessoa pode entrar neste aparelho e não deve ver a leitura desta. */
async function clearLocalData(): Promise<void> {
  await localDb.transaction(
    "rw",
    [localDb.readingStates, localDb.annotations, localDb.outbox, localDb.meta, localDb.books],
    async () => {
      await Promise.all([
        localDb.readingStates.clear(),
        localDb.annotations.clear(),
        localDb.outbox.clear(),
        localDb.meta.clear(),
        localDb.books.clear(),
      ]);
    },
  );
}

export function ShellLayout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const [leaving, setLeaving] = useState(false);

  async function signOut() {
    setLeaving(true);
    try {
      // Tenta enviar o que está pendente antes de apagar o cache; sem rede, segue sem enviar.
      await syncEngine.flush().catch((error: unknown) => {
        console.warn("não foi possível enviar o progresso antes de sair", error);
      });
      await authClient.signOut();
      await clearLocalData();
      queryClient.clear();
      navigate("/login", { replace: true });
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="min-h-dvh">
      <header className="flex items-center gap-4 border-b px-4 py-3">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <img src="/icon.svg" alt="" className="size-6 rounded-md" />
          Leitura Compartilhada
        </Link>
        <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
          {session ? <span className="hidden sm:inline">{session.user.email}</span> : null}
          <ThemeToggle />
          <Button variant="ghost" size="sm" onClick={signOut} disabled={leaving}>
            <LogOut className="size-4" aria-hidden="true" />
            Sair
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">
        <Outlet />
      </main>
    </div>
  );
}
