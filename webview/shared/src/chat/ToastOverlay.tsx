import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

import { cn } from "../utils";
import logger from "./lib/logger";
import { extractCentralizedToastNotifications, type CentralizedToastNotification, type ToastVariant } from "./lib/toastEvents";

function toastVariantStyles(variant: ToastVariant) {
  switch (variant) {
    case "success":
      return {
        icon: CheckCircle2,
        accent: "var(--vscode-testing-iconPassed, var(--oc-green))",
        label: "Success",
      };
    case "warning":
      return {
        icon: AlertTriangle,
        accent: "var(--vscode-editorWarning-foreground, var(--oc-yellow))",
        label: "Warning",
      };
    case "error":
      return {
        icon: XCircle,
        accent: "var(--vscode-editorError-foreground, var(--oc-red))",
        label: "Error",
      };
    case "info":
    default:
      return {
        icon: Info,
        accent: "var(--vscode-textLink-foreground, var(--oc-text))",
        label: "Info",
      };
  }
}

function formatRetryCountdown(next: number, now: number): string {
  const totalSeconds = Math.max(0, Math.ceil((next - now) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0
    ? `${minutes}:${String(seconds).padStart(2, "0")}`
    : `${seconds}s`;
}

export function LiveEventBanner({
  sessionId,
  rawSdkEventPayloads,
  liveNotifications,
  placement = "top",
}: {
  sessionId?: string | null;
  rawSdkEventPayloads?: unknown[];
  liveNotifications?: CentralizedToastNotification[];
  /** `tui.show` remains at the top; retry/error session status sits above the composer. */
  placement?: "top" | "composer";
}) {
  const isComposerPlacement = placement === "composer";
  const notifications = useMemo(() => {
    const persisted = extractCentralizedToastNotifications(rawSdkEventPayloads);
    const allNotifications = [...persisted, ...(liveNotifications ?? [])];
    const placedNotifications = allNotifications.filter((notification) =>
      placement === "composer"
        ? notification.type === "session.status"
        : notification.type !== "session.status",
    );
    return placedNotifications;
  }, [liveNotifications, placement, rawSdkEventPayloads]);
  const [activeToast, setActiveToast] = useState<CentralizedToastNotification | null>(null);
  const [toastNow, setToastNow] = useState(() => Date.now());
  const toastQueueRef = useRef<CentralizedToastNotification[]>([]);
  const activeToastRef = useRef<CentralizedToastNotification | null>(null);
  const seenToastKeysRef = useRef<Set<string>>(new Set());
  const timeoutHandleRef = useRef<number | null>(null);
  const initializedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    activeToastRef.current = activeToast;
    if (activeToast) {
      logger.info("[LIVE-TOAST] overlay rendering", {
        sessionId: sessionId ?? null,
        toastKey: activeToast.key,
        type: activeToast.type,
        durationMs: activeToast.durationMs,
      });
    }
  }, [activeToast, sessionId]);

  useEffect(() => {
    if (!activeToast?.next) {
      return;
    }
    setToastNow(Date.now());
    const intervalId = window.setInterval(() => setToastNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [activeToast?.next]);

  const clearActiveTimer = () => {
    if (timeoutHandleRef.current !== null) {
      window.clearTimeout(timeoutHandleRef.current);
      timeoutHandleRef.current = null;
    }
  };

  const showNextToast = () => {
    if (activeToastRef.current) {
      return;
    }

    clearActiveTimer();
    const nextToast = toastQueueRef.current.shift() ?? null;
    if (!nextToast) {
      return;
    }

    activeToastRef.current = nextToast;
    setActiveToast(nextToast);

    if (nextToast.durationMs > 0) {
      timeoutHandleRef.current = window.setTimeout(() => {
        timeoutHandleRef.current = null;
        activeToastRef.current = null;
        setActiveToast(null);
        showNextToast();
      }, nextToast.durationMs);
    }
  };

  useEffect(() => {
    const currentSessionKey = sessionId ?? null;
    if (initializedSessionRef.current !== currentSessionKey) {
      initializedSessionRef.current = currentSessionKey;
      clearActiveTimer();
      toastQueueRef.current = [];
      seenToastKeysRef.current = new Set();
      activeToastRef.current = null;
      setActiveToast(null);
    }

    const nextToasts = notifications.filter(
      (notification) => !seenToastKeysRef.current.has(notification.key),
    );

    if (nextToasts.length === 0) {
      logger.info("[LIVE-TOAST] overlay evaluated", {
        sessionId: currentSessionKey,
        notificationCount: notifications.length,
        activeToastKey: activeToastRef.current?.key ?? null,
        queuedCount: toastQueueRef.current.length,
      });
      return;
    }

    for (const notification of nextToasts) {
      seenToastKeysRef.current.add(notification.key);
      toastQueueRef.current.push(notification);
    }

    logger.info("[LIVE-TOAST] overlay queued", {
      sessionId: currentSessionKey,
      keys: nextToasts.map((notification) => notification.key),
      queuedCount: toastQueueRef.current.length,
    });

    if (!activeToastRef.current) {
      showNextToast();
    }
  }, [notifications, sessionId]);

  useEffect(() => {
    return () => {
      clearActiveTimer();
    };
  }, []);

  if (!activeToast) {
    return null;
  }

  return (
    <div className="pointer-events-none relative z-20 flex w-full flex-col">
      {(() => {
        const styles = toastVariantStyles(activeToast.variant);
        const Icon = styles.icon;
        return (
          <div
            key={activeToast.key}
            className={cn(
              "pointer-events-auto border-l-2 border-oc-border bg-oc-panel",
              isComposerPlacement ? "border-t" : "border-b",
            )}
            style={{
              borderLeftColor: styles.accent,
              backgroundColor: "color-mix(in srgb, var(--oc-panel) 84%, var(--oc-text) 16%)",
              boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--oc-text) 8%, transparent)",
            }}
            role="status"
            aria-live="polite"
          >
            <div className={cn("flex gap-2.5 px-3", isComposerPlacement ? "items-center py-1.5" : "items-start py-2")}>
              <div className={cn("flex shrink-0 items-center justify-center", isComposerPlacement ? "h-3.5 w-3.5" : "mt-0.5 h-4 w-4")} style={{ color: styles.accent }} aria-hidden="true">
                <Icon className={isComposerPlacement ? "h-3.5 w-3.5" : "h-3.5 w-3.5"} />
              </div>
              <div className="min-w-0 flex-1">
                <div className={cn("flex min-w-0", isComposerPlacement ? "items-center gap-1.5" : "items-baseline gap-2")}>
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: styles.accent }}>
                    {styles.label}
                  </span>
                  <span className={cn("truncate font-semibold text-oc-text", isComposerPlacement ? "text-[12px] leading-4" : "text-[13px] leading-4")}>
                    {activeToast.title}
                  </span>
                  {isComposerPlacement && activeToast.message ? (
                    <span className="min-w-0 flex-1 truncate text-[11px] leading-4 text-oc-text opacity-75" title={activeToast.message}>
                      {activeToast.message}
                    </span>
                  ) : null}
                </div>
                {!isComposerPlacement && activeToast.message ? (
                  <div className="mt-0.5 whitespace-pre-wrap break-words text-[12px] leading-4 text-oc-text opacity-90">
                    {activeToast.message}
                  </div>
                ) : null}
              </div>
              {activeToast.type === "session.status" && activeToast.next ? (
                <div className={cn("shrink-0 font-medium tabular-nums", isComposerPlacement ? "text-[11px]" : "mt-1 text-[11px]")} style={{ color: styles.accent }}>
                  Retrying in {formatRetryCountdown(activeToast.next, toastNow)}
                </div>
              ) : null}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
