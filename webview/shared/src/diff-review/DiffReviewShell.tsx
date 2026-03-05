import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileCode,
  FilePlus,
  FileMinus,
  GitMerge,
  MessageSquare,
  Minus,
  Plus,
  X,
  CheckCircle2,
  XCircle,
  Keyboard,
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

declare global {
  interface Window {
    __DIFF_DATA__?: DiffData;
  }
}

import vscode from '@/chat/lib/vscode';

type FilterType = 'all' | 'create' | 'modify' | 'delete';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getFileTypeConfig(type?: DiffFile['type']) {
  switch (type) {
    case 'create':
      return {
        label: 'CREATE',
        badgeVariant: 'success' as const,
        Icon: FilePlus,
        colorClass: 'text-oc-green',
      };
    case 'delete':
      return {
        label: 'DELETE',
        badgeVariant: 'error' as const,
        Icon: FileMinus,
        colorClass: 'text-oc-red',
      };
    default:
      return {
        label: 'MODIFY',
        badgeVariant: 'muted' as const,
        Icon: FileCode,
        colorClass: 'text-oc-text-muted',
      };
  }
}

// Parse actual old/new line numbers from hunk header: @@ -old,count +new,count @@
function parseHunkHeader(header: string): { oldStart: number; newStart: number } {
  const m = header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (m) return { oldStart: parseInt(m[1], 10), newStart: parseInt(m[2], 10) };
  return { oldStart: 1, newStart: 1 };
}

// Compute line numbers for all lines in all hunks
function computeLineNumbers(hunks: DiffHunk[]): Array<{ old: number | null; new: number | null }> {
  const result: Array<{ old: number | null; new: number | null }> = [];
  for (const hunk of hunks) {
    const { oldStart, newStart } = parseHunkHeader(hunk.header);
    // Push null for the hunk header itself
    result.push({ old: null, new: null });
    let oldN = oldStart;
    let newN = newStart;
    for (const line of hunk.lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        result.push({ old: null, new: newN++ });
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        result.push({ old: oldN++, new: null });
      } else {
        result.push({ old: oldN++, new: newN++ });
      }
    }
  }
  return result;
}

// ── Diff Line ─────────────────────────────────────────────────────────────────

function DiffLine({
  line,
  oldNum,
  newNum,
}: {
  line: string;
  oldNum: number | null;
  newNum: number | null;
}) {
  const isAdded = line.startsWith('+') && !line.startsWith('+++');
  const isRemoved = line.startsWith('-') && !line.startsWith('---');
  const isHunkHeader = line.startsWith('@@');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = line.slice(1); // strip +/- prefix
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      className={cn(
        'group relative flex min-w-0 font-mono text-oc-2xs leading-relaxed',
        isAdded && 'bg-emerald-950/30',
        isRemoved && 'bg-red-950/30',
        isHunkHeader && 'bg-blue-950/25',
        !isAdded && !isRemoved && !isHunkHeader && 'hover:bg-white/[0.03]',
      )}
    >
      {/* Gutter: line numbers */}
      <div
        className={cn(
          'flex select-none flex-shrink-0 items-center gap-0',
          'border-r border-oc-border-soft',
        )}
        style={{ minWidth: 72 }}
      >
        <span
          className={cn(
            'inline-block w-9 py-0.5 pr-2 text-right',
            isRemoved ? 'text-oc-red opacity-60' : 'text-oc-text-muted opacity-40',
          )}
        >
          {oldNum ?? ''}
        </span>
        <span
          className={cn(
            'inline-block w-9 py-0.5 pr-2 text-right',
            isAdded ? 'text-oc-green opacity-60' : 'text-oc-text-muted opacity-40',
          )}
        >
          {newNum ?? ''}
        </span>
      </div>

      {/* Sign gutter */}
      <div
        className={cn(
          'flex w-5 flex-shrink-0 select-none items-center justify-center border-r border-oc-border-soft py-0.5',
          isAdded && 'text-oc-green',
          isRemoved && 'text-oc-red',
          isHunkHeader && 'text-blue-400',
          !isAdded && !isRemoved && !isHunkHeader && 'text-oc-text-muted opacity-30',
        )}
      >
        {isAdded ? '+' : isRemoved ? '-' : isHunkHeader ? '·' : ' '}
      </div>

      {/* Content */}
      <div
        className={cn(
          'flex-1 overflow-x-auto whitespace-pre px-3 py-0.5',
          isAdded && 'text-emerald-300',
          isRemoved && 'text-red-300',
          isHunkHeader && 'text-blue-300 font-semibold',
          !isAdded && !isRemoved && !isHunkHeader && 'text-oc-text opacity-75',
        )}
      >
        {isHunkHeader ? line : line.slice(1)}
      </div>

      {/* Copy button (hover) */}
      {!isHunkHeader && (
        <button
          type="button"
          title="Copy line"
          onClick={handleCopy}
          className={cn(
            'absolute right-1 top-0.5 flex h-4 w-4 items-center justify-center rounded',
            'opacity-0 group-hover:opacity-100 transition-opacity',
            'text-oc-text-muted hover:text-oc-text hover:bg-white/10',
          )}
        >
          {copied ? (
            <Check className="h-2.5 w-2.5 text-oc-green" />
          ) : (
            <Copy className="h-2.5 w-2.5" />
          )}
        </button>
      )}
    </div>
  );
}

// ── Diff Stats Bar ─────────────────────────────────────────────────────────────

function DiffStatsBar({ added, deleted }: { added: number; deleted: number }) {
  const total = added + deleted;
  if (total === 0) return null;
  const segments = Math.min(5, total);
  const addedSegs = Math.round((added / total) * segments);
  const deletedSegs = segments - addedSegs;

  return (
    <div className="flex items-center gap-1" title={`+${added} / -${deleted}`}>
      {Array.from({ length: addedSegs }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: decorative segments have no unique id
        <span key={`a-${i}`} className="h-2 w-2 rounded-sm bg-oc-green opacity-80" />
      ))}
      {Array.from({ length: deletedSegs }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: decorative segments have no unique id
        <span key={`d-${i}`} className="h-2 w-2 rounded-sm bg-oc-red opacity-80" />
      ))}
    </div>
  );
}

// ── Diff Item ─────────────────────────────────────────────────────────────────

function DiffItem({
  file,
  isActive,
  onApprove,
  onReject,
  onActivate,
  externalExpanded,
  setExternalExpanded,
}: {
  file: DiffFile;
  isActive: boolean;
  onApprove: (path: string) => void;
  onReject: (path: string) => void;
  onActivate: () => void;
  externalExpanded?: boolean;
  setExternalExpanded?: (v: boolean) => void;
}) {
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = externalExpanded !== undefined ? externalExpanded : internalExpanded;
  const setExpanded = setExternalExpanded ?? setInternalExpanded;
  const [decided, setDecided] = useState<'approved' | 'rejected' | null>(null);
  const itemRef = useRef<HTMLButtonElement>(null);

  const { label: typeLabel, badgeVariant, Icon: TypeIcon } = getFileTypeConfig(file.type);
  const filename = file.path.split(/[\\/]/).pop() ?? file.path;
  const dirname = file.path.includes('/') || file.path.includes('\\')
    ? file.path.substring(0, file.path.lastIndexOf(file.path.includes('/') ? '/' : '\\'))
    : '';

  const allLinesAndNums = (() => {
    const nums = computeLineNumbers(file.hunks);
    const flat: string[] = [];
    for (const hunk of file.hunks) {
      flat.push(hunk.header);
      flat.push(...hunk.lines);
    }
    return flat.map((line, i) => ({ line, ...nums[i] }));
  })();

  // Scroll into view when becoming active
  useEffect(() => {
    if (isActive && itemRef.current) {
      itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isActive]);

  return (
    <button
      ref={itemRef}
      onClick={onActivate}
      type="button"
      className={cn(
        'w-full text-left rounded-lg border transition-all duration-150',
        decided === 'approved' && 'border-oc-green/30 bg-emerald-950/15',
        decided === 'rejected' && 'border-oc-red/30 bg-red-950/15',
        !decided && isActive
          ? 'border-oc-accent/40 bg-oc-accent-soft shadow-sm shadow-oc-accent/10'
          : !decided && 'border-oc-border bg-white/[0.02] hover:border-oc-border-soft hover:bg-white/[0.04]',
      )}
    >
      {/* File header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          className="flex items-center gap-2 text-left flex-1 min-w-0"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        >
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-oc-text-muted transition-transform" />
            : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-oc-text-muted transition-transform" />
          }
          <TypeIcon className={cn('h-3.5 w-3.5 flex-shrink-0', getFileTypeConfig(file.type).colorClass)} />

          <div className="min-w-0 flex-1 flex items-center gap-2">
            <span className="text-oc-xs font-mono font-medium text-oc-text truncate">{filename}</span>
            {dirname && (
              <span className="text-oc-2xs font-mono text-oc-text-muted truncate hidden sm:inline">
                {dirname}
              </span>
            )}
          </div>
        </button>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Type badge */}
          <Badge variant={badgeVariant} className="text-[9px] px-1.5 py-0 leading-4 font-mono tracking-wider uppercase">
            {typeLabel}
          </Badge>

          {/* Stats bar */}
          <DiffStatsBar added={file.added} deleted={file.deleted} />

          {/* +/- counts */}
          <div className="flex items-center gap-1 font-mono">
            {file.added > 0 && (
              <span className="flex items-center gap-0.5 text-oc-2xs text-oc-green">
                <Plus className="h-2.5 w-2.5" />{file.added}
              </span>
            )}
            {file.deleted > 0 && (
              <span className="flex items-center gap-0.5 text-oc-2xs text-oc-red">
                <Minus className="h-2.5 w-2.5" />{file.deleted}
              </span>
            )}
          </div>

          {decided ? (
            <Badge
              variant={decided === 'approved' ? 'success' : 'error'}
              className="text-[9px] px-1.5 font-mono uppercase tracking-wider"
            >
              {decided === 'approved' ? (
                <><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />Approved</>
              ) : (
                <><XCircle className="h-2.5 w-2.5 mr-0.5" />Rejected</>
              )}
            </Badge>
          ) : (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-oc-text-muted hover:bg-oc-accent-soft hover:text-oc-text"
                title="Open File"
                onClick={(e) => {
                  e.stopPropagation();
                  vscode.postMessage({ type: 'openFile', file: file.path });
                }}
              >
                <ExternalLink className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-oc-green hover:bg-emerald-950/40 hover:text-emerald-300"
                title="Approve"
                onClick={(e) => {
                  e.stopPropagation();
                  setDecided('approved');
                  onApprove(file.path);
                }}
              >
                <Check className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-oc-red hover:bg-red-950/40 hover:text-red-300"
                title="Reject"
                onClick={(e) => {
                  e.stopPropagation();
                  setDecided('rejected');
                  onReject(file.path);
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Diff content */}
      <div
        className="overflow-hidden transition-all duration-200"
        style={{
          maxHeight: expanded ? `${Math.max(120, allLinesAndNums.length * 20 + 16)}px` : 0,
          opacity: expanded ? 1 : 0,
        }}
      >
        <div className="border-t border-oc-border overflow-x-auto">
          {allLinesAndNums.length > 0 ? (
            allLinesAndNums.map(({ line, old: oldNum, new: newNum }, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no stable unique id
              <DiffLine key={`line-${i}`} line={line} oldNum={oldNum} newNum={newNum} />
            ))
          ) : (
            <div className="px-4 py-3 text-oc-2xs text-oc-text-muted italic">
              No diff content available.
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Approval Progress Bar ─────────────────────────────────────────────────────

function ApprovalProgressBar({
  total,
  approved,
  rejected,
}: {
  total: number;
  approved: number;
  rejected: number;
}) {
  if (total === 0) return null;
  const pending = total - approved - rejected;
  const approvedPct = (approved / total) * 100;
  const rejectedPct = (rejected / total) * 100;

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden flex">
        <div
          className="h-full bg-oc-green/70 transition-all duration-300"
          style={{ width: `${approvedPct}%` }}
        />
        <div
          className="h-full bg-oc-red/70 transition-all duration-300"
          style={{ width: `${rejectedPct}%` }}
        />
      </div>
      <span className="text-oc-2xs font-mono text-oc-text-muted whitespace-nowrap">
        {approved}/{total} reviewed
        {pending > 0 && <span className="text-oc-yellow"> · {pending} pending</span>}
      </span>
    </div>
  );
}

// ── Keyboard Shortcuts Hint ───────────────────────────────────────────────────

function KeyboardHint() {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-1 rounded px-1.5 py-1 text-oc-2xs text-oc-text-muted hover:text-oc-text hover:bg-white/10 transition-colors"
        title="Keyboard shortcuts"
        onClick={() => setVisible((v) => !v)}
      >
        <Keyboard className="h-3 w-3" />
        <span className="hidden sm:inline">Shortcuts</span>
      </button>
      {visible && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border border-oc-border bg-oc-panel p-3 shadow-lg text-oc-2xs">
          <div className="space-y-1.5 text-oc-text-muted">
            {[
              ['j / ↓', 'Next file'],
              ['k / ↑', 'Prev file'],
              ['Enter', 'Expand/collapse'],
              ['Esc', 'Close panels'],
              ['a', 'Approve active'],
              ['r', 'Reject active'],
            ].map(([key, desc]) => (
              <div key={key} className="flex justify-between gap-3">
                <kbd className="font-mono bg-white/10 px-1 rounded text-oc-text">{key}</kbd>
                <span>{desc}</span>
              </div>
            ))}
          </div>
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

  // Keyboard navigation
  const [activeIdx, setActiveIdx] = useState(0);
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});

  // Decisions tracking for approval bar
  const [decisions, setDecisions] = useState<Record<string, 'approved' | 'rejected'>>({});

  const handleApprove = useCallback((path: string) => {
    setDecisions((d) => ({ ...d, [path]: 'approved' }));
    vscode?.postMessage({ type: 'approveDiff', file: path });
  }, []);

  const handleReject = useCallback((path: string) => {
    setDecisions((d) => ({ ...d, [path]: 'rejected' }));
    vscode?.postMessage({ type: 'rejectDiff', file: path });
  }, []);

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

  // Compute filtered files
  const filteredFiles = filter === 'all'
    ? (data?.files ?? [])
    : (data?.files ?? []).filter((f) => (f.type ?? 'modify') === filter);

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const active = document.activeElement;
      const isInput = active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || active?.closest('.comment-popover');
      if (isInput) return;

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          setActiveIdx((i) => Math.min(i + 1, filteredFiles.length - 1));
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          setActiveIdx((i) => Math.max(i - 1, 0));
          break;
        case 'Enter': {
          e.preventDefault();
          const file = filteredFiles[activeIdx];
          if (file) {
            setExpandedMap((m) => ({ ...m, [file.path]: !m[file.path] }));
          }
          break;
        }
        case 'a': {
          const file = filteredFiles[activeIdx];
          if (file && !decisions[file.path]) {
            handleApprove(file.path);
          }
          break;
        }
        case 'r': {
          const file = filteredFiles[activeIdx];
          if (file && !decisions[file.path]) {
            handleReject(file.path);
          }
          break;
        }
        case 'Escape':
          setCommentsPanelOpen(false);
          setPendingAnchor(null);
          setPopoverPos(null);
          setCommentText('');
          break;
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [filteredFiles, activeIdx, decisions, handleApprove, handleReject]);

  // Text selection → floating comment popover
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
      setPendingAnchor({ startLine: 0, endLine: 0, selectedText, surroundingText });

      try {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const POPOVER_W = 308;
        const POPOVER_H = 160;
        const x = Math.min(Math.max(8, rect.left), window.innerWidth - POPOVER_W - 8);
        const y = Math.max(8, rect.top - POPOVER_H - 8);
        setPopoverPos({ x, y });
      } catch {
        /* ignore */
      }
    }

    function handleSelectionChange() {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.closest('.comment-popover'))) return;
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

  // Comment highlight walk
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
            mark.onclick = (e) => { e.stopPropagation(); setCommentsPanelOpen(true); };
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
  }, [comments]);

  if (!data || data.files.length === 0) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-oc-bg text-oc-text-muted text-oc-sm">
        <GitMerge className="h-8 w-8 opacity-30" />
        <span>No diff data available.</span>
      </div>
    );
  }

  const filters: { label: string; value: FilterType }[] = [
    { label: 'All', value: 'all' },
    { label: 'Created', value: 'create' },
    { label: 'Modified', value: 'modify' },
    { label: 'Deleted', value: 'delete' },
  ];

  const totalAdded = data.files.reduce((sum, f) => sum + (f.added ?? 0), 0);
  const totalDeleted = data.files.reduce((sum, f) => sum + (f.deleted ?? 0), 0);
  const approvedCount = Object.values(decisions).filter((d) => d === 'approved').length;
  const rejectedCount = Object.values(decisions).filter((d) => d === 'rejected').length;

  function handleAddComment() {
    const trimmed = commentText.trim();
    if (!trimmed || !pendingAnchor) return;
    const newComment: PlanComment = {
      id: crypto.randomUUID(),
      anchor: pendingAnchor,
      text: trimmed,
      createdAt: Date.now(),
    };
    vscode?.postMessage({ type: 'addComment', comment: newComment });
    setCommentText('');
    setPendingAnchor(null);
    setPopoverPos(null);
  }

  return (
    <div
      ref={shellRef}
      className="flex h-screen flex-col overflow-hidden bg-oc-bg text-oc-text"
    >
      {/* ── Header ── */}
      <header
        className="flex-shrink-0 border-b border-oc-border px-4 py-2.5"
        style={{ background: 'var(--oc-bg-soft)' }}
      >
        {/* Top row */}
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <div className="oc-agent-icon">
              <GitMerge className="h-3 w-3" />
            </div>
            <h1 className="text-oc-sm font-semibold text-oc-text">Diff Review</h1>
            <Badge variant="secondary" className="text-[9px] font-mono px-1.5">
              {data.files.length} file{data.files.length !== 1 ? 's' : ''}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            {/* Total stats */}
            <div className="flex items-center gap-1.5 font-mono text-oc-2xs">
              {totalAdded > 0 && (
                <span className="flex items-center gap-0.5 text-oc-green">
                  <Plus className="h-2.5 w-2.5" />{totalAdded}
                </span>
              )}
              {totalDeleted > 0 && (
                <span className="flex items-center gap-0.5 text-oc-red">
                  <Minus className="h-2.5 w-2.5" />{totalDeleted}
                </span>
              )}
            </div>

            <div className="h-3 w-px bg-oc-border" />

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCommentsPanelOpen(true)}
              className="h-7 text-oc-2xs gap-1.5 text-oc-text-muted hover:text-oc-text"
            >
              <MessageSquare className="h-3 w-3" />
              <span>Comments</span>
              {comments.length > 0 && (
                <Badge variant="secondary" className="ml-0.5 text-[9px] px-1 py-0 leading-none h-3.5">
                  {comments.length}
                </Badge>
              )}
            </Button>

            <KeyboardHint />
          </div>
        </div>

        {/* Approval progress */}
        <ApprovalProgressBar
          total={data.files.length}
          approved={approvedCount}
          rejected={rejectedCount}
        />

        {/* Filter tabs */}
        <div className="mt-2 flex gap-1">
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
                  'rounded px-2.5 py-1 text-oc-2xs font-medium transition-colors',
                  filter === f.value
                    ? 'bg-oc-accent-soft text-oc-accent border border-oc-accent/20'
                    : 'text-oc-text-muted hover:bg-white/10 hover:text-oc-text',
                )}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
                <span className="ml-1 opacity-50">({count})</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* ── File list ── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-oc-text-muted text-oc-xs">
            <FileCode className="h-6 w-6 opacity-30" />
            <span>No files match this filter.</span>
          </div>
        ) : (
          filteredFiles.map((file, i) => (
            <DiffItem
              key={`${file.path}-${i}`}
              file={file}
              isActive={i === activeIdx}
              onApprove={handleApprove}
              onReject={handleReject}
              onActivate={() => setActiveIdx(i)}
              externalExpanded={expandedMap[file.path] ?? false}
              setExternalExpanded={(v) =>
                setExpandedMap((m) => ({ ...m, [file.path]: v }))
              }
            />
          ))
        )}
      </div>

      {/* ── Floating comment popover ── */}
      {popoverPos && pendingAnchor && (
        <div
          style={{
            position: 'fixed',
            top: popoverPos.y,
            left: popoverPos.x,
            zIndex: 50,
            width: 308,
          }}
          className="comment-popover rounded-lg border border-oc-border bg-oc-panel p-3 shadow-xl"
        >
          <p className="mb-2 text-oc-2xs text-oc-text-muted italic line-clamp-2">
            &ldquo;{pendingAnchor.selectedText.length > 60
              ? `${pendingAnchor.selectedText.slice(0, 60)}…`
              : pendingAnchor.selectedText}&rdquo;
          </p>
          <Textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment… (Ctrl+Enter to submit)"
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
            className="mb-2 text-oc-xs"
            rows={2}
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-oc-2xs"
              onClick={handleAddComment}
              disabled={!commentText.trim()}
            >
              Add Comment
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-oc-2xs"
              onClick={() => {
                setPendingAnchor(null);
                setPopoverPos(null);
                setCommentText('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ── Comments slide-in panel ── */}
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
        className="flex flex-col border-l border-oc-border shadow-2xl"

      >
        <div
          className="flex flex-col h-full"
          style={{ background: 'var(--oc-bg-soft)' }}
        >
          <div className="flex items-center justify-between border-b border-oc-border px-3 py-2.5">
            <h2 className="flex items-center gap-2 text-oc-xs font-semibold text-oc-text">
              <MessageSquare className="h-3.5 w-3.5 text-oc-accent" />
              Comments
              {comments.length > 0 && (
                <span className="rounded-full bg-oc-accent-soft px-1.5 py-0.5 text-[9px] font-mono text-oc-accent">
                  {comments.length}
                </span>
              )}
            </h2>
            <button
              type="button"
              onClick={() => setCommentsPanelOpen(false)}
              className="rounded p-1 hover:bg-white/10 text-oc-text-muted hover:text-oc-text transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {comments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-oc-text-muted">
                <MessageSquare className="h-5 w-5 opacity-25" />
                <p className="text-oc-xs text-center">
                  No comments yet.<br />
                  <span className="text-oc-2xs">Highlight diff text to add one.</span>
                </p>
              </div>
            ) : (
              comments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-lg border border-oc-border bg-white/[0.03] p-2.5 text-oc-xs"
                >
                  <p className="italic text-oc-text-muted truncate mb-1.5 text-oc-2xs">
                    &ldquo;{comment.anchor.selectedText}&rdquo;
                  </p>

                  {editingId === comment.id ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="text-oc-xs"
                        rows={2}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="h-6 text-oc-2xs"
                          onClick={() => {
                            const updated = { ...comment, text: editText.trim() };
                            vscode?.postMessage({ type: 'updateComment', comment: updated });
                            setEditingId(null);
                          }}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-oc-2xs"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-oc-text mb-2 leading-relaxed">{comment.text}</p>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          className="text-oc-2xs text-oc-text-muted hover:text-oc-accent transition-colors"
                          onClick={() => { setEditingId(comment.id); setEditText(comment.text); }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-oc-2xs text-oc-text-muted hover:text-oc-red transition-colors"
                          onClick={() => vscode?.postMessage({ type: 'deleteComment', id: comment.id })}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
