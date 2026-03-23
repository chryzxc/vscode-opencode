import { useMemo, useState } from "react";
import { Zap, History, Settings } from "lucide-react";
import { useAppState, useAppDispatch } from "../../lib/store";
import { Button } from "@/components/ui/button";
import type { Message } from "../../lib/types";
import { SettingsSlideOver } from "../settings/SettingsSlideOver";

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
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-oc-border-soft opacity-20"
        />
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
      {pct > 80 && (
        <div
          className="absolute inset-0 rounded-full blur-[4px] opacity-40 animate-pulse"
          style={{ backgroundColor: strokeColor }}
        />
      )}
    </div>
  );
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
    return true;
  }
  if (!Array.isArray(processingSessionIds) || processingSessionIds.length === 0) {
    return true;
  }
  return processingSessionIds.includes(currentSessionId);
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isProcessing = isProcessingInCurrentSession(
    globalIsProcessing,
    currentSessionId,
    processingSessionIds,
  );

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
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Settings"
          aria-label="Open settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>
      {settingsOpen && (
        <SettingsSlideOver
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
