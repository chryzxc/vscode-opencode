/**
 * Centralized debug payload exclusions.
 *
 * This is intentionally the single source of truth for what gets hidden from
 * the raw centralized tape in both of the following places:
 * - persistence/rehydration in SessionService
 * - debug rendering in the webview
 *
 * Keep the rules data-driven so future exclusions only require adding a new
 * path/value pair here instead of duplicating conditionals across layers.
 */
const CENTRALIZED_DEBUG_EXCLUDED_PATH_RULES = [
  {
    path: "type",
    values: [
      "server.connected",
      "server.connected.1",
      "server.heartbeat",
      "message.part.delta",
      "message.part.delta.1",
      "tui.toast.show",
      "tui.show",
      "session.status",
    ],
  },
  {
    path: "syncEvent.type",
    values: [
      "server.connected",
      "server.connected.1",
      "server.heartbeat",
      "message.part.delta",
      "message.part.delta.1",
      "tui.toast.show",
      "tui.show",
      "session.status",
    ],
  },
  {
    path: "payload.syncEvent.type",
    values: [
      "server.connected",
      "server.connected.1",
      "server.heartbeat",
      "message.part.delta",
      "message.part.delta.1",
      "tui.toast.show",
      "tui.show",
      "session.status",
    ],
  },
  {
    path: "syncEvent.data.type",
    values: [
      "server.connected",
      "server.connected.1",
      "server.heartbeat",
      "message.part.delta",
      "message.part.delta.1",
      "tui.toast.show",
      "tui.show",
      "session.status",
    ],
  },
  {
    path: "payload.syncEvent.data.type",
    values: [
      "server.connected",
      "server.connected.1",
      "server.heartbeat",
      "message.part.delta",
      "message.part.delta.1",
      "tui.toast.show",
      "tui.show",
      "session.status",
    ],
  },
] as const;

const CENTRALIZED_DEBUG_STRIP_FORMAT_PATHS = [
  "info.format",
  "properties.info.format",
  "payload.info.format",
  "payload.properties.info.format",
  "syncEvent.data.info.format",
  "payload.syncEvent.data.info.format",
] as const;

/*
 * Persistence policy:
 * The centralized tape is now the source of truth, so persistence must be
 * permissive. We only drop explicit transport noise (heartbeats, connected
 * frames, explicit message.part.delta event types) via
 * shouldIncludeCentralizedDebugPayload(). Semantic stream events like
 * question.asked, message.completed, session.completed, tool activity, and
 * non-delta lifecycle payloads must remain persisted even when they do not
 * appear in a narrow allowlist. delta-bearing message.part.updated lifecycle
 * payloads are excluded so centralized hydration only keeps stable snapshots.
 * Live-only UI events such as tui.toast.show and reasoning chunk frames are
 * excluded separately so they do not bloat hydrated centralized data.
 *
 * Previously excluded rules. Kept here commented during the blacklist
 * reduction pass so we can restore them without re-deriving the paths:
 *
 * - type: sync
 * - source: /global/event
 * - properties.part.state.status: running
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Reads a nested property using dot notation so callers can filter on deeply
 * nested fields without writing custom traversal logic for each rule.
 */
function valueAtDotPath(value: unknown, path: string): unknown {
  if (!path) {
    return value;
  }

  return path.split(".").reduce<unknown>((current, segment) => {
    const next = asRecord(current);
    if (!next) {
      return undefined;
    }
    return next[segment];
  }, value);
}

function candidatePayloads(event: Record<string, unknown>): unknown[] {
  const payloads = [event];
  const wrappedPayload = asRecord(event.payload);
  if (wrappedPayload) {
    payloads.push(wrappedPayload);
  }
  return payloads;
}

function shallowCloneRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Array.isArray(value) ? [...value] as unknown as Record<string, unknown> : { ...value };
}

function stripDotPathIfJsonSchema(
  root: Record<string, unknown>,
  path: string,
): void {
  const segments = path.split(".");
  if (segments.length === 0) {
    return;
  }

  let current: Record<string, unknown> = root;
  const parents: Array<{ node: Record<string, unknown>; key: string }> = [];

  for (let index = 0; index < segments.length; index += 1) {
    const key = segments[index];
    const next = current[key];
    const nextRecord = asRecord(next);
    if (!nextRecord) {
      return;
    }

    parents.push({ node: current, key });
    if (index === segments.length - 1) {
      const formatType = asString(nextRecord.type).trim().toLowerCase();
      if (formatType !== "json_schema") {
        return;
      }

      for (let cloneIndex = 0; cloneIndex < parents.length; cloneIndex += 1) {
        const { node, key: cloneKey } = parents[cloneIndex];
        node[cloneKey] = shallowCloneRecord(node[cloneKey] as Record<string, unknown>);
        if (cloneIndex + 1 < parents.length) {
          parents[cloneIndex + 1].node = node[cloneKey] as Record<string, unknown>;
        }
      }

      const lastParent = parents[parents.length - 1];
      delete lastParent.node[lastParent.key];
      return;
    }

    current = nextRecord;
  }
}

// NOTE: Stream events (like SSE) often use `.event` or `.kind` instead of `.type`.
// This fallback chain is critical for ensuring that live stream events are correctly
// classified and not dropped by the centralized data persister. Without this,
// stream events will resolve to an empty type and be incorrectly rejected as noise.
export function normalizedCentralizedEventType(event: Record<string, unknown>): string {
  const directType = asString(event.type ?? event.event ?? event.kind).trim();
  const payloadRecord = asRecord(event.payload);
  const payloadType = asString(payloadRecord?.type ?? payloadRecord?.event ?? payloadRecord?.kind).trim();
  const syncEvent = asRecord(event.syncEvent);
  const syncType = asString(syncEvent?.type).trim();
  const syncData = asRecord(syncEvent?.data);
  const syncDataType = asString(syncData?.type ?? syncData?.event ?? syncData?.kind).trim();
  const payloadSyncEvent = asRecord(payloadRecord?.syncEvent);
  const payloadSyncType = asString(payloadSyncEvent?.type).trim();
  const payloadSyncData = asRecord(payloadSyncEvent?.data);
  const payloadSyncDataType = asString(payloadSyncData?.type ?? payloadSyncData?.event ?? payloadSyncData?.kind).trim();

  const rawType =
    directType && directType !== "sync"
      ? directType
      : payloadSyncType || syncType || payloadSyncDataType || syncDataType || payloadType || directType;

  return rawType.replace(/\.\d+$/, "");
}

function hasReasoningLikeChunk(payload: Record<string, unknown>): boolean {
  const properties = asRecord(payload.properties);
  const part = asRecord(properties?.part) ?? asRecord(payload.part);
  const normalizedPartType = asString(part?.type).trim().toLowerCase();

  if (normalizedPartType === "reasoning" || normalizedPartType === "thinking") {
    return true;
  }

  const reasoningFields = [
    part?.reasoning,
    part?.thought,
    part?.thinking,
    properties?.reasoning,
    properties?.thought,
    properties?.thinking,
    payload.reasoning,
    payload.thought,
    payload.thinking,
  ];

  return reasoningFields.some((value) => asString(value).trim().length > 0);
}

function hasDeltaProperty(payload: Record<string, unknown>): boolean {
  const properties = asRecord(payload.properties);
  const part = asRecord(properties?.part) ?? asRecord(payload.part);
  const syncEvent = asRecord(payload.syncEvent);
  const syncData = asRecord(syncEvent?.data);
  const payloadRecord = asRecord(payload.payload);

  return [
    payload.delta,
    properties?.delta,
    part?.delta,
    syncData?.delta,
    asRecord(syncData?.part)?.delta,
    payloadRecord?.delta,
    asRecord(payloadRecord?.properties)?.delta,
    asRecord(asRecord(payloadRecord?.properties)?.part)?.delta,
    payload.text,
    payload.content,
    payload.chunk,
  ].some((value) => typeof value === "string" && value.length > 0);
}

function isPatchPart(payload: Record<string, unknown>): boolean {
  const properties = asRecord(payload.properties);
  const part = asRecord(properties?.part) ?? asRecord(payload.part);
  const syncEvent = asRecord(payload.syncEvent);
  const syncData = asRecord(syncEvent?.data);
  const syncPart = asRecord(syncData?.part);
  const payloadRecord = asRecord(payload.payload);
  const payloadProperties = asRecord(payloadRecord?.properties);
  const payloadPart = asRecord(payloadProperties?.part) ?? asRecord(payloadRecord?.part);

  return [part, syncPart, payloadPart].some(
    (p) => asString(p?.type).trim().toLowerCase() === "patch",
  );
}

function isEphemeralCentralizedPayload(payload: Record<string, unknown>): boolean {
  const eventType = normalizedCentralizedEventType(payload);
  if (eventType !== "message.part.updated") {
    return false;
  }

  return hasReasoningLikeChunk(payload) || hasDeltaProperty(payload) || isPatchPart(payload);
}

export type CentralizedDebugPayloadDisposition =
  | "persist"
  | "excluded-noise"
  | "live-only";

export function getCentralizedDebugPayloadDisposition(
  payload: unknown,
): CentralizedDebugPayloadDisposition {
  const event = asRecord(payload);
  if (!event) {
    return "persist";
  }

  if (isEphemeralCentralizedPayload(event)) {
    return "live-only";
  }

  for (const candidate of candidatePayloads(event)) {
    const record = asRecord(candidate);
    if (!record) {
      continue;
    }

    for (const rule of CENTRALIZED_DEBUG_EXCLUDED_PATH_RULES) {
      const value = valueAtDotPath(record, rule.path);
      if (
        rule.values.some(
          (expected) => asString(value).trim().toLowerCase() === expected.toLowerCase(),
        )
      ) {
        const normalizedType = normalizedCentralizedEventType(record);
        return normalizedType === "tui.toast.show" || normalizedType === "tui.show" || normalizedType === "session.status"
          ? "live-only"
          : "excluded-noise";
      }
    }
  }

  return "persist";
}

export function getCentralizedDebugPayloadIdentity(payload: unknown): string {
  const event = asRecord(payload);
  if (!event) {
    return "";
  }

  const properties = asRecord(event.properties);
  const info = asRecord(properties?.info) ?? asRecord(event.info);
  const part = asRecord(properties?.part) ?? asRecord(event.part);
  const syncEvent = asRecord(event.syncEvent);
  const payloadRecord = asRecord(event.payload);
  const payloadSyncEvent = asRecord(payloadRecord?.syncEvent);
  const payloadSyncData = asRecord(payloadSyncEvent?.data);

  const id = [
    event.id,
    payloadRecord?.id,
    syncEvent?.id,
    payloadSyncEvent?.id,
    info?.id,
    info?.messageID,
    info?.messageId,
    part?.id,
    part?.partID,
    part?.partId,
  ]
    .map((value) => asString(value).trim())
    .find((value) => value.length > 0);

  if (!id) {
    return "";
  }

  const type = normalizedCentralizedEventType(event);
  const sessionId =
    asString(event.sessionId).trim() ||
    asString(event.sessionID).trim() ||
    asString(properties?.sessionID).trim() ||
    asString(properties?.sessionId).trim() ||
    asString(payloadSyncData?.sessionID).trim() ||
    asString(payloadSyncData?.sessionId).trim();

  return [type, sessionId, id].filter(Boolean).join("|");
}

export function centralizedDebugPayloadFingerprint(payload: unknown): string {
  if (payload == null) {
    return "";
  }

  if (typeof payload !== "object") {
    return `${typeof payload}:${String(payload)}`;
  }

  const event = asRecord(payload);
  if (!event) {
    return "";
  }

  const properties = asRecord(event.properties);
  const part = asRecord(properties?.part) ?? asRecord(event.part);
  const info = asRecord(properties?.info) ?? asRecord(event.info);
  const syncEvent = asRecord(event.syncEvent);
  const syncData = asRecord(syncEvent?.data);
  const syncInfo = asRecord(syncData?.info);
  const payloadRecord = asRecord(event.payload);
  const wrappedPayload = payloadRecord ? asRecord(payloadRecord.payload) : null;

  const values = [
    event.id,
    event.type,
    event.source,
    event.sessionId,
    event.sessionID,
    properties?.sessionID,
    properties?.sessionId,
    properties?.messageID,
    properties?.messageId,
    info?.id,
    info?.messageID,
    info?.messageId,
    part?.id,
    part?.type,
    part?.messageID,
    part?.messageId,
    part?.partID,
    part?.partId,
    syncData?.id,
    syncData?.type,
    syncInfo?.id,
    syncInfo?.messageID,
    syncInfo?.messageId,
    payloadRecord?.id,
    payloadRecord?.type,
    wrappedPayload?.id,
    wrappedPayload?.type,
  ];

  const normalizedValues = values
    .map((value) => asString(value).trim())
    .filter((value) => value.length > 0);

  if (normalizedValues.length > 0) {
    return normalizedValues.join("|");
  }

  // DO NOT use JSON.stringify as a fallback fingerprint!
  // It is extremely slow for large objects and incorrectly drops stream chunks.
  // We use a counter to ensure unidentified events remain unique.
  return `unique_unidentified_${Math.random()}_{Date.now()}`;
}

export function dedupeCentralizedDebugPayloads(payloads: unknown[]): unknown[] {
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return [];
  }

  const deduped: unknown[] = [];
  const seen = new Set<string>();

  for (const payload of payloads) {
    const key =
      getCentralizedDebugPayloadIdentity(payload) ||
      centralizedDebugPayloadFingerprint(payload);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(payload);
  }

  return deduped;
}

export function sanitizeCentralizedDebugPayload(payload: unknown): unknown {
  const event = asRecord(payload);
  if (!event) {
    return payload;
  }

  const cloned = shallowCloneRecord(event);
  for (const path of CENTRALIZED_DEBUG_STRIP_FORMAT_PATHS) {
    stripDotPathIfJsonSchema(cloned, path);
  }
  return cloned;
}

export function shouldIncludeCentralizedDebugPayload(payload: unknown): boolean {
  return getCentralizedDebugPayloadDisposition(payload) === "persist";
}

export function shouldPersistCentralizedSessionEventPayload(payload: unknown): boolean {
  const event = asRecord(payload);
  if (!event) {
    return true;
  }

  if (!shouldIncludeCentralizedDebugPayload(payload)) {
    return false;
  }

  // NOTE: Removed source filtering for "/global/event" to allow tool events
  // to be persisted. Tool events like bash, webfetch, etc. often come from
  // "/global/event" source and should be included in centralized data.

  // Persist every non-noise centralized event. The centralized tape is the
  // durable source of truth, so trimming to a small allowlist can silently
  // drop important lifecycle frames that power hydration and timeline parity.
  return normalizedCentralizedEventType(event).length > 0;
}

export function appendAndDedupeCentralizedDebugPayload(existing: unknown[], newPayload: unknown): unknown[] {
  if (!Array.isArray(existing)) {
    return [newPayload];
  }
  const newKey =
    getCentralizedDebugPayloadIdentity(newPayload) ||
    centralizedDebugPayloadFingerprint(newPayload);

  const limit = Math.max(0, existing.length - 50);
  for (let i = existing.length - 1; i >= limit; i--) {
    const existingKey =
      getCentralizedDebugPayloadIdentity(existing[i]) ||
      centralizedDebugPayloadFingerprint(existing[i]);
    if (existingKey === newKey) {
      return existing; // Duplicate found, ignore new payload
    }
  }

  return [...existing, newPayload];
}
