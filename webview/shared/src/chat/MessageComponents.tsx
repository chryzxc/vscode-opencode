import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText as FileTextIcon,
  Layers,
  Loader2,
  X,
  Sparkles,
  RotateCw,
  Zap,
  AlertCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Stepper, StepperItem } from "@/components/ui/stepper";
import { cn } from "@/utils";

import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { SubagentDetailModal } from "./SubagentDetailModal";

import type {
  Message,
  MessagePart,
  MessageStep,
  ReasoningEvent,
  StreamingState,
  StreamingStep,
  SubagentDetail,
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

function isReasoningPart(part: MessagePart): boolean {
  const type = (part.type ?? "").toLowerCase();
  return (
    type === "reasoning" ||
    type === "thinking" ||
    type === "thought" ||
    !!part.reasoning ||
    !!part.thought ||
    !!part.thinking
  );
}

// Deterministic accent colors for subagents
const SUBAGENT_COLORS = [
  "text-oc-orange",
  "text-oc-green",
  "text-oc-yellow",
  "text-oc-red",
  "text-oc-accent",
];

const SUBAGENT_HUES = [12, 36, 58, 92, 128, 166, 198, 228, 264, 312, 338];

function getStableHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function getSubagentColor(id: string): string {
  if (!id) return "text-oc-accent";
  const hash = getStableHash(id);
  return SUBAGENT_COLORS[Math.abs(hash) % SUBAGENT_COLORS.length];
}

function getSubagentHue(id: string): number {
  if (!id) return 210;
  return SUBAGENT_HUES[getStableHash(id) % SUBAGENT_HUES.length];
}

function getSubagentCardStyle(id: string): CSSProperties {
  const hue = getSubagentHue(id);
  return {
    borderLeftWidth: "3px",
    borderLeftColor: `hsl(${hue}, 78%, 68%)`,
    backgroundImage: `linear-gradient(90deg, hsla(${hue}, 72%, 58%, 0.09) 0%, hsla(${hue}, 72%, 58%, 0.02) 38%, transparent 62%)`,
  };
}

function getSubagentAccentTextStyle(id: string): CSSProperties {
  const hue = getSubagentHue(id);
  return {
    color: `hsl(${hue}, 80%, 70%)`,
  };
}

function getSubagentMetaStyle(id: string): CSSProperties {
  const hue = getSubagentHue(id);
  return {
    borderColor: `hsla(${hue}, 75%, 68%, 0.3)`,
    backgroundColor: `hsla(${hue}, 72%, 56%, 0.08)`,
  };
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
        .replace(/\./g, "-")
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
      if (isReasoningPart(part)) {
        return "";
      }
      return part.text ?? part.content ?? "";
    })
    .join("")
    .trim();
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

function modelLabel(message?: Message): string {
  if (!message) return "assistant";
  // Check nested info structure first (from streaming)
  const modelObj = message.info?.model;
  if (modelObj && typeof modelObj === "object") {
    const name = (modelObj as Record<string, unknown>).name;
    const modelID = (modelObj as Record<string, unknown>).modelID;
    if (typeof name === "string" && name) return name;
    if (typeof modelID === "string" && modelID) return modelID;
  }
  // Check top-level model object (from persisted messages)
  if (typeof message.model === "object" && message.model !== null) {
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
    return streaming.content;
  }
  if (!message) {
    return "";
  }
  const candidates = [
    messageBodyFromParts(message.parts),
    message.content,
    message.text,
    summaryText(message),
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
  mergeKey: string;
  id?: string;
  callID?: string;
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
    const fromEvents = message.reasoningEvents
      .filter((event: ReasoningEvent) => {
        const text = event.text;
        return typeof text === "string" && text.length > 0;
      })
      .map((event: ReasoningEvent) => ({
        key: `evt-${event.createdAt}`,
        text: event.text.trim(),
      }));
    if (fromEvents.length > 0) {
      return fromEvents;
    }
  }

  return (message?.parts ?? [])
    .map((part: MessagePart, index: number) => {
      const text =
        part.reasoning ??
        part.thought ??
        part.thinking ??
        (isReasoningPart(part) ? (part.text ?? part.content ?? "") : "");
      return { key: `part-${index}`, text: text.trim() };
    })
    .filter((item: ThoughtItem) => item.text.length > 0);
}

function thoughtItemsFromStreaming(streaming?: StreamingState): ThoughtItem[] {
  if (!streaming) {
    return [];
  }
  if (streaming.reasoningEvents && streaming.reasoningEvents.length > 0) {
    const fromEvents = streaming.reasoningEvents
      .filter((event: ReasoningEvent) => {
        return event.text && event.text.length > 0;
      })
      .map((event: ReasoningEvent, idx: number) => ({
        key: `stream-${idx}-${event.createdAt}`,
        text: event.text.trim(),
      }));
    if (fromEvents.length > 0) {
      return fromEvents;
    }
  }

  const fallback = (streaming?.reasoning || "").trim();
  return fallback ? [{ key: "stream-reasoning-fallback", text: fallback }] : [];
}

function normalizeProgressStatus(
  value?: string | null,
): "pending" | "done" | "error" {
  const v = value?.toLowerCase();
  if (
    v === "done" ||
    v === "completed" ||
    v === "success" ||
    v === "finished" ||
    v === "complete"
  ) {
    return "done";
  }
  if (v === "error" || v === "failed") {
    return "error";
  }
  return "pending";
}

function isActionProgressStep(step: MessageStep | StreamingStep): boolean {
  const type = (step.type ?? "").toLowerCase();
  if (type === "reasoning" || type === "thinking") {
    return false;
  }

  const title = step.title.trim().toLowerCase();
  if (title === "thinking..." || title === "thinking") {
    return false;
  }
  if (title === "starting step" || title === "finishing step") {
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
      const stepId =
        "id" in step && typeof step.id === "string" ? step.id : undefined;
      const stepCallId =
        "callID" in step && typeof step.callID === "string"
          ? step.callID
          : undefined;
      const mergeKey = stepCallId
        ? `call:${stepCallId}`
        : stepId
          ? `id:${stepId}`
          : `title:${title.trim().toLowerCase()}`;
      const stepFilePath =
        "filePath" in step
          ? (step as StreamingStep).filePath
          : ((step as MessageStep).content ?? undefined);

      if (stepMap.has(mergeKey)) {
        const existing = stepMap.get(mergeKey)!;
        // Do not regress terminal statuses back to pending on noisy updates.
        if (
          status === "error" ||
          status === "done" ||
          existing.status === "pending"
        ) {
          existing.status = status;
        }
        if (title) existing.title = title;
        if (meta) existing.meta = meta;
        if (stepFilePath) existing.filePath = stepFilePath;
        if (!existing.id && stepId) existing.id = stepId;
        if (!existing.callID && stepCallId) existing.callID = stepCallId;
        if ("diffStats" in step)
          existing.diffStats = step.diffStats as {
            added: number;
            deleted: number;
          };
      } else {
        stepMap.set(mergeKey, {
          key: `${prefix}-${index}-${title}`,
          mergeKey,
          id: stepId,
          callID: stepCallId,
          title,
          status,
          meta,
          filePath: stepFilePath,
          diffStats:
            "diffStats" in step
              ? (step.diffStats as { added: number; deleted: number })
              : undefined,
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
    // Match back to the original step to read its streamSeq timestamp.
    // Use the first occurrence so we get the arrival time, not a later update.
    const step = streaming.steps.find(
      (s) =>
        (!!item.callID && !!s.callID && s.callID === item.callID) ||
        (!!item.id && !!s.id && s.id === item.id) ||
        s.title === item.title,
    );
    // NOTE: Fall back to MAX_SAFE_INTEGER (not 0) so that steps with
    // no timestamp always sort AFTER thinking/content, never before.
    const rawSeq = step?.streamSeq ?? step?.startTime;
    entries.push({
      kind: "step",
      item,
      // Add a tiny +1 offset so that a step arriving at the exact same
      // millisecond as a thinking event always renders after it.
      seq: rawSeq != null ? rawSeq + 1 : Number.MAX_SAFE_INTEGER,
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
      if (isReasoningPart(part)) {
        const text = (
          part.reasoning ??
          part.thought ??
          part.thinking ??
          (isReasoningPart(part) ? (part.text ?? part.content ?? "") : "")
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
    // they won't have been added above â€” insert them before the first content block.
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

  // Fallback for messages that have no parts array â€” thinking always precedes content
  const blocks: TimelineBlock[] = [];
  if (thoughtItems.length > 0)
    blocks.push({ kind: "thinking", items: thoughtItems });
  if (progressItems.length > 0)
    blocks.push({ kind: "steps", items: progressItems });
  if (html) blocks.push({ kind: "content", html });
  return blocks;
}

const MAX_VISIBLE_COMPLETED_ACTIVITY = 5;

type MessageViewState = {
  activityExpanded: boolean;
  showActivityDetails: boolean;
  showThinkingDetails: boolean;
  showAllCompletedActivity: boolean;
};

type DisplayEvent = {
  key: string;
  kind: "thinking" | "activity";
  label: string;
  summary: string;
  description?: string;
  detail?: string;
  status: "pending" | "done" | "error";
  filePath?: string;
  diffStats?: { added: number; deleted: number };
  viewDiffFile?: string;
  updateCount: number;
};

function subagentStatusLabel(status: SubagentSummary["status"]): string {
  switch (status) {
    case "done":
      return "Completed";
    case "running":
      return "Running";
    case "error":
      return "Error";
    case "orphaned":
      return "Orphaned";
    case "pending":
    default:
      return "Pending";
  }
}

function subagentAgentLabel(
  subagent: SubagentSummary,
  detail?: SubagentDetail,
): string {
  return (
    subagent.agentId || detail?.agentId || `Agent ${subagent.id.slice(0, 4)}`
  );
}

function subagentModelLabel(
  subagent: SubagentSummary,
  detail?: SubagentDetail,
): string {
  const provider = subagent.providerID || detail?.providerID;
  const model = subagent.modelID || detail?.modelID;
  if (provider && model) {
    return `${provider}/${model}`;
  }
  return model || provider || "model pending";
}

function FadeSwapText({
  text,
  className,
  durationMs = 180,
}: {
  text: string;
  className?: string;
  durationMs?: number;
}) {
  const [displayText, setDisplayText] = useState(text);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    if (text === displayText) {
      return;
    }

    setIsFadingOut(true);
    const outDuration = Math.max(60, Math.round(durationMs * 0.45));
    const outTimer = window.setTimeout(() => {
      setDisplayText(text);
      requestAnimationFrame(() => setIsFadingOut(false));
    }, outDuration);

    return () => window.clearTimeout(outTimer);
  }, [text, displayText, durationMs]);

  return (
    <span
      className={cn(
        "transition-all will-change-[opacity,transform]",
        isFadingOut ? "opacity-0 translate-y-0.5" : "opacity-100 translate-y-0",
        className,
      )}
      style={{ transitionDuration: `${durationMs}ms` }}
    >
      {displayText}
    </span>
  );
}

const THINKING_LOADING_TEXTS = [
  "Analyzing code…",
  "Processing request…",
  "Generating solution…",
  "Building response…",
  "Refining output…",
  "Almost ready…",
  "One moment…",
  "Still processing…",
  "Working on it…",
  "Composing response…",
  "Running checks…",
  "Finalizing…",
  "Nearly done…",
  "Computing result…",
];

function ThinkingStatusTicker({ className }: { className?: string }) {
  const [messageIndex, setMessageIndex] = useState(() =>
    Math.floor(Math.random() * THINKING_LOADING_TEXTS.length),
  );

  useEffect(() => {
    if (THINKING_LOADING_TEXTS.length <= 1) {
      return;
    }
    const timer = window.setInterval(() => {
      setMessageIndex((current) => {
        let next = current;
        while (next === current) {
          next = Math.floor(Math.random() * THINKING_LOADING_TEXTS.length);
        }
        return next;
      });
    }, 1800);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className={cn(
        "inline-flex items-center font-mono text-[11px]",
        className,
      )}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            "inline-block rounded-full bg-current h-1.5 w-1.5",
            index > 0 ? "ml-1.5" : "",
          )}
          style={{
            animation: `thinking-pulse 1.3s ${index * 0.16}s infinite`,
          }}
        />
      ))}
      <FadeSwapText
        text={THINKING_LOADING_TEXTS[messageIndex]}
        className="ml-3 italic opacity-85 tracking-wide"
        durationMs={220}
      />
    </div>
  );
}

function latestNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ?? ""
  );
}

function parseTimelineStepTitle(rawTitle: string): {
  label: string;
  summary: string;
} {
  const stripTrailingEllipsis = (value: string) =>
    value.replace(/\s*(?:\.{3}|…)\s*$/u, "").trim();
  const trimOptional = (value?: string) => value?.trim() || "";
  const title = rawTitle.trim();
  if (!title) {
    return { label: "event", summary: "Activity update" };
  }

  const runningMatch = title.match(
    /^running(?::\s*|\s+)([a-z0-9_.-]+)(?:\s+(.*))?$/is,
  );
  if (runningMatch) {
    const label = stripTrailingEllipsis(
      runningMatch[1]?.toLowerCase() || "tool",
    );
    const summary = stripTrailingEllipsis(trimOptional(runningMatch[2]));
    return { label, summary };
  }

  const bashMatch = title.match(/^bash(?::\s*|\s+)(.*)/is);
  if (bashMatch) {
    return {
      label: "bash",
      summary: stripTrailingEllipsis(trimOptional(bashMatch[1])),
    };
  }

  const readMatch = title.match(/^read(?::\s*|\s+)(.*)/is);
  if (readMatch) {
    return {
      label: "read",
      summary: stripTrailingEllipsis(trimOptional(readMatch[1])),
    };
  }

  const writeMatch = title.match(
    /^(edit|write|modify|update|patch)(?::\s*|\s+)(.*)/is,
  );
  if (writeMatch) {
    const label = stripTrailingEllipsis(writeMatch[1]?.toLowerCase() || "edit");
    const summary = stripTrailingEllipsis(trimOptional(writeMatch[2]));
    return { label, summary };
  }

  const thinkMatch = title.match(/^think(?:ing)?(?::\s*|\s+)?(.*)/is);
  if (thinkMatch) {
    return {
      label: "thinking",
      summary: stripTrailingEllipsis(trimOptional(thinkMatch[1])),
    };
  }

  const spaceIdx = title.indexOf(" ");
  if (spaceIdx > 0 && spaceIdx <= 12) {
    const label = stripTrailingEllipsis(title.slice(0, spaceIdx).toLowerCase());
    const summary = stripTrailingEllipsis(
      trimOptional(title.slice(spaceIdx + 1)),
    );
    return { label, summary };
  }

  return { label: "event", summary: stripTrailingEllipsis(title) };
}

function buildDisplayEvents(
  timelineBlocks: TimelineBlock[],
  message: Message | undefined,
  isStreamingActive: boolean,
): DisplayEvent[] {
  const stripTrailingEllipsis = (value?: string) =>
    (value || "").replace(/\s*(?:\.{3}|…)\s*$/u, "").trim();
  const normalizePathForMatch = (value?: string) =>
    (value || "").replace(/\\/g, "/").toLowerCase();
  const rawEvents: DisplayEvent[] = [];

  for (const block of timelineBlocks) {
    if (block.kind === "content") {
      continue;
    }

    if (block.kind === "thinking") {
      for (const item of block.items) {
        const text = item.text.trim();
        if (!text) continue;
        rawEvents.push({
          key: item.key,
          kind: "thinking",
          label: "thinking",
          summary: latestNonEmptyLine(text) || "Thinking...",
          detail: text,
          status: isStreamingActive ? "pending" : "done",
          updateCount: 1,
        });
      }
      continue;
    }

    for (const event of block.items) {
      const rawTitle = event.title || "";
      const parsed = parseTimelineStepTitle(rawTitle);
      const cleanedRawTitle = stripTrailingEllipsis(rawTitle);
      let filePath = event.filePath;
      if (
        !filePath &&
        /edit|writ|modif|updat|patch/i.test(rawTitle) &&
        message?.edits?.length
      ) {
        filePath = message.edits[0].file;
      }

      const fileName = filePath ? filePath.split(/[/\\]/).pop() : undefined;
      const fallbackEdit = Array.isArray(message?.edits)
        ? filePath
          ? message.edits.find(
              (edit) =>
                normalizePathForMatch(edit?.file) ===
                normalizePathForMatch(filePath),
            )
          : message.edits[0]
        : undefined;
      const fallbackDiffStats =
        fallbackEdit &&
        (typeof fallbackEdit.added === "number" ||
          typeof fallbackEdit.deleted === "number")
          ? {
              added: Math.max(0, Number(fallbackEdit.added) || 0),
              deleted: Math.max(0, Number(fallbackEdit.deleted) || 0),
            }
          : undefined;
      const diffStats = event.diffStats || fallbackDiffStats;

      const metaText = stripTrailingEllipsis(event.meta);
      const summary = filePath
        ? fileName || filePath
        : parsed.summary ||
          metaText ||
          (parsed.label === "event" ? cleanedRawTitle : "");
      const description =
        filePath || parsed.summary
          ? metaText
          : metaText && metaText !== summary
            ? metaText
            : undefined;
      const detail =
        filePath && fileName && filePath !== fileName ? filePath : undefined;
      const viewDiffFile =
        event.status === "done" &&
        (diffStats || /edit|writ|modif|updat|patch/i.test(rawTitle))
          ? filePath || message?.edits?.[0]?.file
          : undefined;

      rawEvents.push({
        key: event.key,
        kind: "activity",
        label: parsed.label,
        summary: summary || cleanedRawTitle || "Activity update",
        description,
        detail: detail || undefined,
        status: event.status,
        filePath,
        diffStats,
        viewDiffFile,
        updateCount: 1,
      });
    }
  }

  const collapsed: DisplayEvent[] = [];
  for (const event of rawEvents) {
    const previous = collapsed[collapsed.length - 1];
    const isDuplicate =
      !!previous &&
      previous.kind === event.kind &&
      previous.label === event.label &&
      previous.summary === event.summary &&
      previous.status === event.status &&
      (previous.filePath ?? "") === (event.filePath ?? "");

    if (!isDuplicate || !previous) {
      collapsed.push({ ...event });
      continue;
    }

    previous.updateCount += 1;
    if (event.description) previous.description = event.description;
    if (event.detail) previous.detail = event.detail;
    if (event.diffStats) previous.diffStats = event.diffStats;
    if (event.viewDiffFile) previous.viewDiffFile = event.viewDiffFile;
  }

  return collapsed;
}

export function UserMessage({ message }: { message?: Message }) {
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const userMessageRef = useRef<HTMLDivElement>(null);
  const rawContent =
    message?.content ?? message?.text ?? messageBodyFromParts(message?.parts);
  const content = sanitizeUserContent(rawContent);
  const fileChips = (message?.parts ?? [])
    .map((part) => part.filename ?? part.source?.path)
    .filter((value): value is string => !!value);
  const hasImages = Array.isArray(message?.images) && message.images.length > 0;

  useEffect(() => {
    const root = userMessageRef.current;
    if (!root) return;

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;

      const src = target.currentSrc || target.src;
      if (!src) return;
      setPreviewImageSrc(src);
    };

    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, []);

  if (!message) return null;
  if (!content && fileChips.length === 0 && !hasImages) {
    return null;
  }

  return (
    <div className="oc-message-enter mb-5 flex items-end justify-end gap-2.5 px-4">
      <div className="w-fit max-w-[78%]">
        <div className="oc-msg-user" ref={userMessageRef}>
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
                  className="max-h-20 rounded-lg border border-oc-border cursor-zoom-in"
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <ImagePreviewModal
        isOpen={previewImageSrc !== null}
        imageSrc={previewImageSrc}
        imageAlt="Message image"
        title="Image Preview"
        onClose={() => setPreviewImageSrc(null)}
      />
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

  if (message && "agent" in message) {
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
function getTokenInfo(message: Message | undefined):
  | {
      input?: number;
      output?: number;
      reasoning?: number;
      cache?: { read?: number; write?: number };
    }
  | undefined {
  if (!message) {
    return undefined;
  }

  if (message.info?.tokens) {
    return message.info.tokens;
  }

  if ("tokens" in message) {
    const tokens = (message as Record<string, unknown>).tokens;
    if (tokens && typeof tokens === "object") {
      return tokens as {
        input?: number;
        output?: number;
        reasoning?: number;
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

  if ("duration" in message) {
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
  const { subagentsByParentMessageId, subagentDetailsById, availableAgents } =
    useAppState();
  const [showSubagents, setShowSubagents] = useState(true);
  const [showAllSubagents, setShowAllSubagents] = useState(false);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const messageBodyRef = useRef<HTMLDivElement>(null);
  const progressTimelineRef = useRef<HTMLDivElement>(null);
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
  const isStreamingActive = !!streaming?.isActive;
  const displayEvents = useMemo(
    () => buildDisplayEvents(timelineBlocks, message, isStreamingActive),
    [timelineBlocks, message, isStreamingActive],
  );
  const [viewState, setViewState] = useState<MessageViewState>({
    activityExpanded: true,
    showActivityDetails: false,
    showThinkingDetails: false,
    showAllCompletedActivity: false,
  });
  const hasCompletedCondensedActivity =
    !isStreamingActive &&
    displayEvents.length > MAX_VISIBLE_COMPLETED_ACTIVITY &&
    !viewState.showAllCompletedActivity;
  const visibleDisplayEvents = hasCompletedCondensedActivity
    ? displayEvents.slice(-MAX_VISIBLE_COMPLETED_ACTIVITY)
    : displayEvents;
  const hiddenActivityEventCount = Math.max(
    0,
    displayEvents.length - visibleDisplayEvents.length,
  );
  const activityStatusCounts = useMemo(
    () =>
      visibleDisplayEvents.reduce(
        (acc, event) => {
          if (event.status === "error") acc.error += 1;
          else if (event.status === "done") acc.done += 1;
          else acc.pending += 1;
          return acc;
        },
        { pending: 0, done: 0, error: 0 },
      ),
    [visibleDisplayEvents],
  );

  const info = message?.info;
  const plan = message?.plan;
  const messageId = info?.id || message?.id || streaming?.messageId;
  // Merge subagents from message data and from the store lookup by parent message ID
  const subagents = useMemo(() => {
    const fromMessage = (
      Array.isArray(message?.subagents) ? message.subagents : []
    ).filter((subagent: SubagentSummary) => {
      if (!messageId) {
        return true;
      }
      const parentMessageId = subagent.parentMessageId;
      return !parentMessageId || parentMessageId === messageId;
    });
    const fromStore = (
      messageId ? (subagentsByParentMessageId[messageId] ?? []) : []
    ).filter((subagent: SubagentSummary) => {
      if (!messageId) {
        return true;
      }
      return subagent.parentMessageId === messageId;
    });
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

  useEffect(() => {
    if (subagents.length === 0) {
      setSelectedSubagentId(null);
      dispatch({ type: "SELECT_SUBAGENT", payload: null });
    }
  }, [subagents.length, dispatch]);

  const subagentStatusCounts = useMemo(
    () =>
      subagents.reduce(
        (acc, subagent) => {
          const key = subagent.status;
          if (key === "running") acc.running += 1;
          else if (key === "done") acc.done += 1;
          else if (key === "error") acc.error += 1;
          else acc.pending += 1;
          return acc;
        },
        { pending: 0, running: 0, done: 0, error: 0 },
      ),
    [subagents],
  );
  const hasStreamingActivity = !!(
    streaming &&
    ((streaming.content && String(streaming.content).trim().length > 0) ||
      (streaming.reasoning && String(streaming.reasoning).trim().length > 0) ||
      (Array.isArray(streaming.reasoningEvents) &&
        streaming.reasoningEvents.length > 0) ||
      (Array.isArray(streaming.progressEvents) &&
        streaming.progressEvents.length > 0) ||
      (Array.isArray(streaming.steps) && streaming.steps.length > 0) ||
      subagents.length > 0)
  );

  const showStreamingLoading =
    !message && !!streaming?.isActive && !hasStreamingActivity;

  // Use type-safe helpers instead of type assertions
  const agentName = getAgentName(message, streaming);
  const agentColor = useMemo(() => {
    if (!agentName || agentName === "assistant") return undefined;
    const match = availableAgents.find(
      (a) =>
        a.id === agentName || a.name.toLowerCase() === agentName.toLowerCase(),
    );
    return match?.color ?? undefined;
  }, [agentName, availableAgents]);
  const modelName = useMemo(() => {
    if (streaming?.isActive) {
      if (streaming.model?.name) return streaming.model.name;
      if (streaming.providerID && streaming.modelID)
        return `${streaming.providerID}/${streaming.modelID}`;
      if (streaming.modelID) return streaming.modelID;
    }
    return modelLabel(message ?? ({} as Message));
  }, [message, streaming]);
  const tokens = getTokenInfo(message);
  const inputTok = tokens?.input ?? 0;
  const outputTok = tokens?.output ?? 0;
  const reasoningTok = tokens?.reasoning ?? 0;
  const cache = tokens?.cache;
  const cacheRead = cache?.read ?? 0;
  const cacheWrite = cache?.write ?? 0;
  const duration = getDuration(message, streaming);
  const hasTokens = inputTok > 0 || outputTok > 0 || reasoningTok > 0;
  const showThinkingPlaceholder =
    !streaming && thoughtItems.length === 0 && reasoningTok > 0;
  const thinkingPlaceholderText =
    "Reasoning tokens were used, but this provider did not expose reasoning text.";
  const hasResponseContent = content.trim().length > 0;
  const isLiveStreamingCard = !message && !!streaming;
  const responseBodyClass = isLiveStreamingCard
    ? "w-full max-h-[340px] overflow-y-auto pr-1"
    : "w-full";
  const markdownBodyClass = isLiveStreamingCard
    ? "w-full max-w-none"
    : "w-full";
  const showResponseSection = !isLiveStreamingCard && hasResponseContent;
  const hasThinkingEvents = useMemo(
    () => displayEvents.some((event) => event.kind === "thinking"),
    [displayEvents],
  );
  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const openSubagentModal = (subagentId: string) => {
    setSelectedSubagentId(subagentId);
    dispatch({ type: "SELECT_SUBAGENT", payload: subagentId });
  };

  const closeSubagentModal = () => {
    setSelectedSubagentId(null);
    dispatch({ type: "SELECT_SUBAGENT", payload: null });
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
        return parts.length > 0 ? `ref${index + 1}: ${parts.join(" ")}` : null;
      }),
    ]
      .filter((item): item is string => !!item)
      .join("\n");
    await navigator.clipboard.writeText(refs);
  };

  useEffect(() => {
    const root = messageBodyRef.current;
    if (!root) return;

    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (!target.closest(".markdown-body")) return;

      const src = target.currentSrc || target.src;
      if (!src) return;
      setPreviewImageSrc(src);
    };

    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!isStreamingActive) return;
    const root = progressTimelineRef.current;
    if (!root) return;
    root.scrollTop = root.scrollHeight;
  }, [isStreamingActive, visibleDisplayEvents.length]);

  const responseEnterClass = streaming
    ? "oc-assistant-streaming-enter"
    : "oc-assistant-response-enter";

  return (
    <div
      id={messageId ? `msg-${messageId}` : undefined}
      data-message-id={messageId || undefined}
      className={`oc-message-enter ${responseEnterClass} ${isContiguous ? "mb-4 mt-[-12px]" : "mb-5"} px-4`}
    >
      <div
        className={cn(
          "oc-msg-assistant",
          isLiveStreamingCard && "max-h-[72vh] overflow-hidden",
        )}
        ref={messageBodyRef}
      >
        {!isContiguous && (
          <div className="mb-2.5 flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
              {showStreamingLoading ? (
                <ThinkingStatusTicker className="text-[#4e648c]" />
              ) : (
                <>
                  <div className="oc-msg-header-left flex items-center gap-1.5 min-w-0">
                    <div
                      className="oc-agent-icon flex items-center justify-center rounded-md p-1"
                      style={
                        agentColor
                          ? { backgroundColor: `${agentColor}26` }
                          : { backgroundColor: "var(--oc-accent-soft)" }
                      }
                    >
                      <Zap
                        className="h-4 w-4"
                        style={
                          agentColor
                            ? { color: agentColor }
                            : { color: "var(--oc-accent)" }
                        }
                      />
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span
                        className="oc-msg-agent-name px-2 py-0.5 rounded-md font-semibold text-oc-sm truncate shrink-0"
                        style={
                          agentColor
                            ? {
                                color: agentColor,
                                backgroundColor: `${agentColor}1a`,
                              }
                            : undefined
                        }
                      >
                        {agentName !== "assistant" ? agentName : "AI"}
                      </span>
                      {modelName && modelName !== "assistant" && (
                        <div className="flex items-center gap-1.5 opacity-60 min-w-0 truncate">
                          <span className="text-oc-xs font-mono shrink-0">
                            •
                          </span>
                          <span className="oc-msg-model-label truncate text-oc-xs">
                            {modelName}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  {hasTokens && (
                    <div className="oc-msg-token-chips flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] sm:ml-auto sm:text-[12px]">
                      <span
                        title="Tokens in system prompt + conversation history + your message"
                        className="cursor-help decoration-dotted underline underline-offset-2"
                      >
                        prompt
                      </span>
                      <span
                        className="tabular-nums cursor-help"
                        title="Tokens in system prompt + conversation history + your message"
                      >
                        {inputTok.toLocaleString()}
                      </span>
                      <span className="opacity-30">-</span>
                      <span
                        title="Tokens generated in this reply"
                        className="cursor-help decoration-dotted underline underline-offset-2"
                      >
                        response
                      </span>
                      <span
                        className="tabular-nums cursor-help"
                        title="Tokens generated in this reply"
                      >
                        {outputTok.toLocaleString()}
                      </span>
                      {reasoningTok > 0 && (
                        <>
                          <span className="opacity-30">-</span>
                          <span
                            title="Internal reasoning tokens reported by provider/model"
                            className="cursor-help decoration-dotted underline underline-offset-2"
                          >
                            reasoning
                          </span>
                          <span
                            className="tabular-nums cursor-help"
                            title="Internal reasoning tokens reported by provider/model"
                          >
                            {reasoningTok.toLocaleString()}
                          </span>
                        </>
                      )}
                      {cacheRead > 0 && (
                        <>
                          <span className="opacity-30">-</span>
                          <span
                            title="Tokens retrieved from prompt cache"
                            className="cursor-help decoration-dotted underline underline-offset-2"
                          >
                            cache read
                          </span>
                          <span
                            className="tabular-nums cursor-help"
                            title="Tokens retrieved from prompt cache"
                          >
                            {cacheRead.toLocaleString()}
                          </span>
                        </>
                      )}
                      {cacheWrite > 0 && (
                        <>
                          <span className="opacity-30">-</span>
                          <span
                            title="New tokens written to prompt cache"
                            className="cursor-help decoration-dotted underline underline-offset-2"
                          >
                            cache write
                          </span>
                          <span
                            className="tabular-nums cursor-help"
                            title="New tokens written to prompt cache"
                          >
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

        <div className="space-y-3">
          {(displayEvents.length > 0 || showThinkingPlaceholder) && (
            <section
              data-assistant-section="activity"
              className="rounded-md border border-oc-border bg-oc-panel-soft/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-left"
                  onClick={() =>
                    setViewState((prev) => ({
                      ...prev,
                      activityExpanded: !prev.activityExpanded,
                    }))
                  }
                  title="Toggle activity panel"
                >
                  {viewState.activityExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-oc-text-muted" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-oc-text-muted" />
                  )}
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-oc-text-soft">
                    Activity
                  </span>
                  <span className="rounded border border-oc-border px-1.5 py-0.5 font-mono text-[10px] text-oc-text-muted">
                    {displayEvents.length}
                  </span>
                </button>

                <div className="flex flex-wrap items-center gap-1.5">
                  {activityStatusCounts.pending > 0 && (
                    <span className="rounded border border-oc-border px-1.5 py-0.5 font-mono text-[10px] text-oc-accent">
                      pending {activityStatusCounts.pending}
                    </span>
                  )}
                  {activityStatusCounts.done > 0 && (
                    <span className="rounded border border-oc-border px-1.5 py-0.5 font-mono text-[10px] text-oc-green">
                      done {activityStatusCounts.done}
                    </span>
                  )}
                  {activityStatusCounts.error > 0 && (
                    <span className="rounded border border-oc-border px-1.5 py-0.5 font-mono text-[10px] text-oc-red">
                      error {activityStatusCounts.error}
                    </span>
                  )}
                  <button
                    type="button"
                    className="rounded border border-oc-border px-1.5 py-0.5 font-mono text-[10px] text-oc-text-muted hover:text-oc-text-soft"
                    onClick={() =>
                      setViewState((prev) => ({
                        ...prev,
                        showActivityDetails: !prev.showActivityDetails,
                      }))
                    }
                    title="Toggle activity metadata"
                  >
                    details {viewState.showActivityDetails ? "on" : "off"}
                  </button>
                  {hasThinkingEvents && (
                    <button
                      type="button"
                      className="rounded border border-oc-border px-1.5 py-0.5 font-mono text-[10px] text-oc-text-muted hover:text-oc-text-soft"
                      onClick={() =>
                        setViewState((prev) => ({
                          ...prev,
                          showThinkingDetails: !prev.showThinkingDetails,
                        }))
                      }
                      title="Toggle full thinking text"
                    >
                      thinking{" "}
                      {viewState.showThinkingDetails ? "full" : "preview"}
                    </button>
                  )}
                </div>
              </div>

              {viewState.activityExpanded && (
                <div className="border-t border-oc-border px-3 py-2.5">
                  {showThinkingPlaceholder && (
                    <div className="mb-2 rounded-md border border-oc-border bg-oc-bg-soft px-2.5 py-2 text-xs text-oc-text-muted whitespace-pre-wrap">
                      {thinkingPlaceholderText}
                    </div>
                  )}

                  {displayEvents.length > 0 && (
                    <>
                      <Stepper
                        className="max-h-[320px] overflow-y-auto pl-1 font-sans text-[12px]"
                        ref={progressTimelineRef}
                      >
                        {visibleDisplayEvents.map((event, index) => {
                          const isLast =
                            index === visibleDisplayEvents.length - 1;
                          const isLatestStreamingEvent =
                            isStreamingActive && isLast;
                          const indicatorNode =
                            event.status === "pending" ? (
                              <div className="h-2 w-2 rounded-full border border-oc-accent/70 bg-oc-accent/30 animate-pulse" />
                            ) : event.status === "error" ? (
                              <X className="h-[10px] w-[10px] text-[var(--vscode-terminal-ansiRed,#ef4444)]" />
                            ) : (
                              <div className="h-2 w-2 rounded-full bg-oc-green" />
                            );
                          const fileName = event.filePath
                            ? event.filePath.split(/[/\\]/).pop()
                            : undefined;
                          const shouldShowDetail =
                            event.kind === "thinking"
                              ? viewState.showThinkingDetails
                              : viewState.showActivityDetails;

                          return (
                            <StepperItem
                              key={event.key}
                              isLast={isLast}
                              indicator={indicatorNode}
                              className={cn(
                                "group rounded-md pr-3 transition-colors",
                                isLatestStreamingEvent
                                  ? "bg-oc-accent/10"
                                  : "hover:bg-foreground/5",
                              )}
                            >
                              <div className="flex min-w-0 items-start gap-2.5 pt-[3px]">
                                <span className="inline-block min-w-[64px] shrink-0 rounded border border-oc-border px-1.5 py-[3px] text-center font-mono text-[10px] font-semibold uppercase text-oc-text-muted">
                                  {event.kind === "thinking"
                                    ? "thinking"
                                    : event.label}
                                </span>

                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                  {event.filePath ? (
                                    <button
                                      type="button"
                                      className="inline-flex min-w-0 items-center gap-1 text-left font-mono text-[12px] text-oc-text-soft hover:text-oc-accent"
                                      title={event.filePath}
                                      onClick={() =>
                                        vscode.postMessage({
                                          type: "openFile",
                                          file: event.filePath!,
                                        })
                                      }
                                    >
                                      <FileIcon filePath={event.filePath} />
                                      <span className="break-words whitespace-pre-wrap">
                                        {fileName || event.summary}
                                      </span>
                                    </button>
                                  ) : (
                                    event.summary && (
                                      <span className="block break-words whitespace-pre-wrap text-[12.5px] text-oc-text-muted">
                                        {event.summary}
                                      </span>
                                    )
                                  )}

                                  {event.description && (
                                    <span className="block whitespace-pre-wrap break-words text-[11px] text-oc-text-muted">
                                      {event.description}
                                    </span>
                                  )}

                                  {event.updateCount > 1 && (
                                    <span className="text-[10px] font-mono text-oc-text-muted">
                                      x{event.updateCount} updates
                                    </span>
                                  )}

                                  {shouldShowDetail && event.detail && (
                                    <span className="block whitespace-pre-wrap break-words text-[11px] text-oc-text-muted">
                                      {event.detail}
                                    </span>
                                  )}
                                </span>

                                {event.diffStats &&
                                  (event.diffStats.added > 0 ||
                                    event.diffStats.deleted > 0) && (
                                    <span className="flex shrink-0 items-center gap-1 text-[10px] font-mono">
                                      {event.diffStats.added > 0 && (
                                        <span className="text-oc-green">
                                          +{event.diffStats.added}
                                        </span>
                                      )}
                                      {event.diffStats.deleted > 0 && (
                                        <span className="text-oc-red">
                                          -{event.diffStats.deleted}
                                        </span>
                                      )}
                                    </span>
                                  )}

                                {event.viewDiffFile && (
                                  <button
                                    type="button"
                                    className="shrink-0 rounded border border-oc-border px-2 py-0.5 text-[10px] font-medium text-oc-text-muted hover:text-oc-text-soft"
                                    onClick={() =>
                                      vscode.postMessage({
                                        type: "openDiff",
                                        file: event.viewDiffFile,
                                      })
                                    }
                                  >
                                    View diff
                                  </button>
                                )}
                              </div>
                            </StepperItem>
                          );
                        })}
                      </Stepper>

                      {!isStreamingActive &&
                        displayEvents.length >
                          MAX_VISIBLE_COMPLETED_ACTIVITY && (
                          <button
                            type="button"
                            className="mt-2 text-[11px] font-mono text-oc-accent hover:underline"
                            onClick={() =>
                              setViewState((prev) => ({
                                ...prev,
                                showAllCompletedActivity:
                                  !prev.showAllCompletedActivity,
                              }))
                            }
                          >
                            {hasCompletedCondensedActivity
                              ? "Show " +
                                hiddenActivityEventCount +
                                " older events"
                              : "Show fewer events"}
                          </button>
                        )}
                    </>
                  )}
                </div>
              )}
            </section>
          )}

          {showResponseSection && (
            <section
              data-assistant-section="response"
              className="rounded-md border border-oc-border bg-background p-3.5 shadow-sm"
            >
              <div className={responseBodyClass}>
                <MarkdownRenderer
                  content={content}
                  className={markdownBodyClass}
                />
              </div>
            </section>
          )}
        </div>

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

        <ImagePreviewModal
          isOpen={previewImageSrc !== null}
          imageSrc={previewImageSrc}
          imageAlt="Conversation image"
          title="Image Preview"
          onClose={() => setPreviewImageSrc(null)}
        />

        {selectedSubagentId &&
          (() => {
            const selected = subagents.find(
              (subagent) => subagent.id === selectedSubagentId,
            );
            if (!selected) return null;

            const detailData =
              (subagentDetailsById[selected.id] as
                | SubagentDetail
                | undefined) ||
              ({
                ...selected,
                thinkingEvents: [],
                progressEvents: [],
                timelineEvents: [],
              } as SubagentDetail);
            const providerLabel = subagentModelLabel(selected, detailData);
            const displayTitle = subagentAgentLabel(selected, detailData);

            return (
              <SubagentDetailModal
                isOpen={Boolean(selectedSubagentId)}
                title={displayTitle}
                providerLabel={providerLabel}
                detail={detailData}
                colorClass={getSubagentColor(selected.id)}
                onClose={closeSubagentModal}
                onCopyRefs={copyRefs}
                onJumpToParent={() =>
                  jumpToMessage(selected.parentMessageId || messageId || "")
                }
              />
            );
          })()}

        {subagents.length > 0 && (
          <div className="mt-3 mb-3 overflow-hidden rounded-md border border-oc-border bg-oc-panel-soft">
            <button
              type="button"
              className="w-full border-b border-oc-border px-2.5 py-2 text-left hover:bg-oc-panel"
              onClick={() => setShowSubagents((value) => !value)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-oc-accent" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-oc-text-soft">
                    Spawned Subagents
                  </span>
                  <span className="rounded-md border border-oc-border px-1.5 py-0.5 font-mono text-oc-2xs text-oc-text-muted">
                    {subagents.length}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {subagentStatusCounts.running > 0 && (
                    <Badge className="h-5 bg-oc-accent/10 px-1.5 text-[10px] text-oc-accent">
                      {subagentStatusCounts.running} running
                    </Badge>
                  )}
                  {subagentStatusCounts.done > 0 && (
                    <Badge className="h-5 bg-oc-green/10 px-1.5 text-[10px] text-oc-green">
                      {subagentStatusCounts.done} done
                    </Badge>
                  )}
                  {subagentStatusCounts.error > 0 && (
                    <Badge className="h-5 bg-oc-red/10 px-1.5 text-[10px] text-oc-red">
                      {subagentStatusCounts.error} error
                    </Badge>
                  )}
                </div>
              </div>
            </button>

            {showSubagents && (
              <div className="space-y-2 p-2.5">
                <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
                  {visibleSubagents.map((subagent: SubagentSummary) => {
                    const detail = subagentDetailsById[subagent.id] as
                      | SubagentDetail
                      | undefined;
                    const agentLabel = subagentAgentLabel(subagent, detail);
                    const modelInfo = subagentModelLabel(subagent, detail);
                    const cardStyle = getSubagentCardStyle(subagent.id);
                    const accentTextStyle = getSubagentAccentTextStyle(
                      subagent.id,
                    );
                    const metaStyle = getSubagentMetaStyle(subagent.id);
                    const statusText =
                      subagentStatusLabel(subagent.status) || "Pending";
                    const activityText =
                      subagent.latestActivity ||
                      statusText ||
                      "Initializing...";
                    const shouldShowActivity =
                      activityText.trim().toLowerCase() !==
                      statusText.trim().toLowerCase();

                    return (
                      <button
                        key={subagent.id}
                        type="button"
                        className={cn(
                          "w-full rounded-md border border-oc-border bg-oc-bg-soft px-2 py-1.5 text-left transition-colors",
                          "hover:bg-oc-panel",
                        )}
                        style={cardStyle}
                        onClick={() => openSubagentModal(subagent.id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <div
                              className="oc-agent-icon shrink-0"
                              style={accentTextStyle}
                            >
                              {subagent.status === "running" ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : subagent.status === "error" ? (
                                <X className="h-3 w-3 text-oc-red" />
                              ) : (
                                <Check className="h-3 w-3" />
                              )}
                            </div>
                            <span className="truncate text-oc-xs font-semibold text-oc-text-soft">
                              {agentLabel}
                            </span>
                          </div>
                          <span className="font-mono text-oc-2xs text-oc-text-muted">
                            {formatDurationMs(subagent.durationMs)}
                          </span>
                        </div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5">
                          <span
                            className="truncate rounded-sm border px-1 py-0.5 font-mono text-[10px] leading-none text-oc-text-soft"
                            style={metaStyle}
                            title={modelInfo}
                          >
                            {modelInfo}
                          </span>
                          <span className="text-[10px] font-medium text-oc-text-muted">
                            {statusText}
                          </span>
                        </div>
                        {shouldShowActivity ? (
                          <div className="mt-0.5 min-h-[14px] font-mono text-[10px] text-oc-text-muted">
                            <FadeSwapText
                              text={activityText}
                              className="block truncate"
                              durationMs={220}
                            />
                          </div>
                        ) : null}
                      </button>
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
              </div>
            )}
          </div>
        )}
        {/* Raw Data â€” moved last so it doesn't interrupt the reading flow */}
        {/* {(message || streaming) && (
          <details className="group mb-3">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-oc-xs font-mono text-oc-text-muted hover:text-oc-text-soft transition-colors">
              <span className="inline-block text-oc-2xs transition-transform group-open:rotate-90">
                â€º
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
        )} */}
        {/* FORBIDDEN TO REMOVE: Plan card rendering - core UI element for viewing implementation plans */}
        {plan ? (
          <div className="plan-card mt-3 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="text-oc-xs font-semibold text-oc-text-soft uppercase tracking-widest font-mono">
                  {plan.title || "Implementation Plan"}
                </div>
                {plan.summary && (
                  <div className="text-[11px] text-oc-text-muted line-clamp-2">
                    {plan.summary}
                  </div>
                )}
              </div>
              <button
                type="button"
                title="Core Feature: View Implementation Plan"
                onClick={() => vscode.postMessage({ type: "viewPlan", plan })}
                className="oc-plan-btn shrink-0"
              >
                <FileTextIcon className="h-3 w-3" />
                View Plan
              </button>
            </div>
            {message?.edits && message.edits.length > 0 && (
              <div className="flex items-center gap-2 pt-1.5 border-t border-oc-border/50">
                <span className="text-[10px] font-mono text-oc-text-muted">
                  {message.edits.length} file{message.edits.length !== 1 ? "s" : ""} changed
                </span>
                <button
                  type="button"
                  title="Review all file changes in diff viewer"
                  onClick={() => vscode.postMessage({ type: "reviewChanges" })}
                  className="oc-plan-btn shrink-0"
                >
                  <Layers className="h-3 w-3" />
                  Review All Changes
                </button>
              </div>
            )}
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
            <span className="text-oc-2xs">⚠️</span>
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
  const errorDetails =
    typeof message === "string" && message.trim().length > 0
      ? message.trim()
      : "Unknown error";

  return (
    <div className="mb-2 px-4">
      <div className="flex flex-col gap-2 rounded-lg border border-[#dc262680] bg-[#7f1d1d26] p-2.5 text-oc-xs text-[#fee2e2] shadow-[0_4px_14px_rgba(127,29,29,0.18)] transition-all duration-200">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-[#ef444480] bg-[#ef444426]">
            <AlertCircle className="h-3 w-3 shrink-0 text-[#fca5a5]" />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[#fca5a5]">
            Request failed
          </span>
        </div>

        <div className="rounded-md border border-[#ef444440] bg-[#450a0a59] px-2 py-1.5">
          <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#fca5a5]">
            Error message
          </div>
          <div className="overflow-hidden text-[11px] leading-snug text-[#fee2e2] whitespace-pre-wrap break-words">
            {errorDetails}
          </div>
        </div>

        {onRetry && (
          <div className="flex justify-start">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#ef444480] bg-[#ef444426] px-2.5 py-1 text-[11px] font-medium text-[#fecaca] transition-all hover:bg-[#ef444440] active:scale-95"
            >
              <RotateCw className="h-3 w-3" />
              <span>Retry</span>
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
      <ThinkingStatusTicker className="pl-1 text-[#4e648c]" />
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
