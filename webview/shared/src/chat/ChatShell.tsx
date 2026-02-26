import { useEffect, useRef } from 'react';

import { AppProvider, useAppDispatch, useAppState } from './lib/store';
import { createMessageHandler } from './lib/messageHandler';
import vscode from './lib/vscode';

import { StickyHeader, HistorySidebar, InputWrapper, QueueContainer, ActiveTaskPanel, QuotaMonitor } from './PanelComponents';
import { StreamingCard } from './StreamingComponents';
import { AssistantMessage, EmptyState, ErrorBanner, PermissionCard, ThinkingBubble, UserMessage } from './MessageComponents';
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

  // Auto-scroll to bottom on new messages / streaming updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  });

  const showThinking = state.isProcessing && !state.streaming;

  return (
    <div className="oc-shell relative flex h-screen overflow-hidden bg-[var(--oc-bg)] text-[var(--oc-text)]">
      {/* History sidebar (absolute overlay) */}
      <HistorySidebar />

      {/* Main column */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Sticky header — session id + history button */}
        <StickyHeader />

        {/* Message list */}
        <div className="flex-1 min-h-0 overflow-y-auto py-4">
          {state.messages.length === 0 && !state.streaming && !state.isProcessing ? (
            <EmptyState />
          ) : null}

          {state.errorMessages.map((msg) => (
            <ErrorBanner key={`err-${msg}`} message={msg} />
          ))}

          {state.messages.map((msg: Message) => {
            const role = msg.role ?? (msg.parts ? 'assistant' : 'user');
            const key =
              msg.info?.id ??
              `${role}-${(msg.content ?? msg.text ?? '').slice(0, 32)}-${msg.parts?.length ?? 0}-${msg.steps?.length ?? 0}`;
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

        {/* Queue panel (shows when open) */}
        <QueueContainer />

        {/* Input area */}
        <InputWrapper />
      </div>

      {/* Right panel — token stats */}
      <aside className="oc-right-panel hidden w-[320px] shrink-0 overflow-y-auto self-stretch border-l border-[var(--oc-border)] bg-[var(--oc-panel)] [@media(min-width:1100px)]:block">
        <ActiveTaskPanel />
        <QuotaMonitor />
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
