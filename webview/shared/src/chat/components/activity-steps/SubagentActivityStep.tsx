import type { ActivityDetail } from "../../lib/types";
import { ExpandableStep } from "@/components/ui/ExpandableStep";
import { TerminalBlock } from "@/components/ui/TerminalBlock";
import { MarkdownRenderer } from "../../../components/MarkdownRenderer";

type Props = {
  label: string;
  status?: "pending" | "running" | "done" | "error";
  activityDetail?: ActivityDetail;
  summary?: string;
  showHeader?: boolean;
};

export function SubagentActivityStep({ label, activityDetail, summary, showHeader = true }: Props) {
  const input = activityDetail?.input;
  const command = activityDetail?.command || (typeof input?.command === "string" ? input.command : undefined);
  const description = activityDetail?.metadata?.description || (typeof input?.description === "string" ? input.description : undefined);
  const query = activityDetail?.query || (typeof input?.pattern === "string" ? input.pattern : undefined);
  const body = command
    ? <TerminalBlock command={command} />
    : query
      ? <div className="oc-refined-event-content font-mono text-xs">{query}</div>
      : summary || activityDetail?.output
        ? <MarkdownRenderer content={summary || activityDetail?.output || ""} />
        : null;

  return (
    <ExpandableStep className="oc-activity-step-surface w-full">
      {showHeader ? <div className="flex items-center justify-between gap-2">
        <span className="oc-activity-step-title font-medium capitalize">{label}</span>
      </div> : null}
      {description ? <div className="oc-activity-step-meta mt-1">{description}</div> : null}
      {body ? <div className="mt-2 w-full">{body}</div> : null}
    </ExpandableStep>
  );
}
