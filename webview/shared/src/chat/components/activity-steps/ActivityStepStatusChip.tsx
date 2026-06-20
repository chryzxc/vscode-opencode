import type { ReactNode } from "react";
import { Check, Loader2, X } from "lucide-react";

import { cn } from "@/utils";

export type ActivityStepStatus = "pending" | "running" | "done" | "error";

type ActivityStepStatusChipProps = {
  status: ActivityStepStatus;
  className?: string;
};

function statusLabel(status: ActivityStepStatus): string {
  switch (status) {
    case "done":
      return "completed";
    case "error":
      return "failed";
    case "running":
      return "running";
    case "pending":
    default:
      return "pending";
  }
}

function statusTone(status: ActivityStepStatus): string {
  switch (status) {
    case "done":
      return "border-oc-border-soft bg-oc-green/10 text-oc-green";
    case "error":
      return "border-oc-border-soft bg-oc-red/10 text-oc-red";
    case "running":
      return "border-oc-border-soft bg-oc-panel-soft text-oc-text-soft";
    case "pending":
    default:
      return "border-oc-border-soft bg-oc-bg-soft text-oc-text-soft";
  }
}

function statusIcon(status: ActivityStepStatus): ReactNode {
  switch (status) {
    case "done":
      return <Check className="h-3 w-3" />;
    case "error":
      return <X className="h-3 w-3" />;
    case "running":
      return <Loader2 className="h-3 w-3 animate-spin" />;
    case "pending":
    default:
      return <span className="h-2 w-2 rounded-full border border-oc-border-soft bg-oc-text-soft/40" />;
  }
}

export function ActivityStepStatusChip({
  status,
  className,
}: ActivityStepStatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]",
        statusTone(status),
        className,
      )}
      aria-label={`Step status: ${statusLabel(status)}`}
    >
      {statusIcon(status)}
      <span>{statusLabel(status)}</span>
    </span>
  );
}
