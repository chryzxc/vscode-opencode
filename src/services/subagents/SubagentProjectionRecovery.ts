/**
 * Persistence-only recovery for the legacy subagent UI projection.
 *
 * Raw SDK events remain authoritative. This module merely prevents a cached
 * projection from falsely presenting pre-restart work as live while older
 * session data is still supported.
 */
type UnknownRecord = Record<string, unknown>;

export type SubagentProjectionLike = {
  summariesByParentMessageId: Record<string, unknown>;
  detailsById: Record<string, unknown>;
};

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLegacyTextStep(value: unknown): boolean {
  return typeof value === "string" && /^text:\s*/i.test(value);
}

function repairConversationEvents(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value
    .filter((event) => {
      if (!isRecord(event)) return true;
      return !(event.kind === "step" && isLegacyTextStep(event.text));
    })
    .map((event) => {
      if (!isRecord(event) || typeof event.text !== "string") return event;
      return { ...event, text: event.text.replace(/<\s+(?=[A-Za-z])/g, "<") };
    });
}

function repairProjectionEntry(entry: UnknownRecord): UnknownRecord {
  const filterEvents = (value: unknown, labelField: "title" | "label") =>
    Array.isArray(value)
      ? value.filter((event) => !isRecord(event) || !isLegacyTextStep(event[labelField]))
      : value;

  return {
    ...entry,
    latestActivity: isLegacyTextStep(entry.latestActivity)
      ? "Subagent update"
      : entry.latestActivity,
    progressEvents: filterEvents(entry.progressEvents, "title"),
    timelineEvents: filterEvents(entry.timelineEvents, "label"),
    conversationEvents: repairConversationEvents(entry.conversationEvents),
    rawConversationEvents: repairConversationEvents(entry.rawConversationEvents),
  };
}

function cancelIfIncomplete(entry: UnknownRecord, cancelledAt: number): UnknownRecord {
  const repaired = repairProjectionEntry(entry);
  const status = typeof repaired.status === "string" ? repaired.status.toLowerCase() : "";
  if (status !== "pending" && status !== "running" && status !== "orphaned") {
    return repaired;
  }

  const startedAt = typeof repaired.startedAt === "number" ? repaired.startedAt : undefined;
  return {
    ...repaired,
    status: "cancelled",
    latestActivity: "Cancelled",
    endedAt: typeof repaired.endedAt === "number" ? repaired.endedAt : cancelledAt,
    durationMs:
      typeof repaired.durationMs === "number"
        ? repaired.durationMs
        : typeof startedAt === "number"
          ? Math.max(0, cancelledAt - startedAt)
          : undefined,
  };
}

/** Repair legacy artifacts and terminalize subagents that belonged to a dead host. */
export function recoverSubagentProjectionAfterRestart<T extends SubagentProjectionLike>(
  projection: T,
  cancelledAt = Date.now(),
): T {
  const summariesByParentMessageId = Object.fromEntries(
    Object.entries(projection.summariesByParentMessageId).map(([parentMessageId, entries]) => [
      parentMessageId,
      Array.isArray(entries)
        ? entries.map((entry) => isRecord(entry) ? cancelIfIncomplete(entry, cancelledAt) : entry)
        : entries,
    ]),
  );
  const detailsById = Object.fromEntries(
    Object.entries(projection.detailsById).map(([id, entry]) => [
      id,
      isRecord(entry) ? cancelIfIncomplete(entry, cancelledAt) : entry,
    ]),
  );
  return { ...projection, summariesByParentMessageId, detailsById } as T;
}
