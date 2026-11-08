import type { ConversionJob } from "@leitura/shared";
import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import { Link } from "react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import { describeApiError } from "@/lib/messages";
import { describeConversionFailure, STATUS_LABEL } from "./conversion-model";
import { useConversionActions, useConversions } from "./use-conversions";

function StatusIcon({ status }: { status: ConversionJob["status"] }) {
  const cls = "size-4 shrink-0";
  if (status === "running") return <Loader2 className={`${cls} animate-spin`} aria-hidden="true" />;
  if (status === "done") return <CheckCircle2 className={cls} aria-hidden="true" />;
  if (status === "failed") {
    return <AlertCircle className={`${cls} text-destructive`} aria-hidden="true" />;
  }
  return <Clock className={cls} aria-hidden="true" />;
}

/** Painel "Conversões": só aparece quando há jobs. */
export function ConversionsPanel() {
  const { data: jobs, announcement } = useConversions();
  const { retry, dismiss } = useConversionActions();
  const actionError = retry.error ?? dismiss.error;

  return (
    <>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {jobs && jobs.length > 0 ? (
        <section aria-labelledby="conversions-heading" className="rounded-lg border p-4">
          <h2 id="conversions-heading" className="mb-2 text-base font-semibold">
            Conversões
          </h2>
          <ul className="flex flex-col divide-y">
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <StatusIcon status={job.status} />
                <span className="min-w-0 flex-1 break-words font-medium" title={job.filename}>
                  {job.filename}
                </span>
                <span className="text-xs uppercase text-muted-foreground">{job.sourceFormat}</span>
                <span className="text-sm text-muted-foreground">{STATUS_LABEL[job.status]}</span>
                {job.status === "done" ? (
                  <div className="flex gap-2">
                    {job.bookId ? (
                      <Link
                        to={`/read/${job.bookId}`}
                        className={buttonVariants({ size: "sm", variant: "outline" })}
                        aria-label={`Abrir ${job.filename}`}
                      >
                        Abrir
                      </Link>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Fechar ${job.filename}`}
                      onClick={() => dismiss.mutate(job.id)}
                    >
                      Fechar
                    </Button>
                  </div>
                ) : null}
                {job.status === "failed" ? (
                  <>
                    <p className="basis-full text-sm text-destructive">
                      {describeConversionFailure(job.errorCode)}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Tentar de novo ${job.filename}`}
                        onClick={() => retry.mutate(job.id)}
                      >
                        Tentar de novo
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Descartar ${job.filename}`}
                        onClick={() => dismiss.mutate(job.id)}
                      >
                        Descartar
                      </Button>
                    </div>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          {actionError ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {describeApiError(actionError)}
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
