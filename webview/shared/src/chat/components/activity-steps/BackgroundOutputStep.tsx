import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { ArrowRight, Bot, Clock3, Copy, Sparkles, X, Terminal } from "lucide-react";

import { cn, formatDuration } from "@/utils";

import { MarkdownRenderer } from "../../../components/MarkdownRenderer";
import { ActivityStepStatusChip } from "./ActivityStepStatusChip";

import type { ActivityDetail } from "../../lib/types";

type BackgroundOutputStepProps = {
  callID?: string;
  sessionID?: string;
  startedAt?: number;
  endedAt?: number;
  status: "pending" | "done" | "error";
  source?: "stream" | "final" | "raw_debug";
  activityDetail?: ActivityDetail;
};

type ParsedBackgroundOutput = {
  taskId?: string;
  description?: string;
  agent?: string;
  statusLabel?: string;
  duration?: string;
  sessionId?: string;
  rawText?: string;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatDurationRange(startedAt?: number, endedAt?: number): string | undefined {
  if (!startedAt) return undefined;
  return formatDuration(Math.max(0, (endedAt || Date.now()) - startedAt));
}

function compactId(value: string | undefined, keep = 8): string | undefined {
  const text = stringValue(value);
  if (!text) return undefined;
  if (text.length <= keep) return text;
  return text.slice(0, keep);
}

/**
 * Extracts the first readable, non-empty, and non-boilerplate line from raw text.
 * Filters out markdown tables, headers, and repeating system-level notes.
 */
function extractReadablePreview(raw: string | undefined): string | undefined {
  const text = stringValue(raw);
  if (!text) return undefined;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      // Exclude markdown headers, table structures, and separator lines
      if (line.startsWith("#") || line.includes("|") || /^[-=]{3,}$/.test(line)) {
        return false;
      }
      
      // Exclude system boilerplate warnings like "No need to wait explicitly"
      const lower = line.toLowerCase();
      if (
        line.startsWith(">") ||
        lower.includes("no need to wait") ||
        lower.includes("system will notify you") ||
        lower.includes("task completes") ||
        lower.startsWith("note:") ||
        lower.startsWith("**note**:")
      ) {
        return false;
      }
      return true;
    });

  const firstReadable = lines.find((line) => line.length > 0);
  return firstReadable;
}

/**
 * Parses markdown table output from background operations into structured fields.
 */
function parseBackgroundOutput(raw: string | undefined): ParsedBackgroundOutput {
  const text = stringValue(raw);
  if (!text) {
    return {};
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const fieldMap: Record<string, string> = {};

  for (const line of lines) {
    if (!line.includes("|")) {
      continue;
    }
    const cells = line
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean)
      .map((cell) => cell.replace(/\*\*/g, "").trim());

    if (cells.length < 2) {
      continue;
    }

    // Matches rows like: Task ID | bg_xxx
    if (cells.length === 2) {
      fieldMap[cells[0].toLowerCase()] = cells[1];
      continue;
    }

    // Ignore markdown table header/separator rows
    const first = cells[0].toLowerCase();
    const second = cells[1].toLowerCase();
    if (
      (first === "field" && second === "value") ||
      /^-+$/.test(cells[0].replace(/\s+/g, "")) ||
      /^-+$/.test(cells[1].replace(/\s+/g, ""))
    ) {
      continue;
    }
  }

  return {
    taskId: fieldMap["task id"],
    description: fieldMap["description"],
    agent: fieldMap["agent"],
    statusLabel: fieldMap["status"],
    duration: fieldMap["duration"],
    sessionId: fieldMap["session id"],
    rawText: text,
  };
}

/**
 * Modal that renders full payload details and formatted markdown output for background tasks.
 */
function BackgroundOutputModal({
  isOpen,
  title,
  detail: rawDetail,
  onClose,
}: {
  isOpen: boolean;
  title: string;
  detail: ActivityDetail | undefined;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  
  // Cast detail as any to bypass strict typecheck checks on dynamic payload properties
  const detail = rawDetail as any;

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const detailText = useMemo(() => {
    if (!detail) return "{}";
    try {
      return JSON.stringify(detail, null, 2);
    } catch {
      return String(detail);
    }
  }, [detail]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(detailText);
    } finally {
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
        aria-label="Close background output details"
      />
      <div
        className="oc-modal-shell relative z-50 flex h-[min(92vh,900px)] min-h-0 w-full max-w-5xl flex-col overflow-hidden text-foreground animate-in zoom-in-95 duration-200"
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
              Full background output payload and rendered output
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
          <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="rounded-lg border border-oc-border-soft bg-oc-bg/20 p-3">
              <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.18em] oc-text-secondary">
                Summary
              </div>
              <div className="space-y-2 text-[11px] leading-relaxed">
                <div><span className="oc-text-secondary">Task:</span> {detail?.backgroundTaskId ?? detail?.id ?? "Unavailable"}</div>
                <div><span className="oc-text-secondary">Status:</span> {detail?.status ?? "unknown"}</div>
                <div><span className="oc-text-secondary">Agent:</span> {detail?.agentRole ?? detail?.agentId ?? "Unavailable"}</div>
                <div><span className="oc-text-secondary">Session:</span> {detail?.childSessionId ?? detail?.parentSessionId ?? "Unavailable"}</div>
                <div><span className="oc-text-secondary">Model:</span> {detail?.modelID && detail?.providerID ? `${detail.modelID}/${detail.providerID}` : detail?.modelID || detail?.providerID || "Unavailable"}</div>
              </div>
            </section>

            <section className="rounded-lg border border-oc-border-soft bg-oc-bg/20 p-3">
              <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.18em] oc-text-secondary">
                Raw Detail
              </div>
              <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-oc-border-soft bg-oc-panel/30 p-3 text-[10px] leading-relaxed text-oc-text-soft">
                {detailText}
              </pre>
            </section>
          </div>

          {detail?.output ? (
            <section className="mt-3 rounded-lg border border-oc-border-soft bg-oc-bg/20 p-3">
              <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.18em] oc-text-secondary">
                Latest Output
              </div>
              <div className="max-h-56 overflow-y-auto text-[11px] leading-relaxed">
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

/**
 * Activity component representing a background command output or execution step.
 * Redesigned for improved theme consistency, readability, and a mini console view.
 */
export function BackgroundOutputStep({
  callID,
  sessionID,
  startedAt,
  endedAt,
  status,
  source,
  activityDetail,
}: BackgroundOutputStepProps) {
  const input = activityDetail?.input ?? {};
  
  // Extract key fields from the background output payload
  const parsedOutput = useMemo(
    () => parseBackgroundOutput(activityDetail?.output),
    [activityDetail?.output],
  );
  
  const taskId =
    parsedOutput.taskId ||
    stringValue(activityDetail?.backgroundTaskId) ||
    stringValue(activityDetail?.metadata?.task_id) ||
    stringValue(activityDetail?.metadata?.taskId) ||
    stringValue(input.task_id) ||
    stringValue(input.taskId) ||
    callID;
    
  const description =
    parsedOutput.description ||
    stringValue(input.description) ||
    stringValue(activityDetail?.summary) ||
    "Background task update";
    
  const agent =
    parsedOutput.agent ||
    stringValue(input.subagent_type) ||
    stringValue(input.agent);
    
  const durationLabel = formatDurationRange(startedAt, endedAt);
  const runInBackground = input.block === true || stringValue(input.run_in_background) === "true";
  const output = stringValue(activityDetail?.output);
  
  // Clean preview output (removes system boilerplate/waiting warnings)
  const previewOutput = extractReadablePreview(parsedOutput.rawText || output);
  
  const sessionLabel =
    stringValue(sessionID) ||
    parsedOutput.sessionId ||
    stringValue(activityDetail?.sessionID);
    
  const [isModalOpen, setIsModalOpen] = useState(false);

  const isDone = status === "done";
  const isError = status === "error";
  const isPending = status === "pending";
  
  // Capitalize first letter of status strings for a more humanized presentation
  const rawStatus = parsedOutput.statusLabel || (isError ? "failed" : isDone ? "completed" : isPending ? "pending" : "running");
  
  const compactTaskId = compactId(taskId);
  const compactSessionId = compactId(sessionLabel);

  return (
    <>
      <button
        type="button"
        className="group block w-full overflow-hidden text-left transition-colors"
        onClick={() => setIsModalOpen(true)}
      >
        <div className="px-3 py-2 sm:px-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-oc-border-soft bg-oc-bg-soft text-oc-text-secondary">
                  <Terminal className="h-3 w-3" />
                </span>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-oc-text-secondary">
                  background_output
                </span>
                <ActivityStepStatusChip status={isPending ? "pending" : isDone ? "done" : isError ? "error" : "running"} />
                {runInBackground ? (
                  <span className="rounded-full border border-oc-border-soft bg-oc-bg/30 px-2 py-0.5 text-[10px] oc-text-secondary">
                    background
                  </span>
                ) : null}
                {source === "raw_debug" ? (
                  <span className="rounded-full border border-oc-border-soft bg-oc-bg/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] oc-text-secondary">
                    raw
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-oc-border-soft bg-oc-bg-soft text-oc-text-secondary transition-colors group-hover:bg-oc-panel-soft">
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>

          <div className="oc-activity-step-card mt-2 flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-1.5 text-[9px] oc-text-secondary">
              {durationLabel ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-oc-border-soft bg-oc-bg-soft px-2 py-0.5">
                  <Clock3 className="h-3 w-3" />
                  {durationLabel}
                </span>
              ) : null}
              {compactTaskId ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-oc-border-soft bg-oc-bg-soft px-2 py-0.5">
                  <span className="uppercase tracking-[0.14em]">Task</span>
                  <span className="font-mono text-oc-text-soft">{compactTaskId}</span>
                </span>
              ) : null}
              {compactSessionId ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-oc-border-soft bg-oc-bg-soft px-2 py-0.5">
                  <span className="uppercase tracking-[0.14em]">Session</span>
                  <span className="font-mono text-oc-text-soft">{compactSessionId}</span>
                </span>
              ) : null}
            </div>

            {description && description.toLowerCase() !== "background_output" ? (
              <div className="text-[10.5px] leading-relaxed text-oc-text-soft">
                {description}
              </div>
            ) : null}

            {previewOutput ? (
              <div className="rounded-md border border-oc-border-soft/20 bg-oc-bg/18 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-oc-text-soft">
                <div className="line-clamp-2 whitespace-pre-wrap break-words">
                  {previewOutput}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </button>

      {/* Modal Dialog for Full Detail Payload */}
      <BackgroundOutputModal
        isOpen={isModalOpen}
        title="Background Output"
        detail={activityDetail}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
