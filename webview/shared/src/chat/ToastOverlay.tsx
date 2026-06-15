import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

import { cn } from "../utils";
import { extractCentralizedToastNotifications, type CentralizedToastNotification, type ToastVariant } from "./lib/toastEvents";

function toastVariantStyles(variant: ToastVariant) {
  switch (variant) {
    case "success":
      return {
        icon: CheckCircle2,
        accent: "border-emerald-500/40 bg-[rgba(16,55,34,0.96)]",
        label: "Success",
        iconTone: "text-emerald-300",
        titleTone: "text-emerald-200",
      };
    case "warning":
      return {
        icon: AlertTriangle,
        accent: "border-amber-500/40 bg-[rgba(58,39,14,0.96)]",
        label: "Warning",
        iconTone: "text-amber-300",
        titleTone: "text-amber-200",
      };
    case "error":
      return {
        icon: XCircle,
        accent: "border-rose-500/40 bg-[rgba(64,18,26,0.96)]",
        label: "Error",
        iconTone: "text-rose-300",
        titleTone: "text-rose-200",
      };
    case "info":
    default:
      return {
        icon: Info,
        accent: "border-sky-500/40 bg-[rgba(14,30,48,0.96)]",
        label: "Info",
        iconTone: "text-sky-300",
        titleTone: "text-sky-200",
      };
  }
}

export function CentralizedToastOverlay({
  sessionId,
  rawSdkEventPayloads,
}: {
  sessionId?: string | null;
  rawSdkEventPayloads?: unknown[];
}) {
  const notifications = useMemo(
    () => extractCentralizedToastNotifications(rawSdkEventPayloads),
    [rawSdkEventPayloads],
  );
  const [activeToast, setActiveToast] = useState<CentralizedToastNotification | null>(null);
  const toastQueueRef = useRef<CentralizedToastNotification[]>([]);
  const activeToastRef = useRef<CentralizedToastNotification | null>(null);
  const seenToastKeysRef = useRef<Set<string>>(new Set());
  const timeoutHandleRef = useRef<number | null>(null);
  const initializedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    activeToastRef.current = activeToast;
  }, [activeToast]);

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
      return;
    }

    for (const notification of nextToasts) {
      seenToastKeysRef.current.add(notification.key);
      toastQueueRef.current.push(notification);
    }

    if (!activeToastRef.current) {
      showNextToast();
    }
  }, [notifications, sessionId]);

  useEffect(() => {
    return () => {
      clearActiveTimer();
    };
  }, []);

  const dismissToast = (key: string) => {
    clearActiveTimer();
    if (activeToastRef.current?.key === key) {
      activeToastRef.current = null;
      setActiveToast(null);
      showNextToast();
      return;
    }

    toastQueueRef.current = toastQueueRef.current.filter((toast) => toast.key !== key);
  };

  if (!activeToast) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute right-3 top-24 z-40 flex w-full max-w-sm flex-col gap-2.5">
      {(() => {
        const styles = toastVariantStyles(activeToast.variant);
        const Icon = styles.icon;
        return (
          <div
            key={activeToast.key}
            className={cn(
              "pointer-events-auto overflow-hidden rounded-lg border shadow-[0_14px_36px_rgba(0,0,0,0.28)] backdrop-blur",
              styles.accent,
            )}
          >
            <div className="flex items-start gap-3 px-3 py-2.5">
              <div className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center", styles.iconTone)} aria-hidden="true">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className={cn("text-[10px] font-semibold uppercase tracking-[0.08em]", styles.titleTone)}>
                  {styles.label}
                </div>
                <div className="mt-1 text-[12px] font-semibold leading-5 text-oc-text">
                  {activeToast.title}
                </div>
                {activeToast.message ? (
                  <div className="mt-0.5 whitespace-pre-wrap break-words text-[12px] leading-5 text-oc-text-soft">
                    {activeToast.message}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-white/10 text-oc-text-soft transition-colors hover:bg-white/5 hover:text-oc-text"
                aria-label="Dismiss toast"
                title="Dismiss toast"
                onClick={() => dismissToast(activeToast.key)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
