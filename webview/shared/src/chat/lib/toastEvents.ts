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

interface RawToastProperties {
  title?: unknown;
  message?: unknown;
  variant?: unknown;
  duration?: unknown;
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

function normalizeVariant(value: unknown): ToastVariant {
  const variant = asString(value)?.trim().toLowerCase();
  if (variant === "success" || variant === "warning" || variant === "error") {
    return variant;
  }
  return "info";
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

  const properties = asRecord(payload.properties) as RawToastProperties | null;
  const title = asString(properties?.title) || "";
  const message = asString(properties?.message) || "";

  return [
    "toast",
    asString(payload.type) || "unknown",
    title,
    message,
    asString(payload.sessionId) || "",
    String(index),
  ].join(":");
}

export function toastNotificationFromPayload(
  entry: unknown,
  index = 0,
): CentralizedToastNotification | null {
  const payload = asRecord(entry);
  if (!payload || asString(payload.type) !== "tui.toast.show") {
    return null;
  }

  const properties = asRecord(payload.properties) as RawToastProperties | null;
  const title = asString(properties?.title)?.trim() || "OpenCode";
  const message = asString(properties?.message)?.trim() || "";
  const variant = normalizeVariant(properties?.variant);
  const durationMs = asNumber(properties?.duration);

  return {
    key: buildToastKey(payload, index),
    id: asString(payload.id),
    type: "tui.toast.show",
    title,
    message,
    variant,
    durationMs: durationMs && durationMs > 0 ? durationMs : 4000,
    sessionId: asString(payload.sessionId),
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
