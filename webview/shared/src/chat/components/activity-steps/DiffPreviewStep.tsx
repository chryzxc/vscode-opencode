import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { ChevronDown, Copy, Diff, FileCode2, X } from "lucide-react";

import { ActivityDiffExcerpt } from "../ActivityDiffExcerpt";
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

  const header =
    lines.find((line) =>
      line.startsWith("@@") ||
      line.startsWith("diff --git") ||
      line.startsWith("Index:") ||
      line.startsWith("*** Update File:") ||
      line.startsWith("*** Add File:") ||
      line.startsWith("*** Delete File:"),
    ) || undefined;

  const diffLines = lines.filter(
    (line) =>
      !line.startsWith("*** Begin Patch") &&
      !line.startsWith("*** End Patch") &&
      !line.startsWith("*** Update File:") &&
      !line.startsWith("*** Add File:") &&
      !line.startsWith("*** Delete File:"),
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

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-oc-border-soft bg-oc-bg/20 p-3">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-2 rounded-md border border-oc-border bg-oc-bg-soft px-3 py-1.5 text-xs font-medium oc-text-secondary transition-colors hover:bg-oc-panel hover:text-foreground"
          >
            <Copy className="h-3.5 w-3.5" />
            <span>{copied ? "Copied" : "Copy Details"}</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <div className="grid gap-3 lg:grid-cols-[1fr_0.95fr]">
            <section className="rounded-lg border border-oc-border-soft bg-oc-bg/20 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-oc-border-soft bg-oc-bg-soft text-oc-text-secondary">
                  <Diff className="h-3 w-3" />
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] oc-text-secondary">
                  Diff Summary
                </span>
              </div>

              <div className="space-y-2 text-[11px] leading-relaxed">
                <div>
                  <span className="oc-text-secondary">File:</span>{" "}
                  <span className="font-medium text-oc-text-soft">
                    {compactPath(filePath) || "Unavailable"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={diffChipClass("add")}>
                    +{Math.max(0, diffStats?.added ?? excerpt?.added ?? 0)}
                  </span>
                  <span className={diffChipClass("del")}>
                    -{Math.max(0, diffStats?.deleted ?? excerpt?.deleted ?? 0)}
                  </span>
                  <span className={diffChipClass("neutral")}>
                    {countLines(excerpt).changed} changed
                  </span>
                </div>
                {activityDetail?.summary ? (
                  <div className="rounded-md border border-oc-border-soft bg-oc-panel-soft/40 px-2.5 py-2 text-[11px] text-oc-text-soft">
                    {activityDetail.summary}
                  </div>
                ) : null}
                {activityDetail?.output ? (
                  <div className="rounded-md border border-oc-border-soft bg-oc-panel-soft/40 px-2.5 py-2 text-[10px] leading-relaxed oc-text-secondary">
                    {activityDetail.output}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-lg border border-oc-border-soft bg-oc-bg/20 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-oc-border-soft bg-oc-bg-soft text-oc-text-secondary">
                  <FileCode2 className="h-3 w-3" />
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.18em] oc-text-secondary">
                  Diff Excerpt
                </span>
              </div>
              {excerpt ? (
                <ActivityDiffExcerpt
                  excerpt={{
                    header: excerpt.header,
                    lines: excerpt.lines || [],
                  }}
                />
              ) : (
                <div className="rounded-md border border-oc-border-soft bg-oc-panel-soft/40 px-2.5 py-2 text-[11px] oc-text-secondary">
                  No diff excerpt available.
                </div>
              )}
            </section>
          </div>
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
  const [isModalOpen, setIsModalOpen] = useState(false);
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
        className="oc-timeline-surface oc-timeline-soft-frame group relative block w-full overflow-hidden text-left transition-colors"
        aria-label={`Open ${summaryTitle} details`}
      >
        <div className="oc-diff-preview-step">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-oc-border-soft bg-oc-bg-soft text-oc-text-secondary">
                  <Diff className="h-3 w-3" />
                </span>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-oc-text-secondary">
                  diff
                </span>
                {status ? <ActivityStepStatusChip status={status} /> : null}
                {source === "raw_debug" ? (
                  <span className="rounded-full border border-oc-border-soft bg-oc-bg/30 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] oc-text-secondary">
                    raw
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                {previewPath ? (
                  <span className="font-medium text-oc-text-soft">
                    {previewPath}
                  </span>
                ) : null}
                <span className={diffChipClass(added > 0 ? "add" : "neutral")}>
                  +{added}
                </span>
                <span className={diffChipClass(deleted > 0 ? "del" : "neutral")}>
                  -{deleted}
                </span>
              </div>

              <div className="oc-diff-preview-step__excerpt relative">
                {derivedExcerpt ? (
                  <div
                    className={cn(
                      "relative overflow-hidden rounded-lg",
                      shouldCollapseExcerpt ? "max-h-[180px]" : "max-h-none",
                    )}
                  >
                    <ActivityDiffExcerpt excerpt={derivedExcerpt} />
                    {shouldCollapseExcerpt ? (
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-oc-bg via-oc-bg/90 to-transparent" />
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="oc-timeline-caret pointer-events-none mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full">
              <ChevronDown className="h-3 w-3 oc-text-secondary" />
            </div>
          </div>
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
