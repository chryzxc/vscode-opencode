import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileCode,
  GitMerge,
  MessageSquare,
  Minus,
  Plus,
  X
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlanComment {
  id: string;
  anchor: {
    startLine: number;
    endLine: number;
    selectedText: string;
    surroundingText?: string;
  };
  text: string;
  createdAt: number;
}

interface DiffHunk {
  header: string;
  lines: string[];
}

interface DiffFile {
  path: string;
  added: number;
  deleted: number;
  type?: 'create' | 'modify' | 'delete';
  hunks: DiffHunk[];
}

interface DiffData {
  files: DiffFile[];
  comments?: PlanComment[];
}

// Extend window
declare global {
  interface Window {
    __DIFF_DATA__?: DiffData;
  }
}

import vscode from '@/chat/lib/vscode';

type FilterType = 'all' | 'create' | 'modify' | 'delete';

// ── Diff Line ─────────────────────────────────────────────────────────────────

function DiffLine({ line }: { line: string }) {
  const isAdded = line.startsWith('+') && !line.startsWith('+++');
  const isRemoved = line.startsWith('-') && !line.startsWith('---');
  const isHunkHeader = line.startsWith('@@');

  return (
    <div
      className={cn(
        'px-3 py-0.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all',
        isAdded && 'bg-emerald-950/40 text-emerald-300',
        isRemoved && 'bg-red-950/40 text-red-300',
        isHunkHeader && 'bg-blue-950/40 text-blue-300 font-semibold',
        !isAdded && !isRemoved && !isHunkHeader && 'text-[var(--vscode-editor-foreground)] opacity-70'
      )}
    >
      {line}
    </div>
  );
}

// ── Diff Item ─────────────────────────────────────────────────────────────────

function DiffItem({
  file,
  onApprove,
  onReject,
}: {
  file: DiffFile;
  onApprove: (path: string) => void;
  onReject: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [decided, setDecided] = useState<'approved' | 'rejected' | null>(null);

  const filename = file.path.split(/[\\/]/).pop() ?? file.path;
  const dirname = file.path.includes('/') || file.path.includes('\\')
    ? file.path.substring(0, file.path.lastIndexOf(file.path.includes('/') ? '/' : '\\'))
    : '';

  const allLines = file.hunks.flatMap((h) => [h.header, ...h.lines]);

  return (
    <div
      className={cn(
        'rounded-md border transition-colors',
        decided === 'approved' && 'border-emerald-700/50 bg-emerald-950/20',
        decided === 'rejected' && 'border-red-700/50 bg-red-950/20',
        !decided && 'border-[var(--vscode-panel-border)] bg-white/5'
      )}
    >
      {/* File header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          className="flex items-center gap-1.5 text-left flex-1 min-w-0"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-[var(--vscode-descriptionForeground)]" />
            : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-[var(--vscode-descriptionForeground)]" />
          }
          <FileCode className="h-3.5 w-3.5 flex-shrink-0 text-[var(--vscode-descriptionForeground)]" />
          <div className="min-w-0 flex-1">
            <span className="text-xs font-mono font-medium">{filename}</span>
            {dirname && (
              <span className="ml-1.5 text-[10px] font-mono text-[var(--vscode-descriptionForeground)] truncate">
                {dirname}
              </span>
            )}
          </div>
        </button>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {file.added > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] font-mono text-emerald-400">
              <Plus className="h-2.5 w-2.5" />{file.added}
            </span>
          )}
          {file.deleted > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] font-mono text-red-400">
              <Minus className="h-2.5 w-2.5" />{file.deleted}
            </span>
          )}

          {decided ? (
            <Badge
              variant={decided === 'approved' ? 'default' : 'destructive'}
              className="text-[10px] px-1.5"
            >
              {decided === 'approved' ? 'Approved' : 'Rejected'}
            </Badge>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-emerald-400 hover:bg-emerald-950/40 hover:text-emerald-300"
                title="Approve"
                onClick={() => {
                  setDecided('approved');
                  onApprove(file.path);
                }}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-red-400 hover:bg-red-950/40 hover:text-red-300"
                title="Reject"
                onClick={() => {
                  setDecided('rejected');
                  onReject(file.path);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Diff lines */}
      {expanded && allLines.length > 0 && (
        <div className="border-t border-[var(--vscode-panel-border)] overflow-x-auto">
          {allLines.map((line, i) => (
            <DiffLine key={i} line={line} />
          ))}
        </div>
      )}

      {expanded && allLines.length === 0 && (
        <div className="border-t border-[var(--vscode-panel-border)] px-3 py-3 text-[11px] text-[var(--vscode-descriptionForeground)] italic">
          No diff available.
        </div>
      )}
    </div>
  );
}

// ── Main Shell ────────────────────────────────────────────────────────────────

export default function DiffReviewShell() {
  const data = window.__DIFF_DATA__;
  const [filter, setFilter] = useState<FilterType>('all');
  const [comments, setComments] = useState<PlanComment[]>(data?.comments ?? []);
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const shellRef = useRef<HTMLDivElement | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<PlanComment['anchor'] | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(null);
  const [commentText, setCommentText] = useState('');

  // Listen for commentsUpdated messages
  useEffect(() => {
    function handler(e: MessageEvent) {
      if (e.data?.type === 'commentsUpdated') setComments(e.data.comments ?? []);
    }
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Text selection → floating popover
  useEffect(() => {
    function computeAnchorFromSelection() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setPendingAnchor(null);
        setPopoverPos(null);
        return;
      }

      const container = shellRef.current;
      if (!container || !sel.anchorNode || !sel.focusNode || !container.contains(sel.anchorNode)) {
        setPendingAnchor(null);
        setPopoverPos(null);
        return;
      }

      const selectedText = sel.toString().trim();
      if (!selectedText) {
        setPendingAnchor(null);
        setPopoverPos(null);
        return;
      }

      const surroundingText = sel.getRangeAt(0).commonAncestorContainer.textContent || '';

      // Best-effort line calculation is less relevant for diff viewer than planar, 
      // but we keep the structure for compatibility.
      setPendingAnchor({ startLine: 0, endLine: 0, selectedText, surroundingText });

      try {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setPopoverPos({ x: rect.left, y: rect.top });
      } catch {
        /* ignore */
      }
    }

    function handleSelectionChange() {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.closest('.comment-popover'))) return;

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setPendingAnchor(null);
        setPopoverPos(null);
      }
    }

    const container = shellRef.current;
    if (container) {
      container.addEventListener('mouseup', computeAnchorFromSelection);
      container.addEventListener('keyup', computeAnchorFromSelection);
    }
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      if (container) {
        container.removeEventListener('mouseup', computeAnchorFromSelection);
        container.removeEventListener('keyup', computeAnchorFromSelection);
      }
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, []);

  // Highlights walk
  useEffect(() => {
    const container = shellRef.current;
    if (!container || !comments.length) return;

    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue || '';
        const parent = node.parentNode as HTMLElement;
        if (!parent || parent.nodeName === 'MARK' || parent.nodeName === 'SCRIPT' || parent.nodeName === 'STYLE' || parent.closest('.comment-popover')) return;

        for (const comment of comments) {
          const needle = comment.anchor.selectedText;
          if (!needle) continue;

          const idx = text.indexOf(needle);
          if (idx !== -1) {
            if (comment.anchor.surroundingText) {
              const context = parent.innerText || parent.textContent || '';
              if (!context.includes(comment.anchor.surroundingText)) continue;
            }

            const before = text.slice(0, idx);
            const match = text.slice(idx, idx + needle.length);
            const after = text.slice(idx + needle.length);

            const fragment = document.createDocumentFragment();
            if (before) fragment.appendChild(document.createTextNode(before));

            const mark = document.createElement('mark');
            mark.textContent = match;
            mark.className = 'bg-amber-500/30 text-inherit cursor-pointer rounded-sm hover:bg-amber-500/50 transition-colors px-0.5 -mx-0.5';
            mark.onclick = (e) => {
              e.stopPropagation();
              setCommentsPanelOpen(true);
            };
            fragment.appendChild(mark);

            if (after) fragment.appendChild(document.createTextNode(after));
            parent.replaceChild(fragment, node);
            break;
          }
        }
      } else {
        Array.from(node.childNodes).forEach(walk);
      }
    };

    const timer = setTimeout(() => walk(container), 50);
    return () => clearTimeout(timer);
  }, [comments, filter]); // Re-run when filters change because nodes are re-rendered

  if (!data || data.files.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--vscode-editor-background)] text-[var(--vscode-descriptionForeground)] text-xs">
        No diff data available.
      </div>
    );
  }

  const filters: { label: string; value: FilterType }[] = [
    { label: 'All', value: 'all' },
    { label: 'Created', value: 'create' },
    { label: 'Modified', value: 'modify' },
    { label: 'Deleted', value: 'delete' },
  ];

  const filteredFiles = filter === 'all'
    ? data.files
    : data.files.filter((f) => (f.type ?? 'modify') === filter);

  const totalAdded = data.files.reduce((sum, f) => sum + (f.added ?? 0), 0);
  const totalDeleted = data.files.reduce((sum, f) => sum + (f.deleted ?? 0), 0);

  function handleApprove(path: string) {
    vscode?.postMessage({ type: 'approveDiff', file: path });
  }

  function handleReject(path: string) {
    vscode?.postMessage({ type: 'rejectDiff', file: path });
  }

  function handleAddComment() {
    const trimmed = commentText.trim();
    if (!trimmed || !pendingAnchor) return;
    const newComment: PlanComment = { id: crypto.randomUUID(), anchor: pendingAnchor, text: trimmed, createdAt: Date.now() };
    vscode?.postMessage({ type: 'addComment', comment: newComment });
    setCommentText('');
    setPendingAnchor(null);
    setPopoverPos(null);
  }

  return (
    <div ref={shellRef} className="flex h-screen flex-col overflow-hidden bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)]">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background,var(--vscode-editor-background))] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-[var(--vscode-focusBorder)]" />
            <h1 className="text-xs font-semibold">Diff Review</h1>
            <Badge variant="secondary" className="text-[10px]">
              {data.files.length} file{data.files.length !== 1 ? 's' : ''}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-xs font-mono mr-2">
              {totalAdded > 0 && <span className="text-emerald-400">+{totalAdded}</span>}
              {totalDeleted > 0 && <span className="text-red-400">-{totalDeleted}</span>}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setCommentsPanelOpen(true)}
              className="h-7 text-[10px] flex items-center gap-1.5"
            >
              <MessageSquare className="h-3 w-3" />
              <span>Comments</span>
              {comments.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0 leading-none h-4">
                  {comments.length}
                </Badge>
              )}
            </Button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="mt-2.5 flex gap-1">
          {filters.map((f) => {
            const count = f.value === 'all'
              ? data.files.length
              : data.files.filter((file) => (file.type ?? 'modify') === f.value).length;
            if (count === 0 && f.value !== 'all') return null;
            return (
              <button
                key={f.value}
                type="button"
                className={cn(
                  'rounded px-2.5 py-1 text-xs transition-colors',
                  filter === f.value
                    ? 'bg-[var(--vscode-button-background,#007acc)] text-[var(--vscode-button-foreground,#fff)]'
                    : 'text-[var(--vscode-descriptionForeground)] hover:bg-white/10'
                )}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
                <span className="ml-1 opacity-60">({count})</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* File list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filteredFiles.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-[var(--vscode-descriptionForeground)]">
            No files match this filter.
          </div>
        ) : (
          filteredFiles.map((file, i) => (
            <DiffItem
              key={`${file.path}-${i}`}
              file={file}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          ))
        )}
      </div>

      {/* Floating comment popover */}
      {popoverPos && pendingAnchor && (
        <div
          style={{
            position: 'fixed',
            top: Math.max(8, popoverPos.y - 10),
            left: Math.min(popoverPos.x, window.innerWidth - 320),
            zIndex: 50,
            width: 300,
          }}
          className="comment-popover rounded-md border border-[var(--vscode-panel-border)] bg-[var(--vscode-editorWidget-background,var(--vscode-editor-background))] p-3 shadow-lg"
        >
          <p className="mb-2 text-[10px] text-[var(--vscode-descriptionForeground)] italic line-clamp-2">
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
            className="mb-2 text-xs min-h-[60px]"
            rows={2}
          />
          <div className="flex gap-2">
            <Button size="sm" className="h-7 text-[10px]" onClick={handleAddComment} disabled={!commentText.trim()}>
              Add Comment
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => { setPendingAnchor(null); setPopoverPos(null); setCommentText(''); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Comments panel (slide-in overlay) */}
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
        <div className="flex items-center justify-between border-b border-[var(--vscode-panel-border)] px-3 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider">
            Comments
            {comments.length > 0 && (
              <span className="ml-2 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-mono">{comments.length}</span>
            )}
          </h2>
          <button
            type="button"
            onClick={() => setCommentsPanelOpen(false)}
            className="rounded p-1 hover:bg-white/10 text-[var(--vscode-descriptionForeground)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {comments.length === 0 ? (
            <p className="text-[11px] text-[var(--vscode-descriptionForeground)]">No comments yet. Highlight text to add one.</p>
          ) : (
            comments.map((comment) => (
              <div key={comment.id} className="rounded border border-[var(--vscode-panel-border)] bg-white/5 p-2.5 text-[11px]">
                <p className="italic text-[var(--vscode-descriptionForeground)] truncate mb-1">
                  &ldquo;{comment.anchor.selectedText}&rdquo;
                </p>

                {editingId === comment.id ? (
                  <div className="space-y-2">
                    <Textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="text-[11px] min-h-[60px]"
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" className="h-6 text-[9px]" onClick={() => {
                        const updated = { ...comment, text: editText.trim() };
                        vscode?.postMessage({ type: 'updateComment', comment: updated });
                        setEditingId(null);
                      }}>Save</Button>
                      <Button size="sm" variant="outline" className="h-6 text-[9px]" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-[var(--vscode-editor-foreground)] mb-2 leading-relaxed">{comment.text}</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="text-[10px] text-[var(--vscode-descriptionForeground)] hover:text-oc-accent"
                        onClick={() => { setEditingId(comment.id); setEditText(comment.text); }}
                      >Edit</button>
                      <button
                        type="button"
                        className="text-[10px] text-[var(--vscode-descriptionForeground)] hover:text-red-400"
                        onClick={() => vscode?.postMessage({ type: 'deleteComment', id: comment.id })}
                      >Delete</button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
