import { Fragment, useEffect, useRef, useState } from "react";

import { AppProvider, useAppDispatch, useAppState } from "./lib/store";
import { createMessageHandler } from "./lib/messageHandler";
import vscode from "./lib/vscode";

import {
  StickyHeader,
  HistorySidebar,
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
import { QuotaPopover } from "./QuotaPopover";
import { StreamingCard } from "./StreamingComponents";
import {
  AssistantMessage,
  EmptyState,
  PermissionCard,
  SystemMessage,
  ThinkingBubble,
  UserMessage,
} from "./MessageComponents";
import { SkillInstallerModal } from "./SkillInstallerModal";
import { SessionModal } from "./components/SessionModal";
import type { Message } from "./lib/types";

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

function CompactionDivider({ at }: { at?: number }) {
  const compactedAt = formatCompactionTime(at);
  return (
    <div className="oc-compaction-divider-wrap -mx-4 py-2">
      <div className="oc-compaction-divider">
        <span className="oc-compaction-divider-line" />
        <div className="oc-compaction-divider-pill">
          <span className="oc-compaction-divider-dot" />
          <span className="oc-compaction-divider-label">
            {compactedAt ? `Compacted at ${compactedAt}` : "Compacted"}
          </span>
        </div>
        <span className="oc-compaction-divider-line" />
      </div>
    </div>
  );
}

function CompactedMessagesToggle({
  collapsed,
  hiddenMessageCount,
  at,
  onToggle,
}: {
  collapsed: boolean;
  hiddenMessageCount: number;
  at?: number;
  onToggle: () => void;
}) {
  const compactedAt = formatCompactionTime(at);
  const summary = collapsed
    ? `${hiddenMessageCount} compacted message${hiddenMessageCount === 1 ? "" : "s"} hidden`
    : "Compacted history expanded";
  const actionLabel = collapsed ? "Show history" : "Collapse history";

  return (
    <div className="oc-compaction-toggle-wrap -mx-4 py-2">
      <button
        type="button"
        onClick={onToggle}
        className="oc-compaction-toggle"
        title={collapsed ? "Show compacted messages" : "Hide compacted messages"}
      >
        <span className="oc-compaction-toggle-summary">{summary}</span>
        <span className="oc-compaction-toggle-meta">
          {compactedAt ? `Compacted ${compactedAt}` : "Session archive"}
        </span>
        <span className="oc-compaction-toggle-action">{actionLabel}</span>
      </button>
    </div>
  );
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

  const resolveAgentColor = (agentId?: string) => {
    if (!agentId) return "var(--oc-accent)";

    const match = state.availableAgents.find(
      (agent) =>
        agent.id === agentId ||
        agent.name.toLowerCase() === agentId.toLowerCase(),
    );

    return match?.color ?? "var(--oc-accent)";
  };

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
  }, [state.currentSessionId, state.messagesBySessionId]);

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
  const isAiResponding =
    state.isProcessing &&
    (!state.currentSessionId ||
      state.processingSessionIds.includes(state.currentSessionId));

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

  // Show AI response loading indicator until assistant text arrives. Activity
  // streams can render tool/progress rows before text starts, so the response
  // loading affordance should key off text presence instead of stream presence.
  const hasAssistantText =
    !!state.streaming?.content &&
    state.streaming.content.trim().length > 0;

  // Show AI response loading indicator (thinking bubble) when:
  // 1. NOT switching sessions (session loading takes precedence), AND
  // 2. AI is responding but no assistant text has arrived yet.
  const showAiResponseLoading =
    !state.isLoadingSession && // Direct state check to avoid timing issues
    isAiResponding && // Must still be processing (not stopped)
    !state.isCompacting &&
    !state.streaming?.isActive &&
    !hasAssistantText;

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
  const visibleMessages = state.messages.slice(visibleStartIndex);

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
      {/* === LEFT: History sidebar overlay (hamburger-toggled, absolute positioned) === */}
      <HistorySidebar />

      {/* === MIDDLE: Main conversation column (flex-1, scrollable message list + input) === */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* FORBIDDEN TO REMOVE: StickyHeader (token/session stats) - core UX for token visibility */}
        <StickyHeader />

        {/* Message list */}
        <div
          ref={messagesScrollRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-4"
          style={{ background: "var(--oc-chat-bg)" }}
        >
          {isSwitchingSession ? (
            <div className="flex h-full items-center justify-center">
              <SessionLoadingSpinner />
            </div>
          ) : (
            <>
              {state.messages.length === 0 &&
              !state.streaming &&
              !isAiResponding ? (
                <EmptyState />
              ) : null}

              {hasCompactedSegment ? (
                <CompactedMessagesToggle
                  collapsed={isCompressed}
                  hiddenMessageCount={hiddenMessageCount}
                  at={state.lastCompactedAt}
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

          {visibleMessages.map((msg: Message, visibleIdx: number) => {
            const idx = visibleStartIndex + visibleIdx;
            const role = msg.role ?? msg.info?.role ?? "user";
            const key = getStableMessageKey(msg, idx, role);

            const prevIdx = idx - 1;
            const prevMsg =
              prevIdx >= visibleStartIndex
                ? state.messages[prevIdx]
                : undefined;
            const isContiguous =
              role === "assistant" &&
              prevMsg?.role === "assistant" &&
              (prevMsg.info?.agent === msg.info?.agent ||
                (!prevMsg.info?.agent && !msg.info?.agent));

            let messageNode: JSX.Element;
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
                <AssistantMessage message={msg} isContiguous={isContiguous} />
              );
            }

            return (
              <Fragment key={key}>
                {!isCompressed && compactionDividerIndex === idx ? (
                  <CompactionDivider at={state.lastCompactedAt} />
                ) : null}
                {messageNode}
              </Fragment>
            );
          })}

          {!isCompressed && compactionDividerIndex === state.messages.length ? (
            <CompactionDivider at={state.lastCompactedAt} />
          ) : null}

          {/* Live streaming activity card (thinking/progress/subagents) */}
          <StreamingCard
            isContiguous={
              visibleMessages.length > 0 &&
              visibleMessages[visibleMessages.length - 1].role === "assistant"
            }
          />

          {/* Loading status while processing before first stream payload */}
          {showAiResponseLoading ? (
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
        {/* TEMPORARY: Hidden during modularization; keep SettingsPanel implementation intact for later re-enable. */}
        {false && <SettingsPanel />}
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

      {/* Quota Popover */}
      <QuotaPopover />
    </div>
  );
}

export default function ChatShell() {
  return (
    <AppProvider>
      <ChatContent />
    </AppProvider>
  );
}

