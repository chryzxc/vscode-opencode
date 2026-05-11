import { useState, useEffect } from "react";
import { X, Download, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { createPortal } from "react-dom";

import { cn } from "@/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import vscode from "./lib/vscode";

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
  // eslint-disable-next-line react-hooks/rules-of-hooks
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

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
        aria-label="Close skill installer"
      />

      {/* Modal panel */}
      <div
        className="oc-modal-shell relative z-50 w-full max-w-md flex-col overflow-hidden text-foreground animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-label="Install Skill"
      >
        {/* Header */}
        <div className="oc-modal-header flex items-center justify-between bg-oc-panel-soft/70">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-oc-accent" />
            <span className="text-sm font-semibold text-foreground">Install Skill</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close skill installer"
            className="h-6 w-6 oc-text-secondary hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Body */}
        <div className="oc-modal-content flex flex-col gap-4">
          {/* Status messages */}
          {status.type === "success" && (
            <div className="flex items-center gap-2 rounded-lg border border-oc-green/30 bg-oc-green/10 px-3 py-2.5 text-xs text-oc-green">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              <span>{status.message}</span>
            </div>
          )}

          {status.type === "error" && (
            <div className="flex items-center gap-2 rounded-lg border border-oc-red/30 bg-oc-red/10 px-3 py-2.5 text-xs text-oc-red">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{status.message}</span>
            </div>
          )}

          {/* URL input */}
          <div className="oc-panel-section flex flex-col gap-1.5 p-3">
            <Label htmlFor="skill-url" className="text-xs font-medium oc-text-secondary">
              Skill URL
            </Label>
            <Input
              id="skill-url"
              type="text"
              placeholder="https://example.com/skill.json"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isInstalling}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isInstalling) {
                  handleInstall();
                }
              }}
              className="h-8 text-xs"
            />
          </div>

          {/* Progress message */}
          {status.type === "idle" && status.message && (
            <div className="flex items-center gap-2 text-xs oc-text-secondary">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>{status.message}</span>
            </div>
          )}

          {/* Actions */}
          <div className="oc-modal-footer px-0 pb-0 pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={isInstalling}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleInstall}
              disabled={isInstalling || !url.trim()}
              className={cn("text-xs", isInstalling && "opacity-75")}
            >
              {isInstalling ? (
                <>
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  Installing…
                </>
              ) : (
                <>
                  <Download className="mr-1.5 h-3 w-3" />
                  Install
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

