import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Edit,
  FileText,
  History,
  Loader2,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Play,
  RefreshCw,
  Search,
  Send,
  Square,
  PanelRightClose,
  PanelRightOpen,
  Trash2,
  WifiOff,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import logger from "./lib/logger";

import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { JsonFormEditor } from "./JsonFormEditor";
import { StepIndicator } from "@/components/ui/StepIndicator";
import { formatDuration } from "../utils";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { shallowEqual, useAppDispatch, useAppState } from "./lib/store";
import { PENDING_CURRENT_SESSION_KEY } from "./lib/pendingUserMessages";
import vscode from "./lib/vscode";
import type {
  InteractiveEvent,
  InteractiveQuickActionsEvent,
  Message,
  SlashCommand,
  StreamingState,
  ThinkingLevel,
  TodoItem,
  FileResult,
  MentionResult,
  ContextItem,
  Model,
} from "./lib/types";
import {
  isProcessingInCurrentSession,
  shouldDeferComposerSendInCurrentSession,
} from "./lib/sessionProcessing";

import { FileIcon } from "./MessageComponents";

const EMPTY_DISMISSED_INTERACTIVE_EVENT_KEYS = new Set<string>();

function messageTokenStats(message: Message): {
  input: number;
  output: number;
  read: number;
  write: number;
} {
  return {
    input: message.tokens?.input || message.info?.tokens?.input || 0,
    output: message.tokens?.output || message.info?.tokens?.output || 0,
    read: message.tokens?.cache?.read || message.info?.tokens?.cache?.read || 0,
    write:
      message.tokens?.cache?.write || message.info?.tokens?.cache?.write || 0,
  };
}

function contextChipDisplayParts(context: ContextItem): {
  displayName: string;
  lineSuffix: string;
} {
  const rawLabel = context.file.startsWith("resource:")
    ? context.file.replace("resource:", "")
    : context.file;
  const segments = rawLabel.split(/[\\/]/);
  const displayName = segments[segments.length - 1] || rawLabel;
  const normalizedLineInfo = typeof context.lineInfo === "string" ? context.lineInfo.trim() : "";

  return {
    displayName,
    lineSuffix: normalizedLineInfo
      ? `:${normalizedLineInfo.replace(/^:+/, "")}`
      : "",
  };
}

function CircularProgress({
  pct,
  size = 16,
  strokeWidth = 2.5,
}: {
  pct: number;
  size?: number;
  strokeWidth?: number;
}) {
  const normalizedPct = Math.max(0, Math.min(100, pct));
  const visiblePct = normalizedPct === 0 ? 2 : normalizedPct;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (visiblePct / 100) * circumference;
  const trackColor = "color-mix(in srgb, var(--oc-text) 30%, transparent)";
  const strokeColor =
    normalizedPct > 90
      ? "var(--oc-red)"
      : normalizedPct > 75
        ? "var(--oc-yellow)"
        : "var(--vscode-charts-blue, color-mix(in srgb, var(--oc-text) 72%, var(--oc-accent)))";

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
      title={`Context usage: ${Math.round(normalizedPct)}%`}
      aria-label={`Context usage: ${Math.round(normalizedPct)}%`}
    >
      <svg
        width={size}
        height={size}
        className="-rotate-90"
        viewBox={`0 0 ${size} ${size}`}
      >
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* Progress fill */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{
            color: strokeColor,
            opacity: normalizedPct === 0 ? 0.55 : 1,
          }}
          className="transition-all duration-700 ease-in-out"
        />
      </svg>
      {/* Glow effect for high usage */}
      {pct > 80 && (
        <div
          className="absolute inset-0 rounded-full blur-[4px] opacity-40 animate-pulse"
          style={{ backgroundColor: strokeColor }}
        />
      )}
    </div>
  );
}

// Regex to match @filename references (shared between components)
export const FILE_MENTION_REGEX = /@([a-zA-Z0-9_\-./\\]+[a-zA-Z0-9])/g;

/**
 * Resolves file mentions selected from the @ autocomplete into the same
 * context payload used by explicit file attachments. The message retains its
 * @path text for the model, while the extension host turns these contexts
 * into SDK `file` parts containing the referenced file's content.
 */
export function resolveMentionedFileContexts(
  text: string,
  selectedContexts: ContextItem[],
  fileMentionPaths: Record<string, string>,
): ContextItem[] | undefined {
  const contexts = [...selectedContexts];
  const attachedPaths = new Set(contexts.map((context) => context.file));

  for (const match of text.matchAll(FILE_MENTION_REGEX)) {
    const mention = match[1];
    const filePath = fileMentionPaths[mention];
    if (!filePath || attachedPaths.has(filePath)) {
      continue;
    }

    contexts.push({
      file: filePath,
      lineInfo: "",
      content: "",
    });
    attachedPaths.add(filePath);
  }

  return contexts.length > 0 ? contexts : undefined;
}

type SlashTrigger = {
  query: string;
  replaceFrom: number;
  replaceTo: number;
};

function getSlashTrigger(input: string, cursor: number): SlashTrigger | null {
  if (cursor < 0 || cursor > input.length) {
    return null;
  }

  const beforeCursor = input.slice(0, cursor);
  const slashIndex = beforeCursor.lastIndexOf("/");
  if (slashIndex < 0) {
    return null;
  }

  // If the slash is too far away, it's not a slash command.
  if (cursor - slashIndex > 100) {
    return null;
  }

  // Trigger slash commands only when "/" starts a token (start or whitespace).
  if (slashIndex > 0 && !/\s/.test(beforeCursor[slashIndex - 1])) {
    return null;
  }

  const token = beforeCursor.slice(slashIndex + 1);
  if (/\s/.test(token)) {
    return null;
  }

  return {
    query: token,
    replaceFrom: slashIndex,
    replaceTo: cursor,
  };
}

export type MentionTrigger = {
  query: string;
  replaceFrom: number;
  replaceTo: number;
};

export function getMentionTrigger(input: string, cursor: number): MentionTrigger | null {
  if (cursor < 0 || cursor > input.length) {
    return null;
  }

  const beforeCursor = input.slice(0, cursor);
  const mentionIndex = beforeCursor.lastIndexOf("@");
  if (mentionIndex < 0) {
    return null;
  }

  // If the @ is too far away, it's not a mention.
  if (cursor - mentionIndex > 100) {
    return null;
  }

  // Trigger @ mentions only when "@" starts a token (start or whitespace).
  if (mentionIndex > 0 && !/\s/.test(beforeCursor[mentionIndex - 1])) {
    return null;
  }

  const token = beforeCursor.slice(mentionIndex + 1);
  if (/\s/.test(token)) {
    return null;
  }

  return {
    query: token,
    replaceFrom: mentionIndex,
    replaceTo: cursor,
  };
}

function isExecutingQueueInCurrentSession(
  isExecutingQueue: boolean,
  currentSessionId: string | null,
  executingQueueSessionIds: Set<string>,
): boolean {
  if (!isExecutingQueue) {
    return false;
  }
  if (!currentSessionId) {
    return isExecutingQueue;
  }
  if (!executingQueueSessionIds || executingQueueSessionIds.size === 0) {
    return false;
  }
  return executingQueueSessionIds.has(currentSessionId);
}

function isQuickInputInteractiveEvent(event: InteractiveEvent): boolean {
  if (event.uiCategory === "quick_input") {
    return true;
  }
  if (event.uiCategory === "passive") {
    return false;
  }
  return (
    event.type === "question" ||
    event.type === "quick_actions" ||
    event.type === "confirm"
  );
}

function getInteractiveEventDismissalKeys(event: InteractiveEvent): string[] {
  const keys = new Set<string>();
  const id = typeof event.id === "string" ? event.id.trim() : "";
  if (id) {
    keys.add(`id:${id}`);
  }

  // Permission requests need per-request dismissal only. A generic fallback
  // such as `quick_actions:allow read` would suppress every later read
  // permission after the user rejected or aborted just one of them.
  if (event.type === "quick_actions" && event.permissionID) {
    return [...keys];
  }

  const prompt =
    event.type === "question" || event.type === "confirm"
      ? event.question
      : event.type === "quick_actions"
        ? event.title
        : event.type === "message"
          ? event.message
          : event.title;
  const normalizedPrompt = (prompt || "").trim().toLowerCase();
  if (normalizedPrompt) {
    keys.add(`fallback:${event.type}:${normalizedPrompt}`);
  }

  return [...keys];
}

function filterDismissedInteractiveEvents(
  events: InteractiveEvent[],
  dismissedInteractiveEventKeys: Set<string>,
): InteractiveEvent[] {
  if (
    !Array.isArray(events) ||
    events.length === 0 ||
    !(dismissedInteractiveEventKeys instanceof Set) ||
    dismissedInteractiveEventKeys.size === 0
  ) {
    return events;
  }

  return events.filter(
    (event) =>
      !getInteractiveEventDismissalKeys(event).some((key) =>
        dismissedInteractiveEventKeys.has(key),
      ),
  );
}

export const StickyHeader = memo(function StickyHeader() {
  const {
    currentSessionId,
    isSessionModalOpen,
    isExtendedPanelOpen,
    isProcessing: globalIsProcessing,
    processingSessionIds,
    sessionsList,
    contextUsagePct,
  } = useAppState(
    (state) => ({
      currentSessionId: state.currentSessionId,
      isSessionModalOpen: state.isSessionModalOpen,
      isExtendedPanelOpen: state.isExtendedPanelOpen,
      isProcessing: state.isProcessing,
      processingSessionIds: state.processingSessionIds,
      sessionsList: state.sessionsList,
      contextUsagePct: state.contextUsagePct,
    }),
    shallowEqual,
  );
  const dispatch = useAppDispatch();

  const currentSession = currentSessionId
    ? sessionsList.find((s) => s.id === currentSessionId)
    : undefined;
  const sessionTitle = currentSession?.title || "Untitled chat";
  const hasContextUsage =
    typeof contextUsagePct === "number" && Number.isFinite(contextUsagePct);

  return (
    <div className="oc-header sticky top-0 z-10 flex items-center justify-between border-b border-oc-border-soft px-3 py-1.5 text-xs">
      {/* Left side: Context indicator + Session title */}
      <div className={`oc-header-left flex items-center min-w-0 ${hasContextUsage ? "gap-2" : "gap-0"}`}>
        {hasContextUsage ? (
          <CircularProgress pct={contextUsagePct} size={18} strokeWidth={2.5} />
        ) : null}
        <span className="oc-title text-sm font-medium truncate">{sessionTitle}</span>
      </div>

      {/* Right side: Action buttons */}
      <div className="oc-header-right flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="oc-history-btn h-7 w-7"
          title="View sessions"
          aria-label="Open session history"
          onClick={() =>
            dispatch({ type: "SET_SESSION_MODAL_OPEN", payload: !isSessionModalOpen })
          }
        >
          <History className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="oc-new-chat-btn h-7 w-7"
          title="Create new session"
          aria-label="Create new chat session"
          onClick={() => vscode.postMessage({ type: "createSession" })}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="oc-extended-panel-btn h-7 w-7 [@media(min-width:1100px)]:hidden"
          title={isExtendedPanelOpen ? "Collapse extended panel" : "Expand extended panel"}
          aria-label={isExtendedPanelOpen ? "Collapse extended panel" : "Expand extended panel"}
          onClick={() =>
            dispatch({
              type: "SET_EXTENDED_PANEL_OPEN",
              payload: !isExtendedPanelOpen,
            })
          }
        >
          {isExtendedPanelOpen ? (
            <PanelRightClose className="h-3.5 w-3.5" />
          ) : (
            <PanelRightOpen className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
});

export const HistorySidebar = memo(function HistorySidebar() {
  const {
    isSidebarOpen,
  } = useAppState(
    (state) => ({ isSidebarOpen: state.isSidebarOpen }),
    shallowEqual,
  );
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (isSidebarOpen) {
      // Could add focus management here if needed
    }
  }, [isSidebarOpen]);

  return (
    <aside
      className={`oc-history-sidebar absolute bottom-0 left-0 top-0 z-20 flex w-[280px] flex-col border-r border-oc-border bg-oc-bg-soft transition-transform duration-200 ease-in-out ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      style={{ boxShadow: isSidebarOpen ? "4px 0 24px rgba(0,0,0,0.18)" : "none" }}
    >
      <div className="flex shrink-0 items-center justify-between px-3.5 pt-3.5 pb-2">
        <div className="flex items-center gap-2">
          <History className="h-3.5 w-3.5 text-oc-accent" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] oc-text-secondary">
            History
          </span>
        </div>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-md oc-text-secondary transition-colors hover:bg-oc-border hover:text-oc-text"
          aria-label="Close history sidebar"
          onClick={() => dispatch({ type: "SET_SIDEBAR_OPEN", payload: false })}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mx-3 mb-1 h-px bg-oc-border" />

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 pt-1">
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
          <History className="h-8 w-8 text-[var(--oc-text-secondary)] opacity-80" />
          <p className="text-[11px] oc-text-secondary">Session management moved</p>
          <p className="text-[10px] oc-text-secondary opacity-70">
            Use the session modal to switch, create, or manage sessions
          </p>
          <button
            type="button"
            className="oc-accent-soft-action mt-2 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all"
            onClick={() => {
              vscode.postMessage({ type: "openSessionModal" });
            }}
          >
            Open Sessions
          </button>
        </div>
      </div>
    </aside>
  );
});

// ─── MiniSection ──────────────────────────────────────────────────────────────
function MiniSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useMiniSectionState(defaultOpen);
  return (
    <section className="oc-panel-section oc-inspector-section mb-1.5 overflow-hidden p-0">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="oc-inspector-section-toggle flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs rounded-none"
      >
        <span
          className={`font-medium text-xs uppercase tracking-widest font-semibold ${open
              ? "text-[var(--oc-text-soft)]"
              : "text-[var(--oc-text-soft)] opacity-70"
            }`}
        >
          {title}
        </span>
        <span
          className={`ml-auto transition-transform ${open ? "rotate-0" : "-rotate-90"
            }`}
        >
          <ChevronDown className="h-3 w-3 text-[var(--oc-text-soft)] opacity-70" />
        </span>
      </Button>
      {open && <div className="oc-inspector-section-content px-2.5 pb-2.5 pt-1.5">{children}</div>}
    </section>
  );
}

// tiny hook so we don't need useState import twice
function useMiniSectionState(def: boolean) {
  return useState(def);
}

const TODO_STATUS_RANK: Record<TodoItem["status"], number> = {
  in_progress: 0,
  pending: 1,
  failed: 2,
  cancelled: 3,
  completed: 4,
};

function todoStatusLabel(status: TodoItem["status"]) {
  switch (status) {
    case "in_progress":
      return "In progress";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "pending":
    default:
      return "Pending";
  }
}

function todoPriorityTone(priority?: TodoItem["priority"]) {
  switch (priority) {
    case "high":
      return "text-oc-red border-transparent bg-oc-red/10 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-red)_14%,transparent)]";
    case "medium":
      return "oc-quota-warning border-transparent bg-oc-quota-warning-bg shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-yellow)_14%,transparent)]";
    case "low":
      return "text-[var(--oc-text-soft)] border-transparent bg-oc-panel-soft shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-text)_10%,transparent)]";
    default:
      return "text-[var(--oc-text-soft)] border-transparent bg-oc-panel-soft shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-text)_10%,transparent)]";
  }
}

function TodoChecklistIcon({ status }: { status: TodoItem["status"] }) {
  switch (status) {
    case "completed":
      return (
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-oc-green/15 text-oc-green">
          <Check className="h-3 w-3" />
        </span>
      );
    case "in_progress":
      return (
        <span className="flex h-4 w-4 items-center justify-center rounded-full border border-oc-green/45 text-oc-green">
          <RefreshCw className="h-2.5 w-2.5 animate-spin" />
        </span>
      );
    case "failed":
      return (
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-oc-red/10 text-oc-red">
          <AlertCircle className="h-3 w-3" />
        </span>
      );
    case "cancelled":
      return (
        <span className="flex h-4 w-4 items-center justify-center rounded-full border border-oc-border text-[var(--oc-text-soft)]">
          <X className="h-3 w-3" />
        </span>
      );
    case "pending":
    default:
      return (
        <span className="flex h-4 w-4 items-center justify-center rounded-full border border-oc-border-soft text-[var(--oc-text-soft)]">
          <MoreHorizontal className="h-3 w-3" />
        </span>
      );
  }
}

// ─── ActiveTaskPanel ──────────────────────────────────────────────────────────
export const ActiveTaskPanel = memo(function ActiveTaskPanel() {
  const {
    sessionStats,
    streaming,
    todoItems,
    messages,
    currentSessionId,
    sessionsList,
    availableModels,
    selectedModel,
    isProcessing: isProcessingGlobal,
    processingSessionIds,
    executingQueueSessionIds,
    isCompacting,
    lastCompactedAt,
    compactionError,
    compactionNotice,
    compactionBaselineStats,
    compactionDividerIndex,
    sdkVersion,
    serverVersion,
    contextInputTokens,
    contextUsagePct,
  } = useAppState(
    (state) => ({
      sessionStats: state.sessionStats,
      streaming: state.streaming,
      todoItems: state.todoItems,
      messages: state.messages,
      currentSessionId: state.currentSessionId,
      sessionsList: state.sessionsList,
      availableModels: state.availableModels,
      selectedModel: state.selectedModel,
      isProcessing: state.isProcessing,
      processingSessionIds: state.processingSessionIds,
      executingQueueSessionIds: state.executingQueueSessionIds,
      isCompacting: state.isCompacting,
      lastCompactedAt: state.lastCompactedAt,
      compactionError: state.compactionError,
      compactionNotice: state.compactionNotice,
      compactionBaselineStats: state.compactionBaselineStats,
      compactionDividerIndex: state.compactionDividerIndex,
      sdkVersion: state.sdkVersion,
      serverVersion: state.serverVersion,
      contextInputTokens: state.contextInputTokens,
      contextUsagePct: state.contextUsagePct,
    }),
    shallowEqual,
  );

  const isProcessing = isProcessingInCurrentSession(
    isProcessingGlobal,
    currentSessionId,
    processingSessionIds,
  );

  const isExecutingQueue = isExecutingQueueInCurrentSession(
    false,
    currentSessionId,
    executingQueueSessionIds,
  );
  const runtimeSdkVersion = sdkVersion || "-";
  const runtimeTuiVersion = serverVersion || "Loading…";
  const progressListRef = useRef<HTMLDivElement>(null);

  const selectedModelContextLimit = useMemo(() => {
    if (!selectedModel) {
      return undefined;
    }
    const matched = availableModels.find(
      (model) =>
        model.providerID === selectedModel.providerID &&
        model.modelID === selectedModel.modelID,
    );
    const limit = matched?.contextLimit;
    return typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : undefined;
  }, [availableModels, selectedModel]);

  const safeCompactionDividerIndex =
    typeof compactionDividerIndex === "number"
      ? Math.max(0, Math.min(compactionDividerIndex, messages.length))
      : undefined;

  const derivedCompactionBaselineStats = useMemo(() => {
    const baseline = { input: 0, output: 0, read: 0, write: 0 };
    if (
      safeCompactionDividerIndex === undefined ||
      safeCompactionDividerIndex <= 0
    ) {
      return baseline;
    }
    for (let i = 0; i < safeCompactionDividerIndex; i += 1) {
      const stats = messageTokenStats(messages[i]);
      baseline.input += stats.input;
      baseline.output += stats.output;
      baseline.read += stats.read;
      baseline.write += stats.write;
    }
    return baseline;
  }, [messages, safeCompactionDividerIndex]);

  const effectiveCompactionBaselineStats = useMemo(
    () =>
      compactionBaselineStats
        ? {
          input: compactionBaselineStats.input,
          output: compactionBaselineStats.output,
          read: compactionBaselineStats.read,
          write: compactionBaselineStats.write,
        }
        : derivedCompactionBaselineStats,
    [compactionBaselineStats, derivedCompactionBaselineStats],
  );

  const contextStats = useMemo(
    () => ({
      input: Math.max(
        0,
        sessionStats.input - effectiveCompactionBaselineStats.input,
      ),
      output: Math.max(
        0,
        sessionStats.output - effectiveCompactionBaselineStats.output,
      ),
      read: Math.max(
        0,
        sessionStats.read - effectiveCompactionBaselineStats.read,
      ),
      write: Math.max(
        0,
        sessionStats.write - effectiveCompactionBaselineStats.write,
      ),
    }),
    [sessionStats, effectiveCompactionBaselineStats],
  );

  const maxContext = selectedModelContextLimit ?? 128_000;
  const usingContextFallback = selectedModelContextLimit === undefined;
  // This must remain SDK-backed. `tokens.input` is the actual context passed
  // to the model for the latest request; sessionStats is cumulative usage and
  // cannot accurately describe the current context window.
  const contextUsedTokens = contextInputTokens ?? 0;
  const pct =
    typeof contextUsagePct === "number" && Number.isFinite(contextUsagePct)
      ? Math.max(0, Math.min(100, Math.round(contextUsagePct)))
      : contextUsedTokens > 0
        ? Math.min(100, Math.round((contextUsedTokens / maxContext) * 100))
        : 0;
  const hasCompactionBaseline =
    !!compactionBaselineStats ||
    (typeof safeCompactionDividerIndex === "number" &&
      safeCompactionDividerIndex > 0);

  const compactDisabled = !currentSessionId || isProcessing || isCompacting;
  const compactedAtLabel =
    typeof lastCompactedAt === "number"
      ? new Date(lastCompactedAt).toLocaleTimeString()
      : "";

  // Session info
  const messageCount = messages.length;
  const isActive = !!streaming?.isActive;

  const currentSession = currentSessionId
    ? sessionsList.find((s) => s.id === currentSessionId)
    : undefined;
  const startedLabel = currentSession?.createdAt
    ? new Date(currentSession.createdAt).toLocaleString()
    : "—";

  // Derive live progress steps from streaming state.
  // Exclude reasoning-type steps and "thinking" title rows (same logic as MessageComponents).
  const liveProgressSteps = useMemo(() => {
    const source =
      Array.isArray(streaming?.progressEvents) &&
        streaming.progressEvents.length > 0
        ? streaming.progressEvents
        : Array.isArray(streaming?.steps)
          ? streaming.steps
          : [];
    const seen = new Set<string>();
    return source.filter((step) => {
      const type = (step.type ?? "").toLowerCase();
      if (type === "reasoning" || type === "thinking") return false;
      const title = step.title.trim().toLowerCase();
      const compactTitle = title.replace(/\s+/g, "");
      if (
        compactTitle.includes("structuredoutput") ||
        compactTitle.includes("structured_output") ||
        compactTitle === "invalid" ||
        compactTitle === "runninginvalid" ||
        compactTitle === "processinginvalid"
      ) {
        return false;
      }
      if (title === "thinking..." || title === "thinking") return false;
      if (title === "starting step" || title === "finishing step") return false;
      const key = `${step.title}-${step.status ?? "pending"}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  }, [streaming?.progressEvents, streaming?.steps]);

  // Latest reasoning snippet shown when the AI is thinking but no steps have arrived yet.
  const latestReasoningSnippet = useMemo(() => {
    if (!streaming?.isActive) return "";
    const events = streaming.reasoningEvents;
    if (!Array.isArray(events) || events.length === 0) return "";
    const last = events[events.length - 1]?.text ?? "";
    return last.slice(0, 80);
  }, [streaming?.isActive, streaming?.reasoningEvents]);

  const progressStepCount = liveProgressSteps.length;
  const sortedTodoItems = useMemo(
    () =>
      [...(todoItems || [])].sort(
        (left, right) =>
          (TODO_STATUS_RANK[left.status] ?? 9) -
          (TODO_STATUS_RANK[right.status] ?? 9),
      ),
    [todoItems],
  );
  const completedTodoCount = sortedTodoItems.filter(
    (todo) => todo.status === "completed",
  ).length;

  // Auto-scroll the progress list to the bottom when new steps arrive.
  useEffect(() => {
    if (progressStepCount === 0) return;
    if (progressListRef.current) {
      progressListRef.current.scrollTop = progressListRef.current.scrollHeight;
    }
  }, [progressStepCount]);

  return (
    <div className="oc-active-task-panel flex flex-col w-full bg-oc-bg-soft">
      <div className="oc-active-task-content">
        {sortedTodoItems.length > 0 ? (
          <MiniSection title="Active Task">
            <div className="mb-2 flex items-center justify-between text-[11px] oc-text-secondary">
              <span className="font-medium">
                {completedTodoCount} / {sortedTodoItems.length} done
              </span>
            </div>
            <div className="space-y-1.5">
              {sortedTodoItems.map((todo) => {
                const isDone = todo.status === "completed";
                return (
                  <div
                    key={todo.id}
                    className="flex items-start gap-2 rounded-md border border-oc-border bg-oc-bg-soft px-2 py-1.5 text-xs"
                  >
                    <span className="mt-0.5 shrink-0">
                      <TodoChecklistIcon status={todo.status} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`break-words leading-relaxed ${isDone
                            ? "text-[var(--oc-text-soft)] line-through opacity-70"
                            : "text-[var(--oc-text-soft)]"
                          }`}
                      >
                        {todo.description ?? todo.content ?? todo.text ?? "Untitled task"}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded border border-oc-border bg-oc-panel-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--oc-text-soft)]">
                          {todoStatusLabel(todo.status)}
                        </span>
                        {todo.priority ? (
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${todoPriorityTone(
                              todo.priority,
                            )}`}
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
          </MiniSection>
        ) : null}
        {/* ── Progress Updates: shown only while streaming is active ── */}
        {isActive && (
          <MiniSection title="Progress Updates">
            {liveProgressSteps.length === 0 ? (
              <div className="flex items-center gap-1.5 py-0.5 text-xs oc-text-secondary opacity-70">
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-oc-accent"
                  style={{ animationDelay: "0ms" }}
                />
                <span className="truncate">
                  {latestReasoningSnippet
                    ? latestReasoningSnippet
                    : "Thinking…"}
                </span>
              </div>
            ) : (
              <div
                ref={progressListRef}
                className="space-y-0.5 max-h-[200px] overflow-y-auto pr-1"
              >
                {liveProgressSteps.map((step, idx) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: steps are append-only during a stream
                    key={`progress-${idx}-${step.title}`}
                    className="flex items-start gap-1.5 py-0.5 text-xs"
                  >
                    <span className="mt-px shrink-0">
                      <StepIndicator status={step.status ?? 'pending'} />
                    </span>
                    <span
                      className={`min-w-0 flex-1 leading-relaxed ${step.status === "pending"
                          ? "text-oc-text"
                          : "text-[var(--oc-text-soft)] opacity-80"
                        }`}
                    >
                      <span className="block break-words whitespace-pre-wrap">
                        {step.title}
                      </span>
                      {step.meta ? (
                        <span className="mt-0.5 block oc-text-secondary opacity-60 break-words whitespace-pre-wrap">
                          {step.meta}
                        </span>
                      ) : null}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </MiniSection>
        )}

        {/* Context usage and SDK-backed session compaction controls. */}
        {(
          <MiniSection title="Context">
            {/* Token usage bar */}
            <div className="oc-inspector-context-summary mb-2 rounded-md border border-oc-border-soft bg-oc-panel-soft p-2 transition-colors hover:border-oc-border">
              <div className="mb-1.5 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-[var(--oc-text-soft)] uppercase tracking-wider opacity-90">
                      Tokens Used
                    </span>
                    {hasCompactionBaseline && (
                      <span className="rounded-full bg-oc-border px-1.5 py-0.5 text-[9px] uppercase tracking-widest oc-text-secondary">
                        Since compact
                      </span>
                    )}
                  </div>
                  <div
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums tracking-wider ${pct > 90
                        ? "oc-context-critical"
                        : pct > 75
                          ? "oc-context-warning"
                          : "oc-context-healthy"
                      }`}
                  >
                    {pct}%
                  </div>
                </div>
                <div className="flex items-center gap-1.5 opacity-80">
                  <span className="font-medium tabular-nums text-[10px] text-[var(--oc-text-soft)]">
                    {contextUsedTokens.toLocaleString()} /{" "}
                    <span
                      title={
                        usingContextFallback
                          ? "Context limit is estimated; model metadata unavailable"
                          : undefined
                      }
                      className={
                        usingContextFallback
                          ? "underline decoration-oc-border decoration-dashed underline-offset-2 cursor-help"
                          : ""
                      }
                    >
                      {maxContext.toLocaleString()}
                    </span>
                  </span>
                  {usingContextFallback && (
                    <span className="text-[10px] oc-text-secondary">~est</span>
                  )}
                </div>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-oc-border shadow-inner">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${pct}%`,
                    background:
                      pct > 80
                        ? "linear-gradient(90deg, #f0883e, #f85149)"
                        : pct > 50
                          ? "linear-gradient(90deg, #d29922, #f0883e)"
                          : "linear-gradient(90deg, var(--oc-accent-soft), var(--oc-accent))",
                  }}
                />
              </div>
            </div>

            {/* Compaction Controls */}
            <div className="oc-inspector-compaction mb-2 rounded-md border border-oc-border-soft bg-oc-panel-soft px-2.5 py-1.5 transition-colors hover:border-oc-border">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider font-medium text-[var(--oc-text-soft)] opacity-90">
                    Session Compaction
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {!isCompacting && compactedAtLabel ? (
                    <span className="rounded-full bg-oc-border-soft px-1.5 py-0.5 text-[9px] font-medium tracking-wider oc-text-secondary opacity-80">
                      {compactedAtLabel}
                    </span>
                  ) : null}
                  {isCompacting ? (
                    <span className="animate-pulse rounded-full bg-oc-accent-soft px-1.5 py-0.5 text-[9px] font-medium text-oc-accent">
                      Compacting...
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    variant="chip"
                    size="chip"
                    className="h-5 px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
                    disabled={compactDisabled}
                    onClick={() =>
                      vscode.postMessage({
                        type: "compactSession",
                        ...(currentSessionId ? { sessionId: currentSessionId } : {}),
                        baselineStats: {
                          input: Math.max(0, Math.floor(sessionStats.input || 0)),
                          output: Math.max(0, Math.floor(sessionStats.output || 0)),
                          read: Math.max(0, Math.floor(sessionStats.read || 0)),
                          write: Math.max(0, Math.floor(sessionStats.write || 0)),
                          duration: Math.max(
                            0,
                            Math.floor(sessionStats.duration || 0),
                          ),
                        },
                      })
                    }
                  >
                    Compact
                  </Button>
                </div>
              </div>
              {!isCompacting && compactionError ? (
                <div className="mt-1 text-[10px] text-oc-red font-medium">
                  {compactionError}
                </div>
              ) : null}
              {!isCompacting && !compactionError && compactionNotice ? (
                <div className="mt-1 text-[10px] oc-text-secondary">
                  {compactionNotice}
                </div>
              ) : null}
            </div>


            {/* Detailed Token Stats */}
            <div className="oc-inspector-stat-grid grid grid-cols-2 gap-1.5 text-xs">
              <div className="oc-inspector-stat flex flex-col gap-0.5 rounded-md border border-oc-border-soft bg-oc-panel-soft p-1.5 transition-colors hover:border-oc-border">
                <span className="text-[9px] uppercase tracking-wider text-[var(--oc-text-soft)] opacity-70">Input</span>
                <span className="font-semibold tabular-nums text-[var(--oc-text-soft)]">
                  {contextStats.input.toLocaleString()}
                </span>
              </div>
              <div className="oc-inspector-stat flex flex-col gap-0.5 rounded-md border border-oc-border-soft bg-oc-panel-soft p-1.5 transition-colors hover:border-oc-border">
                <span className="text-[9px] uppercase tracking-wider text-[var(--oc-text-soft)] opacity-70">Output</span>
                <span className="font-semibold tabular-nums text-[var(--oc-text-soft)]">
                  {contextStats.output.toLocaleString()}
                </span>
              </div>
              <div className="oc-inspector-stat flex flex-col gap-0.5 rounded-md border border-oc-border-soft bg-oc-panel-soft p-1.5 transition-colors hover:border-oc-border">
                <span className="text-[9px] uppercase tracking-wider text-[var(--oc-text-soft)] opacity-70">Cache hits</span>
                <span
                  className={`font-semibold tabular-nums transition-colors duration-300 ${contextStats.read > 0
                      ? "text-oc-green"
                      : "text-[var(--oc-text-soft)]"
                    }`}
                >
                  {contextStats.read.toLocaleString()}
                </span>
              </div>
              <div className="oc-inspector-stat flex flex-col gap-0.5 rounded-md border border-oc-border-soft bg-oc-panel-soft p-1.5 transition-colors hover:border-oc-border">
                <span className="text-[9px] uppercase tracking-wider text-[var(--oc-text-soft)] opacity-70">
                  Cache writes
                </span>
                <span className="font-semibold tabular-nums text-[var(--oc-text-soft)]">
                  {contextStats.write.toLocaleString()}
                </span>
              </div>
              <div className="oc-inspector-stat col-span-2 flex items-center justify-between rounded-md border border-oc-border-soft bg-oc-panel-soft px-2 py-1.5 transition-colors hover:border-oc-border">
                <span className="text-[9px] uppercase tracking-wider text-[var(--oc-text-soft)] opacity-70">Duration</span>
                <span className="font-semibold tabular-nums text-[var(--oc-text-soft)]">
                  {formatDuration(sessionStats.duration)}
                </span>
              </div>
            </div>
          </MiniSection>
        )}

        <MiniSection title="Runtime">
          <div className="oc-inspector-data-list flex flex-col gap-1.5 text-xs">
            <div className="oc-inspector-data-row flex items-center justify-between rounded-md border border-oc-border-soft bg-oc-panel-soft px-2 py-1.5 transition-colors hover:border-oc-border">
              <span className="text-[10px] uppercase tracking-wider font-medium text-[var(--oc-text-soft)] opacity-90">
                OpenCode TUI
              </span>
              <span className="font-mono text-[10px] font-medium text-[var(--oc-text-soft)] opacity-70">
                {runtimeTuiVersion}
              </span>
            </div>
            <div className="oc-inspector-data-row flex items-center justify-between rounded-md border border-oc-border-soft bg-oc-panel-soft px-2 py-1.5 transition-colors hover:border-oc-border">
              <span className="text-[10px] uppercase tracking-wider font-medium text-[var(--oc-text-soft)] opacity-90">
                OpenCode SDK
              </span>
              <span className="font-mono text-[10px] font-medium text-[var(--oc-text-soft)] opacity-70">
                {runtimeSdkVersion}
              </span>
            </div>
          </div>
        </MiniSection>

        <MiniSection title="Session">
          <div className="oc-inspector-session-grid grid grid-cols-2 gap-1.5 text-xs">
            <div className="oc-inspector-data-row col-span-2 flex items-center justify-between rounded-md border border-oc-border-soft bg-oc-panel-soft px-2 py-1.5 transition-colors hover:border-oc-border">
              <span className="text-[10px] uppercase tracking-wider font-medium text-[var(--oc-text-soft)] opacity-90">ID</span>
              <span className="font-mono text-[10px] font-medium text-[var(--oc-text-soft)] opacity-70">
                {currentSessionId ? currentSessionId.slice(0, 16) : "—"}
              </span>
            </div>
            <div className="oc-inspector-stat flex flex-col gap-0.5 rounded-md border border-oc-border-soft bg-oc-panel-soft p-1.5 transition-colors hover:border-oc-border">
              <span className="text-[9px] uppercase tracking-wider text-[var(--oc-text-soft)] opacity-70">
                Messages
              </span>
              <span className="font-semibold tabular-nums text-[var(--oc-text-soft)]">
                {messageCount}
              </span>
            </div>
            <div className="oc-inspector-stat flex flex-col gap-0.5 rounded-md border border-oc-border-soft bg-oc-panel-soft p-1.5 transition-colors hover:border-oc-border">
              <span className="text-[9px] uppercase tracking-wider text-[var(--oc-text-soft)] opacity-70">
                Status
              </span>
              <span
                className={`font-semibold text-[10px] uppercase tracking-wider ${isActive
                    ? "text-oc-accent animate-pulse"
                    : "text-[var(--oc-text-soft)] opacity-70"
                  }`}
              >
                {isActive ? "ACTIVE" : "IDLE"}
              </span>
            </div>
            <div className="oc-inspector-data-row col-span-2 flex items-center justify-between rounded-md border border-oc-border-soft bg-oc-panel-soft px-2 py-1.5 transition-colors hover:border-oc-border">
              <span className="text-[10px] uppercase tracking-wider font-medium text-[var(--oc-text-soft)] opacity-90">
                Date started
              </span>
              <span
                className={`oc-inspector-session-date font-medium tabular-nums ${isActive ? "text-oc-accent" : "text-[var(--oc-text-soft)] opacity-80"
                  }`}
              >
                {startedLabel}
              </span>
            </div>
          </div>
        </MiniSection>
      </div>
    </div>
  );
});

export const MobileRightSummary = memo(function MobileRightSummary() {
  const {
    isProcessing: globalIsProcessing,
    currentSessionId,
    processingSessionIds,
    isExtendedPanelOpen,
  } = useAppState(
    (state) => ({
      isProcessing: state.isProcessing,
      currentSessionId: state.currentSessionId,
      processingSessionIds: state.processingSessionIds,
      isExtendedPanelOpen: state.isExtendedPanelOpen,
    }),
    shallowEqual,
  );
  const dispatch = useAppDispatch();
  const [activeTab, setActiveTab] = useState<"task" | "quota" | "integrations" | "tools">(
    "task",
  );
  const isProcessing = isProcessingInCurrentSession(
    globalIsProcessing,
    currentSessionId,
    processingSessionIds,
  );

  useEffect(() => {
    if (!isExtendedPanelOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dispatch({ type: "SET_EXTENDED_PANEL_OPEN", payload: false });
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [dispatch, isExtendedPanelOpen]);

  if (!isExtendedPanelOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        className="absolute inset-0 bg-oc-bg/35"
        aria-label="Close extended panel"
        onClick={() => dispatch({ type: "SET_EXTENDED_PANEL_OPEN", payload: false })}
      />

      <div className="oc-details-sheet pointer-events-none absolute inset-x-2 top-[3.25rem] bottom-2 overflow-hidden rounded-xl border border-oc-border bg-oc-panel shadow-[0_18px_44px_rgba(0,0,0,0.28)]">
        <div className="pointer-events-auto flex h-full flex-col">
          <div className="oc-details-sheet-header flex items-center justify-between gap-3 border-b border-oc-border px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] oc-text-secondary">
                Details
              </div>
            </div>
            <div className="flex items-center gap-1">
              {isProcessing ? (
                <Badge
                  variant="accent"
                  className="oc-processing-badge h-5 rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-[0.18em] uppercase shrink-0"
                >
                  PROCESSING
                </Badge>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Collapse extended panel"
                aria-label="Collapse extended panel"
                onClick={() =>
                  dispatch({ type: "SET_EXTENDED_PANEL_OPEN", payload: false })
                }
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="oc-details-sheet-body flex-1 overflow-hidden px-3 py-3">
            <Tabs
              value={activeTab}
              onValueChange={(value) =>
                setActiveTab(value as "task" | "quota" | "integrations" | "tools")
              }
              className="flex h-full flex-col gap-0"
            >
              <TabsList className="oc-details-tabs grid h-8 w-full grid-cols-4 border border-oc-border-soft bg-oc-bg-soft/70">
                <TabsTrigger value="task" className="text-[11px]">
                  Overview
                </TabsTrigger>
                <TabsTrigger value="quota" className="text-[11px]">
                  Quota
                </TabsTrigger>
                <TabsTrigger value="integrations" className="text-[11px]">
                  Integrations
                </TabsTrigger>
                <TabsTrigger value="tools" className="text-[11px]">
                  Tools
                </TabsTrigger>
              </TabsList>

              <TabsContent value="task" className="oc-details-tab-content oc-details-tab-content--overview mt-0 min-h-0 flex-1 overflow-y-auto">
                <ActiveTaskPanel />
              </TabsContent>

              <TabsContent value="quota" className="oc-details-tab-content mt-0 min-h-0 flex-1 overflow-y-auto">
                <QuotaMonitor />
              </TabsContent>

              <TabsContent value="integrations" className="oc-details-tab-content mt-0 min-h-0 flex-1 overflow-y-auto">
                <div className="oc-details-tab-stack">
                  <McpPanel />
                  <LspPanel />
                </div>
              </TabsContent>

              <TabsContent value="tools" className="oc-details-tab-content mt-0 min-h-0 flex-1 overflow-y-auto">
                <div className="oc-details-tab-stack">
                  <SkillsPanel />
                  <AgentsPanel />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </div>
  );
});

export const ModelDropdown = memo(function ModelDropdown() {
  const {
    availableModels,
    selectedModel,
    modelSearchQuery,
    modelDropdownOpen,
    quotaData,
    configuredProviders,
  } = useAppState(
    (state) => ({
      availableModels: state.availableModels,
      selectedModel: state.selectedModel,
      modelSearchQuery: state.modelSearchQuery,
      modelDropdownOpen: state.modelDropdownOpen,
      quotaData: state.quotaData,
      configuredProviders: state.configuredProviders,
    }),
    shallowEqual,
  );
  const dispatch = useAppDispatch();
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [selectedTab, setSelectedTab] = useState("All");
  const [popoverStyle, setPopoverStyle] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    placement: "top" | "bottom";
  } | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !(popoverRef.current && popoverRef.current.contains(target))
      ) {
        dispatch({ type: "SET_MODEL_DROPDOWN_OPEN", payload: false });
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modelDropdownOpen, dispatch]);

  // Reset tab when dropdown closes
  useEffect(() => {
    if (!modelDropdownOpen) {
      setSelectedTab("All");
    }
  }, [modelDropdownOpen]);

  useLayoutEffect(() => {
    if (!modelDropdownOpen) {
      return;
    }

    const updatePopoverBounds = () => {
      const container = containerRef.current;
      const popover = popoverRef.current;
      if (!container) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const viewportPadding = 12;
      const gap = 8;
      const popoverWidth = 288;
      const left = Math.max(
        viewportPadding,
        Math.min(rect.left, window.innerWidth - popoverWidth - viewportPadding),
      );
      const availableAbove = Math.max(0, rect.top - viewportPadding);
      const availableBelow = Math.max(0, window.innerHeight - rect.bottom - viewportPadding);
      const measuredHeight = popover?.scrollHeight ?? 320;
      const desiredHeight = Math.min(Math.max(measuredHeight, 180), 420);
      const topCanFit = availableAbove >= desiredHeight + gap;
      const bottomCanFit = availableBelow >= desiredHeight + gap;
      const placement =
        topCanFit && !bottomCanFit ? "top" : bottomCanFit && !topCanFit ? "bottom" : availableAbove >= availableBelow ? "top" : "bottom";
      const availableHeight =
        placement === "top"
          ? Math.max(180, availableAbove - gap)
          : Math.max(180, availableBelow - gap);
      const maxHeight = Math.min(desiredHeight, availableHeight);
      const top =
        placement === "top"
          ? Math.max(viewportPadding, rect.top - gap - maxHeight)
          : Math.min(window.innerHeight - viewportPadding - maxHeight, rect.bottom + gap);

      setPopoverStyle({
        top,
        left,
        width: Math.min(popoverWidth, window.innerWidth - viewportPadding * 2),
        maxHeight,
        placement,
      });
    };

    updatePopoverBounds();
    window.addEventListener("resize", updatePopoverBounds);

    return () => {
      window.removeEventListener("resize", updatePopoverBounds);
    };
  }, [modelDropdownOpen]);

  const subscribedProviders = useMemo(() => {
    // Show provider badges only for configured/connected providers (from SDK config.providers())
    // If no configured providers, badges are hidden (except "All" tab which shows everything)
    if (!configuredProviders || configuredProviders.length === 0) {
      return [];
    }

    // Build a set of configured provider IDs from SDK (strict matching)
    const configuredProviderIds = new Set(
      configuredProviders.map((id) => id.toLowerCase())
    );

    // Filter available models using strict matching on providerID
    const providers = Array.from(
      new Set(
        availableModels
          .filter((m) => {
            // Use providerID (internal ID) for matching
            // configuredProviders contains the IDs from SDK config.providers()
            const providerId = m.providerID.toLowerCase();
            // Strict match: provider ID must be exactly in configured list
            return configuredProviderIds.has(providerId);
          })
          .map((m) => m.providerName ?? m.providerID)
      )
    )
      .filter((name) => {
        const key = name.toLowerCase();
        const providerId = (availableModels.find(
          (m) => (m.providerName ?? m.providerID) === name
        )?.providerID ?? "").toLowerCase();

        // Skip only the "opencode" provider itself (the free tier/default)
        // Allow other providers with "opencode" in the name like "OpenCode Go"
        return providerId !== "opencode";
      })
      .sort((a, b) => a.localeCompare(b));

    // Always include OpenCode Free at the start
    const result = ["OpenCode Free", ...providers];

    return result.filter((name, index, self) => self.indexOf(name) === index);
  }, [availableModels, configuredProviders]);

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof availableModels>();
    const query = modelSearchQuery.toLowerCase();

    [...availableModels]
      .sort((a, b) => {
        const pA = a.providerName ?? a.providerID;
        const pB = b.providerName ?? b.providerID;
        if (pA !== pB) return pA.localeCompare(pB);
        return a.name.localeCompare(b.name);
      })
      .filter((model) => {
        const matchesQuery = `${model.name} ${model.modelID} ${model.providerName}`
          .toLowerCase()
          .includes(query);

        if (!matchesQuery) return false;

        if (selectedTab !== "All") {
          if (selectedTab === "OpenCode Free") {
            return model.providerID === "opencode";
          }
          const providerName = model.providerName ?? model.providerID;
          return providerName.toLowerCase() === selectedTab.toLowerCase();
        }

        return true;
      })
      .forEach((model) => {
        const key = model.providerName ?? model.providerID;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)?.push(model);
      });
    return groups;
  }, [availableModels, modelSearchQuery, selectedTab]);

  const label = selectedModel
    ? `${selectedModel.providerID}/${selectedModel.modelID}`
    : "Model";

  return (
    <div className="relative oc-toolbar-control" ref={containerRef}>
      <Button
        type="button"
        variant="chip"
        size="chip"
        className="oc-toolbar-chip"
        onClick={() =>
          dispatch({
            type: "SET_MODEL_DROPDOWN_OPEN",
            payload: !modelDropdownOpen,
          })
        }
        aria-expanded={modelDropdownOpen}
        aria-label="Choose model"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate">{label}</span>
        </div>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${modelDropdownOpen ? "rotate-180" : ""
            }`}
        />
      </Button>
      {modelDropdownOpen && (
        createPortal(
          popoverStyle ? (
            <div
              ref={popoverRef}
              className="oc-popover fixed z-[120] overflow-hidden rounded-xl border border-oc-border bg-oc-panel shadow-xl flex flex-col"
              style={{
                top: `${popoverStyle.top}px`,
                left: `${popoverStyle.left}px`,
                width: `${popoverStyle.width}px`,
                maxHeight: `${popoverStyle.maxHeight}px`,
              }}
            >
              <div className="px-3 pt-3 pb-2 space-y-2">
                <input
                  value={modelSearchQuery}
                  onChange={(e) =>
                    dispatch({ type: "SET_MODEL_SEARCH", payload: e.target.value })
                  }
                  placeholder="Search models..."
                  className="oc-popover-search w-full rounded-lg border border-oc-border bg-oc-bg-soft px-3 py-1.5 text-xs font-medium outline-none focus:border-oc-accent transition-colors"
                />
                {subscribedProviders.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {["All", ...subscribedProviders].map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setSelectedTab(tab)}
                        className={`rounded-full px-2.5 py-1 text-[10px] font-medium tracking-wide transition-colors ${selectedTab === tab
                            ? "bg-oc-accent text-white"
                            : "bg-oc-bg-soft oc-text-secondary hover:bg-oc-panel-soft hover:text-oc-text"
                          }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-1.5">
                {[...grouped.entries()].map(([provider, models]) => (
                  <div key={provider} className="mb-1">
                    <div className="px-2.5 py-1 text-xs font-semibold uppercase tracking-widest oc-text-secondary opacity-60">
                      {provider}
                    </div>
                    {models.map((model) => {
                      const isCurrent =
                        selectedModel?.providerID === model.providerID &&
                        selectedModel?.modelID === model.modelID;
                      return (
                        <button
                          key={`${model.providerID}-${model.modelID}`}
                          type="button"
                          className={`oc-popover-item w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                            isCurrent
                              ? "bg-oc-accent-soft oc-popover-item-selected"
                              : "oc-popover-item-not-selected"
                          }`}
                          onClick={() => {
                            dispatch({
                              type: "SET_SELECTED_MODEL",
                              payload: {
                                providerID: model.providerID,
                                modelID: model.modelID,
                              },
                            });
                            dispatch({
                              type: "SET_MODEL_DROPDOWN_OPEN",
                              payload: false,
                            });
                            vscode.postMessage({
                              type: "selectModel",
                              model: {
                                providerID: model.providerID,
                                modelID: model.modelID,
                                providerName: model.providerName,
                              },
                            });
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium truncate">
                              {model.name}
                            </span>
                            {isCurrent && (
                              <span className="text-xs font-medium text-oc-accent shrink-0">
                                active
                              </span>
                            )}
                          </div>
                          <div className="text-xs font-medium oc-text-secondary truncate mt-0.5">
                            {model.modelID}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
                {grouped.size === 0 && (
                  <div className="px-2.5 py-4 text-center text-xs oc-text-secondary font-medium italic">
                    No models found
                  </div>
                )}
              </div>
            </div>
          ) : null,
          document.body,
        )
      )}
    </div>
  );
});

export const AgentDropdown = memo(function AgentDropdown() {
  const {
    availableAgents,
    selectedAgent,
    agentSearchQuery,
    agentDropdownOpen,
  } = useAppState(
    (state) => ({
      availableAgents: state.availableAgents,
      selectedAgent: state.selectedAgent,
      agentSearchQuery: state.agentSearchQuery,
      agentDropdownOpen: state.agentDropdownOpen,
    }),
    shallowEqual,
  );
  const dispatch = useAppDispatch();
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!agentDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        dispatch({ type: "SET_AGENT_DROPDOWN_OPEN", payload: false });
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [agentDropdownOpen, dispatch]);

  const filtered = useMemo(
    () =>
      availableAgents.filter((agent) =>
        `${agent.name} ${agent.id} ${agent.description}`
          .toLowerCase()
          .includes(agentSearchQuery.toLowerCase()),
      ),
    [agentSearchQuery, availableAgents],
  );

  const selectedAgentItem = availableAgents.find((a) => a.id === selectedAgent);
  const label = selectedAgentItem?.name ?? selectedAgent ?? "Default permissions";

  return (
    <div className="relative oc-toolbar-control" ref={containerRef}>
      <Button
        type="button"
        variant="chip"
        size="chip"
        className="oc-toolbar-chip"
        onClick={() =>
          dispatch({
            type: "SET_AGENT_DROPDOWN_OPEN",
            payload: !agentDropdownOpen,
          })
        }
        aria-label="Choose agent"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate">{label}</span>
        </div>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${agentDropdownOpen ? "rotate-180" : ""
            }`}
        />
      </Button>
      {agentDropdownOpen && (
        <div className="oc-popover absolute bottom-full left-0 z-30 mb-1.5 w-64 rounded-xl border border-oc-border bg-oc-panel shadow-xl overflow-hidden">
          <div className="px-3 pt-3 pb-2">
            <input
              value={agentSearchQuery}
              onChange={(e) =>
                dispatch({ type: "SET_AGENT_SEARCH", payload: e.target.value })
              }
              placeholder="Search agents..."
              className="oc-popover-search w-full rounded-lg border border-oc-border bg-oc-bg-soft px-3 py-1.5 text-xs font-medium outline-none focus:border-oc-accent transition-colors"
            />
          </div>
          <div className="max-h-52 overflow-y-auto px-1.5 pb-1.5">
            {availableAgents.length === 0 && (
              <div className="px-2.5 py-3 text-xs oc-text-secondary text-center font-medium">
                Loading agents…
              </div>
            )}
            {availableAgents.length > 0 && filtered.length === 0 && (
              <div className="px-2.5 py-3 text-xs oc-text-secondary text-center font-medium">
                No agents found
              </div>
            )}
            {filtered.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={`oc-popover-item oc-agent-option w-full rounded-lg px-2.5 py-2 text-left transition-colors ${selectedAgent === agent.id
                    ? "oc-agent-option-selected"
                    : "hover:bg-oc-panel-soft"
                  }`}
                style={
                  {
                    "--agent-color": agent.color ?? "var(--oc-accent)",
                  } as Record<string, string>
                }
                onClick={() => {
                  dispatch({ type: "SET_SELECTED_AGENT", payload: agent.id });
                  dispatch({ type: "SET_AGENT_DROPDOWN_OPEN", payload: false });
                  vscode.postMessage({ type: "selectAgent", agent: agent.id });
                }}
              >
                <div className="oc-agent-option-top">
                  <span className="oc-agent-option-dot" />
                  <div className="text-xs font-medium truncate text-[var(--oc-text)]">
                    {agent.name}
                  </div>
                </div>
                <div className="text-xs font-medium truncate mt-0.5 text-[var(--oc-text-secondary)] opacity-95">
                  {agent.description}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export const QueueContainer = memo(function QueueContainer() {
  const {
    promptQueue,
    processingSessionIds,
    isProcessing: globalIsProcessing,
    isSteering,
    currentSessionId,
  } = useAppState(
    (state) => ({
      promptQueue: state.promptQueue,
      processingSessionIds: state.processingSessionIds,
      isProcessing: state.isProcessing,
      isSteering: state.isSteering,
      currentSessionId: state.currentSessionId,
    }),
    shallowEqual,
  );
  const dispatch = useAppDispatch();

  const isProcessing = isProcessingInCurrentSession(
    globalIsProcessing,
    currentSessionId,
    processingSessionIds,
  );

  if (promptQueue.length === 0) return null;

  const removeQueuedItem = (
    item: (typeof promptQueue)[number],
    index: number,
  ) => {
    const itemSessionId = item.sessionId;
    if (!itemSessionId) return;
    vscode.postMessage({
      type: "removeFromQueue",
      sessionId: itemSessionId,
      id: item.id,
      index,
    });
  };

  return (
    <div className="oc-queue-popover">
      <div className="oc-queue-header">
        <div className="flex items-center gap-2 min-w-0">
          <span className="oc-queue-title font-medium text-[10px] font-semibold uppercase tracking-widest">
            Pending
          </span>
          <span className="oc-queue-count">
            {promptQueue.length}
          </span>
          <span className="oc-queue-status text-[10px] truncate">
            {isProcessing ? "· sending after response" : ""}
          </span>
        </div>
        <button
          type="button"
          className="oc-queue-clear"
          title="Clear all pending prompts"
          onClick={() => {
            if (!currentSessionId) return;
            vscode.postMessage({
              type: "clearQueue",
              sessionId: currentSessionId,
            });
          }}
        >
          Clear all
        </button>
      </div>

      {promptQueue.map((item, index) => {
        const itemSessionId = item.sessionId;
        return (
          <div
            key={item.id || `${item.text}-${index}`}
            className="oc-queue-item group"
          >
            <div className="oc-queue-index">
              <span className="font-medium text-[9px] font-bold">
                {index + 1}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="oc-queue-item-text line-clamp-2 font-medium text-[12px] leading-5">
                {item.text || "(empty)"}
              </div>
              {(item.files?.length || item.contexts?.length) ? (
                <div className="oc-queue-item-meta mt-1 flex items-center gap-2 font-medium text-[10px]">
                  {item.files?.length ? (
                    <span>{item.files.length} file{item.files.length > 1 ? "s" : ""}</span>
                  ) : null}
                  {item.contexts?.length ? (
                    <span>{item.contexts.length} ctx</span>
                  ) : null}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="oc-queue-remove"
              title="Remove from queue"
              disabled={!itemSessionId || isSteering}
              onClick={() => removeQueuedItem(item, index)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
});

/** Dedicated permission surface; generic questions use the composer popover below. */
function PermissionAskedPopover({
  event,
  onReply,
  onAbort,
}: {
  event: InteractiveQuickActionsEvent;
  onReply: (response: string) => void;
  onAbort: () => void;
}) {
  const permissionPaths = event.permissionPatterns ?? [];
  return (
    <div className="mb-2 px-1 py-1">
      <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-oc-border-soft pb-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider oc-text-secondary">
          {event.title}
        </div>
        <button
          type="button"
          className="oc-quick-input-icon-btn rounded p-1 transition-colors"
          title="Abort current response"
          onClick={onAbort}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mb-2 text-[11px] oc-text-secondary">
        OpenCode requests {event.permissionName || "permission"} access to:
      </div>
      {permissionPaths.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
          {permissionPaths.map((path) => (
            <div key={path} className="flex min-w-0 items-center gap-1.5 text-[11px] text-oc-text-soft">
              <FileIcon filePath={path} className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate font-mono">{path}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {event.actions.map((action, index) => (
          <button
            key={`${event.id}-${action.id || action.value || index}`}
            type="button"
            className="oc-quick-input-option rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all"
            onClick={() => onReply(action.value || action.label)}
          >
            {action.label ? action.label.charAt(0).toUpperCase() + action.label.slice(1) : action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export const InputWrapper = memo(function InputWrapper() {
  const {
    inputValue,
    isProcessing: globalIsProcessing,
    isExecutingQueue: globalIsExecutingQueue,
    isSteering,
    streaming,
    currentSessionId,
    processingSessionIds,
    executingQueueSessionIds,
    promptQueue,
    selectedFiles,
    selectedContexts,
    fileMentionPaths,
    selectedAgent,
    showFileSuggestions,
    fileSuggestions,
    selectedSuggestionIndex,
    mentionSuggestions,
    showMentionSuggestions,
    selectedMentionIndex,
    availableCommands,
    availableSkills,
    commandsLoaded,
    attachments = [],
    interactiveEvents,
    dismissedInteractiveEventKeys,
    contextUsagePct,
    assistantTurnPending,
    messages,
  } = useAppState(
    (state) => ({
      inputValue: state.inputValue,
      isProcessing: state.isProcessing,
      isExecutingQueue: state.isExecutingQueue,
      isSteering: state.isSteering,
      streaming: state.streaming,
      messages: state.messages,
      currentSessionId: state.currentSessionId,
      processingSessionIds: state.processingSessionIds,
      executingQueueSessionIds: state.executingQueueSessionIds,
      promptQueue: state.promptQueue,
      selectedFiles: state.selectedFiles,
      selectedContexts: state.selectedContexts,
      fileMentionPaths: state.fileMentionPaths,
      selectedAgent: state.selectedAgent,
      showFileSuggestions: state.showFileSuggestions,
      fileSuggestions: state.fileSuggestions,
      selectedSuggestionIndex: state.selectedSuggestionIndex,
      mentionSuggestions: state.mentionSuggestions,
      showMentionSuggestions: state.showMentionSuggestions,
      selectedMentionIndex: state.selectedMentionIndex,
      availableCommands: state.availableCommands,
      availableSkills: state.availableSkills,
      commandsLoaded: state.commandsLoaded,
      attachments: state.attachments,
      interactiveEvents: state.interactiveEvents,
      dismissedInteractiveEventKeys:
        state.dismissedInteractiveEventKeys instanceof Set
          ? state.dismissedInteractiveEventKeys
          : EMPTY_DISMISSED_INTERACTIVE_EVENT_KEYS,
      contextUsagePct: state.contextUsagePct,
      assistantTurnPending: state.assistantTurnPending,
    }),
    shallowEqual,
  );
  const dispatch = useAppDispatch();
  const isProcessing = isProcessingInCurrentSession(
    globalIsProcessing,
    currentSessionId,
    processingSessionIds,
  );
  const isExecutingQueue = isExecutingQueueInCurrentSession(
    globalIsExecutingQueue,
    currentSessionId,
    executingQueueSessionIds,
  );
  const hasLiveAssistantTurn = shouldDeferComposerSendInCurrentSession(
    currentSessionId,
    processingSessionIds,
    Boolean(streaming?.isActive),
    assistantTurnPending,
  );
  const [isEscapeArmed, setIsEscapeArmed] = useState(false);

  const prevInputLengthRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaMetricsRef = useRef<{
    lineHeight: number;
    chrome: number;
    border: number;
  } | null>(null);
  const textareaHasValue = inputValue.length > 0;
  const textareaMinRows = 2;
  const textareaMaxRows = textareaHasValue ? 8 : 3;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    // We do NOT want to shrink the text area while executing a queue items
    if (!textareaHasValue && textarea.scrollHeight <= textareaMinRows * 20) {
      textarea.style.height = "auto";
      textarea.style.maxHeight = "none";
      textarea.style.minHeight = "44px";
      textarea.style.overflowY = "hidden";
      prevInputLengthRef.current = inputValue.length;
      return;
    }

    let metrics = textareaMetricsRef.current;
    if (!metrics) {
      const computed = window.getComputedStyle(textarea);
      const lineHeight = Number.parseFloat(computed.lineHeight) || 20;
      const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
      const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
      const borderTop = Number.parseFloat(computed.borderTopWidth) || 0;
      const borderBottom = Number.parseFloat(computed.borderBottomWidth) || 0;
      metrics = {
        lineHeight,
        chrome: paddingTop + paddingBottom + borderTop + borderBottom,
        border: borderTop + borderBottom,
      };
      textareaMetricsRef.current = metrics;
    }

    const minHeight = metrics.lineHeight * textareaMinRows + metrics.chrome;
    const maxHeight = metrics.lineHeight * textareaMaxRows + metrics.chrome;

    textarea.style.maxHeight = `${maxHeight}px`;
    textarea.style.minHeight = `${minHeight}px`;

    // Fast path for large text to avoid expensive scrollHeight calculation
    // and layout thrashing (setting height="auto" causes a full reflow)
    if (inputValue.length > 2000) {
      textarea.style.height = `${maxHeight}px`;
      textarea.style.overflowY = "auto";
      prevInputLengthRef.current = inputValue.length;
      return;
    }

    const isShrinking = inputValue.length < prevInputLengthRef.current;
    prevInputLengthRef.current = inputValue.length;

    // Setting height to "auto" forces a synchronous layout reflow which causes lag during rapid typing.
    // We only need to reset it to "auto" if the content might have shrunk.
    // If it's growing, just setting height to scrollHeight works fine because scrollHeight naturally expands.
    if (isShrinking || inputValue === "") {
      textarea.style.height = "auto";
    }

    const scrollHeight = textarea.scrollHeight;
    const newHeight = Math.min(scrollHeight + metrics.border, maxHeight);
    const newHeightPx = `${newHeight}px`;
    
    // Only write to DOM if it actually changed to prevent style invalidation
    if (textarea.style.height !== newHeightPx) {
      textarea.style.height = newHeightPx;
    }
    
    const newOverflow = scrollHeight > maxHeight ? "auto" : "hidden";
    if (textarea.style.overflowY !== newOverflow) {
      textarea.style.overflowY = newOverflow;
    }
  }, [inputValue, textareaHasValue, textareaMaxRows]);

  const [currentInteractiveIndex, setCurrentInteractiveIndex] = useState(0);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const [pendingAnswers, setPendingAnswers] = useState<
    Record<string, { text: string | string[]; eventType: string }>
  >({});
  const [multiSelectValues, setMultiSelectValues] = useState<Set<string>>(new Set());
  const customInputRef = useRef<HTMLInputElement>(null);
  const [previewAttachmentSrc, setPreviewAttachmentSrc] = useState<
    string | null
  >(null);

  const [slashTrigger, setSlashTrigger] = useState<SlashTrigger | null>(null);
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(null);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const commandsRequestedRef = useRef(false);
  const suggestionsContainerRef = useRef<HTMLDivElement>(null);
  const composerInteractiveEvents = useMemo(() => {
    let events: InteractiveEvent[] = [];

    // 1. Top-level interactive events (out-of-band questions, etc.)
    if (Array.isArray(interactiveEvents)) {
      events = [...events, ...interactiveEvents];
    }

    // 2. Interactive events from currently streaming response
    if (streaming?.isActive && Array.isArray(streaming.interactiveEvents)) {
      events = [...events, ...streaming.interactiveEvents];
    } else {
      // 3. If not streaming, fallback to interactive events from the latest assistant message,
      // but ONLY if the assistant is the absolute last speaker in the conversation.
      const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
      if (lastMsg?.role === "assistant" && Array.isArray(lastMsg.interactiveEvents)) {
        events = [...events, ...lastMsg.interactiveEvents];
      }
    }

    return filterDismissedInteractiveEvents(
      events,
      dismissedInteractiveEventKeys,
    );
  }, [messages, streaming, interactiveEvents, dismissedInteractiveEventKeys]);

  const filteredCommands = useMemo(() => {
    if (!slashTrigger) {
      return [] as SlashCommand[];
    }

    const query = slashTrigger.query.trim().toLowerCase();

    // Combine both commands and skills for slash suggestions
    const commandsFromServer = availableCommands || [];
    const skillsFromService = availableSkills || [];
    const allSlashItems = [
      ...commandsFromServer,
      // Convert skills to SlashCommand format
      ...skillsFromService.map(skill => ({
        name: skill.name,
        description: skill.description,
        source: "skill"
      }))
    ];
    const dedupedSlashItems = Array.from(
      new Map(
        allSlashItems.map((item) => [
          `${item.source || "command"}:${item.name}`,
          item,
        ]),
      ).values(),
    );

    if (!query) {
      return dedupedSlashItems;
    }

    const filtered = dedupedSlashItems.filter((command) => {
      const name = command.name.toLowerCase();
      return name.includes(query);
    });

    return filtered;
  }, [slashTrigger, availableCommands, availableSkills]);

  useEffect(() => {
    if (slashTrigger && !commandsLoaded && !commandsRequestedRef.current) {
      commandsRequestedRef.current = true;
      vscode.postMessage({ type: "getCommands" });
    }
  }, [slashTrigger, commandsLoaded]);

  useEffect(() => {
    if (mentionTrigger) {
      const timeoutId = window.setTimeout(() => {
        vscode.postMessage({ type: "getMentions", query: mentionTrigger.query });
      }, 120);
      return () => window.clearTimeout(timeoutId);
    }
    if (showFileSuggestions) {
      dispatch({ type: "SET_SHOW_FILE_SUGGESTIONS", payload: false });
    }
    if (showMentionSuggestions) {
      dispatch({ type: "SET_SHOW_MENTION_SUGGESTIONS", payload: false });
    }
  }, [mentionTrigger?.query]);

  useEffect(() => {
    setSelectedCommandIndex(0);
  }, [slashTrigger?.query]);

  useEffect(() => {
    if (selectedCommandIndex >= filteredCommands.length) {
      setSelectedCommandIndex(Math.max(0, filteredCommands.length - 1));
    }
  }, [filteredCommands.length, selectedCommandIndex]);

  useEffect(() => {
    if (suggestionsContainerRef.current) {
      const activeEl = suggestionsContainerRef.current.querySelector(".active");
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [
    selectedCommandIndex,
    selectedSuggestionIndex,
    slashTrigger,
    showFileSuggestions,
  ]);

  // Centralized Interactive Event Handler
  // By design, ALL interactive choices explicitly sent through structured output
  // as a popup above the chatbox. This provides a consistent, clear place for
  // user required actions (questions, confirmations, quick actions).
  //
  // Even if the AI types the question in the chat bubble, we show the popup
  // here to make the call-to-action obvious and clickable.
  const displayInteractiveEvents = useMemo(() => {
    const candidates = composerInteractiveEvents.filter(isQuickInputInteractiveEvent);
    const seen = new Set<string>();
    const visible = candidates.filter((event) => {
      const eventAny = event as any;
      const key = event.type === "quick_actions" && event.permissionID
        ? `permission::${event.permissionID}`
        : `${event.type}::${(eventAny.question || eventAny.title || eventAny.message || "").trim().toLowerCase().replace(/\s+/g, " ")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return visible;
  }, [composerInteractiveEvents]);
  const interactiveEventCount = displayInteractiveEvents.length;
  const interactiveEventResetKey = displayInteractiveEvents
    .map((item) => {
      const title =
        item.type === "question" || item.type === "confirm"
          ? item.question
          : item.type === "quick_actions"
            ? item.title
            : item.type === "message"
              ? item.message || item.title
              : item.title;
      return `${item.id}|${item.type}|${title ?? ""}`;
    })
    .join("::");

  // Reset index and custom mode when interactive events change
  useEffect(() => {
    if (interactiveEventCount < 0) return;
    // If the first event is an open-ended question (allowCustomInput, no pre-set options),
    // skip straight to the free-text input so the user doesn't see an empty button row.
    const firstEvent = displayInteractiveEvents[0];
    const autoCustomMode =
      firstEvent?.type === "question" &&
      Array.isArray(firstEvent.options) &&
      firstEvent.options.length === 0 &&
      firstEvent.allowCustomInput === true;
    setCurrentInteractiveIndex(0);
    setIsCustomMode(autoCustomMode);
    setCustomValue("");
    setPendingAnswers({});
  }, [interactiveEventCount, interactiveEventResetKey]);

  useEffect(() => {
    if (isCustomMode) {
      customInputRef.current?.focus();
    }
  }, [isCustomMode]);

  const activeInteractiveEvent =
    displayInteractiveEvents[currentInteractiveIndex];
  const event = activeInteractiveEvent;
  const isPermissionPopover =
    event?.type === "quick_actions" &&
    (typeof event.permissionID === "string" || event.permissionPreview === true);
  const showInteractivePopover = displayInteractiveEvents.length > 0;
  const currentInteractiveAnswered = Boolean(
    event?.id &&
      (Array.isArray(pendingAnswers[event.id]?.text)
        ? pendingAnswers[event.id]?.text.length > 0
        : (pendingAnswers[event.id]?.text as string)?.trim()),
  );
  const eventTitleText = event?.title?.trim() || "";
  const eventBodyText =
    event?.type === "quick_actions"
      ? eventTitleText || "Select an action"
      : event?.type === "message"
        ? event.message || ""
        : event?.question || "";
  const eventContextMessage = event?.contextMessage?.trim() || "";
  const normalizePopoverText = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[`"'()[\]{}<>]/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  const normalizedBodyText = normalizePopoverText(eventBodyText);
  const normalizedTitleText = normalizePopoverText(eventTitleText);
  const normalizedContextText = normalizePopoverText(eventContextMessage);
  const hasDistinctTitle =
    !!eventTitleText &&
    normalizedTitleText !== normalizedBodyText;
  const hasDistinctContextMessage =
    !!eventContextMessage &&
    normalizedContextText !== normalizedBodyText &&
    normalizedContextText !== normalizedTitleText;
  const showPromptInHeader = !!eventTitleText;
  const showContextMessage = hasDistinctContextMessage;
  const showPromptInBody = !!eventBodyText && normalizedBodyText !== normalizedTitleText;

  const capitalizeFirst = (str: string) => {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  const renderInteractiveOptionLabel = (label: string, recommended?: boolean) => {
    const displayLabel = capitalizeFirst(label);
    return recommended ? `Recommended: ${displayLabel}` : displayLabel;
  };

  const applyCommandSuggestion = (command: SlashCommand) => {
    if (!slashTrigger) return;
    const normalizedName = command.name.replace(/^\//, "");
    if (!normalizedName) return;

    const before = inputValue.slice(0, slashTrigger.replaceFrom);
    const after = inputValue.slice(slashTrigger.replaceTo);
    const insertion = `/${normalizedName} `;
    const nextValue = `${before}${insertion}${after}`;
    const cursor = before.length + insertion.length;

    dispatch({ type: "SET_INPUT_VALUE", payload: nextValue });
    setSlashTrigger(null);
    setSelectedCommandIndex(0);

    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(cursor, cursor);
    });
  };

  const applyMentionSuggestion = (suggestion: FileResult) => {
    if (!mentionTrigger) return;

    // Convert suggestion to a ContextItem
    const contextItem: ContextItem = {
      file: suggestion.path,
      lineInfo: "",
      content: "",
    };

    const isAlreadySelected = selectedContexts.some(
      (c) => c.file === contextItem.file && c.lineInfo === contextItem.lineInfo
    );

    if (!isAlreadySelected) {
      dispatch({
        type: "SET_SELECTED_CONTEXTS",
        payload: [...selectedContexts, contextItem],
      });
    }

    // Remove the @mention from input (it will be shown as a chip instead)
    const before = inputValue.slice(0, mentionTrigger.replaceFrom);
    const after = inputValue.slice(mentionTrigger.replaceTo);
    const nextValue = `${before}${after}`;

    dispatch({ type: "SET_INPUT_VALUE", payload: nextValue });
    setMentionTrigger(null);
    dispatch({ type: "SET_SHOW_FILE_SUGGESTIONS", payload: false });
    dispatch({ type: "SET_SUGGESTION_INDEX", payload: 0 });

    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(before.length, before.length);
    });
  };

  const applyMentionResult = (result: MentionResult) => {
    if (!mentionTrigger) return;

    if (result.type === "agent") {
      dispatch({ type: "SET_SELECTED_AGENT", payload: result.id });
      // For agents: keep @agentname in the input
      const before = inputValue.slice(0, mentionTrigger.replaceFrom);
      const after = inputValue.slice(mentionTrigger.replaceTo);
      const displayName = result.name || result.id;
      const mentionText = `@${displayName}`;
      const nextValue = after.startsWith(' ')
        ? `${before}${mentionText}${after}`
        : `${before}${mentionText} ${after}`;

      dispatch({ type: "SET_INPUT_VALUE", payload: nextValue });
      setMentionTrigger(null);
      dispatch({ type: "SET_SHOW_MENTION_SUGGESTIONS", payload: false });
      dispatch({ type: "SET_MENTION_INDEX", payload: 0 });

      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        const cursorPos = before.length + mentionText.length + 1;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(cursorPos, cursorPos);
      });
    } else if (result.type === "file") {
      // Don't add to selectedContexts - we'll parse @filename from input instead
      // For files: keep @filename in the input
      const before = inputValue.slice(0, mentionTrigger.replaceFrom);
      const after = inputValue.slice(mentionTrigger.replaceTo);
      const displayName = result.name || result.path;
      const mentionText = `@${displayName}`;
      const nextValue = after.startsWith(' ')
        ? `${before}${mentionText}${after}`
        : `${before}${mentionText} ${after}`;

      // Store the full path mapping for this filename
      const updatedPaths = { ...fileMentionPaths };
      updatedPaths[displayName] = result.path;
      dispatch({ type: "SET_FILE_MENTION_PATHS", payload: updatedPaths });

      dispatch({ type: "SET_INPUT_VALUE", payload: nextValue });
      setMentionTrigger(null);
      dispatch({ type: "SET_SHOW_MENTION_SUGGESTIONS", payload: false });
      dispatch({ type: "SET_MENTION_INDEX", payload: 0 });

      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        const cursorPos = before.length + mentionText.length + 1;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(cursorPos, cursorPos);
      });
    } else if (result.type === "resource") {
      const contextItem: ContextItem = {
        file: `resource:${result.uri}`,
        lineInfo: "",
        content: "",
      };
      const alreadySelected = selectedContexts.some(
        (c) => c.file === contextItem.file
      );
      if (!alreadySelected) {
        dispatch({
          type: "SET_SELECTED_CONTEXTS",
          payload: [...selectedContexts, contextItem],
        });
      }
      // For resources: remove @resource from input
      const before = inputValue.slice(0, mentionTrigger.replaceFrom);
      const after = inputValue.slice(mentionTrigger.replaceTo);
      const nextValue = `${before}${after}`;

      dispatch({ type: "SET_INPUT_VALUE", payload: nextValue });
      setMentionTrigger(null);
      dispatch({ type: "SET_SHOW_MENTION_SUGGESTIONS", payload: false });
      dispatch({ type: "SET_MENTION_INDEX", payload: 0 });

      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(before.length, before.length);
      });
    }
  };

  const sendPrompt = () => {
    const text = inputValue.trim();
    if (!text) return;

    // Capture values before clearing state
    const currentFiles = selectedFiles.length > 0 ? [...selectedFiles] : undefined;
    const currentContexts = resolveMentionedFileContexts(
      text,
      selectedContexts,
      fileMentionPaths,
    );
    const currentAttachments = attachments || [];
    const currentAgent = selectedAgent || null;
    const sessionId = currentSessionId;

    // Clear UI state immediately for better UX
    dispatch({ type: "SET_INPUT_VALUE", payload: "" });
    dispatch({ type: "CLEAR_ATTACHMENTS" });
    dispatch({ type: "SET_SELECTED_CONTEXTS", payload: [] });
    dispatch({ type: "SET_SELECTED_FILES", payload: [] });
    dispatch({ type: "SET_FILE_MENTION_PATHS", payload: {} }); // Clear file mention paths
    setSlashTrigger(null);

    const clientRequestId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const hasPendingQuestion =
      interactiveEvents.length > 0 &&
      interactiveEvents.some(
        (e) =>
          e.type === "question" ||
          e.type === "confirm" ||
          e.type === "quick_input",
      );
    // Every normal send belongs in the inline transcript immediately. OpenCode
    // owns ordering while a turn is active; the webview never shows a separate
    // extension-side pending queue for these messages.
    const pendingSessionId = sessionId ?? PENDING_CURRENT_SESSION_KEY;
    dispatch({
      type: "ADD_PENDING_USER_MESSAGE",
      payload: {
        id: clientRequestId,
        clientRequestId,
        sessionId: pendingSessionId,
        createdAt: Date.now(),
        text,
        images: currentAttachments
          .filter((attachment) => isImageAttachment(attachment.mimeType, attachment.dataUrl))
          .map((attachment) => attachment.dataUrl),
        attachments: currentAttachments,
        contexts: currentContexts,
        interactiveSubmit: hasPendingQuestion,
      },
    });

    vscode.postMessage({
      type: "sendMessage",
      clientRequestId,
      ...(sessionId ? { sessionId } : {}),
      text,
      files: currentFiles,
      contexts: currentContexts,
      agent: currentAgent,
      images: currentAttachments,
      ...(hasPendingQuestion ? { interactiveSubmit: true } : {}),
    });

    dispatch({ type: "SET_PROCESSING", payload: true });
    logger.info("[LOADING][INPUT] User sent message, dispatching SET_PROCESSING(true)", {
      sessionId: sessionId || null,
      currentSessionId,
      processingSessionIds,
      textLength: text.length,
      hasPendingQuestion,
      timestamp: Date.now(),
    });
  };

  const steerPrompt = () => {
    const text = inputValue.trim();
    if (!text || !hasLiveAssistantTurn || isSteering) return;

    dispatch({ type: "SET_STEERING", payload: true });
    vscode.postMessage({
      type: "steerMessage",
      ...(currentSessionId ? { sessionId: currentSessionId } : {}),
      text,
      files: selectedFiles,
      contexts: resolveMentionedFileContexts(
        text,
        selectedContexts,
        fileMentionPaths,
      ),
      agent: selectedAgent || null,
      images: attachments || [],
    });
    dispatch({ type: "SET_INPUT_VALUE", payload: "" });
    dispatch({ type: "CLEAR_ATTACHMENTS" });
    dispatch({ type: "SET_FILE_MENTION_PATHS", payload: {} }); // Clear file mention paths
    setSlashTrigger(null);
  };

  // When a text paste exceeds this many characters, convert it to a .txt
  // attachment instead of inserting into the textarea. Keeps the message bubble
  // readable. Tune this constant to adjust the cutoff.
  const PASTE_TEXT_ATTACHMENT_THRESHOLD = 2000;

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    // Large text paste → auto-convert to a .txt attachment. Prioritize text
    // content over image items: rich-text clipboard copies from IDEs/browsers
    // often include an image/png fallback alongside text/plain, and the user
    // intent is to paste the text, not the fallback image.
    const pastedText = e.clipboardData.getData("text/plain") ?? "";
    if (pastedText.length >= PASTE_TEXT_ATTACHMENT_THRESHOLD) {
      e.preventDefault();
      const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(pastedText)}`;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `pasted-snippet-${stamp}.txt`;
      dispatch({
        type: "ADD_ATTACHMENT",
        payload: {
          id: crypto.randomUUID(),
          dataUrl,
          filename,
          mimeType: "text/plain",
        },
      });
      return;
    }

    let pastedImage = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.type.startsWith("image/")) continue;
      const blob = item.getAsFile();
      if (!blob) continue;
      pastedImage = true;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const dataUrl = reader.result;
          if (typeof dataUrl !== "string") return;
          const ext = blob.type.split("/")[1] ?? "png";
          const filename =
            blob.name && blob.name.length > 0
              ? blob.name
              : `pasted-${Date.now()}.${ext}`;
          dispatch({
            type: "ADD_ATTACHMENT",
            payload: {
              id: crypto.randomUUID(),
              dataUrl,
              filename,
              mimeType: blob.type,
            },
          });
        } catch (err) {
          /* ignore */
        }
      };
      reader.readAsDataURL(blob);
    }

    if (pastedImage) {
      e.preventDefault();
    }
  };

  const initStatesForEvent = (eventIndex: number, currentAnswers: Record<string, { text: string | string[]; eventType: string }>) => {
    const nextEvent = displayInteractiveEvents[eventIndex];
    if (nextEvent && nextEvent.type === "question") {
      const ans = currentAnswers[nextEvent.id];
      if (ans) {
        if (nextEvent.multiSelect) {
          setMultiSelectValues(new Set(Array.isArray(ans.text) ? ans.text : [ans.text]));
          setIsCustomMode(false);
          setCustomValue("");
        } else {
          setMultiSelectValues(new Set());
          const textAns = Array.isArray(ans.text) ? ans.text[0] : ans.text;
          const isOption = nextEvent.options.some(o => (o.value || o.label) === textAns);
          if (!isOption && nextEvent.allowCustomInput) {
            setIsCustomMode(true);
            setCustomValue(textAns);
          } else {
            setIsCustomMode(false);
            setCustomValue("");
          }
        }
      } else {
        setMultiSelectValues(new Set());
        setIsCustomMode(false);
        setCustomValue("");
      }
    } else {
      setMultiSelectValues(new Set());
      setIsCustomMode(false);
      setCustomValue("");
    }
  };

  const submitInteractiveResponse = (
    text: string | string[],
    eventId: string,
    eventType: string,
  ) => {
    const nextAnswers = {
      ...pendingAnswers,
      [eventId]: { text, eventType },
    };
    setPendingAnswers(nextAnswers);

    // If there are more questions, go to the next one
    if (currentInteractiveIndex < displayInteractiveEvents.length - 1) {
      setCurrentInteractiveIndex((prev) => prev + 1);
      initStatesForEvent(currentInteractiveIndex + 1, nextAnswers);
    } else {
      // All questions are answered, submit batch
      submitBatchResponses(nextAnswers);
    }
  };

  const submitBatchResponses = (
    answers: Record<string, { text: string | string[]; eventType: string }>,
  ) => {
    const batch = Object.entries(answers).map(([eventId, data]) => {
      const event = displayInteractiveEvents.find((e) => e.id === eventId);
      const questionText =
        event?.type === "question" || event?.type === "confirm"
          ? event.question
          : event?.type === "quick_actions"
            ? event.title || "Select an action"
            : event?.type === "message"
              ? event.message || event.title || "Acknowledge"
              : event?.title || "";
      return {
        eventId,
        eventType: data.eventType,
        text: data.text,
        questionText,
        requestID:
          event?.type === "question" ? event.requestID : undefined,
        questionIndex:
          event?.type === "question" ? event.questionIndex : undefined,
        permissionID:
          event?.type === "quick_actions" ? event.permissionID : undefined,
        sessionID:
          event?.type === "quick_actions" ? event.sessionID : undefined,
      };
    }).sort((a, b) => {
      const idxA = typeof a.questionIndex === "number" ? a.questionIndex : 0;
      const idxB = typeof b.questionIndex === "number" ? b.questionIndex : 0;
      return idxA - idxB;
    });

    const hasMultipleInteractivePrompts = batch.length > 1;

    // Single popover answers read best as plain user replies. Numbered question
    // context is only needed when a batched prompt carries multiple questions.
    const composedPrompt = batch
      .map((resp, index) => {
        const answer = Array.isArray(resp.text) ? resp.text.join(", ") : (resp.text || "").trim();
        const question = (resp.questionText || "").trim();
        if (!answer) {
          return "";
        }
        if (!hasMultipleInteractivePrompts) {
          return answer;
        }
        if (!question) {
          return `Answer ${index + 1}: ${answer}`;
        }
        return `Question ${index + 1}: ${question}\nAnswer: ${answer}`;
      })
      .filter((line) => line.length > 0)
      .join("\n\n");

    // Keep user bubble text aligned with the exact prompt sent upstream.
    const displayText = composedPrompt;

    // IMPORTANT: do not append optimistic assistant or user messages here.
    // The host/message handler owns the canonical turn transition. Clearing or
    // replacing local assistant state from this component can hide the already
    // rendered assistant activity/subagent UI until the next stream update lands.

    // Dismiss all events that were part of this batch immediately to prevent stale popover UI.
    // Be defensive: some legacy/hydrated events may have missing/unstable IDs.
    batch.forEach(({ eventId }) => {
      dispatch({
        type: "DISMISS_INTERACTIVE_EVENT",
        payload: eventId,
      });
    });

    dispatch({
      type: "SET_INTERACTIVE_EVENTS",
      payload: [],
    });

    // Don't show processing state immediately - let extension confirm when actually processing
    // This prevents UI from showing "stuck" loading state when request is delayed
    // dispatch({ type: "SET_PROCESSING", payload: true });

    const permissionReplies = batch.filter(
      (response) =>
        response.permissionID &&
        (response.text === "once" || response.text === "always" || response.text === "reject"),
    );
    if (permissionReplies.length > 0) {
      permissionReplies.forEach((response) => {
        vscode.postMessage({
          type: "permissionReply",
          sessionId: response.sessionID || currentSessionId,
          permissionID: response.permissionID,
          response: response.text,
        });
      });
      return;
    }

    // Route question answers through questionReply and non-question events
    // (confirm, quick_actions, message) through the normal sendMessage path.
    const canReplyToSdkQuestion = batch.some((resp) => resp.eventType === "question" || resp.eventType === "confirm");
      
    console.error("[DEBUG-UI] canReplyToSdkQuestion evaluated:", {
      canReplyToSdkQuestion,
      eventTypes: batch.map(b => b.eventType),
      batchRequestIDs: batch.map(b => b.requestID)
    });
    
    if (canReplyToSdkQuestion) {
      console.error("[DEBUG-UI] Dispatching questionReply message to host");
      dispatch({ type: "SET_PROCESSING", payload: false });
      dispatch({ type: "SET_STEERING", payload: false });
      dispatch({ type: "SET_STREAMING", payload: null });
      const answers = batch.map((resp) =>
        Array.isArray(resp.text) ? resp.text : [resp.text],
      );
      const requestID = batch.find((resp) => resp.requestID)?.requestID;
      logger.info("[QUESTION DEBUG] submitting SDK question reply", {
        requestID,
        answerCount: answers.length,
        answers,
        sessionId: currentSessionId ?? null,
      });
      vscode.postMessage({
        type: "questionReply",
        ...(currentSessionId ? { sessionId: currentSessionId } : {}),
        requestID,
        answers,
        text: displayText,
      });
    } else {
      console.error("[DEBUG-UI] Dispatching normal sendMessage message to host");
      const clientRequestId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      vscode.postMessage({
        type: "sendMessage",
        clientRequestId,
        ...(currentSessionId ? { sessionId: currentSessionId } : {}),
        text: displayText,
        agent: selectedAgent || null,
        interactiveSubmit: true,
      });
    }

    // Reset state immediately after sending
    setPendingAnswers({});
    setCurrentInteractiveIndex(0);
    setIsCustomMode(false);
    setCustomValue("");
  };

  const stopRequest = useCallback(
    () =>
      vscode.postMessage({
        type: "stopRequest",
        ...(currentSessionId ? { sessionId: currentSessionId } : {}),
      }),
    [currentSessionId],
  );

  const escapePressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEscapePressAtRef = useRef<number | null>(null);

  useEffect(() => {
    const handleEscapeShortcut = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !hasLiveAssistantTurn || isSteering) {
        return;
      }

      const now = Date.now();
      const lastPressAt = lastEscapePressAtRef.current;
      const isDoublePress = lastPressAt !== null && now - lastPressAt <= 500;

      if (isDoublePress) {
        event.preventDefault();
        lastEscapePressAtRef.current = null;
        setIsEscapeArmed(false);
        if (escapePressTimeoutRef.current) {
          clearTimeout(escapePressTimeoutRef.current);
          escapePressTimeoutRef.current = null;
        }
        stopRequest();
        return;
      }

      lastEscapePressAtRef.current = now;
      setIsEscapeArmed(true);
      if (escapePressTimeoutRef.current) {
        clearTimeout(escapePressTimeoutRef.current);
      }
      escapePressTimeoutRef.current = setTimeout(() => {
        lastEscapePressAtRef.current = null;
        escapePressTimeoutRef.current = null;
        setIsEscapeArmed(false);
      }, 500);
    };

    window.addEventListener("keydown", handleEscapeShortcut);
    return () => {
      window.removeEventListener("keydown", handleEscapeShortcut);
      if (escapePressTimeoutRef.current) {
        clearTimeout(escapePressTimeoutRef.current);
        escapePressTimeoutRef.current = null;
      }
      lastEscapePressAtRef.current = null;
      setIsEscapeArmed(false);
    };
  }, [hasLiveAssistantTurn, isSteering, stopRequest]);

  const abortActiveResponse = () =>
    vscode.postMessage({
      type: "abortResponse",
      ...(currentSessionId ? { sessionId: currentSessionId } : {}),
    });

  const dismissInteractivePopover = (interactiveEvent: InteractiveEvent) => {
    const shouldAbortActiveResponse = interactiveEvent.type === "question";

    if (shouldAbortActiveResponse) {
      abortActiveResponse();
    }

    dispatch({
      type: "DISMISS_INTERACTIVE_EVENT",
      payload: interactiveEvent.id,
    });
  };

  const isImageAttachment = (mimeType?: string, dataUrl?: string) => {
    if (typeof mimeType === "string" && mimeType.startsWith("image/")) {
      return true;
    }
    if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
      return true;
    }
    return false;
  };

  return (
    <>
      <div
        className="oc-input-area"
      >
         {event && isPermissionPopover ? (
           <PermissionAskedPopover
             event={event}
             onReply={(response) => submitInteractiveResponse(response, event.id, event.type)}
             onAbort={() => {
               dismissInteractivePopover(event);
               abortActiveResponse();
             }}
           />
         ) : null}

         {event && !isPermissionPopover && (
           <div className="mb-2 px-1 py-1">
             <div className={`${isPermissionPopover ? "mb-1.5 pb-1" : "mb-2 pb-1.5"} border-b border-oc-border-soft`}>
               <div className="flex items-start justify-between gap-2">
                 <div className="flex min-w-0 flex-1 flex-col gap-1">
                   <div className="flex items-center gap-2">
                    {showPromptInHeader ? (
                      <div className="text-[11px] font-semibold uppercase tracking-wider oc-text-secondary">
                        {eventTitleText}
                      </div>
                    ) : null}
                    {displayInteractiveEvents.length > 1 && (
                      <div className={`flex items-center gap-1.5 ${showPromptInHeader ? "ml-2 border-l border-oc-border-soft pl-3" : ""}`}>
                    <button
                      type="button"
                      disabled={currentInteractiveIndex === 0}
                      onClick={() => {
                        const newIndex = currentInteractiveIndex - 1;
                        setCurrentInteractiveIndex(newIndex);
                        initStatesForEvent(newIndex, pendingAnswers);
                      }}
                      className="oc-quick-input-icon-btn disabled:opacity-30 transition-colors"
                      title="Previous"
                    >
                      <ArrowLeft className="h-3 w-3" />
                    </button>
                    <span className="text-[10px] font-medium oc-text-secondary tabular-nums">
                      {currentInteractiveIndex + 1} /{" "}
                      {displayInteractiveEvents.length}
                    </span>
                    <button
                      type="button"
                      disabled={
                        currentInteractiveIndex ===
                        displayInteractiveEvents.length - 1 ||
                        !currentInteractiveAnswered
                      }
                      onClick={() => {
                        if (!currentInteractiveAnswered) {
                          return;
                        }
                        const newIndex = currentInteractiveIndex + 1;
                        setCurrentInteractiveIndex(newIndex);
                        initStatesForEvent(newIndex, pendingAnswers);
                      }}
                      className="oc-quick-input-icon-btn disabled:opacity-30 transition-colors"
                      title="Next"
                    >
                      <ArrowRight className="h-3 w-3" />
                    </button>
                    {Object.keys(pendingAnswers).length > 0 && (
                      <span className="ml-1 rounded-full bg-[var(--oc-accent-soft)] px-1.5 py-0.5 text-[9px] font-semibold oc-tinted-badge-text tabular-nums">
                        {Object.keys(pendingAnswers).length} answered
                      </span>
         )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="oc-quick-input-icon-btn rounded p-1 transition-colors"
                    title="Dismiss This"
                    onClick={() => dismissInteractivePopover(event)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="relative">
              {(showContextMessage || showPromptInBody) && (
                <div className={`${isPermissionPopover ? "mb-2" : "mb-3"} text-[12px] text-[var(--oc-text-soft)]`}>
                  {showContextMessage ? (
                    <div className="mb-2 rounded bg-[var(--oc-panel)] border border-[var(--oc-border-soft)] px-2.5 py-2 text-[11px] oc-text-secondary leading-relaxed">
                      <MarkdownRenderer content={eventContextMessage} />
                    </div>
                  ) : null}
                  {showPromptInBody && !hasDistinctContextMessage ? (
                    <MarkdownRenderer content={eventBodyText} />
                  ) : null}
                </div>
              )}

              {isCustomMode ? (
                <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                  <input
                    ref={customInputRef}
                    type="text"
                    className="w-full bg-oc-panel border border-oc-border rounded px-2 py-1.5 text-xs text-oc-text outline-none focus:border-oc-accent transition-colors"
                    placeholder="Type your answer..."
                    value={customValue}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        submitInteractiveResponse(
                          customValue,
                          event.id,
                          event.type,
                        );
                      } else if (e.key === "Escape") {
                        setIsCustomMode(false);
                        setCustomValue("");
                      }
                    }}
                    onChange={(e) => setCustomValue(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="flex-1 rounded-md bg-oc-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-oc-accent/90 transition-colors"
                      onClick={() =>
                        submitInteractiveResponse(
                          customValue,
                          event.id,
                          event.type,
                        )
                      }
                    >
                      {currentInteractiveIndex === displayInteractiveEvents.length - 1 &&
                        Object.keys(pendingAnswers).length > 0
                        ? `Submit All (${Object.keys(pendingAnswers).length + 1} answers)`
                        : "Submit"}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-oc-border bg-oc-panel px-3 py-1.5 text-xs font-medium text-[var(--oc-text-soft)] hover:bg-oc-panel-hover transition-colors"
                      onClick={() => {
                        setIsCustomMode(false);
                        setCustomValue("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {event.type === "question" ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2">
                        {event.options.map((option, index) => {
                          const val = option.value || option.label;
                          let isSelected = false;
                          const ans = pendingAnswers[event.id];
                          if (event.multiSelect) {
                            isSelected = multiSelectValues.has(val);
                          } else if (ans) {
                            isSelected = ans.text === val || (Array.isArray(ans.text) && ans.text.includes(val));
                          }
                          return (
                            <button
                              key={`${event.id}-q-${option.id || val || index}`}
                              type="button"
                              className={`oc-quick-input-option rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-all ${
                                isSelected ? "!bg-oc-accent !text-white !border-oc-accent shadow-[0_0_0_1px_var(--oc-accent)]" : ""
                              }`}
                              title={option.description || option.label}
                              onClick={() => {
                                const val = option.value || option.label;
                                if (event.multiSelect) {
                                  setMultiSelectValues((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(val)) next.delete(val);
                                    else next.add(val);
                                    return next;
                                  });
                                } else {
                                  submitInteractiveResponse(
                                    val,
                                    event.id,
                                    event.type,
                                  );
                                }
                              }}
                            >
                              {renderInteractiveOptionLabel(option.label, option.recommended)}
                            </button>
                          );
                        })}
                        {event.allowCustomInput ? (
                          <button
                            type="button"
                            className={`oc-quick-input-option-muted rounded-md border border-dashed px-2.5 py-1.5 text-[11px] font-medium transition-all ${
                              isCustomMode && !event.multiSelect ? "!bg-oc-accent !text-white !border-oc-accent border-solid shadow-[0_0_0_1px_var(--oc-accent)]" : "bg-transparent"
                            }`}
                            onClick={() => setIsCustomMode(true)}
                          >
                            Custom Answer...
                          </button>
                        ) : null}
                      </div>
                      {event.multiSelect ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="rounded-md bg-oc-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-oc-accent/90 transition-colors disabled:opacity-50"
                            disabled={multiSelectValues.size === 0}
                            onClick={() => {
                              submitInteractiveResponse(
                                Array.from(multiSelectValues),
                                event.id,
                                event.type,
                              );
                              setMultiSelectValues(new Set());
                            }}
                          >
                            Submit Selection
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {event.type === "confirm" ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="oc-quick-input-option rounded-md border px-3 py-1.5 text-[11px] font-medium transition-all"
                        onClick={() =>
                          submitInteractiveResponse(
                            event.confirmLabel || "Yes",
                            event.id,
                            event.type,
                          )
                        }
                      >
                        {capitalizeFirst(event.confirmLabel || "Yes")}
                      </button>
                      <button
                        type="button"
                        className="oc-quick-input-option-muted rounded-md border px-3 py-1.5 text-[11px] font-medium transition-all"
                        onClick={() =>
                          submitInteractiveResponse(
                            event.cancelLabel || "No",
                            event.id,
                            event.type,
                          )
                        }
                      >
                        {capitalizeFirst(event.cancelLabel || "No")}
                      </button>
                    </div>
                  ) : null}

                  {event.type === "quick_actions" ? (
                    <div className="flex flex-wrap gap-2">
                      {event.actions.map((action, index) => (
                        <button
                          key={`${event.id}-a-${action.id || action.value || index}`}
                          type="button"
                          className={`oc-quick-input-option rounded-md border text-[11px] font-medium transition-all ${isPermissionPopover ? "px-2.5 py-1" : "px-2.5 py-1.5"}`}
                          title={action.description || action.label}
                          onClick={() =>
                            submitInteractiveResponse(
                              action.value || action.label,
                              event.id,
                              event.type,
                            )
                          }
                        >
                          {capitalizeFirst(action.label)}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {event.type === "message" ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="oc-quick-input-option rounded-md border px-3 py-1.5 text-[11px] font-medium transition-all"
                        onClick={() =>
                          submitInteractiveResponse(
                            event.dismissLabel || "OK",
                            event.id,
                            event.type,
                          )
                        }
                      >
                        {capitalizeFirst(event.dismissLabel || "OK")}
                      </button>
                    </div>
                  ) : null}
                </>
              )}

              {!isPermissionPopover && (
              <div className="mt-3 rounded-lg border border-oc-border-soft bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] oc-text-secondary">
                      Current model
                    </div>
                    <div className="mt-0.5 text-[11px] leading-snug text-[var(--oc-text-soft)]">
                      Pick the model for this answer before you submit.
                    </div>
                  </div>
                  <div className="shrink-0">
                    <ModelDropdown />
                  </div>
                </div>
              </div>
              )}
            </div>
          </div>
        )}

        {!showInteractivePopover && (
          <>
            {/* Context chips */}
            {(selectedFiles.length > 0 || selectedContexts.length > 0) && (
          <div className="oc-context-chips flex flex-wrap gap-1.5 mb-2">
            {selectedFiles.map((file) => (
              <div key={file} className="oc-chip">
                <FileIcon filePath={file} className="h-3.5 w-3.5" />
                <span className="truncate">{file}</span>
              </div>
            ))}
            {selectedContexts.map((context) => {
              const isResource = context.file.startsWith("resource:");
              const { displayName, lineSuffix } = contextChipDisplayParts(context);
              return (
                <div
                  key={`${context.file}:${context.lineInfo}`}
                  className="oc-chip-removable"
                >
                  {isResource ? (
                    <Wrench className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <FileIcon filePath={context.file} className="h-3.5 w-3.5" />
                  )}
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate max-w-[160px]">{displayName}</span>
                    {lineSuffix ? <span className="shrink-0">{lineSuffix}</span> : null}
                  </span>
                  {context.languageId && !isResource && (
                    <span className="opacity-60 text-[9px] font-semibold shrink-0">
                      {context.languageId}
                    </span>
                  )}
                  <button
                    type="button"
                    className="oc-chip-remove"
                    onClick={(e) => {
                      e.preventDefault();
                      dispatch({
                        type: "SET_SELECTED_CONTEXTS",
                        payload: selectedContexts.filter(
                          (c) =>
                            c.file !== context.file ||
                            c.lineInfo !== context.lineInfo,
                        ),
                      });
                    }}
                    title="Remove file"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
            )}

            {/* Attachment chips */}
            {attachments && attachments.length > 0 && (
          <div className="oc-context-chips">
            {attachments.map((a) => (
              <div key={a.id} className="oc-chip oc-chip-removable">
                {isImageAttachment(a.mimeType, a.dataUrl) ? (
                  <button
                    type="button"
                    className="oc-chip-preview"
                    onClick={() => setPreviewAttachmentSrc(a.dataUrl)}
                    title={`Preview ${a.filename ?? "image"}`}
                  >
                    <img
                      src={a.dataUrl}
                      alt={a.filename ?? "attachment image"}
                      className="oc-chip-thumb"
                    />
                    <span className="truncate max-w-[140px]">{a.filename}</span>
                  </button>
                ) : (
                  <span className="flex items-center gap-1 truncate max-w-[140px]">
                    <FileText className="h-3 w-3 shrink-0 opacity-70" />
                    <span className="truncate">{a.filename}</span>
                  </span>
                )}
                <button
                  type="button"
                  className="oc-chip-remove"
                  onClick={() =>
                    dispatch({ type: "REMOVE_ATTACHMENT", payload: a.id })
                  }
                  title={`Remove ${a.filename}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
            )}

            {/* Main input box */}
            <div className="oc-input-box">
          <Textarea
            ref={textareaRef}
            value={inputValue}
            placeholder={
              isProcessing
                ? "Ask anything..."
                : "Ask anything..."
            }
            className="oc-textarea"
            onChange={(e) => {
              const nextValue = e.target.value;
              dispatch({ type: "SET_INPUT_VALUE", payload: nextValue });
              const cursor = e.target.selectionStart ?? nextValue.length;
              setSlashTrigger(getSlashTrigger(nextValue, cursor));
              setMentionTrigger(getMentionTrigger(nextValue, cursor));
            }}
            onKeyDown={(e) => {
              if (slashTrigger) {
                if (e.key === "ArrowDown" && filteredCommands.length > 0) {
                  e.preventDefault();
                  setSelectedCommandIndex((prev) =>
                    Math.min(prev + 1, filteredCommands.length - 1),
                  );
                  return;
                }
                if (e.key === "ArrowUp" && filteredCommands.length > 0) {
                  e.preventDefault();
                  setSelectedCommandIndex((prev) => Math.max(prev - 1, 0));
                  return;
                }
                if (
                  (e.key === "Enter" || e.key === "Tab") &&
                  filteredCommands.length > 0
                ) {
                  e.preventDefault();
                  applyCommandSuggestion(
                    filteredCommands[selectedCommandIndex] ||
                    filteredCommands[0],
                  );
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSlashTrigger(null);
                  return;
                }
              }

              if (mentionTrigger && showMentionSuggestions && mentionSuggestions.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  dispatch({
                    type: "SET_MENTION_INDEX",
                    payload: Math.min(selectedMentionIndex + 1, mentionSuggestions.length - 1)
                  });
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  dispatch({
                    type: "SET_MENTION_INDEX",
                    payload: Math.max(selectedMentionIndex - 1, 0)
                  });
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  applyMentionResult(
                    mentionSuggestions[selectedMentionIndex] || mentionSuggestions[0]
                  );
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMentionTrigger(null);
                  dispatch({ type: "SET_SHOW_MENTION_SUGGESTIONS", payload: false });
                  return;
                }
              }

              if (mentionTrigger && showFileSuggestions && fileSuggestions.length > 0 && !showMentionSuggestions) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  dispatch({
                    type: "SET_SUGGESTION_INDEX",
                    payload: Math.min(selectedSuggestionIndex + 1, fileSuggestions.length - 1)
                  });
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  dispatch({
                    type: "SET_SUGGESTION_INDEX",
                    payload: Math.max(selectedSuggestionIndex - 1, 0)
                  });
                  return;
                }
                if ((e.key === "Enter" || e.key === "Tab")) {
                  e.preventDefault();
                  applyMentionSuggestion(
                    fileSuggestions[selectedSuggestionIndex] || fileSuggestions[0]
                  );
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMentionTrigger(null);
                  dispatch({ type: "SET_SHOW_FILE_SUGGESTIONS", payload: false });
                  return;
                }
              }

              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendPrompt();
              }
            }}
            onSelect={(e) => {
              const target = e.target as HTMLTextAreaElement;
              const cursor = target.selectionStart ?? target.value.length;
              setSlashTrigger(getSlashTrigger(target.value, cursor));
              setMentionTrigger(getMentionTrigger(target.value, cursor));
            }}
            onPaste={handlePaste}
          />

              {/* Slash command suggestions */}
              {slashTrigger && (
            <div className="oc-suggestions" ref={suggestionsContainerRef}>
              {!commandsLoaded ? (
                <div className="px-3 py-2 text-[11px] font-medium oc-text-secondary">
                  Loading commands...
                </div>
              ) : filteredCommands.length > 0 ? (
                filteredCommands.map((command, index) => (
                  <button
                    key={command.name}
                    type="button"
                    className={`oc-suggestion-item ${index === selectedCommandIndex ? "active" : ""
                      }`}
                    onMouseEnter={() => setSelectedCommandIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyCommandSuggestion(command)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-oc-text">
                        /{command.name.replace(/^\//, "")}
                      </span>
                      {command.source ? (
                        <span className="text-[9px] uppercase tracking-wider opacity-70">
                          {command.source}
                        </span>
                      ) : null}
                    </div>
                    {command.description ? (
                      <div className="mt-0.5 truncate text-[10px] oc-text-secondary">
                        {command.description}
                      </div>
                    ) : null}
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-[11px] font-medium oc-text-secondary">
                  No matching commands.
                </div>
              )}
            </div>
              )}

              {/* File suggestions (legacy path) */}
              {showFileSuggestions && fileSuggestions.length > 0 && !showMentionSuggestions && (
            <div className="oc-suggestions" ref={suggestionsContainerRef}>
              {fileSuggestions.map((suggestion, index) => (
                <button
                  key={suggestion.path}
                  type="button"
                  className={`oc-suggestion-item ${index === selectedSuggestionIndex ? "active" : ""
                    }`}
                  onMouseEnter={() => dispatch({ type: "SET_SUGGESTION_INDEX", payload: index })}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyMentionSuggestion(suggestion)}
                >
                  {suggestion.name}
                </button>
              ))}
            </div>
              )}

              {/* Mention suggestions (agents + files + MCP resources) */}
              {showMentionSuggestions && mentionSuggestions.length > 0 && (
            <div className="oc-suggestions" ref={suggestionsContainerRef}>
              {mentionSuggestions.map((item, index) => (
                <button
                  key={`${item.type}:${item.type === "agent" ? item.id : item.type === "file" ? item.path : item.uri}`}
                  type="button"
                  className={`oc-suggestion-item ${index === selectedMentionIndex ? "active" : ""}`}
                  onMouseEnter={() => dispatch({ type: "SET_MENTION_INDEX", payload: index })}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyMentionResult(item)}
                >
                  <span className="flex items-center gap-2 w-full min-w-0">
                    {item.type === "agent" && (
                      <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--vscode-textLink-foreground)]" />
                    )}
                    {item.type === "file" && (
                      <span className="shrink-0 oc-text-secondary text-[10px]">📄</span>
                    )}
                    {item.type === "resource" && (
                      <Wrench className="h-3.5 w-3.5 shrink-0 text-[var(--vscode-notificationsWarningIcon-foreground)]" />
                    )}
                    <span className="truncate text-[11px]">
                      {item.type === "agent" && item.name}
                      {item.type === "file" && item.name}
                      {item.type === "resource" && item.name}
                    </span>
                    {item.type === "agent" && item.description && (
                      <span className="ml-auto text-[9px] oc-text-secondary truncate max-w-[140px]">
                        {item.description}
                      </span>
                    )}
                    {item.type === "file" && (
                      <span className="ml-auto text-[9px] oc-text-secondary truncate max-w-[140px]" title={item.path}>
                        {item.path}
                      </span>
                    )}
                    {item.type === "resource" && (
                      <span className="ml-auto text-[9px] oc-text-secondary truncate max-w-[140px]">
                        {item.clientName}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
              )}

              {/* Bottom toolbar */}
              <div className="oc-toolbar">
            {/* Unified controls cluster */}
            <div className="oc-toolbar-center">
              <AgentDropdown />
              <ModelDropdown />
              <ThinkingLevelControl />
            </div>

            {/* Right: action buttons */}
            <div className="oc-toolbar-right">
              {hasLiveAssistantTurn ? (
                <Button
                  variant="send"
                  size="icon"
                  className="oc-toolbar-action-icon oc-toolbar-action-icon-stop"
                  onClick={stopRequest}
                  disabled={isSteering}
                  aria-label="Stop"
                  title="Stop (press Escape twice)"
                >
                  {isEscapeArmed ? (
                    <span className="text-[9px] font-bold leading-none">ESC</span>
                  ) : (
                    <Square className="h-3 w-3" />
                  )}
                </Button>
              ) : null}
              {!hasLiveAssistantTurn || inputValue.trim().length > 0 ? (
                <Button
                  variant="send"
                  size="icon"
                  className="oc-toolbar-action-icon"
                  onClick={sendPrompt}
                  disabled={isSteering}
                  aria-label={hasLiveAssistantTurn ? "Send steering message" : "Send"}
                  title={hasLiveAssistantTurn ? "Send steering message" : "Send"}
                >
                  {!hasLiveAssistantTurn ? (
                    <Send className="h-3 w-3" />
                  ) : inputValue.trim().length > 0 ? (
                    <AlertCircle className="h-3 w-3" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                </Button>
              ) : null}
            </div>
              </div>
            </div>
          </>
        )}
        <ImagePreviewModal
          isOpen={previewAttachmentSrc !== null}
          imageSrc={previewAttachmentSrc}
          imageAlt="Attachment image"
          title="Attachment Preview"
          onClose={() => setPreviewAttachmentSrc(null)}
        />
      </div>
    </>
  );
});

export const ThinkingLevelControl = memo(function ThinkingLevelControl() {
  const { thinkingLevel, thinkingDropdownOpen, modelCapability } = useAppState(
    (state) => ({
      thinkingLevel: state.thinkingLevel,
      thinkingDropdownOpen: state.thinkingDropdownOpen,
      modelCapability: state.modelCapability,
    }),
    shallowEqual,
  );
  const dispatch = useAppDispatch();
  const containerRef = useRef<HTMLDivElement>(null);
  const variantDescriptions: Record<string, string> = {
    auto: "Let the model decide",
    minimal: "Fastest response",
    low: "Light reasoning",
    medium: "Balanced reasoning",
    high: "Deeper reasoning",
    xhigh: "Maximum reasoning",
  };

  const setLevel = (level: ThinkingLevel) => {
    dispatch({ type: "SET_THINKING_LEVEL", payload: level });
    dispatch({ type: "SET_THINKING_DROPDOWN_OPEN", payload: false });
    try {
      vscode.postMessage({ type: "setThinkingLevel", level });
    } catch (e) {
      /* ignore */
    }
  };

  // Close on outside click
  useEffect(() => {
    if (!thinkingDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        dispatch({ type: "SET_THINKING_DROPDOWN_OPEN", payload: false });
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [thinkingDropdownOpen, dispatch]);

  const baseVariants =
    modelCapability && Array.isArray(modelCapability.variants)
      ? modelCapability.variants
      : [];
  const localVariants: ThinkingLevel[] =
    baseVariants.length > 0
      ? ["auto" as ThinkingLevel, ...(baseVariants as ThinkingLevel[])]
      : [];

  const displayLabel = (lvl?: string) => {
    const current =
      lvl && lvl !== "none" && (!localVariants.length || localVariants.includes(lvl))
        ? lvl
        : localVariants[1] ?? localVariants[0];
    if (!current) return "Medium";
    return current.charAt(0).toUpperCase() + current.slice(1).toLowerCase();
  };

  useEffect(() => {
    if (!localVariants || localVariants.length === 0) return;
    if (!thinkingLevel || !localVariants.includes(thinkingLevel)) {
      dispatch({ type: "SET_THINKING_LEVEL", payload: localVariants[0] as ThinkingLevel });
    }
  }, [(localVariants || []).join(","), thinkingLevel, dispatch]);

  if (
    !modelCapability ||
    !modelCapability.reasoning ||
    !Array.isArray(localVariants) ||
    localVariants.length === 0
  ) {
    return null;
  }

  return (
    <div className="relative oc-toolbar-control" ref={containerRef}>
      <Button
        type="button"
        variant="chip"
        size="chip"
        className="oc-toolbar-chip"
        onClick={() =>
          dispatch({
            type: "SET_THINKING_DROPDOWN_OPEN",
            payload: !thinkingDropdownOpen,
          })
        }
        aria-label="Set thinking level"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <Brain className="oc-thinking-chip-icon h-3.5 w-3.5 shrink-0" />
          <span className="truncate oc-thinking-chip-label">{displayLabel(thinkingLevel)}</span>
        </div>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${thinkingDropdownOpen ? "rotate-180" : ""
            }`}
        />
      </Button>
      {thinkingDropdownOpen && (
        <div className="oc-popover absolute bottom-full left-0 z-30 mb-1.5 w-52 rounded-xl border border-oc-border bg-oc-panel shadow-xl overflow-hidden">
          <div className="px-1.5 py-1.5">
            {(localVariants as ThinkingLevel[]).map((level) => (
              <button
                key={level}
                type="button"
                className={`oc-popover-item w-full rounded-lg px-3 py-2 text-left transition-colors ${
                  thinkingLevel === level
                    ? "bg-oc-accent-soft oc-popover-item-selected"
                    : "oc-popover-item-not-selected"
                }`}
                onClick={() => setLevel(level)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium capitalize">
                    {level}
                  </span>
                  {thinkingLevel === level ? (
                    <span
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-oc-accent text-[color:var(--vscode-button-foreground)] shadow-sm ring-1 ring-oc-accent/30"
                      aria-hidden="true"
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-[11px] oc-text-secondary">
                  {variantDescriptions[level.toLowerCase()] ?? "Custom reasoning mode"}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export const QuotaMonitor = memo(function QuotaMonitor() {
  const { quotaData, quotaIsRefreshing } = useAppState(
    (state) => ({
      quotaData: state.quotaData,
      quotaIsRefreshing: state.quotaIsRefreshing,
    }),
    shallowEqual,
  );
  const dispatch = useAppDispatch();

  const [open, setOpen] = useState(true);

  const handleRefresh = () => {
    dispatch({ type: "SET_QUOTA_REFRESHING", payload: true });
    vscode.postMessage({ type: "refreshQuota" });
  };

  const lastUpdatedLabel = quotaData
    ? new Date(quotaData.lastUpdated).toLocaleTimeString()
    : null;

  const toProviderName = (platform: string, title?: string) => {
    // Prefer title when available - strip "Account Quota" suffix for cleaner display
    if (title) {
      const cleanedTitle = title
        .replace(" Account Quota", "")
        .replace(" account quota", "")
        .trim();
      return cleanedTitle || platform;
    }

    // Fallback to specific normalization for known broad providers
    const key = platform.toLowerCase();
    if (key.includes("openai")) return "OpenAI";
    if (key.includes("zai")) return "Z.ai";
    if (key.includes("zhipu")) return "Zhipu AI";
    if (key.includes("copilot")) return "GitHub Copilot";

    // Last resort: use platform name
    return platform;
  };

  const barColor = (pct: number) => {
    if (pct >= 50) return "oc-quota-bar-healthy";
    if (pct >= 20) return "oc-quota-bar-warning";
    return "oc-quota-bar-critical";
  };

  return (
    <div className="oc-quota-monitor border-t border-oc-border text-xs">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="oc-panel-title">Quota Monitor</div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost-accent"
            size="sm"
            className="h-7 px-2 text-xs font-medium normal-case tracking-normal"
            title="Refresh quota"
            aria-label="Refresh quota"
            disabled={quotaIsRefreshing}
            onClick={handleRefresh}
          >
            <RefreshCw
              className={`mr-1 h-3.5 w-3.5 ${quotaIsRefreshing ? "animate-spin" : ""
                }`}
            />
            Refresh
          </Button>
          <Button
            type="button"
            aria-label={
              open ? "Collapse Quota Monitor" : "Expand Quota Monitor"
            }
            onClick={() => setOpen((v) => !v)}
            variant="ghost"
            size="icon"
            className="flex items-center gap-1 text-xs text-[var(--oc-text-soft)] opacity-80 hover:text-oc-accent transition-colors p-1"
          >
            {open ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="p-3">
          {!quotaData && !quotaIsRefreshing ? (
            <div className="py-4 text-center text-[var(--oc-text-soft)] opacity-60 text-xs">
              No quota data
            </div>
          ) : null}

          {quotaIsRefreshing && !quotaData ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded-md bg-oc-border opacity-40"
                />
              ))}
            </div>
          ) : null}

          {quotaData ? (
            <div className="space-y-3">
              {[...quotaData.platforms]
                .sort((a, b) => {
                  // Sort by platform name first, then by account
                  const platformCompare = a.platform.localeCompare(b.platform);
                  if (platformCompare !== 0) return platformCompare;
                  return a.account.localeCompare(b.account);
                })
                .map((platform) => (
                  <div
                    key={`${platform.platform}-${platform.account}`}
                    className="oc-modal-shell overflow-hidden p-0 bg-[linear-gradient(180deg,var(--oc-panel)_0%,var(--oc-panel-soft)_100%)] shadow-[0_6px_20px_rgba(0,0,0,0.2)]"
                  >
                    <div className="oc-modal-header px-3 py-2.5">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold tracking-tight text-[var(--oc-text-soft)]">
                          {toProviderName(platform.platform, platform.title)}
                        </span>
                        {platform.status === "error" ? (
                          <Badge
                            variant="error"
                            className="text-xs uppercase"
                          >
                            error
                          </Badge>
                        ) : platform.status === "warning" ? (
                          <Badge
                            variant="warning"
                            className="oc-quota-warning text-xs uppercase"
                          >
                            warning
                          </Badge>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
                        <span className="text-xs font-medium text-[var(--oc-text-soft)] opacity-85">
                          Account:
                        </span>
                        <span className="truncate text-xs text-[var(--oc-text-soft)]">
                          {platform.account} {platform.accountLabel ?? ""}
                        </span>
                      </div>
                    </div>

                    <div className="oc-modal-content space-y-2.5 px-3 py-2.5">
                      {platform.error ? (
                        <div className="rounded-md border border-oc-border-soft bg-oc-panel-soft/40 px-2.5 py-2 text-oc-red">
                          {platform.error.length > 130
                            ? `${platform.error.slice(0, 127)}...`
                            : platform.error}
                        </div>
                      ) : null}

                      {platform.quotas.map((quota) => {
                        const pct = Math.max(
                          0,
                          Math.min(100, quota.remainPercent),
                        );

                        return (
                          <div
                            key={quota.label}
                            className="oc-quota-item"
                          >
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="text-xs font-medium text-[var(--oc-text-soft)]">
                                {quota.label}
                              </span>
                              <span className="font-medium text-xs text-[var(--oc-text-soft)]">
                                {quota.percentLabel ??
                                  `${Math.round(pct)}% remaining`}
                              </span>
                            </div>
                            <div className="h-1 w-full overflow-hidden rounded-full bg-oc-border">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${barColor(pct)}`}
                                style={{
                                  width: `${pct}%`,
                                }}
                              />
                            </div>

                            <div className="mt-1.5 space-y-0.5 text-xs text-[var(--oc-text-soft)] opacity-70">
                              {quota.usedTotalDisplay ? (
                                <div className="flex items-center justify-between gap-2">
                                  <span>Used</span>
                                  <span className="font-medium text-[var(--oc-text-soft)]">
                                    {quota.usedTotalDisplay}
                                  </span>
                                </div>
                              ) : null}
                              {quota.resetLabel ? (
                                <div className="flex items-center justify-between gap-2">
                                  <span>Resets in</span>
                                  <span className="font-medium text-[var(--oc-text-soft)]">
                                    {quota.resetLabel}
                                  </span>
                                </div>
                              ) : null}
                              {quota.note ? (
                                <div className="flex gap-2 mt-1.5 pt-1.5 border-t border-oc-border opacity-80">
                                  <span className="text-[var(--oc-text-soft)] italic">
                                    {quota.note}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}

                    </div>
                  </div>
                ))}

              {lastUpdatedLabel ? (
                <div className="text-center text-xs text-[var(--oc-text-soft)] opacity-50 font-medium">
                  Updated: {lastUpdatedLabel}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

// TodoPanel - displays todo items in right panel
export const TodoPanel = memo(function TodoPanel() {
  const todoItems = useAppState((s) => s.todoItems);
  const [open, setOpen] = useState(true);

  const sortedTodoItems = useMemo(() => {
    const rank: Record<TodoItem["status"], number> = {
      in_progress: 0,
      pending: 1,
      failed: 2,
      cancelled: 3,
      completed: 4,
    };
    return [...(todoItems || [])].sort(
      (left, right) => (rank[left.status] ?? 9) - (rank[right.status] ?? 9),
    );
  }, [todoItems]);

  const statusIcon = (status?: string) => {
    switch (status) {
      case "pending":
        return "⏳";
      case "in_progress":
        return "🔄";
      case "completed":
        return "✅";
      case "failed":
      case "cancelled":
        return "❌";
      default:
        return "•";
    }
  };

  const statusLabel = (status?: TodoItem["status"]) => {
    switch (status) {
      case "pending":
        return "Pending";
      case "in_progress":
        return "In progress";
      case "completed":
        return "Completed";
      case "failed":
        return "Failed";
      case "cancelled":
        return "Cancelled";
      default:
        return "Unknown";
    }
  };

  const statusTone = (status?: TodoItem["status"]) => {
    switch (status) {
      case "pending":
        return "oc-quota-warning border-transparent bg-oc-quota-warning-bg shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-yellow)_14%,transparent)]";
      case "in_progress":
        return "oc-tinted-badge-text bg-oc-accent/10 border-transparent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-accent)_14%,transparent)]";
      case "completed":
        return "text-oc-green bg-oc-green/10 border-transparent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-green)_14%,transparent)]";
      case "failed":
        return "text-oc-red bg-oc-red/10 border-transparent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-red)_14%,transparent)]";
      case "cancelled":
        return "text-[var(--oc-text-soft)] bg-oc-panel-soft border-transparent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-text)_10%,transparent)]";
      default:
        return "text-[var(--oc-text-soft)] bg-oc-panel-soft border-transparent shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-text)_10%,transparent)]";
    }
  };

  const priorityTone = (priority?: TodoItem["priority"]) => {
    switch (priority) {
      case "high":
        return "text-oc-red border-transparent bg-oc-red/10 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-red)_14%,transparent)]";
      case "medium":
        return "oc-quota-warning border-transparent bg-oc-quota-warning-bg shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-yellow)_14%,transparent)]";
      case "low":
        return "text-[var(--oc-text-soft)] border-transparent bg-oc-panel-soft shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-text)_10%,transparent)]";
      default:
        return "text-[var(--oc-text-soft)] border-transparent bg-oc-panel-soft shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--oc-text)_10%,transparent)]";
    }
  };

  return (
    <div className="oc-todo-panel border-t border-oc-border p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <div className="oc-panel-title">TODOs</div>
        <Button
          type="button"
          aria-label={open ? "Collapse TODOs" : "Expand TODOs"}
          onClick={() => setOpen((v) => !v)}
          variant="ghost"
          size="icon"
          className="flex items-center gap-1 text-xs text-[var(--oc-text-soft)] hover:text-oc-accent transition-colors"
        >
          {open ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronUp className="h-3 w-3" />
          )}
        </Button>
      </div>

      {open ? (
        <div>
          {sortedTodoItems.length === 0 ? (
            <div className="py-3 text-center text-[var(--oc-text-soft)] opacity-60 text-xs">
              No tasks yet
            </div>
          ) : (
            <div className="space-y-1.5">
              {sortedTodoItems.map((t) => (
                <div
                  key={t.id}
                  className="oc-panel-section flex items-start gap-2 bg-oc-panel-soft p-2"
                >
                  <div
                    className={`text-[14px] leading-none mt-0.5 ${t.status === "failed"
                        ? "text-oc-red"
                        : t.status === "completed"
                          ? "text-oc-green"
                          : t.status === "in_progress"
                            ? "text-oc-accent"
                            : t.status === "pending"
                              ? "oc-quota-warning"
                              : "text-[var(--oc-text-soft)]"
                      }`}
                  >
                    {statusIcon(t.status)}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-xs text-[var(--oc-text-soft)] leading-relaxed break-words">
                      {t.description ?? t.text ?? "Untitled"}
                    </div>
                    <div
                      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusTone(
                        t.status,
                      )}`}
                    >
                      {statusLabel(t.status)}
                    </div>
                    {t.priority ? (
                      <div
                        className={`ml-1 inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${priorityTone(
                          t.priority,
                        )}`}
                      >
                        {t.priority}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
});

// McpPanel - displays MCP (Model Context Protocol) server status with live data from OpenCode SDK
export const McpPanel = memo(function McpPanel() {
  const [open, setOpen] = useState(true);
  const [expandedServers, setExpandedServers] = useState<Set<string>>(
    new Set(),
  );
  const { mcpServers } = useAppState(
    (state) => ({ mcpServers: state.mcpServers }),
    shallowEqual,
  );
  const dispatch = useAppDispatch();

  function toggleServer(name: string) {
    setExpandedServers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  function requestRefresh() {
    dispatch({ type: "SET_MCP_SERVERS", payload: [] });
    vscode.postMessage({ type: "getMcpStatus" });
  }

  const connectedCount = mcpServers.filter(
    (s) => s.status === "connected",
  ).length;
  const hasServers = mcpServers.length > 0;

  function statusDot(status: string) {
    if (status === "connected") return "bg-[var(--oc-green)]";
    if (status === "disabled") return "bg-[var(--oc-text-soft)] opacity-40";
    if (status === "needs_auth" || status === "needs_client_registration")
      return "bg-[var(--oc-yellow,#f59e0b)]";
    return "bg-[var(--oc-red)]";
  }

  function StatusIcon({ status }: { status: string }) {
    if (status === "failed")
      return (
        <AlertCircle
          className="h-3 w-3 text-[var(--oc-red)]"
          aria-label="Server failed"
        />
      );
    if (status === "needs_auth" || status === "needs_client_registration")
      return (
        <Lock
          className="h-3 w-3 text-[var(--oc-yellow,#f59e0b)]"
          aria-label="Authentication needed"
        />
      );
    if (status === "disabled")
      return (
        <WifiOff
          className="h-3 w-3 text-[var(--oc-text-soft)] opacity-40"
          aria-label="Disabled"
        />
      );
    return null;
  }

  return (
    <div className="oc-mcp-panel border-t border-oc-border p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <div className="oc-panel-title">MCP Servers</div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            aria-label="Refresh MCP status"
            onClick={requestRefresh}
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-[var(--oc-text-soft)] hover:text-oc-accent transition-colors"
            title="Refresh MCP server status"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            aria-label={open ? "Collapse MCP" : "Expand MCP"}
            onClick={() => setOpen((v) => !v)}
            variant="ghost"
            size="icon"
            className="oc-collapse-btn h-5 w-5 text-[var(--oc-text-soft)] hover:text-oc-accent transition-colors"
          >
            {open ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="space-y-1.5">
          {!hasServers ? (
            <div className="py-2 text-center text-xs text-[var(--oc-text-soft)] opacity-60">
              No MCP servers configured
            </div>
          ) : (
            mcpServers.map((server) => {
              const isExpanded = expandedServers.has(server.name);
              const hasTools = server.tools.length > 0;
              return (
                <div
                  key={server.name}
                  className="oc-panel-section bg-oc-panel-soft p-0"
                >
                  {/* Server row */}
                  <div className="oc-details-list-row flex items-center gap-2 p-2">
                    <span
                      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(server.status)}`}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate font-medium text-xs font-medium text-[var(--oc-text-soft)]">
                      {server.name}
                    </span>
                    <StatusIcon status={server.status} />
                    <span className="text-xs text-[var(--oc-text-soft)] opacity-70 tabular-nums">
                      {server.tools.length > 0
                        ? `${server.tools.length} tools`
                        : server.status}
                    </span>
                    {hasTools && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={
                          isExpanded
                            ? `Collapse ${server.name} tools`
                            : `Expand ${server.name} tools`
                        }
                        aria-expanded={isExpanded}
                        onClick={() => toggleServer(server.name)}
                        className="h-4 w-4 shrink-0 text-[var(--oc-text-soft)] hover:text-oc-accent transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                  </div>

                  {/* Error message */}
                  {server.error && (
                    <div className="px-2 pb-1.5 text-xs text-[var(--oc-red)] opacity-80">
                      <AlertTriangle className="mr-1 inline h-3 w-3" />
                      {server.error}
                    </div>
                  )}

                  {/* Tool list (expandable) */}
                  {isExpanded && hasTools && (
                    <div className="border-t border-oc-border px-2 pb-2 pt-1">
                      <div className="mb-1 flex items-center gap-1 text-xs text-[var(--oc-text-soft)] opacity-60">
                        <Wrench className="h-2.5 w-2.5" />
                        <span>Tools</span>
                      </div>
                      <ul className="space-y-0.5">
                        {server.tools.map((tool) => (
                          <li
                            key={tool}
                            className="truncate rounded px-1 py-0.5 font-medium text-[10px] text-[var(--oc-text-soft)] opacity-80 hover:bg-oc-border/40"
                            title={tool}
                          >
                            {tool}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })
          )}
          {hasServers && (
            <div className="oc-agent-list-summary mt-1.5 text-center text-xs text-[var(--oc-text-soft)] opacity-60">
              {connectedCount} / {mcpServers.length} connected
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
});

// LspPanel - displays Language Server Protocol status with live data from OpenCode SDK
export const LspPanel = memo(function LspPanel() {
  const [open, setOpen] = useState(true);
  const { lspServers } = useAppState(
    (state) => ({ lspServers: state.lspServers }),
    shallowEqual,
  );

  const activeCount = lspServers.filter((s) => s.status === "connected").length;
  const hasServers = lspServers.length > 0;

  const requestRefresh = () => {
    vscode.postMessage({ type: "getLspStatus" });
  };

  return (
    <div className="oc-lsp-panel border-t border-oc-border p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <div className="oc-panel-title">LSP Servers</div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            aria-label="Refresh LSP status"
            onClick={requestRefresh}
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-[var(--oc-text-soft)] hover:text-oc-accent transition-colors"
            title="Refresh LSP server status"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            aria-label={open ? "Collapse LSP" : "Expand LSP"}
            onClick={() => setOpen((v) => !v)}
            variant="ghost"
            size="icon"
            className="oc-collapse-btn h-5 w-5 text-[var(--oc-text-soft)] hover:text-oc-accent transition-colors"
          >
            {open ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="space-y-1.5">
          {!hasServers ? (
            <div className="py-2 text-center text-xs text-[var(--oc-text-soft)] opacity-60">
              No language servers active
            </div>
          ) : (
            lspServers.map((server) => (
              <div
                key={server.id}
                className="oc-panel-section bg-oc-panel-soft p-0"
              >
                <div className="oc-details-list-row flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${server.status === "connected"
                          ? "bg-[var(--oc-green)]"
                          : "bg-[var(--oc-red)]"
                        }`}
                      aria-hidden="true"
                    />
                    <span className="truncate font-medium text-xs font-medium text-[var(--oc-text-soft)]">
                      {server.name}
                    </span>
                  </div>
                  {server.status === "error" && (
                    <AlertCircle
                      className="h-3 w-3 shrink-0 text-[var(--oc-red)]"
                      aria-label="Language server error"
                    />
                  )}
                </div>
                {server.root && (
                  <div
                    className="mt-0.5 truncate pl-3.5 text-[10px] text-[var(--oc-text-soft)] opacity-50"
                    title={server.root}
                  >
                    {server.root}
                  </div>
                )}
              </div>
            ))
          )}
          {hasServers && (
            <div className="mt-1.5 text-center text-xs text-[var(--oc-text-soft)] opacity-60">
              {activeCount} / {lspServers.length} language servers active
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
});

// SkillsPanel - displays slash command skills from the OpenCode SDK command catalog
export const SkillsPanel = memo(function SkillsPanel() {
  const [open, setOpen] = useState(true);
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { availableSkills, serverStatus } = useAppState(
    (state) => ({
      availableSkills: state.availableSkills,
      serverStatus: state.serverStatus,
    }),
    shallowEqual,
  );
  const dispatch = useAppDispatch();

  const hasSkills = availableSkills.length > 0;

  // Load skills on mount if server is ready
  useEffect(() => {
    if (serverStatus === "running") {
      vscode.postMessage({ type: "getMySkills" });
    }
  }, [serverStatus]);

  function handleRefresh() {
    setIsRefreshing(true);
    dispatch({ type: "SET_SKILLS_LIST", payload: [] });
    vscode.postMessage({ type: "getMySkills" });
    setTimeout(() => setIsRefreshing(false), 3000);
  }

  function toggleSkill(name: string) {
    setExpandedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  return (
    <div className="oc-skills-panel border-t border-oc-border p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <div className="oc-panel-title flex items-center gap-1.5">
          <span>Skills</span>
          {hasSkills && (
            <span className="text-[10px] text-[var(--oc-text-soft)] opacity-50">
              {availableSkills.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            aria-label="Refresh Skills"
            onClick={handleRefresh}
            disabled={isRefreshing}
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-[var(--oc-text-soft)] hover:text-oc-accent transition-colors"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
          <Button
            type="button"
            aria-label={open ? "Collapse Skills" : "Expand Skills"}
            onClick={() => setOpen((v) => !v)}
            variant="ghost"
            size="icon"
            className="oc-collapse-btn h-5 w-5 text-[var(--oc-text-soft)] hover:text-oc-accent transition-colors"
          >
            {open ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
          {!hasSkills ? (
            <div className="py-2 text-center text-xs text-[var(--oc-text-soft)] opacity-60">
              No skills configured
            </div>
          ) : (
            availableSkills.map((skill) => {
              const isExpanded = expandedSkills.has(skill.name);
              const hasDetail = !!skill.description;
              return (
                <div
                  key={skill.name}
                  className="oc-panel-section oc-skill-record bg-oc-panel-soft p-0"
                >
                  <div className="oc-details-list-row flex items-center gap-2 p-2">
                    <span className="flex-1 truncate font-medium text-xs font-medium text-[var(--oc-text-soft)]">
                      {skill.name}
                    </span>
                    {skill.source && (
                      <span
                        className="shrink-0 rounded px-1 py-0.5 text-[10px] text-[var(--oc-text-soft)] opacity-50"
                        title={`Source: ${skill.source}`}
                      >
                        {skill.source}
                      </span>
                    )}
                    {hasDetail && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={
                          isExpanded
                            ? `Collapse ${skill.name}`
                            : `Expand ${skill.name}`
                        }
                        aria-expanded={isExpanded}
                        onClick={() => toggleSkill(skill.name)}
                        className="oc-detail-row-toggle h-4 w-4 shrink-0 text-[var(--oc-text-soft)] hover:text-oc-accent transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                  </div>

                  {isExpanded && hasDetail && (
                    <div className="oc-skill-details border-t border-oc-border px-2 pb-2 pt-1 space-y-0.5">
                      {skill.description && (
                        <div className="text-[10px] text-[var(--oc-text-soft)] opacity-70 leading-relaxed">
                          {skill.description}
                        </div>
                      )}
                      {skill.agent && (
                        <div className="flex items-center gap-1 text-[10px] text-[var(--oc-text-soft)] opacity-60">
                          <Bot className="h-2.5 w-2.5" />
                          <span>{skill.agent}</span>
                        </div>
                      )}
                      {skill.model && (
                        <div className="flex items-center gap-1 text-[10px] text-[var(--oc-text-soft)] opacity-60">
                          <Wrench className="h-2.5 w-2.5" />
                          <span className="font-medium">{skill.model}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
});

// AgentsPanel - displays installed agents/skills with live data from OpenCode SDK
export const AgentsPanel = memo(function AgentsPanel() {
  const [open, setOpen] = useState(true);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { availableAgents } = useAppState(
    (state) => ({ availableAgents: state.availableAgents }),
    shallowEqual,
  );
  const dispatch = useAppDispatch();

  const hasAgents = availableAgents.length > 0;
  const builtInCount = availableAgents.filter((a) => a.builtIn).length;
  const customCount = availableAgents.length - builtInCount;

  function toggleAgent(id: string) {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleRefresh() {
    setIsRefreshing(true);
    dispatch({ type: "SET_AGENTS_LIST", payload: [] });
    vscode.postMessage({ type: "getAgents" });
    // Set a timeout to reset the loading state if it takes too long
    setTimeout(() => setIsRefreshing(false), 3000);
  }

  function modeBadgeClass(mode: string | undefined) {
    if (mode === "subagent")
      return "bg-[var(--oc-yellow,#f59e0b)]/20 oc-tinted-badge-text";
    if (mode === "all") return "bg-[var(--oc-accent)]/20 oc-tinted-badge-text";
    // primary (default)
    return "bg-[var(--oc-green)]/20 oc-tinted-badge-text";
  }

  return (
    <div className="oc-agents-panel border-t border-oc-border p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <div className="oc-panel-title flex items-center gap-1.5">
          <span>Agents</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            aria-label="Refresh agents"
            onClick={handleRefresh}
            disabled={isRefreshing}
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-[var(--oc-text-soft)] hover:text-oc-accent transition-colors"
            title="Refresh agents list"
          >
            <RefreshCw
              className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </Button>
          <Button
            type="button"
            aria-label={open ? "Collapse Agents" : "Expand Agents"}
            onClick={() => setOpen((v) => !v)}
            variant="ghost"
            size="icon"
            className="oc-collapse-btn h-5 w-5 text-[var(--oc-text-soft)] hover:text-oc-accent transition-colors"
          >
            {open ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="oc-agent-panel-content">
          {!hasAgents ? (
            <div className="py-2 text-center text-xs text-[var(--oc-text-soft)] opacity-60">
              No agents available
            </div>
          ) : (
            <>
            <div className="oc-agent-list">
            {availableAgents.map((agent) => {
              const isExpanded = expandedAgents.has(agent.id);
              const hasDescription = !!agent.description;
              return (
                <div
                  key={agent.id}
                  className="oc-panel-section bg-oc-panel-soft p-0"
                >
                  <div className="oc-details-list-row flex items-center gap-2 p-2">
                    <span
                      className="oc-agent-color-dot inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: agent.color ?? "var(--oc-accent)",
                      }}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate font-medium text-xs font-medium text-[var(--oc-text)]">
                      {agent.name}
                    </span>
                    {agent.mode && (
                      <span
                        className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium tabular-nums ${modeBadgeClass(agent.mode)}`}
                        title={`Mode: ${agent.mode}`}
                      >
                        {agent.mode}
                      </span>
                    )}
                    {agent.builtIn && (
                      <span
                        className="shrink-0 rounded px-1 py-0.5 text-[10px] text-[var(--oc-text-secondary)] opacity-75"
                        title="Built-in agent"
                      >
                        built-in
                      </span>
                    )}
                    {hasDescription && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={
                          isExpanded
                            ? `Collapse ${agent.name} details`
                            : `Expand ${agent.name} details`
                        }
                        aria-expanded={isExpanded}
                        onClick={() => toggleAgent(agent.id)}
                        className="oc-detail-row-toggle h-4 w-4 shrink-0 text-[var(--oc-text-soft)] hover:text-oc-accent transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                  </div>

                  {isExpanded && hasDescription && (
                    <div className="border-t border-oc-border px-2 pb-2 pt-1 text-[10px] text-[var(--oc-text-secondary)] opacity-90 leading-relaxed">
                      {agent.description}
                    </div>
                  )}
                </div>
              );
            })}
            </div>
            <div className="oc-agent-list-summary text-center text-[var(--oc-text-soft)] opacity-60">
              {customCount > 0
                ? `${customCount} custom · ${builtInCount} built-in`
                : `${builtInCount} built-in`}
            </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
});

type ConfigPrimitive = string | number | boolean | null;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function stripJsonComments(source: string): string {
  let output = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaping = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function stripTrailingCommas(source: string): string {
  return source.replace(/,\s*([}\]])/g, "$1");
}

function tryParseConfigContent(
  content: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch (strictError) {
    try {
      const cleaned = stripTrailingCommas(stripJsonComments(content));
      return { ok: true, value: JSON.parse(cleaned) };
    } catch (jsoncError) {
      return { ok: false, error: toErrorMessage(jsoncError || strictError) };
    }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isConfigPrimitive(value: unknown): value is ConfigPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function formatConfigContent(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function resolveConfigPayload(data: unknown): Record<string, unknown> | null {
  if (!isPlainRecord(data)) {
    return null;
  }
  if (isPlainRecord(data.payload)) {
    return data.payload;
  }
  return data;
}

// Helper function for immutable path-based updates
function updateAtPath(obj: unknown, path: string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [key, ...rest] = path;
  if (Array.isArray(obj)) {
    const copy = [...obj];
    copy[Number(key)] = rest.length === 0 ? value : updateAtPath(copy[Number(key)], rest, value);
    return copy;
  } else if (typeof obj === 'object' && obj !== null) {
    const record = obj as Record<string, unknown>;
    return { ...record, [key]: rest.length === 0 ? value : updateAtPath(record[key], rest, value) };
  }
  return value;
}

export const SettingsModal = memo(function SettingsModal({
  isOpen,
  onClose,
  initialContent,
  filePath,
  isGlobal,
  availableModels,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialContent: string;
  filePath?: string;
  isGlobal?: boolean;
  availableModels?: Model[];
}) {
  const [content, setContent] = useState(initialContent);
  const [activeTab, setActiveTab] = useState<"gui" | "json">("gui");
  const [error, setError] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newType, setNewType] = useState<"string" | "number" | "boolean">(
    "string",
  );
  const [newValue, setNewValue] = useState("");
  const [newBooleanValue, setNewBooleanValue] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setContent(initialContent || "{\n}\n");
      setActiveTab("gui");
      setError("");
      setIsSaving(false);
      setNewKey("");
      setNewType("string");
      setNewValue("");
      setNewBooleanValue(false);
    }
  }, [isOpen, initialContent]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!isPlainRecord(data) || data.type !== "opencodeConfigSaved") {
        return;
      }

      const payload = resolveConfigPayload(data);
      if (!payload) {
        return;
      }

      const success = payload.success === true;
      setIsSaving(false);
      if (success) {
        setError("");
        onClose();
        return;
      }

      const saveError =
        typeof payload.error === "string"
          ? payload.error
          : "Failed to save OpenCode configuration.";
      setError(saveError);
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [isOpen, onClose]);

  const parseResult = useMemo(() => tryParseConfigContent(content), [content]);
  const rootConfig = useMemo(() => {
    if (!parseResult.ok || !isPlainRecord(parseResult.value)) {
      return null;
    }
    return parseResult.value;
  }, [parseResult]);

  const primitiveEntries = useMemo(() => {
    if (!rootConfig) {
      return [] as Array<[string, ConfigPrimitive]>;
    }
    return Object.entries(rootConfig)
      .filter(([, value]) => isConfigPrimitive(value))
      .map(([key, value]) => [key, value as ConfigPrimitive] as [string, ConfigPrimitive])
      .sort(([left], [right]) => left.localeCompare(right));
  }, [rootConfig]);

  const complexEntries = useMemo(() => {
    if (!rootConfig) {
      return [] as Array<[string, unknown]>;
    }
    return Object.entries(rootConfig)
      .filter(([, value]) => !isConfigPrimitive(value))
      .sort(([left], [right]) => left.localeCompare(right));
  }, [rootConfig]);

  const isDirty = content !== initialContent;

  const applyRootUpdate = (mutate: (draft: Record<string, unknown>) => void) => {
    if (!rootConfig) {
      setError("GUI mode requires a top-level JSON object.");
      return;
    }

    const draft: Record<string, unknown> = { ...rootConfig };
    mutate(draft);
    setContent(formatConfigContent(draft));
    setError("");
  };

  const updatePrimitiveValue = (key: string, rawValue: string | boolean) => {
    if (!rootConfig) {
      return;
    }
    const current = rootConfig[key];
    if (!isConfigPrimitive(current)) {
      return;
    }

    let nextValue: ConfigPrimitive;
    if (typeof current === "boolean") {
      nextValue =
        typeof rawValue === "boolean" ? rawValue : rawValue.toLowerCase() === "true";
    } else if (typeof current === "number") {
      const parsedNumber = Number(rawValue);
      if (!Number.isFinite(parsedNumber)) {
        setError(`"${key}" expects a numeric value.`);
        return;
      }
      nextValue = parsedNumber;
    } else if (current === null) {
      const text = String(rawValue);
      nextValue = text.trim().length === 0 ? null : text;
    } else {
      nextValue = String(rawValue);
    }

    applyRootUpdate((draft) => {
      draft[key] = nextValue;
    });
  };

  const removeKey = (key: string) => {
    applyRootUpdate((draft) => {
      delete draft[key];
    });
  };

  const handleAddKey = () => {
    const normalizedKey = newKey.trim();
    if (!normalizedKey) {
      setError("Key name is required.");
      return;
    }
    if (!rootConfig) {
      setError("GUI mode requires a top-level JSON object.");
      return;
    }
    if (Object.prototype.hasOwnProperty.call(rootConfig, normalizedKey)) {
      setError(`"${normalizedKey}" already exists.`);
      return;
    }

    let value: ConfigPrimitive;
    if (newType === "boolean") {
      value = newBooleanValue;
    } else if (newType === "number") {
      const parsedNumber = Number(newValue);
      if (!Number.isFinite(parsedNumber)) {
        setError("New key value must be a valid number.");
        return;
      }
      value = parsedNumber;
    } else {
      value = newValue;
    }

    applyRootUpdate((draft) => {
      draft[normalizedKey] = value;
    });
    setNewKey("");
    setNewType("string");
    setNewValue("");
    setNewBooleanValue(false);
  };

  const handleSave = () => {
    if (!filePath) {
      setError("Config path is not available yet. Reload and try again.");
      return;
    }

    const validation = tryParseConfigContent(content);
    if (!validation.ok) {
      setError(`Invalid JSON/JSONC: ${validation.error}`);
      return;
    }

    setError("");
    setIsSaving(true);
    vscode.postMessage({
      type: "saveOpenCodeConfig",
      content,
      filePath,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="oc-image-preview-shell z-50">
      <div
        className="oc-image-preview-backdrop backdrop-blur-sm bg-black/40"
        onClick={onClose}
      />
      <div className="oc-image-preview-modal oc-modal-shell max-w-3xl w-[94vw] h-[84vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="oc-image-preview-header oc-modal-header flex items-center justify-between bg-oc-bg-soft">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-oc-accent" />
            <span className="font-semibold text-sm">
              OpenCode Configuration
            </span>
            <Badge
              variant="outline"
              className="ml-2 text-[10px] uppercase tracking-wider opacity-70"
            >
              {isGlobal ? "Global" : "Workspace"}
            </Badge>
            {isDirty ? (
              <Badge
                variant="outline"
                className="text-[9px] uppercase tracking-wider border-oc-yellow/40 text-oc-yellow"
              >
                Unsaved
              </Badge>
            ) : null}
          </div>
          <button
            type="button"
            className="p-1 hover:bg-oc-accent-soft rounded transition-colors"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="oc-modal-content flex-1 flex flex-col space-y-3 overflow-hidden bg-oc-bg">
          <div className="flex items-center justify-between text-xs gap-3">
            <div className="flex items-center gap-2 oc-text-secondary min-w-0">
              <FileIcon filePath="opencode.json" className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate opacity-80" title={filePath}>
                {filePath || "opencode.json"}
              </span>
            </div>
            <a
              href="https://opencode.ai/docs/config/"
              target="_blank"
              rel="noreferrer"
              className="text-oc-accent hover:underline flex items-center gap-1 shrink-0"
            >
              Docs <ArrowRight className="h-3 w-3" />
            </a>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value === "json" ? "json" : "gui")}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList className="grid w-full grid-cols-2 h-8">
              <TabsTrigger value="gui" className="text-xs">
                GUI
              </TabsTrigger>
              <TabsTrigger value="json" className="text-xs font-medium">
                JSON / JSONC
              </TabsTrigger>
            </TabsList>

            <TabsContent value="gui" className="mt-3 min-h-0 flex-1 overflow-hidden">
              {!rootConfig ? (
                <div className="h-full rounded-md border border-oc-red/30 bg-oc-red/10 p-3 text-xs text-oc-red space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      GUI mode requires valid JSON. Fix JSON in the JSON tab first.
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveTab("json")}
                    className="h-7 text-xs"
                  >
                    Switch to JSON
                  </Button>
                </div>
              ) : (
                <div className="h-full overflow-y-auto space-y-3 pr-1">
                   <div className="oc-panel-section border-oc-border-soft p-2 text-[10px] oc-text-secondary">
                    GUI mode: Edit nested objects, arrays, and primitives with full JSON structure support.
                  </div>
                  <JsonFormEditor
                    value={rootConfig}
                    path={[]}
                    onChange={(path, newValue) => {
                      const updated = updateAtPath(rootConfig, path, newValue);
                      setContent(formatConfigContent(updated as Record<string, unknown>));
                    }}
                    availableModels={availableModels}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="json" className="mt-3 min-h-0 flex-1 overflow-hidden">
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="h-full w-full resize-none font-medium text-[13px] leading-relaxed p-4 bg-oc-bg-soft border-oc-border focus-visible:ring-1 focus-visible:ring-oc-accent"
                spellCheck={false}
                placeholder='{ "default_model": "provider/model" }'
              />
            </TabsContent>
          </Tabs>

          {activeTab === "json" && !parseResult.ok ? (
            <div className="rounded-md border border-oc-yellow/30 bg-oc-yellow/10 text-oc-yellow text-xs p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{parseResult.error}</span>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-md border border-oc-red/30 bg-oc-red/10 text-oc-red text-xs p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <div className="oc-modal-footer items-center justify-between bg-oc-bg-soft">
          <p className="text-[10px] oc-text-secondary">
            {isDirty
              ? "Unsaved changes detected."
              : "No unsaved changes."}{" "}
            Changes take effect after saving.
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving || !isDirty}
              className="h-8 text-xs bg-oc-accent hover:bg-oc-accent/90 text-white border-0 shadow-lg shadow-oc-accent/20 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-1 h-3.5 w-3.5" />
              )}
              Save Configuration
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
});

export const SettingsPanel = memo(function SettingsPanel() {
  const { opencodeConfig, opencodeConfigSaveStatus, availableModels } = useAppState(
    (state) => ({
      opencodeConfig: state.opencodeConfig,
      opencodeConfigSaveStatus: state.opencodeConfigSaveStatus,
      availableModels: state.availableModels,
    }),
    shallowEqual,
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Trigger initial fetch if missing.
  useEffect(() => {
    if (!opencodeConfig) {
      vscode.postMessage({ type: "getOpenCodeConfig" });
    }
  }, [opencodeConfig]);

  function requestRefresh() {
    setIsRefreshing(true);
    vscode.postMessage({ type: "getOpenCodeConfig" });
    setTimeout(() => setIsRefreshing(false), 600);
  }

  const previewModel = useMemo(() => {
    if (!opencodeConfig?.content) return "Default model";
    const parsed = tryParseConfigContent(opencodeConfig.content);
    if (!parsed.ok || !isPlainRecord(parsed.value)) {
      return "Invalid JSON/JSONC";
    }
    const modelCandidate =
      parsed.value.default_model ??
      parsed.value.defaultModel ??
      parsed.value.model;
    return typeof modelCandidate === "string" && modelCandidate.trim().length > 0
      ? modelCandidate
      : "Default model";
  }, [opencodeConfig]);

  const recentSaveStatus =
    opencodeConfigSaveStatus &&
      Date.now() - opencodeConfigSaveStatus.savedAt < 120000
      ? opencodeConfigSaveStatus
      : undefined;

  return (
    <div className="oc-settings-panel border-t border-oc-border p-3 group transition-colors hover:bg-oc-accent-soft/5">
      <div className="mb-3 flex items-center justify-between">
        <div className="oc-panel-title flex items-center gap-2 select-none">
          <div className="p-1 rounded bg-oc-accent/10 border border-oc-accent/20">
            <Wrench className="h-3 w-3 text-oc-accent" />
          </div>
          Settings
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            type="button"
            aria-label="Reload Config"
            onClick={requestRefresh}
            variant="ghost"
            size="icon"
            className={`h-6 w-6 oc-text-secondary hover:text-oc-accent transition-all ${isRefreshing ? "animate-spin" : ""}`}
            title="Reload config"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-3">
         <div className="oc-panel-section flex flex-col gap-1.5 border-oc-border-soft p-2 shadow-sm transition-all hover:border-oc-accent/30">
          <div className="flex items-center justify-between text-[10px] oc-text-secondary font-medium uppercase tracking-wider">
            <span>Current Model</span>
            <Badge
              variant="outline"
              className="h-4 px-1 text-[8px] border-oc-border"
            >
              {opencodeConfig?.isGlobal ? "Global" : "Workspace"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Bot className="h-3.5 w-3.5 text-oc-accent opacity-70" />
            <span className="text-[11px] font-medium truncate text-oc-text opacity-90">
              {previewModel}
            </span>
          </div>
          <div
            className="text-[10px] oc-text-secondary truncate"
            title={opencodeConfig?.filePath}
          >
            {opencodeConfig?.filePath || "Resolving config path..."}
          </div>
        </div>

        {recentSaveStatus ? (
          <div
            className={`rounded-md border p-2 text-[11px] flex items-start gap-2 ${recentSaveStatus.success
                ? "border-oc-green/30 bg-oc-green/10 text-oc-green"
                : "border-oc-red/30 bg-oc-red/10 text-oc-red"
              }`}
          >
            {recentSaveStatus.success ? (
              <Check className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            )}
            <span>
              {recentSaveStatus.message ||
                (recentSaveStatus.success
                  ? "Config saved."
                  : "Config save failed.")}
            </span>
          </div>
        ) : null}

         {/* File Selector Dropdown */}
         {opencodeConfig?.files && opencodeConfig.files.length > 1 && (
           <div className="oc-panel-section flex flex-col gap-1.5 border-oc-border-soft p-2 shadow-sm">
            <div className="text-[10px] oc-text-secondary font-medium uppercase tracking-wider">
              Config Files ({opencodeConfig.files.length})
            </div>
            <select
              value={opencodeConfig.fileName}
              onChange={(e) => {
                const selectedFile = opencodeConfig?.files?.find(f => f.name === e.target.value);
                if (selectedFile) {
                  vscode.postMessage({
                    type: "getOpenCodeConfig",
                    fileName: selectedFile.name,
                  });
                }
              }}
              className="w-full h-7 text-[11px] font-medium border border-oc-border bg-oc-bg rounded px-2"
            >
              {opencodeConfig.files.map(file => (
                <option key={file.name} value={file.name}>
                  {file.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <Button
          onClick={() => setModalOpen(true)}
          className="w-full h-8 text-[11px] font-medium transition-all gap-2 bg-oc-bg hover:bg-oc-accent hover:text-white border-oc-border group/btn"
          variant="outline"
        >
          <Edit className="h-3 w-3 group-hover/btn:scale-110 transition-transform" />
          Open Config Editor
        </Button>
      </div>

      <SettingsModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        initialContent={opencodeConfig?.content || "{\n}\n"}
        filePath={opencodeConfig?.filePath}
        isGlobal={opencodeConfig?.isGlobal}
        availableModels={availableModels}
      />
    </div>
  );
});

export { ConfigSidebar } from './ConfigSidebar';
