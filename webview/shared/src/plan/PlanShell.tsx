import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, FileEdit, FilePlus, FileX, MessageSquare, Play, Shield, X } from 'lucide-react';

import type { PlanComment } from '@/chat/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/utils';
import { renderMarkdown } from './markdownRenderer';

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

declare global {
  interface Window {
    __PLAN_DATA__?: PlanData;
    __pendingPlanAnchor?: PlanComment['anchor'] | null;
    acquireVsCodeApi?: () => { postMessage: (msg: unknown) => void };
    postAddComment?: (comment: PlanComment, planId?: string) => void;
    postUpdateComment?: (comment: PlanComment, planId?: string) => void;
    postDeleteComment?: (id: string, planId?: string) => void;
  }
}

const vscode = window.acquireVsCodeApi?.();

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

function Section({ title, count, children, defaultOpen = true }: { title: string; count?: number; children: React.ReactNode; defaultOpen?: boolean }) {
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
          <span className="ml-auto rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-mono">{count}</span>
        )}
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}

export default function PlanShell() {
  const envelope = window.__PLAN_DATA__ as any;
  const plan = (envelope?.parsed ?? envelope) as PlanData | undefined;

  const [checkedSteps, setCheckedSteps] = useState<Set<number>>(() => new Set(plan?.steps.map((s, i) => (s.completed ? i : -1)).filter((i) => i >= 0) ?? []));
  const [executing, setExecuting] = useState(false);

  const [comments, setComments] = useState<PlanComment[]>(envelope?.comments ?? []);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);

  const planContentRef = useRef<HTMLDivElement | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<PlanComment['anchor'] | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);
  const [commentText, setCommentText] = useState('');

  // Listen for commentsUpdated messages from the extension
  useEffect(() => {
    function handler(e: MessageEvent) {
      const data = e.data as { type?: string; comments?: PlanComment[] } | undefined;
      if (data?.type === 'commentsUpdated') setComments(data.comments ?? []);
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Expose postAddComment / postUpdateComment / postDeleteComment globals
  useEffect(() => {
    window.postAddComment = (comment: PlanComment, planId?: string) => vscode?.postMessage({ type: 'addComment', comment, planId });
    window.postUpdateComment = (comment: PlanComment, planId?: string) => vscode?.postMessage({ type: 'updateComment', comment, planId });
    window.postDeleteComment = (id: string, planId?: string) => vscode?.postMessage({ type: 'deleteComment', id, planId });
    return () => {
      try {
        // @ts-ignore
        delete window.postAddComment;
        // @ts-ignore
        delete window.postUpdateComment;
        // @ts-ignore
        delete window.postDeleteComment;
      } catch {
        /* ignore */
      }
    };
  }, []);

  const rawPlan = (plan as PlanData)?.rawContent ?? envelope?.raw ?? '';

  useEffect(() => {
    window.__pendingPlanAnchor = pendingAnchor ?? null;
  }, [pendingAnchor]);

  // Text selection → floating popover
  useEffect(() => {
    function computeAnchorFromSelection() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setPendingAnchor(null);
        setPopoverPos(null);
        return;
      }

      const anchorNode = sel.anchorNode;
      const focusNode = sel.focusNode;
      const container = planContentRef.current;
      if (!container || !anchorNode || !focusNode) {
        setPendingAnchor(null);
        setPopoverPos(null);
        return;
      }
      if (!container.contains(anchorNode) || !container.contains(focusNode)) {
        setPendingAnchor(null);
        setPopoverPos(null);
        return;
      }

      const selectedText = sel.toString();
      if (!selectedText) {
        setPendingAnchor(null);
        setPopoverPos(null);
        return;
      }

      const idx = rawPlan.indexOf(selectedText);
      if (idx === -1) {
        setPendingAnchor(null);
        setPopoverPos(null);
        return;
      }

      const startLine = rawPlan.slice(0, idx).split('\n').length - 1;
      const endLine = rawPlan.slice(0, idx + selectedText.length).split('\n').length - 1;
      setPendingAnchor({ startLine, endLine, selectedText });

      // Position popover near the selection
      try {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setPopoverPos({ x: rect.left, y: rect.top });
      } catch {
        /* ignore */
      }
    }

    const container = planContentRef.current;
    if (container) container.addEventListener('mouseup', computeAnchorFromSelection);
    document.addEventListener('selectionchange', computeAnchorFromSelection);
    return () => {
      if (container) container.removeEventListener('mouseup', computeAnchorFromSelection);
      document.removeEventListener('selectionchange', computeAnchorFromSelection);
    };
  }, [rawPlan]);

  if (!plan) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--vscode-editor-background)] text-[var(--vscode-descriptionForeground)] text-sm">No plan data available.</div>
    );
  }

  function toggleStep(index: number) {
    setCheckedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }

  function handleProceed() {
    if (executing) return;
    setExecuting(true);
    vscode?.postMessage({ type: 'proceedWithPlan', rawPlan, comments });
  }

  function handleAddComment() {
    const trimmed = commentText.trim();
    if (!trimmed || !pendingAnchor) return;
    const newComment: PlanComment = { id: crypto.randomUUID(), anchor: pendingAnchor, text: trimmed, createdAt: Date.now() };
    window.postAddComment?.(newComment);
    setCommentText('');
    setPendingAnchor(null);
    setPopoverPos(null);
  }

  const completedCount = checkedSteps.size;
  const totalSteps = plan.steps.length;
  const renderedHtml = renderMarkdown(rawPlan);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)]">

      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background,var(--vscode-editor-background))] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          {/* Left: title + description */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="h-4 w-4 flex-shrink-0 text-[var(--vscode-focusBorder)]" />
              <h1 className="truncate text-sm font-semibold">{plan.goal}</h1>
            </div>
            {plan.description && <p className="text-xs text-[var(--vscode-descriptionForeground)] line-clamp-2">{plan.description}</p>}
          </div>

          {/* Right: Comments + Proceed buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCommentsPanelOpen(true)}
              className="flex items-center gap-1.5"
              title="View comments"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Comments</span>
              {comments.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 leading-none">
                  {comments.length}
                </Badge>
              )}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleProceed}
              disabled={executing}
              className="flex items-center gap-1.5"
              aria-label="Proceed to implementation"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{executing ? 'Executing…' : 'Proceed'}</span>
            </Button>
          </div>
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

      {/* ─── Main scroll area ────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-6 py-4">
        {/* Rendered markdown */}
        {/* biome-disable-next-line lint/security/noDangerouslySetInnerHtml */}
        <div
          ref={planContentRef}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: plan content is from trusted extension backend
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
          className="prose prose-invert max-w-none text-xs leading-relaxed text-[var(--vscode-editor-foreground)] select-text cursor-text mb-6 [&_h1]:text-base [&_h1]:font-bold [&_h1]:mb-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mb-1.5 [&_pre]:bg-white/5 [&_pre]:rounded [&_pre]:p-3 [&_pre]:overflow-x-auto [&_code]:bg-white/10 [&_code]:px-1 [&_code]:rounded [&_pre_code]:bg-transparent [&_pre_code]:px-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:mb-0.5 [&_p]:mb-2 [&_strong]:font-semibold [&_em]:italic"
        />

        {/* Proposed Changes */}
        {plan.files.length > 0 && (
          <Section title="Proposed Changes" count={plan.files.length}>
            <div className="space-y-1">
              {plan.files.map((file) => (
                <div key={file.path} className="flex items-center gap-2 rounded border border-[var(--vscode-panel-border)] bg-white/5 px-2.5 py-1.5 text-xs font-mono">
                  {fileTypeIcon(file.type)}
                  <span className="flex-1 truncate text-[var(--vscode-editor-foreground)]">{file.path}</span>
                  <Badge variant={fileTypeBadgeVariant(file.type)} className="text-[10px] px-1.5 py-0">{file.type}</Badge>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Task Checklist */}
        {plan.steps.length > 0 && (
          <Section title="Task Checklist" count={totalSteps}>
            <div className="space-y-1.5">
              {plan.steps.map((step, i) => {
                const done = checkedSteps.has(i);
                return (
                  <div key={`${i}-${step.title}`} className={cn('flex items-center gap-2.5 rounded border px-2.5 py-2 text-xs transition-colors', done ? 'border-[var(--vscode-panel-border)] bg-white/5 text-[var(--vscode-descriptionForeground)] line-through' : 'border-[var(--vscode-panel-border)] bg-white/5 hover:bg-white/10')}>
                    <button type="button" onClick={() => toggleStep(i)} aria-pressed={done} className={cn('flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-colors', done ? 'border-emerald-500 bg-emerald-500/20' : 'border-[var(--vscode-panel-border)] bg-transparent')}>
                      {done && <Check className="h-2.5 w-2.5 text-emerald-400" />}
                    </button>
                    <span className="flex-1">{step.title}</span>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Verification Plan */}
        {plan.verification.length > 0 && (
          <Section title="Verification Plan" count={plan.verification.length} defaultOpen={false}>
            <div className="space-y-1.5">
              {plan.verification.map((v, i) => (
                <div key={`${i}-${v.type}`} className="flex items-start gap-2.5 rounded border border-[var(--vscode-panel-border)] bg-white/5 px-2.5 py-2 text-xs">
                  <Badge variant="outline" className="flex-shrink-0 text-[10px] mt-0.5 capitalize">{v.type}</Badge>
                  <span className="text-[var(--vscode-descriptionForeground)]">{v.description}</span>
                </div>
              ))}
            </div>
          </Section>
        )}
      </main>

      {/* ─── Floating comment popover ─────────────────────────────────── */}
      {popoverPos && pendingAnchor && (
        <div
          style={{
            position: 'fixed',
            top: Math.max(8, popoverPos.y - 10),
            left: Math.min(popoverPos.x, window.innerWidth - 320),
            zIndex: 50,
            width: 300,
          }}
          className="rounded-md border border-[var(--vscode-panel-border)] bg-[var(--vscode-editorWidget-background,var(--vscode-editor-background))] p-3 shadow-lg"
        >
          <p className="mb-2 text-xs text-[var(--vscode-descriptionForeground)] italic line-clamp-2">
            &ldquo;{pendingAnchor.selectedText.length > 60 ? `${pendingAnchor.selectedText.slice(0, 60)}…` : pendingAnchor.selectedText}&rdquo;
          </p>
          <Textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment…"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setPendingAnchor(null);
                setPopoverPos(null);
                setCommentText('');
              }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                handleAddComment();
              }
            }}
            className="mb-2 text-xs"
            rows={3}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAddComment} disabled={!commentText.trim()}>
              Add Comment
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setPendingAnchor(null); setPopoverPos(null); setCommentText(''); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ─── Comments panel (slide-in overlay) ──────────────────────────── */}
      <div
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          bottom: 0,
          width: 320,
          transform: commentsPanelOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.2s ease',
          zIndex: 40,
        }}
        className="flex flex-col border-l border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background,var(--vscode-editor-background))] shadow-xl"
      >
        {/* Panel header */}
        <div className="flex items-center justify-between border-b border-[var(--vscode-panel-border)] px-3 py-2.5">
          <h2 className="text-sm font-semibold">
            Comments
            {comments.length > 0 && (
              <span className="ml-2 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-mono">{comments.length}</span>
            )}
          </h2>
          <button
            type="button"
            onClick={() => setCommentsPanelOpen(false)}
            className="rounded p-1 hover:bg-white/10 text-[var(--vscode-descriptionForeground)]"
            aria-label="Close comments panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Panel body */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {comments.length === 0 ? (
            <p className="text-xs text-[var(--vscode-descriptionForeground)]">No comments yet. Highlight text to add one.</p>
          ) : (
            comments.map((comment) => {
              const isStale = !rawPlan.includes(comment.anchor.selectedText || '');
              return (
                <div key={comment.id} className="rounded border border-[var(--vscode-panel-border)] bg-white/5 p-2 text-xs">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="italic text-[var(--vscode-descriptionForeground)] truncate flex-1">
                      &ldquo;{comment.anchor.selectedText}&rdquo;
                    </p>
                    {isStale && <Badge variant="secondary" className="text-[10px] flex-shrink-0">Stale</Badge>}
                  </div>
                  <p className="text-[var(--vscode-editor-foreground)] mb-2">{comment.text}</p>

                  {editingId === comment.id ? (
                    <>
                      <label htmlFor={`comment-edit-${comment.id}`} className="sr-only">Edit comment</label>
                      <Textarea
                        id={`comment-edit-${comment.id}`}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="mb-2 text-xs"
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => {
                          const trimmed = editText.trim();
                          window.postUpdateComment?.({ ...comment, text: trimmed });
                          setEditingId(null);
                          setEditText('');
                        }}>Save</Button>
                        <Button size="sm" variant="outline" onClick={() => { setEditingId(null); setEditText(''); }}>Cancel</Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setEditingId(comment.id); setEditText(comment.text); }}>Edit</Button>
                      <Button size="sm" variant="outline" onClick={() => window.postDeleteComment?.(comment.id)}>Delete</Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
