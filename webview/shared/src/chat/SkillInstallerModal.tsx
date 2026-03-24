import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { vscode } from "./lib/vscode";

type SkillInstallerModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function SkillInstallerModal({
  isOpen,
  onClose,
}: SkillInstallerModalProps) {
  const [url, setUrl] = useState("");
  const [isInstalling, setIsInstalling] = useState(false);
  const [status, setStatus] = useState<{
    type: "idle" | "success" | "error";
    message: string;
  }>({ type: "idle", message: "" });

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

  useEffect(() => {
    if (!isOpen) {
      // Reset state when modal closes
      setUrl("");
      setIsInstalling(false);
      setStatus({ type: "idle", message: "" });
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleInstall = () => {
    if (!url.trim()) {
      setStatus({ type: "error", message: "Please enter a URL" });
      return;
    }

    setIsInstalling(true);
    setStatus({ type: "idle", message: "" });

    vscode.postMessage({
      type: "installSkill",
      source: "url",
      data: url.trim(),
    });
  };

  // Listen for installation result
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      if (message.type === "skillInstalled") {
        setStatus({ type: "success", message: "Skill installed successfully!" });
        setIsInstalling(false);
        setTimeout(() => {
          onClose();
        }, 1500);
      } else if (message.type === "skillError") {
        setStatus({ type: "error", message: message.error || "Installation failed" });
        setIsInstalling(false);
      } else if (message.type === "installProgress") {
        setStatus({ type: "idle", message: message.progress.message });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onClose]);

  return (
    <div className="oc-skill-installer-shell">
      <div
        className="oc-skill-installer-backdrop"
        onClick={onClose}
        role="presentation"
      />
      <div
        className="oc-skill-installer-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Install Skill"
      >
        <div className="oc-skill-installer-header">
          <span className="oc-skill-installer-title">Install Skill</span>
          <button
            type="button"
            className="oc-skill-installer-close"
            onClick={onClose}
            aria-label="Close skill installer"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="oc-skill-installer-content">
          {status.type === "success" && (
            <div className="oc-skill-installer-success">
              ✓ {status.message}
            </div>
          )}

          {status.type === "error" && (
            <div className="oc-skill-installer-error">
              ✕ {status.message}
            </div>
          )}

          <div className="oc-skill-installer-form">
            <label htmlFor="skill-url" className="oc-skill-installer-label">
              Skill URL
            </label>
            <input
              id="skill-url"
              type="text"
              className="oc-skill-installer-input"
              placeholder="https://example.com/skill.json"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isInstalling}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isInstalling) {
                  handleInstall();
                }
              }}
            />

            {status.type === "idle" && status.message && (
              <div className="oc-skill-installer-status">
                {status.message}
              </div>
            )}

            <div className="oc-skill-installer-actions">
              <button
                type="button"
                className="oc-skill-installer-btn-secondary"
                onClick={onClose}
                disabled={isInstalling}
              >
                Cancel
              </button>
              <button
                type="button"
                className="oc-skill-installer-btn-primary"
                onClick={handleInstall}
                disabled={isInstalling || !url.trim()}
              >
                {isInstalling ? "Installing..." : "Install"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
