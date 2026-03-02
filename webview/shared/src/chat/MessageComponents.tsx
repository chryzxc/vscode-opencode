import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  FileText as FileTextIcon,
  Loader2,
  X,
  Sparkles,
  RotateCw,
  User,
  Zap,
  AlertCircle,
} from "lucide-react";
import * as Popover from "@radix-ui/react-popover";

import { MarkdownRenderer } from "../components/MarkdownRenderer";

import { cn } from "@/utils";
import { Badge } from "@/components/ui/badge";

import type {
  Message,
  MessagePart,
  MessageStep,
  StreamingState,
  StreamingStep,
  SubagentSummary,
  SubagentDetail,
  ReasoningEvent,
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

// Deterministic colors for subagents
const SUBAGENT_COLORS = [
  "text-oc-orange",
  "text-oc-green",
  "text-oc-yellow",
  "text-oc-red",
  "text-oc-accent",
];

function getSubagentColor(id: string): string {
  if (!id) return "text-oc-accent";
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return SUBAGENT_COLORS[Math.abs(hash) % SUBAGENT_COLORS.length];
}

// SVG file icon
export function FileIcon({
  filePath,
  className,
}: {
  filePath?: string;
  className?: string;
}) {
  const ext = filePath ? getFileExtension(filePath) : "";

  if (filePath) {
    const fileName = (filePath.split(/[\\/]/).pop() || "").toLowerCase();
    const cleanKey = (key: string) =>
      key
        .replace(/\./g, "_")
        .replace(/\//g, "-")
        .replace(/\+/g, "p")
        .replace(/#/g, "h")
        .replace(/[^a-z0-9_-]/g, "_");

    // The library uses .file-icon and .file-icon-type-[ext]
    // We add both filename and extension classes to maximize match chances
    // We also use a more aggressive sanitization to match processor's likely output
    return (
      <div
        className={cn(
          "file-icon",
          `file-icon-type-${cleanKey(fileName)}`,
          `file-icon-type-${cleanKey(ext)}`,
          className,
        )}
        style={{
          width: "16px",
          height: "16px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          marginRight: "4px",
          verticalAlign: "text-bottom",
        }}
      />
    );
  }

  const color = getFileColor(ext);
  return (
    <svg
      role="img"
      aria-label={filePath ?? "file"}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className={cn("file-icon-svg", className)}
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
  const fromParts = (parts: MessagePart[]) =>
    parts
      .map((part: MessagePart, _index: number) => {
        const explicit = part.reasoning ?? part.thought ?? part.thinking;
        if (explicit) {
          return explicit;
        }
        if (part.type === "reasoning") {
          return part.text ?? part.content ?? "";
        }
        if (part.type === "text" || part.text) {
          const value = part.text || part.content || "";
          // If it's a text part, but it's empty, it might be a placeholder for reasoning
          // that was not explicitly typed as "reasoning".
          if (value.trim().length === 0) {
            return "";
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("\n\n")
      .trim();

  return fromParts(parts);
}

function summaryText(message?: Message): string {
  // Check both nested info and top-level properties (for persisted messages)
  const summary =
    message?.info?.summary ??
    ((message as Record<string, unknown>).summary as
      | { title?: string; body?: string }
      | undefined);
  const title = summary?.title?.trim() ?? "";
  const body = summary?.body?.trim() ?? "";
  if (title && body) {
    return `${title}\n\n${body}`;
  }
  return title || body;
}

function modelLabel(message: Message): string {
  // Check nested info structure first (from streaming)
  const modelObj = message.info?.model;
  if (modelObj && typeof modelObj === "object") {
    const name = (modelObj as Record<string, unknown>).name;
    const modelID = (modelObj as Record<string, unknown>).modelID;
    if (typeof name === "string" && name) return name;
    if (typeof modelID === "string" && modelID) return modelID;
  }
  // Check top-level model object (from persisted messages)
  if (
    !modelObj &&
    typeof message.model === "object" &&
    message.model !== null
  ) {
    const name = (message.model as Record<string, unknown>).name;
    const modelID = (message.model as Record<string, unknown>).modelID;
    if (typeof name === "string" && name) return name;
    if (typeof modelID === "string" && modelID) return modelID;
  }
  // Check nested info structure
  let model = message.info?.modelID;
  let provider = message.info?.providerID;
  if (model && provider) return `${provider}/${model}`;
  // Check top-level properties (from persisted messages)
  model ??= (message as Record<string, unknown>).modelID as string | undefined;
  provider ??= (message as Record<string, unknown>).providerID as
    | string
    | undefined;
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
  diffStats?: { added: number; deleted: number };
};

type ThinkingBlock = { kind: "thinking"; items: ThoughtItem[] };
type StepsBlock = { kind: "steps"; items: ProgressItem[] };
type ContentBlock = { kind: "content"; html: string };
type TimelineBlock = ThinkingBlock | StepsBlock | ContentBlock;

/**
 * Extracts the Date.now() timestamp embedded in a streaming thought-item key.
 * Keys are formatted as "stream-{idx}-{createdAt}".
 */
function seqFromThoughtKey(key: string): number {
  const m = key.match(/stream-\d+-(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function thoughtItemsFromMessage(message?: Message): ThoughtItem[] {
  if (message?.reasoningEvents && message.reasoningEvents.length > 0) {
    return message.reasoningEvents
      .filter((event: ReasoningEvent) => {
        const text = event.text;
        return typeof text === "string" && text.length > 0;
      })
      .map((event: ReasoningEvent) => ({
        key: `evt-${event.createdAt}`,
        text: event.text.trim(),
      }));
  }

  return (message?.parts ?? [])
    .map((part: MessagePart, index: number) => {
      const text =
        part.reasoning ??
        part.thought ??
        part.thinking ??
        (part.type === "reasoning" ? (part.text ?? part.content ?? "") : "");
      return { key: `part-${index}`, text: text.trim() };
    })
    .filter((item: ThoughtItem) => item.text.length > 0);
}

function thoughtItemsFromStreaming(streaming?: StreamingState): ThoughtItem[] {
  if (!streaming) {
    return [];
  }
  if (streaming.reasoningEvents && streaming.reasoningEvents.length > 0) {
    return streaming.reasoningEvents
      .filter((event: ReasoningEvent) => {
        return event.text && event.text.length > 0;
      })
      .map((event: ReasoningEvent, idx: number) => ({
        key: `stream-${idx}-${event.createdAt}`,
        text: event.text.trim(),
      }));
  }

  const fallback = (streaming?.reasoning || "").trim();
  return fallback ? [{ key: "stream-reasoning-fallback", text: fallback }] : [];
}

function normalizeProgressStatus(value?: string | null): "pending" | "done" | "error" {
  const v = value?.toLowerCase();
  if (v === "done" || v === "completed" || v === "success" || v === "finished" || v === "complete") {
    return "done";
  }
  if (v === "error" || v === "failed") {
    return "error";
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
  const stepMap = new Map<string, ProgressItem>();

  steps
    .filter((step) => isActionProgressStep(step))
    .forEach((step, index) => {
      const title = step.title;
      const status = normalizeProgressStatus(step.status);
      const meta = step.meta;
      const filePath =
        "filePath" in step
          ? (step as StreamingStep).filePath
          : ((step as MessageStep).content ?? undefined);

      if (stepMap.has(title)) {
        const existing = stepMap.get(title)!;
        existing.status = status;
        if (meta) existing.meta = meta;
        if (filePath) existing.filePath = filePath;
        if ("diffStats" in step) existing.diffStats = step.diffStats as { added: number; deleted: number };
      } else {
        stepMap.set(title, {
          key: `${prefix}-${index}-${title}`,
          title,
          status,
          meta,
          filePath,
          diffStats: "diffStats" in step ? (step.diffStats as { added: number; deleted: number }) : undefined,
        });
      }
    });

  return Array.from(stepMap.values());
}

function progressItemsFromMessage(message?: Message): ProgressItem[] {
  if (!message) {
    return [];
  }
  let items: ProgressItem[] = [];
  if (
    Array.isArray(message.progressEvents) &&
    message.progressEvents.length > 0
  ) {
    items = progressItemsFromSteps(
      message.progressEvents,
      "msg-progress-events",
    );
  } else if (Array.isArray(message.steps) && message.steps.length > 0) {
    items = progressItemsFromSteps(message.steps, "msg-steps");
  }

  // For completed messages, any hanging pending steps should be marked as done
  for (const item of items) {
    if (item.status === "pending") {
      item.status = "done";
    }
  }

  return items;
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
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[interactive:[^:]+:[^\]]+\]\s*/gi, "")
    .trim();
}

/**
 * Builds a unified ordered timeline for a STREAMING message.
 * Merges thinking events (timestamped via createdAt), steps (via streamSeq),
 * and the response content (via contentStartSeq) into arrival order.
 */
function buildStreamingTimeline(
  streaming: StreamingState,
  thoughtItems: ThoughtItem[],
  progressItems: ProgressItem[],
  html: string,
): TimelineBlock[] {
  type RawEntry =
    | { seq: number; kind: "thinking"; item: ThoughtItem }
    | { seq: number; kind: "step"; item: ProgressItem }
    | { seq: number; kind: "content" };

  const entries: RawEntry[] = [];

  for (const item of thoughtItems) {
    entries.push({ kind: "thinking", item, seq: seqFromThoughtKey(item.key) });
  }

  for (const item of progressItems) {
    // Match back to the original step to read its streamSeq timestamp
    const step = streaming.steps.find((s) => s.title === item.title);
    entries.push({
      kind: "step",
      item,
      seq: step?.streamSeq ?? step?.startTime ?? 0,
    });
  }

  if (html) {
    // If contentStartSeq is missing the content starts last
    entries.push({
      kind: "content",
      seq: streaming.contentStartSeq ?? Number.MAX_SAFE_INTEGER,
    });
  }

  entries.sort((a, b) => a.seq - b.seq);

  const blocks: TimelineBlock[] = [];
  for (const entry of entries) {
    const last = blocks[blocks.length - 1];
    if (entry.kind === "thinking") {
      if (last?.kind === "thinking") {
        (last as ThinkingBlock).items.push(entry.item);
      } else {
        blocks.push({ kind: "thinking", items: [entry.item] });
      }
    } else if (entry.kind === "step") {
      if (last?.kind === "steps") {
        (last as StepsBlock).items.push(entry.item);
      } else {
        blocks.push({ kind: "steps", items: [entry.item] });
      }
    } else {
      blocks.push({ kind: "content", html });
    }
  }

  return blocks;
}

/**
 * Builds a unified ordered timeline for a COMPLETED message.
 * Uses message.parts (already in arrival order) for thinking/content interleaving.
 * Steps are inserted before the first content block (their most common natural position).
 */
function buildMessageTimeline(
  message: Message | undefined,
  thoughtItems: ThoughtItem[],
  progressItems: ProgressItem[],
  html: string,
): TimelineBlock[] {
  const parts = message?.parts;

  if (Array.isArray(parts) && parts.length > 0) {
    const blocks: TimelineBlock[] = [];

    for (const part of parts) {
      const isReasoning =
        part.type === "reasoning" ||
        !!part.reasoning ||
        !!part.thought ||
        !!part.thinking;

      if (isReasoning) {
        const text = (
          part.reasoning ??
          part.thought ??
          part.thinking ??
          (part.type === "reasoning" ? (part.text ?? part.content ?? "") : "")
        ).trim();
        if (!text) continue;
        const last = blocks[blocks.length - 1];
        if (last?.kind === "thinking") {
          (last as ThinkingBlock).items.push({
            key: `msg-think-${blocks.length}`,
            text,
          });
        } else {
          blocks.push({
            kind: "thinking",
            items: [{ key: `msg-think-${blocks.length}`, text }],
          });
        }
      } else {
        const partText = (part.text ?? part.content ?? "").trim();
        if (!partText) continue;
        const last = blocks[blocks.length - 1];
        if (last?.kind === "content") {
          (last as ContentBlock).html += partText;
        } else {
          blocks.push({ kind: "content", html: partText });
        }
      }
    }

    // Steps don't appear in parts; insert them before the first content block
    if (progressItems.length > 0) {
      const firstContentIdx = blocks.findIndex((b) => b.kind === "content");
      const stepsBlock: TimelineBlock = { kind: "steps", items: progressItems };
      if (firstContentIdx >= 0) {
        blocks.splice(firstContentIdx, 0, stepsBlock);
      } else {
        blocks.push(stepsBlock);
      }
    }

    // If parts had no reasoning entries but the message has reasoningEvents,
    // they won't have been added above — insert them before the first content block.
    const hasThinkingBlock = blocks.some((b) => b.kind === "thinking");
    if (!hasThinkingBlock && thoughtItems.length > 0) {
      const firstContentIdx = blocks.findIndex((b) => b.kind === "content");
      const thinkingBlock: TimelineBlock = {
        kind: "thinking",
        items: thoughtItems,
      };
      if (firstContentIdx >= 0) {
        blocks.splice(firstContentIdx, 0, thinkingBlock);
      } else {
        blocks.unshift(thinkingBlock);
      }
    }

    return blocks.filter((b) => {
      if (b.kind === "content") return !!(b as ContentBlock).html;
      return (b as ThinkingBlock | StepsBlock).items.length > 0;
    });
  }

  // Fallback for messages that have no parts array — thinking always precedes content
  const blocks: TimelineBlock[] = [];
  if (thoughtItems.length > 0)
    blocks.push({ kind: "thinking", items: thoughtItems });
  if (progressItems.length > 0)
    blocks.push({ kind: "steps", items: progressItems });
  if (html) blocks.push({ kind: "content", html });
  return blocks;
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
          <div className="whitespace-pre-wrap text-xs leading-relaxed">
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
              {message.images.map((src: string) => (
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

/**
 * Type-safe helper to get agent name from message or streaming state.
 * Checks multiple possible locations for the agent name to support both
 * persisted messages and real-time streaming.
 */
function getAgentName(
  message: Message | undefined,
  streaming: StreamingState | undefined,
): string {
  if (message?.info?.agent && typeof message.info.agent === "string") {
    return message.info.agent;
  }

  if (message && 'agent' in message) {
    const agent = (message as Record<string, unknown>).agent;
    if (typeof agent === "string" && agent) {
      return agent;
    }
  }

  if (streaming?.agent && typeof streaming.agent === "string") {
    return streaming.agent;
  }

  return "assistant";
}

/**
 * Type-safe helper to get token usage info from message.
 * Returns undefined for streaming state since tokens aren't available until completion.
 */
function getTokenInfo(
  message: Message | undefined,
): { input?: number; output?: number; cache?: { read?: number; write?: number } } | undefined {
  if (!message) {
    return undefined;
  }

  if (message.info?.tokens) {
    return message.info.tokens;
  }

  if ('tokens' in message) {
    const tokens = (message as Record<string, unknown>).tokens;
    if (tokens && typeof tokens === "object") {
      return tokens as {
        input?: number;
        output?: number;
        cache?: { read?: number; write?: number };
      };
    }
  }

  return undefined;
}

/**
 * Type-safe helper to get duration from message or streaming state.
 */
function getDuration(
  message: Message | undefined,
  streaming: StreamingState | undefined,
): number | undefined {
  if (
    streaming?.usage?.duration !== undefined &&
    typeof streaming.usage.duration === "number"
  ) {
    return streaming.usage.duration;
  }

  if (!message) {
    return undefined;
  }

  if (
    message.info?.duration !== undefined &&
    typeof message.info.duration === "number"
  ) {
    return message.info.duration;
  }

  if ('duration' in message) {
    const duration = (message as Record<string, unknown>).duration;
    if (typeof duration === "number") {
      return duration;
    }
  }

  if (message.timing && "duration" in message.timing) {
    const timingDuration = message.timing.duration;
    if (typeof timingDuration === "number") {
      return timingDuration;
    }
  }

  return undefined;
}

export function SubagentProgressPopover({
  subagent,
  subagentDetail,
  colorClass,
  children,
}: {
  subagent: SubagentSummary;
  subagentDetail?: SubagentDetail;
  colorClass: string;
  children: React.ReactNode;
}) {
  const agentName = subagent.agentId || `Agent ${subagent.id.slice(0, 4)}`;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 w-72 rounded-md border border-oc-border bg-oc-panel p-4 shadow-md outline-none animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95"
          sideOffset={5}
        >
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className={cn("oc-agent-icon shrink-0", colorClass)}>
                  <Sparkles className="h-3 w-3" />
                </div>
                <span className={cn("text-xs font-semibold truncate", colorClass)}>
                  {agentName}
                </span>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "h-5 text-[10px] font-mono",
                  subagent.status === "done"
                    ? "border-oc-green/30 text-oc-green bg-oc-green/5"
                    : subagent.status === "error"
                      ? "border-oc-red/30 text-oc-red bg-oc-red/5"
                      : "border-oc-accent/30 text-oc-accent bg-oc-accent/5",
                )}
              >
                {subagent.status.toUpperCase()}
              </Badge>
            </div>

            {subagentDetail && (
              <div className="space-y-2.5">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium text-oc-text-muted uppercase tracking-wider">
                    Latest activity
                  </span>
                  <div className="text-xs text-oc-text-soft line-clamp-2 italic">
                    {subagent.latestActivity || "Initializing..."}
                  </div>
                </div>

                {subagentDetail.progressEvents && subagentDetail.progressEvents.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-medium text-oc-text-muted uppercase tracking-wider">
                      Recent Steps
                    </span>
                    <div className="max-h-32 overflow-y-auto pr-1 space-y-2">
                      {subagentDetail.progressEvents.slice(-3).reverse().map((event, idx) => (
                        <div key={idx} className="flex flex-col gap-1 border-l-2 border-oc-border pl-2 py-0.5">
                          <span className="text-[10px] text-oc-text-soft leading-tight">
                            {event.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <Popover.Arrow className="fill-oc-border" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function AssistantMessage({
  message,
  streaming,
  isContiguous,
}: {
  message?: Message;
  streaming?: StreamingState;
    isContiguous?: boolean;
}) {
  const dispatch = useAppDispatch();
  const { subagentsByParentMessageId, subagentDetailsById } = useAppState();
  const [showSubagents, setShowSubagents] = useState(false);
  const [showAllSubagents, setShowAllSubagents] = useState(false);
  const [expandedSubagentId, setExpandedSubagentId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const content = getMessageContent(message, streaming);
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

  /** Unified chronological list of timeline blocks to render. */
  const timelineBlocks = useMemo<TimelineBlock[]>(() => {
    if (streaming) {
      return buildStreamingTimeline(
        streaming,
        thoughtItems,
        progressItems,
        content,
      );
    }
    return buildMessageTimeline(message, thoughtItems, progressItems, content);
  }, [streaming, message, thoughtItems, progressItems, content]);

  const info = message?.info;
  const plan = message?.plan;
  const messageId = info?.id || streaming?.messageId;
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
  const hasStreamingActivity = !!(
    streaming &&
    ((streaming.content && String(streaming.content).trim().length > 0) ||
      (streaming.reasoning && String(streaming.reasoning).trim().length > 0) ||
      (Array.isArray(streaming.reasoningEvents) &&
        streaming.reasoningEvents.length > 0) ||
      (Array.isArray(streaming.progressEvents) &&
        streaming.progressEvents.length > 0) ||
      (Array.isArray(streaming.steps) && streaming.steps.length > 0))
  );

  const showStreamingLoading = !message && !!streaming?.isActive && !hasStreamingActivity;

  // Use type-safe helpers instead of type assertions
  const agentName = getAgentName(message, streaming);
  const modelName = useMemo(() => {
    if (streaming?.isActive) {
      if (streaming.model?.name) return streaming.model.name;
      if (streaming.providerID && streaming.modelID) return `${streaming.providerID}/${streaming.modelID}`;
      if (streaming.modelID) return streaming.modelID;
    }
    return modelLabel(message ?? ({} as Message));
  }, [message, streaming]);
  const tokens = getTokenInfo(message);
  const inputTok = tokens?.input ?? 0;
  const outputTok = tokens?.output ?? 0;
  const cache = tokens?.cache;
  const cacheRead = cache?.read ?? 0;
  const cacheWrite = cache?.write ?? 0;
  const duration = getDuration(message, streaming);
  const hasTokens = inputTok > 0 || outputTok > 0;
  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const toggleSubagentDetails = (subagentId: string) => {
    setExpandedSubagentId(prev => prev === subagentId ? null : subagentId);
  };
  const copyRefs = async (detail: SubagentDetail) => {
    const refs = [
      `parentSessionID=${detail.parentSessionId}`,
      `parentMessageID=${detail.parentMessageId}`,
      detail.childSessionId ? `childSessionID=${detail.childSessionId}` : null,
      ...detail.references.map((ref, index) => {
        const parts = [
          ref.messageID ? `messageID=${ref.messageID}` : null,
          ref.partID ? `partID=${ref.partID}` : null,
          ref.callID ? `callID=${ref.callID}` : null,
        ].filter(Boolean);
        return parts.length > 0 ? `ref${index + 1}: ${parts.join(' ')}` : null;
      }),
    ]
      .filter((item): item is string => !!item)
      .join('\n');
    await navigator.clipboard.writeText(refs);
  };
  return (
    <div
      id={messageId ? `msg-${messageId}` : undefined}
      data-message-id={messageId || undefined}
      className={`oc-message-enter ${isContiguous ? 'mb-4 mt-[-12px]' : 'mb-5'} px-4`}
    >
      <div className="oc-msg-assistant">
        {!isContiguous && (
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
                    <div className="oc-msg-header-left flex items-center gap-1.5 min-w-0">
                      <div className="oc-agent-icon flex items-center justify-center rounded-md bg-oc-accent-soft p-1">
                        <Zap className="h-4 w-4 text-oc-accent" />
                      </div>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="oc-msg-agent-name px-2 py-0.5 rounded-md font-semibold text-oc-sm text-oc-agent-custom bg-oc-agent-custom truncate shrink-0">
                          {agentName}
                        </span>
                        {modelName && modelName !== "assistant" && (
                          <div className="flex items-center gap-1.5 opacity-60 min-w-0 truncate">
                            <span className="text-oc-xs font-mono shrink-0">•</span>
                            <span className="oc-msg-model-label truncate text-oc-xs">
                              {modelName}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                {hasTokens && (
                  <div className="oc-msg-token-chips flex shrink-0 items-center gap-1">
                      <span title="Tokens in system prompt + conversation history + your message" className="cursor-help decoration-dotted underline underline-offset-2">prompt</span>
                      <span className="tabular-nums cursor-help" title="Tokens in system prompt + conversation history + your message">
                      {inputTok.toLocaleString()}
                    </span>
                    <span className="opacity-30">-</span>
                      <span title="Tokens generated in this reply" className="cursor-help decoration-dotted underline underline-offset-2">response</span>
                      <span className="tabular-nums cursor-help" title="Tokens generated in this reply">
                      {outputTok.toLocaleString()}
                    </span>
                    {cacheRead > 0 && (
                      <>
                        <span className="opacity-30">-</span>
                          <span title="Tokens retrieved from prompt cache" className="cursor-help decoration-dotted underline underline-offset-2">cache read</span>
                          <span className="tabular-nums cursor-help" title="Tokens retrieved from prompt cache">
                          {cacheRead.toLocaleString()}
                        </span>
                      </>
                    )}
                    {cacheWrite > 0 && (
                      <>
                        <span className="opacity-30">-</span>
                          <span title="New tokens written to prompt cache" className="cursor-help decoration-dotted underline underline-offset-2">cache write</span>
                          <span className="tabular-nums cursor-help" title="New tokens written to prompt cache">
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
        )}

        {/* Unified timeline: blocks rendered in arrival order (thinking → steps → content → ...) */}
        {timelineBlocks.map((block, blockIdx) => {
          if (block.kind === "thinking") {
            return (
              <details
                // biome-ignore lint/suspicious/noArrayIndexKey: blocks are position-stable within a message
                key={`block-thinking-${blockIdx}`}
                className="group mb-3"
              >
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-oc-xs font-mono text-oc-text-muted hover:text-oc-text-soft transition-colors mt-1">
                  <span className="inline-block text-oc-2xs transition-transform group-open:rotate-90">
                    ›
                  </span>
                  <span className="opacity-70 whitespace-nowrap shrink-0">
                    Thinking
                  </span>
                </summary>
                <div className="mt-1.5 ml-0.5 border-l border-oc-border pl-3 space-y-0.5 max-h-[300px] overflow-y-auto pr-2">
                  {block.items.map((thought) => (
                    <div
                      key={thought.key}
                      className="py-0.5 text-xs leading-relaxed text-oc-text-soft opacity-70 whitespace-pre-wrap"
                    >
                      {thought.text}
                    </div>
                  ))}
                </div>
              </details>
            );
          }

          if (block.kind === "steps") {
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: blocks are position-stable within a message
                key={`block-steps-${blockIdx}`}
                className="mb-3 ml-0.5 border-l border-oc-border pl-3 space-y-0.5 max-h-[300px] overflow-y-auto pr-2"
              >
                {block.items.map((event) => (
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
                    <span
                      className={`min-w-0 flex-1 leading-relaxed ${
                        event.status === "pending"
                          ? "text-oc-text"
                          : "text-oc-text-soft opacity-80"
                      }`}
                    >
                      {event.title}
                      {event.meta ? (
                        <span className="ml-1.5 text-oc-text-muted opacity-60">
                          {event.meta}
                        </span>
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
                      {event.diffStats && (event.diffStats.added > 0 || event.diffStats.deleted > 0) ? (
                        <span className="ml-1.5 inline-flex items-center gap-1 font-mono text-[10px]">
                          {event.diffStats.added > 0 && (
                            <span className="text-oc-green">+{event.diffStats.added}</span>
                          )}
                          {event.diffStats.deleted > 0 && (
                            <span className="text-oc-red">-{event.diffStats.deleted}</span>
                          )}
                        </span>
                      ) : null}
                    </span>
                    {event.status === "done" && event.filePath && (event.diffStats || /edit|writ|modif|updat|delet/i.test(event.title)) && (
                      <button
                        type="button"
                        className="ml-2 shrink-0 text-[10px] uppercase font-semibold tracking-wider text-oc-accent hover:underline opacity-80 hover:opacity-100"
                        onClick={() =>
                          vscode.postMessage({
                            type: "openDiff",
                            file: event.filePath,
                          })
                        }
                      >
                        View diff
                      </button>
                    )}
                  </div>
                ))}
              </div>
            );
          }

          // block.kind === "content"
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: blocks are position-stable within a message
              key={`block-content-${blockIdx}`}
              className="mb-3 max-h-[500px] overflow-y-auto pr-2"
            >
              {/* biome-ignore lint/security/noDangerouslySetInnerHtml: markdown rendering requires HTML injection */}
              <MarkdownRenderer content={block.html} />
            </div>
          );
        })}

        {message?.error && (
          <div className="mt-2">
            <ErrorBanner
              message={message.error}
              onRetry={() => {
                dispatch({ type: "SET_PROCESSING", payload: true });
                dispatch({ type: "CLEAR_ERROR_MESSAGES" });
                vscode.postMessage({ type: "retryLastMessage" });
              }}
            />
          </div>
        )}

        {subagents.length > 0 && (
          <div className="mt-3 mb-3 space-y-2">
              {visibleSubagents.map((subagent: SubagentSummary) => {
                const isExpanded = expandedSubagentId === subagent.id;
                // Merge data from the subagent store
                const detailData = subagentDetailsById[subagent.id] || subagent;
                return (
                  <div
                    key={subagent.id}
                    className="rounded-md border border-oc-border bg-oc-panel-soft overflow-hidden text-xs"
                  >
                    <div className="p-2.5">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <SubagentProgressPopover
                          subagent={subagent}
                          subagentDetail={subagentDetailsById?.[subagent.id]}
                          colorClass={getSubagentColor(subagent.id)}
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 hover:bg-oc-panel-hover text-left"
                          >
                            <div className={cn("oc-agent-icon shrink-0 flex items-center justify-center", getSubagentColor(subagent.id))}>
                              {subagent.status === "running" ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : subagent.status === "error" ? (
                                <X className="h-3 w-3 text-oc-red" />
                              ) : (
                                <Check className="h-3 w-3" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className={cn("truncate text-oc-xs font-semibold", getSubagentColor(subagent.id))}>
                                  {subagent.agentId || `Agent ${subagent.id.slice(0, 4)}`}
                                </span>
                              </div>
                              <div className="truncate text-[10px] text-oc-text-muted font-mono leading-tight">
                                {subagent.latestActivity || "Initializing..."}
                              </div>
                            </div>
                          </button>
                        </SubagentProgressPopover>
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
                          onClick={() => toggleSubagentDetails(subagent.id)}
                        >
                          {isExpanded ? "Hide details" : "Open details"}
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
                          Jump to parent
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-oc-border bg-oc-panel p-2.5">
                        <div className="space-y-1 text-oc-2xs text-oc-text-muted">
                          <div>
                            model:{" "}
                            {subagent.providerID && subagent.modelID
                              ? `${subagent.providerID}/${subagent.modelID}`
                              : "n/a"}
                          </div>
                          <div>
                            child session: {(detailData as SubagentDetail).childSessionId || "n/a"}
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-oc-2xs font-mono text-oc-text-muted hover:text-oc-accent"
                            onClick={() => copyRefs(detailData as SubagentDetail)}
                          >
                            <Copy className="h-3 w-3" />
                            Copy refs
                          </button>
                        </div>
                        {(detailData as SubagentDetail).thinkingEvents?.length > 0 ? (
                          <details className="mt-2" open={false}>
                            <summary className="cursor-pointer text-oc-2xs font-mono text-oc-text-muted hover:text-oc-text-soft transition-colors">
                              Thinking
                            </summary>
                            <div className="mt-1.5 max-h-44 space-y-1 overflow-y-auto pr-1">
                              {(detailData as SubagentDetail).thinkingEvents.map((ev) => (
                                <div
                                  key={ev.id}
                                  className="rounded border border-oc-border bg-oc-panel-soft px-2 py-1.5 text-oc-2xs text-oc-text-muted whitespace-pre-wrap"
                                >
                                  {ev.text}
                                </div>
                              ))}
                            </div>
                          </details>
                        ) : null}
                        {(detailData as SubagentDetail).progressEvents?.length > 0 ? (
                          <details className="mt-2" open={false}>
                            <summary className="cursor-pointer text-oc-2xs font-mono text-oc-text-muted hover:text-oc-text-soft transition-colors">
                              Progress ({(detailData as SubagentDetail).progressEvents.length})
                            </summary>
                            <div className="mt-1.5 max-h-44 space-y-1 overflow-y-auto pr-1">
                              {(detailData as SubagentDetail).progressEvents.map((ev) => (
                                <div
                                  key={ev.id}
                                  className="rounded border border-oc-border bg-oc-panel-soft px-2 py-1.5 text-oc-2xs"
                                >
                                  <div className="text-oc-text-soft">{ev.title}</div>
                                  {ev.meta ? (
                                    <div className="text-oc-text-muted mt-0.5">{ev.meta}</div>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </details>
                        ) : null}
                        {(detailData as SubagentDetail).timelineEvents?.length > 0 ? (
                          <details className="mt-2" open={true}>
                            <summary className="cursor-pointer text-oc-2xs font-mono text-oc-text-muted hover:text-oc-text-soft transition-colors">
                              Timeline ({(detailData as SubagentDetail).timelineEvents.length})
                            </summary>
                            <div className="mt-1.5 max-h-44 space-y-1 overflow-y-auto pr-1">
                              {(detailData as SubagentDetail).timelineEvents.map((ev) => (
                                <div
                                  key={ev.key}
                                  className="rounded border border-oc-border bg-oc-panel-soft px-2 py-1.5 text-oc-2xs"
                                >
                                  <div className="text-oc-text-soft">{ev.label}</div>
                                  <div className="font-mono text-oc-text-muted mt-0.5">
                                    {new Date(ev.createdAt).toLocaleTimeString()}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
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
                        edits: message.edits?.map((file: { file: string }) => file.file),
                        createdAt: message.created,
                        duration: message.info?.duration ?? message.duration,
                        }
                      : null,
                    streaming: streaming
                      ? {
                          isActive: streaming.isActive,
                          contentLength: streaming.content?.length || 0,
                          stepsCount: streaming.steps?.length || 0,
                          progressEventsCount:
                            streaming.progressEvents?.length || 0,
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

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="mb-3 px-4">
      <div className="flex flex-col gap-2 rounded-md border border-oc-red/50 bg-oc-red/10 px-3 py-2 text-oc-sm text-oc-red shadow-sm transition-all duration-200">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-oc-red" />
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-oc-red opacity-90">
            Request Failed
          </h4>
        </div>
        <div className="overflow-hidden border-l border-oc-red/30 pl-2.5 py-0.5 font-mono text-[11px] leading-relaxed text-oc-red/90 whitespace-pre-wrap break-words">
          {message}
        </div>
        {onRetry && (
          <div className="flex justify-start">
            <button
              type="button"
              onClick={onRetry}
              className="group relative mt-1 inline-flex items-center gap-1.5 overflow-hidden rounded border border-oc-red/40 bg-oc-red/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-tight text-oc-red transition-all hover:bg-oc-red/30 active:scale-95"
            >
              <RotateCw className="h-3 w-3 transition-transform group-hover:rotate-180" />
              <span>Retry Generation</span>
            </button>
          </div>
        )}
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
      <div className="text-xs text-oc-text-soft opacity-70 max-w-[240px] leading-relaxed">
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
