import { useEffect, useRef } from 'react';

import { AppProvider, useAppDispatch, useAppState } from './lib/store';
import { createMessageHandler } from './lib/messageHandler';
import vscode from './lib/vscode';

import {
  StickyHeader,
  HistorySidebar,
  InputWrapper,
  ActiveTaskPanel,
  SubagentsPanel,
  QuotaMonitor,
  TodoPanel,
  McpPanel,
  LspPanel,
  MobileRightSummary,
} from './PanelComponents';
import { StreamingCard } from './StreamingComponents';
import {
  AssistantMessage,
  EmptyState,
  ErrorBanner,
  PermissionCard,
  ThinkingBubble,
  UserMessage,
} from './MessageComponents';
import type { Message } from './lib/types';

function ChatContent() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const stateRef = useRef(state);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Keep ref current so message handler closure always reads latest state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Register message listener
  useEffect(() => {
    const handler = createMessageHandler(dispatch, () => stateRef.current);
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [dispatch]);

  // Send ready + retry until initState received
  useEffect(() => {
    vscode.postMessage({ type: 'ready' });
    const interval = setInterval(() => {
      if (!stateRef.current.receivedInitState) {
        vscode.postMessage({ type: 'ready' });
      } else {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll only when conversation content changes (not on every render).
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [
    state.messages.length,
    state.streaming?.messageId,
    state.streaming?.content,
    state.streaming?.reasoning,
    state.streaming?.steps.length,
    state.streaming?.edits.length,
    state.streaming?.isActive,
  ]);

  const showThinking = state.isProcessing && !state.streaming;

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
        <div className="flex-1 min-h-0 overflow-y-auto py-4">
          {state.messages.length === 0 &&
          !state.streaming &&
          !state.isProcessing ? (
            <EmptyState />
          ) : null}

          {state.errorMessages.map((msg) => (
            <ErrorBanner key={`err-${msg}`} message={msg} />
          ))}

          {state.messages.map((msg: Message) => {
            const role = msg.role ?? msg.info?.role ?? 'user';
            const key =
              msg.info?.id ??
              `${role}-${(msg.content ?? msg.text ?? '').slice(0, 32)}-${
                msg.parts?.length ?? 0
              }-${msg.steps?.length ?? 0}`;
            if (role === 'user') {
              return <UserMessage key={key} message={msg} />;
            }
            if ((msg as Record<string, unknown>).type === 'permission') {
              return <PermissionCard key={key} perm={msg} />;
            }
            return <AssistantMessage key={key} message={msg} />;
          })}

          {/* Live streaming card */}
          <StreamingCard />

          {/* "Thinking…" dots when waiting for first streaming event */}
          {showThinking ? <ThinkingBubble /> : null}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area (queue panel is embedded inside InputWrapper) */}
        <InputWrapper />
      </div>

      {/* === RIGHT: Extended panel — desktop only (>= 1100px), contains stats/quota/tasks === */}
      <aside className="oc-right-panel hidden w-[368px] shrink-0 overflow-y-auto self-stretch border-l border-oc-border bg-oc-panel [@media(min-width:1100px)]:block">
        <ActiveTaskPanel />
        <SubagentsPanel />
        <QuotaMonitor />
        <TodoPanel />
        <McpPanel />
        <LspPanel />
      </aside>
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
