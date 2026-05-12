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
import { cn, formatDuration } from "@/utils";

import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { ActivityDiffExcerpt } from "./components/ActivityDiffExcerpt";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { SubagentDetailModal } from "./SubagentDetailModal";
import { DiffStats } from "./DiffStats";

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
  SubagentDetail,
  SubagentSummary,
  TodoItem,
} from "./lib/types";
import type { DisplayError } from "../../../../src/providers/chat/types";
import { useAppDispatch, useAppState } from "./lib/store";
import { jumpToMessage } from "./lib/messageJump";
import vscode from "./lib/vscode";

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
        flexShrink: 0,
        marginRight: "4px",
        verticalAlign: "middle",
        width: "16px",
        height: "16px",
        overflow: "hidden",
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
    asRecord(infoRec?.structuredOutput) ||
    asRecord(infoRec?.structured_output);
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

    if (!streamingFinished && hasReasoningEvents) {
      return '';
    }

    return content;
  }
  if (!message) {
    return "";
  }
  const messageRec = asRecord(message);
  const infoRec = asRecord(messageRec?.info);
  const structured = asRecord(messageRec?.structuredOutput) || asRecord(infoRec?.structuredOutput);
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

  // Filter out reasoning/thinking and internal bookkeeping steps
  if (type === "reasoning" || type === "thinking") {
    return false;
  }
  // Filter out step-start and step-finish events (internal bookkeeping)
  if (
    normalizedPartType === "step-start" ||
    normalizedPartType === "step-finish" ||
    type === "step-start" ||
    type === "step-finish"
  ) {
    return false;
  }
  // Filter out tool wrapper events that just show "tool completed successfully"
  // These are internal system events, not actual user-facing progress
  if (type === "tool" && step.title?.toLowerCase().includes("structuredoutput")) {
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

function TodoInlineSummary({ todoItems }: { todoItems: TodoItem[] }) {
  if (todoItems.length === 0) {
    return null;
  }

  const inProgressCount = todoItems.reduce(
    (count, item) => (item.status === "in_progress" ? count + 1 : count),
    0,
  );
  const totalCount = todoItems.length;
  const latest = getLatestTodoTransition(todoItems);

  return (
    <section
      data-assistant-section="todo-inline-summary"
      className="rounded-md border border-oc-border-soft/70 bg-oc-panel-soft/30 px-2.5 py-2"
    >
      <div className="text-[11px] font-medium oc-text-secondary">
        {totalCount} {totalCount === 1 ? "task" : "tasks"} - {inProgressCount} in
        progress
      </div>
      {latest && (
        <div className="mt-0.5 truncate text-[11px] oc-text-secondary">
          Latest: "{truncateTodoLabel(latest.text)}" - {formatTodoStatus(latest.status)}
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

function normalizedUserMessageText(message?: Message): string {
  const raw =
    message?.content ?? message?.text ?? messageBodyFromParts(message?.parts);
  return sanitizeUserContent(typeof raw === "string" ? raw : "");
}

function isPlanProceedMessageContent(value: string): boolean {
  return /\bproceed on this plan\./i.test(value);
}

function isPlanRevisionMessageContent(value: string): boolean {
  return /\brevise this implementation plan\b/i.test(value);
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
  const isError = subagent.status === 'error' || subagent.status === 'orphaned';
  const isTerminal = subagent.status === 'done';

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
  "Generating witty loading messages…",
  "Untangling the spaghetti code…",
  "Asking StackOverflow…",
  "Convincing the compiler to cooperate…",
  "Reversing the polarity…",
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
    }, 2400); // Increased interval for typewriter to complete

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
        rawEvents.push({
          key: `reasoning-${item.key}`,
          kind: "reasoning",
          label: "Reasoning",
          summary: text,
          status: "done",
          source: sourceFromThoughtKey(item.key),
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
      const summary = filePath
        ? fileName || filePath
        : activityDetail?.summary ||
        parsed.summary ||
        metaText ||
        (parsed.label === "event" ? cleanedRawTitle : "");
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

      const cleanedLabel = cleanEventLabel(metadataFirstLabel);

      // Skip filtered events (like starting/finishing)
      if (!cleanedLabel) {
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
  const userMessageRef = useRef<HTMLDivElement>(null);
  const content = normalizedUserMessageText(message);
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

  if (isPlanProceedMessageContent(content)) {
    return (
      <div className="oc-message-enter mb-5 px-4 flex justify-end">
        <div className="flex items-center gap-1.5 rounded-full border border-oc-green/30 bg-oc-green/10 px-3 py-1.5 text-oc-xs text-oc-green">
          <Check className="h-3.5 w-3.5" />
          <span className="font-medium">Plan Approved</span>
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
                    <span className="text-oc-accent font-medium">{match[1]}</span>
                    {match[2]}
                  </>
                );
              }
              return content;
            })()}
          </div>
          {fileChips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {fileChips.map((file) => (
                <span
                  key={file}
                  className="rounded-md border oc-accent-border-faint px-2 py-0.5 text-oc-2xs font-medium text-oc-text-soft opacity-70"
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
                  className="max-h-20 rounded-lg border border-oc-border-soft cursor-zoom-in"
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
  const hideReasoningTimeline = responseType === "implementation_plan";
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
  });
  const hasCompletedCondensedActivity =
    displayEvents.length > MAX_VISIBLE_COMPLETED_ACTIVITY &&
    !viewState.showAllCompletedActivity;
  const visibleDisplayEvents = hasCompletedCondensedActivity
    ? displayEvents.slice(-MAX_VISIBLE_COMPLETED_ACTIVITY)
    : displayEvents;
  const userFacingDisplayEvents = visibleDisplayEvents.filter((event) => {
    if (event.internal) return false;
    if (hideReasoningTimeline && event.kind === "reasoning") return false;
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
  const shouldShowTodoInlineSummary =
    todoItems.length > 0 &&
    (!latestAssistantMessageId || latestAssistantMessageId === messageId);
  const { planStatus, isRevisedPlan } = useMemo(() => {
    let status: "Draft" | "Executing" | "Revision Requested" | undefined;
    let revised = false;

    if (plan) {
      status = "Draft"; // Default
      const msgIndex = state.messages.findIndex(
        (m) => m === message || (messageId && (m.info?.id === messageId || m.id === messageId))
      );

      if (msgIndex !== -1) {
        // Did user ask for a revision before this plan was generated?
        for (let i = msgIndex - 1; i >= 0; i--) {
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
        for (let i = msgIndex + 1; i < state.messages.length; i++) {
          const m = state.messages[i];
          if (m.role === "assistant" && m.plan) {
            break; // Stop checking if a new plan was spawned
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
    const scopedStore = messageId ? (subagentsByParentMessageId[messageId] ?? []) : [];
    const fromStore = scopedStore.filter((subagent: SubagentSummary) => {
      if (!messageId) {
        return true;
      }
      return subagent.parentMessageId === messageId;
    });
    const messageSubagents = Array.isArray(message?.subagents) ? message.subagents : [];
    const fromMessage = messageSubagents.filter((subagent: SubagentSummary) => {
      if (!messageId) {
        return true;
      }
      return subagent.parentMessageId === messageId;
    });

    // Live-stream safety: if finalization temporarily leaves parentMessageId
    // out-of-sync, keep rendering the scoped bucket/message-attached subagents
    // instead of dropping the section until hydration catches up.
    if (fromStore.length === 0 && fromMessage.length === 0) {
      if (scopedStore.length > 0) return scopedStore;
      if (messageSubagents.length > 0) return messageSubagents;
    }

    if (fromStore.length === 0) return fromMessage;
    if (fromMessage.length === 0) return fromStore;

    // Merge: store entries take precedence (more up-to-date), then append
    // message-scoped entries not yet in the store snapshot.
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
  const visibleSubagents = (showAllSubagents ? subagents : subagents.slice(0, 10))
    .filter((subagent: SubagentSummary) => subagent.status !== 'orphaned');

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
                          <span className="text-oc-xs">
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
          {shouldShowTodoInlineSummary && <TodoInlineSummary todoItems={todoItems} />}

          {(displayEvents.length > 0 || showThinkingPlaceholder) && (
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
                      const isLast =
                        index === timelineDisplayEvents.length - 1;
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
                          <ExpandableStep>
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
                                  <button
                                    type="button"
                                    className="oc-refined-file-link"
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
                                    <div
                                      className={cn(
                                        "oc-refined-event-summary",
                                        event.kind === "reasoning" &&
                                        !viewState.showThinkingDetails &&
                                        "line-clamp-2",
                                      )}
                                    >
                                      {event.label === "bash" ? (
                                        <TerminalBlockWithOutput
                                          event={event}
                                          messageContent={content}
                                        />
                                      ) : SEARCH_LABELS.has(event.label) ? (
                                        <SearchBlock
                                          pattern={event.activityDetail?.query || event.summary}
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
                                )}

                                {/* For non-bash events, render description separately */}
                                {event.label !== "bash" && event.description && (
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
                        </StepperItem>
                      );
                    })}
                  </Stepper>

                  {showThinkingPlaceholder && !hasThinkingEvents && (
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

          {subagents.length > 0 && (
            <div className="mt-3 mb-3 overflow-hidden rounded-md border border-oc-border-soft bg-oc-panel-soft">
              <button
                type="button"
                className="w-full border-b border-oc-border-soft px-2.5 py-2 text-left hover:bg-oc-panel"
                onClick={() => setShowSubagents((value) => !value)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-oc-accent" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-oc-text-soft">
                      Spawned Subagents
                    </span>
                    <span className="rounded-md border border-oc-border-soft px-1.5 py-0.5 font-medium text-oc-2xs text-oc-text-soft">
                      {subagents.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {subagentStatusCounts.running > 0 && (
                      <Badge className="h-5 bg-oc-accent/10 px-1.5 text-[10px] oc-tinted-badge-text">
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
                  <div
                    className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1 pb-2"
                    style={{ scrollPaddingBottom: "0.5rem" }}
                  >
                    {visibleSubagents.map((subagent: SubagentSummary) => {
                      const detail = subagentDetailsById[subagent.id] as
                        | SubagentDetail
                        | undefined;
                      const modelInfo = subagentModelLabel(subagent, detail);
                      const cardStyle = getSubagentCardStyle(subagent.id);
                      const accentTextStyle = getSubagentAccentTextStyle(
                        subagent.id,
                      );
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
                            "w-full rounded-md border border-oc-border-soft bg-oc-bg-soft px-2 py-1.5 text-left transition-colors",
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
                                {modelInfo}
                              </span>
                            </div>
                            <span className="font-medium text-oc-2xs oc-text-secondary">
                              {formatDuration(subagent.durationMs ?? 0)}
                            </span>
                          </div>
                          <div className="mt-1 flex min-w-0 items-center gap-1.5">
                            <span className="text-[10px] font-medium oc-text-secondary">
                              {statusText}
                            </span>
                          </div>
                          {shouldShowActivity ? (
                            <div className="mt-0.5 min-h-[14px] font-medium text-[10px] oc-text-secondary">
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
                        className="text-oc-2xs font-medium text-oc-accent hover:underline"
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

              {plan && (
                <div
                  className={
                    hasResponseContent
                      ? "mt-3 pt-3 border-t border-oc-border-soft/30"
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
                          <span className="truncate" title={plan.file}>{plan.file}</span>
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

              {hasRawResponseDebug && (
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
        {((Array.isArray(message?.edits) && message.edits.length > 0 && messageId) ||
          (changeSummary &&
            Array.isArray(changeSummary.files) &&
            changeSummary.files.length > 0 &&
            changeSummary.messageId === messageId)) && (
            <div className="mt-4">
              <FileChangesSection
                streamingSteps={[]}
                timelineEvents={[]}
                messageEdits={message?.edits || []}
                changeSummary={changeSummary}
                messageId={messageId}
              />
            </div>
          )}

        {isStreamingActive && !showResponseSection && hasStreamingActivity && (
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
  changeSummary,
  messageId,
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
  changeSummary?: Message["changeSummary"];
  messageId?: string | null;
}) {
  type DiffExcerpt = { header?: string; lines?: string[]; added?: number; deleted?: number };
  type FileChange = { file: string; added: number; deleted: number; diffExcerpt?: DiffExcerpt };
  type IndexedFileChange = FileChange & { sourcePriority: number };

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
      upsert(
        step.filePath || step.activityDetail?.file || step.title,
        step.diffStats?.added,
        step.diffStats?.deleted,
        1,
        step.activityDetail?.diffExcerpt,
      );
    }

    for (const event of timelineEvents) {
      upsert(
        event.filePath || event.activityDetail?.file || event.summary || event.description,
        event.diffStats?.added,
        event.diffStats?.deleted,
        1,
        event.activityDetail?.diffExcerpt,
      );
    }

    for (const edit of messageEdits) {
      upsert(edit.file, edit.added, edit.deleted, 2);
    }

    if (changeSummary && Array.isArray(changeSummary.files)) {
      for (const summaryFile of changeSummary.files) {
        upsert(summaryFile.file, summaryFile.added, summaryFile.deleted, 3);
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
  }, [streamingSteps, timelineEvents, messageEdits, changeSummary]);

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

  const handleUndo = () => {
    vscode.postMessage({
      type: "undoMessageChanges",
      messageId: changeSummary?.messageId || messageId,
    });
  };

  const handleReview = () => {
    vscode.postMessage({
      type: "reviewMessageChanges",
      files: fileChanges.map((file) => file.file),
    });
  };
  const [expandedByFile, setExpandedByFile] = useState<Record<string, boolean>>({});

  const toggleExpanded = (file: string) => {
    setExpandedByFile((prev) => ({
      ...prev,
      [file]: !prev[file],
    }));
  };

  return (
    <div className="rounded-lg border border-oc-border-soft bg-oc-bg overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-sm text-oc-text">
          <FileCode className="h-3.5 w-3.5 shrink-0 text-oc-accent/80" />
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
            className="inline-flex items-center gap-1 rounded border border-oc-border-soft bg-white/[0.03] px-2 py-1 text-xs oc-text-secondary transition-colors hover:border-oc-border hover:bg-white/[0.06] hover:text-oc-text-soft"
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
            const hasPreview =
              Array.isArray(fileChange.diffExcerpt?.lines) && fileChange.diffExcerpt.lines.length > 0;
            const isExpanded = !!expandedByFile[fileChange.file];
            const filename = fileChange.file.split(/[\\/]/).pop() ?? fileChange.file;
            const dirname = fileChange.file !== filename
              ? fileChange.file.slice(0, fileChange.file.length - filename.length - 1)
              : '';

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
                    {hasPreview ? (
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
                    ) : (
                      <span className="w-3 shrink-0" />
                    )}
                    <FileText className="h-3 w-3 shrink-0 text-oc-text-soft" />
                    <span className="text-[11px] font-medium text-oc-text truncate">{filename}</span>
                    {dirname && (
                      <span className="text-[10px] font-medium text-oc-text-soft truncate hidden sm:inline">
                        {dirname}
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
                        header: fileChange.diffExcerpt?.header,
                        lines: fileChange.diffExcerpt?.lines || [],
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
