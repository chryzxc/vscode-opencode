import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { Bot, Clock3, Copy, Sparkles, ArrowRight, X, ChevronDown } from "lucide-react";

import { cn, formatDuration } from "@/utils";

import { MarkdownRenderer } from "../../../components/MarkdownRenderer";
import { ActivityStepStatusChip } from "./ActivityStepStatusChip";

import type { ActivityDetail } from "../../lib/types";

type CallOmoAgentStepProps = {
  callID?: string;
  sessionID?: string;
  startedAt?: number;
  endedAt?: number;
  status: "pending" | "done" | "error";
  source?: "stream" | "final" | "raw_debug";
  activityDetail?: ActivityDetail;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function booleanLabel(value: unknown): string | undefined {
  if (value === true) return "yes";
  if (value === false) return "no";
  return undefined;
}

function formatDurationRange(startedAt?: number, endedAt?: number): string | undefined {
  if (!startedAt) {
    return undefined;
  }

  const end = endedAt || Date.now();
  const delta = Math.max(0, end - startedAt);
  return formatDuration(delta);
}

function CallOmoAgentDetailModal({
  isOpen,
  title,
  detail,
  onClose,
  parsedMeta,
}: {
  isOpen: boolean;
  title: string;
  detail: ActivityDetail | undefined;
  onClose: () => void;
  parsedMeta: {
    agent: string;
    description: string;
    prompt: string;
    taskId: string;
    sessionId: string;
    status: string;
  };
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const detailText = useMemo(() => {
    if (!detail) {
      return "{}";
    }
    try {
      return JSON.stringify(detail, null, 2);
    } catch {
      return String(detail);
    }
  }, [detail]);

  if (!isOpen) {
    return null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(detailText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
        aria-label="Close subagent details"
      />
      <div
        className="oc-modal-shell relative z-50 flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden text-foreground animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="oc-modal-header flex shrink-0 items-start justify-between gap-3 bg-oc-panel-soft/70 p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-medium">{title}</span>
            </div>
            <div className="mt-1 text-xs oc-text-secondary">
              Subagent invocation details and metadata
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-oc-border bg-oc-bg-soft oc-text-secondary transition-colors hover:bg-oc-panel hover:text-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="flex flex-col gap-6 sm:gap-8">
            <section>
              <div className="mb-2 sm:mb-3 flex items-center gap-2">
                <div className="h-4 w-1 rounded-full bg-oc-brand" />
                <span className="text-[11px] font-bold uppercase tracking-[0.15em] oc-text-secondary">
                  Instruction Prompt
                </span>
              </div>
              <div className="rounded-xl border border-oc-border-soft bg-oc-bg-soft/50 p-4 sm:p-5 text-[13px] leading-relaxed text-oc-text shadow-sm transition-colors hover:bg-oc-bg-soft/80">
                <MarkdownRenderer content={parsedMeta.prompt || "No prompt provided."} className="markdown-body" />
              </div>
            </section>
            
            <section>
              <div className="mb-2 sm:mb-3 flex items-center gap-2">
                <div className="h-4 w-1 rounded-full bg-oc-brand/60" />
                <span className="text-[11px] font-bold uppercase tracking-[0.15em] oc-text-secondary">
                  Metadata
                </span>
              </div>
              <div className="grid grid-cols-1 gap-5 rounded-xl border border-oc-border-soft bg-oc-bg-soft/50 p-4 sm:p-5 text-[13px] shadow-sm transition-colors hover:bg-oc-bg-soft/80 sm:grid-cols-2 md:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider oc-text-secondary">Status</span>
                  <span className="inline-flex w-fit items-center rounded-md bg-oc-panel-soft px-2 py-1 text-xs font-medium text-oc-text capitalize border border-oc-border-soft shadow-sm">{parsedMeta.status || "Unknown"}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider oc-text-secondary">Agent</span>
                  <span className="font-medium text-oc-text capitalize">{parsedMeta.agent || "Default"}</span>
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2 md:col-span-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider oc-text-secondary">Task ID</span>
                  <span className="font-mono text-oc-text-soft text-[11px] break-all">{parsedMeta.taskId || "Unavailable"}</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function CallOmoAgentStep({
  callID,
  sessionID,
  startedAt,
  endedAt,
  status,
  source,
  activityDetail,
}: CallOmoAgentStepProps) {
  const input = activityDetail?.input ?? {};
  const description =
    stringValue(input.description) ||
    stringValue(activityDetail?.summary) ||
    stringValue(activityDetail?.output);
  const prompt = stringValue(input.prompt);
  const agent = stringValue(input.subagent_type) || stringValue(input.agent);
  const taskId =
    stringValue(activityDetail?.metadata?.task_id) ||
    stringValue(activityDetail?.metadata?.taskId) ||
    stringValue(input.task_id) ||
    stringValue(input.taskId) ||
    stringValue(activityDetail?.backgroundTaskId) ||
    callID;
  const sessionValue =
    stringValue(sessionID) ||
    stringValue(activityDetail?.sessionID);
  const durationLabel = formatDurationRange(startedAt, endedAt);
  const runInBackground = booleanLabel(input.run_in_background);
  const output = stringValue(activityDetail?.output);
  const isPending = status === "pending";
  const isError = status === "error";
  const isDone = status === "done";
  const resolvedBackgroundTaskId =
    stringValue(activityDetail?.backgroundTaskId) || taskId;
  const [isModalOpen, setIsModalOpen] = useState(false);
  const modalTitle = "call_omo_agent";
  const summaryLine =
    description ||
    prompt ||
    "Background agent launched";

  return (
    <>
      <div className="flex flex-col items-start gap-2 w-full min-w-0">
        <div className="flex items-center gap-2 flex-wrap min-h-[20px]">
          <span className="font-medium text-oc-text capitalize text-[13px]">
            Invoke Subagent
          </span>
          {agent && (
            <span className="text-oc-text-soft text-[13px] flex items-center gap-2">
              <span>&middot;</span>
              <span>{agent}</span>
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5 w-full">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="group relative w-full overflow-hidden rounded-lg border border-oc-border-soft bg-oc-bg-soft/60 text-left transition-colors hover:border-oc-border hover:bg-oc-panel-soft/60"
            aria-label="View subagent details"
          >
            <div className="relative overflow-hidden p-2.5">
              <div className="font-mono text-[11px] text-oc-text-soft whitespace-pre-wrap break-words flex items-start gap-2">
                <span className="flex-1">{summaryLine}</span>
              </div>
              {(resolvedBackgroundTaskId || sessionValue) && (
                <div className="mt-1.5 font-mono text-[10px] text-oc-text-soft/40">
                  {resolvedBackgroundTaskId || sessionValue}
                </div>
              )}
            </div>
            <div className="oc-timeline-caret pointer-events-none absolute bottom-2 right-2 inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors group-hover:bg-oc-panel-soft">
              <ChevronDown className="h-3 w-3 oc-text-secondary transition-transform group-hover:translate-y-0.5" />
            </div>
          </button>
        </div>
      </div>
      <CallOmoAgentDetailModal
        isOpen={isModalOpen}
        title={modalTitle}
        detail={activityDetail}
        onClose={() => setIsModalOpen(false)}
        parsedMeta={{
          agent,
          description,
          prompt,
          taskId: resolvedBackgroundTaskId || "Unavailable",
          sessionId: sessionValue || "Unavailable",
          status,
        }}
      />
    </>
  );
}
