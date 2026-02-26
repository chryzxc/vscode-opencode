import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, FileText, Loader2, X } from 'lucide-react';

import { useAppState } from './lib/store';
import type { StreamingStep } from './lib/types';
import vscode from './lib/vscode';
import { AssistantMessage } from './MessageComponents';

function extClass(path?: string): string {
  if (!path) {
    return 'text-[var(--vscode-foreground)]';
  }
  if (path.endsWith('.ts') || path.endsWith('.tsx')) {
    return 'text-blue-300';
  }
  if (path.endsWith('.js') || path.endsWith('.jsx')) {
    return 'text-yellow-300';
  }
  if (path.endsWith('.json')) {
    return 'text-emerald-300';
  }
  return 'text-[var(--vscode-foreground)]';
}

export function ProgressStep({ step }: { step: StreamingStep }) {
  const statusIcon =
    step.status === 'pending' ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
    ) : step.status === 'error' ? (
      <X className="h-3.5 w-3.5" />
    ) : (
      <Check className="h-3.5 w-3.5" />
    );

  const handleOpenFile = () => {
    if (step.filePath) {
      vscode.postMessage({ type: 'openFile', file: step.filePath });
    }
  };

  return (
    <div className="oc-step-item flex items-start gap-2 rounded border border-[var(--vscode-panel-border)] bg-black/10 px-2 py-1.5 text-xs">
      <span className="mt-0.5 opacity-75">{statusIcon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          {step.filePath ? (
            <button
              type="button"
              onClick={handleOpenFile}
              className="inline-flex items-center gap-1 hover:underline"
              title={step.filePath}
            >
              <FileText className={`h-3.5 w-3.5 ${extClass(step.filePath)}`} />
              <span className="truncate">{step.title}</span>
            </button>
          ) : (
            <span>{step.title}</span>
          )}
        </div>
        {step.meta ? <div className="mt-0.5 opacity-75">{step.meta}</div> : null}
      </div>
    </div>
  );
}

export function ProgressSteps({ steps }: { steps: StreamingStep[] }) {
  const [open, setOpen] = useState(true);
  if (!steps.length) {
    return null;
  }

  return (
    <div className="oc-steps-wrap mt-3 rounded border border-[var(--vscode-panel-border)] p-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="oc-steps-header mb-1 flex w-full items-center gap-1 text-left text-xs"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Progress ({steps.length})
      </button>
      {open ? (
        <div className="space-y-1">
          {steps.map((step, index) => (
            <ProgressStep key={`${step.id ?? step.callID ?? step.title}-${index}`} step={step} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function StreamingCard() {
  const { streaming } = useAppState();
  const visible = useMemo(() => !!streaming && (streaming.isActive || streaming.content.length > 0), [streaming]);

  if (!visible || !streaming) {
    return null;
  }

  return <AssistantMessage streaming={streaming} />;
}
