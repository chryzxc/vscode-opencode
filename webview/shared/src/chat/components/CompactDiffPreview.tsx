import { useMemo } from "react";
import { cn } from "@/utils";

type DiffExcerpt = {
  header?: string;
  lines?: string[];
  added?: number;
  deleted?: number;
};

interface CompactDiffPreviewProps {
  excerpt?: DiffExcerpt;
  maxLines?: number;
  filePath?: string;
}

/**
 * Compact diff preview component for stepper items
 * Shows 3-5 representative lines of code changes
 * Falls back to diff stats if lines are not available
 */
export function CompactDiffPreview({
  excerpt,
  maxLines = 5,
  filePath,
}: CompactDiffPreviewProps) {
  if (!excerpt) {
    return null;
  }

  // Fallback: if no lines but we have diff stats, show a minimal indicator
  const hasLines = Array.isArray(excerpt.lines) && excerpt.lines.length > 0;
  const hasDiffStats = typeof excerpt.added === 'number' || typeof excerpt.deleted === 'number';

  if (!hasLines && !hasDiffStats) {
    return null;
  }

  // Fallback rendering when lines aren't available
  if (!hasLines && hasDiffStats) {
    return (
      <div className="oc-compact-diff-preview mt-2">
        <div className="oc-compact-diff-stats flex items-center gap-3 text-xs font-mono px-1.5 py-1 rounded bg-oc-bg/30 border border-oc-border/40">
          {filePath && (
            <span className="text-oc-text-muted truncate">{filePath}</span>
          )}
          <div className="flex items-center gap-2 ml-auto">
            {typeof excerpt.added === 'number' && excerpt.added > 0 && (
              <span className="text-oc-green flex items-center gap-1">
                <span>+</span>
                <span>{excerpt.added}</span>
              </span>
            )}
            {typeof excerpt.deleted === 'number' && excerpt.deleted > 0 && (
              <span className="text-oc-red flex items-center gap-1">
                <span>-</span>
                <span>{excerpt.deleted}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  const processedLines = useMemo(() => {
    const lines = excerpt.lines.slice(0, maxLines);
    const totalLines = excerpt.lines.length;
    const hasMore = totalLines > maxLines;

    // Separate additions and deletions for better representation
    const additions = lines.filter(line => line.startsWith('+') && !line.startsWith('+++'));
    const deletions = lines.filter(line => line.startsWith('-') && !line.startsWith('---'));

    // Smart selection: show mix of additions and deletions
    let selectedLines: string[] = [];

    if (totalLines <= maxLines) {
      // Small diff: show all lines
      selectedLines = lines;
    } else {
      // Larger diff: show representative sample
      const additionSample = additions.slice(0, 2);
      const deletionSample = deletions.slice(0, 2);
      const contextLines = lines.filter(line =>
        !line.startsWith('+') && !line.startsWith('-') && !line.startsWith('@@')
      ).slice(0, 1);

      selectedLines = [
        ...contextLines,
        ...deletionSample,
        ...additionSample
      ].slice(0, maxLines - 1);
    }

    return {
      lines: selectedLines,
      hasMore,
      remainingCount: totalLines - selectedLines.length,
      totalAdditions: excerpt.added || additions.length,
      totalDeletions: excerpt.deleted || deletions.length,
    };
  }, [excerpt.lines, excerpt.added, excerpt.deleted, maxLines]);

  if (processedLines.lines.length === 0) {
    return null;
  }

  return (
    <div className="oc-compact-diff-preview mt-2">
      {/* Diff lines */}
      <div className="oc-compact-diff-lines space-y-0.5">
        {processedLines.lines.map((line, index) => {
          const isAdded = line.startsWith('+') && !line.startsWith('+++');
          const isRemoved = line.startsWith('-') && !line.startsWith('---');
          const isContext = !isAdded && !isRemoved;

          return (
            <div
              key={`line-${index}`}
              className={cn(
                "oc-diff-line group relative flex min-w-0 items-start gap-1.5 font-mono text-[10px] leading-tight py-0.5 px-1.5 rounded",
                 "border border-transparent transition-colors",
                 // Operation type-specific styling
                 isAdded && "bg-emerald-950/20 border-emerald-950/30 text-emerald-300",
                 isRemoved && "bg-red-950/20 border-red-950/30 text-red-300",
                 isContext && "bg-oc-bg/40 border-oc-border-soft text-oc-text-muted",
               )}
            >
              {/* Diff indicator */}
              <span
                className={cn(
                  "flex-shrink-0 font-semibold select-none",
                  isAdded && "text-oc-green",
                  isRemoved && "text-oc-red",
                  isContext && "text-oc-text-muted opacity-50"
                )}
              >
                {isAdded ? '+' : isRemoved ? '-' : ' '}
              </span>

              {/* Code content */}
              <span className="flex-1 overflow-x-auto whitespace-pre break-all">
                {isAdded || isRemoved ? line.slice(1) : line}
              </span>

              {/* Hover effect for technical precision */}
              <div className={cn(
                "absolute inset-0 rounded pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity",
                "border border-current opacity-10",
              )} />
            </div>
          );
        })}
      </div>

      {/* More indicator */}
      {processedLines.hasMore && (
        <div className="oc-compact-diff-more mt-1.5 flex items-center justify-between">
          <span className="text-[9px] font-mono text-oc-text-muted uppercase tracking-wide">
            {processedLines.remainingCount > 0 && (
              <>
                {processedLines.totalAdditions > 0 && (
                  <span className="text-oc-green mr-1">+{processedLines.totalAdditions}</span>
                )}
                {processedLines.totalDeletions > 0 && (
                  <span className="text-oc-red mr-1">-{processedLines.totalDeletions}</span>
                )}
                <span className="opacity-75">more lines</span>
              </>
            )}
          </span>

          {filePath && (
            <span
              className={cn(
                "text-[9px] font-mono text-oc-accent hover:underline cursor-pointer",
                "transition-colors"
              )}
            >
              View diff
            </span>
          )}
        </div>
      )}
    </div>
  );
}
