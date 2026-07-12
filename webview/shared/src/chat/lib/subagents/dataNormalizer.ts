/**
 * Data normalizer module for subagent processing.
 *
 * This module handles cleaning and normalizing raw subagent data, applying
 * data validation, handling missing/optional fields, and ensuring type safety.
 */

import type {
  SubagentSummary,
  SubagentDetail,
  SubagentReference,
  SubagentThinkingEvent,
  SubagentConversationEvent,
  SubagentProgressEvent,
  SubagentTimelineEvent,
} from './types';
import { asRecord, asString } from '../messageHandler';

/**
 * Check if value is a valid subagent status
 */
export function isSubagentStatus(value: unknown): value is SubagentSummary['status'] {
  return value === 'pending' || value === 'running' || value === 'done' || value === 'error' || value === 'orphaned' || value === 'cancelled';
}

/**
 * Check if value is an opaque subagent token (ID that should be hidden from UI)
 */
function isOpaqueSubagentToken(value: string): boolean {
  const text = value.trim();
  if (text.length < 8) {
    return false;
  }
  return (
    /^[a-f0-9-]{8,}$/i.test(text) ||
    /^msg[_-][a-z0-9-]+$/i.test(text) ||
    /^call[_-][a-z0-9-]+$/i.test(text) ||
    /^ses[_-][a-z0-9-]+$/i.test(text)
  );
}

/**
 * Sanitize subagent label by removing opaque tokens and normalizing whitespace
 */
export function sanitizeSubagentLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || isOpaqueSubagentToken(trimmed)) {
    return '';
  }
  return trimmed.replace(/\s+/g, ' ');
}

/**
 * Normalize progress event status
 */
function normalizeProgressStatus(status: string | undefined): 'pending' | 'done' | 'error' {
  const normalized = (status || 'pending').toLowerCase();
  if (normalized === 'done' || normalized === 'completed' || normalized === 'success') {
    return 'done';
  }
  if (normalized === 'error' || normalized === 'failed' || normalized === 'cancelled') {
    return 'error';
  }
  return 'pending';
}

/**
 * Normalize subagent summary from raw data
 */
export function normalizeSubagentSummary(value: unknown): SubagentSummary | null {
  const rec = asRecord(value);
  if (!rec) {
    return null;
  }

  const id = asString(rec.id);
  const parentSessionId = asString(rec.parentSessionId);
  const parentMessageId = asString(rec.parentMessageId);
  if (!id || !parentSessionId || !parentMessageId) {
    return null;
  }

  const references = Array.isArray(rec.references)
    ? rec.references
      .map((entry) => {
        const ref = asRecord(entry);
        if (!ref) {
          return null;
        }
        const res: SubagentReference = {
          messageID: asString(ref.messageID) || undefined,
          partID: asString(ref.partID) || undefined,
          callID: asString(ref.callID) || undefined,
        };
        if (!res.messageID && !res.partID && !res.callID) {
          return null;
        }
        return res;
      })
      .filter((entry): entry is SubagentReference => !!entry)
    : [];

  return {
    id,
    parentSessionId,
    parentMessageId,
    childSessionId: asString(rec.childSessionId) || undefined,
    backgroundTaskId:
      asString(rec.backgroundTaskId) ||
      asString(rec.background_task_id) ||
      undefined,
    agentId: asString(rec.agentId) || asString(rec.agent) || undefined,
    agentRole: asString(rec.agentRole) || undefined,
    providerID: asString(rec.providerID) || undefined,
    modelID: asString(rec.modelID) || undefined,
    startedAt: asOptionalNumber(rec.startedAt),
    endedAt: asOptionalNumber(rec.endedAt),
    durationMs: asOptionalNumber(rec.durationMs),
    status: isSubagentStatus(rec.status) ? rec.status : 'pending',
    latestActivity: sanitizeSubagentLabel(asString(rec.latestActivity)) || 'Subagent update',
    references
  };
}

/**
 * Normalize subagent detail from raw data
 */
export function normalizeSubagentDetail(value: unknown): SubagentDetail | null {
  const summary = normalizeSubagentSummary(value);
  if (!summary) {
    return null;
  }
  const rec = asRecord(value);
  if (!rec) {
    return null;
  }

  const thinkingEvents = Array.isArray(rec.thinkingEvents)
    ? rec.thinkingEvents
      .map((entry, index) => {
        const evt = asRecord(entry);
        if (!evt) {
          return null;
        }
        const text = asString(evt.text);
        if (!text) {
          return null;
        }
        const res: SubagentThinkingEvent = {
          id: asString(evt.id) || `${summary.id}:thinking:${index}`,
          text,
          createdAt: asNumber(evt.createdAt, Date.now()),
          messageID: asString(evt.messageID) || undefined,
          partID: asString(evt.partID) || undefined,
        };
        return res;
      })
      .filter((entry): entry is SubagentThinkingEvent => !!entry)
    : [];

  const conversationEvents = Array.isArray(rec.conversationEvents)
    ? rec.conversationEvents
      .map((entry, index) => {
        const evt = asRecord(entry);
        if (!evt) {
          return null;
        }
        const text = asString(evt.text);
        if (!text) {
          return null;
        }
        const rawKind = asString(evt.kind).toLowerCase();
        const kind =
          rawKind === 'reasoning' || rawKind === 'step'
            ? rawKind
            : 'message';
        return {
          id: asString(evt.id) || `${summary.id}:conversation:${index}`,
          role: asString(evt.role) || 'assistant',
          kind,
          text,
          createdAt: asNumber(evt.createdAt, Date.now()),
          messageID: asString(evt.messageID) || undefined,
          partID: asString(evt.partID) || undefined,
        };
      })
      .filter((entry): entry is SubagentConversationEvent => !!entry)
    : [];

  const rawConversationEvents = Array.isArray(rec.conversationEvents)
    ? [...rec.conversationEvents]
    : [];
  const rawEvents = Array.isArray(rec.rawEvents) ? [...rec.rawEvents] : [];

  const progressEvents = Array.isArray(rec.progressEvents)
    ? rec.progressEvents
      .map((entry, index) => {
        const evt = asRecord(entry);
        if (!evt) {
          return null;
        }
        const title = sanitizeSubagentLabel(asString(evt.title));
        if (!title) {
          return null;
        }
        const res: SubagentProgressEvent = {
          id: asString(evt.id) || `${summary.id}:progress:${index}`,
          title,
          status: normalizeProgressStatus(asString(evt.status)),
          meta: asString(evt.meta) || undefined,
          filePath: asString(evt.filePath) || undefined,
          createdAt: asNumber(evt.createdAt, Date.now()),
          messageID: asString(evt.messageID) || undefined,
          partID: asString(evt.partID) || undefined,
          callID: asString(evt.callID) || undefined,
        };
        return res;
      })
      .filter((entry): entry is SubagentProgressEvent => !!entry)
    : [];

  const timelineEvents = Array.isArray(rec.timelineEvents)
    ? rec.timelineEvents
      .map((entry, index) => {
        const evt = asRecord(entry);
        if (!evt) {
          return null;
        }
        const key = asString(evt.key);
        const type = asString(evt.type);
        const label = sanitizeSubagentLabel(asString(evt.label));
        if (!key || !type || !label) {
          return null;
        }
        const res: SubagentTimelineEvent = {
          key: key || `${summary.id}:timeline:${index}`,
          type,
          label,
          createdAt: asNumber(evt.createdAt, Date.now()),
          messageID: asString(evt.messageID) || undefined,
          partID: asString(evt.partID) || undefined,
          callID: asString(evt.callID) || undefined,
        };
        return res;
      })
      .filter((entry): entry is SubagentTimelineEvent => !!entry)
    : [];

  const normalizedProgressEvents =
    normalizeSubagentProgressEventsForPresentation(progressEvents);
  const normalizedTimelineEvents =
    normalizeSubagentTimelineEventsForPresentation(timelineEvents);

  const tokenUsageRec = asRecord(rec.tokenUsage);
  const tokenCacheRec = asRecord(tokenUsageRec?.cache);

  return {
    ...summary,
    thinkingEvents,
    rawEvents,
    conversationEvents,
    rawConversationEvents,
    progressEvents: normalizedProgressEvents,
    timelineEvents: normalizedTimelineEvents,
    tokenUsage: tokenUsageRec
      ? {
        input: asOptionalNumber(tokenUsageRec.input),
        output: asOptionalNumber(tokenUsageRec.output),
        reasoning: asOptionalNumber(tokenUsageRec.reasoning),
        cache: tokenCacheRec
          ? {
            read: asOptionalNumber(tokenCacheRec.read),
            write: asOptionalNumber(tokenCacheRec.write)
          }
          : undefined
      }
      : undefined,
    errorText: asString(rec.errorText) || undefined,
    hydrationUnavailable: asBoolean(rec.hydrationUnavailable, false)
  };
}

/**
 * Normalize map of parent message IDs to subagent summaries
 */
export function normalizeSubagentSummaryMap(value: unknown): Record<string, SubagentSummary[]> {
  const rec = asRecord(value);
  if (!rec) {
    return {};
  }
  const out: Record<string, SubagentSummary[]> = {};
  for (const [key, item] of Object.entries(rec)) {
    if (!Array.isArray(item)) {
      continue;
    }
    const entries = item
      .map((raw) => normalizeSubagentSummary(raw))
      .filter((entry): entry is SubagentSummary => !!entry);
    if (entries.length > 0) {
      out[key] = entries;
    }
  }
  return out;
}

/**
 * Normalize map of subagent IDs to subagent details
 */
export function normalizeSubagentDetailMap(value: unknown): Record<string, SubagentDetail> {
  const rec = asRecord(value);
  if (!rec) {
    return {};
  }
  const out: Record<string, SubagentDetail> = {};
  for (const [key, item] of Object.entries(rec)) {
    const detail = normalizeSubagentDetail(item);
    if (detail) {
      out[key] = detail;
    }
  }
  return out;
}

// Import presentation formatting functions from eventBuilder
import { normalizeSubagentProgressEventsForPresentation, normalizeSubagentTimelineEventsForPresentation } from './eventBuilder';

// Type utility functions
function asNumber(value: unknown, defaultValue: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) return parsed;
  }
  return defaultValue;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) return parsed;
  }
  return undefined;
}

function asBoolean(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
  }
  return defaultValue;
}
