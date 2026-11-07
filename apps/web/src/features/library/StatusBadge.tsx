import type { ReadingStatus } from "@leitura/shared";
import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS } from "./library-model";

const VARIANTS: Record<ReadingStatus, "default" | "secondary" | "outline"> = {
  want_to_read: "outline",
  reading: "default",
  read: "secondary",
  abandoned: "outline",
};

export function StatusBadge({ status }: { status: ReadingStatus }) {
  return (
    <Badge variant={VARIANTS[status]} data-status={status}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
