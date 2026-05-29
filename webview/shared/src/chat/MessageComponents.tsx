import {
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type CSSProperties,
} from "react";
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
  Zap,
  AlertCircle,
  AlertTriangle,
  Clock,
  HelpCircle,
  Info,
  FileCode,
  ArrowUpRight,
  Undo2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Stepper, StepperItem } from "@/components/ui/stepper";
import { TerminalBlock } from "@/components/ui/TerminalBlock";
import { SearchBlock } from "@/components/ui/SearchBlock";
import { ExpandableStep } from "@/components/ui/ExpandableStep";
import { StepIndicator } from "@/components/ui/StepIndicator";
import { cn, formatDuration, toWorkspaceRelativePath } from "@/utils";

import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { ActivityDiffExcerpt } from "./components/ActivityDiffExcerpt";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { SubagentDetailModal } from "./SubagentDetailModal";
import { DiffStats } from "./DiffStats";
import { asString } from "./lib/messageHandler";

import type {
  ActivityDetail,
  AppState,
  InteractiveEvent,
  Message,
  MessagePart,
  MessageStep,
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

function isRenderableAssistantTextPart(part: MessagePart): boolean {
  if (isReasoningPart(part)) {
    return false;
  }
  const type = (part.type ?? "").toLowerCase();
  if (!type) {
    return true;
  }
  return type === "text" || type === "message" || type === "output_text";
}

function isStructuredOutputFailureMessage(value?: string): boolean {
  const normalized = (value || "").trim().toLowerCase();
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

const SEARCH_LABELS = new Set(["grep", "search", "glob", "ripgrep", "ast-grep", "find"]);

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

  return <TerminalBlock command={command} output={output} />;
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
        return;
      }

      if (filePath && !useGenericFileIcon) {
        setUseGenericFileIcon(true);
        return;
      }

      setShowSvgFallback(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [filePath, iconKeys.join("|"), useGenericFileIcon]);

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

function messageBodyFromParts(parts?: MessagePart[]): string {
  if (!parts) {
    return "";
  }
  return parts
    .map((part) => {
      if (!isRenderableAssistantTextPart(part)) {
        return "";
      }
      return part.message ?? part.text ?? part.content ?? "";
    })
    .join("")
    .trim();
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
    message.messageId,
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

function normalizeComparableText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim().toLowerCase();
}

function messageDisplaysSameErrorText(
  message: Message | undefined,
  value: string,
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
  value: string,
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

function looksLikeReasoningPlanningText(value: string): boolean {
  const normalized = normalizeComparableText(value);
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith("let me ") ||
    normalized.startsWith("i should ") ||
    normalized.startsWith("i need to ") ||
    normalized.startsWith("i will ") ||
    normalized.startsWith("the user wants ") ||
    normalized.startsWith("the user asked ")
  );
}

function isReasoningLeakCandidate(
  value: string,
  source: "parts" | "structured" | "content" | "text" | "summary",
  message?: Message,
  hasRenderableParts?: boolean,
): boolean {
  if (!value.trim()) {
    return false;
  }
  if (source !== "content" && source !== "text") {
    return false;
  }
  if (hasRenderableParts) {
    return false;
  }
  const candidateNorm = normalizeComparableText(value);
  if (!candidateNorm) {
    return false;
  }

  const reasoningFingerprints = collectReasoningFingerprints(message);
  for (const reasoningNorm of reasoningFingerprints) {
    if (!reasoningNorm) continue;
    if (candidateNorm === reasoningNorm) {
      return true;
    }
    if (
      candidateNorm.length < 220 &&
      (candidateNorm.includes(reasoningNorm) ||
        reasoningNorm.includes(candidateNorm))
    ) {
      return true;
    }
  }

  return reasoningFingerprints.size > 0 && looksLikeReasoningPlanningText(value);
}

function isLowValueInteractiveBodyText(value: string): boolean {
  const normalized = normalizeComparableText(value);
  if (!normalized) {
    return true;
  }
  return (
    normalized === "running question" ||
    normalized === "question" ||
    normalized === "question for you" ||
    normalized === "quick input" ||
    normalized === "wants" ||
    normalized === "want" ||
    normalized === "wants to" ||
    normalized === "ask" ||
    normalized === "asks" ||
    normalized === "asking" ||
    normalized === "awaiting your answer" ||
    normalized === "awaiting your response" ||
    normalized === "waiting for your answer" ||
    normalized === "waiting for your response"
  );
}

function formatQuestionPromptForAssistant(
  prompt: string,
  kind: "question" | "confirm" | "message" | "quick_actions" = "question",
): string {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed;
}

function questionPromptFromMessage(message?: Message): string | undefined {
  if (!message) {
    return undefined;
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

  // displayPrompt is the primary source-of-truth for question chat bubble text.
  const explicitDisplayPrompt = firstNonEmptyString(
    question?.displayPrompt,
    question?.assistantPrompt,
    question?.responseMessage,
  );
  if (explicitDisplayPrompt) {
    return explicitDisplayPrompt;
  }

  if (question) {
    const questionType = firstNonEmptyString(question.type)?.toLowerCase();
    if (questionType === "message") {
      return firstNonEmptyString(
        question.message,
        question.content,
        question.question,
        question.title,
      );
    }
    if (questionType === "quick_actions" || questionType === "quick-actions") {
      const prompt = firstNonEmptyString(
        question.question,
        question.title,
        question.message,
        question.content,
      );
      return prompt
        ? formatQuestionPromptForAssistant(prompt, "quick_actions")
        : undefined;
    }
    const prompt = firstNonEmptyString(
      question.question,
      question.message,
      question.content,
      question.title,
    );
    if (prompt) {
      return formatQuestionPromptForAssistant(
        prompt,
        questionType === "confirm" ? "confirm" : "question",
      );
    }
  }

  if (Array.isArray(message.interactiveEvents)) {
    for (const event of message.interactiveEvents) {
      if (event.type === "question" || event.type === "confirm") {
        const prompt = firstNonEmptyString(event.question, event.title);
        if (prompt) {
          return formatQuestionPromptForAssistant(prompt, event.type);
        }
      }
      if (event.type === "message") {
        const prompt = firstNonEmptyString(event.message, event.title);
        if (prompt) {
          return prompt;
        }
      }
      if (event.type === "quick_actions") {
        const prompt = firstNonEmptyString(event.title);
        if (prompt) {
          return formatQuestionPromptForAssistant(prompt, "quick_actions");
        }
      }
    }
  }
  return undefined;
}

function questionPromptFromInteractiveEvents(
  events?: InteractiveEvent[],
): string | undefined {
  if (!Array.isArray(events) || events.length === 0) {
    return undefined;
  }

  for (const event of events) {
    if (event.type === "question" || event.type === "confirm") {
      const prompt = firstNonEmptyString(
        event.contextMessage,
        event.question,
        event.title,
      );
      if (prompt) {
        return formatQuestionPromptForAssistant(prompt, event.type);
      }
      continue;
    }
    if (event.type === "message") {
      const prompt = firstNonEmptyString(
        event.contextMessage,
        event.message,
        event.title,
      );
      if (prompt) {
        return prompt;
      }
      continue;
    }
    if (event.type === "quick_actions") {
      const prompt = firstNonEmptyString(event.contextMessage, event.title);
      if (prompt) {
        return formatQuestionPromptForAssistant(prompt, "quick_actions");
      }
    }
  }

  return undefined;
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

function hasPendingStreamingSteps(streaming: StreamingState): boolean {
  if (Array.isArray(streaming.steps)) {
    return streaming.steps.some((step) => step.status === "pending");
  }
  if (Array.isArray(streaming.progressEvents)) {
    return streaming.progressEvents.some((step) => step.status === "pending");
  }
  return false;
}

function getMessageContent(
  message?: Message,
  streaming?: StreamingState,
): string {
  if (streaming) {
    // Filter out reasoning content from streaming content as a safety measure
    // This catches any reasoning that leaked through the event handler
    const content = streaming.content || '';
    const hasRenderableContent = streaming.hasRenderableContent === true;
    const hasReasoningEvents = streaming.reasoningEvents && streaming.reasoningEvents.length > 0;
    const isInReasoningPart = streaming.inReasoningPart || false;

    // NOTE: When streaming is no longer active (isActive === false), FINISH_STREAMING has already
    // fired — this happens when a blocking interactive event (e.g. question) is detected mid-stream.
    // At that point, streaming.content holds the final AI response text (e.g. "I have a few
    // questions:"). We must NOT discard it based on length — it is the correct final content.
    // Only apply the reasoning filter while the stream is still actively flowing.
    const streamingFinished = !streaming.isActive;

    if (isInReasoningPart) {
      return '';
    }

    if (!hasRenderableContent) {
      return '';
    }

    // CRITICAL: If reasoning events are active and streaming is in progress,
    // completely block content from going to the AI final response component.
    // This prevents reasoning text from appearing in the main chat bubble.
    // Reasoning should only appear in the activity timeline, not in the response body.
    if (streaming.isActive && hasReasoningEvents) {
      return '';
    }

    // Prevent reasoning data from leaking into the AI final response body
    // when activity steps are still in progress. Content should only render
    // once all steps complete, avoiding raw reasoning text appearing as
    // final assistant output.
    if (streaming.isActive && hasPendingStreamingSteps(streaming)) {
      return '';
    }

    return content;
  }

  if (!message) {
    return "";
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
  const responseType = firstNonEmptyString(message?.responseType, structured?.responseType)?.toLowerCase();
  const partsBody = messageBodyFromParts(message.parts);
  const hasParts = Array.isArray(message.parts) && message.parts.length > 0;
  const hasRenderableParts =
    Array.isArray(message.parts) &&
    message.parts.some((part) => isRenderableAssistantTextPart(part));
  const isMessageResponseType = responseType === "message";
  const structuredMessage = firstNonEmptyString(structured?.message);
  const candidates: Array<{
    source: "parts" | "structured" | "content" | "text" | "summary";
    value: string | undefined;
  }> = hasParts
      ? [
        { source: "parts", value: partsBody },
        { source: "structured", value: isMessageResponseType ? structuredMessage : "" },
        { source: "summary", value: summaryText(message) },
      ]
      : [
        { source: "parts", value: partsBody },
        { source: "content", value: message.content },
        { source: "text", value: message.text },
        { source: "summary", value: summaryText(message) },
      ];
  const selectedCandidate = candidates.find((candidate) => {
    if (typeof candidate.value !== "string" || candidate.value.trim().length === 0) {
      return false;
    }
    return !isReasoningLeakCandidate(
      candidate.value,
      candidate.source,
      message,
      hasRenderableParts,
    );
  });
  const baseContent = selectedCandidate?.value ?? "";
  const safeBaseContent = baseContent;
  const questionPrompt = questionPromptFromMessage(message);
  if (!questionPrompt) {
    return safeBaseContent;
  }
  const isQuestionResponseType = responseType === "question";
  const hasInteractiveEvents = Array.isArray(message.interactiveEvents) && message.interactiveEvents.length > 0;
  if (isMessageResponseType) {
    if (structuredMessage) {
      return structuredMessage;
    }
  }
  if (!isQuestionResponseType && !hasInteractiveEvents) {
    return safeBaseContent;
  }

  // For explicit question turns, render only the canonical question prompt in the
  // assistant bubble (no assistantMessage/body concatenation).
  if (isQuestionResponseType) {
    return questionPrompt;
  }

  if (!safeBaseContent || isLowValueInteractiveBodyText(safeBaseContent)) {
    return questionPrompt;
  }

  const promptNorm = normalizeComparableText(questionPrompt);
  const bodyNorm = normalizeComparableText(safeBaseContent);
  if (!promptNorm || bodyNorm === promptNorm) {
    return questionPrompt;
  }
  if (bodyNorm.startsWith(promptNorm)) {
    return safeBaseContent;
  }
  return `${questionPrompt}\n\n${safeBaseContent}`;
}

type RawDebugParseStatus = "parsed" | "empty" | "unparseable" | "truncated";

type ParsedRawDebugForUi = {
  status: RawDebugParseStatus;
  parts: Array<Record<string, unknown>>;
};

function parseRawResponseDebugForUi(raw: unknown): ParsedRawDebugForUi {
  if (typeof raw === "undefined" || raw === null) {
    return { status: "empty", parts: [] };
  }
  if (typeof raw === "object") {
    const rec = asRecord(raw);
    const parts = Array.isArray(rec?.parts)
      ? rec.parts
        .map((part) => asRecord(part))
        .filter((part): part is Record<string, unknown> => !!part)
      : [];
    return { status: "parsed", parts };
  }
  if (typeof raw !== "string") {
    return { status: "unparseable", parts: [] };
  }
  const text = raw.trim();
  if (!text) {
    return { status: "empty", parts: [] };
  }
  const truncMatch = text.match(/\.\.\.<truncated\s+\d+\s+chars>\s*$/i);
  const candidate = truncMatch ? text.slice(0, truncMatch.index).trim() : text;
  try {
    const parsed = JSON.parse(candidate);
    const rec = asRecord(parsed);
    const parts = Array.isArray(rec?.parts)
      ? rec.parts
        .map((part) => asRecord(part))
        .filter((part): part is Record<string, unknown> => !!part)
      : [];
    return { status: truncMatch ? "truncated" : "parsed", parts };
  } catch {
    return { status: truncMatch ? "truncated" : "unparseable", parts: [] };
  }
}

type ThoughtItem = { key: string; text: string };
type ProgressItem = {
  key: string;
  mergeKey: string;
  id?: string;
  callID?: string;
  title: string;
  status: "pending" | "done" | "error";
  source?: "stream" | "final" | "raw_debug";
  partType?: string;
  internal?: boolean;
  meta?: string;
  filePath?: string;
  diffStats?: { added: number; deleted: number };
  activityDetail?: ActivityDetail;
  /** Arrival-order sequence number from StreamingStep.streamSeq or MessageStep.streamSeq */
  streamSeq?: number;
};

type ThinkingBlock = { kind: "thinking"; items: ThoughtItem[] };
type StepsBlock = { kind: "steps"; items: ProgressItem[] };
type ContentBlock = { kind: "content"; html: string };
type TimelineBlock = ThinkingBlock | StepsBlock | ContentBlock;

/**
 * Extracts the Date.now() timestamp embedded in a thought-item key.
 * Handles both streaming keys ("stream-{idx}-{createdAt}") and
 * persisted reasoningEvent keys ("evt-{createdAt}").
 * Returns 0 for parts-based keys ("part-{idx}") that have no timestamp.
 */
function seqFromThoughtKey(key: string): number {
  const evtMatch = key.match(/^evt-(\d+)$/);
  if (evtMatch) return parseInt(evtMatch[1], 10);
  const streamMatch = key.match(/stream-\d+-(\d+)/);
  if (streamMatch) return parseInt(streamMatch[1], 10);
  return 0;
}

function thoughtItemsFromMessage(message?: Message): ThoughtItem[] {
  const items: ThoughtItem[] = [];
  const seen = new Set<string>();
  const pushUnique = (key: string, text: string) => {
    const cleaned = text.trim();
    if (!cleaned) return;
    const fp = normalizeComparableText(cleaned);
    if (!fp || seen.has(fp)) return;
    seen.add(fp);
    items.push({ key, text: cleaned });
  };

  if (Array.isArray(message?.reasoningPayload?.events)) {
    message.reasoningPayload.events.forEach((event, index) => {
      pushUnique(`evt-${event.createdAt}-${index}`, event.text || "");
    });
  }

  if (Array.isArray(message?.reasoningEvents)) {
    message.reasoningEvents.forEach((event: ReasoningEvent, index: number) => {
      pushUnique(`evt-${event.createdAt}-${index}`, event.text || "");
    });
  }

  if (items.length > 0) {
    return items;
  }

  // Do not derive visible thinking text from raw reasoning parts.
  // Some providers include internal instruction/planning traces there.
  return [];
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

  // Avoid showing raw streaming reasoning fallback text in the UI timeline.
  return [];
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

  // Filter out empty step-start and step-finish bookkeeping, but keep rows that
  // carry file/diff/activity detail because they are the only visible evidence
  // for some background edits.
  if (
    !hasUserFacingActivity &&
    (normalizedPartType === "step-start" ||
      normalizedPartType === "step-finish" ||
      type === "step-start" ||
      type === "step-finish")
  ) {
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
          title,
          status,
          source: stepSource,
          partType: stepPartType,
          internal: stepInternal,
          meta,
          filePath: stepFilePath,
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

function progressItemsFromMessage(message?: Message): ProgressItem[] {
  if (!message) {
    return [];
  }
  let items: ProgressItem[] = [];
  if (Array.isArray(message.steps) && message.steps.length > 0) {
    items = progressItemsFromSteps(message.steps, "msg-steps");
  } else if (
    Array.isArray(message.progressEvents) &&
    message.progressEvents.length > 0
  ) {
    items = progressItemsFromSteps(
      message.progressEvents,
      "msg-progress-events",
    );
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
  if (Array.isArray(streaming.steps) && streaming.steps.length > 0) {
    return progressItemsFromSteps(streaming.steps, "stream-steps");
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
  return [];
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
      className="mt-1 mb-1 overflow-hidden rounded-md border border-oc-border bg-oc-panel-soft"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 border-b border-oc-border-soft px-2.5 py-2 text-left hover:bg-oc-panel"
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
        <div
          className="max-h-[320px] space-y-1.5 overflow-y-auto p-2.5"
          style={{ scrollPaddingBottom: "0.5rem" }}
        >
          <div className="text-[10px] uppercase tracking-wider oc-text-secondary">
            {inProgressCount} in progress
            {latest ? ` · Latest: "${truncateTodoLabel(latest.text)}"` : ""}
          </div>
          {sorted.map((todo) => {
            const isDone = todo.status === "completed";
            return (
              <div
                key={todo.id}
                className="flex items-start gap-2 rounded-md border border-oc-border bg-oc-bg-soft px-2 py-1.5 text-xs"
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
                    {todo.description ?? todo.text ?? "Untitled task"}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
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
      )}
    </section>
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
  return sanitizeUserContent(withoutGenericFenceEcho);
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

function planFileFromMessageForComparison(message?: Message): string {
  const direct = message?.plan?.file;
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }
  const structured = (message as unknown as Record<string, unknown> | undefined)
    ?.structuredOutput as Record<string, unknown> | undefined;
  const structuredPlan = structured?.plan as Record<string, unknown> | undefined;
  const structuredFile = structuredPlan?.file;
  return typeof structuredFile === "string" ? structuredFile : "";
}

function planRenderRichness(plan?: Message["plan"]): number {
  if (!plan) {
    return 0;
  }
  let score = 0;
  if (typeof plan.file === "string" && plan.file.trim()) {
    score += plan.file.includes("/") || plan.file.includes("\\") ? 20 : 10;
    score += Math.min(plan.file.length, 120);
  }
  if (typeof plan.title === "string" && plan.title.trim()) {
    score += Math.min(plan.title.length, 80);
  }
  if (typeof plan.summary === "string" && plan.summary.trim()) {
    score += 20;
  }
  if (typeof plan.content === "string" && plan.content.trim()) {
    score += 30;
  }
  return score;
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

function fileChangePathsFromMessage(message?: Message): Set<string> {
  const files = new Set<string>();
  if (!message) {
    return files;
  }

  if (Array.isArray(message.edits)) {
    for (const edit of message.edits) {
      const normalized = normalizeFileChangePathForComparison(edit?.file);
      if (normalized) {
        files.add(normalized);
      }
    }
  }

  const summaryFiles = Array.isArray(message.changeSummary?.files)
    ? message.changeSummary.files
    : [];
  for (const file of summaryFiles) {
    const normalized = normalizeFileChangePathForComparison(file?.file);
    if (normalized) {
      files.add(normalized);
    }
  }

  for (const item of structuredFileChangesFromMessage(message)) {
    const normalized = normalizeFileChangePathForComparison(item.file);
    if (normalized) {
      files.add(normalized);
    }
  }

  return files;
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

function fileChangeRenderRichness(message?: Message): number {
  if (!message) {
    return 0;
  }
  const files = fileChangePathsFromMessage(message);
  const summaryFiles = message.changeSummary?.files ?? [];
  const statsScore =
    typeof message.changeSummary?.added === "number" ||
      typeof message.changeSummary?.deleted === "number"
      ? 20
      : 0;
  const perFileStats = summaryFiles.filter(
    (file) =>
      typeof file?.added === "number" ||
      typeof file?.deleted === "number" ||
      Array.isArray(file?.diffExcerpt?.lines),
  ).length;
  return files.size * 10 + summaryFiles.length * 4 + perFileStats * 3 + statsScore;
}

function normalizeStructuredFileChanges(
  value: unknown,
): StructuredFileChange[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      const rec = asRecord(item);
      if (!rec) return null;
      const file = asString(rec.file).trim();
      if (!file) return null;
      const diffStatsRec = asRecord(rec.diffStats);
      const diffExcerptRec = asRecord(rec.diffExcerpt);
      const kind = asString(rec.kind).trim();
      const normalizedKind =
        kind === "file_edit" ||
        kind === "file_create" ||
        kind === "file_delete" ||
        kind === "file_move" ||
        kind === "other"
          ? kind
          : undefined;
      return {
        file,
        kind: normalizedKind,
        diffStats: diffStatsRec
          ? {
              added:
                typeof diffStatsRec.added === "number"
                  ? diffStatsRec.added
                  : undefined,
              deleted:
                typeof diffStatsRec.deleted === "number"
                  ? diffStatsRec.deleted
                  : undefined,
            }
          : undefined,
        diffExcerpt: diffExcerptRec
          ? {
              header:
                typeof diffExcerptRec.header === "string"
                  ? diffExcerptRec.header
                  : undefined,
              lines: Array.isArray(diffExcerptRec.lines)
                ? diffExcerptRec.lines.filter(
                    (line): line is string => typeof line === "string",
                  )
                : undefined,
              added:
                typeof diffExcerptRec.added === "number"
                  ? diffExcerptRec.added
                  : undefined,
              deleted:
                typeof diffExcerptRec.deleted === "number"
                  ? diffExcerptRec.deleted
                  : undefined,
            }
          : undefined,
      } satisfies StructuredFileChange;
    })
    .filter((item): item is StructuredFileChange => item !== null);
}

function structuredFileChangesFromMessage(message?: Message): StructuredFileChange[] {
  if (!message) {
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
    const truncMatch = text.match(/\.\.\.<truncated\s+\d+\s+chars>\s*$/i);
    const candidate = truncMatch ? text.slice(0, truncMatch.index).trim() : text;
    try {
      return asRecord(JSON.parse(candidate));
    } catch {
      return null;
    }
  };
  const messageRec = asRecord(message);
  const infoRec = asRecord(messageRec?.info);
  const structured =
    asRecord(messageRec?.structuredOutput) ||
    asRecord(messageRec?.structured_output) ||
    asRecord(messageRec?.structured) ||
    asRecord(infoRec?.structuredOutput) ||
    asRecord(infoRec?.structured_output) ||
    asRecord(infoRec?.structured);
  const direct = normalizeStructuredFileChanges(structured?.fileChanges);
  if (direct.length > 0) {
    if (config.debug.showRawResponse) {
      console.debug("[DIFF PREVIEW] source=message/info structured", {
        messageId: message.info?.id || message.id,
        count: direct.length,
      });
    }
    return direct;
  }

  const rawResponseRec = parseRawResponseRecord(messageRec?.rawResponse);
  const rawInfoRec = asRecord(rawResponseRec?.info);
  const rawStructured =
    asRecord(rawInfoRec?.structuredOutput) ||
    asRecord(rawInfoRec?.structured_output) ||
    asRecord(rawInfoRec?.structured);
  const fromRawStructured = normalizeStructuredFileChanges(rawStructured?.fileChanges);
  if (fromRawStructured.length > 0) {
    if (config.debug.showRawResponse) {
      console.debug("[DIFF PREVIEW] source=rawResponse.info.structured", {
        messageId: message.info?.id || message.id,
        count: fromRawStructured.length,
        rawResponseType: typeof messageRec?.rawResponse,
      });
    }
    return fromRawStructured;
  }

  const rawParts = Array.isArray(rawResponseRec?.parts) ? rawResponseRec.parts : [];
  for (const part of rawParts) {
    const partRec = asRecord(part);
    if (!partRec) {
      continue;
    }
    const toolName = asString(partRec.tool).toLowerCase();
    if (toolName !== "structuredoutput" && toolName !== "structured_output") {
      continue;
    }
    const stateRec = asRecord(partRec.state);
    const inputRec = asRecord(stateRec?.input);
    const fromToolInput = normalizeStructuredFileChanges(inputRec?.fileChanges);
    if (fromToolInput.length > 0) {
      if (config.debug.showRawResponse) {
        console.debug("[DIFF PREVIEW] source=rawResponse.parts[].StructuredOutput.input", {
          messageId: message.info?.id || message.id,
          count: fromToolInput.length,
        });
      }
      return fromToolInput;
    }
  }

  if (config.debug.showRawResponse) {
    console.debug("[DIFF PREVIEW] source=none", {
      messageId: message.info?.id || message.id,
      hasStructuredOutput: !!asRecord(messageRec?.structuredOutput),
      hasInfoStructured: !!asRecord(infoRec?.structured),
      rawResponseType: typeof messageRec?.rawResponse,
      rawHasInfoStructured: !!rawStructured,
      rawPartsCount: rawParts.length,
    });
  }
  return [];
}

function messageHasOwnFileChangeEvidence(message?: Message): boolean {
  if (!message) {
    return false;
  }

  if (Array.isArray(message.edits) && message.edits.length > 0) {
    return true;
  }

  if (structuredFileChangesFromMessage(message).length > 0) {
    return true;
  }

  const hasDiffStats = (value: unknown): boolean => {
    const rec = asRecord(value);
    return Boolean(
      rec &&
      (typeof rec.added === "number" ||
        typeof rec.deleted === "number" ||
        typeof rec.additions === "number" ||
        typeof rec.deletions === "number"),
    );
  };

  const hasActivityEvidence = (value: unknown): boolean => {
    const rec = asRecord(value);
    if (!rec) {
      return false;
    }
    const activityDetail = asRecord(rec.activityDetail);
    const tool = firstNonEmptyString(
      rec.tool,
      rec.name,
      activityDetail?.tool,
    )?.toLowerCase();
    return Boolean(
      firstNonEmptyString(rec.file, rec.filePath, rec.path, activityDetail?.file) ||
      hasDiffStats(rec.diffStats) ||
      hasDiffStats(activityDetail?.diffStats) ||
      asRecord(activityDetail?.diffExcerpt) ||
      firstNonEmptyString(rec.type, rec.partType)?.toLowerCase() === "patch" ||
      tool?.includes("write") ||
      tool?.includes("edit") ||
      tool?.includes("replace"),
    );
  };

  return [message.steps, message.progressEvents, message.parts].some(
    (items) => Array.isArray(items) && items.some(hasActivityEvidence),
  );
}

function messageOwnsChangeSummary(
  message: Message | undefined,
  messageId: string | undefined,
  changeSummary: Message["changeSummary"],
): boolean {
  if (
    !message ||
    !changeSummary ||
    !Array.isArray(changeSummary.files) ||
    changeSummary.files.length === 0
  ) {
    return false;
  }

  const summaryMessageId =
    typeof changeSummary.messageId === "string"
      ? changeSummary.messageId.trim()
      : "";
  if (!summaryMessageId) {
    return false;
  }

  const info = message.info;
  const ownerIds = [
    messageId,
    message.id,
    message.messageId,
    info?.id,
    info?.messageId,
  ].filter((id): id is string => typeof id === "string" && id.trim().length > 0);

  return ownerIds.some((id) => id.trim() === summaryMessageId);
}

/**
 * Single source of truth for building the Activity timeline.
 *
 * Used for BOTH streaming and completed (persisted) messages. The timeline is
 * built by sorting thoughtItems (by createdAt timestamp from their key) and
 * progressItems (by streamSeq) into arrival order, then grouping consecutive
 * same-kind entries so all steps merge into one StepsBlock and all thinking
 * items merge into one ThinkingBlock.
 *
 * Falls back to a parts-based layout for server-loaded messages where timing
 * data is absent (no streamSeq on steps, no createdAt on thoughts).
 */
function buildTimeline(
  thoughtItems: ThoughtItem[],
  progressItems: ProgressItem[],
  html: string,
  /** Only used for the parts-based fallback path; null during streaming */
  messageParts?: MessagePart[],
): TimelineBlock[] {
  // Check if we have any timing data for sorted interleaving.
  const hasTimedThoughts = thoughtItems.some(
    (t) => seqFromThoughtKey(t.key) > 0,
  );
  const hasTimedSteps = progressItems.some((p) => p.streamSeq != null);

  if (hasTimedThoughts || hasTimedSteps || progressItems.length > 0) {
    type RawEntry =
      | { seq: number; kind: "thinking"; item: ThoughtItem }
      | { seq: number; kind: "step"; item: ProgressItem }
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
): TimelineBlock[] {
  return buildTimeline(
    thoughtItemsFromMessage(message),
    progressItemsFromMessage(message),
    html,
    message?.parts,
  );
}

function buildStreamingTimeline(
  streaming?: StreamingState,
  html = "",
): TimelineBlock[] {
  return buildTimeline(
    thoughtItemsFromStreaming(streaming),
    progressItemsFromStreaming(streaming),
    html,
  );
}




const MAX_VISIBLE_COMPLETED_ACTIVITY = 5;

type MessageViewState = {
  showActivityDetails: boolean;
  showThinkingDetails: boolean;
  showAllCompletedActivity: boolean;
  showInternalActivity: boolean;
  expandedReasoningSteps: Set<string>; // Track individual reasoning step expansion
};

type DisplayEvent = {
  key: string;
  kind: "activity" | "reasoning";
  label: string;
  summary: string;
  description?: string;
  detail?: string;
  status: "pending" | "done" | "error";
  source?: "stream" | "final" | "raw_debug";
  partType?: string;
  internal?: boolean;
  filePath?: string;
  diffStats?: { added: number; deleted: number };
  activityDetail?: ActivityDetail;
  viewDiffFile?: string;
  isImportant?: boolean;
  updateCount: number;
};

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
  const provider = subagent.providerID || detail?.providerID;
  const model = subagent.modelID || detail?.modelID;
  if (provider && model) {
    return `${provider}/${model}`;
  }

  // If we have partial info, show it
  if (model || provider) {
    return model || provider;
  }

  // No model info available - check status to determine appropriate message
  const resolvedStatus = resolveSubagentStatus(subagent, detail);
  const isError = resolvedStatus === 'error' || resolvedStatus === 'orphaned';
  const isTerminal = resolvedStatus === 'done';

  if (isError || isTerminal) {
    // For errored/orphaned/completed subagents without model info, show "Unknown"
    return "Unknown";
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
      return "Unknown";
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
  const nonOrphanedSubagents = subagents.filter(
    (subagent: SubagentSummary) => subagent.status !== "orphaned",
  );
  const totalSubagentCount = nonOrphanedSubagents.length;
  const visibleSubagents = (showAllSubagents
    ? nonOrphanedSubagents
    : nonOrphanedSubagents.slice(0, 10));
  const hasLiveSubagentDuration = useMemo(
    () =>
      showSubagents &&
      visibleSubagents.some((subagent) => {
        const detail = subagentDetailsById[subagent.id] as
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
      const detail = subagentDetailsById[subagent.id] as SubagentDetail | undefined;
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
      className="oc-subagents-panel mt-3 mb-3 overflow-hidden rounded-md border bg-oc-panel-soft"
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
        <div className="space-y-2 p-2.5">
          <div
            className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1 pb-2"
            style={{ scrollPaddingBottom: "0.5rem" }}
          >
            {visibleSubagents.map((subagent: SubagentSummary) => {
              const detail = subagentDetailsById[subagent.id] as
                | SubagentDetail
                | undefined;
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
                    "oc-subagent-row w-full rounded-md border bg-oc-bg-soft px-2 py-1.5 text-left transition-colors",
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
                  <div className="mt-1 flex min-w-0 items-center gap-1.5">
                    <span className="text-[10px] font-medium oc-text-secondary">
                      {statusText}
                    </span>
                    {agentRole ? (
                      <span className="rounded border border-oc-border-soft px-1 py-0 text-[9px] font-medium uppercase tracking-wide oc-text-secondary">
                        {agentRole}
                      </span>
                    ) : null}
                    {backgroundTaskId ? (
                      <span className="rounded border border-oc-border-soft px-1 py-0 text-[9px] font-medium uppercase tracking-wide oc-text-secondary">
                        {backgroundTaskId}
                      </span>
                    ) : null}
                  </div>
                  {shouldShowActivity ? (
                    <div className="mt-0.5 min-h-[14px] font-medium text-[10px] oc-text-secondary">
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

function buildDisplayEvents(
  timelineBlocks: TimelineBlock[],
  message: Message | undefined,
  isStreamingActive: boolean,
): DisplayEvent[] {
  const stripTrailingEllipsis = (value?: string) =>
    (value || "").replace(/\s*(?:\.{3}|…)\s*$/u, "").trim();
  const normalizePathForMatch = (value?: string) =>
    (value || "").replace(/\\/g, "/").toLowerCase();
  const extractFilePathFromText = (value?: string): string | undefined => {
    if (!value) return undefined;
    const match = value.match(
      /(?:^|[\s("'`])((?:\.{1,2}\/|\/|[A-Za-z]:\\)?[\w./\\-]+\.[A-Za-z0-9]+)(?:$|[\s)"'`])/,
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

  const rawEvents: DisplayEvent[] = [];

  for (const block of timelineBlocks) {
    if (block.kind === "content") {
      continue;
    }

    if (block.kind === "thinking") {
      for (const item of block.items) {
        const text = (item.text || "").trim();
        if (!text) continue;
        const source = sourceFromThoughtKey(item.key);
        rawEvents.push({
          key: `reasoning-${item.key}`,
          kind: "reasoning",
          label: "Reasoning",
          summary: text,
          status: isStreamingActive && source === "stream" ? "pending" : "done",
          source,
          isImportant: false,
          updateCount: 1,
        });
      }
      continue;
    }

    for (const event of block.items) {
      const rawTitle = event.title || "";
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
      const description =
        filePath || parsed.summary || activityDetail?.summary
          ? metaText || activityDetail?.command || activityDetail?.query
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
          summary = description;
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
        diffStats,
        activityDetail,
        viewDiffFile,
        isImportant: Boolean(
          event.status === 'error' ||
          (event.status === 'done' && (filePath || diffStats || viewDiffFile)) ||
          cleanedLabel === 'error'
        ),
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
      (previous.filePath ?? "") === (event.filePath ?? "") &&
      (previous.source ?? "") === (event.source ?? "") &&
      (previous.internal ?? false) === (event.internal ?? false);

    if (!isDuplicate || !previous) {
      collapsed.push({ ...event });
      continue;
    }

    previous.updateCount += 1;
    if (event.description) previous.description = event.description;
    if (event.detail) previous.detail = event.detail;
    if (event.diffStats) previous.diffStats = event.diffStats;
    if (event.activityDetail) previous.activityDetail = event.activityDetail;
    if (event.viewDiffFile) previous.viewDiffFile = event.viewDiffFile;
    if (event.partType) previous.partType = event.partType;
    if (event.source) previous.source = event.source;
    previous.internal = Boolean(previous.internal || event.internal);
  }

  if (isStreamingActive) {
    let latestPendingIndex = -1;
    for (let index = collapsed.length - 1; index >= 0; index -= 1) {
      if (collapsed[index].status === "pending") {
        latestPendingIndex = index;
        break;
      }
    }

    if (latestPendingIndex > 0) {
      for (let index = 0; index < latestPendingIndex; index += 1) {
        if (collapsed[index].status === "pending") {
          collapsed[index].status = "done";
        }
      }
    }
  }

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
    <div className="oc-message-enter mb-6 px-4">
      <div className="opacity-90 transition-opacity hover:opacity-100">
        <div
          className="rounded-r-md border-l pr-2"
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
  const content = normalizedUserMessageText(message);
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
      <div className="oc-message-enter mb-5 px-4 flex justify-end">
        <div className="flex w-fit max-w-[78%] flex-col items-end gap-2">
          <div className="oc-plan-approved-badge flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-oc-xs">
            <Check className="h-3.5 w-3.5" />
            <span className="font-medium">Plan Approved</span>
          </div>
          {fileChips.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1">
              {fileChips.map((file) => (
                <span
                  key={file}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-oc-border bg-oc-panel-soft px-2.5 py-1 text-[10px] font-medium text-oc-text-soft"
                  title={file}
                >
                  <FileIcon filePath={file} className="h-3.5 w-3.5 shrink-0 opacity-85" />
                  <span className="truncate">{file}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }


  if (!content && fileChips.length === 0 && !hasImages) {
    return null;
  }

  return (
    <div className="oc-message-enter mb-5 flex items-end justify-end gap-2.5 px-4">
      <div className="w-fit max-w-[78%]">
        <div className="oc-msg-user" ref={userMessageRef}>
          <div className="whitespace-pre-wrap text-xs leading-relaxed">
            {content && (() => {
              const match = content.match(/^(\/[a-zA-Z0-9_-]+)(.*)$/s);
              if (match) {
                return (
                  <>
                    <span className="oc-readable-accent font-medium">{match[1]}</span>
                    {match[2]}
                  </>
                );
              }
              return content;
            })()}
          </div>
          {(fileChips.length > 0 || hasImages) && (
            <div className="mt-2 flex flex-wrap gap-1">
              {fileChips.map((file) => (
                <span
                  key={file}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-oc-border bg-oc-panel-soft px-2.5 py-1 text-[10px] font-medium text-oc-text-soft"
                  title={file}
                >
                  <FileIcon filePath={file} className="h-3.5 w-3.5 shrink-0 opacity-85" />
                  <span className="truncate">{file}</span>
                </span>
              ))}
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
        <div className="mt-1.5 flex justify-end">
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

const AssistantMessageInner = memo(function AssistantMessageInner({
  message,
  streaming,
  isContiguous,
  subagentsByParentMessageId,
  subagentDetailsById,
  availableAgents,
  todoItems = [],
}: {
  message?: Message;
  streaming?: StreamingState;
  isContiguous?: boolean;
  subagentsByParentMessageId: AppState["subagentsByParentMessageId"];
  subagentDetailsById: AppState["subagentDetailsById"];
  availableAgents: AppState["availableAgents"];
  todoItems?: AppState["todoItems"];
}) {
  const dispatch = useAppDispatch();
  const state = useAppState();
  const [showSubagents, setShowSubagents] = useState(true);
  const [showAllSubagents, setShowAllSubagents] = useState(false);
  const [showTodoChecklist, setShowTodoChecklist] = useState(true);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const messageBodyRef = useRef<HTMLDivElement>(null);
  const progressTimelineRef = useRef<HTMLDivElement>(null);
  const requestedSubagentConversationRef = useRef<Set<string>>(new Set());

  const content = getMessageContent(message, streaming);
  const liveInteractivePrompt = useMemo(
    () => questionPromptFromInteractiveEvents(state.interactiveEvents),
    [state.interactiveEvents],
  );
  const shouldUseInteractivePromptFallback =
    !!streaming?.isActive &&
    content.trim().length === 0 &&
    !!liveInteractivePrompt;
  const resolvedContent = shouldUseInteractivePromptFallback
    ? (liveInteractivePrompt ?? "")
    : content;
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
    return buildTimeline(
      thoughtItems,
      progressItems,
      resolvedContent,
      message?.parts,
    );
  }, [thoughtItems, progressItems, resolvedContent, message?.parts]);
  const isStreamingActive = !!streaming?.isActive;
  const displayEvents = useMemo(
    () => buildDisplayEvents(timelineBlocks, message, isStreamingActive),
    [timelineBlocks, message, isStreamingActive],
  );
  const info = message?.info;
  const messageRec = asRecord(message);
  const infoRec = asRecord(messageRec?.info);
  const structured =
    asRecord(messageRec?.structuredOutput) ||
    asRecord(messageRec?.structured) ||
    asRecord(infoRec?.structuredOutput) ||
    asRecord(infoRec?.structured);
  const responseType = firstNonEmptyString(
    message?.responseType,
    typeof structured?.responseType === "string" ? structured.responseType : undefined,
  )?.toLowerCase();
  let plan = responseType === "implementation_plan" ? message?.plan : undefined;
  if (!plan && responseType === "implementation_plan") {
    const structuredPlanRec = asRecord(structured?.plan);
    if (structuredPlanRec) {
      plan = {
        file:
          typeof structuredPlanRec.file === "string"
            ? structuredPlanRec.file
            : undefined,
        files: Array.isArray(structuredPlanRec.files)
          ? structuredPlanRec.files
          : undefined,
        content:
          typeof structuredPlanRec.content === "string"
            ? structuredPlanRec.content
            : undefined,
        title:
          typeof structuredPlanRec.title === "string"
            ? structuredPlanRec.title
            : undefined,
        intro:
          typeof structuredPlanRec.intro === "string"
            ? structuredPlanRec.intro
            : undefined,
        summary:
          typeof structuredPlanRec.summary === "string"
            ? structuredPlanRec.summary
            : undefined,
        fileCount:
          typeof structuredPlanRec.fileCount === "number" &&
            Number.isFinite(structuredPlanRec.fileCount)
            ? structuredPlanRec.fileCount
            : undefined,
      };
    }
  }
  const changeSummary = message?.changeSummary;
  // Match the same ID extraction logic as backend extractMessageId()
  // https://github.com/anthropics/opencode-vscode/blob/main/src/providers/ChatViewProvider.ts#L1988-L2000
  const messageId =
    info?.id ||
    message?.id ||
    message?.messageId ||
    info?.messageId ||
    streaming?.messageId;
  const hasOwnedChangeSummary = messageOwnsChangeSummary(
    message,
    messageId,
    changeSummary,
  );
  const shouldShowFileChanges = useMemo(() => {
    if (!message || !messageHasOwnFileChangeEvidence(message)) {
      return false;
    }

    const ownFiles = fileChangePathsFromMessage(message);

    // If summary ownership metadata is missing, keep local evidence visible.
    // This avoids dropping the file-change card when providers omit
    // message-scoped diff summary payloads.
    if (!hasOwnedChangeSummary) {
      return (
        ownFiles.size > 0 ||
        (Array.isArray(message.steps) && message.steps.length > 0) ||
        (Array.isArray(message.progressEvents) && message.progressEvents.length > 0)
      );
    }

    if (ownFiles.size === 0) {
      return true;
    }

    const ownIndex = state.messages.findIndex(
      (candidate) =>
        candidate === message ||
        (!!messageId && (candidate.info?.id === messageId || candidate.id === messageId)),
    );
    const ownRichness = fileChangeRenderRichness(message);

    return !state.messages.some((candidate, index) => {
      if (candidate === message) {
        return false;
      }
      const candidateFiles = fileChangePathsFromMessage(candidate);
      if (candidateFiles.size === 0) {
        return false;
      }
      if (!isFileChangeSubset(ownFiles, candidateFiles)) {
        return false;
      }
      const candidateRichness = fileChangeRenderRichness(candidate);
      if (candidateRichness > ownRichness) {
        return true;
      }
      return candidateRichness === ownRichness && ownIndex >= 0 && index > ownIndex;
    });
  }, [hasOwnedChangeSummary, message, messageId, state.messages]);
  useEffect(() => {
    if (!message || !config.debug.showRawResponse) {
      return;
    }
    const structuredCount = structuredFileChangesFromMessage(message).length;
    console.debug("[DIFF PREVIEW] render-gate", {
      messageId,
      shouldShowFileChanges,
      hasOwnEvidence: messageHasOwnFileChangeEvidence(message),
      structuredCount,
      editsCount: Array.isArray(message.edits) ? message.edits.length : 0,
      stepsCount: Array.isArray(message.steps) ? message.steps.length : 0,
      progressEventsCount: Array.isArray(message.progressEvents)
        ? message.progressEvents.length
        : 0,
      hasOwnedChangeSummary,
    });
  }, [message, messageId, shouldShowFileChanges, hasOwnedChangeSummary]);
  const shouldShowPlanCard = useMemo(() => {
    if (!plan?.file) {
      return !!plan;
    }

    const ownIndex = state.messages.findIndex(
      (candidate) =>
        candidate === message ||
        (!!messageId && (candidate.info?.id === messageId || candidate.id === messageId)),
    );
    const ownRichness = planRenderRichness(plan);

    return !state.messages.some((candidate, index) => {
      if (candidate === message) {
        return false;
      }
      const candidatePlanFile = planFileFromMessageForComparison(candidate);
      if (!areLikelySamePlanFilePath(candidatePlanFile, plan.file)) {
        return false;
      }

      const candidatePlan =
        candidate.plan ||
        ((candidate as unknown as Record<string, unknown>).structuredOutput as
          | { plan?: Message["plan"] }
          | undefined)?.plan;
      const candidateRichness = planRenderRichness(candidatePlan);
      if (candidateRichness > ownRichness) {
        return true;
      }
      return candidateRichness === ownRichness && ownIndex >= 0 && index < ownIndex;
    });
  }, [message, messageId, plan, state.messages]);

  const latestAssistantMessageId = useMemo(() => {
    for (let index = state.messages.length - 1; index >= 0; index--) {
      const candidate = state.messages[index];
      const role = candidate.role ?? candidate.info?.role ?? "user";
      if (role === "assistant") {
        return candidate.info?.id ?? candidate.id;
      }
    }
    return undefined;
  }, [state.messages]);
  const isLatestAssistantMessage =
    !!messageId && latestAssistantMessageId === messageId;
  const [viewState, setViewState] = useState<MessageViewState>({
    showActivityDetails: false,
    showThinkingDetails: false,
    showAllCompletedActivity: false,
    showInternalActivity: false,
    expandedReasoningSteps: new Set<string>(),
  });
  const hasCompletedCondensedActivity =
    displayEvents.length > MAX_VISIBLE_COMPLETED_ACTIVITY &&
    !viewState.showAllCompletedActivity;
  const visibleDisplayEvents = hasCompletedCondensedActivity
    ? displayEvents.slice(-MAX_VISIBLE_COMPLETED_ACTIVITY)
    : displayEvents;
  const userFacingDisplayEvents = visibleDisplayEvents.filter((event) => {
    if (event.internal) return false;
    return true;
  });
  const internalDisplayEvents = visibleDisplayEvents.filter(
    (event) => event.internal,
  );
  const timelineDisplayEvents =
    viewState.showInternalActivity && internalDisplayEvents.length > 0
      ? visibleDisplayEvents
      : userFacingDisplayEvents;
  const hiddenActivityEventCount = Math.max(
    0,
    displayEvents.length - visibleDisplayEvents.length,
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
    const activeSessionId = state.currentSessionId;
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
    const assistantMessageIdentitySet = new Set<string>();
    for (const candidate of state.messages) {
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
      return orphanMappedTodos;
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
    // keep them visible on the latest assistant message even after streaming.
    if (!hasAnyScopedTodo && isLatestAssistantMessage) {
      return sessionScopedTodoItems.filter((item) => !item.parentMessageId);
    }
    return [];
  }, [
    todoItems,
    messageId,
    isStreamingActive,
    latestAssistantMessageId,
    state.currentSessionId,
    state.messages,
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
      const msgIndex = state.messages.findIndex(
        (m) => m === message || (messageId && (m.info?.id === messageId || m.id === messageId))
      );

      if (msgIndex !== -1) {
        const matchingPlanIndexes = state.messages
          .map((candidate, index) =>
            areLikelySamePlanFilePath(
              planFileFromMessageForComparison(candidate),
              targetPlanFile,
            )
              ? index
              : -1,
          )
          .filter((index) => index >= 0);
        const firstMatchingPlanIndex =
          matchingPlanIndexes.length > 0 ? Math.min(...matchingPlanIndexes) : msgIndex;
        const lastMatchingPlanIndex =
          matchingPlanIndexes.length > 0 ? Math.max(...matchingPlanIndexes) : msgIndex;

        // Did user ask for a revision before this plan was generated?
        for (let i = firstMatchingPlanIndex - 1; i >= 0; i--) {
          const m = state.messages[i];
          if (m.role === "user") {
            const text = normalizedUserMessageText(m);
            if (isPlanRevisionMessageContent(text)) {
              revised = true;
            }
            break;
          }
        }

        // Did user approve or request revision on this plan?
        for (let i = firstMatchingPlanIndex + 1; i < state.messages.length; i++) {
          const m = state.messages[i];
          const candidatePlanFile = planFileFromMessageForComparison(m);
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
  }, [plan, message, messageId, state.messages]);

  // Merge subagents from message data and from the store lookup by parent message ID.
  // Prefer store-scoped entries so subagent cards cannot bleed into unrelated messages.
  const subagents = useMemo(() => {
    const activeSessionId = state.currentSessionId;
    const isInActiveSession = (subagent: SubagentSummary): boolean => {
      if (!activeSessionId) {
        return true;
      }
      return subagent.parentSessionId === activeSessionId;
    };
    const scopedStore = messageId ? (subagentsByParentMessageId[messageId] ?? []) : [];
    const fromStore = scopedStore.filter((subagent: SubagentSummary) => {
      if (!isInActiveSession(subagent)) {
        return false;
      }
      if (!messageId) {
        return true;
      }
      return subagent.parentMessageId === messageId;
    });
    const messageSubagents = Array.isArray(message?.subagents) ? message.subagents : [];
    const fromMessage = messageSubagents.filter((subagent: SubagentSummary) => {
      if (!isInActiveSession(subagent)) {
        return false;
      }
      if (!messageId) {
        return true;
      }
      return subagent.parentMessageId === messageId;
    });

    if (fromStore.length === 0) return fromMessage;
    if (fromMessage.length === 0) return fromStore;

    // Merge: store entries take precedence (more up-to-date), then append
    // message-scoped entries not yet in the store snapshot.
    const storeIds = new Set(fromStore.map((s: SubagentSummary) => s.id));
    const extra = fromMessage.filter((s) => !storeIds.has(s.id));
    return [...fromStore, ...extra];
  }, [message, messageId, subagentsByParentMessageId, state.currentSessionId]);
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
      (subagentDetailsById[selected.id] as SubagentDetail | undefined) ||
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
      (subagentDetailsById[selected.id] as SubagentDetail | undefined) ||
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
  const thinkingVariant = getThinkingVariant(message, streaming);
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
    const raw = message?.rawResponse;
    if (typeof raw === "undefined") {
      return {
        rawResponseText: "",
      };
    }
    if (typeof raw === "string") {
      return {
        rawResponseText: withCap(raw),
      };
    }
    try {
      return {
        rawResponseText: withCap(JSON.stringify(raw, null, 2)),
      };
    } catch {
      return {
        rawResponseText: withCap(String(raw)),
      };
    }
  }, [message?.rawResponse]);
  // Render raw debug whenever payload exists. Do not gate behind stream-debug
  // flags, otherwise streamed + hydrated sessions can silently hide rawResponse.
  const hasRawResponseDebug = rawResponseText.trim().length > 0;
  const showRawResponseDebug = config.debug.showRawResponse;
  const planLeadMessage = useMemo(() => {
    if (!plan) return "";
    const candidate = (
      firstNonEmptyString(
        message?.message,
        typeof structured?.message === "string" ? structured.message : undefined,
        plan.intro,
        plan.summary,
      ) ?? ""
    ).trim();
    if (candidate && !looksLikeInternalPlanningText(candidate)) {
      return candidate;
    }
    return "I created an implementation plan. Here are the key steps and the plan file.";
  }, [message?.message, structured?.message, plan]);
  const hasThinkingEvents = useMemo(
    () => displayEvents.some((event) => event.kind === "reasoning"),
    [displayEvents],
  );
  const resolvedContentMatchesError = messageDisplaysSameErrorText(
    message,
    resolvedContent,
  );
  const visibleResolvedContent = resolvedContentMatchesError
    ? ""
    : resolvedContent;
  const effectiveResponseContent =
    visibleResolvedContent.trim().length > 0
      ? visibleResolvedContent
      : planLeadMessage;
  const hasVisibleResponseBody = effectiveResponseContent.trim().length > 0;
  const hasPrimaryResponseBody = hasVisibleResponseBody || !!plan;
  const hasResponseContent = hasVisibleResponseBody;
  const isAborted = message?.aborted === true;
  const structuredRetryError =
    !!message?.error &&
    (message.retryWithoutStructuredOutput === true ||
      isStructuredOutputFailureMessage(message.error));
  const showLegacyErrorBanner =
    !!message?.error &&
    !messageMatchesDisplayErrorText(message, message.error) &&
    !structuredRetryError &&
    !isAborted;
  const showDisplayErrorBanner = !!message?.displayError;
  const plainTextFallback = message?.plainTextFallback === true;
  const plainTextFallbackTooltip = plainTextFallback
    ? [
      message.plainTextFallbackMessage ||
      "Structured output failed for this turn. Showing plain text response.",
      message.plainTextFallbackReason
        ? `Reason: ${message.plainTextFallbackReason}`
        : "",
    ]
      .filter(Boolean)
      .join("\n")
    : "";
  const isLiveStreamingCard = !message && !!streaming?.isActive;
  const responseBodyClass = isLiveStreamingCard
    ? "w-full"
    : "w-full";
  const markdownBodyClass = isLiveStreamingCard
    ? "w-full max-w-none"
    : "w-full";
  const showResponseSection = hasVisibleResponseBody || !!plan;
  const responseSectionClass = hasResponseContent
    ? "rounded-md border border-oc-border-soft bg-background p-3.5 shadow-sm"
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
  const retryLastMessage = (retryWithoutStructuredOutput: boolean) => {
    dispatch({ type: "SET_PROCESSING", payload: true });
    const targetMessageIndex = state.messages.findIndex((candidate) => {
      if (messageId) {
        const candidateId = candidate.info?.id ?? candidate.id;
        return candidateId === messageId;
      }
      return candidate === message;
    });
    if (targetMessageIndex >= 0) {
      let persistedPatchedMessage: Message | undefined;
      const nextMessages = state.messages.map((candidate, index) => {
        if (index !== targetMessageIndex) return candidate;
        const patched = patchMessageRetryState(
          candidate,
          retryWithoutStructuredOutput,
        );
        persistedPatchedMessage = patched;
        return patched;
      });
      dispatch({ type: "SET_MESSAGES", payload: nextMessages });
      if (state.currentSessionId && persistedPatchedMessage) {
        vscode.postMessage({
          type: "persistAssistantMessage",
          sessionId: state.currentSessionId,
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

  return (
    <div
      id={messageId ? `msg-${messageId}` : undefined}
      data-message-id={messageId || undefined}
      className={`oc-message-enter ${responseEnterClass} ${isContiguous ? "mb-4 mt-[-12px]" : "mb-5"} px-4`}
    >
      <div
        className={cn(
          "oc-msg-assistant",
        )}
        ref={messageBodyRef}
      >
        {!isContiguous && (
          <div className="oc-msg-header mb-2.5 flex flex-wrap items-start justify-between gap-2">
            <div className="oc-msg-header-main flex min-w-0 flex-1 items-center gap-1.5">
              {showStreamingLoading ? (
                <ThinkingStatusTicker className="oc-thinking-status" />
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
                            ? { color: `color-mix(in srgb, var(--oc-text) 88%, ${agentColor})` }
                            : { color: "var(--oc-text-secondary)" }
                        }
                      />
                    </div>
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
                      {thinkingVariant && (
                        <div className="flex items-center gap-1 opacity-60">
                          <span className="text-oc-xs font-medium shrink-0">•</span>
                          <span className="oc-msg-thinking-label">
                            Think {formatThinkingVariantLabel(thinkingVariant)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="oc-msg-header-actions flex min-w-0 flex-wrap items-center gap-1.5">
              {hasMetrics && !showStreamingLoading && (
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

        <div className="space-y-3">
          {(displayEvents.length > 0 ||
            showThinkingPlaceholder) && (
              <section data-assistant-section="activity">
                {timelineDisplayEvents.length > 0 && (
                  <>
                    <Stepper
                      className={cn(
                        "oc-refined-stepper",
                        viewState.showAllCompletedActivity && "max-h-[400px] overflow-y-auto",
                      )}
                      ref={progressTimelineRef}
                      autoScrollToBottom={isStreamingActive}
                    >
                      {timelineDisplayEvents.map((event, index) => {
                        const isLast = index === timelineDisplayEvents.length - 1;
                        const isLatestStreamingEvent =
                          isStreamingActive && isLast;
                        const indicatorNode = (
                          <StepIndicator
                            status={isLatestStreamingEvent && event.status === "pending" ? "running" : event.status}
                          />
                        );
                        const fileName = event.filePath
                          ? event.filePath.split(/[/\\]/).pop()
                          : undefined;
                        const shouldShowDetail = viewState.showActivityDetails;

                        return (
                          <StepperItem
                            key={event.key}
                            isLast={isLast}
                            indicator={indicatorNode}
                            className={cn(
                              "oc-refined-stepper-item group",
                              isLatestStreamingEvent
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
                                          data-operation={event.label.toLowerCase()}
                                        >
                                          {event.label}
                                        </span>
                                      </div>

                                      <span className="flex min-w-0 flex-1 flex-col gap-1 oc-refined-event-content w-full">
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
                                      </span>
                                    </div>

                                    {/* Chevron button at right end */}
                                    <button
                                      type="button"
                                      className="shrink-0 p-1 hover:bg-oc-panel-soft rounded transition-colors"
                                      onClick={() =>
                                        setViewState((prev) => {
                                          const newExpanded = new Set(prev.expandedReasoningSteps);
                                          if (newExpanded.has(event.key)) {
                                            newExpanded.delete(event.key);
                                          } else {
                                            newExpanded.add(event.key);
                                          }
                                          return { ...prev, expandedReasoningSteps: newExpanded };
                                        })
                                      }
                                      title={isExpanded ? "Collapse reasoning" : "Expand reasoning"}
                                    >
                                      <ChevronDown
                                        className={cn(
                                          "h-4 w-4 transition-transform duration-200 oc-text-secondary",
                                          isExpanded && "rotate-180",
                                        )}
                                      />
                                    </button>
                                  </div>
                                );
                              } else {
                                return (
                                  <div className="flex items-start justify-between gap-2 w-full">
                                    <ExpandableStep className="flex-1 min-w-0">
                                <div className="flex min-w-0 flex-col items-start gap-2 w-full">
                                  <div className="flex items-center gap-2 flex-wrap">
                                  <span
                                    className={cn(
                                      "oc-refined-event-label",
                                      event.kind === "reasoning" && "reasoning",
                                      // event.kind === "activity" && "uppercase"
                                      event.kind === "activity" && "activity",
                                    )}
                                    data-operation={event.label.toLowerCase()}
                                  >
                                    {event.label}
                                  </span>
                                  {event.kind === "activity" && event.source && event.source !== "stream" && event.source !== "final" && (
                                    <span className="oc-refined-meta-badge">
                                      {event.source === "raw_debug"
                                        ? "raw"
                                        : event.source}
                                    </span>
                                  )}
                                  {event.kind === "activity" && event.internal && (
                                    <span className="oc-refined-meta-badge">
                                      internal
                                    </span>
                                  )}
                                </div>

                                <span className="flex min-w-0 flex-1 flex-col gap-1 oc-refined-event-content w-full">
                                  {event.filePath ? (
                                    SEARCH_LABELS.has(event.label) ? (
                                      <SearchBlock
                                        pattern={
                                          [
                                            event.activityDetail?.query || event.summary,
                                            event.description,
                                          ]
                                            .filter((value): value is string => !!value?.trim())
                                            .join("\n")
                                        }
                                        scope={event.label}
                                        path={event.filePath}
                                      />
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
                                          {fileName || event.summary}
                                        </span>
                                        <span className="oc-refined-file-link-tooltip" role="tooltip">
                                          {event.filePath}
                                        </span>
                                      </button>
                                    )
                                  ) : (
                                    event.summary && (
                                      event.kind === "reasoning" ? (
                                        <div className="w-full">
                                          <div
                                            className={cn(
                                              "oc-refined-event-summary text-left w-full",
                                              !viewState.expandedReasoningSteps.has(event.key) && "line-clamp-2",
                                            )}
                                          >
                                            <MarkdownRenderer
                                              content={event.summary}
                                              className="markdown-body"
                                            />
                                          </div>
                                        </div>
                                      ) : (
                                        <div
                                          className={cn(
                                            "oc-refined-event-summary",
                                          )}
                                        >
                                        {event.label === "bash" ? (
                                          <TerminalBlockWithOutput
                                            event={event}
                                            messageContent={content}
                                          />
                                        ) : SEARCH_LABELS.has(event.label) ? (
                                          <SearchBlock
                                            pattern={
                                              [
                                                event.activityDetail?.query || event.summary,
                                                event.description,
                                              ]
                                                .filter((value): value is string => !!value?.trim())
                                                .join("\n")
                                            }
                                            scope={event.label}
                                          />
                                        ) : (
                                          <MarkdownRenderer
                                            content={event.summary}
                                            className="markdown-body"
                                          />
                                        )}
                                      </div>
                                    )
                                  ))}

                                  {/* For non-bash events, render description separately */}
                                  {!SEARCH_LABELS.has(event.label) && event.label !== "bash" && event.description && (
                                    <div className="oc-refined-event-content">
                                      <MarkdownRenderer
                                        content={event.description}
                                        className="markdown-body"
                                      />
                                    </div>
                                  )}

                                  {event.updateCount > 1 && (
                                    <span className="oc-refined-update-count">
                                      x{event.updateCount} updates
                                    </span>
                                  )}

                                  {shouldShowDetail && event.detail && (
                                    <div className="oc-refined-event-content">
                                      <MarkdownRenderer
                                        content={event.detail}
                                        className="markdown-body"
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

                                      {/* Don't show TerminalBlock here for bash - already shown in summary section above */}
                                      {event.label !== "bash" && event.activityDetail.command && (
                                        <TerminalBlock command={event.activityDetail.command} />
                                      )}
                                    </div>
                                  )}
                                </span>

                                {event.diffStats &&
                                  (event.diffStats.added > 0 ||
                                    event.diffStats.deleted > 0) && (
                                    <span className="oc-refined-diff-stats">
                                      {event.diffStats.added > 0 && (
                                        <span className="oc-refined-diff-add">
                                          +{event.diffStats.added}
                                        </span>
                                      )}
                                      {event.diffStats.deleted > 0 && (
                                        <span className="oc-refined-diff-del">
                                          -{event.diffStats.deleted}
                                        </span>
                                      )}
                                    </span>
                                  )}

                                {event.viewDiffFile && (
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
                                </div>
                              </ExpandableStep>
                            </div>
                        );
                      }
                    })()}
                          </StepperItem>
                        );
                      })}
                    </Stepper>

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

                    {displayEvents.length > MAX_VISIBLE_COMPLETED_ACTIVITY && (
                      <button
                        type="button"
                        className="mt-4 rounded-full border border-oc-border px-2.5 py-0.5 text-left font-medium text-[10px] oc-text-secondary transition-colors hover:bg-oc-panel hover:text-oc-text-soft"
                        onClick={() =>
                          setViewState((prev) => ({
                            ...prev,
                            showAllCompletedActivity: !prev.showAllCompletedActivity,
                          }))
                        }
                      >
                        {viewState.showAllCompletedActivity
                          ? "Show less"
                          : `Show more (${hiddenActivityEventCount})`}
                      </button>
                    )}

                  </>
                )}

              </section>
            )}

          <SubagentsInlineCard
            subagents={subagents}
            subagentDetailsById={subagentDetailsById}
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
              {hasResponseContent && (
                <div className={responseBodyClass}>
                  <MarkdownRenderer
                    content={effectiveResponseContent}
                    className={markdownBodyClass}
                  />
                </div>
              )}

              {shouldShowPlanCard && plan && (
                <div
                  className={
                    hasResponseContent
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

              {/* CHANGE SUMMARY SECTION - TEMPORARILY DISABLED
              
              User reported that diff previews were showing inside the AI response card
              above the Raw Response (Debug) section. This changeSummary section
              (lines 3027-3102) displays file change statistics like "5 files changed +15 -3"
              with a list of modified files. This appears to be what the user was seeing.
              
              The File Changes section (lines 3362-3397) at the bottom now shows actual
              diff previews with CompactDiffPreview, so this summary section is redundant.
              
              TODO: Verify with user that this is the correct section to remove.
              */}
              {/* {changeSummary &&
                Array.isArray(changeSummary.files) &&
                changeSummary.files.length > 0 && (
                  <div
                    className={
                      hasResponseContent || !!plan
                        ? "mt-3 pt-3 border-t border-oc-border-soft/30"
                        : undefined
                    }
                  >
                    <div className="rounded-md border border-oc-border-soft bg-oc-panel-soft/50">
                      <div className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="text-sm font-medium text-oc-text-soft">
                          {changeSummary.filesChanged} file
                          {changeSummary.filesChanged === 1 ? "" : "s"} changed
                          {(changeSummary.added > 0 || changeSummary.deleted > 0) && (
                            <span className="ml-2 text-xs font-medium">
                              {changeSummary.added > 0 && (
                                <span className="text-oc-green">+{changeSummary.added}</span>
                              )}
                              {changeSummary.added > 0 && changeSummary.deleted > 0 ? " " : ""}
                              {changeSummary.deleted > 0 && (
                                <span className="text-oc-red">-{changeSummary.deleted}</span>
                              )}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            className="rounded border border-oc-border-soft px-2 py-0.5 text-xs oc-text-secondary hover:text-oc-text-soft"
                            onClick={() =>
                              vscode.postMessage({
                                type: "undoMessageChanges",
                                messageId: changeSummary.messageId || messageId,
                              })
                            }
                          >
                            Undo
                          </button>
                          <button
                            type="button"
                            className="rounded border border-oc-border-soft px-2 py-0.5 text-xs oc-text-secondary hover:text-oc-text-soft"
                            onClick={() =>
                              vscode.postMessage({
                                type: "reviewMessageChanges",
                                files: changeSummary.files.map((file) => file.file),
                              })
                            }
                          >
                            Review
                          </button>
                        </div>
                      </div>
                      <div className="border-t border-oc-border-soft/50">
                        {changeSummary.files.slice(0, 12).map((file) => (
                          <button
                            key={file.file}
                            type="button"
                            className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-oc-panel-soft"
                            onClick={() =>
                              vscode.postMessage({
                                type: "openDiff",
                                file: file.file,
                              })
                            }
                          >
                            <span className="truncate text-oc-text-soft">{file.file}</span>
                            <span className="ml-2 shrink-0 font-medium">
                              {file.added > 0 && <span className="text-oc-green">+{file.added}</span>}
                              {file.added > 0 && file.deleted > 0 ? " " : ""}
                              {file.deleted > 0 && <span className="text-oc-red">-{file.deleted}</span>}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )} */}

              {showRawResponseDebug && hasRawResponseDebug && (
                <div
                  data-assistant-section="raw-response-debug"
                  className={
                    hasPrimaryResponseBody
                      ? "mt-3 pt-3 border-t border-oc-border-soft/30"
                      : undefined
                  }
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-oc-text-soft">
                      Raw Response (Debug)
                    </div>
                  </div>
                  <pre className="max-h-[260px] overflow-auto rounded border border-oc-border-soft bg-oc-panel-soft/60 p-2 text-[11px] leading-relaxed text-oc-text-soft whitespace-pre-wrap break-words font-medium">
                    {rawResponseText}
                  </pre>
                </div>
              )}

            </section>
          )}
        </div>

        {!isStreamingActive && showResponseSection && (
          <div className="mt-2 flex justify-start">
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
        )}

        {isAborted && (
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
                message.retryWithoutStructuredOutput === true ||
                isStructuredOutputFailureMessage(message.error);
              return (
                <ErrorBanner
                  message={message.error}
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
            <InfoBanner error={message.displayError} />
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
              (subagentDetailsById[selected.id] as
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
        {shouldShowFileChanges && (
          <div className="mt-4">
            <FileChangesSection
              streamingSteps={Array.isArray(message?.steps) ? message.steps : []}
              timelineEvents={
                Array.isArray(message?.progressEvents) ? message.progressEvents : []
              }
              messageEdits={message?.edits || []}
              structuredFileChanges={structuredFileChangesFromMessage(message)}
              changeSummary={changeSummary}
              messageId={messageId}
              sessionId={state.currentSessionId}
            />
          </div>
        )}

        {isStreamingActive &&
          !showResponseSection &&
          hasStreamingActivity &&
          !showStreamingLoading && (
            <div className="mt-2 mb-2 px-1">
              <ThinkingStatusTicker className="oc-thinking-status" />
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
      </div>
    </div>
  );
});

function FileChangesSection({
  streamingSteps,
  timelineEvents,
  messageEdits,
  structuredFileChanges,
  changeSummary,
  messageId,
  sessionId,
}: {
  streamingSteps: Array<{
    filePath?: string;
    title?: string;
    activityDetail?: {
      file?: string;
      diffExcerpt?: { header?: string; lines: string[]; added?: number; deleted?: number };
    };
    diffStats?: { added: number; deleted: number };
  }>;
  timelineEvents: Array<{
    filePath?: string;
    summary?: string;
    description?: string;
    activityDetail?: {
      file?: string;
      diffExcerpt?: { header?: string; lines: string[]; added?: number; deleted?: number };
    };
    diffStats?: { added: number; deleted: number };
  }>;
  messageEdits: Array<{ file: string; added?: number; deleted?: number }>;
  structuredFileChanges: StructuredFileChange[];
  changeSummary?: Message["changeSummary"];
  messageId?: string | null;
  sessionId?: string | null;
}) {
  type DiffExcerpt = { header?: string; lines?: string[]; added?: number; deleted?: number };
  type FileChange = { file: string; added: number; deleted: number; diffExcerpt?: DiffExcerpt };
  type IndexedFileChange = FileChange & { sourcePriority: number };

  const isLikelyFilePath = (value: string): boolean => {
    const v = value.trim();
    if (!v) return false;
    if (v.includes("\n")) return false;
    if (/\s/.test(v)) return false;
    if (!/^[A-Za-z0-9._/\-\\]+$/.test(v)) return false;
    if (/[\\/]/.test(v)) return true;
    if (/^\*?[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+$/.test(v)) return true;
    if (/^\*\s+[A-Za-z0-9._-]+[\\/][^ ]+/.test(v)) return true;
    return false;
  };

  const compactDisplayDir = (dir: string): string => {
    const normalized = dir.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!normalized) return "";
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length <= 3) return normalized;
    return `.../${parts.slice(-3).join("/")}`;
  };

  const basenameFromPath = (value: string) => {
    const normalized = value.replace(/\\/g, "/").trim();
    const parts = normalized.split("/");
    return (parts[parts.length - 1] || normalized).toLowerCase();
  };

  const normalizePath = (value: string) => {
    const normalized = value.replace(/\\/g, "/").trim();
    const lower = normalized.toLowerCase();

    const hiddenSisyphusMarker = "/.sisyphus/";
    const hiddenIdx = lower.indexOf(hiddenSisyphusMarker);
    if (hiddenIdx >= 0) {
      return `sisyphus/${lower.slice(hiddenIdx + hiddenSisyphusMarker.length)}`;
    }

    const plainSisyphusMarker = "/sisyphus/";
    const plainIdx = lower.indexOf(plainSisyphusMarker);
    if (plainIdx >= 0) {
      return lower.slice(plainIdx + 1);
    }

    if (lower.startsWith(".sisyphus/")) {
      return `sisyphus/${lower.slice(".sisyphus/".length)}`;
    }

    return lower;
  };

  const fileChanges = useMemo<FileChange[]>(() => {
    const byFile = new Map<string, IndexedFileChange>();

    const upsert = (
      filePath: string | undefined,
      added: number | undefined,
      deleted: number | undefined,
      sourcePriority: number,
      diffExcerpt?: DiffExcerpt,
    ) => {
      const file = (filePath || "").trim();
      if (!file) return;
      if (!isLikelyFilePath(file)) return;

      const normalizedPath = normalizePath(file);
      const hasSeparator = normalizedPath.includes("/");
      const basename = basenameFromPath(normalizedPath);

      let key = normalizedPath;
      if (!hasSeparator) {
        const matches = Array.from(byFile.keys()).filter(
          (candidate) => candidate.includes("/") && basenameFromPath(candidate) === basename,
        );
        if (matches.length === 1) {
          key = matches[0];
        }
      } else if (byFile.has(basename) && !byFile.has(normalizedPath)) {
        const basenameEntry = byFile.get(basename);
        if (basenameEntry) {
          byFile.set(normalizedPath, basenameEntry);
          byFile.delete(basename);
        }
      }
      const resolvedAdded = Math.max(
        0,
        typeof added === "number" ? added : typeof diffExcerpt?.added === "number" ? diffExcerpt.added : 0,
      );
      const resolvedDeleted = Math.max(
        0,
        typeof deleted === "number"
          ? deleted
          : typeof diffExcerpt?.deleted === "number"
            ? diffExcerpt.deleted
            : 0,
      );
      const hasExcerptLines =
        Array.isArray(diffExcerpt?.lines) &&
        diffExcerpt.lines.some((line) => typeof line === "string" && line.trim().length > 0);
      const hasStructuredChangeEvidence =
        resolvedAdded > 0 || resolvedDeleted > 0 || hasExcerptLines;
      if (!hasStructuredChangeEvidence) {
        return;
      }

      const existing = byFile.get(key);
      if (!existing) {
        byFile.set(key, {
          file,
          added: resolvedAdded,
          deleted: resolvedDeleted,
          diffExcerpt,
          sourcePriority,
        });
        return;
      }

      const existingLooksLikePath = /[\\/]/.test(existing.file);
      const incomingLooksLikePath = /[\\/]/.test(file);

      const shouldReplaceStats = sourcePriority >= existing.sourcePriority;
      const nextExcerptLines = Array.isArray(diffExcerpt?.lines) ? diffExcerpt.lines.length : 0;
      const existingExcerptLines = Array.isArray(existing.diffExcerpt?.lines)
        ? existing.diffExcerpt.lines.length
        : 0;

      existing.file = incomingLooksLikePath && !existingLooksLikePath
        ? file
        : existing.file.length >= file.length
          ? existing.file
          : file;
      if (shouldReplaceStats) {
        existing.added = resolvedAdded;
        existing.deleted = resolvedDeleted;
        existing.sourcePriority = sourcePriority;
      } else {
        existing.added = Math.max(existing.added, resolvedAdded);
        existing.deleted = Math.max(existing.deleted, resolvedDeleted);
      }
      if (nextExcerptLines > existingExcerptLines) {
        existing.diffExcerpt = diffExcerpt;
      }
    };

    for (const step of streamingSteps) {
      const hasConcreteChangeEvidence =
        Boolean(step.diffStats) ||
        Boolean(step.activityDetail?.diffExcerpt) ||
        Boolean(step.activityDetail?.file);
      if (!hasConcreteChangeEvidence) {
        continue;
      }
      upsert(
        step.filePath || step.activityDetail?.file,
        step.diffStats?.added,
        step.diffStats?.deleted,
        1,
        step.activityDetail?.diffExcerpt,
      );
    }

    for (const event of timelineEvents) {
      const hasConcreteChangeEvidence =
        Boolean(event.diffStats) ||
        Boolean(event.activityDetail?.diffExcerpt) ||
        Boolean(event.activityDetail?.file);
      if (!hasConcreteChangeEvidence) {
        continue;
      }
      upsert(
        event.filePath || event.activityDetail?.file,
        event.diffStats?.added,
        event.diffStats?.deleted,
        1,
        event.activityDetail?.diffExcerpt,
      );
    }

    for (const edit of messageEdits) {
      upsert(edit.file, edit.added, edit.deleted, 2);
    }

    for (const item of structuredFileChanges) {
      const excerptLines = Array.isArray(item.diffExcerpt?.lines)
        ? item.diffExcerpt.lines.filter(
            (line): line is string => typeof line === "string" && line.trim().length > 0,
          )
        : [];
      upsert(
        item.file,
        item.diffStats?.added,
        item.diffStats?.deleted,
        3,
        {
          ...item.diffExcerpt,
          lines: excerptLines,
        },
      );
    }

    if (changeSummary && Array.isArray(changeSummary.files)) {
      for (const summaryFile of changeSummary.files) {
        if (!isLikelyFilePath(summaryFile.file)) {
          continue;
        }
        upsert(summaryFile.file, summaryFile.added, summaryFile.deleted, 4);
      }
    }

    return Array.from(byFile.values())
      .map((item) => ({
        file: item.file,
        added: item.added,
        deleted: item.deleted,
        diffExcerpt: item.diffExcerpt,
      }))
      .sort((a, b) => a.file.localeCompare(b.file));
  }, [streamingSteps, timelineEvents, messageEdits, structuredFileChanges, changeSummary]);

  if (fileChanges.length === 0) {
    return null;
  }

  const filesChanged = changeSummary?.filesChanged ?? fileChanges.length;
  const totalAdded =
    typeof changeSummary?.added === "number"
      ? Math.max(0, changeSummary.added)
      : fileChanges.reduce((sum, file) => sum + file.added, 0);
  const totalDeleted =
    typeof changeSummary?.deleted === "number"
      ? Math.max(0, changeSummary.deleted)
      : fileChanges.reduce((sum, file) => sum + file.deleted, 0);

  const visibleChanges = useMemo(() => {
    const ordered: Array<{
      file: string;
      added: number;
      deleted: number;
      diffExcerpt?: DiffExcerpt;
    }> = [];
    const seen = new Set<string>();

    if (changeSummary && Array.isArray(changeSummary.files)) {
      for (const summaryFile of changeSummary.files) {
        if (!isLikelyFilePath(summaryFile.file)) {
          continue;
        }
        const key = normalizePath(summaryFile.file);
        if (seen.has(key)) continue;
        const matched = fileChanges.find((file) => normalizePath(file.file) === key);
        ordered.push({
          file: summaryFile.file,
          added: Math.max(0, summaryFile.added || 0),
          deleted: Math.max(0, summaryFile.deleted || 0),
          diffExcerpt: matched?.diffExcerpt || summaryFile.diffExcerpt,
        });
        seen.add(key);
      }
    }

    for (const change of fileChanges) {
      const key = normalizePath(change.file);
      if (seen.has(key)) continue;
      ordered.push(change);
      seen.add(key);
    }

    return ordered.slice(0, 12);
  }, [changeSummary, fileChanges]);

  const undoMessageId = firstNonEmptyString(changeSummary?.messageId, messageId);

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

  return (
    <div className="rounded-lg border border-oc-border-soft bg-oc-bg overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-sm text-oc-text">
          <FileCode className="h-3.5 w-3.5 shrink-0 oc-readable-accent" />
          <span className="font-medium text-oc-text-soft">
            {filesChanged} {filesChanged === 1 ? "file" : "files"} changed
          </span>
          {(totalAdded > 0 || totalDeleted > 0) && (
            <DiffStats added={totalAdded} deleted={totalDeleted} />
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!undoMessageId}
            className="inline-flex items-center gap-1 rounded border border-oc-border-soft bg-white/[0.03] px-2 py-1 text-xs oc-text-secondary transition-colors hover:border-oc-border hover:bg-white/[0.06] hover:text-oc-text-soft"
            title={
              undoMessageId
                ? "Undo changes from this assistant message"
                : "Undo unavailable: no message identifier for this change set"
            }
          >
            <Undo2 className="h-3 w-3" />
            Undo
          </button>
          <button
            type="button"
            onClick={handleReview}
            className="inline-flex items-center gap-1 rounded border border-oc-border-soft bg-white/[0.03] px-2 py-1 text-xs oc-text-secondary transition-colors hover:border-oc-border hover:bg-white/[0.06] hover:text-oc-text-soft"
          >
            <ArrowUpRight className="h-3 w-3" />
            Review
          </button>
        </div>
      </div>
      <div className="border-t border-oc-border-soft">
        <div className="space-y-0.5 p-1.5">
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
                className="rounded border border-oc-border-soft overflow-hidden transition-colors hover:border-oc-border"
              >
                <div className="flex items-center justify-between px-2.5 py-1.5 hover:bg-white/[0.025] transition-colors">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
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
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </button>
                    <FileText className="h-3 w-3 shrink-0 text-oc-text-soft" />
                    <span className="text-[11px] font-medium text-oc-text truncate">{filename}</span>
                    {compactDirname && (
                      <span className="text-[10px] font-medium text-oc-text-soft truncate hidden sm:inline">
                        {compactDirname}
                      </span>
                    )}
                  </button>

                  <div className="flex items-center gap-1.5 flex-shrink-0 font-medium text-[11px]">
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
                  <div className="border-t border-oc-border-soft px-2.5 py-2 text-xs text-oc-text-soft italic">
                    Diff preview unavailable for this file in the current payload.
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {fileChanges.length > visibleChanges.length ? (
        <div className="border-t border-oc-border-soft px-3 py-1.5 text-[11px] text-oc-text-soft text-center">
          Showing {visibleChanges.length} of {fileChanges.length} changed files
        </div>
      ) : null}
    </div>
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
  const {
    subagentsByParentMessageId,
    subagentDetailsById,
    availableAgents,
    todoItems = [],
  } = useAppState();

  return (
    <AssistantMessageInner
      message={message}
      streaming={streaming}
      isContiguous={isContiguous}
      subagentsByParentMessageId={subagentsByParentMessageId}
      subagentDetailsById={subagentDetailsById}
      availableAgents={availableAgents}
      todoItems={todoItems}
    />
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
      <div className="oc-error flex flex-col gap-2">
        <div className="flex items-center gap-2">
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

export function ThinkingBubble() {
  return (
    <div className="mb-4 px-4">
      <ThinkingStatusTicker className="pl-1 oc-thinking-status" />
    </div>
  );
}

export function EmptyState() {
  const {
    serverStatus,
    serverError,
    receivedInitState,
    currentSessionId,
    messagesBySessionId,
  } = useAppState();

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
      <div className="oc-empty-copy">
        <h1>OpenCode</h1>
        <p>Ask about the workspace, plan a change, or build the next piece.</p>
      </div>

      <div className="oc-empty-shortcuts" aria-label="Chat shortcuts">
        <div className="oc-empty-shortcut">
          <span className="oc-empty-shortcut-icon" aria-hidden="true">
            <CornerDownLeft className="h-3.5 w-3.5" />
          </span>
          <span>Send message</span>
          <kbd>Enter</kbd>
        </div>
        <div className="oc-empty-shortcut">
          <span className="oc-empty-shortcut-icon" aria-hidden="true">
            <AtSign className="h-3.5 w-3.5" />
          </span>
          <span>Mention files</span>
          <kbd>@</kbd>
        </div>
        <div className="oc-empty-shortcut">
          <span className="oc-empty-shortcut-icon" aria-hidden="true">
            <Terminal className="h-3.5 w-3.5" />
          </span>
          <span>Run commands</span>
          <kbd>/</kbd>
        </div>
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
