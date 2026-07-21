export type SdkDebugSnapshot = {
  rehydratedSdkMessages: readonly unknown[];
  liveEvents: readonly unknown[];
};

const EMPTY_SNAPSHOT: SdkDebugSnapshot = Object.freeze({
  rehydratedSdkMessages: Object.freeze([]),
  liveEvents: Object.freeze([]),
});
const MAX_REHYDRATED_SDK_MESSAGES = 50;
const MAX_LIVE_EVENTS = 100;

const sdkMessagesBySessionId = new Map<string, readonly unknown[]>();
const liveEventsBySessionId = new Map<string, unknown[]>();
const snapshotsBySessionId = new Map<string, SdkDebugSnapshot>();
const listeners = new Set<() => void>();
function publish(): void {
  const sessionIds = new Set([
    ...sdkMessagesBySessionId.keys(),
    ...liveEventsBySessionId.keys(),
  ]);
  snapshotsBySessionId.clear();
  for (const sessionId of sessionIds) {
    snapshotsBySessionId.set(sessionId, {
      rehydratedSdkMessages:
        sdkMessagesBySessionId.get(sessionId) ?? EMPTY_SNAPSHOT.rehydratedSdkMessages,
      liveEvents:
        liveEventsBySessionId.get(sessionId)?.slice() ?? EMPTY_SNAPSHOT.liveEvents,
    });
  }
  listeners.forEach((listener) => listener());
}

export function setRehydratedSdkDebugMessages(
  sessionId: string,
  messages: unknown[],
): void {
  // This diagnostic mirror is deliberately separate from chat state. Retain
  // only what the panel can display and discard previously viewed sessions.
  sdkMessagesBySessionId.clear();
  sdkMessagesBySessionId.set(
    sessionId,
    messages.length > MAX_REHYDRATED_SDK_MESSAGES
      ? messages.slice(-MAX_REHYDRATED_SDK_MESSAGES)
      : messages,
  );
  publish();
}

export function appendLiveSdkDebugEvents(
  sessionId: string,
  events: unknown[],
): void {
  // Heartbeats arrive from both stream endpoints and can replace the entire
  // bounded diagnostic window within seconds. They carry no renderable SDK
  // activity, so keep the panel focused on events that can explain the live
  // UI state.
  const renderRelevantEvents = events.filter((event) => {
    if (!event || typeof event !== "object") return true;
    return (event as { type?: unknown }).type !== "server.heartbeat";
  });
  if (renderRelevantEvents.length === 0) return;
  const retained = liveEventsBySessionId.get(sessionId) ?? [];
  retained.push(...renderRelevantEvents);
  if (retained.length > MAX_LIVE_EVENTS) {
    retained.splice(0, retained.length - MAX_LIVE_EVENTS);
  }
  liveEventsBySessionId.set(sessionId, retained);
  // This store is deliberately outside the chat reducer, so diagnostic live
  // events can update at SDK cadence without rebuilding the conversation.
  publish();
}

export function clearLiveSdkDebugEvents(): void {
  liveEventsBySessionId.clear();
  publish();
}

export function getSdkDebugSnapshot(sessionId: string | null): SdkDebugSnapshot {
  return sessionId
    ? snapshotsBySessionId.get(sessionId) ?? EMPTY_SNAPSHOT
    : EMPTY_SNAPSHOT;
}

export function subscribeToSdkDebugStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
