/**
 * State manager module for subagent processing.
 *
 * This module handles merging incoming data with existing state, data conflicts
 * and resolution, hydration logic, and ensuring data consistency.
 */

import type {
  SubagentSummary,
  SubagentDetail,
  SubagentEntityStore,
} from './types';
import { asRecord, asString, asNumber } from '../messageHandler';
import { sanitizeSubagentLabel } from './dataNormalizer';
import {
  normalizeSubagentProgressEventsForPresentation,
  normalizeSubagentTimelineEventsForPresentation
} from './eventBuilder';

function subagentStatusRank(status: SubagentSummary["status"] | undefined): number {
  switch (status) {
    case "done":
    case "error":
    case "orphaned":
    case "cancelled":
      return 2;
    case "running":
      return 1;
    default:
      return 0;
  }
}

/** Do not let an older live projection revive an already-terminal subagent. */
function mergeSubagentStatus(
  existing: SubagentSummary["status"] | undefined,
  incoming: SubagentSummary["status"] | undefined,
): SubagentSummary["status"] {
  if (!incoming) return existing || "pending";
  return subagentStatusRank(existing) > subagentStatusRank(incoming)
    ? existing!
    : incoming;
}

function emptySubagentEventCollections(): Pick<SubagentDetail,
  'references' | 'thinkingEvents' | 'conversationEvents' | 'rawEvents' | 'progressEvents' | 'timelineEvents'> {
  // Each stub must own its collections: streaming merges append/replace arrays
  // over time, and shared empty array references make that behavior fragile.
  return {
    references: [],
    thinkingEvents: [],
    conversationEvents: [],
    rawEvents: [],
    progressEvents: [],
    timelineEvents: [],
  };
}

export function createSubagentEntityStore(): SubagentEntityStore {
  return {
    version: 1,
    byId: {},
    idsByParentMessageId: {},
    idByChildSessionId: {},
    updatedAt: 0,
  };
}

function detailFromSummary(summary: SubagentSummary): SubagentDetail {
  return {
    ...summary,
    ...emptySubagentEventCollections(),
    references: [...summary.references],
  };
}

function buildSubagentIndexes(byId: Record<string, SubagentDetail>): Pick<SubagentEntityStore,
  'idsByParentMessageId' | 'idByChildSessionId'> {
  const idsByParentMessageId: Record<string, string[]> = {};
  const idByChildSessionId: Record<string, string> = {};

  for (const detail of Object.values(byId)) {
    if (!detail?.id) continue;
    if (detail.parentMessageId) {
      (idsByParentMessageId[detail.parentMessageId] ??= []).push(detail.id);
    }
    if (detail.childSessionId) {
      idByChildSessionId[detail.childSessionId] = detail.id;
    }
  }

  return { idsByParentMessageId, idByChildSessionId };
}

function finalizeSubagentEntityStore(byId: Record<string, SubagentDetail>): SubagentEntityStore {
  return {
    version: 1,
    byId,
    ...buildSubagentIndexes(byId),
    updatedAt: Date.now(),
  };
}

/** Merge incoming compatibility summaries into the canonical entity store. */
export function upsertSubagentSummariesIntoStore(
  store: SubagentEntityStore,
  incomingByParentId: Record<string, SubagentSummary[]>,
): SubagentEntityStore {
  const byId = { ...store.byId };
  for (const summaries of Object.values(incomingByParentId)) {
    for (const summary of summaries ?? []) {
      if (!summary?.id) continue;
      byId[summary.id] = mergeSubagentDetailRecord(
        byId[summary.id],
        detailFromSummary(summary),
      );
    }
  }
  return finalizeSubagentEntityStore(byId);
}

/** Merge incoming detailed records into the canonical entity store. */
export function upsertSubagentDetailsIntoStore(
  store: SubagentEntityStore,
  incomingById: Record<string, SubagentDetail>,
): SubagentEntityStore {
  const byId = { ...store.byId };
  for (const detail of Object.values(incomingById)) {
    if (!detail?.id) continue;
    byId[detail.id] = mergeSubagentDetailRecord(byId[detail.id], detail);
  }
  return finalizeSubagentEntityStore(byId);
}

/** Compatibility selector for the existing message-oriented UI. */
export function selectSubagentSummariesByParentMessageId(
  store: SubagentEntityStore,
): Record<string, SubagentSummary[]> {
  const summaries: Record<string, SubagentSummary[]> = {};
  for (const [parentMessageId, ids] of Object.entries(store.idsByParentMessageId)) {
    const entries = ids.map((id) => store.byId[id]).filter((detail): detail is SubagentDetail => Boolean(detail));
    if (entries.length > 0) summaries[parentMessageId] = entries;
  }
  return summaries;
}

/**
 * Merge subagent summaries with existing state
 */
export function mergeSubagentSummaries(
  existing: SubagentSummary[] | undefined,
  incoming: SubagentSummary[],
): SubagentSummary[] {
  const byId = new Map<string, SubagentSummary>();
  const source = Array.isArray(existing) ? existing : [];

  source.forEach((entry) => {
    if (entry?.id) {
      byId.set(entry.id, entry);
    }
  });

  incoming.forEach((entry) => {
    if (!entry?.id) {
      return;
    }
    const prev = byId.get(entry.id);
    if (!prev) {
      byId.set(entry.id, entry);
      return;
    }

    // Merge with preference for higher rank status
    const merged = { ...prev, ...entry, id: entry.id };
    merged.status = mergeSubagentStatus(prev.status, entry.status);
    byId.set(entry.id, merged);
  });

  return Array.from(byId.values());
}

/**
 * Check if summaries object has any entries
 */
export function hasSubagentSummaryEntries(
  summariesByParentMessageId: Record<string, SubagentSummary[]>,
): boolean {
  return Object.values(summariesByParentMessageId).some(
    (entries) => Array.isArray(entries) && entries.length > 0
  );
}

/**
 * Merge unique subagent entries based on key function
 */
export function mergeUniqueSubagentEntries<T>(
  existing: T[] | undefined,
  incoming: T[] | undefined,
  keyBuilder: (item: T, index: number) => string,
): T[] {
  const out: T[] = [];
  const indexByKey = new Map<string, number>();

  const push = (items: T[] | undefined) => {
    if (!Array.isArray(items) || items.length === 0) {
      return;
    }

    items.forEach((item, index) => {
      const key = keyBuilder(item, index);
      if (!key) {
        out.push(item);
        return;
      }

      const existingItemIndex = indexByKey.get(key);
      if (typeof existingItemIndex === "number") {
        out[existingItemIndex] = item;
        return;
      }

      indexByKey.set(key, out.length);
      out.push(item);
    });
  };

  push(existing);
  push(incoming);
  return out;
}

/**
 * Merge subagent detail records with intelligent conflict resolution
 */
export function mergeSubagentDetailRecord(
  existing: SubagentDetail | undefined,
  incoming: SubagentDetail,
): SubagentDetail {
  const latestActivity =
    sanitizeSubagentLabel(incoming.latestActivity || "") ||
    sanitizeSubagentLabel(existing?.latestActivity || "") ||
    "Subagent update";

  const references = mergeUniqueSubagentEntries(
    existing?.references,
    incoming.references,
    (entry) =>
      `${entry.messageID || ""}|${entry.partID || ""}|${entry.callID || ""}`,
  );

  const thinkingEvents = mergeUniqueSubagentEntries(
    existing?.thinkingEvents,
    incoming.thinkingEvents,
    (event, index) =>
      event.id || `${event.createdAt || 0}:${event.text || ""}:${index}`,
  );

  const conversationEvents = mergeUniqueSubagentEntries(
    existing?.conversationEvents,
    incoming.conversationEvents,
    (event, index) =>
      event.id ||
      `${event.role || ""}:${event.kind || ""}:${event.createdAt || 0}:${event.text || ""}:${index}`,
  );

  const rawConversationEvents = mergeUniqueSubagentEntries(
    existing?.rawConversationEvents,
    incoming.rawConversationEvents,
    (event, index) => {
      const rec = asRecord(event);
      return (
        asString(rec?.id) ||
        `${asString(rec?.messageID) || asString(rec?.messageId) || ""}:${asString(rec?.partID) || asString(rec?.partId) || ""}:${asString(rec?.kind) || asString(rec?.role) || ""}:${asString(rec?.text) || asString(rec?.content) || ""}:${asNumber(rec?.createdAt)}:${index}`
      );
    },
  );

  const rawEvents = mergeUniqueSubagentEntries(
    existing?.rawEvents,
    incoming.rawEvents,
    (event, index) => {
      const rec = asRecord(event);
      return asString(rec?.id) || `${asString(rec?.type)}:${index}`;
    },
  );

  const progressEvents = normalizeSubagentProgressEventsForPresentation(
    mergeUniqueSubagentEntries(
      existing?.progressEvents,
      incoming.progressEvents,
      (event, index) =>
        event.callID ||
        event.id ||
        `${event.title || ""}:${event.status || ""}:${event.createdAt || 0}:${index}`,
    ),
  );

  const timelineEvents = normalizeSubagentTimelineEventsForPresentation(
    mergeUniqueSubagentEntries(
      existing?.timelineEvents,
      incoming.timelineEvents,
      (event, index) =>
        event.key ||
        `${event.type || ""}:${event.label || ""}:${event.createdAt || 0}:${index}`,
    ),
  );

  return {
    ...(existing || incoming),
    ...incoming,
    id: incoming.id || existing?.id || "",
    parentSessionId:
      incoming.parentSessionId || existing?.parentSessionId || "",
    parentMessageId:
      incoming.parentMessageId || existing?.parentMessageId || "",
    status: mergeSubagentStatus(existing?.status, incoming.status),
    latestActivity,
    references,
    thinkingEvents,
    conversationEvents,
    rawConversationEvents,
    rawEvents,
    progressEvents,
    timelineEvents,
  };
}

/**
 * Merge subagent detail payloads (maps of IDs to details)
 */
export function mergeSubagentDetailPayload(
  existingById: Record<string, SubagentDetail>,
  incomingById: Record<string, SubagentDetail>,
): Record<string, SubagentDetail> {
  const merged: Record<string, SubagentDetail> = {};

  // First merge existing entries
  for (const [detailId, detail] of Object.entries(existingById)) {
    if (detail) {
      merged[detailId] = detail;
    }
  }

  // Then merge/override with incoming entries
  for (const [detailId, incoming] of Object.entries(incomingById)) {
    if (!incoming) {
      continue;
    }
    merged[detailId] = mergeSubagentDetailRecord(
      existingById[detailId],
      incoming,
    );
  }

  return merged;
}

/**
 * Merge subagent summary payload into existing state
 */
export function mergeSubagentSummaryPayload(
  existingByParentId: Record<string, SubagentSummary[]>,
  incomingByParentId: Record<string, SubagentSummary[]>,
): Record<string, SubagentSummary[]> {
  const merged: Record<string, SubagentSummary[]> = {};

  // First copy existing entries
  for (const [parentId, summaries] of Object.entries(existingByParentId)) {
    merged[parentId] = [...summaries];
  }

  // Then merge incoming summaries
  for (const [parentId, incoming] of Object.entries(incomingByParentId)) {
    if (!Array.isArray(incoming) || incoming.length === 0) {
      continue;
    }
    merged[parentId] = mergeSubagentSummaries(merged[parentId], incoming);
  }

  return merged;
}

/**
 * Hydrate subagent summary with additional data from structured output
 */
export function hydrateSubagentSummary(
  summary: SubagentSummary,
  hydrationData: {
    agentRole?: string;
    providerID?: string;
    modelID?: string;
    startedAt?: number;
    endedAt?: number;
    durationMs?: number;
    latestActivity?: string;
  }
): SubagentSummary {
  return {
    ...summary,
    agentRole: hydrationData.agentRole || summary.agentRole,
    providerID: hydrationData.providerID || summary.providerID,
    modelID: hydrationData.modelID || summary.modelID,
    startedAt: hydrationData.startedAt || summary.startedAt,
    endedAt: hydrationData.endedAt || summary.endedAt,
    durationMs: hydrationData.durationMs || summary.durationMs,
    latestActivity: hydrationData.latestActivity || summary.latestActivity,
  };
}

/**
 * Check if two subagent lists are equivalent (for change detection)
 */
export function areSubagentListsEquivalent(
  list1: SubagentSummary[] | undefined,
  list2: SubagentSummary[] | undefined,
): boolean {
  if (!Array.isArray(list1) && !Array.isArray(list2)) {
    return true;
  }
  if (!Array.isArray(list1) || !Array.isArray(list2)) {
    return false;
  }
  if (list1.length !== list2.length) {
    return false;
  }

  const byId1 = new Map(list1.map(s => [s.id, s]));
  const byId2 = new Map(list2.map(s => [s.id, s]));

  for (const [id, summary1] of byId1) {
    const summary2 = byId2.get(id);
    if (!summary2) return false;

    // Compare key fields
    if (summary1.status !== summary2.status) return false;
    if (summary1.latestActivity !== summary2.latestActivity) return false;
    if (summary1.agentRole !== summary2.agentRole) return false;
  }

  return true;
}

/**
 * Clear subagents for a specific session
 */
export function clearSubagentsForSession(
  existingByParentId: Record<string, SubagentSummary[]>,
  sessionId: string
): Record<string, SubagentSummary[]> {
  const cleared: Record<string, SubagentSummary[]> = {};

  for (const [parentId, summaries] of Object.entries(existingByParentId)) {
    const filtered = summaries.filter(s => s && typeof s.parentSessionId === 'string' && s.parentSessionId !== sessionId);
    if (filtered.length > 0) {
      cleared[parentId] = filtered;
    }
  }

  return cleared;
}

/**
 * Update subagent status
 */
export function updateSubagentStatus(
  summary: SubagentSummary,
  newStatus: SubagentSummary['status'],
  latestActivity?: string
): SubagentSummary {
  return {
    ...summary,
    status: newStatus,
    latestActivity: latestActivity || summary.latestActivity,
    endedAt: (newStatus === 'done' || newStatus === 'error' || newStatus === 'orphaned')
      ? summary.endedAt || Date.now()
      : summary.endedAt,
    durationMs: (newStatus === 'done' || newStatus === 'error' || newStatus === 'orphaned')
      ? summary.durationMs || (summary.startedAt ? Date.now() - summary.startedAt : undefined)
      : summary.durationMs,
  };
}
