import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Archive, X } from "lucide-react";

import { AppProvider, useAppDispatch, useAppState } from "./lib/store";
import {
  createMessageHandler,
  normalizeCentralizedEventPayloads,
} from "./lib/messageHandler";
import {
  isAssistantRespondingInCurrentSession,
  hasCompletedAssistantReplyForLatestTurn,
  isProcessingInCurrentSession,
} from "./lib/sessionProcessing";
import { hasSystemMessagePatternInText } from "./lib/store";
import vscode from "./lib/vscode";
import logger, { getGlobalShowBrowserConsole } from "./lib/logger";

import {
  StickyHeader,
  HistorySidebar,
  MobileRightSummary,
  InputWrapper,
  ActiveTaskPanel,
  QuotaMonitor,
  TodoPanel,
  McpPanel,
  LspPanel,
  AgentsPanel,
  SkillsPanel,
  SettingsPanel,
} from "./PanelComponents";
import { CentralizedToastOverlay } from "./ToastOverlay";
import { StreamingCard } from "./StreamingComponents";
import {
  AssistantResponseCard,
  CentralizedDebugPanel,
  EmptyState,
  FileChangesSection,
  PermissionCard,
  SystemMessage,
  ThinkingBubble,
  UserMessage,
} from "./MessageComponents";
import { SkillInstallerModal } from "./SkillInstallerModal";
import { SessionModal } from "./components/SessionModal";
import type { CentralizedSessionDiffEvent, Message } from "./lib/types";

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function buildCentralizedRenderMessages(
  messages: Message[],
  rawSdkEventPayloads: unknown[],
): Message[] {
  // Normalize the centralized tape once so this conversation builder only
  // consumes one canonical event envelope regardless of whether the original
  // payload was a direct `properties.part` event or a sync-wrapped event.
  const normalizedRawSdkEventPayloads = normalizeCentralizedEventPayloads(rawSdkEventPayloads);
  /**
   * ============================================================================
   * STRICT CENTRALIZED DATA ENFORCEMENT
   * ============================================================================
   * Per strict architectural requirements: All data that will be rendered in the 
   * conversation list MUST come from the centralized data (rawSdkEventPayloads), 
   * nothing else. 
   * 
   * We do NOT render optimistic messages from the local `messages` state. 
   * Even user messages are purely derived from the central tape echoing them back.
   * If a message is not in `rawSdkEventPayloads`, it does not exist in the UI.
   * ============================================================================
   */
  const merged: Message[] = [];
  const knownIds = new Set<string>();
  const assistantIds = new Set<string>();
  const assistantParentIds = new Set<string>();
  const sourceMessagesById = new Map<string, Message>();

  for (const message of messages) {
    const messageId = firstNonEmptyString(
      message.info?.id,
      message.id,
      message.messageId,
    );
    if (!messageId || sourceMessagesById.has(messageId)) {
      continue;
    }
    sourceMessagesById.set(messageId, message);
  }

  // 1. First pass: Collect all assistant messages from the central tape
  for (const payload of normalizedRawSdkEventPayloads) {
    const event = asRecord(payload);
    if (!event || firstNonEmptyString(event.type) !== "message.updated") {
      continue;
    }
    const properties = asRecord(event.properties);
    const info = asRecord(properties?.info) ?? asRecord(event.info);
    if (firstNonEmptyString(info?.role)?.toLowerCase() !== "assistant") {
      continue;
    }
    const assistantId = firstNonEmptyString(info?.id, info?.messageID, info?.messageId);
    const parentId = firstNonEmptyString(info?.parentID, info?.parentId);
    if (assistantId) {
      assistantIds.add(assistantId);
      if (parentId) {
        assistantParentIds.add(parentId);
      }

      if (!knownIds.has(assistantId)) {
        knownIds.add(assistantId);
        const sourceMessage = sourceMessagesById.get(assistantId);
        if (sourceMessage) {
          merged.push(sourceMessage);
          continue;
        }

        merged.push({
          id: assistantId,
          role: "assistant",
          info: {
            id: assistantId,
            role: "assistant",
            created:
              typeof asRecord(info?.time)?.created === "number"
                ? (asRecord(info?.time)?.created as number)
                : undefined,
          },
          created:
            typeof asRecord(info?.time)?.created === "number"
              ? (asRecord(info?.time)?.created as number)
              : undefined,
        } as Message);
      }
    }
  }

  // 2. Second pass: Collect all user messages from the central tape
  for (const payload of normalizedRawSdkEventPayloads) {
    const event = asRecord(payload);
    if (!event || firstNonEmptyString(event.type) !== "message.part.updated") {
      continue;
    }
    const properties = asRecord(event.properties);
    const part = asRecord(properties?.part) ?? asRecord(event.part);
    if (firstNonEmptyString(part?.type)?.toLowerCase() !== "text") {
      continue;
    }
    const messageId = firstNonEmptyString(part?.messageID, part?.messageId);
    const text = firstNonEmptyString(part?.text, part?.content);
    const isUserOwnedTextPart = !!messageId && !assistantIds.has(messageId);
      
    // Strictly ONLY push if it is a user text part from the tape
    if (!messageId || !text || !isUserOwnedTextPart || knownIds.has(messageId)) {
      continue;
    }
    
    knownIds.add(messageId);

    const sourceMessage = sourceMessagesById.get(messageId);
    if (sourceMessage) {
      merged.push(sourceMessage);
      continue;
    }
    
    const eventTime =
      typeof properties?.time === "number"
        ? properties.time
        : typeof asRecord(part?.time)?.start === "number"
          ? (asRecord(part?.time)?.start as number)
          : undefined;
          
    merged.push({
      id: messageId,
      role: "user",
      content: text,
      text,
      info: {
        id: messageId,
        role: "user",
      },
      created: eventTime,
    } as Message);
  }

  // 3. Sort strictly by canonical creation time from the central tape
  return merged.sort((left, right) => {
    const leftCreated =
      typeof left.created === "number"
        ? left.created
        : typeof left.info?.created === "number"
          ? left.info.created
          : 0;
    const rightCreated =
      typeof right.created === "number"
        ? right.created
        : typeof right.info?.created === "number"
          ? right.info.created
          : 0;
    if (leftCreated !== rightCreated) {
      return leftCreated - rightCreated;
    }
    return 0;
  });
}

type ConversationRenderEntry =
  | {
      kind: "message";
      key: string;
      message: Message;
      messageIndex: number;
      order: number;
    }
  | {
      kind: "session.diff";
      key: string;
      diff: CentralizedSessionDiffEvent;
      order: number;
    };

function parseCentralizedSessionDiffEvent(
  payload: unknown,
  rawIndex: number,
): CentralizedSessionDiffEvent | null {
  const event = asRecord(payload);
  if (!event || firstNonEmptyString(event.type) !== "session.diff") {
    return null;
  }

  const properties = asRecord(event.properties);
  const rawDiffs = Array.isArray(properties?.diff)
    ? properties.diff
    : Array.isArray(event.diff)
      ? event.diff
      : [];
  const files = rawDiffs
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => !!item)
    .map((item) => ({
      file: firstNonEmptyString(item.file) ?? "",
      patch: firstNonEmptyString(item.patch),
      additions:
        typeof item.additions === "number"
          ? item.additions
          : typeof item.additions === "string"
            ? Number(item.additions)
            : undefined,
      deletions:
        typeof item.deletions === "number"
          ? item.deletions
          : typeof item.deletions === "string"
            ? Number(item.deletions)
            : undefined,
      status: firstNonEmptyString(item.status),
    }))
    .filter((item) => item.file.length > 0);

  if (files.length === 0) {
    return null;
  }

  const eventTime =
    typeof properties?.time === "number"
      ? properties.time
      : typeof event.time === "number"
        ? event.time
        : undefined;

  return {
    id: firstNonEmptyString(event.id),
    sessionId: firstNonEmptyString(properties?.sessionID, event.sessionId),
    createdAt: eventTime,
    files,
  };
}

function buildCentralizedConversationEntries(
  messages: Message[],
  rawSdkEventPayloads: unknown[],
): ConversationRenderEntry[] {
  const normalizedRawSdkEventPayloads = normalizeCentralizedEventPayloads(rawSdkEventPayloads);
  const renderMessages = buildCentralizedRenderMessages(messages, normalizedRawSdkEventPayloads);
  const messageById = new Map<string, Message>();
  const messageIndexById = new Map<string, number>();
  const emittedMessageIds = new Set<string>();
  const entries: ConversationRenderEntry[] = [];

  for (let index = 0; index < renderMessages.length; index += 1) {
    const message = renderMessages[index];
    const messageId = firstNonEmptyString(
      message.info?.id,
      message.id,
      message.messageId,
    );
    if (messageId && !messageById.has(messageId)) {
      messageById.set(messageId, message);
      messageIndexById.set(messageId, index);
    }
  }

  for (let rawIndex = 0; rawIndex < normalizedRawSdkEventPayloads.length; rawIndex += 1) {
    const event = asRecord(normalizedRawSdkEventPayloads[rawIndex]);
    if (!event) {
      continue;
    }

    const properties = asRecord(event.properties);
    const info = asRecord(properties?.info) ?? asRecord(event.info);
    const part = asRecord(properties?.part) ?? asRecord(event.part);
    const diff = parseCentralizedSessionDiffEvent(event, rawIndex);
    if (diff) {
      entries.push({
        kind: "session.diff",
        key: `session.diff:${diff.id ?? rawIndex}`,
        diff,
        order: rawIndex,
      });
      continue;
    }

    const messageId = firstNonEmptyString(
      info?.id,
      info?.messageID,
      info?.messageId,
      part?.messageID,
      part?.messageId,
    );
    if (!messageId || emittedMessageIds.has(messageId)) {
      continue;
    }

    const message = messageById.get(messageId);
    if (!message) {
      continue;
    }

    emittedMessageIds.add(messageId);
    entries.push({
      kind: "message",
      key: `message:${messageId}`,
      message,
      messageIndex: messageIndexById.get(messageId) ?? entries.length,
      order: rawIndex,
    });
  }

  for (let index = 0; index < renderMessages.length; index += 1) {
    const message = renderMessages[index];
    const messageId = firstNonEmptyString(
      message.info?.id,
      message.id,
      message.messageId,
    );
    if (!messageId || emittedMessageIds.has(messageId)) {
      continue;
    }
    emittedMessageIds.add(messageId);
    entries.push({
      kind: "message",
      key: `message:${messageId}`,
      message,
      messageIndex: index,
      order: Number.MAX_SAFE_INTEGER + index,
    });
  }

  return entries;
}

type StreamViewportState = {
  isFollowing: boolean;
  unseenUpdateCount: number;
};

const AUTO_FOLLOW_THRESHOLD_PX = 96;
const WEBVIEW_BOOTSTRAP_CACHE_KEY = "opencode.chat.bootstrap.v1";

function formatCompactionTime(at?: number): string | undefined {
  if (typeof at !== "number") {
    return undefined;
  }
  return new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function CompactionDivider({
  at,
  collapsed,
  hiddenMessageCount,
  onToggle,
}: {
  at?: number;
  collapsed?: boolean;
  hiddenMessageCount?: number;
  onToggle?: () => void;
}) {
  const compactedAt = formatCompactionTime(at);
  const isInteractive = typeof collapsed === "boolean" && typeof onToggle === "function";
  const summary =
    collapsed && typeof hiddenMessageCount === "number"
      ? `${hiddenMessageCount} compacted message${hiddenMessageCount === 1 ? "" : "s"} hidden`
      : "Compacted history";
  const meta = collapsed
    ? compactedAt
      ? `Compacted ${compactedAt}`
      : "Session archive"
    : compactedAt
      ? `Compacted ${compactedAt}`
      : "Archive boundary";
  const actionLabel = collapsed ? "Show history" : "Hide history";

  return (
    <div className="oc-compaction-divider-wrap -mx-4 py-2">
      <div className="oc-compaction-divider">
        <span className="oc-compaction-divider-line" />
        {isInteractive ? (
          <button
            type="button"
            onClick={onToggle}
            className="oc-compaction-divider-card oc-compaction-divider-card-button"
            aria-pressed={!collapsed}
            title={collapsed ? "Show compacted messages" : "Hide compacted messages"}
            data-collapsed={collapsed ? "true" : "false"}
          >
            <span className="oc-compaction-divider-icon" aria-hidden="true">
              <Archive className="h-3.5 w-3.5" />
            </span>
            <span className="oc-compaction-divider-copy">
              <span className="oc-compaction-divider-label">{summary}</span>
              <span className="oc-compaction-divider-meta">{meta}</span>
            </span>
            <span className="oc-compaction-divider-action">{actionLabel}</span>
          </button>
        ) : (
          <div className="oc-compaction-divider-card" aria-label={meta}>
            <span className="oc-compaction-divider-icon" aria-hidden="true">
              <Archive className="h-3.5 w-3.5" />
            </span>
            <span className="oc-compaction-divider-copy">
              <span className="oc-compaction-divider-label">{summary}</span>
              <span className="oc-compaction-divider-meta">{meta}</span>
            </span>
          </div>
        )}
        <span className="oc-compaction-divider-line" />
      </div>
    </div>
  );
}

function getToastSeverity(message: string): "warning" | "error" {
  const normalized = message.trim().toLowerCase();
  return normalized.includes("warning") ? "warning" : "error";
}

function SessionLoadingSpinner() {
  return (
    <div className="flex items-center justify-center gap-2">
      {/* Three dot loading animation */}
      <div className="flex gap-1.5">
        <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: '0s' }} />
        <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: '0.2s' }} />
        <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: '0.4s' }} />
      </div>
    </div>
  );
}

function ChatContent() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const stateRef = useRef(state);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const [streamViewport, setStreamViewport] = useState<StreamViewportState>({
    isFollowing: true,
    unseenUpdateCount: 0,
  });
  const [showSkillInstaller, setShowSkillInstaller] = useState(false);
  const [dismissedCompatibilityWarningSignature, setDismissedCompatibilityWarningSignature] =
    useState<string | null>(null);

  // Track loading state timing to ensure minimum display duration
  const loadingStartTimeRef = useRef<number | null>(null);
  const LOADING_MIN_DISPLAY_MS = 500; // Show loading state for at least 500ms so users can perceive it
  const streamViewportRef = useRef(streamViewport);
  const previousIsLoadingSessionRef = useRef(state.isLoadingSession);
  const previousReceivedInitStateRef = useRef(state.receivedInitState);
  const previousStreamingActiveRef = useRef(Boolean(state.streaming?.isActive));
  const didHydrateBootstrapRef = useRef(false);
  // Throttle "unseen updates" increments while the user is scrolled away from the
  // bottom. Stream events can arrive dozens of times per second, and incrementing
  // this counter for every tick causes avoidable React work during manual scrolling.
  const lastUnseenIncrementAtRef = useRef(0);
  // Throttle follow-mode scroll writes to roughly one frame (33ms ~= 30fps).
  // Writing scrollTop on every tiny stream mutation can fight user input and create
  // visible hitching. A small throttle preserves "stick to bottom" behavior without
  // overdriving layout/reflow during heavy token streams.
  const lastFollowAutoScrollAtRef = useRef(0);

  const resolveAgentColor = useCallback((agentId?: string) => {
    if (!agentId) return "var(--oc-accent)";

    const match = state.availableAgents.find(
      (agent) =>
        agent.id === agentId ||
        agent.name.toLowerCase() === agentId.toLowerCase(),
    );

    return match?.color ?? "var(--oc-accent)";
  }, [state.availableAgents]);

  // Keep ref current so message handler closure always reads latest state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  // Hydrate last known session/messages immediately on webview re-open so UI
  // does not flash a blank/loading screen while extension bootstrap completes.
  useEffect(() => {
    if (didHydrateBootstrapRef.current) {
      return;
    }
    didHydrateBootstrapRef.current = true;

    try {
      const raw = window.sessionStorage.getItem(WEBVIEW_BOOTSTRAP_CACHE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as {
        currentSessionId?: string;
        messagesBySessionId?: Record<string, Message[]>;
      };

      const sessionId =
        typeof parsed?.currentSessionId === "string" &&
        parsed.currentSessionId.trim().length > 0
          ? parsed.currentSessionId
          : null;
      const messagesBySessionId =
        parsed?.messagesBySessionId &&
        typeof parsed.messagesBySessionId === "object"
          ? parsed.messagesBySessionId
          : {};

      if (!sessionId) {
        return;
      }

      const cachedMessages = Array.isArray(messagesBySessionId[sessionId])
        ? messagesBySessionId[sessionId]
        : [];

      dispatch({ type: "SET_SESSION_ID", payload: sessionId });
      dispatch({
        type: "CACHE_SESSION_MESSAGES",
        payload: { sessionId, messages: cachedMessages },
      });
      if (cachedMessages.length > 0) {
        dispatch({ type: "HYDRATE_SESSION_FROM_CACHE", payload: { sessionId } });
      }
    } catch {
      // best-effort hydration only
    }
  }, [dispatch]);

  // Persist a lightweight session/message snapshot for fast restore across
  // sidebar/extension switches that recreate the webview.
  useEffect(() => {
    if (state.streaming?.isActive) {
      return;
    }
    try {
      const nextSnapshot = {
        currentSessionId: state.currentSessionId,
        messagesBySessionId: state.messagesBySessionId,
      };
      window.sessionStorage.setItem(
        WEBVIEW_BOOTSTRAP_CACHE_KEY,
        JSON.stringify(nextSnapshot),
      );
    } catch {
      // storage can fail in restricted webview scenarios; ignore gracefully
    }
  }, [state.currentSessionId, state.messagesBySessionId, state.streaming?.isActive]);

  useEffect(() => {
    streamViewportRef.current = streamViewport;
  }, [streamViewport]);

  useEffect(() => {
    const isStreamingNow = Boolean(state.streaming?.isActive);
    const justLoadedInitialChat =
      !previousReceivedInitStateRef.current && state.receivedInitState;
    const justFinishedSessionLoad =
      previousIsLoadingSessionRef.current && !state.isLoadingSession;
    const justFinishedAiResponse =
      previousStreamingActiveRef.current && !isStreamingNow;
    const shouldSnapToLatest =
      state.messages.length > 0 &&
      (justLoadedInitialChat || justFinishedSessionLoad);

    // Only auto-scroll after AI finishes if user is already near the bottom.
    const shouldFollowAfterResponse =
      justFinishedAiResponse && streamViewportRef.current.isFollowing;

    if (shouldSnapToLatest || shouldFollowAfterResponse) {
      setStreamViewport({ isFollowing: true, unseenUpdateCount: 0 });
      requestAnimationFrame(() => {
        const root = messagesScrollRef.current;
        if (root) {
          root.scrollTop = root.scrollHeight;
        }
      });
    } else if (justFinishedAiResponse) {
      setStreamViewport((prev) =>
        prev.unseenUpdateCount === 0
          ? prev
          : { ...prev, unseenUpdateCount: 0 },
      );
    }

    previousReceivedInitStateRef.current = state.receivedInitState;
    previousIsLoadingSessionRef.current = state.isLoadingSession;
    previousStreamingActiveRef.current = isStreamingNow;
  }, [
    state.isLoadingSession,
    state.messages.length,
    state.receivedInitState,
    state.streaming?.isActive,
  ]);

  // Register message listener
  useEffect(() => {
    const handler = createMessageHandler(dispatch, () => stateRef.current);
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [dispatch]);

  // Listen for skill installer messages
  useEffect(() => {
    const handleSkillMessages = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "showSkillInstaller") {
        setShowSkillInstaller(true);
      }
    };

    window.addEventListener("message", handleSkillMessages);
    return () => window.removeEventListener("message", handleSkillMessages);
  }, []);

  // Send ready + retry until initState received
  useEffect(() => {
    vscode.postMessage({ type: "ready" });
    const interval = setInterval(() => {
      if (!stateRef.current.receivedInitState) {
        vscode.postMessage({ type: "ready" });
      } else {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const root = messagesScrollRef.current;
    if (!root) return;

    let rafId: number | null = null;
    const updateViewportState = () => {
      rafId = null;
      const nearBottom =
        root.scrollHeight - root.scrollTop - root.clientHeight <=
        AUTO_FOLLOW_THRESHOLD_PX;
      setStreamViewport((prev) => {
        if (nearBottom) {
          if (prev.isFollowing && prev.unseenUpdateCount === 0) {
            return prev;
          }
          return { isFollowing: true, unseenUpdateCount: 0 };
        }
        if (!prev.isFollowing) {
          return prev;
        }
        return { ...prev, isFollowing: false };
      });
    };
    const onScroll = () => {
      if (rafId !== null) {
        return;
      }
      rafId = requestAnimationFrame(updateViewportState);
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);

  useEffect(() => {
    if (streamViewportRef.current.isFollowing) {
      const root = messagesScrollRef.current;
      if (root) {
        const now = Date.now();
        // Keep follow-mode pinned, but at a controlled cadence. This replaced a
        // MutationObserver-per-change strategy that was too eager during streaming.
        if (now - lastFollowAutoScrollAtRef.current >= 33) {
          root.scrollTop = root.scrollHeight;
          lastFollowAutoScrollAtRef.current = now;
        }
      }
      if (streamViewportRef.current.unseenUpdateCount > 0) {
        setStreamViewport((prev) =>
          prev.unseenUpdateCount === 0
            ? prev
            : { ...prev, unseenUpdateCount: 0 },
        );
      }
      return;
    }

    if (state.streaming?.isActive) {
      const now = Date.now();
      // When user is not following, we still surface activity via the "Jump to latest"
      // badge. Throttle count updates so the badge reflects progress without creating
      // a render storm on high-frequency stream bursts.
      if (now - lastUnseenIncrementAtRef.current < 120) {
        return;
      }
      lastUnseenIncrementAtRef.current = now;
      setStreamViewport((prev) => ({
        ...prev,
        unseenUpdateCount: Math.min(prev.unseenUpdateCount + 1, 999),
      }));
    }
  }, [state.messages, state.streaming]);

  // Safety net: Clear loading state if it takes too long (10 seconds)
  // Note: END_SESSION_LOADING is normally dispatched in messageHandler after chatHistory loads
  // This timeout only handles edge cases where loading state gets stuck
  useEffect(() => {
    if (!state.isLoadingSession) return;

    const timeoutId = setTimeout(() => {
      if (state.isLoadingSession) {
        dispatch({ type: "END_SESSION_LOADING" });
      }
    }, 10000); // 10 second timeout

    return () => clearTimeout(timeoutId);
  }, [state.isLoadingSession, dispatch]);

  // Check if AI is currently responding (processing user message)
  const isAiResponding = isProcessingInCurrentSession(
    state.isProcessing,
    state.currentSessionId,
    state.processingSessionIds,
  );
  const centralizedSessionRawSdkEventPayloads =
    state.currentSessionId &&
    Array.isArray(state.rawSdkEventPayloadsBySessionId?.[state.currentSessionId])
      ? state.rawSdkEventPayloadsBySessionId[state.currentSessionId]
      : [];
  const hasCompletedAssistantReply = hasCompletedAssistantReplyForLatestTurn(
    centralizedSessionRawSdkEventPayloads,
  );
  const isAiStillResponding = isAssistantRespondingInCurrentSession(
    state.isProcessing,
    state.currentSessionId,
    state.processingSessionIds,
    Boolean(state.streaming?.isActive),
    state.assistantTurnPending,
    hasCompletedAssistantReply,
  );

  // Check if we're switching to a different session (loading conversation)
  // Uses the new isLoadingSession state which is set during session switches
  // Note: We don't check if loadingSessionId === currentSessionId because during
  // the transition, currentSessionId hasn't been updated yet (timing issue)
  const isSwitchingSession = false;

  const hasCachedCurrentSessionMessages = Boolean(
    state.currentSessionId &&
      (state.messagesBySessionId?.[state.currentSessionId]?.length ?? 0) > 0,
  );
  const hasAnyRenderableConversation =
    state.messages.length > 0 || hasCachedCurrentSessionMessages;
  const isConnecting = false;

  const compatibilityWarningSignature = state.compatibilityWarnings
    .map((warning) => `${warning.component}:${warning.version ?? "unknown"}:${warning.status}:${warning.supportedRange}`)
    .join("|");
  useEffect(() => {
    if (!compatibilityWarningSignature) {
      setDismissedCompatibilityWarningSignature(null);
      return;
    }
    setDismissedCompatibilityWarningSignature((current) =>
      current === compatibilityWarningSignature ? current : null,
    );
  }, [compatibilityWarningSignature]);

  if (isConnecting) {
    return (
      <div className="oc-shell relative flex h-screen items-center justify-center overflow-hidden bg-oc-bg text-oc-text">
        <div className="flex flex-col items-center gap-4">
          <div className="flex gap-1.5">
            <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: '0s' }} />
            <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: '0.2s' }} />
            <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: '0.4s' }} />
          </div>
          <div className="text-sm text-oc-text-soft opacity-70 font-medium">
            Connecting…
          </div>
        </div>
      </div>
    );
  }

  // Keep the loading bubble visible for the entire active assistant turn.
  // Live stream payloads can arrive before the final assistant message is
  // finalized, but the user still needs a clear "AI is responding" signal.
  const hasAssistantText =
    !!state.streaming?.content &&
    state.streaming.content.trim().length > 0;
  const hasVisibleStreamingPayload = Boolean(
    state.streaming &&
      (state.streaming.content.trim().length > 0 ||
        state.streaming.reasoning.trim().length > 0 ||
        state.streaming.steps.length > 0 ||
        state.streaming.progressEvents.length > 0 ||
        state.streaming.edits.length > 0 ||
        (Array.isArray(state.streaming.interactiveEvents) &&
          state.streaming.interactiveEvents.length > 0) ||
        (Array.isArray(state.interactiveEvents) &&
          state.interactiveEvents.length > 0)),
  );
  // Show AI response loading indicator (thinking bubble) when:
  // 1. NOT switching sessions (session loading takes precedence), AND
  // 2. AI is still responding and the assistant turn has not finalized yet.
  // FIXED: Use hasRenderableContent from SDK instead of checking content length
  const hasRenderableStreamingContent = Boolean(state.streaming?.hasRenderableContent);
  const showAiResponseLoading =
    !state.isLoadingSession && // Direct state check to avoid timing issues
    isAiStillResponding && // Keep loading affordance visible while the turn is active
    !state.isCompacting;

  // Enforce minimum display duration for loading state
  // This ensures users can perceive the loading indicator even when content arrives quickly
  const now = Date.now();
  const loadingElapsedTime = loadingStartTimeRef.current ? now - loadingStartTimeRef.current : 0;

  if (showAiResponseLoading && !loadingStartTimeRef.current) {
    // Loading state just started - record the timestamp
    loadingStartTimeRef.current = now;
  } else if (!showAiResponseLoading && loadingStartTimeRef.current) {
    // Loading state ended - reset the timestamp
    loadingStartTimeRef.current = null;
  }

  // Extend the loading state display time if content arrived too quickly
  const showExtendedLoading =
    showAiResponseLoading || // Normal loading state
    (loadingStartTimeRef.current && loadingElapsedTime < LOADING_MIN_DISPLAY_MS && isAiStillResponding); // Extended for minimum duration

  useEffect(() => {
    if (!state.streaming && state.interactiveEvents.length === 0 && !showExtendedLoading) {
      return;
    }

    logger.info("[TRACE][RENDER][CHAT_SHELL]", {
      sessionId: state.currentSessionId,
      streamingActive: !!state.streaming?.isActive,
      streamingMessageId: state.streaming?.messageId ?? null,
      streamingContentLength: state.streaming?.content?.length ?? 0,
      streamingReasoningLength: state.streaming?.reasoning?.length ?? 0,
      streamingSteps: state.streaming?.steps?.length ?? 0,
      streamingProgressEvents: state.streaming?.progressEvents?.length ?? 0,
      streamingInteractiveEvents: state.streaming?.interactiveEvents?.length ?? 0,
      interactiveEvents: state.interactiveEvents.length,
      hasRenderableStreamingContent,
      hasVisibleStreamingPayload,
      showAiResponseLoading,
      showExtendedLoading,
    });
    console.info("[TRACE][RENDER][CHAT_SHELL]", {
      sessionId: state.currentSessionId,
      streamingActive: !!state.streaming?.isActive,
      streamingMessageId: state.streaming?.messageId ?? null,
      streamingContentLength: state.streaming?.content?.length ?? 0,
      streamingReasoningLength: state.streaming?.reasoning?.length ?? 0,
      streamingSteps: state.streaming?.steps?.length ?? 0,
      streamingProgressEvents: state.streaming?.progressEvents?.length ?? 0,
      streamingInteractiveEvents: state.streaming?.interactiveEvents?.length ?? 0,
      interactiveEvents: state.interactiveEvents.length,
      hasRenderableStreamingContent,
      hasVisibleStreamingPayload,
      showAiResponseLoading,
      showExtendedLoading,
    });
  }, [
    state.currentSessionId,
    state.streaming,
    state.interactiveEvents.length,
    hasRenderableStreamingContent,
    hasVisibleStreamingPayload,
    showAiResponseLoading,
    showExtendedLoading,
  ]);

  // DEBUG: Log loading state calculation
  if (state.isProcessing || state.streaming?.isActive || showExtendedLoading) {
    logger.info('[LOADING][RENDER] Loading state calculation', {
      isLoadingSession: state.isLoadingSession,
      isProcessing: state.isProcessing,
      currentSessionId: state.currentSessionId,
      processingSessionIds: state.processingSessionIds,
      isAiResponding,
      isCompacting: state.isCompacting,
      hasRenderableStreamingContent,
      hasAssistantText,
      streamingIsActive: state.streaming?.isActive,
      streamingContentLength: state.streaming?.content?.length || 0,
      streamingExists: !!state.streaming,
      streamingHasRenderableContent: state.streaming?.hasRenderableContent,
      showAiResponseLoading,
      showExtendedLoading,
      willShowThinkingBubble: showExtendedLoading,
      willShowStreamingCard: !!state.streaming && (hasRenderableStreamingContent || state.streaming?.isActive),
      loadingStartTime: loadingStartTimeRef.current,
      loadingElapsedTime,
      LOADING_MIN_DISPLAY_MS,
      sessionId: state.currentSessionId,
      timestamp: now,
      source: 'webview',
    });
  }

  const compactionDividerIndex =
    typeof state.compactionDividerIndex === "number"
      ? Math.max(
          0,
          Math.min(state.compactionDividerIndex, state.messages.length),
        )
      : undefined;
  const hasCompactedSegment =
    typeof compactionDividerIndex === "number" && compactionDividerIndex > 0;
  const isCompressed = hasCompactedSegment && state.compactedMessagesCollapsed;
  const hiddenMessageCount = isCompressed ? compactionDividerIndex : 0;
  const visibleStartIndex = isCompressed ? compactionDividerIndex : 0;
  const renderMessages = buildCentralizedRenderMessages(
    state.messages,
    centralizedSessionRawSdkEventPayloads,
  );
  const hasCentralizedSessionDiffEntries = centralizedSessionRawSdkEventPayloads.some(
    (payload) => {
      const event = asRecord(payload);
      return event && firstNonEmptyString(event.type) === "session.diff";
    },
  );
  const conversationEntries = buildCentralizedConversationEntries(
    state.messages,
    centralizedSessionRawSdkEventPayloads,
  );
  const visibleConversationEntries = (() => {
    let messageCount = 0;
    const visible: ConversationRenderEntry[] = [];

    for (const entry of conversationEntries) {
      if (!isCompressed || messageCount >= visibleStartIndex) {
        visible.push(entry);
      }
      if (entry.kind === "message") {
        messageCount += 1;
      }
    }

    return visible;
  })();
  const visibleMessages = visibleConversationEntries
    .filter((entry): entry is Extract<ConversationRenderEntry, { kind: "message" }> =>
      entry.kind === "message",
    )
    .map((entry) => entry.message);
  const hasCompatibilityWarnings = state.compatibilityWarnings.length > 0;
  const errorToasts = state.errorMessages;

  useEffect(() => {
    if (errorToasts.length > 0 && getGlobalShowBrowserConsole()) {
      console.log("ERROR_FLOW: Error messages in ChatShell", {
        timestamp: new Date().toISOString(),
        errorCount: errorToasts.length,
        errorMessages: errorToasts,
      });
    }
  }, [errorToasts]);

  const jumpToLatest = () => {
    setStreamViewport({ isFollowing: true, unseenUpdateCount: 0 });
    const root = messagesScrollRef.current;
    if (root) {
      root.scrollTop = root.scrollHeight;
    }
  };

  const getStableMessageKey = (msg: Message, absoluteIndex: number, role: string): string => {
    const infoId =
      typeof msg.info?.id === "string" && msg.info.id.trim().length > 0
        ? msg.info.id
        : null;
    if (infoId) {
      return infoId;
    }

    const topLevelId =
      typeof msg.id === "string" && msg.id.trim().length > 0 ? msg.id : null;
    if (topLevelId) {
      return topLevelId;
    }

    const createdAt =
      typeof msg.created === "number" && Number.isFinite(msg.created)
        ? msg.created
        : typeof msg.info?.created === "number" && Number.isFinite(msg.info.created)
          ? msg.info.created
          : null;

    return createdAt !== null
      ? `${role}:${createdAt}:${absoluteIndex}`
      : `${role}:idx:${absoluteIndex}`;
  };

  return (
    <div className="oc-shell relative flex h-screen overflow-hidden bg-oc-bg text-oc-text">
      {errorToasts.length > 0 ? (
        <div className="pointer-events-none absolute right-3 top-3 z-50 flex w-full max-w-sm flex-col gap-2.5">
          {errorToasts.map((message, index) => (
            (() => {
              const severity = getToastSeverity(message);
              const isWarning = severity === "warning";
              return (
                <div
                  key={`${index}:${message}`}
                  className={`pointer-events-auto overflow-hidden rounded-lg border shadow-[0_14px_36px_rgba(0,0,0,0.28)] backdrop-blur ${
                    isWarning
                      ? "border-yellow-500/40 bg-[rgba(64,44,18,0.92)]"
                      : "border-red-500/40 bg-[rgba(60,18,24,0.92)]"
                  }`}
                >
              <div className="flex items-start justify-between gap-2.5 px-3 py-2.5">
                <div className="min-w-0">
                  <div
                    className={`text-[10px] font-semibold uppercase tracking-[0.08em] ${
                      isWarning ? "text-yellow-300" : "text-red-300"
                    }`}
                  >
                    {isWarning ? "Warning" : "Error"}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-6 text-oc-text">
                    {message}
                  </div>
                </div>
                <button
                  type="button"
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-white/10 text-oc-text-soft transition-colors hover:bg-white/5 hover:text-oc-text"
                  aria-label="Dismiss error notification"
                  title="Dismiss error notification"
                  onClick={() =>
                    dispatch({ type: "REMOVE_ERROR_MESSAGE", payload: index })
                  }
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
                </div>
              );
            })()
          ))}
        </div>
      ) : null}

      {/* Raw centralized SDK toast events are rendered here so the UI stays driven by the same event tape. */}
      <CentralizedToastOverlay
        sessionId={state.currentSessionId}
        rawSdkEventPayloads={
          state.currentSessionId
            ? state.rawSdkEventPayloadsBySessionId?.[state.currentSessionId]
            : undefined
        }
      />

      {/* === LEFT: History sidebar overlay (hamburger-toggled, absolute positioned) === */}
      <HistorySidebar />

      {/* === MIDDLE: Main conversation column (flex-1, scrollable message list + input) === */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* FORBIDDEN TO REMOVE: StickyHeader (token/session stats) - core UX for token visibility */}
        <StickyHeader />

        {/* Mobile-only extended panel summary and collapsible details */}
        <MobileRightSummary />

        {/* Message list */}
        <div
          ref={messagesScrollRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-2.5"
          style={{ background: "var(--oc-chat-bg)" }}
        >
          {isSwitchingSession ? (
            <div className="flex h-full items-center justify-center">
              <SessionLoadingSpinner />
            </div>
          ) : (
            <>
              {hasCompatibilityWarnings &&
              dismissedCompatibilityWarningSignature !== compatibilityWarningSignature ? (
                <div className="mb-2.5 px-4">
                  <div className="rounded-xl border oc-warning-border oc-warning-bg p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-oc-yellow">
                        OpenCode compatibility warning
                      </div>
                      <button
                        type="button"
                        className="flex h-6 w-6 items-center justify-center rounded-md border border-oc-border-soft text-oc-text-soft transition-colors hover:bg-white/5 hover:text-oc-text"
                        aria-label="Dismiss compatibility warning"
                        title="Dismiss compatibility warning"
                        onClick={() =>
                          setDismissedCompatibilityWarningSignature(
                            compatibilityWarningSignature,
                          )
                        }
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="space-y-2 text-sm leading-relaxed text-oc-text-soft opacity-90">
                      {state.compatibilityWarnings.map((warning) => (
                        <div
                          key={`${warning.component}:${warning.version ?? "unknown"}:${warning.status}`}
                          className="rounded-lg border border-oc-border-soft bg-black/10 px-3 py-2"
                        >
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-oc-yellow">
                              {warning.component === "sdk"
                                ? "OpenCode SDK"
                                : "OpenCode TUI"}
                            </div>
                            <div className="rounded-full border border-oc-border-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-oc-text-soft">
                              {warning.status}
                            </div>
                          </div>
                          <div className="space-y-0.5 text-[13px] leading-relaxed">
                            <div>
                              Detected: {warning.version ?? "unknown"}
                            </div>
                            <div>
                              Supported: {warning.supportedRange}
                            </div>
                            <div className="text-oc-text-soft opacity-80">
                              {warning.message}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {state.messages.length === 0 &&
              !state.streaming &&
              !isAiResponding ? (
                <EmptyState
                  serverStatus={state.serverStatus}
                  receivedInitState={state.receivedInitState}
                  currentSessionId={state.currentSessionId}
                  messagesBySessionId={state.messagesBySessionId}
                />
              ) : null}

              {hasCompactedSegment && isCompressed ? (
                <CompactionDivider
                  at={state.lastCompactedAt}
                  collapsed={isCompressed}
                  hiddenMessageCount={hiddenMessageCount}
                  onToggle={() => {
                    const nextCollapsed = !state.compactedMessagesCollapsed;
                    dispatch({
                      type: "SET_COMPACTED_MESSAGES_COLLAPSED",
                      payload: nextCollapsed,
                    });
                    if (state.currentSessionId) {
                      vscode.postMessage({
                        type: "setCompactionViewState",
                        sessionId: state.currentSessionId,
                        collapsed: nextCollapsed,
                        compactionDividerIndex: state.compactionDividerIndex,
                        compactionDividerBeforeMessageId:
                          state.compactionDividerBeforeMessageId,
                        compactionDividerAfterMessageId:
                          state.compactionDividerAfterMessageId,
                        lastCompactedAt: state.lastCompactedAt,
                        baselineStats: state.compactionBaselineStats,
                      });
                    }
                  }}
                />
              ) : null}

          <CentralizedDebugPanel />

          {(() => {
            let messageCountSeen = 0;
            return visibleConversationEntries.map((entry) => {
              const dividerHere = !isCompressed && compactionDividerIndex === messageCountSeen;
              if (entry.kind === "message") {
                const msg = entry.message;
                const idx = entry.messageIndex;
                const role = msg.role ?? msg.info?.role ?? "user";
                const messageId = msg.info?.id ?? msg.id ?? msg.messageId ?? null;
                const prevIdx = idx - 1;
                const prevMsg =
                  prevIdx >= 0 ? renderMessages[prevIdx] : undefined;
                const isContiguous =
                  role === "assistant" &&
                  prevMsg?.role === "assistant" &&
                  (prevMsg.info?.agent === msg.info?.agent ||
                    (!prevMsg.info?.agent && !msg.info?.agent));

                let messageNode: JSX.Element | null;
                if (role === "user") {
                  messageNode = <UserMessage message={msg} />;
                } else if (role === "system") {
                  const systemAgentId =
                    msg.info?.agent ?? state.streaming?.agent ?? state.selectedAgent;

                  messageNode = (
                    <SystemMessage
                      content={msg.content ?? msg.text ?? ""}
                      accentColor={resolveAgentColor(systemAgentId)}
                    />
                  );
                } else if ((msg as Record<string, unknown>).type === "permission") {
                  messageNode = <PermissionCard perm={msg} />;
                } else {
                  messageNode = (
                  <AssistantResponseCard
                    message={msg}
                    isContiguous={isContiguous}
                    interactiveEvents={state.interactiveEvents}
                    messages={state.messages}
                    currentSessionId={state.currentSessionId}
                    hideFileChangesSection={hasCentralizedSessionDiffEntries}
                    subagentsByParentMessageId={state.subagentsByParentMessageId}
                    subagentDetailsById={state.subagentDetailsById}
                    availableAgents={state.availableAgents}
                      todoItems={state.todoItems}
                    />
                  );
                }

                messageCountSeen += 1;

                return (
                  <Fragment key={entry.key}>
                    {dividerHere ? <CompactionDivider at={state.lastCompactedAt} /> : null}
                    {messageNode}
                  </Fragment>
                );
              }

              return (
                <Fragment key={entry.key}>
                  {dividerHere ? <CompactionDivider at={state.lastCompactedAt} /> : null}
                  <FileChangesSection
                    structuredFileChanges={[]}
                    centralizedDiffEvent={entry.diff}
                    sessionId={state.currentSessionId}
                  />
                </Fragment>
              );
            });
          })()}

          {!isCompressed && compactionDividerIndex === state.messages.length ? (
            <CompactionDivider at={state.lastCompactedAt} />
          ) : null}

          {/* Live streaming activity card (thinking/progress/subagents) */}
          <StreamingCard
            streaming={state.streaming}
            isContiguous={
              visibleMessages.length > 0 &&
              visibleMessages[visibleMessages.length - 1].role === "assistant"
            }
            interactiveEvents={state.interactiveEvents}
            messages={state.messages}
            assistantTurnMessageId={state.assistantTurnMessageId}
            currentSessionId={state.currentSessionId}
            subagentsByParentMessageId={state.subagentsByParentMessageId}
            subagentDetailsById={state.subagentDetailsById}
            availableAgents={state.availableAgents}
            todoItems={state.todoItems}
          />

          {/* Loading status while processing before first stream payload */}
          {showExtendedLoading ? (
            <ThinkingBubble />
          ) : null}

          {state.isCompacting ? (
            <div className="sticky bottom-3 z-20 mb-2 flex justify-center px-4 pointer-events-none">
              <div className="rounded-full border border-oc-accent bg-oc-panel px-3 py-1 text-[11px] font-medium text-oc-accent shadow-sm">
                Compacting conversation...
              </div>
            </div>
          ) : null}

          {!streamViewport.isFollowing &&
          streamViewport.unseenUpdateCount > 0 ? (
            <div className="sticky bottom-3 z-20 flex justify-end pr-4">
              <button
                type="button"
                onClick={jumpToLatest}
                className="oc-accent-soft-action rounded-md px-2.5 py-1.5 text-[11px] font-semibold shadow-sm transition-colors"
              >
                Jump to latest ({streamViewport.unseenUpdateCount})
              </button>
            </div>
          ) : null}

          <div ref={messagesEndRef} />
        </>
          )}
        </div>

        {/* Input area (queue panel is embedded inside InputWrapper) */}
        {!isSwitchingSession && <InputWrapper />}
      </div>

      {/* === RIGHT: Extended panel — desktop only (>= 1100px), contains stats/quota/tasks === */}
      <aside className="oc-right-panel hidden w-[368px] shrink-0 overflow-y-auto self-stretch border-l border-oc-border bg-oc-panel [@media(min-width:1100px)]:block">
        <ActiveTaskPanel />
        <QuotaMonitor />
        {/* TEMPORARY: Hidden during modularization; keep TodoPanel implementation intact for later re-enable. */}
        {false && <TodoPanel />}
        <McpPanel />
        <LspPanel />
        <SkillsPanel />
        <AgentsPanel />
        <SettingsPanel />
      </aside>

      {/* Skill Installer Modal */}
      <SkillInstallerModal
        isOpen={showSkillInstaller}
        onClose={() => setShowSkillInstaller(false)}
      />

      {/* Session Modal */}
      {state.isSessionModalOpen ? (
        <SessionModal
          isOpen={state.isSessionModalOpen}
          onClose={() => dispatch({ type: "SET_SESSION_MODAL_OPEN", payload: false })}
        />
      ) : null}

    </div>
  );
}

export default function ChatShell() {
  return (
    <AppProvider>
      <ChatContent />
      <style>{`
        .file-mention-chip {
          color: #60a5fa;
          font-weight: 700;
          cursor: pointer;
          text-decoration: underline;
          text-decoration-style: solid;
          text-decoration-color: #60a5fa;
          text-underline-offset: 2px;
          transition: all 0.2s ease;
        }

        .file-mention-chip:hover {
          color: #93c5fd;
          text-decoration-color: #93c5fd;
        }

        .file-mention-chip:active {
          color: #3b82f6;
        }
      `}</style>
    </AppProvider>
  );
}
