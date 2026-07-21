type WebviewStreamQueueItem = {
  event: unknown;
  sessionId?: string;
  immediate?: boolean;
};

type DeltaDescriptor = {
  event: Record<string, unknown>;
  properties: Record<string, unknown>;
  part: Record<string, unknown>;
  delta: string;
  field: string;
  identity: string;
};

const COALESCIBLE_DELTA_FIELDS = new Set([
  "text",
  "content",
  "message",
  "output_text",
  "reasoning",
  "thinking",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return "";
}

function describeDelta(item: WebviewStreamQueueItem): DeltaDescriptor | undefined {
  if (item.immediate) return undefined;
  const event = asRecord(item.event);
  const properties = asRecord(event?.properties);
  const part = asRecord(properties?.part);
  if (!event || !properties || !part || event.type !== "message.part.updated") {
    return undefined;
  }

  const field = firstString(properties.field).toLowerCase();
  const delta = typeof properties.delta === "string" ? properties.delta : undefined;
  if (!delta || !COALESCIBLE_DELTA_FIELDS.has(field)) {
    return undefined;
  }

  // Canonical SDK delta adapters duplicate the same chunk into `part.delta`
  // and `part[field]`. Requiring that exact shape prevents full snapshots,
  // structured events, and tool/lifecycle payloads from being merged.
  if (part.delta !== delta || part[field] !== delta) {
    return undefined;
  }
  if (event.structured || event.structuredOutput || properties.structuredOutput) {
    return undefined;
  }

  const partID = firstString(properties.partID, properties.partId, part.id);
  const messageID = firstString(
    properties.messageID,
    properties.messageId,
    part.messageID,
    part.messageId,
  );
  const sessionID = firstString(
    item.sessionId,
    properties.sessionID,
    properties.sessionId,
    part.sessionID,
    part.sessionId,
  );
  if (!partID || !messageID || !sessionID) {
    return undefined;
  }

  return {
    event,
    properties,
    part,
    delta,
    field,
    identity: `${sessionID}\u0000${messageID}\u0000${partID}\u0000${field}`,
  };
}

/**
 * Merge only adjacent canonical token deltas for the same stream part.
 * Persisted SDK events are unaffected; this operates solely on detached,
 * webview-bound queue items to reduce IPC payload count and reducer churn.
 */
export function coalesceWebviewStreamDelta(
  queue: WebviewStreamQueueItem[],
  incoming: WebviewStreamQueueItem,
): boolean {
  const previousIndex = queue.length - 1;
  if (previousIndex < 0) return false;

  const previous = describeDelta(queue[previousIndex]);
  const next = describeDelta(incoming);
  if (!previous || !next || previous.identity !== next.identity) {
    return false;
  }

  const delta = previous.delta + next.delta;
  queue[previousIndex] = {
    ...incoming,
    event: {
      ...next.event,
      properties: {
        ...next.properties,
        delta,
        part: {
          ...next.part,
          [next.field]: delta,
          delta,
        },
      },
    },
  };
  return true;
}

/**
 * Remove duplicate canonical-adapter delta strings immediately before IPC.
 * The webview reads `properties.delta` and uses the nested part only for
 * identity/type. The authoritative persisted/debug event is never modified.
 */
export function compactWebviewStreamDeltaForTransport(eventValue: unknown): unknown {
  const descriptor = describeDelta({ event: eventValue });
  if (!descriptor) return eventValue;

  const part = { ...descriptor.part };
  delete part.delta;
  delete part[descriptor.field];

  return {
    ...descriptor.event,
    properties: {
      ...descriptor.properties,
      part,
    },
  };
}
