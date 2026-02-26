import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, FileEdit, FilePlus, FileX, Play, Shield } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlanFile {
  path: string;
  type: 'create' | 'modify' | 'delete';
}

interface PlanStep {
  title: string;
  completed: boolean;
}

interface PlanVerification {
  type: string;
  description: string;
}

interface PlanData {
  goal: string;
  description?: string;
  files: PlanFile[];
  steps: PlanStep[];
  verification: PlanVerification[];
  rawContent: string;
}

// Extend window to accept injected plan data
declare global {
  interface Window {
    __PLAN_DATA__?: PlanData;
    acquireVsCodeApi?: () => { postMessage: (msg: unknown) => void };
  }
}

const vscode = window.acquireVsCodeApi?.();

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileTypeIcon(type: PlanFile['type']) {
  if (type === 'create') return <FilePlus className="h-3.5 w-3.5 text-emerald-400" />;
  if (type === 'delete') return <FileX className="h-3.5 w-3.5 text-red-400" />;
  return <FileEdit className="h-3.5 w-3.5 text-amber-400" />;
}

function fileTypeBadgeVariant(type: PlanFile['type']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (type === 'create') return 'default';
  if (type === 'delete') return 'destructive';
  return 'secondary';
}

// ── Collapsible Section ───────────────────────────────────────────────────────

function Section({ title, count, children, defaultOpen = true }: {
  title: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mb-4 rounded-md border border-[var(--vscode-panel-border)]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--vscode-descriptionForeground)] hover:bg-white/5"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {title}
        {count !== undefined && (
          <span className="ml-auto rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-mono">
            {count}
          </span>
        )}
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}

// ── Main Shell ────────────────────────────────────────────────────────────────

export default function PlanShell() {
  const plan = window.__PLAN_DATA__;
  const [checkedSteps, setCheckedSteps] = useState<Set<number>>(
    () => new Set(plan?.steps.map((s, i) => s.completed ? i : -1).filter((i) => i >= 0) ?? [])
  );
  const [executing, setExecuting] = useState(false);

  if (!plan) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--vscode-editor-background)] text-[var(--vscode-descriptionForeground)] text-sm">
        No plan data available.
      </div>
    );
  }

  function toggleStep(index: number) {
    setCheckedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function handleProceed() {
    if (executing) return;
    setExecuting(true);
    vscode?.postMessage({ type: 'executePlan', plan: plan!.rawContent });
  }

  const completedCount = checkedSteps.size;
  const totalSteps = plan.steps.length;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)]">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background,var(--vscode-editor-background))] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="h-4 w-4 flex-shrink-0 text-[var(--vscode-focusBorder)]" />
              <h1 className="truncate text-sm font-semibold">{plan.goal}</h1>
            </div>
            {plan.description && (
              <p className="text-xs text-[var(--vscode-descriptionForeground)] line-clamp-2">
                {plan.description}
              </p>
            )}
          </div>
          <Badge variant="outline" className="flex-shrink-0 text-[10px]">
            In Review
          </Badge>
        </div>

        {/* Progress bar */}
        {totalSteps > 0 && (
          <div className="mt-2.5">
            <div className="flex justify-between text-[10px] text-[var(--vscode-descriptionForeground)] mb-1">
              <span>Steps</span>
              <span>{completedCount}/{totalSteps}</span>
            </div>
            <div className="h-1 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--vscode-progressBar-background,#007acc)] transition-all duration-300"
                style={{ width: `${totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </header>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-0">

        {/* Files section */}
        {plan.files.length > 0 && (
          <Section title="Proposed Changes" count={plan.files.length}>
            <div className="space-y-1">
              {plan.files.map((file, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded border border-[var(--vscode-panel-border)] bg-white/5 px-2.5 py-1.5 text-xs font-mono"
                >
                  {fileTypeIcon(file.type)}
                  <span className="flex-1 truncate text-[var(--vscode-editor-foreground)]">
                    {file.path}
                  </span>
                  <Badge variant={fileTypeBadgeVariant(file.type)} className="text-[10px] px-1.5 py-0">
                    {file.type}
                  </Badge>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Steps section */}
        {plan.steps.length > 0 && (
          <Section title="Task Checklist" count={totalSteps}>
            <div className="space-y-1.5">
              {plan.steps.map((step, i) => {
                const done = checkedSteps.has(i);
                return (
                  <label
                    key={i}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 rounded border px-2.5 py-2 text-xs transition-colors',
                      done
                        ? 'border-[var(--vscode-panel-border)] bg-white/5 text-[var(--vscode-descriptionForeground)] line-through'
                        : 'border-[var(--vscode-panel-border)] bg-white/5 hover:bg-white/10'
                    )}
                  >
                    <div
                      onClick={() => toggleStep(i)}
                      className={cn(
                        'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors cursor-pointer',
                        done
                          ? 'border-emerald-500 bg-emerald-500/20'
                          : 'border-[var(--vscode-panel-border)] bg-transparent'
                      )}
                    >
                      {done && <Check className="h-2.5 w-2.5 text-emerald-400" />}
                    </div>
                    <span className="flex-1">{step.title}</span>
                  </label>
                );
              })}
            </div>
          </Section>
        )}

        {/* Verification section */}
        {plan.verification.length > 0 && (
          <Section title="Verification Plan" count={plan.verification.length} defaultOpen={false}>
            <div className="space-y-1.5">
              {plan.verification.map((v, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2.5 rounded border border-[var(--vscode-panel-border)] bg-white/5 px-2.5 py-2 text-xs"
                >
                  <Badge variant="outline" className="flex-shrink-0 text-[10px] mt-0.5 capitalize">
                    {v.type}
                  </Badge>
                  <span className="text-[var(--vscode-descriptionForeground)]">{v.description}</span>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>

      {/* Action bar */}
      <footer className="flex-shrink-0 border-t border-[var(--vscode-panel-border)] px-4 py-3">
        <Button
          className="w-full"
          onClick={handleProceed}
          disabled={executing}
        >
          <Play className="mr-2 h-3.5 w-3.5" />
          {executing ? 'Executing…' : 'Proceed to Implementation'}
        </Button>
      </footer>
    </div>
  );
}
