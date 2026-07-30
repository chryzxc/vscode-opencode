import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  memo,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  GitFork,
  FileText,
  Loader2,
  X,
  CornerDownLeft,
  AtSign,
  Terminal,
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
  ArrowUp,
  ArrowDown,
  Brain,
  Ban,
  Database,
  RotateCcw,
  History,
  Plus,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Stepper, StepperItem } from "@/components/ui/stepper";
import { TerminalBlock } from "@/components/ui/TerminalBlock";
import { SearchBlock } from "@/components/ui/SearchBlock";
import { ExpandableStep } from "@/components/ui/ExpandableStep";
import {
  FadedCollapseOverlay,
  useFadedContentOverflow,
} from "@/components/ui/FadedCollapseOverlay";
import { StepIndicator } from "@/components/ui/StepIndicator";
import { cn, formatDuration, toWorkspaceRelativePath } from "@/utils";

import { MarkdownRenderer } from "../components/MarkdownRenderer";
import {
  FALLBACK_ICON_COLOR,
  getFileIconFallbackKind,
  getFileIconThemeClasses,
  hasThemeIcon,
  isLikelyDirectoryPath,
} from "../components/fileIcons";
import { CallOmoAgentStep } from "./components/activity-steps/CallOmoAgentStep";
import { BackgroundOutputStep } from "./components/activity-steps/BackgroundOutputStep";
import { DiffPreviewStep } from "./components/activity-steps/DiffPreviewStep";
import { ActivityTimelineItem } from "./components/activity-steps/ActivityTimelineItem";
import {
  activityTextFingerprint,
  canonicalActivityActionIdentity,
  stableActivityIdentity,
} from "./lib/activityIdentity";
import { centralizedDebugPayloadFingerprint } from "./lib/generated/centralizedDebugPayloadFilter";
import { SearchActivityPreview } from "./components/activity-steps/SearchActivityPreview";
import { ActivityDiffExcerpt } from "./components/ActivityDiffExcerpt";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { CodeSelectionPreviewModal } from "./CodeSelectionPreviewModal";
import { SubagentDetailModal } from "./SubagentDetailModal";

// NEW: Import custom hooks for subagent data access
import { useSubagentsForParentMessage } from "./hooks/useSubagents";
import { DiffStats } from "./DiffStats";
import {
  asString,
  completedQuestionToolPresentation,
  getCentralizedAssistantContentChunksFromRawSdkEventPayloads,
  getCentralizedEventType,
  getCentralizedEventPart,
  latestAssistantMessageIdFromCentralizedTape,
  normalizeCentralizedEventPayloads,
  structuredOutputFromRawSdkEventPayloads,
  isAiResponseEvent,
  extractEventMessageId,
} from "./lib/messageHandler";
import {
  backgroundTaskIdFromReminderText,
} from "./lib/backgroundTaskOwnership";
import { buildBackgroundTaskPresentation } from "./lib/backgroundTaskPresentation";
import {
  hasActiveAssistantReplyInCentralizedTape,
} from "./lib/sessionProcessing";
import { hasSystemMessagePatternInText } from "./lib/store";
import logger from "./lib/logger";
import { FILE_MENTION_REGEX } from "./PanelComponents";

import type {
  ActivityDetail,
  AppState,
  InteractiveEvent,
  Message,
  MessagePart,
  CodeSelectionMessagePart,
  MessageStep,
  Model,
  ReasoningEvent,
  StreamingState,
  StreamingStep,
  StructuredFileChange,
  CentralizedSessionDiffEvent,
  SubagentConversationEvent,
  SubagentDetail,
  SubagentSummary,
  TodoItem,
} from "./lib/types";
import type { DisplayError } from "../../../../src/providers/chat/types";
import { shallowEqual, useAppDispatch, useAppState } from "./lib/store";
import { jumpToMessage } from "./lib/messageJump";
import vscode from "./lib/vscode";
import { copyToClipboard } from "./lib/clipboard";
import {
  getSubagentDisplayActivity,
  getSubagentDisplayDurationMs,
} from "./lib/subagentDuration";
import { config } from "../config";
import {
  getSdkDebugSnapshot,
  subscribeToSdkDebugStore,
} from "./lib/sdkDebugStore";

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

function firstNonEmptyNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
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

function isSyntheticUserToolTextPart(text: string): boolean {
  const normalized = normalizeComparableText(text);
  if (!normalized) {
    return false;
  }
  if (
    normalized.startsWith("called the ") &&
    normalized.includes(" tool with the following input:")
  ) {
    return true;
  }
  return text.includes("<path>") && text.includes("</path>") && text.includes("<content>");
}

function textFromAttachedDataUrl(part: MessagePart): string | undefined {
  const mime = typeof part.mime === "string" ? part.mime.toLowerCase() : "";
  const url = typeof part.url === "string" ? part.url : "";
  if (part.type !== "file" || !mime.startsWith("text/") || !url.startsWith("data:")) {
    return undefined;
  }
  const commaIndex = url.indexOf(",");
  if (commaIndex < 0) return undefined;
  const metadata = url.slice(0, commaIndex).toLowerCase();
  const payload = url.slice(commaIndex + 1);
  try {
    if (metadata.includes(";base64")) {
      return atob(payload);
    }
    return decodeURIComponent(payload);
  } catch {
    return undefined;
  }
}

function isRenderableUserTextPart(part: MessagePart): boolean {
  if (!isRenderableAssistantTextPart(part)) {
    return false;
  }
  if ((part as { synthetic?: unknown }).synthetic === true) {
    return false;
  }
  const text =
    typeof part.message === "string"
      ? part.message
      : typeof part.text === "string"
        ? part.text
        : typeof part.content === "string"
          ? part.content
          : "";
  return (
    !!text &&
    !isSyntheticUserToolTextPart(splitInjectedSystemPromptFromUserText(text).userText)
  );
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
    normalized.includes("model did not produce structured output") ||
    normalized.includes("structured output error") ||
    normalized.includes("empty structured payload") ||
    normalized.includes("valid structured response") ||
    normalized.includes("json_schema") ||
    normalized.includes("structuredoutput")
  );
}

const SUBAGENT_HUES = [12, 36, 58, 92, 128, 166, 198, 228, 264, 312, 338];

function getStableHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = value.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
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
  parentResponseFinished = false,
): SubagentSummary["status"] {
  // A parent response is authoritative for this UI. If it has already
  // finalized, a child that never emitted its own terminal event cannot still
  // be running; retain the source data but present the stale live state as
  // cancelled.
  const sourceStatus = detail?.status || subagent.status;
  if (
    parentResponseFinished &&
    (sourceStatus === "running" || sourceStatus === "pending")
  ) {
    return "cancelled";
  }
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

  // A persisted end time is a terminal signal even when a provider omits a
  // literal `stop` part (some tool-driven agents finish with tool-calls).
  // Do not downgrade that completed record back to Running.
  const hasEnded = subagent.endedAt || detail?.endedAt;
  if (
    hasEnded &&
    !detail?.errorText &&
    (sourceStatus === "running" || sourceStatus === "pending" || sourceStatus === "done")
  ) {
    return "done";
  }

  const detailStatus = detail?.status;
  if (detailStatus === "error" || detailStatus === "orphaned" || detailStatus === "cancelled") {
    return detailStatus;
  }
  if (subagent.status === "cancelled") {
    return "cancelled";
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

const DEFERRED_CHAT_CARD_STYLE: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "320px",
};

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

// Component to render command-like tool input and output in the shared terminal preview.
function TerminalBlockWithOutput({
  event,
  messageContent,
}: {
  event: DisplayEvent;
  messageContent: string;
}) {
  const input = event.activityDetail?.input as Record<string, unknown> | undefined;
  const globPattern = typeof input?.pattern === "string" ? input.pattern.trim() : "";
  const isGlob = event.label.trim().toLowerCase() === "glob";
  // Glob has the same input/output contract as Bash. Render the actual glob
  // pattern as the terminal command so the activity is inspectable at a glance.
  const command = isGlob && globPattern
    ? `glob ${globPattern}`
    : (input?.["command"] as string) || event.activityDetail?.command || event.summary;

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
      title={isGlob ? "Glob output" : "Bash output"}
      command={command}
      output={output}
    />
  );
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

function getImplementationPlanPrelude(
  plan?: Pick<NonNullable<Message["plan"]>, "summary" | "intro"> | null,
): string {
  if (!plan) {
    return "";
  }
  return firstNonEmptyString(plan.summary, plan.intro) ?? "";
}

function shouldDisplayImplementationPlanCard(params: {
  responseType?: string;
  plan?: NonNullable<Message["plan"]>;
  message?: Message;
  messageId?: string;
  messages?: Message[];
}): boolean {
  const { responseType, plan, message, messageId, messages } = params;
  if (responseType !== "implementation_plan" || !plan) {
    return false;
  }

  if (!plan.file) {
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

  return ownIndex === Math.max(...matchingPlanIndexes);
}

function shouldDisplayWalkthroughCard(params: {
  walkthrough?: NonNullable<Message["walkthrough"]>;
  message?: Message;
  messageId?: string;
  messages?: Message[];
}): boolean {
  const { walkthrough, message, messageId, messages } = params;
  if (!walkthrough?.file) return false;
  const ownIndex = (messages || []).findIndex(
    (candidate) => candidate === message || (!!messageId && (candidate.info?.id === messageId || candidate.id === messageId)),
  );
  if (ownIndex < 0) return true;
  const matchingIndexes = (messages || [])
    .map((candidate, index) => {
      const structured = structuredOutputFromRawSdkEventPayloads(candidate.rawSdkEventPayloads);
      const candidateWalkthrough = structured?.walkthrough ?? candidate.walkthrough;
      return areLikelySamePlanFilePath(candidateWalkthrough?.file, walkthrough.file) ? index : -1;
    })
    .filter((index) => index >= 0);
  return matchingIndexes.length === 0 || ownIndex === Math.max(...matchingIndexes);
}

function getRenderablePlanResponseChunks(params: {
  visibleResponseBodyChunks: string[];
  planPrelude: string;
  shouldShowPlanCard: boolean;
  cardMessage?: Message;
}): {
  visibleResolvedContent: string;
  visiblePlanPrelude: string;
  effectiveResponseContent: string;
  hasVisibleResponseBody: boolean;
  hasPreludeResponseBody: boolean;
  hasPrimaryResponseBody: boolean;
  hasResponseContent: boolean;
  showResponseBody: boolean;
  responseChunksToRender: string[];
} {
  const {
    visibleResponseBodyChunks,
    planPrelude,
    shouldShowPlanCard,
    cardMessage,
  } = params;
  const joinedResponseBody = visibleResponseBodyChunks.join("\n\n");
  const resolvedContentMatchesError = messageDisplaysSameErrorText(
    cardMessage,
    joinedResponseBody,
  );
  const visibleResolvedContent = resolvedContentMatchesError ? "" : joinedResponseBody;
  const suppressAssistantChunksForPlanCard = shouldShowPlanCard;
  const trimmedPlanPrelude = planPrelude.trim();
  const visiblePlanPrelude = suppressAssistantChunksForPlanCard
    ? trimmedPlanPrelude
    : visibleResolvedContent.trim().length === 0
      ? trimmedPlanPrelude
      : "";
  const hasVisibleResponseBody =
    !suppressAssistantChunksForPlanCard &&
    visibleResponseBodyChunks.some((chunk) => chunk.trim().length > 0);
  const hasPreludeResponseBody = visiblePlanPrelude.length > 0;
  const responseChunksToRender = hasVisibleResponseBody
    ? visibleResponseBodyChunks
    : visiblePlanPrelude
      ? [visiblePlanPrelude]
      : [];

  return {
    visibleResolvedContent,
    visiblePlanPrelude,
    effectiveResponseContent:
      !suppressAssistantChunksForPlanCard && visibleResolvedContent.trim().length > 0
        ? visibleResolvedContent
        : visiblePlanPrelude,
    hasVisibleResponseBody,
    hasPreludeResponseBody,
    hasPrimaryResponseBody:
      hasVisibleResponseBody || hasPreludeResponseBody || shouldShowPlanCard,
    hasResponseContent: hasVisibleResponseBody || hasPreludeResponseBody,
    showResponseBody: hasVisibleResponseBody || hasPreludeResponseBody,
    responseChunksToRender,
  };
}

function normalizePathForComparison(path?: string): string {
  return (path || "").trim().replace(/^file:\/\//i, "").replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
}

function pathsMatch(left?: string, right?: string): boolean {
  const normalizedLeft = normalizePathForComparison(left);
  const normalizedRight = normalizePathForComparison(right);
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

function isDirectoryActivityPath(
  filePath?: string,
  activityDetail?: ActivityDetail,
): boolean {
  if (!filePath) {
    return false;
  }

  if (activityDetail?.isDirectory === true) {
    return true;
  }

  if (activityDetail?.metadata?.isDirectory === true) {
    return true;
  }

  const input = asRecord(activityDetail?.input);
  if (!input) {
    return false;
  }

  const explicitDirectoryKeys = [
    input.directory,
    input.directoryPath,
    input.directorypath,
    input.searchDirectory,
    input.searchdirectory,
  ];
  if (explicitDirectoryKeys.some((candidate) => pathsMatch(asString(candidate), filePath))) {
    return true;
  }

  if (activityDetail?.kind === "read" && isLikelyDirectoryPath(filePath)) {
    return true;
  }

  const tool = (activityDetail?.tool || "").trim().toLowerCase();
  if (!["glob", "search", "grep", "ripgrep", "ast-grep", "find"].includes(tool)) {
    return false;
  }

  return pathsMatch(
    asString(input.searchPath) || asString(input.searchpath) || asString(input.path),
    filePath,
  );
}

export function FileIcon({
  filePath,
  isDirectory,
  className,
}: {
  filePath?: string;
  isDirectory?: boolean;
  className?: string;
}) {
  const resolvedDirectory = useMemo(
    () => getFileIconFallbackKind({ filePath, isDirectory }) === "folder",
    [filePath, isDirectory],
  );
  const [showSvgFallback, setShowSvgFallback] = useState(false);
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const themeClasses = useMemo(
    () => getFileIconThemeClasses({ filePath, isDirectory: resolvedDirectory }),
    [filePath, resolvedDirectory],
  );
  const { themeCssVersion } = useAppState(
    (state) => ({ themeCssVersion: state.themeCssVersion }),
    shallowEqual,
  );

  useEffect(() => {
    setShowSvgFallback(false);
  }, [filePath, resolvedDirectory, themeCssVersion]);

  useEffect(() => {
    const icon = iconRef.current;
    if (!icon) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (hasThemeIcon(icon)) {
        return;
      }

      if (!showSvgFallback) {
        setShowSvgFallback(true);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [filePath, resolvedDirectory, showSvgFallback, themeCssVersion]);

  return (
    <span
      ref={iconRef}
      className={cn(
        "file-icon",
        themeClasses,
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
        getFileIconFallbackKind({ filePath, isDirectory: resolvedDirectory }) === "folder" ? (
          <svg
            className="file-icon-svg"
            viewBox="0 0 16 16"
            width="16"
            height="16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M1.5 3.5h4.25l1.5 1.5h7.25v8.5H1.5V3.5Z"
              fill={FALLBACK_ICON_COLOR}
              opacity="0.18"
            />
            <path
              d="M1.5 3.5h4.25l1.5 1.5h7.25v8.5H1.5V3.5Z"
              stroke={FALLBACK_ICON_COLOR}
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
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
        )
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
  role?: string,
): string {
  if (!parts) {
    return "";
  }
  const isUserMessage = role?.toLowerCase() === "user";
  const attachmentContents = new Set(
    parts
      .map((part) => asRecord(part) as MessagePart | undefined)
      .filter((part): part is MessagePart => !!part)
      .map((part) => textFromAttachedDataUrl(part))
      // SDK text parts are trimmed before rendering, while the pasted data URL
      // preserves its final newline. Normalize both sides so an attached text
      // snippet cannot also leak into the user bubble as a duplicate body.
      .filter((text): text is string => typeof text === "string")
      .map((text) => text.trim())
      .filter((text) => text.length > 0),
  );
  return parts
    .map((part) => {
      const partRec = asRecord(part);
      if (
        !partRec ||
        !(
          isUserMessage
            ? isRenderableUserTextPart(partRec as MessagePart)
            : isRenderableAssistantTextPart(partRec as MessagePart)
        )
      ) {
        return "";
      }
      const text = (
        (partRec.message as string | undefined) ??
        (partRec.text as string | undefined) ??
        (partRec.content as string | undefined) ??
        ""
      ).trim();
      return isUserMessage && attachmentContents.has(text) ? "" : text;
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

  const question = asRecord(structured?.question) || asRecord(structured);
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
    // Safely collect any extra message IDs that were merged into this 
    // unified turn during coalescing (e.g. from tool call phases), 
    // ensuring their centralized streaming events remain in scope.
    ...(Array.isArray((message as any).coalescedIds) ? (message as any).coalescedIds : []),
  ];
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      candidates.add(value.trim());
    }
  }
  return candidates;
}

function buildAssistantScopeMessageIds(options: {
  message?: Message;
  assistantMessageId?: string | null;
  streamingMessageId?: string | null;
  assistantTurnMessageId?: string | null;
  assistantTurnRootMessageId?: string | null;
  assistantTurnAnchorMessageId?: string | null;
  additionalMessageIds?: readonly string[];
  includeLiveTurnIds?: boolean;
}): Set<string> {
  const messageCandidates = collectMessageIdentityCandidates(options.message);
  const ids = new Set<string>(messageCandidates);
  // A single user turn can move through several assistant SDK message IDs
  // (tool-calls -> next assistant phase -> final text). When this card is the
  // active turn, retain its root IDs and add the current live phase so newly
  // rendered activity cannot disappear during that phase transition.
  if (
    messageCandidates.size > 0 &&
    !options.includeLiveTurnIds &&
    (options.additionalMessageIds?.length ?? 0) === 0
  ) {
    return ids;
  }
  for (const candidate of [
    options.assistantMessageId,
    options.streamingMessageId,
    options.assistantTurnMessageId,
    options.assistantTurnRootMessageId,
    options.assistantTurnAnchorMessageId,
    ...(options.additionalMessageIds ?? []),
  ]) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      ids.add(candidate.trim());
    }
  }

  return ids;
}

function collectCentralizedTurnMessageIdCandidates(
  rawSdkEventPayloads: unknown[] | undefined,
): Set<string> {
  const candidates = new Set<string>();
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return candidates;
  }

  for (const payload of rawSdkEventPayloads) {
    const rec = asRecord(payload);
    if (!rec) continue;

    const part = getCentralizedEventPart(rec);
    const properties = asRecord(rec.properties);
    const payloadRecord = asRecord(rec.payload);
    const payloadSyncEvent = asRecord(payloadRecord?.syncEvent);
    const payloadSyncPart = asRecord(payloadSyncEvent?.data)?.part as Record<string, unknown> | null;
    const syncEvent = asRecord(rec.syncEvent);
    const syncPart = asRecord(syncEvent?.data)?.part as Record<string, unknown> | null;

    const ids = [
      asString(part?.messageID),
      asString(part?.messageId),
      asString(properties?.messageID),
      asString(properties?.messageId),
      asString(payloadRecord?.messageID),
      asString(payloadRecord?.messageId),
      asString(payloadSyncPart?.messageID),
      asString(payloadSyncPart?.messageId),
      asString(syncPart?.messageID),
      asString(syncPart?.messageId),
      asString(rec.messageID),
      asString(rec.messageId),
    ];

    for (const id of ids) {
      const trimmed = id.trim();
      if (trimmed) {
        candidates.add(trimmed);
      }
    }
  }

  return candidates;
}

function eventBelongsToAssistantScope(
  event: unknown,
  assistantScopeMessageIds: Set<string>,
): boolean {
  if (assistantScopeMessageIds.size === 0) {
    return false;
  }
  const eventMessageId = extractSemanticEventMessageId(event);
  return !!eventMessageId && assistantScopeMessageIds.has(eventMessageId);
}

function extractSemanticEventMessageId(event: unknown): string | null {
  const eventRecord = asRecord(event);
  if (!eventRecord) {
    return null;
  }

  const payloadRecord = asRecord(eventRecord.payload);
  const info =
    asRecord(asRecord(eventRecord.properties)?.info) ||
    asRecord(eventRecord.info) ||
    asRecord(asRecord(payloadRecord?.properties)?.info) ||
    asRecord(payloadRecord?.info);

  const part = getCentralizedEventPart(eventRecord);

  const syncData =
    asRecord(asRecord(eventRecord.syncEvent)?.data) ||
    asRecord(asRecord(payloadRecord?.syncEvent)?.data);
  const syncInfo = asRecord(syncData?.info);
  const syncPart = asRecord(syncData?.part);

  const messageRecord =
    asRecord(eventRecord.message) ||
    asRecord(asRecord(eventRecord.properties)?.message) ||
    asRecord(payloadRecord?.message) ||
    asRecord(asRecord(payloadRecord?.properties)?.message);

  const directId = firstNonEmptyString(
    asString(info?.id),
    asString(info?.messageID),
    asString(info?.messageId),
    asString(part?.messageID),
    asString(part?.messageId),
    asString(syncInfo?.id),
    asString(syncInfo?.messageID),
    asString(syncInfo?.messageId),
    asString(syncPart?.messageID),
    asString(syncPart?.messageId),
    asString(messageRecord?.id),
    asString(messageRecord?.messageID),
    asString(messageRecord?.messageId),
    asString(eventRecord.messageId),
    asString(eventRecord.messageID),
    asString(payloadRecord?.messageId),
    asString(payloadRecord?.messageID),
  );
  if (directId) {
    return directId;
  }

  // Centralized/session tape rows often carry a wrapper event id such as `evt_*`
  // even when they are not actually scoped to a single assistant message. Those
  // wrapper ids are useful for lifecycle tracking, but they are NOT safe for
  // assistant-card scoping. If we treat them as semantic message ids, session-
  // level metadata rows like `session.updated` and `session.next.*` stop looking
  // like shared turn metadata and the top response header loses agent/model/
  // thinking labels after hydration.
  const fallbackId = firstNonEmptyString(asString(payloadRecord?.id), asString(eventRecord.id));
  if (!fallbackId || fallbackId.toLowerCase().startsWith("evt_")) {
    return null;
  }

  return fallbackId;
}

function isAssistantScopedNoIdPayloadCandidate(event: unknown): boolean {
  if (extractSemanticEventMessageId(event)) {
    return false;
  }

  const record = asRecord(event);
  if (!record) {
    return false;
  }

  const properties = asRecord(record.properties);
  const info = getCentralizedEventInfo(record);
  const part = getCentralizedEventPart(record);
  const eventType = firstNonEmptyString(record.type, record.event, record.kind)?.toLowerCase() ?? "";
  const role = firstNonEmptyString(info?.role, record.role, properties?.role)?.toLowerCase() ?? "";
  const toolName = firstNonEmptyString(part?.tool, part?.name)?.toLowerCase() ?? "";

  const hasStructuredPayload =
    !!asRecord(record.structured) ||
    !!asRecord(record.structuredOutput) ||
    !!asRecord((record as Record<string, unknown>).structured_output) ||
    !!asRecord(properties?.structured) ||
    !!asRecord(properties?.structuredOutput) ||
    !!asRecord((properties as Record<string, unknown> | null)?.structured_output) ||
    !!asRecord(info?.structured) ||
    !!asRecord(info?.structuredOutput) ||
    !!asRecord((info as Record<string, unknown> | null)?.structured_output) ||
    toolName === "structuredoutput" ||
    toolName === "structured_output";

  const hasAssistantText =
    firstNonEmptyString(
      info?.text,
      info?.content,
      info?.message,
      record.text,
      record.content,
      record.message,
      properties?.text,
      properties?.content,
      properties?.message,
      part?.text,
      part?.content,
      part?.message,
    ) !== undefined;

  const model = asRecord(info?.model);
  const hasAssistantHeaderMetadata =
    !!firstNonEmptyString(
      info?.agent,
      properties?.agent,
      model?.providerID,
      model?.modelID,
      model?.id,
      model?.variant,
      info?.providerID,
      info?.modelID,
      info?.variant,
    );

  const isAssistantLikeTerminalEvent =
    eventType === "message.completed" ||
    eventType === "session.completed" ||
    eventType === "message.updated";

  const isAssistantHeaderMetadataEvent =
    eventType === "session.next.agent.switched" ||
    eventType === "session.next.model.switched" ||
    eventType === "session.updated";

  return (role === "assistant" || isAssistantLikeTerminalEvent) && (
    hasStructuredPayload ||
    hasAssistantText
  ) || (isAssistantHeaderMetadataEvent && hasAssistantHeaderMetadata);
}

function normalizeComparableText(value: unknown): string {
  return normalizeErrorLikeValue(value)
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeComparableActivityText(value: unknown): string {
  return normalizeComparableText(value)
    .replace(/\.{2,}/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isActivityTextRedundantWithTitle(
  title: unknown,
  content: unknown,
): boolean {
  const normalizedTitle = normalizeComparableActivityText(title);
  const normalizedContent = normalizeComparableActivityText(content);
  if (!normalizedTitle || !normalizedContent) {
    return false;
  }
  if (normalizedTitle === normalizedContent) {
    return true;
  }

  const compactTitle = normalizedTitle.replace(/\s+/g, "");
  const compactContent = normalizedContent.replace(/\s+/g, "");
  return compactTitle.length > 0 && compactTitle === compactContent;
}

function getVisibleDefaultActivitySummary(
  title: unknown,
  summary: unknown,
  fallback?: unknown,
): string {
  if (isActivityTextRedundantWithTitle(title, summary)) {
    return isActivityTextRedundantWithTitle(title, fallback) ? "" : asString(fallback);
  }
  return asString(summary) || asString(fallback);
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

function collectQuestionPreludeFingerprints(
  groups: Array<
    | { type: "question-output"; key: string; text: string }
    | { type: "activity"; events: Array<{ summary?: string; activityDetail?: ActivityDetail }> }
    | { type: "commentary"; event: { summary?: string } }
  >,
): Set<string> {
  const fingerprints = new Set<string>();
  const add = (value: unknown) => {
    const normalized = normalizeComparableText(value);
    if (normalized) {
      fingerprints.add(normalized);
    }
  };

  for (const group of groups) {
    if (group.type === "question-output") {
      add(group.text);
      continue;
    }

    if (group.type !== "activity") {
      continue;
    }

    for (const event of group.events) {
      add(event.summary);
      add(event.activityDetail?.summary);
      add(event.activityDetail?.output);
      add(event.activityDetail?.title);
    }
  }

  return fingerprints;
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

function ImplementationPlanCard({
  plan,
  isRevisedPlan,
  planStatus,
}: {
  plan: NonNullable<Message["plan"]>;
  isRevisedPlan: boolean;
  planStatus?: string;
}) {
  return (
    <div className="plan-card flex items-start justify-between gap-3">
      <div className="plan-card-content flex flex-1 flex-col gap-2 min-w-0">
        {(isRevisedPlan || planStatus === "Executing" || planStatus === "Revision Requested" || planStatus === "Draft") && (
          <div className="flex flex-wrap items-center gap-2">
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
        )}
        <div className="plan-card-title text-oc-xs font-semibold tracking-normal">
          {plan.title || "Implementation Plan"}
        </div>
        {plan.file ? (
          <div className="plan-card-file mt-1 flex items-center gap-1.5 text-[11px] font-medium">
            <FileIcon filePath={plan.file} />
            <span className="truncate" title={plan.file}>
              {toWorkspaceRelativePath(plan.file)}
            </span>
          </div>
        ) : (
          <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-oc-text-soft italic">
            (no file)
          </div>
        )}
      </div>
      <button
        type="button"
        title={`View ${plan.title || "Implementation Plan"}`}
        onClick={() => vscode.postMessage({ type: "viewPlan", plan })}
        className="oc-plan-btn plan-card-action shrink-0 self-start"
      >
        View
      </button>
    </div>
  );
}

function WalkthroughCard({
  walkthrough,
}: {
  walkthrough: NonNullable<Message["walkthrough"]>;
}) {
  return (
    <div className="plan-card walkthrough-card flex items-start justify-between gap-3">
      <div className="plan-card-content flex flex-1 flex-col gap-2 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="plan-status-badge plan-status-badge-neutral rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
            Walkthrough
          </span>
        </div>
        <div className="plan-card-title text-oc-xs font-semibold tracking-normal">
          {walkthrough.title || "Walkthrough"}
        </div>
        {walkthrough.file ? (
          <div className="plan-card-file mt-1 flex items-center gap-1.5 text-[11px] font-medium">
            <FileIcon filePath={walkthrough.file} />
            <span className="truncate" title={walkthrough.file}>
              {toWorkspaceRelativePath(walkthrough.file)}
            </span>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        title={`View ${walkthrough.title}`}
        onClick={() => vscode.postMessage({ type: "viewWalkthrough", walkthrough })}
        className="oc-plan-btn plan-card-action shrink-0 self-start"
      >
        View
      </button>
    </div>
  );
}

function resolveProviderName(
  providerID: string | undefined,
  providerName: string | undefined,
  availableModels: Model[] = [],
): string | undefined {
  if (providerName?.trim()) return providerName.trim();
  if (!providerID) return undefined;
  return (
    availableModels.find((model) => model.providerID === providerID)?.providerName ||
    providerID
  );
}

function formatModelLabel(
  modelID?: string,
  providerID?: string,
  modelName?: string,
  providerName?: string,
  availableModels: Model[] = [],
): string | undefined {
  const model = modelName?.trim() || modelID?.trim();
  const provider = resolveProviderName(providerID, providerName, availableModels);
  if (model && provider) return `${provider} / ${model}`;
  return model || provider;
}

function modelLabel(message?: Message, availableModels: Model[] = []): string {
  if (!message) return "assistant";
  // Check nested info structure first (from streaming)
  const modelObj = message.info?.model;
  if (modelObj && typeof modelObj === "object") {
    const name = (modelObj as Record<string, unknown>).name;
    const modelID = (modelObj as Record<string, unknown>).modelID;
    const label = formatModelLabel(
      typeof modelID === "string" ? modelID : undefined,
      modelObj.providerID,
      typeof name === "string" ? name : undefined,
      modelObj.providerName,
      availableModels,
    );
    if (label) return label;
  }
  // Check top-level model object (from persisted messages)
  if (typeof message.model === "object" && message.model !== null) {
    const name = (message.model as Record<string, unknown>).name;
    const modelID = (message.model as Record<string, unknown>).modelID;
    const label = formatModelLabel(
      typeof modelID === "string" ? modelID : undefined,
      message.model.providerID,
      typeof name === "string" ? name : undefined,
      message.model.providerName,
      availableModels,
    );
    if (label) return label;
  }
  // Check nested info structure
  let model = message.info?.modelID;
  let provider = message.info?.providerID;
  const nestedLabel = formatModelLabel(model, provider, undefined, undefined, availableModels);
  if (nestedLabel) return nestedLabel;
  // Check top-level properties (from persisted messages)
  model ??= (message as Record<string, unknown>).modelID as string | undefined;
  provider ??= (message as Record<string, unknown>).providerID as
    | string
    | undefined;
  return formatModelLabel(model, provider, undefined, undefined, availableModels) ?? "assistant";
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
    // Inline the normalizeDebugStringForDisplay logic
    let normalized = value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed && /^[{\[]/.test(trimmed)) {
        try {
          normalized = JSON.parse(trimmed);
        } catch {
          // Keep original value if parsing fails
        }
      }
    }
    return JSON.stringify(normalized, replacer, 2) ?? "";
  } catch {
    return String(value);
  }
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
  const { ref: previewRef, hasOverflow } = useFadedContentOverflow<HTMLDivElement>();
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
        )} ref={previewRef}>
          <div className={cn(
            "min-w-0 max-w-full",
            variant === "card" ? "pr-1" : "pr-0",
          )}>
            <MarkdownRenderer content={content} className="markdown-body" />
          </div>
          {hasOverflow && <FadedCollapseOverlay
            backgroundClassName={
              variant === "card"
                ? "from-oc-bg-soft via-oc-bg-soft/90 to-transparent"
                : "from-oc-panel-soft/80 via-oc-panel-soft/30 to-transparent"
            }
          />}
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
            </div>
            <div className="mt-1 text-xs oc-text-secondary">
              Command execution details and output
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
  const { ref: previewRef, hasOverflow } = useFadedContentOverflow<HTMLDivElement>();
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
        <div ref={previewRef} className="relative max-h-[140px] overflow-hidden p-2">
          <TerminalBlock command={command} output={output} className="pointer-events-none" />
          {hasOverflow && <FadedCollapseOverlay />}
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
            </div>
            <div className="mt-1 text-xs oc-text-secondary">
              Search query details and results
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
  const { ref: previewRef, hasOverflow } = useFadedContentOverflow<HTMLDivElement>();
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
        <div ref={previewRef} className="relative max-h-[128px] overflow-hidden p-1.5">
          <div>
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
          {hasOverflow && <FadedCollapseOverlay />}
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

function DetailedSearchActivityPreview({
  event,
  isGlobSearch,
}: {
  event: DisplayEvent;
  isGlobSearch: boolean;
}) {
  return <SearchActivityPreview title={event.label} pattern={isGlobSearch ? buildSearchPattern(event.activityDetail?.input?.pattern as string, event.description) : buildSearchPattern(event.activityDetail?.query || event.summary, event.description)} patternInHeader={isGlobSearch} path={isGlobSearch ? undefined : event.filePath} include={event.activityDetail?.input?.include as string || event.activityDetail?.input?.Include as string} outputMode={event.activityDetail?.input?.output_mode as string || event.activityDetail?.input?.outputMode as string} headLimit={event.activityDetail?.input?.head_limit as number || event.activityDetail?.input?.headLimit as number} output={event.activityDetail?.output} isGlobSearch={isGlobSearch} />;
}

type ThoughtItem = {
  key: string;
  text: string;
  messageID?: string;
  partID?: string;
  streamSeq?: number;
  source?: "stream" | "final" | "raw_debug";
  status?: "pending" | "done" | "error";
  /** Unix-ms timestamps from part.time.start / part.time.end for duration display */
  startedAt?: number;
  endedAt?: number;
};
type ProgressItem = {
  key: string;
  mergeKey: string;
  id?: string;
  callID?: string;
  messageID?: string;
  sessionID?: string;
  title: string;
  status: "pending" | "running" | "done" | "error";
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

function questionPromptSummaryFromEventProperties(
  eventProperties: Record<string, unknown> | null,
): string | undefined {
  const questions = Array.isArray(eventProperties?.questions)
    ? eventProperties.questions
    : [];
  const firstQuestion = asRecord(questions[0]);
  const questionText = firstNonEmptyString(
    asString(firstQuestion?.question),
    asString(firstQuestion?.header),
    asString(firstQuestion?.title),
  );
  if (questionText) {
    return questionText;
  }
  if (questions.length > 0) {
    return `${questions.length} question${questions.length === 1 ? "" : "s"}`;
  }
  return undefined;
}

function isQuestionToolName(tool?: string): boolean {
  const normalized = (tool || "").trim().toLowerCase();
  return (
    normalized === "question" ||
    normalized.includes("request_user_input") ||
    normalized.includes("request-user-input")
  );
}

function isQuestionLikeActivityTool(
  tool?: string,
  partType?: string,
): boolean {
  return (
    isQuestionToolName(tool) ||
    (partType || "").trim().toLowerCase() === "question.asked" ||
    (partType || "").trim().toLowerCase() === "question.replied"
  );
}

type CommentaryItem = {
  id?: string;
  text: string;
  streamSeq?: number;
  kind?: "commentary" | "ai_response";
  status?: "pending" | "running" | "done" | "error";
  messageID?: string;
  partID?: string;
};

function ResponseMessageBody({
  content,
  parts,
  className,
  variant = "default",
  isStreaming = false,
}: {
  content?: string[];
  parts?: MessagePart[];
  className?: string;
  variant?: "default" | "bare";
  isStreaming?: boolean;
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
            isStreaming={isStreaming}
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

    const partTimeStart = typeof partTime?.start === "number" ? partTime.start : undefined;
    const partTimeEnd = typeof partTime?.end === "number" ? partTime.end : undefined;
    upsertThoughtItem({
      key,
      text: cleaned,
      streamSeq: index,
      source: "final",
      status,
      startedAt: partTimeStart,
      endedAt: partTimeEnd,
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

  const mergeReasoningPartText = (current: string, incoming: string): string => {
    if (!current) return incoming;
    if (!incoming) return current;

    // The stream reducer normally retains one evolving entry per part. During
    // hydration, however, the same part can briefly be present more than once
    // as a cumulative snapshot. Concatenating those snapshots repeats an
    // entire thought in the UI. Prefer the complete snapshot and append only
    // text that is genuinely new to the part.
    if (current === incoming || current.includes(incoming)) return current;
    if (incoming.includes(current)) return incoming;
    return `${current}\n\n${incoming}`;
  };

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
    const startedAt =
      typeof event?.startedAt === "number" ? event.startedAt : undefined;
    const endedAt =
      typeof event?.endedAt === "number" ? event.endedAt : undefined;
    const partID = asString(event?.partID).trim();
    const messageID = asString(event?.messageID).trim();
    const groupKey = partID || `${createdAt}:${index}`;
    const existing = grouped.get(groupKey);
    const nextText = existing
      ? mergeReasoningPartText(existing.text, resolvedText)
      : resolvedText;

    grouped.set(groupKey, {
      key: existing?.key ?? `stream-${index}-${createdAt}`,
      text: nextText,
      streamSeq: existing?.streamSeq ?? createdAt,
      status: isLiveChunk ? "pending" : "done",
      messageID: existing?.messageID ?? (messageID || undefined),
      partID: existing?.partID ?? (partID || undefined),
      startedAt: existing?.startedAt ?? startedAt,
      endedAt: existing?.endedAt ?? endedAt,
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
    startedAt: item.startedAt,
    endedAt: item.endedAt,
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
    } else if (item.messageID) {
      // A message can contain many reasoning parts. Only fall back to its
      // message ID when the SDK did not supply the part identity.
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
      !item.partID && item.messageID ? `msg:${item.messageID}` : "",
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
  // `steps`, `progressEvents`, and the centralized tape can all carry the
  // same activity in the first live frame. Never return one source unchanged:
  // every source must pass through these semantic keys before it can render.
  const merged: ProgressItem[] = [];
  const indexByKey = new Map<string, number>();

  const addKey = (item: ProgressItem, index: number) => {
    const semanticKey = progressItemIdentityKey(item);
    const normalizedPartType = normalizeComparableText(item.partType);
    const isLifecycleMarker =
      normalizedPartType === "step-start" ||
      normalizedPartType === "step-finish" ||
      normalizedPartType === "step-update";
    // Transport IDs identify SDK envelopes, not necessarily distinct visible
    // actions. The same Read can arrive once from the live event stream and
    // again from a later assistant phase with different message/call IDs.
    // Deduplicate by the visible action across phases; the first row remains
    // in place and mergeProgressItemRecord only enriches it.
    const actionKey = progressVisibleActionIdentity(item);
    if (semanticKey) {
      indexByKey.set(`semantic:${semanticKey}`, index);
    }
    // SDK mirrors can occasionally have different part/call IDs. Keep the
    // action fingerprint as an additional key, but never let mutable output
    // fields define identity.
    if (!isLifecycleMarker && actionKey) {
      indexByKey.set(`action:${actionKey}`, index);
    }
    if (item.mergeKey) {
      indexByKey.set(item.mergeKey, index);
    }
    if (item.callID) {
      indexByKey.set(`call:${item.callID}`, index);
    } else if (item.id) {
      indexByKey.set(`id:${item.id}`, index);
    } else if (item.messageID) {
      // Tool calls are siblings under one assistant message. A message ID is
      // not a tool identity, so use it only when no call/part ID exists.
      indexByKey.set(`msg:${item.messageID}`, index);
    }
    // Generic titles such as "Running read..." identify neither a tool call
    // nor an action. Only use a title when the SDK gave us no semantic, call,
    // part, or message identity at all; otherwise it can replace a rendered
    // Read with an unrelated later Read and make the first row disappear.
    if (!isLifecycleMarker && !semanticKey && !item.callID && !item.id && !item.messageID) {
      indexByKey.set(`title:${normalizeComparableText(item.title)}`, index);
    }
  };

  const ingest = (item: ProgressItem, incomingPreferred: boolean) => {
    const semanticKey = progressItemIdentityKey(item);
    const normalizedPartType = normalizeComparableText(item.partType);
    const isLifecycleMarker =
      normalizedPartType === "step-start" ||
      normalizedPartType === "step-finish" ||
      normalizedPartType === "step-update";
    const actionKey = progressVisibleActionIdentity(item);
    const canUseTitleFallback =
      !isLifecycleMarker && !semanticKey && !item.callID && !item.id && !item.messageID;
    // A tool's input evolves while its call is running (especially File_edit,
    // where old/new strings and patch metadata arrive in separate snapshots).
    // Match the SDK lifecycle ID first so those snapshots enrich one row. The
    // semantic action key remains the fallback for the /event + /global/event
    // mirrors that legitimately carry different transport IDs.
    const keys = [
      // Prefer semantic identity before transport mergeKey. Raw and live
      // mirrors often assign different merge keys to the same visible Read;
      // checking mergeKey first lets that duplicate through.
      semanticKey ? `semantic:${semanticKey}` : "",
      !isLifecycleMarker && actionKey
        ? `action:${actionKey}`
        : "",
      item.callID ? `call:${item.callID}` : "",
      !item.callID && item.id ? `id:${item.id}` : "",
      !item.callID && !item.id && item.messageID ? `msg:${item.messageID}` : "",
      item.mergeKey,
      canUseTitleFallback ? `title:${normalizeComparableText(item.title)}` : "",
    ].filter(Boolean);

    const matchingKey = keys.find((key) => indexByKey.has(key));
    if (typeof matchingKey === "string") {
      const existingIndex = indexByKey.get(matchingKey);
      if (typeof existingIndex === "number") {
        const existing = merged[existingIndex];
        merged[existingIndex] = incomingPreferred
          ? mergeProgressItemRecord(existing, item)
          : mergeProgressItemRecord(item, existing);
        addKey(merged[existingIndex], existingIndex);
      }
      return;
    }

    const nextIndex = merged.length;
    merged.push(item);
    addKey(item, nextIndex);
  };

  finalizedItems.forEach((item) => ingest(item, true));
  streamingItems.forEach((item) => ingest(item, preferStreaming));

  return merged;
}

/**
 * OpenCode represents a Read range in two equivalent SDK shapes. Streaming
 * tool input commonly has `offset` / `limit`; hydrated snapshots can instead
 * place `lineStart` / `lineEnd` under `state.metadata.display`. Normalize the
 * latter into the input contract once so both rendering paths show the same
 * line label without parsing source text.
 */
function normalizeReadRangeInput(
  tool: string | undefined,
  input: Record<string, unknown> | null,
  metadata: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  if (!input) return undefined;
  if (tool?.trim().toLowerCase() !== "read") return input;

  const display = asRecord(metadata?.display);
  const inputOffset = Number(input.offset);
  const inputLimit = Number(input.limit);
  const displayStart = Number(display?.lineStart);
  const displayEnd = Number(display?.lineEnd);
  const offset = Number.isInteger(inputOffset) && inputOffset >= 1
    ? inputOffset
    : Number.isInteger(displayStart) && displayStart >= 1
      ? displayStart
      : undefined;
  const limit = Number.isInteger(inputLimit) && inputLimit >= 1
    ? inputLimit
    : offset !== undefined && Number.isInteger(displayEnd) && displayEnd >= offset
      ? displayEnd - offset + 1
      : undefined;

  if (offset === undefined && limit === undefined) return input;

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) normalized[key] = value;
  }
  if (offset !== undefined) normalized.offset = offset;
  if (limit !== undefined) normalized.limit = limit;
  return normalized;
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

    // File watcher notifications describe filesystem side effects, not agent
    // activity. They often repeat for one edit and must stay out of both the
    // live and rehydrated timeline. Actual agent file edits are represented by
    // their tool/patch parts below.
    if (eventType === "file.edited" || eventType === "file.watcher.updated") {
      rememberSkipped("filesystem_notification", event, index);
      continue;
    }

    if (eventType === "question.asked") {
      const toolRecord = asRecord(eventProperties?.tool);
      const summary = questionPromptSummaryFromEventProperties(eventProperties);
      const callID = firstNonEmptyString(
        asString(toolRecord?.callID),
        asString(toolRecord?.callId),
      );
      const requestID = firstNonEmptyString(
        asString(eventProperties?.id),
        asString(eventProperties?.requestID),
        asString(eventProperties?.requestId),
      );
      const sessionID = firstNonEmptyString(
        asString(eventProperties?.sessionID),
        asString(eventProperties?.sessionId),
        asString(event.sessionID),
        asString(event.sessionId),
      );
      const eventMessageID = firstNonEmptyString(
        asString(toolRecord?.messageID),
        asString(toolRecord?.messageId),
        messageID,
      );
      if (!callID && !requestID && !eventMessageID && !summary) {
        diagnostics.noRenderableProgress += 1;
        rememberSkipped("question_asked_no_renderable_progress", event, index);
        continue;
      }

      rawSteps.push({
        id: requestID || firstNonEmptyString(asString(event.id), asString(event.eventId)),
        callID: callID || undefined,
        messageID: eventMessageID || undefined,
        sessionID,
        title: "Requested clarification",
        type: "tool",
        status: "done",
        source: "raw_debug",
        partType: eventType,
        internal: false,
        streamSeq: index,
        activityDetail: {
          kind: "other",
          summary: summary || "Requested clarification",
          tool: "question",
          input: eventProperties ?? undefined,
          output: undefined,
          metadata: {
            questionCount: Array.isArray(eventProperties?.questions)
              ? eventProperties.questions.length
              : 0,
          },
          sessionID,
        },
      });
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
    const normalizedInput = normalizeReadRangeInput(tool, input, metadata);
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
    const readDisplay = tool === "read" ? asRecord(metadata?.display) : null;
    if (Number.isInteger(Number(readDisplay?.lineStart))) {
      compactMetadata.lineStart = Number(readDisplay?.lineStart);
    }
    if (Number.isInteger(Number(readDisplay?.lineEnd))) {
      compactMetadata.lineEnd = Number(readDisplay?.lineEnd);
    }

    const isQuestionTool = isQuestionToolName(tool);
    const questionPresentation = completedQuestionToolPresentation(tool, status, output);
    const title =
      (questionPresentation.isCompleted
        ? questionPresentation.title
        : undefined) ||
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
        kind: tool === "read" ? "read" : isQuestionTool ? "other" : tool || "tool_call",
        summary: filePath || preview || output || title,
        tool,
        command: firstNonEmptyString(
          asString(input?.command),
          asString(part.command),
          asString(state?.command),
        ) || undefined,
        file: filePath,
        input: normalizedInput,
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

  const projectedItems = progressItemsFromSteps(rawSteps, "raw-event");

  return projectedItems;
}

function normalizeProgressStatus(
  value?: string | null,
): "pending" | "running" | "done" | "error" {
  const v = value?.toLowerCase();
  if (
    v === "running" ||
    v === "in_progress" ||
    v === "processing" ||
    v === "streaming"
  ) {
    return "running";
  }
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

  // Filter placeholder rows that only say "step" and carry no user-facing data.
  if (!hasUserFacingActivity && normalizedTitle === "step" && type !== "tool") {
    return false;
  }

  return true;
}

function progressItemStatusRank(status: ProgressItem["status"]): number {
  switch (status) {
    case "error":
      return 3;
    case "done":
      return 2;
    case "running":
      return 1;
    case "pending":
    default:
      return 0;
  }
}

function progressItemIdentityKey(item: {
  id?: string;
  callID?: string;
  messageID?: string;
  title?: string;
  filePath?: string;
  partType?: string;
  activityDetail?: ActivityDetail;
}): string {
  const normalizedPartType = normalizeComparableText(item.partType);
  const isLifecycleMarker =
    normalizedPartType === "step-start" ||
    normalizedPartType === "step-finish" ||
    normalizedPartType === "step-update";
  if (isLifecycleMarker && !item.callID && !item.id && !item.messageID) {
    // Lifecycle boundaries are not repeated tool snapshots. Do not derive an
    // identity from their generic title/action when the SDK omitted IDs.
    return "";
  }
  const stableIdentity = stableActivityIdentity({
    callID: item.callID,
    id: item.id,
    messageID: item.messageID,
    tool: item.activityDetail?.tool,
    title: item.title,
    filePath: item.filePath,
    partType: item.partType,
  });
  if (stableIdentity) {
    return stableIdentity;
  }

  const actionIdentity = canonicalActivityActionIdentity(
    item.activityDetail?.tool,
    item.activityDetail?.input,
  );
  if (actionIdentity) {
    return actionIdentity;
  }

  const detailSummary = firstNonEmptyString(
    asString(item.activityDetail?.summary),
    asString(item.activityDetail?.output),
    asString(item.activityDetail?.title),
    asString(item.activityDetail?.tool),
  );

  return [
    item.callID ? `call:${item.callID}` : "",
    item.id ? `id:${item.id}` : "",
    item.messageID ? `msg:${item.messageID}` : "",
    `title:${normalizeComparableText(item.title)}`,
    item.filePath ? `file:${normalizeComparableText(item.filePath)}` : "",
    detailSummary ? `summary:${normalizeComparableText(detailSummary)}` : "",
    item.partType ? `part:${normalizeComparableText(item.partType)}` : "",
  ]
    .filter((segment) => segment.length > 0)
    .join("|");
}

function progressVisibleActionIdentity(item: ProgressItem): string {
  const tool = normalizeComparableText(item.activityDetail?.tool || item.title);
  const input = asRecord(item.activityDetail?.input);
  const metadata = asRecord(item.activityDetail?.metadata);
  const display = asRecord(metadata?.display);
  const file = normalizeComparableText(
    item.filePath ||
      item.activityDetail?.file ||
      asString(input?.filePath) ||
      asString(input?.file) ||
      asString(input?.path),
  );
  if (tool === "read" || tool === "read_file") {
    const offset = input?.offset ?? input?.lineStart ?? display?.lineStart ?? "";
    const limit = input?.limit ?? input?.lineEnd ?? display?.lineEnd ?? "";
    if (file) {
      // Read mirrors frequently omit structured input on one side while still
      // exposing the same visible file/range in title/metadata.
      return `visible-read:${file}:${String(offset)}:${String(limit)}`;
    }
  }
  return canonicalActivityActionIdentity(
    // Some live envelopes omit activityDetail.tool but still provide the
    // visible tool title and input. Use that title as the semantic tool name;
    // otherwise the unmatched live row is appended after finalized rows.
    item.activityDetail?.tool || item.title,
    item.activityDetail?.input,
  );
}

function mergeProgressItemRecord(existing: ProgressItem, incoming: ProgressItem): ProgressItem {
  const existingRank = progressItemStatusRank(existing.status);
  const incomingRank = progressItemStatusRank(incoming.status);
  const shouldPromoteStatus =
    incomingRank > existingRank ||
    (incomingRank === existingRank &&
      typeof incoming.streamSeq === "number" &&
      typeof existing.streamSeq === "number" &&
      incoming.streamSeq >= existing.streamSeq);

  // SDK stream envelopes are patches, not complete replacements. Keep each
  // field's ownership explicit so an omitted field in a later mirror cannot
  // silently erase something the user already saw.
  return {
    key: existing.key || incoming.key,
    mergeKey: existing.mergeKey || incoming.mergeKey,
    id: incoming.id ?? existing.id,
    callID: incoming.callID ?? existing.callID,
    messageID: incoming.messageID ?? existing.messageID,
    sessionID: incoming.sessionID ?? existing.sessionID,
    title: incoming.title || existing.title,
    status: shouldPromoteStatus ? incoming.status : existing.status,
    source: incoming.source ?? existing.source,
    partType: incoming.partType ?? existing.partType,
    internal: Boolean(existing.internal || incoming.internal),
    meta: incoming.meta ?? existing.meta,
    filePath: incoming.filePath ?? existing.filePath,
    startedAt: incoming.startedAt ?? existing.startedAt,
    endedAt: incoming.endedAt ?? existing.endedAt,
    diffStats: incoming.diffStats ?? existing.diffStats,
    activityDetail: mergeActivityDetail(existing.activityDetail, incoming.activityDetail),
    // A lifecycle update enriches the same visible activity row; it must not
    // move that row to the update's later tape position. Keeping its first
    // SDK position lets intervening assistant text remain between steps.
    streamSeq:
      existing.streamSeq ?? incoming.streamSeq,
  };
}

function progressItemsFromSteps(
  steps: Array<MessageStep | StreamingStep>,
  prefix: string,
): ProgressItem[] {
  const stepMap = new Map<string, ProgressItem>();

  steps
    .filter((step) => isActionProgressStep(step))
    .forEach((step, index) => {
      const rawActivityDetail =
        "activityDetail" in step
          ? (step.activityDetail as ActivityDetail | undefined)
          : undefined;
      const status = normalizeProgressStatus(step.status);
      const questionPresentation = completedQuestionToolPresentation(
        rawActivityDetail?.tool,
        step.status,
        rawActivityDetail?.output,
      );
      const title = questionPresentation.title ?? step.title;
      const activityDetail = questionPresentation.isCompleted
        ? { ...rawActivityDetail, summary: questionPresentation.summary ?? rawActivityDetail?.summary }
        : rawActivityDetail;
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
      const normalizedStepPartType = normalizeComparableText(stepPartType);
      const isLifecycleMarker =
        normalizedStepPartType === "step-start" ||
        normalizedStepPartType === "step-finish" ||
        normalizedStepPartType === "step-update";
      const mergeKey = stepCallId
        ? `call:${stepCallId}`
        : stepId
          ? `id:${stepId}`
          : stepMessageId
            ? `msg:${stepMessageId}:${index}`
            : isLifecycleMarker
              ? `lifecycle:${normalizedStepPartType}:${index}`
              : `title:${title.trim().toLowerCase()}`;
      const stepInternal =
        "internal" in step ? Boolean(step.internal) : false;
      const baseMergeKey =
        progressItemIdentityKey({
          id: stepId,
          callID: stepCallId,
          messageID: stepMessageId,
          title,
          filePath: stepFilePath,
          partType: stepPartType,
          activityDetail,
        }) || mergeKey;
      const candidate: ProgressItem = {
        key: `${prefix}-${index}-${title}`,
        mergeKey: baseMergeKey,
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
                ? activityDetail
            : undefined,
        streamSeq:
          "streamSeq" in step
            ? (step as { streamSeq?: number }).streamSeq
            : undefined,
      };

      const existing = stepMap.get(candidate.mergeKey);
      if (!existing) {
        stepMap.set(candidate.mergeKey, candidate);
      } else {
        stepMap.set(candidate.mergeKey, mergeProgressItemRecord(existing, candidate));
      }
    });

  return Array.from(stepMap.values());
}

function progressItemsFromRawResponseParts(
  rawResponse?: unknown,
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

    const partType = asString(partRec.type).trim().toLowerCase();
    if (
      partType === "reasoning" ||
      partType === "thinking" ||
      partType === "thought" ||
      partType === "text" ||
      partType === "message" ||
      partType === "output_text"
    ) {
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
    const normalizedInputRec = normalizeReadRangeInput(toolName, inputRec, metadataRec);
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
    const partMessageID = firstNonEmptyString(
      asString(partRec.messageID),
      asString(partRec.messageId),
    );

    if (toolName !== "read" && !callID && !id) {
      continue;
    }

    const output = firstNonEmptyString(
      asString(stateRec?.output),
      asString(partRec.output),
    );
    const preview = firstNonEmptyString(asString(metadataRec?.preview));
    const rawTitle = firstNonEmptyString(
      asString(stateRec?.title),
      asString(partRec.title),
      toolName,
    ) || "step";

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
    const readDisplay = toolName === "read" ? asRecord(metadataRec?.display) : null;
    if (Number.isInteger(Number(readDisplay?.lineStart))) {
      compactMetadata.lineStart = Number(readDisplay?.lineStart);
    }
    if (Number.isInteger(Number(readDisplay?.lineEnd))) {
      compactMetadata.lineEnd = Number(readDisplay?.lineEnd);
    }

    items.push({
      key: `raw-${callID ?? id ?? partRec.messageID ?? index}`,
      mergeKey:
        progressItemIdentityKey({
          id,
          callID,
          messageID: partMessageID || undefined,
          title: rawTitle,
          filePath,
          partType: partType || "tool",
          activityDetail: {
            kind: toolName === "read" ? "read" : toolName || "tool_call",
            summary: filePath || preview || rawTitle,
            tool: toolName,
            file: filePath,
            input: normalizedInputRec,
            output: output || undefined,
            // Store the display title (e.g., relative path) from state.title for read steps
            title: firstNonEmptyString(asString(stateRec?.title), asString(partRec.title)) || undefined,
            metadata: Object.keys(compactMetadata).length > 0 ? compactMetadata : undefined,
          },
        }) || `index:${index}`,
      id,
      callID,
      messageID: partMessageID || undefined,
      title: rawTitle,
      status,
      source: "raw_debug",
      partType: partType || "tool",
      internal: Boolean(partRec.internal),
      meta: preview || undefined,
      filePath,
      diffStats: undefined,
      activityDetail: {
        kind: toolName === "read" ? "read" : toolName || "tool_call",
        summary: filePath || preview || rawTitle,
        tool: toolName,
        file: filePath,
        input: normalizedInputRec,
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
    const mergeKey =
      item.mergeKey ||
      progressItemIdentityKey(item) ||
      item.callID ||
      item.id ||
      item.key;
    const existing = stepMap.get(mergeKey);
    if (!existing) {
      stepMap.set(mergeKey, { ...item });
      continue;
    }
    stepMap.set(mergeKey, mergeProgressItemRecord(existing, item));
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
    // Delta-bearing text is owned by the live Thinking state. Treating it as
    // commentary renders reasoning tokens as a response card (for example,
    // `investigate` + `setup` becoming `investigatesetup`).
    if (isDeltaCentralizedEventPayload(event)) continue;
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
      : id
        ? `id:${id}`
        : `text:${messageID || "unknown"}:${normalizeComparableText(text)}`;

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

function completedQuestionOutputChunksFromRawEventPayloads(
  rawSdkEventPayloads: unknown[],
  messageScopeIds?: Set<string>,
): Array<{ text: string; streamSeq: number }> {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return [];
  }

  const chunks: Array<{ text: string; streamSeq: number }> = [];
  const seen = new Set<string>();
  const isMessageInScope = (messageId?: string | null): boolean => {
    if (!messageScopeIds || messageScopeIds.size === 0) {
      return true;
    }
    if (!messageId) {
      return true;
    }
    return messageScopeIds.has(messageId);
  };

  for (let index = 0; index < rawSdkEventPayloads.length; index += 1) {
    const event = asRecord(rawSdkEventPayloads[index]);
    if (!event) {
      continue;
    }

    const part = getCentralizedEventPart(event);
    if (!part) {
      continue;
    }

    const toolName = firstNonEmptyString(
      asString(part.tool),
      asString(part.name),
    )?.toLowerCase();
    if (
      toolName !== "question" &&
      !toolName?.includes("request_user_input") &&
      !toolName?.includes("request-user-input")
    ) {
      continue;
    }

    const messageID = firstNonEmptyString(
      asString(part.messageID),
      asString(part.messageId),
      asString(event.messageID),
      asString(event.messageId),
    );
    if (!isMessageInScope(messageID)) {
      continue;
    }

    const state = asRecord(part.state);
    const status = firstNonEmptyString(
      asString(state?.status),
      asString(part.status),
    )?.toLowerCase();
    if (status !== "completed") {
      continue;
    }

    const output = firstNonEmptyString(
      asString(state?.output),
      asString(part.output),
    )?.trim();
    if (!output) {
      continue;
    }

    const callID = firstNonEmptyString(asString(part.callID), asString(part.callId));
    const dedupeKey = [messageID || "", callID || "", normalizeComparableText(output)].join("|");
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    chunks.push({ text: output, streamSeq: index });
  }

  return chunks;
}

function orderedAssistantResponseChunksFromCentralizedData(
  rawSdkEventPayloads: unknown[],
  messageScopeIds?: Set<string>,
): string[] {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return [];
  }

  const orderedMessageIds: string[] = [];
  const seenMessageIds = new Set<string>();
  for (const event of rawSdkEventPayloads) {
    const messageID = extractSemanticEventMessageId(event);
    if (!messageID) {
      continue;
    }
    if (messageScopeIds && messageScopeIds.size > 0 && !messageScopeIds.has(messageID)) {
      continue;
    }
    if (seenMessageIds.has(messageID)) {
      continue;
    }
    seenMessageIds.add(messageID);
    orderedMessageIds.push(messageID);
  }

  const orderedChunks: Array<{ text: string; streamSeq: number }> = [];
  const seenChunkKeys = new Set<string>();
  const questionChunks = completedQuestionOutputChunksFromRawEventPayloads(
    rawSdkEventPayloads,
    messageScopeIds,
  );
  for (const chunk of questionChunks) {
    const key = `question:${normalizeComparableText(chunk.text)}`;
    if (seenChunkKeys.has(key)) {
      continue;
    }
    seenChunkKeys.add(key);
    orderedChunks.push(chunk);
  }

  for (const messageID of orderedMessageIds) {
    const scopedPayloads = rawSdkEventPayloads.filter(
        (event) => extractSemanticEventMessageId(event) === messageID,
    );
    const bodyChunks = getCentralizedAssistantContentChunksFromRawSdkEventPayloads(
      scopedPayloads,
    );
    if (bodyChunks.length === 0) {
      continue;
    }

    let firstBodySeq = Number.MAX_SAFE_INTEGER;
    for (let index = 0; index < rawSdkEventPayloads.length; index += 1) {
      const event = rawSdkEventPayloads[index];
      if (extractSemanticEventMessageId(event) !== messageID) {
        continue;
      }
      if (isAiResponseEvent(event)) {
        firstBodySeq = Math.min(firstBodySeq, index);
      }
      const part = getCentralizedEventPart(event);
      const toolName = firstNonEmptyString(
        asString(part?.tool),
        asString(part?.name),
      )?.toLowerCase();
      if (toolName === "structuredoutput" || toolName === "structured_output") {
        firstBodySeq = Math.min(firstBodySeq, index);
      }
    }

    for (const chunk of bodyChunks) {
      const normalized = normalizeComparableText(chunk);
      if (!normalized) {
        continue;
      }
      const key = `body:${messageID}:${normalized}`;
      if (seenChunkKeys.has(key)) {
        continue;
      }
      seenChunkKeys.add(key);
      orderedChunks.push({
        text: chunk,
        streamSeq: firstBodySeq === Number.MAX_SAFE_INTEGER ? orderedChunks.length : firstBodySeq,
      });
    }
  }

  return orderedChunks
    .sort((a, b) => a.streamSeq - b.streamSeq)
    .map((chunk) => chunk.text);
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

function todoItemsFromDisplayEvent(event: DisplayEvent): unknown[] {
  const candidates: unknown[][] = [];
  const inputTodos = event.activityDetail?.input?.todos;
  if (Array.isArray(inputTodos)) {
    candidates.push(inputTodos);
  }

  const output = event.activityDetail?.output;
  if (typeof output === "string" && output.trim()) {
    try {
      const parsedOutput = JSON.parse(output) as unknown;
      if (Array.isArray(parsedOutput)) {
        candidates.push(parsedOutput);
      } else {
        const parsedRecord = asRecord(parsedOutput);
        if (Array.isArray(parsedRecord?.todos)) {
          candidates.push(parsedRecord.todos);
        }
      }
    } catch {
      // A partial tool output is expected while the input remains complete.
    }
  }

  return candidates.reduce<unknown[]>(
    (richest, candidate) => candidate.length > richest.length ? candidate : richest,
    [],
  );
}

function TodoWriteStep({ event }: { event: DisplayEvent }) {
  const [showTodoChecklist, setShowTodoChecklist] = useState(true);
  const todos = todoItemsFromDisplayEvent(event);

  // A TodoWrite activity already has its own pending state in the timeline.
  // Do not add a second generic loading row before its checklist payload arrives.
  if (todos.length === 0) {
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

function skillMcpOutputText(rawOutput: unknown): string {
  const output = asString(rawOutput).trim();
  if (!output) return "";

  try {
    const parsed = JSON.parse(output) as unknown;
    if (Array.isArray(parsed)) {
      const textParts = parsed
        .map((entry) => asString(asRecord(entry)?.text).trim())
        .filter(Boolean);
      if (textParts.length > 0) return textParts.join("\n\n");
    }
    const parsedText = asString(asRecord(parsed)?.text).trim();
    if (parsedText) return parsedText;
  } catch {
    // OpenCode may emit a partially written output string while streaming.
  }

  return output;
}

function SkillMcpActivityStep({ event }: { event: DisplayEvent }) {
  const input = asRecord(event.activityDetail?.input);
  const mcpName = asString(input?.mcp_name) || asString(input?.mcpName);
  const toolName = asString(input?.tool_name) || asString(input?.toolName);
  const output = skillMcpOutputText(event.activityDetail?.output);
  const title = [mcpName, toolName].filter(Boolean).join(" · ") || "skill_mcp";

  return (
    // The shared activity row already renders the skill_mcp title, MCP name,
    // and tool name. This component owns only the bounded result body so the
    // same metadata is not rendered twice and no card is nested in that row.
    <div className="flex w-full min-w-0 flex-col items-start gap-1">
      {output ? (
        <div className="w-full min-w-0">
          <CollapsedMarkdownPreview title={`${title} output`} content={output} variant="bare" />
        </div>
      ) : null}
    </div>
  );
}

function genericToolPayloadText(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
    } catch {
      return trimmed;
    }
  }

  if (value && typeof value === "object") {
    try {
      return `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
    } catch {
      return "";
    }
  }

  return "";
}

/**
 * Schema-agnostic fallback for tools without a dedicated activity card.
 * Preserve arbitrary input/output keys instead of maintaining a growing list
 * of tool-specific field mappings. Specialized renderers remain authoritative
 * and this fallback only fills an otherwise title-only activity row.
 */
function GenericToolPayloadStep({ event }: { event: DisplayEvent }) {
  const input = asRecord(event.activityDetail?.input);
  const inputText = genericToolPayloadText(
    input && Object.keys(input).length > 0 ? input : undefined,
  );
  const outputText = genericToolPayloadText(event.activityDetail?.output);
  if (!inputText && !outputText) return null;

  return (
    // The parent activity row already owns the surface. Keep payload previews
    // bare here so a generic tool cannot render a card inside another card.
    <div className="flex w-full min-w-0 flex-col items-start gap-2">
      {inputText ? (
        <div className="w-full min-w-0">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider oc-text-secondary">Input</div>
          <CollapsedMarkdownPreview title={`${event.label} input`} content={inputText} variant="bare" />
        </div>
      ) : null}
      {outputText ? (
        <div className="w-full min-w-0">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider oc-text-secondary">Output</div>
          <CollapsedMarkdownPreview title={`${event.label} output`} content={outputText} variant="bare" />
        </div>
      ) : null}
    </div>
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
    if (isCodeSelectionPart(part)) return false;
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

function isCodeSelectionPart(part: MessagePart | undefined | null | {}): part is CodeSelectionMessagePart {
  if (!part || typeof part !== "object") return false;
  const rec = part as Record<string, unknown>;
  const type = typeof rec.type === "string" ? rec.type : "";
  const source = rec.source as Record<string, unknown> | undefined;
  if (!source) return false;
  const sourceType = typeof source.type === "string" ? source.type : "";
  const lineInfo = typeof source.lineInfo === "string" ? source.lineInfo : "";
  const textValue = source.text && typeof source.text === "object"
    ? (source.text as Record<string, unknown>).value
    : undefined;
  return type === "file" && sourceType === "file" && lineInfo.length > 0 && typeof textValue === "string";
}

export interface CodeSelectionChipData {
  path?: string;
  filename?: string;
  languageId?: string;
  lineInfo?: string;
  content: string;
  startLine?: number;
  endLine?: number;
}

function parseLineRange(lineInfo?: string): { startLine?: number; endLine?: number } {
  if (!lineInfo) return {};
  const match = lineInfo.match(/(\d+)(?:\s*-\s*(\d+))?/);
  if (!match) return {};
  return {
    startLine: match[1] ? Number(match[1]) : undefined,
    endLine: match[2] ? Number(match[2]) : undefined,
  };
}

function rangeToLines(range?: { start?: { line?: number }; end?: { line?: number } }): { startLine?: number; endLine?: number } {
  if (!range) return {};
  const startLine = typeof range.start?.line === "number" ? range.start.line + 1 : undefined;
  const endLine = typeof range.end?.line === "number" ? range.end.line + 1 : undefined;
  return { startLine, endLine };
}

function collectCodeSelectionsFromParts(parts: MessagePart[] | undefined): CodeSelectionChipData[] {
  if (!parts) return [];
  const out: CodeSelectionChipData[] = [];
  for (const part of parts) {
    if (!isCodeSelectionPart(part)) continue;
    const source = part.source;
    const value = source.text?.value ?? "";
    const { startLine, endLine } = parseLineRange(source.lineInfo);
    const lineInfo = source.lineInfo || (startLine && endLine ? `${startLine}-${endLine}` : startLine ? `${startLine}` : undefined);
    out.push({
      path: source.path,
      filename:
        basenamePreservingLineSuffix(part.filename || source.path || "", lineInfo) ||
        undefined,
      languageId: source.languageId || part.mime,
      lineInfo,
      content: value,
      startLine,
      endLine,
    });
  }
  return out;
}

function collectImageUrlsFromParts(message?: Message): string[] {
  if (!message?.parts) return [];
  const urls: string[] = [];
  for (const part of message.parts) {
    const rec = part as Record<string, unknown> | null | undefined;
    if (!rec) continue;
    const type = typeof rec.type === "string" ? rec.type.toLowerCase() : "";
    const mime = typeof rec.mime === "string" ? rec.mime.toLowerCase() : "";
    const url = typeof rec.url === "string" ? rec.url : "";
    if (type === "file" && mime.startsWith("image/") && url) {
      urls.push(url);
    }
  }
  return urls;
}

function isImageAttachmentPart(part: MessagePart | undefined): boolean {
  if (!part) return false;
  const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
  const mime = typeof part.mime === "string" ? part.mime.toLowerCase() : "";
  return type === "file" && mime.startsWith("image/");
}

function basenamePreservingLineSuffix(label: string, lineInfo?: string): string {
  const normalizedLabel = label.trim();
  if (!normalizedLabel) return "";
  const normalizedLineInfo = typeof lineInfo === "string" ? lineInfo.trim() : "";
  const lineSuffix = normalizedLineInfo ? `:${normalizedLineInfo.replace(/^:+/, "")}` : "";
  const withoutSuffix =
    lineSuffix && normalizedLabel.endsWith(lineSuffix)
      ? normalizedLabel.slice(0, -lineSuffix.length)
      : normalizedLabel;
  const segments = withoutSuffix.split(/[\\/]/);
  const baseName = segments[segments.length - 1] || withoutSuffix;
  return `${baseName}${lineSuffix}`;
}

function buildExplicitFileChipLabel(part: MessagePart): string | undefined {
  const filename = typeof part.filename === "string" ? part.filename.trim() : "";
  const sourcePath = typeof part.source?.path === "string" ? part.source.path.trim() : "";
  const lineInfo = typeof part.source?.lineInfo === "string" ? part.source.lineInfo.trim() : "";
  const baseLabel = basenamePreservingLineSuffix(filename || sourcePath, lineInfo);
  if (!baseLabel) return undefined;
  if (!lineInfo) return baseLabel;
  const lineSuffix = `:${lineInfo}`;
  return baseLabel.endsWith(lineSuffix) ? baseLabel : `${baseLabel}${lineSuffix}`;
}

function decodeTextDataUrl(dataUrl?: string): string | undefined {
  if (typeof dataUrl !== "string" || !dataUrl.toLowerCase().startsWith("data:text/")) return undefined;
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) return undefined;
  const metadata = dataUrl.slice(0, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);
  try {
    if (metadata.includes(";base64")) {
      const binary = atob(payload);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return decodeURIComponent(payload);
  } catch {
    return undefined;
  }
}

type UserFileChip = { label: string; path?: string; textContent?: string };

function buildExplicitFileChip(part: MessagePart): { label: string; path?: string } | undefined {
  const label = buildExplicitFileChipLabel(part);
  if (!label) return undefined;
  const sourcePath = typeof part.source?.path === "string" ? part.source.path.trim() : "";
  return {
    label,
    path: sourcePath || undefined,
  };
}

function normalizedUserMessageText(message?: Message): string {
  const raw =
    message?.content ?? message?.text ?? messageBodyFromParts(message?.parts, message?.role ?? message?.info?.role);
  const withoutAttachmentEcho = stripHydratedAttachmentEcho(
    typeof raw === "string" ? raw : "",
    message,
  );
  const withoutGenericFenceEcho =
    stripGenericHydratedAttachmentFence(withoutAttachmentEcho);
  return splitInjectedSystemPromptFromUserText(withoutGenericFenceEcho).userText;
}

function isLikelyUserPromptEcho(responseText: unknown, userPromptText: unknown): boolean {
  const response = normalizeComparableActivityText(responseText);
  const prompt = normalizeComparableActivityText(userPromptText);
  if (!response || !prompt) {
    return false;
  }
  if (response === prompt) {
    return true;
  }

  // Some SDK text events only mirror the user turn and differ by punctuation
  // or a small transport prefix. Do not suppress a genuine answer that merely
  // quotes one phrase from the prompt: containment must cover nearly all of
  // both values and have enough text to be meaningful.
  const shorterLength = Math.min(response.length, prompt.length);
  const longerLength = Math.max(response.length, prompt.length);
  return (
    shorterLength >= 24 &&
    shorterLength / longerLength >= 0.9 &&
    (response.includes(prompt) || prompt.includes(response))
  );
}

function splitInjectedSystemPromptFromUserText(raw: string): {
  systemText?: string;
  userText: string;
} {
  // Rendering contract:
  // Some user turns are persisted as one raw text blob containing:
  //   [transport/system reminder]
  //   ---
  //   actual user prompt
  //
  // The chat UI intentionally splits that into:
  // - a separate system card (`systemText`), and
  // - the visible user bubble (`userText`)
  //
  // Keep this behavior aligned with pending-user reconciliation in
  // `pendingUserMessages.ts`. If one side strips the injected prefix and the
  // other compares the raw combined blob, the same user turn can render twice:
  // once as the canonical centralized message and once as the optimistic
  // overlay lingering at the bottom during streaming.
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

type FileMentionTarget = {
  filename: string;
  path: string;
};

function hasInlineFileMention(text: string, filename: string): boolean {
  if (!text || !filename) {
    return false;
  }
  const token = `@${filename}`;
  let index = text.indexOf(token);
  while (index >= 0) {
    const nextCharacter = text[index + token.length] || "";
    if (!/[a-zA-Z0-9_./\\-]/.test(nextCharacter)) {
      return true;
    }
    index = text.indexOf(token, index + token.length);
  }
  return false;
}

// Function to parse text and extract file mentions
function parseFileMentions(text: string, targets: FileMentionTarget[] = []) {
  if (!text) return [];
  const parts: Array<{
    type: 'text' | 'file';
    content: string;
    filename?: string;
    path?: string;
  }> = [];
  const sortedTargets = [...targets]
    .filter((target) => target.filename && target.path)
    .sort((left, right) => right.filename.length - left.filename.length);
  let lastIndex = 0;

  // SDK file parts are authoritative: only they can make a blue @ mention
  // navigable. This avoids consuming adjacent synthetic transport text (for
  // example, `@.env.exampleCalled the Read tool`) as part of a filename.
  if (sortedTargets.length > 0) {
    for (let index = 0; index < text.length; index += 1) {
      const target = sortedTargets.find((candidate) => {
        const token = `@${candidate.filename}`;
        const nextCharacter = text[index + token.length] || "";
        return (
          text.startsWith(token, index) &&
          !/[a-zA-Z0-9_./\\-]/.test(nextCharacter)
        );
      });
      if (!target) {
        continue;
      }
      if (index > lastIndex) {
        parts.push({ type: 'text', content: text.slice(lastIndex, index) });
      }
      parts.push({
        type: 'file',
        content: `@${target.filename}`,
        filename: target.filename,
        path: target.path,
      });
      lastIndex = index + target.filename.length + 1;
      index = lastIndex - 1;
    }
  } else {
    let match: RegExpExecArray | null;
    FILE_MENTION_REGEX.lastIndex = 0;
    while ((match = FILE_MENTION_REGEX.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'file', content: match[0], filename: match[1] });
      lastIndex = match.index + match[0].length;
    }
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', content: text }];
}

// Component to render text with highlighted file mentions
function renderHighlightedText(text: string, targets?: FileMentionTarget[]) {
  const parts = parseFileMentions(text, targets);

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
              file: part.path || (part as any).filename,
            });
          }}
          title={`Open ${part.path || (part as any).filename}`}
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


type MessageViewState = {
  showActivityDetails: boolean;
  showThinkingDetails: boolean;
  showInternalActivity: boolean;
  showExpandedActivityTimeline: boolean;
  expandedReasoningSteps: Set<string>; // Track individual reasoning step expansion
};

type DisplayEvent = {
  key: string;
  kind: "activity" | "reasoning" | "commentary";
  label: string;
  summary: string;
  description?: string;
  detail?: string;
  status: "pending" | "running" | "done" | "error" | "cancelled";
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
  streamSeq?: number;
  /** Stable position assigned when this row first enters the turn-scoped sticky tape. */
  timelineSeq?: number;
};

/**
 * The shared activity-row surface.  This is deliberately kept beside the
 * transcript renderer: subagent events are the same tool-part contract as
 * normal assistant activity and must not have a second, simplified UI.
 */
export type SharedActivityEvent = DisplayEvent;

/**
 * OpenCode's Read input uses a one-based source offset and a line count. Keep
 * it visible in the compact timeline row so repeated reads of one file remain
 * understandable without expanding source output into the live stream.
 */
function formatReadLineRange(
  input: unknown,
  metadata?: Record<string, string | number | boolean>,
): string | undefined {
  const record = asRecord(input);
  const offset = Number(record?.offset ?? metadata?.lineStart);
  const limit = Number(record?.limit);
  const lineEnd = Number(metadata?.lineEnd);
  if (!Number.isInteger(offset) || offset < 1) return undefined;

  const resolvedLimit = Number.isInteger(limit) && limit >= 1
    ? limit
    : Number.isInteger(lineEnd) && lineEnd >= offset
      ? lineEnd - offset + 1
      : undefined;
  if (!resolvedLimit) return `Line ${offset}`;

  const end = offset + resolvedLimit - 1;
  return end === offset ? `Line ${offset}` : `Lines ${offset}\u2013${end}`;
}

/** A compact, input-backed discriminator for File_edit rows without a diff hunk. */
function formatEditChangeSize(input: unknown): string | undefined {
  const record = asRecord(input);
  if (!record) return undefined;
  const oldText = asString(record.oldString);
  const newText = asString(record.newString);
  if (!oldText && !newText) return undefined;

  const lineCount = (text: string) => text ? text.split(/\r?\n/u).length : 0;
  return `Changed ${lineCount(oldText)} \u2192 ${lineCount(newText)} lines`;
}

export function SharedActivityStep({
  event,
  messageContent = "",
}: {
  event: SharedActivityEvent;
  messageContent?: string;
}) {
  const labelText = (event.label ?? "").toString();
  const labelLower = labelText.trim().toLowerCase();
  const isGlobSearch = labelLower === "glob";
  const isReadActivity = labelLower === "read";
  const readLineRange = isReadActivity
    ? formatReadLineRange(event.activityDetail?.input, event.activityDetail?.metadata)
    : undefined;
  const isEditLike = ["edit", "file_edit", "modify", "patch", "write", "apply_patch"].includes(labelLower);
  const editChangeSize = isEditLike
    ? formatEditChangeSize(event.activityDetail?.input)
    : undefined;
  const filePath = event.filePath || (event.activityDetail?.input as Record<string, unknown> | undefined)?.filePath as string | undefined;
  const description = (event.activityDetail?.metadata?.description as string | undefined) || (event.activityDetail?.input?.description as string | undefined);
  const globPattern = isGlobSearch && typeof event.activityDetail?.input?.pattern === "string"
    ? event.activityDetail.input.pattern.trim()
    : "";
  // Rehydrated raw SDK tool events can carry their only result in
  // activityDetail.output. Use it as the last summary fallback so those events
  // share the same collapsible preview as streamed activity rows.
  const visibleSummary = getVisibleDefaultActivitySummary(
    event.label,
    event.summary,
    event.filePath || event.activityDetail?.output,
  );

  return (
    <div className="flex items-start justify-between gap-2 w-full">
      <ExpandableStep className="flex-1">
        <div className={cn("oc-activity-step-surface flex flex-col items-start w-full min-w-0", isReadActivity ? "gap-0" : "gap-2")}>
          <div className="flex items-center gap-2 flex-wrap w-full min-h-[20px]">
            <span className="oc-activity-step-title font-medium text-oc-text capitalize">{event.label.replace(/_/g, " ")}</span>
            {globPattern ? <span className="max-w-[min(44ch,60vw)] truncate rounded bg-oc-bg-soft px-1.5 py-0.5 font-mono text-xs text-oc-text-soft" title={globPattern}>{globPattern}</span> : null}
            {description ? <span className="oc-activity-step-meta flex items-center gap-2 text-oc-text-soft"><span>&middot;</span><span>{description}</span></span> : null}
            {(labelLower === "read" || isGlobSearch || isEditLike) && filePath && !isUrl(filePath) ? (
              <button type="button" className="oc-refined-file-link oc-refined-file-link-with-tooltip oc-refined-file-link-inline oc-refined-file-link-plain" onClick={() => vscode.postMessage({ type: "openFile", file: filePath })}>
                <FileIcon filePath={filePath} isDirectory={isDirectoryActivityPath(filePath, event.activityDetail)} />
                <span className="truncate">{filePath.split(/[\\/]/).pop() || filePath}</span>
                <span className="oc-refined-file-link-tooltip oc-refined-file-link-tooltip-below" role="tooltip">{filePath}</span>
              </button>
            ) : null}
          </div>
          {readLineRange ? (
            <span className="oc-activity-step-meta pl-0.5 font-mono text-[11px] text-oc-text-soft">
              {readLineRange}
            </span>
          ) : null}
          {editChangeSize ? (
            <span className="oc-activity-step-meta pl-0.5 font-mono text-[11px] text-oc-text-soft">
              {editChangeSize}
            </span>
          ) : null}
          {!isReadActivity ? (
            <div className="flex flex-col gap-1 w-full">
              {labelLower === "bash" || isGlobSearch ? (
                <div className="oc-refined-event-summary"><TerminalBlockWithOutput event={event} messageContent={messageContent} /></div>
              ) : SEARCH_LABELS.has(event.label) ? (
                <DetailedSearchActivityPreview event={event} isGlobSearch={isGlobSearch} />
              ) : visibleSummary ? (
                <div className="oc-refined-event-summary"><CollapsedMarkdownPreview title={event.label} content={visibleSummary} /></div>
              ) : null}
            </div>
          ) : null}
        </div>
      </ExpandableStep>
    </div>
  );
}

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

/**
 * Generates a stable identity key for activity events to enable proper deduplication.
 *
 * Priority order for identity generation:
 * 1. callID (highest priority - most stable)
 * 2. partID (second priority - stable within a message)
 * 3. messageID + filePath (third priority - message-scoped)
 * 4. event.key (fallback for system events without standard IDs)
 *
 * @param event - The display event to generate an identity for
 * @returns A stable identity string, or empty string if no stable identity can be generated
 */
function activityDisplayEventIdentity(event: DisplayEvent): string {
  const partType = (event.partType || "").trim().toLowerCase();
  const isLifecycleMarker =
    partType === "step-start" ||
    partType === "step-finish" ||
    partType === "step-update";

  // A message ID scopes an assistant turn, not an individual step. When the
  // SDK omits call/part IDs, falling back to messageID + label/tool makes the
  // next identical step replace the previous one during the final render
  // merge. Lifecycle markers are ordered tape entries in that case; keep
  // their own stream identity so each start-finish block remains mounted.
  if (isLifecycleMarker && !event.callID && !event.partID) {
    return event.timelineSeq !== undefined
      ? `lifecycle:${event.timelineSeq}`
      : event.streamSeq !== undefined
      ? `lifecycle:${event.streamSeq}`
      : event.key
        ? `lifecycle:${event.key}`
        : "";
  }

  // A streamed row's React key contains its transient array position
  // (`stream-7`, `stream-8`, ...). It is not an SDK identity and must never
  // outrank the semantic action/patch identities used for mirrored snapshots.
  const stableIdentity = stableActivityIdentity({
    callID: event.callID,
    partID: event.partID,
    messageID: event.messageID,
    tool: event.activityDetail?.tool,
    label: event.label,
    filePath: event.filePath,
    partType: event.partType,
  });
  if (stableIdentity) {
    return stableIdentity;
  }

  // No stable identity available
  return "";
}

/**
 * TodoWrite emits a new SDK snapshot whenever it advances the same checklist.
 * Transport IDs are not reliable across live/envelope/hydrated mirrors, so
 * dedupe only an exact repeated snapshot. The item status is part of the
 * identity on purpose: 0/4, 1/4, 2/4, and 4/4 are chronological UI records,
 * not duplicates. Omitting status collapses the stream to one final-looking
 * row and makes earlier progress disappear until rehydration.
 */
function todoWriteChecklistIdentity(event: DisplayEvent): string {
  const tool = (event.activityDetail?.tool ?? event.label ?? "").trim().toLowerCase();
  if (event.kind !== "activity" || tool !== "todowrite") {
    return "";
  }
  const todos = todoItemsFromDisplayEvent(event);
  if (!todos || todos.length === 0) {
    return "";
  }

  const normalizedTodos = todos.map((todo) => {
    const record = asRecord(todo);
    return [
      asString(record?.content).trim(),
      asString(record?.priority).trim(),
      asString(record?.status).trim().toLowerCase(),
    ];
  });
  return `todowrite:${JSON.stringify(normalizedTodos)}`;
}

/**
 * Some providers replay the same completed tool snapshot through separate SDK
 * calls. Call and part IDs differ, but the reader sees the exact same action.
 * Keep ID-based lifecycle merging, then use this semantic identity to collapse
 * only snapshots with the same tool action. Tool output is deliberately not
 * included: it evolves from sparse live state to completed state and is not
 * an identifier for the action.
 */
function activitySnapshotIdentity(event: DisplayEvent): string {
  if (event.kind !== "activity") return "";
  const partType = (event.partType || "").trim().toLowerCase();
  if (
    partType === "step-start" ||
    partType === "step-finish" ||
    partType === "step-update"
  ) {
    // Lifecycle markers delimit activity blocks. Their visible text is often
    // identical across consecutive steps, so a text/action fingerprint must
    // not collapse the next marker into the previous block.
    return "";
  }
  if (isEditLikeActivity(event)) return "";
  const detail = event.activityDetail;
  const tool = firstNonEmptyString(detail?.tool, event.label, event.partType);
  const actionIdentity = canonicalActivityActionIdentity(tool, detail?.input);
  if (actionIdentity) return actionIdentity;

  // Some mirrored lifecycle snapshots omit `state.input` entirely. Fall back
  // only to the exact compact action text that the timeline renders; this
  // catches the same Bash/Grep/Read row across `/event` and `/global/event`
  // without using mutable tool output as identity.
  const fallbackAction = firstNonEmptyString(
    asString(detail?.command),
    asString((detail?.input as Record<string, unknown> | undefined)?.command),
    event.filePath,
    detail?.file,
    event.summary,
    detail?.summary,
    detail?.title,
  );
  if (!tool || !fallbackAction) return "";
  return `visible-action:${normalizeComparableText(tool)}:${activityTextFingerprint(fallbackAction)}`;
}

function isEditLikeActivity(event: DisplayEvent): boolean {
  const detail = event.activityDetail;
  const tool = firstNonEmptyString(detail?.tool, event.label, event.partType)
    ?.trim()
    .toLowerCase() ?? "";
  return (
    event.partType?.toLowerCase() === "patch" ||
    Boolean(detail?.diffExcerpt) ||
    /(?:edit|write|patch|modify|replace)/u.test(tool)
  );
}

const activityPatchIdentityCache = new WeakMap<object, string>();

function activityPatchContentFingerprint(patch: string): string {
  // SDK representations of one edit differ in their diff headers and paths:
  // the tool result can contain a full unified diff while a patch part only
  // carries the changed lines. Compare the meaningful changed lines instead.
  const changedLines = patch
    .split(/\r?\n/u)
    .filter((line) => /^(?:\+|-)\s?/u.test(line) && !/^(?:\+\+\+|---)/u.test(line))
    .map((line) => line.trimEnd());
  return activityTextFingerprint(changedLines.length > 0 ? changedLines.join("\n") : patch);
}

function activityPatchFileKey(file: string | undefined): string {
  const normalized = normalizeComparableText(file).replace(/\\/gu, "/");
  const lastSeparator = normalized.lastIndexOf("/");
  return lastSeparator >= 0 ? normalized.slice(lastSeparator + 1) : normalized;
}

function activityPatchFileIdentity(event: DisplayEvent): string {
  if (!isEditLikeActivity(event)) return "";
  const detail = event.activityDetail;
  const input = asRecord(detail?.input);
  const metadata = asRecord(detail?.metadata);
  const fileDiff = asRecord(metadata?.filediff);
  const file = firstNonEmptyString(
    event.filePath,
    detail?.file,
    asString(fileDiff?.file),
    asString(input?.filePath),
    asString(input?.file),
  );
  return file ? `patch-file:${activityPatchFileKey(file)}` : "";
}

function activityPatchIdentity(event: DisplayEvent): string {
  if (event.kind !== "activity") return "";
  const cached = activityPatchIdentityCache.get(event);
  if (cached !== undefined) return cached;
  if (!isEditLikeActivity(event)) {
    activityPatchIdentityCache.set(event, "");
    return "";
  }
  const detail = event.activityDetail;
  const input = asRecord(detail?.input);
  const metadata = asRecord(detail?.metadata);
  const fileDiff = asRecord(metadata?.filediff);
  const excerptLines = Array.isArray(detail?.diffExcerpt?.lines)
    ? detail.diffExcerpt.lines.filter((line): line is string => typeof line === "string")
    : [];
  const patch = firstNonEmptyString(
    asString(fileDiff?.patch),
    asString(metadata?.diff),
    asString(input?.patchText),
    asString(input?.patch),
    asString(input?.diff),
    excerptLines.join("\n"),
    input && (asString(input.oldString) || asString(input.newString))
      ? `-${asString(input.oldString)}\n+${asString(input.newString)}`
      : undefined,
  );
  const fileOnlyIdentity = activityPatchFileIdentity(event);
  const file = fileOnlyIdentity.replace(/^patch-file:/u, "");
  if (!patch) {
    // Patch/tool mirrors sometimes reach the timeline with only the target
    // file. They have separate transport IDs but no visible payload that
    // represents a second edit. Coalesce precisely that indistinguishable
    // fallback; a real patch below still gets a content-based identity.
    activityPatchIdentityCache.set(event, fileOnlyIdentity);
    return fileOnlyIdentity;
  }
  const identity = `patch:${file}:${activityPatchContentFingerprint(patch)}`;
  activityPatchIdentityCache.set(event, identity);
  return identity;
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
    const stableIdentity = activityDisplayEventIdentity(event);
    if (stableIdentity) {
      return stableIdentity;
    }
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

/**
 * React keys must reflect an SDK/semantic identity, never a stream array index.
 * The live projection is rebuilt for each event; using its transient keys makes
 * Stepper remount, which visibly restarts the check icon and activity preview.
 */
function timelineDisplayEventReactKey(event: DisplayEvent): string {
  if (event.kind === "reasoning") {
    return `reasoning:${event.partID || event.key}`;
  }
  if (event.kind === "commentary") {
    // A message can contain several distinct text parts. messageID alone is
    // not a React identity and caused all but one Assistant Response card to
    // disappear when a part ID was absent from a live envelope.
    return `commentary:${event.partID || (event.timelineSeq ?? event.key)}`;
  }
  return firstNonEmptyString(
    activityPatchIdentity(event),
    todoWriteChecklistIdentity(event),
    activitySnapshotIdentity(event),
    activityDisplayEventIdentity(event),
    event.timelineSeq !== undefined ? `timeline:${event.timelineSeq}` : undefined,
    event.key,
  ) || event.key;
}

function timelineDisplayGroupReactKey(
  events: DisplayEvent[],
  fallbackIndex: number,
): string {
  const first = events[0];
  return first
    ? `stepper:${timelineDisplayEventReactKey(first)}`
    : `stepper:empty:${fallbackIndex}`;
}

/**
 * Coalesce one call's repeated SDK snapshots at the final render boundary.
 * Some tapes replay the same part after hydration, after completion, and
 * through a sync envelope; all of those snapshots carry the same call/part
 * identity and must produce one visible row.
 */
function coalesceTimelineEventsForRender(events: DisplayEvent[]): DisplayEvent[] {
  const result: DisplayEvent[] = [];
  const indexByIdentity = new Map<string, number>();

  const rememberIdentity = (event: DisplayEvent, index: number): void => {
    const identity =
      event.kind === "activity"
        ? activityDisplayEventIdentity(event)
        : event.partID
          ? `part:${event.partID}`
          : event.messageID
            ? `message:${event.messageID}:${event.kind}`
            : "";
    if (identity) {
      indexByIdentity.set(`transport:${identity}`, index);
    }
    // A patch part and its tool metadata can have different transport IDs but
    // still describe one visible edit. Match the semantic patch fingerprint at
    // the final render boundary so mirrored Edit rows cannot survive earlier
    // projection layers. Different patch contents remain separate edits.
    const patchIdentity = event.kind === "activity" ? activityPatchIdentity(event) : "";
    if (patchIdentity) {
      indexByIdentity.set(`patch:${patchIdentity}`, index);
    }
    // Transport IDs can differ between `/event`, `/global/event`, and
    // rehydrated snapshots. The visible action/input identity is the final
    // cross-envelope fallback; lifecycle timing is already excluded from its
    // fingerprint, so a new start time cannot create a second visible row.
    const snapshotIdentity = event.kind === "activity" ? activitySnapshotIdentity(event) : "";
    if (snapshotIdentity) {
      indexByIdentity.set(`snapshot:${snapshotIdentity}`, index);
    }
  };

  for (const event of events) {
    const transportIdentity =
      event.kind === "activity"
        ? activityDisplayEventIdentity(event)
        : event.partID
          ? `part:${event.partID}`
          : event.messageID
            ? `message:${event.messageID}:${event.kind}`
            : "";
    const patchIdentity = event.kind === "activity" ? activityPatchIdentity(event) : "";
    const snapshotIdentity = event.kind === "activity" ? activitySnapshotIdentity(event) : "";
    const matchingKeys = [
      transportIdentity ? `transport:${transportIdentity}` : "",
      patchIdentity ? `patch:${patchIdentity}` : "",
      snapshotIdentity ? `snapshot:${snapshotIdentity}` : "",
    ].filter(Boolean);
    if (matchingKeys.length === 0) {
      result.push(event);
      continue;
    }

    const existingIndex = matchingKeys
      .map((key) => indexByIdentity.get(key))
      .find((index): index is number => typeof index === "number");
    if (typeof existingIndex !== "number") {
      rememberIdentity(event, result.length);
      result.push(event);
      continue;
    }

    const existing = result[existingIndex];
    const incomingPriority = displayEventSourcePriority(event.source);
    const existingPriority = displayEventSourcePriority(existing.source);
    result[existingIndex] =
      incomingPriority >= existingPriority
        ? mergeStickyDisplayEvent(existing, event)
        : mergeStickyDisplayEvent(event, existing);
    rememberIdentity(result[existingIndex], existingIndex);
  }

  return result;
}

function diffStatsEqual(
  left?: { added: number; deleted: number },
  right?: { added: number; deleted: number },
): boolean {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.added === right.added && left.deleted === right.deleted;
}

function displayEventNeedsReplacement(
  existing: DisplayEvent,
  incoming: DisplayEvent,
): boolean {
  return (
    existing.status !== incoming.status ||
    existing.summary !== incoming.summary ||
    existing.description !== incoming.description ||
    existing.detail !== incoming.detail ||
    existing.filePath !== incoming.filePath ||
    existing.startedAt !== incoming.startedAt ||
    existing.endedAt !== incoming.endedAt ||
    existing.viewDiffFile !== incoming.viewDiffFile ||
    existing.isImportant !== incoming.isImportant ||
    !diffStatsEqual(existing.diffStats, incoming.diffStats) ||
    existing.activityDetail !== incoming.activityDetail
  );
}

function mergeStickyDisplayEvent(
  existing: DisplayEvent,
  incoming: DisplayEvent,
): DisplayEvent {
  // LOCKED UI INVARIANT: once an activity row has rendered for this assistant
  // turn, a later live-event snapshot may enrich it but must never remove the
  // fields that choose its visible component (especially edit/diff payloads).
  // OpenCode emits the same tool lifecycle through normal and `sync`-wrapped
  // events; the later event is often intentionally sparse. This is an
  // explicit patch merge, never a broad object spread, so omissions cannot
  // erase an already-rendered field.
  return {
    key: existing.key || incoming.key,
    kind: existing.kind,
    label: incoming.label || existing.label,
    summary: incoming.summary || existing.summary,
    description: incoming.description ?? existing.description,
    detail: incoming.detail ?? existing.detail,
    status: mergeDisplayEventStatus(existing.status, incoming.status),
    source:
      displayEventSourcePriority(incoming.source) >= displayEventSourcePriority(existing.source)
        ? incoming.source ?? existing.source
        : existing.source,
    partType: incoming.partType ?? existing.partType,
    internal: Boolean(existing.internal || incoming.internal),
    filePath: incoming.filePath ?? existing.filePath,
    callID: incoming.callID ?? existing.callID,
    messageID: incoming.messageID ?? existing.messageID,
    partID: incoming.partID ?? existing.partID,
    sessionID: incoming.sessionID ?? existing.sessionID,
    viewDiffFile: incoming.viewDiffFile ?? existing.viewDiffFile,
    diffStats: incoming.diffStats ?? existing.diffStats,
    activityDetail: mergeActivityDetail(existing.activityDetail, incoming.activityDetail),
    startedAt: incoming.startedAt ?? existing.startedAt,
    endedAt: incoming.endedAt ?? existing.endedAt,
    isImportant: Boolean(existing.isImportant || incoming.isImportant),
    updateCount: existing.updateCount + 1,
    // Preserve the position where this activity first appeared. Completion or
    // patch updates often arrive after an assistant text part and must not
    // pull that text card ahead of the activity.
    streamSeq:
      existing.streamSeq ?? incoming.streamSeq,
    timelineSeq:
      existing.timelineSeq ?? incoming.timelineSeq,
  };
}

function mergeDisplayEventStatus(
  existing: DisplayEvent["status"],
  incoming: DisplayEvent["status"],
): DisplayEvent["status"] {
  const isTerminal = (status: DisplayEvent["status"]) =>
    status === "done" || status === "error" || status === "cancelled";
  if (isTerminal(existing) && !isTerminal(incoming)) return existing;
  return incoming;
}

/**
 * Merge partial SDK records without treating omitted keys as deletion. The SDK
 * sends one action across several envelopes, so `{}` means "no fields in this
 * envelope", not "clear all previous fields".
 */
function mergePartialSdkRecord(
  existing?: Record<string, unknown>,
  incoming?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {};
  for (const source of [existing, incoming]) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) {
        merged[key] = value;
      }
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeActivityDetail(
  existing?: ActivityDetail,
  incoming?: ActivityDetail,
): ActivityDetail | undefined {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const existingMetadata = asRecord(existing.metadata);
  const incomingMetadata = asRecord(incoming.metadata);
  const existingInput = asRecord(existing.input);
  const incomingInput = asRecord(incoming.input);
  return {
    kind: incoming.kind ?? existing.kind,
    summary: incoming.summary ?? existing.summary,
    input: mergePartialSdkRecord(existingInput, incomingInput),
    output: incoming.output ?? existing.output,
    command: incoming.command ?? existing.command,
    file: incoming.file ?? existing.file,
    files: incoming.files ?? existing.files,
    backgroundTaskId: incoming.backgroundTaskId ?? existing.backgroundTaskId,
    backgroundOutput: incoming.backgroundOutput ?? existing.backgroundOutput,
    tool: incoming.tool ?? existing.tool,
    query: incoming.query ?? existing.query,
    isDirectory: incoming.isDirectory ?? existing.isDirectory,
    title: incoming.title ?? existing.title,
    diffExcerpt: incoming.diffExcerpt ?? existing.diffExcerpt,
    metadata: mergePartialSdkRecord(existingMetadata, incomingMetadata) as ActivityDetail["metadata"],
    sessionID: incoming.sessionID ?? existing.sessionID,
  };
}

function mergeStickyDisplayEventsForTurn(
  previousEvents: DisplayEvent[],
  nextEvents: DisplayEvent[],
): DisplayEvent[] {
  // Always run every incoming row through the same identity indexes. The
  // initial live frame can already contain mirrored SDK snapshots, and an
  // early return here would render those duplicates permanently.
  const merged: DisplayEvent[] = [];
  const identityIndex = new Map<string, number>();
  const fingerprintIndex = new Map<string, number>();
  const todoChecklistIndex = new Map<string, number>();
  const activitySnapshotIndex = new Map<string, number>();
  const activityPatchIndex = new Map<string, number>();
  const activityPatchFileIndex = new Map<string, number>();
  const sparseActivityPatchFileIndex = new Map<string, number>();
  let nextTimelineSeq = previousEvents.reduce(
    (highest, event) =>
      typeof event.timelineSeq === "number"
        ? Math.max(highest, event.timelineSeq + 1)
        : highest,
    0,
  );

  const stampTimelinePosition = (event: DisplayEvent): DisplayEvent => {
    if (typeof event.timelineSeq === "number") {
      nextTimelineSeq = Math.max(nextTimelineSeq, event.timelineSeq + 1);
      return event;
    }
    const stamped = { ...event, timelineSeq: nextTimelineSeq };
    nextTimelineSeq += 1;
    return stamped;
  };

  const remember = (event: DisplayEvent, index: number) => {
    const identity =
      event.kind === "activity"
        ? activityDisplayEventIdentity(event)
        : event.kind === "commentary"
          ? (event.partID ? `part:${event.partID}` : undefined)
          : firstNonEmptyString(
              event.partID ? `part:${event.partID}` : undefined,
              event.messageID ? `msg:${event.messageID}:${event.kind}` : undefined,
            );
    if (identity) {
      identityIndex.set(identity, index);
    }
    fingerprintIndex.set(displayEventFingerprint(event), index);
    const todoChecklistIdentity = todoWriteChecklistIdentity(event);
    if (todoChecklistIdentity) {
      todoChecklistIndex.set(todoChecklistIdentity, index);
    }
    const snapshotIdentity = activitySnapshotIdentity(event);
    if (snapshotIdentity) {
      activitySnapshotIndex.set(snapshotIdentity, index);
    }
    const patchIdentity = activityPatchIdentity(event);
    if (patchIdentity) {
      activityPatchIndex.set(patchIdentity, index);
    }
    const patchFileIdentity = activityPatchFileIdentity(event);
    if (patchFileIdentity) {
      activityPatchFileIndex.set(patchFileIdentity, index);
      if (patchIdentity === patchFileIdentity) {
        sparseActivityPatchFileIndex.set(patchFileIdentity, index);
      } else {
        sparseActivityPatchFileIndex.delete(patchFileIdentity);
      }
    }
  };

  const ingest = (event: DisplayEvent) => {
    event = stampTimelinePosition(event);
    const identity =
      event.kind === "activity"
        ? activityDisplayEventIdentity(event)
        : event.kind === "commentary"
          ? (event.partID ? `part:${event.partID}` : undefined)
          : firstNonEmptyString(
              event.partID ? `part:${event.partID}` : undefined,
              event.messageID ? `msg:${event.messageID}:${event.kind}` : undefined,
            );
    const fingerprint = displayEventFingerprint(event);
    const todoChecklistIdentity = todoWriteChecklistIdentity(event);
    const snapshotIdentity = activitySnapshotIdentity(event);
    const patchIdentity = activityPatchIdentity(event);
    const patchFileIdentity = activityPatchFileIdentity(event);
    const isSparsePatchSnapshot =
      patchIdentity.length > 0 && patchIdentity === patchFileIdentity;

    const matchingIndex =
      (identity && identityIndex.get(identity)) ??
      fingerprintIndex.get(fingerprint) ??
      (todoChecklistIdentity ? todoChecklistIndex.get(todoChecklistIdentity) : undefined) ??
      (snapshotIdentity ? activitySnapshotIndex.get(snapshotIdentity) : undefined) ??
      (patchIdentity ? activityPatchIndex.get(patchIdentity) : undefined) ??
      // A single edit can be reported once with its patch and once as a sparse
      // file-only lifecycle mirror. Bridge only that pair. Two content-bearing
      // patches of the same file still use their distinct content identities.
      (patchFileIdentity
        ? isSparsePatchSnapshot
          ? activityPatchFileIndex.get(patchFileIdentity)
          : sparseActivityPatchFileIndex.get(patchFileIdentity)
        : undefined);

    if (typeof matchingIndex === "number") {
      const existing = merged[matchingIndex];
      const existingFingerprint = displayEventFingerprint(existing);
      const existingPriority = displayEventSourcePriority(existing.source);
      const incomingPriority = displayEventSourcePriority(event.source);
      const needsReplacement = displayEventNeedsReplacement(existing, event);

      if (
        existingFingerprint !== fingerprint ||
        incomingPriority > existingPriority ||
        needsReplacement
      ) {
        // The merged row can gain a semantic action/patch identity that the
        // sparse first snapshot did not have. Re-index it immediately so the
        // next mirrored event joins this row instead of becoming a duplicate.
        merged[matchingIndex] = mergeStickyDisplayEvent(existing, event);
        remember(merged[matchingIndex], matchingIndex);
      }
      return;
    }

    const nextIndex = merged.length;
    merged.push(event);
    remember(event, nextIndex);
  };

  // A sticky snapshot is retained across React renders. It may already hold
  // duplicates from an earlier partial stream frame, so it must go through the
  // same identity merge as fresh events. Seeding the indexes around a copied
  // `previousEvents` array preserved those rows forever and is the direct
  // cause of repeated File_edit cards.
  for (const event of previousEvents) {
    ingest(event);
  }
  for (const event of nextEvents) {
    ingest(event);
  }

  // A live reasoning part can arrive with a new transient identity in every
  // envelope. `nextEvents` is collapsed before this merge, but the sticky
  // projection retains prior envelopes, so collapse once more after all live
  // frames have been combined. This keeps one Thinking row for a continuous
  // reasoning phase while an intervening activity still starts a new phase.
  return collapseConsecutiveReasoningDisplayEvents(merged);
}

function orderDisplayEventsChronologically(events: DisplayEvent[]): DisplayEvent[] {
  // The SDK stream is already ordered. Sticky merging retains existing rows
  // and appends newly observed activity, which is the live timeline order.
  // Local per-snapshot indexes must not be used to re-sort those rows.
  return events;
}

/**
 * Final render guard for activity rows. Earlier reducers retain transport
 * detail for recovery, but the UI contract is one row per semantic action.
 * This guard runs after every source has been merged, including the first
 * streaming frame, so an identical Read cannot paint twice.
 */
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
    case "cancelled":
      return "Cancelled";
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
  if (config.debug.showBrowserConsole) {
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

  // Keep subagent labels stable when metadata has not arrived yet.
  // The animated AI loading text is rendered by the shared loader component,
  // not reused as inline metadata text.
  return "Subagent";
}

function SubagentsInlineCard({
  subagents,
  subagentDetailsById,
  showSubagents,
  setShowSubagents,
  showAllSubagents,
  setShowAllSubagents,
  openSubagentModal,
  parentResponseFinished,
}: {
  subagents: SubagentSummary[];
  subagentDetailsById: AppState["subagentDetailsById"];
  showSubagents: boolean;
  setShowSubagents: (next: boolean) => void;
  showAllSubagents: boolean;
  setShowAllSubagents: (next: boolean) => void;
  openSubagentModal: (subagentId: string) => void;
  parentResponseFinished: boolean;
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
        const status = resolveSubagentStatus(subagent, detail, parentResponseFinished);
        return status === "running" || status === "pending";
      }),
    [showSubagents, visibleSubagents, subagentDetailsById, parentResponseFinished],
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
      const status = resolveSubagentStatus(subagent, detail, parentResponseFinished);
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

              if (config.debug.showBrowserConsole) {
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

              const resolvedStatus = resolveSubagentStatus(subagent, detail, parentResponseFinished);
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
                resolvedStatus !== "cancelled" &&
                activityText.trim().toLowerCase() !==
                statusText.trim().toLowerCase();

              return (
                <button
                  key={subagent.id}
                  type="button"
                  className={cn(
                    "oc-subagent-row w-full min-w-0 max-w-full overflow-hidden rounded-md border bg-oc-bg-soft px-2 py-1 text-left transition-colors",
                    "hover:bg-oc-panel",
                  )}
                  style={cardStyle}
                  onClick={() => openSubagentModal(subagent.id)}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <div className="oc-agent-icon shrink-0" style={accentTextStyle}>
                        {resolvedStatus === "running" ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : resolvedStatus === "error" ? (
                          <X className="h-3 w-3 text-oc-red" />
                        ) : resolvedStatus === "orphaned" ? (
                          <AlertCircle className="h-3 w-3 text-oc-yellow" />
                        ) : resolvedStatus === "cancelled" ? (
                          <Ban className="h-3 w-3 oc-text-secondary" />
                        ) : resolvedStatus === "done" ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Circle className="h-3 w-3 oc-text-secondary" />
                        )}
                      </div>
                      <span className="truncate text-oc-xs font-semibold text-oc-text-soft">
                        {modelInfo}
                      </span>
                    </div>
                    <span className="shrink-0 font-medium text-oc-2xs oc-text-secondary">
                      {formatDuration(durationMs)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex min-w-0 max-w-full items-center gap-1 overflow-hidden">
                    <span className="shrink-0 text-[9px] font-medium oc-text-secondary">
                      {statusText}
                    </span>
                    {agentRole ? (
                      <span className="max-w-full truncate rounded border border-oc-border-soft px-1 py-0 text-[8px] font-medium uppercase tracking-wide oc-text-secondary">
                        {agentRole}
                      </span>
                    ) : null}
                    {backgroundTaskId ? (
                      <span className="max-w-full truncate rounded border border-oc-border-soft px-1 py-0 text-[8px] font-medium uppercase tracking-wide oc-text-secondary">
                        {backgroundTaskId}
                      </span>
                    ) : null}
                  </div>
                  {shouldShowActivity ? (
                    <div className="mt-0.5 min-h-[12px] min-w-0 max-w-full overflow-hidden font-medium text-[9px] oc-text-secondary">
                      <FadeSwapText
                        text={loadingHint || activityText}
                        className="block min-w-0 max-w-full truncate"
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
        "oc-ai-status-ticker-text transition-[opacity,transform] will-change-[opacity,transform]",
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

const AI_LOADING_TEXT = [
  "Bribing the intern to type faster...",
  "Download more RAM...",
  "Checking for typos I made up...",
  "Looking busy...",
  "Locating the 'any' key...",
  "Brewing virtual coffee...",
  "Herding the bits...",
  "Updating the flux capacitor...",
  "Waiting for the magic smoke to clear...",
  "Untangling the spaghetti code...",
  "Asking StackOverflow...",
  "Convincing the compiler to cooperate...",
  "Reversing the polarity...",
] as const;
// Keep the status moving often enough to read as a live indicator. The
// transition itself is CSS-only; this timer only chooses the next complete
// status string and never performs a character-by-character update.
const AI_LOADING_TEXT_SWITCH_INTERVAL_MS = 2800;

export function AIStatusTicker({ className }: { className?: string }) {
  const [messageIndex, setMessageIndex] = useState(() =>
    Math.floor(Math.random() * AI_LOADING_TEXT.length),
  );
  const tickerIdRef = useRef(`ticker-${Math.random().toString(36).slice(2, 8)}`);

  // Diagnostic-only animation probe. When the ticker appears to pause, this
  // distinguishes a React remount from a browser main-thread frame stall.
  // It is intentionally disabled outside the existing SDK debug mode and
  // reports at most once per second, never once per stream event.
  useEffect(() => {
    if (!config.debug.showSdkEventDebug) {
      return;
    }

    const tickerId = tickerIdRef.current;
    let frameId = 0;
    let previousFrameAt = performance.now();
    let lastReportedAt = -Infinity;
    logger.warn("[AI-TICKER-TRACE] mounted", { tickerId });

    const observeFrame = (now: number) => {
      const frameGapMs = now - previousFrameAt;
      previousFrameAt = now;
      if (frameGapMs >= 48 && now - lastReportedAt >= 1_000) {
        lastReportedAt = now;
        logger.warn("[AI-TICKER-TRACE] dropped-animation-frame", {
          tickerId,
          frameGapMs: Number(frameGapMs.toFixed(1)),
          visibilityState: document.visibilityState,
        });
      }
      frameId = requestAnimationFrame(observeFrame);
    };

    frameId = requestAnimationFrame(observeFrame);
    return () => {
      cancelAnimationFrame(frameId);
      logger.warn("[AI-TICKER-TRACE] unmounted", { tickerId });
    };
  }, []);

  useEffect(() => {
    if (AI_LOADING_TEXT.length <= 1) {
      return;
    }
    const timer = window.setInterval(() => {
      setMessageIndex((current) => {
        let next = current;
        while (next === current) {
          next = Math.floor(Math.random() * AI_LOADING_TEXT.length);
        }
        return next;
      });
    }, AI_LOADING_TEXT_SWITCH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (config.debug.showSdkEventDebug) {
      logger.warn("[AI-TICKER-TRACE] text-selected", {
        tickerId: tickerIdRef.current,
        messageIndex,
      });
    }
  }, [messageIndex]);

  return (
    <div
      className={cn(
        "oc-ai-status-ticker inline-flex items-center font-medium text-[11px]",
        className,
      )}
    >
      <FadeSwapText
        text={AI_LOADING_TEXT[messageIndex]}
        // The fade is compositor-friendly. Avoid the old animated clipped
        // gradient here: repainting text every frame made this isolated status
        // label visibly stall while the rest of the chat remained responsive.
        className="italic opacity-85 tracking-wide"
        durationMs={280}
        // Loading visibility can toggle while a live event is processed. Do
        // not restart a character-by-character animation on every remount:
        // it makes a fully rendered status appear to shrink back to one letter.
        useTypewriter={false}
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

/**
 * A provider can split one continuous reasoning phase into several part IDs.
 * In the timeline those are consecutive Thinking rows, not separate user
 * actions. Fold only adjacent reasoning rows, retaining their full text and
 * the first row's key so an expanded live Thought does not collapse again.
 */
function isHiddenLifecycleReasoningSeparator(event: DisplayEvent): boolean {
  if (event.kind !== "activity" || event.internal !== true) return false;
  const label = event.label.trim().toLowerCase();
  const summary = event.summary.trim().toLowerCase();
  const partType = (event.partType || "").trim().toLowerCase();
  return (
    partType === "step-start" ||
    partType === "step-finish" ||
    label === "step-start" ||
    label === "step-finish" ||
    label === "starting step" ||
    label === "finishing step" ||
    (label === "step" && (summary === "start" || summary === "finish")) ||
    (label === "start" && summary === "start") ||
    (label === "finish" && summary === "finish")
  );
}

function collapseConsecutiveReasoningDisplayEvents(
  events: DisplayEvent[],
): DisplayEvent[] {
  const collapsed: DisplayEvent[] = [];
  for (const event of events) {
    const isPendingPlaceholder =
      event.kind === "reasoning" &&
      event.summary.trim() === "Thinking..." &&
      (event.status === "pending" || event.status === "running");
    if (isPendingPlaceholder) {
      // A delta has no durable reasoning payload by design. It only says the
      // current assistant turn is thinking. The SDK can advance an assistant
      // phase to a new message ID between deltas, so neither adjacency nor the
      // transient message ID is a valid phase boundary here: keep exactly one
      // live placeholder in the active timeline.
      const existingPlaceholderIndex = collapsed.findIndex(
        (candidate) =>
          candidate.kind === "reasoning" &&
          candidate.summary.trim() === "Thinking..." &&
          (candidate.status === "pending" || candidate.status === "running"),
      );
      if (existingPlaceholderIndex >= 0) {
        const existingPlaceholder = collapsed[existingPlaceholderIndex];
        collapsed[existingPlaceholderIndex] = {
          ...existingPlaceholder,
          status: "pending",
          endedAt: undefined,
          updateCount: existingPlaceholder.updateCount + event.updateCount,
        };
        continue;
      }
    }
    // Transport-only lifecycle records are retained for diagnostics but hidden
    // from the UI. They must not turn one continuous reasoning stream into a
    // stack of visible Thinking rows.
    let previousIndex = collapsed.length - 1;
    while (
      previousIndex >= 0 &&
      isHiddenLifecycleReasoningSeparator(collapsed[previousIndex])
    ) {
      previousIndex -= 1;
    }
    const previous = collapsed[previousIndex];
    if (event.kind !== "reasoning" || previous?.kind !== "reasoning") {
      collapsed.push(event);
      continue;
    }

    const previousText = previous.summary.trim();
    const incomingText = event.summary.trim();
    const mergedSummary =
      !previousText || previousText === "Thinking..."
        ? incomingText
        : !incomingText || incomingText === "Thinking..." || previousText.includes(incomingText)
          ? previousText
          : incomingText.includes(previousText)
            ? incomingText
            : `${previousText}\n\n${incomingText}`;
    collapsed[previousIndex] = {
      ...previous,
      summary: mergedSummary || "Thinking...",
      status:
        previous.status === "pending" || previous.status === "running" ||
        event.status === "pending" || event.status === "running"
          ? "pending"
          : event.status || previous.status,
      endedAt: event.endedAt ?? previous.endedAt,
      updateCount: previous.updateCount + event.updateCount,
    };
  }
  return collapsed;
}

function buildDisplayEvents(
  thoughtItems: ThoughtItem[],
  progressItems: ProgressItem[],
  commentaryItems: CommentaryItem[],
  fileChanges: StructuredFileChange[] | undefined,
  messageScopeIds?: Set<string>,
  currentMessageId?: string | null,
  parentResponseFinished = false,
  rawEventCount = 0,
): DisplayEvent[] {
  const stripTrailingEllipsis = (value?: string) =>
    (value || "").replace(/\s*(?:\.{3}|…)\s*$/u, "").trim();
  const normalizePathForMatch = (value?: string) =>
    (value || "").replace(/\\/g, "/").toLowerCase();
  const isMessageInScope = (messageId?: string | null): boolean => {
    // The centralized tape can describe one assistant turn through several
    // equivalent message IDs (root assistant message, child assistant reply,
    // or a later finalized snapshot). We therefore scope by the whole turn
    // identity set instead of a single message id, but we still keep rows that
    // do not carry an explicit message id because they already belong to the
    // current rendered turn.
    if (!messageScopeIds || messageScopeIds.size === 0) {
      return true;
    }
    if (!messageId) {
      return true;
    }
    return messageScopeIds.has(messageId);
  };
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

  type RawRenderEntry =
    | { seq: number; kind: "reasoning"; item: ThoughtItem }
    | { seq: number; kind: "activity"; item: ProgressItem }
    | { seq: number; kind: "commentary"; item: CommentaryItem };

  const entries: RawRenderEntry[] = [];
  const isSiblingScopedMessageId = (messageId?: string | null): boolean => {
    if (!currentMessageId || !messageId) {
      return false;
    }
    if (messageId === currentMessageId) {
      return false;
    }
    return !messageScopeIds || messageScopeIds.size === 0 || messageScopeIds.has(messageId);
  };

  for (const item of thoughtItems) {
    entries.push({
      kind: "reasoning",
      item,
      seq:
        typeof item.streamSeq === "number"
          ? item.streamSeq
          : seqFromThoughtKey(item.key),
    });
  }

  for (const item of progressItems) {
    entries.push({
      kind: "activity",
      item,
      seq:
        item.streamSeq != null
          ? item.streamSeq
          : Number.MAX_SAFE_INTEGER,
    });
  }

  for (const item of commentaryItems) {
    const text = (item.text || "").trim();
    if (!text) {
      continue;
    }
    entries.push({
      kind: "commentary",
      item,
      seq:
        item.streamSeq != null
          ? item.streamSeq
          : Number.MAX_SAFE_INTEGER,
    });
  }

  const lastFinishedActivitySeq = entries.reduce((best, entry) => {
    if (entry.kind !== "activity") {
      return best;
    }
    const status = (entry.item.status || "").toLowerCase();
    const isFinished =
      status === "done" ||
      status === "completed" ||
      status === "complete" ||
      status === "error" ||
      status === "failed";
    if (!isFinished) {
      return best;
    }
    return Math.max(best, entry.seq);
  }, Number.NEGATIVE_INFINITY);
  const lastKnownEntrySeq = entries.reduce(
    (best, entry) => Math.max(best, entry.seq),
    Number.NEGATIVE_INFINITY,
  );
  const appendBaseSeq =
    lastFinishedActivitySeq !== Number.NEGATIVE_INFINITY
      ? lastFinishedActivitySeq
      : lastKnownEntrySeq !== Number.NEGATIVE_INFINITY
        ? lastKnownEntrySeq
        : 0;

  let appendedSiblingOffset = 0;
  const normalizedEntries = entries.map((entry) => {
    const messageId =
      entry.kind === "activity"
        ? entry.item.messageID
        : entry.item.messageID;
    if (!isSiblingScopedMessageId(messageId)) {
      return entry;
    }

    appendedSiblingOffset += 1;
    return {
      ...entry,
      seq: appendBaseSeq + appendedSiblingOffset,
    };
  });

  // These item types are extracted into separate lanes, but their streamSeq
  // values are positions in one SDK tape. Walk that tape directly to restore
  // its authoritative order without applying a UI-level sort. Entries outside
  // the tape (hydrated snapshots/placeholders) stay after the live tape.
  const entriesBySdkSequence = new Map<number, RawRenderEntry[]>();
  const trailingEntries: RawRenderEntry[] = [];
  for (const entry of normalizedEntries) {
    if (
      Number.isInteger(entry.seq) &&
      entry.seq >= 0 &&
      entry.seq < rawEventCount
    ) {
      const entriesAtSequence = entriesBySdkSequence.get(entry.seq) ?? [];
      entriesAtSequence.push(entry);
      entriesBySdkSequence.set(entry.seq, entriesAtSequence);
    } else {
      trailingEntries.push(entry);
    }
  }
  const sdkOrderedEntries: RawRenderEntry[] = [];
  for (let streamSeq = 0; streamSeq < rawEventCount; streamSeq += 1) {
    // Do not use push(...entriesAtSequence) here. A long SDK tape can contain
    // thousands of rows, and spreading them into function arguments can throw
    // `RangeError: Maximum call stack size exceeded` before React gets to paint.
    const entriesAtSequence = entriesBySdkSequence.get(streamSeq);
    if (!entriesAtSequence) continue;
    for (const entry of entriesAtSequence) {
      sdkOrderedEntries.push(entry);
    }
  }
  for (const entry of trailingEntries) {
    sdkOrderedEntries.push(entry);
  }

  const rawEvents: DisplayEvent[] = [];

  for (const entry of sdkOrderedEntries) {
    if (entry.kind === "reasoning") {
      const item = entry.item;
      const text = (item.text || "").trim();
      if (!text) continue;
      if (!isMessageInScope(item.messageID)) {
        continue;
      }
      const source = item.source ?? sourceFromThoughtKey(item.key);
      rawEvents.push({
        key: `reasoning-${item.key}`,
        kind: "reasoning",
        label: "Reasoning",
        summary: text,
        status:
          parentResponseFinished && (item.status === "pending" || item.status === "running")
            ? "cancelled"
            : item.status || "done",
        source,
        messageID: item.messageID,
        partID: item.partID,
        // Carry timing through so the render layer can show "Thought for Xs"
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        isImportant: false,
        updateCount: 1,
        streamSeq: entry.seq,
      });
      continue;
    }

    if (entry.kind === "commentary") {
      const item = entry.item;
      const text = (item.text || "").trim();
      if (!text) continue;
      if (!isMessageInScope(item.messageID)) {
        continue;
      }
      rawEvents.push({
        key: item.id ? `commentary-${item.id}` : `commentary-${rawEvents.length}`,
        kind: "commentary",
        label: item.kind === "ai_response" ? "Assistant Response" : "Commentary",
        summary: text,
        status:
          parentResponseFinished && (item.status === "pending" || item.status === "running")
            ? "cancelled"
            : item.status || "done",
        messageID: item.messageID,
        partID: item.partID,
        isImportant: false,
        updateCount: 1,
        streamSeq: entry.seq,
      });
      continue;
    }

    const event = entry.item;
    if (!isMessageInScope(event.messageID)) {
      continue;
    }
    // Patch-derived File_edit rows duplicate the SDK's actual Edit tool row
    // and are emitted repeatedly as the patch snapshot evolves. They carry no
    // separate user-facing action, so exclude this derived representation in
    // the one shared timeline projection used by live and hydrated messages.
    if (event.activityDetail?.kind === "file_edit") {
      continue;
    }
    const rawTitle = event.title || "";
    const parsed = parseTimelineStepTitle(rawTitle);
    const cleanedRawTitle = stripTrailingEllipsis(rawTitle);
    const activityDetail = event.activityDetail;
    const source = event.source;
    const partType = event.partType;
    const internal = Boolean(event.internal);
    const activityFiles = Array.isArray(activityDetail?.files)
      ? activityDetail.files.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    let filePath = event.filePath || activityDetail?.file;
    if (!filePath && activityFiles.length > 0) {
      filePath = activityFiles[0];
    }
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

    const fileName = (() => {
      if (!filePath) return undefined;
      const segments = filePath.split(/[/\\]/);
      const lastSegment = segments.pop();
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
        continue;
      }
    }

    const questionLikeActivity = isQuestionLikeActivityTool(
      activityDetail?.tool,
      partType,
    );
    const cleanedLabel = questionLikeActivity && cleanedRawTitle
      ? cleanEventLabel(cleanedRawTitle)
      : cleanEventLabel(metadataFirstLabel);
    const normalizedSummary = (summary || cleanedRawTitle || "")
      .trim()
      .toLowerCase();
    const normalizedLabel = cleanedLabel.trim().toLowerCase();

    if (!cleanedLabel) {
      continue;
    }

    if (
      normalizedLabel === "step" &&
      normalizedSummary === "step" &&
      !filePath &&
      !diffStats &&
      !activityDetail
    ) {
      continue;
    }

    // step-start / step-finish are internal lifecycle signals. Preserve them
    // in the timeline but mark them so the renderer can display them as compact
    // lifecycle markers (Claude Code / Codex style) rather than full cards.
    const isLifecycleMarker =
      normalizedLabel === "step-start" ||
      normalizedLabel === "step-finish" ||
      normalizedLabel === "start" && normalizedSummary === "start" ||
      normalizedLabel === "finish" && normalizedSummary === "finish" ||
      (normalizedLabel === "step" && (normalizedSummary === "start" || normalizedSummary === "finish")) ||
      cleanedRawTitle.toLowerCase() === "step-start" ||
      cleanedRawTitle.toLowerCase() === "step-finish";
    rawEvents.push({
      key: event.key,
      kind: "activity",
      label: isLifecycleMarker ? cleanedRawTitle || cleanedLabel : cleanedLabel,
      summary: summary || cleanedRawTitle || "Activity update",
      description,
      detail: detail || undefined,
      status:
        parentResponseFinished && (event.status === "pending" || event.status === "running")
          ? "cancelled"
          : event.status,
      source,
      partType,
      // NOTE: lifecycle markers (step-start / step-finish) are flagged as internal
      // so the renderer can display them as compact chips instead of full cards.
      internal: internal || isLifecycleMarker,
      filePath,
      callID: event.callID,
      messageID: event.messageID,
      sessionID: event.sessionID || activityDetail?.sessionID,
      startedAt: event.startedAt,
      endedAt: event.endedAt,
      diffStats,
      activityDetail,
      viewDiffFile,
      partID: event.partID,
      isImportant: Boolean(
        event.status === "error" ||
          (event.status === "done" && (filePath || diffStats || viewDiffFile)) ||
          cleanedLabel === "error",
      ),
      updateCount: 1,
      streamSeq: entry.seq,
    });
  }

  const consecutiveReasoningCollapsed = collapseConsecutiveReasoningDisplayEvents(rawEvents);
  const deduped: DisplayEvent[] = [];
  const dedupedIndexByFingerprint = new Map<string, number>();
  const dedupedIndexByIdentity = new Map<string, number>();
  const dedupedIndexByTodoChecklist = new Map<string, number>();
  const dedupedIndexByActivitySnapshot = new Map<string, number>();
  const dedupedIndexByPatch = new Map<string, number>();
  for (const event of consecutiveReasoningCollapsed) {
    const todoChecklistIdentity = todoWriteChecklistIdentity(event);
    const snapshotIdentity = activitySnapshotIdentity(event);
    const patchIdentity = activityPatchIdentity(event);
    const existingTodoChecklistIndex = todoChecklistIdentity
      ? dedupedIndexByTodoChecklist.get(todoChecklistIdentity)
      : undefined;
    if (typeof existingTodoChecklistIndex === "number") {
      const existing = deduped[existingTodoChecklistIndex];
      // TodoWrite snapshots represent successive state for one checklist.
      // Merge forward so the completed list replaces the earlier 0/3 payload
      // even when both snapshots share the same hydrated source priority.
      deduped[existingTodoChecklistIndex] = mergeStickyDisplayEvent(existing, event);
      continue;
    }
    const existingPatchIndex = patchIdentity
      ? dedupedIndexByPatch.get(patchIdentity)
      : undefined;
    if (typeof existingPatchIndex === "number") {
      const existing = deduped[existingPatchIndex];
      const incomingPriority = displayEventSourcePriority(event.source);
      const existingPriority = displayEventSourcePriority(existing.source);
      deduped[existingPatchIndex] = mergeStickyDisplayEvent(
        incomingPriority > existingPriority ? existing : event,
        incomingPriority > existingPriority ? event : existing,
      );
      continue;
    }
    const existingSnapshotIndex = snapshotIdentity
      ? dedupedIndexByActivitySnapshot.get(snapshotIdentity)
      : undefined;
    if (typeof existingSnapshotIndex === "number") {
      const existing = deduped[existingSnapshotIndex];
      const existingPriority = displayEventSourcePriority(existing.source);
      const incomingPriority = displayEventSourcePriority(event.source);
      if (incomingPriority > existingPriority) {
        deduped[existingSnapshotIndex] = {
          ...existing,
          ...event,
          updateCount: existing.updateCount + 1,
        };
      } else {
        existing.updateCount += 1;
      }
      continue;
    }
    const stableIdentity =
      event.kind === "activity"
        ? activityDisplayEventIdentity(event)
        : firstNonEmptyString(
            event.partID ? `part:${event.partID}` : undefined,
            event.messageID ? `msg:${event.messageID}:${event.kind}` : undefined,
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
    if (todoChecklistIdentity) {
      dedupedIndexByTodoChecklist.set(todoChecklistIdentity, deduped.length);
    }
    if (snapshotIdentity) {
      dedupedIndexByActivitySnapshot.set(snapshotIdentity, deduped.length);
    }
    if (patchIdentity) {
      dedupedIndexByPatch.set(patchIdentity, deduped.length);
    }
    deduped.push({ ...event });
  }

  const collapsed: DisplayEvent[] = deduped;

  // Run the same semantic merge used by the sticky live projection once more
  // before handing rows to React. A centralized tape can contain repeated
  // pending/running/completed snapshots of one call (same part/call ID) that
  // entered through different adapters; this final pass guarantees that the
  // first render cannot paint both copies.
  return mergeStickyDisplayEventsForTurn([], collapsed);
}



export const SystemMessage = memo(function SystemMessage({
  content,
  accentColor = "var(--oc-accent)",
}: {
  content: string;
  accentColor?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { title, displayContent, collapsedPreview } = useMemo(() => {
    const trimmedContent = content.trim();
    const lines = trimmedContent.split("\n");
    const firstLine = lines[0]?.trim() ?? "";

    let nextTitle = "";
    let nextDisplayContent = trimmedContent;

    if (firstLine.startsWith("[") && firstLine.includes("]")) {
      const closingIdx = firstLine.indexOf("]");
      const rawTitle = firstLine.slice(0, closingIdx + 1).trim();
      const remainderOnFirstLine = firstLine.slice(closingIdx + 1).trim();
      const remainingLines = lines.slice(1).join("\n").trim();

      nextTitle = rawTitle;
      nextDisplayContent = [remainderOnFirstLine, remainingLines]
        .filter(Boolean)
        .join("\n")
        .trim();
    }

    if (!nextDisplayContent) {
      nextDisplayContent = nextTitle;
      nextTitle = "";
    }

    const nextCollapsedPreview = nextDisplayContent
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);

    return {
      title: nextTitle,
      displayContent: nextDisplayContent,
      collapsedPreview: nextCollapsedPreview,
    };
  }, [content]);
  const systemMessageStyle = useMemo(
    () =>
      ({
        "--oc-system-accent": accentColor,
      }) as CSSProperties,
    [accentColor],
  );

  // A transport envelope can be classified as a system row before it carries
  // its text part (or after that part has been replaced by an empty snapshot).
  // Do not mount the expandable system-card chrome for that empty envelope:
  // it appears as a duplicate blank panel with only a chevron and provides no
  // user-visible state. Real system directives still have displayContent and
  // render unchanged.
  if (!displayContent) {
    return null;
  }

  return (
    <div className="oc-message-enter mb-4" style={DEFERRED_CHAT_CARD_STYLE}>
      <section className="oc-system-message" style={systemMessageStyle}>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="oc-system-message__toggle"
          aria-label={isExpanded ? "Collapse system prompt" : "Expand system prompt"}
          aria-expanded={isExpanded}
        >
          <div className="oc-system-message__header">
            <div className="oc-system-message__title-block">
              <div className="oc-system-message__title-row">
                {title && <span className="oc-system-message__title">{title}</span>}
              </div>
              {!isExpanded && collapsedPreview ? (
                <p className="oc-system-message__preview">{collapsedPreview}</p>
              ) : null}
            </div>
          </div>
          <div className="oc-system-message__chevron" aria-hidden="true">
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform duration-300",
                isExpanded ? "rotate-180" : "",
              )}
            />
          </div>
        </button>

        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-300 ease-in-out",
            isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">
            <div className="oc-system-message__body">
              <div className="oc-system-message__content">
                {displayContent}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
});

export const BackgroundTaskReminderMessage = memo(function BackgroundTaskReminderMessage({
  message,
  messages,
}: {
  message?: Message;
  messages?: Message[];
}) {
  const reminderText = (message?.content ?? message?.text ?? "").trim();
  const backgroundTaskId = useMemo(
    () => backgroundTaskIdFromReminderText(reminderText),
    [reminderText],
  );
  const presentation = useMemo(
    () =>
      buildBackgroundTaskPresentation({
        taskId: backgroundTaskId,
        message,
        messages,
      }),
    [backgroundTaskId, message, messages],
  );
  const assistantConversationEvents = presentation.assistantConversationEvents;
  const assistantUpdateText = presentation.assistantUpdateText;
  const reminderActivityDetail = presentation.activityDetail;
  const reminderMessageId =
    firstNonEmptyString(message?.info?.id, message?.id, message?.messageId) ?? null;

  // TRACE logging disabled for performance
  // useEffect(() => {
  //   logger.info("[TRACE][BG_TASK_REMINDER][CARD]", {
  //     reminderMessageId,
  //     backgroundTaskId: presentation.backgroundTaskId,
  //     assistantConversationEventCount: assistantConversationEvents.length,
  //     assistantUpdateTextLength: assistantUpdateText.length,
  //     hasReminderActivityDetail: !!reminderActivityDetail,
  //     reminderActivityTool: reminderActivityDetail?.tool ?? null,
  //     reminderActivityBackgroundTaskId: reminderActivityDetail?.backgroundTaskId ?? null,
  //     reminderTextPreview: reminderText.slice(0, 200),
  //   });
  //   if (process.env.NODE_ENV === "development") {
  //     console.info("[TRACE][BG_TASK_REMINDER][CARD]", {
  //       reminderMessageId,
  //       backgroundTaskId: presentation.backgroundTaskId,
  //       assistantConversationEventCount: assistantConversationEvents.length,
  //       assistantUpdateTextLength: assistantUpdateText.length,
  //       hasReminderActivityDetail: !!reminderActivityDetail,
  //       reminderActivityTool: reminderActivityDetail?.tool ?? null,
  //       reminderActivityBackgroundTaskId: reminderActivityDetail?.backgroundTaskId ?? null,
  //       reminderTextPreview: reminderText.slice(0, 200),
  //     });
  //   }
  // }, [
  //   assistantConversationEvents.length,
  //   assistantUpdateText.length,
  //   presentation.backgroundTaskId,
  //   reminderActivityDetail,
  //   reminderMessageId,
  //   reminderText,
  // ]);

  return (
    <div className="oc-message-enter mb-4" style={DEFERRED_CHAT_CARD_STYLE}>
      <BackgroundOutputStep
        sessionID={firstNonEmptyString(
          message?.info?.sessionID,
          message?.info?.sessionId,
          message?.sessionID,
        )}
        status="done"
        source="final"
        activityDetail={reminderActivityDetail}
        assistantUpdateText={assistantUpdateText || undefined}
        assistantConversationEvents={assistantConversationEvents}
      />
    </div>
  );
});

export const UserMessage = memo(function UserMessage({ message, isQueued = false }: { message?: Message; isQueued?: boolean }) {
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [previewSelection, setPreviewSelection] = useState<CodeSelectionChipData | null>(null);
  const [copied, setCopied] = useState(false);
  const userMessageRef = useRef<HTMLDivElement>(null);
  // Hydrated user messages can contain SDK synthetic Read-tool echoes beside
  // the original text part. Prefer renderable user parts so server transport
  // text and attached file contents never leak into the user bubble.
  const rawUserText =
    messageBodyFromParts(message?.parts, message?.role ?? message?.info?.role) ||
    message?.content ||
    message?.text ||
    "";
  const codeSelections = useMemo(
    () => collectCodeSelectionsFromParts(message?.parts),
    [message?.parts],
  );
  const splitContent = useMemo(() => {
    if (codeSelections.length > 0) {
      return splitInjectedSystemPromptFromUserText(
        typeof rawUserText === "string" ? rawUserText : "",
      );
    }
    const withoutAttachmentEcho = stripHydratedAttachmentEcho(
      typeof rawUserText === "string" ? rawUserText : "",
      message,
    );
    const withoutGenericFenceEcho =
      stripGenericHydratedAttachmentFence(withoutAttachmentEcho);
    return splitInjectedSystemPromptFromUserText(withoutGenericFenceEcho);
  }, [message, rawUserText, codeSelections]);
  const content = splitContent.userText;
  const injectedSystemText = splitContent.systemText;
  const attachedFileChips = (message?.parts ?? [])
    .filter((part) => isExplicitFileAttachmentPart(part) && !isImageAttachmentPart(part))
    .map((part) => {
      const chip = buildExplicitFileChip(part);
      return chip
        ? { ...chip, textContent: !chip.path ? decodeTextDataUrl(part.url) : undefined }
        : undefined;
    })
    .filter((value): value is UserFileChip => !!value);
  const fileMentionTargets = Array.from(
    new Map(
      attachedFileChips
        .filter((chip): chip is UserFileChip & { path: string } => !!chip.path)
        .map((chip) => [chip.label, { filename: chip.label, path: chip.path }]),
    ).values(),
  );
  // @ references are represented by their inline blue mention. Do not render a
  // second attachment chip for the same SDK file part. Explicit uploads remain
  // visible as chips when they are not referenced inline.
  const explicitFileChips = attachedFileChips.filter(
    (chip) => !hasInlineFileMention(content, chip.label),
  );
  const inferredFileChips = inferAttachmentPathsFromHydratedUserText(
    typeof rawUserText === "string" ? rawUserText : "",
  ).map((filePath) => ({
    label: basenamePreservingLineSuffix(filePath),
    path: filePath,
  }));
  const fileChips = Array.from(
    new Map(
      [...explicitFileChips, ...inferredFileChips].map((chip) => [
        `${chip.path ?? ""}:${chip.label}`,
        chip,
      ]),
    ).values(),
  );
  const effectiveImages = Array.from(
    new Set([
      ...((message?.images ?? []).filter((src): src is string => typeof src === "string")),
      ...collectImageUrlsFromParts(message),
    ]),
  );
  const hasImages = effectiveImages.length > 0;

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
      await copyToClipboard(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
      return;
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };

  if (!message) return null;

  if (isPlanProceedMessageContent(content)) {
    return (
      <div className="oc-message-enter mt-6 mb-3.5 flex justify-end" style={DEFERRED_CHAT_CARD_STYLE}>
        <div className="oc-plan-approved-message flex w-fit max-w-[78%] flex-col items-end">
          <div className="oc-plan-approved-badge flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-oc-xs">
            <Check className="h-3.5 w-3.5" />
            <span className="font-medium">Plan Approved</span>
          </div>
          {fileChips.length > 0 && (
            <div className="oc-plan-approved-attachments" aria-label="Attached plan files">
              {fileChips.map((file, index) => (
                <button
                  key={`approved-plan-file-${index}:${file.path ?? file.label}`}
                  type="button"
                  className="oc-plan-approved-attachment"
                  onClick={() => vscode.postMessage({ type: "openFile", file: file.path || file.label })}
                  title={`Open ${file.path || file.label}`}
                >
                  <FileIcon filePath={file.path || file.label} className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{file.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }


  if (!content && !hasImages && !injectedSystemText && codeSelections.length === 0 && fileChips.length === 0) {
    return null;
  }

  return (
      <div className="oc-message-enter flex flex-col mt-6 mb-3.5 gap-1.5" style={DEFERRED_CHAT_CARD_STYLE}>
      {(content || hasImages || codeSelections.length > 0 || fileChips.length > 0) ? (
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
                        {renderHighlightedText(match[2], fileMentionTargets)}
                      </>
                    );
                  }
                  return renderHighlightedText(content, fileMentionTargets);
                })()}
              </div>
              {hasImages && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {effectiveImages.map((src: string, index: number) => (
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
              {fileChips.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {fileChips.map((label, index) => (
                    <button
                      key={`file-chip-${index}:${label.label}`}
                      type="button"
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-oc-border bg-oc-panel-soft px-2.5 py-1 text-[10px] font-medium text-oc-text-soft transition-colors hover:bg-oc-bg-soft"
                      title={label.textContent !== undefined ? `Open ${label.label} in a text tab` : label.path || label.label}
                      onClick={() => {
                        if (label.textContent !== undefined) {
                          vscode.postMessage({
                            type: "openText",
                            content: label.textContent,
                            filename: label.label,
                            languageId: label.label.split(".").pop(),
                          });
                          return;
                        }
                        vscode.postMessage({ type: "openFile", file: label.path || label.label });
                      }}
                    >
                      <FileIcon filePath={label.path || label.label} className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{label.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {codeSelections.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {codeSelections.map((sel, index) => {
                    const lineLabel =
                      sel.startLine && sel.endLine && sel.startLine !== sel.endLine
                        ? `${sel.startLine}-${sel.endLine}`
                        : `${sel.startLine ?? sel.endLine ?? sel.lineInfo ?? ""}`;
                    const name = sel.filename ?? sel.path ?? `selection-${index + 1}`;
                    const label = lineLabel ? `${name}:${lineLabel}` : name;
                    return (
                      <button
                        key={`code-sel-${index}`}
                        type="button"
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-oc-border bg-oc-panel-soft px-2.5 py-1 text-[10px] font-medium text-oc-text-soft transition-colors hover:bg-oc-bg-soft"
                        onClick={() => setPreviewSelection(sel)}
                        title={sel.path ?? label}
                      >
                        <FileCode className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="oc-user-message-meta">
              {isQueued ? (
                <span
                  className="oc-user-message-queue-state"
                  title="This message is queued and will be processed after the current response completes"
                >
                  <span className="oc-user-message-queue-dot" aria-hidden="true" />
                  <span>Queued</span>
                  <span className="oc-user-message-queue-next">Up next</span>
                </span>
              ) : null}
              {(() => {
                const ts = isQueued
                  ? null
                  : formatMessageTime(getMessageTimestamp(message));
                return ts ? (
                  <span className="oc-text-secondary text-[10px] tabular-nums opacity-70">
                    {ts}
                  </span>
                ) : null;
              })()}
              <button
                type="button"
                className={cn("oc-bubble-copy-btn oc-user-message-copy-btn", copied && "is-copied")}
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
      <CodeSelectionPreviewModal
        isOpen={previewSelection !== null}
        data={previewSelection}
        onClose={() => setPreviewSelection(null)}
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
): string | undefined {
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

  return undefined;
}

type CentralizedTokenInfo = {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
};

type CentralizedMetricsSnapshot = {
  tokens?: CentralizedTokenInfo;
  duration?: number;
  matchingPayloads: unknown[];
  sourcePayload?: unknown;
  sourcePayloadIndex?: number;
  sourceEventType?: string;
};

type LegacyMetricsDiagnostics = {
  tokenSource:
    | "message.info.tokens"
    | "message.rawResponse.info.tokens"
    | "message.tokens"
    | "none";
  durationSource:
    | "streaming.usage.duration"
    | "message.info.duration"
    | "message.rawResponse.info.time"
    | "message.duration"
    | "message.timing.duration"
    | "none";
  tokens?: CentralizedTokenInfo;
  duration?: number;
  rawResponseInfo?: Record<string, unknown> | null;
  rawResponseParsed?: Record<string, unknown> | null;
};

function asNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function asNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function parseRawResponseRecordForDiagnostics(
  raw: Message["rawResponse"],
): Record<string, unknown> | null {
  if (typeof raw === "object" && raw !== null) {
    return asRecord(raw);
  }
  if (typeof raw !== "string") {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const truncMatch = text.match(/\.\.\.<truncated\s+\d+\s+chars>\s*$/i);
  const candidate = truncMatch ? text.slice(0, truncMatch.index).trim() : text;
  try {
    return asRecord(JSON.parse(candidate));
  } catch {
    return null;
  }
}

function getRawResponseInfoRecordForDiagnostics(
  raw: Message["rawResponse"],
): Record<string, unknown> | null {
  const normalized = parseRawResponseRecordForDiagnostics(raw);
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

function extractCentralizedTokens(infoRecord: Record<string, unknown> | null): CentralizedTokenInfo | undefined {
  const rawTokens = asRecord(infoRecord?.tokens);
  if (!rawTokens) {
    return undefined;
  }

  const input = asNonNegativeInteger(rawTokens.input);
  const output = asNonNegativeInteger(rawTokens.output);
  const reasoning = asNonNegativeInteger(rawTokens.reasoning);
  const rawCache = asRecord(rawTokens.cache);
  const cacheRead = asNonNegativeInteger(rawCache?.read);
  const cacheWrite = asNonNegativeInteger(rawCache?.write);

  if (
    input === undefined &&
    output === undefined &&
    reasoning === undefined &&
    cacheRead === undefined &&
    cacheWrite === undefined
  ) {
    return undefined;
  }

  return {
    input,
    output,
    reasoning,
    cache:
      cacheRead !== undefined || cacheWrite !== undefined
        ? {
            read: cacheRead,
            write: cacheWrite,
          }
        : undefined,
  };
}

function extractCentralizedDurationSeconds(infoRecord: Record<string, unknown> | null): number | undefined {
  const infoDuration = asNonNegativeNumber(infoRecord?.duration);
  if (infoDuration !== undefined) {
    return infoDuration;
  }

  const rawTime = asRecord(infoRecord?.time);
  const created = asNonNegativeNumber(rawTime?.created);
  const completed = asNonNegativeNumber(rawTime?.completed);
  if (
    created !== undefined &&
    completed !== undefined &&
    completed >= created
  ) {
    return (completed - created) / 1000;
  }

  return undefined;
}

function eventMatchesAssistantScope(
  payload: unknown,
  assistantScopeMessageIds?: Set<string>,
): boolean {
  const info = getCentralizedEventInfo(payload);
  const role = asString(info?.role).trim().toLowerCase();
  if (role && role !== "assistant") {
    return false;
  }

  if (!assistantScopeMessageIds || assistantScopeMessageIds.size === 0) {
    return role === "assistant";
  }

  const messageId =
    extractSemanticEventMessageId(payload) ||
    firstNonEmptyString(info?.id, info?.messageID, info?.messageId) ||
    null;
  return !!messageId && assistantScopeMessageIds.has(messageId);
}

function getCentralizedMetricsSnapshot(
  rawSdkEventPayloads?: unknown[],
  assistantScopeMessageIds?: Set<string>,
): CentralizedMetricsSnapshot | undefined {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return undefined;
  }

  const matchingPayloads = rawSdkEventPayloads.filter((payload) =>
    eventMatchesAssistantScope(payload, assistantScopeMessageIds),
  );

  if (matchingPayloads.length === 0) {
    return undefined;
  }

  for (let index = matchingPayloads.length - 1; index >= 0; index -= 1) {
    const payload = matchingPayloads[index];
    const info = getCentralizedEventInfo(payload);
    const tokens = extractCentralizedTokens(info);
    const duration = extractCentralizedDurationSeconds(info);

    if (!tokens && duration === undefined) {
      continue;
    }

    return {
      tokens,
      duration,
      matchingPayloads,
      sourcePayload: payload,
      sourcePayloadIndex: index,
      sourceEventType: asString(asRecord(payload)?.type).trim() || undefined,
    };
  }

  return {
    matchingPayloads,
  };
}

/**
 * Type-safe helper to get token usage info from centralized assistant events only.
 */
function getTokenInfo(
  rawSdkEventPayloads?: unknown[],
  assistantScopeMessageIds?: Set<string>,
): CentralizedTokenInfo | undefined {
  return getCentralizedMetricsSnapshot(
    rawSdkEventPayloads,
    assistantScopeMessageIds,
  )?.tokens;
}

/**
 * Type-safe helper to get duration from centralized assistant events only.
 */
function getDuration(
  rawSdkEventPayloads?: unknown[],
  assistantScopeMessageIds?: Set<string>,
): number | undefined {
  return getCentralizedMetricsSnapshot(
    rawSdkEventPayloads,
    assistantScopeMessageIds,
  )?.duration;
}

function getLegacyMetricsDiagnostics(
  message: Message | undefined,
  streaming: StreamingState | undefined,
): LegacyMetricsDiagnostics {
  const rawResponseParsed = message
    ? parseRawResponseRecordForDiagnostics(message.rawResponse)
    : null;
  const rawResponseInfo = message
    ? getRawResponseInfoRecordForDiagnostics(message.rawResponse)
    : null;

  if (message?.info?.tokens) {
    return {
      tokenSource: "message.info.tokens",
      durationSource:
        streaming?.usage?.duration !== undefined &&
        typeof streaming.usage.duration === "number"
          ? "streaming.usage.duration"
          : message.info?.duration !== undefined &&
              typeof message.info.duration === "number"
            ? "message.info.duration"
            : "none",
      tokens: message.info.tokens,
      duration:
        streaming?.usage?.duration !== undefined &&
        typeof streaming.usage.duration === "number"
          ? streaming.usage.duration
          : typeof message.info.duration === "number"
            ? message.info.duration
            : undefined,
      rawResponseInfo,
      rawResponseParsed,
    };
  }

  const rawTokens = asRecord(rawResponseInfo?.tokens);
  const rawTimeRec = asRecord(rawResponseInfo?.time);
  const rawDuration =
    typeof rawTimeRec?.created === "number" &&
    typeof rawTimeRec?.completed === "number" &&
    rawTimeRec.completed >= rawTimeRec.created
      ? (rawTimeRec.completed - rawTimeRec.created) / 1000
      : undefined;

  if (rawTokens) {
    const rawCache = asRecord(rawTokens.cache);
    return {
      tokenSource: "message.rawResponse.info.tokens",
      durationSource:
        streaming?.usage?.duration !== undefined &&
        typeof streaming.usage.duration === "number"
          ? "streaming.usage.duration"
          : rawDuration !== undefined
            ? "message.rawResponse.info.time"
            : "none",
      tokens: {
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
      },
      duration:
        streaming?.usage?.duration !== undefined &&
        typeof streaming.usage.duration === "number"
          ? streaming.usage.duration
          : rawDuration,
      rawResponseInfo,
      rawResponseParsed,
    };
  }

  if (message && "tokens" in message) {
    const tokens = (message as Record<string, unknown>).tokens;
    if (tokens && typeof tokens === "object") {
      return {
        tokenSource: "message.tokens",
        durationSource:
          streaming?.usage?.duration !== undefined &&
          typeof streaming.usage.duration === "number"
            ? "streaming.usage.duration"
            : typeof message.duration === "number"
              ? "message.duration"
              : typeof message.timing?.duration === "number"
                ? "message.timing.duration"
                : "none",
        tokens: tokens as CentralizedTokenInfo,
        duration:
          streaming?.usage?.duration !== undefined &&
          typeof streaming.usage.duration === "number"
            ? streaming.usage.duration
            : typeof message.duration === "number"
              ? message.duration
              : typeof message.timing?.duration === "number"
                ? message.timing.duration
                : undefined,
        rawResponseInfo,
        rawResponseParsed,
      };
    }
  }

  return {
    tokenSource: "none",
    durationSource:
      streaming?.usage?.duration !== undefined &&
      typeof streaming.usage.duration === "number"
        ? "streaming.usage.duration"
        : message?.info?.duration !== undefined &&
            typeof message.info.duration === "number"
          ? "message.info.duration"
          : rawDuration !== undefined
            ? "message.rawResponse.info.time"
            : typeof message?.duration === "number"
              ? "message.duration"
              : typeof message?.timing?.duration === "number"
                ? "message.timing.duration"
                : "none",
    duration:
      streaming?.usage?.duration !== undefined &&
      typeof streaming.usage.duration === "number"
        ? streaming.usage.duration
        : typeof message?.info?.duration === "number"
          ? message.info.duration
          : rawDuration !== undefined
            ? rawDuration
            : typeof message?.duration === "number"
              ? message.duration
              : typeof message?.timing?.duration === "number"
                ? message.timing.duration
                : undefined,
    rawResponseInfo,
    rawResponseParsed,
  };
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

function formatThinkingVariantLabel(variant: string): string {
  const trimmed = variant.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

function getStableAgentAccentColor(agentName?: string): string {
  if (!agentName || agentName === "assistant") {
    // Default accent color so the agent name is always visually distinct in
    // the header, even when the SDK hasn't surfaced a non-default agent
    // name on the message envelope. Matches the empty-id hue from
    // getSubagentHue for visual consistency with the subagent palette.
    return `hsl(${getSubagentHue("")}, 72%, 68%)`;
  }
  return `hsl(${getSubagentHue(agentName)}, 72%, 68%)`;
}

type AssistantTurnMetadata = {
  agent?: string;
  modelID?: string;
  providerID?: string;
  variant?: string;
};

type AssistantHeaderSegment = {
  key: string;
  text: string;
  className: string;
  style?: CSSProperties;
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

    const normalizedType = getCentralizedEventType(record);
    const payloadRecord = asRecord(record.payload);
    const payloadSyncEvent = asRecord(payloadRecord?.syncEvent);
    const syncEvent = asRecord(record.syncEvent);
    const properties = asRecord(record.properties) || asRecord(payloadRecord?.properties);
    const syncData =
      asRecord(syncEvent?.data) ||
      asRecord(payloadSyncEvent?.data);

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
      continue;
    }

    const info = getCentralizedEventInfo(record) || asRecord(syncData?.info);
    if (info) {
      if (normalizedType === "session.updated" || normalizedType === "session.updated.1") {
        const agent = asString(info.agent);
        if (agent) metadata.agent = agent;
        const model = asRecord(info.model);
        if (model) {
          const modelID = asString(model.modelID) || asString(model.id);
          const providerID = asString(model.providerID);
          const variant = asString(model.variant);
          if (modelID) metadata.modelID = modelID;
          if (providerID) metadata.providerID = providerID;
          if (variant) metadata.variant = variant;
        }
        const modelID = asString(info.modelID);
        const providerID = asString(info.providerID);
        const variant = asString(info.variant);
        if (modelID) metadata.modelID = modelID;
        if (providerID) metadata.providerID = providerID;
        if (variant) metadata.variant = variant;
      } else if (normalizedType === "message.updated" || normalizedType === "message.updated.1") {
        if (asString(info.role) === "assistant") {
          const agent = asString(info.agent);
          if (agent) metadata.agent = agent;
          // Mirror session.updated: check the nested info.model object first
          // (SDK delivers model info as a nested object for parity with
          // session.updated). Without this, metadata.providerID stays empty
          // for message.updated-only turns and the header shows model-only.
          const nestedModel = asRecord(info.model);
          if (nestedModel) {
            const nestedModelID = asString(nestedModel.modelID) || asString(nestedModel.id);
            const nestedProviderID = asString(nestedModel.providerID);
            const nestedVariant = asString(nestedModel.variant);
            if (nestedModelID) metadata.modelID = nestedModelID;
            if (nestedProviderID) metadata.providerID = nestedProviderID;
            if (nestedVariant) metadata.variant = nestedVariant;
          }
          const modelID = asString(info.modelID);
          const providerID = asString(info.providerID);
          const variant = asString(info.variant);
          if (modelID) metadata.modelID = modelID;
          if (providerID) metadata.providerID = providerID;
          if (variant) metadata.variant = variant;
        }
      }
    }
  }

  return metadata;
}

function getCentralizedEventInfo(payload: unknown): Record<string, unknown> | null {
  const event = asRecord(payload);
  if (!event) {
    return null;
  }

  const payloadPropertiesInfo = asRecord(asRecord(asRecord(event.payload)?.properties)?.info);
  if (payloadPropertiesInfo) {
    return payloadPropertiesInfo;
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

/** Returns assistant response IDs with an explicit terminal signal. */
function finishedAssistantResponseMessageIds(payloads: unknown[]): Set<string> {
  const finishedIds = new Set<string>();
  for (const payload of payloads) {
    const event = asRecord(payload);
    const info = getCentralizedEventInfo(payload);
    const messageId = extractSemanticEventMessageId(payload);
    if (
      !event ||
      !info ||
      !messageId ||
      (asString(info.role).toLowerCase() !== "assistant" && !isAiResponseEvent(payload))
    ) {
      continue;
    }
    const time = asRecord(info.time);
    const finish = info.finish;
    const hasFinishReason =
      (typeof finish === "string" && finish.trim().length > 0) || finish === true;
    if (
      info.aborted === true ||
      event.aborted === true ||
      hasFinishReason ||
      time?.completed !== undefined ||
      time?.end !== undefined
    ) {
      finishedIds.add(messageId);
    }
  }
  return finishedIds;
}

function ResponseMessageInner({
  message,
  streaming,
  hideLoadingText = false,
  isContiguous,
  interactiveEvents,
  messages,
  currentSessionId,
  hideFileChangesSection,
  centralizedDiffEvent,
  subagentsByParentMessageId,
  subagentDetailsById,
  todoItems = [],
  blockGroupKey,
  isLastInBlock,
  isBlockExpanded,
  isBlockStreaming = false,
  isBlockHeaderAnchor = true,
  onSetBlockExpanded,
  blockSize = 1,
  isHiddenByBlock = false,
  blockHasInlineAbort = false,
}: {
  message?: Message;
  streaming?: StreamingState;
  hideLoadingText?: boolean;
  isContiguous?: boolean;
  interactiveEvents?: AppState["interactiveEvents"];
  messages?: Message[];
  currentSessionId?: AppState["currentSessionId"];
  hideFileChangesSection?: boolean;
  centralizedDiffEvent?: CentralizedSessionDiffEvent;
  subagentsByParentMessageId?: AppState["subagentsByParentMessageId"];
  subagentDetailsById?: AppState["subagentDetailsById"];
  todoItems?: AppState["todoItems"];
  // Block-level collapse/expand props (lifted from ChatShell).
  // Non-last assistant cards in a contiguous block share a single expanded state
  // so the entire block collapses/expands together. The last card in the block
  // (isLastInBlock === true) is always expanded and is never collapsible.
  blockGroupKey?: string;
  isLastInBlock?: boolean;
  isBlockExpanded?: boolean;
  // The current assistant block is actively streaming. Its content remains
  // expanded and no completed-turn expand/collapse controls are available.
  isBlockStreaming?: boolean;
  // Exactly one visible card in a response block owns the agent/model/thinking
  // metadata and statistics header.
  isBlockHeaderAnchor?: boolean;
  onSetBlockExpanded?: (expanded: boolean) => void;
  // Total number of assistant cards in this block (1 = single-card, unchanged behaviour).
  blockSize?: number;
  // When true the entire card should be visually hidden (non-last card in a
  // collapsed multi-card block). It stays in the DOM so DOM-dependent logic
  // (streaming refs, etc.) is not broken.
  isHiddenByBlock?: boolean;
}) {
  const dispatch = useAppDispatch();
  const {
    assistantTurnPending,
    assistantTurnMessageId,
    isLoadingSession,
    isProcessing,
    processingSessionIds,
    streaming: currentStreaming,
    selectedSubagentId,
    availableModels,
  } = useAppState(
    (state) => ({
      assistantTurnPending: state.assistantTurnPending,
      assistantTurnMessageId: state.assistantTurnMessageId,
      isLoadingSession: state.isLoadingSession,
      isProcessing: state.isProcessing,
      processingSessionIds: state.processingSessionIds,
      streaming: state.streaming,
      selectedSubagentId: state.selectedSubagentId,
      availableModels: state.availableModels,
    }),
    shallowEqual,
  );

  // NEW: Use custom hooks for simplified subagent data access
  // Keep the transcript activity scope separate from subagent-card ownership.
  // The streaming card has no persisted message, and assigning its stream id
  // to `messageId` makes the main activity renderer filter out live events.
  const messageId = message?.id || message?.info?.id;
  const subagentParentMessageId = messageId || (!message ? streaming?.messageId : undefined);
  const formattedSubagents = useSubagentsForParentMessage(subagentParentMessageId);
  // The final visible card is the one stable place for a response block's
  // shared UI. Keep each subagent's actual parentMessageId intact, then gather
  // those message-owned entries onto that final card for presentation.
  const inlineSubagentParentMessageIds = useMemo(() => {
    if (!subagentParentMessageId || !isLastInBlock || !blockGroupKey || !messages) {
      return subagentParentMessageId ? [subagentParentMessageId] : [];
    }
    return messages
      .filter((candidate) =>
        firstNonEmptyString(candidate.role, candidate.info?.role)?.toLowerCase() === "assistant" &&
        firstNonEmptyString(candidate.info?.parentID, candidate.info?.parentId) === blockGroupKey,
      )
      .map((candidate) => firstNonEmptyString(candidate.id, candidate.info?.id))
      .filter((id): id is string => Boolean(id));
  }, [blockGroupKey, isLastInBlock, messages, subagentParentMessageId]);
  // A live response can advance from the tool-call message to a later text
  // message before the child update arrives. In that narrow window the card
  // has no exact message-key match even though its current session owns the
  // subagent. Use this only as a live-card fallback; hydrated cards stay
  // strictly message-owned to avoid showing historical subagents elsewhere.
  const liveSessionSubagents = useMemo(() => {
    if (message || !currentSessionId) {
      return [] as SubagentSummary[];
    }
    const liveSessionParentMessageIds = new Set<string>([
      subagentParentMessageId,
      assistantTurnMessageId,
    ].filter((id): id is string => Boolean(id)));

    // A live response can move through several assistant phase IDs. Resolve
    // those phases through their shared user-turn parent, but never fall back
    // to every subagent in the session: that would render an older block's
    // card at the bottom of the conversation.
    const activeAssistantIds = new Set(
      (messages ?? [])
        .filter((candidate) =>
          firstNonEmptyString(candidate.role, candidate.info?.role)?.toLowerCase() === "assistant" &&
          collectMessageIdentityCandidates(candidate).has(assistantTurnMessageId || ""),
        )
        .map((candidate) => firstNonEmptyString(candidate.id, candidate.info?.id))
        .filter((id): id is string => Boolean(id)),
    );
    const activeTurnParentIds = new Set(
      (messages ?? [])
        .filter((candidate) => {
          const candidateId = collectMessageIdentityCandidates(candidate);
          return candidateId.size > 0 && Array.from(candidateId).some((id) => activeAssistantIds.has(id));
        })
        .map((candidate) => firstNonEmptyString(candidate.info?.parentID, candidate.info?.parentId))
        .filter((id): id is string => Boolean(id)),
    );
    for (const candidate of messages ?? []) {
      const role = firstNonEmptyString(candidate.role, candidate.info?.role)?.toLowerCase();
      const parentId = firstNonEmptyString(candidate.info?.parentID, candidate.info?.parentId);
      if (role === "assistant" && parentId && activeTurnParentIds.has(parentId)) {
        for (const id of collectMessageIdentityCandidates(candidate)) {
          liveSessionParentMessageIds.add(id);
        }
      }
    }

    return Object.values(subagentsByParentMessageId ?? {})
      .flat()
      .filter(
        (subagent) =>
          subagent?.parentSessionId === currentSessionId &&
          Boolean(subagent.parentMessageId) &&
          liveSessionParentMessageIds.has(subagent.parentMessageId),
      );
  }, [assistantTurnMessageId, currentSessionId, message, messages, subagentParentMessageId, subagentsByParentMessageId]);

  const [showSubagents, setShowSubagents] = useState(true);
  const [showAllSubagents, setShowAllSubagents] = useState(false);
  const [showTodoChecklist, setShowTodoChecklist] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isForking, setIsForking] = useState(false);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const messageBodyRef = useRef<HTMLDivElement>(null);
  const progressTimelineRef = useRef<HTMLDivElement>(null);
  const requestedSubagentConversationRef = useRef<Set<string>>(new Set());
  const activityTimelineMessage = message;
  // A persisted transcript card must never fall back to the session-global
  // stream. That stream belongs to the newest assistant turn; using it here
  // lets its response text, stats, and activity leak into older cards. The
  // dedicated message-less StreamingCard receives `streaming` explicitly.
  const activityTimelineStreaming = streaming;
  // A collapsed response card is the visible summary for one user turn. That
  // turn can contain several assistant SDK messages (tools, then prose). Keep
  // their authoritative parts together here, but only on the one visible card.
  // Expanded cards stay individually scoped, which prevents duplicated rows.
  const shouldAggregateCollapsedBlockActivity = Boolean(
    isLastInBlock &&
      isBlockExpanded !== true &&
      blockGroupKey &&
      Array.isArray(messages),
  );
  const collapsedBlockAssistantMessages = useMemo(
    () =>
      shouldAggregateCollapsedBlockActivity
        ? (messages ?? []).filter((candidate) =>
            firstNonEmptyString(candidate.role, candidate.info?.role)?.toLowerCase() === "assistant" &&
            firstNonEmptyString(candidate.info?.parentID, candidate.info?.parentId) === blockGroupKey,
          )
        : [],
    [blockGroupKey, messages, shouldAggregateCollapsedBlockActivity],
  );
  const collapsedBlockAssistantMessageIds = useMemo(
    () =>
      collapsedBlockAssistantMessages
        .map((candidate) => firstNonEmptyString(candidate.id, candidate.info?.id))
        .filter((id): id is string => Boolean(id)),
    [collapsedBlockAssistantMessages],
  );
  const assistantMessageId =
    message?.info?.id ||
    message?.id ||
    assistantTurnMessageId ||
    activityTimelineStreaming?.messageId ||
    null;
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
  // Live raw events are scoped to the active streaming turn. Completed cards
  // use the SDK snapshot fields on `message` and never consult a session tape.
  const sessionScopedRawSdkEventPayloads =
    activityTimelineStreaming?.rawSdkEventPayloads ?? [];
  const hasCentralizedPendingAssistantReply = useMemo(
    () => hasActiveAssistantReplyInCentralizedTape(activityTimelineStreaming?.rawSdkEventPayloads ?? []),
    [activityTimelineStreaming?.rawSdkEventPayloads],
  );
  const isLiveAssistantTurn = !!(
    activityTimelineStreaming?.isActive ||
    assistantTurnPending ||
    hasCentralizedPendingAssistantReply
  );
  const currentMessageIdentityCandidates = useMemo(
    () => collectMessageIdentityCandidates(message),
    [message],
  );
  const liveAssistantTurnIdentityCandidates = useMemo(() => {
    const ids = new Set<string>();
    for (const candidate of [
      assistantTurnMessageId,
      activityTimelineStreaming?.messageId,
    ]) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        ids.add(candidate.trim());
      }
    }
    return ids;
  }, [activityTimelineStreaming?.messageId, assistantTurnMessageId]);
  const isCurrentCardLiveAssistantTurn = useMemo(() => {
    if (!isLiveAssistantTurn) {
      return false;
    }
    if (!message) {
      return true;
    }
    if (currentMessageIdentityCandidates.size === 0) {
      return false;
    }
    for (const candidate of currentMessageIdentityCandidates) {
      if (liveAssistantTurnIdentityCandidates.has(candidate)) {
        return true;
      }
    }
    return false;
  }, [
    currentMessageIdentityCandidates,
    isLiveAssistantTurn,
    liveAssistantTurnIdentityCandidates,
    message,
  ]);
  const assistantTurnRootMessageId = firstNonEmptyString(
    assistantMessageId,
    activityTimelineStreaming?.messageId,
    assistantTurnMessageId,
    !isLiveAssistantTurn
      ? latestAssistantMessageIdFromCentralizedTape(sessionScopedRawSdkEventPayloads)
      : null,
  ) || null;
  const latestSyncWrappedAssistantMessageId = useMemo(() => {
    if (isLiveAssistantTurn) {
      return null;
    }
    const candidates = Array.from(
      collectCentralizedTurnMessageIdCandidates(sessionScopedRawSdkEventPayloads),
    );
    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
  }, [isLiveAssistantTurn, sessionScopedRawSdkEventPayloads]);
  const assistantTurnAnchorMessageId = firstNonEmptyString(
    assistantTurnRootMessageId,
    latestSyncWrappedAssistantMessageId,
  ) || null;
  const liveAssistantTurnParentMessageId = useMemo(() => {
    const liveAssistantIds = new Set(
      [assistantTurnMessageId, activityTimelineStreaming?.messageId, assistantMessageId]
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim()),
    );
    if (liveAssistantIds.size === 0) {
      return null;
    }

    for (let index = sessionScopedRawSdkEventPayloads.length - 1; index >= 0; index -= 1) {
      const event = sessionScopedRawSdkEventPayloads[index];
      const info = getCentralizedEventInfo(event);
      const eventMessageId = firstNonEmptyString(
        asString(info?.id),
        extractSemanticEventMessageId(event),
      );
      if (!eventMessageId || !liveAssistantIds.has(eventMessageId)) {
        continue;
      }
      const parentId = firstNonEmptyString(
        asString(info?.parentID),
        asString(info?.parentId),
      );
      if (parentId) {
        return parentId;
      }
    }
    return null;
  }, [
    activityTimelineStreaming?.messageId,
    assistantMessageId,
    assistantTurnMessageId,
    sessionScopedRawSdkEventPayloads,
  ]);
  const assistantScopeMessageIds = useMemo(() => {
    return buildAssistantScopeMessageIds({
      message,
      assistantMessageId,
      streamingMessageId: activityTimelineStreaming?.messageId ?? null,
      assistantTurnMessageId,
      assistantTurnRootMessageId,
      assistantTurnAnchorMessageId,
      additionalMessageIds: collapsedBlockAssistantMessageIds,
      includeLiveTurnIds: isCurrentCardLiveAssistantTurn,
    });
  }, [
    message,
    assistantMessageId,
    activityTimelineStreaming?.messageId,
    assistantTurnMessageId,
    assistantTurnRootMessageId,
    assistantTurnAnchorMessageId,
    collapsedBlockAssistantMessageIds,
    isCurrentCardLiveAssistantTurn,
  ]);
  const messageAttachedRawSdkEventPayloads = useMemo(
    () => (Array.isArray(message?.rawSdkEventPayloads) ? message.rawSdkEventPayloads : []),
    [message?.rawSdkEventPayloads],
  );
  const centralizedRawSdkEventPayloads = useMemo(() => {
    // Handle case where message is undefined
    if (!message) {
      if (assistantScopeMessageIds.size > 0) {
        const scopedLivePayloads = sessionScopedRawSdkEventPayloads.filter((event) =>
          eventBelongsToAssistantScope(event, assistantScopeMessageIds),
        );
        if (scopedLivePayloads.length > 0) {
          return scopedLivePayloads;
        }
      }
      return sessionScopedRawSdkEventPayloads;
    }

    // Get all candidate message IDs for the current message
    const messageCandidateIds = new Set<string>();
    for (const candidate of collectMessageIdentityCandidates(message)) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        messageCandidateIds.add(candidate.trim());
      }
    }
    for (const candidate of assistantScopeMessageIds) {
      if (candidate.trim().length > 0) {
        messageCandidateIds.add(candidate.trim());
      }
    }

    const attachedPayloadsWithoutIds = messageAttachedRawSdkEventPayloads.filter((event) =>
      !extractSemanticEventMessageId(event),
    );
    const sessionScopedNoIdPayloads = sessionScopedRawSdkEventPayloads.filter((event) =>
      isAssistantScopedNoIdPayloadCandidate(event),
    );

    // Filter session-scoped events to only those belonging to this message
    const messageSpecificEvents: unknown[] = [];

    for (const event of sessionScopedRawSdkEventPayloads) {
      // Check if this event belongs to the current message
      if (eventBelongsToAssistantScope(event, messageCandidateIds)) {
        messageSpecificEvents.push(event);
      }
    }

    // If we found message-specific events, use those
    if (messageSpecificEvents.length > 0) {
      return [
        ...messageSpecificEvents,
        ...sessionScopedNoIdPayloads,
        ...attachedPayloadsWithoutIds,
      ];
    }

    // Fallback: message-attached payloads are usually already scoped to this
    // card. When they include ids, still filter them through the same normal /
    // syncEvent-aware path so stale duplicated data cannot leak across turns.
    if (messageAttachedRawSdkEventPayloads.length > 0) {
      const attachedPayloadsWithIds = messageAttachedRawSdkEventPayloads.filter((event) =>
        !!extractSemanticEventMessageId(event),
      );
      const scopedAttachedPayloads = messageAttachedRawSdkEventPayloads.filter((event) =>
        eventBelongsToAssistantScope(event, messageCandidateIds),
      );
      if (scopedAttachedPayloads.length > 0) {
        // Message-attached payloads are already card-scoped by persistence.
        // Preserve entries that lack an explicit message id so top-level
        // assistant activity and header metadata (agent/model/thinking) do not
        // disappear during rehydration just because the payload shape is
        // session-scoped rather than message-scoped.
        return [
          ...scopedAttachedPayloads,
          ...sessionScopedNoIdPayloads,
          ...attachedPayloadsWithoutIds,
        ];
      }
      if (attachedPayloadsWithIds.length === 0) {
        return [...messageAttachedRawSdkEventPayloads, ...sessionScopedNoIdPayloads];
      }
    }

    if (messageCandidateIds.size === 0) {
      if (message?.aborted && messageAttachedRawSdkEventPayloads.length > 0) {
        return [
          ...messageAttachedRawSdkEventPayloads,
          ...sessionScopedNoIdPayloads,
        ];
      }
      return [];
    }

    // Final fallback: older hydrated messages may only carry raw SDK payloads
    // on sibling message objects. Search them, but never take "all messages";
    // only events whose normal or syncEvent payload ids match this assistant
    // scope are allowed into this card.
    if (!Array.isArray(messages) || messages.length === 0) {
      return [];
    }

    const collectedEvents: unknown[] = [];
    const seenEventSignatures = new Set<string>();

    for (const msg of messages) {
      const msgEvents = Array.isArray((msg as Record<string, unknown>)?.rawSdkEventPayloads)
        ? (msg as Record<string, unknown>).rawSdkEventPayloads as unknown[]
        : [];

      for (const event of msgEvents) {
        if (!eventBelongsToAssistantScope(event, messageCandidateIds)) {
          continue;
        }
        const signature = centralizedDebugPayloadFingerprint(event);
        if (signature && !seenEventSignatures.has(signature)) {
          seenEventSignatures.add(signature);
          collectedEvents.push(event);
        }
      }
    }

    return collectedEvents;
  }, [
    sessionScopedRawSdkEventPayloads,
    messageAttachedRawSdkEventPayloads,
    messages,
    message,
    assistantMessageId,
    assistantScopeMessageIds,
  ]);
  // A single user turn may create several assistant SDK envelopes (reasoning,
  // tools, then response). Key sticky timeline state to the shared block when
  // available so moving from one envelope to the next cannot clear activity
  // already painted for that turn.
  const activityTimelineTurnMessageId = firstNonEmptyString(
    blockGroupKey,
    // A tool-driven assistant response advances through multiple SDK assistant
    // message IDs under one user parent. The live card has no ChatShell block
    // key, so use that parent as its stable turn key; otherwise each phase
    // replaces the visible timeline with only its latest tool rows.
    liveAssistantTurnParentMessageId,
    assistantTurnAnchorMessageId,
    assistantTurnMessageId,
    assistantMessageId,
    activityTimelineStreaming?.messageId,
  ) || null;
  const stickyCentralizedRawSdkEventPayloadsRef = useRef<{
    messageId: string | null;
    sessionId: string | null;
    payloads: unknown[];
    isLive: boolean;
  }>({ messageId: null, sessionId: null, payloads: [], isLive: false });
  if (
    stickyCentralizedRawSdkEventPayloadsRef.current.messageId !==
    activityTimelineTurnMessageId
  ) {
    // Assistant envelope IDs are not a stream boundary. The event/session
    // admission path already rejects foreign sessions, so retain the accepted
    // tape across every same-session phase and activity group. Reset only when
    // the selected session itself changes.
    const sessionChanged = Boolean(
      stickyCentralizedRawSdkEventPayloadsRef.current.sessionId &&
        centralizedSessionId &&
        stickyCentralizedRawSdkEventPayloadsRef.current.sessionId !== centralizedSessionId,
    );
    stickyCentralizedRawSdkEventPayloadsRef.current = {
      messageId: activityTimelineTurnMessageId,
      sessionId: centralizedSessionId,
      payloads: sessionChanged ? [] : stickyCentralizedRawSdkEventPayloadsRef.current.payloads,
      isLive: isLiveAssistantTurn,
    };
  } else {
    stickyCentralizedRawSdkEventPayloadsRef.current.isLive = isLiveAssistantTurn;
    stickyCentralizedRawSdkEventPayloadsRef.current.sessionId = centralizedSessionId;
  }
  if (centralizedRawSdkEventPayloads.length > 0) {
    stickyCentralizedRawSdkEventPayloadsRef.current = {
      messageId: activityTimelineTurnMessageId,
      sessionId: centralizedSessionId,
      payloads: centralizedRawSdkEventPayloads,
      isLive: isLiveAssistantTurn,
    };
  }
  const effectiveCentralizedRawSdkEventPayloads =
    centralizedRawSdkEventPayloads.length > 0
      ? centralizedRawSdkEventPayloads
      : stickyCentralizedRawSdkEventPayloadsRef.current.messageId === activityTimelineTurnMessageId
        ? stickyCentralizedRawSdkEventPayloadsRef.current.payloads
        : [];
  const scopedActivityTimelineStreaming = useMemo(() => {
    if (!activityTimelineStreaming) {
      return undefined;
    }

    const streamingMessageId = asString(activityTimelineStreaming.messageId).trim();
    if (!message || isCurrentCardLiveAssistantTurn) {
      // A hydrated assistant message can expose an equivalent ID through a
      // different field (`id`, `info.id`, or the active-turn anchor).  The
      // turn-aware identity check above considers all of those candidates.
      // Comparing only the preferred assistantMessageId here made the live
      // overlay disappear until the next hydration snapshot arrived.
      return activityTimelineStreaming;
    }

    if (!streamingMessageId && currentMessageIdentityCandidates.size === 0) {
      // Legacy assistant cards without an identity cannot be scoped more
      // precisely. Preserve the existing fallback only for that case.
      return activityTimelineStreaming;
    }

    // A stream for another assistant turn must never appear in this card.
    return undefined;
  }, [
    activityTimelineStreaming,
    currentMessageIdentityCandidates.size,
    isCurrentCardLiveAssistantTurn,
    message,
  ]);
  const turnMetadata = useMemo(
    () =>
      getAssistantTurnMetadataFromCentralizedEvents(
        effectiveCentralizedRawSdkEventPayloads,
      ),
    [effectiveCentralizedRawSdkEventPayloads],
  );
  // Normalize the centralized tape once at the boundary so downstream helpers
  // only see a single event shape, regardless of whether the original entry was
  // stored as `properties.part` or `payload.syncEvent.data.part`.
  const normalizedCentralizedRawSdkEventPayloads = useMemo(
    () => normalizeCentralizedEventPayloads(effectiveCentralizedRawSdkEventPayloads),
    [effectiveCentralizedRawSdkEventPayloads],
  );
  const cardMessage = activityTimelineMessage;
  const hydratedActivityParts = useMemo(
    () =>
      collapsedBlockAssistantMessages.length > 0
        ? collapsedBlockAssistantMessages.flatMap((candidate) =>
            Array.isArray(candidate.parts) ? candidate.parts : [],
          )
        : cardMessage?.parts ?? [],
    [cardMessage?.parts, collapsedBlockAssistantMessages],
  );
  const hydratedActivitySteps = useMemo(
    () =>
      collapsedBlockAssistantMessages.length > 0
        ? collapsedBlockAssistantMessages.flatMap((candidate) => {
            // Hydrated messages mirror the canonical activity list into both
            // `steps` and `progressEvents`. Prefer one representation so the
            // same tool call is not projected twice before semantic merging.
            if (Array.isArray(candidate.steps) && candidate.steps.length > 0) {
              return candidate.steps;
            }
            return Array.isArray(candidate.progressEvents) ? candidate.progressEvents : [];
          })
        : Array.isArray(cardMessage?.steps) && cardMessage.steps.length > 0
          ? cardMessage.steps
          : (cardMessage?.progressEvents ?? []),
    [
      cardMessage?.progressEvents,
      cardMessage?.steps,
      collapsedBlockAssistantMessages,
    ],
  );
  const rawContentChunks = useMemo(
    () =>
      getCentralizedAssistantContentChunksFromRawSdkEventPayloads(
        normalizedCentralizedRawSdkEventPayloads,
      ),
    [normalizedCentralizedRawSdkEventPayloads],
  );
  const rawContent = rawContentChunks.join("");
  // The final structured response can live on a later assistant phase than
  // the card envelope selected for this render. In collapsed blocks, search
  // the complete coalesced block in reverse arrival order so the final SDK
  // response remains visible even when the selected card only contains tools
  // or commentary parts.
  const responseSourceMessage =
    [...collapsedBlockAssistantMessages].reverse().find((candidate) => {
      const candidateStructured =
        asRecord(candidate.structuredOutput) ??
        asRecord(candidate.info?.structuredOutput) ??
        asRecord(candidate.info?.structured) ??
        asRecord(
          structuredOutputFromRawSdkEventPayloads(candidate.rawSdkEventPayloads),
        );
      return Boolean(
        asString(candidateStructured?.message).trim() ||
        asString(candidateStructured?.text).trim(),
      );
    }) ?? cardMessage;
  const structuredSnapshot =
    asRecord(responseSourceMessage?.structuredOutput) ??
    asRecord(responseSourceMessage?.info?.structuredOutput) ??
    asRecord(responseSourceMessage?.info?.structured) ??
    asRecord(
      structuredOutputFromRawSdkEventPayloads(responseSourceMessage?.rawSdkEventPayloads),
    );
  const snapshotContent = firstNonEmptyString(
    responseSourceMessage?.content,
    responseSourceMessage?.text,
    asString(structuredSnapshot?.message),
    asString(structuredSnapshot?.text),
    cardMessage?.parts
      ?.filter((part) => part?.type === "text")
      .map((part) => firstNonEmptyString(part.text, part.content, part.message) ?? "")
      .join(""),
  ) ?? "";
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
      : rawContent || snapshotContent;
  const hasAssistantFinishSignal =
    scopedActivityTimelineStreaming?.hasAssistantFinishSignal === true;
  const hasActiveReasoningPart = scopedActivityTimelineStreaming?.inReasoningPart === true;
  const hasTerminalStepSignal =
    scopedActivityTimelineStreaming?.hasTerminalStepSignal === true;
  const finishedResponseMessageIds = useMemo(
    () => finishedAssistantResponseMessageIds([
      ...sessionScopedRawSdkEventPayloads,
      ...messageAttachedRawSdkEventPayloads,
    ]),
    [sessionScopedRawSdkEventPayloads, messageAttachedRawSdkEventPayloads],
  );
  const isParentResponseFinished =
    cardMessage?.aborted === true ||
    asString(asRecord(cardMessage?.info)?.finish).trim().length > 0 ||
    asRecord(asRecord(cardMessage?.info)?.time)?.completed !== undefined ||
    hasAssistantFinishSignal ||
    Array.from(assistantScopeMessageIds).some((id) =>
      finishedResponseMessageIds.has(id),
    );
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
  // Rehydrated messages come from `session.messages()` and retain reasoning as
  // typed message parts. Use that snapshot when there is no live/raw overlay.
  const snapshotThoughtItems = useMemo(
    () => thoughtItemsFromStreamingReasoningEvents(cardMessage?.reasoningEvents, false),
    [cardMessage?.reasoningEvents],
  );
  const liveThoughtItems = useMemo(
    () => {
      const items = thoughtItemsFromStreamingReasoningEvents(
        scopedActivityTimelineStreaming?.reasoningEvents,
        scopedActivityTimelineStreaming?.isActive === true,
      );
      // Live delta text is deliberately not retained in React state. Keep a
      // single, cheap status row until the SDK supplies the completed part.
      if (
        items.length === 0 &&
        scopedActivityTimelineStreaming?.isActive === true &&
        scopedActivityTimelineStreaming.inReasoningPart === true
      ) {
        return [{
          key: "live-reasoning-placeholder",
          text: "Thinking...",
          messageID: scopedActivityTimelineStreaming.messageId ?? undefined,
          source: "stream" as const,
          status: "pending" as const,
          // Delta text is intentionally not retained in state. This row stands
          // for the newest stream event, so it belongs after any activity that
          // rendered before the delta instead of defaulting to timeline index 0.
          streamSeq: Number.MAX_SAFE_INTEGER,
        }];
      }
      return items;
    },
    [
      scopedActivityTimelineStreaming?.reasoningEvents,
      scopedActivityTimelineStreaming?.isActive,
      scopedActivityTimelineStreaming?.inReasoningPart,
      scopedActivityTimelineStreaming?.messageId,
    ],
  );
  const thoughtItems = useMemo(
    () => mergeThoughtItemsForTimeline(
      mergeThoughtItemsForTimeline(finalizedThoughtItems, snapshotThoughtItems),
      liveThoughtItems,
      isStreamingActive,
    ),
    [finalizedThoughtItems, snapshotThoughtItems, liveThoughtItems, isStreamingActive],
  );
  const progressItems = useMemo(
    () => {
      const fromRaw = progressItemsFromCentralizedData(normalizedCentralizedRawSdkEventPayloads);
      const fromSnapshotParts = progressItemsFromRawResponseParts({
        parts: hydratedActivityParts,
      });
      const fromSnapshotSteps = progressItemsFromSteps(
        hydratedActivitySteps,
        "sdk-snapshot",
      );
      // These are complementary representations of the same turn, not
      // mutually-exclusive fallbacks. A live/raw tape commonly contains only
      // some tool parts while the SDK message snapshot carries the rest. Run
      // both through the canonical merge in every frame; returning their raw
      // concatenation during a stream creates duplicate and stale rows.
      // `fromRaw` is first, so current live state remains authoritative until
      // the corresponding hydrated snapshot catches up.
      return mergeProgressItemsForTimeline(
        fromRaw,
        [...fromSnapshotParts, ...fromSnapshotSteps],
      );
    },
    [
      hydratedActivityParts,
      hydratedActivitySteps,
      isLiveAssistantTurn,
      normalizedCentralizedRawSdkEventPayloads,
    ],
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
    () =>
      mergeProgressItemsForTimeline(
        progressItems,
        liveProgressItems,
        isStreamingActive,
      ),
    [progressItems, liveProgressItems, isStreamingActive],
  );
  const liveDuplicateProgressTraceRef = useRef("");
  useEffect(() => {
    const groups = new Map<string, ProgressItem[]>();
    for (const item of mergedProgressItems) {
      const fingerprint = progressVisibleActionIdentity(item);
      if (!fingerprint) continue;
      groups.set(fingerprint, [...(groups.get(fingerprint) ?? []), item]);
    }
    const duplicates = [...groups.entries()]
      .filter(([, items]) => items.length > 1)
      .map(([fingerprint, items]) => ({
        fingerprint,
        rows: items.map((item) => ({
          key: item.key,
          mergeKey: item.mergeKey,
          id: item.id,
          callID: item.callID,
          messageID: item.messageID,
          streamSeq: item.streamSeq,
          source: item.source,
          status: item.status,
        })),
      }));
    if (duplicates.length === 0) return;
    const signature = JSON.stringify(duplicates);
    if (signature === liveDuplicateProgressTraceRef.current) return;
    liveDuplicateProgressTraceRef.current = signature;
    logger.error("[ACTIVITY-DUPLICATE-TRACE] identical visible rows survived progress merge", {
      messageId,
      streamingMessageId: activityTimelineStreaming?.messageId ?? null,
      isStreamingActive,
      turnId: activityTimelineTurnMessageId,
      duplicates,
      finalizedCount: progressItems.length,
      liveCount: liveProgressItems.length,
      mergedCount: mergedProgressItems.length,
    });
  }, [
    activityTimelineStreaming?.messageId,
    activityTimelineTurnMessageId,
    isStreamingActive,
    liveProgressItems,
    mergedProgressItems,
    messageId,
    progressItems,
  ]);
  // The final sticky display tape can preserve a row after the progress
  // projection has already dropped it. That made the old loss detector silent
  // while the user-visible activity-step list still shrank. Track the merge
  // boundary itself so every partial loss is reported, including losses caused
  // by a new SDK step-start/step-finish phase.
  const liveProgressLossTraceRef = useRef<{
    sessionId: string | null;
    streamingMessageId: string | null;
    rows: Map<string, ProgressItem>;
    lastSignature: string;
  }>({ sessionId: null, streamingMessageId: null, rows: new Map(), lastSignature: "" });
  useEffect(() => {
    const identityForProgressItem = (item: ProgressItem): string =>
      // A tool snapshot can gain its structured input after the pending
      // envelope. Keep that update attached to the same row by callID before
      // considering the cross-call visible-action fingerprint.
      (item.callID ? `call:${item.callID}` : "") ||
      progressVisibleActionIdentity(item) ||
      progressItemIdentityKey(item) ||
      (item.id ? `id:${item.id}` : "") ||
      item.key;
    const rows = new Map<string, ProgressItem>();
    for (const item of mergedProgressItems) {
      rows.set(identityForProgressItem(item), item);
    }
    const previous = liveProgressLossTraceRef.current;
    const sameSession = previous.sessionId === currentSessionId;
    const streamingMessageId = activityTimelineStreaming?.messageId ?? null;
    const sameStreamingPhase = previous.streamingMessageId === streamingMessageId;
    // A new assistant message ID is a legitimate OpenCode phase transition.
    // Its raw finalized rows are replaced by the new live phase rows; that is
    // not a rendered-row loss and must not be reported as one.
    if (sameSession && sameStreamingPhase && isStreamingActive) {
      const removed = [...previous.rows.entries()]
        .filter(([identity]) => !rows.has(identity))
        .map(([identity, item]) => ({
          identity,
          key: item.key,
          mergeKey: item.mergeKey,
          title: item.title,
          partType: item.partType,
          status: item.status,
          source: item.source,
          id: item.id,
          callID: item.callID,
          messageID: item.messageID,
          streamSeq: item.streamSeq,
        }));
      if (removed.length > 0) {
        const signature = JSON.stringify({
          sessionId: currentSessionId,
          streamingMessageId: activityTimelineStreaming?.messageId ?? null,
          removed,
          previousCount: previous.rows.size,
          currentCount: rows.size,
        });
        if (signature !== previous.lastSignature) {
          logger.error("[ACTIVITY-LIVE-LOSS] progress rows disappeared before display projection", {
            sessionId: currentSessionId,
            streamingMessageId: activityTimelineStreaming?.messageId ?? null,
            removed,
            currentRows: [...rows.values()].map((item) => ({
              identity: identityForProgressItem(item),
              key: item.key,
              mergeKey: item.mergeKey,
              title: item.title,
              partType: item.partType,
              status: item.status,
              source: item.source,
              id: item.id,
              callID: item.callID,
              messageID: item.messageID,
              streamSeq: item.streamSeq,
            })),
            finalizedCount: progressItems.length,
            liveCount: liveProgressItems.length,
            mergedCount: mergedProgressItems.length,
          });
          previous.lastSignature = signature;
        }
      }
    }
    liveProgressLossTraceRef.current = {
      sessionId: currentSessionId,
      streamingMessageId,
      rows,
      lastSignature: previous.lastSignature,
    };
  }, [
    activityTimelineStreaming?.messageId,
    currentSessionId,
    isStreamingActive,
    liveProgressItems,
    mergedProgressItems,
    progressItems,
  ]);
  const visibleTurnUserPromptText = useMemo(() => {
    if (!Array.isArray(messages)) {
      return "";
    }

    // The block key is the current user-turn ID when the card is hydrated.
    // On a message-less live card it is not available yet, so use the newest
    // visible user bubble instead.
    const promptMessage =
      (blockGroupKey
        ? messages.find(
            (candidate) =>
              firstNonEmptyString(candidate.id, candidate.info?.id) === blockGroupKey &&
              firstNonEmptyString(candidate.role, candidate.info?.role)?.toLowerCase() === "user",
          )
        : undefined) ??
      [...messages]
        .reverse()
        .find(
          (candidate) =>
            firstNonEmptyString(candidate.role, candidate.info?.role)?.toLowerCase() === "user",
        );
    return normalizedUserMessageText(promptMessage);
  }, [blockGroupKey, messages]);
  const commentaryItems = useMemo(
    () =>
      commentaryItemsFromRawEventPayloads(normalizedCentralizedRawSdkEventPayloads).filter(
        (item) => !isLikelyUserPromptEcho(item.text, visibleTurnUserPromptText),
      ),
    [normalizedCentralizedRawSdkEventPayloads, visibleTurnUserPromptText],
  );

  const structured = useMemo(
    () => structuredOutputFromRawSdkEventPayloads(normalizedCentralizedRawSdkEventPayloads)
      ?? cardMessage?.structuredOutput,
    [cardMessage?.structuredOutput, normalizedCentralizedRawSdkEventPayloads],
  );
  const responseType = (structured?.type ?? structured?.responseType)?.toLowerCase();
  const plan = structured?.plan;
  const walkthrough = structured?.walkthrough ?? cardMessage?.walkthrough;
  const messageChangeSummary = message?.changeSummary;
  const fileChanges = useMemo(() => {
    if (Array.isArray(messageChangeSummary?.files) && messageChangeSummary.files.length > 0) {
      return messageChangeSummary.files.map((file) => ({
        file: file.file,
        diffStats: {
          added: Math.max(0, Number(file.added) || 0),
          deleted: Math.max(0, Number(file.deleted) || 0),
        },
        diffExcerpt: file.diffExcerpt,
      })) satisfies StructuredFileChange[];
    }

    return structured?.fileChanges;
  }, [messageChangeSummary, structured?.fileChanges]);

  // Message-scoped rendering depends on this ID. Keep it above every memo that
  // filters timeline rows so React never evaluates a useMemo while `messageId`
  // is still in the temporal-dead-zone.
  const info = activityTimelineMessage?.info;
  const messageRec = asRecord(activityTimelineMessage);
  const infoRec = asRecord(messageRec?.info);
  
  const displayEvents = useMemo(
    () => {
      const events = buildDisplayEvents(
        thoughtItems,
        mergedProgressItems,
        commentaryItems,
        fileChanges,
        assistantScopeMessageIds,
        messageId,
        isParentResponseFinished,
        normalizedCentralizedRawSdkEventPayloads.length,
      );
      return events;
    },
    [thoughtItems, mergedProgressItems, commentaryItems, fileChanges, assistantScopeMessageIds, messageId, isParentResponseFinished, normalizedCentralizedRawSdkEventPayloads.length],
  );
  const completedDuplicateDisplayTraceRef = useRef("");
  useEffect(() => {
    const groups = new Map<string, DisplayEvent[]>();
    for (const event of displayEvents) {
      if (event.kind !== "activity") continue;
      const identity =
        activitySnapshotIdentity(event) ||
        activityDisplayEventIdentity(event) ||
        displayEventFingerprint(event);
      groups.set(identity, [...(groups.get(identity) ?? []), event]);
    }
    const duplicates = [...groups.entries()]
      .filter(([, events]) => events.length > 1)
      .map(([identity, events]) => ({
        identity,
        rows: events.map((event) => ({
          key: event.key,
          label: event.label,
          partType: event.partType,
          callID: event.callID,
          partID: event.partID,
          messageID: event.messageID,
          streamSeq: event.streamSeq,
          timelineSeq: event.timelineSeq,
          source: event.source,
        })),
      }));
    if (duplicates.length === 0) return;
    const signature = JSON.stringify(duplicates);
    if (signature === completedDuplicateDisplayTraceRef.current) return;
    completedDuplicateDisplayTraceRef.current = signature;
    logger.error("[ACTIVITY-DUPLICATE-TRACE] identical visible rows survived display projection", {
      turnId: activityTimelineTurnMessageId,
      messageId,
      isStreamingActive,
      duplicates,
      progressCount: mergedProgressItems.length,
      displayCount: displayEvents.length,
    });
  }, [activityTimelineTurnMessageId, displayEvents, isStreamingActive, mergedProgressItems.length, messageId]);
  const activityOrderTraceRef = useRef<string>("");
  useEffect(() => {
    if (!config.debug.showSdkEventDebug) {
      return;
    }
    const activity = displayEvents
      .filter((event) => event.kind === "activity")
      .map((event) => ({
        identity: activityDisplayEventIdentity(event),
        label: event.label,
        sequence: event.streamSeq ?? null,
        source: event.source ?? null,
      }));
    const numericSequences = activity
      .map((event) => event.sequence)
      .filter((sequence): sequence is number => typeof sequence === "number");
    const isOutOfOrder = numericSequences.some(
      (sequence, index) => index > 0 && sequence < numericSequences[index - 1],
    );
    if (!isOutOfOrder) {
      return;
    }
    const signature = JSON.stringify({ messageId, activity });
    if (signature === activityOrderTraceRef.current) {
      return;
    }
    activityOrderTraceRef.current = signature;
    logger.warn("[ACTIVITY-ORDER-TRACE] non-monotonic-render-order", {
      sessionId: centralizedSessionId,
      messageId,
      activity,
    });
  }, [centralizedSessionId, displayEvents, messageId]);
  // Centralized debug is the long-term source of truth for this assistant turn.
  // Keep it raw and complete so future UI rendering can consume the same data
  // without depending on derived display-only transforms.
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

    // DIAGNOSTIC logging disabled for performance
    // logger.info(`${ACTIVITY_TIMELINE_DIAGNOSTIC_LOG} render_flow`, {
    //   currentMessageId: messageId,
    //   assistantMessageId,
    //   rawEventCount: rawEvents.length,
    //   rawSamples,
    //   progressItemCount: progressItems.length,
    //   progressSamples: progressItems
    //     .slice(0, 12)
    //     .map((item, index) => summarizeProgressItemForTimelineDiagnostics(item, index)),
    //   progressItemsForOtherMessages: progressItemsForOtherMessages
    //     .slice(0, 8)
    //     .map((item, index) => summarizeProgressItemForTimelineDiagnostics(item, index)),
    //   thoughtItemCount: thoughtItems.length,
    //   commentaryItemCount: commentaryItems.length,
    //   thoughtSamples: thoughtItems.slice(0, 12).map((item, index) => ({
    //     index,
    //     key: item.key,
    //     textLength: item.text.length,
    //     source: item.source,
    //     status: item.status,
    //     messageID: item.messageID,
    //     partID: item.partID,
    //     streamSeq: item.streamSeq,
    //   })),
    //   commentarySamples: commentaryItems.slice(0, 12).map((item, index) => ({
    //     index,
    //     id: item.id,
    //     textLength: item.text.length,
    //     kind: item.kind,
    //     status: item.status,
    //     messageID: item.messageID,
    //     partID: item.partID,
    //     streamSeq: item.streamSeq,
    //   })),
    //   displayEventCount: displayEvents.length,
    //   displaySamples: displayEvents
    //     .slice(0, 12)
    //     .map((event, index) => summarizeDisplayEventForTimelineDiagnostics(event, index)),
    //   displayEventsForOtherMessages: displayEventsForOtherMessages
    //     .slice(0, 8)
    //     .map((event, index) => summarizeDisplayEventForTimelineDiagnostics(event, index)),
    // });
  }, [
    assistantMessageId,
    commentaryItems,
    displayEvents,
    messageId,
    normalizedCentralizedRawSdkEventPayloads,
    progressItems,
    thoughtItems,
    mergedProgressItems,
  ]);
  const shouldShowFileChanges = useMemo(() => {
    // Implementation plan turns already surface their own plan card, so the
    // aggregated diff section would just duplicate the same turn.
    if (plan?.file) {
      return false;
    }

    if (Array.isArray(messageChangeSummary?.files) && messageChangeSummary.files.length > 0) {
      const summaryMessageId = firstNonEmptyString(messageChangeSummary.messageId);
      if (!summaryMessageId) {
        return true;
      }
      const ownershipIds = collectMessageIdentityCandidates(message);
      return ownershipIds.size === 0 || ownershipIds.has(summaryMessageId);
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
  }, [fileChanges, plan?.file, messageChangeSummary, messageId, messages, message]);

  const shouldShowPlanCard = useMemo(
    () =>
      shouldDisplayImplementationPlanCard({
        responseType,
        plan,
        message,
        messageId,
        messages,
      }),
    [message, messageId, messages, plan, responseType],
  );
  const shouldShowWalkthroughCard = useMemo(
    () => shouldDisplayWalkthroughCard({ walkthrough, message, messageId, messages }),
    [message, messageId, messages, walkthrough],
  );
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

  const isAfterLatestUserMessage = useMemo(() => {
    if (!Array.isArray(messages)) return false;
    let latestUserIndex = -1;
    let thisMessageIndex = -1;
    for (let i = 0; i < messages.length; i++) {
      const candidate = messages[i];
      const role = candidate.role ?? candidate.info?.role ?? "user";
      if (role === "user") {
        latestUserIndex = i;
      }
      const candidateId = candidate.info?.id ?? candidate.id;
      if (messageId && candidateId === messageId) {
        thisMessageIndex = i;
      }
    }
    return thisMessageIndex > latestUserIndex;
  }, [messages, messageId]);

  const [viewState, setViewState] = useState<MessageViewState>({
    showActivityDetails: false,
    showThinkingDetails: false,
    showInternalActivity: false,
    showExpandedActivityTimeline: false,
    expandedReasoningSteps: new Set<string>(),
  });
  // Long response bodies start as a bounded preview. This state is entirely
  // local to the response card; activity and assistant-block collapse do not
  // affect it.
  const [isResponseExpanded, setIsResponseExpanded] = useState(false);
  const [hasResponseOverflow, setHasResponseOverflow] = useState(false);
  const responsePreviewRef = useRef<HTMLDivElement>(null);
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
  const stickyTimelineDisplayEventsRef = useRef<{
    messageId: string | null;
    sessionId: string | null;
    events: DisplayEvent[];
    isLive: boolean;
  }>({ messageId: null, sessionId: null, events: [], isLive: false });
  if (
    stickyTimelineDisplayEventsRef.current.messageId !==
    activityTimelineTurnMessageId
  ) {
    const sessionChanged = Boolean(
      stickyTimelineDisplayEventsRef.current.sessionId &&
        centralizedSessionId &&
        stickyTimelineDisplayEventsRef.current.sessionId !== centralizedSessionId,
    );
    if (
      config.debug.showSdkEventDebug &&
      isStreamingActive &&
      stickyTimelineDisplayEventsRef.current.events.length > 0
    ) {
      logger.warn(
        `[ACTIVITY-TIMELINE-TRACE] ${
          sessionChanged ? "sticky-session-reset" : "sticky-turn-phase-carried"
        }`,
        {
        previousTurnId: stickyTimelineDisplayEventsRef.current.messageId,
        nextTurnId: activityTimelineTurnMessageId,
        isCurrentCardLiveAssistantTurn,
        blockGroupKey: blockGroupKey ?? null,
        assistantTurnAnchorMessageId,
        assistantTurnMessageId,
        assistantMessageId,
        retainedRowCount: stickyTimelineDisplayEventsRef.current.events.length,
        retainedRows: stickyTimelineDisplayEventsRef.current.events
          .filter((event) => event.kind === "activity")
          .map((event) => ({
            identity:
              activityDisplayEventIdentity(event) ||
              activitySnapshotIdentity(event) ||
              displayEventFingerprint(event),
            label: event.label,
            status: event.status,
            source: event.source,
            callID: event.callID,
            partID: event.partID,
            messageID: event.messageID,
            filePath: event.filePath,
            tool: event.activityDetail?.tool,
          })),
        sessionId: currentSessionId,
          sessionChanged,
          source: "webview",
        },
      );
    }
    // Preserve accepted rows for the whole session. A step group, assistant
    // message ID, or transient inactive status must never delete UI that has
    // already rendered; session-scoped event admission prevents cross-session
    // leakage before rows reach this projection.
    stickyTimelineDisplayEventsRef.current = {
      messageId: activityTimelineTurnMessageId,
      sessionId: centralizedSessionId,
      events: sessionChanged ? [] : stickyTimelineDisplayEventsRef.current.events,
      isLive: isLiveAssistantTurn,
    };
  } else {
    stickyTimelineDisplayEventsRef.current.isLive = isLiveAssistantTurn;
    stickyTimelineDisplayEventsRef.current.sessionId = centralizedSessionId;
  }
  if (visibleDisplayEvents.length > 0) {
    stickyTimelineDisplayEventsRef.current = {
      messageId: activityTimelineTurnMessageId,
      sessionId: centralizedSessionId,
      events: orderDisplayEventsChronologically(
        mergeStickyDisplayEventsForTurn(
          stickyTimelineDisplayEventsRef.current.events,
          visibleDisplayEvents,
        ),
      ),
      isLive: isLiveAssistantTurn,
    };
  }
  // The raw live projection is intentionally allowed to be partial: OpenCode
  // advances one user turn through multiple assistant envelopes, and each
  // envelope can contain only its current activity group. Rendering that raw
  // array directly made already-painted rows vanish whenever the next
  // step-start/step-finish group arrived. The turn-scoped sticky merge is the
  // single presentation source for both live and hydrated frames; it retains
  // prior rows and coalesces mirrors through the semantic identities above.
  const timelineDisplayEvents =
    stickyTimelineDisplayEventsRef.current.messageId === activityTimelineTurnMessageId
      ? stickyTimelineDisplayEventsRef.current.events
      : visibleDisplayEvents;

  // Always-on, narrowly scoped evidence for the user-visible regression. This
  // does not log ordinary stream updates; it logs only when a row that was in
  // the rendered live timeline is absent on the next render of the same turn.
  // Keep this outside the debug flag so a reproduction can be diagnosed from
  // the normal webview log without asking the user to change settings.
  const liveActivityLossTraceRef = useRef<{
    turnId: string | null;
    rows: Map<string, DisplayEvent>;
    lastSignature: string;
  }>({ turnId: null, rows: new Map(), lastSignature: "" });
  useEffect(() => {
    const rows = new Map<string, DisplayEvent>();
    for (const event of timelineDisplayEvents) {
      if (event.kind !== "activity") continue;
      const identity =
        activityDisplayEventIdentity(event) ||
        (event.timelineSeq !== undefined
          ? `timeline:${event.timelineSeq}`
          : `key:${event.key}`);
      rows.set(identity, event);
    }
    const previous = liveActivityLossTraceRef.current;
    if (previous.turnId === activityTimelineTurnMessageId && isStreamingActive) {
      const removed = [...previous.rows.entries()]
        .filter(([identity]) => !rows.has(identity))
        .map(([identity, event]) => ({
          identity,
          key: event.key,
          label: event.label,
          partType: event.partType,
          status: event.status,
          source: event.source,
          messageID: event.messageID,
          partID: event.partID,
          callID: event.callID,
          streamSeq: event.streamSeq,
          timelineSeq: event.timelineSeq,
        }));
      if (removed.length > 0) {
        const signature = JSON.stringify({
          turnId: activityTimelineTurnMessageId,
          removed,
          nextRowCount: rows.size,
        });
        if (signature !== previous.lastSignature) {
          logger.error("[ACTIVITY-LIVE-LOSS] rendered rows disappeared during stream", {
            turnId: activityTimelineTurnMessageId,
            messageId,
            streamingMessageId: activityTimelineStreaming?.messageId ?? null,
            assistantTurnMessageId,
            removed,
            nextRows: [...rows.values()].map((event) => ({
              key: event.key,
              label: event.label,
              partType: event.partType,
              source: event.source,
              messageID: event.messageID,
              partID: event.partID,
              callID: event.callID,
              streamSeq: event.streamSeq,
              timelineSeq: event.timelineSeq,
            })),
            visibleDisplayEventCount: visibleDisplayEvents.length,
            timelineDisplayEventCount: timelineDisplayEvents.length,
          });
          previous.lastSignature = signature;
        }
      }
    }
    liveActivityLossTraceRef.current = {
      turnId: activityTimelineTurnMessageId,
      rows,
      lastSignature: previous.lastSignature,
    };
  }, [
    activityTimelineStreaming?.messageId,
    activityTimelineTurnMessageId,
    assistantTurnMessageId,
    isStreamingActive,
    messageId,
    timelineDisplayEvents,
    visibleDisplayEvents.length,
  ]);

  // Evidence-only guard for the regression where a row paints during a live
  // turn and is then removed by a later projection. The sticky merge above is
  // meant to make that impossible; when it happens, log every pipeline stage
  // once so the next trace identifies the layer that lost the row.
  const renderedActivityTraceRef = useRef<{
    turnId: string | null;
    events: Map<string, Record<string, unknown>>;
  }>({ turnId: null, events: new Map() });
  const duplicateActivityTraceRef = useRef<string>("");
  useEffect(() => {
    if (!config.debug.showSdkEventDebug) {
      return;
    }

    const summarizeDisplayActivity = (event: DisplayEvent): Record<string, unknown> => {
      const input = asRecord(event.activityDetail?.input);
      const semanticIdentity =
        activityPatchIdentity(event) ||
        todoWriteChecklistIdentity(event) ||
        activitySnapshotIdentity(event);
      return {
      identity:
        semanticIdentity ||
        activityDisplayEventIdentity(event) ||
        displayEventFingerprint(event),
      key: event.key,
      label: event.label,
      status: event.status,
      source: event.source,
      messageID: event.messageID,
      partID: event.partID,
      callID: event.callID,
      tool: event.activityDetail?.tool,
      filePath: event.filePath ?? asString(input?.filePath),
      offset: input?.offset,
      limit: input?.limit,
      oldStringLength: asString(input?.oldString).length || undefined,
      newStringLength: asString(input?.newString).length || undefined,
      patchIdentity: activityPatchIdentity(event) || undefined,
      semanticIdentity,
      summary: event.summary.slice(0, 220),
      };
    };
    const mapActivities = (events: DisplayEvent[]) =>
      new Map(
        events
          .filter((event) => event.kind === "activity")
          .map((event) => {
            const summary = summarizeDisplayActivity(event);
            return [String(summary.identity), summary] as const;
          }),
      );
    const displayActivity = mapActivities(displayEvents);
    const stickyActivity = mapActivities(stickyTimelineDisplayEventsRef.current.events);
    const currentEvents = mapActivities(timelineDisplayEvents);

    // Diagnostics only: group rows by the exact data the user can see. This
    // intentionally does not perform dedupe; it tells us which reducer stage
    // allowed a visually identical Read/File_edit through, and whether the
    // SDK payloads actually differed in call, part, or tool input.
    const visibleActivityKey = (event: DisplayEvent): string => {
      const input = asRecord(event.activityDetail?.input);
      const tool = normalizeComparableText(
        firstNonEmptyString(event.activityDetail?.tool, event.label, event.partType),
      );
      const file = normalizeComparableText(
        firstNonEmptyString(
          event.filePath,
          event.activityDetail?.file,
          asString(input?.filePath),
          asString(input?.file),
          asString(input?.path),
        ),
      );
      if (tool === "read" || tool === "read_file") {
        return `visible-read:${file}:${asString(input?.offset)}:${asString(input?.limit)}`;
      }
      if (isEditLikeActivity(event)) {
        return `visible-edit:${file}:${activityPatchIdentity(event)}`;
      }
      return `visible:${tool}:${file}:${normalizeComparableText(event.summary)}`;
    };
    const duplicateGroups = (events: DisplayEvent[]) => {
      const groups = new Map<string, DisplayEvent[]>();
      for (const event of events) {
        if (event.kind !== "activity") continue;
        const key = visibleActivityKey(event);
        groups.set(key, [...(groups.get(key) ?? []), event]);
      }
      return [...groups.entries()]
        .filter(([, eventsForKey]) => eventsForKey.length > 1)
        .map(([key, eventsForKey]) => ({
          key,
          rows: eventsForKey.map((event) => summarizeDisplayActivity(event)),
        }));
    };
    const duplicateStages = {
      rawProgress: duplicateGroups(
        progressItems.map((item) => ({
          key: item.key,
          kind: "activity" as const,
          label: item.title,
          summary: item.meta ?? item.title,
          status: item.status,
          source: item.source,
          partType: item.partType,
          filePath: item.filePath,
          callID: item.callID,
          messageID: item.messageID,
          partID: item.id,
          activityDetail: item.activityDetail,
          updateCount: 1,
        })),
      ),
      mergedProgress: duplicateGroups(
        mergedProgressItems.map((item) => ({
          key: item.key,
          kind: "activity" as const,
          label: item.title,
          summary: item.meta ?? item.title,
          status: item.status,
          source: item.source,
          partType: item.partType,
          filePath: item.filePath,
          callID: item.callID,
          messageID: item.messageID,
          partID: item.id,
          activityDetail: item.activityDetail,
          updateCount: 1,
        })),
      ),
      display: duplicateGroups(displayEvents),
      sticky: duplicateGroups(stickyTimelineDisplayEventsRef.current.events),
      rendered: duplicateGroups(timelineDisplayEvents),
    };
    const hasDuplicateActivities = Object.values(duplicateStages).some(
      (groups) => groups.length > 0,
    );
    const duplicateSignature = hasDuplicateActivities
      ? JSON.stringify(duplicateStages)
      : "";
    if (hasDuplicateActivities && duplicateSignature !== duplicateActivityTraceRef.current) {
      duplicateActivityTraceRef.current = duplicateSignature;
      logger.warn("[ACTIVITY-TIMELINE-TRACE] duplicate-visible-activity", {
        turnId: activityTimelineTurnMessageId,
        sessionId: currentSessionId,
        duplicateStages,
        source: "webview",
      });
    }

    const previous = renderedActivityTraceRef.current;
    if (previous.turnId === activityTimelineTurnMessageId) {
      const removed = [...previous.events.entries()]
        .filter(([identity]) => !currentEvents.has(identity))
        .map(([, summary]) => summary);
      // A broken assistant-phase handoff can incorrectly flip streaming to
      // inactive immediately before the timeline loses rows. Keep logging for
      // the live assistant card in that state; otherwise the diagnostic hides
      // the exact removal the user is reporting.
      if (removed.length > 0 && (isStreamingActive || isCurrentCardLiveAssistantTurn)) {
        const lossLayers = removed.map((summary) => {
          const identity = String(summary.identity);
          return {
            identity,
            missingFromDisplay: !displayActivity.has(identity),
            missingFromSticky: !stickyActivity.has(identity),
            missingFromFinalRender: !currentEvents.has(identity),
          };
        });
        const summarizeProgress = (items: ProgressItem[]) =>
          items.map((item) => ({
            identity: item.mergeKey || item.callID || item.id || item.key,
            title: item.title,
            status: item.status,
            source: item.source,
            callID: item.callID,
            messageID: item.messageID,
            tool: item.activityDetail?.tool,
          }));
        logger.warn("[ACTIVITY-TIMELINE-TRACE] rendered-step-removed", {
          turnId: activityTimelineTurnMessageId,
          removed,
          rawProgress: summarizeProgress(progressItems),
          liveProgress: summarizeProgress(liveProgressItems),
          mergedProgress: summarizeProgress(mergedProgressItems),
          displayActivity: [...displayActivity.values()],
          stickyActivity: [...stickyActivity.values()],
          finalRenderedActivity: [...currentEvents.values()],
          lossLayers,
          isStreamingActive,
          isCurrentCardLiveAssistantTurn,
          isLiveAssistantTurn,
          removalContext: isStreamingActive
            ? "active-stream"
            : "live-card-after-stream-inactive",
        });
      }
    }
    renderedActivityTraceRef.current = {
      turnId: activityTimelineTurnMessageId,
      events: currentEvents,
    };
  }, [
    activityTimelineTurnMessageId,
    displayEvents,
    isCurrentCardLiveAssistantTurn,
    isLiveAssistantTurn,
    isStreamingActive,
    liveProgressItems,
    mergedProgressItems,
    progressItems,
    currentSessionId,
    timelineDisplayEvents,
  ]);

  // Hydration parity trace: `edit` is a real SDK tool part, while `file_edit`
  // is only the patch-derived duplicate representation. When an authoritative
  // Edit part does not make the rendered timeline, report the exact stage that
  // dropped it instead of treating a separate diff preview as success.
  const hydratedEditProjectionTraceRef = useRef("");
  const hydratedStepProjectionTraceRef = useRef("");
  useEffect(() => {
    if (!config.debug.showSdkEventDebug || isStreamingActive) {
      return;
    }

    const sourceSteps = hydratedActivityParts
      .map((part) => asRecord(part))
      .filter((part): part is Record<string, unknown> => Boolean(part))
      .filter((part) => asString(part.type).trim().toLowerCase() === "tool")
      .map((part) => {
        const state = asRecord(part.state);
        return {
          partID: asString(part.id) || null,
          callID: asString(part.callID) || asString(part.callId) || null,
          messageID: asString(part.messageID) || asString(part.messageId) || null,
          tool: asString(part.tool) || asString(part.name) || null,
          status: asString(state?.status) || null,
        };
      });
    const stage = (items: Array<ProgressItem | DisplayEvent>) =>
      items
        .filter((item) => item.kind === "activity" || "activityDetail" in item)
        .map((item) => ({
          partID: "id" in item ? item.id ?? null : item.partID ?? null,
          callID: item.callID ?? null,
          messageID: item.messageID ?? null,
          tool: item.activityDetail?.tool ?? null,
          label: "title" in item ? item.title : item.label,
          status: item.status,
        }));
    const payload = {
      sessionId: currentSessionId,
      turnId: activityTimelineTurnMessageId,
      blockGroupKey: blockGroupKey ?? null,
      isLastInBlock: isLastInBlock ?? null,
      isBlockExpanded: isBlockExpanded ?? null,
      collapsedBlockAssistantMessageIds,
      sourceSteps,
      progressSteps: stage(mergedProgressItems),
      displaySteps: stage(displayEvents),
      renderedSteps: stage(timelineDisplayEvents),
      source: "webview",
    };
    const signature = JSON.stringify(payload);
    if (signature === hydratedStepProjectionTraceRef.current) {
      return;
    }
    hydratedStepProjectionTraceRef.current = signature;
    logger.warn("[HYDRATION-STEP-TRACE][RENDER] projection", payload);
  }, [
    activityTimelineTurnMessageId,
    blockGroupKey,
    collapsedBlockAssistantMessageIds,
    currentSessionId,
    displayEvents,
    hydratedActivityParts,
    isBlockExpanded,
    isLastInBlock,
    isStreamingActive,
    mergedProgressItems,
    timelineDisplayEvents,
  ]);
  useEffect(() => {
    if (!config.debug.showSdkEventDebug || isStreamingActive) {
      return;
    }

    const sourceEdits = hydratedActivityParts
      .map((part) => asRecord(part))
      .filter((part): part is Record<string, unknown> => Boolean(part))
      .filter((part) => asString(part.tool).trim().toLowerCase() === "edit")
      .map((part) => {
        const state = asRecord(part.state);
        const input = asRecord(state?.input);
        return {
          partID: asString(part.id).trim() || undefined,
          callID: asString(part.callID).trim() || undefined,
          messageID: asString(part.messageID).trim() || undefined,
          status: asString(state?.status).trim() || undefined,
          filePath: asString(input?.filePath).trim() || undefined,
        };
      });
    if (sourceEdits.length === 0) {
      return;
    }

    const stage = (items: Array<ProgressItem | DisplayEvent>) =>
      items
        .filter((item) => item.activityDetail?.tool?.trim().toLowerCase() === "edit")
        .map((item) => ({
          partID: "id" in item ? item.id : item.partID,
          callID: item.callID,
          messageID: item.messageID,
          status: item.status,
          filePath: item.filePath,
          source: item.source,
        }));
    const payload = {
      sessionId: currentSessionId,
      turnId: activityTimelineTurnMessageId,
      blockGroupKey: blockGroupKey ?? null,
      isLastInBlock: isLastInBlock ?? null,
      isBlockExpanded: isBlockExpanded ?? null,
      collapsedBlockAssistantMessageIds,
      sourceEdits,
      progressEdits: stage(mergedProgressItems),
      displayEdits: stage(displayEvents),
      renderedEdits: stage(timelineDisplayEvents),
      source: "webview",
    };
    const signature = JSON.stringify(payload);
    if (signature === hydratedEditProjectionTraceRef.current) {
      return;
    }
    hydratedEditProjectionTraceRef.current = signature;
    logger.warn("[ACTIVITY-TIMELINE-TRACE] hydrated-edit-projection", payload);
  }, [
    activityTimelineTurnMessageId,
    blockGroupKey,
    collapsedBlockAssistantMessageIds,
    currentSessionId,
    displayEvents,
    hydratedActivityParts,
    isBlockExpanded,
    isLastInBlock,
    isStreamingActive,
    mergedProgressItems,
    timelineDisplayEvents,
  ]);
        
  // Step lifecycle markers are retained for timeline bookkeeping, but their
  // compact UI is intentionally hidden. They must not leave an empty
  // collapsed summary that can be expanded into no visible content.
  const isHiddenLifecycleTimelineEvent = (event: DisplayEvent) => {
    if (event.internal !== true) return false;
    const labelLower = (event.label || "").trim().toLowerCase();
    const summaryLower = (event.summary || "").trim().toLowerCase();
    const partTypeLower = (event.partType || "").trim().toLowerCase();
    if (partTypeLower === "step-start" || partTypeLower === "step-finish") {
      return true;
    }
    return (
      labelLower === "step-start" ||
      labelLower === "step-finish" ||
      labelLower === "starting step" ||
      labelLower === "finishing step" ||
      (labelLower === "step" && (summaryLower === "start" || summaryLower === "finish")) ||
      (labelLower === "start" && summaryLower === "start") ||
      (labelLower === "finish" && summaryLower === "finish")
    );
  };

  const hasStickyTimelineActivity = timelineDisplayEvents.length > 0;
  const hasExpandableTimelineActivity = timelineDisplayEvents.some(
    (event) => !isHiddenLifecycleTimelineEvent(event),
  );
  const canCollapseCompletedAssistantTurn =
    cardMessage?.aborted !== true &&
    !isCurrentCardLiveAssistantTurn &&
    !(assistantTurnPending && isLatestAssistantMessage && isAfterLatestUserMessage) &&
    hasExpandableTimelineActivity;
  const effectiveExpanded =
    typeof isBlockExpanded === "boolean" ? isBlockExpanded : viewState.showExpandedActivityTimeline;
  const isAssistantTurnCollapsed =
    canCollapseCompletedAssistantTurn &&
    !effectiveExpanded;
  // Copy/Fork belong to the compact completed-turn summary. Keeping them out
  // of live and expanded cards prevents actions from appearing while the
  // response is still changing and avoids repeating them for assistant phases.
  const shouldShowResponseActions =
    isAssistantTurnCollapsed &&
    (blockSize === undefined || blockSize <= 1 || isLastInBlock === true);

  const { blockTokens, blockDuration } = useMemo(() => {
    if (!isAssistantTurnCollapsed || !blockGroupKey || !messages || blockSize === undefined || blockSize <= 1) {
      return { blockTokens: undefined, blockDuration: undefined };
    }
    
    let sumInput = 0;
    let sumOutput = 0;
    let sumReasoning = 0;
    let sumRead = 0;
    let sumWrite = 0;
    let sumDuration = 0;
    let hasTokens = false;
    let hasDuration = false;

    let currentKey = "initial";
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const role = msg.role ?? msg.info?.role;
      if (role === "user") {
        currentKey = firstNonEmptyString(msg.info?.id, msg.id) ?? `user:${i}`;
      } else if (role === "assistant" && currentKey === blockGroupKey) {
        const rawEvents = normalizeCentralizedEventPayloads(msg.rawSdkEventPayloads);
        const scopeIds = buildAssistantScopeMessageIds({
          message: msg,
          assistantMessageId: msg.info?.id ?? msg.id,
        });
        const t = getTokenInfo(rawEvents, scopeIds);
        const d = getDuration(rawEvents, scopeIds);
        
        if (t) {
          hasTokens = true;
          sumInput += t.input ?? 0;
          sumOutput += t.output ?? 0;
          sumReasoning += t.reasoning ?? 0;
          sumRead += t.cache?.read ?? 0;
          sumWrite += t.cache?.write ?? 0;
        }
        if (typeof d === "number") {
          hasDuration = true;
          sumDuration += d;
        }
      }
    }

    const blockTokens: CentralizedTokenInfo | undefined = hasTokens ? {
      input: sumInput,
      output: sumOutput,
      reasoning: sumReasoning,
      cache: (sumRead > 0 || sumWrite > 0) ? { read: sumRead, write: sumWrite } : undefined
    } : undefined;
    const blockDuration: number | undefined = hasDuration ? sumDuration : undefined;
    return { blockTokens, blockDuration };
  }, [isAssistantTurnCollapsed, blockGroupKey, messages, blockSize]);

  const responseBodyRawSdkEventPayloads = useMemo(
    () =>
      normalizedCentralizedRawSdkEventPayloads.filter(
        (payload) => !isDeltaCentralizedEventPayload(payload),
      ),
    [normalizedCentralizedRawSdkEventPayloads],
  );

  const shouldInterleaveStreamingAssistantCommentary = false;
  const timelineDisplayEventGroups = useMemo(() => {
    const groups: Array<
      | { type: "activity"; events: DisplayEvent[] }
      | { type: "commentary"; event: DisplayEvent }
      | { type: "question-output"; text: string; key: string }
    > = [];
    const coalescedTimelineDisplayEvents = coalesceTimelineEventsForRender(
      timelineDisplayEvents,
    );
    const orderedEntries: Array<
      | { type: "event"; seq: number; event: DisplayEvent }
      | { type: "question-output"; seq: number; text: string; key: string }
    > = [];
    let currentActivity: DisplayEvent[] = [];
    const isLifecycleBoundary = (event: DisplayEvent, boundary: "start" | "finish") => {
      if (!isHiddenLifecycleReasoningSeparator(event)) {
        return false;
      }
      const label = event.label.trim().toLowerCase();
      const summary = event.summary.trim().toLowerCase();
      const partType = (event.partType || "").trim().toLowerCase();
      return boundary === "start"
        ? partType === "step-start" ||
          label === "step-start" ||
          label === "starting step" ||
          (label === "step" && summary === "start") ||
          (label === "start" && summary === "start")
        : partType === "step-finish" ||
          label === "step-finish" ||
          label === "finishing step" ||
          (label === "step" && summary === "finish") ||
          (label === "finish" && summary === "finish");
    };
    const flushCurrentActivity = () => {
      if (currentActivity.length === 0) {
        return;
      }
      groups.push({ type: "activity", events: currentActivity });
      currentActivity = [];
    };
    const questionActivityFingerprints = new Set(
      coalescedTimelineDisplayEvents
        .filter((event) =>
          event.kind === "activity" &&
          isQuestionLikeActivityTool(event.activityDetail?.tool, event.partType),
        )
        .flatMap((event) =>
          [
            event.summary,
            event.description,
            event.detail,
            event.activityDetail?.summary,
            event.activityDetail?.output,
            event.activityDetail?.title,
          ]
            .map((value) => normalizeComparableText(value))
            .filter((value) => value.length > 0),
        ),
    );

    for (const [eventIndex, event] of coalescedTimelineDisplayEvents.entries()) {
      // Assistant response text already renders in the dedicated response card
      // above the timeline. Keep it out of the timeline groups so the same
      // final answer cannot appear twice when the centralized tape contains
      // both the response body and its mirrored commentary chunk.
      if (
        event.kind === "commentary" &&
        event.label === "Assistant Response" &&
        !shouldInterleaveStreamingAssistantCommentary
      ) {
        continue;
      }
      orderedEntries.push({
        type: "event",
        // `streamSeq` is not a comparable global clock: raw SDK payloads use
        // array indexes while live reducer rows use arrival timestamps. The
        // sticky timeline has already accepted and merged events in arrival
        // order, so use that retained array position for final rendering.
        seq: eventIndex,
        event,
      });
    }
    completedQuestionOutputChunksFromRawEventPayloads(
      responseBodyRawSdkEventPayloads,
      assistantScopeMessageIds,
    ).forEach((chunk, index) => {
      if (questionActivityFingerprints.has(normalizeComparableText(chunk.text))) {
        return;
      }
      const anchorIndex = coalescedTimelineDisplayEvents.findIndex(
        (event) => event.streamSeq === chunk.streamSeq,
      );
      orderedEntries.push({
        type: "question-output",
        // Question output is a derived sidecar. Anchor it to the retained
        // event position when possible; never compare its raw tape index
        // directly with live timestamp-based activity sequences.
        seq:
          anchorIndex >= 0
            ? anchorIndex + 0.1
            : coalescedTimelineDisplayEvents.length + index,
        text: chunk.text,
        key: `${messageId || "assistant"}-question-output-${index}`,
      });
    });

    const orderedEntriesByStream = [...orderedEntries].sort((left, right) => {
      const sequenceDelta = left.seq - right.seq;
      if (sequenceDelta !== 0) {
        return sequenceDelta;
      }
      // Activity is the source row for a question response when both entries
      // share a sequence. Keep it first so the output is read chronologically.
      if (left.type === right.type) {
        return 0;
      }
      return left.type === "event" ? -1 : 1;
    });

    for (const entry of orderedEntriesByStream) {
      if (entry.type === "question-output") {
        flushCurrentActivity();
        groups.push({ type: "question-output", text: entry.text, key: entry.key });
        continue;
      }
      const event = entry.event;
      if (event.kind === "commentary") {
        flushCurrentActivity();
        groups.push({ type: "commentary", event });
      } else {
        const isQuestionEvent =
          (event.label ?? "").trim().toLowerCase() === "question" ||
          (event.activityDetail?.tool ?? "").trim().toLowerCase() === "question";

        // Start a fresh visual timeline at every SDK lifecycle start. The
        // start marker stays in that group (hidden in the UI) so its stable
        // identity keeps completed groups mounted as later events arrive.
        if (
          (isQuestionEvent || isLifecycleBoundary(event, "start")) &&
          currentActivity.length > 0
        ) {
          flushCurrentActivity();
        }

        currentActivity.push(event);

        // A finish closes precisely the block opened by step-start. Appending
        // the next event therefore adds a new Stepper instead of replacing the
        // existing activity list and producing a visible refresh.
        if (isQuestionEvent || isLifecycleBoundary(event, "finish")) {
          flushCurrentActivity();
        }
      }
    }
    flushCurrentActivity();
    return groups;
  }, [
    assistantScopeMessageIds,
    messageId,
    responseBodyRawSdkEventPayloads,
    shouldInterleaveStreamingAssistantCommentary,
    timelineDisplayEvents,
  ]);
  const questionPreludeGroups = useMemo(
    () =>
      timelineDisplayEventGroups.filter((group) => {
        if (group.type === "question-output") {
          return true;
        }
        if (group.type !== "activity") {
          return false;
        }
        return (
          group.events.length > 0 &&
          group.events.every((event) => {
            const label = (event.label ?? "").trim().toLowerCase();
            const tool = (event.activityDetail?.tool ?? "").trim().toLowerCase();
            return label === "question" || tool === "question";
          })
        );
      }),
    [timelineDisplayEventGroups],
  );
  const nonQuestionTimelineDisplayEventGroups = useMemo(
    () =>
      timelineDisplayEventGroups.filter((group) => !questionPreludeGroups.includes(group)),
    [questionPreludeGroups, timelineDisplayEventGroups],
  );
  const questionPreludeFingerprints = useMemo(
    () => collectQuestionPreludeFingerprints(questionPreludeGroups),
    [questionPreludeGroups],
  );

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
          const messageRole = (m.role ?? m.info?.role ?? "").toLowerCase();
          const text = normalizedUserMessageText(m);
          // Plan approval is dispatched by the extension as a user turn, but
          // older hydrated histories may render that transport instruction as
          // a system message. Both represent the same approved plan state.
          if (
            isPlanProceedMessageContent(text) &&
            (messageRole === "user" || messageRole === "system")
          ) {
            status = "Executing";
            break;
          }
          if (messageRole === "user" && isPlanRevisionMessageContent(text)) {
            status = "Revision Requested";
            break;
          }
        }
      }
    }
    return { planStatus: status, isRevisedPlan: revised };
  }, [plan, message, messageId, messages]);

// NEW: Use custom hooks for simplified subagent data access
	// The custom hooks handle all the filtering, formatting, and data processing
	const subagents = useMemo(() => {
    const candidates = isLastInBlock
      ? inlineSubagentParentMessageIds.flatMap(
          (parentMessageId) => subagentsByParentMessageId?.[parentMessageId] ?? [],
        )
		: !message && formattedSubagents.length === 0
			? liveSessionSubagents
			: formattedSubagents;
		const filtered = candidates.filter((subagent) => {
			// Check if in active session
			if (currentSessionId && subagent.parentSessionId !== currentSessionId) {
				return false;
			}
			return true;
		});

		return Array.from(new Map(filtered.map((subagent) => [subagent.id, subagent])).values());
	}, [currentSessionId, formattedSubagents, inlineSubagentParentMessageIds, isLastInBlock, liveSessionSubagents, message, subagentsByParentMessageId]);
  // Show it once, on the response card excluded from the collapsed earlier
  // activity. The live card has no persisted block position and owns itself.
  const shouldRenderSubagentsInlineCard = !message || isLastInBlock !== false;
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
      dispatch({ type: "SELECT_SUBAGENT", payload: null });
    }
  }, [subagents.length, dispatch]);

  // Mirror latest subagents / subagentDetailsById into refs so the
  // effects below can keep deps minimal — otherwise the 1500ms poll
  // interval tears down on every stream event.
  const latestSubagentsRef = useRef(subagents);
  latestSubagentsRef.current = subagents;
  const latestSubagentDetailsByIdRef = useRef(subagentDetailsById);
  latestSubagentDetailsByIdRef.current = subagentDetailsById;

  useEffect(() => {
    if (!selectedSubagentId) {
      return;
    }
    const selected = latestSubagentsRef.current.find((entry) => entry.id === selectedSubagentId);
    if (!selected) {
      return;
    }
    const detail =
      (latestSubagentDetailsByIdRef.current?.[selected.id] as SubagentDetail | undefined) ||
      (selected as unknown as SubagentDetail);
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
  }, [selectedSubagentId]);

  useEffect(() => {
    if (!selectedSubagentId) {
      return;
    }
    const selected = latestSubagentsRef.current.find((entry) => entry.id === selectedSubagentId);
    if (!selected) {
      return;
    }
    const detail =
      (latestSubagentDetailsByIdRef.current?.[selected.id] as SubagentDetail | undefined) ||
      (selected as unknown as SubagentDetail);
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
      const currentSelected = latestSubagentsRef.current.find(
        (entry) => entry.id === selectedSubagentId,
      );
      if (!currentSelected) {
        return;
      }
      vscode.postMessage({
        type: "getSubagentConversation",
        subagentId: currentSelected.id,
        childSessionId,
        parentSessionId,
        parentMessageId,
        status: currentSelected.status,
        latestActivity: currentSelected.latestActivity,
      });
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [selectedSubagentId]);

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
      !!streaming.liveSessionStatus ||
      subagents.length > 0)
  );
  const liveSessionStatus = streaming?.liveSessionStatus;
  const hasLiveSessionStatus = !!liveSessionStatus;
  const [liveStatusNow, setLiveStatusNow] = useState(() => Date.now());
  useEffect(() => {
    if (!liveSessionStatus?.next) {
      return;
    }
    setLiveStatusNow(Date.now());
    const intervalId = window.setInterval(() => {
      setLiveStatusNow(Date.now());
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [liveSessionStatus?.next]);
  const liveStatusCountdown = useMemo(() => {
    if (!liveSessionStatus?.next || !Number.isFinite(liveSessionStatus.next)) {
      return undefined;
    }
    const remainingMs = Math.max(0, liveSessionStatus.next - liveStatusNow);
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds}s`;
  }, [liveSessionStatus?.next, liveStatusNow]);
  const liveStatusTitle = useMemo(() => {
    if (!liveSessionStatus) {
      return "";
    }
    if (liveSessionStatus.statusType === "retry") {
      return typeof liveSessionStatus.attempt === "number"
        ? `Retry scheduled · attempt ${liveSessionStatus.attempt}`
        : "Retry scheduled";
    }
    if (
      liveSessionStatus.statusType === "busy" ||
      liveSessionStatus.statusType === "running" ||
      liveSessionStatus.statusType === "processing" ||
      liveSessionStatus.statusType === "streaming" ||
      liveSessionStatus.statusType === "in_progress"
    ) {
      return "Session busy";
    }
    return `Session status · ${liveSessionStatus.statusType.replace(/[_-]+/g, " ")}`;
  }, [liveSessionStatus]);
  const liveStatusSubtitle = useMemo(() => {
    if (!liveSessionStatus) {
      return undefined;
    }
    if (liveSessionStatus.message) {
      return liveSessionStatus.message;
    }
    if (liveSessionStatus.statusType === "retry") {
      return "Waiting before the next retry.";
    }
    if (
      liveSessionStatus.statusType === "busy" ||
      liveSessionStatus.statusType === "running" ||
      liveSessionStatus.statusType === "processing" ||
      liveSessionStatus.statusType === "streaming" ||
      liveSessionStatus.statusType === "in_progress"
    ) {
      return "Assistant is still working on this turn.";
    }
    return undefined;
  }, [liveSessionStatus]);

  // Use type-safe helpers instead of type assertions
  const agentName = turnMetadata.agent || getAgentName(message, streaming);
  const assistantHeaderAgentLabel = firstNonEmptyString(agentName)?.trim();
  const agentColor = useMemo(() => {
    return getStableAgentAccentColor(agentName);
  }, [agentName]);
  const modelName = useMemo(() => {
    if (turnMetadata.providerID && turnMetadata.modelID) {
      return formatModelLabel(
        turnMetadata.modelID,
        turnMetadata.providerID,
        undefined,
        undefined,
        availableModels,
      );
    }
    if (turnMetadata.providerID || turnMetadata.modelID) {
      return formatModelLabel(
        turnMetadata.modelID,
        turnMetadata.providerID,
        undefined,
        undefined,
        availableModels,
      );
    }
    if (streaming?.isActive) {
      const streamingLabel = formatModelLabel(
        streaming.modelID || streaming.model?.modelID,
        streaming.providerID || streaming.model?.providerID,
        streaming.model?.name,
        streaming.model?.providerName,
        availableModels,
      );
      if (streamingLabel) return streamingLabel;
    }
    return modelLabel(message ?? ({} as Message), availableModels);
  }, [availableModels, message, streaming, turnMetadata.modelID, turnMetadata.providerID]);
  const thinkingVariant =
    turnMetadata.variant || getThinkingVariant(message, streaming);
  const showMessageThinking = useMemo(
    () => !!thinkingVariant,
    [thinkingVariant],
  );
  const headerSegments = useMemo(() => {
    const segments: AssistantHeaderSegment[] = [];

    if (assistantHeaderAgentLabel) {
      segments.push({
        key: "agent",
        text: assistantHeaderAgentLabel,
        className: "oc-msg-agent-name min-w-0 truncate text-oc-xs opacity-60",
        style: agentColor
          ? {
              color: `color-mix(in srgb, var(--oc-text) 88%, ${agentColor})`,
            }
          : undefined,
      });
    }

    if (
      modelName &&
      modelName !== "assistant" &&
      modelName !== assistantHeaderAgentLabel
    ) {
      segments.push({
        key: "model",
        text: modelName,
        className: "oc-msg-model-label font-semibold text-oc-sm truncate min-w-0",
      });
    }

    if (showMessageThinking) {
      segments.push({
        key: "thinking",
        text: `Think ${formatThinkingVariantLabel(thinkingVariant || "")}`,
        className: "oc-msg-thinking-label text-oc-xs truncate min-w-0 opacity-60",
      });
    }

    return segments;
  }, [agentColor, assistantHeaderAgentLabel, modelName, showMessageThinking, thinkingVariant]);
  const centralizedMetrics = useMemo(
    () =>
      getCentralizedMetricsSnapshot(
        normalizedCentralizedRawSdkEventPayloads,
        assistantScopeMessageIds,
      ),
    [assistantScopeMessageIds, normalizedCentralizedRawSdkEventPayloads],
  );
  const legacyMetricsDiagnostics = useMemo(
    () => getLegacyMetricsDiagnostics(message, streaming),
    [message, streaming],
  );
  // Completed cards are SDK snapshots. The live raw overlay can enrich these
  // values during an active turn, but it must never be required for them.
  const snapshotTokens = message?.tokens ?? message?.info?.tokens;
  const snapshotDuration = message?.duration ?? message?.info?.duration;
  const baseTokens = getTokenInfo(
    normalizedCentralizedRawSdkEventPayloads,
    assistantScopeMessageIds,
  ) ?? snapshotTokens;
  const baseDuration = getDuration(
    normalizedCentralizedRawSdkEventPayloads,
    assistantScopeMessageIds,
  ) ?? snapshotDuration;

  const tokens = isAssistantTurnCollapsed && blockTokens ? blockTokens : baseTokens;
  const duration = isAssistantTurnCollapsed && blockDuration !== undefined ? blockDuration : baseDuration;

  const inputTok = tokens?.input ?? 0;
  const outputTok = tokens?.output ?? 0;
  const reasoningTok = tokens?.reasoning ?? 0;
  const cache = tokens?.cache;
  const cacheRead = cache?.read ?? 0;
  const cacheWrite = cache?.write ?? 0;
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
  const hasActiveTimelineWork = timelineDisplayEvents.some(
    (event) => event.status === "pending",
  );
  // METRICS logging disabled for performance
  // useEffect(() => {
  //   logger.info("[CENTRALIZED_METRICS_CARD] response-card-data", {
  //     messageId,
  //     assistantMessageId,
  //     assistantScopeMessageIds: Array.from(assistantScopeMessageIds),
  //     extractedMetrics: {
  //       tokens: centralizedMetrics?.tokens ?? null,
  //       duration: centralizedMetrics?.duration ?? null,
  //       sourceEventType: centralizedMetrics?.sourceEventType ?? null,
  //       sourcePayloadIndex: centralizedMetrics?.sourcePayloadIndex ?? null,
  //     },
  //     sourcePayload: centralizedMetrics?.sourcePayload ?? null,
  //     matchingPayloadCount: centralizedMetrics?.matchingPayloads.length ?? 0,
  //     matchingPayloads: centralizedMetrics?.matchingPayloads ?? [],
  //   });
  // }, [
  //   assistantMessageId,
  //   assistantScopeMessageIds,
  //   centralizedMetrics,
  //   messageId,
  // ]);
  // useEffect(() => {
  //   logger.info("[LEGACY_METRICS_CARD] pre-centralized-data-sources", {
  //     messageId,
  //     assistantMessageId,
  //     legacyTokenSource: legacyMetricsDiagnostics.tokenSource,
  //     legacyDurationSource: legacyMetricsDiagnostics.durationSource,
  //     legacyExtractedMetrics: {
  //       tokens: legacyMetricsDiagnostics.tokens ?? null,
  //       duration: legacyMetricsDiagnostics.duration ?? null,
  //     },
  //     messageInfoTokens: message?.info?.tokens ?? null,
  //     messageInfoDuration:
  //       typeof message?.info?.duration === "number" ? message.info.duration : null,
  //     messageTopLevelTokens:
  //       message && "tokens" in message
  //         ? (message as Record<string, unknown>).tokens ?? null
  //         : null,
  //     messageTopLevelDuration:
  //       typeof message?.duration === "number" ? message.duration : null,
  //     messageTimingDuration:
  //       typeof message?.timing?.duration === "number"
  //         ? message.timing.duration
  //         : null,
  //     streamingUsage: streaming?.usage ?? null,
  //     rawResponseInfo: legacyMetricsDiagnostics.rawResponseInfo ?? null,
  //     rawResponseParsed: legacyMetricsDiagnostics.rawResponseParsed ?? null,
  //     rawResponse: message?.rawResponse ?? null,
  //   });
  // }, [
  //   assistantMessageId,
  //   legacyMetricsDiagnostics,
  //   message,
  //   messageId,
  //   streaming,
  // ]);
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
const responseBodyChunks = useMemo(() => {
    // Delta events are intentionally excluded from the centralized tape. The
    // live card has no message payload, so use only explicitly renderable
    // stream text here to paint each safe chunk as it arrives.
    if (
      !cardMessage &&
      streaming?.hasRenderableContent === true &&
      streaming.content.trim().length > 0
    ) {
      const liveChunks = Array.isArray(streaming.responseChunks)
        ? streaming.responseChunks
            .map((chunk) => chunk.text.trim())
            .filter((chunk) => chunk.length > 0)
        : [];
      return liveChunks.length > 0 ? liveChunks : [streaming.content];
    }
    const orderedChunks = orderedAssistantResponseChunksFromCentralizedData(
      responseBodyRawSdkEventPayloads,
      assistantScopeMessageIds,
    );
    if (orderedChunks.length > 0) {
      return orderedChunks;
    }
    const rawChunks = getCentralizedAssistantContentChunksFromRawSdkEventPayloads(
      responseBodyRawSdkEventPayloads,
    );
    if (rawChunks.length > 0) {
      return rawChunks;
    }
    return snapshotContent.trim().length > 0 ? [snapshotContent] : [];
  }, [
    assistantScopeMessageIds,
    cardMessage,
    responseBodyRawSdkEventPayloads,
    streaming?.content,
    streaming?.hasRenderableContent,
    snapshotContent,
  ]);
  const visibleResponseBodyChunks = useMemo(() => {
    const renderedQuestionOutputs = new Set(
      completedQuestionOutputChunksFromRawEventPayloads(
        responseBodyRawSdkEventPayloads,
        assistantScopeMessageIds,
      ).map((chunk) => normalizeComparableText(chunk.text)),
    );
    const duplicateFingerprints = new Set([
      ...renderedQuestionOutputs,
      ...questionPreludeFingerprints,
    ]);
    if (duplicateFingerprints.size === 0) {
      return responseBodyChunks;
    }
    const filteredChunks = responseBodyChunks.filter(
      (chunk) => !duplicateFingerprints.has(normalizeComparableText(chunk)),
    );
    if (filteredChunks.length > 0) {
      return filteredChunks;
    }

    const questionToolOnlyResponse =
      responseBodyChunks.length > 0 &&
      responseBodyChunks.every((chunk) =>
        duplicateFingerprints.has(normalizeComparableText(chunk)),
      ) &&
      responseBodyChunks.some((chunk) =>
        renderedQuestionOutputs.has(normalizeComparableText(chunk)),
      );
    return questionToolOnlyResponse ? [] : responseBodyChunks;
  }, [
    assistantScopeMessageIds,
    questionPreludeFingerprints,
    responseBodyChunks,
    responseBodyRawSdkEventPayloads,
  ]);
  const hasThinkingEvents = useMemo(
    () => displayEvents.some((event) => event.kind === "reasoning"),
    [displayEvents],
  );
  const planPrelude = useMemo(
    () => (shouldShowPlanCard ? getImplementationPlanPrelude(plan) : ""),
    [plan, shouldShowPlanCard],
  );
  const {
    visibleResolvedContent,
    visiblePlanPrelude,
    effectiveResponseContent,
    hasVisibleResponseBody,
    hasPreludeResponseBody,
    hasPrimaryResponseBody,
    hasResponseContent,
    showResponseBody,
    responseChunksToRender,
  } = useMemo(
    () =>
      getRenderablePlanResponseChunks({
        visibleResponseBodyChunks,
        planPrelude,
        shouldShowPlanCard,
        cardMessage,
      }),
    [cardMessage, planPrelude, shouldShowPlanCard, visibleResponseBodyChunks],
  );
  // The agent/model/thinking and metrics header describes the AI response
  // block, rather than an individual assistant message. The shell selects the
  // single visible anchor for each collapsed or expanded block.
  const showAssistantResponseHeader =
    isBlockHeaderAnchor && (hasPrimaryResponseBody || blockSize > 1);
  const isAborted = cardMessage?.aborted === true;
  const effectiveInterruptedPresentation =
    cardMessage?.interruptedPresentation ||
    cardMessage?.info?.interruptedPresentation ||
    (isAborted ? "inline" : undefined);
    
  // If the block is collapsed, the aborted card might be hidden. 
  // We inherit the block's inline abort state so the visible card can render it.
  const interruptedPresentation = 
    isAssistantTurnCollapsed && blockHasInlineAbort 
      ? "inline" 
      : effectiveInterruptedPresentation;
  const structuredRetryError =
    !!cardMessage?.error &&
    (cardMessage.retryWithoutStructuredOutput === true ||
      isStructuredOutputFailureMessage(cardMessage.error));
  const structuredOutputWarning =
    structuredRetryError ||
    cardMessage?.displayError?.type === "structured_output_failure" ||
    isStructuredOutputFailureMessage(cardMessage?.displayError?.message);
  const showLegacyErrorBanner =
    !!cardMessage?.error &&
    !messageMatchesDisplayErrorText(cardMessage, cardMessage.error) &&
    !structuredOutputWarning &&
    !isAborted;
  const showDisplayErrorBanner =
    !!cardMessage?.displayError && !structuredOutputWarning;
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
  // Keep the loading label owned by the canonical live card. `isLiveStream`
  // describes only this component's local stream prop and can be false for a
  // transcript card during the live-card handoff, even while this card is the
  // active assistant turn. The ticker must also be able to render before the
  // first activity row exists.
  const shouldShowLiveLoadingText =
    isCurrentCardLiveAssistantTurn &&
    !isParentResponseFinished &&
    !isAborted &&
    !hideLoadingText;
  // Centralized data is the source of truth for what belongs in the final
  // assistant response. If the response text is present, render it directly
  // instead of hiding it behind a live-stream flag.
  // Use the sticky timeline snapshot, not the ephemeral live array, so rows
  // already painted in the UI remain visible through hydration rerenders.
  // Drive the collapsed state from the shared block-level prop when available
  // (so all non-last cards in the block toggle together), otherwise fall back
  // to the local viewState for standalone or legacy usage.
  const visibleStepsCount = timelineDisplayEvents.filter(
    (event) => !isHiddenLifecycleTimelineEvent(event),
  ).length;
  const collapsedTimelineLabel =
    typeof duration === "number" && Number.isFinite(duration) && duration > 0
      ? `Worked for ${formatDuration(duration * 1000)}`
      : visibleStepsCount === 1
        ? "Worked through 1 step"
        : `Worked through ${visibleStepsCount} steps`;
  const hasLiveTimelineActivity =
    hasStreamingActivity ||
    hasLiveSessionStatus ||
    hasActiveTimelineWork ||
    hasActiveReasoningPart ||
    hasPendingReasoningDisplayEvent;
  const showResponseSection =
    shouldShowPlanCard ||
    hasVisibleResponseBody ||
    hasStickyTimelineActivity ||
    (isLiveStream && hasLiveTimelineActivity);
const hasVisibleResponseSectionContent =
    (showResponseBody && !shouldInterleaveStreamingAssistantCommentary) ||
    (shouldShowPlanCard && !!plan);
  // The response card has its own preview state. It sits outside the activity
  // block's collapsed content, so its height must be controlled independently.
  const responseChunksVisibleInCurrentView = responseChunksToRender;
  // Every completed response body is constrained to the preview height first.
  // Whether it receives a fade is determined from its rendered height rather
  // than an arbitrary character count, so code-heavy and markdown-heavy cards
  // behave consistently too.
  const shouldConstrainResponsePreview =
    showResponseBody &&
    !isResponseExpanded;
  const canPreviewResponse = shouldConstrainResponsePreview && hasResponseOverflow;
  const isResponsePreviewCollapsed = canPreviewResponse;

  useEffect(() => {
    const preview = responsePreviewRef.current;
    if (!preview || !shouldConstrainResponsePreview) {
      setHasResponseOverflow(false);
      return;
    }

    const updateOverflow = () => {
      const nextHasOverflow = preview.scrollHeight > preview.clientHeight + 1;
      setHasResponseOverflow((current) =>
        current === nextHasOverflow ? current : nextHasOverflow,
      );
    };

    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(preview);
    return () => observer.disconnect();
  }, [responseChunksToRender, shouldConstrainResponsePreview]);

  const responseSectionClass = hasResponseContent
    ? "rounded-md border border-oc-border-soft bg-background p-2.5 shadow-sm"
    : "p-0 border-0 bg-transparent shadow-none";
  const hasCopyableResponseContent = (visibleResolvedContent?.trim()?.length ?? 0) > 0;
  const handleCopy = async () => {
    const textToCopy = visibleResolvedContent?.trim() ?? "";
    if (!textToCopy) return;

    try {
      await copyToClipboard(textToCopy);
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
  const handleForkSession = () => {
    if (!centralizedSessionId || !assistantMessageId || isForking) {
      logger.warn("[FORK_TRACE][WEBVIEW] fork click ignored", {
        centralizedSessionId,
        assistantMessageId,
        isForking,
        currentSessionId,
        isProcessing,
        isLoadingSession,
        processingSessionIds,
        streamingActive: currentStreaming?.isActive ?? false,
      });
      return;
    }

    logger.warn("[FORK_TRACE][WEBVIEW] fork requested", {
      sourceSessionId: centralizedSessionId,
      sourceMessageId: assistantMessageId,
      currentSessionId,
      isProcessing,
      isLoadingSession,
      processingSessionIds,
      assistantTurnPending,
      assistantTurnMessageId,
      streamingActive: currentStreaming?.isActive ?? false,
      streamingMessageId: currentStreaming?.messageId ?? null,
    });
    setIsForking(true);
    vscode.postMessage({
      type: "forkSession",
      sessionId: centralizedSessionId,
      messageId: assistantMessageId,
    });
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event?.data as
        | {
            type?: string;
            sessionId?: string;
            messageId?: string;
            success?: boolean;
            forkedSessionId?: string;
            error?: string;
          }
        | undefined;
      if (
        data?.type === "forkSessionResult" &&
        data.sessionId === centralizedSessionId &&
        data.messageId === assistantMessageId
      ) {
        logger.warn("[FORK_TRACE][WEBVIEW] fork result received", {
          sourceSessionId: data.sessionId,
          sourceMessageId: data.messageId,
          success: data.success === true,
          forkedSessionId: data.forkedSessionId ?? null,
          error: data.error ?? null,
          currentSessionId,
          isProcessing,
          isLoadingSession,
          processingSessionIds,
          streamingActive: currentStreaming?.isActive ?? false,
        });
        setIsForking(false);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [
    assistantMessageId,
    centralizedSessionId,
    currentSessionId,
    isLoadingSession,
    isProcessing,
    processingSessionIds,
    assistantTurnMessageId,
    assistantTurnPending,
    currentStreaming?.isActive,
    currentStreaming?.messageId,
  ]);
  const openSubagentModal = (subagentId: string) => {
    dispatch({ type: "SELECT_SUBAGENT", payload: subagentId });
  };

  const closeSubagentModal = () => {
    dispatch({ type: "SELECT_SUBAGENT", payload: null });
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

  // An assistant card may lack visible response text (hasVisibleResponseSectionContent)
  // or a response header (showAssistantResponseHeader) and still contain meaningful
  // activity in its timeline — e.g. tool-call steps, file edits, or pending reasoning.
  //
  // Without this guard, non-last cards in an expanded multi-card block (blockSize > 1)
  // that contain only timeline activity are marked isVisuallyEmpty and hidden via CSS,
  // leaving only the aborted/highest-card visible. The user sees an empty expanded block
  // instead of the full activity history.
  const hasTimelineActivity =
    nonQuestionTimelineDisplayEventGroups.length > 0 ||
    hasPendingReasoningDisplayEvent;
  const isVisuallyEmpty =
    !hasVisibleResponseSectionContent &&
    !showAssistantResponseHeader &&
    questionPreludeGroups.length === 0 &&
    !(isLastInBlock && blockSize !== undefined && blockSize > 1 && isBlockExpanded) &&
    !(!isAssistantTurnCollapsed && canCollapseCompletedAssistantTurn && !(blockSize !== undefined && blockSize > 1)) &&
    interruptedPresentation !== "inline" &&
    !showLegacyErrorBanner &&
    !showDisplayErrorBanner &&
    message?.retryState !== "retrying_without_structured_output" &&
    (hideFileChangesSection || !shouldShowFileChanges) &&
    (!centralizedDiffEvent?.files || centralizedDiffEvent.files.length === 0) &&
    (!subagents || subagents.length === 0) &&
    !hasTimelineActivity;

  const responseEnterClass = streaming
    ? "oc-assistant-streaming-enter"
    : "oc-assistant-response-enter";
  const isCentralizedDebugLive = !!streaming?.isActive;

  return (
    <div
      id={messageId ? `msg-${messageId}` : undefined}
      data-message-id={messageId || undefined}
      className={`oc-message-enter ${responseEnterClass} ${isContiguous ? "mb-2.5 mt-2" : "mb-3.5"}${isVisuallyEmpty && !isHiddenByBlock ? " hidden" : ""}`}
      // Do not apply content-visibility/intrinsic-size placeholders to the
      // active stream. The browser may skip the timeline body and expose the
      // 320px placeholder, leaving the Thought row stranded below a large
      // blank area. Settled history cards keep the virtualization optimization.
      style={streaming || isStreamingActive ? undefined : DEFERRED_CHAT_CARD_STYLE}
    >
      <div
        className={cn(
          "oc-msg-assistant",
        )}
        ref={messageBodyRef}
      >
        <div className="space-y-2">
          {showAssistantResponseHeader && (
            <div
              data-assistant-section="header"
              className="oc-msg-header mb-2 flex flex-wrap items-start justify-between gap-1.5"
            >
              <div className="oc-msg-header-main flex min-w-0 flex-1 items-center gap-1.5">
                <div className="oc-msg-header-left flex items-center gap-1.5 min-w-0">
                  <div className="oc-msg-header-text flex min-w-0 items-center gap-1.5 flex-wrap">
                    {headerSegments.map((segment, index) => (
                      <div key={segment.key} className="flex min-w-0 items-center gap-1">
                        {index > 0 && (
                          <span className="text-oc-xs font-medium shrink-0 opacity-60">&middot;</span>
                        )}
                        <span className={segment.className} style={segment.style}>
                          {segment.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="oc-msg-header-actions flex min-w-0 flex-wrap items-center gap-1.5">
                {hasMetrics && (
                  <div className="oc-metrics-rail flex flex-wrap items-center gap-2 px-1 py-0.5 text-[10px] text-oc-text-secondary/60 hover:text-oc-text-secondary transition-colors" role="list" aria-label="Response metrics">
                    {inputTok > 0 && (
                      <div className="oc-metric-item flex items-center gap-1" data-tooltip={`Prompt: ${inputTok.toLocaleString()} tokens`} aria-label={`Prompt: ${inputTok.toLocaleString()} tokens`} tabIndex={0} role="listitem">
                        <ArrowUp className="h-2.5 w-2.5 opacity-70" />
                        <span className="tabular-nums">{inputTok.toLocaleString()}</span>
                      </div>
                    )}
                    {outputTok > 0 && (
                      <div className="oc-metric-item flex items-center gap-1" data-tooltip={`Response: ${outputTok.toLocaleString()} tokens`} aria-label={`Response: ${outputTok.toLocaleString()} tokens`} tabIndex={0} role="listitem">
                        <ArrowDown className="h-2.5 w-2.5 opacity-70" />
                        <span className="tabular-nums">{outputTok.toLocaleString()}</span>
                      </div>
                    )}
                    {reasoningTok > 0 && (
                      <div className="oc-metric-item flex items-center gap-1" data-tooltip={`Reasoning: ${reasoningTok.toLocaleString()} tokens`} aria-label={`Reasoning: ${reasoningTok.toLocaleString()} tokens`} tabIndex={0} role="listitem">
                        <Brain className="h-2.5 w-2.5 opacity-70" />
                        <span className="tabular-nums">{reasoningTok.toLocaleString()}</span>
                      </div>
                    )}
                    {cacheRead > 0 && (
                      <div className="oc-metric-item flex items-center gap-1" data-tooltip={`Cache Read: ${cacheRead.toLocaleString()} tokens`} aria-label={`Cache Read: ${cacheRead.toLocaleString()} tokens`} tabIndex={0} role="listitem">
                        <Database className="h-2.5 w-2.5 opacity-70" />
                        <span className="tabular-nums">{cacheRead.toLocaleString()}</span>
                      </div>
                    )}
                    {cacheWrite > 0 && (
                      <div className="oc-metric-item flex items-center gap-1" data-tooltip={`Cache Write: ${cacheWrite.toLocaleString()} tokens`} aria-label={`Cache Write: ${cacheWrite.toLocaleString()} tokens`} tabIndex={0} role="listitem">
                        <Database className="h-2.5 w-2.5 opacity-40" />
                        <span className="tabular-nums">{cacheWrite.toLocaleString()}</span>
                      </div>
                    )}
                    {typeof duration === "number" && (
                      <div className="oc-metric-item flex items-center gap-1" data-tooltip={`Duration: ${formatDuration(duration * 1000)}`} aria-label={`Duration: ${formatDuration(duration * 1000)}`} tabIndex={0} role="listitem">
                        <Clock className="h-2.5 w-2.5 opacity-70" />
                        <span className="tabular-nums">{formatDuration(duration * 1000)}</span>
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

          {questionPreludeGroups.length > 0 && (
            <section data-assistant-section="question-prelude" className="space-y-2">
              {questionPreludeGroups.map((group, groupIdx) => {
                if (group.type === "question-output") {
                  return (
                    <ResponseMessageBody
                      key={`question-prelude-output-${group.key}`}
                      content={[group.text]}
                      className="oc-response-body-block"
                      variant="bare"
                    />
                  );
                }

                if (group.type === "commentary") {
                  return (
                    <div key={`question-prelude-commentary-${groupIdx}`} className="px-1 mb-2 mt-1">
                      <ResponseMessageBody
                        content={[group.event.summary]}
                        className="oc-response-commentary-block"
                      />
                    </div>
                  );
                }

                if (group.events.length === 0) return null;

                return (
                  <Stepper
                    key={`question-prelude-stepper-${groupIdx}`}
                    className="oc-refined-stepper oc-activity-timeline-compact"
                  >
                    {group.events.map((event, index) => {
                      const isLast = index === group.events.length - 1;
                      const visibleQuestionPreludeSummary = getVisibleDefaultActivitySummary(
                        event.label,
                        event.summary,
                      );
                      return (
                        <StepperItem
                          key={`question-prelude-${event.key}`}
                          isLast={isLast}
                          indicator={<StepIndicator status={event.status} />}
                          className={cn(
                            "oc-refined-stepper-item group",
                            event.status === "running" ? "is-streaming" : "",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2 w-full">
                            <ExpandableStep className="flex-1">
                              <div className="oc-activity-step-surface flex flex-col items-start gap-2 w-full min-w-0">
                                <div className="flex items-center gap-2 flex-wrap min-h-[20px]">
                                  <span className="oc-activity-step-title font-medium text-oc-text capitalize">
                                    {event.label.replace(/_/g, " ")}
                                  </span>
                                </div>
                                {visibleQuestionPreludeSummary && (
                                  <div className="flex flex-col gap-1 w-full">
                                    <div className="oc-refined-event-summary">
                                      <CollapsedMarkdownPreview
                                        title={event.label}
                                        content={visibleQuestionPreludeSummary}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </ExpandableStep>
                          </div>
                        </StepperItem>
                      );
                    })}
                  </Stepper>
                );
              })}
            </section>
          )}

          {!isAssistantTurnCollapsed &&
            (hasStickyTimelineActivity ||
              hasLiveSessionStatus ||
              showThinkingPlaceholder ||
              nonQuestionTimelineDisplayEventGroups.length > 0 ||
              shouldShowLiveLoadingText) && (
              <section data-assistant-section="activity" className="space-y-0">
                {/* Lifecycle-delimited Steppers are siblings. Keep this
                    section gap-free so start/finish blocks cannot accumulate
                    empty space before the live Thought. */}
                {/* Hide the session.status banner when statusType is "busy" — the AI response
                    loading indicator (ThinkingBubble / activity timeline) already conveys busy
                    state. Other status types (retry, error, idle, ready, etc.) must still
                    render so the user sees retry countdowns and surfacing session events. */}
                {hasLiveSessionStatus && liveSessionStatus?.statusType !== "busy" ? (
                  <div className="mb-2 px-1.5">
                    <div
                      className={cn(
                        "oc-live-session-status",
                        liveSessionStatus.statusType === "retry" && "is-retry",
                      )}
                      role="status"
                      aria-live="polite"
                      style={{
                        "--oc-live-status-color": liveSessionStatus.statusType === "retry"
                          ? "var(--vscode-warningForeground)"
                          : "var(--oc-text-secondary)",
                      } as CSSProperties}
                    >
                      <div className="oc-live-session-status__icon" aria-hidden="true">
                        {liveSessionStatus.statusType === "retry" ? (
                          <AlertTriangle className="h-3.5 w-3.5" />
                        ) : (
                          <div className="h-2 w-2 rounded-full animate-pulse bg-current" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="oc-live-session-status__title">
                          <span>{liveStatusTitle}</span>
                          {liveSessionStatus.statusType === "retry" ? (
                            <span className="oc-live-session-status__state">Waiting</span>
                          ) : null}
                        </div>
                        {liveSessionStatus.statusType === "retry" && liveSessionStatus.attempt ? (
                          <div className="oc-live-session-status__meta">
                            Attempt {liveSessionStatus.attempt}
                          </div>
                        ) : null}
                        {liveStatusSubtitle ? (
                          <div className="oc-live-session-status__description">{liveStatusSubtitle}</div>
                        ) : null}
                      </div>
                      {liveStatusCountdown ? (
                        <div className="oc-live-session-status__countdown">
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          <span>{liveStatusCountdown}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {nonQuestionTimelineDisplayEventGroups.map((group, groupIdx) => {
                  if (group.type === "commentary") {
                    return (
                      <div key={`commentary-${groupIdx}`} className="px-1 mb-2 mt-1">
                        <ResponseMessageBody
                          content={[group.event.summary]}
                          className="oc-response-commentary-block"
                        />
                      </div>
                    );
                  }

                  if (group.type === "question-output") {
                    return (
                      <ResponseMessageBody
                        key={group.key}
                        content={[group.text]}
                        className="oc-response-body-block"
                        variant="bare"
                      />
                    );
                  }
                  
                  if (group.events.length === 0) return null;

                  return (
                    <Stepper
                      key={timelineDisplayGroupReactKey(group.events, groupIdx)}
                      className="oc-refined-stepper oc-activity-timeline-compact"
                      ref={groupIdx === nonQuestionTimelineDisplayEventGroups.length - 1 ? progressTimelineRef : undefined}
                      autoScrollToBottom={isStreamingActive && groupIdx === nonQuestionTimelineDisplayEventGroups.length - 1}
                    >
                       {group.events.map((event, index) => {
                        // Lifecycle markers remain in the tape for ordering and
                        // reconciliation, but they have no visible row. Treat the
                        // last visible item as final so its timeline connector does
                        // not stretch through the empty space before subagents.
                        const isLastVisibleEventInGroup = !group.events
                          .slice(index + 1)
                          .some((candidate) => !isHiddenLifecycleTimelineEvent(candidate));
                        const isLast =
                          groupIdx === nonQuestionTimelineDisplayEventGroups.length - 1 &&
                          isLastVisibleEventInGroup;
                        const indicatorNode = (
                          <StepIndicator
                            status={event.status}
                          />
                        );
                        const shouldShowDetail = viewState.showActivityDetails;
                        const labelText = (event.label ?? "").toString();
                        const labelLower = labelText.trim().toLowerCase();
                        const compressTopic = labelLower === "compress"
                          ? firstNonEmptyString(
                              (event.activityDetail?.input as Record<string, unknown> | undefined)?.topic,
                              (event.activityDetail?.metadata as Record<string, unknown> | undefined)?.topic,
                            )
                          : undefined;
                        const shouldHideSummary =
                          labelLower === "compress" ||
                          isActivityTextRedundantWithTitle(event.label, event.summary);
                        const visibleSummary = shouldHideSummary && labelLower === "compress"
                          ? ""
                          : getVisibleDefaultActivitySummary(
                              event.label,
                              event.summary,
                              event.filePath,
                            );
                        const shouldHideDescription =
                          !!event.description &&
                          (isActivityTextRedundantWithTitle(event.label, event.description) ||
                            isActivityTextRedundantWithTitle(visibleSummary, event.description));
                        const shouldHideDetail =
                          !!event.detail &&
                          (isActivityTextRedundantWithTitle(event.label, event.detail) ||
                            isActivityTextRedundantWithTitle(visibleSummary, event.detail) ||
                            isActivityTextRedundantWithTitle(event.description, event.detail));
                        // OpenCode's generic `task` tool carries the selected
                        // subagent in input.subagent_type. Keep it visible in
                        // the step header so task rows identify which agent
                        // performed the work without expanding the prompt.
                        const taskSubagentType =
                          labelLower === "task"
                            ? asString(event.activityDetail?.input?.subagent_type).trim()
                            : "";
                        // skill_mcp exposes the selected MCP server and tool in
                        // its structured input. Keep both visible in the step
                        // header so the activity row identifies the external
                        // capability without expanding the raw arguments/output.
                        const skillMcpName =
                          labelLower === "skill_mcp"
                            ? asString(event.activityDetail?.input?.mcp_name).trim()
                            : "";
                        const skillMcpToolName =
                          labelLower === "skill_mcp"
                            ? asString(event.activityDetail?.input?.tool_name).trim()
                            : "";
                        const skillMcpTarget = [skillMcpName, skillMcpToolName]
                          .filter(Boolean)
                          .join(" · ");
                        // A file-read row is intentionally a compact timeline marker.
                        // Its payload can be a complete source file, and mounting an
                        // otherwise-empty detail column leaves a clipped surface and
                        // vertical gap between consecutive Read/Thought rows.
                        const isReadActivity = labelLower === "read";
                        const readLineRange = isReadActivity
                          ? formatReadLineRange(event.activityDetail?.input, event.activityDetail?.metadata)
                          : undefined;
                        const shouldRenderActivityBody = !isReadActivity;

                        // Lifecycle markers (step-start / step-finish) are used
                        // only to split logical timeline blocks. They must not
                        // mount a StepperItem: even a hidden item can affect
                        // flex/connector sizing and create a gap between blocks.
                        const isLifecycleMarkerEvent =
                          event.internal === true && (
                            (event.partType || "").trim().toLowerCase() === "step-start" ||
                            (event.partType || "").trim().toLowerCase() === "step-finish" ||
                            labelLower === "step-start" ||
                            labelLower === "step-finish" ||
                            labelLower === "starting step" ||
                            labelLower === "finishing step" ||
                            (labelLower === "step" && (
                              (event.summary || "").trim().toLowerCase() === "start" ||
                              (event.summary || "").trim().toLowerCase() === "finish"
                            )) ||
                            (labelLower === "start" && (event.summary || "").trim().toLowerCase() === "start") ||
                            (labelLower === "finish" && (event.summary || "").trim().toLowerCase() === "finish")
                        );
                        if (isLifecycleMarkerEvent) {
                          // Preserve the canonical start/finish classification
                          // for lifecycle contracts even though the marker is
                          // intentionally not mounted in the visual timeline.
                          const partTypeLower = (event.partType || "").trim().toLowerCase();
                          const isStart = partTypeLower === "step-start" ||
                            labelLower === "step-start" ||
                            labelLower === "starting step" ||
                            labelLower === "start" ||
                            (event.summary || "").trim().toLowerCase() === "start";
                          void isStart;
                          return null;
                        }

                        const isGlobSearch = labelLower === "glob";
                        const isEditLike =
                          labelLower === "edit" ||
                          labelLower === "file_edit" ||
                          labelLower === "modify" ||
                          labelLower === "patch" ||
                          labelLower === "write" ||
                          labelLower === "apply_patch";
                        const editChangeSize = isEditLike
                          ? formatEditChangeSize(event.activityDetail?.input)
                          : undefined;
                        const showDiffPreviewLocal =
                          isEditLike &&
                          (
                            !!event.activityDetail?.diffExcerpt ||
                            !!(event.activityDetail?.input as Record<string, unknown> | undefined)?.patchText ||
                            !!(event.activityDetail?.input as Record<string, unknown> | undefined)?.patch ||
                            !!(event.activityDetail?.input as Record<string, unknown> | undefined)?.diff ||
                            !!(event.activityDetail?.metadata as Record<string, unknown> | undefined)?.diff ||
                            !!(event.activityDetail?.metadata as Record<string, unknown> | undefined)?.filediff ||
                            !!event.diffStats
                          );

                        return (
                          <ActivityTimelineItem
                            key={timelineDisplayEventReactKey(event)}
                            id={timelineDisplayEventReactKey(event)}
                            isLast={isLast}
                            status={event.status}
                            animateEntrance={isStreamingActive}
                          >
                            {(() => {
                              if (event.kind === "reasoning") {
                                const isExpanded = viewState.expandedReasoningSteps.has(event.key);
                                // A live reasoning part remains pending until its terminal
                                // SDK snapshot arrives, but its delta text is already useful
                                // and must remain inspectable during that period.
                                const hasReasoningContent =
                                  event.summary.trim().length > 0 &&
                                  event.summary.trim() !== "Thinking...";
                                // Compute elapsed thinking time for "Thought for Xs" label.
                                // Uses whole seconds (no ms) for a clean, human-friendly display.
                                const thinkingDuration = (() => {
                                  if (!event.startedAt) return null;
                                  const ms = Math.max(0, (event.endedAt ?? Date.now()) - event.startedAt);
                                  if (ms < 1000) return "< 1s";
                                  const secs = Math.round(ms / 1000);
                                  if (secs < 60) return `${secs}s`;
                                  const mins = Math.floor(secs / 60);
                                  const rem = secs % 60;
                                  return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
                                })();
                                const isPending = event.status === "pending" || event.status === "running";
                                const headerLabel = isPending
                                  ? "Thinking…"
                                  : thinkingDuration
                                    ? `Thought for ${thinkingDuration}`
                                    : "Thought";
                                return (
                                  // Compact single-line header: ● Thought for Xs >
                                  <div className="w-full">
                                    <button
                                      type="button"
                                      className={cn(
                                        "oc-reasoning-row",
                                        isExpanded && "is-expanded",
                                        isPending && "is-pending",
                                      )}
                                      onClick={() => {
                                        if (!hasReasoningContent) {
                                          return;
                                        }
                                        // Toggle this reasoning step's expansion in local view state
                                        setViewState((prev) => {
                                          const next = new Set(prev.expandedReasoningSteps);
                                          if (next.has(event.key)) {
                                            next.delete(event.key);
                                          } else {
                                            next.add(event.key);
                                          }
                                          return { ...prev, expandedReasoningSteps: next };
                                        });
                                      }}
                                      aria-expanded={isExpanded}
                                      aria-disabled={!hasReasoningContent}
                                    >
                                      {/* "Thought for Xs" label */}
                                      <span className="oc-reasoning-row-label">{headerLabel}</span>
                                      {/* A pending row can already have live delta text. */}
                                      {hasReasoningContent && (
                                        <span
                                          className={cn(
                                            "oc-reasoning-chevron",
                                            isExpanded && "is-expanded",
                                          )}
                                          aria-hidden="true"
                                        >
                                          &rsaquo;
                                        </span>
                                      )}
                                    </button>
                                    {/* Expanded reasoning content */}
                                    {isExpanded && hasReasoningContent && (
                                      <div className="oc-reasoning-body">
                                        <MarkdownRenderer
                                          content={event.summary}
                                          className="markdown-body"
                                        />
                                      </div>
                                    )}
                                  </div>
                                );
                              } else {
                                const activityTool = (event.activityDetail?.tool ?? "").trim().toLowerCase();
                                const taskSubagentType = labelLower === "task"
                                  ? firstNonEmptyString(
                                      asString((event.activityDetail?.input as Record<string, unknown> | undefined)?.subagent_type),
                                      asString((event.activityDetail?.input as Record<string, unknown> | undefined)?.agent),
                                    )
                                  : undefined;
                                return (
                                  <div className="flex items-start justify-between gap-2 w-full">
                                    <ExpandableStep className="flex-1">
                                      {labelLower === "call_omo_agent" || labelLower === "omo_agent" ? (
                                        <CallOmoAgentStep
                                          callID={event.callID}
                                          sessionID={event.sessionID}
                                          parentSessionId={centralizedSessionId ?? undefined}
                                          parentMessageId={assistantMessageId ?? undefined}
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
                                        <div className={cn(
                                          "oc-activity-step-surface flex flex-col items-start w-full min-w-0",
                                          shouldRenderActivityBody ? "gap-2" : "gap-0",
                                        )}>
                                          <div className="flex items-center gap-2 flex-wrap w-full min-h-[20px]">
                                            <span className="oc-activity-step-title font-medium text-oc-text capitalize">
                                              {event.label.replace(/_/g, " ")}
                                            </span>
                                            {taskSubagentType ? (
                                              <span
                                                className="oc-activity-step-meta max-w-[min(44ch,60vw)] truncate font-mono text-[11px] text-oc-text-soft"
                                                title={taskSubagentType}
                                              >
                                                {taskSubagentType}
                                              </span>
                                            ) : null}
                                            {taskSubagentType ? (
                                              <span
                                                className="oc-activity-step-meta max-w-[min(44ch,60vw)] truncate font-mono"
                                                title={taskSubagentType}
                                              >
                                                {taskSubagentType}
                                              </span>
                                            ) : null}
                                            {skillMcpTarget ? (
                                              <span
                                                className="oc-activity-step-meta max-w-[min(52ch,70vw)] truncate font-mono"
                                                title={skillMcpTarget}
                                              >
                                                {skillMcpTarget}
                                              </span>
                                            ) : null}
                                            {isGlobSearch && typeof event.activityDetail?.input?.pattern === "string" && event.activityDetail.input.pattern.trim() ? (
                                              <span
                                                className="max-w-[min(44ch,60vw)] truncate rounded bg-oc-bg-soft px-1.5 py-0.5 font-mono text-xs text-oc-text-soft"
                                                title={event.activityDetail.input.pattern}
                                              >
                                                {event.activityDetail.input.pattern}
                                              </span>
                                            ) : null}
                                            {compressTopic ? (
                                              <span className="oc-activity-step-meta truncate max-w-[min(42ch,60vw)] text-oc-text-soft">
                                                {compressTopic}
                                              </span>
                                            ) : null}
                                            {(() => {
                                              const desc = (event.activityDetail?.metadata?.description as string) || (event.activityDetail?.input?.description as string);
                                              return desc ? (
                                                <span className="oc-activity-step-meta flex items-center gap-2 text-oc-text-soft">
                                                  <span>&middot;</span>
                                                  <span>{desc}</span>
                                                </span>
                                              ) : null;
                                            })()}
                                            {/* Event source and internal badges intentionally hidden */}

                                            {(() => {
                                              const fp = event.filePath || 
                                                         (event.activityDetail?.input as Record<string, unknown> | undefined)?.filePath as string ||
                                                         (event.activityDetail?.metadata as Record<string, any> | undefined)?.filediff?.file as string;
                                              const shouldShowFileLink = labelLower === "read" || isGlobSearch || isEditLike;
                                              return shouldShowFileLink && fp && !isUrl(fp) ? (
                                                <button
                                                  type="button"
                                                  className="oc-refined-file-link oc-refined-file-link-with-tooltip oc-refined-file-link-inline oc-refined-file-link-plain"
                                                  onClick={() =>
                                                    vscode.postMessage({
                                                      type: "openFile",
                                                      file: fp,
                                                    })
                                                  }
                                                >
                                                  <FileIcon
                                                    filePath={fp}
                                                    isDirectory={isDirectoryActivityPath(fp, event.activityDetail)}
                                                  />
                                                  <span className="truncate">
                                                    {fp.split(/[\\/]/).pop() || fp}
                                                  </span>
                                                  <span className="oc-refined-file-link-tooltip oc-refined-file-link-tooltip-below" role="tooltip">
                                                    {fp}
                                                  </span>
                                                </button>
                                              ) : null;
                                            })()}
                                          </div>

                                          {readLineRange ? (
                                            <span className="oc-activity-step-meta pl-0.5 font-mono text-[11px] text-oc-text-soft">
                                              {readLineRange}
                                            </span>
                                          ) : null}
                                          {editChangeSize ? (
                                            <span className="oc-activity-step-meta pl-0.5 font-mono text-[11px] text-oc-text-soft">
                                              {editChangeSize}
                                            </span>
                                          ) : null}

                                          {shouldRenderActivityBody ? (
                                          <div className="flex flex-col gap-1 w-full">
                                              {/* For read, TodoWrite, and edit events, skip the generic summary
                                                  block because they have dedicated content below. Every other
                                                  activity summary must pass through a bounded preview; otherwise
                                                  one large Markdown/tool payload can expand the entire timeline
                                                  while the other activity rows remain collapsed. */}
                                              {/* Bash/Glob payloads live in activityDetail, not necessarily in the
                                                  generic summary.  Render their terminal surface directly so live
                                                  tool snapshots do not disappear until SDK rehydration supplies a
                                                  summary. */}
                                              {labelLower === "bash" || isGlobSearch ? (
                                                <div className="oc-refined-event-summary">
                                                  <TerminalBlockWithOutput
                                                    event={event}
                                                    messageContent={content}
                                                  />
                                                </div>
                                              ) : labelLower === "skill_mcp" ? (
                                                <SkillMcpActivityStep event={event} />
                                              ) : !visibleSummary && (
                                                (event.activityDetail?.input && Object.keys(event.activityDetail.input).length > 0) ||
                                                asString(event.activityDetail?.output).trim()
                                              ) ? (
                                                <GenericToolPayloadStep event={event} />
                                              ) : labelLower !== "read" && labelLower !== "todowrite" && labelLower !== "skill_mcp" && !isEditLike && visibleSummary && (
                                                <div className="oc-refined-event-summary">
                                                  {labelLower === "bash" || isGlobSearch ? (
                                                    <TerminalBlockWithOutput
                                                      event={event}
                                                      messageContent={content}
                                                    />
                                                  ) : SEARCH_LABELS.has(event.label) ? (
                                                    <DetailedSearchActivityPreview
                                                      event={event}
                                                      isGlobSearch={isGlobSearch}
                                                    />
                                                  ) : (
                                                    <CollapsedMarkdownPreview
                                                      title={event.label}
                                                      content={
                                                        event.filePath && isUrl(event.filePath)
                                                          ? `${visibleSummary}\n\n[Open link](${event.filePath})`
                                                          : visibleSummary
                                                      }
                                                    />
                                                  )}
                                                </div>
                                              )}

                                              {!SEARCH_LABELS.has(labelText) && labelLower !== "bash" && labelLower !== "todowrite" && labelLower !== "read" && event.description && !shouldHideDescription && (
                                                <div className="mt-1">
                                                  <CollapsedMarkdownPreview
                                                    title={`${event.label} description`}
                                                    content={event.description}
                                                  />
                                                </div>
                                              )}

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

                                              {shouldShowDetail && event.detail && !shouldHideDetail && (
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
                                                    <CollapsedTerminalBlockPreview
                                                      title={`${event.label} command`}
                                                      command={event.activityDetail.command}
                                                    />
                                                  )}
                                                </div>
                                              )}
                                          </div>
                                          ) : null}
                                      </div>
                                    )}
                                  </ExpandableStep>

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

                              </div>
                                );
                              }
                            })()}
                          </ActivityTimelineItem>
                        );
                      })}
                    </Stepper>
                  );
                })}

                {/*
                 * Keep the live status text attached to the assistant card.
                 * The ticker used to be mounted only by the session-switch
                 * spinner, so normal SSE responses could lose the loading
                 * text while their activity rows were still streaming. It
                 * must not be rendered in the composer: mounting it here
                 * preserves the card's ownership and prevents a response
                 * rerender from moving the scroll target to the user prompt.
                 */}
                {shouldShowLiveLoadingText ? (
                  <div
                    data-assistant-section="live-loading-text"
                    className="px-1 py-1"
                    role="status"
                    aria-live="polite"
                  >
                    <AIStatusTicker />
                  </div>
                ) : null}

              </section>
            )}

          {/* Per-card collapsed pill — only for single-card blocks or
              non-last cards that have their own collapse state. */}
          {isAssistantTurnCollapsed && !(isLastInBlock && blockSize > 1) && !(blockSize > 1 && !isLastInBlock) && (
            <section data-assistant-section="activity-collapsed">
              <button
                type="button"
                className="oc-assistant-turn-collapse-toggle group flex w-full items-center justify-start gap-1 px-1.5 py-1 text-left transition-colors"
                onClick={() => {
                  // Prefer the shared block-level handler so sibling cards
                  // in the same block expand together.
                  if (onSetBlockExpanded) {
                    onSetBlockExpanded(true);
                  } else {
                    setViewState((current) => ({
                      ...current,
                      showExpandedActivityTimeline: true,
                    }));
                  }
                }}
                aria-expanded="false"
                aria-label="Expand activity timeline"
                title="Expand activity timeline"
              >
                <span className="truncate text-[11px] font-normal oc-text-secondary">
                  {collapsedTimelineLabel}
                </span>
                <ChevronRight className="h-2.5 w-2.5 shrink-0 oc-text-secondary transition-transform group-hover:translate-x-0.5" />
              </button>
            </section>
          )}

          {/* Block-level pill for the last card in a multi-card block.
              When collapsed: replaces ALL the per-card pills with one unified summary
              and is displayed ABOVE the final text to maintain chronological sense. */}
          {isLastInBlock && blockSize > 1 && !isBlockStreaming && !isBlockExpanded && (
            <section data-assistant-section="block-collapse-control-collapsed">
              <div className="flex justify-start mb-2">
                <button
                  type="button"
                  className="oc-assistant-turn-collapse-toggle group flex items-center justify-start gap-1 rounded-md px-1.5 py-1 text-left transition-colors"
                  onClick={() => onSetBlockExpanded?.(true)}
                  aria-expanded="false"
                  aria-label="Expand all steps"
                  title="Expand all steps"
                >
                  <span className="truncate text-[11px] font-normal oc-text-secondary">
                    {blockSize - 1} earlier {blockSize - 1 === 1 ? "step" : "steps"} collapsed
                  </span>
                  <ChevronRight className="h-2.5 w-2.5 shrink-0 oc-text-secondary transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            </section>
          )}

          {showResponseSection && hasVisibleResponseSectionContent && (
                <section
                  data-assistant-section="response"
                  className={responseSectionClass}
            >
              {showResponseBody && !shouldInterleaveStreamingAssistantCommentary && (
                <div
                  ref={responsePreviewRef}
                  className={cn(
                    "relative mt-1.5 space-y-1.5",
                    shouldConstrainResponsePreview && "max-h-32 overflow-hidden",
                  )}
                >
                  {responseChunksVisibleInCurrentView.map((chunk, index) => (
                    <ResponseMessageBody
                      key={`${messageId || "assistant"}-response-${index}`}
                      content={[chunk]}
                      isStreaming={isLiveStream}
                      className="oc-response-body-block"
                      variant="bare"
                    />
                  ))}
                  {isResponsePreviewCollapsed && (
                    <FadedCollapseOverlay
                      label="Show full response"
                      onClick={() => setIsResponseExpanded(true)}
                      backgroundClassName="from-background via-background/90 to-transparent"
                    />
                  )}
                </div>
              )}

              {hasResponseOverflow && isResponseExpanded && (
                <div className="mt-2 flex justify-start">
                  <button
                    type="button"
                    className="oc-assistant-turn-collapse-link inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium oc-text-secondary transition-colors hover:text-oc-text"
                    onClick={() => setIsResponseExpanded(false)}
                    aria-expanded="true"
                    aria-label="Show less response"
                    title="Show less response"
                  >
                    <ChevronUp className="h-3 w-3" />
                    <span>Show less</span>
                  </button>
                </div>
              )}

              {shouldShowPlanCard && plan && (
                <div
                  className={
                    showResponseBody
                      ? "oc-response-plan-separator mt-3 pt-3 border-t"
                      : undefined
                  }
                >
                  <ImplementationPlanCard
                    plan={plan}
                    isRevisedPlan={isRevisedPlan}
                    planStatus={planStatus}
                  />
                </div>
              )}
              {walkthrough && shouldShowWalkthroughCard && !isStreamingActive && (
                <div
                  className={
                    shouldShowPlanCard || showResponseBody
                      ? "oc-response-plan-separator mt-3 pt-3 border-t"
                      : undefined
                  }
                >
                  <WalkthroughCard walkthrough={walkthrough} />
                </div>
              )}
              {!isStreamingActive && !hasCopyableResponseContent && (
                <div className="mt-2 flex items-center justify-start">
                  {/* For intermediate messages without copyable text,
                      we move the timestamp inside the response bubble.
                      We also omit the copy button here to keep the UI clean. */}
                  {(() => {
                    const ts = formatMessageTime(getMessageTimestamp(cardMessage));
                    return ts ? (
                      <span className="oc-text-secondary text-[10px] tabular-nums opacity-70 flex items-center gap-1">
                        <span>{ts}</span>
                        {typeof duration === "number" && (
                          <>
                            <span className="opacity-40">·</span>
                            <span>{formatDuration(duration * 1000)}</span>
                          </>
                        )}
                      </span>
                    ) : null;
                  })()}
                </div>
              )}
            </section>
          )}

          {shouldRenderSubagentsInlineCard && (
            <SubagentsInlineCard
              subagents={subagents}
              subagentDetailsById={subagentDetailsById || {}}
              showSubagents={showSubagents}
              setShowSubagents={setShowSubagents}
              showAllSubagents={showAllSubagents}
              setShowAllSubagents={setShowAllSubagents}
              openSubagentModal={openSubagentModal}
              parentResponseFinished={isParentResponseFinished}
            />
          )}

          {/* Block-level pill for the last card in a multi-card block.
              When expanded: shows a single Collapse link at the very end to fold the whole block. */}
          {isLastInBlock && blockSize > 1 && !isBlockStreaming && isBlockExpanded && (
            <section data-assistant-section="block-collapse-control-expanded">
              <div className="flex justify-start mt-1">
                <button
                  type="button"
                  className="oc-assistant-turn-collapse-link inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium oc-text-secondary transition-colors hover:text-oc-text"
                  onClick={() => onSetBlockExpanded?.(false)}
                  aria-expanded="true"
                  aria-label="Collapse steps"
                  title="Collapse steps"
                >
                  <ChevronUp className="h-2.5 w-2.5" />
                  Collapse
                </button>
              </div>
            </section>
          )}

          {/* Per-card Collapse link — suppressed for non-last cards in a
              multi-card block (they are hidden when collapsed, so the link
              is never needed) and for the last card which uses the
              block-level control above. */}
          {!isAssistantTurnCollapsed && canCollapseCompletedAssistantTurn && !(blockSize > 1) && (
            <div className="flex justify-start">
              <button
                type="button"
                className="oc-assistant-turn-collapse-link inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium oc-text-secondary transition-colors hover:text-oc-text"
                onClick={() => {
                  // Prefer the shared block-level handler so sibling cards
                  // in the same block collapse together.
                  if (onSetBlockExpanded) {
                    onSetBlockExpanded(false);
                  } else {
                    setViewState((current) => ({
                      ...current,
                      showExpandedActivityTimeline: false,
                    }));
                  }
                }}
                aria-expanded="true"
                aria-label="Collapse activity timeline"
                title="Collapse activity timeline"
              >
                <ChevronDown className="h-3 w-3" />
                <span>Collapse</span>
              </button>
            </div>
          )}

        </div>

        {shouldShowResponseActions &&
          showResponseSection &&
          hasCopyableResponseContent && (
          // For the main text response (messages with copyable content),
          // we render the copy button and the timestamp outside the response bubble.
          <div className="mt-1 flex items-center justify-start gap-1.5">
            {structuredOutputWarning && (
              <span
                className="oc-refined-file-link-with-tooltip inline-flex h-7 w-5 items-center justify-center"
                aria-label="Structured output unavailable; showing the plain-text response"
              >
                <AlertTriangle className="oc-warning-icon-color h-3.5 w-3.5" />
                <span className="oc-refined-file-link-tooltip" role="tooltip">
                  The model did not produce structured output. The response above is still available as plain text.
                </span>
              </span>
            )}
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
            <button
              type="button"
              className="oc-bubble-copy-btn h-7 w-7"
              onClick={handleForkSession}
              disabled={!centralizedSessionId || !assistantMessageId || isForking}
              aria-label="Fork conversation from this response"
              title={
                centralizedSessionId && assistantMessageId
                  ? "Fork conversation from this response"
                  : "Fork unavailable: missing session or message identifier"
              }
            >
              {isForking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <GitFork className="h-3.5 w-3.5" />
              )}
            </button>
            {(() => {
              const ts = formatMessageTime(getMessageTimestamp(cardMessage));
              return ts ? (
                <span className="oc-text-secondary text-[10px] tabular-nums opacity-70 flex items-center gap-1">
                  <span>{ts}</span>
                  {typeof duration === "number" && (
                    <>
                      <span className="opacity-40">·</span>
                      <span>{formatDuration(duration * 1000)}</span>
                    </>
                  )}
                </span>
              ) : null;
            })()}
          </div>
        )}

        {interruptedPresentation === "inline" &&
          !hasQuestionLikeInteractiveContent(cardMessage) &&
          // When this card is part of a multi-card block that has an inline
          // abort, the block-level presentation (collapsed override badge or
          // detached assistant.abort transcript entry) already provides the
          // interruption indicator. Rendering a second inline badge on the
          // individual card inside the block would duplicate the visual.
          !(blockHasInlineAbort && blockSize !== undefined && blockSize > 1) && (
          // Inline interrupted badge is correct only when the abort belongs to
          // this card's own transcript position. If projection switches the
          // presentation to `detached`, a separate later conversation entry
          // will render it so the UI can match the centralized tape order
          // without moving the assistant response block itself.
          <div className="mt-2 flex items-center justify-center">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium tracking-wide text-amber-400">
              <div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>Interrupted</span>
            </div>
          </div>
        )}

        {showLegacyErrorBanner && (
          <div className="mt-2">
            <ErrorBanner message={cardMessage?.error ?? ""} />
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
                parentResponseFinished={isParentResponseFinished}
                onClose={closeSubagentModal}
              />
            );
          })()}

        {/* File Changes - aggregated diffs at the bottom */}
        {/* Only show for the specific message that has file changes, not for every message */}
        {!hideFileChangesSection && shouldShowFileChanges && (
          <div className="mt-4">
            <FileChangesSection
              structuredFileChanges={fileChanges || []}
              changeSummary={messageChangeSummary}
              messageId={firstNonEmptyString(messageChangeSummary?.messageId, messageId) || null}
              sessionId={currentSessionId}
            />
          </div>
        )}

        {centralizedDiffEvent?.files?.length > 0 && (
          <div className="mt-4">
            <FileChangesSection
              structuredFileChanges={[]}
              centralizedDiffEvent={centralizedDiffEvent}
              messageId={centralizedDiffEvent.messageId || messageId || null}
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
  changeSummary,
  messageId,
  sessionId,
  centralizedDiffEvent,
}: {
  structuredFileChanges: StructuredFileChange[];
  changeSummary?: Message["changeSummary"];
  messageId?: string | null;
  sessionId?: string | null;
  centralizedDiffEvent?: {
    id?: string;
    sessionId?: string;
    messageId?: string;
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
  // The SDK envelope that owns the summary/diff is the revert target. In
  // particular, rehydrated `info.summary.diffs` belong to the user message.
  const summaryMessageId = firstNonEmptyString(centralizedDiffEvent?.messageId, changeSummary?.messageId, messageId) || null;

  const compactDisplayDir = (dir: string): string => {
    const normalized = dir.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!normalized) return "";
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length <= 3) return normalized;
    return `.../${parts.slice(-3).join("/")}`;
  };

  const fileChanges = useMemo<FileChange[]>(() => {
    if (Array.isArray(changeSummary?.files) && changeSummary.files.length > 0) {
      return changeSummary.files
        .map((item) => ({
          file: item.file,
          added: Math.max(0, Number(item.added) || 0),
          deleted: Math.max(0, Number(item.deleted) || 0),
          diffExcerpt: item.diffExcerpt
            ? {
                ...item.diffExcerpt,
                lines: Array.isArray(item.diffExcerpt.lines)
                  ? item.diffExcerpt.lines.filter(
                      (line): line is string =>
                        typeof line === "string" && line.trim().length > 0,
                    )
                  : undefined,
              }
            : undefined,
        }))
        .sort((a, b) => a.file.localeCompare(b.file));
    }

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
  }, [changeSummary, structuredFileChanges, centralizedDiffEvent]);

  const filesChanged = fileChanges.length;
  const totalAdded = fileChanges.reduce((sum, file) => sum + file.added, 0);
  const totalDeleted = fileChanges.reduce((sum, file) => sum + file.deleted, 0);

  const undoMessageId = summaryMessageId;
  const [isUndoing, setIsUndoing] = useState(false);
  const [revertedMessageId, setRevertedMessageId] = useState<string | null>(null);
  const isReverted = !!revertedMessageId && !!undoMessageId && revertedMessageId === undoMessageId;

  const handleUndo = () => {
    if (!undoMessageId) {
      return;
    }
    setIsUndoing(true);
    vscode.postMessage({
      type: "undoMessageChanges",
      messageId: undoMessageId,
      sessionId: sessionId || undefined,
    });
  };

  const handleRestore = () => {
    vscode.postMessage({
      type: "unrevertSession",
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
            revertState?: { messageID?: string; partID?: string; snapshot?: string; diff?: string } | null;
          }
        | undefined;
      if (!data) {
        return;
      }
      if (data.type === "revertStateUpdate") {
        // Clear loading state regardless of outcome — revert either succeeded or failed.
        setIsUndoing(false);
        // Track which message was reverted so we can swap Undo → Restore inline.
        setRevertedMessageId(data.revertState?.messageID ?? null);
        return;
      }
      if (data.type !== "messageFileDiffPreview") {
        return;
      }
      if (summaryMessageId && data.messageId && data.messageId !== summaryMessageId) {
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
  }, [summaryMessageId]);

  const toggleExpanded = (file: string) => {
    const key = normalizePath(file);
    const hasLocalPreview = !!fetchedPreviewByFile[key];
    const current = fileChanges.find(
      (change) => normalizePath(change.file) === key,
    );
    const hasExistingPreview =
      !!current &&
      Array.isArray(current.diffExcerpt?.lines) &&
      current.diffExcerpt.lines.length > 0;
    if (!hasLocalPreview && !hasExistingPreview && summaryMessageId) {
      vscode.postMessage({
        type: "getMessageFileDiffPreview",
        messageId: summaryMessageId,
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
    <div className="overflow-hidden rounded-lg border border-oc-border bg-oc-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-oc-text-soft">
          <FileCode className="h-4 w-4 shrink-0 oc-readable-accent" />
          <span className="tracking-[0.01em] text-oc-text-soft">
            {filesChanged} {filesChanged === 1 ? "file" : "files"} changed
          </span>
          {(totalAdded > 0 || totalDeleted > 0) && (
            <DiffStats added={totalAdded} deleted={totalDeleted} />
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {isReverted ? (
            <button
              type="button"
              onClick={handleRestore}
              className="inline-flex items-center gap-1 rounded-md border border-oc-border bg-white/[0.025] px-2 py-1 text-[13px] oc-text-secondary transition-colors hover:border-oc-border-strong hover:bg-white/[0.05] hover:text-oc-text-soft"
              title="Restore reverted changes"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restore
            </button>
          ) : (
            <button
              type="button"
              onClick={handleUndo}
              disabled={!undoMessageId || isUndoing}
              className="inline-flex items-center gap-1 rounded-md border border-oc-border bg-white/[0.025] px-2 py-1 text-[13px] oc-text-secondary transition-colors hover:border-oc-border-strong hover:bg-white/[0.05] hover:text-oc-text-soft disabled:cursor-not-allowed disabled:opacity-40 disabled:pointer-events-none"
              title={
                undoMessageId
                  ? "Undo changes from this assistant message"
                  : "Undo unavailable: no message identifier for this change set"
              }
            >
              {isUndoing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Undo2 className="h-3.5 w-3.5" />
              )}
              {isUndoing ? "Undoing..." : "Undo"}
            </button>
          )}
          <button
            type="button"
            onClick={handleReview}
            className="inline-flex items-center gap-1 rounded-md border border-oc-border bg-white/[0.025] px-2 py-1 text-[13px] oc-text-secondary transition-colors hover:border-oc-border-strong hover:bg-white/[0.05] hover:text-oc-text-soft"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            Review
          </button>
        </div>
      </div>
      <div className="border-t border-oc-border max-h-[300px] overflow-y-auto">
        <div className="space-y-0.5 p-1">
          {fileChanges.map((fileChange) => {
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
                className="overflow-hidden rounded-sm transition-colors"
              >
                <div className="flex items-center justify-between px-2.5 py-1 hover:bg-white/[0.04] transition-colors">
                  <button
                    type="button"
                    className="group flex min-w-0 flex-1 items-center gap-1.5 text-left"
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
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                    <FileIcon filePath={fileChange.file} className="h-4 w-4 shrink-0" />
                    <span className="truncate text-[13px] text-oc-text-soft group-hover:text-oc-text transition-colors">{filename}</span>
                    {compactDirname && (
                      <span className="hidden truncate text-[11px] text-oc-text-soft sm:inline">
                        {compactDirname}
                      </span>
                    )}
                  </button>

                  <div className="flex flex-shrink-0 items-center gap-1.5 text-[13px]">
                    {fileChange.added > 0 && (
                      <span className="text-oc-green">+{fileChange.added}</span>
                    )}
                    {fileChange.deleted > 0 && (
                      <span className="text-oc-red">-{fileChange.deleted}</span>
                    )}
                  </div>
                </div>

                {isExpanded && hasPreview ? (
                  <div className="border-t border-oc-border bg-black/10 max-h-[300px] overflow-y-auto">
                    <ActivityDiffExcerpt
                      excerpt={{
                        header: previewExcerpt?.header,
                        lines: previewExcerpt?.lines || [],
                      }}
                    />
                  </div>
                ) : isExpanded && !hasPreview ? (
                  <div className="border-t border-oc-border px-2.5 py-1.5 text-[13px] text-oc-text-soft italic">
                    Diff preview unavailable for this file in the current payload.
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
});

function isStreamingForThisCard(
  streaming: StreamingState | undefined,
  messageId: string | undefined,
): boolean {
  return Boolean(
    streaming &&
    streaming.isActive !== false &&
    messageId &&
    streaming.messageId === messageId,
  );
}

function areResponseMessagePropsEqual(
  prevProps: Readonly<Parameters<typeof ResponseMessageInner>[0]>,
  nextProps: Readonly<Parameters<typeof ResponseMessageInner>[0]>,
): boolean {
  if (
    prevProps.message !== nextProps.message ||
    prevProps.hideLoadingText !== nextProps.hideLoadingText ||
    prevProps.isContiguous !== nextProps.isContiguous ||
    prevProps.interactiveEvents !== nextProps.interactiveEvents ||
    prevProps.messages?.length !== nextProps.messages?.length ||
    prevProps.currentSessionId !== nextProps.currentSessionId ||
    prevProps.hideFileChangesSection !== nextProps.hideFileChangesSection ||
    prevProps.subagentsByParentMessageId !== nextProps.subagentsByParentMessageId ||
    prevProps.subagentDetailsById !== nextProps.subagentDetailsById ||
    prevProps.todoItems !== nextProps.todoItems ||
    prevProps.blockGroupKey !== nextProps.blockGroupKey ||
    prevProps.isLastInBlock !== nextProps.isLastInBlock ||
    prevProps.isBlockExpanded !== nextProps.isBlockExpanded ||
    prevProps.isBlockStreaming !== nextProps.isBlockStreaming ||
    prevProps.isBlockHeaderAnchor !== nextProps.isBlockHeaderAnchor ||
    prevProps.blockSize !== nextProps.blockSize ||
    prevProps.isHiddenByBlock !== nextProps.isHiddenByBlock
  ) {
    return false;
  }

  // Skip streaming identity changes for non-streaming cards. Without this,
  // every stream batch forces EVERY mounted ResponseMessage to rerender.
  const prevMessageId = prevProps.message?.id ?? prevProps.message?.info?.id;
  const nextMessageId = nextProps.message?.id ?? nextProps.message?.info?.id;
  // The dedicated StreamingCard intentionally has no persisted message yet.
  // Treat that card as live by its streaming state, otherwise React.memo can
  // swallow every subsequent SSE update because there is no message id to
  // match against.
  const prevWasStreaming = prevProps.message
    ? isStreamingForThisCard(prevProps.streaming, prevMessageId)
    : Boolean(prevProps.streaming?.isActive);
  const nextIsStreaming = nextProps.message
    ? isStreamingForThisCard(nextProps.streaming, nextMessageId)
    : Boolean(nextProps.streaming?.isActive);
  if (prevWasStreaming || nextIsStreaming) {
    return prevProps.streaming === nextProps.streaming;
  }
  return true;
}

export const ResponseMessage = memo(function ResponseMessage({
  message,
  streaming,
  hideLoadingText,
  isContiguous,
  interactiveEvents,
  messages,
  currentSessionId,
  subagentsByParentMessageId,
  subagentDetailsById,
  todoItems,
  hideFileChangesSection,
  centralizedDiffEvent,
  blockGroupKey,
  isLastInBlock,
  isBlockExpanded,
  isBlockStreaming,
  isBlockHeaderAnchor,
  onSetBlockExpanded,
  blockSize,
  isHiddenByBlock,
  blockHasInlineAbort,
}: {
  message?: Message;
  streaming?: StreamingState;
  hideLoadingText?: boolean;
  isContiguous?: boolean;
  interactiveEvents?: AppState["interactiveEvents"];
  messages?: Message[];
  currentSessionId?: AppState["currentSessionId"];
  hideFileChangesSection?: boolean;
  centralizedDiffEvent?: CentralizedSessionDiffEvent;
  subagentsByParentMessageId?: AppState["subagentsByParentMessageId"];
  subagentDetailsById?: AppState["subagentDetailsById"];
  todoItems?: AppState["todoItems"];
  blockGroupKey?: string;
  isLastInBlock?: boolean;
  isBlockExpanded?: boolean;
  isBlockStreaming?: boolean;
  isBlockHeaderAnchor?: boolean;
  onSetBlockExpanded?: (expanded: boolean) => void;
  blockSize?: number;
  isHiddenByBlock?: boolean;
  blockHasInlineAbort?: boolean;
}) {
  return (
    <ResponseMessageInner
      message={message}
      streaming={streaming}
      hideLoadingText={hideLoadingText}
      isContiguous={isContiguous}
      interactiveEvents={interactiveEvents}
      messages={messages}
      currentSessionId={currentSessionId}
      hideFileChangesSection={hideFileChangesSection}
      centralizedDiffEvent={centralizedDiffEvent}
      subagentsByParentMessageId={subagentsByParentMessageId}
      subagentDetailsById={subagentDetailsById}
      todoItems={todoItems}
      blockGroupKey={blockGroupKey}
      isLastInBlock={isLastInBlock}
      isBlockExpanded={isBlockExpanded}
      isBlockStreaming={isBlockStreaming}
      isBlockHeaderAnchor={isBlockHeaderAnchor}
      onSetBlockExpanded={onSetBlockExpanded}
      blockSize={blockSize}
      isHiddenByBlock={isHiddenByBlock}
      blockHasInlineAbort={blockHasInlineAbort}
    />
  );
}, areResponseMessagePropsEqual);
export const PermissionCard = memo(function PermissionCard({ perm }: { perm: unknown }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const permission = (perm && typeof perm === "object" ? perm : {}) as Record<string, unknown>;
  const permissionID = asString(permission.permissionID) || asString(permission.id);
  const sessionID = asString(permission.sessionID) || asString(permission.sessionId);
  const permissionKind = asString(permission.permission) || "operation";
  const patterns = Array.isArray(permission.patterns)
    ? permission.patterns.filter((pattern): pattern is string => typeof pattern === "string")
    : [];
  const canAlwaysAllow = Array.isArray(permission.always) && permission.always.length > 0;

  const reply = (response: "once" | "always" | "reject") => {
    if (!permissionID || !sessionID || isSubmitting) return;
    setIsSubmitting(true);
    vscode.postMessage({ type: "permissionReply", sessionId: sessionID, permissionID, response });
  };

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
          Allow OpenCode to use <span className="font-medium text-oc-text">{permissionKind}</span>
          {patterns.length > 0 ? " for:" : "?"}
        </div>
        {patterns.length > 0 && (
          <div className="mt-2 rounded-md border border-[var(--oc-border)] bg-[var(--oc-bg)] px-2 py-1.5 font-mono text-oc-xs text-oc-text">
            {patterns.join("\n")}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isSubmitting || !permissionID || !sessionID}
            onClick={() => reply("once")}
            className="rounded-md bg-[var(--oc-accent)] px-2.5 py-1.5 text-oc-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Responding…" : "Allow"}
          </button>
          {canAlwaysAllow && (
            <button
              type="button"
              disabled={isSubmitting || !permissionID || !sessionID}
              onClick={() => reply("always")}
              className="rounded-md border border-[var(--oc-border)] px-2.5 py-1.5 text-oc-xs font-medium text-oc-text-soft hover:bg-[var(--oc-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Always allow
            </button>
          )}
          <button
            type="button"
            disabled={isSubmitting || !permissionID || !sessionID}
            onClick={() => reply("reject")}
            className="rounded-md px-2.5 py-1.5 text-oc-xs font-medium text-oc-red hover:bg-[var(--oc-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
});

export function ErrorBanner({
  message,
}: {
  message: string;
}) {
  const errorDetails =
    typeof message === "string" && message.trim().length > 0
      ? message.trim()
      : "Unknown error";

  return (
    <div className="mb-2">
      <div className="oc-error">
        <div className="oc-error-content">
          <span className="oc-error-icon">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          </span>
          <div className="oc-error-copy">
            <span className="oc-error-title">Request failed</span>
            <span className="oc-error-separator" aria-hidden="true" />
            <p className="oc-error-message">
              {errorDetails}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}


interface InfoBannerProps {
  message?: string;
  error?: DisplayError;
}

export function InfoBanner({ message, error }: InfoBannerProps) {
  // Error data can arrive through the typed display-error path or the legacy
  // message.error path. Both use the same display-only error card.
  if (error) {
    return <ErrorBanner message={error.message} />;
  }

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

  if (message) {
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

export const ThinkingBubble = memo(function ThinkingBubble({
  hidden = false,
}: {
  /** Keep the layout slot during a brief stream-state gap without showing text. */
  hidden?: boolean;
}) {
  return (
    <div
      // Keep the placeholder to one compact line.  The previous `mb-4` plus
      // `min-h-[32px]` reserved nearly 48px, which became a conspicuous gap
      // when a timeline step collapsed or a stream briefly reported idle.
      className={cn(
        hidden ? "h-5 min-h-0 mb-0" : "min-h-5 mb-2",
        hidden && "invisible",
      )}
      aria-hidden={hidden || undefined}
    >
      <div className="inline-flex h-5 items-center text-[11px] font-medium text-oc-text-soft">
        <AIStatusTicker />
      </div>
    </div>
  );
});

export const EmptyState = memo(function EmptyState({
  serverStatus,
  serverError,
  receivedInitState,
  currentSessionId,
}: {
  serverStatus: AppState["serverStatus"];
  serverError?: string;
  receivedInitState: AppState["receivedInitState"];
  currentSessionId: AppState["currentSessionId"];
}) {
  const iconUri =
    typeof document !== "undefined"
      ? document.getElementById("root")?.dataset.opencodeIconUri
      : undefined;

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

export const SessionUnavailableState = memo(function SessionUnavailableState({
  error,
}: {
  error: NonNullable<AppState["sessionLoadError"]>;
}) {
  const dispatch = useAppDispatch();
  const isNotFound = error.reason === "not_found";

  return (
    <div className="flex min-h-[320px] h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-[520px] border-l-2 border-[var(--vscode-errorForeground)] pl-5 sm:pl-6">
        <div className="mb-3 flex items-center gap-2 text-[var(--vscode-errorForeground)]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">
            Session unavailable
          </span>
        </div>
        <h2 className="text-lg font-semibold tracking-tight text-oc-text">
          {isNotFound ? "Session not found" : "Couldn’t load this session"}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-oc-text-soft">
          {error.message} It may have been removed or created in a different workspace or server data directory.
        </p>
        <code className="mt-3 block break-all text-[11px] text-oc-text-soft opacity-75">
          {error.sessionId}
        </code>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => dispatch({ type: "SET_SESSION_MODAL_OPEN", payload: true })}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-oc-border bg-oc-panel px-3 text-xs font-medium text-oc-text transition-colors hover:border-oc-border-strong hover:bg-oc-panel-hover"
          >
            <History className="h-3.5 w-3.5" />
            Choose another session
          </button>
          <button
            type="button"
            onClick={() => vscode.postMessage({ type: "newSession" })}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-oc-accent px-3 text-xs font-medium text-[var(--vscode-button-foreground)] transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            New session
          </button>
        </div>
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

export const SdkEventDebugPanel = memo(function SdkEventDebugPanel() {
  if (!config.debug.showSdkEventDebug) {
    return null;
  }
  return <SdkEventDebugPanelContents />;
});

const SdkEventDebugPanelContents = memo(function SdkEventDebugPanelContents() {
  const [copiedDebugPanel, setCopiedDebugPanel] = useState(false);
  const [showRawDebugData, setShowRawDebugData] = useState(false);
  const sessionId = useAppState((state) => state.currentSessionId);
  const { rehydratedSdkMessages, liveEvents } = useSyncExternalStore(
    subscribeToSdkDebugStore,
    () => getSdkDebugSnapshot(sessionId),
    () => getSdkDebugSnapshot(sessionId),
  );
  const debugData = {
    sessionId,
    rehydratedSdkMessages,
    liveEvents,
  };
  const visibleSdkMessages = useMemo(
    () => rehydratedSdkMessages.slice(-50),
    [rehydratedSdkMessages],
  );
  const visibleLiveEvents = useMemo(
    () => liveEvents.slice(-100),
    [liveEvents],
  );
  const visibleDebugJson = useMemo(
    () =>
      showRawDebugData
        ? JSON.stringify(
            {
              sessionId,
              rehydratedSdkMessages: visibleSdkMessages,
              liveEvents: visibleLiveEvents,
              displayWindow: {
                sdkMessages: `${visibleSdkMessages.length}/${rehydratedSdkMessages.length}`,
                liveEvents: `${visibleLiveEvents.length}/${liveEvents.length}`,
              },
            },
            null,
            2,
          )
        : "",
    [
      liveEvents.length,
      rehydratedSdkMessages.length,
      sessionId,
      showRawDebugData,
      visibleLiveEvents,
      visibleSdkMessages,
    ],
  );

  return (
    <div className="mx-4 my-2 rounded-md border border-oc-border bg-oc-panel overflow-hidden text-[10px] font-mono">
      <div className="flex items-center justify-between bg-oc-panel-hover px-2 py-1 border-b border-oc-border">
        <span className="font-semibold text-oc-text">
          SDK Events (Debug) · {rehydratedSdkMessages.length} messages · {liveEvents.length} live
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRawDebugData((visible) => !visible)}
            className="text-oc-text-muted hover:text-oc-text"
          >
            {showRawDebugData ? "Hide" : "Show recent"}
          </button>
          <button
            type="button"
            onClick={() => {
              // Full serialization is intentionally user-triggered. Performing
              // it during every streaming render was the main-thread freeze.
              void copyToClipboard(JSON.stringify(debugData, null, 2)).then(() => {
                setCopiedDebugPanel(true);
                setTimeout(() => setCopiedDebugPanel(false), 2000);
              }).catch(() => {
                // Clipboard failures are expected in unfocused VS Code webviews.
              });
            }}
            className="text-oc-text-muted hover:text-oc-text"
          >
            {copiedDebugPanel ? "Copied!" : "Copy all"}
          </button>
        </div>
      </div>
      {showRawDebugData ? (
        <div className="p-2 max-h-48 overflow-y-auto text-oc-text-muted">
          <pre>{visibleDebugJson}</pre>
        </div>
      ) : null}
    </div>
  );
});
