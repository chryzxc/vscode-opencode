import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { ArrowRight, Bot, Clock3, Copy, Sparkles, X, Terminal, ChevronDown } from "lucide-react";

import { cn, formatDuration } from "@/utils";
import { Stepper, StepperItem } from "@/components/ui/stepper";
import { StepIndicator } from "@/components/ui/StepIndicator";

import { MarkdownRenderer } from "../../../components/MarkdownRenderer";
import { ActivityStepStatusChip } from "./ActivityStepStatusChip";

import type { ActivityDetail, SubagentConversationEvent } from "../../lib/types";

type BackgroundOutputStepProps = {
  callID?: string;
  sessionID?: string;
  startedAt?: number;
  endedAt?: number;
  status: "pending" | "done" | "error";
  source?: "stream" | "final" | "raw_debug";
  activityDetail?: ActivityDetail;
  assistantUpdateText?: string;
  assistantConversationEvents?: SubagentConversationEvent[];
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
  parsedOutput,
  assistantUpdateText,
  assistantConversationEvents,
  onClose,
}: {
  isOpen: boolean;
  title: string;
  detail: ActivityDetail | undefined;
  parsedOutput: {
    taskId?: string;
    description?: string;
    agent?: string;
    statusLabel?: string;
    duration?: string;
    sessionId?: string;
    rawText?: string;
  };
  assistantUpdateText?: string;
  assistantConversationEvents?: SubagentConversationEvent[];
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  
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
  const renderedConversation = useMemo(() => {
    const source = Array.isArray(assistantConversationEvents)
      ? assistantConversationEvents
      : [];
    return [...source]
      .filter((event) => stringValue(event.text).length > 0)
      .sort((left, right) => left.createdAt - right.createdAt);
  }, [assistantConversationEvents]);

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
        className="oc-modal-shell relative z-50 flex h-[min(92vh,860px)] min-h-0 w-full max-w-5xl flex-col overflow-hidden text-foreground animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="oc-modal-header shrink-0 bg-oc-panel-soft/70 p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold sm:text-base">{title}</span>
              </div>
              <div className="mt-1 text-xs oc-text-secondary">
                Background task details and output
              </div>
            </div>
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-oc-border bg-oc-bg-soft oc-text-secondary transition-colors hover:bg-oc-panel hover:text-foreground"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="oc-modal-content min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:p-5">
          <div className="flex flex-col gap-6 sm:gap-8">
            {(renderedConversation.length > 0 || stringValue(assistantUpdateText)) ? (
              <section>
                <div className="sticky top-0 z-[1] mb-3 flex items-center justify-between border-b border-oc-border-soft bg-oc-panel/95 pb-2 backdrop-blur-sm">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-oc-text-soft">
                    Assistant Update
                  </span>
                  <span className="rounded-md border border-oc-border-soft px-2 py-0.5 text-[10px] font-medium text-oc-text-soft">
                    {renderedConversation.length > 0 ? `${renderedConversation.length} events` : "Summary"}
                  </span>
                </div>

                {renderedConversation.length > 0 ? (
                  <Stepper
                    className="oc-refined-stepper oc-activity-timeline-compact pl-2"
                    autoScrollToBottom={false}
                  >
                    {renderedConversation.map((event, index) => {
                      const label =
                        event.kind === "reasoning"
                          ? "Reasoning"
                          : event.kind === "step"
                            ? "Step"
                            : "Message";
                      return (
                        <StepperItem
                          key={event.id}
                          isLast={index === renderedConversation.length - 1}
                          indicator={<StepIndicator status="done" />}
                          className="oc-refined-stepper-item group"
                        >
                          <div className="flex min-w-0 flex-col items-start gap-2 w-full">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="oc-refined-event-label">{label}</span>
                              <span className="text-[10px] font-medium text-oc-text-soft">
                                {new Date(event.createdAt).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                })}
                              </span>
                            </div>
                            <div className="oc-refined-event-content w-full">
                              <MarkdownRenderer content={event.text} className="markdown-body" />
                            </div>
                          </div>
                        </StepperItem>
                      );
                    })}
                  </Stepper>
                ) : (
                  <div className="rounded-xl border border-oc-border-soft bg-oc-bg-soft/50 p-4 sm:p-5 text-[13px] leading-relaxed text-oc-text shadow-sm transition-colors hover:bg-oc-bg-soft/80">
                    <MarkdownRenderer content={assistantUpdateText} className="markdown-body" />
                  </div>
                )}
              </section>
            ) : null}

            <section>
              <div className="mb-2 sm:mb-3 flex items-center gap-2">
                <div className="h-4 w-1 rounded-full bg-oc-brand" />
                <span className="text-[11px] font-bold uppercase tracking-[0.15em] oc-text-secondary">
                  Background Output
                </span>
              </div>
              <div className="rounded-xl border border-oc-border-soft bg-oc-bg-soft/50 p-4 sm:p-5 text-[13px] leading-relaxed text-oc-text shadow-sm transition-colors hover:bg-oc-bg-soft/80">
                <MarkdownRenderer content={parsedOutput.rawText || detail?.output || "No output provided."} className="markdown-body" />
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
                  <span className="inline-flex w-fit items-center rounded-md bg-oc-panel-soft px-2 py-1 text-xs font-medium text-oc-text capitalize border border-oc-border-soft shadow-sm">{parsedOutput.statusLabel || detail?.status || "Unknown"}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider oc-text-secondary">Agent</span>
                  <span className="font-medium text-oc-text capitalize">{parsedOutput.agent || detail?.agentRole || "Default"}</span>
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2 md:col-span-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider oc-text-secondary">Task ID</span>
                  <span className="font-mono text-oc-text-soft text-[11px] break-all">{parsedOutput.taskId || detail?.backgroundTaskId || "Unavailable"}</span>
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
  assistantUpdateText,
  assistantConversationEvents,
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
      <div className="oc-activity-step-surface flex flex-col items-start gap-1.5 w-full min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap min-h-[18px]">
          <span className="oc-activity-step-title font-medium text-oc-text capitalize">
            Background Task Note
          </span>
          {description && description.toLowerCase() !== "background_output" && (
            <span className="oc-activity-step-meta flex items-center gap-1.5 text-oc-text-soft">
              <span>&middot;</span>
              <span>{description}</span>
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1 w-full">
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="group relative w-full overflow-hidden rounded-lg border border-oc-border-soft bg-oc-bg-soft/60 text-left transition-colors hover:border-oc-border hover:bg-oc-panel-soft/60"
            aria-label="View background output details"
          >
            <div className="relative overflow-hidden p-2">
              <div className="oc-activity-step-summary flex items-start gap-1.5 whitespace-pre-wrap break-words font-mono text-oc-text-soft">
                <span className="flex-1">{previewOutput || "Background output received"}</span>
              </div>
              {compactTaskId && (
                <div className="oc-activity-step-meta mt-1 font-mono text-oc-text-soft/40">
                  {compactTaskId}
                </div>
              )}
            </div>
            <div className="oc-timeline-caret pointer-events-none absolute bottom-1.5 right-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors group-hover:bg-oc-panel-soft">
              <ChevronDown className="h-3 w-3 oc-text-secondary transition-transform group-hover:translate-y-0.5" />
            </div>
          </button>
        </div>
      </div>

      {/* Modal Dialog for Full Detail Payload */}
      <BackgroundOutputModal
        isOpen={isModalOpen}
        title="Background Output"
        detail={activityDetail}
        parsedOutput={parsedOutput}
        assistantUpdateText={assistantUpdateText}
        assistantConversationEvents={assistantConversationEvents}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
