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
    values: ["server.heartbeat", "message.part.delta", "message.part.delta.1"],
  },
  {
    path: "syncEvent.type",
    values: ["message.part.delta", "message.part.delta.1"],
  },
  {
    path: "payload.syncEvent.type",
    values: ["message.part.delta", "message.part.delta.1"],
  },
] as const;

/*
 * Previously excluded rules. Kept here commented during the blacklist
 * reduction pass so we can restore them without re-deriving the paths:
 *
 * - type: step-start, step-finish, sync
 * - source: /global/event
 * - properties.info.format.type: json_schema
 * - payload.properties.info.format.type: json_schema
 * - syncEvent.data.info.format.type: json_schema
 * - payload.syncEvent.data.info.format.type: json_schema
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

function centralizedDebugPayloadFingerprint(payload: unknown): string {
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

  try {
    return JSON.stringify(event);
  } catch {
    return `${Object.prototype.toString.call(event)}:${String(event)}`;
  }
}

export function dedupeCentralizedDebugPayloads(payloads: unknown[]): unknown[] {
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return [];
  }

  const deduped: unknown[] = [];
  const seen = new Set<string>();

  for (const payload of payloads) {
    const key = centralizedDebugPayloadFingerprint(payload);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(payload);
  }

  return deduped;
}

/**
 * Returns true when a raw payload should remain visible in the centralized
 * debug tape.
 *
 * The function is deliberately tolerant of missing/non-object inputs so it can
 * be used safely from both live stream code and rehydrated cache reads.
 */
/**
 * Returns true when a raw payload carries a streaming delta field.
 *
 * Streaming delta chunks (properties.delta or properties.part.delta) carry
 * incremental text fragments and should never appear in the centralized debug
 * tape because they represent transient streaming state rather than meaningful
 * SDK events.
 */
function hasStreamingDelta(event: Record<string, unknown>): boolean {
  const candidates = [
    asString(event.type),
    asString(valueAtDotPath(event, "syncEvent.type")),
    asString(valueAtDotPath(event, "payload.syncEvent.type")),
  ];
  return candidates.some((candidate) =>
    candidate.toLowerCase().includes("message.part.delta"),
  );
}

export function shouldIncludeCentralizedDebugPayload(payload: unknown): boolean {
  const event = asRecord(payload);
  if (!event) {
    return true;
  }
  if (hasStreamingDelta(event)) {
    return false;
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
        return false;
      }
    }
  }

  return true;
}
