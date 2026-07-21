import { useEffect, useRef, useState } from "react";
import { MessageSquare, Pencil, Play, Quote, Trash2, X } from "lucide-react";
import { marked } from "marked";

import type { PlanComment } from "@/chat/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { ThemeFileIcon } from "../components/ThemeFileIcon";
import { toWorkspaceRelativePath } from "@/utils";
import vscode from "@/chat/lib/vscode";

interface PlanEnvelope {
  raw?: string;
  title?: string;
  sourceFile?: string;
  workspaceRoot?: string;
  comments?: PlanComment[];
  planId?: string;
}

interface PositionedComment {
  id: string;
  preview: string;
  lineLabel: string;
  top: number;
}

function normalizeTitleForCompare(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, " ");
}

function stripRedundantLeadingTitle(raw: string, title: string): string {
  if (!raw.trim()) return raw;

  const lines = raw.split("\n");
  let firstContentLineIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().length > 0) {
      firstContentLineIndex = i;
      break;
    }
  }
  if (firstContentLineIndex === -1) return raw;

  const firstLine = lines[firstContentLineIndex];
  const headingMatch = firstLine.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
  if (!headingMatch?.[1]) return raw;

  const headingText = normalizeTitleForCompare(headingMatch[1]);
  const targetTitle = normalizeTitleForCompare(title);
  if (!headingText || !targetTitle || headingText !== targetTitle) return raw;

  lines.splice(firstContentLineIndex, 1);
  return lines.join("\n");
}

function normalizeCommentText(value: string | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function formatCommentLineLabel(comment: PlanComment): string {
  const { startLine, endLine } = comment.anchor;
  if (startLine < 0 || endLine < 0) return "General";
  const start = startLine + 1;
  const end = endLine + 1;
  if (start === end) return `L${start}`;
  return `L${Math.min(start, end)}-L${Math.max(start, end)}`;
}

declare global {
  interface Window {
    __PLAN_DATA__?: PlanEnvelope;
    __pendingPlanAnchor?: PlanComment["anchor"] | null;
    acquireVsCodeApi?: () => { postMessage: (msg: unknown) => void };
    postAddComment?: (comment: PlanComment, planId?: string) => void;
    postUpdateComment?: (comment: PlanComment, planId?: string) => void;
    postDeleteComment?: (id: string, planId?: string) => void;
  }
}

export default function PlanShell() {
  const envelope = window.__PLAN_DATA__;
  const rawPlan = envelope?.raw ?? "";
  const planTitle = envelope?.title?.trim() || "Implementation Plan";
  const displayedPlan = stripRedundantLeadingTitle(rawPlan, planTitle);
  const sourceFile = envelope?.sourceFile?.trim();
  const displayedSourceFile = sourceFile
    ? toWorkspaceRelativePath(sourceFile, envelope?.workspaceRoot)
    : "";
  const planId = envelope?.planId?.trim() || planTitle;

  const [executing, setExecuting] = useState(false);
  const [proceedError, setProceedError] = useState<string | null>(null);
  const [comments, setComments] = useState<PlanComment[]>(
    envelope?.comments ?? [],
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [positionedComments, setPositionedComments] = useState<
    PositionedComment[]
  >([]);
  const planSurfaceRef = useRef<HTMLDivElement | null>(null);
  const planContentRef = useRef<HTMLDivElement | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<
    PlanComment["anchor"] | null
  >(null);
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [commentText, setCommentText] = useState("");

  useEffect(() => {
    function handler(e: MessageEvent) {
      const data = e.data as
        | {
            type?: string;
            comments?: PlanComment[];
            ok?: boolean;
            message?: string;
          }
        | undefined;
      if (data?.type === "commentsUpdated") setComments(data.comments ?? []);
      if (data?.type === "planProceedStatus" && data.ok === false) {
        setExecuting(false);
        setProceedError(data.message || "Failed to start plan execution.");
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  useEffect(() => {
    window.postAddComment = (comment: PlanComment) =>
      vscode?.postMessage({ type: "addComment", comment, planId });
    window.postUpdateComment = (comment: PlanComment) =>
      vscode?.postMessage({ type: "updateComment", comment, planId });
    window.postDeleteComment = (id: string) =>
      vscode?.postMessage({ type: "deleteComment", id, planId });
    return () => {
      try {
        delete window.postAddComment;
        delete window.postUpdateComment;
        delete window.postDeleteComment;
      } catch {
        /* ignore */
      }
    };
  }, [planId]);

  useEffect(() => {
    window.__pendingPlanAnchor = pendingAnchor ?? null;
  }, [pendingAnchor]);

  const renderedHtml = marked(displayedPlan) as string;

  function focusPlanAnchor(commentId: string) {
    const container = planContentRef.current;
    if (!container) return;
    const anchorEl =
      (container.querySelector(
        `mark[data-comment-id="${commentId}"]`,
      ) as HTMLElement | null) ||
      (container.querySelector(
        `[data-plan-comment-anchor="${commentId}"]`,
      ) as HTMLElement | null);
    if (!anchorEl) return;

    anchorEl.scrollIntoView({ block: "center", behavior: "smooth" });
    anchorEl.classList.add(
      "ring-2",
      "ring-[color-mix(in_srgb,#7dd3fc_72%,transparent)]",
      "shadow-[0_0_0_2px_color-mix(in_srgb,#7dd3fc_48%,transparent)]",
    );
    window.setTimeout(() => {
      anchorEl.classList.remove(
        "ring-2",
        "ring-[color-mix(in_srgb,#7dd3fc_72%,transparent)]",
        "shadow-[0_0_0_2px_color-mix(in_srgb,#7dd3fc_48%,transparent)]",
      );
    }, 1200);
  }

  function revealComment(commentId: string) {
    setActiveCommentId(commentId);
    setCommentsPanelOpen(true);
    focusPlanAnchor(commentId);
    setTimeout(() => {
      const commentCard = document.querySelector(
        `[data-comment-id="${commentId}"]`,
      );
      commentCard?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 180);
  }

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

      const surroundingText =
        sel.getRangeAt(0).commonAncestorContainer.textContent || "";
      const idx = rawPlan.indexOf(selectedText);
      const startLine =
        idx !== -1 ? rawPlan.slice(0, idx).split("\n").length - 1 : 0;
      const endLine =
        idx !== -1
          ? rawPlan.slice(0, idx + selectedText.length).split("\n").length - 1
          : 0;

      setPendingAnchor({ startLine, endLine, selectedText, surroundingText });

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
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.closest(".comment-popover"))
      ) {
        return;
      }

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setPendingAnchor(null);
        setPopoverPos(null);
      }
    }

    const container = planContentRef.current;
    if (container) {
      container.addEventListener("mouseup", computeAnchorFromSelection);
      container.addEventListener("keyup", computeAnchorFromSelection);
    }
    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      if (container) {
        container.removeEventListener("mouseup", computeAnchorFromSelection);
        container.removeEventListener("keyup", computeAnchorFromSelection);
      }
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [rawPlan]);

  useEffect(() => {
    const container = planContentRef.current;
    const surface = planSurfaceRef.current;
    if (!container || !surface) return;

    function clearAnchorState() {
      const elements = container.querySelectorAll("[data-plan-comment-anchor]");
      elements.forEach((el) => {
        const element = el as HTMLElement;
        element.classList.remove(
          "bg-[color-mix(in_srgb,#93c5fd_14%,transparent)]",
          "ring-1",
          "ring-[color-mix(in_srgb,#93c5fd_36%,transparent)]",
          "shadow-[inset_0_0_0_1px_color-mix(in_srgb,#93c5fd_24%,transparent)]",
          "bg-[color-mix(in_srgb,#7dd3fc_22%,transparent)]",
          "ring-[color-mix(in_srgb,#7dd3fc_50%,transparent)]",
          "shadow-[inset_0_0_0_1px_color-mix(in_srgb,#7dd3fc_38%,transparent)]",
        );
        delete element.dataset.planCommentAnchor;
      });

      const marks = container.querySelectorAll("mark[data-comment-id]");
      marks.forEach((markEl) => {
        const mark = markEl as HTMLElement;
        mark.classList.remove(
          "bg-[color-mix(in_srgb,#93c5fd_20%,transparent)]",
          "ring-[color-mix(in_srgb,#93c5fd_44%,transparent)]",
          "bg-[color-mix(in_srgb,#7dd3fc_34%,transparent)]",
          "ring-[color-mix(in_srgb,#7dd3fc_62%,transparent)]",
          "shadow-[0_0_0_1px_color-mix(in_srgb,#7dd3fc_44%,transparent)]",
        );
        mark.classList.add(
          "bg-[color-mix(in_srgb,#93c5fd_20%,transparent)]",
          "ring-[color-mix(in_srgb,#93c5fd_44%,transparent)]",
        );
      });
    }

    function getMarkdownLinePreview(comment: PlanComment): string {
      const line = rawPlan.split("\n")[comment.anchor.startLine] || "";
      return line.replace(/^[\s>*-]+/, "").trim();
    }

    function findCommentAnchorElement(comment: PlanComment): HTMLElement | null {
      const mark = container.querySelector(
        `mark[data-comment-id="${comment.id}"]`,
      ) as HTMLElement | null;
      if (mark) return mark;

      const candidates = Array.from(
        container.querySelectorAll("li, p, h1, h2, h3, h4, h5, h6, blockquote"),
      ) as HTMLElement[];

      const selectedText = normalizeCommentText(comment.anchor.selectedText);
      const surroundingText = normalizeCommentText(comment.anchor.surroundingText);
      const linePreview = normalizeCommentText(getMarkdownLinePreview(comment));

      let bestMatch: { el: HTMLElement; score: number } | null = null;

      for (const candidate of candidates) {
        const candidateText = normalizeCommentText(candidate.textContent || "");
        if (!candidateText) continue;

        let score = 0;
        if (selectedText && candidateText.includes(selectedText)) score += 5;
        if (surroundingText && candidateText.includes(surroundingText)) score += 4;
        if (linePreview && candidateText.includes(linePreview)) score += 3;

        if (!score && selectedText) {
          const selectedWords = selectedText.split(" ").filter(Boolean);
          const overlap = selectedWords.filter((word) => candidateText.includes(word));
          if (overlap.length >= Math.min(4, selectedWords.length)) {
            score += 2;
          }
        }

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = score > 0 ? { el: candidate, score } : bestMatch;
        }
      }

      return bestMatch?.el ?? null;
    }

    function applyAnchorState() {
      clearAnchorState();
      comments.forEach((comment) => {
        const selectedMark = container.querySelector(
          `mark[data-comment-id="${comment.id}"]`,
        ) as HTMLElement | null;

        if (selectedMark) {
          if (activeCommentId === comment.id) {
            selectedMark.classList.remove(
              "bg-[color-mix(in_srgb,#93c5fd_20%,transparent)]",
              "ring-[color-mix(in_srgb,#93c5fd_44%,transparent)]",
            );
            selectedMark.classList.add(
              "bg-[color-mix(in_srgb,#7dd3fc_34%,transparent)]",
              "ring-[color-mix(in_srgb,#7dd3fc_62%,transparent)]",
              "shadow-[0_0_0_1px_color-mix(in_srgb,#7dd3fc_44%,transparent)]",
            );
          }
          return;
        }

        const anchorEl = findCommentAnchorElement(comment);
        if (!anchorEl) return;
        anchorEl.dataset.planCommentAnchor = comment.id;
        anchorEl.classList.add(
          "bg-[color-mix(in_srgb,#93c5fd_14%,transparent)]",
          "ring-1",
          "ring-[color-mix(in_srgb,#93c5fd_36%,transparent)]",
          "shadow-[inset_0_0_0_1px_color-mix(in_srgb,#93c5fd_24%,transparent)]",
        );
        if (activeCommentId === comment.id) {
          anchorEl.classList.add(
            "bg-[color-mix(in_srgb,#7dd3fc_22%,transparent)]",
            "ring-[color-mix(in_srgb,#7dd3fc_50%,transparent)]",
            "shadow-[inset_0_0_0_1px_color-mix(in_srgb,#7dd3fc_38%,transparent)]",
          );
        }
      });
    }

    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue || "";
        const parent = node.parentNode;
        if (
          !parent ||
          parent.nodeName === "MARK" ||
          parent.nodeName === "SCRIPT" ||
          parent.nodeName === "STYLE"
        )
          return;

        for (const comment of comments) {
          const needle = comment.anchor.selectedText;
          if (!needle) continue;

          const idx = text.indexOf(needle);
          if (idx !== -1) {
            if (comment.anchor.surroundingText) {
              const context =
                (parent as HTMLElement).innerText || parent.textContent || "";
              if (!context.includes(comment.anchor.surroundingText)) continue;
            }

            const before = text.slice(0, idx);
            const match = text.slice(idx, idx + needle.length);
            const after = text.slice(idx + needle.length);

            const fragment = document.createDocumentFragment();
            if (before) fragment.appendChild(document.createTextNode(before));

            const mark = document.createElement("mark");
            mark.textContent = match;
            mark.className =
              "bg-[color-mix(in_srgb,#93c5fd_20%,transparent)] text-inherit cursor-pointer rounded-sm ring-1 ring-[color-mix(in_srgb,#93c5fd_44%,transparent)] hover:bg-[color-mix(in_srgb,#7dd3fc_28%,transparent)] transition-colors px-0.5 -mx-0.5";
            mark.dataset.commentId = comment.id;
            mark.title = comment.text;
            mark.onclick = (e) => {
              e.stopPropagation();
              revealComment(comment.id);
            };
            fragment.appendChild(mark);

            if (after) fragment.appendChild(document.createTextNode(after));

            parent.replaceChild(fragment, node);
            break;
          }
        }
      } else {
        const children = Array.from(node.childNodes);
        for (const child of children) {
          walk(child);
        }
      }
    };

    function measureAnnotations() {
      if (!planContentRef.current || !planSurfaceRef.current) return;
      const nextPositions: PositionedComment[] = [];
      const seenTops: number[] = [];
      comments.forEach((comment) => {
        const anchorEl = findCommentAnchorElement(comment);
        if (!anchorEl) return;
        const anchorRect = anchorEl.getBoundingClientRect();
        const surfaceRect = planSurfaceRef.current!.getBoundingClientRect();
        let top =
          anchorRect.top - surfaceRect.top + planSurfaceRef.current!.scrollTop - 2;
        while (seenTops.some((value) => Math.abs(value - top) < 28)) {
          top += 28;
        }
        seenTops.push(top);
        const previewSource = comment.text || comment.anchor.selectedText || "Comment";
        const lineLabel = formatCommentLineLabel(comment);
        nextPositions.push({
          id: comment.id,
          preview:
            previewSource.length > 42
              ? `${previewSource.slice(0, 42).trimEnd()}...`
              : previewSource,
          lineLabel,
          top,
        });
      });
      setPositionedComments(nextPositions);
    }

    const timer = setTimeout(() => {
      walk(container);
      applyAnchorState();
      measureAnnotations();
    }, 20);

    window.addEventListener("resize", measureAnnotations);
    const mainScroller = surface.closest("main");
    mainScroller?.addEventListener("scroll", measureAnnotations);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", measureAnnotations);
      mainScroller?.removeEventListener("scroll", measureAnnotations);
    };
  }, [comments, renderedHtml, activeCommentId]);

  function handleProceed() {
    if (executing) return;
    setProceedError(null);
    setExecuting(true);
    vscode?.postMessage({ type: "proceedWithPlan", rawPlan, comments, sourceFile });
  }

  function handleAddComment() {
    const trimmed = commentText.trim();
    if (!trimmed || !pendingAnchor) return;
    const newComment: PlanComment = {
      id: crypto.randomUUID(),
      anchor: pendingAnchor,
      text: trimmed,
      createdAt: Date.now(),
    };
    window.postAddComment?.(newComment);
    setCommentText("");
    setPendingAnchor(null);
    setPopoverPos(null);
    setCommentsPanelOpen(true);
  }

  return (
    <div className="plan-view-shell flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)]">
      <header className="flex-shrink-0 border-b border-[var(--vscode-panel-border)] px-6 py-5">
        <div className="mx-auto flex max-w-4xl items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center">
              <h1 className="line-clamp-2 text-xl font-semibold leading-tight">{planTitle}</h1>
            </div>
            {sourceFile ? (
              <div className="mt-2 flex items-start gap-1.5 text-xs text-oc-text-soft" title={sourceFile}>
                <ThemeFileIcon filePath={sourceFile} className="mt-px" />
                <span className="line-clamp-2 break-all">{displayedSourceFile}</span>
              </div>
            ) : (
              <p className="mt-2 text-xs italic text-[var(--vscode-descriptionForeground)]">
                (no source file)
              </p>
            )}
          </div>

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
                <Badge
                  variant="secondary"
                  className="ml-1 text-[10px] px-1.5 py-0 leading-none"
                >
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
              aria-label="Proceed"
            >
              <Play className="h-3.5 w-3.5" />
              <span>{executing ? "Proceeding…" : "Proceed"}</span>
            </Button>
          </div>
        </div>

        {proceedError ? (
          <p
            className="mt-2 text-xs text-[var(--vscode-errorForeground)]"
            role="status"
            aria-live="polite"
          >
            {proceedError}
          </p>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {displayedPlan.trim() ? (
          <div
            ref={planSurfaceRef}
            className="relative mx-auto max-w-4xl px-6 py-7 pb-12"
          >
            <MarkdownRenderer
              ref={planContentRef}
              content={renderedHtml}
              isPreParsed={true}
              className="prose prose-invert max-w-none cursor-text select-text pr-20 text-[13px] leading-7 text-[var(--vscode-editor-foreground)] [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:font-semibold [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-[var(--vscode-panel-border)] [&_pre]:bg-[color-mix(in_srgb,var(--vscode-editor-background)_74%,black_26%)] [&_pre]:p-3 [&_code]:rounded [&_code]:bg-[color-mix(in_srgb,var(--vscode-editor-background)_75%,black_25%)] [&_code]:px-1 [&_em]:italic [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:pl-5"
            />
            {positionedComments.map((comment) => (
              <button
                key={comment.id}
                type="button"
                onClick={() => revealComment(comment.id)}
                className={`absolute right-4 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-sm transition-all ${
                  activeCommentId === comment.id
                    ? "border-[color-mix(in_srgb,#7dd3fc_64%,var(--vscode-panel-border)_36%)] bg-[color-mix(in_srgb,#7dd3fc_28%,var(--vscode-editor-background)_72%)] text-[color-mix(in_srgb,#e0f2fe_82%,var(--vscode-editor-foreground)_18%)]"
                    : "border-[color-mix(in_srgb,#93c5fd_34%,var(--vscode-panel-border)_66%)] bg-[color-mix(in_srgb,#93c5fd_14%,var(--vscode-editor-background)_86%)] text-[color-mix(in_srgb,#bfdbfe_74%,var(--vscode-editor-foreground)_26%)] hover:bg-[color-mix(in_srgb,#93c5fd_20%,var(--vscode-editor-background)_80%)]"
                }`}
                style={{ top: `${comment.top}px` }}
                title={`${comment.lineLabel}: ${comment.preview}`}
              >
                <MessageSquare className="h-4 w-4" />
              </button>
            ))}
          </div>
        ) : (
          <div className="py-8 text-xs text-[var(--vscode-descriptionForeground)]">
            No plan data available.
          </div>
        )}
      </main>

      {popoverPos && pendingAnchor && (
        <div
          style={{
            position: "fixed",
            top: Math.max(8, popoverPos.y - 10),
            left: Math.min(popoverPos.x, window.innerWidth - 320),
            zIndex: 50,
            width: 300,
          }}
          className="comment-popover animate-in fade-in zoom-in-95 duration-200 rounded-md border border-[var(--vscode-panel-border)] bg-[var(--vscode-editorWidget-background,var(--vscode-editor-background))] p-4 shadow-xl"
        >
          <p className="mb-2 text-xs text-[var(--vscode-descriptionForeground)] italic line-clamp-2">
            &ldquo;
            {pendingAnchor.selectedText.length > 60
              ? `${pendingAnchor.selectedText.slice(0, 60)}…`
              : pendingAnchor.selectedText}
            &rdquo;
          </p>
          <Textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment…"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setPendingAnchor(null);
                setPopoverPos(null);
                setCommentText("");
              }
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                handleAddComment();
              }
            }}
            className="mb-2 text-xs"
            rows={3}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleAddComment}
              disabled={!commentText.trim()}
            >
              Add Comment
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPendingAnchor(null);
                setPopoverPos(null);
                setCommentText("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div
        style={{
          position: "fixed",
          right: 0,
          top: 0,
          bottom: 0,
          width: 360,
          transform: commentsPanelOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.2s ease",
          zIndex: 40,
        }}
        className="flex flex-col border-l border-[var(--vscode-panel-border)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--vscode-sideBar-background,var(--vscode-editor-background))_92%,var(--vscode-focusBorder)_8%)_0%,var(--vscode-sideBar-background,var(--vscode-editor-background))_100%)] shadow-2xl"
      >
        <div className="sticky top-0 z-10 border-b border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-sideBar-background,var(--vscode-editor-background))_90%,var(--vscode-focusBorder)_10%)] px-4 py-3 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight">
              Comments
              {comments.length > 0 && (
                <span className="ml-2 rounded-full bg-[var(--vscode-badge-background)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--vscode-badge-foreground)]">
                  {comments.length}
                </span>
              )}
            </h2>
            <button
              type="button"
              onClick={() => setCommentsPanelOpen(false)}
              className="rounded p-1 text-[var(--vscode-descriptionForeground)] transition-colors hover:bg-oc-bg hover:text-[var(--vscode-foreground)]"
              aria-label="Close comments panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-8">
          {comments.length === 0 ? (
            <div className="mt-12 flex h-full flex-col items-center justify-center space-y-3 pb-12 text-center opacity-80">
              <div className="rounded-full border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,var(--vscode-focusBorder)_15%)] p-3">
                <MessageSquare className="h-6 w-6 text-[var(--vscode-descriptionForeground)]" />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--vscode-foreground)]">
                  No comments yet
                </p>
                <p className="text-xs text-[var(--vscode-descriptionForeground)]">
                  Highlight text in the plan or use the form below to add one.
                </p>
              </div>
            </div>
          ) : (
            comments.map((comment) => {
              const lineLabel = formatCommentLineLabel(comment);
              return (
                <div
                  key={comment.id}
                  data-comment-id={comment.id}
                  onClick={() => {
                    setActiveCommentId(comment.id);
                    focusPlanAnchor(comment.id);
                  }}
                  className={`group relative rounded-[10px] border p-3.5 transition-all duration-200 ease-out cursor-default ${
                    activeCommentId === comment.id
                      ? "border-[color-mix(in_srgb,var(--vscode-focusBorder)_40%,transparent)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_95%,var(--vscode-focusBorder)_5%)] shadow-sm"
                      : "border-[color-mix(in_srgb,var(--vscode-panel-border)_50%,transparent)] bg-transparent hover:border-[color-mix(in_srgb,var(--vscode-focusBorder)_20%,var(--vscode-panel-border)_80%)] hover:bg-[color-mix(in_srgb,var(--vscode-editor-background)_98%,var(--vscode-focusBorder)_2%)]"
                  }`}
                >
                  <div className="mb-3 flex items-start gap-3">
                    <div className="min-w-0 flex-1 rounded-r border-l-[3px] border-[var(--vscode-focusBorder)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_80%,var(--vscode-focusBorder)_20%)] px-2.5 py-1.5 text-[12px] italic leading-relaxed text-[var(--vscode-descriptionForeground)]">
                      {comment.anchor.startLine === -1
                        ? "(General Feedback)"
                        : `\u201C${comment.anchor.selectedText}\u201D`}
                    </div>
                    <span className="shrink-0 rounded bg-[color-mix(in_srgb,var(--vscode-editor-background)_70%,var(--vscode-focusBorder)_30%)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--vscode-descriptionForeground)]">
                      {lineLabel}
                    </span>
                  </div>
                  <p className="mb-3 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--vscode-foreground)]">
                    {comment.text}
                  </p>

                  {editingId === comment.id ? (
                    <>
                      <label
                        htmlFor={`comment-edit-${comment.id}`}
                        className="sr-only"
                      >
                        Edit comment
                      </label>
                      <Textarea
                        id={`comment-edit-${comment.id}`}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="mb-2 text-xs"
                        rows={3}
                      />
                      <div className="flex gap-2 justify-end">
                        <Button
                          size="sm"
                          onClick={() => {
                            const trimmed = editText.trim();
                            window.postUpdateComment?.({
                              ...comment,
                              text: trimmed,
                            });
                            setEditingId(null);
                            setEditText("");
                          }}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(null);
                            setEditText("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className={`flex flex-wrap justify-end gap-1 transition-opacity ${activeCommentId === comment.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                      <button
                        type="button"
                        className="flex h-6 items-center gap-1.5 rounded px-2 text-[11px] font-medium text-[var(--vscode-descriptionForeground)] hover:bg-[var(--vscode-list-hoverBackground)] hover:text-[var(--vscode-foreground)] transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(comment.id);
                          setEditText(comment.text);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                        Edit
                      </button>
                      <button
                        type="button"
                        className="flex h-6 items-center gap-1.5 rounded px-2 text-[11px] font-medium text-[var(--vscode-descriptionForeground)] hover:bg-[color-mix(in_srgb,var(--vscode-errorForeground)_15%,transparent)] hover:text-[var(--vscode-errorForeground)] transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.postDeleteComment?.(comment.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </button>
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
