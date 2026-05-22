import { useEffect } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";

type ImagePreviewModalProps = {
  isOpen: boolean;
  imageSrc: string | null;
  imageAlt?: string;
  title?: string;
  onClose: () => void;
};

export function ImagePreviewModal({
  isOpen,
  imageSrc,
  imageAlt = "Image preview",
  title,
  onClose,
}: ImagePreviewModalProps) {
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

  if (!isOpen || !imageSrc) {
    return null;
  }

  const modalContent = (
    <div className="oc-image-preview-shell">
      <button
        type="button"
        className="oc-image-preview-backdrop"
        onClick={onClose}
        aria-label="Close image preview"
      />
      <div
        className="oc-image-preview-modal oc-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-label={title ?? imageAlt}
      >
        <div className="oc-image-preview-header oc-modal-header">
          <span className="oc-image-preview-title">{title ?? imageAlt}</span>
          <button
            type="button"
            className="oc-image-preview-close"
            onClick={onClose}
            aria-label="Close image preview"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="oc-image-preview-content oc-modal-content">
          <img src={imageSrc} alt={imageAlt} className="oc-image-preview-img" />
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
