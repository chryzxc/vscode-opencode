/**
 * Event builder module for subagent processing.
 *
 * This module handles building conversation, progress, and timeline events
 * from normalized subagent event data, as well as presentation formatting.
 */

import type { NormalizedSubagentEvent } from './types';
import type {
  SubagentConversationEvent,
  SubagentProgressEvent,
  SubagentTimelineEvent,
  SubagentDetail
} from './types';
import { asRecord, asString } from '../messageHandler';
import { isSubagentToolName } from './eventNormalizer';

/**
 * Normalize comparable text for deduplication
 */
function normalizeComparableText(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.toLowerCase();
}

/**
 * Normalize subagent progress events for presentation (deduplication and merging)
 */
export function normalizeSubagentProgressEventsForPresentation(
  events: SubagentProgressEvent[]
): SubagentProgressEvent[] {
  if (events.length <= 1) {
    return events;
  }

  const byCallId = new Map<string, SubagentProgressEvent>();
  const ordered: SubagentProgressEvent[] = [];

  for (const event of events) {
    if (!event.callID) {
      ordered.push(event);
      continue;
    }
    const current = byCallId.get(event.callID);
    if (!current) {
      byCallId.set(event.callID, event);
      ordered.push(event);
      continue;
    }
    // Merge events by callID - keep latest timestamp and worst status
    current.createdAt = Math.max(current.createdAt, event.createdAt);
    current.status =
      event.status === 'error'
        ? 'error'
        : event.status === 'done' || current.status === 'done'
          ? 'done'
          : 'pending';
    current.title = event.title || current.title;
    current.meta = event.meta || current.meta;
    current.filePath = event.filePath || current.filePath;
  }

  // Deduplicate events with same content
  const deduped: SubagentProgressEvent[] = [];
  const seen = new Set<string>();

  for (const event of ordered) {
    const key = [
      event.callID || '',
      normalizeComparableText(event.title),
      normalizeComparableText(event.meta || ''),
      normalizeComparableText(event.filePath || ''),
      event.status,
    ].join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(event);
  }

  return deduped;
}

/**
 * Normalize subagent timeline events for presentation (deduplication and merging)
 */
export function normalizeSubagentTimelineEventsForPresentation(
  events: SubagentTimelineEvent[]
): SubagentTimelineEvent[] {
  if (events.length <= 1) {
    return events.filter((event): event is SubagentTimelineEvent => Boolean(event));
  }

  const sorted = events
    .filter((event): event is SubagentTimelineEvent => Boolean(event))
    .sort((a, b) => a.createdAt - b.createdAt);
  const deduped: SubagentTimelineEvent[] = [];

  for (const event of sorted) {
    const previous = deduped[deduped.length - 1];
    if (
      previous &&
      previous.type === event.type &&
      normalizeComparableText(previous.label) ===
      normalizeComparableText(event.label)
    ) {
      // Merge consecutive events of same type - keep latest metadata
      deduped[deduped.length - 1] = {
        ...previous,
        createdAt: Math.max(previous.createdAt, event.createdAt),
        messageID: event.messageID || previous.messageID,
        partID: event.partID || previous.partID,
        callID: event.callID || previous.callID,
      };
      continue;
    }
    deduped.push(event);
  }

  return deduped;
}

/**
 * Build conversation events from normalized events
 */
export function buildConversationEvents(
  normalizedEvents: NormalizedSubagentEvent[],
  subagentId: string
): SubagentDetail['conversationEvents'] {
  const conversationEvents: SubagentDetail['conversationEvents'] = [];

  for (const normalized of normalizedEvents) {
    const isSubagentTool = normalized.tool ? isSubagentToolName(normalized.tool) : false;
    if (isSubagentTool) continue;

    const partType = asString(normalized.part?.type)?.toLowerCase();
    if (partType === 'text' || partType === 'message') {
      const text = asString(
        normalized.part?.text ||
        normalized.part?.content ||
        normalized.part?.message
      );
      if (text) {
        conversationEvents.push({
          id: `${subagentId}-conv-${conversationEvents.length}`,
          role: 'assistant',
          kind: 'message',
          text,
          createdAt: normalized.timestamp,
        });
      }
    }
  }

  return conversationEvents;
}

/**
 * Build progress events from normalized events
 */
export function buildProgressEvents(
  normalizedEvents: NormalizedSubagentEvent[],
  subagentId: string
): SubagentDetail['progressEvents'] {
  const progressEvents: SubagentDetail['progressEvents'] = [];

  for (const normalized of normalizedEvents) {
    const isSubagentTool = normalized.tool ? isSubagentToolName(normalized.tool) : false;
    if (isSubagentTool) continue;

    const partType = asString(normalized.part?.type)?.toLowerCase();
    if (partType === 'tool' || normalized.tool) {
      const input = asRecord(normalized.part?.input || normalized.part?.params);
      const toolCommand = asString(input?.command || input?.url || input?.query || '');
      const description = asString(normalized.part?.description || '');

      progressEvents.push({
        id: `${subagentId}-progress-${progressEvents.length}`,
        title: normalized.tool || asString(normalized.part?.name) || 'tool',
        status: 'done',
        meta: toolCommand || description,
        createdAt: normalized.timestamp,
        callID: normalized.callID,
      });
    }
  }

  return progressEvents;
}

/**
 * Build timeline events from normalized events
 */
export function buildTimelineEvents(
  normalizedEvents: NormalizedSubagentEvent[],
  subagentId: string
): SubagentDetail['timelineEvents'] {
  const timelineEvents: SubagentDetail['timelineEvents'] = [];

  for (const normalized of normalizedEvents) {
    const partType = asString(normalized.part?.type)?.toLowerCase();
    const label = normalized.tool || asString(normalized.part?.name) || 'event';
    const title = asString(normalized.part?.text || normalized.part?.description || '');

    timelineEvents.push({
      key: `${subagentId}-timeline-${timelineEvents.length}`,
      type: partType || 'unknown',
      label,
      createdAt: normalized.timestamp,
      title,
      callID: normalized.callID,
      messageID: normalized.messageID,
      partID: normalized.partID,
    });
  }

  return timelineEvents;
}

/**
 * Build thinking events from normalized events
 */
export function buildThinkingEvents(
  normalizedEvents: NormalizedSubagentEvent[],
  subagentId: string
): SubagentDetail['thinkingEvents'] {
  const thinkingEvents: SubagentDetail['thinkingEvents'] = [];

  for (const normalized of normalizedEvents) {
    const partType = asString(normalized.part?.type)?.toLowerCase();
    if (partType === 'thinking' || partType === 'reasoning') {
      const text = asString(normalized.part?.text || normalized.part?.content || '');
      if (text) {
        thinkingEvents.push({
          id: `${subagentId}-thinking-${thinkingEvents.length}`,
          text,
          createdAt: normalized.timestamp,
        });
      }
    }
  }

  return thinkingEvents;
}

/**
 * Apply presentation formatting to subagent detail events
 */
export function applyPresentationFormatting(
  detail: SubagentDetail
): SubagentDetail {
  return {
    ...detail,
    progressEvents: normalizeSubagentProgressEventsForPresentation(detail.progressEvents),
    timelineEvents: normalizeSubagentTimelineEventsForPresentation(detail.timelineEvents),
  };
}
