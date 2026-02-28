import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Check,
  Copy,
  FileText as FileTextIcon,
  Loader2,
  X,
  Sparkles,
} from "lucide-react";
import { marked } from "marked";

import { cn } from "@/utils";

import type {
  Message,
  MessagePart,
  MessageStep,
  StreamingState,
  StreamingStep,
  SubagentSummary,
} from "./lib/types";
import { useAppDispatch, useAppState } from "./lib/store";
import { jumpToMessage } from "./lib/messageJump";
import vscode from "./lib/vscode";

// File extension color mapping for icons
const FILE_COLOR_MAP: Record<string, string> = {
  ts: "#3178c6",
  js: "#f1e05a",
  tsx: "#3178c6",
  jsx: "#f1e05a",
  css: "#563d7c",
  html: "#e34c26",
  json: "#f1e05a",
  md: "#083fa1",
  vue: "#41b883",
  py: "#3572A5",
  go: "#00ADD8",
  java: "#b07219",
  rs: "#dea584",
  php: "#4F5D95",
  rb: "#701516",
  swift: "#ffac45",
  kt: "#F18E33",
  c: "#555555",
  cpp: "#f34b7d",
  h: "#a8ff97",
  hpp: "#a8ff97",
};

// Extract file extension from path
function getFileExtension(path: string): string {
  const match = path.match(/\.([a-zA-Z0-9]+)(?::|:|$)/);
  return match ? match[1].toLowerCase() : "";
}

// Get color for file extension
function getFileColor(ext: string): string {
  return FILE_COLOR_MAP[ext] || "var(--oc-text-muted)";
}

// SVG file icon
function FileIcon({ filePath }: { filePath?: string }) {
  const ext = filePath ? getFileExtension(filePath) : "";
  const color = getFileColor(ext);
  return (
    <svg
      role="img"
      aria-label={filePath ?? "file"}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className="file-icon-svg"
    >
      <title>{filePath ?? "file"}</title>
      <path
        d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={color}
        fillOpacity="0.1"
      ></path>
      <polyline
        points="14 2 14 8 20 8"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      ></polyline>
    </svg>
  );
}

function InlineProgressSteps({ steps }: { steps: StreamingState["steps"] }) {
  const [open, setOpen] = useState(true);
  if (!steps.length) {
    return null;
  }

  return (
    <div className="oc-steps-wrap mt-3 p-2.5">
      <button
        type="button"
        className="oc-steps-header mb-2 flex w-full items-center gap-1.5 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        Progress Updates ({steps.length})
      </button>
      {open ? (
        <div className="space-y-1">
          {steps.map((step, index) => {
            // Detect file path from step title
            const fileMatch = step.title.match(
              /([a-zA-Z0-9_\-\.\/\\ +]+?\.[a-zA-Z0-9]+)(?::L\d+(?:-L\d+)?)?/,
            );
            const filePath = fileMatch
              ? fileMatch[1].trim()
              : (step as any).filePath;

            if (filePath) {
              return (
                <button
                  key={`${step.id ?? step.callID ?? step.title}-${index}`}
                  type="button"
                  className="oc-step-item file-step flex items-center gap-2 px-2.5 py-1.5 text-xs"
                  onClick={() =>
                    vscode.postMessage({ type: "openFile", file: filePath })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      vscode.postMessage({ type: "openFile", file: filePath });
                    }
                  }}
                  title={`Click to open ${filePath}`}
                >
                  <div className="step-icon shrink-0">
                    <FileIcon filePath={filePath} />
                  </div>
                  <div className="step-content flex-1 min-w-0">
                    <div className="step-title text-oc-text-soft opacity-80 truncate">
                      {step.title}
                    </div>
                  </div>
                </button>
              );
            }

            return (
              <div
                key={`${step.id ?? step.callID ?? step.title}-${index}`}
                className="oc-step-item flex items-center gap-2 px-2.5 py-1.5 text-xs"
              >
                {step.status === "pending" ? (
                  <div className="step-icon shrink-0">
                    <Loader2 className="h-3 w-3 animate-spin text-oc-accent" />
                  </div>
                ) : step.status === "error" ? (
                  <div className="step-icon shrink-0">
                    <X className="h-3 w-3 text-oc-red" />
                  </div>
                ) : (
                  <div className="step-icon shrink-0">
                    <Check className="h-3 w-3 text-oc-green" />
                  </div>
                )}
                <div className="step-content flex-1 min-w-0">
                  <div className="step-title text-oc-text-soft opacity-80 truncate">
                    {step.title}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function messageBodyFromParts(parts?: MessagePart[]): string {
  if (!parts) {
    return "";
  }
  return parts
    .map((part) => {
      const isReasoning =
        part.type === "reasoning" ||
        !!part.reasoning ||
        !!part.thought ||
        !!part.thinking;
      if (isReasoning) {
        return "";
      }
      return part.text ?? part.content ?? "";
    })
    .join("")
    .trim();
}

function reasoningFromParts(parts?: MessagePart[]): string {
  if (!parts) {
    return "";
  }
  return parts
    .map((part) => {
      const explicit = part.reasoning ?? part.thought ?? part.thinking;
      if (explicit) {
        return explicit;
      }
      if (part.type === "reasoning") {
        return part.text ?? part.content ?? "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function summaryText(message?: Message): string {
  const title = message?.info?.summary?.title?.trim() ?? "";
  const body = message?.info?.summary?.body?.trim() ?? "";
  if (title && body) {
    return `${title}\n\n${body}`;
  }
  return title || body;
}

function modelLabel(message: Message): string {
  const modelObj = message.info?.model;
  if (modelObj && typeof modelObj === "object") {
    const name = (modelObj as Record<string, unknown>).name;
    const modelID = (modelObj as Record<string, unknown>).modelID;
    if (typeof name === "string" && name) return name;
    if (typeof modelID === "string" && modelID) return modelID;
  }
  const model = message.info?.modelID;
  const provider = message.info?.providerID;
  if (model && provider) return `${provider}/${model}`;
  return model ?? provider ?? "assistant";
}

function getMessageContent(
  message?: Message,
  streaming?: StreamingState,
): string {
  if (streaming) {
    return streaming.content || streaming.reasoning;
  }
  if (!message) {
    return "";
  }
  const candidates = [
    message.content,
    message.text,
    messageBodyFromParts(message.parts),
    summaryText(message),
    reasoningFromParts(message.parts),
  ];
  return (
    candidates.find(
      (candidate) =>
        typeof candidate === "string" && candidate.trim().length > 0,
    ) ?? ""
  );
}

type ThoughtItem = { key: string; text: string };
type ProgressItem = {
  key: string;
  title: string;
  status: "pending" | "done" | "error";
  meta?: string;
  filePath?: string;
};

function thoughtItemsFromMessage(message?: Message): ThoughtItem[] {
  const eventItems = (message?.reasoningEvents ?? [])
    .map((event, index) => ({
      key: `evt-${index}-${event.createdAt}`,
      text: event.text.trim(),
    }))
    .filter((event) => event.text.length > 0);
  if (eventItems.length > 0) {
    return eventItems;
  }

  return (message?.parts ?? [])
    .map((part, index) => {
      const text =
        part.reasoning ??
        part.thought ??
        part.thinking ??
        (part.type === "reasoning" ? (part.text ?? part.content ?? "") : "");
      return { key: `part-${index}`, text: text.trim() };
    })
    .filter((item) => item.text.length > 0);
}

function thoughtItemsFromStreaming(streaming?: StreamingState): ThoughtItem[] {
  if (!streaming) {
    return [];
  }
  const eventItems = (streaming.reasoningEvents ?? [])
    .map((event, index) => ({
      key: `stream-${index}-${event.createdAt}`,
      text: event.text.trim(),
    }))
    .filter((event) => event.text.length > 0);
  if (eventItems.length > 0) {
    return eventItems;
  }

  const fallback = streaming.reasoning.trim();
  return fallback ? [{ key: "stream-reasoning-fallback", text: fallback }] : [];
}

function normalizeProgressStatus(value?: string): "pending" | "done" | "error" {
  if (value === "done" || value === "error") {
    return value;
  }
  return "pending";
}

function isActionProgressStep(step: MessageStep | StreamingStep): boolean {
  const type = (step.type ?? "").toLowerCase();
  if (type === "reasoning") {
    return false;
  }

  const title = step.title.trim().toLowerCase();
  if (title === "thinking..." || title === "thinking") {
    return false;
  }

  return true;
}

function progressItemsFromSteps(
  steps: Array<MessageStep | StreamingStep>,
  prefix: string,
): ProgressItem[] {
  const seen = new Set<string>();
  return steps
    .filter((step) => isActionProgressStep(step))
    .reduce<ProgressItem[]>((acc, step, index) => {
      const itemKey = `${step.title}-${normalizeProgressStatus(step.status)}`;
      if (!seen.has(itemKey)) {
        seen.add(itemKey);
        acc.push({
          key: `${prefix}-${index}-${step.title}`,
          title: step.title,
          status: normalizeProgressStatus(step.status),
          meta: step.meta,
          filePath:
            "filePath" in step
              ? (step as StreamingStep).filePath
              : ((step as MessageStep).content ?? undefined),
        });
      }
      return acc;
    }, []);
}

function progressItemsFromMessage(message?: Message): ProgressItem[] {
  if (!message) {
    return [];
  }
  if (
    Array.isArray(message.progressEvents) &&
    message.progressEvents.length > 0
  ) {
    return progressItemsFromSteps(
      message.progressEvents,
      "msg-progress-events",
    );
  }
  if (Array.isArray(message.steps) && message.steps.length > 0) {
    return progressItemsFromSteps(message.steps, "msg-steps");
  }
  return [];
}

function progressItemsFromStreaming(
  streaming?: StreamingState,
): ProgressItem[] {
  if (!streaming) {
    return [];
  }
  if (
    Array.isArray(streaming.progressEvents) &&
    streaming.progressEvents.length > 0
  ) {
    return progressItemsFromSteps(
      streaming.progressEvents,
      "stream-progress-events",
    );
  }
  if (Array.isArray(streaming.steps) && streaming.steps.length > 0) {
    return progressItemsFromSteps(streaming.steps, "stream-steps");
  }
  return [];
}

function formatDurationMs(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
    return "n/a";
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}

function statusBadgeClass(status: string): string {
  if (status === "done") return "text-oc-green border-oc-border";
  if (status === "error") return "text-oc-red border-oc-border";
  if (status === "running") return "text-oc-accent border-oc-border";
  if (status === "orphaned") return "text-oc-yellow border-oc-border";
  return "text-oc-text-muted border-oc-border";
}

function sanitizeUserContent(raw: string): string {
  return raw
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
}

export function UserMessage({ message }: { message: Message }) {
  const rawContent =
    message.content ?? message.text ?? messageBodyFromParts(message.parts);
  const content = sanitizeUserContent(rawContent);
  const fileChips = (message.parts ?? [])
    .map((part) => part.filename ?? part.source?.path)
    .filter((value): value is string => !!value);

  return (
    <div className="oc-message-enter mb-5 flex items-end justify-end gap-2.5 px-4">
      <div className="w-fit max-w-[78%]">
        <div className="oc-msg-user">
          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {content}
          </div>
          {fileChips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {fileChips.map((file) => (
                <span
                  key={file}
                  className="rounded-md border oc-accent-border-faint px-2 py-0.5 text-oc-2xs font-mono text-oc-text-soft opacity-70"
                >
                  {file}
                </span>
              ))}
            </div>
          )}
          {message.images && message.images.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {message.images.map((src) => (
                <img
                  key={src}
                  src={src}
                  alt="attachment"
                  className="max-h-20 rounded-lg border border-oc-border"
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function AssistantMessage({
  message,
  streaming,
}: {
  message?: Message;
  streaming?: StreamingState;
}) {
  const dispatch = useAppDispatch();
  const { subagentsByParentMessageId } = useAppState();
  const [showThoughts, setShowThoughts] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [showSubagents, setShowSubagents] = useState(false);
  const [showAllSubagents, setShowAllSubagents] = useState(false);
  const [copied, setCopied] = useState(false);
  const content = getMessageContent(message, streaming);
  const parsed = marked.parse(content || "");
  const html = typeof parsed === "string" ? parsed : "";
  const thoughtItems = useMemo(
    () =>
      streaming
        ? thoughtItemsFromStreaming(streaming)
        : thoughtItemsFromMessage(message),
    [streaming, message],
  );
  const progressItems = useMemo(
    () =>
      streaming
        ? progressItemsFromStreaming(streaming)
        : progressItemsFromMessage(message),
    [streaming, message],
  );
  const previousThoughtCount = useRef(thoughtItems.length);
  const previousProgressCount = useRef(progressItems.length);

  useEffect(() => {
    const hasNewThought = thoughtItems.length > previousThoughtCount.current;
    previousThoughtCount.current = thoughtItems.length;
    if (streaming && hasNewThought) {
      setShowThoughts(true);
    }
  }, [streaming, thoughtItems.length]);

  useEffect(() => {
    const hasNewProgress = progressItems.length > previousProgressCount.current;
    previousProgressCount.current = progressItems.length;
    if (streaming && hasNewProgress) {
      setShowProgress(true);
    }
  }, [streaming, progressItems.length]);
  const info = message?.info;
  const plan = message?.plan;
  const messageId = info?.id;
  // Merge subagents from message data and from the store lookup by parent message ID
  const subagents = useMemo(() => {
    const fromMessage = Array.isArray(message?.subagents)
      ? message.subagents
      : [];
    const fromStore = messageId
      ? (subagentsByParentMessageId[messageId] ?? [])
      : [];
    if (fromStore.length === 0) return fromMessage;
    if (fromMessage.length === 0) return fromStore;
    // Merge: store entries take precedence (more up-to-date), then append message-only entries
    const storeIds = new Set(fromStore.map((s: SubagentSummary) => s.id));
    const extra = fromMessage.filter((s) => !storeIds.has(s.id));
    return [...fromStore, ...extra];
  }, [message, messageId, subagentsByParentMessageId]);
  const previousSubagentCount = useRef(subagents.length);

  useEffect(() => {
    const hasNewSubagent = subagents.length > previousSubagentCount.current;
    previousSubagentCount.current = subagents.length;
    if (streaming && hasNewSubagent) {
      setShowSubagents(true);
    }
  }, [streaming, subagents.length]);
  const visibleSubagents = showAllSubagents
    ? subagents
    : subagents.slice(0, 10);
  const showStreamingLoading = !message && !!streaming?.isActive;
  const agentName = info?.agent ?? "assistant";
  const modelName = modelLabel(message ?? ({} as Message));
  const inputTok = info?.tokens?.input ?? 0;
  const outputTok = info?.tokens?.output ?? 0;
  const cacheRead = info?.tokens?.cache?.read ?? 0;
  const cacheWrite = info?.tokens?.cache?.write ?? 0;
  const duration =
    info?.duration ?? message?.timing?.duration ?? streaming?.usage?.duration;
  const hasTokens = inputTok > 0 || outputTok > 0;
  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const openSubagentDetails = (subagentId: string) => {
    dispatch({ type: "SELECT_SUBAGENT", payload: subagentId });
    dispatch({ type: "SET_SUBAGENTS_PANEL_OPEN", payload: true });
  };
  return (
    <div
      id={messageId ? `msg-${messageId}` : undefined}
      data-message-id={messageId || undefined}
      className="oc-message-enter mb-5 px-4"
    >
      <div className="oc-msg-assistant">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {showStreamingLoading ? (
              <div className="inline-flex items-center gap-1.5 oc-msg-agent-label font-mono">
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-oc-accent"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-oc-accent"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-oc-accent"
                  style={{ animationDelay: "300ms" }}
                />
                <span className="ml-1 oc-msg-model-label">Thinking...</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="oc-agent-icon">
                    <Sparkles className="h-2.5 w-2.5" />
                  </div>
                  <span className="oc-msg-agent-label font-mono">
                    {agentName}
                    {modelName && modelName !== "assistant" ? (
                      <span className="oc-msg-model-label"> - {modelName}</span>
                    ) : (
                      ""
                    )}
                  </span>
                </div>
                {hasTokens && (
                  <div className="oc-msg-token-chips flex shrink-0 items-center gap-1">
                    <span>in</span>
                    <span className="tabular-nums">
                      {inputTok.toLocaleString()}
                    </span>
                    <span className="opacity-30">-</span>
                    <span>out</span>
                    <span className="tabular-nums">
                      {outputTok.toLocaleString()}
                    </span>
                    {cacheRead > 0 && (
                      <>
                        <span className="opacity-30">-</span>
                        <span>cr</span>
                        <span className="tabular-nums">
                          {cacheRead.toLocaleString()}
                        </span>
                      </>
                    )}
                    {cacheWrite > 0 && (
                      <>
                        <span className="opacity-30">-</span>
                        <span>cw</span>
                        <span className="tabular-nums">
                          {cacheWrite.toLocaleString()}
                        </span>
                      </>
                    )}
                    {typeof duration === "number" && (
                      <>
                        <span className="opacity-30">-</span>
                        <span className="tabular-nums">
                          {duration.toFixed(1)}s
                        </span>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {plan ? (
              <button
                type="button"
                title="Core Feature: View Implementation Plan"
                onClick={() => vscode.postMessage({ type: "viewPlan", plan })}
                className="oc-plan-btn"
              >
                <FileTextIcon className="h-3 w-3" /> View Plan
              </button>
            ) : null}
            <button
              type="button"
              className="oc-msg-copy-btn h-6 w-6"
              onClick={handleCopy}
              title="Copy message"
            >
              {copied ? (
                <Check className="h-3 w-3 text-oc-green" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          </div>
        </div>
        {/* Progress Updates — compact GitHub Copilot–style stack, shown before response content */}
        {progressItems.length > 0 && (
          <details
            className="group mb-3"
            open={showProgress}
            onToggle={(e) =>
              setShowProgress((e.target as HTMLDetailsElement).open)
            }
          >
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-oc-xs font-mono text-oc-text-muted hover:text-oc-text-soft transition-colors">
              <span className="inline-block text-oc-2xs transition-transform group-open:rotate-90">
                ›
              </span>
              <span className="opacity-70">{progressItems.length} step{progressItems.length !== 1 ? "s" : ""}</span>
            </summary>
            <div className="mt-1.5 ml-0.5 border-l border-oc-border pl-3 space-y-0.5">
              {progressItems.map((event) => (
                <div
                  key={event.key}
                  className="flex items-start gap-1.5 py-0.5 text-xs"
                >
                  <span className="mt-px shrink-0">
                    {event.status === "pending" ? (
                      <Loader2 className="h-3 w-3 animate-spin text-oc-accent" />
                    ) : event.status === "error" ? (
                      <X className="h-3 w-3 text-oc-red" />
                    ) : (
                      <Check className="h-3 w-3 text-oc-green opacity-70" />
                    )}
                  </span>
                  <span className={`min-w-0 flex-1 leading-relaxed ${event.status === "pending" ? "text-oc-text" : "text-oc-text-soft opacity-80"}`}>
                    {event.title}
                    {event.meta ? (
                      <span className="ml-1.5 text-oc-text-muted opacity-60">{event.meta}</span>
                    ) : null}
                    {event.filePath ? (
                      <button
                        type="button"
                        className="ml-1.5 inline-flex items-center gap-1 font-mono text-oc-text-muted opacity-60 hover:text-oc-accent hover:opacity-100 transition-colors"
                        onClick={() =>
                          vscode.postMessage({
                            type: "openFile",
                            file: event.filePath,
                          })
                        }
                      >
                        <FileIcon filePath={event.filePath} />
                        {event.filePath.split(/[/\\]/).pop()}
                      </button>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
        <div className="mb-3">
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: markdown rendering requires HTML injection */}
          <div
            className="markdown-body text-sm"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
        {/* Thinking — compact collapsible, shown after response */}
        {thoughtItems.length > 0 && (
          <details
            className="group mb-3"
            open={showThoughts}
            onToggle={(e) =>
              setShowThoughts((e.target as HTMLDetailsElement).open)
            }
          >
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-oc-xs font-mono text-oc-text-muted hover:text-oc-text-soft transition-colors">
              <span className="inline-block text-oc-2xs transition-transform group-open:rotate-90">
                ›
              </span>
              <span className="opacity-70">Thinking ({thoughtItems.length})</span>
              <span className="truncate opacity-50 text-oc-2xs">
                {thoughtItems[thoughtItems.length - 1]?.text.slice(0, 52)}
              </span>
            </summary>
            <div className="mt-1.5 ml-0.5 border-l border-oc-border pl-3 space-y-0.5">
              {thoughtItems.map((thought) => (
                <div
                  key={thought.key}
                  className="py-0.5 text-xs leading-relaxed text-oc-text-soft opacity-70 whitespace-pre-wrap"
                >
                  {thought.text}
                </div>
              ))}
            </div>
          </details>
        )}
        {subagents.length > 0 && (
          <details
            className="group mb-3"
            open={showSubagents}
            onToggle={(e) =>
              setShowSubagents((e.target as HTMLDetailsElement).open)
            }
          >
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-oc-xs font-mono text-oc-text-muted hover:text-oc-text-soft transition-colors">
              <span className="inline-block text-oc-2xs transition-transform group-open:rotate-90">
                ›
              </span>
              <span className="opacity-70">Spawned Agents ({subagents.length})</span>
              <span className="truncate opacity-50 text-oc-2xs">
                {subagents[subagents.length - 1]?.latestActivity}
              </span>
            </summary>
            <div className="mt-2 space-y-1.5">
              {visibleSubagents.map((subagent: SubagentSummary) => (
                <div
                  key={subagent.id}
                  className="rounded-md border border-oc-border bg-oc-panel-soft px-2.5 py-2 text-xs"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-oc-2xs uppercase tracking-wider ${statusBadgeClass(subagent.status)}`}
                    >
                      {subagent.status}
                    </span>
                    <span className="font-mono text-oc-2xs text-oc-text-muted">
                      {formatDurationMs(subagent.durationMs)}
                    </span>
                  </div>
                  <div className="truncate text-oc-text-soft">
                    {subagent.agentId || "subagent"}{" "}
                    {subagent.providerID && subagent.modelID
                      ? `- ${subagent.providerID}/${subagent.modelID}`
                      : ""}
                  </div>
                  <div className="mt-0.5 truncate text-oc-text-muted">
                    {subagent.latestActivity || "No activity yet"}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="text-oc-2xs font-mono text-oc-accent hover:underline"
                      onClick={() => openSubagentDetails(subagent.id)}
                    >
                      Open details
                    </button>
                    <button
                      type="button"
                      className="text-oc-2xs font-mono text-oc-text-muted hover:text-oc-accent"
                      onClick={() =>
                        jumpToMessage(
                          subagent.parentMessageId || messageId || "",
                        )
                      }
                    >
                      Jump to message
                    </button>
                    <button
                      type="button"
                      className="text-oc-2xs font-mono text-oc-text-muted hover:text-oc-accent"
                      onClick={() => openSubagentDetails(subagent.id)}
                    >
                      View timeline
                    </button>
                  </div>
                </div>
              ))}
              {subagents.length > 10 ? (
                <button
                  type="button"
                  className="text-oc-2xs font-mono text-oc-accent hover:underline"
                  onClick={() => setShowAllSubagents((value) => !value)}
                >
                  {showAllSubagents
                    ? "Show less"
                    : `Show all (${subagents.length})`}
                </button>
              ) : null}
            </div>
          </details>
        )}
        {/* Raw Data — moved last so it doesn't interrupt the reading flow */}
        {(message || streaming) && (
          <details className="group mb-3">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-oc-xs font-mono text-oc-text-muted hover:text-oc-text-soft transition-colors">
              <span className="inline-block text-oc-2xs transition-transform group-open:rotate-90">
                ›
              </span>
              <span className="opacity-50">Raw Data</span>
            </summary>
            <div className="mt-2 rounded-md border border-oc-border bg-oc-panel-soft p-2.5">
              <pre className="overflow-x-auto text-oc-2xs font-mono text-oc-text-soft whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                {JSON.stringify(
                  {
                    message: message
                      ? {
                          id: message.id,
                          role: message.role,
                          contentLength:
                            message.content?.length ||
                            message.text?.length ||
                            0,
                          partsCount: message.parts?.length || 0,
                          info: message.info,
                          hasReasoning:
                            !!message.reasoningEvents?.length ||
                            !!message.parts?.some(
                              (p) => p.reasoning || p.thought || p.thinking,
                            ),
                          hasSteps: !!message.steps?.length,
                          hasProgressEvents: !!message.progressEvents?.length,
                          hasSubagents: !!message.subagents?.length,
                          hasPlan: !!message.plan,
                          createdAt: message.info?.created,
                          duration: message.info?.duration,
                        }
                      : null,
                    streaming: streaming
                      ? {
                          isActive: streaming.isActive,
                          contentLength: streaming.content?.length || 0,
                          stepsCount: streaming.steps?.length || 0,
                          progressEventsCount:
                            streaming.progressEvents?.length || 0,
                          partsCount: streaming.parts?.length || 0,
                          hasError: !!streaming.error,
                          error: streaming.error,
                          role: streaming.role,
                          info: streaming.info,
                        }
                      : null,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          </details>
        )}
        {/* FORBIDDEN TO REMOVE: Plan card rendering - core UI element for viewing implementation plans */}
        {plan ? (
          <div className="plan-card mt-3 p-3">
            <div className="mb-2 text-oc-xs font-semibold text-oc-text-soft uppercase tracking-widest font-mono">
              Implementation Plan
            </div>
            <button
              type="button"
              title="Core Feature: Do not remove"
              onClick={() => vscode.postMessage({ type: "viewPlan", plan })}
              className="oc-plan-btn"
            >
              <FileTextIcon className="h-3 w-3" />
              View Implementation Plan
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
export function PermissionCard({ perm }: { perm: unknown }) {
  const label = typeof perm === "string" ? perm : JSON.stringify(perm);
  return (
    <div className="oc-message-enter mb-5 px-4">
      <div className="rounded-xl border oc-warning-border oc-warning-bg p-3.5">
        <div className="mb-1.5 flex items-center gap-2">
          <div className="h-4 w-4 rounded-sm bg-[rgba(210,153,34,0.2)] flex items-center justify-center">
            <span className="text-oc-2xs">⚠</span>
          </div>
          <div className="text-oc-sm font-semibold text-oc-yellow">
            Permission Required
          </div>
        </div>
        <div className="text-oc-sm text-oc-text-soft opacity-70 leading-relaxed">
          {label}
        </div>
      </div>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-3 px-4">
      <div className="rounded-lg border border-oc-red/30 bg-oc-red/5 px-3.5 py-2.5 text-oc-sm text-oc-red leading-relaxed">
        {message}
      </div>
    </div>
  );
}

export function ThinkingBubble() {
  return (
    <div className="mb-4 px-4">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-oc-border bg-oc-panel px-3 py-2">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className={cn(
              "h-1.5 w-1.5 rounded-full bg-oc-accent",
              index > 0 ? "ml-0.5" : "",
            )}
            style={{
              animation: `thinking-pulse 1.3s ${index * 0.16}s infinite`,
            }}
          />
        ))}
        <Loader2 className="ml-1.5 h-3 w-3 animate-spin text-oc-text-soft opacity-70" />
        <span className="ml-1 text-oc-xs text-oc-text-soft opacity-70 font-mono">
          Thinking…
        </span>
      </div>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="oc-empty-icon mb-4">
        <Sparkles className="h-6 w-6" />
      </div>
      <div className="text-xl font-semibold text-oc-text tracking-tight mb-1">
        OpenCode
      </div>
      <div className="text-sm text-oc-text-soft opacity-70 max-w-[240px] leading-relaxed">
        AI-powered coding assistant. Ask anything, build anything.
      </div>
      <div className="mt-6 flex flex-col items-center gap-2 text-oc-xs text-oc-text-soft opacity-70 font-mono">
        <span className="flex items-center gap-2">
          <kbd className="rounded border border-oc-border bg-oc-panel-soft px-1.5 py-0.5 text-oc-2xs">
            Enter
          </kbd>
          send message
        </span>
        <span className="flex items-center gap-2">
          <kbd className="rounded border border-oc-border bg-oc-panel-soft px-1.5 py-0.5 text-oc-2xs">
            @
          </kbd>
          mention files
        </span>
        <span className="flex items-center gap-2">
          <kbd className="rounded border border-oc-border bg-oc-panel-soft px-1.5 py-0.5 text-oc-2xs">
            /
          </kbd>
          commands
        </span>
      </div>
    </div>
  );
}

export function MessageStatus({
  active,
  failed,
}: {
  active: boolean;
  failed: boolean;
}) {
  return (
    <div className="mb-2 px-4 text-xs text-oc-text-soft opacity-70">
      <span className="inline-flex items-center gap-1.5 font-mono">
        {active ? (
          <Loader2 className="h-3 w-3 animate-spin text-oc-accent" />
        ) : failed ? (
          <X className="h-3 w-3 text-oc-red" />
        ) : (
          <Check className="h-3 w-3 text-oc-green" />
        )}
        {active ? "Working..." : failed ? "Failed" : "Done"}
      </span>
    </div>
  );
}
