import {
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  FileText as FileTextIcon,
  Loader2,
  X,
  Sparkles,
  CornerDownLeft,
  AtSign,
  Terminal,
  RotateCw,
  AlertCircle,
  AlertTriangle,
  Clock,
  HelpCircle,
  Info,
  FileCode,
  ArrowUpRight,
  Undo2,
  CheckSquare,
  Circle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Stepper, StepperItem } from "@/components/ui/stepper";
import { TerminalBlock } from "@/components/ui/TerminalBlock";
import { SearchBlock } from "@/components/ui/SearchBlock";
import { ExpandableStep } from "@/components/ui/ExpandableStep";
import { StepIndicator } from "@/components/ui/StepIndicator";
import { cn, formatDuration, toWorkspaceRelativePath } from "@/utils";

import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { CallOmoAgentStep } from "./components/activity-steps/CallOmoAgentStep";
import { BackgroundOutputStep } from "./components/activity-steps/BackgroundOutputStep";
import { DiffPreviewStep } from "./components/activity-steps/DiffPreviewStep";
import { ActivityDiffExcerpt } from "./components/ActivityDiffExcerpt";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { SubagentDetailModal } from "./SubagentDetailModal";
import { DiffStats } from "./DiffStats";
import {
  asString,
  getCentralizedAssistantContentChunksFromRawSdkEventPayloads,
  getCentralizedEventPart,
  latestAssistantMessageIdFromCentralizedTape,
  normalizeCentralizedEventPayloads,
  structuredOutputFromRawSdkEventPayloads,
  isAiResponseEvent,
} from "./lib/messageHandler";
import {
  hasActiveAssistantReplyInCentralizedTape,
} from "./lib/sessionProcessing";
import { hasSystemMessagePatternInText } from "./lib/store";
import logger, { getGlobalShowBrowserConsole } from "./lib/logger";
import { FILE_MENTION_REGEX } from "./PanelComponents";

import type {
  ActivityDetail,
  AppState,
  CentralizedDebugData,
  CentralizedDebugSourceData,
  InteractiveEvent,
  Message,
  MessagePart,
  MessageStep,
  Model,
  ReasoningEvent,
  StreamingState,
  StreamingStep,
  StructuredFileChange,
  SubagentDetail,
  SubagentSummary,
  TodoItem,
} from "./lib/types";
import type { DisplayError } from "../../../../src/providers/chat/types";
import { useAppDispatch, useAppState } from "./lib/store";
import { jumpToMessage } from "./lib/messageJump";
import vscode from "./lib/vscode";
import {
  getSubagentDisplayActivity,
  getSubagentDisplayDurationMs,
} from "./lib/subagentDuration";
import { config } from "../config";

// File extension color mapping for icons
const FILE_COLOR_MAP: Record<string, string> = {
  ts: "#3178c6",
  js: "#f1e05a",
  tsx: "#3178c6",
  jsx: "#f1e05a",
  mjs: "#f1e05a",
  cjs: "#f1e05a",
  css: "#563d7c",
  scss: "#c6538c",
  less: "#1d365d",
  html: "#e34c26",
  htm: "#e34c26",
  json: "#f1e05a",
  jsonc: "#f1e05a",
  md: "#083fa1",
  mdx: "#083fa1",
  vue: "#41b883",
  svelte: "#ff3e00",
  py: "#3572A5",
  pyi: "#3572A5",
  go: "#00ADD8",
  mod: "#00ADD8",
  java: "#b07219",
  rs: "#dea584",
  php: "#4F5D95",
  rb: "#701516",
  swift: "#ffac45",
  kt: "#F18E33",
  kts: "#F18E33",
  c: "#555555",
  cpp: "#f34b7d",
  cc: "#f34b7d",
  cxx: "#f34b7d",
  h: "#a8ff97",
  hpp: "#a8ff97",
  hxx: "#a8ff97",
  cs: "#178600",
  fs: "#b845fc",
  dart: "#00B4AB",
  lua: "#000080",
  zig: "#f7a41d",
  nim: "#ffc200",
  r: "#198CE7",
  scala: "#c22d40",
  elixir: "#6e4a7e",
  erl: "#0d7377",
  clj: "#db5855",
  hs: "#5e5086",
  ml: "#f39e02",
  sql: "#e38c00",
  graphql: "#e535ab",
  gql: "#e535ab",
  prisma: "#0c344b",
  yaml: "#cb171e",
  yml: "#cb171e",
  toml: "#9c4221",
  xml: "#0060ac",
  svg: "#ff9900",
  sh: "#89e051",
  bash: "#89e051",
  zsh: "#89e051",
  fish: "#89e051",
  ps1: "#012456",
  bat: "#c1f12e",
  dockerfile: "#384d54",
  makefile: "#427819",
  cmake: "#064f8c",
  lock: "#6e7681",
  env: "#ecd53f",
  gitignore: "#f54d27",
  config: "#6e7681",
  conf: "#6e7681",
  ini: "#6e7681",
  txt: "#6e7681",
  log: "#6e7681",
  csv: "#239124",
  tsv: "#239124",
  wasm: "#654ff0",
  proto: "#e535ab",
  tf: "#7b42bc",
  hcl: "#7b42bc",
};

// Extract file extension from path
function getFileExtension(path: string): string {
  const fileName = (path.split(/[\\/]/).pop() || "").split(":")[0];
  const index = fileName.lastIndexOf(".");
  return index >= 0 && index < fileName.length - 1
    ? fileName.slice(index + 1).toLowerCase()
    : "";
}

// Get color for file extension
function getFileColor(ext: string): string {
  return FILE_COLOR_MAP[ext] || "var(--oc-text-muted)";
}

// Check if a path is a URL (http/https)
function isUrl(path: string): boolean {
  if (!path || typeof path !== "string") {
    return false;
  }
  const trimmed = path.trim().toLowerCase();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

function isCallStyleActivityLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return (
    normalized.startsWith("call_") ||
    normalized === "background_task" ||
    normalized === "background task" ||
    normalized === "background-task"
  );
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

function isActivityLikePart(part: MessagePart): boolean {
  const activityKeys: Array<keyof MessagePart | string> = [
    "title",
    "label",
    "summary",
    "status",
    "tool",
    "callID",
    "callId",
    "activityDetail",
    "diffStats",
    "filePath",
    "file",
    "path",
    "priority",
    "state",
    "input",
    "result",
  ];

  return activityKeys.some((key) => typeof (part as Record<string, unknown>)[key] !== "undefined");
}

function isRenderableAssistantTextPart(part: MessagePart): boolean {
  if (isReasoningPart(part)) {
    return false;
  }
  const type = (part.type ?? "").toLowerCase();
  if (type) {
    return type === "text" || type === "message" || type === "output_text";
  }
  const hasTextLikeField =
    typeof part.text === "string" ||
    typeof part.content === "string" ||
    typeof part.message === "string";
  if (!hasTextLikeField) {
    return false;
  }
  return !isActivityLikePart(part);
}

function normalizeErrorLikeValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeErrorLikeValue(entry))
      .filter((entry) => entry.length > 0)
      .join(" ");
  }
  if (value instanceof Error) {
    return value.message || String(value);
  }
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const preferred =
      normalizeErrorLikeValue(rec.message) ||
      normalizeErrorLikeValue(rec.error) ||
      normalizeErrorLikeValue(rec.text) ||
      normalizeErrorLikeValue(rec.content);
    if (preferred) {
      return preferred;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function isStructuredOutputFailureMessage(value?: unknown): boolean {
  const normalized = normalizeErrorLikeValue(value).trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("structured output error") ||
    normalized.includes("empty structured payload") ||
    normalized.includes("valid structured response") ||
    normalized.includes("json_schema") ||
    normalized.includes("structuredoutput")
  );
}

function patchMessageRetryState(
  message: Message,
  retryWithoutStructuredOutput: boolean,
): Message {
  const retryMessage = retryWithoutStructuredOutput
    ? "Retrying without structured output..."
    : "Retrying request...";
  const existingParts = Array.isArray(message.parts) ? [...message.parts] : [];
  const nextParts =
    existingParts.length > 0
      ? existingParts.map((part, index) => {
        if (index === 0 && (part.type === "text" || !part.type)) {
          return { ...part, type: "text", text: retryMessage };
        }
        return part;
      })
      : [{ type: "text", text: retryMessage }];
  return {
    ...message,
    aborted: false,
    error: undefined,
    content: retryMessage,
    text: retryMessage,
    parts: nextParts,
    retryWithoutStructuredOutput,
    retryState: retryWithoutStructuredOutput
      ? "retrying_without_structured_output"
      : undefined,
    retryMessage,
    retryStartedAt: Date.now(),
  };
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

function isBackgroundTaskId(value: string | undefined): boolean {
  if (!value) return false;
  return /^bg_[a-z0-9]+$/i.test(value.trim());
}

function deriveSubagentRole(subagent: SubagentSummary): string | undefined {
  const directRole = (subagent.agentRole || "").trim().toLowerCase();
  if (directRole) return directRole;
  const candidate = (subagent.agentId || "").trim().toLowerCase();
  const knownRoles = new Set([
    "explorer",
    "explore",
    "librarian",
    "library",
    "worker",
    "default",
    "researcher",
    "planner",
  ]);
  return knownRoles.has(candidate) ? candidate : undefined;
}

function resolveSubagentStatus(
  subagent: SubagentSummary,
  detail?: SubagentDetail,
): SubagentSummary["status"] {
  const hasTerminalStopMarker = !!(
    detail &&
    (
      (Array.isArray(detail.timelineEvents) &&
        detail.timelineEvents.some((event) => {
          const type = (event.type || "").toLowerCase();
          const label = (event.label || "").toLowerCase();
          return type === "stop" || type === "stopped" || label === "stop" || label === "stopped";
        })) ||
      (Array.isArray(detail.progressEvents) &&
        detail.progressEvents.some((event) => {
          const title = (event.title || "").trim().toLowerCase();
          return title === "stop" || title === "stopped";
        })) ||
      (Array.isArray(detail.conversationEvents) &&
        detail.conversationEvents.some((event) => {
          const kind = (event.kind || "").toLowerCase();
          return kind === "stop" || kind === "stopped";
        }))
    )
  );

  // If subagent has ended, don't show it as running
  const hasEnded = subagent.endedAt || detail?.endedAt;
  if (hasEnded && !detail?.errorText && subagent.status === "running") {
    return "done";
  }

  const detailStatus = detail?.status;
  if (detailStatus === "error" || detailStatus === "orphaned") {
    return detailStatus;
  }
  if (detailStatus === "done") {
    return hasTerminalStopMarker ? "done" : "running";
  }
  if (subagent.status === "done") {
    return hasTerminalStopMarker ? "done" : "running";
  }
  return detailStatus || subagent.status;
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

function debugFieldValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function debugEntryKey(entry: unknown, preferredFields: string[]): string {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return `primitive:${String(entry)}`;
  }

  const record = entry as Record<string, unknown>;
  const preferred = preferredFields
    .map((field) => debugFieldValue(record[field]))
    .filter(Boolean)
    .join("|");
  if (preferred) {
    return preferred;
  }

  const fallbackFields = [
    "id",
    "key",
    "type",
    "kind",
    "label",
    "title",
    "status",
    "messageID",
    "partID",
    "callID",
    "messageId",
    "partId",
    "callId",
    "text",
  ];
  const fallback = fallbackFields
    .map((field) => debugFieldValue(record[field]))
    .filter(Boolean)
    .join("|");
  if (fallback) {
    return fallback;
  }

  return Object.entries(record)
    .slice(0, 6)
    .map(([key, value]) => `${key}:${debugFieldValue(value)}`)
    .join("|");
}

function dedupeDebugArray<T extends Record<string, unknown>>(
  items: unknown,
  preferredFields: string[],
): T[] | undefined {
  if (!Array.isArray(items)) {
    return undefined;
  }

  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const entry of items) {
    const key = debugEntryKey(entry, preferredFields);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry as T);
  }

  return deduped;
}

function valuesHaveSameDebugShape(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (left === null || right === null) {
    return false;
  }
  if (typeof left !== typeof right) {
    return false;
  }
  if (typeof left !== "object") {
    return false;
  }

  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

const COMPACTABLE_DEBUG_INFO_FIELDS = new Set([
  "parentID",
  "parentId",
  "role",
  "mode",
  "agent",
  "variant",
  "path",
  "cost",
  "tokens",
  "modelID",
  "providerID",
  "time",
  "finish",
  "id",
  "sessionID",
  "sessionId",
]);

function objectHasMatchingSubset(
  candidate: Record<string, unknown>,
  source: Record<string, unknown>,
): boolean {
  return Object.entries(candidate).every(([key, candidateValue]) => {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      return false;
    }
    return valuesHaveSameDebugShape(candidateValue, source[key]);
  });
}

function compactDuplicateDebugFields(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return value;
    }
    seen.add(value);
    return value.map((item) => compactDuplicateDebugFields(item, seen));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value as object)) {
    return value;
  }
  seen.add(value as object);

  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    next[key] = compactDuplicateDebugFields(child, seen);
  }

  const infoValue = next.info;
  if (infoValue && typeof infoValue === "object" && !Array.isArray(infoValue)) {
    const infoRecord = infoValue as Record<string, unknown>;
    if (
      Object.keys(infoRecord).every((infoKey) =>
        COMPACTABLE_DEBUG_INFO_FIELDS.has(infoKey),
      ) &&
      objectHasMatchingSubset(infoRecord, next)
    ) {
      delete next.info;
    }
  }

  return next;
}

function normalizeToastTitle(title: string): string {
  return title
    .replace(/^[\s\u2022\u00b7\u25cf\u25cb\u25a1\u25aa\u25ab]+/u, "")
    .trim();
}

function compactCentralizedRawSdkEventPayloadsForDebug(
  rawSdkEventPayloads?: unknown[],
): unknown[] | undefined {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return undefined;
  }

  const seen = new Set<string>();
  const compacted: unknown[] = [];

  for (const entry of rawSdkEventPayloads) {
    const rec = asRecord(entry);
    if (!rec) {
      compacted.push(entry);
      continue;
    }

    const eventType = asString(rec.type) ?? "";
    const source = asString(rec.source) ?? "";

    let key = "";
    if (eventType === "tui.toast.show") {
      const properties = asRecord(rec.properties);
      key = [
        eventType,
        normalizeToastTitle(asString(properties?.title) ?? ""),
        asString(properties?.message) ?? "",
        asString(properties?.variant) ?? "",
        asString(rec.sessionId) ?? "",
      ].join("|");
    } else if (eventType === "sync") {
      const syncEvent = asRecord(rec.syncEvent);
      const data = asRecord(syncEvent?.data);
      const info = asRecord(data?.info);
      const structured = asRecord(info?.structured);
      const tokens = asRecord(info?.tokens);
      key = [
        eventType,
        asString(syncEvent?.type) ?? "",
        asString(syncEvent?.aggregateID) ?? "",
        asString(data?.sessionID) ?? "",
        asString(info?.id) ?? "",
        asString(info?.parentID) ?? "",
        asString(info?.role) ?? "",
        asString(info?.mode) ?? "",
        asString(info?.agent) ?? "",
        asString(info?.modelID) ?? "",
        asString(info?.providerID) ?? "",
        asString(info?.finish) ?? "",
        asString(structured?.type ?? structured?.responseType) ?? "",
        asString(structured?.text ?? structured?.message) ?? "",
        typeof tokens?.total === "number" ? String(tokens.total) : "",
        typeof tokens?.input === "number" ? String(tokens.input) : "",
        typeof tokens?.output === "number" ? String(tokens.output) : "",
      ].join("|");
    } else {
      key = [
        eventType,
        source,
        asString(rec.id) ?? "",
        asString(rec.sessionId) ?? "",
        asString(rec.type) ?? "",
      ].join("|");
    }

    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    compacted.push(entry);
  }

  return compacted;
}

function sanitizeStructuredOutputForDebug(
  value: unknown,
  depth = 0,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStructuredOutputForDebug(item, depth));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "raw" && depth >= 1) {
      continue;
    }
    next[key] = sanitizeStructuredOutputForDebug(child, key === "raw" ? depth + 1 : depth);
  }

  return next;
}

function arraysHaveSameDebugKeys(
  left: unknown[],
  right: unknown[],
  preferredFields: string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => {
    const leftKey = debugEntryKey(entry, preferredFields);
    const rightKey = debugEntryKey(right[index], preferredFields);
    return leftKey === rightKey;
  });
}

function compactDebugSubagent(subagent: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...subagent };
  const references = dedupeDebugArray<Record<string, unknown>>(
    subagent.references,
    ["messageID", "partID", "callID"],
  );
  if (references) {
    next.references = references;
  }

  const thinkingEvents = dedupeDebugArray<Record<string, unknown>>(
    subagent.thinkingEvents,
    ["id", "key", "type", "kind", "label", "title", "text", "createdAt"],
  );
  if (thinkingEvents) {
    next.thinkingEvents = thinkingEvents;
  }

  const conversationEvents = dedupeDebugArray<Record<string, unknown>>(
    subagent.conversationEvents,
    ["id", "key", "type", "kind", "label", "title", "messageID", "partID", "callID", "text"],
  );
  if (conversationEvents) {
    next.conversationEvents = conversationEvents;
  }

  const progressEvents = dedupeDebugArray<Record<string, unknown>>(
    subagent.progressEvents,
    ["id", "key", "type", "kind", "label", "title", "messageID", "partID", "callID"],
  );
  if (progressEvents) {
    next.progressEvents = progressEvents;
  }

  const timelineEvents = dedupeDebugArray<Record<string, unknown>>(
    subagent.timelineEvents,
    ["id", "key", "type", "kind", "label", "title", "messageID", "partID", "callID"],
  );
  if (timelineEvents) {
    next.timelineEvents = timelineEvents;
  }

  return next;
}

function compactDebugTimeline(value: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...value };
  const timelineKeyFields = [
    "id",
    "callID",
    "title",
    "status",
    "type",
    "partType",
    "source",
  ];
  const steps = dedupeDebugArray<Record<string, unknown>>(
    value.steps,
    timelineKeyFields,
  );
  const progressEvents = dedupeDebugArray<Record<string, unknown>>(
    value.progressEvents,
    timelineKeyFields,
  );

  if (
    steps &&
    progressEvents &&
    arraysHaveSameDebugKeys(steps, progressEvents, timelineKeyFields)
  ) {
    next.steps = steps;
    delete next.progressEvents;
  } else {
    if (steps) {
      next.steps = steps;
    }
    if (progressEvents) {
      next.progressEvents = progressEvents;
    }
  }

  const interactiveEvents = dedupeDebugArray<Record<string, unknown>>(
    value.interactiveEvents,
    ["id", "key", "type", "label", "title", "status", "value"],
  );
  if (interactiveEvents) {
    next.interactiveEvents = interactiveEvents;
  }

  const reasoningEvents = dedupeDebugArray<Record<string, unknown>>(
    value.reasoningEvents,
    ["id", "key", "type", "title", "text"],
  );
  if (reasoningEvents) {
    next.reasoningEvents = reasoningEvents;
  }

  const subagents = dedupeDebugArray<Record<string, unknown>>(value.subagents, ["id"]);
  if (subagents) {
    next.subagents = subagents.map((subagent) => compactDebugSubagent(subagent));
  }

  return next;
}

const SEARCH_LABELS = new Set(["grep", "search", "glob", "ripgrep", "ast-grep", "find"]);

function buildSearchPattern(...values: Array<string | undefined>): string {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const value of values) {
    if (!value) {
      continue;
    }

    for (const line of value.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const key = trimmed.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      lines.push(trimmed);
    }
  }

  return lines.join("\n");
}

// Component to extract bash output from message content
function TerminalBlockWithOutput({
  event,
  messageContent,
}: {
  event: DisplayEvent;
  messageContent: string;
}) {
  // Use activityDetail.command first as it contains the full unmodified command
  // Fall back to event.summary only if command is not available
  const command = event.activityDetail?.command || event.summary;

  // Try to extract bash output from message content
  // Look for text after the command that looks like terminal output
  let output = event.activityDetail?.output;

  if (!output && messageContent) {
    // The output might be in the message content after the command
    // Look for patterns like:
    // - "Running: npm run build" followed by output
    // - Command text followed by multi-line output
    const commandLower = command.toLowerCase();
    const contentLines = messageContent.split('\n');

    // Find lines that come after the command mention
    const commandIndex = contentLines.findIndex(line =>
      line.toLowerCase().includes(commandLower) ||
      line.toLowerCase().includes('running') ||
      line.toLowerCase().includes('executing')
    );

    if (commandIndex >= 0 && commandIndex < contentLines.length - 1) {
      // Get lines after the command (skip the command line itself)
      const outputLines = contentLines.slice(commandIndex + 1);

      // Filter out lines that look like other activity steps
      const terminalOutput = outputLines
        .filter(line => {
          const lineLower = line.trim().toLowerCase();
          // Skip if it looks like another step
          if (lineLower.startsWith('step') ||
            lineLower.startsWith('running') ||
            lineLower.startsWith('reading') ||
            lineLower.startsWith('writing') ||
            lineLower.startsWith('starting') ||
            lineLower.match(/^\d+\./) || // numbered lists
            line.length < 3) { // too short
            return false;
          }
          return true;
        })
        .join('\n')
        .trim();

      if (terminalOutput.length > 0) {
        output = terminalOutput;
      }
    }
  }

  return (
    <CollapsedTerminalBlockPreview
      title="Bash output"
      command={command}
      output={output}
    />
  );
}

const FALLBACK_ICON_COLOR = "#6e7681";

function cleanKey(key: string): string {
  return key
    .replace(/\./g, "-")
    .replace(/\//g, "-")
    .replace(/\+/g, "p")
    .replace(/#/g, "h")
    .replace(/,/g, "");
}

function looksLikeInternalPlanningText(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("i need to produce a plan") ||
    normalized.includes("i should call the tool") ||
    normalized.includes("i might be able to use structuredoutput") ||
    normalized.includes("i'm not actually writing a file") ||
    normalized.includes("as per the instruction")
  );
}

function getFileIconKeys(filePath?: string): string[] {
  if (!filePath) {
    return [];
  }

  const fileName = (filePath.split(/[\\/]/).pop() || "").split(":")[0].toLowerCase();
  if (!fileName) {
    return [];
  }

  const parts = fileName.split(".");
  const extensionKeys =
    parts.length > 1
      ? parts
        .slice(1)
        .map((_, index) => parts.slice(index + 1).join("."))
        .reverse()
      : [];

  return Array.from(new Set([fileName, ...extensionKeys].filter(Boolean)));
}

function hasThemeIcon(element: HTMLElement): boolean {
  const before = window.getComputedStyle(element, "::before");
  const content = before.getPropertyValue("content");
  const backgroundImage = before.getPropertyValue("background-image");

  return (
    (!!content && content !== "none" && content !== "normal" && content !== '""') ||
    (!!backgroundImage && backgroundImage !== "none")
  );
}

export function FileIcon({
  filePath,
  className,
}: {
  filePath?: string;
  className?: string;
}) {
  const [useGenericFileIcon, setUseGenericFileIcon] = useState(!filePath);
  const [showSvgFallback, setShowSvgFallback] = useState(false);
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const iconKeys = useMemo(() => getFileIconKeys(filePath), [filePath]);
  const { themeCssVersion } = useAppState();

  useEffect(() => {
    setUseGenericFileIcon(!filePath);
    setShowSvgFallback(false);
  }, [filePath, iconKeys.join("|")]);

  useEffect(() => {
    const icon = iconRef.current;
    if (!icon) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (hasThemeIcon(icon)) {
        if (useGenericFileIcon || showSvgFallback) {
          setUseGenericFileIcon(false);
          setShowSvgFallback(false);
        }
        return;
      }

      if (filePath && !useGenericFileIcon) {
        setUseGenericFileIcon(true);
        return;
      }

      setShowSvgFallback(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [filePath, iconKeys.join("|"), useGenericFileIcon, themeCssVersion]);

  return (
    <span
      ref={iconRef}
      className={cn(
        "file-icon",
        useGenericFileIcon
          ? "file-icon-type-file"
          : iconKeys.map((key) => `file-icon-type-${cleanKey(key)}`),
        className,
      )}
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        marginRight: "0",
        verticalAlign: "middle",
        width: "16px",
        height: "16px",
        overflow: "visible",
      }}
    >
      {showSvgFallback ? (
        <svg
          className="file-icon-svg"
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M3.5 1.75h6.25L13 5v9.25H3.5V1.75Z"
            fill={FALLBACK_ICON_COLOR}
            opacity="0.18"
          />
          <path
            d="M9.5 1.75V5.25H13M3.5 1.75h6.25L13 5v9.25H3.5V1.75Z"
            stroke={FALLBACK_ICON_COLOR}
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}

function formatMessageTime(timestamp?: number): string | null {
  if (!timestamp || typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function getMessageTimestamp(message?: Message): number | undefined {
  if (!message) return undefined;
  const rec = message as Record<string, unknown>;
  const info = rec.info as Record<string, unknown> | undefined;
  const infoTime = info ? (info.time as Record<string, unknown> | undefined) : undefined;
  const messageTime = rec.time as Record<string, unknown> | undefined;
  const numericCandidates = [
    messageTime?.created,
    infoTime?.created,
    rec.created,
    rec.createdAt,
    info?.createdAt,
    rec.timestamp,
    info?.timestamp,
  ];
  for (const candidate of numericCandidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      const parsed = new Date(candidate).getTime();
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function messageBodyFromParts(
  parts?: Array<MessagePart | Record<string, unknown> | null | undefined>,
): string {
  if (!parts) {
    return "";
  }
  return parts
    .map((part) => {
      const partRec = asRecord(part);
      if (!partRec || !isRenderableAssistantTextPart(partRec as MessagePart)) {
        return "";
      }
      return (
        (partRec.message as string | undefined) ??
        (partRec.text as string | undefined) ??
        (partRec.content as string | undefined) ??
        ""
      ).trim();
    })
    .filter((partText) => partText.length > 0)
    .join("\n\n")
    .trim();
}

function interactiveChoiceTextsFromMessage(message?: Message): string[] {
  if (!message) {
    return [];
  }

  const messageRec = asRecord(message);
  const infoRec = asRecord(messageRec?.info);
  const structured =
    asRecord(messageRec?.structuredOutput) ||
    asRecord(messageRec?.structured_output) ||
    asRecord(messageRec?.structured) ||
    asRecord(infoRec?.structuredOutput) ||
    asRecord(infoRec?.structured_output) ||
    asRecord(infoRec?.structured);
  const question = asRecord(structured?.question);

  const choiceTexts: string[] = [];
  const addChoiceText = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (trimmed) {
      choiceTexts.push(trimmed);
    }
  };
  const addChoiceRecord = (value: unknown) => {
    const rec = asRecord(value);
    if (!rec) {
      return;
    }
    addChoiceText(rec.label);
    addChoiceText(rec.value);
    addChoiceText(rec.description);
    addChoiceText(rec.title);
    addChoiceText(rec.message);
  };

  const questionChoices = [
    ...(Array.isArray(question?.options) ? question.options : []),
    ...(Array.isArray(question?.choices) ? question.choices : []),
    ...(Array.isArray(question?.actions) ? question.actions : []),
  ];
  questionChoices.forEach(addChoiceRecord);

  if (Array.isArray(message.interactiveEvents)) {
    for (const event of message.interactiveEvents) {
      const eventRec = asRecord(event);
      if (!eventRec) {
        continue;
      }
      const eventChoices = [
        ...(Array.isArray(eventRec.options) ? eventRec.options : []),
        ...(Array.isArray(eventRec.choices) ? eventRec.choices : []),
        ...(Array.isArray(eventRec.actions) ? eventRec.actions : []),
      ];
      eventChoices.forEach(addChoiceRecord);
    }
  }

  return choiceTexts;
}

function looksLikeFlattenedInteractiveEcho(
  questionPrompt: string,
  bodyContent: string,
  message?: Message,
): boolean {
  if (!questionPrompt.trim() || !bodyContent.trim()) {
    return false;
  }

  const promptNorm = normalizeComparableText(questionPrompt);
  const bodyNorm = normalizeComparableText(bodyContent);
  if (!promptNorm || !bodyNorm) {
    return false;
  }

  if (bodyNorm === promptNorm || bodyNorm.startsWith(promptNorm)) {
    return false;
  }

  const choiceFingerprints = interactiveChoiceTextsFromMessage(message)
    .map((text) => normalizeComparableText(text))
    .filter((text) => text.length >= 4);

  if (choiceFingerprints.length === 0) {
    return false;
  }

  let matches = 0;
  for (const fingerprint of choiceFingerprints) {
    if (bodyNorm.includes(fingerprint)) {
      matches += 1;
    }
  }

  return matches >= 2;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function collectMessageIdentityCandidates(message?: Message): Set<string> {
  const candidates = new Set<string>();
  if (!message) {
    return candidates;
  }
  const info = asRecord(message.info);
  const values = [
    message.id,
    (message as any).messageId,
    info?.id,
    info?.messageId,
  ];
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      candidates.add(value.trim());
    }
  }
  return candidates;
}

function collectAssistantTurnMessageIds(
  messages: Message[] | undefined,
  rootMessageId: string | null,
): Set<string> {
  const scopedIds = new Set<string>();
  const normalizedRootId = (rootMessageId || "").trim();
  if (!Array.isArray(messages) || messages.length === 0 || !normalizedRootId) {
    return scopedIds;
  }

  const queue: string[] = [normalizedRootId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (scopedIds.has(currentId)) {
      continue;
    }
    scopedIds.add(currentId);

    for (const candidate of messages) {
      const candidateInfo = asRecord(candidate.info);
      const candidateRole = (candidate.role ?? candidateInfo?.role ?? "").toString().toLowerCase();
      if (candidateRole !== "assistant") {
        continue;
      }

      const candidateIds = collectMessageIdentityCandidates(candidate);
      const parentId = firstNonEmptyString(
        candidateInfo?.parentID,
        candidateInfo?.parentId,
      );
      if (!parentId || !candidateIds.size) {
        continue;
      }

      if (parentId === currentId) {
        for (const id of candidateIds) {
          if (!scopedIds.has(id)) {
            queue.push(id);
          }
        }
      }
    }
  }

  return scopedIds;
}

function normalizeComparableText(value: unknown): string {
  return normalizeErrorLikeValue(value)
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function messageDisplaysSameErrorText(
  message: Message | undefined,
  value: unknown,
): boolean {
  const normalized = normalizeComparableText(value);
  if (!normalized) {
    return false;
  }

  const errorCandidates = [
    message?.displayError?.message,
    message?.displayError?.originalError,
    message?.error,
  ];

  return errorCandidates.some(
    (candidate) =>
      typeof candidate === "string" &&
      normalizeComparableText(candidate) === normalized,
  );
}

function messageMatchesDisplayErrorText(
  message: Message | undefined,
  value: unknown,
): boolean {
  const normalized = normalizeComparableText(value);
  if (!normalized) {
    return false;
  }

  const errorCandidates = [
    message?.displayError?.message,
    message?.displayError?.originalError,
  ];

  return errorCandidates.some(
    (candidate) =>
      typeof candidate === "string" &&
      normalizeComparableText(candidate) === normalized,
  );
}

function collectReasoningFingerprints(message?: Message): Set<string> {
  const fingerprints = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const normalized = normalizeComparableText(value);
    if (normalized) {
      fingerprints.add(normalized);
    }
  };

  if (!message) {
    return fingerprints;
  }

  if (Array.isArray(message.reasoningEvents)) {
    message.reasoningEvents.forEach((event) => add(event?.text));
  }

  const payloadRec = asRecord((message as Record<string, unknown>).reasoningPayload);
  const payloadEvents = Array.isArray(payloadRec?.events) ? payloadRec.events : [];
  payloadEvents.forEach((event) => add(asRecord(event)?.text));

  if (Array.isArray(message.parts)) {
    message.parts.forEach((part) => {
      add(part.reasoning);
      add(part.thought);
      add(part.thinking);
    });
  }

  return fingerprints;
}

function hasQuestionLikeInteractiveContent(message?: Message): boolean {
  if (!message) {
    return false;
  }

  const messageRec = asRecord(message);
  const infoRec = asRecord(messageRec?.info);
  const structured =
    asRecord(messageRec?.structuredOutput) ||
    asRecord(messageRec?.structured_output) ||
    asRecord(messageRec?.structured) ||
    asRecord(infoRec?.structuredOutput) ||
    asRecord(infoRec?.structured_output) ||
    asRecord(infoRec?.structured);
  const questionType = firstNonEmptyString(
    asRecord(structured?.question)?.type,
  )?.toLowerCase();

  if (
    questionType === "question" ||
    questionType === "confirm" ||
    questionType === "quick_actions" ||
    questionType === "quick-actions"
  ) {
    return true;
  }

  if (!Array.isArray(message.interactiveEvents)) {
    return false;
  }

  return message.interactiveEvents.some((event) => {
    const type = firstNonEmptyString(asRecord(event)?.type)?.toLowerCase();
    return (
      type === "question" ||
      type === "confirm" ||
      type === "quick_actions" ||
      type === "quick-actions"
    );
  });
}

function rawMessagePartsFromRawSdkEventPayloads(
  rawSdkEventPayloads?: unknown[],
): MessagePart[] {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return [];
  }

  // Collapse canonical + sync mirror entries by stable identity so the same
  // logical part does not render twice during event-stream playback.
  const parts: MessagePart[] = [];
  const partsByKey = new Map<string, MessagePart>();
  const statusRank = (value?: unknown): number => {
    const status = asString(value).toLowerCase();
    if (status === "done" || status === "completed" || status === "complete") return 3;
    if (status === "error" || status === "failed") return 2;
    if (status === "running" || status === "pending") return 1;
    return 0;
  };

  for (const payload of rawSdkEventPayloads) {
    const eventRec = asRecord(payload);
    if (!eventRec) {
      continue;
    }

    const partRec = getCentralizedEventPart(eventRec);
    if (partRec) {
      const candidate = partRec as MessagePart;
      const candidateRec = asRecord(candidate);
      const partID = firstNonEmptyString(
        asString(candidateRec?.id),
        asString(candidateRec?.partID),
        asString(candidateRec?.partId),
      );
      const messageID = firstNonEmptyString(
        asString(candidateRec?.messageID),
        asString(candidateRec?.messageId),
      );
      const partType = firstNonEmptyString(
        asString(candidateRec?.type),
        asString(candidateRec?.kind),
      )?.toLowerCase();
      const textKey = normalizeComparableText(
        firstNonEmptyString(
          asString(candidateRec?.text),
          asString(candidateRec?.content),
          asString(candidateRec?.message),
          asString(asRecord(candidateRec?.state)?.output),
          asString(candidateRec?.delta),
        ),
      );
      const mergeKey = partID
        ? `part:${partID}`
        : messageID
          ? `msg:${messageID}`
          : `${partType || "part"}:${textKey}`;

      const existing = partsByKey.get(mergeKey);
      if (!existing) {
        partsByKey.set(mergeKey, candidate);
        continue;
      }

      const existingRec = asRecord(existing);
      const existingStatus = asRecord(existingRec?.state)?.status;
      const candidateStatus = asRecord(candidateRec?.state)?.status;
      if (statusRank(candidateStatus) >= statusRank(existingStatus)) {
        partsByKey.set(mergeKey, candidate);
      }
    }
  }

  parts.push(...partsByKey.values());
  return parts;
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

type RawDebugParseStatus = "parsed" | "empty" | "unparseable" | "truncated";

type ParsedRawDebugForUi = {
  status: RawDebugParseStatus;
  parts: Array<Record<string, unknown>>;
};

type ParsedRawResponseRecordForUi = {
  status: RawDebugParseStatus;
  record: Record<string, unknown> | null;
};

function parseRawResponseRecordForUi(raw: Message["rawResponse"]): ParsedRawResponseRecordForUi {
  if (typeof raw === "object" && raw !== null) {
    return { status: "parsed", record: asRecord(raw) };
  }
  if (typeof raw !== "string") {
    return { status: "empty", record: null };
  }
  const text = raw.trim();
  if (!text) {
    return { status: "empty", record: null };
  }
  const truncMatch = text.match(/\.\.\.<truncated\s+\d+\s+chars>\s*$/i);
  const candidate = truncMatch ? text.slice(0, truncMatch.index).trim() : text;
  try {
    return {
      status: truncMatch ? "truncated" : "parsed",
      record: asRecord(JSON.parse(candidate)),
    };
  } catch {
    return { status: truncMatch ? "truncated" : "unparseable", record: null };
  }
}

function parseRawResponseDebugForUi(raw: Message["rawResponse"]): ParsedRawDebugForUi {
  const parsed = parseRawResponseRecordForUi(raw);
  if (!parsed.record) {
    return { status: parsed.status, parts: [] };
  }
  const parts = Array.isArray(parsed.record.parts)
    ? parsed.record.parts
      .map((part) => asRecord(part))
      .filter((part): part is Record<string, unknown> => !!part)
    : [];
  return { status: parsed.status, parts };
}

function rawResponseInfoRecordForUi(
  raw: Message["rawResponse"],
): Record<string, unknown> | null {
  const normalized = parseRawResponseRecordForUi(raw).record;
  if (!normalized) {
    return null;
  }

  const nestedPaths = [
    ["info"],
    ["payload", "syncEvent", "data", "info"],
    ["payload", "data", "info"],
    ["data", "info"],
  ];

  for (const path of nestedPaths) {
    let current: unknown = normalized;
    let valid = true;
    for (const segment of path) {
      const record = asRecord(current);
      if (!record) {
        valid = false;
        break;
      }
      current = record[segment];
    }
    if (valid) {
      const infoRecord = asRecord(current);
      if (infoRecord) {
        return infoRecord;
      }
    }
  }

  return null;
}

// LEGACY BRIDGE: temporary helper kept only while we are migrating the
// conversation UI to render directly from the centralized raw event tape.
// This path will be removed once the new architecture owns the full ordering
// and system-message rendering contract.
function extractSystemMessageTextFromRawEventStream(
  rawSdkEventPayloads?: unknown[],
): string | undefined {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return undefined;
  }

  for (let index = rawSdkEventPayloads.length - 1; index >= 0; index -= 1) {
    const event = asRecord(rawSdkEventPayloads[index]);
    if (!event) {
      continue;
    }

    if (String(event.type ?? "").trim() !== "message.part.updated") {
      continue;
    }

    const structured = asRecord(event.structured);
    if (String(structured?.kind ?? "").trim() !== "message") {
      continue;
    }

    const properties = asRecord(event.properties);
    const part = asRecord(properties?.part);
    const text =
      firstNonEmptyString(
        structured?.text,
        structured?.message,
        part?.text,
        part?.message,
        event.text,
        event.message,
      ) ?? "";
    if (text.trim().length > 0) {
      return text;
    }
  }

  return undefined;
}

type SessionUpdatedMetadata = {
  sessionID?: string;
  title?: string;
  agent?: string;
  modelID?: string;
  providerID?: string;
  variant?: string;
  version?: string;
  directory?: string;
};

function extractSessionUpdatedMetadataFromRawEventStream(
  rawSdkEventPayloads?: unknown[],
): SessionUpdatedMetadata | undefined {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return undefined;
  }

  for (let index = rawSdkEventPayloads.length - 1; index >= 0; index -= 1) {
    const event = asRecord(rawSdkEventPayloads[index]);
    if (!event || String(event.type ?? "").trim() !== "session.updated") {
      continue;
    }

    const properties = asRecord(event.properties);
    const info = asRecord(properties?.info);
    const model = asRecord(info?.model);

    return {
      sessionID:
        firstNonEmptyString(
          properties?.sessionID,
          event.sessionId,
          event.sessionID,
          info?.id,
        ) ?? undefined,
      title: firstNonEmptyString(info?.title) ?? undefined,
      agent: firstNonEmptyString(info?.agent) ?? undefined,
      modelID:
        firstNonEmptyString(
          model?.id,
          model?.modelID,
          info?.modelID,
        ) ?? undefined,
      providerID:
        firstNonEmptyString(
          model?.providerID,
          info?.providerID,
        ) ?? undefined,
      variant:
        firstNonEmptyString(model?.variant, info?.variant) ?? undefined,
      version: firstNonEmptyString(info?.version) ?? undefined,
      directory: firstNonEmptyString(info?.directory) ?? undefined,
    };
  }

  return undefined;
}

function stringifyDebugValue(value: unknown): string {
  const seen = new WeakSet<object>();
  const replacer = (_key: string, nextValue: unknown) => {
    if (nextValue === undefined) return "(undefined)";
    if (typeof nextValue === "function") return "(function)";
    if (nextValue instanceof Error) return { message: nextValue.message, name: nextValue.name };
    if (typeof nextValue === "object" && nextValue !== null) {
      if (seen.has(nextValue)) return "(circular)";
      seen.add(nextValue);
    }
    return nextValue;
  };

  try {
    const normalized =
      typeof value === "string" ? normalizeDebugStringForDisplay(value) : value;
    return JSON.stringify(normalized, replacer, 2) ?? "";
  } catch {
    return String(value);
  }
}

function normalizeDebugStringForDisplay(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  if (!/^[{\[]/.test(trimmed)) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

type DebugObjectViewProps = {
  value: unknown;
};

// Keep debug output in object-literal form so the payload stays readable and
// visually matches the raw SDK shape instead of a JSON string dump.
function formatDebugObjectLiteral(value: unknown, depth = 0, seen = new WeakSet<object>()): string {
  const indent = "  ".repeat(depth);
  const nextIndent = "  ".repeat(depth + 1);

  if (value === null) return "null";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^[{\[]/.test(trimmed)) {
      try {
        return formatDebugObjectLiteral(JSON.parse(trimmed), depth, seen);
      } catch {
        // Fall through to a quoted string when the payload only looks like JSON.
      }
    }
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "[Function]";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value instanceof Error) {
    return `{\n${nextIndent}name: ${JSON.stringify(value.name)},\n${nextIndent}message: ${JSON.stringify(value.message)}\n${indent}}`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) => `${nextIndent}${formatDebugObjectLiteral(item, depth + 1, seen)}`);
    return `[\n${items.join(",\n")}\n${indent}]`;
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";

    const body = entries
      .map(([key, nextValue]) => `${nextIndent}${key}: ${formatDebugObjectLiteral(nextValue, depth + 1, seen)}`)
      .join(",\n");
    return `{\n${body}\n${indent}}`;
  }

  return String(value);
}

function DebugObjectView({ value }: DebugObjectViewProps) {
  return (
    <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-oc-text-soft">
      {formatDebugObjectLiteral(value)}
    </pre>
  );
}

type MarkdownPreviewModalProps = {
  isOpen: boolean;
  title: string;
  content: string;
  onClose: () => void;
};

function MarkdownPreviewModal({
  isOpen,
  title,
  content,
  onClose,
}: MarkdownPreviewModalProps) {
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

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
        aria-label={`Close ${title} preview`}
      />
      <div
        className="oc-modal-shell relative z-50 flex h-[min(92vh,900px)] min-h-0 w-full max-w-5xl flex-col overflow-hidden text-foreground animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="oc-modal-header flex shrink-0 items-start justify-between gap-3 bg-oc-panel-soft/70 p-3">
          <div className="min-w-0">
            <span className="text-sm font-semibold">{title}</span>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-oc-border bg-oc-bg-soft oc-text-secondary transition-colors hover:bg-oc-panel hover:text-foreground"
            onClick={onClose}
            aria-label="Close markdown preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="rounded-lg border border-oc-border-soft bg-oc-bg/20 p-4">
            <MarkdownRenderer content={content} className="markdown-body" />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type CollapsedMarkdownPreviewProps = {
  title: string;
  content: string;
  className?: string;
  variant?: "card" | "bare";
};

function CollapsedMarkdownPreview({
  title,
  content,
  className,
  variant = "card",
}: CollapsedMarkdownPreviewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const hasContent = content.trim().length > 0;

  if (!hasContent) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={cn(
          "group relative w-full min-w-0 max-w-full overflow-hidden text-left transition-colors",
          variant === "card"
            ? "rounded-lg border border-oc-border-soft bg-oc-bg-soft/60 hover:border-oc-border hover:bg-oc-panel-soft/60"
            : "rounded-none border-0 bg-transparent hover:bg-transparent",
          className,
        )}
        aria-label={`Open ${title} preview`}
      >
        <div className={cn(
          "relative max-h-[140px] min-w-0 max-w-full overflow-hidden",
          variant === "card" ? "p-2" : "p-0",
        )}>
          <div className={cn(
            "max-h-[140px] min-w-0 max-w-full overflow-hidden",
            variant === "card" ? "pr-1" : "pr-0",
          )}>
            <MarkdownRenderer content={content} className="markdown-body" />
          </div>
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t",
              variant === "card"
                ? "from-oc-bg-soft via-oc-bg-soft/90 to-transparent"
                : "from-oc-panel-soft/80 via-oc-panel-soft/30 to-transparent",
            )}
          />
        </div>
        <div
          className={cn(
            "oc-timeline-caret pointer-events-none absolute bottom-2 right-2 inline-flex h-6 w-6 items-center justify-center rounded-full",
            variant === "bare" && "bottom-1 right-1",
          )}
        >
          <ChevronDown className="h-3 w-3 oc-text-secondary" />
        </div>
      </button>
      <MarkdownPreviewModal
        isOpen={isOpen}
        title={title}
        content={content}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}

type TerminalBlockPreviewModalProps = {
  isOpen: boolean;
  title: string;
  command: string;
  output?: string;
  onClose: () => void;
};

function TerminalBlockPreviewModal({
  isOpen,
  title,
  command,
  output,
  onClose,
}: TerminalBlockPreviewModalProps) {
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

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
        aria-label={`Close ${title} preview`}
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
                preview
              </span>
            </div>
            <div className="mt-1 text-xs oc-text-secondary">
              Full bash command and captured output
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-oc-border bg-oc-bg-soft oc-text-secondary transition-colors hover:bg-oc-panel hover:text-foreground"
            onClick={onClose}
            aria-label="Close bash preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <TerminalBlock command={command} output={output} className="shadow-none" />
        </div>
      </div>
    </div>,
    document.body,
  );
}

type CollapsedTerminalBlockPreviewProps = {
  title: string;
  command: string;
  output?: string;
  className?: string;
};

function CollapsedTerminalBlockPreview({
  title,
  command,
  output,
  className,
}: CollapsedTerminalBlockPreviewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const hasCommand = command.trim().length > 0;
  if (!hasCommand) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={cn(
          "group relative w-full overflow-hidden rounded-lg border border-oc-border-soft bg-oc-bg-soft/60 text-left transition-colors hover:border-oc-border hover:bg-oc-panel-soft/60",
          className,
        )}
        aria-label={`Open ${title} preview`}
      >
        <div className="relative max-h-[140px] overflow-hidden p-2">
          <TerminalBlock command={command} output={output} className="pointer-events-none" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-oc-bg-soft via-oc-bg-soft/90 to-transparent" />
        </div>
        <div className="oc-timeline-caret pointer-events-none absolute bottom-2 right-2 inline-flex h-6 w-6 items-center justify-center rounded-full">
          <ChevronDown className="h-3 w-3 oc-text-secondary" />
        </div>
      </button>
      <TerminalBlockPreviewModal
        isOpen={isOpen}
        title={title}
        command={command}
        output={output}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}

type CollapsedSearchBlockPreviewProps = {
  title: string;
  pattern: string;
  patternInHeader?: boolean;
  scope?: string;
  include?: string;
  path?: string;
  output?: string;
  outputMode?: string;
  headLimit?: number;
};

type SearchBlockPreviewModalProps = CollapsedSearchBlockPreviewProps & {
  isOpen: boolean;
  onClose: () => void;
};

function SearchBlockPreviewModal({
  isOpen,
  onClose,
  title,
  pattern,
  patternInHeader,
  scope,
  include,
  path,
  output,
  outputMode,
  headLimit,
}: SearchBlockPreviewModalProps) {
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

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
        aria-label={`Close ${title} details`}
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
              Full search block and output
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-oc-border bg-oc-bg-soft oc-text-secondary transition-colors hover:bg-oc-panel hover:text-foreground"
            onClick={onClose}
            aria-label="Close search preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="rounded-lg border border-oc-border-soft bg-oc-bg/20 p-3">
            <SearchBlock
              pattern={pattern}
              patternInHeader={patternInHeader}
              scope={scope}
              include={include}
              path={path}
              output={output}
              outputMode={outputMode}
              headLimit={headLimit}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CollapsedSearchBlockPreview({
  title,
  pattern,
  patternInHeader,
  scope,
  include,
  path,
  output,
  outputMode,
  headLimit,
}: CollapsedSearchBlockPreviewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const hasContent =
    !!pattern ||
    !!scope ||
    !!include ||
    !!path ||
    !!output ||
    !!outputMode ||
    headLimit !== undefined;

  if (!hasContent) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="oc-timeline-surface oc-timeline-soft-frame group relative w-full overflow-hidden rounded-lg text-left transition-colors hover:bg-oc-panel-soft/50"
        aria-label={`Open ${title} details`}
      >
        <div className="relative max-h-[128px] overflow-hidden p-1.5">
          <div className="max-h-[128px] overflow-hidden">
            <SearchBlock
              className="oc-search-block--timeline-compact"
              pattern={pattern}
              patternInHeader={patternInHeader}
              scope={scope}
              include={include}
              path={path}
              output={output}
              outputMode={outputMode}
              headLimit={headLimit}
            />
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-oc-bg-soft via-oc-bg-soft/88 to-transparent" />
        </div>
        <div className="oc-timeline-caret pointer-events-none absolute bottom-2 right-2 inline-flex h-6 w-6 items-center justify-center rounded-full">
          <ChevronDown className="h-3 w-3 oc-text-secondary" />
        </div>
      </button>
      <SearchBlockPreviewModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={title}
        pattern={pattern}
        patternInHeader={patternInHeader}
        scope={scope}
        include={include}
        path={path}
        output={output}
        outputMode={outputMode}
        headLimit={headLimit}
      />
    </>
  );
}

type ThoughtItem = {
  key: string;
  text: string;
  messageID?: string;
  partID?: string;
  streamSeq?: number;
  source?: "stream" | "final" | "raw_debug";
  status?: "pending" | "done" | "error";
};
type ProgressItem = {
  key: string;
  mergeKey: string;
  id?: string;
  callID?: string;
  messageID?: string;
  sessionID?: string;
  title: string;
  status: "pending" | "done" | "error";
  source?: "stream" | "final" | "raw_debug";
  partType?: string;
  internal?: boolean;
  meta?: string;
  filePath?: string;
  startedAt?: number;
  endedAt?: number;
  diffStats?: { added: number; deleted: number };
  activityDetail?: ActivityDetail;
  /** Arrival-order sequence number from StreamingStep.streamSeq or MessageStep.streamSeq */
  streamSeq?: number;
};

type CommentaryItem = {
  id?: string;
  text: string;
  streamSeq?: number;
  kind?: "commentary" | "ai_response";
  status?: "pending" | "done" | "error";
  messageID?: string;
  partID?: string;
};

type ThinkingBlock = { kind: "thinking"; items: ThoughtItem[] };
type StepsBlock = { kind: "steps"; items: ProgressItem[] };
type ContentBlock = { kind: "content"; html: string };
type CommentaryBlock = { kind: "commentary"; text: string; label?: string; messageID?: string; partID?: string };
type TimelineBlock = ThinkingBlock | StepsBlock | ContentBlock | CommentaryBlock;

function AssistantResponseBodyCard({
  content,
  parts,
  className,
  variant = "default",
}: {
  content?: string[];
  parts?: MessagePart[];
  className?: string;
  variant?: "default" | "bare";
}) {
  const chunkSource = Array.isArray(parts) && parts.length > 0
    ? parts.map((part) => {
        const partRec = asRecord(part);
        return (
          asString(partRec?.text).trim() ||
          asString(partRec?.content).trim() ||
          asString(partRec?.message).trim() ||
          asString(partRec?.delta).trim()
        );
      })
    : Array.isArray(content)
      ? content
      : [];
  const trimmed = chunkSource.filter((chunk) => chunk.trim().length > 0);
  if (trimmed.length === 0) {
    return null;
  }

  return (
    <section
      data-assistant-section="response"
      className={cn(
        variant === "bare"
          ? "rounded-none border-0 bg-transparent p-0 shadow-none"
          : "rounded-md border border-oc-border-soft bg-background p-2.5 shadow-sm",
        className,
      )}
    >
      <div className="flex w-full flex-col gap-2">
        {trimmed.map((chunk, index) => (
          <MarkdownRenderer
            key={`${index}-${chunk.slice(0, 24)}`}
            content={chunk}
            className="markdown-body w-full max-w-none"
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Extracts the Date.now() timestamp embedded in a thought-item key.
 * Handles both streaming keys ("stream-{idx}-{createdAt}") and
 * persisted reasoningEvent keys ("evt-{createdAt}").
 * Returns 0 for parts-based keys ("part-{idx}") that have no timestamp.
 */
function seqFromThoughtKey(key: string): number {
  const evtMatch = key.match(/^evt-(\d+)/);
  if (evtMatch) return parseInt(evtMatch[1], 10);
  const streamMatch = key.match(/stream-\d+-(\d+)/);
  if (streamMatch) return parseInt(streamMatch[1], 10);
  return 0;
}

function thoughtItemsFromRawEventPayloads(
  rawSdkEventPayloads?: unknown[],
): ThoughtItem[] {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return [];
  }

  const items: ThoughtItem[] = [];
  const itemsByIdentity = new Map<string, number>();
  // Canonical and sync-mirrored reasoning events often share the same
  // `partID` / `messageID`. Use those stable identifiers first so we collapse
  // the same logical reasoning row instead of deduping purely by rendered text.
  const getIdentityKey = (item: ThoughtItem): string | null =>
    firstNonEmptyString(
      item.partID ? `part:${item.partID}` : undefined,
      item.messageID ? `msg:${item.messageID}` : undefined,
      item.key ? `key:${item.key}` : undefined,
      normalizeComparableText(item.text)
        ? `text:${normalizeComparableText(item.text)}`
        : undefined,
    );

  const addIdentity = (item: ThoughtItem, index: number) => {
    const identityKey = getIdentityKey(item);
    if (identityKey) {
      itemsByIdentity.set(identityKey, index);
    }
  };

  const upsertThoughtItem = (item: ThoughtItem) => {
    const key = getIdentityKey(item);
    if (!key) {
      return;
    }

    const existingIndex = itemsByIdentity.get(key);
    if (typeof existingIndex === "number") {
      const existing = items[existingIndex];
      if (!existing) {
        items[existingIndex] = item;
        return;
      }

      const incomingText = normalizeComparableText(item.text);
      const existingText = normalizeComparableText(existing.text);
      if (incomingText.length > existingText.length) {
        items[existingIndex] = {
          ...existing,
          ...item,
          text: item.text.trim(),
        };
        addIdentity(items[existingIndex], existingIndex);
        return;
      }

      if (item.status === "done" || item.status === "error") {
        items[existingIndex] = {
          ...existing,
          ...item,
          text: existing.text.trim() || item.text.trim(),
        };
        addIdentity(items[existingIndex], existingIndex);
      }
      return;
    }

    const nextIndex = items.length;
    items.push({
      ...item,
      text: item.text.trim(),
    });
    addIdentity(items[nextIndex], nextIndex);
  };

  for (let index = 0; index < rawSdkEventPayloads.length; index += 1) {
    const event = asRecord(rawSdkEventPayloads[index]);
    if (!event) {
      continue;
    }

    const structured = asRecord(event.structured);
    const part = getCentralizedEventPart(event);
    const properties = asRecord(event.properties);
    if (String(structured?.kind ?? "").trim() !== "thinking" && asString(part?.type).toLowerCase() !== "reasoning") {
      continue;
    }

    const text = firstNonEmptyString(
      asString(part?.text),
      asString(part?.message),
      asString(structured?.text),
      asString(structured?.message),
      asString(event.text),
      asString(event.message),
    );
    if (!text) {
      continue;
    }

    const partTime = asRecord(part?.time);
    const createdAt =
      (typeof partTime?.end === "number" ? partTime.end : undefined) ??
      (typeof partTime?.start === "number" ? partTime.start : undefined) ??
      (typeof properties?.time === "number" ? properties.time : undefined) ??
      (typeof event.time === "number" ? event.time : undefined) ??
      index;
    const status = typeof partTime?.end === "number" ? "done" : "pending";
    const key = `evt-${createdAt}-${index}`;
    const cleaned = text.trim();
    if (!cleaned) {
      continue;
    }

    upsertThoughtItem({
      key,
      text: cleaned,
      status,
      messageID:
        asString(part?.messageID) ||
        asString(part?.messageId) ||
        asString(properties?.messageID) ||
        asString(properties?.messageId) ||
        asString(event.messageID) ||
        asString(event.messageId) ||
        undefined,
      partID:
        asString(part?.id) ||
        asString(part?.partID) ||
        asString(part?.partId) ||
        asString(properties?.partID) ||
        asString(properties?.partId) ||
        asString(event.partID) ||
        asString(event.partId) ||
        undefined,
    });
  }

  return items;
}

/**
 * Converts the live streaming reasoning buffer into timeline items.
 *
 * The centralized tape deliberately drops delta chunks, so this adapter is the
 * only place where we turn the in-flight reasoning stream into renderable
 * timeline entries while the assistant is still responding.
 */
function thoughtItemsFromStreamingReasoningEvents(
  reasoningEvents?: ReasoningEvent[],
  isActive = false,
): ThoughtItem[] {
  if (!Array.isArray(reasoningEvents) || reasoningEvents.length === 0) {
    return [];
  }

  const grouped = new Map<
    string,
    {
      key: string;
      text: string;
      streamSeq: number;
      status: "pending" | "done" | "error";
      messageID?: string;
      partID?: string;
    }
  >();

  reasoningEvents.forEach((event, index) => {
    const text = asString(event?.text).trim();
    const isLatestChunk = index === reasoningEvents.length - 1;
    const isLiveChunk =
      event?.delta === true || (isLatestChunk && isActive);
    const fallbackText = isLiveChunk ? "Thinking..." : "";
    const resolvedText = text || fallbackText;
    if (!resolvedText) {
      return;
    }

    const createdAt =
      typeof event?.createdAt === "number" ? event.createdAt : index;
    const partID = asString(event?.partID).trim();
    const messageID = asString(event?.messageID).trim();
    const groupKey = partID || `${createdAt}:${index}`;
    const existing = grouped.get(groupKey);
    const nextText = existing
      ? `${existing.text}${existing.text && resolvedText ? "\n\n" : ""}${resolvedText}`
      : resolvedText;

    grouped.set(groupKey, {
      key: existing?.key ?? `stream-${index}-${createdAt}`,
      text: nextText,
      streamSeq: existing?.streamSeq ?? createdAt,
      status: isLiveChunk ? "pending" : "done",
      messageID: existing?.messageID ?? (messageID || undefined),
      partID: existing?.partID ?? (partID || undefined),
    });
  });

  return Array.from(grouped.values()).map((item) => ({
    key: item.key,
    text: item.text,
    streamSeq: item.streamSeq,
    source: "stream",
    status: item.status,
    messageID: item.messageID,
    partID: item.partID,
  }));
}

/**
 * Merges the finalized centralized reasoning trail with the live reasoning
 * stream.
 *
 * Raw centralized events always win when they share the same `partID` or
 * `messageID`, because they represent the authoritative finalized version.
 * Live items are kept only when the final event has not arrived yet, which
 * preserves the streaming spinner / evolving text without duplicating the
 * same reasoning once the turn is complete.
 */
function mergeThoughtItemsForTimeline(
  finalizedItems: ThoughtItem[],
  streamingItems: ThoughtItem[],
  preferStreaming = false,
): ThoughtItem[] {
  if (finalizedItems.length === 0) {
    return streamingItems;
  }
  if (streamingItems.length === 0) {
    return finalizedItems;
  }

  const merged: ThoughtItem[] = [...finalizedItems];
  const indexByKey = new Map<string, number>();

  const addKey = (item: ThoughtItem, index: number) => {
    const normalizedText = normalizeComparableText(item.text);
    if (item.partID) {
      indexByKey.set(`part:${item.partID}`, index);
    }
    if (item.messageID) {
      indexByKey.set(`msg:${item.messageID}`, index);
    }
    if (normalizedText) {
      indexByKey.set(`text:${normalizedText}`, index);
    }
  };

  finalizedItems.forEach((item, index) => addKey(item, index));

  for (const item of streamingItems) {
    const normalizedText = normalizeComparableText(item.text);
    const keys = [
      item.partID ? `part:${item.partID}` : "",
      item.messageID ? `msg:${item.messageID}` : "",
      normalizedText ? `text:${normalizedText}` : "",
    ].filter(Boolean);

    const matchingKey = keys.find((key) => indexByKey.has(key));
    if (typeof matchingKey === "string") {
      if (preferStreaming) {
        const existingIndex = indexByKey.get(matchingKey);
        if (typeof existingIndex === "number") {
          merged[existingIndex] = {
            ...merged[existingIndex],
            ...item,
            source: item.source || merged[existingIndex].source,
          };
        }
      }
      continue;
    }

    const nextIndex = merged.length;
    keys.forEach((key) => indexByKey.set(key, nextIndex));
    merged.push(item);
  }

  return merged;
}

/**
 * Merge finalized progress rows with live streaming progress rows.
 *
 * The assistant can emit running/pending step snapshots before the centralized
 * tape has fully materialized. Those live rows should be visible immediately,
 * but once the finalized tape arrives it must win so we do not duplicate the
 * same tool row twice with different status snapshots.
 */
function mergeProgressItemsForTimeline(
  finalizedItems: ProgressItem[],
  streamingItems: ProgressItem[],
  preferStreaming = false,
): ProgressItem[] {
  if (finalizedItems.length === 0) {
    return streamingItems;
  }
  if (streamingItems.length === 0) {
    return finalizedItems;
  }

  const merged: ProgressItem[] = [...finalizedItems];
  const indexByKey = new Map<string, number>();

  const addKey = (item: ProgressItem, index: number) => {
    if (item.callID) {
      indexByKey.set(`call:${item.callID}`, index);
    }
    if (item.id) {
      indexByKey.set(`id:${item.id}`, index);
    }
    if (item.messageID) {
      indexByKey.set(`msg:${item.messageID}`, index);
    }
    indexByKey.set(`title:${normalizeComparableText(item.title)}`, index);
  };

  finalizedItems.forEach((item, index) => addKey(item, index));

  for (const item of streamingItems) {
    const keys = [
      item.callID ? `call:${item.callID}` : "",
      item.id ? `id:${item.id}` : "",
      item.messageID ? `msg:${item.messageID}` : "",
      `title:${normalizeComparableText(item.title)}`,
    ].filter(Boolean);

    const matchingKey = keys.find((key) => indexByKey.has(key));
    if (typeof matchingKey === "string") {
      if (preferStreaming) {
        const existingIndex = indexByKey.get(matchingKey);
        if (typeof existingIndex === "number") {
          merged[existingIndex] = {
            ...merged[existingIndex],
            ...item,
            source: item.source || merged[existingIndex].source,
          };
        }
      }
      continue;
    }

    const nextIndex = merged.length;
    keys.forEach((key) => indexByKey.set(key, nextIndex));
    merged.push(item);
  }

  return merged;
}

function progressItemsFromRawEventPayloads(
  rawSdkEventPayloads?: unknown[],
): ProgressItem[] {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return [];
  }

  const rawSteps: Array<MessageStep | StreamingStep> = [];
  const diagnostics = {
    total: rawSdkEventPayloads.length,
    noRecord: 0,
    fileWatcher: 0,
    structuredThinkingSkipped: 0,
    noPart: 0,
    reasoningSkipped: 0,
    textSkipped: 0,
    noRenderableProgress: 0,
    pushed: 0,
  };
  const skippedSamples: Array<Record<string, unknown>> = [];
  const pushedSamples: Array<Record<string, unknown>> = [];
  const rememberSkipped = (reason: string, event: unknown, index: number) => {
    if (skippedSamples.length >= 8) {
      return;
    }
    skippedSamples.push({
      reason,
      ...summarizeCentralizedEventForTimelineDiagnostics(event, index),
    });
  };
  const rememberPushed = (event: unknown, index: number) => {
    if (pushedSamples.length >= 8) {
      return;
    }
    pushedSamples.push(summarizeCentralizedEventForTimelineDiagnostics(event, index));
  };

  for (let index = 0; index < rawSdkEventPayloads.length; index += 1) {
    const event = asRecord(rawSdkEventPayloads[index]);
    if (!event) {
      diagnostics.noRecord += 1;
      rememberSkipped("no_record", rawSdkEventPayloads[index], index);
      continue;
    }

    const eventType = firstNonEmptyString(asString(event.type), asString(event.eventType))?.toLowerCase() || "";
    const eventProperties = asRecord(event.properties);
    const messageID = firstNonEmptyString(
      asString(eventProperties?.messageID),
      asString(eventProperties?.messageId),
      asString(event.messageID),
      asString(event.messageId),
    );

    // Some centralized events are not part updates at all. We still want to
    // surface them in the activity timeline when they represent meaningful
    // work that happened during the assistant turn, instead of dropping them
    // on the floor simply because they do not have a `part` envelope.
    if (eventType === "file.watcher.updated") {
      const file = firstNonEmptyString(
        asString(eventProperties?.file),
        asString(event.file),
      );
      const watcherEvent = firstNonEmptyString(
        asString(eventProperties?.event),
        asString(event.event),
      );
      const title = firstNonEmptyString(watcherEvent, "file watcher updated");
      const summary = firstNonEmptyString(
        watcherEvent,
        file,
        title,
      );
      const id = firstNonEmptyString(
        asString(event.id),
        asString(event.eventId),
      );
      if (!file && !watcherEvent && !id) {
        continue;
      }

      rawSteps.push({
        id: id || `${eventType}-${index}`,
        sessionID: firstNonEmptyString(
          asString(event.sessionID),
          asString(event.sessionId),
        ),
        title,
        type: "tool",
        status: "done",
        source: "raw_debug",
        partType: eventType,
        internal: false,
        filePath: file || undefined,
        messageID: messageID || undefined,
        streamSeq: index,
        activityDetail: {
          kind: "other",
          summary: summary || title,
          tool: "file_watcher",
          input: eventProperties
            ? {
                file: eventProperties.file,
                event: eventProperties.event,
              }
            : undefined,
          output: undefined,
          sessionID: firstNonEmptyString(
            asString(event.sessionID),
            asString(event.sessionId),
          ),
        },
      });
      diagnostics.fileWatcher += 1;
      diagnostics.pushed += 1;
      rememberPushed(event, index);
      continue;
    }

    const structured = asRecord(event.structured);
    if (String(structured?.kind ?? "").trim() === "thinking") {
      diagnostics.structuredThinkingSkipped += 1;
      rememberSkipped("structured_thinking", event, index);
      continue;
    }

    const part = getCentralizedEventPart(event);
    if (!part) {
      diagnostics.noPart += 1;
      rememberSkipped("no_part", event, index);
      continue;
    }

    const state = asRecord(part.state);
    const input = asRecord(state?.input) || asRecord(part.input) || asRecord(part.arguments);
    const metadata = asRecord(state?.metadata) || asRecord(part.metadata);
    const stateTime = asRecord(state?.time);
    const tool = firstNonEmptyString(
      asString(part.tool),
      asString(part.name),
      asString(part.type),
    )?.toLowerCase();
    const partType = firstNonEmptyString(
      asString(part.type),
      asString(part.partType),
      asString(structured?.kind),
    );
    // Reasoning belongs in the dedicated thinking lane, not the activity step
    // lane. If we let it through here, the same assistant text can render once
    // as a reasoning block and again as a raw activity row, which is the
    // duplicate the UI has been showing.
    if ((partType || "").toLowerCase() === "reasoning") {
      diagnostics.reasoningSkipped += 1;
      rememberSkipped("reasoning_lane", event, index);
      continue;
    }
    const status = normalizeProgressStatus(
      firstNonEmptyString(
        asString(state?.status),
        asString(part.status),
        asString(structured?.status),
      ),
    );
    const id = firstNonEmptyString(
      asString(part.id),
      asString(part.partID),
      asString(part.partId),
      asString(event.id),
    );
    const callID = firstNonEmptyString(asString(part.callID), asString(part.callId));
    const partMessageID = firstNonEmptyString(
      asString(part.messageID),
      asString(part.messageId),
      asString(event.messageID),
      asString(event.messageId),
      asString(eventProperties?.messageID),
      asString(eventProperties?.messageId),
    );
    const sessionID = firstNonEmptyString(
      asString(event.sessionID),
      asString(event.sessionId),
      asString(part.sessionID),
      asString(part.sessionId),
    );
    const startedAt = firstNonEmptyString(
      asString(stateTime?.start),
      asString(stateTime?.created),
      asString(event.time),
    );
    const endedAt = firstNonEmptyString(
      asString(stateTime?.end),
      asString(stateTime?.completed),
    );
    const filePath = firstNonEmptyString(
      asString(input?.filePath),
      asString(input?.path),
      asString(input?.file),
      asString(part.filePath),
      asString(part.file),
      asString(part.path),
    );
    const output = firstNonEmptyString(
      asString(state?.output),
      asString(part.output),
      asString(part.text),
      asString(structured?.text),
      asString(event.text),
      asString(event.message),
    );

    if (partType === "text") {
      diagnostics.textSkipped += 1;
      rememberSkipped("text_response_lane", event, index);
      continue;
    }

    const preview = firstNonEmptyString(asString(metadata?.preview));

    const compactMetadata: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(metadata ?? {})) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        compactMetadata[key] = value;
      }
    }

    const title =
      firstNonEmptyString(
        asString(part.title),
        tool,
        partType,
        asString(structured?.eventType),
        asString(event.type),
      ) || "step";

    const hasRenderableProgress =
      !!callID ||
      !!id ||
      !!filePath ||
      !!output ||
      !!preview ||
      !!tool ||
      !!partType;
    if (!hasRenderableProgress) {
      diagnostics.noRenderableProgress += 1;
      rememberSkipped("no_renderable_progress", event, index);
      continue;
    }

    rawSteps.push({
      id,
      callID,
      messageID: partMessageID || undefined,
      sessionID,
      title,
      type: tool ? "tool" : "step",
      status,
      source: "raw_debug",
      partType: partType || undefined,
      internal: Boolean(part.internal),
      meta: preview || undefined,
      filePath,
      startedAt: startedAt ? Number(startedAt) : undefined,
      endedAt: endedAt ? Number(endedAt) : undefined,
      streamSeq: index,
      activityDetail: {
        kind: tool === "read" ? "read" : tool === "question" ? "other" : tool || "tool_call",
        summary: filePath || preview || output || title,
        tool,
        command: firstNonEmptyString(
          asString(input?.command),
          asString(part.command),
          asString(state?.command),
        ) || undefined,
        file: filePath,
        input: input ?? undefined,
        output: output || undefined,
        // Store the display title (e.g., relative path) from state.title for read steps
        title: asString(part.title) || undefined,
        metadata: Object.keys(compactMetadata).length > 0 ? compactMetadata : undefined,
        sessionID,
      },
    });
    diagnostics.pushed += 1;
    rememberPushed(event, index);
  }

  const rawStepFilterPreview = rawSteps.slice(0, 12).map((step, index) => {
    const stepRec = step as StreamingStep;
    return {
      index,
      id: "id" in step ? step.id : undefined,
      callID: "callID" in step ? step.callID : undefined,
      messageID: "messageID" in step ? step.messageID : undefined,
      title: step.title,
      type: step.type,
      partType: "partType" in step ? step.partType : undefined,
      status: step.status,
      tool: stepRec.activityDetail?.tool,
      kind: stepRec.activityDetail?.kind,
      hasActivityDetail: !!stepRec.activityDetail,
      wouldRender: isActionProgressStep(step),
    };
  });
  const projectedItems = progressItemsFromSteps(rawSteps, "raw-event");
  logger.info(`${ACTIVITY_TIMELINE_DIAGNOSTIC_LOG} progress_projection`, {
    diagnostics,
    rawSteps: rawSteps.length,
    projectedItems: projectedItems.length,
    rawStepFilterPreview,
    skippedSamples,
    pushedSamples,
    projectedSamples: projectedItems
      .slice(0, 8)
      .map((item, index) => summarizeProgressItemForTimelineDiagnostics(item, index)),
  });

  return projectedItems;
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
  const partType = ("partType" in step ? step.partType : undefined) || "";
  const normalizedPartType = partType.toString().toLowerCase();
  const filePath =
    ("filePath" in step ? step.filePath : undefined) ||
    ("content" in step ? step.content : undefined);
  const diffStats =
    "diffStats" in step
      ? (step.diffStats as { added: number; deleted: number } | undefined)
      : undefined;
  const activityDetail =
    "activityDetail" in step
      ? (step.activityDetail as ActivityDetail | undefined)
      : undefined;
  const hasUserFacingActivity =
    Boolean(filePath) ||
    Boolean(diffStats && (diffStats.added > 0 || diffStats.deleted > 0)) ||
    Boolean(activityDetail);
  const normalizedTitle = (step.title ?? "").trim().toLowerCase();

  // Step-start / step-finish are lifecycle markers, not user-facing timeline
  // entries. Keep them out of the UI entirely so they do not duplicate the
  // meaningful activity rows that surround them.
  if (
    normalizedPartType === "step-start" ||
    normalizedPartType === "step-finish" ||
    type === "step-start" ||
    type === "step-finish"
  ) {
    return false;
  }
  // Reasoning is rendered in the thinking timeline, not as a progress step.
  // Keeping it out of this path prevents the same assistant text from showing
  // twice with and without the raw badge.
  if (normalizedPartType === "reasoning" || type === "reasoning") {
    return false;
  }
  // Filter out tool wrapper events that just show "tool completed successfully"
  // These are internal system events, not actual user-facing progress
  if (type === "tool" && step.title?.toLowerCase().includes("structuredoutput")) {
    return false;
  }

  const activityTool = (
    ("activityDetail" in step ? (step as StreamingStep).activityDetail?.tool : undefined) ?? ""
  ).toLowerCase();
  const stepTitleLower = (step.title ?? "").toLowerCase();
  const normalizedRunPrefix = stepTitleLower.replace(/^running\s+/, "");
  if (
    type === "tool" &&
    step.partType?.toLowerCase() !== "step-start" &&
    step.partType?.toLowerCase() !== "step-finish" &&
    !hasUserFacingActivity &&
    (
      activityTool === "question" ||
      activityTool === "request_user_input" ||
      activityTool === "request-user-input" ||
      normalizedRunPrefix === "question" ||
      normalizedRunPrefix === "request_user_input" ||
      normalizedRunPrefix === "request-user-input"
    )
  ) {
    return false;
  }

  // Filter placeholder rows that only say "step" and carry no user-facing data.
  if (!hasUserFacingActivity && normalizedTitle === "step" && type !== "tool") {
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
      const stepMessageId =
        "messageID" in step && typeof (step as { messageID?: string }).messageID === "string"
          ? (step as { messageID?: string }).messageID
          : undefined;
      const stepSessionId =
        "sessionID" in step && typeof step.sessionID === "string"
          ? step.sessionID
          : undefined;
      const stepStartedAt =
        "startedAt" in step && typeof step.startedAt === "number"
          ? step.startedAt
          : undefined;
      const stepEndedAt =
        "endedAt" in step && typeof step.endedAt === "number"
          ? step.endedAt
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
      const stepSource =
        "source" in step
          ? (step.source as "stream" | "final" | "raw_debug" | undefined)
          : undefined;
      const stepPartType =
        "partType" in step ? (step.partType as string | undefined) : undefined;
      const stepInternal =
        "internal" in step ? Boolean(step.internal) : false;

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
        if (!existing.messageID && stepMessageId) existing.messageID = stepMessageId;
        if (!existing.sessionID && stepSessionId) existing.sessionID = stepSessionId;
        if (!existing.startedAt && stepStartedAt) existing.startedAt = stepStartedAt;
        if (!existing.endedAt && stepEndedAt) existing.endedAt = stepEndedAt;
        if (!existing.source && stepSource) existing.source = stepSource;
        if (!existing.partType && stepPartType) existing.partType = stepPartType;
        existing.internal = Boolean(existing.internal || stepInternal);
        if ("diffStats" in step)
          existing.diffStats = step.diffStats as {
            added: number;
            deleted: number;
          };
        if ("activityDetail" in step && step.activityDetail) {
          existing.activityDetail = step.activityDetail as ActivityDetail;
        }
      } else {
        stepMap.set(mergeKey, {
          key: `${prefix}-${index}-${title}`,
          mergeKey,
          id: stepId,
          callID: stepCallId,
          messageID: stepMessageId,
          sessionID: stepSessionId,
          title,
          status,
          source: stepSource,
          partType: stepPartType,
          internal: stepInternal,
          meta,
          filePath: stepFilePath,
          startedAt: stepStartedAt,
          endedAt: stepEndedAt,
          diffStats:
            "diffStats" in step
              ? (step.diffStats as { added: number; deleted: number })
              : undefined,
          activityDetail:
            "activityDetail" in step
              ? (step.activityDetail as ActivityDetail | undefined)
              : undefined,
          streamSeq:
            "streamSeq" in step
              ? (step as { streamSeq?: number }).streamSeq
              : undefined,
        });
      }
    });

  return Array.from(stepMap.values());
}

function progressItemsFromRawResponseParts(
  rawResponse?: Message["rawResponse"],
): ProgressItem[] {
  if (!rawResponse) {
    return [];
  }

  const parseRawResponseRecord = (raw: unknown): Record<string, unknown> | null => {
    const rec = asRecord(raw);
    if (rec) {
      return rec;
    }
    if (typeof raw !== "string") {
      return null;
    }
    const text = raw.trim();
    if (!text) {
      return null;
    }
    try {
      return asRecord(JSON.parse(text));
    } catch {
      return null;
    }
  };

  const rawResponseRec = parseRawResponseRecord(rawResponse);
  const rawParts = Array.isArray(rawResponseRec?.parts) ? rawResponseRec.parts : [];
  if (rawParts.length === 0) {
    return [];
  }

  const items: ProgressItem[] = [];
  for (const [index, part] of rawParts.entries()) {
    const partRec = asRecord(part);
    if (!partRec) {
      continue;
    }

    const toolName = firstNonEmptyString(
      asString(partRec.tool),
      asString(partRec.name),
      asString(partRec.type),
    )?.toLowerCase();
    const stateRec = asRecord(partRec.state);
    const inputRec = asRecord(stateRec?.input);
    const metadataRec = asRecord(stateRec?.metadata);
    const filePath = firstNonEmptyString(
      asString(inputRec?.filePath),
      asString(inputRec?.path),
      asString(inputRec?.file),
    );
    const status = normalizeProgressStatus(
      firstNonEmptyString(
        asString(stateRec?.status),
        asString(partRec.status),
      ),
    );
    const callID = firstNonEmptyString(
      asString(partRec.callID),
      asString(partRec.callId),
    );
    const id = firstNonEmptyString(
      asString(partRec.id),
      asString(partRec.partID),
      asString(partRec.partId),
    );

    if (toolName !== "read" && !callID && !id) {
      continue;
    }

    const output = firstNonEmptyString(
      asString(stateRec?.output),
      asString(partRec.output),
    );
    const preview = firstNonEmptyString(asString(metadataRec?.preview));
    const rawTitle = toolName || "step";

    const compactMetadata: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(metadataRec ?? {})) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        compactMetadata[key] = value;
      }
    }

    items.push({
      key: `raw-${callID ?? id ?? partRec.messageID ?? index}`,
      mergeKey: callID ? `call:${callID}` : id ? `id:${id}` : `index:${index}`,
      id,
      callID,
      messageID: partMessageID || undefined,
      title: rawTitle,
      status,
      source: "raw_debug",
      partType: asString(partRec.type) || "tool",
      internal: Boolean(partRec.internal),
      meta: preview || undefined,
      filePath,
      diffStats: undefined,
      activityDetail: {
        kind: toolName === "read" ? "read" : toolName || "tool_call",
        summary: filePath || preview || rawTitle,
        tool: toolName,
        file: filePath,
        input: inputRec ?? undefined,
        output: output || undefined,
        // Store the display title (e.g., relative path) from state.title for read steps
        title: firstNonEmptyString(asString(stateRec?.title), asString(partRec.title)) || undefined,
        metadata: Object.keys(compactMetadata).length > 0 ? compactMetadata : undefined,
      },
      streamSeq: index,
    });
  }

  return items;
}

function progressItemsFromCentralizedData(
  rawSdkEventPayloads?: unknown[],
): ProgressItem[] {
  const rawItems = progressItemsFromRawEventPayloads(rawSdkEventPayloads);
  const stepMap = new Map<string, ProgressItem>();

  for (const item of rawItems) {
    const mergeKey = item.mergeKey || item.callID || item.id || item.key;
    const existing = stepMap.get(mergeKey);
    if (!existing) {
      stepMap.set(mergeKey, { ...item });
      continue;
    }

    if (
      item.status === "error" ||
      item.status === "done" ||
      existing.status === "pending"
    ) {
      existing.status = item.status;
    }
    if (item.title) existing.title = item.title;
    if (item.meta) existing.meta = item.meta;
    if (item.filePath) existing.filePath = item.filePath;
    if (item.id && !existing.id) existing.id = item.id;
    if (item.callID && !existing.callID) existing.callID = item.callID;
    if (item.sessionID && !existing.sessionID) existing.sessionID = item.sessionID;
    if (item.startedAt && !existing.startedAt) existing.startedAt = item.startedAt;
    if (item.endedAt && !existing.endedAt) existing.endedAt = item.endedAt;
    if (item.source && !existing.source) existing.source = item.source;
    if (item.partType && !existing.partType) existing.partType = item.partType;
    existing.internal = Boolean(existing.internal || item.internal);
    if (item.diffStats) existing.diffStats = item.diffStats;
    if (item.activityDetail) existing.activityDetail = item.activityDetail;
  }

  const items = Array.from(stepMap.values());
  return items;
}

function commentaryItemsFromRawEventPayloads(
  rawSdkEventPayloads?: unknown[],
): CommentaryItem[] {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return [];
  }
  const rawItems = new Map<string, CommentaryItem>();
  const statusRank = (value?: unknown): number => {
    const status = asString(value).toLowerCase();
    if (status === "done" || status === "completed" || status === "complete") return 3;
    if (status === "error" || status === "failed") return 2;
    if (status === "running" || status === "pending") return 1;
    return 0;
  };

  for (let index = 0; index < rawSdkEventPayloads.length; index += 1) {
    const event = asRecord(rawSdkEventPayloads[index]);
    if (!event) continue;

    const properties = asRecord(event.properties);
    const part = asRecord(properties?.part) ?? asRecord(event.part);
    const syncEvent = asRecord(event.syncEvent);
    const syncData = asRecord(syncEvent?.data);
    const syncPart = asRecord(syncData?.part);
    const payloadRecord = asRecord(event.payload);
    const payloadSyncEvent = asRecord(payloadRecord?.syncEvent);
    const payloadSyncData = asRecord(payloadSyncEvent?.data);
    const payloadSyncPart = asRecord(payloadSyncData?.part);
    const aiResponseLike = isAiResponseEvent(event);
    const sourcePart = syncPart ?? payloadSyncPart ?? part;
    if (!sourcePart) continue;
    if (!aiResponseLike) continue;

    const stateRec = asRecord(sourcePart.state);
    const status = normalizeProgressStatus(
      firstNonEmptyString(
        asString(stateRec?.status),
        asString(sourcePart.status),
        asString(event.status),
      ),
    );
    const text = asString(sourcePart.text) || asString(sourcePart.content) || asString(sourcePart.message) || asString(stateRec?.output) || asString(sourcePart.output);
    if (!text) continue;

    const id = firstNonEmptyString(
      asString(sourcePart.id),
      asString(sourcePart.partID),
      asString(sourcePart.partId),
      asString(event.id),
    );
    const messageID = firstNonEmptyString(
      asString(sourcePart.messageID),
      asString(sourcePart.messageId),
      asString(event.messageID),
    );
    const partID = firstNonEmptyString(
      asString(sourcePart.partID),
      asString(sourcePart.partId),
    );
    const mergeKey = partID
      ? `part:${partID}`
      : messageID
        ? `msg:${messageID}`
        : id
          ? `id:${id}`
          : `text:${normalizeComparableText(text)}`;

    const nextItem: CommentaryItem = {
      id,
      text,
      streamSeq: index,
      kind: aiResponseLike ? "ai_response" : "commentary",
      status,
      messageID,
      partID,
    };

    const existing = rawItems.get(mergeKey);
    if (!existing) {
      rawItems.set(mergeKey, nextItem);
      continue;
    }

    const existingRank = statusRank(existing.status);
    const incomingRank = statusRank(status);
    if (incomingRank > existingRank) {
      rawItems.set(mergeKey, nextItem);
      continue;
    }

    if (incomingRank === existingRank) {
      if (normalizeComparableText(text).length > normalizeComparableText(existing.text).length) {
        rawItems.set(mergeKey, nextItem);
      }
    }
  }

  // Keep each commentary chunk in sequence, but collapse the canonical + sync
  // mirror entries that share the same stable identity.
  return Array.from(rawItems.values()).sort((a, b) => {
    const left = typeof a.streamSeq === "number" ? a.streamSeq : 0;
    const right = typeof b.streamSeq === "number" ? b.streamSeq : 0;
    return left - right;
  });
}

function formatTodoStatus(status: TodoItem["status"]): string {
  switch (status) {
    case "in_progress":
      return "in progress";
    default:
      return status;
  }
}

function truncateTodoLabel(text: string, maxLength = 44): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function getLatestTodoTransition(items: TodoItem[]): TodoItem | undefined {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item.status !== "pending") {
      return item;
    }
  }
  return items[items.length - 1];
}

function todoStatusTone(status: TodoItem["status"]): string {
  switch (status) {
    case "completed":
      return "text-oc-green border-oc-border bg-oc-green/8";
    case "in_progress":
      return "oc-tinted-badge-text border-oc-border bg-oc-accent/10";
    case "failed":
      return "text-oc-red border-oc-border bg-oc-red/10";
    case "cancelled":
      return "oc-text-secondary border-oc-border bg-oc-panel-soft";
    case "pending":
    default:
      return "oc-text-secondary border-oc-border bg-oc-panel-soft";
  }
}

function todoPriorityTone(priority?: TodoItem["priority"]): string {
  switch (priority) {
    case "high":
      return "text-oc-red border-oc-border bg-oc-red/10";
    case "medium":
      return "oc-quota-warning border-oc-border bg-oc-quota-warning-bg";
    case "low":
      return "oc-text-secondary border-oc-border bg-oc-panel-soft";
    default:
      return "oc-text-secondary border-oc-border bg-oc-panel-soft";
  }
}

function TodoInlineSummary({
  todoItems,
  showTodoChecklist,
  setShowTodoChecklist,
}: {
  todoItems: TodoItem[];
  showTodoChecklist: boolean;
  setShowTodoChecklist: (next: boolean) => void;
}) {
  if (todoItems.length === 0) {
    return null;
  }

  const sorted = [...todoItems].sort((a, b) => {
    const rank = (item: TodoItem): number => {
      switch (item.status) {
        case "in_progress":
          return 0;
        case "pending":
          return 1;
        case "failed":
          return 2;
        case "cancelled":
          return 3;
        case "completed":
          return 4;
        default:
          return 5;
      }
    };
    return rank(a) - rank(b);
  });
  const inProgressCount = todoItems.reduce(
    (count, item) => (item.status === "in_progress" ? count + 1 : count),
    0,
  );
  const completedCount = todoItems.reduce(
    (count, item) => (item.status === "completed" ? count + 1 : count),
    0,
  );
  const totalCount = todoItems.length;
  const latest = getLatestTodoTransition(todoItems);

  return (
    <section
      data-assistant-section="todo-inline-summary"
      className="oc-timeline-surface oc-timeline-soft-frame mt-1 mb-1 overflow-hidden rounded-xl"
    >
      <button
        type="button"
        className="oc-timeline-soft-frame__header flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-oc-panel/25"
        onClick={() => setShowTodoChecklist(!showTodoChecklist)}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-oc-text-soft">
            Todo Checklist
          </span>
          <span className="rounded-md border border-oc-border-soft px-1.5 py-0.5 text-[10px] font-medium oc-text-secondary">
            {totalCount}
          </span>
          <span className="text-[10px] oc-text-secondary">
            {completedCount}/{totalCount} done
          </span>
        </div>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-oc-text-soft transition-transform",
            showTodoChecklist ? "rotate-0" : "-rotate-90",
          )}
        />
      </button>
      {showTodoChecklist && (
        <div className="max-h-[280px] overflow-y-auto p-2" style={{ scrollPaddingBottom: "0.5rem" }}>
          <div className="mb-1 text-[10px] uppercase tracking-wider oc-text-secondary">
            {inProgressCount} in progress
            {latest ? ` · Latest: "${truncateTodoLabel(latest.content ?? latest.text ?? "")}"` : ""}
          </div>
          <div className="oc-timeline-soft-frame__body overflow-hidden rounded-lg">
          {sorted.map((todo) => {
            const isDone = todo.status === "completed";
            return (
              <div
                key={todo.id ?? todo.content ?? todo.text ?? todo.description ?? "todo"}
                className="oc-todo-row flex items-start gap-2 px-2 py-1.5 text-xs"
              >
                <span className="mt-0.5 shrink-0">
                  {todo.status === "completed" ? (
                    <Check className="h-3.5 w-3.5 text-oc-green" />
                  ) : todo.status === "in_progress" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-oc-green" />
                  ) : todo.status === "failed" ? (
                    <AlertCircle className="h-3.5 w-3.5 text-oc-red" />
                  ) : todo.status === "cancelled" ? (
                    <X className="h-3.5 w-3.5 oc-text-secondary" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 oc-text-secondary" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "break-words leading-relaxed",
                      isDone
                        ? "line-through opacity-70 oc-text-secondary"
                        : "text-oc-text-soft",
                    )}
                  >
                    {todo.description ?? todo.content ?? todo.text ?? "Untitled task"}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        todoStatusTone(todo.status),
                      )}
                    >
                      {formatTodoStatus(todo.status)}
                    </span>
                    {todo.priority ? (
                      <span
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          todoPriorityTone(todo.priority),
                        )}
                      >
                        {todo.priority}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        </div>
      )}
    </section>
  );
}

function TodoWriteStep({ event }: { event: DisplayEvent }) {
  const [showTodoChecklist, setShowTodoChecklist] = useState(true);

  let todos: any[] = [];
  try {
    const parsedOutput = event.activityDetail?.output ? JSON.parse(event.activityDetail.output) : null;
    const parsedInputTodos = event.activityDetail?.input?.todos;
    
    if (Array.isArray(parsedOutput)) {
      todos = parsedOutput;
    } else if (Array.isArray(parsedInputTodos)) {
      todos = parsedInputTodos;
    } else if (parsedOutput?.todos && Array.isArray(parsedOutput.todos)) {
      todos = parsedOutput.todos;
    }
  } catch (e) {
    // ignore
  }

  if (todos.length === 0) {
    if (event.status === "pending") {
      return (
        <div className="oc-refined-event-content flex items-center gap-2 rounded-md px-3 py-2 text-xs text-oc-text-soft">
          <ThinkingStatusTicker className="oc-thinking-status" />
          <span>Generating checklist...</span>
        </div>
      );
    }
    return null;
  }

  return (
    <TodoInlineSummary
      todoItems={todos}
      showTodoChecklist={showTodoChecklist}
      setShowTodoChecklist={setShowTodoChecklist}
    />
  );
}

function sanitizeUserContent(raw: string): string {
  return raw
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[interactive:[^:]+:[^\]]+\]\s*/gi, "")
    .trim();
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripHydratedAttachmentEcho(raw: string, message?: Message): string {
  if (!message || !Array.isArray(message.parts) || message.parts.length === 0) {
    return raw;
  }

  const attachedPaths = message.parts
    .map((part) => part.filename ?? part.source?.path)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (attachedPaths.length === 0) {
    return raw;
  }

  let cleaned = raw;
  for (const path of attachedPaths) {
    const escapedPath = escapeForRegex(path.trim()).replace(/[\\/]/g, "[\\\\/]");
    const fencedEchoPattern = new RegExp(
      String.raw`(?:\r?\n)?` +
      "```" +
      String.raw`[a-zA-Z0-9_-]*\r?\n\s*\/\/\s*${escapedPath}(?::\d+)?[\s\S]*?` +
      "```",
      "g",
    );
    cleaned = cleaned.replace(fencedEchoPattern, "");

    const inlineEchoPattern = new RegExp(
      String.raw`(?:\r?\n)?\s*\/\/\s*${escapedPath}(?::\d+)?[^\n]*`,
      "g",
    );
    cleaned = cleaned.replace(inlineEchoPattern, "");
  }

  return cleaned.trim();
}

function stripGenericHydratedAttachmentFence(raw: string): string {
  if (!raw || !raw.includes("```")) {
    return raw;
  }

  // Hydrated artifact shape:
  // ```<lang>
  // // path/to/file.ext:line
  // <snippet...>
  // ```
  const fencedPathSnippetPattern =
    /(?:\r?\n)?```[a-zA-Z0-9_-]*\r?\n\s*\/\/\s*[^\n]*[\\/][^\n]*:\d+[^\n]*\r?\n[\s\S]*?```/g;

  // Same artifact can also appear without a newline before the fence.
  const inlineFencePattern =
    /```[a-zA-Z0-9_-]*\r?\n\s*\/\/\s*[^\n]*[\\/][^\n]*:\d+[^\n]*\r?\n[\s\S]*?```/g;

  return raw
    .replace(fencedPathSnippetPattern, "")
    .replace(inlineFencePattern, "")
    .trim();
}

function inferAttachmentPathsFromHydratedUserText(raw: string): string[] {
  if (!raw) {
    return [];
  }

  // Hydrated snippets commonly include comment headers like:
  // // path/to/file.ext:123
  // Extract the path while dropping trailing line/column metadata.
  const pathHeaderPattern = /^\s*\/\/\s*(.+?)(?::\d+(?::\d+)?)?\s*$/gm;
  const paths = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = pathHeaderPattern.exec(raw)) !== null) {
    const value = (match[1] || "").trim();
    if (!value) {
      continue;
    }

    if (!value.includes("/") && !value.includes("\\")) {
      continue;
    }

    paths.add(value);
  }

  return Array.from(paths);
}

function isExplicitFileAttachmentPart(part: MessagePart): boolean {
  const partType = (part.type || "").trim().toLowerCase();
  if (partType === "file") {
    return true;
  }

  // Fallback for legacy payloads that omit part.type but still carry a file path.
  const hasPathLikeSource =
    typeof part.source?.path === "string" && part.source.path.trim().length > 0;
  const hasFilename =
    typeof part.filename === "string" && part.filename.trim().length > 0;
  const hasTextPayload =
    typeof part.text === "string" ||
    typeof part.content === "string" ||
    typeof part.message === "string";

  return (hasPathLikeSource || hasFilename) && !hasTextPayload;
}

function normalizedUserMessageText(message?: Message): string {
  const raw =
    message?.content ?? message?.text ?? messageBodyFromParts(message?.parts);
  const withoutAttachmentEcho = stripHydratedAttachmentEcho(
    typeof raw === "string" ? raw : "",
    message,
  );
  const withoutGenericFenceEcho =
    stripGenericHydratedAttachmentFence(withoutAttachmentEcho);
  return splitInjectedSystemPromptFromUserText(withoutGenericFenceEcho).userText;
}

function splitInjectedSystemPromptFromUserText(raw: string): {
  systemText?: string;
  userText: string;
} {
  const sanitized = sanitizeUserContent(raw);
  if (!sanitized) {
    return { userText: "" };
  }

  const separatorMatch = sanitized.match(/(?:\r?\n)---(?:\r?\n)+/);
  if (!separatorMatch) {
    return { userText: sanitized };
  }

  const separatorIndex = sanitized.indexOf(separatorMatch[0]);
  if (separatorIndex <= 0) {
    return { userText: sanitized };
  }

  const systemText = sanitized.slice(0, separatorIndex).trim();
  const userText = sanitized.slice(separatorIndex + separatorMatch[0].length).trim();
  if (!systemText || !userText || !hasSystemMessagePatternInText(systemText)) {
    return { userText: sanitized };
  }

  return { systemText, userText };
}

function isDeltaCentralizedEventPayload(payload: unknown): boolean {
  const rec = asRecord(payload);
  if (!rec) {
    return false;
  }

  const eventType = `${asString(rec.type)} ${asString(rec.event)} ${asString(rec.kind)}`.toLowerCase();
  if (eventType.includes("delta")) {
    return true;
  }

  const properties = asRecord(rec.properties);
  const syncEvent = asRecord(rec.syncEvent);
  const syncData = asRecord(syncEvent?.data);
  const part = asRecord(properties?.part) ?? asRecord(rec.part) ?? asRecord(syncData?.part);

  return Boolean(
    asString(properties?.delta).trim() ||
      asString(rec.delta).trim() ||
      asString(syncData?.delta).trim() ||
      asString(part?.delta).trim() ||
      asString(part?.text).trim() && eventType.includes("message.part.delta"),
  );
}

// Function to parse text and extract file mentions
function parseFileMentions(text: string) {
  if (!text) return [];
  const parts: Array<{ type: 'text' | 'file'; content: string; filename?: string }> = [];
  let lastIndex = 0;
  let match;
  FILE_MENTION_REGEX.lastIndex = 0; // Reset regex state

  while ((match = FILE_MENTION_REGEX.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: text.slice(lastIndex, match.index)
      });
    }
    // Add the file mention
    parts.push({
      type: 'file',
      content: match[0],
      filename: match[1]
    });
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push({
      type: 'text',
      content: text.slice(lastIndex)
    });
  }

  return parts.length > 0 ? parts : [{ type: 'text', content: text }];
}

// Component to render text with highlighted file mentions
function renderHighlightedText(text: string) {
  const parts = parseFileMentions(text);

  return parts.map((part, index) => {
    const key = `${part.type}-${index}`;
    if (part.type === 'file' && 'filename' in part && part.filename) {
      return (
        <span
          key={key}
          className="file-mention-chip"
          onClick={() => {
            // Open file when clicked
            vscode.postMessage({
              type: "openFile",
              file: (part as any).filename,
            });
          }}
          title={`Open ${(part as any).filename}`}
        >
          {part.content}
        </span>
      );
    }
    return <span key={key}>{part.content}</span>;
  });
}

function isPlanProceedMessageContent(value: string): boolean {
  return (
    /\bproceed on this plan\.?/i.test(value) ||
    /\bplan approved\b/i.test(value)
  );
}

function isPlanRevisionMessageContent(value: string): boolean {
  return /\brevise this implementation plan\b/i.test(value);
}

function normalizePlanFilePathForComparison(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:\//, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

function areLikelySamePlanFilePath(a: unknown, b: unknown): boolean {
  const left = normalizePlanFilePathForComparison(a);
  const right = normalizePlanFilePathForComparison(b);
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  return left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}



function normalizeFileChangePathForComparison(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:\//, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

function areLikelySameFileChangePath(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}



function isFileChangeSubset(small: Set<string>, large: Set<string>): boolean {
  if (small.size === 0 || large.size === 0 || small.size > large.size) {
    return false;
  }
  for (const file of small) {
    let matched = false;
    for (const candidate of large) {
      if (areLikelySameFileChangePath(file, candidate)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      return false;
    }
  }
  return true;
}


/**
 * LEGACY NORMALIZATION LAYER.
 *
 * This timeline builder is still in place so the current UI can keep working
 * during the migration, but it is not the long-term architecture. The new
 * conversation flow should render directly from the centralized raw event tape
 * and delete this re-sorting / grouping pass once the v2 path is complete.
 *
 * For now it still handles both streaming and hydrated messages by sorting
 * thoughtItems and progressItems, then falling back to parts-based replay when
 * timing data is missing.
 */
function buildTimeline(
  thoughtItems: ThoughtItem[],
  progressItems: ProgressItem[],
  commentaryItems: CommentaryItem[],
  html: string,
  /** Only used for the parts-based fallback path; null during streaming */
  messageParts?: MessagePart[],
): TimelineBlock[] {
  // Check if we have any timing data for sorted interleaving.
  const hasTimedThoughts = thoughtItems.some(
    (t) => seqFromThoughtKey(t.key) > 0,
  );
  const hasTimedSteps = progressItems.some((p) => p.streamSeq != null);
  const hasTimedCommentary = commentaryItems.some((c) => c.streamSeq != null);

  if (hasTimedThoughts || hasTimedSteps || progressItems.length > 0 || hasTimedCommentary || commentaryItems.length > 0) {
    type RawEntry =
      | { seq: number; kind: "thinking"; item: ThoughtItem }
      | { seq: number; kind: "step"; item: ProgressItem }
      | { seq: number; kind: "commentary"; item: CommentaryItem }
      | { seq: number; kind: "content" };

    const entries: RawEntry[] = [];

    for (const item of thoughtItems) {
      entries.push({
        kind: "thinking",
        item,
        seq: seqFromThoughtKey(item.key),
      });
    }

  for (const item of progressItems) {
      entries.push({
        kind: "step",
        item,
        // +1 offset so a step at the same millisecond as a thinking event
        // always sorts after it (consistent with original streaming logic).
        seq:
          item.streamSeq != null
            ? item.streamSeq + 1
            : Number.MAX_SAFE_INTEGER,
      });
    }

    for (const item of commentaryItems) {
      const text = (item.text || "").trim();
      if (!text) continue;
      entries.push({
        kind: "commentary",
        item,
        seq:
          item.streamSeq != null
            ? item.streamSeq + 1
            : Number.MAX_SAFE_INTEGER,
      });
    }

    // Preserve the merged raw response body when available. It renders in the
    // assistant response section, while commentary chunks remain available as
    // timeline blocks for live/step-by-step rendering.
    if (html) {
      entries.push({ kind: "content", seq: Number.MAX_SAFE_INTEGER });
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
      } else if (entry.kind === "commentary") {
        blocks.push({
          kind: "commentary",
          text: entry.item.text,
          messageID: entry.item.messageID,
          partID: entry.item.partID,
          label:
            entry.item.kind === "ai_response"
              ? "Assistant Response"
              : "Commentary",
        });
      } else {
        blocks.push({ kind: "content", html });
      }
    }

    return blocks;
  }

  // ── Fallback: parts-based approach for server-loaded messages with no timing ──
  const parts = messageParts;

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
    // insert them before the first content block.
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

  // Fallback for messages with no parts array
  const blocks: TimelineBlock[] = [];
  if (thoughtItems.length > 0)
    blocks.push({ kind: "thinking", items: thoughtItems });
  if (progressItems.length > 0)
    blocks.push({ kind: "steps", items: progressItems });
  if (html) blocks.push({ kind: "content", html });

  return blocks;
}

function buildMessageTimeline(
  message?: Message,
  html = "",
  rawSdkEventPayloads?: unknown[],
): TimelineBlock[] {
  const centralizedRawSdkEventPayloads =
    rawSdkEventPayloads ?? message?.rawSdkEventPayloads;
  return buildTimeline(
    thoughtItemsFromRawEventPayloads(centralizedRawSdkEventPayloads),
    progressItemsFromCentralizedData(
      centralizedRawSdkEventPayloads
    ),
    commentaryItemsFromRawEventPayloads(centralizedRawSdkEventPayloads),
    html,
    message?.parts,
  );
}

type MessageViewState = {
  showActivityDetails: boolean;
  showThinkingDetails: boolean;
  showInternalActivity: boolean;
  expandedReasoningSteps: Set<string>; // Track individual reasoning step expansion
};

type DisplayEvent = {
  key: string;
  kind: "activity" | "reasoning" | "commentary";
  label: string;
  summary: string;
  description?: string;
  detail?: string;
  status: "pending" | "done" | "error";
  source?: "stream" | "final" | "raw_debug";
  partType?: string;
  internal?: boolean;
  filePath?: string;
  callID?: string;
  messageID?: string;
  partID?: string;
  sessionID?: string;
  startedAt?: number;
  endedAt?: number;
  diffStats?: { added: number; deleted: number };
  activityDetail?: ActivityDetail;
  viewDiffFile?: string;
  isImportant?: boolean;
  updateCount: number;
};

const ACTIVITY_TIMELINE_DIAGNOSTIC_LOG = "[ACTIVITY-TIMELINE-DIAG]";

function summarizeCentralizedEventForTimelineDiagnostics(
  value: unknown,
  index: number,
): Record<string, unknown> {
  const event = asRecord(value);
  const payload = asRecord(event?.payload);
  const syncEvent = asRecord(event?.syncEvent) ?? asRecord(payload?.syncEvent);
  const syncData = asRecord(syncEvent?.data);
  const properties = asRecord(event?.properties) ?? asRecord(payload?.properties);
  const part = event ? getCentralizedEventPart(event) : null;
  const state = asRecord(part?.state);
  const input = asRecord(state?.input);

  return {
    index,
    id: firstNonEmptyString(
      asString(event?.id),
      asString(payload?.id),
      asString(syncEvent?.id),
    ),
    type: firstNonEmptyString(
      asString(event?.type),
      asString(payload?.type),
      asString(syncEvent?.type),
    ),
    wrappedPayloadType: asString(payload?.type) || undefined,
    source: asString(event?.source) || undefined,
    partType: asString(part?.type) || undefined,
    tool: asString(part?.tool) || asString(part?.name) || undefined,
    status: asString(state?.status) || asString(part?.status) || undefined,
    partID: firstNonEmptyString(
      asString(part?.id),
      asString(part?.partID),
      asString(part?.partId),
      asString(properties?.partID),
      asString(properties?.partId),
    ),
    messageID: firstNonEmptyString(
      asString(part?.messageID),
      asString(part?.messageId),
      asString(properties?.messageID),
      asString(properties?.messageId),
      asString(syncData?.messageID),
      asString(syncData?.messageId),
    ),
    callID: firstNonEmptyString(
      asString(part?.callID),
      asString(part?.callId),
    ),
    hasInput: !!input,
    hasOutput: typeof state?.output === "string" || typeof part?.output === "string",
  };
}

function summarizeProgressItemForTimelineDiagnostics(
  item: ProgressItem,
  index: number,
): Record<string, unknown> {
  return {
    index,
    key: item.key,
    mergeKey: item.mergeKey,
    id: item.id,
    callID: item.callID,
    messageID: item.messageID,
    title: item.title,
    status: item.status,
    source: item.source,
    partType: item.partType,
    tool: item.activityDetail?.tool,
    kind: item.activityDetail?.kind,
    hasOutput: !!item.activityDetail?.output,
  };
}

function summarizeDisplayEventForTimelineDiagnostics(
  event: DisplayEvent,
  index: number,
): Record<string, unknown> {
  return {
    index,
    key: event.key,
    kind: event.kind,
    label: event.label,
    status: event.status,
    source: event.source,
    partType: event.partType,
    messageID: event.messageID,
    callID: event.callID,
    tool: event.activityDetail?.tool,
    activityKind: event.activityDetail?.kind,
    summary: event.summary ? event.summary.slice(0, 120) : "",
  };
}

function displayEventSourcePriority(source?: DisplayEvent["source"]): number {
  // Prefer the canonical event tape over the raw debug mirror when both
  // produce the same visible row. That keeps one row in the timeline while
  // still letting richer non-raw data win when it exists.
  switch (source) {
    case "final":
      return 3;
    case "stream":
      return 2;
    case "raw_debug":
      return 1;
    default:
      return 2;
  }
}

function displayEventFingerprint(event: DisplayEvent): string {
  const label = event.label.trim().toLowerCase();
  const filePath = (event.filePath ?? "").trim().toLowerCase();
  const callID = (event.callID ?? "").trim().toLowerCase();
  const messageID = (event.messageID ?? "").trim().toLowerCase();
  const partID = (event.partID ?? "").trim().toLowerCase();
  const sessionID = (event.sessionID ?? "").trim().toLowerCase();
  const partType = (event.partType ?? "").trim().toLowerCase();
  const activityTool = (event.activityDetail?.tool ?? "").trim().toLowerCase();

  if (event.kind === "activity") {
    // Activity rows may surface multiple times across canonical/sync mirrors and
    // across lifecycle states (running -> pending -> done). Their visible
    // summary text can change as the raw payload stabilizes, so key them by
    // stable identity instead of rendered prose.
    return [
      "activity",
      label,
      callID || filePath,
      messageID,
      partID,
      sessionID,
      partType,
      activityTool,
      String(event.internal ?? false),
    ].join("|");
  }

  // Non-activity rows (reasoning/commentary) should continue to include their
  // rendered text so chunked reasoning remains sequential instead of collapsing
  // into a single line.
  return [
    event.kind,
    label,
      event.summary.trim().toLowerCase(),
      (event.description ?? "").trim().toLowerCase(),
      (event.detail ?? "").trim().toLowerCase(),
      filePath,
      callID,
      messageID,
      partID,
      sessionID,
    partType,
      String(event.internal ?? false),
  ].join("|");
}

function sourceFromThoughtKey(
  key: string,
): "stream" | "final" | "raw_debug" | undefined {
  if (key.startsWith("stream-")) return "stream";
  if (key.startsWith("evt-")) return "final";
  if (key.startsWith("raw-")) return "raw_debug";
  return undefined;
}

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

function subagentModelLabel(
  subagent: SubagentSummary,
  detail?: SubagentDetail,
): string {
  if (getGlobalShowBrowserConsole()) {
    console.log('[SUBAGENT][RENDER] subagentModelLabel called with data', {
    subagentId: subagent.id,
    providerID: subagent.providerID,
    modelID: subagent.modelID,
    agentId: subagent.agentId,
    status: subagent.status,
    hasDetail: !!detail,
    detailProviderID: detail?.providerID,
    detailModelID: detail?.modelID,
    });
  }
  const provider = subagent.providerID || detail?.providerID;
  const model = subagent.modelID || detail?.modelID;
  if (provider && model) {
    return `${provider}/${model}`;
  }

  // If we have partial info, show it
  if (model || provider) {
    return (model || provider) as string;
  }

  const roleLabel = deriveSubagentRole(subagent);
  if (roleLabel) {
    return roleLabel;
  }

  // No model info available - check status to determine appropriate message
  const resolvedStatus = resolveSubagentStatus(subagent, detail);
  const isError = resolvedStatus === 'error' || resolvedStatus === 'orphaned';
  const isTerminal = resolvedStatus === 'done';

  if (isError || isTerminal) {
    // Prefer a neutral label over "Unknown" when the subagent is terminal but
    // has no provider/model metadata.
    return "Subagent";
  }

  // For pending/running subagents, check if they've been stuck without model info
  // This handles cases where subagents were interrupted or stalled
  const hasStarted = subagent.startedAt && subagent.startedAt > 0;
  const hasEnded = subagent.endedAt && subagent.endedAt > 0;

  if (hasStarted) {
    // If started but no model info, check how long it's been running
    const now = Date.now();
    const elapsed = hasEnded ? subagent.endedAt! - subagent.startedAt! : now - subagent.startedAt!;

    // If it's been more than 5 seconds without model info, likely not coming
    // (e.g., interrupted, stalled, or model selection failed)
    if (elapsed > 5000) {
      return "Subagent";
    }
  }

  // For recently started pending/running subagents, show loading state
  return "Loading...";
}

function SubagentsInlineCard({
  subagents,
  subagentDetailsById,
  showSubagents,
  setShowSubagents,
  showAllSubagents,
  setShowAllSubagents,
  openSubagentModal,
}: {
  subagents: SubagentSummary[];
  subagentDetailsById: AppState["subagentDetailsById"];
  showSubagents: boolean;
  setShowSubagents: (next: boolean) => void;
  showAllSubagents: boolean;
  setShowAllSubagents: (next: boolean) => void;
  openSubagentModal: (subagentId: string) => void;
}) {
  const [durationNow, setDurationNow] = useState(() => Date.now());
  // Show all subagents including orphaned ones - they should be visible in the UI
  // Orphaned subagents are newly spawned and haven't been linked to a parent session yet
  const visibleSubagentsList = subagents;
  const totalSubagentCount = visibleSubagentsList.length;
  const visibleSubagents = (showAllSubagents
    ? visibleSubagentsList
    : visibleSubagentsList.slice(0, 10));
  const hasLiveSubagentDuration = useMemo(
    () =>
      showSubagents &&
      visibleSubagents.some((subagent) => {
        const detail = subagentDetailsById?.[subagent.id] as
          | SubagentDetail
          | undefined;
        const status = resolveSubagentStatus(subagent, detail);
        return status === "running" || status === "pending";
      }),
    [showSubagents, visibleSubagents, subagentDetailsById],
  );

  useEffect(() => {
    if (!hasLiveSubagentDuration) {
      return;
    }
    setDurationNow(Date.now());
    const timer = window.setInterval(() => {
      setDurationNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [hasLiveSubagentDuration]);

  if (totalSubagentCount === 0) {
    return null;
  }

  const resolvedStatusCounts = visibleSubagents.reduce(
    (acc, subagent) => {
      const detail = subagentDetailsById?.[subagent.id] as SubagentDetail | undefined;
      const status = resolveSubagentStatus(subagent, detail);
      if (status === "running") acc.running += 1;
      else if (status === "done") acc.done += 1;
      else if (status === "error") acc.error += 1;
      return acc;
    },
    { running: 0, done: 0, error: 0 },
  );

  return (
    <div
      data-assistant-section="subagents-inline-card"
      className="oc-subagents-panel mt-2.5 mb-2.5 overflow-hidden rounded-md border bg-oc-panel-soft"
    >
      <button
        type="button"
        className="oc-subagents-panel-header w-full border-b px-2.5 py-2 text-left hover:bg-oc-panel"
        onClick={() => setShowSubagents(!showSubagents)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 oc-subagents-header-icon" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-oc-text-soft">
              Subagents
            </span>
            <span className="oc-subagents-count rounded-md border px-1.5 py-0.5 font-medium text-oc-2xs text-oc-text-soft">
              {totalSubagentCount}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {resolvedStatusCounts.running > 0 && (
              <Badge className="h-5 bg-oc-accent/10 px-1.5 text-[10px] oc-tinted-badge-text">
                {resolvedStatusCounts.running} running
              </Badge>
            )}
            {resolvedStatusCounts.done > 0 && (
              <Badge className="h-5 bg-oc-green/10 px-1.5 text-[10px] text-oc-green">
                {resolvedStatusCounts.done} done
              </Badge>
            )}
            {resolvedStatusCounts.error > 0 && (
              <Badge className="h-5 bg-oc-red/10 px-1.5 text-[10px] text-oc-red">
                {resolvedStatusCounts.error} error
              </Badge>
            )}
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 text-oc-text-soft transition-transform",
                showSubagents ? "rotate-0" : "-rotate-90",
              )}
            />
          </div>
        </div>
      </button>

      {showSubagents && (
        <div className="space-y-1.5 p-2">
          <div
            className="max-h-[260px] space-y-1 overflow-y-auto pr-1 pb-1.5"
            style={{ scrollPaddingBottom: "0.5rem" }}
          >
            {visibleSubagents.map((subagent: SubagentSummary) => {
              const detail = subagentDetailsById?.[subagent.id] as
                | SubagentDetail
                | undefined;

              if (getGlobalShowBrowserConsole()) {
                console.log('===SUBAGENT_SPAWN=== [UI_RENDER] Rendering subagent card', {
                subagentId: subagent.id,
                hasDetail: !!detail,
                subagentKeys: subagent ? Object.keys(subagent) : [],
                detailKeys: detail ? Object.keys(detail) : [],
                subagentProviderID: subagent.providerID,
                subagentModelID: subagent.modelID,
                subagentAgentId: subagent.agentId,
                detailProviderID: detail?.providerID,
                detailModelID: detail?.modelID,
                detailAgentId: detail?.agentId,
                detailErrorText: detail?.errorText,
                detailStatus: detail?.status,
                subagentStatus: subagent.status,
              });
              }

              const resolvedStatus = resolveSubagentStatus(subagent, detail);
              const hasTerminalStopMarker = !!(
                detail &&
                (
                  (Array.isArray(detail.timelineEvents) &&
                    detail.timelineEvents.some((event) => {
                      const type = (event.type || "").toLowerCase();
                      const label = (event.label || "").toLowerCase();
                      return type === "stop" || type === "stopped" || label === "stop" || label === "stopped";
                    })) ||
                  (Array.isArray(detail.progressEvents) &&
                    detail.progressEvents.some((event) => {
                      const title = (event.title || "").trim().toLowerCase();
                      return title === "stop" || title === "stopped";
                    })) ||
                  (Array.isArray(detail.conversationEvents) &&
                    detail.conversationEvents.some((event) => {
                      const kind = (event.kind || "").toLowerCase();
                      return kind === "stop" || kind === "stopped";
                    }))
                )
              );
              const modelInfo = subagentModelLabel(subagent, detail);
              const cardStyle = getSubagentCardStyle(subagent.id);
              const accentTextStyle = getSubagentAccentTextStyle(subagent.id);
              const statusText = subagentStatusLabel(resolvedStatus) || "Pending";
              const durationMs = getSubagentDisplayDurationMs(
                subagent,
                detail,
                durationNow,
                resolvedStatus,
              );
              const activityText = getSubagentDisplayActivity(
                subagent,
                detail,
                resolvedStatus,
                statusText || "Initializing...",
              );
              const loadingHint =
                resolvedStatus === "running" && !hasTerminalStopMarker
                  ? "Waiting for next progress..."
                  : "";
              const backgroundTaskId = isBackgroundTaskId(subagent.backgroundTaskId)
                ? subagent.backgroundTaskId
                : isBackgroundTaskId(subagent.id)
                  ? subagent.id
                  : undefined;
              const agentRole = deriveSubagentRole(subagent);
              const shouldShowActivity =
                activityText.trim().toLowerCase() !==
                statusText.trim().toLowerCase();

              return (
                <button
                  key={subagent.id}
                  type="button"
                  className={cn(
                    "oc-subagent-row w-full rounded-md border bg-oc-bg-soft px-2 py-1 text-left transition-colors",
                    "hover:bg-oc-panel",
                  )}
                  style={cardStyle}
                  onClick={() => openSubagentModal(subagent.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="oc-agent-icon shrink-0" style={accentTextStyle}>
                        {resolvedStatus === "running" ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : resolvedStatus === "error" ? (
                          <X className="h-3 w-3 text-oc-red" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                      </div>
                      <span className="truncate text-oc-xs font-semibold text-oc-text-soft">
                        {modelInfo}
                      </span>
                    </div>
                    <span className="font-medium text-oc-2xs oc-text-secondary">
                      {formatDuration(durationMs)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1">
                    <span className="text-[9px] font-medium oc-text-secondary">
                      {statusText}
                    </span>
                    {agentRole ? (
                      <span className="rounded border border-oc-border-soft px-1 py-0 text-[8px] font-medium uppercase tracking-wide oc-text-secondary">
                        {agentRole}
                      </span>
                    ) : null}
                    {backgroundTaskId ? (
                      <span className="rounded border border-oc-border-soft px-1 py-0 text-[8px] font-medium uppercase tracking-wide oc-text-secondary">
                        {backgroundTaskId}
                      </span>
                    ) : null}
                  </div>
                  {shouldShowActivity ? (
                    <div className="mt-0.5 min-h-[12px] font-medium text-[9px] oc-text-secondary">
                      <FadeSwapText
                        text={loadingHint || activityText}
                        className="block truncate"
                        durationMs={220}
                      />
                    </div>
                  ) : null}
                </button>
              );
            })}
            {totalSubagentCount > 10 ? (
              <button
                type="button"
                className="text-oc-2xs font-medium oc-readable-accent hover:underline"
                onClick={() => setShowAllSubagents(!showAllSubagents)}
              >
                {showAllSubagents ? "Show less" : `Show all (${totalSubagentCount})`}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function TypewriterText({
  text,
  className,
  speed = 30,
}: {
  text: string;
  className?: string;
  speed?: number;
}) {
  const [displayedText, setDisplayedText] = useState("");
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    setDisplayedText("");
    setComplete(false);
    let i = 0;
    const timer = setInterval(() => {
      if (i < text.length) {
        setDisplayedText(text.slice(0, i + 1));
        i++;
      } else {
        clearInterval(timer);
        setComplete(true);
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  return (
    <span className={cn(className, !complete && "after:content-['|'] after:ml-0.5 after:animate-pulse")}>
      {displayedText}
    </span>
  );
}

function FadeSwapText({
  text,
  className,
  durationMs = 180,
  useTypewriter = false,
}: {
  text: string;
  className?: string;
  durationMs?: number;
  useTypewriter?: boolean;
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
      {useTypewriter ? (
        <TypewriterText text={displayText} speed={40} />
      ) : (
        displayText
      )}
    </span>
  );
}

const THINKING_LOADING_TEXTS = [
  "Bribing the intern to type faster…",
  "Download more RAM…",
  "Checking for typos I made up…",
  "Looking busy…",
  "Locating the 'any' key…",
  "Brewing virtual coffee…",
  "Herding the bits…",
  "Updating the flux capacitor…",
  "Waiting for the magic smoke to clear…",
  "Untangling the spaghetti code…",
  "Asking StackOverflow…",
  "Convincing the compiler to cooperate…",
  "Reversing the polarity…",
];
const THINKING_LOADING_TEXT_SWITCH_INTERVAL_MS = 4200;

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
    }, THINKING_LOADING_TEXT_SWITCH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className={cn(
        "inline-flex items-center font-medium text-[11px]",
        className,
      )}
    >
      <FadeSwapText
        text={THINKING_LOADING_TEXTS[messageIndex]}
        className="italic opacity-85 tracking-wide oc-glowing-text"
        durationMs={220}
        useTypewriter={true}
      />
    </div>
  );
}

function latestNonEmptyLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? "";
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

  // Hydrated history can include compact tool titles as a single token
  // (for example "read_file" or "shell"). Keep these as explicit labels
  // instead of collapsing to a generic "event" chip.
  const singleToken = stripTrailingEllipsis(title.toLowerCase());
  if (/^[a-z][a-z0-9_.-]{1,40}$/.test(singleToken)) {
    return { label: singleToken, summary: "" };
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

// LEGACY NORMALIZATION LAYER.
//
// This second pass reshapes the already-built timeline into UI-friendly rows.
// It is intentionally retained only as a migration bridge and should be
// removed when the centralized raw event tape becomes the sole render source.
function buildDisplayEvents(
  timelineBlocks: TimelineBlock[],
  fileChanges: StructuredFileChange[] | undefined,
  isStreamingActive: boolean,
  assistantTurnPending: boolean,
  currentMessageId?: string | null,
): DisplayEvent[] {
  const stripTrailingEllipsis = (value?: string) =>
    (value || "").replace(/\s*(?:\.{3}|…)\s*$/u, "").trim();
  const normalizePathForMatch = (value?: string) =>
    (value || "").replace(/\\/g, "/").toLowerCase();
  /**
   * Extract file paths from text while avoiding false positives.
   *
   * IMPORTANT: This function uses a VERY RESTRICTIVE regex to prevent
   * extracting normal text as file paths. This fixes issues where descriptive
   * text like "attachment handling in chat\nSearch for component files with
   * names containing 'chat', 'message', 'conversation', 'thread', 'input',
   * 'bubble' etc." was incorrectly parsed as a file path.
   *
   * The regex now ONLY matches:
   * 1. Known file extensions (whitelist: ts, js, json, etc.)
   * 2. Proper filename structure (alphanumeric start/end)
   * 3. Valid path separators (/ or \)
   * 4. No spaces, quotes, or special characters in filenames
   *
   * VALID extractions:
   * - "edit src/components/Button.tsx" → "src/components/Button.tsx" ✅
   * - "read ./config.json" → "./config.json" ✅
   * - "writing to /path/to/file.py" → "/path/to/file.py" ✅
   *
   * INVALID extractions (correctly rejected):
   * - "input", "bubble" etc. → undefined ❌ (quotes, spaces, not a valid file)
   * - "attachment handling in chat" → undefined ❌ (spaces, no extension)
   * - "etc." → undefined ❌ (not a known extension)
   * - Multi-line sentences → undefined ❌ (contains line breaks)
   *
   * @param value - Text to search for file paths
   * @returns Extracted file path or undefined if no valid path found
   */
  const extractFilePathFromText = (value?: string): string | undefined => {
    if (!value) return undefined;
    // Very restrictive pattern to avoid extracting text that looks like file paths
    // Only match actual file paths with known extensions, not arbitrary text with dots
    const match = value.match(
      /(?:^|[\s("'`])((?:\.{1,2}\/|\/|[A-Za-z]:\\)?[a-zA-Z0-9_][a-zA-Z0-9_.-]*[a-zA-Z0-9](?:\/[a-zA-Z0-9_][a-zA-Z0-9_.-]*[a-zA-Z0-9])*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|c|cpp|h|hpp|java|rb|php|sh|bash|zsh|fish|json|yaml|yml|toml|md|mdx|css|scss|less|html|xml|svg|sql|prisma|lock|env|gitignore|dockerfile|makefile))(?:$|[\s)"'`])/,
    );
    return match?.[1];
  };

  /**
   * Check if a string IS a valid file path (not contains one).
   * Unlike extractFilePathFromText which finds paths within text,
   * this validates that the entire string is a valid file path.
   */
  const isValidFilePath = (value?: string): boolean => {
    if (!value) return false;
    // Match the entire string as a file path, not just finding one within text
    // This prevents arbitrary text with "/" from being treated as file paths
    const isValid = value.match(
      /^(?:\.{1,2}\/|\/|[A-Za-z]:\\)?[a-zA-Z0-9_][a-zA-Z0-9_.-]*[a-zA-Z0-9](?:\/[a-zA-Z0-9_][a-zA-Z0-9_.-]*[a-zA-Z0-9])*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|c|cpp|h|hpp|java|rb|php|sh|bash|zsh|fish|json|yaml|yml|toml|md|mdx|css|scss|less|html|xml|svg|sql|prisma|lock|env|gitignore|dockerfile|makefile)$/,
    );
    return !!isValid;
  };

  // Clean event labels - remove unwanted prefixes and filter out system noise
  const cleanEventLabel = (label: string): string => {
    const cleaned = label
      .replace(/^final\s+/i, '') // Remove "Final" prefix
      .replace(/^step\s+/i, '') // Remove "Step" prefix
      .replace(/streaming|stream/gi, '') // Remove "Stream" or "Streaming" references
      .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
      .trim();

    // Filter out system noise events
    const lowerCleaned = cleaned.toLowerCase();
    if (
      lowerCleaned === 'starting' ||
      lowerCleaned === 'finishing' ||
      lowerCleaned.startsWith('starting ') ||
      lowerCleaned.startsWith('finishing ') ||
      lowerCleaned.includes('starting...') ||
      lowerCleaned.includes('finishing...')
    ) {
      return ''; // Return empty to filter out
    }

    // Return cleaned label or original if cleaning resulted in empty string
    return cleaned.trim() || label;
  };

  const rawEvents: DisplayEvent[] = [];

  for (const block of timelineBlocks) {
    if (block.kind === "content") {
      continue;
    }

    if (block.kind === "thinking") {
      for (const item of block.items) {
        const text = (item.text || "").trim();
        if (!text) continue;
        if (currentMessageId && item.messageID && item.messageID !== currentMessageId) {
          continue;
        }
        const source = sourceFromThoughtKey(item.key);
        rawEvents.push({
          key: `reasoning-${item.key}`,
          kind: "reasoning",
          label: "Reasoning",
          summary: text,
          status: item.status || ((isStreamingActive || assistantTurnPending) && source === "stream" ? "pending" : "done"),
          source,
          messageID: item.messageID,
          partID: item.partID,
          isImportant: false,
          updateCount: 1,
        });
      }
      continue;
    }

    if (block.kind === "commentary") {
      const text = (block.text || "").trim();
      if (!text) continue;
      if (
        currentMessageId &&
        "messageID" in block &&
        block.messageID &&
        block.messageID !== currentMessageId
      ) {
        continue;
      }
      rawEvents.push({
        key: `commentary-${rawEvents.length}`,
        kind: "commentary",
        label: block.label ?? "Commentary",
        summary: text,
        status: "done",
        messageID: "messageID" in block ? block.messageID : undefined,
        partID: "partID" in block ? block.partID : undefined,
        isImportant: false,
        updateCount: 1,
      });
      continue;
    }

    for (const event of block.items) {
      if (currentMessageId && event.messageID && event.messageID !== currentMessageId) {
        continue;
      }
      const rawTitle = event.title || "";
      const labelText = (event.label ?? "").toString();
      const labelLower = labelText.trim().toLowerCase();
      const parsed = parseTimelineStepTitle(rawTitle);
      const cleanedRawTitle = stripTrailingEllipsis(rawTitle);
      const activityDetail = event.activityDetail;
      const source = event.source;
      const partType = event.partType;
      const internal = Boolean(event.internal);
      let filePath = event.filePath || activityDetail?.file;
      if (!filePath) {
        filePath =
          extractFilePathFromText(event.meta) ||
          extractFilePathFromText(activityDetail?.command) ||
          extractFilePathFromText(rawTitle);
      }
      if (
        !filePath &&
        /edit|writ|modif|updat|patch/i.test(rawTitle) &&
        fileChanges?.length
      ) {
        filePath = fileChanges[0].file;
      }

      // Extract filename from filePath, but validate it looks like a real filename
      // This prevents arbitrary text like "attachment handling in chat" from being treated as a filename
      const fileName = (() => {
        if (!filePath) return undefined;
        const segments = filePath.split(/[/\\]/);
        const lastSegment = segments.pop();

        // A valid filename should:
        // 1. Have a file extension (contains a dot with extension after it)
        // 2. Not be too long (arbitrary text segments tend to be long)
        // 3. Not have excessive whitespace
        // 4. Not contain special characters that suggest it's not a filename
        const hasExtension = /\.[a-zA-Z0-9]{1,10}$/.test(lastSegment || "");
        const notTooLong = (lastSegment || "").length <= 100;
        const notExcessiveWhitespace = ((lastSegment || "").match(/\s/g) || []).length <= 2;
        const looksLikeFilename = hasExtension && notTooLong && notExcessiveWhitespace;

        return looksLikeFilename ? lastSegment : undefined;
      })();
      const fallbackEdit = Array.isArray(fileChanges)
        ? filePath
          ? fileChanges.find(
            (edit) =>
              normalizePathForMatch(edit?.file) ===
              normalizePathForMatch(filePath),
          )
          : fileChanges[0]
        : undefined;
      const fallbackDiffStats =
        fallbackEdit && fallbackEdit.diffStats &&
          (typeof fallbackEdit.diffStats.added === "number" ||
            typeof fallbackEdit.diffStats.deleted === "number")
          ? {
            added: Math.max(0, Number(fallbackEdit.diffStats.added) || 0),
            deleted: Math.max(0, Number(fallbackEdit.diffStats.deleted) || 0),
          }
          : undefined;
      const detailDiffStats =
        activityDetail?.diffExcerpt &&
          (typeof activityDetail.diffExcerpt.added === "number" ||
            typeof activityDetail.diffExcerpt.deleted === "number")
          ? {
            added: Math.max(0, Number(activityDetail.diffExcerpt.added) || 0),
            deleted: Math.max(0, Number(activityDetail.diffExcerpt.deleted) || 0),
          }
          : undefined;
      const diffStats = event.diffStats || fallbackDiffStats || detailDiffStats;

      const metaText = stripTrailingEllipsis(event.meta);
      const baseSummary = filePath
        ? fileName || filePath
        : activityDetail?.summary ||
        parsed.summary ||
        metaText ||
        (parsed.label === "event" ? cleanedRawTitle : "");
      const normalizedBaseSummary = (baseSummary || "").trim().toLowerCase();
      const fallbackSummaryFromActivity =
        stripTrailingEllipsis(
          activityDetail?.command ||
          activityDetail?.query ||
          activityDetail?.output ||
          event.meta,
        ) || "";
      let summary =
        normalizedBaseSummary === "step" && fallbackSummaryFromActivity
          ? fallbackSummaryFromActivity
          : baseSummary;
      // Filter out metaText if it is a duplicate of the filePath or summary to avoid displaying it in the code block
      const cleanedMetaText =
        metaText &&
        metaText !== filePath &&
        metaText !== summary
          ? metaText
          : undefined;

      const description =
        filePath || parsed.summary || activityDetail?.summary
          ? cleanedMetaText || activityDetail?.command || activityDetail?.query
          : cleanedMetaText && cleanedMetaText !== summary
            ? cleanedMetaText
            : undefined;
      const detail =
        filePath && fileName && filePath !== fileName ? filePath : undefined;
      const viewDiffFile =
        event.status === "done" &&
          (diffStats || /edit|writ|modif|updat|patch/i.test(rawTitle))
          ? filePath || fileChanges?.[0]?.file
          : undefined;
      const metadataFirstLabel =
        stripTrailingEllipsis(
          (activityDetail?.tool || "").toLowerCase() ||
          (activityDetail?.kind || "").toLowerCase() ||
          (partType || "").toLowerCase(),
        ) || parsed.label;
      const normalizedLabelForSummary = metadataFirstLabel.trim().toLowerCase();
      const normalizedSummaryForDisplay = (summary || "").trim().toLowerCase();
      if (
        normalizedLabelForSummary === "tool_call" &&
        (normalizedSummaryForDisplay === "step" ||
          normalizedSummaryForDisplay === "starting step" ||
          normalizedSummaryForDisplay === "finishing step")
      ) {
        const normalizedDescription = (description || "").trim().toLowerCase();
        const hasMeaningfulDescription =
          normalizedDescription.length > 0 &&
          normalizedDescription !== "step" &&
          normalizedDescription !== "starting step" &&
          normalizedDescription !== "finishing step";
        if (hasMeaningfulDescription) {
          summary = description || "";
        } else {
          // Drop low-signal TOOL_CALL placeholders when they have no useful detail.
          continue;
        }
      }

      const cleanedLabel = cleanEventLabel(metadataFirstLabel);
      const normalizedSummary = (summary || cleanedRawTitle || "")
        .trim()
        .toLowerCase();
      const normalizedLabel = cleanedLabel.trim().toLowerCase();

      // Skip filtered events (like starting/finishing)
      if (!cleanedLabel) {
        continue;
      }

      // Suppress low-signal placeholder timeline rows like
      // label=step + summary=step when no concrete activity exists.
      if (
        normalizedLabel === "step" &&
        normalizedSummary === "step" &&
        !filePath &&
        !diffStats &&
        !activityDetail
      ) {
        continue;
      }

      rawEvents.push({
        key: event.key,
        kind: "activity",
        label: cleanedLabel,
        summary: summary || cleanedRawTitle || "Activity update",
        description,
        detail: detail || undefined,
        status: event.status,
        source,
        partType,
        internal,
        filePath,
        callID: event.callID,
        messageID: event.messageID,
        sessionID: event.sessionID || activityDetail?.sessionID,
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        diffStats,
        activityDetail,
        viewDiffFile,
        partID: (event as { partID?: string }).partID,
        isImportant: Boolean(
          event.status === 'error' ||
          (event.status === 'done' && (filePath || diffStats || viewDiffFile)) ||
          cleanedLabel === 'error'
        ),
        updateCount: 1,
      });
    }
  }

  const deduped: DisplayEvent[] = [];
  const dedupedIndexByFingerprint = new Map<string, number>();
  const dedupedIndexByIdentity = new Map<string, number>();
  for (const event of rawEvents) {
    const stableIdentity = firstNonEmptyString(
      event.partID ? `part:${event.partID}` : undefined,
      event.messageID ? `msg:${event.messageID}:${event.kind}` : undefined,
      event.callID ? `call:${event.callID}:${event.kind}` : undefined,
    );
    if (stableIdentity) {
      const existingIdentityIndex = dedupedIndexByIdentity.get(stableIdentity);
      if (typeof existingIdentityIndex === "number") {
        const existing = deduped[existingIdentityIndex];
        const existingPriority = displayEventSourcePriority(existing.source);
        const incomingPriority = displayEventSourcePriority(event.source);
        if (incomingPriority > existingPriority) {
          deduped[existingIdentityIndex] = {
            ...existing,
            ...event,
            updateCount: existing.updateCount + 1,
          };
        } else {
          existing.updateCount += 1;
        }
        continue;
      }
      dedupedIndexByIdentity.set(stableIdentity, deduped.length);
    }

    const fingerprint = displayEventFingerprint(event);
    const existingIndex = dedupedIndexByFingerprint.get(fingerprint);
    if (typeof existingIndex === "number") {
      const existing = deduped[existingIndex];
      const existingPriority = displayEventSourcePriority(existing.source);
      const incomingPriority = displayEventSourcePriority(event.source);
      if (incomingPriority > existingPriority) {
        deduped[existingIndex] = {
          ...existing,
          ...event,
          updateCount: existing.updateCount + 1,
        };
      } else {
        existing.updateCount += 1;
      }
      continue;
    }

    dedupedIndexByFingerprint.set(fingerprint, deduped.length);
    deduped.push({ ...event });
  }

  const collapsed: DisplayEvent[] = deduped;

  return collapsed;
}



export const SystemMessage = memo(function SystemMessage({
  content,
  accentColor = "var(--oc-accent)",
}: {
  content: string;
  accentColor?: string;
}) {
  return (
    <div className="oc-message-enter mb-4">
      <div className="opacity-90 transition-opacity hover:opacity-100">
        <div
          className="mx-auto max-w-full rounded-r-md border-l pr-2"
          style={{
            borderLeftColor: accentColor,
            backgroundColor: `color-mix(in srgb, ${accentColor} 4%, transparent)`,
          }}
        >
          <pre
            className="oc-code max-h-[220px] overflow-y-auto whitespace-pre-wrap break-words py-1 pl-4 pr-2 sm:pl-5"
          >
            {content}
          </pre>
        </div>
      </div>
    </div>
  );
});

export const UserMessage = memo(function UserMessage({ message }: { message?: Message }) {
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const userMessageRef = useRef<HTMLDivElement>(null);
  const rawUserText =
    message?.content ?? message?.text ?? messageBodyFromParts(message?.parts);
  const splitContent = useMemo(() => {
    const withoutAttachmentEcho = stripHydratedAttachmentEcho(
      typeof rawUserText === "string" ? rawUserText : "",
      message,
    );
    const withoutGenericFenceEcho =
      stripGenericHydratedAttachmentFence(withoutAttachmentEcho);
    return splitInjectedSystemPromptFromUserText(withoutGenericFenceEcho);
  }, [message, rawUserText]);
  const content = splitContent.userText;
  const injectedSystemText = splitContent.systemText;
  const explicitFileChips = (message?.parts ?? [])
    .filter(isExplicitFileAttachmentPart)
    .map((part) => part.filename ?? part.source?.path)
    .filter((value): value is string => !!value);
  const inferredFileChips = inferAttachmentPathsFromHydratedUserText(
    typeof rawUserText === "string" ? rawUserText : "",
  );
  const fileChips = Array.from(new Set([...explicitFileChips, ...inferredFileChips]));
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

  const handleCopy = async () => {
    const textToCopy = content?.trim() || rawUserText?.trim() || "";
    if (!textToCopy) return;

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
      return;
    } catch {
      vscode.postMessage({ type: "copyToClipboard", text: textToCopy });
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };

  if (!message) return null;

  if (isPlanProceedMessageContent(content)) {
    return (
    <div className="oc-message-enter mb-3.5 px-4 flex justify-end">
        <div className="flex w-fit max-w-[78%] flex-col items-end gap-2">
          <div className="oc-plan-approved-badge flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-oc-xs">
            <Check className="h-3.5 w-3.5" />
            <span className="font-medium">Plan Approved</span>
          </div>
        </div>
      </div>
    );
  }


  if (!content && !hasImages && !injectedSystemText) {
    return null;
  }

  return (
      <div className="oc-message-enter mb-3.5 flex flex-col gap-1.5 px-4">
      {(content || hasImages) ? (
        <div className="flex items-end justify-end gap-1.5">
          <div className="w-fit max-w-[78%]">
            <div className="oc-msg-user" ref={userMessageRef}>
              <div className="whitespace-pre-wrap text-xs leading-relaxed">
                {content && (() => {
                  const match = content.match(/^(\/[a-zA-Z0-9_-]+)(.*)$/s);
                  if (match) {
                    return (
                      <>
                        <span className="oc-readable-accent font-medium">{match[1]}</span>
                        {renderHighlightedText(match[2])}
                      </>
                    );
                  }
                  return renderHighlightedText(content);
                })()}
              </div>
              {hasImages && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {(message.images ?? []).map((src: string, index: number) => (
                    <button
                      key={src}
                      type="button"
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-oc-border bg-oc-panel-soft px-2.5 py-1 text-[10px] font-medium text-oc-text-soft transition-colors hover:bg-oc-bg-soft"
                      onClick={() => setPreviewImageSrc(src)}
                      title="Preview image attachment"
                    >
                      <img
                        src={src}
                        alt={`attachment image ${index + 1}`}
                        className="h-3.5 w-3.5 rounded-sm border border-oc-border-soft object-cover shrink-0"
                      />
                      <span className="truncate">image-{index + 1}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-1 flex items-center justify-end gap-1.5">
              {(() => {
                const ts = formatMessageTime(getMessageTimestamp(message));
                return ts ? (
                  <span className="oc-text-secondary text-[10px] tabular-nums opacity-70">
                    {ts}
                  </span>
                ) : null;
              })()}
              <button
                type="button"
                className={cn("oc-bubble-copy-btn h-7 w-7", copied && "is-copied")}
                onClick={handleCopy}
                title="Copy message"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-oc-green" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {injectedSystemText ? (
        <SystemMessage content={injectedSystemText} />
      ) : null}
      <ImagePreviewModal
        isOpen={previewImageSrc !== null}
        imageSrc={previewImageSrc}
        imageAlt="Message image"
        title="Image Preview"
        onClose={() => setPreviewImageSrc(null)}
      />
    </div>
  );
});

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

  const rawInfoRec = rawResponseInfoRecordForUi(message.rawResponse);
  const rawTokens = asRecord(rawInfoRec?.tokens);
  if (rawTokens) {
    const rawCache = asRecord(rawTokens.cache);
    return {
      input: typeof rawTokens.input === "number" ? rawTokens.input : undefined,
      output: typeof rawTokens.output === "number" ? rawTokens.output : undefined,
      reasoning:
        typeof rawTokens.reasoning === "number" ? rawTokens.reasoning : undefined,
      cache: rawCache
        ? {
            read: typeof rawCache.read === "number" ? rawCache.read : undefined,
            write: typeof rawCache.write === "number" ? rawCache.write : undefined,
          }
        : undefined,
    };
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

  const rawInfoRec = rawResponseInfoRecordForUi(message.rawResponse);
  const rawTimeRec = asRecord(rawInfoRec?.time);
  if (
    typeof rawTimeRec?.created === "number" &&
    typeof rawTimeRec?.completed === "number" &&
    rawTimeRec.completed >= rawTimeRec.created
  ) {
    return (rawTimeRec.completed - rawTimeRec.created) / 1000;
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

function getThinkingVariant(
  message: Message | undefined,
  streaming: StreamingState | undefined,
): string | undefined {
  if (streaming?.variant && typeof streaming.variant === "string") {
    return streaming.variant;
  }

  if (message?.info && "variant" in message.info) {
    const variant = (message.info as Record<string, unknown>).variant;
    if (typeof variant === "string" && variant) {
      return variant;
    }
  }

  if (message && "variant" in message) {
    const variant = (message as Record<string, unknown>).variant;
    if (typeof variant === "string" && variant) {
      return variant;
    }
  }

  return undefined;
}

function messageModelSupportsThinking(
  message: Message | undefined,
  streaming: StreamingState | undefined,
  availableModels: Model[],
): boolean {
  let providerID: string | undefined;
  let modelID: string | undefined;

  if (streaming?.isActive) {
    providerID = streaming.providerID;
    modelID = streaming.modelID;
  }

  if (!providerID || !modelID) {
    if (message?.info) {
      const info = message.info as Record<string, unknown>;
      const infoModel = info.model as Record<string, string> | undefined;
      providerID = providerID ?? infoModel?.providerID ?? info.providerID as string;
      modelID = modelID ?? infoModel?.modelID ?? info.modelID as string;
    }
  }

  if (!providerID || !modelID) {
    providerID = providerID ?? message?.providerID;
    modelID = modelID ?? message?.modelID;
  }

  if (!providerID || !modelID) {
    const msgModel = message?.model;
    if (msgModel) {
      providerID = providerID ?? msgModel.providerID;
      modelID = modelID ?? msgModel.modelID;
    }
  }

  if (!providerID || !modelID) return false;

  const match = availableModels.find(
    (m) => m.providerID === providerID && m.modelID === modelID,
  );
  return Boolean(match && (match.reasoning || (match.variants && match.variants.length > 0)));
}

function formatThinkingVariantLabel(variant: string): string {
  const trimmed = variant.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

type AssistantTurnMetadata = {
  agent?: string;
  modelID?: string;
  providerID?: string;
  variant?: string;
};

function getAssistantTurnMetadataFromCentralizedEvents(
  rawSdkEventPayloads: unknown[] | undefined,
): AssistantTurnMetadata {
  const metadata: AssistantTurnMetadata = {};

  if (!Array.isArray(rawSdkEventPayloads)) {
    return metadata;
  }

  for (const payload of rawSdkEventPayloads) {
    const record = asRecord(payload);
    if (!record) continue;

    const payloadType = asString(record.type);
    const syncEvent = asRecord(record.syncEvent);
    const syncType = asString(syncEvent?.type);
    const normalizedType = syncType || payloadType;
    const properties = asRecord(record.properties);
    const syncData = asRecord(syncEvent?.data);

    if (
      normalizedType === "session.next.agent.switched" ||
      normalizedType === "session.next.agent.switched.1"
    ) {
      const agent =
        asString(properties?.agent) ||
        asString(syncData?.agent);
      if (agent) {
        metadata.agent = agent;
      }
      continue;
    }

    if (
      normalizedType === "session.next.model.switched" ||
      normalizedType === "session.next.model.switched.1"
    ) {
      const model =
        asRecord(properties?.model) ||
        asRecord(syncData?.model);
      const modelID =
        asString(model?.modelID) ||
        asString(model?.id);
      const providerID = asString(model?.providerID);
      const variant = asString(model?.variant);

      if (modelID) metadata.modelID = modelID;
      if (providerID) metadata.providerID = providerID;
      if (variant) metadata.variant = variant;
    }
  }

  return metadata;
}

function getCentralizedEventInfo(payload: unknown): Record<string, unknown> | null {
  const event = asRecord(payload);
  if (!event) {
    return null;
  }

  const payloadSyncInfo = asRecord(
    asRecord(asRecord(event.payload)?.syncEvent)?.data?.info,
  );
  if (payloadSyncInfo) {
    return payloadSyncInfo;
  }

  const syncInfo = asRecord(asRecord(event.syncEvent)?.data?.info);
  if (syncInfo) {
    return syncInfo;
  }

  const propertiesInfo = asRecord(asRecord(event.properties)?.info);
  if (propertiesInfo) {
    return propertiesInfo;
  }

  return asRecord(event.info);
}

function collectCentralizedTurnMessageIds(
  rawSdkEventPayloads: unknown[] | undefined,
  rootMessageId: string | null,
): Set<string> {
  const scopedIds = new Set<string>();
  const normalizedRootId = (rootMessageId || "").trim();
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0 || !normalizedRootId) {
    return scopedIds;
  }

  const childrenByParent = new Map<string, Set<string>>();

  for (const payload of rawSdkEventPayloads) {
    const record = asRecord(payload);
    if (!record) continue;

    const part = getCentralizedEventPart(record);
    const info = getCentralizedEventInfo(record);
    const messageId =
      firstNonEmptyString(
        asString(info?.id),
        asString(info?.messageID),
        asString(info?.messageId),
        asString(part?.messageID),
        asString(part?.messageId),
        asString(record.messageID),
        asString(record.messageId),
      ) || "";
    const parentMessageId =
      firstNonEmptyString(
        asString(info?.parentID),
        asString(info?.parentId),
        asString(part?.parentMessageId),
        asString(part?.parentMessageID),
        asString(record.parentID),
        asString(record.parentId),
      ) || "";

    if (messageId && parentMessageId) {
      const existing = childrenByParent.get(parentMessageId) ?? new Set<string>();
      existing.add(messageId);
      childrenByParent.set(parentMessageId, existing);
    }
  }

  const queue: string[] = [normalizedRootId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (scopedIds.has(currentId)) {
      continue;
    }
    scopedIds.add(currentId);

    const children = childrenByParent.get(currentId);
    if (!children) {
      continue;
    }

    for (const childId of children) {
      if (!scopedIds.has(childId)) {
        queue.push(childId);
      }
    }
  }

  return scopedIds;
}

function AssistantResponseCardInner({
  message,
  streaming,
  hideLoadingText = false,
  isContiguous,
  interactiveEvents,
  messages,
  currentSessionId,
  hideFileChangesSection,
  subagentsByParentMessageId,
  subagentDetailsById,
  availableAgents,
  todoItems = [],
}: {
  message?: Message;
  streaming?: StreamingState;
  hideLoadingText?: boolean;
  isContiguous?: boolean;
  interactiveEvents?: AppState["interactiveEvents"];
  messages?: Message[];
  currentSessionId?: AppState["currentSessionId"];
  hideFileChangesSection?: boolean;
  subagentsByParentMessageId?: AppState["subagentsByParentMessageId"];
  subagentDetailsById?: AppState["subagentDetailsById"];
  availableAgents?: AppState["availableAgents"];
  todoItems?: AppState["todoItems"];
}) {
  const dispatch = useAppDispatch();
  const {
    assistantTurnPending,
    assistantTurnMessageId,
    availableModels,
    streamingBySessionId,
    rawSdkEventPayloadsBySessionId,
  } = useAppState();
  const [showSubagents, setShowSubagents] = useState(true);
  const [showAllSubagents, setShowAllSubagents] = useState(false);
  const [showTodoChecklist, setShowTodoChecklist] = useState(true);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [copiedDebugPanel, setCopiedDebugPanel] = useState<"sdk" | "centralized" | null>(null);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const messageBodyRef = useRef<HTMLDivElement>(null);
  const progressTimelineRef = useRef<HTMLDivElement>(null);
  const requestedSubagentConversationRef = useRef<Set<string>>(new Set());
  const activityTimelineMessage = message;
  const activityTimelineStreaming =
    streaming ?? (currentSessionId ? streamingBySessionId?.[currentSessionId] : undefined);
  const assistantMessageId =
    message?.info?.id ||
    message?.id ||
    assistantTurnMessageId ||
    activityTimelineStreaming?.messageId ||
    null;
  const sdkDebugData = useMemo(() => {
    if (!config.debug.showSdkDebug) return null;
    const sdkPayloads =
      message?.rawSdkEventPayloads ??
      activityTimelineStreaming?.rawSdkEventPayloads ??
      [];
    return {
      streamEventPayloads: sdkPayloads.length > 0 ? sdkPayloads : undefined,
      rawResponse: message?.rawResponse,
      payloadCount: sdkPayloads.length,
    };
  }, [message, activityTimelineStreaming, config.debug.showSdkDebug]);
  const centralizedRawResponse = message?.rawResponse;
  const centralizedMessageRec = asRecord(activityTimelineMessage);
  const centralizedMessageInfoRec = asRecord(centralizedMessageRec?.info);
  const centralizedSessionId =
    currentSessionId ||
    asString(centralizedMessageInfoRec?.sessionID) ||
    asString(centralizedMessageInfoRec?.sessionId) ||
    asString(centralizedMessageRec?.sessionID) ||
    asString(centralizedMessageRec?.sessionId) ||
    null;
  const sessionScopedRawSdkEventPayloads = useMemo(() => {
    if (!centralizedSessionId) {
      return [];
    }

    return Array.isArray(rawSdkEventPayloadsBySessionId?.[centralizedSessionId])
      ? rawSdkEventPayloadsBySessionId[centralizedSessionId]
      : [];
  }, [centralizedSessionId, rawSdkEventPayloadsBySessionId]);
  const hasCentralizedPendingAssistantReply = useMemo(
    () => hasActiveAssistantReplyInCentralizedTape(sessionScopedRawSdkEventPayloads),
    [sessionScopedRawSdkEventPayloads],
  );
  const isLiveAssistantTurn = !!(
    activityTimelineStreaming?.isActive ||
    assistantTurnPending ||
    hasCentralizedPendingAssistantReply
  );
  const assistantTurnRootMessageId = firstNonEmptyString(
    assistantMessageId,
    activityTimelineStreaming?.messageId,
    assistantTurnMessageId,
    !isLiveAssistantTurn
      ? latestAssistantMessageIdFromCentralizedTape(sessionScopedRawSdkEventPayloads)
      : null,
  ) || null;
  const assistantScopeMessageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const candidate of [
      assistantMessageId,
      activityTimelineStreaming?.messageId,
      assistantTurnMessageId,
      assistantTurnRootMessageId,
    ]) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        ids.add(candidate.trim());
      }
    }

    for (const candidate of collectMessageIdentityCandidates(message)) {
      ids.add(candidate);
    }

    return ids;
  }, [
    assistantMessageId,
    activityTimelineStreaming?.messageId,
    assistantTurnMessageId,
    assistantTurnRootMessageId,
    message,
  ]);
  const assistantTurnMessageIds = useMemo(() => {
    const ids = collectAssistantTurnMessageIds(messages, assistantTurnRootMessageId);
    for (const id of collectCentralizedTurnMessageIds(sessionScopedRawSdkEventPayloads, assistantTurnRootMessageId)) {
      ids.add(id);
    }
    return ids;
  }, [messages, assistantTurnRootMessageId, sessionScopedRawSdkEventPayloads]);
  const centralizedRawSdkEventPayloads = useMemo(() => {
    if (assistantTurnMessageIds.size === 0 && assistantScopeMessageIds.size === 0) {
      return [];
    }

    return sessionScopedRawSdkEventPayloads.filter((payload) => {
      const rec = asRecord(payload);
      if (!rec) return false;

      // Use the shared centralized part extractor so we cover both raw shapes:
      // - direct `properties.part`
      // - wrapped `payload.syncEvent.data.part` / `syncEvent.data.part`
      //
      // This keeps sync-only tool updates and later turn events from being
      // dropped before they reach the assistant response timeline.
      const part = getCentralizedEventPart(rec);
      const info = getCentralizedEventInfo(rec);
      const msgId =
        firstNonEmptyString(
          asString(info?.id),
          asString(info?.messageID),
          asString(info?.messageId),
          asString(part?.messageID),
          asString(part?.messageId),
        ) || "";

      if (!msgId) return false;
      if (assistantScopeMessageIds.has(msgId)) {
        return true;
      }
      return assistantTurnMessageIds.has(msgId);
    });
  }, [assistantScopeMessageIds, assistantTurnMessageIds, sessionScopedRawSdkEventPayloads]);
  const scopedActivityTimelineStreaming = useMemo(() => {
    if (!activityTimelineStreaming) {
      return undefined;
    }

    const streamingMessageId = asString(activityTimelineStreaming.messageId).trim();
    if (!assistantMessageId) {
      return activityTimelineStreaming;
    }
    if (!streamingMessageId) {
      // Keep legacy or incomplete streaming snapshots only when we cannot
      // identify the owning message yet. Once a message ID is present, the
      // stream must match the current assistant turn to avoid leaking the
      // previous turn’s live steps into the new card.
      return activityTimelineStreaming;
    }

    return streamingMessageId === assistantMessageId ? activityTimelineStreaming : undefined;
  }, [activityTimelineStreaming, assistantMessageId]);
  const turnMetadata = useMemo(
    () =>
      getAssistantTurnMetadataFromCentralizedEvents(
        sessionScopedRawSdkEventPayloads,
      ),
    [sessionScopedRawSdkEventPayloads],
  );
  // Normalize the centralized tape once at the boundary so downstream helpers
  // only see a single event shape, regardless of whether the original entry was
  // stored as `properties.part` or `payload.syncEvent.data.part`.
  const normalizedCentralizedRawSdkEventPayloads = useMemo(
    () => normalizeCentralizedEventPayloads(centralizedRawSdkEventPayloads),
    [centralizedRawSdkEventPayloads],
  );
  const activityTimelineRawEventParts = useMemo(() => {
    return rawMessagePartsFromRawSdkEventPayloads(normalizedCentralizedRawSdkEventPayloads);
  }, [normalizedCentralizedRawSdkEventPayloads]);
  const cardMessage = activityTimelineMessage;
  const rawContentChunks = useMemo(
    () =>
      getCentralizedAssistantContentChunksFromRawSdkEventPayloads(
        normalizedCentralizedRawSdkEventPayloads,
      ),
    [normalizedCentralizedRawSdkEventPayloads],
  );
  const rawContent = rawContentChunks.join("");
  const stickyStreamingContentRef = useRef<{
    messageId: string | null;
    content: string;
  }>({ messageId: null, content: "" });
  const activeStreamingMessageId =
    scopedActivityTimelineStreaming?.messageId || assistantMessageId;
  if (stickyStreamingContentRef.current.messageId !== activeStreamingMessageId) {
    stickyStreamingContentRef.current = {
      messageId: activeStreamingMessageId,
      content: "",
    };
  }
  if (scopedActivityTimelineStreaming?.isActive && rawContent.trim().length > 0) {
    stickyStreamingContentRef.current.content = rawContent;
  }
  const content =
    scopedActivityTimelineStreaming?.isActive && rawContent.trim().length === 0
      ? stickyStreamingContentRef.current.content
      : rawContent;
  const hasAssistantFinishSignal =
    scopedActivityTimelineStreaming?.hasAssistantFinishSignal === true;
  const hasActiveReasoningPart = scopedActivityTimelineStreaming?.inReasoningPart === true;
  const hasTerminalStepSignal =
    scopedActivityTimelineStreaming?.hasTerminalStepSignal === true;
  const resolvedContentChunks =
    rawContentChunks.length > 0
      ? rawContentChunks
      : content.trim().length > 0
        ? [content]
        : [];
  const resolvedContent = resolvedContentChunks.join("");
  const isStreamingActive = !!scopedActivityTimelineStreaming?.isActive;
  const finalizedThoughtItems = useMemo(
    () => thoughtItemsFromRawEventPayloads(normalizedCentralizedRawSdkEventPayloads),
    [normalizedCentralizedRawSdkEventPayloads],
  );
  const liveThoughtItems = useMemo(
    () =>
      thoughtItemsFromStreamingReasoningEvents(
        scopedActivityTimelineStreaming?.reasoningEvents,
        scopedActivityTimelineStreaming?.isActive === true,
      ),
    [scopedActivityTimelineStreaming?.reasoningEvents, scopedActivityTimelineStreaming?.isActive],
  );
  const thoughtItems = useMemo(
    () => mergeThoughtItemsForTimeline(finalizedThoughtItems, liveThoughtItems, isStreamingActive),
    [finalizedThoughtItems, liveThoughtItems, isStreamingActive],
  );
  const progressItems = useMemo(
    () => {
      return progressItemsFromCentralizedData(normalizedCentralizedRawSdkEventPayloads);
    },
    [normalizedCentralizedRawSdkEventPayloads],
  );
  const liveProgressItems = useMemo(
    () =>
      progressItemsFromSteps(
        [
          ...(Array.isArray(scopedActivityTimelineStreaming?.progressEvents)
            ? scopedActivityTimelineStreaming.progressEvents
            : []),
          ...(Array.isArray(scopedActivityTimelineStreaming?.steps)
            ? scopedActivityTimelineStreaming.steps
            : []),
        ],
        "stream",
      ),
    [scopedActivityTimelineStreaming?.progressEvents, scopedActivityTimelineStreaming?.steps],
  );
  const mergedProgressItems = useMemo(
    () => mergeProgressItemsForTimeline(progressItems, liveProgressItems, isStreamingActive),
    [progressItems, liveProgressItems, isStreamingActive],
  );
  const commentaryItems = useMemo(
    () => {
      return commentaryItemsFromRawEventPayloads(normalizedCentralizedRawSdkEventPayloads);
    },
    [normalizedCentralizedRawSdkEventPayloads],
  );

  /** Unified chronological list of timeline blocks to render. */
  const timelineBlocks = useMemo<TimelineBlock[]>(() => {
    return buildTimeline(
      thoughtItems,
      mergedProgressItems,
      commentaryItems,
      resolvedContentChunks.join(""),
      activityTimelineRawEventParts as MessagePart[],
  );
  }, [thoughtItems, mergedProgressItems, commentaryItems, resolvedContentChunks, activityTimelineRawEventParts]);
  
  const structured = useMemo(
    () => structuredOutputFromRawSdkEventPayloads(normalizedCentralizedRawSdkEventPayloads),
    [normalizedCentralizedRawSdkEventPayloads]
  );
  const responseType = (structured?.type ?? structured?.responseType)?.toLowerCase();
  const plan = structured?.plan;
  const fileChanges = structured?.fileChanges;

  // Message-scoped rendering depends on this ID. Keep it above every memo that
  // filters timeline rows so React never evaluates a useMemo while `messageId`
  // is still in the temporal-dead-zone.
  const info = activityTimelineMessage?.info;
  const messageRec = asRecord(activityTimelineMessage);
  const infoRec = asRecord(messageRec?.info);
  const messageId =
    assistantMessageId ||
    (activityTimelineMessage as any)?.messageId ||
    (info as any)?.messageId ||
    null;
  
  const displayEvents = useMemo(
    () => {
      const events = buildDisplayEvents(
        timelineBlocks,
        fileChanges,
        isStreamingActive,
        assistantTurnPending,
        messageId,
      );
      // Debug: Log all display events with read/edit labels
      const readEditEvents = events.filter(e => e.label.toLowerCase() === 'read' || e.label.toLowerCase() === 'edit');
      if (readEditEvents.length > 0) {
        console.log('[DEBUG] DisplayEvents with read/edit labels:', {
          count: readEditEvents.length,
          events: readEditEvents.map(e => ({
            label: e.label,
            summary: e.summary,
            hasActivityDetail: !!e.activityDetail,
            hasOutput: !!e.activityDetail?.output,
            outputLength: e.activityDetail?.output?.length || 0,
            hasDiffExcerpt: !!e.activityDetail?.diffExcerpt,
            diffLines: e.activityDetail?.diffExcerpt?.lines?.length || 0,
          }))
        });
      }
      return events;
    },
    [timelineBlocks, fileChanges, isStreamingActive, assistantTurnPending, messageId],
  );
  // Centralized debug is the long-term source of truth for this assistant turn.
  // Keep it raw and complete so future UI rendering can consume the same data
  // without depending on derived display-only transforms.
  const centralizedDebugData = useMemo<CentralizedDebugData>(() => {
    if (!config.debug.showCentralizedDebug) {
      return {};
    }

    const rawEventStream: CentralizedDebugSourceData = {
      sessionId: centralizedSessionId ?? currentSessionId ?? undefined,
      rawSdkEventPayloads: centralizedRawSdkEventPayloads,
    };

    // Keep the debug panel mounted even before the assistant responds so the
    // raw session tape can grow in-place as soon as the first event lands.
    return {
      rawEventStream,
    };
  }, [
    centralizedRawSdkEventPayloads,
    centralizedSessionId,
    currentSessionId,
    config.debug.showCentralizedDebug,
  ]);
  const hasPendingReasoningDisplayEvent = useMemo(
    () =>
      displayEvents.some(
        (event) => event.kind === "reasoning" && event.status === "pending",
      ),
    [displayEvents],
  );
  useEffect(() => {
    const rawEvents = normalizedCentralizedRawSdkEventPayloads;
    const rawSamples = rawEvents
      .slice(Math.max(0, rawEvents.length - 12))
      .map((event, index) =>
        summarizeCentralizedEventForTimelineDiagnostics(
          event,
          rawEvents.length - Math.min(rawEvents.length, 12) + index,
        ),
      );
    const progressItemsForOtherMessages = messageId
      ? progressItems.filter(
          (item) => item.messageID && item.messageID !== messageId,
        )
      : [];
    const displayEventsForOtherMessages = messageId
      ? displayEvents.filter(
          (event) => event.messageID && event.messageID !== messageId,
        )
      : [];

    logger.info(`${ACTIVITY_TIMELINE_DIAGNOSTIC_LOG} render_flow`, {
      currentMessageId: messageId,
      assistantMessageId,
      rawEventCount: rawEvents.length,
      rawSamples,
      progressItemCount: progressItems.length,
      progressSamples: progressItems
        .slice(0, 12)
        .map((item, index) => summarizeProgressItemForTimelineDiagnostics(item, index)),
      progressItemsForOtherMessages: progressItemsForOtherMessages
        .slice(0, 8)
        .map((item, index) => summarizeProgressItemForTimelineDiagnostics(item, index)),
      thoughtItemCount: thoughtItems.length,
      commentaryItemCount: commentaryItems.length,
      timelineBlocks: timelineBlocks.map((block, index) => {
        if (block.kind === "steps") {
          return { index, kind: block.kind, count: block.items.length };
        }
        if (block.kind === "thinking") {
          return { index, kind: block.kind, count: block.items.length };
        }
        if (block.kind === "commentary") {
          return {
            index,
            kind: block.kind,
            messageID: block.messageID,
            textLength: block.text.length,
          };
        }
        return { index, kind: block.kind, htmlLength: block.html.length };
      }),
      displayEventCount: displayEvents.length,
      displaySamples: displayEvents
        .slice(0, 12)
        .map((event, index) => summarizeDisplayEventForTimelineDiagnostics(event, index)),
      displayEventsForOtherMessages: displayEventsForOtherMessages
        .slice(0, 8)
        .map((event, index) => summarizeDisplayEventForTimelineDiagnostics(event, index)),
    });
  }, [
    assistantMessageId,
    commentaryItems,
    displayEvents,
    messageId,
    normalizedCentralizedRawSdkEventPayloads,
    progressItems,
    thoughtItems,
    timelineBlocks,
  ]);
  const shouldShowFileChanges = useMemo(() => {
    // Implementation plan turns already surface their own plan card, so the
    // aggregated diff section would just duplicate the same turn.
    if (plan?.file) {
      return false;
    }

    if (!Array.isArray(fileChanges) || fileChanges.length === 0) {
      return false;
    }

    const ownFiles = new Set(
      fileChanges.map(c => normalizeFileChangePathForComparison(c.file)).filter((f): f is string => !!f)
    );

    if (ownFiles.size === 0) {
      return true;
    }

    const ownIndex = (messages || []).findIndex(
      (candidate) =>
        candidate === message ||
        (!!messageId && (candidate.info?.id === messageId || candidate.id === messageId)),
    );
    
    // Evaluate our richness using the structured data
    let ownRichness = 1;
    if (fileChanges.some(c => c.diffExcerpt?.lines?.length)) {
      ownRichness += 2;
    }

    return !(messages || []).some((candidate, index) => {
      if (candidate === message) {
        return false;
      }
      
      const candidateStructured = structuredOutputFromRawSdkEventPayloads(candidate.rawSdkEventPayloads);
      const candidateChanges = candidateStructured?.fileChanges;
      
      if (!Array.isArray(candidateChanges) || candidateChanges.length === 0) {
        return false;
      }
      
      const candidateFiles = new Set(
        candidateChanges.map(c => normalizeFileChangePathForComparison(c.file)).filter((f): f is string => !!f)
      );
      
      if (!isFileChangeSubset(ownFiles, candidateFiles)) {
        return false;
      }
      
      let candidateRichness = 1;
      if (candidateChanges.some(c => c.diffExcerpt?.lines?.length)) {
        candidateRichness += 2;
      }
      
      if (candidateRichness > ownRichness) {
        return true;
      }
      return candidateRichness === ownRichness && ownIndex >= 0 && index > ownIndex;
    });
  }, [fileChanges, plan?.file, messageId, messages, message]);

  const shouldShowPlanCard = useMemo(() => {
    if (responseType !== "implementation_plan" || !plan) {
      return false;
    }

    if (!plan?.file) {
      return true;
    }

    const ownIndex = (messages || []).findIndex(
      (candidate) =>
        candidate === message ||
        (!!messageId && (candidate.info?.id === messageId || candidate.id === messageId)),
    );
    if (ownIndex < 0) {
      return true;
    }

    const matchingPlanIndexes = (messages || [])
      .map((candidate, index) => {
        const candidateStructured = structuredOutputFromRawSdkEventPayloads(candidate.rawSdkEventPayloads);
        const candidatePlanFile = candidateStructured?.plan?.file || "";
        return areLikelySamePlanFilePath(candidatePlanFile, plan.file) ? index : -1;
      })
      .filter((index) => index >= 0);

    if (matchingPlanIndexes.length === 0) {
      return true;
    }

    const lastMatchingPlanIndex = Math.max(...matchingPlanIndexes);
    return ownIndex === lastMatchingPlanIndex;
  }, [responseType, plan, messageId, messages, message]);

  const latestAssistantMessageId = useMemo(() => {
    if (!Array.isArray(messages)) return undefined;
    for (let index = (messages || []).length - 1; index >= 0; index--) {
      const candidate = (messages || [])[index];
      const role = candidate.role ?? candidate.info?.role ?? "user";
      if (role === "assistant") {
        return candidate.info?.id ?? candidate.id;
      }
    }
    return undefined;
  }, [messages]);
  const isLatestAssistantMessage =
    !!messageId && latestAssistantMessageId === messageId;
  const [viewState, setViewState] = useState<MessageViewState>({
    showActivityDetails: false,
    showThinkingDetails: false,
    showInternalActivity: false,
    expandedReasoningSteps: new Set<string>(),
  });
  // The centralized event tape is the source of truth for ordering. Do not
  // pin streaming-only reasoning blocks or other migration artifacts to the
  // end of the timeline, because that can duplicate or reorder the final turn.
  const visibleDisplayEvents = displayEvents;
  // Keep internal events in the primary timeline too. The centralized tape is
  // the source of truth, and silently hiding `internal` rows was causing valid
  // activity steps to disappear during hydration/turn transitions.
  const userFacingDisplayEvents = visibleDisplayEvents;
  const internalDisplayEvents = visibleDisplayEvents.filter(
    (event) => event.internal,
  );
  let timelineDisplayEvents = visibleDisplayEvents;

  const timelineDisplayEventGroups = useMemo(() => {
    const groups: Array<{ type: "activity", events: DisplayEvent[] } | { type: "commentary", event: DisplayEvent }> = [];
    let currentActivity: DisplayEvent[] = [];

    for (const event of timelineDisplayEvents) {
      // Assistant response text already renders in the dedicated response card
      // above the timeline. Keep it out of the timeline groups so the same
      // final answer cannot appear twice when the centralized tape contains
      // both the response body and its mirrored commentary chunk.
      if (event.kind === "commentary" && event.label === "Assistant Response") {
        continue;
      }
      if (event.kind === "commentary") {
        if (currentActivity.length > 0) {
          groups.push({ type: "activity", events: currentActivity });
          currentActivity = [];
        }
        groups.push({ type: "commentary", event });
      } else {
        currentActivity.push(event);
      }
    }
    if (currentActivity.length > 0) {
      groups.push({ type: "activity", events: currentActivity });
    }
    return groups;
  }, [timelineDisplayEvents]);

  const activityStatusCounts = useMemo(
    () =>
      userFacingDisplayEvents.reduce(
        (acc, event) => {
          if (event.status === "error") acc.error += 1;
          else if (event.status === "done") acc.done += 1;
          else acc.pending += 1;
          return acc;
        },
        { pending: 0, done: 0, error: 0 },
      ),
    [userFacingDisplayEvents],
  );
  const scopedTodoItems = useMemo(() => {
    if (!Array.isArray(todoItems) || todoItems.length === 0) {
      return [];
    }
    if (!messageId) {
      return [];
    }
    const activeSessionId = currentSessionId;
    const sessionScopedTodoItems = activeSessionId
      ? todoItems.filter((item) => item.sessionId === activeSessionId)
      : todoItems;
    const hasAnyScopedTodo = sessionScopedTodoItems.some((item) => !!item.parentMessageId);
    const messageIdentityCandidates = collectMessageIdentityCandidates(message);
    const strict = sessionScopedTodoItems.filter((item) => {
      if (!item.parentMessageId) {
        return false;
      }
      return messageIdentityCandidates.has(item.parentMessageId);
    });
    if (strict.length > 0) {
      return strict;
    }
    // Orphan mapped todos: todos whose parentMessageId references an assistant
    // message that no longer exists in the rendered list (e.g. compacted away
    // or stale ID format). Show these ONLY on the latest assistant message AND
    // only if no other assistant message already owns them via strict matching.
    const assistantMessageIdentitySet = new Set<string>();
    for (const candidate of messages || []) {
      const role = candidate.role ?? candidate.info?.role ?? "user";
      if (role !== "assistant") {
        continue;
      }
      const ids = collectMessageIdentityCandidates(candidate);
      for (const id of ids) {
        assistantMessageIdentitySet.add(id);
      }
    }
    const orphanMappedTodos = sessionScopedTodoItems.filter(
      (item) =>
        !!item.parentMessageId &&
        !assistantMessageIdentitySet.has(item.parentMessageId),
    );
    if (orphanMappedTodos.length > 0 && isLatestAssistantMessage) {
      // Only claim orphan todos if no other message in the conversation
      // strictly owns any todo. Prevents orphans from bleeding into
      // unrelated messages when the owning message still exists but
      // uses a different ID variant.
      const anyStrictMatch = sessionScopedTodoItems.some(
        (item) =>
          !!item.parentMessageId &&
          assistantMessageIdentitySet.has(item.parentMessageId),
      );
      if (!anyStrictMatch) {
        return orphanMappedTodos;
      }
    }
    // Live-stream safety: if todos have not been stamped with parentMessageId yet,
    // keep showing them on the currently streaming assistant message only.
    if (
      !hasAnyScopedTodo &&
      isStreamingActive &&
      latestAssistantMessageId === messageId
    ) {
      return sessionScopedTodoItems.filter((item) => !item.parentMessageId);
    }
    // Hydration safety: if snapshot todos are session-scoped but unstamped,
    // only show them on the latest assistant message when there is no active
    // streaming (which already handles unstamped todos above). Unstamped
    // todos are shown on the latest assistant message ONLY if no other
    // assistant message has strict ownership of any todo in this session.
    if (!hasAnyScopedTodo && isLatestAssistantMessage) {
      const anyStrictMatchInSession = sessionScopedTodoItems.some(
        (item) =>
          !!item.parentMessageId &&
          assistantMessageIdentitySet.has(item.parentMessageId),
      );
      if (!anyStrictMatchInSession) {
        return sessionScopedTodoItems.filter((item) => !item.parentMessageId);
      }
    }
    return [];
  }, [
    todoItems,
    messageId,
    isStreamingActive,
    latestAssistantMessageId,
    currentSessionId,
    messages,
    isLatestAssistantMessage,
    message,
  ]);
  const shouldShowTodoInlineSummary = scopedTodoItems.length > 0;
  const { planStatus, isRevisedPlan } = useMemo(() => {
    let status: "Draft" | "Executing" | "Revision Requested" | undefined;
    let revised = false;

    if (plan) {
      status = "Draft"; // Default
      const targetPlanFile = typeof plan.file === "string" ? plan.file : "";
      const msgIndex = (messages || []).findIndex(
        (m: any) => m === message || (messageId && (m.info?.id === messageId || m.id === messageId))
      );

      if (msgIndex !== -1) {
        const matchingPlanIndexes = (messages || [])
          .map((candidate, index) => {
            const candidateStructured = structuredOutputFromRawSdkEventPayloads(candidate.rawSdkEventPayloads);
            const candidatePlanFile = candidateStructured?.plan?.file || "";
            return areLikelySamePlanFilePath(candidatePlanFile, targetPlanFile) ? index : -1;
          })
          .filter((index) => index >= 0);
        const firstMatchingPlanIndex =
          matchingPlanIndexes.length > 0 ? Math.min(...matchingPlanIndexes) : msgIndex;
        const lastMatchingPlanIndex =
          matchingPlanIndexes.length > 0 ? Math.max(...matchingPlanIndexes) : msgIndex;

        // Did user ask for a revision before this plan was generated?
        for (let i = firstMatchingPlanIndex - 1; i >= 0; i--) {
          const m = (messages || [])[i];
          if (m.role === "user") {
            const text = normalizedUserMessageText(m);
            if (isPlanRevisionMessageContent(text)) {
              revised = true;
            }
            break;
          }
        }

        // Did user approve or request revision on this plan?
        for (let i = firstMatchingPlanIndex + 1; i < (messages || []).length; i++) {
          const m = (messages || [])[i];
          const candidateStructured = structuredOutputFromRawSdkEventPayloads(m.rawSdkEventPayloads);
          const candidatePlanFile = candidateStructured?.plan?.file || "";
          if (m.role === "assistant" && candidatePlanFile) {
            const samePlanFile = areLikelySamePlanFilePath(
              candidatePlanFile,
              targetPlanFile,
            );
            if (!samePlanFile && i > lastMatchingPlanIndex) {
              break; // Stop checking only when a different plan was spawned
            }
          }
          if (m.role === "user") {
            const text = normalizedUserMessageText(m);
            if (isPlanProceedMessageContent(text)) {
              status = "Executing";
              break;
            } else if (isPlanRevisionMessageContent(text)) {
              status = "Revision Requested";
              break;
            }
          }
        }
      }
    }
    return { planStatus: status, isRevisedPlan: revised };
  }, [plan, message, messageId, messages]);

// Merge subagents from message data and from the store lookup by parent message ID.
  // Prefer store-scoped entries so subagent cards cannot bleed into unrelated messages.
  const subagents = useMemo(() => {
    const activeSessionId = currentSessionId;
    const dedupeSubagentsById = (entries: SubagentSummary[]): SubagentSummary[] => {
      const deduped = new Map<string, SubagentSummary>();
      for (const entry of entries) {
        if (!entry?.id) {
          continue;
        }
        const existing = deduped.get(entry.id);
        // Later updates for the same subagent should win so the inline card and
        // modal show the freshest progress / status instead of duplicate rows.
        deduped.set(entry.id, existing ? { ...existing, ...entry } : entry);
      }
      return Array.from(deduped.values());
    };
    const isInActiveSession = (subagent: SubagentSummary): boolean => {
      if (!activeSessionId) {
        return true;
      }
      return subagent.parentSessionId === activeSessionId;
    };
    const scopedStore = messageId ? (subagentsByParentMessageId?.[messageId] ?? []) : [];

    if (getGlobalShowBrowserConsole()) {
      console.log('===SUBAGENT_SPAWN=== [MEMO] Subagent lookup', {
        messageId,
        activeSessionId,
        hasStoreData: Boolean(subagentsByParentMessageId),
        storeKeys: subagentsByParentMessageId ? Object.keys(subagentsByParentMessageId) : [],
        scopedStoreCount: scopedStore.length,
        messageSubagentCount: Array.isArray(message?.subagents) ? message.subagents.length : 0,
      });
    }

    const fromStore = dedupeSubagentsById(scopedStore.filter((subagent: SubagentSummary) => {
      if (!isInActiveSession(subagent)) {
        return false;
      }
      if (!messageId) {
        return true;
      }
      return subagent.parentMessageId === messageId;
    }));
    const messageSubagents = Array.isArray(message?.subagents) ? message.subagents : [];
    const fromMessage = dedupeSubagentsById(messageSubagents.filter((subagent: SubagentSummary) => {
      if (!isInActiveSession(subagent)) {
        return false;
      }
      if (!messageId) {
        return true;
      }
      return subagent.parentMessageId === messageId;
    }));

    if (getGlobalShowBrowserConsole()) {
      console.log('===SUBAGENT_SPAWN=== [MEMO] Filter results', {
        fromStoreCount: fromStore.length,
        fromMessageCount: fromMessage.length,
        fromStoreIds: fromStore.map(s => s.id),
        fromMessageIds: fromMessage.map(s => s.id),
      });
    }

    if (fromStore.length === 0) return fromMessage;
    if (fromMessage.length === 0) return fromStore;

    // Merge by ID so the same subagent cannot appear twice when the message
    // payload and the store snapshot both report it during hydration/streaming.
    const mergedById = new Map<string, SubagentSummary>();
    for (const subagent of fromStore) {
      mergedById.set(subagent.id, subagent);
    }
    for (const subagent of fromMessage) {
      if (!mergedById.has(subagent.id)) {
        mergedById.set(subagent.id, subagent);
      }
    }
    const result = Array.from(mergedById.values());

    if (getGlobalShowBrowserConsole()) {
      console.log('===SUBAGENT_SPAWN=== [MEMO] Final result', {
        resultCount: result.length,
        resultIds: result.map(s => s.id),
      });
    }

    return result;
  }, [message, messageId, subagentsByParentMessageId, currentSessionId]);
  const previousSubagentCount = useRef(subagents.length);

  useEffect(() => {
    const hasNewSubagent = subagents.length > previousSubagentCount.current;
    previousSubagentCount.current = subagents.length;
    if (streaming && hasNewSubagent) {
      setShowSubagents(true);
    }
  }, [streaming, subagents.length]);
  useEffect(() => {
    if (subagents.length === 0) {
      setSelectedSubagentId(null);
      dispatch({ type: "SELECT_SUBAGENT", payload: null });
    }
  }, [subagents.length, dispatch]);

  useEffect(() => {
    if (!selectedSubagentId) {
      return;
    }
    const selected = subagents.find((entry) => entry.id === selectedSubagentId);
    if (!selected) {
      return;
    }
    const detail =
      (subagentDetailsById?.[selected.id] as SubagentDetail | undefined) ||
      (selected as SubagentDetail);
    const childSessionId = detail.childSessionId || selected.childSessionId;
    const parentSessionId = detail.parentSessionId || selected.parentSessionId;
    const parentMessageId = detail.parentMessageId || selected.parentMessageId;
    if (!childSessionId || !parentSessionId || !parentMessageId) {
      return;
    }
    const hasConversation =
      Array.isArray(detail.conversationEvents) &&
      detail.conversationEvents.length > 0;
    if (hasConversation) {
      return;
    }
    const requestKey = `${selected.id}:${childSessionId}`;
    if (requestedSubagentConversationRef.current.has(requestKey)) {
      return;
    }
    requestedSubagentConversationRef.current.add(requestKey);
    vscode.postMessage({
      type: "getSubagentConversation",
      subagentId: selected.id,
      childSessionId,
      parentSessionId,
      parentMessageId,
      status: selected.status,
      latestActivity: selected.latestActivity,
    });
  }, [selectedSubagentId, subagents, subagentDetailsById]);

  useEffect(() => {
    if (!selectedSubagentId) {
      return;
    }
    const selected = subagents.find((entry) => entry.id === selectedSubagentId);
    if (!selected) {
      return;
    }
    const detail =
      (subagentDetailsById?.[selected.id] as SubagentDetail | undefined) ||
      (selected as SubagentDetail);
    const childSessionId = detail.childSessionId || selected.childSessionId;
    const parentSessionId = detail.parentSessionId || selected.parentSessionId;
    const parentMessageId = detail.parentMessageId || selected.parentMessageId;
    if (!childSessionId || !parentSessionId || !parentMessageId) {
      return;
    }

    const status = (detail.status || selected.status || "running").toLowerCase();
    const isTerminal =
      status === "done" || status === "error" || status === "orphaned";
    if (isTerminal) {
      return;
    }

    // Keep modal conversation/timeline fresh while an active subagent is running.
    const intervalId = window.setInterval(() => {
      vscode.postMessage({
        type: "getSubagentConversation",
        subagentId: selected.id,
        childSessionId,
        parentSessionId,
        parentMessageId,
        status: selected.status,
        latestActivity: selected.latestActivity,
      });
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [selectedSubagentId, subagents, subagentDetailsById]);

  const hasStreamingActivity = !!(
    streaming &&
    ((streaming.content && String(streaming.content).trim().length > 0) ||
      (streaming.reasoning && String(streaming.reasoning).trim().length > 0) ||
      (Array.isArray(streaming.reasoningEvents) &&
        streaming.reasoningEvents.length > 0) ||
      (Array.isArray(streaming.progressEvents) &&
        streaming.progressEvents.length > 0) ||
      (Array.isArray(streaming.steps) && streaming.steps.length > 0) ||
      (Array.isArray(interactiveEvents) && interactiveEvents.length > 0) ||
      (Array.isArray(streaming.interactiveEvents) &&
        streaming.interactiveEvents.length > 0) ||
      subagents.length > 0)
  );

  // Use type-safe helpers instead of type assertions
  const agentName = turnMetadata.agent || getAgentName(message, streaming);
  const agentColor = useMemo(() => {
    if (!agentName || agentName === "assistant") return undefined;
    const match = availableAgents?.find(
      (a) =>
        a.id === agentName || a.name.toLowerCase() === agentName.toLowerCase(),
    );
    return match?.color ?? undefined;
  }, [agentName, availableAgents]);
  const modelName = useMemo(() => {
    if (turnMetadata.modelID && turnMetadata.providerID) {
      return `${turnMetadata.modelID}/${turnMetadata.providerID}`;
    }
    if (turnMetadata.modelID) {
      return turnMetadata.modelID;
    }
    if (turnMetadata.providerID) {
      return turnMetadata.providerID;
    }
    if (streaming?.isActive) {
      if (streaming.model?.name) return streaming.model.name;
      if (streaming.modelID && streaming.providerID)
        return `${streaming.modelID}/${streaming.providerID}`;
      if (streaming.modelID) return streaming.modelID;
    }
    return modelLabel(message ?? ({} as Message));
  }, [message, streaming, turnMetadata.modelID, turnMetadata.providerID]);
  const thinkingVariant =
    turnMetadata.variant || getThinkingVariant(message, streaming);
  const showMessageThinking = useMemo(
    () =>
      !!thinkingVariant &&
      messageModelSupportsThinking(message, streaming, availableModels),
    [thinkingVariant, message, streaming, availableModels],
  );
  const tokens = getTokenInfo(message);
  const inputTok = tokens?.input ?? 0;
  const outputTok = tokens?.output ?? 0;
  const reasoningTok = tokens?.reasoning ?? 0;
  const cache = tokens?.cache;
  const cacheRead = cache?.read ?? 0;
  const cacheWrite = cache?.write ?? 0;
  const duration = getDuration(message, streaming);
  const hasMetrics =
    inputTok > 0 ||
    outputTok > 0 ||
    reasoningTok > 0 ||
    cacheRead > 0 ||
    cacheWrite > 0 ||
    typeof duration === "number";
  const tokenMetricChips = [
    {
      key: "prompt",
      label: "prompt",
      value: inputTok,
      dotClassName: "bg-oc-yellow",
      emphasis: "primary" as const,
      tier: "primary" as const,
      visible: inputTok > 0,
    },
    {
      key: "response",
      label: "response",
      value: outputTok,
      dotClassName: "bg-oc-accent",
      emphasis: "primary" as const,
      tier: "primary" as const,
      visible: outputTok > 0,
    },
    {
      key: "reasoning",
      label: "reasoning",
      value: reasoningTok,
      dotClassName: "bg-oc-amber-custom",
      emphasis: "muted" as const,
      tier: "secondary" as const,
      visible: reasoningTok > 0,
    },
    {
      key: "cache-read",
      label: "cache read",
      value: cacheRead,
      dotClassName: "bg-oc-green",
      emphasis: "subtle" as const,
      tier: "secondary" as const,
      visible: cacheRead > 0,
    },
    {
      key: "cache-write",
      label: "cache write",
      value: cacheWrite,
      dotClassName: "bg-oc-orange",
      emphasis: "subtle" as const,
      tier: "secondary" as const,
      visible: cacheWrite > 0,
    },
  ].filter((chip) => chip.visible);
  const primaryMetricChips = tokenMetricChips.filter(
    (chip) => chip.tier === "primary",
  );
  const secondaryMetricChips = tokenMetricChips.filter(
    (chip) => chip.tier === "secondary",
  );
  const showThinkingPlaceholder =
    !streaming && thoughtItems.length === 0 && reasoningTok > 0;
  const thinkingPlaceholderText =
    "Reasoning tokens were used, but this provider did not expose reasoning text.";
  const hasActiveTimelineWork = timelineDisplayEvents.some(
    (event) => event.status === "pending",
  );
  const { rawResponseText } = useMemo(() => {
    const maxRawDebugChars = 30000;
    const withCap = (value: string): string =>
      value.length > maxRawDebugChars
        ? `${value.slice(0, maxRawDebugChars)}\n...<truncated ${value.length - maxRawDebugChars
        } chars>`
        : value;
    const raw = centralizedRawResponse;
    if (typeof raw === "undefined") {
      return {
        rawResponseText: "(rawResponse is missing on this message)",
      };
    }
    const rawResponseText =
      typeof raw === "string" ? raw : stringifyDebugValue(raw);
    return {
      rawResponseText: withCap(rawResponseText),
    };
  }, [centralizedRawResponse]);
  const showRawResponseDebug = config.debug.showRawResponse;
  const visibleRawResponseText =
    rawResponseText.trim().length > 0
      ? rawResponseText
      : "(rawResponse is missing on this message)";
  const planLeadMessage = useMemo(() => {
    if (!plan) return "";
    const candidate = (
      firstNonEmptyString(
        typeof structured?.text === "string"
          ? structured.text
          : typeof structured?.message === "string"
            ? structured.message
            : undefined,
        plan.intro,
        plan.summary,
      ) ?? ""
    ).trim();
    if (candidate && !looksLikeInternalPlanningText(candidate)) {
      return candidate;
    }
    return "I created an implementation plan. Here are the key steps and the plan file.";
  }, [structured?.text, structured?.message, plan]);
  const structuredResponseMessage =
    typeof structured?.text === "string"
      ? structured.text.trim()
      : typeof structured?.message === "string"
        ? structured.message.trim()
        : "";
  const responseBodyRawSdkEventPayloads = useMemo(
    () =>
      normalizedCentralizedRawSdkEventPayloads.filter(
        (payload) => !isDeltaCentralizedEventPayload(payload),
      ),
    [normalizedCentralizedRawSdkEventPayloads],
  );
  const responseBodyChunks = useMemo(() => {
    // The response body must render the final assistant answer exactly once.
    // Centralized fixtures can surface the same answer through both the
    // structured message field and raw text chunks, so the extractor and the
    // body renderer intentionally stay narrow here.
    if (structuredResponseMessage.length > 0) {
      return [structuredResponseMessage];
    }
    return getCentralizedAssistantContentChunksFromRawSdkEventPayloads(
      responseBodyRawSdkEventPayloads,
    );
  }, [structuredResponseMessage, responseBodyRawSdkEventPayloads]);
  const hasThinkingEvents = useMemo(
    () => displayEvents.some((event) => event.kind === "reasoning"),
    [displayEvents],
  );
  const resolvedContentMatchesError = messageDisplaysSameErrorText(
    cardMessage,
    responseBodyChunks.join("\n\n"),
  );
  const visibleResolvedContent = resolvedContentMatchesError
    ? ""
    : responseBodyChunks.join("\n\n");
  // For plan messages the display text comes from structured output fields
  // (plan.intro / plan.summary), not from concatenated raw response parts.
  // The extension-side applyStructuredOutputToMessage now populates
  // message.content from the structured fallback, so resolvedContent already
  // holds the correct structured text. planLeadMessage remains as a fallback.
  const effectiveResponseContent =
    visibleResolvedContent.trim().length > 0
      ? visibleResolvedContent
      : planLeadMessage;
  const hasVisibleResponseBody = responseBodyChunks.some(
    (chunk) => chunk.trim().length > 0,
  );
  const hasPrimaryResponseBody = hasVisibleResponseBody || shouldShowPlanCard;
  const hasResponseContent = hasVisibleResponseBody;
  const isAborted = cardMessage?.aborted === true;
  const structuredRetryError =
    !!cardMessage?.error &&
    (cardMessage.retryWithoutStructuredOutput === true ||
      isStructuredOutputFailureMessage(cardMessage.error));
  const showLegacyErrorBanner =
    !!cardMessage?.error &&
    !messageMatchesDisplayErrorText(cardMessage, cardMessage.error) &&
    !structuredRetryError &&
    !isAborted;
  const showDisplayErrorBanner = !!cardMessage?.displayError;
  const plainTextFallback = cardMessage?.plainTextFallback === true;
  const plainTextFallbackTooltip = plainTextFallback
    ? [
      cardMessage?.plainTextFallbackMessage ||
      "Structured output failed for this turn. Showing plain text response.",
      cardMessage?.plainTextFallbackReason
        ? `Reason: ${cardMessage.plainTextFallbackReason}`
        : "",
    ]
      .filter(Boolean)
      .join("\n")
    : "";
  const isLiveStreamingCard = !cardMessage && !!streaming?.isActive;
  const isLiveStream = !!streaming?.isActive;
  // Centralized data is the source of truth for what belongs in the final
  // assistant response. If the response text is present, render it directly
  // instead of hiding it behind a live-stream flag.
  const showResponseBody = !isLiveStreamingCard && hasVisibleResponseBody;
  const showResponseSection =
    !isLiveStreamingCard &&
    !isAborted &&
    (shouldShowPlanCard ||
      hasVisibleResponseBody ||
      (isLiveStream &&
        (hasStreamingActivity ||
          displayEvents.length > 0 ||
          hasActiveTimelineWork ||
          hasActiveReasoningPart ||
          hasPendingReasoningDisplayEvent)));
  useEffect(() => {
    if (
      !streaming?.isActive &&
      displayEvents.length === 0 &&
      !config.debug.showCentralizedDebug &&
      !config.debug.showPreRenderDebug
    ) {
      return;
    }

    logger.info("[TRACE][RENDER][ASSISTANT_MESSAGE]", {
      messageId: messageId || null,
      streamingMessageId: streaming?.messageId ?? null,
      streamingActive: !!streaming?.isActive,
      hasStreamingActivity,
      displayEventsCount: displayEvents.length,
      timelineDisplayEventsCount: timelineDisplayEvents.length,
      hasActiveTimelineWork,
      hasActiveReasoningPart,
      hasPendingReasoningDisplayEvent,
      showResponseSection,
      showResponseBody,
      hasVisibleResponseBody,
      hasPrimaryResponseBody,
      hasAssistantFinishSignal,
      messageInteractiveEvents: Array.isArray(cardMessage?.interactiveEvents)
        ? cardMessage.interactiveEvents.length
        : 0,
      streamingInteractiveEvents: Array.isArray(streaming?.interactiveEvents)
        ? streaming.interactiveEvents.length
        : 0,
    });
    console.info("[TRACE][RENDER][ASSISTANT_MESSAGE]", {
      messageId: messageId || null,
      streamingMessageId: streaming?.messageId ?? null,
      streamingActive: !!streaming?.isActive,
      hasStreamingActivity,
      displayEventsCount: displayEvents.length,
      timelineDisplayEventsCount: timelineDisplayEvents.length,
      hasActiveTimelineWork,
      hasActiveReasoningPart,
      hasPendingReasoningDisplayEvent,
      showResponseSection,
      showResponseBody,
      hasVisibleResponseBody,
      hasPrimaryResponseBody,
      hasAssistantFinishSignal,
      messageInteractiveEvents: Array.isArray(cardMessage?.interactiveEvents)
        ? cardMessage.interactiveEvents.length
        : 0,
      streamingInteractiveEvents: Array.isArray(streaming?.interactiveEvents)
        ? streaming.interactiveEvents.length
        : 0,
    });
  }, [
    messageId,
    cardMessage?.interactiveEvents,
    streaming,
    displayEvents.length,
    timelineDisplayEvents.length,
    hasActiveTimelineWork,
    hasActiveReasoningPart,
    hasPendingReasoningDisplayEvent,
    showResponseSection,
    showResponseBody,
    hasVisibleResponseBody,
    hasPrimaryResponseBody,
    hasAssistantFinishSignal,
    hasStreamingActivity,
    config.debug.showCentralizedDebug,
    config.debug.showPreRenderDebug,
  ]);

  const preRenderDebug = useMemo(() => {
    if (!config.debug.showPreRenderDebug) return null;
    const streamingContent = streaming?.content || '';
    const streamingReasoning = streaming?.reasoning || '';
    const reasoningEvents = streaming?.reasoningEvents || [];
    const reasoningEventSummaries = reasoningEvents.map((e: ReasoningEvent) =>
      typeof e?.text === 'string' ? e.text.slice(0, 120) : ''
    );
    const displayReasoningSummaries = displayEvents
      .filter((e) => e.kind === 'reasoning')
      .map((e) => (e.summary || '').slice(0, 120));
    const streamReasoningInContent = streamingContent && streamingReasoning
      ? streamingContent.includes(streamingReasoning) || streamingReasoning.includes(streamingContent)
      : false;
    const effectiveContentHasReasoning = effectiveResponseContent && streamingReasoning
      ? effectiveResponseContent.includes(streamingReasoning) || streamingReasoning.includes(effectiveResponseContent)
      : false;
    return {
      messageId: messageId || '(none)',
      isLiveStream,
      streaming: {
        isActive: streaming?.isActive || false,
        content: streamingContent.slice(0, 500),
        contentLen: streamingContent.length,
        reasoning: streamingReasoning.slice(0, 500),
        reasoningLen: streamingReasoning.length,
        reasoningEventsCount: reasoningEvents.length,
        reasoningEventSummaries,
        inReasoningPart: streaming?.inReasoningPart || false,
        hasRenderableContent: streaming?.hasRenderableContent || false,
        hasAssistantFinishSignal: String(hasAssistantFinishSignal),
        hasTerminalStepSignal: String(hasTerminalStepSignal),
      },
      filtered: {
        rawContent: rawContent.slice(0, 500),
        rawContentLen: rawContent.length,
        content: content.slice(0, 500),
        contentLen: content.length,
        effectiveResponseContent: effectiveResponseContent.slice(0, 500),
        effectiveResponseContentLen: effectiveResponseContent.length,
      },
      display: {
        displayEventsCount: displayEvents.length,
        displayReasoningSummaries,
        thoughtItemsCount: thoughtItems.length,
        hasActiveTimelineWork: String(hasActiveTimelineWork),
        hasActiveReasoningPart: String(hasActiveReasoningPart),
        hasPendingReasoningDisplayEvent: String(hasPendingReasoningDisplayEvent),
      },
      leakDetection: {
        streamReasoningInContent: String(streamReasoningInContent),
        effectiveContentHasReasoning: String(effectiveContentHasReasoning),
      },
      rendering: {
        showResponseSection: String(showResponseSection),
        hasVisibleResponseBody: String(hasVisibleResponseBody),
        hasPrimaryResponseBody: String(hasPrimaryResponseBody),
        showResponseBody: String(showResponseBody),
        isAborted: String(isAborted),
      },
    };
  }, [
    messageId, isLiveStream, streaming, rawContent, content,
    effectiveResponseContent, hasAssistantFinishSignal, hasTerminalStepSignal,
    hasActiveTimelineWork, hasActiveReasoningPart, hasPendingReasoningDisplayEvent,
    showResponseSection, hasVisibleResponseBody,
    hasPrimaryResponseBody, isAborted, displayEvents, thoughtItems,
    config.debug.showPreRenderDebug,
  ]);

  useEffect(() => {
    if (preRenderDebug) {
      logger.info('[PRE-RENDER-DEBUG]', preRenderDebug);
    }
  }, [preRenderDebug]);
  const responseSectionClass = hasResponseContent
    ? "rounded-md border border-oc-border-soft bg-background p-2.5 shadow-sm"
    : "p-0 border-0 bg-transparent shadow-none";
  const handleCopy = async () => {
    const textToCopy = resolvedContent?.trim() ?? "";
    if (!textToCopy) return;

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
      return;
    } catch {
      // VS Code webviews can block navigator clipboard in some contexts;
      // fallback to extension-host clipboard API.
      vscode.postMessage({ type: "copyToClipboard", text: textToCopy });
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };
  const copyDebugObject = async (panel: "sdk" | "centralized", value: unknown) => {
    const textToCopy = formatDebugObjectLiteral(value);
    if (!textToCopy) return;

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedDebugPanel(panel);
      setTimeout(() => setCopiedDebugPanel((current) => (current === panel ? null : current)), 1200);
      return;
    } catch {
      // VS Code webviews can block navigator clipboard in some contexts;
      // fallback to extension-host clipboard API.
      vscode.postMessage({ type: "copyToClipboard", text: textToCopy });
      setCopiedDebugPanel(panel);
      setTimeout(() => setCopiedDebugPanel((current) => (current === panel ? null : current)), 1200);
    }
  };
  const retryLastMessage = (retryWithoutStructuredOutput: boolean) => {
    dispatch({ type: "SET_PROCESSING", payload: true });
    const targetMessageIndex = (messages || []).findIndex((candidate) => {
      if (messageId) {
        const candidateId = candidate.info?.id ?? candidate.id;
        return candidateId === messageId;
      }
      return candidate === message;
    });
    if (targetMessageIndex >= 0) {
      let persistedPatchedMessage: Message | undefined;
      const nextMessages = (messages || []).map((candidate, index) => {
        if (index !== targetMessageIndex) return candidate;
        const patched = patchMessageRetryState(
          candidate,
          retryWithoutStructuredOutput,
        );
        persistedPatchedMessage = patched;
        return patched;
      });
      dispatch({ type: "SET_MESSAGES", payload: nextMessages });
      if (currentSessionId && persistedPatchedMessage) {
        vscode.postMessage({
          type: "persistAssistantMessage",
          sessionId: currentSessionId,
          message: persistedPatchedMessage,
        });
      }
    }
    vscode.postMessage({
      type: "retryLastMessage",
      retryWithoutStructuredOutput,
    });
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

  const responseEnterClass = streaming
    ? "oc-assistant-streaming-enter"
    : "oc-assistant-response-enter";
  const isCentralizedDebugLive = !!streaming?.isActive;

  return (
    <div
      id={messageId ? `msg-${messageId}` : undefined}
      data-message-id={messageId || undefined}
      className={`oc-message-enter ${responseEnterClass} ${isContiguous ? "mb-2.5 mt-[-8px]" : "mb-3.5"} px-4`}
    >
      <div
        className={cn(
          "oc-msg-assistant",
        )}
        ref={messageBodyRef}
      >
        {config.debug.showSdkDebug && sdkDebugData && (
          <div
            data-assistant-section="sdk-debug"
            className="mb-3"
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-oc-text-soft">
                SDK Debug
              </div>
              <button
                type="button"
                onClick={() => copyDebugObject("sdk", sdkDebugData)}
                className="inline-flex items-center gap-1 rounded border border-oc-border-soft bg-oc-panel-soft/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-oc-text-soft transition-colors hover:border-oc-border hover:bg-oc-panel-soft/70 hover:text-oc-text"
                title="Copy SDK debug object"
              >
                {copiedDebugPanel === "sdk" ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                <span>{copiedDebugPanel === "sdk" ? "Copied" : "Copy"}</span>
              </button>
            </div>
            {/* Keep this as an object literal view so the raw SDK payload is easy to inspect. */}
            <div className="max-h-[320px] overflow-auto rounded border border-oc-border-soft bg-oc-panel-soft/60 p-2 text-[11px] leading-relaxed text-oc-text-soft break-words font-medium">
              <DebugObjectView value={sdkDebugData} />
            </div>
          </div>
        )}

        {!isContiguous && (
          <div className="oc-msg-header mb-2 flex flex-wrap items-start justify-between gap-1.5">
            <div className="oc-msg-header-main flex min-w-0 flex-1 items-center gap-1.5">
              <div className="oc-msg-header-left flex items-center gap-1.5 min-w-0">
                <div className="oc-msg-header-text flex min-w-0 items-center gap-1.5 flex-wrap">
                      <span
                        className="oc-msg-agent-name font-semibold text-oc-sm truncate min-w-0"
                        style={
                          agentColor
                            ? {
                              color: `color-mix(in srgb, var(--oc-text) 88%, ${agentColor})`,
                            }
                            : undefined
                        }
                      >
                        {agentName !== "assistant" ? agentName : "AI"}
                      </span>
                      {modelName && modelName !== "assistant" && (
                        <div className="flex min-w-0 items-center gap-1 opacity-60">
                          <span className="text-oc-xs font-medium shrink-0">
                            •
                          </span>
                          <span className="oc-msg-model-label min-w-0 truncate text-oc-xs">
                            {modelName}
                          </span>
                        </div>
                      )}
                      {showMessageThinking && (
                        <div className="flex items-center gap-1 opacity-60">
                          <span className="text-oc-xs font-medium shrink-0">•</span>
                          <span className="oc-msg-thinking-label">
                            Think {formatThinkingVariantLabel(thinkingVariant || "")}
                          </span>
                        </div>
                      )}
                </div>
              </div>
            </div>
            <div className="oc-msg-header-actions flex min-w-0 flex-wrap items-center gap-1.5">
              {hasMetrics && (
                <div className="oc-metrics-rail flex flex-wrap items-center gap-1.5" role="list" aria-label="Response metrics">
                  {tokenMetricChips.map((chip) => (
                    <div
                      key={chip.key}
                      role="listitem"
                      className={cn(
                        "oc-token-chip group/token relative inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-all duration-200",
                        chip.emphasis === "primary"
                          ? "border-oc-border-soft bg-oc-panel"
                          : chip.emphasis === "subtle"
                            ? "border-oc-border-soft bg-oc-panel-soft oc-token-chip-secondary"
                            : "border-oc-border-soft bg-oc-panel-soft oc-token-chip-secondary",
                      )}
                      title={`${chip.label}: ${chip.value.toLocaleString()} tokens`}
                    >
                      <div className={cn("h-1.5 w-1.5 rounded-full", chip.dotClassName)} />
                      <span className="oc-token-chip-label text-[10px] uppercase tracking-[0.11em] oc-text-secondary">
                        {chip.label}
                      </span>
                      <span className="oc-token-chip-value font-medium font-semibold text-oc-text tabular-nums">
                        {chip.value.toLocaleString()}
                      </span>
                    </div>
                  ))}

                  {typeof duration === "number" && (
                    <div
                      role="listitem"
                      className="oc-token-chip oc-token-chip-duration inline-flex items-center gap-1.5 rounded-full border border-oc-border-soft bg-oc-panel-soft px-2.5 py-1 transition-all duration-200"
                      title={`Duration: ${duration.toFixed(1)} seconds`}
                    >
                      <Clock className="h-3 w-3 oc-text-secondary opacity-80" />
                      <span className="oc-token-chip-value font-medium font-semibold oc-text-secondary tabular-nums">
                        {duration.toFixed(1)}s
                      </span>
                    </div>
                  )}
                </div>
              )}
              {plainTextFallback && (
                <span
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-oc-border-soft oc-text-secondary"
                  title={plainTextFallbackTooltip}
                >
                  <AlertCircle className="h-3.5 w-3.5 text-oc-yellow" />
                </span>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {(displayEvents.length > 0 ||
            showThinkingPlaceholder) && (
              <section data-assistant-section="activity" className="space-y-2">
                {timelineDisplayEventGroups.map((group, groupIdx) => {
                  if (group.type === "commentary") {
                    return (
                      <div key={`commentary-${groupIdx}`} className="px-1 mb-2 mt-1">
                        <AssistantResponseBodyCard
                          content={[group.event.summary]}
                          className="oc-response-commentary-block"
                        />
                      </div>
                    );
                  }
                  
                  if (group.events.length === 0) return null;

                  return (
                    <Stepper
                      key={`stepper-${groupIdx}`}
                      className="oc-refined-stepper"
                      ref={groupIdx === timelineDisplayEventGroups.length - 1 ? progressTimelineRef : undefined}
                      autoScrollToBottom={isStreamingActive && groupIdx === timelineDisplayEventGroups.length - 1}
                    >
                      {group.events.map((event, index) => {
                        const isLast = groupIdx === timelineDisplayEventGroups.length - 1 && index === group.events.length - 1;
                        const isLatestStreamingEvent =
                          isStreamingActive && isLast;
                        const showRunning =
                          (isLatestStreamingEvent || assistantTurnPending) &&
                          event.status === "pending";
                        const indicatorNode = (
                          <StepIndicator
                            status={showRunning ? "running" : event.status}
                          />
                        );
                        const shouldShowDetail = viewState.showActivityDetails;
                        const labelText = (event.label ?? "").toString();
                        const labelLower = labelText.trim().toLowerCase();
                        const isGlobSearch = labelLower === "glob";
                        const showDiffPreviewLocal =
                          (labelLower === "edit" ||
                            labelLower === "modify" ||
                            labelLower === "patch" ||
                            labelLower === "write" ||
                            labelLower === "apply_patch") &&
                          (
                            !!event.activityDetail?.diffExcerpt ||
                            !!(event.activityDetail?.input as Record<string, unknown> | undefined)?.patchText ||
                            !!(event.activityDetail?.input as Record<string, unknown> | undefined)?.patch ||
                            !!(event.activityDetail?.input as Record<string, unknown> | undefined)?.diff ||
                            !!event.diffStats
                          );

                        return (
                          <StepperItem
                            key={event.key}
                            isLast={isLast}
                            indicator={indicatorNode}
                            className={cn(
                              "oc-refined-stepper-item group",
                              showRunning
                                ? "is-streaming"
                                : "",
                            )}
                          >
                            {(() => {
                              if (event.kind === "reasoning") {
                                const isExpanded = viewState.expandedReasoningSteps.has(event.key);
                                return (
                                  <div className="flex items-start justify-between gap-2 w-full">
                                    <div className="flex-1 min-w-0 flex-col items-start gap-2 w-full">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span
                                          className={cn(
                                            "oc-refined-event-label",
                                            "reasoning",
                                          )}
                                          data-operation={labelLower}
                                        >
                                          {event.label}
                                        </span>
                                      </div>

                                      <div className="flex min-w-0 flex-1 flex-col gap-1 oc-refined-event-content w-full">
                                        {event.summary && (
                                          <div className={cn(
                                            "w-full relative transition-all duration-200",
                                            !isExpanded && "max-h-[80px] overflow-hidden",
                                            isExpanded && "max-h-none",
                                          )}>
                                            <div className={cn(
                                              "oc-refined-event-summary text-left w-full",
                                              !isExpanded && "reasoning-subtle-fade"
                                            )}>
                                              <MarkdownRenderer
                                                content={event.summary}
                                                className="markdown-body"
                                              />
                                            </div>
                                            {!isExpanded && (
                                              <div className="reasoning-fade-indicator" />
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              } else {
                                  return (
                                  <div className="flex items-start justify-between gap-2 w-full">
                                    <ExpandableStep className="flex-1">
                                {labelLower === "call_omo_agent" ? (
                                  <CallOmoAgentStep
                                    callID={event.callID}
                                    sessionID={event.sessionID}
                                    startedAt={event.startedAt}
                                    endedAt={event.endedAt}
                                    status={event.status}
                                    source={event.source}
                                    activityDetail={event.activityDetail}
                                  />
                                ) : labelLower === "background_output" ? (
                                  <BackgroundOutputStep
                                    callID={event.callID}
                                    sessionID={event.sessionID}
                                    startedAt={event.startedAt}
                                    endedAt={event.endedAt}
                                    status={event.status}
                                    source={event.source}
                                    activityDetail={event.activityDetail}
                                  />
                                ) : (
                                  <div className="flex flex-col items-start gap-2 w-full min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span
                                        className={cn(
                                          "oc-refined-event-label",
                                          "activity",
                                        )}
                                        data-operation={labelLower}
                                      >
                                        {event.label}
                                      </span>
                                      {event.source && event.source !== "stream" && event.source !== "final" && (
                                        <span className="oc-refined-meta-badge">
                                          {event.source === "raw_debug"
                                            ? "raw"
                                            : event.source}
                                        </span>
                                      )}
                                      {event.internal && (
                                        <span className="oc-refined-meta-badge">
                                          internal
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex flex-col gap-1 w-full">
                                        {/* For read and todowrite events, skip the generic summary block here — they have their own custom UI below.
                                            For all other events, render the file link or summary as usual. */}
                                        {labelLower !== "read" && labelLower !== "todowrite" && (
                                          event.filePath && !isUrl(event.filePath) && !isCallStyleActivityLabel(event.label) ? (
                                            SEARCH_LABELS.has(event.label) ? (
                                              <div className={cn(
                                                "flex flex-col gap-1.5",
                                                isGlobSearch && "max-h-64 overflow-y-auto",
                                              )}>
                                                {isGlobSearch && event.filePath && (
                                                  <div className="flex items-center gap-1.5 text-xs font-medium text-oc-text-soft">
                                                    <FileIcon filePath={event.filePath} />
                                                    <span className="break-words whitespace-pre-wrap">
                                                      {event.filePath}
                                                    </span>
                                                  </div>
                                                )}
                                                  <CollapsedSearchBlockPreview
                                                    title={event.label}
                                                    pattern={
                                                      isGlobSearch
                                                        ? (event.activityDetail?.input?.pattern as string)
                                                        : buildSearchPattern(
                                                            event.activityDetail?.query || event.summary,
                                                            event.description,
                                                          )
                                                    }
                                                    patternInHeader={false}
                                                    scope={event.label}
                                                    path={isGlobSearch ? undefined : event.filePath}
                                                    include={event.activityDetail?.input?.include as string || event.activityDetail?.input?.Include as string}
                                                  outputMode={event.activityDetail?.input?.output_mode as string || event.activityDetail?.input?.outputMode as string}
                                                  headLimit={event.activityDetail?.input?.head_limit as number || event.activityDetail?.input?.headLimit as number}
                                                  output={event.activityDetail?.output}
                                                />
                                              </div>
                                            ) : (
                                              <button
                                                type="button"
                                                className="oc-refined-file-link oc-refined-file-link-with-tooltip"
                                                onClick={() =>
                                                  vscode.postMessage({
                                                    type: "openFile",
                                                    file: event.filePath!,
                                                  })
                                                }
                                              >
                                                <FileIcon filePath={event.filePath} />
                                                <span className="break-words whitespace-pre-wrap">
                                                  {event.summary || event.filePath}
                                                </span>
                                                <span className="oc-refined-file-link-tooltip" role="tooltip">
                                                  {event.filePath}
                                                </span>
                                              </button>
                                            )
                                          ) : (
                                            <div className="oc-refined-event-summary">
                                              {event.label === "bash" ? (
                                                <TerminalBlockWithOutput
                                                  event={event}
                                                  messageContent={content}
                                                />
                                              ) : SEARCH_LABELS.has(event.label) ? (
                                                <div className="flex flex-col gap-1.5">
                                                  {isGlobSearch && event.filePath && (
                                                    <div className="flex items-center gap-1.5 text-xs font-medium text-oc-text-soft">
                                                      <FileIcon filePath={event.filePath} />
                                                      <span className="break-words whitespace-pre-wrap">
                                                        {event.filePath}
                                                      </span>
                                                    </div>
                                                  )}
                                                  {isGlobSearch ? (
                                                    <CollapsedSearchBlockPreview
                                                      title={event.label}
                                                      pattern={buildSearchPattern(
                                                        event.activityDetail?.input?.pattern as string,
                                                        event.description,
                                                      )}
                                                      patternInHeader={true}
                                                      scope={event.label}
                                                      path={undefined}
                                                      include={event.activityDetail?.input?.include as string || event.activityDetail?.input?.Include as string}
                                                      outputMode={event.activityDetail?.input?.output_mode as string || event.activityDetail?.input?.outputMode as string}
                                                      headLimit={event.activityDetail?.input?.head_limit as number || event.activityDetail?.input?.headLimit as number}
                                                      output={event.activityDetail?.output}
                                                    />
                                                  ) : (
                                                    <CollapsedSearchBlockPreview
                                                      title={event.label}
                                                      pattern={buildSearchPattern(
                                                        event.activityDetail?.query || event.summary,
                                                        event.description,
                                                      )}
                                                      scope={event.label}
                                                      path={event.filePath}
                                                      include={event.activityDetail?.input?.include as string || event.activityDetail?.input?.Include as string}
                                                      outputMode={event.activityDetail?.input?.output_mode as string || event.activityDetail?.input?.outputMode as string}
                                                      headLimit={event.activityDetail?.input?.head_limit as number || event.activityDetail?.input?.headLimit as number}
                                                      output={event.activityDetail?.output}
                                                    />
                                                  )}
                                                </div>
                                              ) : event.filePath && isUrl(event.filePath) ? (
                                                <a
                                                  href={event.filePath}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="oc-refined-url-link flex items-center gap-1.5 hover:underline"
                                                >
                                                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                                  <span className="break-words whitespace-pre-wrap">
                                                    {event.summary || event.filePath}
                                                  </span>
                                                </a>
                                              ) : (
                                                <CollapsedMarkdownPreview
                                                  title={event.label}
                                                  content={event.summary || event.filePath || ""}
                                                />
                                              )}
                                            </div>
                                          )
                                        )}

                                        {!SEARCH_LABELS.has(labelText) && labelLower !== "bash" && labelLower !== "todowrite" && labelLower !== "read" && event.description && (
                                          <div className="mt-1">
                                            <CollapsedMarkdownPreview
                                              title={`${event.label} description`}
                                              content={event.description}
                                            />
                                          </div>
                                        )}

                                        {(() => {
                                          const isRead = labelLower === "read";
                                          const preview = event.activityDetail?.metadata?.preview as string | undefined;
                                          return isRead && !!preview;
                                        })() && (() => {
                                          const preview = event.activityDetail?.metadata?.preview as string;
                                          const previewTitle = event.activityDetail?.title || event.summary || event.filePath || "File Preview";
                                          return (
                                            <div className="oc-read-preview oc-activity-step-card mt-2 min-w-0 overflow-hidden p-3">
                                              <div className="mb-2 flex items-center gap-2 text-xs text-oc-text-soft">
                                                <span className="flex items-center gap-1.5 font-medium">
                                                  <FileIcon filePath={event.filePath} />
                                                  <span className="break-words whitespace-pre-wrap">
                                                    {previewTitle}
                                                  </span>
                                                </span>
                                              </div>
                                              <CollapsedMarkdownPreview
                                                title={previewTitle}
                                                content={preview}
                                                variant="bare"
                                              />
                                            </div>
                                          );
                                        })()}

                                        {(() => {
                                          const isTodoWrite = labelLower === "todowrite";
                                          if (!isTodoWrite) return null;
                                          return <TodoWriteStep event={event} />;
                                        })()}

                                        {showDiffPreviewLocal && (
                                          <DiffPreviewStep
                                            title={event.activityDetail?.title || event.summary || "Diff Preview"}
                                            filePath={event.viewDiffFile || event.filePath || event.activityDetail?.file}
                                            diffStats={event.diffStats}
                                            excerpt={event.activityDetail?.diffExcerpt}
                                            source={event.source}
                                            status={event.status}
                                            activityDetail={event.activityDetail}
                                          />
                                        )}

                                        {shouldShowDetail && event.detail && (
                                          <div className="mt-1">
                                            <CollapsedMarkdownPreview
                                              title={`${event.label} details`}
                                              content={event.detail}
                                            />
                                          </div>
                                        )}

                                        {shouldShowDetail && event.activityDetail && (
                                          <div className="oc-refined-activity-details flex flex-col gap-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                              {event.activityDetail.tool && (
                                                <span className="oc-refined-detail-badge">
                                                  tool {event.activityDetail.tool}
                                                </span>
                                              )}
                                              {event.activityDetail.query && (
                                                <span className="oc-refined-detail-badge">
                                                  query {event.activityDetail.query}
                                                </span>
                                              )}
                                            </div>

                                            {labelLower !== "bash" && event.activityDetail.command && (
                                              <TerminalBlock command={event.activityDetail.command} />
                                            )}
                                          </div>
                                        )}
                                    </div>
                                  </div>
                                )}

                                {!showDiffPreviewLocal &&
                                  event.diffStats &&
                                  (
                                    <span className="oc-refined-diff-stats">
                                      <span className={cn(
                                        event.diffStats.added > 0
                                          ? "text-emerald-300"
                                          : "oc-text-secondary",
                                      )}>
                                        +{event.diffStats.added}
                                      </span>
                                      <span className={cn(
                                        event.diffStats.deleted > 0
                                          ? "text-rose-300"
                                          : "oc-text-secondary",
                                      )}>
                                        -{event.diffStats.deleted}
                                      </span>
                                    </span>
                                  )}

                                {!showDiffPreviewLocal &&
                                  event.viewDiffFile && (
                                    <button
                                      type="button"
                                      className="shrink-0 rounded border border-oc-border-soft px-2 py-0.5 text-[10px] font-medium oc-text-secondary hover:text-oc-text-soft"
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
                              </ExpandableStep>
                            </div>
                                );
                              }
                            })()}
                          </StepperItem>
                        );
                      })}
                    </Stepper>
                  );
                })}

                    {showThinkingPlaceholder && !hasThinkingEvents && timelineDisplayEvents.length === 0 && (
                      <Stepper className="mt-2 max-h-[120px] overflow-y-auto">
                        <StepperItem
                          isLast={true}
                          indicator={<StepIndicator status="pending" />}
                        >
                          <div className="flex min-w-0 items-start gap-2 flex-wrap">
                            <span className="oc-refined-event-label reasoning">
                              Reasoning
                            </span>
                            <span
                              className={cn(
                                "flex-1 whitespace-pre-wrap break-words text-[11px] oc-text-secondary",
                                !viewState.showThinkingDetails && "line-clamp-2",
                              )}
                            >
                              {thinkingPlaceholderText}
                            </span>
                          </div>
                        </StepperItem>
                      </Stepper>
                    )}

              </section>
            )}

          <SubagentsInlineCard
            subagents={subagents}
            subagentDetailsById={subagentDetailsById || {}}
            showSubagents={showSubagents}
            setShowSubagents={setShowSubagents}
            showAllSubagents={showAllSubagents}
            setShowAllSubagents={setShowAllSubagents}
            openSubagentModal={openSubagentModal}
          />

          {shouldShowTodoInlineSummary && (
            <TodoInlineSummary
              todoItems={scopedTodoItems}
              showTodoChecklist={showTodoChecklist}
              setShowTodoChecklist={setShowTodoChecklist}
            />
          )}

          {showResponseSection && (
            <section
              data-assistant-section="response"
              className={responseSectionClass}
            >
              {shouldShowPlanCard && plan && (
                <div
                  className={
                    showResponseBody
                      ? "oc-response-plan-separator mt-3 pt-3 border-t"
                      : undefined
                  }
                >
                  <div className="plan-card flex items-center justify-between gap-2">
                    <div className="plan-card-content flex flex-col gap-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="plan-card-title text-oc-xs font-semibold tracking-normal">
                          {plan.title || "Implementation Plan"}
                        </div>
                        {isRevisedPlan && (
                          <span className="plan-status-badge plan-status-badge-blue rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                            Revised
                          </span>
                        )}
                        {planStatus === "Executing" && (
                          <span className="plan-status-badge plan-status-badge-green rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                            Approved
                          </span>
                        )}
                        {planStatus === "Revision Requested" && (
                          <span className="plan-status-badge plan-status-badge-yellow rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                            Revision Requested
                          </span>
                        )}
                        {planStatus === "Draft" && (
                          <span className="plan-status-badge plan-status-badge-neutral rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                            Draft
                          </span>
                        )}
                      </div>
                      {plan.file ? (
                        <div className="plan-card-file mt-1 flex items-center gap-1.5 text-[11px] font-medium">
                          <FileIcon filePath={plan.file} />
                          <span className="truncate" title={plan.file}>{toWorkspaceRelativePath(plan.file)}</span>
                        </div>
                      ) : (
                        <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-oc-text-soft italic">
                          (no file)
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
                </div>
              )}

              {showResponseBody && !shouldShowPlanCard && (
                <div className="mt-1.5 space-y-1.5">
                  {responseBodyChunks.map((chunk, index) => (
                    <AssistantResponseBodyCard
                      key={`${messageId || "assistant"}-response-${index}`}
                      content={[chunk]}
                      className="oc-response-body-block"
                      variant="bare"
                    />
                  ))}
                </div>
              )}

              {showRawResponseDebug && (
                <div
                  data-assistant-section="raw-response-debug"
                  className={
                    hasPrimaryResponseBody
                      ? "mt-1.5 pt-1.5 border-t border-oc-border-soft/30"
                      : undefined
                  }
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-oc-text-soft">
                      Raw Response (Debug)
                    </div>
                  </div>
                  <pre className="max-h-[260px] overflow-auto rounded border border-oc-border-soft bg-oc-panel-soft/60 p-2 text-[11px] leading-relaxed text-oc-text-soft whitespace-pre-wrap break-words font-medium">
                    {visibleRawResponseText}
                  </pre>
                </div>
              )}

              {config.debug.showInteractiveEventsDebug && (
                <div
                  data-assistant-section="interactive-events-debug"
                  className={
                    hasPrimaryResponseBody
                      ? "mt-1.5 pt-1.5 border-t border-oc-border-soft/30"
                      : undefined
                  }
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-oc-text-soft">
                      Interactive Events (Debug)
                    </div>
                  </div>
                  <pre className="max-h-[320px] overflow-auto rounded border border-oc-border-soft bg-oc-panel-soft/60 p-2 text-[11px] leading-relaxed text-oc-text-soft whitespace-pre-wrap break-words font-medium">
                    {(() => {
                      const parts: Record<string, unknown>[] = [];
                      if (Array.isArray(message?.interactiveEvents) && message.interactiveEvents.length > 0) {
                        parts.push({ source: "message.interactiveEvents", data: message.interactiveEvents });
                      }
                      const streamEvents = streaming?.interactiveEvents;
                      if (Array.isArray(streamEvents) && streamEvents.length > 0) {
                        parts.push({ source: "streaming.interactiveEvents", data: streamEvents });
                      }
                      if (parts.length === 0) {
                        return "(no interactive events on this message)";
                      }
                      return JSON.stringify(parts, null, 2);
                    })()}
                  </pre>
                </div>
              )}

              {config.debug.showPreRenderDebug && preRenderDebug && (
                <div
                  data-assistant-section="pre-render-debug"
                  className={
                    hasPrimaryResponseBody
                      ? "mt-1.5 pt-1.5 border-t border-oc-border-soft/30"
                      : undefined
                  }
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-oc-text-soft">
                      Pre-Render Data (Debug)
                    </div>
                  </div>
                  <pre className="max-h-[320px] overflow-auto rounded border border-oc-border-soft bg-oc-panel-soft/60 p-2 text-[11px] leading-relaxed text-oc-text-soft whitespace-pre-wrap break-words font-medium">
                    {JSON.stringify(preRenderDebug, null, 2)}
                  </pre>
                </div>
              )}

            </section>
          )}

        </div>

{!isStreamingActive && showResponseSection && (
          <div className="mt-1 flex items-center justify-start gap-1.5">
            <button
              type="button"
              className={cn("oc-bubble-copy-btn h-7 w-7", copied && "is-copied")}
              onClick={handleCopy}
              title="Copy message"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-oc-green" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
            {(() => {
              const ts = formatMessageTime(getMessageTimestamp(cardMessage));
              return ts ? (
                <span className="oc-text-secondary text-[10px] tabular-nums opacity-70">
                  {ts}
                </span>
              ) : null;
            })()}
          </div>
        )}

        {isAborted && !hasQuestionLikeInteractiveContent(cardMessage) && (
          <div className="mt-2 flex items-center justify-center">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium tracking-wide text-amber-400">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>Interrupted</span>
            </div>
          </div>
        )}

        {showLegacyErrorBanner && (
          <div className="mt-2">
            {(() => {
              const retryWithoutStructuredOutput =
                cardMessage?.retryWithoutStructuredOutput === true ||
                isStructuredOutputFailureMessage(cardMessage?.error);
              return (
                <ErrorBanner
                  message={cardMessage?.error ?? ""}
                  retryLabel={
                    retryWithoutStructuredOutput
                      ? "Retry Without Structured Output"
                      : "Retry"
                  }
                  retryHint={
                    retryWithoutStructuredOutput
                      ? "This will resend your last prompt as plain text (no json_schema)."
                      : undefined
                  }
                  onRetry={() => {
                    retryLastMessage(retryWithoutStructuredOutput);
                  }}
                />
              );
            })()}
          </div>
        )}

        {/* Add new error banner */}
        {showDisplayErrorBanner && (
          <div className="mt-2">
            <InfoBanner error={cardMessage?.displayError} />
          </div>
        )}

        {message?.retryState === "retrying_without_structured_output" && (
          <div className="mt-2">
            <InfoBanner
              message={
                message.retryMessage ||
                "Retrying without structured output..."
              }
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
              (subagentDetailsById?.[selected.id] as
                | SubagentDetail
                | undefined) ||
              ({
                ...selected,
                thinkingEvents: [],
                progressEvents: [],
                timelineEvents: [],
              } as SubagentDetail);
            const title = subagentModelLabel(selected, detailData);

            return (
              <SubagentDetailModal
                isOpen={Boolean(selectedSubagentId)}
                title={title}
                detail={detailData}
                colorClass={getSubagentColor(selected.id)}
                onClose={closeSubagentModal}
                onCopyRefs={copyRefs}
                onJumpToParent={() => {
                  closeSubagentModal();
                  jumpToMessage(selected.parentMessageId || messageId || "");
                }}
              />
            );
          })()}

        {/* File Changes - aggregated diffs at the bottom */}
        {/* Only show for the specific message that has file changes, not for every message */}
        {!hideFileChangesSection && shouldShowFileChanges && (
          <div className="mt-4">
            <FileChangesSection
              structuredFileChanges={fileChanges || []}
              messageId={messageId}
              sessionId={currentSessionId}
            />
          </div>
        )}

        {/* Raw Data â€" moved last so it doesn't interrupt the reading flow */}
        {/* {(message || streaming) && (
          <details className="group mb-3">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-oc-xs font-medium oc-text-secondary hover:text-oc-text-soft transition-colors">
              <span className="inline-block text-oc-2xs transition-transform group-open:rotate-90">
                â€º
              </span>
              <span className="opacity-50">Raw Data</span>
            </summary>
            <div className="mt-2 rounded-md border border-oc-border-soft bg-oc-panel-soft p-2.5">
              <pre className="overflow-x-auto text-oc-2xs font-medium text-oc-text-soft whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                {JSON.stringify(
                  {
                    message: activityTimelineMessage
                      ? {
                          id: activityTimelineMessage.id,
                          role: activityTimelineMessage.role,
                          contentLength:
                            activityTimelineMessage.content?.length ||
                            activityTimelineMessage.text?.length ||
                            0,
                          partsCount: activityTimelineMessage?.parts?.length || 0,
                          info: activityTimelineMessage.info,
                          hasReasoning:
                            !!activityTimelineMessage.reasoningEvents?.length ||
                            !!activityTimelineMessage.parts?.some(
                              (p) => p.reasoning || p.thought || p.thinking,
                            ),
                          hasSteps: !!activityTimelineMessage?.steps?.length,
                          hasProgressEvents: !!activityTimelineMessage?.progressEvents?.length,
                          hasSubagents: !!activityTimelineMessage.subagents?.length,
                          hasPlan: !!activityTimelineMessage.plan,
                        edits: activityTimelineMessage.edits?.map((file: { file: string }) => file.file),
                        createdAt: activityTimelineMessage.created,
                        duration: activityTimelineMessage.info?.duration ?? activityTimelineMessage.duration,
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
      </div>
    </div>
  );
}

function parseSessionDiffPatch(patch?: string): { header?: string; lines: string[] } {
  if (typeof patch !== "string" || patch.trim().length === 0) {
    return { lines: [] };
  }

  const lines = patch
    .split(/\r?\n/)
    .filter((line) => typeof line === "string" && line.trim().length > 0);
  const headerIndex = lines.findIndex((line) => line.startsWith("@@"));
  if (headerIndex < 0) {
    return { lines };
  }

  return {
    header: lines[headerIndex],
    lines: lines.slice(headerIndex + 1),
  };
}

export const FileChangesSection = memo(function FileChangesSection({
  structuredFileChanges,
  messageId,
  sessionId,
  centralizedDiffEvent,
}: {
  structuredFileChanges: StructuredFileChange[];
  messageId?: string | null;
  sessionId?: string | null;
  centralizedDiffEvent?: {
    id?: string;
    sessionId?: string;
    createdAt?: number;
    files: Array<{
      file: string;
      patch?: string;
      additions?: number;
      deletions?: number;
      status?: string;
    }>;
  };
}) {
  type DiffExcerpt = { header?: string; lines?: string[]; added?: number; deleted?: number };
  type FileChange = { file: string; added: number; deleted: number; diffExcerpt?: DiffExcerpt };

  const compactDisplayDir = (dir: string): string => {
    const normalized = dir.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!normalized) return "";
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length <= 3) return normalized;
    return `.../${parts.slice(-3).join("/")}`;
  };

  const fileChanges = useMemo<FileChange[]>(() => {
    if (Array.isArray(structuredFileChanges) && structuredFileChanges.length > 0) {
      return structuredFileChanges
      .map((item) => {
        const excerptLines = Array.isArray(item.diffExcerpt?.lines)
          ? item.diffExcerpt.lines.filter(
              (line): line is string => typeof line === "string" && line.trim().length > 0,
            )
          : [];
        return {
          file: item.file,
          added: Math.max(0, item.diffStats?.added || 0),
          deleted: Math.max(0, item.diffStats?.deleted || 0),
          diffExcerpt: item.diffExcerpt
            ? {
                ...item.diffExcerpt,
                lines: excerptLines,
              }
            : undefined,
        };
      })
      .sort((a, b) => a.file.localeCompare(b.file));
    }

    if (
      centralizedDiffEvent &&
      Array.isArray(centralizedDiffEvent.files) &&
      centralizedDiffEvent.files.length > 0
    ) {
      return centralizedDiffEvent.files
        .map((item) => ({
          file: item.file,
          added: Math.max(0, Number(item.additions) || 0),
          deleted: Math.max(0, Number(item.deletions) || 0),
          diffExcerpt: item.patch
            ? parseSessionDiffPatch(item.patch)
            : undefined,
        }))
        .sort((a, b) => a.file.localeCompare(b.file));
    }

    return [];
  }, [structuredFileChanges, centralizedDiffEvent]);

  const filesChanged = fileChanges.length;
  const totalAdded = fileChanges.reduce((sum, file) => sum + file.added, 0);
  const totalDeleted = fileChanges.reduce((sum, file) => sum + file.deleted, 0);

  const visibleChanges = fileChanges.slice(0, 12);

  const undoMessageId = messageId;

  const handleUndo = () => {
    if (!undoMessageId) {
      return;
    }
    vscode.postMessage({
      type: "undoMessageChanges",
      messageId: undoMessageId,
      sessionId: sessionId || undefined,
    });
  };

  const handleReview = () => {
    vscode.postMessage({
      type: "reviewMessageChanges",
      files: fileChanges.map((file) => file.file),
    });
  };
  const [expandedByFile, setExpandedByFile] = useState<Record<string, boolean>>({});
  const normalizePath = normalizeFileChangePathForComparison;
  const [fetchedPreviewByFile, setFetchedPreviewByFile] = useState<
    Record<string, { header?: string; lines: string[] }>
  >({});

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event?.data as
        | {
            type?: string;
            file?: string;
            messageId?: string;
            diffExcerpt?: { header?: string; lines?: string[] };
          }
        | undefined;
      if (!data || data.type !== "messageFileDiffPreview") {
        return;
      }
      if (messageId && data.messageId && data.messageId !== messageId) {
        return;
      }
      const file = (data.file || "").trim();
      const lines = Array.isArray(data.diffExcerpt?.lines)
        ? data.diffExcerpt!.lines.filter(
            (line): line is string => typeof line === "string" && line.trim().length > 0,
          )
        : [];
      if (!file || lines.length === 0) {
        return;
      }
      setFetchedPreviewByFile((prev) => ({
        ...prev,
        [normalizePath(file)]: {
          header: data.diffExcerpt?.header,
          lines,
        },
      }));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [messageId]);

  const toggleExpanded = (file: string) => {
    const key = normalizePath(file);
    const hasLocalPreview = !!fetchedPreviewByFile[key];
    const current = visibleChanges.find(
      (change) => normalizePath(change.file) === key,
    );
    const hasExistingPreview =
      !!current &&
      Array.isArray(current.diffExcerpt?.lines) &&
      current.diffExcerpt.lines.length > 0;
    if (!hasLocalPreview && !hasExistingPreview && messageId) {
      vscode.postMessage({
        type: "getMessageFileDiffPreview",
        messageId,
        sessionId: sessionId || undefined,
        file,
      });
    }
    setExpandedByFile((prev) => ({
      ...prev,
      [file]: !prev[file],
    }));
  };

  if (fileChanges.length === 0) {
    return null;
  }

  return (
    <div className="mx-4 overflow-hidden rounded-lg border border-oc-border-soft bg-oc-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-oc-text">
          <FileCode className="h-3 w-3 shrink-0 oc-readable-accent" />
          <span className="font-medium tracking-[0.01em] text-oc-text-soft">
            {filesChanged} {filesChanged === 1 ? "file" : "files"} changed
          </span>
          {(totalAdded > 0 || totalDeleted > 0) && (
            <DiffStats added={totalAdded} deleted={totalDeleted} />
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!undoMessageId}
            className="inline-flex items-center gap-1 rounded-md border border-oc-border-soft bg-white/[0.025] px-1.5 py-0.5 text-[10px] oc-text-secondary transition-colors hover:border-oc-border hover:bg-white/[0.05] hover:text-oc-text-soft"
            title={
              undoMessageId
                ? "Undo changes from this assistant message"
                : "Undo unavailable: no message identifier for this change set"
            }
          >
            <Undo2 className="h-2.5 w-2.5" />
            Undo
          </button>
          <button
            type="button"
            onClick={handleReview}
            className="inline-flex items-center gap-1 rounded-md border border-oc-border-soft bg-white/[0.025] px-1.5 py-0.5 text-[10px] oc-text-secondary transition-colors hover:border-oc-border hover:bg-white/[0.05] hover:text-oc-text-soft"
          >
            <ArrowUpRight className="h-2.5 w-2.5" />
            Review
          </button>
        </div>
      </div>
      <div className="border-t border-oc-border-soft">
        <div className="space-y-0.5 p-1">
          {visibleChanges.map((fileChange) => {
            const fetchedPreview = fetchedPreviewByFile[normalizePath(fileChange.file)];
            const previewExcerpt = fetchedPreview
              ? {
                  header: fetchedPreview.header,
                  lines: fetchedPreview.lines,
                }
              : fileChange.diffExcerpt;
            const hasPreview =
              Array.isArray(previewExcerpt?.lines) && previewExcerpt.lines.length > 0;
            const isExpanded = !!expandedByFile[fileChange.file];
            const filename = fileChange.file.split(/[\\/]/).pop() ?? fileChange.file;
            const dirname = fileChange.file !== filename
              ? fileChange.file.slice(0, fileChange.file.length - filename.length - 1)
              : '';
            const compactDirname = compactDisplayDir(dirname);

            return (
              <div
                key={normalizePath(fileChange.file)}
                className="overflow-hidden rounded-md border border-oc-border-soft transition-colors hover:border-oc-border"
              >
                <div className="flex items-center justify-between px-2.5 py-0.5 hover:bg-white/[0.02] transition-colors">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    onClick={() =>
                      vscode.postMessage({
                        type: "openDiff",
                        file: fileChange.file,
                      })
                    }
                  >
                    <button
                      type="button"
                      aria-label={isExpanded ? "Collapse" : "Expand"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpanded(fileChange.file);
                      }}
                      className="shrink-0 text-oc-text-soft hover:text-oc-text transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-2.5 w-2.5" />
                      ) : (
                        <ChevronRight className="h-2.5 w-2.5" />
                      )}
                    </button>
                    <FileText className="h-2.5 w-2.5 shrink-0 text-oc-text-soft" />
                    <span className="truncate text-[10px] font-medium text-oc-text">{filename}</span>
                    {compactDirname && (
                      <span className="hidden truncate text-[9px] font-medium text-oc-text-soft sm:inline">
                        {compactDirname}
                      </span>
                    )}
                  </button>

                  <div className="flex flex-shrink-0 items-center gap-1.5 text-[11px] font-medium">
                    {fileChange.added > 0 && (
                      <span className="text-oc-green">+{fileChange.added}</span>
                    )}
                    {fileChange.deleted > 0 && (
                      <span className="text-oc-red">-{fileChange.deleted}</span>
                    )}
                  </div>
                </div>

                {isExpanded && hasPreview ? (
                  <div className="border-t border-oc-border-soft bg-black/10">
                    <ActivityDiffExcerpt
                      excerpt={{
                        header: previewExcerpt?.header,
                        lines: previewExcerpt?.lines || [],
                      }}
                    />
                  </div>
                ) : isExpanded && !hasPreview ? (
                  <div className="border-t border-oc-border-soft px-2.5 py-1.5 text-[11px] text-oc-text-soft italic">
                    Diff preview unavailable for this file in the current payload.
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {fileChanges.length > visibleChanges.length ? (
        <div className="border-t border-oc-border-soft px-3 py-1 text-[10px] text-oc-text-soft text-center">
          Showing {visibleChanges.length} of {fileChanges.length} changed files
        </div>
      ) : null}
    </div>
  );
});

export function AssistantResponseCard({
  message,
  streaming,
  hideLoadingText,
  isContiguous,
  interactiveEvents,
  messages,
  currentSessionId,
  subagentsByParentMessageId,
  subagentDetailsById,
  availableAgents,
  todoItems,
  hideFileChangesSection,
}: {
  message?: Message;
  streaming?: StreamingState;
  hideLoadingText?: boolean;
  isContiguous?: boolean;
  interactiveEvents?: AppState["interactiveEvents"];
  messages?: Message[];
  currentSessionId?: AppState["currentSessionId"];
  hideFileChangesSection?: boolean;
  subagentsByParentMessageId?: AppState["subagentsByParentMessageId"];
  subagentDetailsById?: AppState["subagentDetailsById"];
  availableAgents?: AppState["availableAgents"];
  todoItems?: AppState["todoItems"];
}) {
  return (
    <AssistantResponseCardInner
      message={message}
      streaming={streaming}
      hideLoadingText={hideLoadingText}
      isContiguous={isContiguous}
      interactiveEvents={interactiveEvents}
      messages={messages}
      currentSessionId={currentSessionId}
      hideFileChangesSection={hideFileChangesSection}
      subagentsByParentMessageId={subagentsByParentMessageId}
      subagentDetailsById={subagentDetailsById}
      availableAgents={availableAgents}
      todoItems={todoItems}
    />
  );
}
export const PermissionCard = memo(function PermissionCard({ perm }: { perm: unknown }) {
  const label = typeof perm === "string" ? perm : JSON.stringify(perm);
  return (
    <div className="oc-message-enter mb-3.5 px-4">
      <div className="rounded-xl border oc-warning-border oc-warning-bg p-3">
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
});

export function ErrorBanner({
  message,
  onRetry,
  retryLabel,
  retryHint,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  retryHint?: string;
}) {
  const errorDetails =
    typeof message === "string" && message.trim().length > 0
      ? message.trim()
      : "Unknown error";

  return (
    <div className="mb-2">
      <div className="oc-error flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="oc-error-icon">
            <AlertCircle className="h-3 w-3 shrink-0 text-[#fca5a5]" />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[#fca5a5]">
            Request failed
          </span>
        </div>

        <div className="oc-error-detail">
          <div className="oc-error-detail-title">
            Error message
          </div>
          <div className="oc-error-detail-content">
            {errorDetails}
          </div>
        </div>

        {onRetry && (
          <div className="flex justify-start">
            <button
              type="button"
              onClick={onRetry}
              className="oc-error-action"
            >
              <RotateCw className="h-3 w-3" />
              <span>{retryLabel || "Retry"}</span>
            </button>
          </div>
        )}
        {retryHint ? (
          <div className="text-[10px] leading-snug text-[#fca5a5]">{retryHint}</div>
        ) : null}
      </div>
    </div>
  );
}


interface InfoBannerProps {
  message?: string;
  error?: DisplayError;
}

export function InfoBanner({ message, error }: InfoBannerProps) {
  // Error type styling configuration - maps to semantic CSS classes
  const errorStyles = {
    api_error: {
      bannerClass: 'oc-banner-error',
      iconClass: 'oc-banner-error-icon',
      icon: AlertCircle
    },
    timeout: {
      bannerClass: 'oc-banner-timeout',
      iconClass: 'oc-banner-timeout-icon',
      icon: Clock
    },
    structured_output_failure: {
      bannerClass: 'oc-banner-structured-output',
      iconClass: 'oc-banner-structured-output-icon',
      icon: AlertTriangle
    },
    unknown: {
      bannerClass: 'oc-banner-unknown',
      iconClass: 'oc-banner-unknown-icon',
      icon: HelpCircle
    }
  };

  // Determine display message and styling
  let displayMessage: string;
  let styles = errorStyles.api_error;
  let Icon = Info;

  if (error) {
    displayMessage = error.message;
    styles = errorStyles[error.type as keyof typeof errorStyles] || errorStyles.unknown;
    Icon = styles.icon;
  } else if (message) {
    displayMessage = typeof message === 'string' && message.trim().length > 0
      ? message.trim()
      : 'Working...';
    styles = errorStyles.api_error; // Default for backward compat
    Icon = Info;
  } else {
    displayMessage = 'Working...';
    styles = errorStyles.api_error;
    Icon = Info;
  }

  return (
    <div className="mb-2">
      <div className={`oc-banner-container ${styles.bannerClass} flex flex-col gap-2 rounded-lg border p-2.5 text-oc-xs transition-all duration-200`}>
        <div className="flex items-center gap-2">
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-md border ${styles.iconClass}`}>
            <Icon className="h-3 w-3" />
          </span>
          <span className="flex-1 font-medium">{displayMessage}</span>
        </div>
      </div>
    </div>
  );
}

export const ThinkingBubble = memo(function ThinkingBubble() {
  return (
    <div className="mb-4 px-4">
      <div className="inline-flex items-center gap-2 rounded-full border border-oc-border-soft bg-oc-panel px-3 py-1.5 text-[11px] font-medium text-oc-text-soft shadow-sm">
        <div className="flex gap-1.5" aria-hidden="true">
          <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: "0s" }} />
          <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: "0.2s" }} />
          <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: "0.4s" }} />
        </div>
        <span>AI is responding...</span>
      </div>
    </div>
  );
});

export const EmptyState = memo(function EmptyState({
  serverStatus,
  serverError,
  receivedInitState,
  currentSessionId,
  messagesBySessionId,
}: {
  serverStatus: AppState["serverStatus"];
  serverError?: string;
  receivedInitState: AppState["receivedInitState"];
  currentSessionId: AppState["currentSessionId"];
  messagesBySessionId: AppState["messagesBySessionId"];
}) {
  const iconUri =
    typeof document !== "undefined"
      ? document.getElementById("root")?.dataset.opencodeIconUri
      : undefined;

  const hasCachedCurrentSessionMessages = Boolean(
    currentSessionId &&
    (messagesBySessionId?.[currentSessionId]?.length ?? 0) > 0,
  );

  const isConnecting = false;

  if (isConnecting) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="flex gap-1.5 mb-4">
          <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: '0s' }} />
          <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: '0.2s' }} />
          <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: '0.4s' }} />
        </div>
        <div className="text-sm text-oc-text-soft opacity-70 font-medium">
          Connecting…
        </div>
      </div>
    );
  }

  // Show error state when server has failed to start
  if (serverStatus === "error" && serverError) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="oc-empty-icon mb-4">
          <AlertCircle className="h-6 w-6" />
        </div>
        <div className="text-xl font-semibold text-oc-text tracking-tight mb-1">
          OpenCode Server Error
        </div>
        <div className="oc-empty-state-error-message text-sm max-w-[400px] leading-relaxed mt-2">
          {serverError}
        </div>
        <div className="text-xs text-oc-text-soft opacity-70 max-w-[400px] leading-relaxed mt-2">
          Please check the extension logs for more details or try restarting the server.
        </div>
      </div>
    );
  }

  return (
    <div className="oc-empty-state">
      {/* Main minimalist hero section containing modern abstract logo and ready title */}
      <div className="oc-empty-hero-simple">
        <div className="oc-empty-logo-container" aria-hidden="true">
          <svg
            width="38"
            height="38"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="oc-empty-logo-svg"
          >
            {/* O - Left ellipse representing Open */}
            <ellipse cx="8" cy="12" rx="4" ry="6" />
            {/* C - Right arc representing Code */}
            <path d="M 22 8 A 4 6 0 0 0 18 6 A 4 6 0 0 0 14 12 A 4 6 0 0 0 18 18 A 4 6 0 0 0 22 16" />
          </svg>
        </div>
        <div className="oc-empty-copy">
          <p className="oc-empty-subtitle">Ready to build?</p>
        </div>
      </div>

      {/* Simplified, elegant keyboard commands helper text */}
      <div className="oc-empty-hint">
        Type a message, <kbd className="oc-empty-kbd">@</kbd> to add files, or <kbd className="oc-empty-kbd">/</kbd> for commands
      </div>
    </div>
  );
});

export function MessageStatus({
  active,
  failed,
}: {
  active: boolean;
  failed: boolean;
}) {
  return (
    <div className="mb-2 px-4 text-xs text-oc-text-soft opacity-70">
      <span className="inline-flex items-center gap-1.5 font-medium">
        {active ? (
          <Loader2 className="h-3 w-3 animate-spin oc-readable-accent" />
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

export const CentralizedDebugPanel = memo(function CentralizedDebugPanel() {
  const [copiedDebugPanel, setCopiedDebugPanel] = useState<"centralized" | null>(null);
  const {
    currentSessionId,
    errorMessages,
    messagesBySessionId,
    rawSdkEventPayloadsBySessionId,
    receivedInitState,
    serverStatus,
    showLogger,
  } = useAppState();

  const centralizedSessionId = currentSessionId;
  const rawSdkEventPayloads = centralizedSessionId && Array.isArray(rawSdkEventPayloadsBySessionId?.[centralizedSessionId]) 
    ? rawSdkEventPayloadsBySessionId[centralizedSessionId] 
    : [];
    
  if (process.env.NODE_ENV !== 'development' && !window.location.search.includes('debug=true') && !showLogger) {
    return null;
  }

  return (
    <div className="mx-4 my-2 rounded-md border border-oc-border bg-oc-panel overflow-hidden text-[10px] font-mono">
      <div className="flex items-center justify-between bg-oc-panel-hover px-2 py-1 border-b border-oc-border">
        <span className="font-semibold text-oc-text">Centralized Data (Debug)</span>
        <button 
          onClick={() => {
            navigator.clipboard.writeText(JSON.stringify({ rawEventStream: { sessionId: centralizedSessionId, rawSdkEventPayloads } }, null, 2));
            setCopiedDebugPanel("centralized");
            setTimeout(() => setCopiedDebugPanel(null), 2000);
          }}
          className="text-oc-text-muted hover:text-oc-text"
        >
          {copiedDebugPanel ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="p-2 max-h-48 overflow-y-auto text-oc-text-muted">
        <pre>{JSON.stringify({ rawEventStream: { sessionId: centralizedSessionId, rawSdkEventPayloads } }, null, 2)}</pre>
      </div>
    </div>
  );
});
