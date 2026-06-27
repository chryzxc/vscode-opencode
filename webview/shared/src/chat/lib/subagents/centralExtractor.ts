/**
 * Central extractor module for subagent processing.
 *
 * This module orchestrates the extraction pipeline, coordinating between all
 * other modules to extract subagent data from centralized events.
 */

import type {
  SubagentSummary,
  SubagentDetail,
  NormalizedSubagentEvent,
} from './types';
import { asRecord, asString } from '../messageHandler';

import { normalizeSubagentEvent, extractSessionId, isSubagentToolName, findUltimateParentMessageId } from './eventNormalizer';
import { extractSubagentMetadata, determineSubagentStatus, extractLatestActivity, extractTimingInfo, extractAgentId, extractProviderModel } from './metadataExtractor';
import { buildConversationEvents, buildProgressEvents, buildTimelineEvents, buildThinkingEvents, applyPresentationFormatting } from './eventBuilder';
import { normalizeSubagentSummary } from './dataNormalizer';

/**
 * Extract subagents from centralized event data (rawSdkEventPayloads).
 * This is the main orchestration function that coordinates the entire extraction pipeline.
 *
 * @param rawSdkEventPayloads - Centralized event data from session persistence
 * @param parentMessageId - Optional parent message ID to filter events
 * @returns Subagent data extracted from centralized events
 */
export function extractSubagentsFromCentralizedEvents(
  rawSdkEventPayloads?: unknown[],
  parentMessageId?: string
): {
  summariesByParentMessageId: Record<string, SubagentSummary[]>;
  detailsById: Record<string, SubagentDetail>;
} {
  // PROMINENT LOG - Always visible
  console.log('🚀 [SUBAGENT_EXTRACTION] Starting', {
    hasEvents: Boolean(rawSdkEventPayloads),
    eventCount: rawSdkEventPayloads?.length || 0,
    parentMessageId,
    mode: 'rehydration or streaming'
  });

  // Debug: Log sample events to understand the structure
  if (Array.isArray(rawSdkEventPayloads) && rawSdkEventPayloads.length > 0) {
    // Find any call_omo_agent events and log them specifically
    const subagentEvents = rawSdkEventPayloads.filter(e => {
      const evt = asRecord(e);
      const props = asRecord(evt?.properties);
      const part = asRecord(props?.part ?? evt?.part);
      const toolName = asString(part?.tool)?.toLowerCase();
      return toolName === 'call_omo_agent' || toolName === 'omo_agent';
    });

    if (subagentEvents.length > 0) {
      console.log('🎯 [SUBAGENT_EXTRACTION] FOUND SUBAGENT EVENTS!', {
        subagentCount: subagentEvents.length,
        subagentEvents: subagentEvents.map(e => {
          const evt = asRecord(e);
          const props = asRecord(evt?.properties);
          const part = asRecord(props?.part ?? evt?.part);
          const syncEvent = asRecord(evt?.syncEvent);
          const syncData = asRecord(syncEvent?.data);
          const syncPart = asRecord(syncData?.part);

          // Extract messageID with multiple fallbacks for different data shapes
          const messageID = asString(
            part?.messageID || part?.messageId ||                              // Direct part
            props?.part?.messageID || props?.part?.messageId ||                 // Properties.part
            syncPart?.messageID || syncPart?.messageId ||                        // SyncEvent.data.part
            props?.info?.id || props?.info?.messageID || props?.info?.messageId ||   // Properties.info (legacy)
            syncData?.info?.id || syncData?.info?.messageID                       // SyncEvent.data.info (legacy)
          );

          return {
            eventType: evt?.type,
            toolName: part?.tool || syncPart?.tool,
            callID: asString(part?.callID || part?.id || syncPart?.callID || syncPart?.id),
            messageID: messageID, // Use the correctly extracted messageID with fallbacks
            allEventKeys: evt ? Object.keys(evt) : [],
            allPropertiesKeys: props ? Object.keys(props) : [],
            allPartKeys: part ? Object.keys(part) : [],
            fullEventData: evt
          };
        })
      });
    } else {
      console.log('🔍 [SUBAGENT_EXTRACTION] No subagent events found - event types present:', {
        eventTypes: rawSdkEventPayloads.slice(0, 5).map(e => {
          const evt = asRecord(e);
          const props = asRecord(evt?.properties);
          const part = asRecord(props?.part ?? evt?.part);
          return {
            type: evt?.type,
            toolName: part?.tool || 'no-tool'
          };
        })
      });
    }
  }

  const summariesByParentMessageId: Record<string, SubagentSummary[]> = {};
  const detailsById: Record<string, SubagentDetail> = {};

  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    console.warn('⚠️ [EXTRACTION_EMPTY] No centralized events to process!');
    return { summariesByParentMessageId, detailsById };
  }

  // Debug: Log input data (development only)
  if (process.env.NODE_ENV === 'development') {
    console.log('🔍 [SUBAGENT_EXTRACTION] Processing events', {
      totalEvents: rawSdkEventPayloads.length,
      subagentCallCount: rawSdkEventPayloads.filter(e => {
        const evt = asRecord(e);
        const props = asRecord(evt?.properties);
        const part = asRecord(props?.part ?? evt?.part);
        const syncEvent = asRecord(evt?.syncEvent);
        const syncData = asRecord(syncEvent?.data);
        const syncPart = asRecord(syncData?.part);
        const toolName = part?.tool || syncPart?.tool;
        return toolName === 'call_omo_agent' || toolName === 'omo_agent';
      }).length
    });
  }

  // Step 1: Normalize events and identify subagent calls
  const subagentCallIds = new Set<string>();
  const subagentMessageIds = new Set<string>();
  const eventsByCallId = new Map<string, unknown[]>();
  const eventsByMessageId = new Map<string, unknown[]>();

  for (const payload of rawSdkEventPayloads) {
    const normalized = normalizeSubagentEvent(payload);
    if (!normalized) continue;

    // Track subagent tool calls
    const isSubagentTool = normalized.tool ? isSubagentToolName(normalized.tool) : false;
    if (isSubagentTool && normalized.callID) {
      subagentCallIds.add(normalized.callID);
      if (normalized.messageID) {
        subagentMessageIds.add(normalized.messageID);
      }
    }

    // Group events by callID for direct tool event tracking
    if (normalized.callID) {
      if (!eventsByCallId.has(normalized.callID)) {
        eventsByCallId.set(normalized.callID, []);
      }
      eventsByCallId.get(normalized.callID)!.push(payload);
    }

    // Group events by messageID for capturing all tools in a subagent workflow
    if (normalized.messageID) {
      if (!eventsByMessageId.has(normalized.messageID)) {
        eventsByMessageId.set(normalized.messageID, []);
      }
      eventsByMessageId.get(normalized.messageID)!.push(payload);
    }
  }

  // Step 2: Build subagent details for each identified call
  for (const callID of subagentCallIds) {
    // Get the events for this subagent call
    const subagentEvents = eventsByCallId.get(callID) || [];

    // Find the subagent tool event
    const subagentEvent = subagentEvents.find(e => {
      const normalized = normalizeSubagentEvent(e);
      const isSubagentTool = normalized?.tool ? isSubagentToolName(normalized.tool) : false;
      return isSubagentTool && normalized.callID === callID;
    });

    if (!subagentEvent) {
      console.warn('⚠️ [SUBAGENT_EXTRACTION] No subagent event found for callID:', callID);
      continue;
    }

    console.log('🔧 [SUBAGENT_DETAIL_BUILD] Starting detail build for callID:', {
      callID,
      subagentEventsCount: subagentEvents.length
    });

    // Use the unified logic to find the ultimate parent message ID
    // This handles: Tool Event → Assistant Message → User Message
    const parentMessageId = findUltimateParentMessageId(subagentEvent, rawSdkEventPayloads);

    console.log('🔧 [SUBAGENT_DETAIL_BUILD] Parent message ID resolution:', {
      callID,
      extractedParentMessageId: parentMessageId,
      requestedParentMessageId: parentMessageId
    });

    if (!parentMessageId) {
      console.warn('⚠️ [SUBAGENT_EXTRACTION] No parent message ID found for callID:', callID);
      continue;
    }

    // Filter by parent message if specified
    if (parentMessageId && parentMessageId !== parentMessageId) {
      console.log('🔍 [FILTERING_OUT]', {
        callID,
        extractedParentMessageId: parentMessageId,
        requestedParentMessageId: parentMessageId
      });
      continue;
    }

    // Get ALL events for this message to capture all related tools
    const allRelatedEvents = eventsByMessageId.get(parentMessageId) || [];

    console.log('🔧 [SUBAGENT_DETAIL_BUILD] Events for detail building:', {
      callID,
      parentMessageId,
      eventsCount: allRelatedEvents.length,
      eventsAvailable: eventsByMessageId.size
    });

    // Debug logging in development only
    if (process.env.NODE_ENV === 'development') {
      console.log('🔍 [SUBAGENT_BUILD]', {
        callID,
        parentMessageId,
        eventsCount: allRelatedEvents.length,
        toolCount: allRelatedEvents.filter(e => {
          const norm = normalizeSubagentEvent(e);
          return norm?.tool && norm.tool !== 'call_omo_agent';
        }).length
      });
    }

    // Build the subagent detail including all tools (bash, glob, etc.)
    const detail = extractSubagentDetailFromCentralizedEvents(allRelatedEvents, callID, parentMessageId);

    if (detail) {
      console.log('✅ [SUBAGENT_DETAIL_BUILD] Successfully built detail:', {
        callID,
        detailId: detail.id,
        agentId: detail.agentId,
        parentMessageId: detail.parentMessageId
      });

      detailsById[detail.id] = detail;

      // Add to summaries
      if (!summariesByParentMessageId[parentMessageId]) {
        summariesByParentMessageId[parentMessageId] = [];
      }
      summariesByParentMessageId[parentMessageId].push(
        normalizeSubagentSummary(detail) as SubagentSummary
      );
    } else {
      console.warn('⚠️ [SUBAGENT_EXTRACTION] Failed to build detail for callID:', callID, {
        callID,
        parentMessageId,
        eventsCount: allRelatedEvents.length
      });
    }
  }

  // Debug logging in development only
  if (process.env.NODE_ENV === 'development') {
    console.log('🔍 [EXTRACTION_RESULTS]', {
      totalSubagentsFound: Object.keys(detailsById).length,
      totalParentMessages: Object.keys(summariesByParentMessageId).length
    });
  }

  if (Object.keys(detailsById).length === 0) {
    console.warn('⚠️ [EXTRACTION] No subagents found in centralized events');
  }

  return { summariesByParentMessageId, detailsById };
}

/**
 * Extract SubagentDetail from centralized events for a specific callID.
 * This includes ALL tool events (bash, glob, etc.) that are part of the subagent workflow.
 */
function extractSubagentDetailFromCentralizedEvents(
  events: unknown[],
  callID: string,
  parentMessageId: string
): SubagentDetail | null {
  if (events.length === 0) return null;

  // Step 1: Find the parent omo_agent event and extract metadata
  const parentEvent = events.find(e => {
    const normalized = normalizeSubagentEvent(e);
    const isSubagentTool = normalized?.tool ? isSubagentToolName(normalized.tool) : false;
    return isSubagentTool && normalized.callID === callID;
  });

  if (!parentEvent) return null;

  const parentEventRecord = asRecord(parentEvent);
  const metadata = extractSubagentMetadata(parentEventRecord);
  if (!metadata) return null;

  // Step 2: Normalize all events for processing
  const normalizedEvents = events
    .map(e => normalizeSubagentEvent(e))
    .filter((e): e is NormalizedSubagentEvent => e !== null);

  // Step 3: Build the event collections
  const conversationEvents = buildConversationEvents(normalizedEvents, callID);
  const progressEvents = buildProgressEvents(normalizedEvents, callID);
  const timelineEvents = buildTimelineEvents(normalizedEvents, callID);
  const thinkingEvents = buildThinkingEvents(normalizedEvents, callID);

  // Step 4: Extract timing information
  const timingInfo = extractTimingInfo(parentEventRecord);

  // Step 5: Extract agent information
  const agentId = extractAgentId(parentEventRecord);
  const providerModel = extractProviderModel(parentEventRecord);

  // Step 6: Build the complete SubagentDetail
  const detail: SubagentDetail = {
    id: callID,
    backgroundTaskId: metadata.backgroundTaskId || callID,
    parentMessageId,
    parentSessionId: extractSessionId(parentEventRecord) || '',
    agentId: agentId || metadata.toolName,
    agentRole: metadata.agentRole,
    providerID: providerModel.providerID,
    modelID: providerModel.modelID,
    startedAt: timingInfo.startedAt,
    endedAt: timingInfo.endedAt,
    durationMs: timingInfo.durationMs,
    status: determineSubagentStatus(metadata.status, timingInfo),
    latestActivity: extractLatestActivity(parentEventRecord) || metadata.output || 'Subagent update',
    references: [],
    thinkingEvents,
    conversationEvents,
    rawConversationEvents: conversationEvents,
    progressEvents,
    timelineEvents,
  };

  // Step 7: Apply presentation formatting
  return applyPresentationFormatting(detail);
}

/**
 * Extract SubagentDetail from a group of events with the same callID.
 * Used for alternative extraction strategies when centralized events aren't available.
 */
function extractSubagentDetailFromEvents(
  events: unknown[],
  callID: string,
  parentMessageId: string
): SubagentDetail | null {
  if (events.length === 0) return null;

  // Find the most recent event with complete information
  const latestEvent = events[events.length - 1];
  const event = asRecord(latestEvent);
  if (!event) return null;

  const normalized = normalizeSubagentEvent(latestEvent);
  if (!normalized) return null;

  // Build basic detail from normalized event
  const conversationEvents = buildConversationEvents([normalized], callID);
  const progressEvents = buildProgressEvents([normalized], callID);
  const timelineEvents = buildTimelineEvents([normalized], callID);
  const thinkingEvents = buildThinkingEvents([normalized], callID);

  const timingInfo = extractTimingInfo(event);
  const agentId = extractAgentId(event);
  const providerModel = extractProviderModel(event);

  return {
    id: callID,
    backgroundTaskId: callID,
    parentMessageId,
    parentSessionId: extractSessionId(event) || '',
    agentId: agentId || normalized.tool,
    agentRole: undefined,
    providerID: providerModel.providerID,
    modelID: providerModel.modelID,
    startedAt: timingInfo.startedAt,
    endedAt: timingInfo.endedAt,
    durationMs: timingInfo.durationMs,
    status: determineSubagentStatus(undefined, timingInfo),
    latestActivity: extractLatestActivity(event) || 'Tool activity',
    references: [],
    thinkingEvents,
    conversationEvents,
    rawConversationEvents: conversationEvents,
    progressEvents,
    timelineEvents,
  };
}

/**
 * Extract subagents from messages (alternative extraction method).
 * Used when centralized events aren't available but message data is.
 */
export function extractSubagentsFromMessages(messages: unknown[]): {
  summariesByParentMessageId: Record<string, SubagentSummary[]>;
  detailsById: Record<string, SubagentDetail>;
} {
  const summariesByParentMessageId: Record<string, SubagentSummary[]> = {};
  const detailsById: Record<string, SubagentDetail> = {};

  // Implementation for message-based extraction
  // This would be used when centralized events aren't available

  return { summariesByParentMessageId, detailsById };
}