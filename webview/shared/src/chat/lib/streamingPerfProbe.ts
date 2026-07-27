/**
 * Lightweight perf probe for streaming-latency investigation.
 *
 * Enable from DevTools console:
 *   (window).__OC_PERF_PROBE__ = true
 *
 * Disable:
 *   (window).__OC_PERF_PROBE__ = false
 *
 * Reports (every 2s while enabled):
 *   - Per-action-type dispatch timing (count / avg / max) from the reducer
 *   - Render+commit timing for ChatContent
 *   - Immediate `SLOW` warnings for any single op > 16ms (one frame budget)
 *
 * Zero overhead when disabled — every entry point checks isEnabled() first.
 *
 * Why a dedicated probe vs React DevTools Profiler:
 *   React Profiler captures render times but misses reducer work that
 *   happens between dispatch and state-change notification (especially
 *   inside the rAF-batched listener path in AppProvider). It also can't
 *   isolate which action TYPES are hot. This probe answers both questions
 *   with timestamps taken at the same layer where the lag originates.
 */

import vscode from './vscode';

const isBrowser = typeof window !== 'undefined';
const hasPerf = typeof performance !== 'undefined';

const manuallyEnabled = (): boolean =>
  isBrowser && (window as unknown as { __OC_PERF_PROBE__?: boolean }).__OC_PERF_PROBE__ === true;

let streamActive = false;
let streamSessionId: string | null = null;
let streamStartedAt = 0;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogExpectedAt = 0;
let lastMessageType = "unknown";
let lastMessageMs = 0;
let maxMessageMs = 0;
let maxRenderMs = 0;
let maxDispatchMs = 0;
let eventLoopStallCount = 0;
let maxEventLoopGapMs = 0;
const lastDiagnosticAt = new Map<string, number>();

const enabled = (): boolean => manuallyEnabled() || streamActive;

const now = (): number => (hasPerf ? performance.now() : Date.now());

interface Bucket {
  count: number;
  totalMs: number;
  maxMs: number;
  slow: number;
}

const dispatchBuckets = new Map<string, Bucket>();
const messageBuckets = new Map<string, Bucket>();
let renderCount = 0;
let renderTotalMs = 0;
let renderMaxMs = 0;
let renderSlowCount = 0;
let lastFlushAt = now();
let nextFlushScheduled = false;

const SLOW_THRESHOLD_MS = 8; // half a frame
const FRAME_BUDGET_MS = 16; // one frame at 60fps
const FLUSH_INTERVAL_MS = 2000;
const WATCHDOG_INTERVAL_MS = 100;
const EVENT_LOOP_STALL_MS = 200;
const DIAGNOSTIC_RATE_LIMIT_MS = 2_000;

function heapSnapshot(): Record<string, number | undefined> {
  const memory = hasPerf
    ? (performance as Performance & {
        memory?: {
          usedJSHeapSize?: number;
          totalJSHeapSize?: number;
          jsHeapSizeLimit?: number;
        };
      }).memory
    : undefined;
  const toMb = (value: number | undefined): number | undefined =>
    typeof value === "number" ? Number((value / 1_048_576).toFixed(1)) : undefined;
  return {
    heapUsedMb: toMb(memory?.usedJSHeapSize),
    heapTotalMb: toMb(memory?.totalJSHeapSize),
    heapLimitMb: toMb(memory?.jsHeapSizeLimit),
  };
}

function postDiagnostic(
  kind: string,
  context: Record<string, string | number | boolean | null | undefined>,
  force = false,
): void {
  const timestamp = Date.now();
  const previous = lastDiagnosticAt.get(kind) ?? -Infinity;
  if (!force && timestamp - previous < DIAGNOSTIC_RATE_LIMIT_MS) {
    return;
  }
  lastDiagnosticAt.set(kind, timestamp);
  const payload = {
    kind,
    sessionId: streamSessionId,
    streamElapsedMs: streamStartedAt > 0 ? Number((now() - streamStartedAt).toFixed(1)) : 0,
    lastMessageType,
    lastMessageMs: Number(lastMessageMs.toFixed(1)),
    maxMessageMs: Number(maxMessageMs.toFixed(1)),
    maxRenderMs: Number(maxRenderMs.toFixed(1)),
    maxDispatchMs: Number(maxDispatchMs.toFixed(1)),
    eventLoopStallCount,
    maxEventLoopGapMs: Number(maxEventLoopGapMs.toFixed(1)),
    ...heapSnapshot(),
    ...context,
  };
  try {
    vscode.postMessage({
      type: "webviewLog",
      level: "warn",
      message: `[STREAM-DIAG] ${kind}`,
      context: payload,
    });
  } catch {
    // Diagnostics must never interfere with streaming.
  }
}

function runWatchdog(): void {
  if (!streamActive) {
    watchdogTimer = null;
    return;
  }
  const current = now();
  const gapMs = Math.max(0, current - watchdogExpectedAt);
  if (gapMs >= EVENT_LOOP_STALL_MS) {
    eventLoopStallCount += 1;
    maxEventLoopGapMs = Math.max(maxEventLoopGapMs, gapMs);
    postDiagnostic("webview-event-loop-gap", { gapMs: Number(gapMs.toFixed(1)) });
  }
  watchdogExpectedAt = current + WATCHDOG_INTERVAL_MS;
  watchdogTimer = setTimeout(runWatchdog, WATCHDOG_INTERVAL_MS);
}

function resetStreamStats(): void {
  streamStartedAt = now();
  lastMessageType = "unknown";
  lastMessageMs = 0;
  maxMessageMs = 0;
  maxRenderMs = 0;
  maxDispatchMs = 0;
  eventLoopStallCount = 0;
  maxEventLoopGapMs = 0;
}

function ensureFlushScheduled(): void {
  if (nextFlushScheduled) return;
  nextFlushScheduled = true;
  setTimeout(flushReport, FLUSH_INTERVAL_MS);
}

function colorForMs(ms: number): string {
  if (ms > FRAME_BUDGET_MS) return '#ef4444'; // red — blew a frame
  if (ms > SLOW_THRESHOLD_MS) return '#f59e0b'; // amber — getting close
  return '#22c55e'; // green — fine
}

function flushReport(): void {
  nextFlushScheduled = false;
  const elapsed = now() - lastFlushAt;
  lastFlushAt = now();

  const dispatchEntries = [...dispatchBuckets.entries()].sort(
    (a, b) => b[1].totalMs - a[1].totalMs,
  );
  const messageEntries = [...messageBuckets.entries()].sort(
    (a, b) => b[1].totalMs - a[1].totalMs,
  );

  if (dispatchEntries.length === 0 && messageEntries.length === 0 && renderCount === 0) {
    return; // nothing to report — avoid noise
  }

  if (typeof console === 'undefined' || !console.groupCollapsed) return;

  console.groupCollapsed(
    `%c[OC PERFL ${elapsed.toFixed(0)}ms window]`,
    'color: #fb923c; font-weight: bold;',
  );

  if (renderCount > 0) {
    const avg = renderTotalMs / renderCount;
    const color = colorForMs(avg);
    console.log(
      `%c  RENDER  count=${renderCount}  avg=${avg.toFixed(2)}ms  max=${renderMaxMs.toFixed(2)}ms  slow=${renderSlowCount}`,
      `color: ${color}; font-weight: bold;`,
    );
  }

  if (dispatchEntries.length > 0) {
    console.log('%c  DISPATCH (sorted by total time):', 'color: #93c5fd;');
    for (const [type, b] of dispatchEntries) {
      const avg = b.totalMs / b.count;
      const color = colorForMs(avg);
      const flag = b.slow > 0 ? `  ⚠slow=${b.slow}` : '';
      console.log(
        `%c    ${type.padEnd(40)} n=${String(b.count).padStart(4)}  avg=${avg.toFixed(2).padStart(7)}ms  max=${b.maxMs.toFixed(2).padStart(7)}ms${flag}`,
        `color: ${color};`,
      );
    }
  }

  if (messageEntries.length > 0) {
    console.log('%c  MESSAGE handler (sorted by total time):', 'color: #93c5fd;');
    for (const [type, b] of messageEntries) {
      const avg = b.totalMs / b.count;
      const color = colorForMs(avg);
      console.log(
        `%c    ${type.padEnd(40)} n=${String(b.count).padStart(4)}  avg=${avg.toFixed(2).padStart(7)}ms  max=${b.maxMs.toFixed(2).padStart(7)}ms`,
        `color: ${color};`,
      );
    }
  }

  console.groupEnd();

  dispatchBuckets.clear();
  messageBuckets.clear();
  renderCount = 0;
  renderTotalMs = 0;
  renderMaxMs = 0;
  renderSlowCount = 0;
}

function record(
  buckets: Map<string, Bucket>,
  key: string,
  durationMs: number,
  warnLabel?: string,
): void {
  const k = String(key).slice(0, 48);
  let bucket = buckets.get(k);
  if (!bucket) {
    bucket = { count: 0, totalMs: 0, maxMs: 0, slow: 0 };
    buckets.set(k, bucket);
  }
  bucket.count += 1;
  bucket.totalMs += durationMs;
  if (durationMs > bucket.maxMs) bucket.maxMs = durationMs;
  if (durationMs > SLOW_THRESHOLD_MS) bucket.slow += 1;
  if (
    manuallyEnabled() &&
    durationMs > FRAME_BUDGET_MS &&
    warnLabel &&
    typeof console !== 'undefined' &&
    console.warn
  ) {
    console.warn(
      `%c[OC PERFL FRAME-BLOW] ${warnLabel}: ${k} = ${durationMs.toFixed(1)}ms`,
      'color: #ef4444; font-weight: bold;',
    );
  }
  if (manuallyEnabled()) {
    ensureFlushScheduled();
  }
}

export const perfProbe = {
  isEnabled: enabled,

  /** Automatically watch only while an assistant stream is live. */
  setStreamingActive(active: boolean, sessionId?: string | null): void {
    if (!isBrowser) return;
    if (active) {
      streamSessionId = sessionId ?? streamSessionId;
      if (streamActive) return;
      streamActive = true;
      resetStreamStats();
      watchdogExpectedAt = now() + WATCHDOG_INTERVAL_MS;
      watchdogTimer = setTimeout(runWatchdog, WATCHDOG_INTERVAL_MS);
      return;
    }
    if (!streamActive) return;
    streamActive = false;
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
    postDiagnostic("stream-summary", {
      durationMs: Number((now() - streamStartedAt).toFixed(1)),
    }, true);
    streamSessionId = null;
  },

  /** Time a single dispatch call. Call from the wrapped dispatch in AppProvider. */
  recordDispatch(actionType: unknown, durationMs: number): void {
    if (!enabled()) return;
    maxDispatchMs = Math.max(maxDispatchMs, durationMs);
    if (streamActive && durationMs >= FRAME_BUDGET_MS) {
      postDiagnostic("dispatch-stall", {
        actionType: actionType == null ? "unknown" : String(actionType).slice(0, 64),
        durationMs: Number(durationMs.toFixed(1)),
      });
    }
    if (manuallyEnabled()) {
      record(dispatchBuckets, actionType == null ? '<no-type>' : String(actionType), durationMs, 'dispatch');
    }
  },

  /** Time the full handler run for a single postMessage. */
  recordMessage(messageType: unknown, durationMs: number): void {
    if (!enabled()) return;
    lastMessageType = messageType == null ? "unknown" : String(messageType).slice(0, 64);
    lastMessageMs = durationMs;
    maxMessageMs = Math.max(maxMessageMs, durationMs);
    if (streamActive && durationMs >= FRAME_BUDGET_MS) {
      postDiagnostic("message-handler-stall", {
        messageType: lastMessageType,
        durationMs: Number(durationMs.toFixed(1)),
      });
    }
    if (manuallyEnabled()) {
      record(messageBuckets, `msg:${messageType == null ? '<no-type>' : String(messageType)}`, durationMs, 'message');
    }
  },

  /** Time a render+commit cycle of ChatContent. */
  recordRender(durationMs: number): void {
    if (!enabled()) return;
    maxRenderMs = Math.max(maxRenderMs, durationMs);
    if (streamActive && durationMs >= FRAME_BUDGET_MS) {
      postDiagnostic("render-commit-stall", {
        durationMs: Number(durationMs.toFixed(1)),
      });
    }
    if (manuallyEnabled()) {
      renderCount += 1;
      renderTotalMs += durationMs;
      if (durationMs > renderMaxMs) renderMaxMs = durationMs;
      if (durationMs > SLOW_THRESHOLD_MS) renderSlowCount += 1;
      if (
        durationMs > FRAME_BUDGET_MS &&
        typeof console !== 'undefined' &&
        console.warn
      ) {
        console.warn(
          `%c[OC PERFL FRAME-BLOW] render+commit = ${durationMs.toFixed(1)}ms`,
          'color: #ef4444; font-weight: bold;',
        );
      }
      ensureFlushScheduled();
    }
  },

  /** Force a flush (useful from console: `__ocPerfProbeFlush()`). */
  flush: flushReport,
};

if (isBrowser) {
  (window as unknown as { __ocPerfProbeFlush?: () => void }).__ocPerfProbeFlush = flushReport;
}
