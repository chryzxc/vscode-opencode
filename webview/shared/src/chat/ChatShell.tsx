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
  MobileRightSummary,
  SettingsPanel,
} from "./PanelComponents";
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
import type { Message } from "./lib/types";

type StreamViewportState = {
  isFollowing: boolean;
  unseenUpdateCount: number;
};

const AUTO_FOLLOW_THRESHOLD_PX = 96;

function CompactionDivider({ at }: { at?: number }) {
  const label =
    typeof at === "number"
      ? `Compacted at ${new Date(at).toLocaleTimeString()}`
      : "Compacted";

  return (
    <div className="-mx-4 py-2">
      <div className="flex w-full items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-oc-text-muted">
        <span className="h-px flex-1 bg-current opacity-50" />
        <span className="shrink-0 text-center opacity-80">{label}</span>
        <span className="h-px flex-1 bg-current opacity-50" />
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

  // Keep ref current so message handler closure always reads latest state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    streamViewportRef.current = streamViewport;
  }, [streamViewport]);

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

    const onScroll = () => {
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

    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (streamViewportRef.current.isFollowing) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
      setStreamViewport((prev) => ({
        ...prev,
        unseenUpdateCount: prev.unseenUpdateCount + 1,
      }));
    }
  }, [
    state.messages.length,
    state.streaming?.messageId,
    state.streaming?.content,
    state.streaming?.reasoning,
    state.streaming?.steps.length,
    state.streaming?.edits.length,
    state.streaming?.isActive,
  ]);

  const isProcessingInCurrentSession =
    state.isProcessing &&
    (!state.currentSessionId ||
      state.processingSessionIds.length === 0 ||
      state.processingSessionIds.includes(state.currentSessionId));

  const showThinking =
    isProcessingInCurrentSession && !state.streaming && !state.isCompacting;
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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
        <div className="block [@media(min-width:1100px)]:hidden">
          <MobileRightSummary />
        </div>
        <div
          ref={messagesScrollRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-4"
          style={{ background: "var(--oc-chat-bg)" }}
        >
          {state.messages.length === 0 &&
          !state.streaming &&
          !isProcessingInCurrentSession ? (
            <EmptyState />
          ) : null}

          {hasCompactedSegment ? (
            <div className="-mx-4 py-2">
              <div className="flex w-full items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-oc-text-muted">
                <span className="h-px flex-1 bg-current opacity-50" />
                <button
                  type="button"
                  onClick={() => {
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
                  className="shrink-0 px-1 py-0 text-[10px] font-mono uppercase tracking-wider text-oc-text-muted opacity-80 hover:opacity-100 hover:underline transition-colors"
                  title={
                    isCompressed
                      ? "Show compacted messages"
                      : "Hide compacted messages"
                  }
                >
                  {isCompressed
                    ? `Compacted messages (${hiddenMessageCount} hidden)`
                    : "Compacted messages (expanded)"}
                </button>
                <span className="h-px flex-1 bg-current opacity-50" />
              </div>
            </div>
          ) : null}

          {visibleMessages.map((msg: Message, visibleIdx: number) => {
            const idx = visibleStartIndex + visibleIdx;
            const role = msg.role ?? msg.info?.role ?? "user";
            const key =
              msg.info?.id ??
              `${idx}-${role}-${(msg.content ?? msg.text ?? "").slice(0, 32)}-${
                msg.parts?.length ?? 0
              }-${msg.steps?.length ?? 0}`;

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
            } else if (role === "system" || msg.responseType === "system") {
              messageNode = (
                <SystemMessage content={msg.content ?? msg.text ?? ""} />
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
          {showThinking ? <ThinkingBubble /> : null}

          {state.isCompacting ? (
            <div className="sticky bottom-3 z-20 mb-2 flex justify-center px-4 pointer-events-none">
              <div className="rounded-full border border-oc-accent bg-oc-panel px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-oc-accent shadow-sm">
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
                className="rounded-md border border-oc-border bg-oc-panel px-2.5 py-1.5 text-[11px] font-mono text-oc-accent shadow-sm hover:bg-oc-panel-soft"
              >
                Jump to latest ({streamViewport.unseenUpdateCount})
              </button>
            </div>
          ) : null}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area (queue panel is embedded inside InputWrapper) */}
        <InputWrapper />
      </div>

      {/* === RIGHT: Extended panel — desktop only (>= 1100px), contains stats/quota/tasks === */}
      <aside className="oc-right-panel hidden w-[368px] shrink-0 overflow-y-auto self-stretch border-l border-oc-border bg-oc-panel [@media(min-width:1100px)]:block">
        <ActiveTaskPanel />
        <QuotaMonitor />
        <TodoPanel />
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
