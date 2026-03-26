import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Edit,
  History,
  Loader2,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  Send,
  Square,
  Trash2,
  WifiOff,
  Wrench,
  X,
  Zap,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";

import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { JsonFormEditor } from "./JsonFormEditor";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useAppDispatch, useAppState } from "./lib/store";
import vscode from "./lib/vscode";
import type {
  InteractiveEvent,
  Message,
  SlashCommand,
  StreamingState,
  ThinkingLevel,
  TodoItem,
  FileResult,
  ContextItem,
  Model,
} from "./lib/types";

import { FileIcon } from "./MessageComponents";

function totalTokens(i: number, o: number, r: number, w: number): number {
  return (i || 0) + (o || 0) + (r || 0) + (w || 0);
}

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

function CircularProgress({
  pct,
  size = 16,
  strokeWidth = 2.5,
}: {
  pct: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  // Determine color based on pressure
  const strokeColor =
    pct > 90
      ? "var(--oc-red)"
      : pct > 75
        ? "var(--oc-yellow)"
        : "var(--oc-accent)";

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
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
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-oc-border-soft opacity-20"
        />
        {/* Progress fill */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
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

function isProcessingInCurrentSession(
  isProcessing: boolean,
  currentSessionId: string | null,
  processingSessionIds: string[],
): boolean {
  if (!isProcessing) {
    return false;
  }
  if (!currentSessionId) {
    return isProcessing;
  }
  if (!Array.isArray(processingSessionIds) || processingSessionIds.length === 0) {
    // If we have no session IDs but isProcessing is true, it might be a legacy 
    // or global state. We'll return false to be safe unless we are sure.
    return false;
  }
  return processingSessionIds.includes(currentSessionId);
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

function hasRenderableStreamingPayload(
  streaming?: StreamingState | null,
): boolean {
  if (!streaming) {
    return false;
  }
  if ((streaming.content || "").trim().length > 0) {
    return true;
  }
  if ((streaming.reasoning || "").trim().length > 0) {
    return true;
  }
  if (
    Array.isArray(streaming.reasoningEvents) &&
    streaming.reasoningEvents.length > 0
  ) {
    return true;
  }
  if (Array.isArray(streaming.steps) && streaming.steps.length > 0) {
    return true;
  }
  if (
    Array.isArray(streaming.progressEvents) &&
    streaming.progressEvents.length > 0
  ) {
    return true;
  }
  if (Array.isArray(streaming.edits) && streaming.edits.length > 0) {
    return true;
  }
  return false;
}

function buildAssistantMessageFromStreaming(streaming: StreamingState): Message {
  const content = streaming.content || "";
  const parts = content
    ? [{ type: "text", text: content }]
    : ([] as Message["parts"]);
  const canonicalSteps =
    Array.isArray(streaming.steps) && streaming.steps.length > 0
      ? streaming.steps.map((step) => ({
          id: step.id,
          callID: step.callID,
          type: step.type,
          title: step.title,
          status: step.status,
          meta: step.meta,
          diffStats: step.diffStats,
          streamSeq: step.streamSeq,
        }))
      : [];

  return {
    id: streaming.messageId || undefined,
    role: "assistant",
    content,
    parts,
    reasoningEvents: streaming.reasoningEvents,
    progressEvents: canonicalSteps,
    steps: canonicalSteps,
    edits: streaming.edits.map((file) => ({ file })),
    info: {
      id: streaming.messageId || undefined,
      agent: streaming.agent,
      model: streaming.model,
      modelID: streaming.modelID,
      providerID: streaming.providerID,
      duration: streaming.usage?.duration,
    },
  };
}

export function StickyHeader() {
  const {
    currentSessionId,
    isSidebarOpen,
    sessionStats,
    isProcessing: globalIsProcessing,
    processingSessionIds,
    streaming,
    promptQueue,
    availableModels,
    selectedModel,
    messages,
    compactionBaselineStats,
    compactionDividerIndex,
  } = useAppState();
  const dispatch = useAppDispatch();
  const isProcessing = isProcessingInCurrentSession(
    globalIsProcessing,
    currentSessionId,
    processingSessionIds,
  );

  // Replicate context usage calculation from ActiveTaskPanel for header indicator
  const selectedModelContextLimit = useMemo(() => {
    if (!selectedModel) return undefined;
    const matched = availableModels.find(
      (m) =>
        m.providerID === selectedModel.providerID &&
        m.modelID === selectedModel.modelID,
    );
    const limit = matched?.contextLimit;
    return typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : undefined;
  }, [availableModels, selectedModel]);

  const safeDividerIdx =
    typeof compactionDividerIndex === "number"
      ? Math.max(0, Math.min(compactionDividerIndex, messages.length))
      : undefined;

  const derivedBaseline = useMemo(() => {
    const b = { input: 0, output: 0, read: 0, write: 0 };
    if (safeDividerIdx === undefined || safeDividerIdx <= 0) return b;
    for (let i = 0; i < safeDividerIdx; i += 1) {
      const s = messageTokenStats(messages[i]);
      b.input += s.input;
      b.output += s.output;
      b.read += s.read;
      b.write += s.write;
    }
    return b;
  }, [messages, safeDividerIdx]);

  const effectiveBaseline = compactionBaselineStats
    ? {
        input: compactionBaselineStats.input,
        output: compactionBaselineStats.output,
        read: compactionBaselineStats.read,
        write: compactionBaselineStats.write,
      }
    : derivedBaseline;

  const contextStats = useMemo(
    () => ({
      input: Math.max(0, sessionStats.input - effectiveBaseline.input),
      output: Math.max(0, sessionStats.output - effectiveBaseline.output),
      read: Math.max(0, sessionStats.read - effectiveBaseline.read),
      write: Math.max(0, sessionStats.write - effectiveBaseline.write),
    }),
    [sessionStats, effectiveBaseline],
  );

  const totalUsed = totalTokens(
    contextStats.input,
    contextStats.output,
    contextStats.read,
    contextStats.write,
  );
  const maxContext = selectedModelContextLimit ?? 128_000;
  const pct =
    totalUsed > 0
      ? Math.min(100, Math.round((totalUsed / maxContext) * 100))
      : 0;

  const sessionLabel = currentSessionId ? currentSessionId.slice(0, 8) : "new";
  const taskName =
    isProcessing || streaming ? "Active request" : "No active task";
  const taskStatus =
    isProcessing || streaming
      ? "RUNNING"
      : promptQueue.length > 0
        ? "PENDING"
        : "IDLE";
  const durationLabel =
    sessionStats.duration >= 1000
      ? `${(sessionStats.duration / 1000).toFixed(1)}s`
      : `${Math.round(sessionStats.duration)}ms`;

  return (
    <div className="oc-header sticky top-0 z-10 flex items-center gap-2 border-b px-3 py-1.5 text-xs">
      <div className="oc-header-left flex items-center gap-2 min-w-0">
        <Button
          variant="ghost"
          size="icon"
          className="oc-history-btn h-7 w-7"
          title="History"
          aria-label="Open history sidebar"
          onClick={() =>
            dispatch({ type: "SET_SIDEBAR_OPEN", payload: !isSidebarOpen })
          }
        >
          <History className="h-3.5 w-3.5" />
        </Button>
        <div
          className="flex items-center gap-2 cursor-help"
          title={`${pct}% context used (${totalUsed.toLocaleString()} / ${maxContext.toLocaleString()} tokens)`}
        >
          <div className="oc-agent-icon relative flex items-center justify-center">
            <CircularProgress pct={pct} size={22} strokeWidth={2.5} />
            <div className="absolute inset-0 flex items-center justify-center opacity-40">
              <Zap className="h-2.5 w-2.5" />
            </div>
          </div>
          <span className="oc-title">OpenCode</span>
        </div>
        <span className="oc-session-chip">ses_{sessionLabel}</span>
      </div>

      {/* Token stats center - FORBIDDEN TO REMOVE */}
      <div className="oc-header-center items-center gap-3 font-mono text-xs opacity-60">
        <div className="flex items-center gap-1.5">
          <span className="opacity-70 text-xs uppercase tracking-wider">
            Tokens
          </span>
          <span className="font-semibold tabular-nums text-[var(--oc-text-soft)]">
            {(sessionStats.input + sessionStats.output || 0).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs opacity-80">
          <span className="text-[var(--oc-text-soft)]">
            {sessionStats.input}i
          </span>
          <span className="opacity-30">·</span>
          <span className="text-[var(--oc-text-soft)]">
            {sessionStats.output}o
          </span>
          {sessionStats.read > 0 && (
            <>
              <span className="opacity-30">·</span>
              <span className="text-[var(--oc-text-soft)]">
                {sessionStats.read}r
              </span>
            </>
          )}
          {sessionStats.write > 0 && (
            <>
              <span className="opacity-30">·</span>
              <span className="text-[var(--oc-text-soft)]">
                {sessionStats.write}w
              </span>
            </>
          )}
        </div>
      </div>

      <div className="oc-header-right ml-auto flex items-center gap-1.5">
        <span className="oc-task-pill">TASK</span>
        <span className="oc-task-name text-xs text-[var(--oc-text-soft)] opacity-80">
          {taskName}
        </span>
        <span
          className={`oc-status-pill ${
            taskStatus === "IDLE"
              ? "idle"
              : taskStatus === "PENDING"
                ? "pending"
                : "running"
          }`}
        >
          {taskStatus}
        </span>
        <span className="oc-duration text-[var(--oc-text-soft)] opacity-70">
          {durationLabel}
        </span>
      </div>
    </div>
  );
}

export function HistorySidebar() {
  const {
    isSidebarOpen,
    sessionsList,
    currentSessionId,
    processingSessionIds,
  } = useAppState();
  const dispatch = useAppDispatch();
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const visibleSessions = useMemo(() => {
    if (sessionsList.length === 0) {
      return [];
    }

    const sessionIds = new Set(sessionsList.map((session) => session.id));
    const topLevelSessions = sessionsList.filter((session) => {
      const parentSessionId = session.parentSessionId?.trim();
      if (!parentSessionId) return true;
      if (parentSessionId === session.id) return true;
      return !sessionIds.has(parentSessionId);
    });

    return topLevelSessions.length > 0 ? topLevelSessions : sessionsList;
  }, [sessionsList]);

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return visibleSessions;
    const q = searchQuery.toLowerCase();
    return visibleSessions.filter((s) =>
      (s.title || "Untitled chat").toLowerCase().includes(q),
    );
  }, [visibleSessions, searchQuery]);

  const groupedSessions = useMemo(() => {
    const day = 86_400_000;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTs = todayStart.getTime();
    const yesterdayTs = todayTs - day;
    const weekTs = todayTs - 6 * day;

    const groups: { label: string; sessions: typeof filteredSessions }[] = [
      { label: "Today", sessions: [] },
      { label: "Yesterday", sessions: [] },
      { label: "This Week", sessions: [] },
      { label: "Older", sessions: [] },
    ];

    for (const session of filteredSessions) {
      const ts = session.createdAt ?? 0;
      if (ts >= todayTs) {
        groups[0].sessions.push(session);
      } else if (ts >= yesterdayTs) {
        groups[1].sessions.push(session);
      } else if (ts >= weekTs) {
        groups[2].sessions.push(session);
      } else {
        groups[3].sessions.push(session);
      }
    }

    return groups.filter((g) => g.sessions.length > 0);
  }, [filteredSessions]);

  useEffect(() => {
    if (editingSessionId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingSessionId]);

  useEffect(() => {
    if (isSidebarOpen) {
      setTimeout(() => searchRef.current?.focus(), 220);
    } else {
      setSearchQuery("");
      setConfirmDeleteId(null);
    }
  }, [isSidebarOpen]);

  function relativeSessionTime(ts: number | undefined): string {
    if (!ts) return "";
    const now = Date.now();
    const diff = now - ts;
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diff < minute) return "Just now";
    if (diff < hour) {
      const mins = Math.round(diff / minute);
      return `${mins}m ago`;
    }
    if (diff < day) {
      const hrs = Math.round(diff / hour);
      return `${hrs}h ago`;
    }
    if (diff < 7 * day) {
      const days = Math.round(diff / day);
      return days === 1 ? "Yesterday" : `${days}d ago`;
    }
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  const handleStartEdit = (sessionId: string, title: string) => {
    setEditingSessionId(sessionId);
    setNewTitle(title || "");
    setConfirmDeleteId(null);
  };

  const handleSaveEdit = () => {
    if (newTitle.trim() && editingSessionId) {
      vscode.postMessage({
        type: "renameSession",
        sessionId: editingSessionId,
        newTitle: newTitle.trim(),
      });
    }
    setEditingSessionId(null);
    setNewTitle("");
  };

  const handleCancelEdit = () => {
    setEditingSessionId(null);
    setNewTitle("");
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSaveEdit();
    else if (e.key === "Escape") handleCancelEdit();
  };

  const handleDeleteConfirm = (sessionId: string) => {
    vscode.postMessage({ type: "deleteSession", sessionId });
    setConfirmDeleteId(null);
  };

  return (
    <aside
      className={`oc-history-sidebar absolute bottom-0 left-0 top-0 z-20 flex w-[280px] flex-col border-r border-oc-border bg-oc-bg-soft transition-transform duration-200 ease-in-out ${
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      }`}
      style={{ boxShadow: isSidebarOpen ? "4px 0 24px rgba(0,0,0,0.18)" : "none" }}
    >
      <div className="flex shrink-0 items-center justify-between px-3.5 pt-3.5 pb-2">
        <div className="flex items-center gap-2">
          <History className="h-3.5 w-3.5 text-oc-accent" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-oc-text-muted">
            Sessions
          </span>
          {visibleSessions.length > 0 && (
            <span className="rounded-full bg-oc-border px-1.5 py-0.5 text-[9px] font-medium tabular-nums text-oc-text-muted leading-none">
              {visibleSessions.length}
            </span>
          )}
        </div>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-md text-oc-text-muted transition-colors hover:bg-oc-border hover:text-oc-text"
          aria-label="Close history sidebar"
          onClick={() => dispatch({ type: "SET_SIDEBAR_OPEN", payload: false })}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="shrink-0 px-3 pb-2.5">
        <button
          type="button"
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-oc-accent bg-oc-accent-soft py-1.5 text-[11px] font-medium text-oc-accent transition-all hover:bg-oc-accent hover:text-white active:scale-[0.98]"
          onClick={() => {
            vscode.postMessage({ type: "createSession" });
            dispatch({ type: "SET_SIDEBAR_OPEN", payload: false });
          }}
        >
          <span className="text-sm leading-none">+</span>
          New Chat
        </button>
      </div>

      <div className="shrink-0 px-3 pb-2.5">
        <div className="flex items-center gap-1.5 rounded-md border border-oc-border bg-oc-panel px-2.5 py-1.5 transition-colors focus-within:border-oc-accent">
          <Search className="h-3 w-3 shrink-0 text-oc-text-muted" />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sessions…"
            className="flex-1 bg-transparent text-[11px] text-oc-text placeholder-oc-text-muted outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="flex h-4 w-4 items-center justify-center rounded text-oc-text-muted hover:text-oc-text"
              aria-label="Clear search"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      </div>

      <div className="mx-3 mb-1 h-px bg-oc-border" />

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 pt-1">
        {filteredSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            {searchQuery ? (
              <>
                <Search className="h-8 w-8 text-oc-border" />
                <p className="text-[11px] text-oc-text-muted">No sessions match</p>
                <p className="text-[10px] text-oc-text-muted opacity-60">"{searchQuery}"</p>
              </>
            ) : (
              <>
                <MessageSquare className="h-8 w-8 text-oc-border" />
                <p className="text-[11px] text-oc-text-muted">No sessions yet</p>
                <p className="text-[10px] text-oc-text-muted opacity-60">Start a new chat to begin</p>
              </>
            )}
          </div>
        ) : (
          groupedSessions.map((group) => (
            <div key={group.label} className="mb-2">
              <div className="mb-1 px-1.5 pt-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-oc-text-muted opacity-60">
                {group.label}
              </div>
              {group.sessions.map((session) => {
                const isActive = session.id === currentSessionId;
                const isProcessing = processingSessionIds?.includes(session.id) || false;
                const isEditing = editingSessionId === session.id;
                const isConfirmingDelete = confirmDeleteId === session.id;

                return (
                  <div
                    key={session.id}
                    className="group relative mb-0.5"
                  >
                    {isEditing ? (
                      <div className="flex items-center gap-1 rounded-md border border-oc-accent bg-oc-accent-soft px-2 py-2">
                        <input
                          ref={inputRef}
                          type="text"
                          value={newTitle}
                          onChange={(e) => setNewTitle(e.target.value)}
                          onKeyDown={handleEditKeyDown}
                          onBlur={handleSaveEdit}
                          className="flex-1 bg-transparent text-[11px] text-oc-text outline-none"
                          placeholder="Session title…"
                        />
                        <button
                          type="button"
                          title="Save"
                          className="flex h-5 w-5 items-center justify-center rounded text-oc-accent hover:bg-oc-accent hover:text-white transition-colors"
                          onClick={handleSaveEdit}
                        >
                          <Check className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          title="Cancel"
                          className="flex h-5 w-5 items-center justify-center rounded text-oc-text-muted hover:bg-oc-border transition-colors"
                          onClick={handleCancelEdit}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : isConfirmingDelete ? (
                      <div className="flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-2">
                        <span className="flex-1 truncate text-[11px] text-oc-text-muted">
                          Delete "{session.title || "Untitled chat"}"?
                        </span>
                        <button
                          type="button"
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-red-400 hover:bg-red-500/20 transition-colors"
                          onClick={() => handleDeleteConfirm(session.id)}
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-oc-text-muted hover:bg-oc-border transition-colors"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div
                        className={`flex items-stretch rounded-md transition-all ${
                          isActive
                            ? "bg-oc-accent-soft"
                            : "hover:bg-oc-panel"
                        }`}
                      >
                        <div
                          className={`w-[3px] shrink-0 self-stretch rounded-l-md transition-colors ${
                            isActive ? "bg-oc-accent" : "bg-transparent"
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            vscode.postMessage({ type: "switchSession", sessionId: session.id });
                            dispatch({ type: "SET_SIDEBAR_OPEN", payload: false });
                          }}
                          className="oc-session-item min-w-0 flex-1 overflow-hidden px-2 py-2 text-left"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            {isProcessing ? (
                              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-oc-accent" aria-label="Processing" />
                            ) : null}
                            <span
                              className={`truncate text-[12px] font-medium leading-tight ${
                                isActive ? "text-oc-text" : "text-oc-text-soft"
                              }`}
                            >
                              {session.title || "Untitled chat"}
                            </span>
                          </div>
                          {session.createdAt ? (
                            <div className="mt-0.5 text-[10px] text-oc-text-muted tabular-nums">
                              {relativeSessionTime(session.createdAt)}
                            </div>
                          ) : null}
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5 pr-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            title="Rename session"
                            aria-label={`Rename session ${session.title ?? session.id}`}
                            className="oc-session-rename flex h-6 w-6 items-center justify-center rounded text-oc-text-muted transition-colors hover:bg-oc-border hover:text-oc-text"
                            onClick={() => handleStartEdit(session.id, session.title || "")}
                          >
                            <Edit className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            title="Delete session"
                            aria-label={`Delete session ${session.title ?? session.id}`}
                            className="oc-session-delete flex h-6 w-6 items-center justify-center rounded text-oc-text-muted transition-colors hover:bg-red-500/15 hover:text-red-400"
                            onClick={() => setConfirmDeleteId(session.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

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
    <div className="mb-1.5 overflow-hidden rounded-md border border-oc-border">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs rounded-none"
      >
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full transition-colors ${
            open ? "bg-oc-accent" : "bg-oc-border-soft"
          }`}
        />
        <span
          className={`font-mono text-xs uppercase tracking-widest font-semibold ${
            open
              ? "text-[var(--oc-text-soft)]"
              : "text-[var(--oc-text-soft)] opacity-70"
          }`}
        >
          {title}
        </span>
        <span
          className={`ml-auto transition-transform ${
            open ? "rotate-0" : "-rotate-90"
          }`}
        >
          <ChevronDown className="h-3 w-3 text-[var(--oc-text-soft)] opacity-70" />
        </span>
      </Button>
      {open && (
        <div className="bg-oc-bg-soft px-2.5 pb-2.5 pt-1.5">{children}</div>
      )}
    </div>
  );
}

// tiny hook so we don't need useState import twice
function useMiniSectionState(def: boolean) {
  return useState(def);
}

// ─── ActiveTaskPanel ──────────────────────────────────────────────────────────
export function ActiveTaskPanel() {
  const {
    sessionStats,
    streaming,
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
    compactionBaselineStats,
    compactionDividerIndex,
    serverVersion,
  } = useAppState();

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

  const total = totalTokens(
    contextStats.input,
    contextStats.output,
    contextStats.read,
    contextStats.write,
  );
  const maxContext = selectedModelContextLimit ?? 128_000;
  const usingContextFallback = selectedModelContextLimit === undefined;
  const pct =
    total > 0 ? Math.min(100, Math.round((total / maxContext) * 100)) : 0;
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

  // Auto-scroll the progress list to the bottom when new steps arrive.
  useEffect(() => {
    if (progressStepCount === 0) return;
    if (progressListRef.current) {
      progressListRef.current.scrollTop = progressListRef.current.scrollHeight;
    }
  }, [progressStepCount]);

  return (
    <div className="oc-active-task-panel flex flex-col w-full bg-oc-bg-soft">
      {/* Panel title */}
      <div className="border-b border-oc-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div
            className={`h-1.5 w-1.5 rounded-full ${
              isActive ? "bg-oc-accent animate-pulse" : "bg-oc-border-soft"
            }`}
          />
          <div className="oc-panel-title">Active Task</div>
        </div>
      </div>

      <div className="p-2">
        {/* ── Progress Updates: shown only while streaming is active ── */}
        {isActive && (
          <MiniSection title="Progress Updates">
            {liveProgressSteps.length === 0 ? (
              <div className="flex items-center gap-1.5 py-0.5 text-xs text-oc-text-muted opacity-70">
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
                      {step.status === "pending" ? (
                        <Loader2 className="h-3 w-3 animate-spin text-oc-accent" />
                      ) : step.status === "error" ? (
                        <X className="h-3 w-3 text-oc-red" />
                      ) : (
                        <Check className="h-3 w-3 text-oc-green opacity-70" />
                      )}
                    </span>
                    <span
                      className={`min-w-0 flex-1 leading-relaxed ${
                        step.status === "pending"
                          ? "text-oc-text"
                          : "text-[var(--oc-text-soft)] opacity-80"
                      }`}
                    >
                      <span className="block break-words whitespace-pre-wrap">
                        {step.title}
                      </span>
                      {step.meta ? (
                        <span className="mt-0.5 block text-oc-text-muted opacity-60 break-words whitespace-pre-wrap">
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

         <MiniSection title="Context">
          {/* Token usage bar */}
          <div className="mb-3">
            <div className="mb-1.5 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-[var(--oc-text-soft)] uppercase tracking-wider">
                    Tokens Used
                  </span>
                  {hasCompactionBaseline && (
                    <span className="rounded-full bg-oc-border px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-oc-text-muted">
                      Since compact
                    </span>
                  )}
                </div>
                <div
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums tracking-wider ${
                    pct > 90
                      ? "bg-red-500/15 text-red-500"
                      : pct > 75
                        ? "bg-amber-500/15 text-amber-500"
                        : "bg-oc-green/15 text-oc-green"
                  }`}
                >
                  {pct}%
                </div>
              </div>
              <div className="flex items-center gap-1.5 opacity-70">
                <span className="font-mono tabular-nums text-[11px] text-[var(--oc-text-soft)]">
                  {total.toLocaleString()} /{" "}
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
                  <span className="text-[10px] text-oc-text-muted">~est</span>
                )}
              </div>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-oc-border">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${pct}%`,
                  background:
                    pct > 80
                      ? "linear-gradient(90deg, #f0883e, #f85149)"
                      : pct > 50
                        ? "linear-gradient(90deg, #d29922, #f0883e)"
                        : "linear-gradient(90deg, #1f6feb, #58a6ff)",
                }}
              />
            </div>
          </div>

          {/* Compaction Controls */}
          <div className="mb-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--oc-text-soft)] opacity-80">
                  Session compaction
                </span>
              </div>
              <div className="flex items-center gap-2">
                {!isCompacting && compactedAtLabel ? (
                  <span className="rounded-full bg-oc-border-soft px-1.5 py-0.5 text-[9px] font-mono tracking-wider text-oc-text-muted opacity-80">
                    {compactedAtLabel}
                  </span>
                ) : null}
                {isCompacting ? (
                  <span className="animate-pulse rounded-full bg-oc-accent-soft px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-oc-accent">
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
              <div className="mt-1.5 text-[10px] text-oc-red">
                {compactionError}
              </div>
            ) : null}
          </div>

          <div className="mb-2 h-px w-full bg-oc-border opacity-50" />

          {/* Detailed Token Stats */}
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[var(--oc-text-soft)] opacity-80">Input</span>
              <span className="font-mono tabular-nums text-[var(--oc-text-soft)]">
                {contextStats.input.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--oc-text-soft)] opacity-80">Output</span>
              <span className="font-mono tabular-nums text-[var(--oc-text-soft)]">
                {contextStats.output.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--oc-text-soft)] opacity-80">Cache hits</span>
              <span
                className={`font-mono tabular-nums transition-colors duration-300 ${
                  contextStats.read > 0
                    ? "text-oc-green font-semibold"
                    : "text-[var(--oc-text-soft)]"
                }`}
              >
                {contextStats.read.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--oc-text-soft)] opacity-80">
                Cache writes
              </span>
              <span className="font-mono tabular-nums text-[var(--oc-text-soft)]">
                {contextStats.write.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-oc-border mt-2">
              <span className="text-[var(--oc-text-soft)] opacity-80">Duration</span>
              <span className="font-mono tabular-nums text-[var(--oc-text-soft)]">
                {sessionStats.duration >= 1000
                  ? `${(sessionStats.duration / 1000).toFixed(1)}s`
                  : `${Math.round(sessionStats.duration)}ms`}
              </span>
            </div>
          </div>
        </MiniSection>

        <MiniSection title="Session">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            <div className="flex items-center justify-between col-span-2">
              <span className="text-[var(--oc-text-soft)] opacity-80">ID</span>
              <span className="font-mono text-xs text-[var(--oc-text-soft)] opacity-70">
                {currentSessionId ? currentSessionId.slice(0, 16) : "—"}
              </span>
            </div>
            {serverVersion && (
              <div className="flex items-center justify-between col-span-2">
                <span className="text-[var(--oc-text-soft)] opacity-80">
                  OpenCode Version
                </span>
                <span className="font-mono text-xs text-[var(--oc-text-soft)] opacity-70">
                  {serverVersion}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[var(--oc-text-soft)] opacity-80">
                Messages
              </span>
              <span className="font-mono tabular-nums text-[var(--oc-text-soft)]">
                {messageCount}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--oc-text-soft)] opacity-80">
                Date started
              </span>
              <span
                className={`font-mono tabular-nums ${
                  isActive ? "text-oc-accent" : "text-[var(--oc-text-soft)]"
                }`}
              >
                {startedLabel}
              </span>
            </div>
            <div className="flex items-center justify-between col-span-2">
              <span className="text-[var(--oc-text-soft)] opacity-80">
                Status
              </span>
              <span
                className={`font-mono text-xs uppercase tracking-wider font-semibold ${
                  isActive
                    ? "text-oc-accent"
                    : "text-[var(--oc-text-soft)] opacity-70"
                }`}
              >
                {isActive ? "ACTIVE" : "IDLE"}
              </span>
            </div>
          </div>
        </MiniSection>
      </div>
    </div>
  );
}

export function MobileRightSummary() {
  const {
    sessionStats,
    isProcessing: globalIsProcessing,
    currentSessionId,
    processingSessionIds,
  } = useAppState();
  const isProcessing = isProcessingInCurrentSession(
    globalIsProcessing,
    currentSessionId,
    processingSessionIds,
  );

  return (
    <div className="block [@media(min-width:1100px)]:hidden border-b border-oc-border bg-oc-bg-soft px-3 py-1.5 text-xs text-oc-text">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-oc-text-muted">In</span>
          <span className="tabular-nums text-[var(--oc-text-soft)]">
            {sessionStats.input.toLocaleString()}
          </span>
          <span className="opacity-30">/</span>
          <span className="text-oc-text-muted">Out</span>
          <span className="tabular-nums text-[var(--oc-text-soft)]">
            {sessionStats.output.toLocaleString()}
          </span>
        </div>

        <div className="flex items-center">
          {isProcessing ? (
            <span className="rounded-md bg-oc-accent-soft px-2 py-0.5 text-xs font-medium text-oc-accent font-mono tracking-wider">
              PROCESSING
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ModelDropdown() {
  const {
    availableModels,
    selectedModel,
    modelSearchQuery,
    modelDropdownOpen,
    quotaData,
  } = useAppState();
  const dispatch = useAppDispatch();
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedTab, setSelectedTab] = useState("All");

  // Close on outside click
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
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

  const subscribedProviders = useMemo(() => {
    const providers = (quotaData?.platforms ?? [])
      .map((p) => {
        const key = p.platform.toLowerCase();

        // Skip opencode platform in mapped providers since we have a dedicated persistent tab
        if (key.includes("opencode")) return null;

        // Always prefer title when available - it contains the specific plan name
        if (p.title) {
          // Strip common suffixes to get the clean provider name
          const cleanedTitle = p.title
            .replace(" Account Quota", "")
            .replace(" account quota", "")
            .trim();
          return cleanedTitle;
        }

        // Fallback to specific normalization for known broad providers
        if (key === "openai") return "OpenAI";
        if (key === "zai") return "Z.ai";
        if (key === "zhipu") return "Zhipu AI";
        if (key === "copilot") return "GitHub Copilot";
        if (key === "google" || key === "google-gemini-cli") return "Google";

        // Last resort: use platform name
        return p.platform;
      })
      .filter((name): name is string => name !== null);

    // Always include OpenCode Free at the start
    const result = ["OpenCode Free", ...providers];

    return result.filter((name, index, self) => self.indexOf(name) === index);
  }, [quotaData]);

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof availableModels>();
    const query = modelSearchQuery.toLowerCase();

    availableModels
      .filter((model) => {
        const matchesQuery =
          `${model.providerID} ${model.name} ${model.modelID}`
            .toLowerCase()
            .includes(query);

        if (!matchesQuery) return false;

        if (selectedTab !== "All") {
          if (selectedTab === "OpenCode Free") {
            return model.providerID === "opencode";
          }
          const providerName = model.providerName ?? model.providerID;
          // Use exact match (case-insensitive) to prevent "Z.ai" tab from matching "Z.ai Coding Plan"
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
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="chip"
        size="chip"
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
          <span className="opacity-60">Model</span>
          <span>{label}</span>
        </div>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${
            modelDropdownOpen ? "rotate-180" : ""
          }`}
        />
      </Button>
      {modelDropdownOpen && (
        <div className="oc-popover absolute bottom-full left-0 z-30 mb-1.5 w-72 rounded-xl border border-oc-border bg-oc-panel shadow-xl overflow-hidden">
          <div className="px-3 pt-3 pb-2 space-y-2">
            <input
              value={modelSearchQuery}
              onChange={(e) =>
                dispatch({ type: "SET_MODEL_SEARCH", payload: e.target.value })
              }
              placeholder="Search models..."
              className="oc-popover-search w-full rounded-lg border border-oc-border bg-oc-bg-soft px-3 py-1.5 text-oc-sm font-mono outline-none focus:border-oc-accent transition-colors"
            />
            {subscribedProviders.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {["All", ...subscribedProviders].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setSelectedTab(tab)}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-medium tracking-wide transition-colors ${
                      selectedTab === tab
                        ? "bg-oc-accent text-white"
                        : "bg-oc-bg-soft text-oc-text-muted hover:bg-oc-panel-soft hover:text-oc-text"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="max-h-56 overflow-y-auto px-1.5 pb-1.5">
            {[...grouped.entries()].map(([provider, models]) => (
              <div key={provider} className="mb-1">
                <div className="px-2.5 py-1 text-xs font-semibold uppercase tracking-widest text-oc-text-muted opacity-60">
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
                          ? "bg-oc-accent-soft text-oc-accent"
                          : "hover:bg-oc-panel-soft"
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
                        <span className="text-oc-sm font-medium truncate">
                          {model.name}
                        </span>
                        {isCurrent && (
                          <span className="text-xs font-mono uppercase tracking-wider text-oc-accent shrink-0">
                            active
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-mono text-oc-text-muted truncate mt-0.5">
                        {model.modelID}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
            {grouped.size === 0 && (
              <div className="px-2.5 py-4 text-center text-xs text-oc-text-muted font-mono italic">
                No models found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentDropdown() {
  const {
    availableAgents,
    selectedAgent,
    agentSearchQuery,
    agentDropdownOpen,
  } = useAppState();
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
  const label = selectedAgentItem?.name ?? selectedAgent ?? "Agent";

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="chip"
        size="chip"
        onClick={() =>
          dispatch({
            type: "SET_AGENT_DROPDOWN_OPEN",
            payload: !agentDropdownOpen,
          })
        }
        aria-label="Choose agent"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="opacity-60">Agent</span>
          <span>{label}</span>
        </div>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${
            agentDropdownOpen ? "rotate-180" : ""
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
              className="oc-popover-search w-full rounded-lg border border-oc-border bg-oc-bg-soft px-3 py-1.5 text-oc-sm font-mono outline-none focus:border-oc-accent transition-colors"
            />
          </div>
          <div className="max-h-52 overflow-y-auto px-1.5 pb-1.5">
            {availableAgents.length === 0 && (
              <div className="px-2.5 py-3 text-oc-sm text-oc-text-muted text-center font-mono">
                Loading agents…
              </div>
            )}
            {availableAgents.length > 0 && filtered.length === 0 && (
              <div className="px-2.5 py-3 text-oc-sm text-oc-text-muted text-center font-mono">
                No agents found
              </div>
            )}
            {filtered.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={`oc-popover-item w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                  selectedAgent === agent.id
                    ? "bg-oc-accent-soft text-oc-accent"
                    : "hover:bg-oc-panel-soft"
                }`}
                onClick={() => {
                  dispatch({ type: "SET_SELECTED_AGENT", payload: agent.id });
                  dispatch({ type: "SET_AGENT_DROPDOWN_OPEN", payload: false });
                  vscode.postMessage({ type: "selectAgent", agent: agent.id });
                }}
              >
                <div className="text-oc-sm font-medium">{agent.name}</div>
                <div className="text-xs font-mono text-oc-text-muted truncate mt-0.5">
                  {agent.description}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function QueueContainer() {
  const {
    promptQueue,
    isQueueOpen,
    isExecutingQueue: isExecutingQueueGlobal,
    executingQueueSessionIds,
    processingSessionIds,
    isProcessing: globalIsProcessing,
    isSteering,
    currentSessionId,
  } = useAppState();
  const dispatch = useAppDispatch();

  const isProcessing = isProcessingInCurrentSession(
    globalIsProcessing,
    currentSessionId,
    processingSessionIds,
  );

  const isExecutingQueue = isExecutingQueueInCurrentSession(
    isExecutingQueueGlobal,
    currentSessionId,
    executingQueueSessionIds,
  );
  const [expandedQueueItemId, setExpandedQueueItemId] = useState<string | null>(
    null,
  );

  // Only render when there are queued items
  if (promptQueue.length === 0) return null;

  const runQueuedItem = (item: (typeof promptQueue)[number], index: number) => {
    const itemSessionId = item.sessionId;
    if (!itemSessionId) return;

    if (isProcessing) {
      dispatch({ type: "SET_STEERING", payload: true });
      vscode.postMessage({
        type: "steerQueuedItem",
        sessionId: itemSessionId,
        id: item.id,
        index,
      });
      return;
    }

    vscode.postMessage({
      type: "sendQueuedItemNow",
      sessionId: itemSessionId,
      id: item.id,
      index,
    });
  };

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
    <div className="mx-[0.625rem] overflow-hidden rounded-xl rounded-b-none border border-b-0 border-oc-border bg-oc-panel">
      {/* Collapsible header - always visible when items exist */}
      <div className="flex items-center justify-between px-3 py-2 transition-colors hover:bg-oc-panel-soft">
        <button
          type="button"
          className="flex items-center gap-2"
          onClick={() =>
            dispatch({ type: "SET_QUEUE_OPEN", payload: !isQueueOpen })
          }
          aria-expanded={isQueueOpen}
          aria-label={
            isQueueOpen ? "Collapse queue panel" : "Expand queue panel"
          }
        >
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-oc-text-muted">
            Queue
          </span>
          <span className="rounded-full bg-oc-accent-soft px-1.5 py-0.5 font-mono text-[9px] font-bold text-oc-accent">
            {promptQueue.length}
          </span>
          {isQueueOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-oc-text-muted" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5 text-oc-text-muted" />
          )}
        </button>
        {isQueueOpen && (
          <button
            type="button"
            className="rounded px-1.5 py-0.5 font-mono text-[10px] text-oc-red transition-colors hover:bg-[rgba(248,81,73,0.12)]"
            title="Clear all queued prompts"
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
        )}
      </div>

      {/* Expanded list */}
      {isQueueOpen && (
        <div className="border-t border-oc-border">
          <div className="max-h-48 space-y-2 overflow-y-auto p-2">
            {promptQueue.map((item, index) => {
              const itemSessionId = item.sessionId;
              const isExpanded = expandedQueueItemId === item.id;

              return (
                <div
                  key={item.id || `${item.text}-${index}`}
                  className="rounded-xl border border-oc-border bg-oc-bg-soft px-2.5 py-2"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-oc-border text-oc-text-muted">
                      <ChevronRight className="h-3 w-3" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`${isExpanded ? "whitespace-pre-wrap" : "line-clamp-2"} font-mono text-[11px] text-[var(--oc-text-soft)]`}
                      >
                        {item.text || "(empty)"}
                      </div>
                      {(item.files?.length || item.contexts?.length) && (
                        <div className="mt-1.5 flex items-center gap-2 font-mono text-[9px] text-oc-text-muted">
                          {item.files?.length ? (
                            <span>
                              {item.files.length} file
                              {item.files.length > 1 ? "s" : ""}
                            </span>
                          ) : null}
                          {item.contexts?.length ? (
                            <span>
                              {item.contexts.length} context
                              {item.contexts.length > 1 ? "s" : ""}
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="queue"
                        size="chip"
                        className="h-6 px-2 text-[10px]"
                        title={
                          isProcessing
                            ? "Steer this queued prompt now"
                            : "Send this queued prompt now"
                        }
                        disabled={
                          !itemSessionId || isSteering || isExecutingQueue
                        }
                        onClick={() => runQueuedItem(item, index)}
                      >
                        {isProcessing ? (
                          <Zap className="mr-1 h-3 w-3" />
                        ) : (
                          <Send className="mr-1 h-3 w-3" />
                        )}
                        {isProcessing
                          ? isSteering
                            ? "Steering..."
                            : "Steer"
                          : "Send"}
                      </Button>
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-oc-text-muted transition-colors hover:bg-[rgba(248,81,73,0.12)] hover:text-oc-red disabled:cursor-not-allowed disabled:opacity-50"
                        title="Remove from queue"
                        disabled={
                          !itemSessionId || isSteering || isExecutingQueue
                        }
                        onClick={() => removeQueuedItem(item, index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-oc-text-muted transition-colors hover:bg-oc-panel-soft hover:text-oc-text-soft"
                        title={isExpanded ? "Show less" : "Show more"}
                        onClick={() =>
                          setExpandedQueueItemId((currentId) =>
                            currentId === item.id ? null : item.id,
                          )
                        }
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between border-t border-oc-border px-3 py-2">
            <span className="font-mono text-[10px] text-oc-text-muted">
              {promptQueue.length} queued
            </span>
            <Button
              className="oc-queue-btn h-6 text-[10px]"
              variant="secondary"
              size="sm"
              disabled={isExecutingQueue || isSteering || !currentSessionId}
              onClick={() =>
                vscode.postMessage({
                  type: "executeQueue",
                  sessionId: currentSessionId,
                })
              }
            >
              <Play className="mr-1 h-3 w-3" /> Execute All
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
export function InputWrapper() {
  const {
    inputValue,
    isProcessing: globalIsProcessing,
    isExecutingQueue: globalIsExecutingQueue,
    isSteering,
    streaming,
    currentSessionId,
    processingSessionIds,
    executingQueueSessionIds,
    messages,
    promptQueue,
    selectedFiles,
    selectedContexts,
    selectedAgent,
    showFileSuggestions,
    fileSuggestions,
    selectedSuggestionIndex,
    availableCommands,
    commandsLoaded,
    attachments = [],
    interactiveEvents,
  } = useAppState();
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

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [currentInteractiveIndex, setCurrentInteractiveIndex] = useState(0);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");
  const customInputRef = useRef<HTMLInputElement>(null);
  const [previewAttachmentSrc, setPreviewAttachmentSrc] = useState<
    string | null
  >(null);
  const [pendingAnswers, setPendingAnswers] = useState<
    Record<string, { text: string; eventType: string }>
  >({});
  const [slashTrigger, setSlashTrigger] = useState<SlashTrigger | null>(null);
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(null);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const commandsRequestedRef = useRef(false);
  const suggestionsContainerRef = useRef<HTMLDivElement>(null);

  const filteredCommands = useMemo(() => {
    if (!slashTrigger) {
      return [] as SlashCommand[];
    }

    const query = slashTrigger.query.trim().toLowerCase();
    const base = availableCommands || [];
    if (!query) {
      return base;
    }

    return base.filter((command) => {
      const name = command.name.toLowerCase();
      return name.includes(query);
    });
  }, [slashTrigger, availableCommands]);

  useEffect(() => {
    if (slashTrigger && !commandsLoaded && !commandsRequestedRef.current) {
      commandsRequestedRef.current = true;
      vscode.postMessage({ type: "getCommands" });
    }
  }, [slashTrigger, commandsLoaded]);

  useEffect(() => {
    if (mentionTrigger) {
      vscode.postMessage({ type: "getMentions", query: mentionTrigger.query });
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
  // By design, ALL interactive choices (whether explicitly sent by the server or
  // auto-detected via regex from the AI's markdown response) are rendered here
  // as a popup above the chatbox. This provides a consistent, clear place for
  // user required actions (questions, confirmations, quick actions).
  //
  // Even if the AI types the question in the chat bubble, we show the popup
  // here to make the call-to-action obvious and clickable.
  const displayInteractiveEvents = interactiveEvents.filter(
    isQuickInputInteractiveEvent,
  );
  const interactiveEventCount = displayInteractiveEvents.length;

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
  }, [interactiveEventCount]);

  useEffect(() => {
    if (isCustomMode) {
      customInputRef.current?.focus();
    }
  }, [isCustomMode]);

  const activeInteractiveEvent =
    displayInteractiveEvents[currentInteractiveIndex];
  const event = activeInteractiveEvent;

  const capitalizeFirst = (str: string) => {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
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
      content: "", // Content can be fetched downstream or attached implicitly
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

  const sendPrompt = () => {
    const text = inputValue.trim();
    if (!text) return;
    if (isProcessing) {
      vscode.postMessage({
        type: "addToQueue",
        ...(currentSessionId ? { sessionId: currentSessionId } : {}),
        text,
        files: selectedFiles,
        contexts: selectedContexts,
        agent: selectedAgent || null,
        images: attachments || [],
      });
      dispatch({ type: "SET_QUEUE_OPEN", payload: true });
      dispatch({ type: "SET_INPUT_VALUE", payload: "" });
      dispatch({ type: "CLEAR_ATTACHMENTS" });
      setSlashTrigger(null);
      return;
    }
    vscode.postMessage({
      type: "sendMessage",
      ...(currentSessionId ? { sessionId: currentSessionId } : {}),
      text,
      files: selectedFiles,
      contexts: selectedContexts,
      agent: selectedAgent || null,
      images: attachments || [],
    });
    dispatch({
      type: "SET_MESSAGES",
      payload: [
        ...messages,
        {
          role: "user",
          content: text,
          parts: [{ type: "text", text }],
          images: (attachments || []).map((a) => a.dataUrl),
        },
      ],
    });
    dispatch({ type: "SET_PROCESSING", payload: true });
    dispatch({ type: "SET_INPUT_VALUE", payload: "" });
    dispatch({ type: "CLEAR_ATTACHMENTS" });
    setSlashTrigger(null);
  };

  const steerPrompt = () => {
    const text = inputValue.trim();
    if (!text || !isProcessing || isSteering) return;

    dispatch({ type: "SET_STEERING", payload: true });
    vscode.postMessage({
      type: "steerMessage",
      ...(currentSessionId ? { sessionId: currentSessionId } : {}),
      text,
      files: selectedFiles,
      contexts: selectedContexts,
      agent: selectedAgent || null,
      images: attachments || [],
    });
    dispatch({ type: "SET_QUEUE_OPEN", payload: true });
    dispatch({ type: "SET_INPUT_VALUE", payload: "" });
    dispatch({ type: "CLEAR_ATTACHMENTS" });
    setSlashTrigger(null);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
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

  const submitInteractiveResponse = (
    text: string,
    eventId: string,
    eventType: string,
  ) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    const nextAnswers = {
      ...pendingAnswers,
      [eventId]: { text: trimmed, eventType },
    };
    setPendingAnswers(nextAnswers);

    // If there are more questions, go to the next one
    if (currentInteractiveIndex < displayInteractiveEvents.length - 1) {
      setCurrentInteractiveIndex((prev) => prev + 1);
      setIsCustomMode(false);
      setCustomValue("");
    } else {
      // All questions are answered, submit batch
      submitBatchResponses(nextAnswers);
    }
  };

  const submitBatchResponses = (
    answers: Record<string, { text: string; eventType: string }>,
  ) => {
    const batch = Object.entries(answers).map(([eventId, data]) => ({
      eventId,
      eventType: data.eventType,
      text: data.text,
    }));

    const composedPrompt = batch
      .map(
        (resp) =>
          `[interactive:${resp.eventType || "event"}:${resp.eventId || "unknown"}] ${resp.text}`,
      )
      .join("\n");

    const displayText = batch
      .map((resp) => {
        const event = displayInteractiveEvents.find((e) => e.id === resp.eventId);
        const questionText =
          event && "question" in event
            ? event.question
            : event && "message" in event
              ? event.message
              : event?.title || null;
        if (questionText) {
          return `**${questionText}**\n${resp.text}`;
        }
        return resp.text;
      })
      .join("\n\n");

    const nextMessages = [...messages];
    if (hasRenderableStreamingPayload(streaming)) {
      const frozenAssistant = buildAssistantMessageFromStreaming(streaming!);
      const frozenMessageId = frozenAssistant.info?.id || frozenAssistant.id;
      const alreadyPresent = frozenMessageId
        ? nextMessages.some(
            (message) =>
              (message.info?.id || message.id || null) === frozenMessageId,
          )
        : nextMessages.some((message) => {
            const role = message.role || message.info?.role;
            return (
              role === "assistant" &&
              (message.content || "").trim() ===
                (frozenAssistant.content || "").trim() &&
              (message.steps?.length || 0) ===
                (frozenAssistant.steps?.length || 0) &&
              (message.reasoningEvents?.length || 0) ===
                (frozenAssistant.reasoningEvents?.length || 0)
            );
          });

      if (!alreadyPresent) {
        nextMessages.push(frozenAssistant);
        if (currentSessionId) {
          vscode.postMessage({
            type: "persistAssistantMessage",
            sessionId: currentSessionId,
            message: frozenAssistant,
          });
        }
      }
    }

    nextMessages.push({
      id: `interactive-${Date.now()}`,
      role: "user",
      content: displayText,
      parts: [{ type: "text", text: composedPrompt }],
    });

    dispatch({
      type: "SET_MESSAGES",
      payload: nextMessages,
    });

    dispatch({ type: "SET_STREAMING", payload: null });
    dispatch({ type: "SET_PROCESSING", payload: false });

    vscode.postMessage({
      type: "batchInteractiveResponse",
      ...(currentSessionId ? { sessionId: currentSessionId } : {}),
      responses: batch,
      agent: selectedAgent || null,
    });

    // Dismiss all events that were part of this batch
    batch.forEach((resp) => {
      dispatch({ type: "DISMISS_INTERACTIVE_EVENT", payload: resp.eventId });
    });

    // Reset state
    setPendingAnswers({});
    setCurrentInteractiveIndex(0);
  };

  const stopRequest = () =>
    vscode.postMessage({
      type: "stopRequest",
      ...(currentSessionId ? { sessionId: currentSessionId } : {}),
    });

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
      <QueueContainer />
      <div
        className="oc-input-area"
        style={promptQueue.length > 0 ? { borderTop: "none" } : undefined}
      >
        {event && (
          <div className="mb-2 rounded-lg border border-[var(--oc-border)] bg-[var(--oc-panel-soft)] px-3 py-2">
            <div className="mb-2 flex items-center justify-between gap-2 border-b border-[var(--oc-border)] pb-1.5">
              <div className="flex items-center gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--oc-text-muted)]">
                  {event.title || "Quick Input"}
                </div>
                {displayInteractiveEvents.length > 1 && (
                  <div className="flex items-center gap-1.5 ml-2 border-l border-[var(--oc-border)] pl-3">
                    <button
                      type="button"
                      disabled={currentInteractiveIndex === 0}
                      onClick={() => {
                        setCurrentInteractiveIndex((i) => i - 1);
                        setIsCustomMode(false);
                        setCustomValue("");
                      }}
                      className="text-[var(--oc-text-muted)] hover:text-[var(--oc-accent)] disabled:opacity-30 disabled:hover:text-[var(--oc-text-muted)] transition-colors"
                      title="Previous"
                    >
                      <ArrowLeft className="h-3 w-3" />
                    </button>
                    <span className="text-[10px] font-mono text-[var(--oc-text-muted)] tabular-nums">
                      {currentInteractiveIndex + 1} /{" "}
                      {displayInteractiveEvents.length}
                    </span>
                    <button
                      type="button"
                      disabled={
                        currentInteractiveIndex ===
                        displayInteractiveEvents.length - 1
                      }
                      onClick={() => {
                        setCurrentInteractiveIndex((i) => i + 1);
                        setIsCustomMode(false);
                        setCustomValue("");
                      }}
                      className="text-[var(--oc-text-muted)] hover:text-[var(--oc-accent)] disabled:opacity-30 disabled:hover:text-[var(--oc-text-muted)] transition-colors"
                      title="Next"
                    >
                      <ArrowRight className="h-3 w-3" />
                    </button>
                    {Object.keys(pendingAnswers).length > 0 && (
                      <span className="ml-1 rounded-full bg-[var(--oc-accent-soft)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--oc-accent)] tabular-nums">
                        {Object.keys(pendingAnswers).length} answered
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded p-1 text-[var(--oc-text-muted)] hover:bg-[var(--oc-accent-soft)] hover:text-[var(--oc-accent)] transition-colors"
                  title="Dismiss This"
                  onClick={() => {
                    dispatch({
                      type: "DISMISS_INTERACTIVE_EVENT",
                      payload: event.id,
                    });
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="relative">
              {Object.keys(pendingAnswers).length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5 p-2 bg-[var(--oc-panel)] rounded-md border border-dashed border-[var(--oc-border)]">
                  {Object.entries(pendingAnswers).map(([eventId, data], idx) => (
                    <span key={eventId} className="rounded bg-[var(--oc-panel-soft)] px-1.5 py-0.5 text-[10px] text-[var(--oc-text-muted)] border border-[var(--oc-border-soft)]" title={data.text}>
                      Q{idx + 1}: <span className="font-medium text-[var(--oc-text-soft)] truncate max-w-[120px] inline-block align-bottom">{data.text}</span>
                    </span>
                  ))}
                </div>
              )}
              <div className="mb-3 text-[12px] text-[var(--oc-text-soft)]">
                <MarkdownRenderer
                  content={
                    event.type === "quick_actions"
                      ? event.title || "Select an action"
                      : event.type === "message"
                        ? event.message
                        : event.question
                  }
                />
              </div>

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
                    <div className="flex flex-wrap gap-2">
                      {event.options.map((option, index) => (
                        <button
                          key={`${event.id}-q-${option.id || option.value || index}`}
                          type="button"
                          className="rounded-md border border-[var(--oc-border)] bg-[var(--oc-panel)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--oc-text-soft)] hover:border-[var(--oc-accent)] hover:bg-[var(--oc-accent-soft)] hover:text-[var(--oc-accent)] transition-all"
                          title={option.description || option.label}
                          onClick={() =>
                            submitInteractiveResponse(
                              option.value || option.label,
                              event.id,
                              event.type,
                            )
                          }
                        >
                          {capitalizeFirst(option.label)}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="rounded-md border border-dashed border-[var(--oc-border)] bg-transparent px-2.5 py-1.5 text-[11px] font-medium text-[var(--oc-text-muted)] hover:border-[var(--oc-accent)] hover:text-[var(--oc-accent)] transition-all"
                        onClick={() => setIsCustomMode(true)}
                      >
                        Custom Answer...
                      </button>
                    </div>
                  ) : null}

                  {event.type === "confirm" ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-md border border-[var(--oc-border)] bg-[var(--oc-panel)] px-3 py-1.5 text-[11px] font-medium text-[var(--oc-text-soft)] hover:border-[var(--oc-accent)] hover:bg-[var(--oc-accent-soft)] hover:text-[var(--oc-accent)] transition-all"
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
                        className="rounded-md border border-[var(--oc-border)] bg-[var(--oc-panel)] px-3 py-1.5 text-[11px] font-medium text-[var(--oc-text-muted)] hover:border-[var(--oc-border-strong)] hover:text-[var(--oc-text-soft)] transition-all"
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
                          className="rounded-md border border-[var(--oc-border)] bg-[var(--oc-panel)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--oc-text-soft)] hover:border-[var(--oc-accent)] hover:bg-[var(--oc-accent-soft)] hover:text-[var(--oc-accent)] transition-all"
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
                        className="rounded-md border border-[var(--oc-border)] bg-[var(--oc-panel)] px-3 py-1.5 text-[11px] font-medium text-[var(--oc-text-soft)] hover:border-[var(--oc-accent)] hover:bg-[var(--oc-accent-soft)] hover:text-[var(--oc-accent)] transition-all"
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
            </div>
          </div>
        )}

        {/* Context chips */}
        {(selectedFiles.length > 0 || selectedContexts.length > 0) && (
          <div className="oc-context-chips flex flex-wrap gap-1.5 mb-2">
            {selectedFiles.map((file) => (
              <Badge
                key={file}
                variant="secondary"
                className="flex items-center gap-1 font-mono text-[10px] hover:bg-oc-panel-soft cursor-default text-[var(--oc-text-soft)]"
              >
                <FileIcon filePath={file} />
                {file}
              </Badge>
            ))}
            {selectedContexts.map((context) => (
              <Badge
                key={`${context.file}:${context.lineInfo}`}
                variant="secondary"
                className="flex items-center gap-1 font-mono text-[10px] pr-1.5 hover:bg-oc-panel-soft cursor-default text-[var(--oc-text-soft)]"
              >
                <FileIcon filePath={context.file} />
                <span>
                  {context.file} {context.lineInfo}
                </span>
                {context.languageId && (
                  <span className="opacity-60 text-[9px] font-semibold">
                    {context.languageId}
                  </span>
                )}
                {context.isAuto && (
                  <button
                    type="button"
                    className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
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
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
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
                  <span className="truncate max-w-[140px]">{a.filename}</span>
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
                ? "Ask for follow-up changes"
                : "Ask anything (Enter to send, Shift+Enter for newline), @ to mention, / for commands"
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

              if (mentionTrigger && showFileSuggestions) {
                if (e.key === "ArrowDown" && fileSuggestions.length > 0) {
                  e.preventDefault();
                  dispatch({ 
                    type: "SET_SUGGESTION_INDEX", 
                    payload: Math.min(selectedSuggestionIndex + 1, fileSuggestions.length - 1) 
                  });
                  return;
                }
                if (e.key === "ArrowUp" && fileSuggestions.length > 0) {
                  e.preventDefault();
                  dispatch({ 
                    type: "SET_SUGGESTION_INDEX", 
                    payload: Math.max(selectedSuggestionIndex - 1, 0) 
                  });
                  return;
                }
                if ((e.key === "Enter" || e.key === "Tab") && fileSuggestions.length > 0) {
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
                <div className="px-3 py-2 text-[11px] font-mono text-oc-text-muted">
                  Loading commands...
                </div>
              ) : filteredCommands.length > 0 ? (
                filteredCommands.map((command, index) => (
                  <button
                    key={command.name}
                    type="button"
                    className={`oc-suggestion-item ${
                      index === selectedCommandIndex ? "active" : ""
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
                      <div className="mt-0.5 truncate text-[10px] text-oc-text-muted">
                        {command.description}
                      </div>
                    ) : null}
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-[11px] font-mono text-oc-text-muted">
                  No matching commands.
                </div>
              )}
            </div>
          )}

          {/* File suggestions */}
          {showFileSuggestions && fileSuggestions.length > 0 && (
            <div className="oc-suggestions" ref={suggestionsContainerRef}>
              {fileSuggestions.map((suggestion, index) => (
                <button
                  key={suggestion.path}
                  type="button"
                  className={`oc-suggestion-item ${
                    index === selectedSuggestionIndex ? "active" : ""
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

          {/* Bottom toolbar */}
          <div className="oc-toolbar">
            {/* Left: chip selectors */}
            <div className="oc-toolbar-left">
              <ModelDropdown />
              <AgentDropdown />
              <ThinkingLevelControl />
            </div>

            {/* Right: action buttons */}
            <div className="oc-toolbar-right">
              {isProcessing ? (
                <Button
                  variant="destructive"
                  size="chip"
                  onClick={stopRequest}
                  disabled={isSteering}
                >
                  <Square className="h-3 w-3" />
                  Stop
                </Button>
              ) : null}
              {isProcessing ? (
                <Button
                  variant="secondary"
                  size="chip"
                  onClick={steerPrompt}
                  disabled={!inputValue.trim() || isSteering}
                >
                  <Zap className="h-3 w-3" />
                  {isSteering ? "Steering..." : "Steer now"}
                </Button>
              ) : null}
              <Button
                variant="send"
                size="chip"
                onClick={sendPrompt}
                disabled={isSteering}
              >
                {isProcessing ? (
                  <AlertCircle className="h-3.5 w-3.5" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                {isProcessing ? "Queue" : "Send"}
              </Button>
            </div>
          </div>
        </div>
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
}

export function ThinkingLevelControl() {
  const { thinkingLevel, thinkingDropdownOpen, modelCapability } = useAppState();
  const dispatch = useAppDispatch();
  const containerRef = useRef<HTMLDivElement>(null);

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

  const localVariants =
    (modelCapability && modelCapability.variants && modelCapability.variants.length > 0)
      ? modelCapability.variants
      : ["low", "medium", "high"];

  const displayLabel = (lvl?: string) => {
    const current = lvl ?? localVariants[1] ?? localVariants[0];
    if (!current) return "Med";
    return current.slice(0, 3).toUpperCase();
  };

  useEffect(() => {
    if (!localVariants || localVariants.length === 0) return;
    if (!thinkingLevel || !localVariants.includes(thinkingLevel)) {
      dispatch({ type: "SET_THINKING_LEVEL", payload: localVariants[0] as ThinkingLevel });
    }
  }, [ (localVariants || []).join(","), thinkingLevel, dispatch]);

  if (!modelCapability || !modelCapability.reasoning) return null;

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="chip"
        size="chip"
        onClick={() =>
          dispatch({
            type: "SET_THINKING_DROPDOWN_OPEN",
            payload: !thinkingDropdownOpen,
          })
        }
        aria-label="Set thinking level"
      >
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="opacity-60">Think</span>
            <span className="font-medium text-oc-accent">
              {displayLabel(thinkingLevel)}
            </span>
          </div>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform ${
            thinkingDropdownOpen ? "rotate-180" : ""
          }`}
        />
      </Button>
      {thinkingDropdownOpen && (
        <div className="oc-popover absolute bottom-full left-0 z-30 mb-1.5 w-44 rounded-xl border border-oc-border bg-oc-panel shadow-xl overflow-hidden">
          <div className="px-1.5 py-1.5">
            {(localVariants as ThinkingLevel[]).map((level) => (
              <button
                key={level}
                type="button"
                className={`oc-popover-item w-full rounded-lg px-3 py-2 text-left transition-colors ${
                  thinkingLevel === level
                    ? "bg-oc-accent-soft text-oc-accent"
                    : "hover:bg-oc-panel-soft"
                }`}
                onClick={() => setLevel(level)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-oc-sm font-medium capitalize">
                    {level}
                  </span>
                  {thinkingLevel === level && (
                    <span className="text-xs font-mono uppercase tracking-wider text-oc-accent">
                      active
                    </span>
                  )}
                </div>
                <div className="text-xs font-mono text-oc-text-muted mt-0.5">
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function QuotaMonitor() {
  const { quotaData, quotaIsRefreshing, budgetInfo } = useAppState();
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
    if (pct >= 50) return "linear-gradient(90deg, #2ea043, #3fb950)";
    if (pct >= 20) return "linear-gradient(90deg, #bf8700, #d29922)";
    return "linear-gradient(90deg, #da3633, #f85149)";
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
            className="h-7 px-2 text-xs font-mono"
            title="Refresh quota"
            aria-label="Refresh quota"
            disabled={quotaIsRefreshing}
            onClick={handleRefresh}
          >
            <RefreshCw
              className={`mr-1 h-3.5 w-3.5 ${
                quotaIsRefreshing ? "animate-spin" : ""
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
                    className="overflow-hidden rounded-xl border border-oc-border bg-[linear-gradient(180deg,var(--oc-panel)_0%,var(--oc-panel-soft)_100%)] shadow-[0_6px_20px_rgba(0,0,0,0.2)]"
                  >
                    <div className="border-b border-oc-border px-3 py-2.5">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="text-oc-sm font-semibold tracking-tight text-[var(--oc-text-soft)]">
                          {toProviderName(platform.platform, platform.title)}
                        </span>
                        {platform.status === "error" ? (
                          <Badge
                            variant="destructive"
                            className="text-xs uppercase"
                          >
                            error
                          </Badge>
                        ) : platform.status === "warning" ? (
                          <Badge
                            variant="warning"
                            className="text-[#d29922] text-xs uppercase"
                          >
                            warning
                          </Badge>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
                        <span className="font-mono uppercase tracking-wider text-[var(--oc-text-soft)] opacity-80">
                          Account:
                        </span>
                        <span className="truncate font-mono text-[var(--oc-text-soft)]">
                          {platform.account} {platform.accountLabel ?? ""}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2.5 px-3 py-2.5">
                      {platform.error ? (
                        <div className="rounded-md border border-oc-red/40 bg-oc-red/10 px-2.5 py-2 text-oc-red">
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
                            className="rounded-lg border border-oc-border bg-[rgba(0,0,0,0.16)] p-2"
                          >
                            <div className="mb-1 flex items-center justify-between gap-2">
                              <span className="text-xs font-medium text-[var(--oc-text-soft)]">
                                {quota.label}
                              </span>
                              <span className="font-mono text-xs text-[var(--oc-text-soft)]">
                                {quota.percentLabel ??
                                  `${Math.round(pct)}% remaining`}
                              </span>
                            </div>
                            <div className="h-1 w-full overflow-hidden rounded-full bg-oc-border">
                              <div
                                className="h-full rounded-full transition-all duration-300"
                                style={{
                                  width: `${pct}%`,
                                  background: barColor(pct),
                                }}
                              />
                            </div>

                            <div className="mt-1.5 space-y-0.5 text-xs text-[var(--oc-text-soft)] opacity-70">
                              {quota.usedTotalDisplay ? (
                                <div className="flex items-center justify-between gap-2">
                                  <span>Used</span>
                                  <span className="font-mono text-[var(--oc-text-soft)]">
                                    {quota.usedTotalDisplay}
                                  </span>
                                </div>
                              ) : null}
                              {quota.resetLabel ? (
                                <div className="flex items-center justify-between gap-2">
                                  <span>Resets in</span>
                                  <span className="font-mono text-[var(--oc-text-soft)]">
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

                      {/* Budget info - integrated into GitHub Copilot card */}
                      {platform.platform === "github-copilot" && budgetInfo ? (
                        <div className="mt-3 overflow-hidden rounded-xl border border-oc-border bg-[var(--oc-panel-soft)]/40 shadow-sm">
                          {/* Header */}
                          <div className="border-b border-oc-border/50 px-3 py-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="flex h-5 w-5 items-center justify-center rounded-md bg-oc-accent/10 text-oc-accent">
                                <Zap className="h-3 w-3 fill-current" />
                              </div>
                              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--oc-text-soft)]">
                                Daily Budget
                              </span>
                            </div>
                            <Badge
                              variant="accent"
                              className={`font-mono text-[10px] uppercase h-5 px-1.5 border-none ${
                                budgetInfo.warningLevel === "critical"
                                  ? "bg-oc-red/10 text-oc-red"
                                  : budgetInfo.warningLevel === "warning"
                                    ? "bg-[#d29922]/10 text-[#d29922]"
                                    : "bg-oc-accent/10 text-oc-accent"
                              }`}
                            >
                              {budgetInfo.warningLevel}
                            </Badge>
                          </div>

                          {/* Progress bar section */}
                          <div className="px-3 pt-2.5 pb-2">
                            <div className="mb-1.5 flex items-center justify-between">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--oc-text-soft)] opacity-50">
                                Used Today
                              </span>
                              <span className="font-mono text-[10px] font-bold text-[var(--oc-text-soft)] opacity-70">
                                {budgetInfo.usedToday} /{" "}
                                {budgetInfo.dailyAllowance}
                              </span>
                            </div>
                            <div className="relative h-1 w-full overflow-hidden rounded-full bg-oc-border/40">
                              <div
                                className="h-full rounded-full transition-all duration-500 ease-out"
                                style={{
                                  width: `${budgetInfo.dailyAllowance > 0 ? Math.min(100, (budgetInfo.usedToday / budgetInfo.dailyAllowance) * 100) : 0}%`,
                                  background: barColor(
                                    budgetInfo.dailyAllowance > 0
                                      ? (budgetInfo.remainingToday /
                                          budgetInfo.dailyAllowance) *
                                          100
                                      : 100,
                                  ),
                                }}
                              />
                            </div>
                          </div>

                          {/* 3-column stats grid */}
                          <div className="grid grid-cols-3 divide-x divide-oc-border/30 border-t border-oc-border/30 px-1 py-2">
                            <div className="px-2 text-center">
                              <div className="text-[9px] font-semibold uppercase tracking-tighter text-[var(--oc-text-soft)] opacity-50">
                                Available
                              </div>
                              <div
                                className={`text-sm font-bold leading-tight ${
                                  budgetInfo.warningLevel === "critical"
                                    ? "text-oc-red"
                                    : budgetInfo.warningLevel === "warning"
                                      ? "text-[#d29922]"
                                      : "text-oc-accent"
                                }`}
                              >
                                {budgetInfo.availableToday}
                              </div>
                              {budgetInfo.availableToday >
                              budgetInfo.dailyAllowance ? (
                                <div className="mt-0.5 text-[9px] font-medium text-oc-accent/70 leading-none">
                                  +
                                  {budgetInfo.availableToday -
                                    budgetInfo.dailyAllowance}{" "}
                                  rollover
                                </div>
                              ) : null}
                            </div>
                            <div className="px-2 text-center">
                              <div className="text-[9px] font-semibold uppercase tracking-tighter text-[var(--oc-text-soft)] opacity-50">
                                Used
                              </div>
                              <div className="text-sm font-bold leading-tight text-[var(--oc-text-soft)]">
                                {budgetInfo.usedToday}
                              </div>
                            </div>
                            <div className="px-2 text-center">
                              <div className="text-[9px] font-semibold uppercase tracking-tighter text-[var(--oc-text-soft)] opacity-50">
                                Days Left
                              </div>
                              <div className="text-sm font-bold leading-tight text-[var(--oc-text-soft)]">
                                {budgetInfo.daysRemaining}
                              </div>
                            </div>
                          </div>

                          {/* Advice footer */}
                          {budgetInfo.advice && budgetInfo.advice.length > 0 ? (
                            <div className="border-t border-oc-border/30 bg-oc-accent/5 px-3 py-1.5">
                              <p className="text-[10px] leading-relaxed text-[var(--oc-text-soft)] opacity-75 italic">
                                {budgetInfo.advice[0].replace(
                                  /^(?:💡|✅|⚠️|🚨)\s*/,
                                  "",
                                )}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}

              {lastUpdatedLabel ? (
                <div className="text-center text-xs text-[var(--oc-text-soft)] opacity-50 font-mono">
                  Updated: {lastUpdatedLabel}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// TodoPanel - displays todo items in right panel
export function TodoPanel() {
  const { todoItems } = useAppState();
  const [open, setOpen] = useState(true);

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
        return "text-[#d29922] bg-[#d29922]/10 border-[#d29922]/30";
      case "in_progress":
        return "text-oc-accent bg-oc-accent/10 border-oc-accent/30";
      case "completed":
        return "text-oc-green bg-oc-green/10 border-oc-green/30";
      case "failed":
        return "text-oc-red bg-oc-red/10 border-oc-red/30";
      case "cancelled":
        return "text-[var(--oc-text-soft)] bg-oc-border/30 border-oc-border";
      default:
        return "text-[var(--oc-text-soft)] bg-oc-border/20 border-oc-border";
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
          {!todoItems || todoItems.length === 0 ? (
            <div className="py-3 text-center text-[var(--oc-text-soft)] opacity-60 text-xs">
              No tasks yet
            </div>
          ) : (
            <div className="space-y-1.5">
              {todoItems.map((t) => (
                <div
                  key={t.id}
                  className="flex items-start gap-2 rounded-md border border-oc-border bg-oc-panel-soft p-2"
                >
                  <div
                    className={`text-[14px] leading-none mt-0.5 ${
                      t.status === "failed"
                        ? "text-oc-red"
                        : t.status === "completed"
                          ? "text-oc-green"
                          : t.status === "in_progress"
                            ? "text-oc-accent"
                            : t.status === "pending"
                              ? "text-[#d29922]"
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
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// McpPanel - displays MCP (Model Context Protocol) server status with live data from OpenCode SDK
export function McpPanel() {
  const [open, setOpen] = useState(true);
  const [expandedServers, setExpandedServers] = useState<Set<string>>(
    new Set(),
  );
  const { mcpServers } = useAppState();
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
                  className="rounded-md border border-oc-border bg-oc-panel-soft"
                >
                  {/* Server row */}
                  <div className="flex items-center gap-2 p-2">
                    <span
                      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(server.status)}`}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate font-mono text-xs font-medium text-[var(--oc-text-soft)]">
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
                            className="truncate rounded px-1 py-0.5 font-mono text-[10px] text-[var(--oc-text-soft)] opacity-80 hover:bg-oc-border/40"
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
            <div className="mt-1.5 text-center text-xs text-[var(--oc-text-soft)] opacity-60">
              {connectedCount} / {mcpServers.length} connected
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// LspPanel - displays Language Server Protocol status with live data from OpenCode SDK
export function LspPanel() {
  const [open, setOpen] = useState(true);
  const { lspServers } = useAppState();

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
                className="rounded-md border border-oc-border bg-oc-panel-soft p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                        server.status === "connected"
                          ? "bg-[var(--oc-green)]"
                          : "bg-[var(--oc-red)]"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="truncate font-mono text-xs font-medium text-[var(--oc-text-soft)]">
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
}

// SkillsPanel - displays slash command skills from the OpenCode SDK command catalog
export function SkillsPanel() {
  const [open, setOpen] = useState(true);
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
  const { availableCommands, commandsLoaded, serverStatus } = useAppState();

  const hasSkills = availableCommands.length > 0;

  // Load commands on mount if server is ready and commands not yet loaded
  // This ensures SkillsPanel shows data immediately on desktop ≥1100px
  useEffect(() => {
    if (serverStatus === "running" && !commandsLoaded) {
      vscode.postMessage({ type: "getCommands" });
    }
  }, [serverStatus, commandsLoaded]);

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
          <Zap
            className="h-3 w-3 text-[var(--oc-text-soft)]"
            aria-hidden="true"
          />
          <span>Skills</span>
          {hasSkills && (
            <span className="text-[10px] text-[var(--oc-text-soft)] opacity-50">
              {availableCommands.length}
            </span>
          )}
        </div>
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

      {open ? (
        <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
          {!hasSkills ? (
            <div className="py-2 text-center text-xs text-[var(--oc-text-soft)] opacity-60">
              No skills configured
            </div>
          ) : (
            availableCommands.map((skill) => {
              const isExpanded = expandedSkills.has(skill.name);
              const hasDetail = !!(
                skill.description ||
                skill.agent ||
                skill.model
              );
              return (
                <div
                  key={skill.name}
                  className="rounded-md border border-oc-border bg-oc-panel-soft"
                >
                  <div className="flex items-center gap-2 p-2">
                    <span className="font-mono text-xs font-medium text-oc-accent shrink-0">
                      /
                    </span>
                    <span className="flex-1 truncate font-mono text-xs font-medium text-[var(--oc-text-soft)]">
                      {skill.name}
                    </span>
                    {skill.subtask && (
                      <span
                        className="shrink-0 rounded px-1 py-0.5 text-[10px] text-[var(--oc-text-soft)] opacity-50"
                        title="Runs as a subtask"
                      >
                        subtask
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

                  {isExpanded && hasDetail && (
                    <div className="border-t border-oc-border px-2 pb-2 pt-1 space-y-0.5">
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
                          <span className="font-mono">{skill.model}</span>
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
}

// AgentsPanel - displays installed agents/skills with live data from OpenCode SDK
export function AgentsPanel() {
  const [open, setOpen] = useState(true);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const { availableAgents } = useAppState();

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

  function modeBadgeClass(mode: string | undefined) {
    if (mode === "subagent")
      return "bg-[var(--oc-yellow,#f59e0b)]/20 text-[var(--oc-yellow,#f59e0b)]";
    if (mode === "all") return "bg-[var(--oc-accent)]/20 text-oc-accent";
    // primary (default)
    return "bg-[var(--oc-green)]/20 text-[var(--oc-green)]";
  }

  return (
    <div className="oc-agents-panel border-t border-oc-border p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <div className="oc-panel-title flex items-center gap-1.5">
          <Bot
            className="h-3 w-3 text-[var(--oc-text-soft)]"
            aria-hidden="true"
          />
          <span>Agents</span>
        </div>
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

      {open ? (
        <div className="space-y-1.5">
          {!hasAgents ? (
            <div className="py-2 text-center text-xs text-[var(--oc-text-soft)] opacity-60">
              No agents available
            </div>
          ) : (
            availableAgents.map((agent) => {
              const isExpanded = expandedAgents.has(agent.id);
              const hasDescription = !!agent.description;
              return (
                <div
                  key={agent.id}
                  className="rounded-md border border-oc-border bg-oc-panel-soft"
                >
                  <div className="flex items-center gap-2 p-2">
                    {/* Color dot — uses agent's color if set, else accent */}
                    <span
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: agent.color ?? "var(--oc-accent)",
                      }}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate font-mono text-xs font-medium text-[var(--oc-text-soft)]">
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
                        className="shrink-0 rounded px-1 py-0.5 text-[10px] text-[var(--oc-text-soft)] opacity-50"
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

                  {isExpanded && hasDescription && (
                    <div className="border-t border-oc-border px-2 pb-2 pt-1 text-[10px] text-[var(--oc-text-soft)] opacity-70 leading-relaxed">
                      {agent.description}
                    </div>
                  )}
                </div>
              );
            })
          )}
          {hasAgents && (
            <div className="mt-1.5 text-center text-xs text-[var(--oc-text-soft)] opacity-60">
              {customCount > 0
                ? `${customCount} custom · ${builtInCount} built-in`
                : `${builtInCount} built-in`}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

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

export function SettingsModal({
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
      <div className="oc-image-preview-modal max-w-3xl w-[94vw] h-[84vh] flex flex-col overflow-hidden border border-oc-border shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="oc-image-preview-header flex items-center justify-between px-4 py-3 border-b border-oc-border bg-oc-bg-soft">
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

        <div className="flex-1 flex flex-col p-4 space-y-3 overflow-hidden bg-oc-bg">
          <div className="flex items-center justify-between text-xs gap-3">
            <div className="flex items-center gap-2 text-oc-text-muted min-w-0">
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
              <TabsTrigger value="json" className="text-xs font-mono">
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
                  <div className="rounded-md border border-oc-border/70 bg-oc-bg-soft p-2 text-[10px] text-oc-text-muted">
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
                className="h-full w-full resize-none font-mono text-[13px] leading-relaxed p-4 bg-oc-bg-soft border-oc-border focus-visible:ring-1 focus-visible:ring-oc-accent"
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

        <div className="p-4 border-t border-oc-border bg-oc-bg-soft flex justify-between items-center gap-3">
          <p className="text-[10px] text-oc-text-muted">
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
}

export function SettingsPanel() {
  const { opencodeConfig, opencodeConfigSaveStatus, availableModels } = useAppState();
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
            className={`h-6 w-6 text-oc-text-muted hover:text-oc-accent transition-all ${isRefreshing ? "animate-spin" : ""}`}
            title="Reload config"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-oc-bg-soft border border-oc-border/50 shadow-sm transition-all hover:border-oc-accent/30">
          <div className="flex items-center justify-between text-[10px] text-oc-text-muted font-medium uppercase tracking-wider">
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
            <span className="text-[11px] font-mono truncate text-oc-text opacity-90">
              {previewModel}
            </span>
          </div>
          <div
            className="text-[10px] text-oc-text-muted truncate"
            title={opencodeConfig?.filePath}
          >
            {opencodeConfig?.filePath || "Resolving config path..."}
          </div>
        </div>

        {recentSaveStatus ? (
          <div
            className={`rounded-md border p-2 text-[11px] flex items-start gap-2 ${
              recentSaveStatus.success
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
          <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-oc-bg-soft border border-oc-border/50 shadow-sm">
            <div className="text-[10px] text-oc-text-muted font-medium uppercase tracking-wider">
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
              className="w-full h-7 text-[11px] font-mono border border-oc-border bg-oc-bg rounded px-2"
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
}

export { ConfigSidebar } from './ConfigSidebar';
