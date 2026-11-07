import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getConfig } from "@/lib/api";
import { authClient, describeAuthError } from "@/lib/auth";
import { PasswordField } from "./PasswordField";

type Mode = "signin" | "signup";

/** Só aceita caminhos internos como destino depois do login (evita redirecionar para fora). */
function safeDestination(from: unknown): string {
  return typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/";
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const { data: config } = useQuery({ queryKey: ["config"], queryFn: getConfig, retry: false });
  const allowSignup = config?.allowSignup === true;

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorId = useId();

  const destination = safeDestination(
    typeof location.state === "object" && location.state !== null && "from" in location.state
      ? location.state.from
      : null,
  );

  if (!sessionPending && session) return <Navigate to={destination} replace />;

  const signingUp = mode === "signup" && allowSignup;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = signingUp
        ? await authClient.signUp.email({ name: name.trim() || email, email, password })
        : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(describeAuthError(result.error));
        return;
      }
      navigate(destination, { replace: true });
    } catch (caught) {
      console.warn("falha ao autenticar", caught);
      setError(describeAuthError(null));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex items-center gap-2 text-xl font-semibold">
        <img src="/icon.svg" alt="" className="size-8 rounded-lg" />
        Leitura Compartilhada
        <span className="ml-auto">
          <ThemeToggle />
        </span>
      </div>
      <h1 className="text-2xl font-semibold">{signingUp ? "Criar conta" : "Entrar"}</h1>

      <form
        onSubmit={onSubmit}
        className="space-y-4"
        aria-describedby={error ? errorId : undefined}
      >
        {signingUp ? (
          <div className="space-y-1.5">
            <label htmlFor="name" className="text-sm font-medium">
              Nome
            </label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            E-mail
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Senha
          </label>
          <PasswordField
            value={password}
            onChange={setPassword}
            autoComplete={signingUp ? "new-password" : "current-password"}
            minLength={signingUp ? 8 : undefined}
          />
        </div>

        {error ? (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Aguarde…" : signingUp ? "Criar conta" : "Entrar"}
        </Button>
      </form>

      {allowSignup ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setMode(signingUp ? "signin" : "signup");
            setError(null);
          }}
        >
          {signingUp ? "Já tenho conta" : "Criar conta"}
        </Button>
      ) : null}
    </div>
  );
}
