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

export function LiveEventBanner({
  sessionId,
  rawSdkEventPayloads,
  liveNotifications,
}: {
  sessionId?: string | null;
  rawSdkEventPayloads?: unknown[];
  liveNotifications?: CentralizedToastNotification[];
}) {
  const notifications = useMemo(() => {
    const persisted = extractCentralizedToastNotifications(rawSdkEventPayloads);
    return [...persisted, ...(liveNotifications ?? [])];
  }, [liveNotifications, rawSdkEventPayloads]);
  const [activeToast, setActiveToast] = useState<CentralizedToastNotification | null>(null);
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
              "pointer-events-auto border-b border-l-2 border-oc-border bg-oc-panel",
            )}
            style={{
              borderLeftColor: styles.accent,
              backgroundColor: "color-mix(in srgb, var(--oc-panel) 84%, var(--oc-text) 16%)",
              boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--oc-text) 8%, transparent)",
            }}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-2.5 px-3 py-2">
              <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center" style={{ color: styles.accent }} aria-hidden="true">
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: styles.accent }}>
                    {styles.label}
                  </span>
                  <span className="truncate text-[13px] font-semibold leading-4 text-oc-text">
                    {activeToast.title}
                  </span>
                </div>
                {activeToast.message ? (
                  <div className="mt-0.5 whitespace-pre-wrap break-words text-[12px] leading-4 text-oc-text opacity-90">
                    {activeToast.message}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
