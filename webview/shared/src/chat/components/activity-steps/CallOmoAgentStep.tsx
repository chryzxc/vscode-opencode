import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { Bot, Clock3, Copy, Sparkles, ArrowRight, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn, formatDuration } from "@/utils";

import { MarkdownRenderer } from "../../../components/MarkdownRenderer";

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
}: {
  isOpen: boolean;
  title: string;
  detail: ActivityDetail | undefined;
  onClose: () => void;
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
        aria-label="Close call_omo_agent details"
      />
      <div
        className="oc-modal-shell relative z-50 flex h-[min(92vh,900px)] min-h-0 w-full max-w-5xl flex-col overflow-hidden text-foreground"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="oc-modal-header flex shrink-0 items-start justify-between gap-3 bg-oc-panel-soft/70 p-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{title}</span>
              <span className="rounded-full border border-oc-border-soft bg-oc-bg-soft px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] oc-text-secondary">
                details
              </span>
            </div>
            <div className="mt-1 text-xs oc-text-secondary">
              Full call_omo_agent payload and metadata
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

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-oc-border-soft bg-oc-bg/20 p-3">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-2 rounded-md border border-oc-border bg-oc-bg-soft px-3 py-1.5 text-xs font-medium oc-text-secondary transition-colors hover:bg-oc-panel hover:text-foreground"
          >
            <Copy className="h-3.5 w-3.5" />
            <span>{copied ? "Copied" : "Copy Payload"}</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid gap-3 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="rounded-lg border border-oc-border-soft bg-oc-bg/20 p-3">
              <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.18em] oc-text-secondary">
                Summary
              </div>
              <div className="space-y-2 text-sm">
                <div><span className="oc-text-secondary">Status:</span> {detail?.status ?? "unknown"}</div>
                <div><span className="oc-text-secondary">Task ID:</span> {detail?.backgroundTaskId ?? detail?.id ?? "Unavailable"}</div>
                <div><span className="oc-text-secondary">Session ID:</span> {detail?.childSessionId ?? detail?.parentSessionId ?? "Unavailable"}</div>
                <div><span className="oc-text-secondary">Agent:</span> {detail?.agentRole ?? detail?.agentId ?? "Unavailable"}</div>
                <div><span className="oc-text-secondary">Model:</span> {detail?.providerID && detail?.modelID ? `${detail.modelID}/${detail.providerID}` : detail?.modelID || detail?.providerID || "Unavailable"}</div>
              </div>
            </section>
            <section className="rounded-lg border border-oc-border-soft bg-oc-bg/20 p-3">
              <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.18em] oc-text-secondary">
                Raw Detail
              </div>
              <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-oc-border-soft bg-oc-panel/30 p-3 text-[11px] leading-relaxed text-oc-text-soft">
                {detailText}
              </pre>
            </section>
          </div>

          {detail?.output ? (
            <section className="mt-3 rounded-lg border border-oc-border-soft bg-oc-bg/20 p-3">
              <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.18em] oc-text-secondary">
                Latest Output
              </div>
              <div className="max-h-56 overflow-y-auto">
                <MarkdownRenderer content={detail.output} className="markdown-body" />
              </div>
            </section>
          ) : null}
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
      <button
        type="button"
        className="group block w-full overflow-hidden rounded-md border border-oc-border-soft bg-oc-bg-soft/55 text-left shadow-none transition-colors hover:border-oc-border hover:bg-oc-panel-soft/55"
        onClick={() => setIsModalOpen(true)}
      >
        <div className="relative border-l border-l-oc-accent/20 px-2.5 py-2">
          <div className="flex items-start justify-between gap-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-oc-border-soft bg-oc-bg-soft text-oc-text-secondary">
                  <Sparkles className="h-3 w-3" />
                </div>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-oc-text-secondary">
                  call_omo_agent
                </span>
                <Badge
                  variant={isError ? "error" : isDone ? "success" : "warning"}
                  className="h-5 gap-1 px-2 py-0 text-[10px] font-medium"
                >
                  <Bot className="h-3 w-3" />
                  {isError ? "failed" : isDone ? "completed" : "running"}
                </Badge>
                {runInBackground && (
                  <span className="rounded-full border border-oc-border-soft bg-oc-bg/30 px-2 py-0.5 text-[10px] oc-text-secondary">
                    background
                  </span>
                )}
                {source === "raw_debug" && (
                  <span className="rounded-full border border-oc-border-soft bg-oc-bg/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] oc-text-secondary">
                    raw
                  </span>
                )}
              </div>

              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9px] oc-text-secondary">
                {durationLabel ? (
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="h-3 w-3" />
                    {durationLabel}
                  </span>
                ) : null}
                {resolvedBackgroundTaskId ? (
                  <>
                    <span className="opacity-35">•</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="uppercase tracking-[0.16em]">Task</span>
                      <span className="font-mono text-oc-text-soft">{resolvedBackgroundTaskId}</span>
                    </span>
                  </>
                ) : null}
                {runInBackground ? (
                  <>
                    <span className="opacity-35">•</span>
                    <span className="inline-flex items-center gap-1">
                      <span className="uppercase tracking-[0.16em]">Mode</span>
                      <span className="font-mono text-oc-text-soft">background</span>
                    </span>
                  </>
                ) : null}
                {agent ? (
                  <>
                    <span className="opacity-35">•</span>
                    <span className="inline-flex items-center gap-1">
                      <Bot className="h-3 w-3" />
                      <span className="font-medium text-oc-text-soft">{agent}</span>
                    </span>
                  </>
                ) : null}
              </div>

              <div className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-oc-text-soft">
                {summaryLine}
              </div>
            </div>

            <div className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-oc-border-soft bg-oc-bg-soft text-oc-text-secondary transition-colors group-hover:bg-oc-panel-soft">
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>
        </div>
      </button>
      <CallOmoAgentDetailModal
        isOpen={isModalOpen}
        title={modalTitle}
        detail={activityDetail}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
