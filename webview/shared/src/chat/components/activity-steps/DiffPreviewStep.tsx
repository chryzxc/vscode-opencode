import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { ChevronDown, Copy, Diff, FileCode2, X } from "lucide-react";

import { cn } from "../../../utils";

import { ActivityDiffExcerpt } from "../ActivityDiffExcerpt";
import { usePersistentModalOpen } from "../../lib/usePersistentModalOpen";
import { ActivityStepStatusChip } from "./ActivityStepStatusChip";

import type { ActivityDetail } from "../../lib/types";

type DiffExcerpt = {
  header?: string;
  lines?: string[];
  added?: number;
  deleted?: number;
};

type DiffPreviewStepProps = {
  title?: string;
  filePath?: string;
  diffStats?: { added: number; deleted: number };
  excerpt?: DiffExcerpt;
  source?: "stream" | "final" | "raw_debug";
  status?: "pending" | "running" | "done" | "error";
  activityDetail?: ActivityDetail;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function compactPath(value?: string): string {
  const text = stringValue(value);
  if (!text) return "";
  const normalized = text.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 3) return normalized;
  return `.../${parts.slice(-3).join("/")}`;
}

function countLines(excerpt?: DiffExcerpt): { changed: number; added: number; deleted: number } {
  const lines = Array.isArray(excerpt?.lines) ? excerpt.lines : [];
  const added = typeof excerpt?.added === "number"
    ? Math.max(0, excerpt.added)
    : lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const deleted = typeof excerpt?.deleted === "number"
    ? Math.max(0, excerpt.deleted)
    : lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
  return {
    changed: added + deleted,
    added,
    deleted,
  };
}

function diffChipClass(kind: "add" | "del" | "neutral"): string {
  if (kind === "add") {
    return "text-emerald-300";
  }

  if (kind === "del") {
    return "text-rose-300";
  }

  return "oc-text-secondary";
}

function extractPatchText(detail?: ActivityDetail): string {
  const input = (detail?.input ?? {}) as Record<string, unknown>;
  const candidates = [
    input.patchText,
    input.patch,
    input.diff,
    input.diffText,
    input.patch_text,
    (detail?.metadata as Record<string, any>)?.filediff?.patch,
    (detail?.metadata as Record<string, any>)?.diff,
    detail?.output,
  ];

  for (const candidate of candidates) {
    const text = stringValue(candidate);
    if (text) {
      return text;
    }
  }

  return "";
}

function parsePatchTextToExcerpt(patchText?: string): DiffExcerpt | undefined {
  const text = stringValue(patchText);
  if (!text) {
    return undefined;
  }

  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))
    .filter((line) => line.length > 0);

  if (!lines.length) {
    return undefined;
  }

  const header = lines.find((line) => line.startsWith("@@")) || undefined;

  const diffLines = lines.filter(
    (line) =>
      !line.startsWith("*** Begin Patch") &&
      !line.startsWith("*** End Patch") &&
      !line.startsWith("*** Update File:") &&
      !line.startsWith("*** Add File:") &&
      !line.startsWith("*** Delete File:") &&
      !line.startsWith("Index: ") &&
      !line.startsWith("===================================================================") &&
      !line.startsWith("--- ") &&
      !line.startsWith("+++ "),
  );

  const previewLines = diffLines.slice(0, 40);
  const added = previewLines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
  const deleted = previewLines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;

  return {
    header,
    lines: previewLines,
    added,
    deleted,
  };
}

function DiffPreviewModal({
  isOpen,
  title,
  filePath,
  diffStats,
  excerpt,
  activityDetail,
  status,
  onClose,
}: DiffPreviewStepProps & {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const detailText = useMemo(() => {
    const payload = {
      title,
      filePath,
      diffStats,
      excerpt,
      activityDetail,
    };
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return String(payload);
    }
  }, [title, filePath, diffStats, excerpt, activityDetail]);

  if (!isOpen) {
    return null;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(detailText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
        aria-label="Close diff preview details"
      />
      <div
        className="oc-modal-shell relative z-50 flex h-[min(92vh,900px)] min-h-0 w-full max-w-5xl flex-col overflow-hidden text-foreground"
        role="dialog"
        aria-modal="true"
        aria-label={title || "Diff preview"}
      >
        <div className="oc-modal-header flex shrink-0 items-start justify-between gap-3 bg-oc-panel-soft/70 p-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{title || "Diff Preview"}</span>
            </div>
            <div className="mt-1 text-xs oc-text-secondary">
              Detailed file changes and summary
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-oc-border bg-oc-bg-soft oc-text-secondary transition-colors hover:bg-oc-panel hover:text-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex shrink-0 items-center justify-between border-b border-oc-border-soft bg-oc-bg/20 px-4 py-2">
          <div className="flex items-center gap-3 text-xs">
            <span className={diffChipClass("add")}>
              +{Math.max(0, diffStats?.added ?? excerpt?.added ?? 0)} added
            </span>
            <span className={diffChipClass("del")}>
              -{Math.max(0, diffStats?.deleted ?? excerpt?.deleted ?? 0)} deleted
            </span>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium oc-text-secondary transition-colors hover:bg-oc-panel hover:text-foreground"
          >
            <Copy className="h-3 w-3" />
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 bg-[#0d1117]">
          {activityDetail?.summary ? (
            <div className="mb-4 rounded border border-oc-border-soft bg-oc-panel-soft/40 px-3 py-2 text-xs text-oc-text-soft">
              {activityDetail.summary}
            </div>
          ) : null}

          {excerpt ? (
            <ActivityDiffExcerpt
              excerpt={{
                header: excerpt.header,
                lines: excerpt.lines || [],
              }}
            />
          ) : (
            <div className="rounded border border-oc-border-soft bg-oc-panel-soft/40 px-3 py-2 text-xs oc-text-secondary">
              No diff excerpt available.
            </div>
          )}

          {activityDetail?.output && activityDetail.output !== activityDetail.summary ? (
            <div className="mt-4 rounded border border-oc-border-soft bg-oc-panel-soft/40 px-3 py-2 font-mono text-[10px] leading-relaxed oc-text-secondary">
              {activityDetail.output}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function DiffPreviewStep({
  title,
  filePath,
  diffStats,
  excerpt,
  source,
  status,
  activityDetail,
}: DiffPreviewStepProps) {
  const [isModalOpen, setIsModalOpen] = usePersistentModalOpen(
    `diff-preview:${filePath || title || activityDetail?.id || "unknown"}`,
  );
  const derivedExcerpt = useMemo(() => {
    if (excerpt && Array.isArray(excerpt.lines) && excerpt.lines.length > 0) {
      return excerpt;
    }

    return parsePatchTextToExcerpt(extractPatchText(activityDetail));
  }, [activityDetail, excerpt]);

  const hasDiffContent =
    !!filePath ||
    !!diffStats ||
    !!derivedExcerpt ||
    !!activityDetail?.summary ||
    !!activityDetail?.output;

  if (!hasDiffContent) {
    return null;
  }

  const counts = countLines(derivedExcerpt);
  const added = Math.max(0, diffStats?.added ?? derivedExcerpt?.added ?? counts.added);
  const deleted = Math.max(0, diffStats?.deleted ?? derivedExcerpt?.deleted ?? counts.deleted);
  const summaryTitle = title || "Diff Preview";
  const previewPath = compactPath(filePath);
  const shouldCollapseExcerpt = (derivedExcerpt?.lines?.length ?? 0) > 8;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        className="group relative block w-full text-left transition-colors"
        aria-label={`Open ${summaryTitle} details`}
      >
        <div className="overflow-hidden rounded-md transition-colors hover:bg-white/[0.02]">
          {derivedExcerpt ? (
            <div
              className={cn(
                "relative overflow-hidden",
                shouldCollapseExcerpt ? "max-h-[180px]" : "max-h-none",
              )}
            >
              <ActivityDiffExcerpt excerpt={derivedExcerpt} />
              {shouldCollapseExcerpt ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-oc-bg via-oc-bg/90 to-transparent flex items-end justify-center pb-2">
                   <div className="rounded-full bg-oc-bg-soft px-2 py-0.5 text-[10px] text-oc-text-soft shadow-sm border border-oc-border-soft flex items-center gap-1">
                     <ChevronDown className="h-3 w-3" />
                     <span>View full diff</span>
                   </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </button>

      <DiffPreviewModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={summaryTitle}
        filePath={filePath}
        diffStats={diffStats}
        excerpt={derivedExcerpt}
        activityDetail={activityDetail}
      />
    </>
  );
}
