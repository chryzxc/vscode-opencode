/**
 * State manager module for subagent processing.
 *
 * This module handles merging incoming data with existing state, data conflicts
 * and resolution, hydration logic, and ensuring data consistency.
 */

import type {
  SubagentSummary,
  SubagentDetail,
} from './types';
import { asRecord, asString, asNumber } from '../messageHandler';
import { sanitizeSubagentLabel } from './dataNormalizer';
import {
  normalizeSubagentProgressEventsForPresentation,
  normalizeSubagentTimelineEventsForPresentation
} from './eventBuilder';

/**
 * Merge subagent summaries with existing state
 */
export function mergeSubagentSummaries(
  existing: SubagentSummary[] | undefined,
  incoming: SubagentSummary[],
): SubagentSummary[] {
  const statusRank = (status: SubagentSummary["status"] | undefined): number => {
    if (status === "done" || status === "error" || status === "orphaned") return 2;
    if (status === "running") return 1;
    return 0;
  };

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
    if (statusRank(prev.status) > statusRank(entry.status)) {
      merged.status = prev.status;
    }
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
  const byKey = new Map<string, T>();

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

      if (byKey.has(key)) {
        const existingItemIndex = out.findIndex((entry, entryIndex) => {
          const entryKey = keyBuilder(entry, entryIndex);
          return entryKey === key;
        });
        if (existingItemIndex >= 0) {
          out[existingItemIndex] = item;
        }
      } else {
        out.push(item);
      }
      byKey.set(key, item);
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
    status: incoming.status || existing?.status || "pending",
    latestActivity,
    references,
    thinkingEvents,
    conversationEvents,
    rawConversationEvents,
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
    const filtered = summaries.filter(s => s.parentSessionId !== sessionId);
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