import { useEffect, useRef, useState } from "react";
import { MessageSquare, Play, Shield, X } from "lucide-react";

import type { PlanComment } from "@/chat/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { renderMarkdown } from "./markdownRenderer";
import { getFilename } from "@/utils";

interface PlanEnvelope {
  raw?: string;
  title?: string;
  sourceFile?: string;
  comments?: PlanComment[];
  planId?: string;
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

import vscode from "@/chat/lib/vscode";

export default function PlanShell() {
  const envelope = window.__PLAN_DATA__;
  const rawPlan = envelope?.raw ?? "";
  const planTitle = envelope?.title?.trim() || "Implementation Plan";
  const sourceFile = envelope?.sourceFile?.trim();
  const planId = envelope?.planId?.trim() || planTitle;

  const [executing, setExecuting] = useState(false);
  const [proceedError, setProceedError] = useState<string | null>(null);

  const [comments, setComments] = useState<PlanComment[]>(
    envelope?.comments ?? [],
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);

  const planContentRef = useRef<HTMLDivElement | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<
    PlanComment["anchor"] | null
  >(null);
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [commentText, setCommentText] = useState("");
  const [generalCommentText, setGeneralCommentText] = useState("");

  // Listen for commentsUpdated messages from the extension
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

  // Expose postAddComment / postUpdateComment / postDeleteComment globals
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

  const renderedHtml = renderMarkdown(rawPlan);

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

      // We capture surrounding text (parent paragraph/div) to disambiguate highlights later.
      const surroundingText =
        sel.getRangeAt(0).commonAncestorContainer.textContent || "";

      // We calculate line numbers relative to the raw markdown for the LLM prompt,
      // but note that this index-search on raw markdown can be brittle if
      // the selection comes from a formatted text block (e.g. bold/italic).
      // We keep it as a best-effort fallback, but the highlight system now uses text context.
      const idx = rawPlan.indexOf(selectedText);
      const startLine =
        idx !== -1 ? rawPlan.slice(0, idx).split("\n").length - 1 : 0;
      const endLine =
        idx !== -1
          ? rawPlan.slice(0, idx + selectedText.length).split("\n").length - 1
          : 0;

      setPendingAnchor({ startLine, endLine, selectedText, surroundingText });

      // Position popover near the selection
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
      // If the user is typing/clicking inside the popover (textarea or buttons),
      // the selection might collapse, but we shouldn't dismiss the popover.
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.closest(".comment-popover"))
      ) {
        return;
      }

      const sel = window.getSelection();
      // Only hide the popover when the selection is cleared
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

  // Inline highlights for comments
  useEffect(() => {
    const container = planContentRef.current;
    if (!container || !comments.length) return;

    // Reset: The markdown renders clean via React, but we might want to be explicit
    // if we were mutating the same DOM. Since renderedHtml is a dependency of this
    // fragment's parent, it's mostly handled.

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

        // Try to find any comment that matches this text node
        // We use a simple approach: if the exact selectedText is present, we wrap it.
        // NOTE: This might highlight multiple occurrences if the text is generic.
        for (const comment of comments) {
          const needle = comment.anchor.selectedText;
          if (!needle) continue;

          const idx = text.indexOf(needle);
          if (idx !== -1) {
            // Disambiguation check: if the comment has surroundingText, verify that
            // this text node's environment matches that context.
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
              "bg-amber-500/30 text-inherit cursor-pointer rounded-sm hover:bg-amber-500/50 transition-colors px-0.5 -mx-0.5";
            mark.dataset.commentId = comment.id;
            mark.title = comment.text;
            mark.onclick = (e) => {
              e.stopPropagation();
              setCommentsPanelOpen(true);
              // We could also scroll to the comment in the sidebar here if we wanted
            };
            fragment.appendChild(mark);

            if (after) fragment.appendChild(document.createTextNode(after));

            parent.replaceChild(fragment, node);
            // After replacement, we stop processing this node but the fragment might contain
            // more text that needs processing (if we had multiple comments in one node).
            // For simplicity, we just process one highlight per node per pass.
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

    // Small delay to ensure renderMarkdown has finished and DOM is stable
    const timer = setTimeout(() => walk(container), 20);
    return () => clearTimeout(timer);
  }, [comments]);

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

  function handleAddGeneralComment() {
    const trimmed = generalCommentText.trim();
    if (!trimmed) return;
    const newComment: PlanComment = {
      id: crypto.randomUUID(),
      anchor: { startLine: -1, endLine: -1, selectedText: "" },
      text: trimmed,
      createdAt: Date.now(),
    };
    window.postAddComment?.(newComment);
    setGeneralCommentText("");
  }

  return (
    <div className="plan-view-shell flex h-screen flex-col overflow-hidden bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)]">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background,var(--vscode-editor-background))] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          {/* Left: title + description */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="h-4 w-4 flex-shrink-0 text-[var(--vscode-focusBorder)]" />
              <h1 className="truncate text-xs font-semibold">{planTitle}</h1>
            </div>
            {sourceFile ? (
              <p className="truncate font-mono text-[10px] text-[var(--vscode-descriptionForeground)]" title={sourceFile}>
                Source: {sourceFile}
              </p>
            ) : (
              <p className="truncate font-mono text-[10px] text-[var(--vscode-descriptionForeground)]/50 italic">
                (no source file)
              </p>
            )}
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

      {/* ─── Main scroll area ────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-6 py-4">
        {rawPlan.trim() ? (
          <MarkdownRenderer
            ref={planContentRef}
            content={renderedHtml}
            isPreParsed={true}
            className="prose prose-invert max-w-none text-xs leading-relaxed text-[var(--vscode-editor-foreground)] select-text cursor-text mb-6 [&_h1]:text-base [&_h1]:font-bold [&_h1]:mb-3 [&_h2]:text-xs [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mb-1.5 [&_pre]:bg-white/5 [&_pre]:rounded [&_pre]:p-3 [&_pre]:overflow-x-auto [&_code]:bg-oc-bg [&_code]:px-1 [&_code]:rounded [&_pre_code]:bg-transparent [&_pre_code]:px-0 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:mb-0.5 [&_p]:mb-2 [&_strong]:font-semibold [&_em]:italic"
          />
        ) : (
          <div className="py-8 text-xs text-[var(--vscode-descriptionForeground)]">
            No plan data available.
          </div>
        )}
      </main>

      {/* ─── Floating comment popover ─────────────────────────────────── */}
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

      {/* ─── Comments panel (slide-in overlay) ──────────────────────────── */}
      <div
        style={{
          position: "fixed",
          right: 0,
          top: 0,
          bottom: 0,
          width: 320,
          transform: commentsPanelOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.2s ease",
          zIndex: 40,
        }}
        className="flex flex-col border-l border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background,var(--vscode-editor-background))] shadow-xl"
      >
        {/* Panel header */}
        <div className="flex items-center justify-between border-b border-[var(--vscode-panel-border)] px-3 py-2.5">
          <h2 className="text-xs font-semibold">
            Comments
            {comments.length > 0 && (
              <span className="ml-2 rounded-full bg-oc-bg px-1.5 py-0.5 text-[10px] font-mono">
                {comments.length}
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={() => setCommentsPanelOpen(false)}
            className="rounded p-1 hover:bg-oc-bg text-[var(--vscode-descriptionForeground)]"
            aria-label="Close comments panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Panel body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {comments.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-70 mt-12 pb-12">
              <div className="bg-white/5 p-3 rounded-full">
                <MessageSquare className="h-6 w-6 text-[var(--vscode-descriptionForeground)]" />
              </div>
              <div>
                <p className="text-xs font-medium text-[var(--vscode-foreground)] mb-1">No comments yet</p>
                <p className="text-xs text-[var(--vscode-descriptionForeground)]">
                  Highlight text in the plan or use the form below to add one.
                </p>
              </div>
            </div>
          ) : (
            comments.map((comment) => {
              const isStale = comment.anchor.startLine !== -1 && !rawPlan.includes(
                comment.anchor.selectedText || "",
              );
              return (
                <div
                  key={comment.id}
                  className={`relative rounded-md border border-[var(--vscode-panel-border)] p-3 shadow-sm text-xs transition-all duration-300 ease-in-out ${
                    comment.resolved ? "opacity-50 grayscale bg-transparent" : "bg-oc-bg-soft hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="italic text-[var(--vscode-descriptionForeground)] truncate flex-1">
                      {comment.anchor.startLine === -1
                        ? "(General Feedback)"
                        : `\u201C${comment.anchor.selectedText}\u201D`}
                    </p>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {isStale && (
                        <Badge
                          variant="secondary"
                          className="text-[10px]"
                        >
                          Stale
                        </Badge>
                      )}
                      {comment.resolved && (
                        <Badge
                          variant="outline"
                          className="text-[10px] text-green-500 border-green-500/30"
                        >
                          Resolved
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className={`mb-2 ${comment.resolved ? "text-[var(--vscode-descriptionForeground)] line-through" : "text-[var(--vscode-editor-foreground)]"}`}>
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
                      <div className="flex gap-2">
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
                          variant="outline"
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
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          window.postUpdateComment?.({
                            ...comment,
                            resolved: !comment.resolved,
                          })
                        }
                      >
                        {comment.resolved ? "Unresolve" : "Resolve"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingId(comment.id);
                          setEditText(comment.text);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.postDeleteComment?.(comment.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* General Comment Input */}
        <div className="border-t border-[var(--vscode-panel-border)] p-3 bg-[var(--vscode-editor-background)]">
          <Textarea
            value={generalCommentText}
            onChange={(e) => setGeneralCommentText(e.target.value)}
            placeholder="Add general feedback..."
            className="mb-2 text-xs"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                handleAddGeneralComment();
              }
            }}
          />
          <Button
            size="sm"
            className="w-full"
            onClick={handleAddGeneralComment}
            disabled={!generalCommentText.trim()}
          >
            Add General Comment
          </Button>
        </div>
      </div>
    </div>
  );
}
