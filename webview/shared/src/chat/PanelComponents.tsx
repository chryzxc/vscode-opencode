import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Copy,
  ChevronDown,
  ChevronUp,
  History,
  Play,
  RefreshCw,
  Send,
  Square,
  Trash2,
  X,
  Zap
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

import { useAppDispatch, useAppState } from './lib/store';
import vscode from './lib/vscode';
import { jumpToMessage } from './lib/messageJump';
import type { SubagentDetail, SubagentSummary, ThinkingLevel } from './lib/types';

function totalTokens(input: number, output: number, read: number, write: number): number {
  return input + output + read + write;
}

function formatDurationMs(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    return 'n/a';
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}

function subagentStatusClass(status: SubagentSummary['status']): string {
  if (status === 'done') return 'text-oc-green';
  if (status === 'error') return 'text-oc-red';
  if (status === 'running') return 'text-oc-accent';
  if (status === 'orphaned') return 'text-oc-yellow';
  return 'text-oc-text-muted';
}

export function StickyHeader() {
  const { currentSessionId, isSidebarOpen, sessionStats, isProcessing, streaming, promptQueue } = useAppState();
  const dispatch = useAppDispatch();

  const sessionLabel = currentSessionId ? currentSessionId.slice(0, 8) : 'new';
  const taskName = isProcessing || streaming ? 'Active request' : 'No active task';
  const taskStatus = isProcessing || streaming ? 'RUNNING' : promptQueue.length > 0 ? 'PENDING' : 'IDLE';
  const durationLabel = sessionStats.duration >= 1000
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
          onClick={() => dispatch({ type: 'SET_SIDEBAR_OPEN', payload: !isSidebarOpen })}
        >
          <History className="h-3.5 w-3.5" />
        </Button>
          <div className="flex items-center gap-1.5">
          <div className="oc-agent-icon">
            <Zap className="h-2.5 w-2.5" />
          </div>
          <span className="oc-title">OpenCode</span>
        </div>
        <span className="oc-session-chip">ses_{sessionLabel}</span>
      </div>

      {/* Token stats center - FORBIDDEN TO REMOVE */}
      <div className="oc-header-center items-center gap-3 font-mono text-oc-xs opacity-60">
        <div className="flex items-center gap-1.5">
          <span className="opacity-70 text-oc-2xs uppercase tracking-wider">Tokens</span>
          <span className="font-semibold tabular-nums text-oc-text-soft">
            {((sessionStats.input + sessionStats.output) || 0).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-1 text-oc-2xs opacity-80">
          <span className="text-oc-text-soft">{sessionStats.input}i</span>
          <span className="opacity-30">·</span>
          <span className="text-oc-text-soft">{sessionStats.output}o</span>
          {sessionStats.read > 0 && (
            <>
              <span className="opacity-30">·</span>
              <span className="text-oc-text-soft">{sessionStats.read}r</span>
            </>
          )}
          {sessionStats.write > 0 && (
            <>
              <span className="opacity-30">·</span>
              <span className="text-oc-text-soft">{sessionStats.write}w</span>
            </>
          )}
        </div>
      </div>

      <div className="oc-header-right ml-auto flex items-center gap-1.5">
        <span className="oc-task-pill">TASK</span>
        <span className="oc-task-name text-oc-xs text-oc-text-soft opacity-80">{taskName}</span>
        <span className={`oc-status-pill ${taskStatus === 'IDLE' ? 'idle' : taskStatus === 'PENDING' ? 'pending' : 'running'}`}>
          {taskStatus}
        </span>
        <span className="oc-duration text-oc-text-soft opacity-70">{durationLabel}</span>
      </div>
    </div>
  );
}

export function HistorySidebar() {
  const { isSidebarOpen, sessionsList, currentSessionId } = useAppState();
  const dispatch = useAppDispatch();

  function relativeSessionTime(ts: number | undefined): string {
    if (!ts) return '';
    const now = Date.now();
    const diff = now - ts;
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diff < minute) return 'Just now';
    if (diff < hour) {
      const mins = Math.round(diff / minute);
      return `${mins} min${mins === 1 ? '' : 's'} ago`;
    }
    if (diff < day) {
      const hrs = Math.round(diff / hour);
      return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    }
    if (diff < 7 * day) {
      const days = Math.round(diff / day);
      return days === 1 ? 'Yesterday' : `${days} days ago`;
    }

    const d = new Date(ts);
    return d.toLocaleDateString();
  }

  return (
    <aside
      className={`oc-history-sidebar absolute bottom-0 left-0 top-0 z-20 w-72 border-r border-oc-border bg-oc-bg-soft transition-transform duration-200 ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex items-center justify-between border-b border-oc-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <History className="h-3.5 w-3.5 text-oc-text-muted" />
          <div className="text-xs font-semibold uppercase tracking-widest text-oc-text-muted">Sessions</div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-md"
          aria-label="Close history sidebar"
          onClick={() => dispatch({ type: 'SET_SIDEBAR_OPEN', payload: false })}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="border-b border-oc-border px-2.5 py-2.5">
        <Button
          variant="ghost-accent"
          size="sm"
          onClick={() => vscode.postMessage({ type: 'createSession' })}
        >
          <span className="text-sm">+</span> New Chat
        </Button>
      </div>
      <div className="h-[calc(100%-88px)] overflow-y-auto p-2">
        {sessionsList.length === 0 ? (
          <div className="p-4 text-center text-xs text-oc-text-muted opacity-70">
            No sessions yet.<br />Start a new chat to get going.
          </div>
        ) : (
          sessionsList.map((session) => {
            const isActive = session.id === currentSessionId;
            return (
              <div key={session.id} className="group mb-1 flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => vscode.postMessage({ type: 'switchSession', sessionId: session.id })}
                  className={
                    `oc-session-item flex-1 min-w-0 overflow-hidden rounded-md px-2.5 py-2 text-left text-xs ` +
                    (isActive
                      ? 'bg-oc-accent-soft border oc-accent-border-light'
                      : 'border border-transparent')
                  }
                >
                  <div className="flex items-center gap-2">
                    {isActive
                      ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-oc-accent" />
                      : <span className="inline-block h-1.5 w-1.5 rounded-full bg-oc-border-soft" />
                    }
                    <div className={`truncate font-medium ${isActive ? 'text-oc-text' : 'text-oc-text-soft'}`}>
                      {session.title || 'Untitled chat'}
                    </div>
                  </div>
                  <div className="truncate text-oc-text-muted text-oc-2xs pl-3.5 mt-0.5">
                    {session.createdAt ? relativeSessionTime(session.createdAt) : 'Unknown'}
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete session"
                  className="oc-session-delete h-6 w-6 shrink-0 rounded-md opacity-70 group-hover:opacity-100"
                  aria-label={`Delete session ${session.title ?? session.id}`}
                  onClick={() => vscode.postMessage({ type: 'deleteSession', sessionId: session.id })}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            );
          })
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
          className={`inline-block h-1.5 w-1.5 rounded-full transition-colors ${open ? 'bg-oc-accent' : 'bg-oc-border-soft'}`}
        />
        <span className={`font-mono text-oc-2xs uppercase tracking-widest font-semibold ${open ? 'text-oc-text-soft' : 'text-oc-text-soft opacity-70'}`}>{title}</span>
        <span className={`ml-auto transition-transform ${open ? 'rotate-0' : '-rotate-90'}`}>
          <ChevronDown className="h-3 w-3 text-oc-text-soft opacity-70" />
        </span>
      </Button>
      {open && <div className="bg-oc-bg-soft px-2.5 pb-2.5 pt-1.5">{children}</div>}
    </div>
  );
}

// tiny hook so we don't need useState import twice
function useMiniSectionState(def: boolean) {
  return useState(def);
}

// ─── ActiveTaskPanel ──────────────────────────────────────────────────────────
export function ActiveTaskPanel() {
  const { sessionStats, streaming, messages, currentSessionId } = useAppState();

  const total = totalTokens(
    sessionStats.input,
    sessionStats.output,
    sessionStats.read,
    sessionStats.write
  );
  const maxContext = 200_000; // placeholder; no dynamic limit exposed yet
  const pct = total > 0 ? Math.min(100, Math.round((total / maxContext) * 100)) : 0;

  // Session info
  const messageCount = messages.length;
  const isActive = !!(streaming?.isActive);

  const durationLabel = sessionStats.duration >= 1000
    ? `${(sessionStats.duration / 1000).toFixed(1)}s`
    : `${Math.round(sessionStats.duration)}ms`;

  return (
    <div className="oc-active-task-panel flex flex-col w-full bg-oc-bg-soft">
      {/* Panel title */}
      <div className="border-b border-oc-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-oc-accent animate-pulse' : 'bg-oc-border-soft'}`} />
          <div className="oc-panel-title">Active Task</div>
        </div>
      </div>

      <div className="p-2">
        <MiniSection title="Context">
          {/* Token usage bar */}
          <div className="mb-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-oc-xs text-oc-text-soft">Tokens used</span>
              <span className="font-mono tabular-nums text-oc-xs text-oc-text-soft">
                {total.toLocaleString()} / {maxContext.toLocaleString()}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-oc-border">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${pct}%`,
                  background: pct > 80
                    ? 'linear-gradient(90deg, #f0883e, #f85149)'
                    : pct > 50
                      ? 'linear-gradient(90deg, #d29922, #f0883e)'
                      : 'linear-gradient(90deg, #1f6feb, #58a6ff)'
                }}
              />
            </div>
          </div>
          {/* 2-col token grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-oc-xs">
            <div className="flex items-center justify-between">
              <span className="text-oc-text-soft opacity-80">In</span>
              <span className="font-mono tabular-nums text-oc-text-soft">{sessionStats.input.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--oc-text-soft)] opacity-80">Out</span>
              <span className="font-mono tabular-nums text-[var(--oc-text-soft)]">{sessionStats.output.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--oc-text-soft)] opacity-80">Cache R</span>
              <span className="font-mono tabular-nums text-[var(--oc-text-soft)]">{sessionStats.read.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--oc-text-soft)] opacity-80">Cache W</span>
              <span className="font-mono tabular-nums text-[var(--oc-text-soft)]">{sessionStats.write.toLocaleString()}</span>
            </div>
          </div>
        </MiniSection>

        <MiniSection title="Session">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-oc-xs">
            <div className="flex items-center justify-between col-span-2">
              <span className="text-oc-text-soft opacity-80">ID</span>
              <span className="font-mono text-oc-2xs text-oc-text-soft opacity-70">
                {currentSessionId ? currentSessionId.slice(0, 16) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--oc-text-soft)] opacity-80">Messages</span>
              <span className="font-mono tabular-nums text-[var(--oc-text-soft)]">{messageCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[var(--oc-text-soft)] opacity-80">Duration</span>
              <span className={`font-mono tabular-nums ${isActive ? 'text-oc-accent' : 'text-oc-text-soft'}`}>{durationLabel}</span>
            </div>
            <div className="flex items-center justify-between col-span-2">
              <span className="text-[var(--oc-text-soft)] opacity-80">Status</span>
              <span className={`font-mono text-oc-2xs uppercase tracking-wider font-semibold ${isActive ? 'text-oc-accent' : 'text-oc-text-soft opacity-70'}`}>
                {isActive ? 'ACTIVE' : 'IDLE'}
              </span>
            </div>
          </div>
        </MiniSection>
      </div>
    </div>
  );
}

export function SubagentsPanel() {
  const {
    subagentsByParentMessageId,
    subagentDetailsById,
    selectedSubagentId,
    subagentsPanelOpen
  } = useAppState();
  const dispatch = useAppDispatch();

  const grouped = useMemo(() => {
    const entries = Object.entries(subagentsByParentMessageId)
      .filter(([, items]) => Array.isArray(items) && items.length > 0)
      .map(([parentMessageId, items]) => {
        const sorted = [...items].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
        const latest = sorted[0];
        return {
          parentMessageId,
          latestAt: latest?.startedAt ?? latest?.endedAt ?? 0,
          items: sorted
        };
      })
      .sort((a, b) => b.latestAt - a.latestAt);
    return entries;
  }, [subagentsByParentMessageId]);

  const selectedDetail = selectedSubagentId ? subagentDetailsById[selectedSubagentId] : null;

  if (grouped.length === 0 && !selectedDetail) {
    return null;
  }

  const selectSubagent = (subagentId: string) => {
    dispatch({ type: 'SELECT_SUBAGENT', payload: subagentId });
    dispatch({ type: 'SET_SUBAGENTS_PANEL_OPEN', payload: true });
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
          ref.callID ? `callID=${ref.callID}` : null
        ].filter(Boolean);
        return parts.length > 0 ? `ref${index + 1}: ${parts.join(' ')}` : null;
      })
    ]
      .filter((item): item is string => !!item)
      .join('\n');

    await navigator.clipboard.writeText(refs);
  };

  return (
    <div className="oc-subagents-panel border-t border-oc-border p-3 text-xs">
        <div className="mb-2 flex items-center justify-between">
          <div className="oc-panel-title">Subagents</div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={subagentsPanelOpen ? 'Collapse subagents panel' : 'Expand subagents panel'}
            onClick={() => dispatch({ type: 'SET_SUBAGENTS_PANEL_OPEN', payload: !subagentsPanelOpen })}
            className="flex items-center gap-1 text-oc-2xs text-oc-text-muted hover:text-oc-accent transition-colors"
          >
            {subagentsPanelOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          </Button>
        </div>

      {subagentsPanelOpen ? (
        <div className="space-y-2">
          {grouped.map((group) => (
            <div key={group.parentMessageId} className="rounded-md border border-oc-border bg-oc-panel-soft p-2">
              <button
                type="button"
                className="mb-2 text-oc-2xs font-mono text-oc-text-muted hover:text-oc-accent"
                onClick={() => jumpToMessage(group.parentMessageId)}
              >
                parent: {group.parentMessageId}
              </button>
              <div className="space-y-1.5">
                {group.items.map((subagent) => (
                  <button
                    key={subagent.id}
                    type="button"
                    className={`w-full rounded-md border px-2 py-1.5 text-left text-oc-xs transition-colors ${
                      selectedSubagentId === subagent.id
                        ? 'border-oc-accent bg-oc-accent-soft'
                        : 'border-oc-border hover:bg-oc-accent-soft'
                    }`}
                    onClick={() => selectSubagent(subagent.id)}
                  >
                    <div className="mb-0.5 flex items-center justify-between gap-2">
                      <span className={`font-mono uppercase tracking-wider ${subagentStatusClass(subagent.status)}`}>
                        {subagent.status}
                      </span>
                      <span className="font-mono text-oc-2xs text-oc-text-muted">{formatDurationMs(subagent.durationMs)}</span>
                    </div>
                    <div className="truncate text-[var(--oc-text-soft)]">
                      {subagent.agentId || 'subagent'} {subagent.providerID && subagent.modelID ? `- ${subagent.providerID}/${subagent.modelID}` : ''}
                    </div>
                    <div className="truncate text-[10px] text-[var(--oc-text-muted)]">{subagent.latestActivity}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {selectedDetail ? (
            <div className="rounded-md border border-oc-border bg-oc-panel p-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-oc-xs font-semibold text-oc-text-soft">
                  {selectedDetail.agentId || 'subagent'}
                </div>
                <span className={`font-mono text-oc-2xs uppercase ${subagentStatusClass(selectedDetail.status)}`}>
                  {selectedDetail.status}
                </span>
              </div>
              <div className="space-y-1 text-oc-2xs text-oc-text-muted">
                <div>model: {selectedDetail.providerID && selectedDetail.modelID ? `${selectedDetail.providerID}/${selectedDetail.modelID}` : 'n/a'}</div>
                <div>duration: {formatDurationMs(selectedDetail.durationMs)}</div>
                <div>child session: {selectedDetail.childSessionId || 'n/a'}</div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="text-oc-2xs font-mono text-oc-accent hover:underline"
                  onClick={() => jumpToMessage(selectedDetail.parentMessageId)}
                >
                  Jump to parent message
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-oc-2xs font-mono text-oc-text-muted hover:text-oc-accent"
                  onClick={() => copyRefs(selectedDetail)}
                >
                  <Copy className="h-3 w-3" />
                  Copy refs
                </button>
              </div>

              {selectedDetail.thinkingEvents.length > 0 ? (
                <details className="mt-2" open={false}>
                  <summary className="cursor-pointer text-oc-2xs font-mono text-oc-text-muted">
                    Thinking ({selectedDetail.thinkingEvents.length})
                  </summary>
                  <div className="mt-1 space-y-1">
                    {selectedDetail.thinkingEvents.map((event) => (
                      <div key={event.id} className="rounded border border-oc-border bg-oc-panel-soft px-2 py-1 text-oc-2xs text-oc-text-muted">
                        {event.text}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}

              {selectedDetail.progressEvents.length > 0 ? (
                <details className="mt-2" open={false}>
                  <summary className="cursor-pointer text-oc-2xs font-mono text-oc-text-muted">
                    Progress ({selectedDetail.progressEvents.length})
                  </summary>
                  <div className="mt-1 space-y-1">
                    {selectedDetail.progressEvents.map((event) => (
                      <div key={event.id} className="rounded border border-oc-border bg-oc-panel-soft px-2 py-1 text-oc-2xs">
                        <div className="text-oc-text-soft">{event.title}</div>
                        {event.meta ? <div className="text-oc-text-muted">{event.meta}</div> : null}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}

              {selectedDetail.timelineEvents.length > 0 ? (
                <details className="mt-2" open={true}>
                  <summary className="cursor-pointer text-oc-2xs font-mono text-oc-text-muted">
                    Timeline ({selectedDetail.timelineEvents.length})
                  </summary>
                  <div className="mt-1 max-h-44 space-y-1 overflow-y-auto pr-1">
                    {selectedDetail.timelineEvents.map((event) => (
                      <div key={event.key} className="rounded border border-oc-border bg-oc-panel-soft px-2 py-1 text-oc-2xs">
                        <div className="text-oc-text-soft">{event.label}</div>
                        <div className="font-mono text-oc-text-muted">
                          {new Date(event.createdAt).toLocaleTimeString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function MobileRightSummary() {
  const { sessionStats, isProcessing } = useAppState();

  return (
    <div className="block [@media(min-width:1100px)]:hidden border-b border-oc-border bg-oc-bg-soft px-3 py-1.5 text-xs text-oc-text">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-mono text-oc-xs">
          <span className="text-oc-text-muted">In</span>
          <span className="tabular-nums text-oc-text-soft">{sessionStats.input.toLocaleString()}</span>
          <span className="opacity-30">/</span>
          <span className="text-[var(--oc-text-muted)]">Out</span>
          <span className="tabular-nums text-[var(--oc-text-soft)]">{sessionStats.output.toLocaleString()}</span>
        </div>

        <div className="flex items-center">
          {isProcessing ? (
            <span className="rounded-md bg-oc-accent-soft px-2 py-0.5 text-oc-xs font-medium text-oc-accent font-mono tracking-wider">
              PROCESSING
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ModelDropdown() {
  const { availableModels, selectedModel, modelSearchQuery, modelDropdownOpen } = useAppState();
  const dispatch = useAppDispatch();
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        dispatch({ type: 'SET_MODEL_DROPDOWN_OPEN', payload: false });
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelDropdownOpen, dispatch]);

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof availableModels>();
    const query = modelSearchQuery.toLowerCase();
    availableModels
      .filter((model) => `${model.providerID} ${model.name} ${model.modelID}`.toLowerCase().includes(query))
      .forEach((model) => {
        const key = model.providerName ?? model.providerID;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)?.push(model);
      });
    return groups;
  }, [availableModels, modelSearchQuery]);

  const label = selectedModel ? `${selectedModel.providerID}/${selectedModel.modelID}` : 'Model';

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="chip"
        size="chip"
        onClick={() => dispatch({ type: 'SET_MODEL_DROPDOWN_OPEN', payload: !modelDropdownOpen })}
        aria-expanded={modelDropdownOpen}
        aria-label="Choose model"
      >
        <span className="truncate max-w-[140px]">{label}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${modelDropdownOpen ? 'rotate-180' : ''}`} />
      </Button>
      {modelDropdownOpen && (
        <div className="oc-popover absolute bottom-full left-0 z-30 mb-1.5 w-72 rounded-xl border border-oc-border bg-oc-panel shadow-xl overflow-hidden">
          <div className="px-3 pt-3 pb-2">
            <input
              autoFocus
              value={modelSearchQuery}
              onChange={(e) => dispatch({ type: 'SET_MODEL_SEARCH', payload: e.target.value })}
              placeholder="Search models..."
              className="oc-popover-search w-full rounded-lg border border-oc-border bg-oc-bg-soft px-3 py-1.5 text-oc-sm font-mono outline-none focus:border-oc-accent transition-colors"
            />
          </div>
          <div className="max-h-56 overflow-y-auto px-1.5 pb-1.5">
            {[...grouped.entries()].map(([provider, models]) => (
              <div key={provider} className="mb-1">
                <div className="px-2.5 py-1 text-oc-2xs font-semibold uppercase tracking-widest text-oc-text-muted opacity-60">{provider}</div>
                {models.map((model) => {
                  const isCurrent = selectedModel?.providerID === model.providerID && selectedModel?.modelID === model.modelID;
                  return (
                    <button
                      key={`${model.providerID}-${model.modelID}`}
                      type="button"
                      className={`oc-popover-item w-full rounded-lg px-2.5 py-2 text-left transition-colors ${isCurrent ? 'bg-oc-accent-soft text-oc-accent' : 'hover:bg-oc-panel-soft'}`}
                      onClick={() => {
                        dispatch({ type: 'SET_SELECTED_MODEL', payload: { providerID: model.providerID, modelID: model.modelID } });
                        dispatch({ type: 'SET_MODEL_DROPDOWN_OPEN', payload: false });
                        vscode.postMessage({ type: 'selectModel', model: { providerID: model.providerID, modelID: model.modelID, providerName: model.providerName } });
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-oc-sm font-medium truncate">{model.name}</span>
                        {isCurrent && <span className="text-oc-2xs font-mono uppercase tracking-wider text-oc-accent shrink-0">active</span>}
                      </div>
                      <div className="text-oc-2xs font-mono text-oc-text-muted truncate mt-0.5">{model.modelID}</div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentDropdown() {
  const { availableAgents, selectedAgent, agentSearchQuery, agentDropdownOpen } = useAppState();
  const dispatch = useAppDispatch();
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!agentDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        dispatch({ type: 'SET_AGENT_DROPDOWN_OPEN', payload: false });
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [agentDropdownOpen, dispatch]);

  const filtered = useMemo(
    () => availableAgents.filter((agent) =>
      `${agent.name} ${agent.id} ${agent.description}`.toLowerCase().includes(agentSearchQuery.toLowerCase())
    ),
    [agentSearchQuery, availableAgents]
  );

  const label = selectedAgent || 'Agent';

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="chip"
        size="chip"
        onClick={() => dispatch({ type: 'SET_AGENT_DROPDOWN_OPEN', payload: !agentDropdownOpen })}
        aria-label="Choose agent"
      >
        <span className="truncate max-w-[120px]">{label}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${agentDropdownOpen ? 'rotate-180' : ''}`} />
      </Button>
      {agentDropdownOpen && (
        <div className="oc-popover absolute bottom-full left-0 z-30 mb-1.5 w-64 rounded-xl border border-oc-border bg-oc-panel shadow-xl overflow-hidden">
          <div className="px-3 pt-3 pb-2">
            <input
              autoFocus
              value={agentSearchQuery}
              onChange={(e) => dispatch({ type: 'SET_AGENT_SEARCH', payload: e.target.value })}
              placeholder="Search agents..."
              className="oc-popover-search w-full rounded-lg border border-oc-border bg-oc-bg-soft px-3 py-1.5 text-oc-sm font-mono outline-none focus:border-oc-accent transition-colors"
            />
          </div>
          <div className="max-h-52 overflow-y-auto px-1.5 pb-1.5">
            {filtered.map((agent) => (
              <button
                key={agent.id}
                type="button"
                      className={`oc-popover-item w-full rounded-lg px-2.5 py-2 text-left transition-colors ${selectedAgent === agent.id ? 'bg-oc-accent-soft text-oc-accent' : 'hover:bg-oc-panel-soft'}`}
                onClick={() => {
                  dispatch({ type: 'SET_SELECTED_AGENT', payload: agent.id });
                  dispatch({ type: 'SET_AGENT_DROPDOWN_OPEN', payload: false });
                  vscode.postMessage({ type: 'selectAgent', agent: agent.id });
                }}
              >
                <div className="text-oc-sm font-medium">{agent.name}</div>
                <div className="text-oc-2xs font-mono text-oc-text-muted truncate mt-0.5">{agent.description}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function QueueContainer() {
  const { promptQueue, isQueueOpen, isExecutingQueue } = useAppState();
  const dispatch = useAppDispatch();

  if (!isQueueOpen) {
    return null;
  }

  return (
    <div className="oc-queue border-t border-[var(--oc-border)] p-2.5">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--oc-text-muted)] font-mono">
        <span>Queue</span>
        {promptQueue.length > 0 && (
          <span className="rounded-full bg-[var(--oc-accent-soft)] px-1.5 py-0.5 text-[10px] text-[var(--oc-accent)]">
            {promptQueue.length}
          </span>
        )}
      </div>
      <div className="mb-2 max-h-32 space-y-1 overflow-y-auto">
        {promptQueue.map((item, index) => (
          <div key={`${item.text}-${index}`} className="rounded-md border border-[var(--oc-border)] bg-[rgba(0,0,0,0.15)] px-2.5 py-1.5">
            <div className="line-clamp-2 text-xs font-mono text-[var(--oc-text-soft)]">{item.text || '(empty)'}</div>
            <button
              type="button"
              className="mt-1 text-[11px] text-[var(--oc-red)] hover:underline"
              onClick={() => {
                const next = promptQueue.filter((_, i) => i !== index);
                dispatch({ type: 'SET_QUEUE', payload: next });
                vscode.postMessage({ type: 'removeFromQueue', index });
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button
          className="oc-queue-btn"
          variant="secondary"
          size="sm"
          disabled={promptQueue.length === 0 || isExecutingQueue}
          onClick={() => vscode.postMessage({ type: 'executeQueue' })}
        >
          <Play className="mr-1 h-3.5 w-3.5" /> Execute
        </Button>
        <Button
          className="oc-queue-btn"
          variant="ghost"
          size="sm"
          disabled={promptQueue.length === 0}
          onClick={() => {
            dispatch({ type: 'SET_QUEUE', payload: [] });
            vscode.postMessage({ type: 'clearQueue' });
          }}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" /> Clear
        </Button>
      </div>
    </div>
  );
}

export function InputWrapper() {
  const {
    inputValue,
    isProcessing,
    currentSessionId,
    messages,
    promptQueue,
    selectedFiles,
    selectedContexts,
    selectedAgent,
    showFileSuggestions,
    fileSuggestions,
    selectedSuggestionIndex,
    attachments = []
  } = useAppState();
  const dispatch = useAppDispatch();

  const sendPrompt = () => {
    const text = inputValue.trim();
    if (!text) return;
    if (isProcessing) {
      vscode.postMessage({
        type: 'addToQueue',
        text,
        files: selectedFiles,
        contexts: selectedContexts,
        agent: selectedAgent || null,
        images: attachments || []
      });
      dispatch({ type: 'SET_QUEUE_OPEN', payload: true });
      dispatch({ type: 'SET_INPUT_VALUE', payload: '' });
      return;
    }
    vscode.postMessage({
      type: 'sendMessage',
      text,
      files: selectedFiles,
      contexts: selectedContexts,
      agent: selectedAgent || null,
      images: attachments || []
    });
    dispatch({
      type: 'SET_MESSAGES',
      payload: [
        ...messages,
        {
          role: 'user',
          content: text,
          parts: [{ type: 'text', text }],
          images: (attachments || []).map((a) => a.dataUrl)
        }
      ]
    });
    dispatch({ type: 'SET_PROCESSING', payload: true });
    dispatch({ type: 'SET_INPUT_VALUE', payload: '' });
    dispatch({ type: 'CLEAR_ATTACHMENTS' });
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.type.startsWith('image/')) continue;
      const blob = item.getAsFile();
      if (!blob) continue;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const dataUrl = reader.result as string;
          const ext = blob.type.split('/')[1] ?? 'png';
          const filename = (blob as any).name ?? `pasted-${Date.now()}.${ext}`;
          dispatch({ type: 'ADD_ATTACHMENT', payload: { id: crypto.randomUUID(), dataUrl, filename, mimeType: blob.type } });
        } catch (err) { /* ignore */ }
      };
      reader.readAsDataURL(blob);
    }
  };

  const stopRequest = () => vscode.postMessage({ type: 'stopRequest', sessionId: currentSessionId });

  return (
    <div className="oc-input-area">
      {/* Context chips */}
      {(selectedFiles.length > 0 || selectedContexts.length > 0) && (
        <div className="oc-context-chips">
          {selectedFiles.map((file) => (
            <span key={file} className="oc-chip">{file}</span>
          ))}
          {selectedContexts.map((context) => (
            <span key={`${context.file}:${context.lineInfo}`} className="oc-chip">
              {context.file} {context.lineInfo}
            </span>
          ))}
        </div>
      )}

      {/* Attachment chips */}
      {attachments && attachments.length > 0 && (
        <div className="oc-context-chips">
          {attachments.map((a) => (
            <div key={a.id} className="oc-chip oc-chip-removable">
              <span className="truncate max-w-[140px]">{a.filename}</span>
              <button
                type="button"
                className="oc-chip-remove"
                onClick={() => dispatch({ type: 'REMOVE_ATTACHMENT', payload: a.id })}
                title={`Remove ${a.filename}`}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {/* Main input box */}
      <div className="oc-input-box">
        <Textarea
          value={inputValue}
          placeholder="Ask anything (Enter to send, Shift+Enter for newline), @ to mention, / for commands"
          className="oc-textarea"
          onChange={(e) => dispatch({ type: 'SET_INPUT_VALUE', payload: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendPrompt();
            }
          }}
          onPaste={handlePaste}
        />

        {/* File suggestions */}
        {showFileSuggestions && fileSuggestions.length > 0 && (
          <div className="oc-suggestions">
            {fileSuggestions.map((suggestion, index) => (
              <button
                key={suggestion.path}
                type="button"
                className={`oc-suggestion-item ${index === selectedSuggestionIndex ? 'active' : ''}`}
                onClick={() => {
                  dispatch({ type: 'SET_SELECTED_FILES', payload: [...selectedFiles, suggestion.path] });
                  dispatch({ type: 'SET_SHOW_FILE_SUGGESTIONS', payload: false });
                }}
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
            <Button
              variant="queue"
              size="chip"
              onClick={() => dispatch({ type: 'SET_QUEUE_OPEN', payload: true })}
              title="Open queue"
            >
              {promptQueue.length > 0 && (
                <span className="oc-queue-badge">{promptQueue.length}</span>
              )}
              Queue
            </Button>
            {isProcessing && (
              <Button
                variant="stop"
                size="chip"
                onClick={stopRequest}
              >
                <Square className="h-3 w-3" />
                Stop
              </Button>
            )}
            <Button
              variant="send"
              size="chip"
              onClick={sendPrompt}
            >
              {isProcessing
                ? <AlertCircle className="h-3.5 w-3.5" />
                : <Send className="h-3.5 w-3.5" />
              }
              {isProcessing ? 'Queue' : 'Send'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ThinkingLevelControl() {
  const { thinkingLevel, thinkingDropdownOpen } = useAppState();
  const dispatch = useAppDispatch();
  const containerRef = useRef<HTMLDivElement>(null);

  const setLevel = (level: ThinkingLevel) => {
    dispatch({ type: 'SET_THINKING_LEVEL', payload: level });
    dispatch({ type: 'SET_THINKING_DROPDOWN_OPEN', payload: false });
    try {
      vscode.postMessage({ type: 'setThinkingLevel', level });
    } catch (e) {}
  };

  // Close on outside click
  useEffect(() => {
    if (!thinkingDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        dispatch({ type: 'SET_THINKING_DROPDOWN_OPEN', payload: false });
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [thinkingDropdownOpen, dispatch]);

  const levelLabels: Record<ThinkingLevel, string> = { high: 'High', medium: 'Med', low: 'Low' };

  return (
    <div className="relative" ref={containerRef}>
      <Button
        type="button"
        variant="chip"
        size="chip"
        onClick={() => dispatch({ type: 'SET_THINKING_DROPDOWN_OPEN', payload: !thinkingDropdownOpen })}
        aria-label="Set thinking level"
      >
        <span>Think: {levelLabels[thinkingLevel ?? 'medium']}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${thinkingDropdownOpen ? 'rotate-180' : ''}`} />
      </Button>
      {thinkingDropdownOpen && (
        <div className="oc-popover absolute bottom-full left-0 z-30 mb-1.5 w-44 rounded-xl border border-[var(--oc-border)] bg-[var(--oc-panel)] shadow-xl overflow-hidden">
          <div className="px-1.5 py-1.5">
            {(['high', 'medium', 'low'] as ThinkingLevel[]).map((level) => (
              <button
                key={level}
                type="button"
                className={`oc-popover-item w-full rounded-lg px-3 py-2 text-left transition-colors ${thinkingLevel === level ? 'bg-[var(--oc-accent-soft)] text-[var(--oc-accent)]' : 'hover:bg-[var(--oc-panel-soft)]'}`}
                onClick={() => setLevel(level)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium capitalize">{level}</span>
                  {thinkingLevel === level && <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--oc-accent)]">active</span>}
                </div>
                <div className="text-[10px] font-mono text-[var(--oc-text-muted)] mt-0.5">
                  {level === 'high' ? 'Deep reasoning' : level === 'medium' ? 'Balanced' : 'Fast response'}
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
  const { quotaData, quotaIsRefreshing } = useAppState();
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(true);

  const handleRefresh = () => {
    dispatch({ type: 'SET_QUOTA_REFRESHING', payload: true });
    vscode.postMessage({ type: 'refreshQuota' });
  };

  const lastUpdatedLabel = quotaData
    ? new Date(quotaData.lastUpdated).toLocaleTimeString()
    : null;

  const toProviderName = (platform: string, title?: string) => {
    if (title && title.includes('Account Quota')) {
      return title;
    }
    const key = platform.toLowerCase();
    if (key.includes('openai')) return 'OpenAI Account Quota';
    if (key.includes('zai')) return 'Z.ai Account Quota';
    if (key.includes('zhipu')) return 'Zhipu AI Account Quota';
    if (key.includes('copilot')) return 'GitHub Copilot Account Quota';
    return title ?? `${platform} Account Quota`;
  };

  const barColor = (pct: number) => {
    if (pct >= 50) return 'linear-gradient(90deg, #2ea043, #3fb950)';
    if (pct >= 20) return 'linear-gradient(90deg, #bf8700, #d29922)';
    return 'linear-gradient(90deg, #da3633, #f85149)';
  };

  return (
    <div className="oc-quota-monitor border-t border-[var(--oc-border)] text-xs">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="oc-panel-title">Quota Monitor</div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost-accent"
            size="sm"
            className="h-7 px-2 text-oc-xs font-mono"
            title="Refresh quota"
            disabled={quotaIsRefreshing}
            onClick={handleRefresh}
          >
            <RefreshCw className={`mr-1 h-3 w-3 ${quotaIsRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            type="button"
            aria-label={open ? 'Collapse Quota Monitor' : 'Expand Quota Monitor'}
            onClick={() => setOpen((v) => !v)}
            variant="ghost"
            size="icon"
            className="flex items-center gap-1 text-oc-xs text-oc-text-soft opacity-80 hover:text-oc-accent transition-colors p-1"
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="p-3">
          {!quotaData && !quotaIsRefreshing ? (
            <div className="py-4 text-center text-[var(--oc-text-soft)] opacity-60 text-[11px]">No quota data</div>
          ) : null}

      {quotaIsRefreshing && !quotaData ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-[var(--oc-border)] opacity-40" />
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
              <div key={`${platform.platform}-${platform.account}`} className="overflow-hidden rounded-xl border border-[var(--oc-border)] bg-[linear-gradient(180deg,var(--oc-panel)_0%,var(--oc-panel-soft)_100%)] shadow-[0_6px_20px_rgba(0,0,0,0.2)]">
              <div className="border-b border-[var(--oc-border)] px-3 py-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold tracking-tight text-[var(--oc-text-soft)]">{toProviderName(platform.platform, platform.title)}</span>
                  {platform.status === 'error' ? (
                    <Badge variant="destructive" className="text-oc-2xs uppercase">error</Badge>
                  ) : platform.status === 'warning' ? (
                    <Badge variant="warning" className="text-oc-2xs uppercase">warning</Badge>
                  ) : null}
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-x-2 text-[10px]">
                  <span className="font-mono uppercase tracking-wider text-[var(--oc-text-soft)] opacity-80">Account:</span>
                  <span className="truncate font-mono text-[var(--oc-text-soft)]">{platform.account} {platform.accountLabel ?? ''}</span>
                </div>
              </div>

              <div className="space-y-2.5 px-3 py-2.5">
                {platform.error ? (
                  <div className="rounded-md border border-oc-red/40 bg-oc-red/10 px-2.5 py-2 text-oc-red">
                    {platform.error.length > 130 ? `${platform.error.slice(0, 127)}...` : platform.error}
                  </div>
                ) : null}

                {platform.quotas.map((quota) => {
                  const pct = Math.max(0, Math.min(100, quota.remainPercent));

                  return (
                    <div key={quota.label} className="rounded-lg border border-[var(--oc-border)] bg-[rgba(0,0,0,0.16)] p-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-[var(--oc-text-soft)]">{quota.label}</span>
                        <span className="font-mono text-[10px] text-[var(--oc-text-soft)]">{quota.percentLabel ?? `${Math.round(pct)}% remaining`}</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--oc-border)]">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{ width: `${pct}%`, background: barColor(pct) }}
                        />
                      </div>

                      <div className="mt-1.5 space-y-0.5 text-[10px] text-[var(--oc-text-soft)] opacity-70">
                        {quota.usedTotalDisplay ? (
                          <div className="flex items-center justify-between gap-2">
                            <span>Used</span>
                            <span className="font-mono text-[var(--oc-text-soft)]">{quota.usedTotalDisplay}</span>
                          </div>
                        ) : null}
                        {quota.resetLabel ? (
                          <div className="flex items-center justify-between gap-2">
                            <span>Resets in</span>
                            <span className="font-mono text-[var(--oc-text-soft)]">{quota.resetLabel}</span>
                          </div>
                        ) : null}
                        {quota.note ? (
                          <div className="flex gap-2 mt-1.5 pt-1.5 border-t border-[var(--oc-border)] opacity-80">
                            <span className="text-[var(--oc-text-soft)] italic">{quota.note}</span>
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
            <div className="text-center text-[10px] text-[var(--oc-text-soft)] opacity-50 font-mono">Updated: {lastUpdatedLabel}</div>
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
      case 'pending':
        return '⏳';
      case 'in_progress':
        return '🔄';
      case 'completed':
        return '✅';
      case 'failed':
      case 'cancelled':
        return '❌';
      default:
        return '•';
    }
  };

  return (
    <div className="oc-todo-panel border-t border-[var(--oc-border)] p-3 text-xs">
        <div className="mb-2 flex items-center justify-between">
        <div className="oc-panel-title">TODOs</div>
        <Button
          type="button"
          aria-label={open ? 'Collapse TODOs' : 'Expand TODOs'}
          onClick={() => setOpen((v) => !v)}
          variant="ghost"
          size="icon"
          className="flex items-center gap-1 text-oc-xs text-oc-text-soft hover:text-oc-accent transition-colors"
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </Button>
      </div>

      {open ? (
        <div>
          {!todoItems || todoItems.length === 0 ? (
            <div className="py-3 text-center text-[var(--oc-text-soft)] opacity-60 text-[11px]">No tasks yet</div>
          ) : (
            <div className="space-y-1.5">
              {todoItems.map((t) => (
                <div key={t.id} className="flex items-start gap-2 rounded-md border border-[var(--oc-border)] bg-[var(--oc-panel-soft)] p-2">
                  <div className="text-[14px] leading-none mt-0.5">{statusIcon(t.status)}</div>
                  <div className="text-[11px] text-[var(--oc-text-soft)] leading-relaxed">{(t as any).description ?? t.text ?? 'Untitled'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// McpPanel - displays MCP (Model Context Protocol) server status
export function McpPanel() {
  const [open, setOpen] = useState(true);

  // Placeholder MCP servers data - this would come from the backend in production
  const mcpServers = [
    { name: 'context7', status: 'connected', tools: 12 },
    { name: 'serena', status: 'connected', tools: 8 },
    { name: 'web-reader', status: 'connected', tools: 3 },
  ];

  return (
    <div className="oc-mcp-panel border-t border-[var(--oc-border)] p-3 text-xs">
        <div className="mb-2 flex items-center justify-between">
        <div className="oc-panel-title">MCP Servers</div>
        <Button
          type="button"
          aria-label={open ? 'Collapse MCP' : 'Expand MCP'}
          onClick={() => setOpen((v) => !v)}
          variant="ghost"
          size="icon"
          className="oc-collapse-btn flex items-center gap-1 text-oc-xs text-oc-text-soft hover:text-oc-accent transition-colors"
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </Button>
      </div>

      {open ? (
        <div className="space-y-2">
          {mcpServers.map((server) => (
            <div key={server.name} className="rounded-md border border-[var(--oc-border)] bg-[var(--oc-panel-soft)] p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${server.status === 'connected' ? 'bg-[var(--oc-green)]' : 'bg-[var(--oc-red)]'}`} />
                  <span className="font-mono text-[11px] font-medium text-[var(--oc-text-soft)]">{server.name}</span>
                </div>
                <span className="text-[10px] text-[var(--oc-text-soft)] opacity-80">{server.tools} tools</span>
              </div>
            </div>
          ))}
          <div className="mt-2 text-center text-[10px] text-[var(--oc-text-soft)] opacity-60">
            {mcpServers.length} servers connected
          </div>
        </div>
      ) : null}
    </div>
  );
}

// LspPanel - displays Language Server Protocol status
export function LspPanel() {
  const [open, setOpen] = useState(true);

  // Placeholder LSP servers data - this would come from VSCode in production
  const lspServers = [
    { name: 'TypeScript', status: 'running', version: '5.6.0' },
    { name: 'Python', status: 'running', version: '2024.2' },
    { name: 'JSON', status: 'running', version: '3.5.1' },
  ];

  return (
    <div className="oc-lsp-panel border-t border-[var(--oc-border)] p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <div className="oc-panel-title">LSP Servers</div>
        <Button
          type="button"
          aria-label={open ? 'Collapse LSP' : 'Expand LSP'}
          onClick={() => setOpen((v) => !v)}
          variant="ghost"
          size="icon"
          className="flex items-center gap-1 text-oc-xs text-oc-text-soft hover:text-oc-accent transition-colors"
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        </Button>
      </div>

      {open ? (
        <div className="space-y-2">
          {lspServers.map((server) => (
            <div key={server.name} className="rounded-md border border-[var(--oc-border)] bg-[var(--oc-panel-soft)] p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${server.status === 'running' ? 'bg-[var(--oc-green)]' : 'bg-[var(--oc-red)]'}`} />
                  <span className="font-mono text-[11px] font-medium text-[var(--oc-text-soft)]">{server.name}</span>
                </div>
                <span className="text-[10px] font-mono text-[var(--oc-text-soft)] opacity-80">{server.version}</span>
              </div>
            </div>
          ))}
          <div className="mt-2 text-center text-[10px] text-[var(--oc-text-soft)] opacity-60">
            {lspServers.length} language servers active
          </div>
        </div>
      ) : null}
    </div>
  );
}
