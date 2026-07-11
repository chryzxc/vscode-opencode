import { useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import hljs from "highlight.js";

export type CodeSelectionPreviewData = {
  path?: string;
  filename?: string;
  languageId?: string;
  lineInfo?: string;
  content: string;
  startLine?: number;
  endLine?: number;
};

type CodeSelectionPreviewModalProps = {
  isOpen: boolean;
  data: CodeSelectionPreviewData | null;
  onClose: () => void;
};

function buildLineLabel(data: CodeSelectionPreviewData): string {
  const start = data.startLine;
  const end = data.endLine;
  if (!start && !end) return data.lineInfo ?? "";
  if (start && end && start !== end) return `${start}-${end}`;
  return `${start ?? end ?? ""}`;
}

function buildTitle(data: CodeSelectionPreviewData): string {
  const name = data.filename ?? data.path ?? "code-selection";
  const lines = buildLineLabel(data);
  return lines ? `${name}:${lines}` : name;
}

export function CodeSelectionPreviewModal({
  isOpen,
  data,
  onClose,
}: CodeSelectionPreviewModalProps) {
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

  const highlightedHtml = useMemo(() => {
    if (!data?.content) return "";
    const code = data.content;
    const lang = data.languageId;
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
    } catch {
    }
    try {
      return hljs.highlightAuto(code).value;
    } catch {
      return code;
    }
  }, [data]);

  if (!isOpen || !data) {
    return null;
  }

  const title = buildTitle(data);
  const languageBadge = data.languageId || "text";

  const modalContent = (
    <div className="oc-image-preview-shell">
      <button
        type="button"
        className="oc-image-preview-backdrop"
        onClick={onClose}
        aria-label="Close code preview"
      />
      <div
        className="oc-image-preview-modal oc-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="oc-image-preview-header oc-modal-header">
          <span className="oc-image-preview-title">{title}</span>
          <span className="ml-2 rounded-full border border-oc-border bg-oc-panel-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-oc-text-soft">
            {languageBadge}
          </span>
          <button
            type="button"
            className="oc-image-preview-close"
            onClick={onClose}
            aria-label="Close code preview"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="oc-image-preview-content oc-modal-content">
          <pre className="m-0 max-h-[70vh] overflow-auto rounded-md border border-oc-border bg-oc-bg-soft p-3 text-xs leading-relaxed">
            <code
              className="hljs"
              dangerouslySetInnerHTML={{ __html: highlightedHtml || data.content }}
            />
          </pre>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
