export type UnknownRecord = Record<string, unknown>;

export interface CanonicalStreamEvent {
  type: string;
  properties?: UnknownRecord;
  directory?: string;
  source?: string;
  syncName?: string;
  syncId?: string;
  syncSeq?: number;
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as UnknownRecord)
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeSyncRecord(
  value: UnknownRecord | undefined,
  inheritedDirectory?: string,
): CanonicalStreamEvent | undefined {
  if (!value || value.type !== "sync") return undefined;
  const name = firstString(value.name);
  const data = asRecord(value.data);
  if (!name || !data) return undefined;
  const eventType = name.replace(/\.\d+$/, "");
  if (!eventType || eventType === "sync") return undefined;
  const normalized: CanonicalStreamEvent = {
    type: eventType,
    properties: data,
    syncName: name,
  };
  if (inheritedDirectory) normalized.directory = inheritedDirectory;
  if (typeof value.id === "string") normalized.syncId = value.id;
  if (typeof value.seq === "number") normalized.syncSeq = value.seq;
  return normalized;
}

function normalizePartDelta(
  value: UnknownRecord,
  inheritedDirectory?: string,
): CanonicalStreamEvent | undefined {
  if (value.type !== "message.part.delta") return undefined;
  const properties = asRecord(value.properties);
  if (!properties) return undefined;
  const partID = firstString(properties.partID, properties.partId);
  const field = firstString(properties.field);
  const delta = firstString(properties.delta);
  if (!partID || !field || typeof delta !== "string") return undefined;
  const part: UnknownRecord = {
    id: partID,
    sessionID: properties.sessionID,
    sessionId: properties.sessionId,
    messageID: properties.messageID,
    messageId: properties.messageId,
    type: field === "text" ? "text" : field,
    [field]: delta,
    delta,
  };
  const normalized: CanonicalStreamEvent = {
    type: "message.part.updated",
    properties: {
      ...properties,
      part,
      delta,
    },
  };
  if (inheritedDirectory) normalized.directory = inheritedDirectory;
  return normalized;
}

export function normalizeSdkStreamEvent(rawEvent: unknown): CanonicalStreamEvent | null {
  const eventRecord = asRecord(rawEvent);
  if (!eventRecord) return null;
  const inheritedDirectory = firstString(eventRecord.directory);

  const candidates = [
    eventRecord,
    asRecord(eventRecord.payload),
    asRecord(eventRecord.data),
    asRecord(asRecord(eventRecord.payload)?.payload),
    asRecord(asRecord(eventRecord.payload)?.data),
  ];

  for (const candidate of candidates) {
    const sync = normalizeSyncRecord(candidate, inheritedDirectory);
    if (sync) return sync;
    if (candidate) {
      const delta = normalizePartDelta(candidate, inheritedDirectory);
      if (delta) return delta;
    }
  }

  for (const candidate of candidates) {
    if (candidate && typeof candidate.type === "string") {
      const normalized = { ...candidate } as CanonicalStreamEvent;
      if (inheritedDirectory && !normalized.directory) {
        normalized.directory = inheritedDirectory;
      }
      return normalized;
    }
  }

  return null;
}

export function getSdkResponseData(response: unknown): unknown {
  const rec = asRecord(response);
  return rec && "data" in rec ? rec.data : response;
}

export function getSdkResponseError(response: unknown): unknown {
  const rec = asRecord(response);
  return rec?.error;
}

export function normalizeSdkAssistantMessage(value: unknown): UnknownRecord | undefined {
  const data = asRecord(getSdkResponseData(value));
  if (!data) return undefined;
  const info = asRecord(data.info);
  const parts = Array.isArray(data.parts) ? data.parts : undefined;
  if (info && parts) {
    return { ...info, parts };
  }
  return data;
}
