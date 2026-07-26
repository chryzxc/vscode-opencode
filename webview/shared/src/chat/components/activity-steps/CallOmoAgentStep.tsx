import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { Bot, Clock3, Copy, Sparkles, ArrowRight, X } from "lucide-react";

import { cn, formatDuration } from "@/utils";

import { MarkdownRenderer } from "../../../components/MarkdownRenderer";
import { ActivityStepStatusChip } from "./ActivityStepStatusChip";
import { StepIndicator } from "@/components/ui/StepIndicator";
import { Stepper, StepperItem } from "@/components/ui/stepper";
import { shallowEqual, useAppState } from "../../lib/store";
import { useAppDispatch } from "../../lib/store";
import { buildBackgroundTaskPresentation } from "../../lib/backgroundTaskPresentation";
import { usePersistentModalOpen } from "../../lib/usePersistentModalOpen";
import { formatCallOmoAgentAsSubagentDetail } from "../../lib/subagents/callOmoFormatter";
import { SubagentDetailModal } from "../../SubagentDetailModal";
import {
  FadedCollapseOverlay,
  useFadedContentOverflow,
} from "@/components/ui/FadedCollapseOverlay";

import type { ActivityDetail } from "../../lib/types";
import type { SubagentDetail } from "../../lib/subagents/types";
import { copyToClipboard } from "../../lib/clipboard";

type CallOmoAgentStepProps = {
  callID?: string;
  sessionID?: string;
  parentSessionId?: string;
  parentMessageId?: string;
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
  assistantUpdateText,
  assistantConversationEvents,
  backgroundOutput,
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
  assistantUpdateText?: string;
  assistantConversationEvents?: Array<{
    id: string;
    text: string;
    kind: string;
    createdAt: number;
  }>;
  backgroundOutput?: string;
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
      await copyToClipboard(detailText);
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
            {(Array.isArray(assistantConversationEvents) && assistantConversationEvents.length > 0) || assistantUpdateText ? (
              <section>
                <div className="mb-2 sm:mb-3 flex items-center gap-2">
                  <div className="h-4 w-1 rounded-full bg-oc-brand" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.15em] oc-text-secondary">
                    Assistant Update
                  </span>
                </div>
                {Array.isArray(assistantConversationEvents) && assistantConversationEvents.length > 0 ? (
                  <Stepper
                    className="oc-refined-stepper oc-activity-timeline-compact pl-2"
                    autoScrollToBottom={false}
                  >
                    {assistantConversationEvents.map((event, index) => (
                      <StepperItem
                        key={event.id}
                        isLast={index === assistantConversationEvents.length - 1}
                        indicator={<StepIndicator status="done" />}
                        className="oc-refined-stepper-item group"
                      >
                        <div className="flex min-w-0 flex-col items-start gap-2 w-full">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="oc-refined-event-label">
                              {event.kind === "reasoning"
                                ? "Reasoning"
                                : event.kind === "step"
                                  ? "Step"
                                  : "Message"}
                            </span>
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
                    ))}
                  </Stepper>
                ) : (
                  <div className="rounded-xl border border-oc-border-soft bg-oc-bg-soft/50 p-4 sm:p-5 text-[13px] leading-relaxed text-oc-text shadow-sm transition-colors hover:bg-oc-bg-soft/80">
                    <MarkdownRenderer content={assistantUpdateText} className="markdown-body" />
                  </div>
                )}
              </section>
            ) : null}

            {backgroundOutput ? (
              <section>
                <div className="mb-2 sm:mb-3 flex items-center gap-2">
                  <div className="h-4 w-1 rounded-full bg-oc-brand/80" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.15em] oc-text-secondary">
                    Background Output
                  </span>
                </div>
                <div className="rounded-xl border border-oc-border-soft bg-oc-bg-soft/50 p-4 sm:p-5 text-[13px] leading-relaxed text-oc-text shadow-sm transition-colors hover:bg-oc-bg-soft/80">
                  <MarkdownRenderer content={backgroundOutput} className="markdown-body" />
                </div>
              </section>
            ) : null}

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
  parentSessionId,
  parentMessageId,
  startedAt,
  endedAt,
  status,
  source,
  activityDetail,
}: CallOmoAgentStepProps) {
  const dispatch = useAppDispatch();
  const { messages, subagentDetailsById } = useAppState(
    (state) => ({
      messages: state.messages,
      subagentDetailsById: state.subagentDetailsById,
    }),
    shallowEqual,
  );
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
  const backgroundTaskPresentation = useMemo(
    () =>
      buildBackgroundTaskPresentation({
        taskId: resolvedBackgroundTaskId,
        messages,
      }),
    [messages, resolvedBackgroundTaskId],
  );
  const linkedSubagent = useMemo(() => {
    const details = Object.values(subagentDetailsById ?? {}) as SubagentDetail[];
    return details.find((detail) =>
      (resolvedBackgroundTaskId && detail.backgroundTaskId === resolvedBackgroundTaskId) ||
      (sessionValue && detail.childSessionId === sessionValue),
    );
  }, [subagentDetailsById, resolvedBackgroundTaskId, sessionValue]);
  const modalDetail = useMemo(
    () => linkedSubagent || formatCallOmoAgentAsSubagentDetail({
      callID,
      parentSessionId,
      parentMessageId,
      childSessionId: sessionValue,
      startedAt,
      endedAt,
      status,
      activityDetail,
    }),
    [linkedSubagent, callID, parentSessionId, parentMessageId, sessionValue, startedAt, endedAt, status, activityDetail],
  );
  const [isModalOpen, setIsModalOpen] = usePersistentModalOpen(
    `call-omo-agent:${resolvedBackgroundTaskId || sessionValue || description}`,
  );
  const { ref: previewRef, hasOverflow } = useFadedContentOverflow<HTMLDivElement>();
  const modalTitle = "call_omo_agent";
  const summaryLine =
    description ||
    prompt ||
    "Background agent launched";

  return (
    <>
      <div className="oc-activity-step-surface flex flex-col items-start gap-1.5 w-full min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap min-h-[18px]">
          <span className="oc-activity-step-title font-medium text-oc-text capitalize">
            Invoke Subagent
          </span>
          {agent && (
            <span className="oc-activity-step-meta flex items-center gap-1.5 text-oc-text-soft">
              <span>&middot;</span>
              <span>{agent}</span>
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1 w-full">
          <button
            type="button"
            onClick={() => {
              if (linkedSubagent) {
                dispatch({ type: "SELECT_SUBAGENT", payload: linkedSubagent.id });
                return;
              }
              setIsModalOpen(true);
            }}
            className="group relative w-full overflow-hidden rounded-lg border border-oc-border-soft bg-oc-bg-soft/60 text-left transition-colors hover:border-oc-border hover:bg-oc-panel-soft/60"
            aria-label="View subagent details"
          >
            <div className="relative max-h-[140px] overflow-hidden p-2">
              <div className="oc-activity-step-summary flex items-start gap-1.5 whitespace-pre-wrap break-words font-mono text-oc-text-soft">
                <span className="flex-1">{summaryLine}</span>
              </div>
              {(resolvedBackgroundTaskId || sessionValue) && (
                <div className="oc-activity-step-meta mt-1 font-mono text-oc-text-soft/40">
                  {resolvedBackgroundTaskId || sessionValue}
                </div>
              )}
            </div>
          </button>
        </div>
      </div>
      <SubagentDetailModal
        isOpen={isModalOpen}
        title="Invoke Subagent"
        detail={modalDetail}
        parentResponseFinished={false}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
