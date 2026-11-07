import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { authClient } from "@/lib/auth";
import { startSyncTriggers } from "@/lib/sync";

/** Guarda das rotas privadas: sem sessão vai para o login; com sessão liga os gatilhos de sync. */
export function RequireAuth() {
  const { data: session, isPending } = authClient.useSession();
  const location = useLocation();
  const signedIn = Boolean(session);

  useEffect(() => {
    if (!signedIn) return;
    return startSyncTriggers();
  }, [signedIn]);

  if (isPending) {
    return (
      <p className="p-6 text-muted-foreground" role="status">
        Carregando…
      </p>
    );
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
