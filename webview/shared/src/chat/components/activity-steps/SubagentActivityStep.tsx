import { useState } from "react";
import type { ActivityDetail } from "../../lib/types";
import { ExpandableStep } from "@/components/ui/ExpandableStep";
import { TerminalBlock } from "@/components/ui/TerminalBlock";
import { MarkdownRenderer } from "../../../components/MarkdownRenderer";
import {
  FadedCollapseOverlay,
  useFadedContentOverflow,
} from "@/components/ui/FadedCollapseOverlay";

type Props = {
  label: string;
  status?: "pending" | "running" | "done" | "error";
  activityDetail?: ActivityDetail;
  summary?: string;
  showHeader?: boolean;
};

export function SubagentActivityStep({ label, activityDetail, summary, showHeader = true }: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { ref: bodyRef, hasOverflow } = useFadedContentOverflow<HTMLDivElement>(!isExpanded);
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
      {body ? (
        <div
          ref={bodyRef}
          className={isExpanded ? "mt-2 w-full" : "relative mt-2 max-h-[140px] w-full overflow-hidden"}
        >
          {body}
          {!isExpanded && hasOverflow ? (
            <FadedCollapseOverlay
              label="Show full"
              onClick={() => setIsExpanded(true)}
            />
          ) : null}
        </div>
      ) : null}
    </ExpandableStep>
  );
}
