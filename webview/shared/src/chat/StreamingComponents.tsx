import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  X,
} from 'lucide-react';

import { useAppState } from './lib/store';
import type { StreamingStep } from './lib/types';
import vscode from './lib/vscode';
import { AssistantMessage } from './MessageComponents';

function extClass(path?: string): string {
  if (!path) return 'text-oc-text-muted';
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'text-oc-accent';
  if (path.endsWith('.js') || path.endsWith('.jsx')) return 'text-oc-yellow';
  if (path.endsWith('.json')) return 'text-oc-green';
  return 'text-oc-text-soft';
}

export function ProgressStep({ step }: { step: StreamingStep }) {
  const isPending = step.status === 'pending';
  const isError = step.status === 'error';
  const isDone = !isPending && !isError;

  const statusIcon = isPending ? (
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
        'flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
        isPending
          ? 'border-oc-accent/20 bg-oc-accent-soft'
          : isError
            ? 'border-oc-red/20 bg-oc-red/5'
            : 'border-oc-border bg-oc-panel-soft',
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
              <FileText
                className={`h-3.5 w-3.5 shrink-0 ${extClass(step.filePath)}`}
              />
              <span className="truncate font-mono">{step.title}</span>
            </button>
          ) : (
            <span className={isDone ? 'text-oc-text-soft' : 'text-oc-text'}>
              {step.title}
            </span>
          )}
        </div>
        {step.meta ? (
          <div className="mt-0.5 text-oc-text-muted">{step.meta}</div>
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
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-oc-text-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-oc-text-muted" />
        )}
        <span className="flex-1 font-medium text-oc-text-soft">Steps</span>
        <span className={`font-mono tabular-nums ${accentColor}`}>
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

export function StreamingCard() {
  const { streaming, isProcessing } = useAppState();

  // Show streaming card if:
  // 1. Streaming state exists (regardless of content - show early)
  // 2. AND either: processing is true, streaming is active, or there's any content
  const visible = useMemo(
    () =>
      !!streaming &&
      (streaming.isActive ||
        streaming.content.length > 0 ||
        streaming.reasoning.length > 0 ||
        streaming.steps.length > 0 ||
        streaming.reasoningEvents.length > 0 ||
        streaming.progressEvents.length > 0 ||
        isProcessing ||
        streaming.messageId),
    [streaming, isProcessing],
  );

  if (!visible || !streaming) return null;

  return <AssistantMessage streaming={streaming} />;
}
