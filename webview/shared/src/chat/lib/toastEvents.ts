type RawRecord = Record<string, unknown>;

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface CentralizedToastNotification {
  key: string;
  id?: string;
  type: string;
  title: string;
  message: string;
  variant: ToastVariant;
  durationMs: number;
  sessionId?: string;
}

export interface LiveSessionStatus {
  statusType: string;
  message?: string;
  attempt?: number;
  next?: number;
  sessionId?: string;
  source?: string;
  updatedAt?: number;
}

interface RawToastProperties {
  title?: unknown;
  message?: unknown;
  text?: unknown;
  body?: unknown;
  description?: unknown;
  variant?: unknown;
  severity?: unknown;
  level?: unknown;
  duration?: unknown;
  durationMs?: unknown;
  timeout?: unknown;
}

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const next = asString(value)?.trim();
    if (next) {
      return next;
    }
  }
  return undefined;
}

function normalizedLiveEventType(entry: unknown): string {
  const payload = asRecord(entry);
  if (!payload) {
    return "";
  }
  const wrappedPayload = asRecord(payload.payload);
  const syncEvent = asRecord(payload.syncEvent);
  const syncData = asRecord(syncEvent?.data);
  const payloadSyncEvent = asRecord(wrappedPayload?.syncEvent);
  const payloadSyncData = asRecord(payloadSyncEvent?.data);
  const rawType = firstString(
    payload.type,
    payload.event,
    payload.kind,
    syncEvent?.type,
    syncData?.type,
    syncData?.event,
    syncData?.kind,
    wrappedPayload?.type,
    wrappedPayload?.event,
    wrappedPayload?.kind,
    payloadSyncEvent?.type,
    payloadSyncData?.type,
    payloadSyncData?.event,
    payloadSyncData?.kind,
  );
  return (rawType ?? "").replace(/\.\d+$/, "");
}

function eventProperties(payload: RawRecord): RawRecord | null {
  const wrappedPayload = asRecord(payload.payload);
  const syncEvent = asRecord(payload.syncEvent);
  const syncData = asRecord(syncEvent?.data);
  const wrappedSyncEvent = asRecord(wrappedPayload?.syncEvent);
  const wrappedSyncData = asRecord(wrappedSyncEvent?.data);
  return (
    asRecord(payload.properties) ??
    asRecord(wrappedPayload?.properties) ??
    asRecord(syncData?.properties) ??
    asRecord(wrappedSyncData?.properties) ??
    syncData ??
    wrappedSyncData
  );
}

function eventSessionId(payload: RawRecord): string | undefined {
  const properties = eventProperties(payload);
  const wrappedPayload = asRecord(payload.payload);
  const syncEvent = asRecord(payload.syncEvent);
  const syncData = asRecord(syncEvent?.data);
  const wrappedSyncEvent = asRecord(wrappedPayload?.syncEvent);
  const wrappedSyncData = asRecord(wrappedSyncEvent?.data);
  return firstString(
    payload.sessionId,
    payload.sessionID,
    properties?.sessionId,
    properties?.sessionID,
    wrappedPayload?.sessionId,
    wrappedPayload?.sessionID,
    syncData?.sessionId,
    syncData?.sessionID,
    wrappedSyncData?.sessionId,
    wrappedSyncData?.sessionID,
  );
}

function normalizeVariant(value: unknown): ToastVariant {
  const variant = asString(value)?.trim().toLowerCase();
  if (variant === "success" || variant === "warning" || variant === "error") {
    return variant;
  }
  return "info";
}

function toastMessageFromProperties(properties: RawToastProperties | null, payload: RawRecord): string {
  const wrappedPayload = asRecord(payload.payload);
  const syncData = asRecord(asRecord(payload.syncEvent)?.data);
  const wrappedSyncData = asRecord(asRecord(wrappedPayload?.syncEvent)?.data);
  return (
    asString(properties?.message)?.trim() ||
    asString(properties?.text)?.trim() ||
    asString(properties?.body)?.trim() ||
    asString(properties?.description)?.trim() ||
    asString(payload.message)?.trim() ||
    asString(payload.text)?.trim() ||
    asString(payload.body)?.trim() ||
    asString(payload.description)?.trim() ||
    asString(syncData?.message)?.trim() ||
    asString(syncData?.text)?.trim() ||
    asString(syncData?.body)?.trim() ||
    asString(syncData?.description)?.trim() ||
    asString(wrappedPayload?.message)?.trim() ||
    asString(wrappedPayload?.text)?.trim() ||
    asString(wrappedPayload?.body)?.trim() ||
    asString(wrappedPayload?.description)?.trim() ||
    asString(wrappedSyncData?.message)?.trim() ||
    asString(wrappedSyncData?.text)?.trim() ||
    asString(wrappedSyncData?.body)?.trim() ||
    asString(wrappedSyncData?.description)?.trim() ||
    ""
  );
}

function toastTitleFromProperties(properties: RawToastProperties | null, payload: RawRecord): string {
  const wrappedPayload = asRecord(payload.payload);
  const syncData = asRecord(asRecord(payload.syncEvent)?.data);
  const wrappedSyncData = asRecord(asRecord(wrappedPayload?.syncEvent)?.data);
  return (
    asString(properties?.title)?.trim() ||
    asString(syncData?.title)?.trim() ||
    asString(payload.title)?.trim() ||
    asString(wrappedPayload?.title)?.trim() ||
    asString(wrappedSyncData?.title)?.trim() ||
    "OpenCode"
  );
}

function buildToastKey(payload: RawRecord, index: number): string {
  const id =
    asString(payload.id) ||
    asString(payload.eventID) ||
    asString(payload.eventId) ||
    asString(payload.messageID) ||
    asString(payload.messageId);

  if (id) {
    return id;
  }

  const properties = eventProperties(payload) as RawToastProperties | null;
  const title = asString(properties?.title) || "";
  const message = asString(properties?.message) || "";

  return [
    "toast",
    normalizedLiveEventType(payload) || asString(payload.type) || "unknown",
    title,
    message,
    eventSessionId(payload) || "",
    String(index),
  ].join(":");
}

export function toastNotificationFromPayload(
  entry: unknown,
  index = 0,
): CentralizedToastNotification | null {
  const payload = asRecord(entry);
  const eventType = normalizedLiveEventType(payload);
  if (!payload || (eventType !== "tui.toast.show" && eventType !== "tui.show")) {
    if (payload && typeof console !== "undefined" && (eventType === "tui.toast.show" || eventType === "tui.show" || eventType.includes("tui") || eventType.includes("toast"))) {
      console.warn("[LIVE-EVENT][toastParser] rejected event", { eventType, payloadType: payload.type, keys: Object.keys(payload).slice(0, 10) });
    }
    return null;
  }
  if (typeof console !== "undefined") {
    console.warn("[LIVE-EVENT][toastParser] accepted event", { eventType, title: payload.title, message: payload.message, keys: Object.keys(payload).slice(0, 10) });
  }
  const properties = eventProperties(payload) as RawToastProperties | null;
  const wrappedPayload = asRecord(payload.payload);
  const syncData = asRecord(asRecord(payload.syncEvent)?.data);
  const wrappedSyncData = asRecord(asRecord(wrappedPayload?.syncEvent)?.data);
  const title = toastTitleFromProperties(properties, payload);
  const message = toastMessageFromProperties(properties, payload);
  const variant = normalizeVariant(
    properties?.variant ??
      properties?.severity ??
      properties?.level ??
      syncData?.variant ??
      syncData?.severity ??
      syncData?.level ??
      payload.variant ??
      payload.severity ??
      wrappedPayload?.variant ??
      wrappedPayload?.severity ??
      wrappedSyncData?.variant ??
      wrappedSyncData?.severity,
  );
  const durationMs =
    asNumber(properties?.duration) ??
    asNumber(properties?.durationMs) ??
    asNumber(properties?.timeout) ??
    asNumber(syncData?.duration) ??
    asNumber(syncData?.durationMs) ??
    asNumber(syncData?.timeout) ??
    asNumber(payload.duration) ??
    asNumber(payload.durationMs) ??
    asNumber(payload.timeout) ??
    asNumber(wrappedPayload?.duration) ??
    asNumber(wrappedPayload?.durationMs) ??
    asNumber(wrappedPayload?.timeout) ??
    asNumber(wrappedSyncData?.duration) ??
    asNumber(wrappedSyncData?.durationMs) ??
    asNumber(wrappedSyncData?.timeout);

  return {
    key: buildToastKey(payload, index),
    id: asString(payload.id),
    type: eventType || "tui.toast.show",
    title,
    message,
    variant,
    durationMs: durationMs && durationMs > 0 ? durationMs : 4000,
    sessionId: eventSessionId(payload),
  };
}

export function liveSessionStatusFromPayload(
  entry: unknown,
): LiveSessionStatus | null {
  const payload = asRecord(entry);
  const eventType = normalizedLiveEventType(payload);
  if (!payload || eventType !== "session.status") {
    if (payload && typeof console !== "undefined" && (asString(payload.type)?.includes("session") || eventType.includes("session"))) {
      console.warn("[LIVE-EVENT][statusParser] rejected event", { eventType, payloadType: payload.type, keys: Object.keys(payload).slice(0, 10) });
    }
    return null;
  }
  if (typeof console !== "undefined") {
    console.warn("[LIVE-EVENT][statusParser] accepted session.status event", { eventType, keys: Object.keys(payload).slice(0, 10) });
  }

  const properties = eventProperties(payload);
  const status = asRecord(properties?.status) ?? asRecord(payload.status);
  const statusType = firstString(status?.type, status?.status)?.toLowerCase();
  if (!statusType) {
    return null;
  }

  const timestamp = firstString(properties?.timestamp, payload.timestamp);
  const updatedAt = timestamp ? Date.parse(timestamp) : undefined;

  return {
    statusType,
    message: firstString(status?.message, properties?.message),
    attempt: asNumber(status?.attempt),
    next: asNumber(status?.next),
    sessionId: eventSessionId(payload),
    source: firstString(payload.source, eventType) ?? eventType,
    updatedAt: Number.isFinite(updatedAt as number) ? updatedAt : undefined,
  };
}

export function extractCentralizedToastNotifications(
  rawSdkEventPayloads: unknown[] | undefined,
): CentralizedToastNotification[] {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return [];
  }

  return rawSdkEventPayloads.flatMap((entry, index) => {
    const notification = toastNotificationFromPayload(entry, index);
    return notification ? [notification] : [];
  });
}
