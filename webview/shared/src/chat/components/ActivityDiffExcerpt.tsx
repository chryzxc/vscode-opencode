import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/utils";

type DiffExcerpt = {
  header?: string;
  lines: string[];
};

function parseHunkHeader(header: string): { oldStart: number; newStart: number } {
  const m = header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (m) return { oldStart: parseInt(m[1], 10), newStart: parseInt(m[2], 10) };
  return { oldStart: 1, newStart: 1 };
}

function computeLineNumbers(
  header: string | undefined,
  lines: string[],
): Array<{ old: number | null; new: number | null; line: string; isHeader: boolean }> {
  const result: Array<{ old: number | null; new: number | null; line: string; isHeader: boolean }> = [];
  const parsedHeader = typeof header === "string" ? header.trim() : "";
  if (parsedHeader.length > 0) {
    result.push({ old: null, new: null, line: parsedHeader, isHeader: true });
  }
  const { oldStart, newStart } =
    parsedHeader.length > 0 ? parseHunkHeader(parsedHeader) : { oldStart: 1, newStart: 1 };
  let oldN = oldStart;
  let newN = newStart;
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      result.push({ old: null, new: newN++, line, isHeader: false });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      result.push({ old: oldN++, new: null, line, isHeader: false });
    } else {
      result.push({ old: oldN++, new: newN++, line, isHeader: false });
    }
  }
  return result;
}

function DiffLine({
  line,
  oldNum,
  newNum,
  isHeader,
}: {
  line: string;
  oldNum: number | null;
  newNum: number | null;
  isHeader: boolean;
}) {
  const isAdded = !isHeader && line.startsWith("+") && !line.startsWith("+++");
  const isRemoved = !isHeader && line.startsWith("-") && !line.startsWith("---");
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = isHeader ? line : line.slice(1);
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);
  };

  return (
    <div
      className={cn(
        "group relative flex min-w-0 font-medium text-[11px] leading-relaxed",
        isAdded && "oc-diff-line-added",
        isRemoved && "oc-diff-line-removed",
        isHeader && "oc-diff-line-header",
        !isAdded && !isRemoved && !isHeader && "oc-diff-line-neutral",
      )}
    >
      <div
        className={cn(
          "flex select-none flex-shrink-0 items-center gap-0 border-r border-oc-border-soft",
        )}
        style={{ minWidth: 64 }}
      >
        <span
          className={cn(
            "inline-block w-8 py-0.5 pr-1.5 text-right",
            isRemoved ? "text-oc-red/70" : "text-oc-text-muted opacity-40",
          )}
        >
          {oldNum ?? ""}
        </span>
        <span
          className={cn(
            "inline-block w-8 py-0.5 pr-1.5 text-right",
            isAdded ? "text-oc-green/70" : "text-oc-text-muted opacity-40",
          )}
        >
          {newNum ?? ""}
        </span>
      </div>

      <div
        className={cn(
          "flex w-5 flex-shrink-0 select-none items-center justify-center border-r border-oc-border-soft py-0.5 font-semibold",
          isAdded && "text-oc-green",
          isRemoved && "text-oc-red",
          isHeader && "text-oc-accent",
          !isAdded && !isRemoved && !isHeader && "text-oc-text-muted opacity-30",
        )}
      >
        {isAdded ? "+" : isRemoved ? "-" : isHeader ? "." : " "}
      </div>

      <div
        className={cn(
          "flex-1 overflow-x-auto whitespace-pre px-2.5 py-0.5",
          isAdded && "text-oc-green",
          isRemoved && "text-oc-red",
          isHeader && "font-semibold text-oc-accent",
          !isAdded && !isRemoved && !isHeader && "text-oc-text opacity-75",
        )}
      >
        {isHeader ? line : line.slice(1)}
      </div>

      {!isHeader && (
        <button
          type="button"
          title="Copy line"
          onClick={handleCopy}
          className={cn(
            "absolute right-1 top-0.5 flex h-4 w-4 items-center justify-center rounded",
            "opacity-0 transition-opacity group-hover:opacity-100",
            "text-oc-text-muted hover:bg-oc-bg hover:text-oc-text",
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

export function ActivityDiffExcerpt({ excerpt }: { excerpt: DiffExcerpt }) {
  const rows = useMemo(
    () => computeLineNumbers(excerpt.header, Array.isArray(excerpt.lines) ? excerpt.lines : []),
    [excerpt.header, excerpt.lines],
  );

  if (!rows.length) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded border border-oc-border-soft bg-oc-bg">
      <div className="overflow-x-auto">
        <div className="min-w-[420px]">
          {rows.map((row, index) => (
            <DiffLine
              // biome-ignore lint/suspicious/noArrayIndexKey: diff excerpts are short and can include duplicate lines
              key={`row-${index}`}
              line={row.line}
              oldNum={row.old}
              newNum={row.new}
              isHeader={row.isHeader}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

