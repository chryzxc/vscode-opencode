import { useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  History,
  Play,
  RefreshCw,
  Send,
  Square,
  Trash2,
  X
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

import { useAppDispatch, useAppState } from './lib/store';
import vscode from './lib/vscode';

function totalTokens(input: number, output: number, read: number, write: number): number {
  return input + output + read + write;
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
          onClick={() => dispatch({ type: 'SET_SIDEBAR_OPEN', payload: !isSidebarOpen })}
        >
          <History className="h-4 w-4" />
        </Button>
        <span className="oc-title text-sm font-semibold">OpenCode</span>
        <span className="oc-session-chip font-mono">ses_{sessionLabel}</span>
      </div>


      <div className="oc-header-right flex items-center gap-1.5">
        <span className="oc-task-pill">TASK</span>
        <span className="oc-task-name text-[11px]">{taskName}</span>
        <span className={`oc-status-pill ${taskStatus === 'IDLE' ? 'idle' : taskStatus === 'PENDING' ? 'pending' : 'running'}`}>
          {taskStatus}
        </span>
      </div>
    </div>
  );
}

export function HistorySidebar() {
  const { isSidebarOpen, sessionsList, currentSessionId } = useAppState();
  const dispatch = useAppDispatch();

  return (
    <aside
      className={`oc-history-sidebar absolute bottom-0 left-0 top-0 z-20 w-72 border-r border-[var(--oc-border)] bg-[var(--oc-panel)] transition-transform ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="flex items-center justify-between border-b border-[var(--vscode-panel-border)] px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Sessions</div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => dispatch({ type: 'SET_SIDEBAR_OPEN', payload: false })}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="border-b border-[var(--vscode-panel-border)] px-2 py-2">
        <button
          type="button"
          className="w-full rounded border border-[var(--vscode-panel-border)] bg-[color:var(--oc-accent-soft)] px-2 py-1.5 text-left text-xs font-semibold text-[var(--oc-accent)]"
          onClick={() => vscode.postMessage({ type: 'newSession' })}
        >
          + New Chat
        </button>
      </div>
      <div className="h-[calc(100%-86px)] overflow-y-auto p-2">
        {sessionsList.map((session) => (
          <div key={session.id} className="mb-1 flex min-w-0 items-center gap-1">
            <button
              type="button"
              onClick={() => vscode.postMessage({ type: 'loadSession', sessionId: session.id })}
              className={`oc-session-item flex-1 min-w-0 overflow-hidden rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--vscode-list-hoverBackground)] ${
                session.id === currentSessionId ? 'bg-[var(--vscode-list-activeSelectionBackground)]' : ''
              }`}
            >
              <div className="truncate font-medium">{session.title || session.id}</div>
              <div className="truncate opacity-70">ses_{session.id.slice(0, 8)}</div>
            </button>
            <button
              type="button"
              title="Delete session"
              className="oc-session-delete shrink-0 rounded p-1 text-xs opacity-60 hover:bg-[var(--vscode-list-hoverBackground)] hover:opacity-100"
              onClick={() => vscode.postMessage({ type: 'deleteSession', sessionId: session.id })}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
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
    <div className="mb-1.5 overflow-hidden rounded border border-[var(--oc-border)]/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-[var(--vscode-list-hoverBackground)]"
      >
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${open ? 'bg-[var(--oc-accent)]/70' : 'bg-current opacity-20'}`}
        />
        <span className={`font-mono text-[10px] uppercase tracking-widest ${open ? '' : 'opacity-50'}`}>{title}</span>
      </button>
      {open && <div className="bg-black/5 px-2 pb-2">{children}</div>}
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
    <div className="oc-active-task-panel flex flex-col w-full bg-[var(--oc-panel)]">
      {/* Panel title */}
      <div className="border-b border-[var(--oc-border)] px-3 py-2">
        <div className="text-[10px] font-mono font-semibold uppercase tracking-widest opacity-60">Active Task</div>
      </div>

      <div className="p-2">
        <MiniSection title="Context">
          {/* Token usage bar */}
          <div className="mb-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="opacity-60">Tokens used</span>
              <span className="font-mono tabular-nums opacity-80">
                {total.toLocaleString()} / {maxContext.toLocaleString()}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--vscode-panel-border)]">
              <div
                className="h-full rounded-full bg-[var(--oc-accent)] transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          {/* 2-col token grid */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="opacity-50">In</span>
              <span className="font-mono tabular-nums">{sessionStats.input.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="opacity-50">Out</span>
              <span className="font-mono tabular-nums">{sessionStats.output.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="opacity-50">Cache R</span>
              <span className="font-mono tabular-nums">{sessionStats.read.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="opacity-50">Cache W</span>
              <span className="font-mono tabular-nums">{sessionStats.write.toLocaleString()}</span>
            </div>
          </div>
        </MiniSection>

        <MiniSection title="Session">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <div className="flex items-center justify-between col-span-2">
              <span className="opacity-50">ID</span>
              <span className="font-mono text-[10px] opacity-70">
                {currentSessionId ? currentSessionId.slice(0, 16) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="opacity-50">Messages</span>
              <span className="font-mono tabular-nums">{messageCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="opacity-50">Duration</span>
              <span className="font-mono tabular-nums">{durationLabel}</span>
            </div>
            <div className="flex items-center justify-between col-span-2">
              <span className="opacity-50">Status</span>
              <span className={`font-mono text-[10px] ${isActive ? 'text-[var(--oc-accent)]' : 'opacity-50'}`}>
                {isActive ? 'ACTIVE' : 'IDLE'}
              </span>
            </div>
          </div>
        </MiniSection>
      </div>
    </div>
  );
}

export function ModelDropdown() {
  const { availableModels, selectedModel, modelSearchQuery, modelDropdownOpen } = useAppState();
  const dispatch = useAppDispatch();

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof availableModels>();
    const query = modelSearchQuery.toLowerCase();
    availableModels
      .filter((model) => `${model.providerID} ${model.name} ${model.modelID}`.toLowerCase().includes(query))
      .forEach((model) => {
        const key = model.providerName ?? model.providerID;
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)?.push(model);
      });
    return groups;
  }, [availableModels, modelSearchQuery]);

  const label = selectedModel ? `${selectedModel.providerID}/${selectedModel.modelID}` : 'Choose model';

  return (
    <div className="relative">
      <button
        type="button"
        className="oc-control-btn flex w-full items-center justify-between rounded border border-[var(--vscode-panel-border)] px-2 py-1 text-xs"
        onClick={() => dispatch({ type: 'SET_MODEL_DROPDOWN_OPEN', payload: !modelDropdownOpen })}
      >
        <span className="truncate">{label}</span>
        {modelDropdownOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {modelDropdownOpen ? (
        <div className="oc-dropdown absolute bottom-full left-0 z-30 mb-1 max-h-64 w-full overflow-y-auto rounded border border-[var(--oc-border)] bg-[var(--oc-panel)] p-1">
          <input
            value={modelSearchQuery}
            onChange={(event) => dispatch({ type: 'SET_MODEL_SEARCH', payload: event.target.value })}
            placeholder="Search models"
            className="oc-dropdown-search mb-1 w-full rounded border border-[var(--vscode-panel-border)] bg-transparent px-2 py-1 text-xs"
          />
          {[...grouped.entries()].map(([provider, models]) => (
            <div key={provider} className="mb-1">
              <div className="oc-group-label px-2 py-1 text-[10px] uppercase opacity-60">{provider}</div>
              {models.map((model) => {
                const isCurrent =
                  selectedModel?.providerID === model.providerID &&
                  selectedModel?.modelID === model.modelID;
                return (
                <button
                  key={`${model.providerID}-${model.modelID}`}
                  type="button"
                  className={`oc-dropdown-option block w-full rounded px-2 py-1 text-left text-xs hover:bg-[var(--vscode-list-hoverBackground)] ${
                    isCurrent ? 'bg-[var(--vscode-list-hoverBackground)]' : ''
                  }`}
                  onClick={() => {
                    dispatch({
                      type: 'SET_SELECTED_MODEL',
                      payload: { providerID: model.providerID, modelID: model.modelID }
                    });
                    dispatch({ type: 'SET_MODEL_DROPDOWN_OPEN', payload: false });
                    vscode.postMessage({
                      type: 'selectModel',
                      model: {
                        providerID: model.providerID,
                        modelID: model.modelID,
                        providerName: model.providerName
                      }
                    });
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{model.name}</span>
                    {isCurrent ? <span className="oc-current-label text-[10px] uppercase opacity-70">current</span> : null}
                  </div>
                  <div className="truncate text-[10px] opacity-60">{model.modelID}</div>
                </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AgentDropdown() {
  const { availableAgents, selectedAgent, agentSearchQuery, agentDropdownOpen } = useAppState();
  const dispatch = useAppDispatch();

  const filtered = useMemo(
    () =>
      availableAgents.filter((agent) =>
        `${agent.name} ${agent.id} ${agent.description}`.toLowerCase().includes(agentSearchQuery.toLowerCase())
      ),
    [agentSearchQuery, availableAgents]
  );

  const label = selectedAgent || 'Choose agent';

  return (
    <div className="relative">
      <button
        type="button"
        className="oc-control-btn flex w-full items-center justify-between rounded border border-[var(--vscode-panel-border)] px-2 py-1 text-xs"
        onClick={() => dispatch({ type: 'SET_AGENT_DROPDOWN_OPEN', payload: !agentDropdownOpen })}
      >
        <span className="truncate">{label}</span>
        {agentDropdownOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {agentDropdownOpen ? (
        <div className="oc-dropdown absolute bottom-full left-0 z-30 mb-1 max-h-64 w-full overflow-y-auto rounded border border-[var(--oc-border)] bg-[var(--oc-panel)] p-1">
          <input
            value={agentSearchQuery}
            onChange={(event) => dispatch({ type: 'SET_AGENT_SEARCH', payload: event.target.value })}
            placeholder="Search agents"
            className="oc-dropdown-search mb-1 w-full rounded border border-[var(--vscode-panel-border)] bg-transparent px-2 py-1 text-xs"
          />
          {filtered.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className="oc-dropdown-option mb-1 block w-full rounded px-2 py-1 text-left text-xs hover:bg-[var(--vscode-list-hoverBackground)]"
              onClick={() => {
                dispatch({ type: 'SET_SELECTED_AGENT', payload: agent.id });
                dispatch({ type: 'SET_AGENT_DROPDOWN_OPEN', payload: false });
                vscode.postMessage({ type: 'selectAgent', agent: agent.id });
              }}
            >
              <div className="font-medium">{agent.name}</div>
              <div className="truncate opacity-70">{agent.description}</div>
            </button>
          ))}
        </div>
      ) : null}
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
    <div className="oc-queue border-t border-[var(--vscode-panel-border)] p-2">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide opacity-75">Queue ({promptQueue.length})</div>
      <div className="mb-2 max-h-32 space-y-1 overflow-y-auto">
        {promptQueue.map((item, index) => (
          <div key={`${item.text}-${index}`} className="rounded border border-[var(--vscode-panel-border)] bg-black/10 px-2 py-1">
            <div className="line-clamp-2 text-xs font-mono">{item.text || '(empty)'}</div>
            <button
              type="button"
              className="mt-1 text-[11px] text-red-300 hover:underline"
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
    selectedSuggestionIndex
  } = useAppState();
  const dispatch = useAppDispatch();

  const sendPrompt = () => {
    const text = inputValue.trim();
    if (!text) {
      return;
    }
    if (isProcessing) {
      vscode.postMessage({
        type: 'addToQueue',
        text,
        files: selectedFiles,
        contexts: selectedContexts,
        agent: selectedAgent || null
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
      agent: selectedAgent || null
    });

    dispatch({
      type: 'SET_MESSAGES',
      payload: [
        ...messages,
        {
          role: 'user',
          content: text,
          parts: [{ type: 'text', text }]
        }
      ]
    });
    dispatch({ type: 'SET_PROCESSING', payload: true });
    dispatch({ type: 'SET_INPUT_VALUE', payload: '' });
  };

  const stopRequest = () => vscode.postMessage({ type: 'stopRequest', sessionId: currentSessionId });

  return (
    <div className="oc-input-wrap border-t border-[var(--vscode-panel-border)] p-2">
      {(selectedFiles.length > 0 || selectedContexts.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-1">
          {selectedFiles.map((file) => (
            <span key={file} className="rounded border border-[var(--vscode-panel-border)] px-2 py-0.5 text-[11px]">
              {file}
            </span>
          ))}
          {selectedContexts.map((context) => (
            <span
              key={`${context.file}:${context.lineInfo}`}
              className="rounded border border-[var(--vscode-panel-border)] px-2 py-0.5 text-[11px]"
            >
              {context.file} {context.lineInfo}
            </span>
          ))}
        </div>
      )}

      <Textarea
        value={inputValue}
        placeholder="Ask anything (Enter to send, Shift+Enter for newline), @ to mention, / for commands"
        className="oc-textarea min-h-[44px] max-h-[170px] resize-none"
        onChange={(event) => dispatch({ type: 'SET_INPUT_VALUE', payload: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendPrompt();
          }
        }}
      />

      {showFileSuggestions && fileSuggestions.length > 0 ? (
        <div className="mt-1 max-h-24 overflow-y-auto rounded border border-[var(--vscode-panel-border)]">
          {fileSuggestions.map((suggestion, index) => (
            <button
              key={suggestion.path}
              type="button"
              className={`block w-full px-2 py-1 text-left text-xs ${
                index === selectedSuggestionIndex ? 'bg-[var(--vscode-list-activeSelectionBackground)]' : ''
              }`}
              onClick={() => {
                dispatch({ type: 'SET_SELECTED_FILES', payload: [...selectedFiles, suggestion.path] });
                dispatch({ type: 'SET_SHOW_FILE_SUGGESTIONS', payload: false });
              }}
            >
              {suggestion.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <ModelDropdown />
        <AgentDropdown />
      </div>

      <div className="mt-2 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => dispatch({ type: 'SET_QUEUE_OPEN', payload: true })}
          title="Open queue"
        >
          <AlertCircle className="mr-1 h-3.5 w-3.5" /> Queue{promptQueue.length > 0 ? ` (${promptQueue.length})` : ''}
        </Button>

        <div className="flex items-center gap-2">
          <Button className="bg-[var(--oc-accent)] text-white hover:opacity-90" variant="outline" size="sm" onClick={sendPrompt}>
            {isProcessing ? <AlertCircle className="mr-1 h-3.5 w-3.5" /> : <Send className="mr-1 h-3.5 w-3.5" />}
            {isProcessing ? 'Queue' : 'Send'}
          </Button>
          {isProcessing ? (
            <Button variant="destructive" size="sm" onClick={stopRequest}>
              <Square className="mr-1 h-3.5 w-3.5" /> Stop
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}


export function QuotaMonitor() {
  const { quotaData, quotaIsRefreshing } = useAppState();
  const dispatch = useAppDispatch();

  const handleRefresh = () => {
    dispatch({ type: 'SET_QUOTA_REFRESHING', payload: true });
    vscode.postMessage({ type: 'refreshQuota' });
  };

  const lastUpdatedLabel = quotaData
    ? new Date(quotaData.lastUpdated).toLocaleTimeString()
    : null;

  return (
    <div className="oc-quota-monitor border-t border-[var(--oc-border)] p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <div className="oc-panel-title font-medium uppercase tracking-wide opacity-60">Quota</div>
        <button
          type="button"
          title="Refresh quota"
          disabled={quotaIsRefreshing}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] opacity-70 hover:opacity-100 hover:bg-[var(--vscode-list-hoverBackground)] disabled:opacity-30"
          onClick={handleRefresh}
        >
          <RefreshCw className={`h-3 w-3 ${quotaIsRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {!quotaData && !quotaIsRefreshing ? (
        <div className="py-4 text-center opacity-50">No quota data</div>
      ) : null}

      {quotaIsRefreshing && !quotaData ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-[var(--vscode-panel-border)] opacity-30" />
          ))}
        </div>
      ) : null}

      {quotaData ? (
        <div className="space-y-3">
          {quotaData.platforms.map((platform) => (
            <div key={`${platform.platform}-${platform.account}`} className="rounded border border-[var(--oc-border)] p-2">
              <div className="mb-1.5 flex items-center justify-between gap-1">
                <span className="font-semibold">{platform.title ?? platform.platform}</span>
                {platform.status === 'error' ? (
                  <span className="rounded px-1 text-[10px] bg-red-500/20 text-red-400">error</span>
                ) : null}
              </div>
              {platform.accountLabel ? (
                <div className="mb-1.5 truncate opacity-50 text-[10px]">{platform.accountLabel}</div>
              ) : null}
              {platform.error ? (
                <div className="text-[11px] text-red-400 opacity-90">{platform.error}</div>
              ) : null}
              <div className="space-y-1.5">
                {platform.quotas.map((quota) => {
                  const pct = Math.max(0, Math.min(100, quota.remainPercent));
                  const barColor =
                    pct >= 30
                      ? 'bg-green-500'
                      : pct >= 15
                      ? 'bg-yellow-500'
                      : 'bg-red-500';
                  return (
                    <div key={quota.label}>
                      <div className="mb-0.5 flex items-center justify-between gap-1">
                        <span className="opacity-70">{quota.label}</span>
                        <span className="font-mono opacity-70">{quota.percentLabel ?? `${Math.round(pct)}%`}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--vscode-panel-border)]">
                        <div
                          className={`h-full rounded-full transition-all ${barColor}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      {quota.usedTotalDisplay ? (
                        <div className="mt-0.5 text-[10px] opacity-50">{quota.usedTotalDisplay}</div>
                      ) : null}
                      {quota.resetLabel ? (
                        <div className="mt-0.5 text-[10px] opacity-50">Resets: {quota.resetLabel}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {lastUpdatedLabel ? (
            <div className="text-center text-[10px] opacity-40">Updated: {lastUpdatedLabel}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}