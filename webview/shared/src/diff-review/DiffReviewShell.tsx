import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileCode,
  GitMerge,
  Minus,
  Plus,
  X
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

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
}

// Extend window
declare global {
  interface Window {
    __DIFF_DATA__?: DiffData;
  }
}

const vscode = window.acquireVsCodeApi?.();

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

  if (!data || data.files.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--vscode-editor-background)] text-[var(--vscode-descriptionForeground)] text-sm">
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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)]">
      {/* Header */}
      <header className="flex-shrink-0 border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background,var(--vscode-editor-background))] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-[var(--vscode-focusBorder)]" />
            <h1 className="text-sm font-semibold">Diff Review</h1>
            <Badge variant="secondary" className="text-[10px]">
              {data.files.length} file{data.files.length !== 1 ? 's' : ''}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono">
            {totalAdded > 0 && (
              <span className="text-emerald-400">+{totalAdded}</span>
            )}
            {totalDeleted > 0 && (
              <span className="text-red-400">-{totalDeleted}</span>
            )}
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
    </div>
  );
}
