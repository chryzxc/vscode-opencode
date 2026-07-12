/**
 * Event normalizer module for subagent processing.
 *
 * This module handles normalization of different event formats from centralized SDK events,
 * providing a consistent interface for subagent extraction and processing.
 */

import type { NormalizedSubagentEvent } from './types';
import { asRecord, asString, asNumber } from '../messageHandler';

/**
 * Check if a tool name represents a subagent tool
 */
export function isSubagentToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return normalized === 'omo_agent' ||
         normalized === 'call_omo_agent' ||
         normalized === 'subagent' ||
         normalized === 'agent_call';
}

/**
 * Find the ultimate parent message ID for a tool event.
 *
 * CENTRALIZED MESSAGE PARENT-CHILD RELATIONSHIP LOGIC:
 *
 * The chat UI follows a parent-child message structure where:
 * - User messages (parent) trigger assistant responses
 * - Assistant messages (child) contain tool calls like `call_omo_agent`, bash, etc.
 * - Tools need to be associated with the USER message that triggered them, not the assistant message
 *
 * DATA STRUCTURE FLOW:
 * 1. User creates message: "msg_user_123"
 * 2. Assistant responds with message: "msg_assistant_456" containing `info.parentID: "msg_user_123"`
 * 3. Assistant adds tools to message "msg_assistant_456" with `part.messageID: "msg_assistant_456"`
 * 4. UI renders user message "msg_user_123" and wants to show tools as subagents of this user message
 *
 * TRAVERSAL LOGIC:
 * Tool Event → Assistant Message → User Message (parent)
 *
 * @param toolEvent - The tool event (call_omo_agent, bash, glob, etc.)
 * @param allEvents - All events from the session to search for parent relationships
 * @returns The user's message ID that ultimately triggered this tool, or null if not found
 *
 * INTEGRATION WITH EXISTING SYSTEM:
 * Uses the existing centralized event info extraction logic from messageHandler.ts:
 * - getCentralizedEventInfo() extracts info from various event formats
 * - info.parentID contains the link from assistant message back to user message
 *
 * @see getCentralizedEventInfo in messageHandler.ts for the centralized info extraction logic
 */
export function findUltimateParentMessageId(toolEvent: unknown, allEvents: unknown[]): string | null {
  const event = asRecord(toolEvent);
  if (!event) return null;

  // Step 1: Get the assistant's message ID from the tool event
  // Tools are attached to assistant messages via part.messageID
  const toolMessageId = extractEventMessageId(event, extractEventPart(event) || {});
  if (!toolMessageId) return null;

  // The part is already attached to the assistant message. Do not walk
  // `info.parentID`: that identifies the initiating user message and would
  // attach this subagent to the wrong transcript block.
  return toolMessageId;
}

/**
 * Extract event info using the same centralized logic as messageHandler.ts.
 *
 * This is a simplified version of getCentralizedEventInfo() from messageHandler.ts
 * that handles the multiple event format variations we see in the wild.
 *
 * EVENT FORMAT VARIATIONS HANDLED:
 * 1. Direct properties.info: { properties: { info: {...} } }
 * 2. Sync event format: { syncEvent: { data: { info: {...} } } }
 * 3. Payload format: { payload: { properties: { info: {...} } } }
 * 4. Direct info: { info: {...} }
 *
 * @param event - The event record to extract info from
 * @returns The info record or null if not found
 *
 * @see getCentralizedEventInfo in messageHandler.ts for the full implementation
 */
function extractCentralizedEventInfo(event: Record<string, unknown>): Record<string, unknown> | null {
  const properties = asRecord(event.properties);
  const syncEvent = asRecord(event.syncEvent);
  const payloadRecord = asRecord(event.payload);

  // Try properties.info first (most common format)
  const propertiesInfo = asRecord(properties?.info);
  if (propertiesInfo) return propertiesInfo;

  // Try syncEvent.data.info (sync format)
  const syncData = asRecord(syncEvent?.data);
  const syncInfo = asRecord(syncData?.info);
  if (syncInfo) return syncInfo;

  // Try payload.properties.info (payload format)
  const payloadPropertiesInfo = asRecord(asRecord(payloadRecord?.properties)?.info);
  if (payloadPropertiesInfo) return payloadPropertiesInfo;

  // Try payload.syncEvent.data.info (payload sync format)
  const payloadSyncEvent = asRecord(payloadRecord?.syncEvent);
  const payloadSyncData = asRecord(payloadSyncEvent?.data);
  const payloadSyncInfo = asRecord(payloadSyncData?.info);
  if (payloadSyncInfo) return payloadSyncInfo;

  // Fallback to direct info
  return asRecord(event.info);
}

/**
 * Extract part data from various event structures
 * Centralizes the logic for finding event data across different SDK event formats
 */
export function extractEventPart(event: Record<string, unknown>): Record<string, unknown> | null {
  const properties = asRecord(event.properties);
  const syncEvent = asRecord(event.syncEvent);
  const payloadRecord = asRecord(event.payload);
  const payloadSyncEvent = asRecord(payloadRecord?.syncEvent);
  const payloadSyncData = asRecord(payloadSyncEvent?.data);

  return asRecord(properties?.part) ?? asRecord(event.part) ?? asRecord(payloadSyncData?.part);
}

/**
 * Extract message ID from various event properties
 * Handles multiple possible locations for message ID data with comprehensive fallbacks
 */
export function extractEventMessageID(event: Record<string, unknown>, part: Record<string, unknown>): string {
  const properties = asRecord(event.properties);
  const syncData = asRecord(asRecord(event.syncEvent)?.data);
  const payloadRecord = asRecord(event.payload);
  const payloadSyncEvent = asRecord(payloadRecord?.syncEvent);
  const payloadSyncData = asRecord(payloadSyncEvent?.data);

  // Comprehensive fallback chain for messageID extraction
  return asString(
    properties?.info?.id || properties?.info?.messageID || properties?.info?.messageId
  ).trim() ||
  asString(part.messageID || part.messageId).trim() ||
  asString(
    syncData?.info?.id || syncData?.info?.messageID || syncData?.info?.messageId
  ).trim() ||
  asString(
    payloadSyncData?.info?.id || payloadSyncData?.info?.messageID || payloadSyncData?.info?.messageId
  ).trim() ||
  asString(
    properties?.part?.messageID || properties?.part?.messageId
  ).trim() ||
  asString(
    syncData?.part?.messageID || syncData?.part?.messageId
  ).trim() ||
  asString(
    payloadSyncData?.part?.messageID || payloadSyncData?.part?.messageId
  ).trim() ||
  asString(event.messageID || event.messageId).trim();
}

/**
 * Extract message ID from payload for event tracking
 */
export function extractEventMessageId(payload: Record<string, unknown>): string | null {
  const properties = asRecord(payload.properties);
  const infoRecord = asRecord(payload.info) ?? asRecord(properties?.info);
  const partRecord = asRecord(payload.part) ?? asRecord(properties?.part);
  const messageRecord = asRecord(payload.message) ?? asRecord(properties?.message);

  const candidates = [
    asString(payload.messageId),
    asString(payload.messageID),
    asString(payload.id),
    asString(infoRecord?.id),
    asString(infoRecord?.messageID),
    asString(infoRecord?.messageId),
    asString(partRecord?.messageID),
    asString(partRecord?.messageId),
    asString(messageRecord?.id),
    asString(messageRecord?.messageID),
    asString(messageRecord?.messageId),
  ];

  return candidates.find(id => id && id.trim().length > 0) || null;
}

/**
 * Normalize a raw event into a consistent structure for processing
 */
export function normalizeSubagentEvent(payload: unknown): NormalizedSubagentEvent | null {
  const event = asRecord(payload);
  if (!event) return null;

  const part = extractEventPart(event);
  if (!part) return null;

  const toolName = asString(part.tool)?.toLowerCase() || '';
  const callID = asString(part.callID || part.id) || '';
  const messageID = extractEventMessageID(event, part);

  const properties = asRecord(event.properties);
  const timestamp = asNumber(properties?.time || event.time || event.createdAt || Date.now());

  return {
    id: callID || messageID || `${Date.now()}-${Math.random()}`,
    type: asString(event.type) || 'unknown',
    tool: toolName,
    callID,
    messageID,
    partID: asString(part.partID || part.partId),
    sessionId: asString(event.sessionId || event.sessionID),
    timestamp,
    rawEvent: event,
  };
}

/**
 * Check if an event is a subagent-related event
 */
export function isSubagentEvent(event: Record<string, unknown>): boolean {
  const part = extractEventPart(event);
  if (!part) return false;

  const toolName = asString(part.tool);
  return toolName ? isSubagentToolName(toolName) : false;
}

/**
 * Extract event type from normalized event
 */
export function getEventType(event: NormalizedSubagentEvent): string {
  return event.type || 'unknown';
}

/**
 * Extract parent message ID from message info
 * This is the ID of the user's message that triggered the assistant's response
 */
export function extractParentMessageId(event: Record<string, unknown>): string | null {
  const properties = asRecord(event.properties);
  const syncData = asRecord(asRecord(event.syncEvent)?.data);
  const payloadRecord = asRecord(event.payload);
  const payloadSyncEvent = asRecord(payloadRecord?.syncEvent);
  const payloadSyncData = asRecord(payloadSyncEvent?.data);

  const candidates = [
    asString(properties?.info?.parentID || properties?.info?.parentId),
    asString(syncData?.info?.parentID || syncData?.info?.parentId),
    asString(payloadSyncData?.info?.parentID || payloadSyncData?.info?.parentId),
  ];

  return candidates.find(id => id && id.trim().length > 0) || null;
}

/**
 * Extract session ID from various event properties
 */
export function extractSessionId(event: Record<string, unknown>): string | null {
  const properties = asRecord(event.properties);
  const syncData = asRecord(asRecord(event.syncEvent)?.data);
  const payloadRecord = asRecord(event.payload);
  const payloadSyncEvent = asRecord(payloadRecord?.syncEvent);
  const payloadSyncData = asRecord(payloadSyncEvent?.data);

  const candidates = [
    asString(event.sessionId),
    asString(event.sessionID),
    asString(properties?.sessionId),
    asString(properties?.sessionID),
    asString(syncData?.sessionId),
    asString(syncData?.sessionID),
    asString(payloadSyncData?.sessionId),
    asString(payloadSyncData?.sessionID),
  ];

  return candidates.find(id => id && id.trim().length > 0) || null;
}
