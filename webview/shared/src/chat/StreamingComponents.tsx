import { memo, useMemo, useState } from 'react';
import {
  Circle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  X,
} from 'lucide-react';


import type { AppState, StreamingState, StreamingStep } from './lib/types';
import vscode from './lib/vscode';
import { ResponseMessage, FileIcon } from './MessageComponents';

export function ProgressStep({ step }: { step: StreamingStep }) {
  const isPending = step.status === 'pending';
  const isRunning = step.status === 'running';
  const isError = step.status === 'error';
  const isDone = step.status === 'done';

  const statusIcon = isPending ? (
    <Circle className="h-3.5 w-3.5 text-oc-text-dim" />
  ) : isRunning ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin text-oc-accent" />
  ) : isError ? (
    <X className="h-3.5 w-3.5 text-oc-red" />
  ) : (
    <Check className="h-3.5 w-3.5 text-oc-green" />
  );

  const handleOpenFile = () => {
    if (step.filePath) {
      vscode.postMessage({ type: 'openFile', file: step.filePath });
    }
  };

  return (
    <div
      className={[
        'flex items-start gap-2 px-2 py-1 text-xs transition-colors',
        isPending
          ? 'bg-oc-accent-soft oc-tinted-badge-text'
          : isError
            ? 'bg-oc-red/5'
            : 'bg-transparent',
      ].join(' ')}
    >
      <span className="mt-0.5 shrink-0">{statusIcon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          {step.filePath ? (
            <button
              type="button"
              onClick={handleOpenFile}
              className="inline-flex items-center gap-1 text-oc-text-soft hover:text-oc-accent hover:underline transition-colors"
              title={step.filePath}
            >
              <FileIcon filePath={step.filePath} className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate font-medium">{step.title}</span>
            </button>
          ) : (
            <span className={isDone ? 'text-oc-text-soft' : 'text-oc-text'}>
              {step.title}
            </span>
          )}
        </div>
        {step.meta ? (
          <div className="mt-0.5 oc-text-secondary">{step.meta}</div>
        ) : null}
      </div>
    </div>
  );
}

export function ProgressSteps({ steps }: { steps: StreamingStep[] }) {
  const [open, setOpen] = useState(true);

  if (!steps.length) return null;

  const doneCount = steps.filter((s) => s.status !== 'pending').length;
  const hasError = steps.some((s) => s.status === 'error');
  const allDone = doneCount === steps.length;

  const accentColor = hasError
    ? 'text-oc-red'
    : allDone
      ? 'text-oc-green'
      : 'text-oc-accent';

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-oc-border bg-oc-panel">
      {/* Header row */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-oc-panel-soft transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 oc-text-secondary" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 oc-text-secondary" />
        )}
        <span className="flex-1 font-medium text-oc-text-soft">Steps</span>
        <span className={`font-medium tabular-nums ${accentColor}`}>
          {doneCount}/{steps.length}
        </span>
      </button>

      {/* Progress bar */}
      <div className="h-px w-full bg-oc-border">
        <div
          className={`h-px transition-all duration-500 ${
            hasError ? 'bg-oc-red' : allDone ? 'bg-oc-green' : 'bg-oc-accent'
          }`}
          style={{
            width: steps.length ? `${(doneCount / steps.length) * 100}%` : '0%',
          }}
        />
      </div>

      {/* Step list */}
      {open ? (
        <div className="space-y-1 p-2 max-h-[300px] overflow-y-auto">
          {steps.map((step, index) => (
            <ProgressStep
              key={`${step.id ?? step.callID ?? step.title}-${index}`}
              step={step}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

type StreamingCardProps = {
  isContiguous?: boolean;
  streaming: StreamingState | null;
  interactiveEvents?: AppState["interactiveEvents"];
  assistantTurnMessageId?: AppState["assistantTurnMessageId"];
  transcriptAssistantMessageIds?: string[];
  hasTranscriptAssistantForCurrentTurn?: boolean;
  currentSessionId?: AppState["currentSessionId"];
  subagentsByParentMessageId?: AppState["subagentsByParentMessageId"];
  subagentDetailsById?: AppState["subagentDetailsById"];
  todoItems?: AppState["todoItems"];
};

type ShouldShowStreamingCardInput = {
  streaming: StreamingState | null;
  interactiveEvents?: AppState["interactiveEvents"];
  assistantTurnMessageId?: AppState["assistantTurnMessageId"];
  transcriptAssistantMessageIds?: string[];
  hasTranscriptAssistantForCurrentTurn?: boolean;
  subagentsByParentMessageId?: AppState["subagentsByParentMessageId"];
};

export function shouldShowStreamingCard({
  streaming,
  interactiveEvents,
  assistantTurnMessageId,
  transcriptAssistantMessageIds,
  hasTranscriptAssistantForCurrentTurn,
  subagentsByParentMessageId,
}: ShouldShowStreamingCardInput): boolean {
  if (!streaming) return false;
  // Delta chunks deliberately do not enter the centralized transcript. Keep
  // the live card mounted for the active turn so its renderable text reaches
  // the user immediately; the centralized card takes over after completion.
  if (hasTranscriptAssistantForCurrentTurn && !streaming.isActive) return false;

  const candidateIds = new Set(
    [streaming.messageId, assistantTurnMessageId]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim()),
  );

  const hasMatchingAssistantTurnInTranscript =
    candidateIds.size > 0 &&
    Array.isArray(transcriptAssistantMessageIds) &&
    transcriptAssistantMessageIds.some((messageId) => candidateIds.has(messageId));

  if (hasMatchingAssistantTurnInTranscript && !streaming.isActive) return false;

  const hasRenderableText =
    streaming.hasRenderableContent === true &&
    streaming.content.trim().length > 0;
  if (hasRenderableText) return true;
  if (streaming.reasoning.trim().length > 0) return true;
  if (
    Array.isArray(streaming.reasoningEvents) &&
    streaming.reasoningEvents.length > 0
  ) {
    return true;
  }
  if (streaming.edits.length > 0) return true;
  if (
    Array.isArray(streaming.interactiveEvents) &&
    streaming.interactiveEvents.length > 0
  ) {
    return true;
  }
  if (Array.isArray(interactiveEvents) && interactiveEvents.length > 0) {
    return true;
  }
  if (streaming.liveSessionStatus) return true;
  if (streaming.steps.length > 0 || streaming.progressEvents.length > 0) return true;
  if (streaming.messageId) {
    const liveSubagents = subagentsByParentMessageId?.[streaming.messageId];
    if (Array.isArray(liveSubagents) && liveSubagents.length > 0) {
      return true;
    }
  }

  return false;
}

export const StreamingCard = memo(function StreamingCard({
  isContiguous,
  streaming,
  interactiveEvents,
  assistantTurnMessageId,
  transcriptAssistantMessageIds,
  hasTranscriptAssistantForCurrentTurn,
  currentSessionId,
  subagentsByParentMessageId,
  subagentDetailsById,
  todoItems,
}: StreamingCardProps) {
  // The live streaming card exists only for the in-flight assistant turn.
  // Once the transcript owns the same turn, the finalized ResponseMessage
  // becomes the only source of truth for that response block.
  const visible = useMemo(
    () =>
      shouldShowStreamingCard({
        streaming,
        interactiveEvents,
        assistantTurnMessageId,
        transcriptAssistantMessageIds,
        hasTranscriptAssistantForCurrentTurn,
        subagentsByParentMessageId,
      }),
    [
      assistantTurnMessageId,
      hasTranscriptAssistantForCurrentTurn,
      interactiveEvents,
      streaming,
      subagentsByParentMessageId,
      transcriptAssistantMessageIds,
    ],
  );

  if (!visible || !streaming) return null;

  return (
    <ResponseMessage
      // Render safe text directly from the live stream. Centralized payloads
      // omit deltas, so waiting for their finalized snapshot makes a response
      // appear all at once after an otherwise empty loading period.
      message={undefined}
      streaming={streaming}
      isContiguous={isContiguous}
      interactiveEvents={interactiveEvents}
      currentSessionId={currentSessionId}
      subagentsByParentMessageId={subagentsByParentMessageId}
      subagentDetailsById={subagentDetailsById}
      todoItems={todoItems}
    />
  );
});


