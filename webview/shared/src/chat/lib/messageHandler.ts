import type { Dispatch } from 'react';

import { config } from '../../config';
import type { AppAction } from './store';
import { appReducer, hasSystemMessagePatternInText } from './store';
import logger from './logger';
import type {
  ActivityDetail,
  ActivityDiffExcerpt,
  AppState,
  ContextItem,
  CompatibilityWarning,
  FileResult,
  InteractiveChoice,
  InteractiveEvent,
  LspServerInfo,
  McpServerInfo,
  McpServerStatus,
  MentionResult,
  Message,
  MessagePart,
  MessageStep,
  QueueItem,
  QuotaData,
  ReasoningEvent,
  Skill,
  SlashCommand,
  Session,
  StreamingState,
  StreamingStep,
  StructuredFileChange,
  SubagentDetail,
  SubagentSummary,
  SubagentReference,
  SubagentThinkingEvent,
  SubagentProgressEvent,
  SubagentConversationEvent,
  SubagentTimelineEvent,
  SubagentPresentationPolicy,
  TodoItem,
} from "./types";
import type {
  StructuredResponseType,
  StructuredWalkthrough,
  WalkthroughChangeKind,
  WalkthroughStepKind,
  WalkthroughVerificationStatus,
} from "./generated/structuredOutputSchema";
import {
  isWalkthroughNarrativeDistinct,
  sanitizeStructuredOutput,
  validateStructuredOutput,
} from "./structuredOutputValidator";
import { getCentralizedDebugPayloadDisposition } from "./generated/centralizedDebugPayloadFilter";
import vscode from "./vscode";
import {
  PENDING_CURRENT_SESSION_KEY,
} from "./pendingUserMessages";
import {
  liveSessionStatusFromPayload,
  toastNotificationFromPayload,
  type CentralizedToastNotification,
} from "./toastEvents";
import { routeLiveEvent } from "./liveEventRouter";
import {
  hasTerminalAssistantReplyForLatestSdkTurn,
  isProcessingInCurrentSession,
} from "./sessionProcessing";
import {
  appendLiveSdkDebugEvents,
  clearLiveSdkDebugEvents,
  setRehydratedSdkDebugMessages,
} from "./sdkDebugStore";

// NEW: Import modular subagent processing functions
import {
  extractSubagentsFromCentralizedEvents as modularExtractSubagentsFromCentralizedEvents
} from './subagents/centralExtractor';
import {
  mergeSubagentSummaries,
  hasSubagentSummaryEntries,
  mergeSubagentDetailPayload,
  mergeSubagentSummaryPayload
} from './subagents/stateManager';
import {
  sanitizeSubagentLabel,
  normalizeSubagentDetail,
  normalizeSubagentSummaryMap,
  normalizeSubagentDetailMap,
} from './subagents/dataNormalizer';
import {
  normalizeSubagentProgressEventsForPresentation,
  normalizeSubagentTimelineEventsForPresentation
} from './subagents/eventBuilder';
import {
  normalizeHydratedSubagentDetail as compatNormalizeHydratedSubagentDetail,
  hydrateSubagentSummary as compatHydrateSubagentSummary,
  areSubagentListsEquivalent as compatAreSubagentListsEquivalent,
  shouldFreezeSubagentForPresentation as compatShouldFreezeSubagentForPresentation
} from './subagents/compatUtils';
import {
  latestSubagentEventTimestamp,
  shouldFreezeSubagentForPresentation as uiShouldFreezeSubagentForPresentation,
} from './subagents/uiFormatter';
import { formatCallOmoAgentAsSubagentDetail } from './subagents/callOmoFormatter';

// Export modular function with original name for backward compatibility
export const extractSubagentsFromCentralizedEvents = modularExtractSubagentsFromCentralizedEvents;

// Export modular subagent functions for backward compatibility
export { normalizeSubagentDetail } from './subagents/dataNormalizer';

const STREAM_DEBUG_ENABLED = false;

// Debouncing state for rendering snapshots
let lastRenderLogTime = 0;
const RENDER_LOG_DEBOUNCE_MS = 500;

// Track seen validation warnings to avoid spam
const seenValidationWarnings = new Set<string>();

// Centralized webview logger is now imported from './logger'

/**
 * Centralized stream debug logging - routes all stream-related debug logs
 * through the centralized webview logger for consistent formatting and filtering.
 * 
 * Usage: streamDebug("descriptive-message", { contextData })
 */
function streamDebug(message: string, context?: Record<string, unknown>): void {
  if (STREAM_DEBUG_ENABLED) {
    logger.debug(message, context);
  }
}

/**
 * Live structured output turn logging
 * Logs structured output processing stages with consistent context.
 */
function logLiveStructuredTurn(stage: string, data: Record<string, unknown>): void {
  streamDebug(`Structured output processing: ${stage}`, {
    stage,
    ...data,
  });
}

function isHeartbeatEventType(eventType: string): boolean {
  return eventType === "server.heartbeat";
}

export function extractEventMessageId(event: unknown): string | null {
  const eventRecord = asRecord(event);
  if (!eventRecord) return null;

  // Sometimes the raw stream wraps the actual payload in a `payload` property.
  const payloadRecord = asRecord(eventRecord.payload);
  // Webview transport messages wrap the semantic SDK event in `event`. Resolve
  // that layer before falling back to wrapper metadata so terminal turn locks
  // remain keyed to the assistant message rather than the transport envelope.
  const semanticEventRecord =
    asRecord(eventRecord.event) ??
    asRecord(payloadRecord?.event);

  if (semanticEventRecord && semanticEventRecord !== eventRecord) {
    const semanticMessageId = extractEventMessageId(semanticEventRecord);
    if (semanticMessageId) {
      return semanticMessageId;
    }
  }

  const info =
    asRecord(asRecord(eventRecord.properties)?.info) ||
    asRecord(eventRecord.info) ||
    asRecord(asRecord(payloadRecord?.properties)?.info) ||
    asRecord(payloadRecord?.info);

  const part =
    asRecord(asRecord(eventRecord.properties)?.part) ||
    asRecord(eventRecord.part) ||
    asRecord(asRecord(payloadRecord?.properties)?.part) ||
    asRecord(payloadRecord?.part);

  const syncData =
    asRecord(asRecord(eventRecord.syncEvent)?.data) ||
    asRecord(asRecord(payloadRecord?.syncEvent)?.data);
  const syncInfo = asRecord(syncData?.info);
  const syncPart = asRecord(syncData?.part);

  const messageRecord =
    asRecord(eventRecord.message) ||
    asRecord(asRecord(eventRecord.properties)?.message) ||
    asRecord(payloadRecord?.message) ||
    asRecord(asRecord(payloadRecord?.properties)?.message);

  const candidate = firstNonEmptyString(
    asString(info?.id),
    asString(info?.messageID),
    asString(info?.messageId),
    asString(part?.messageID),
    asString(part?.messageId),
    asString(syncInfo?.id),
    asString(syncInfo?.messageID),
    asString(syncInfo?.messageId),
    asString(syncPart?.messageID),
    asString(syncPart?.messageId),
    asString(messageRecord?.id),
    asString(messageRecord?.messageID),
    asString(messageRecord?.messageId),
    asString(eventRecord.messageId),
    asString(eventRecord.messageID),
    asString(payloadRecord?.messageId),
    asString(payloadRecord?.messageID),
    // Finally fall back to the wrapper's own ID
    asString(payloadRecord?.id),
    asString(eventRecord.id)
  );

  // `evt_*` identifies a transport frame and `ses_*` identifies a session,
  // not an assistant response. Neither can become StreamingState.messageId:
  // doing so latches the visible turn to a non-message envelope before the
  // real part.messageID arrives.
  const normalizedCandidate = candidate?.toLowerCase() ?? "";
  return candidate &&
    !normalizedCandidate.startsWith("evt_") &&
    !normalizedCandidate.startsWith("ses_")
    ? candidate
    : null;
}

/**
 * Returns every message identity carried by a stream envelope.  Background
 * agents can wrap their terminal event in several `payload`/`data` layers;
 * their child message id is not the turn that owns the chat loading state, but
 * their `parentMessageId` is.  Keep this structural rather than text-based.
 */
function terminalEventMessageIds(event: unknown): Set<string> {
  const messageIds = new Set<string>();
  const visited = new Set<object>();
  const identityKeys = new Set([
    "messageid",
    "message_id",
    "parentmessageid",
    "parent_message_id",
    "parentid",
    "parent_id",
  ]);

  const visit = (value: unknown, allowId = false): void => {
    if (!value || typeof value !== "object") {
      return;
    }
    if (visited.has(value)) {
      return;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach((item) => visit(item));
      return;
    }

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const normalizedKey = key.replace(/[-_]/g, "").toLowerCase();
      if (
        (identityKeys.has(normalizedKey) || (allowId && normalizedKey === "id")) &&
        typeof child === "string" &&
        child.trim()
      ) {
        messageIds.add(child.trim());
      }
      // `id` is a message id only within a semantic message/info object.
      visit(child, normalizedKey === "info" || normalizedKey === "message");
    }
  };

  visit(event);
  return messageIds;
}

export function terminalEventMatchesAssistantTurn(
  event: unknown,
  activeMessageIds: Array<string | null | undefined>,
): boolean {
  const activeIds = new Set(
    activeMessageIds.filter(
      (messageId): messageId is string =>
        typeof messageId === "string" && messageId.trim().length > 0,
    ),
  );
  if (activeIds.size === 0) {
    return false;
  }

  const eventIds = terminalEventMessageIds(event);
  return [...activeIds].some((messageId) => eventIds.has(messageId));
}

function summarizeStreamEventForLog(payload: UnknownRecord): Record<string, unknown> {
  const properties = asRecord(payload.properties);
  const partRecord = asRecord(payload.part) ?? asRecord(properties?.part);
  const infoRecord = asRecord(payload.info) ?? asRecord(properties?.info);
  const eventType =
    asString(payload.type) || asString(payload.event) || asString(payload.kind) || "unknown";
  const textLike =
    asRichString(payload.text) ||
    asRichString(payload.content) ||
    asRichString(payload.delta) ||
    asRichString(properties?.text) ||
    asRichString(properties?.content) ||
    asRichString(properties?.delta) ||
    asRichString(partRecord?.text) ||
    asRichString(partRecord?.content) ||
    asRichString(partRecord?.delta);

  return {
    eventType,
    role:
      asString(payload.role) ||
      asString(infoRecord?.role) ||
      asString(properties?.role) ||
      asString(partRecord?.role) ||
      null,
    messageId:
      asString(payload.messageId) ||
      asString((payload as UnknownRecord).messageID) ||
      asString(payload.id) ||
      asString(properties?.messageId) ||
      asString(properties?.messageID) ||
      asString(infoRecord?.id) ||
      null,
    finish:
      typeof infoRecord?.finish === "boolean"
        ? infoRecord.finish
        : typeof payload.finish === "boolean"
          ? payload.finish
          : null,
    structuredKind:
      normalizePartType(partRecord?.type) === "reasoning" ? "thinking" : null,
    structuredTextPreview: previewForLog(
      asRichString(partRecord?.reasoning) ||
        asRichString(partRecord?.thought) ||
        asRichString(partRecord?.thinking) ||
        asRichString(partRecord?.text) ||
        asRichString(partRecord?.message),
    ),
    partType: normalizePartType(partRecord?.type),
    textPreview: previewForLog(textLike),
    hasStructuredOutput:
      typeof payload.structuredOutput !== "undefined" ||
      typeof (payload as UnknownRecord).structured_output !== "undefined" ||
      typeof infoRecord?.structuredOutput !== "undefined" ||
      typeof (infoRecord as UnknownRecord | null)?.structured_output !== "undefined",
    payloadKeys: objectKeys(payload),
    propertyKeys: objectKeys(properties),
  };
}

function previewForLog(value: unknown, max = 160): string {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > max
    ? `${normalized.slice(0, Math.max(0, max - 3))}...`
    : normalized;
}

function summarizeStreamingForLog(streaming: StreamingState | null | undefined) {
  if (!streaming) {
    return null;
  }
  return {
    messageId: streaming.messageId,
    isActive: streaming.isActive,
    responseType: streaming.responseType,
    contentLength: asString(streaming.content).length,
    contentPreview: previewForLog(streaming.content),
    hasRenderableContent: streaming.hasRenderableContent === true,
    reasoningLength: asString(streaming.reasoning).length,
    reasoningEvents: Array.isArray(streaming.reasoningEvents)
      ? streaming.reasoningEvents.length
      : 0,
    steps: Array.isArray(streaming.steps) ? streaming.steps.length : 0,
    progressEvents: Array.isArray(streaming.progressEvents)
      ? streaming.progressEvents.length
      : 0,
    edits: Array.isArray(streaming.edits) ? [...streaming.edits] : [],
    hasPlan: !!streaming.plan,
    hasStructuredOutput: !!streaming.structuredOutput,
    interactiveEvents: Array.isArray(streaming.interactiveEvents)
      ? streaming.interactiveEvents.length
      : 0,
  };
}

function summarizeMessageForLog(message: Message | undefined | null) {
  if (!message) {
    return null;
  }
  return {
    id: asString(message.id) || asString(asRecord(message.info)?.id) || null,
    role: asString(message.role) || asString(asRecord(message.info)?.role) || null,
    responseType:
      firstNonEmptyString(
        asString(message.responseType),
        asString(asRecord((message as UnknownRecord).structuredOutput)?.responseType),
      ) || null,
    contentLength: asString(message.content).length,
    contentPreview: previewForLog(message.content),
    textLength: asString(message.text).length,
    textPreview: previewForLog(message.text),
    parts: Array.isArray(message.parts) ? message.parts.length : 0,
    edits: Array.isArray(message.edits)
      ? message.edits.map((edit) => asString(asRecord(edit)?.file)).filter(Boolean)
      : [],
    hasPlan: !!message.plan,
    hasStructuredOutput: !!asRecord((message as UnknownRecord).structuredOutput),
    interactiveEvents: Array.isArray(message.interactiveEvents)
      ? message.interactiveEvents.length
      : 0,
    reasoningEvents: Array.isArray(message.reasoningEvents)
      ? message.reasoningEvents.length
      : 0,
    steps: Array.isArray(message.steps) ? message.steps.length : 0,
    progressEvents: Array.isArray(message.progressEvents)
      ? message.progressEvents.length
      : 0,
  };
}

function summarizeStepListForLog(
  steps: Array<
    | MessageStep
    | StreamingStep
    | (Record<string, unknown> & {
        title?: unknown;
        status?: unknown;
        source?: unknown;
        partType?: unknown;
        id?: unknown;
        callID?: unknown;
      })
  >,
) {
  return steps.map((step, index) => {
    const rec = asRecord(step) ?? {};
    return {
      index,
      key:
        asString(rec.callID) ||
        asString(rec.id) ||
        `${asString(rec.title).trim().toLowerCase()}#${index}`,
      title: previewForLog(asString(rec.title), 96),
      status: asString(rec.status) || null,
      source: asString(rec.source) || null,
      partType: asString(rec.partType) || null,
      filePath:
        asString((rec as UnknownRecord).filePath) ||
        asString((rec as UnknownRecord).content) ||
        null,
      hasActivityDetail: !!asRecord((rec as UnknownRecord).activityDetail),
      hasDiffStats: !!asRecord((rec as UnknownRecord).diffStats),
    };
  });
}

function isEditLikeStep(step: MessageStep | StreamingStep): boolean {
  const partType = asString(step.partType).toLowerCase();
  const type = asString(step.type).toLowerCase();
  const tool = asString(step.activityDetail?.tool).toLowerCase();
  const kind = asString(step.activityDetail?.kind).toLowerCase();

  if (partType === "patch" || type === "patch") return true;
  if (kind === "file_edit") return true;
  if (step.diffStats && (step.diffStats.added > 0 || step.diffStats.deleted > 0)) return true;
  if (tool && (tool.includes("write") || tool.includes("replace") || tool.includes("edit") || tool.includes("patch"))) return true;

  return false;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

type UnknownRecord = Record<string, unknown>;

export function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

function objectKeys(value: unknown): string[] {
  const record = asRecord(value);
  return record ? Object.keys(record) : [];
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Resolve the SDK-owned session before considering the host envelope.  Stream
 * messages can be delivered while the user has another session selected; in
 * that case falling back to `currentSessionId` puts a valid activity timeline
 * in the wrong per-session cache and leaves the real turn empty until history
 * hydration catches up.
 */
export function extractCentralizedEventSessionId(payload: unknown): string | undefined {
  const event = asRecord(payload);
  if (!event) return undefined;

  const payloadRecord = asRecord(event.payload);
  const syncEvent = asRecord(event.syncEvent);
  const syncData = asRecord(syncEvent?.data);
  const payloadSyncEvent = asRecord(payloadRecord?.syncEvent);
  const payloadSyncData = asRecord(payloadSyncEvent?.data);
  const properties = asRecord(event.properties);
  const part = getCentralizedEventPart(event);
  const info = getCentralizedEventInfo(event);

  return firstNonEmptyString(
    asString(event.sessionID),
    asString(event.sessionId),
    asString(properties?.sessionID),
    asString(properties?.sessionId),
    asString(part?.sessionID),
    asString(part?.sessionId),
    asString(info?.sessionID),
    asString(info?.sessionId),
    asString(syncEvent?.aggregateID),
    asString(syncEvent?.sessionID),
    asString(syncEvent?.sessionId),
    asString(syncData?.sessionID),
    asString(syncData?.sessionId),
    asString(payloadRecord?.sessionID),
    asString(payloadRecord?.sessionId),
    asString(payloadSyncData?.sessionID),
    asString(payloadSyncData?.sessionId),
  );
}

/** One presentation contract for completed SDK question tools, shared by live and hydrated UI. */
export function completedQuestionToolPresentation(
  tool: unknown,
  status: unknown,
  output?: unknown,
): { isCompleted: boolean; title?: string; summary?: string } {
  const normalizedTool = asString(tool).trim().toLowerCase();
  const normalizedStatus = asString(status).trim().toLowerCase();
  const summary = asString(output).trim();
  const isCompleted =
    normalizedTool === "question" &&
    ["completed", "complete", "done", "success", "finished"].includes(normalizedStatus);
  return isCompleted
    ? { isCompleted: true, title: "Captured user response", summary: summary || undefined }
    : { isCompleted: false };
}

export function getCentralizedEventPart(payload: unknown): UnknownRecord | null {
  const event = asRecord(payload);
  if (!event) {
    return null;
  }

  const payloadRecord = asRecord(event.payload);
  const payloadPropertiesPart = asRecord(asRecord(payloadRecord?.properties)?.part);
  if (payloadPropertiesPart) {
    return payloadPropertiesPart;
  }

  const payloadSyncEvent = asRecord(payloadRecord?.syncEvent);
  const payloadSyncPart = asRecord(asRecord(payloadSyncEvent?.data)?.part) ?? asRecord(payloadSyncEvent?.part);
  if (payloadSyncPart) {
    return payloadSyncPart;
  }

  const syncEvent = asRecord(event.syncEvent);
  const syncPart = asRecord(asRecord(syncEvent?.data)?.part) ?? asRecord(syncEvent?.part);
  if (syncPart) {
    return syncPart;
  }

  const dataPart = asRecord(asRecord(event.data)?.part);
  if (dataPart) {
    return dataPart;
  }

  const payloadDataPart = asRecord(asRecord(payloadRecord?.data)?.part) ?? asRecord(payloadRecord?.part);
  if (payloadDataPart) {
    return payloadDataPart;
  }

  const propertiesPart = asRecord(asRecord(event.properties)?.part) ?? asRecord(event.part);
  if (propertiesPart) {
    return propertiesPart;
  }

  // Session hydration can supply an SDK message part directly instead of the
  // usual event envelope. In particular, a completed `question` tool part is
  // emitted after the user replies and carries the reply text in
  // `state.output`. Treat that record as the part itself so its message
  // ownership, terminal status, and output survive centralized rendering.
  const directType = asString(event.type).trim().toLowerCase();
  if (
    directType === "tool" &&
    !!asRecord(event.state) &&
    !!firstNonEmptyString(
      asString(event.messageID),
      asString(event.messageId),
      asString(event.callID),
      asString(event.callId),
    )
  ) {
    return event;
  }

  return null;
}

export function getCentralizedEventInfo(payload: unknown): UnknownRecord | null {
  const event = asRecord(payload);
  if (!event) {
    return null;
  }

  const payloadRecord = asRecord(event.payload);
  const payloadPropertiesInfo = asRecord(asRecord(payloadRecord?.properties)?.info);
  if (payloadPropertiesInfo) {
    return payloadPropertiesInfo;
  }

  const payloadSyncEvent = asRecord(payloadRecord?.syncEvent);
  const payloadSyncData = asRecord(payloadSyncEvent?.data);
  const payloadSyncInfo = asRecord(payloadSyncData?.info);
  if (payloadSyncInfo) {
    return payloadSyncInfo;
  }

  const syncEvent = asRecord(event.syncEvent);
  const syncData = asRecord(syncEvent?.data);
  const syncInfo = asRecord(syncData?.info);
  if (syncInfo) {
    return syncInfo;
  }

  const propertiesInfo = asRecord(asRecord(event.properties)?.info);
  if (propertiesInfo) {
    return propertiesInfo;
  }

  const info = asRecord(event.info);
  if (info) {
    return info;
  }

  const isInfoLike = (obj: Record<string, unknown> | null) => 
    obj && (obj.role || obj.id || obj.messageID || obj.messageId);

  if (isInfoLike(payloadSyncData)) return payloadSyncData;
  if (isInfoLike(syncData)) return syncData;
  if (isInfoLike(payloadRecord)) return payloadRecord;
  if (isInfoLike(event)) return event;

  return null;
}

// NOTE: Stream events (like SSE) often use `.event` or `.kind` instead of `.type`.
// This fallback chain is critical for ensuring that live stream events are correctly
// classified. Without this, stream events will resolve to an empty type and be
// incorrectly rejected by the centralized data persister.
export function getCentralizedEventType(payload: unknown): string {
  const event = asRecord(payload);
  if (!event) {
    return "";
  }

  const directType = asString(event.type ?? event.event ?? event.kind).trim();
  const payloadRecord = asRecord(event.payload);
  const payloadType = asString(payloadRecord?.type ?? payloadRecord?.event ?? payloadRecord?.kind).trim();
  const payloadSyncType = asString(asRecord(payloadRecord?.syncEvent)?.type).trim();
  const syncType = asString(asRecord(event.syncEvent)?.type).trim();

  // Sync-hydrated events commonly arrive as top-level `type: "sync"` with
  // the real OpenCode event name nested under `syncEvent.type`. Render logic
  // should make decisions from the OpenCode event name, not from the transport
  // envelope, otherwise hydrated activity parts have no assistant message shell.
  const rawType =
    directType && directType !== "sync"
      ? directType
      : payloadSyncType || syncType || directType || payloadType;

  return rawType.replace(/\.\d+$/, "");
}

export function normalizeCentralizedEventPayload(payload: unknown): UnknownRecord | null {
  const event = asRecord(payload);
  if (!event) {
    return null;
  }

  // Centralized debug events arrive in two valid shapes:
  // - `properties.part` for direct message.part.updated entries
  // - `payload.syncEvent.data.part` / `syncEvent.data.part` for sync-wrapped entries
  // Normalize both into a single envelope so renderers only consume one shape.
  const part = getCentralizedEventPart(event);
  if (!part) {
    return event;
  }

  const properties = asRecord(event.properties) ?? {};
  const payloadRecord = asRecord(event.payload) ?? {};
  const payloadSyncEvent = asRecord(payloadRecord.syncEvent) ?? {};
  const payloadSyncData = asRecord(payloadSyncEvent.data) ?? {};
  const syncEvent = asRecord(event.syncEvent) ?? {};
  const syncData = asRecord(syncEvent.data) ?? {};

  return {
    ...event,
    part,
    properties: {
      ...properties,
      part,
    },
    payload: Object.keys(payloadRecord).length > 0
      ? {
          ...payloadRecord,
          syncEvent: {
            ...payloadSyncEvent,
            data: {
              ...payloadSyncData,
              part,
            },
          },
        }
      : payloadRecord,
    syncEvent: Object.keys(syncEvent).length > 0
      ? {
          ...syncEvent,
          data: {
            ...syncData,
            part,
          },
        }
      : syncEvent,
  };
}

export function normalizedCentralizedEventIdentity(event: UnknownRecord): string {
  // `/event`, `/global/event`, and sync can replay the same SDK event. The SDK
  // event ID is the canonical transport-independent identity; use it before
  // part/call fallbacks so one mirrored event reaches the timeline once.
  const payload = asRecord(event.payload);
  const syncEvent = asRecord(event.syncEvent);
  const eventId = firstNonEmptyString(
    asString(event.id),
    asString(event.eventID),
    asString(event.eventId),
    asString(payload?.id),
    asString(payload?.eventID),
    asString(payload?.eventId),
    asString(syncEvent?.id),
    asString(syncEvent?.eventID),
    asString(syncEvent?.eventId),
  );
  if (eventId) {
    return `event:${eventId}`;
  }

  const eventType = getCentralizedEventType(event);
  if (!eventType) {
    return "";
  }

  const part = getCentralizedEventPart(event);
  if (part) {
    return [
      eventType,
      firstNonEmptyString(
        asString(part.id),
        asString(part.partID),
        asString(part.partId),
        asString(part.callID),
        asString(part.callId),
      ) ?? "",
      firstNonEmptyString(
        asString(part.messageID),
        asString(part.messageId),
      ) ?? "",
      asString(part.type).trim().toLowerCase(),
      asString(part.tool).trim().toLowerCase(),
    ].join("|");
  }

  const info = getCentralizedEventInfo(event);
  if (info) {
    return [
      eventType,
      firstNonEmptyString(
        asString(info.id),
        asString(info.messageID),
        asString(info.messageId),
      ) ?? "",
      firstNonEmptyString(
        asString(info.parentID),
        asString(info.parentId),
      ) ?? "",
      asString(info.role).trim().toLowerCase(),
    ].join("|");
  }

  return [
    eventType,
    firstNonEmptyString(
      asString(event.id),
      asString(asRecord(event.syncEvent)?.id),
    ) ?? "",
  ].join("|");
}

function normalizedCentralizedEventRichness(event: UnknownRecord): number {
  const part = getCentralizedEventPart(event);
  const info = getCentralizedEventInfo(event);
  const state = asRecord(part?.state);
  let score = 0;

  if (part) {
    score += 5;
    if (typeof part.text === "string" && part.text.trim()) score += 4;
    if (typeof part.content === "string" && part.content.trim()) score += 4;
    if (typeof part.message === "string" && part.message.trim()) score += 4;
    if (typeof part.tool === "string" && part.tool.trim()) score += 2;
    if (typeof part.callID === "string" && part.callID.trim()) score += 2;
    if (typeof part.messageID === "string" && part.messageID.trim()) score += 2;
  }
  if (state) {
    score += 3;
    if (typeof state.status === "string" && state.status.trim()) score += 2;
    if (typeof state.output !== "undefined") score += 4;
    if (typeof state.input !== "undefined") score += 2;
    if (typeof state.metadata !== "undefined") score += 2;
    if (typeof state.time !== "undefined") score += 1;
    if (typeof state.title === "string" && state.title.trim()) score += 1;
  }
  if (info) {
    score += 3;
    if (typeof info.id === "string" && info.id.trim()) score += 2;
    if (typeof info.role === "string" && info.role.trim()) score += 1;
    if (typeof info.time !== "undefined") score += 1;
    // Events carrying file-change diffs (info.summary.diffs) are richer
    // and must survive deduplication over duplicates without diff data.
    const summary = asRecord(info.summary);
    if (Array.isArray(summary?.diffs) && summary.diffs.length > 0) score += 5;
  }

  return score;
}

export function normalizeCentralizedEventPayloads(
  rawSdkEventPayloads?: unknown[],
): UnknownRecord[] {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return [];
  }

  const normalized: UnknownRecord[] = [];
  const indexByIdentity = new Map<string, number>();
  for (const payload of rawSdkEventPayloads) {
    const event = normalizeCentralizedEventPayload(payload);
    if (event) {
      const identity = normalizedCentralizedEventIdentity(event);
      if (!identity) {
        normalized.push(event);
        continue;
      }

      const existingIndex = indexByIdentity.get(identity);
      if (typeof existingIndex !== "number") {
        indexByIdentity.set(identity, normalized.length);
        normalized.push(event);
        continue;
      }

      const existing = normalized[existingIndex];
      if (
        normalizedCentralizedEventRichness(event) >=
        normalizedCentralizedEventRichness(existing)
      ) {
        normalized[existingIndex] = event;
      }
    }
  }
  return normalized;
}

/**
 * The canonical permission extractor for both live SSE envelopes and restored
 * centralized SDK event payloads. OpenCode puts the request in `properties`,
 * while `permission.list` returns that same request object without an event
 * wrapper, so intentionally support both shapes here.
 */
export function permissionRequestFromSdkPayload(
  payload: unknown,
  fallbackSessionID?: string | null,
): {
  id: string;
  sessionID: string;
  permission?: string;
  patterns: unknown[];
  always: unknown[];
} | undefined {
  const event = normalizeCentralizedEventPayload(payload) ?? asRecord(payload);
  if (!event) return undefined;
  const eventType = getCentralizedEventType(event);
  const properties = asRecord(event.properties) ?? event;
  const isPermissionRequest =
    eventType === "permission.asked" ||
    eventType === "permission.request" ||
    (!eventType && typeof properties.permission === "string");
  if (!isPermissionRequest) return undefined;
  const id = asString(properties.id) || asString(properties.permissionID);
  const sessionID =
    asString(properties.sessionID) || asString(properties.sessionId) || fallbackSessionID || "";
  if (!id || !sessionID) return undefined;
  return {
    id,
    sessionID,
    permission: asOptionalString(properties.permission),
    patterns: Array.isArray(properties.patterns) ? properties.patterns : [],
    always: Array.isArray(properties.always) ? properties.always : [],
  };
}

function isTextDeltaCentralizedEventPayload(payload: unknown): boolean {
  const event = asRecord(payload);
  if (!event) {
    return false;
  }

  const properties = asRecord(event.properties);
  const syncEvent = asRecord(event.syncEvent);
  const syncData = asRecord(syncEvent?.data);
  const part =
    asRecord(properties?.part) ??
    asRecord(event.part) ??
    asRecord(syncData?.part);
  const eventType = firstNonEmptyString(
    asString(event.type),
    asString(event.event),
    asString(syncEvent?.type),
  ).toLowerCase();

  return Boolean(
    asString(properties?.delta).trim() ||
      asString(event.delta).trim() ||
      asString(syncData?.delta).trim() ||
      asString(part?.delta).trim() ||
      eventType.includes("message.part.delta"),
  );
}

export function getCentralizedAssistantContentChunksFromRawSdkEventPayloads(
  rawSdkEventPayloads?: unknown[],
): string[] {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return [];
  }

  const assistantMessageId =
    latestAssistantMessageIdFromCentralizedTape(rawSdkEventPayloads);
  if (!assistantMessageId) {
    return [];
  }

  // Providers can reuse a reasoning part's ID for its token delta, but label
  // that transient delta as `text`. Treat the ID's established ownership as
  // authoritative: otherwise a partial thought (for example, "The") is
  // rendered as an assistant response during hydration.
  const reasoningPartIDs = new Set<string>();
  for (const payload of rawSdkEventPayloads) {
    const part = getCentralizedEventPart(payload);
    if (!part || asString(part.type).trim().toLowerCase() !== "reasoning") {
      continue;
    }
    const partMessageId = firstNonEmptyString(part.messageID, part.messageId) || "";
    const partID = firstNonEmptyString(part.id, part.partID, part.partId) || "";
    if (partMessageId === assistantMessageId && partID) {
      reasoningPartIDs.add(partID);
    }
  }

  for (let index = rawSdkEventPayloads.length - 1; index >= 0; index -= 1) {
    const payload = rawSdkEventPayloads[index];
    const event = asRecord(payload);
    const eventType = getCentralizedEventType(payload);
    const info = getCentralizedEventInfo(payload);
    if (eventType !== "message.updated" || !info) {
      continue;
    }

    const candidateMessageId =
      firstNonEmptyString(info.id, info.messageID, info.messageId) || "";
    const role = asString(info.role).trim().toLowerCase();
    if (candidateMessageId !== assistantMessageId || role !== "assistant") {
      continue;
    }

    const messageChunk = firstNonEmptyString(
      info.text,
      info.content,
      info.message,
      event?.text,
      event?.content,
      event?.message,
    );
    if (messageChunk) {
      return [messageChunk];
    }

    const structuredChunk = firstNonEmptyString(
      asRecord(info?.structured)?.text,
      asRecord(info?.structured)?.message,
      asRecord(info?.structured)?.content,
      asRecord(info?.structuredOutput)?.text,
      asRecord(info?.structuredOutput)?.message,
      asRecord(info?.structuredOutput)?.content,
      asRecord((info as UnknownRecord | null)?.structured_output)?.text,
      asRecord((info as UnknownRecord | null)?.structured_output)?.message,
      asRecord((info as UnknownRecord | null)?.structured_output)?.content,
    );
    if (structuredChunk) {
      return [structuredChunk];
    }
  }

  const structuredChunks: string[] = [];
  const textChunks: string[] = [];
  const seenStructured = new Set<string>();
  const seenText = new Set<string>();
  for (let index = 0; index < rawSdkEventPayloads.length; index += 1) {
    const payload = rawSdkEventPayloads[index];
    // Text deltas are a transport signal, not a durable assistant response.
    // They may carry reasoning even when the provider labels the part `text`.
    // Live streaming owns them; response-body rendering must wait for the
    // non-delta part snapshot for the same message.
    if (isTextDeltaCentralizedEventPayload(payload)) {
      continue;
    }
    const part = getCentralizedEventPart(payload);
    if (!part) {
      continue;
    }

    const partType = asString(part.type).toLowerCase();
    if (partType === "tool") {
      const toolName = asString(part.tool).toLowerCase();
      if (toolName === "structuredoutput" || toolName === "structured_output") {
        const partMessageId =
          firstNonEmptyString(part.messageID, part.messageId) || "";
        if (partMessageId !== assistantMessageId) {
          continue;
        }
        const stateRec = asRecord(part.state);
        const inputRec = asRecord(stateRec?.input) ?? asRecord(part.input);
        const structuredType = firstNonEmptyString(
          inputRec?.type,
          inputRec?.responseType,
          stateRec?.type,
          stateRec?.responseType,
        )?.toLowerCase();
        if (structuredType === "implementation_plan") {
          continue;
        }
        const toolChunk = firstNonEmptyString(
          inputRec?.text,
          inputRec?.message,
          inputRec?.content,
          stateRec?.message,
          stateRec?.content,
          stateRec?.text,
        );
        if (toolChunk) {
          const normalizedToolChunk = toolChunk.replace(/\s+/g, " ").trim().toLowerCase();
          if (!seenStructured.has(normalizedToolChunk)) {
            seenStructured.add(normalizedToolChunk);
            structuredChunks.push(toolChunk);
          }
        }
      }
      continue;
    }
    if (partType !== "text" && partType !== "message" && partType !== "output_text") {
      continue;
    }

    const partMessageId =
      firstNonEmptyString(
        part.messageID,
        part.messageId,
      ) || "";
    if (partMessageId !== assistantMessageId) {
      continue;
    }
    const partID = firstNonEmptyString(part.id, part.partID, part.partId) || "";
    if (partID && reasoningPartIDs.has(partID)) {
      continue;
    }

    const chunk =
      asString(part.text).trim() ||
      asString(part.content).trim() ||
      asString(part.message).trim();
    if (chunk) {
      const normalizedChunk = chunk.replace(/\s+/g, " ").trim().toLowerCase();
      if (seenText.has(normalizedChunk)) {
        continue;
      }
      seenText.add(normalizedChunk);
      textChunks.push(chunk);
    }
  }

  const canonicalStructuredChunk = structuredChunks[structuredChunks.length - 1];
  if (
    canonicalStructuredChunk &&
    shouldPreferStructuredToolResponseOverTextChunks(
      canonicalStructuredChunk,
      textChunks,
    )
  ) {
    return [canonicalStructuredChunk];
  }

  if (textChunks.length > 0) {
    return textChunks;
  }

  return canonicalStructuredChunk ? [canonicalStructuredChunk] : [];
}

function shouldPreferStructuredToolResponseOverTextChunks(
  structuredChunk: string,
  textChunks: string[],
): boolean {
  const structuredNorm = normalizeComparableText(structuredChunk);
  if (!structuredNorm) {
    return false;
  }
  if (!Array.isArray(textChunks) || textChunks.length === 0) {
    return true;
  }

  const joinedText = textChunks.join(" ").trim();
  const joinedNorm = normalizeComparableText(joinedText);
  if (!joinedNorm) {
    return true;
  }

  if (joinedNorm === structuredNorm) {
    return true;
  }

  if (
    structuredNorm.startsWith(joinedNorm) &&
    joinedNorm.length >= Math.max(12, Math.floor(structuredNorm.length * 0.55))
  ) {
    return true;
  }

  if (
    joinedNorm.includes(structuredNorm) &&
    joinedNorm.length >= structuredNorm.length + 24
  ) {
    return false;
  }

  const structuredTokens = comparableTokens(structuredNorm);
  const textTokens = comparableTokens(joinedNorm);
  if (structuredTokens.length === 0 || textTokens.length === 0) {
    return false;
  }

  const textTokenSet = new Set(textTokens);
  let sharedTokenCount = 0;
  for (const token of structuredTokens) {
    if (textTokenSet.has(token)) {
      sharedTokenCount += 1;
    }
  }

  const structuredCoverage = sharedTokenCount / structuredTokens.length;
  const textCoverage = sharedTokenCount / textTokens.length;

  return (
    structuredCoverage >= 0.72 &&
    textCoverage >= 0.72 &&
    joinedNorm.length <= structuredNorm.length + 16
  );
}

export function getCentralizedAssistantContentFromRawSdkEventPayloads(
  rawSdkEventPayloads?: unknown[],
): string {
  return getCentralizedAssistantContentChunksFromRawSdkEventPayloads(
    rawSdkEventPayloads,
  )
    .join("")
    .trim();
}

export function latestAssistantMessageIdFromCentralizedTape(
  rawSdkEventPayloads?: unknown[],
): string | null {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return null;
  }

  for (let index = rawSdkEventPayloads.length - 1; index >= 0; index -= 1) {
    const event = asRecord(rawSdkEventPayloads[index]);
    if (!event) {
      continue;
    }

    const properties = asRecord(event.properties);
    const info = asRecord(properties?.info) ?? asRecord(event.info) ?? getCentralizedEventInfo(event);
    const part = getCentralizedEventPart(event);

    const eventType = getCentralizedEventType(event);

    if (
      eventType === "message.updated" &&
      asString(info?.role).trim().toLowerCase() === "assistant"
    ) {
      const assistantId = firstNonEmptyString(
        info?.id,
        info?.messageID,
        info?.messageId,
      );
      if (assistantId) {
        return assistantId;
      }
    }

    const partType = asString(part?.type).trim().toLowerCase();
    const toolName = firstNonEmptyString(part?.tool, part?.name)?.toLowerCase();

    if (
      partType === "step-finish" ||
      partType === "step-start" ||
      partType === "reasoning" ||
      partType === "tool" ||
      !!toolName
    ) {
      const assistantId = firstNonEmptyString(
        part?.messageID,
        part?.messageId,
      );
      if (assistantId) {
        return assistantId;
      }
    }
  }

  // Some older/simpler centralized fixtures only contain the final assistant
  // text part and never include an explicit assistant `message.updated` or
  // `step-finish` marker. In that case, fall back to the last text-bearing
  // message id so the renderer still has a stable response anchor.
  for (let index = rawSdkEventPayloads.length - 1; index >= 0; index -= 1) {
    const event = asRecord(rawSdkEventPayloads[index]);
    if (!event) {
      continue;
    }

    const part = getCentralizedEventPart(event);
    if (!part) {
      continue;
    }

    const partType = asString(part.type).trim().toLowerCase();
    if (
      partType === "tool" &&
      asString(part.tool).toLowerCase().includes("structuredoutput")
    ) {
      const assistantId = firstNonEmptyString(
        part?.messageID,
        part?.messageId,
      );
      if (assistantId) {
        return assistantId;
      }
      continue;
    }
    if (partType !== "text" && partType !== "message" && partType !== "output_text" && partType !== "reasoning" && partType !== "step-start") {
      continue;
    }

    const assistantId = firstNonEmptyString(
      part?.messageID,
      part?.messageId,
    );
    if (assistantId) {
      return assistantId;
    }
  }

  return null;
}

/**
 * Returns the last index that belongs to the finalized assistant turn in the
 * centralized tape.
 */
export function getCentralizedAssistantTurnCompletionIndex(
  rawSdkEventPayloads?: unknown[],
): number {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return -1;
  }

  const latestAssistantMessageId =
    latestAssistantMessageIdFromCentralizedTape(rawSdkEventPayloads);
  if (!latestAssistantMessageId) {
    return -1;
  }

  for (let index = 0; index < rawSdkEventPayloads.length; index += 1) {
    const event = asRecord(rawSdkEventPayloads[index]);
    if (!event) {
      continue;
    }

    const properties = asRecord(event.properties);
    const info = asRecord(properties?.info) ?? asRecord(event.info);
    const part = getCentralizedEventPart(event);
    const eventType = asString(event.type).trim();
    const candidateMessageId = firstNonEmptyString(
      info?.id,
      info?.messageID,
      info?.messageId,
      part?.messageID,
      part?.messageId,
    );

    if (candidateMessageId !== latestAssistantMessageId) {
      continue;
    }

    if (eventType === "message.updated" && asString(info?.finish).trim()) {
      return index;
    }

    if (
      eventType === "message.part.updated" &&
      asString(part?.type).trim().toLowerCase() === "step-finish"
    ) {
      return index;
    }
  }

  return -1;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function normalizeCompatibilityWarnings(value: unknown): CompatibilityWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      const rec = asRecord(item);
      if (!rec) {
        return undefined;
      }
      const component = asString(rec.component).toLowerCase();
      const status = asString(rec.status).toLowerCase();
      const message = asOptionalString(rec.message);
      const supportedRange = asOptionalString(rec.supportedRange);
      if (
        (component !== "sdk" && component !== "server") ||
        (status !== "untested" && status !== "unknown") ||
        !message ||
        !supportedRange
      ) {
        return undefined;
      }
      return {
        component: component as CompatibilityWarning["component"],
        status: status as CompatibilityWarning["status"],
        version: asOptionalString(rec.version),
        supportedRange,
        message,
      } satisfies CompatibilityWarning;
    })
    .filter((item): item is CompatibilityWarning => !!item);
}

function compatibilityWarningToast(
  warnings: CompatibilityWarning[],
  sdkVersion?: string,
  serverVersion?: string,
  sessionId?: string | null,
): CentralizedToastNotification | null {
  const sdkLabel = sdkVersion || warnings.find((item) => item.component === "sdk")?.version;
  const serverLabel = serverVersion || warnings.find((item) => item.component === "server")?.version;
  const sdkParts = sdkLabel?.match(/^v?(\d+)\.(\d+)/);
  const serverParts = serverLabel?.match(/^v?(\d+)\.(\d+)/);
  // Compatibility cannot be evaluated until both sides identify a concrete
  // numeric release. In particular, an early init snapshot may contain the
  // server version while SDK detection is still unavailable; showing an
  // "unknown" mismatch in that state creates a false warning.
  if (!sdkParts || !serverParts) return null;
  const versionsDiffer = Boolean(
    sdkParts[1] !== serverParts[1] || sdkParts[2] !== serverParts[2],
  );
  if (warnings.length === 0 && !versionsDiffer) return null;

  const displaySdkLabel = sdkLabel || "unknown";
  const displayServerLabel = serverLabel || "unknown";
  return {
    key: `compatibility:${displaySdkLabel}:${displayServerLabel}:${warnings.map((item) => item.component).join(",")}`,
    type: "compatibility.warning",
    title: "OpenCode version mismatch",
    message: `The extension SDK (${displaySdkLabel}) and OpenCode TUI/server (${displayServerLabel}) are not on a supported matching version. Update OpenCode TUI/server to continue receiving fixes and compatibility support.`,
    variant: "warning",
    durationMs: 12000,
    sessionId: sessionId || undefined,
  };
}

function asSessionStats(value: unknown): AppState["sessionStats"] | undefined {
  const rec = asRecord(value);
  if (!rec) {
    return undefined;
  }
  const normalize = (raw: unknown): number | undefined =>
    typeof raw === "number" && Number.isFinite(raw) && raw >= 0
      ? Math.floor(raw)
      : undefined;

  const input = normalize(rec.input);
  const output = normalize(rec.output);
  const read = normalize(rec.read);
  const write = normalize(rec.write);
  const duration = normalize(rec.duration);
  if (
    input === undefined &&
    output === undefined &&
    read === undefined &&
    write === undefined &&
    duration === undefined
  ) {
    return undefined;
  }

  return {
    input: input ?? 0,
    output: output ?? 0,
    read: read ?? 0,
    write: write ?? 0,
    duration: duration ?? 0,
  };
}

function normalizeTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function getMessageInputTokens(message: Message): number | undefined {
  // OpenCode splits prompt usage into uncached input and cache-read tokens.
  // `tokens.input` alone can therefore be tiny (for example, only the newest
  // user text) even when the model receives a large cached conversation.
  const tokens = message.tokens ?? message.info?.tokens;
  const input = normalizeTokenCount(tokens?.input);
  const cacheRead = normalizeTokenCount(tokens?.cache?.read);
  if (input === undefined && cacheRead === undefined) {
    return undefined;
  }
  return (input ?? 0) + (cacheRead ?? 0);
}

function getMessageModelIdentity(message: Message): {
  providerID?: string;
  modelID?: string;
} {
  const info = asRecord(message.info);
  return {
    providerID:
      firstNonEmptyString(message.providerID, info?.providerID) ??
      undefined,
    modelID:
      firstNonEmptyString(message.modelID, info?.modelID) ??
      undefined,
  };
}

function findLatestContextInputTokens(messages: Message[] | undefined | null): {
  inputTokens: number;
  providerID?: string;
  modelID?: string;
} | undefined {
  if (!messages || messages.length === 0) {
    return undefined;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const inputTokens = getMessageInputTokens(messages[index]);
    if (inputTokens === undefined) {
      continue;
    }
    return {
      inputTokens,
      ...getMessageModelIdentity(messages[index]),
    };
  }
  return undefined;
}

function calculateContextUsagePct(
  inputTokens: number | undefined,
  state: AppState,
  modelIdentity?: { providerID?: string; modelID?: string },
): number | undefined {
  if (inputTokens === undefined) {
    return undefined;
  }

  const selectedModel = state.selectedModel;
  const availableModels = Array.isArray(state.availableModels)
    ? state.availableModels
    : [];
  const providerID = modelIdentity?.providerID || selectedModel?.providerID;
  const modelID = modelIdentity?.modelID || selectedModel?.modelID;
  const matched =
    providerID && modelID
      ? availableModels.find(
          (model) =>
            model.providerID === providerID && model.modelID === modelID,
        )
      : selectedModel
        ? availableModels.find(
            (model) =>
              model.providerID === selectedModel.providerID &&
              model.modelID === selectedModel.modelID,
          )
        : undefined;
  const contextLimit = matched?.contextLimit;
  if (
    typeof contextLimit !== "number" ||
    !Number.isFinite(contextLimit) ||
    contextLimit <= 0
  ) {
    return undefined;
  }

  return Math.min(100, Math.round((inputTokens / contextLimit) * 100));
}

function dispatchContextUsageFromMessages(
  dispatch: Dispatch<AppAction>,
  state: AppState,
  messages: Message[],
): void {
  const latest = findLatestContextInputTokens(messages);
  dispatch({
    type: "SET_CONTEXT_INPUT_TOKENS",
    payload: latest?.inputTokens,
  });
  dispatch({
    type: "SET_CONTEXT_USAGE_PCT",
    payload: calculateContextUsagePct(latest?.inputTokens, state, latest),
  });
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isFinishSignal(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "true" ||
    normalized === "done" ||
    normalized === "stop" ||
    normalized === "complete" ||
    normalized === "completed" ||
    normalized === "success" ||
    normalized === "finished" ||
    normalized === "error"
  );
}

function resolveMessageUpdatedFinishSignal(
  payload: UnknownRecord,
  properties: UnknownRecord | null,
): boolean {
  // Preferred completion flag used by most providers.
  const info = asRecord(payload.info) ?? asRecord(properties?.info);
  if (info && isFinishSignal((info as UnknownRecord).finish)) {
    return true;
  }

  // Explicit error payloads mean the message is no longer processing.
  if (info?.error || payload.error || properties?.error) {
    return true;
  }

  // If the payload explicitly includes a completion timestamp, it's finished.
  if (asRecord(info?.time)?.completed) {
    return true;
  }

  // Fallbacks for providers that emit terminal status only on message/part/state
  // records. Without this, UI can remain in loading even after the final content
  // has already arrived.
  const statusCandidates = [
    payload.status,
    payload.state,
    payload.reason,
    properties?.status,
    properties?.reason,
    asRecord(properties?.state)?.status,
    asRecord(properties?.state)?.reason,
    asRecord(properties?.message)?.status,
    asRecord(properties?.message)?.reason,
    asRecord(properties?.part)?.status,
    asRecord(properties?.part)?.reason,
    asRecord(payload.message)?.status,
    asRecord(payload.message)?.reason,
  ];
  return statusCandidates.some((candidate) => isFinishSignal(candidate));
}

function asArray<T>(value: unknown, guard: (item: unknown) => item is T): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(guard);
}

function joinRichStringSegments(segments: string[]): string {
  let out = "";
  for (const segment of segments) {
    if (!segment) {
      continue;
    }
    if (!out) {
      out = segment;
      continue;
    }

    const prevChar = out[out.length - 1];
    const nextChar = segment[0];
    const hasWhitespaceBoundary = /\s/.test(prevChar) || /\s/.test(nextChar);
    const startsWithClosingPunctuation = /^[,.;:!?)}\]]/.test(segment);
    const endsWithOpeningPunctuation = /[(\[{]$/.test(prevChar);

    if (
      !hasWhitespaceBoundary &&
      !startsWithClosingPunctuation &&
      !endsWithOpeningPunctuation
    ) {
      out += " ";
    }

    out += segment;
  }
  return out;
}

function asRichString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return joinRichStringSegments(value.map((item) => asRichString(item)));
  }
  const rec = asRecord(value);
  if (!rec) {
    return '';
  }

  const candidates = [rec.value, rec.text, rec.content, rec.delta];
  for (const candidate of candidates) {
    const text = asRichString(candidate);
    if (text) {
      return text;
    }
  }

  return '';
}

function isOpaqueIdLike(value: string): boolean {
  const text = value.trim();
  if (text.length < 8) {
    return false;
  }
  return (
    /^[a-f0-9-]{8,}$/i.test(text) ||
    /^msg[_-][a-z0-9-]+$/i.test(text) ||
    /^call[_-][a-z0-9-]+$/i.test(text)
  );
}

function normalizeChoiceAnswerValue(value: string | undefined, label: string): string {
  const rawValue = typeof value === "string" ? value.trim() : "";
  const rawLabel = label.trim();
  const fallbackLabelAnswer = rawLabel
    .replace(/\s*\((?:recommended|suggested)\)\s*$/i, "")
    .trim();
  const labelAnswer = fallbackLabelAnswer || rawLabel;

  if (!rawValue) {
    return labelAnswer;
  }

  const looksLikeMachineSlug =
    /^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(rawValue) ||
    /^[a-z0-9]+(?:-[a-z0-9]+)+$/i.test(rawValue);
  if (isOpaqueIdLike(rawValue) || looksLikeMachineSlug) {
    return labelAnswer;
  }

  return rawValue;
}

function sanitizeReasoningChunk(value: string): string {
  const text = value.trim();
  if (!text || isOpaqueIdLike(text)) {
    return '';
  }
  return value;
}

function containsThoughtTagReasoning(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return /<\s*\/?\s*thought\s*>/i.test(trimmed);
}

function splitMixedReasoningFromContent(
  value: string,
): { content: string; reasoning: string } | null {
  const text = value.trim();
  if (!text || text.length < 40) {
    return null;
  }

  const openTag = /<\s*thought\s*>/i.exec(text);
  const closeTag = /<\s*\/\s*thought\s*>/i.exec(text);
  if (!openTag || !closeTag || closeTag.index <= openTag.index) {
    return null;
  }

  const content = text.slice(0, openTag.index).trim();
  const reasoning = text
    .slice(openTag.index + openTag[0].length, closeTag.index)
    .trim();
  if (!content || !reasoning) {
    return null;
  }

  return { content, reasoning };
}

function needsBoundarySpace(previous: string, next: string): boolean {
  if (!previous || !next) {
    return false;
  }

  const prevChar = previous[previous.length - 1];
  const nextChar = next[0];
  if (/\s/.test(prevChar) || /\s/.test(nextChar)) {
    return false;
  }
  if (/^[,.;:!?)}\]]/.test(next)) {
    return false;
  }
  if (/[(\[{]$/.test(prevChar)) {
    return false;
  }

  return /[A-Za-z0-9]/.test(prevChar) && /[A-Za-z0-9]/.test(nextChar);
}

/**
 * Resolve a streaming content update with minimal transformation.
 *
 * Contract:
 * - Returns raw data as-is. No boundary-space insertion, no word-overlap detection,
 *   no reformatting. The caller is responsible for any presentation-level cleanup.
 * - Reasoning is classified structurally before this function is called. A
 *   non-overlapping text snapshot is therefore a second visible assistant
 *   message in the same live response block, not a reason to erase the first.
 *
 * Cases:
 * 1. Empty incoming → null (no-op)
 * 2. No current content → set raw chunk as-is
 * 3. Same normalized content → null (no-op, deduplicate)
 * 4. Incoming starts with current → extract remainder as delta (full-snapshot continuation)
 * 5. Current starts with incoming → null (stale snapshot, don't regress)
 * 6. fromDelta=true → append raw chunk directly
 * 7. Fallback → append a distinct non-delta assistant message
 */
export function resolveStreamingContentUpdate(
  currentContent: string,
  incomingChunk: string,
  fromDelta: boolean,
): { content: string; append: boolean } | null {
  if (!incomingChunk) {
    return null;
  }

  if (!currentContent) {
    return { content: incomingChunk, append: false };
  }

  // Perf: short-circuit the \r\n -> \n regex when no \r is present (the common
  // case after the first normalization). On 150KB streaming content × 160
  // calls/sec this avoids ~24M regex char-scans/sec.
  const currentNormalized = currentContent.includes('\r')
    ? currentContent.replace(/\r\n/g, '\n')
    : currentContent;
  const incomingNormalized = incomingChunk.includes('\r')
    ? incomingChunk.replace(/\r\n/g, '\n')
    : incomingChunk;

  if (incomingNormalized === currentNormalized) {
    return null;
  }

  if (incomingNormalized.startsWith(currentNormalized)) {
    const remainder = incomingNormalized.slice(currentNormalized.length);
    if (!remainder) {
      return null;
    }
    return { content: remainder, append: true };
  }

  if (currentNormalized.startsWith(incomingNormalized)) {
    return null;
  }

  if (fromDelta) {
    // The event stream can repeat a cumulative text snapshot under a new
    // transport event ID. It is still the same rendered response data, so
    // retain only the suffix that is new after the current stream boundary.
    // This operates on chunk structure, not on assistant wording.
    const overlapRemainder = findWordOverlapRemainder(
      currentNormalized,
      incomingNormalized,
    );
    if (overlapRemainder !== null) {
      return { content: overlapRemainder, append: true };
    }
    return { content: incomingChunk, append: true };
  }

  // A single live response block can contain multiple assistant text messages
  // separated by tool/reasoning phases. Once snapshot and delta continuations
  // above have been ruled out, retain this distinct message rather than
  // replacing already-rendered response content.
  return { content: `\n\n${incomingChunk}`, append: true };
}

function findWordOverlapRemainder(
  currentContent: string,
  incomingChunk: string,
): string | null {
  const currentWords = normalizeComparableText(currentContent)
    .toLowerCase()
    .split(" ")
    .filter((word) => word.length > 0);
  const incomingWords = normalizeComparableText(incomingChunk)
    .toLowerCase()
    .split(" ")
    .filter((word) => word.length > 0);
  if (currentWords.length === 0 || incomingWords.length === 0) {
    return null;
  }

  const maxOverlap = Math.min(currentWords.length, incomingWords.length);
  for (let overlap = maxOverlap; overlap >= 2; overlap -= 1) {
    let matches = true;
    for (let index = 0; index < overlap; index += 1) {
      if (
        currentWords[currentWords.length - overlap + index] !==
        incomingWords[index]
      ) {
        matches = false;
        break;
      }
    }
    if (!matches) {
      continue;
    }

    const remainder = skipLeadingWords(incomingChunk, overlap).trimStart();
    if (!remainder) {
      return null;
    }
    return remainder;
  }

  return null;
}

function skipLeadingWords(text: string, wordCount: number): string {
  if (wordCount <= 0) {
    return text;
  }

  const wordMatcher = /\S+/g;
  let seen = 0;
  let startIndex = text.length;
  let match: RegExpExecArray | null;

  while ((match = wordMatcher.exec(text)) !== null) {
    seen += 1;
    if (seen === wordCount + 1) {
      startIndex = match.index;
      break;
    }
  }

  if (seen <= wordCount) {
    return "";
  }

  return text.slice(startIndex);
}

function normalizePartType(value: unknown): string {
  const raw = asString(value).trim().toLowerCase();
  if (!raw) {
    return "";
  }
  if (raw === "thinking" || raw === "thought") {
    return "reasoning";
  }
  if (raw === "stepstart" || raw === "step_start") {
    return "step-start";
  }
  if (raw === "stepstop" || raw === "step_stop") {
    return "step-stop";
  }
  if (raw === "stepfinish" || raw === "step_finish") {
    return "step-finish";
  }
  if (raw === "toolcall" || raw === "tool_call" || raw === "tool-call") {
    return "tool";
  }
  return raw;
}

function isTerminalProgressPart(part: UnknownRecord, partType: string): boolean {
  // Terminal progress parts are activity snapshots, not proof that the model is
  // still generating. Late edit/tool completions can arrive after the final text.
  if (partType === "step-finish" || partType === "step-stop") {
    return true;
  }
  const stateObj = asRecord(part.state);
  const status = normalizeProgressStatus(asString(part.status));
  const stateStatus = normalizeProgressStatus(asString(stateObj?.status));
  return (
    status !== "pending" ||
    stateStatus !== "pending" ||
    Boolean(stateObj && "result" in stateObj)
  );
}

type StructuredProgressUpdate = {
  title: string;
  status?: 'pending' | 'running' | 'done' | 'error';
  meta?: string;
  filePath?: string;
  command?: string;
  output?: string;
};

function normalizeProgressStatus(
  value?: string | null,
): "pending" | "running" | "done" | "completed" | "error" {
  const v = value?.toLowerCase();
  if (
    v === "running" ||
    v === "in_progress" ||
    v === "processing" ||
    v === "streaming"
  ) {
    return "running";
  }
  if (
    v === "completed" ||
    v === "complete"
  ) {
    return "completed";
  }
  if (
    v === "done" ||
    v === "success" ||
    v === "finished"
  ) {
    return "done";
  }
  if (v === "error" || v === "failed") {
    return "error";
  }
  return "pending";
}

function normalizeDiffStats(
  value: unknown,
): { added: number; deleted: number } | undefined {
  const rec = asRecord(value);
  if (!rec) {
    return undefined;
  }
  const addedRaw =
    typeof rec.added === "number" && Number.isFinite(rec.added)
      ? rec.added
      : typeof rec.additions === "number" && Number.isFinite(rec.additions)
        ? rec.additions
      : undefined;
  const deletedRaw =
    typeof rec.deleted === "number" && Number.isFinite(rec.deleted)
      ? rec.deleted
      : typeof rec.deletions === "number" && Number.isFinite(rec.deletions)
        ? rec.deletions
      : undefined;
  if (typeof addedRaw !== "number" && typeof deletedRaw !== "number") {
    return undefined;
  }
  return {
    added: Math.max(0, addedRaw ?? 0),
    deleted: Math.max(0, deletedRaw ?? 0),
  };
}

function normalizeActivityDiffExcerpt(
  value: unknown,
): ActivityDiffExcerpt | undefined {
  const rec = asRecord(value);
  if (!rec) {
    return undefined;
  }
  const lines = Array.isArray(rec.lines)
    ? rec.lines.filter((line): line is string => typeof line === "string")
    : [];

  // Check if there are diff stats (added/deleted counts)
  const added = typeof rec.added === 'number' && Number.isFinite(rec.added) ? Math.max(0, rec.added) : undefined;
  const deleted = typeof rec.deleted === 'number' && Number.isFinite(rec.deleted) ? Math.max(0, rec.deleted) : undefined;

  // Return excerpt if we have lines OR diff stats
  // This allows fallback rendering of diff stats even without detailed lines
  if (lines.length === 0 && !added && !deleted) {
    return undefined;
  }

  return {
    header: asOptionalString(rec.header),
    lines,
    added,
    deleted,
  };
}

function diffExcerptFromPatch(
  patch: unknown,
  diffStats?: { added?: number; deleted?: number },
): ActivityDetail["diffExcerpt"] {
  const text = asOptionalString(patch);
  if (!text) {
    return undefined;
  }
  const allLines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))
    .filter((line) =>
      line.length > 0 &&
      !line.startsWith("Index: ") &&
      !line.startsWith("===================================================================") &&
      !line.startsWith("--- ") &&
      !line.startsWith("+++ "),
    );
  const lines = allLines.slice(0, 40);
  if (lines.length === 0) {
    return undefined;
  }
  return {
    header: lines.find((line) => line.startsWith("@@")),
    lines,
    added: diffStats?.added ?? allLines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length,
    deleted: diffStats?.deleted ?? allLines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length,
  };
}

function diffExcerptFromEditInput(input: UnknownRecord | null): ActivityDetail["diffExcerpt"] {
  const oldText = asOptionalString(input?.oldString);
  const newText = asOptionalString(input?.newString);
  if (!oldText && !newText) {
    return undefined;
  }
  const deletedLines = oldText ? oldText.split(/\r?\n/u) : [];
  const addedLines = newText ? newText.split(/\r?\n/u) : [];
  const allLines = [
    ...deletedLines.map((line) => `-${line}`),
    ...addedLines.map((line) => `+${line}`),
  ];
  return {
    lines: allLines.slice(0, 40),
    added: addedLines.length,
    deleted: deletedLines.length,
  };
}

const FILE_PATH_HINT_KEYS = new Set([
  "file",
  "filepath",
  "path",
  "filename",
  "targetfile",
  "absolutepath",
  "uri",
  "directorypath",
  "searchpath",
  "searchdirectory",
  "outputfile",
  "inputfile",
]);

function normalizePossibleFileUri(value: string): string {
  return value.startsWith("file://") ? value.replace(/^file:\/\//, "") : value;
}

function looksLikeFilePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /\s{2,}/.test(trimmed)) return false;
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.startsWith("file://")) {
    return true;
  }

  /**
   * IMPORTANT: Very restrictive pattern to prevent false positives.
   *
   * This was updated to fix a bug where text like "attachment handling in chat
   * Search for component files with names containing 'chat', 'message', etc."
   * was being incorrectly matched as a file path.
   *
   * The new pattern:
   * 1. ONLY matches known file extensions (whitelist approach)
   * 2. REQUIRES proper filename structure (alphanumeric start/end)
   * 3. REJECTS text with spaces, quotes, or special characters
   *
   * VALID matches:
   * - Button.tsx ✅
   * - config.json ✅
   * - file-name.js ✅
   *
   * INVALID matches (correctly rejected):
   * - "input", "output" etc. ❌ (contains quotes, spaces, not known extension)
   * - attachment handling in chat ❌ (spaces, no proper extension)
   * - etc. ❌ (not a known extension)
   */
  const KNOWN_EXTENSIONS = [
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'c', 'cpp',
    'h', 'hpp', 'java', 'rb', 'php', 'sh', 'bash', 'zsh', 'fish', 'json',
    'yaml', 'yml', 'toml', 'md', 'mdx', 'css', 'scss', 'less', 'html',
    'xml', 'svg', 'sql', 'prisma', 'lock', 'env', 'gitignore', 'dockerfile',
    'makefile'
  ];

  // Very restrictive pattern: only known extensions, proper filename structure
  return /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*[a-zA-Z0-9]\.([a-zA-Z0-9]{2,8})$/.test(trimmed) &&
         KNOWN_EXTENSIONS.some(ext => trimmed.toLowerCase().endsWith('.' + ext));
}

function extractFilePathCandidate(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): string | undefined {
  if (depth > 4 || value === null || typeof value === "undefined") {
    return undefined;
  }
  if (typeof value === "string") {
    const normalized = normalizePossibleFileUri(value.trim());
    return looksLikeFilePath(normalized) ? normalized : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractFilePathCandidate(item, depth + 1, seen);
      if (nested) return nested;
    }
    return undefined;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  const rec = asRecord(value);
  if (!rec) return undefined;
  if (seen.has(rec)) return undefined;
  seen.add(rec);

  for (const [key, fieldValue] of Object.entries(rec)) {
    if (!FILE_PATH_HINT_KEYS.has(key.toLowerCase())) continue;
    const nested = extractFilePathCandidate(fieldValue, depth + 1, seen);
    if (nested) return nested;
  }

  // Check nested object values
  for (const fieldValue of Object.values(rec)) {
    const nested = extractFilePathCandidate(fieldValue, depth + 1, seen);
    if (nested) return nested;
  }
  return undefined;
}

function extractBackgroundTaskId(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = asOptionalString(value);
    if (!text) {
      continue;
    }
    const match = text.match(/\b(bg_[a-z0-9]+)\b/i);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

function normalizeActivityDetail(value: unknown): ActivityDetail | undefined {
  const rec = asRecord(value);
  if (!rec) {
    return undefined;
  }
  const metadataRec = asRecord(rec.metadata);
  const metadata: Record<string, string | number | boolean> = {};
  if (metadataRec) {
    for (const [key, fieldValue] of Object.entries(metadataRec)) {
      if (
        typeof fieldValue === "string" ||
        typeof fieldValue === "number" ||
        typeof fieldValue === "boolean"
      ) {
        metadata[key] = fieldValue;
      }
    }
  }

  // Extract input properties supporting both rec.input and rec.state.input
  const inputRec = asRecord(rec.input) || asRecord(asRecord(rec.state)?.input);
  const stateRec = asRecord(rec.state);
  const outputText =
    asOptionalString(rec.output) ||
    asOptionalString(asRecord(rec.state)?.output) ||
    asOptionalString(metadataRec?.output);
  const files = asArray(
    rec.files,
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  ).map((item) => item.trim());
  const backgroundTaskId = extractBackgroundTaskId(
    metadataRec?.task_id,
    metadataRec?.taskId,
    inputRec?.task_id,
    inputRec?.taskId,
    outputText,
  );

  // Construct the ActivityDetail object
  const activityDetail: ActivityDetail = {
    kind: asOptionalString(rec.kind) as ActivityDetail["kind"] | undefined,
    summary: asOptionalString(rec.summary),
    command: asOptionalString(rec.command),
    // Extract input properties (e.g. pattern, path for glob tool) from raw payload
    input: inputRec || undefined,
    files: files.length > 0 ? files : undefined,
    output: outputText,
    backgroundTaskId,
    backgroundOutput: asOptionalString(asRecord(rec.state)?.output) || asOptionalString(rec.output),
    tool: asOptionalString(rec.tool),
    // Map search/glob/grep input pattern or query to query field if query is missing so that the search pattern builder captures it
    query:
      asOptionalString(rec.query) ||
      (inputRec
        ? asOptionalString(inputRec.pattern) ||
          asOptionalString(inputRec.Pattern) ||
          asOptionalString(inputRec.query) ||
          asOptionalString(inputRec.Query)
        : undefined),
    file:
      asOptionalString(rec.file) ||
      asOptionalString(inputRec?.filePath) ||
      asOptionalString(inputRec?.file) ||
      asOptionalString(inputRec?.path) ||
      files[0],
    diffExcerpt: normalizeActivityDiffExcerpt(rec.diffExcerpt),
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    sessionID:
      asOptionalString(rec.sessionID) ||
      asOptionalString(rec.sessionId) ||
      asOptionalString(stateRec?.sessionID) ||
      asOptionalString(stateRec?.sessionId) ||
      undefined,
  };

  // Debug logging to see what's actually in the activityDetail
  if (activityDetail.output || activityDetail.diffExcerpt) {
    logger.info("[DEBUG] normalizeActivityDetail created", {
      hasOutput: !!activityDetail.output,
      hasDiffExcerpt: !!activityDetail.diffExcerpt,
      tool: activityDetail.tool,
      kind: activityDetail.kind,
      outputLength: activityDetail.output?.length || 0,
      diffLines: activityDetail.diffExcerpt?.lines?.length || 0,
    });
  }

  // Ensure that we don't return an empty activityDetail object
  if (
    !activityDetail.kind &&
    !activityDetail.summary &&
    !activityDetail.command &&
    !activityDetail.input &&
    !activityDetail.tool &&
    !activityDetail.query &&
    !activityDetail.file &&
    !activityDetail.diffExcerpt &&
    !activityDetail.metadata &&
    !activityDetail.backgroundTaskId &&
    !activityDetail.backgroundOutput
  ) {
    return undefined;
  }

  return activityDetail;
}

type ActivitySource = "stream" | "final" | "raw_debug";

// Normalizes the source type of an activity event to ensure it matches the ActivitySource union
function normalizeActivitySource(
  value: unknown,
  fallback: ActivitySource,
): ActivitySource {
  const source = asString(value).toLowerCase();
  if (source === "stream" || source === "final" || source === "raw_debug") {
    return source;
  }
  return fallback;
}

// Merges two activity source values, preferring the one with higher precedence/rank
function mergeActivitySource(
  current?: ActivitySource,
  incoming?: ActivitySource,
): ActivitySource | undefined {
  const rank: Record<ActivitySource, number> = {
    stream: 3,
    final: 2,
    raw_debug: 1,
  };
  if (!current) return incoming;
  if (!incoming) return current;
  return rank[incoming] >= rank[current] ? incoming : current;
}

function isInternalToolName(tool?: string): boolean {
  const normalized = (tool || "").toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("structuredoutput") ||
    normalized.includes("structured_output") ||
    normalized.includes("transport")
  );
}

function normalizeActivityStepRecord(
  value: unknown,
  fallbackSource: ActivitySource,
): MessageStep | undefined {
  const rec = asRecord(value);
  if (!rec) {
    return undefined;
  }
  const label = asString(rec.label);
  const summary = asString(rec.summary);
  const title =
    asString(rec.title) ||
    asString(rec.message) ||
    (label && summary ? `${label} ${summary}` : label || summary) ||
    asString(rec.tool);
  if (!title) {
    return undefined;
  }
  const stateRec = asRecord(rec.state);
  // Extract input record supporting both stateRec.input and rec.input
  const stateInput = asRecord(stateRec?.input) || asRecord(rec.input);
  const filePath =
    asString(rec.filePath) ||
    asString(rec.content) ||
    asString(rec.file) ||
    asString(rec.path) ||
    asString(stateInput?.file) ||
    asString(stateInput?.path) ||
    undefined;
  const statusRaw = asString(stateRec?.status) || asString(rec.status);

  return {
    type: asString(rec.type) || "step",
    title,
    content: filePath,
    status: statusRaw ? normalizeProgressStatus(statusRaw) : undefined,
    source: normalizeActivitySource(rec.source, fallbackSource),
    partType: asString(rec.partType) || asString(rec.type) || undefined,
    internal: asBoolean(rec.internal, false),
    meta:
      asString(rec.meta) ||
      asString(rec.detail) ||
      asString(rec.description) ||
      asString(rec.subtitle) ||
      asString(stateRec?.meta) ||
      asString(stateRec?.detail) ||
      asString(stateRec?.description) ||
      undefined,
    id: asString(rec.id) || undefined,
    callID: asString(rec.callID) || asString(rec.callId) || undefined,
    streamSeq: asOptionalNumber(rec.streamSeq),
    diffStats: normalizeDiffStats(rec.diffStats),
    activityDetail: normalizeActivityDetail(rec.activityDetail),
  };
}

function activityStepMergeKey(step: MessageStep, index: number): string {
  const callID = asString(step.callID).trim();
  if (callID) {
    return `call:${callID}`;
  }
  const id = asString(step.id).trim();
  if (id) {
    return `id:${id}`;
  }
  const title = asString(step.title).trim().toLowerCase();
  const content = asString(step.content).trim().toLowerCase();
  if (title || content) {
    return `title:${title}|content:${content}`;
  }
  return `index:${index}`;
}

function mergeCanonicalActivityStep(
  existing: MessageStep,
  incoming: MessageStep,
): MessageStep {
  const currentStatus = asString(existing.status);
  const nextStatus = asString(incoming.status);
  let status = currentStatus || undefined;
  if (nextStatus) {
    if (
      (currentStatus === "done" || currentStatus === "error") &&
      nextStatus === "pending"
    ) {
      status = currentStatus;
    } else {
      status = normalizeProgressStatus(nextStatus);
    }
  }

  const existingSeq = existing.streamSeq;
  const incomingSeq = incoming.streamSeq;
  let streamSeq = existingSeq;
  if (typeof streamSeq !== "number") {
    streamSeq = incomingSeq;
  } else if (typeof incomingSeq === "number") {
    streamSeq = Math.min(streamSeq, incomingSeq);
  }

  return {
    ...existing,
    ...incoming,
    title: incoming.title || existing.title,
    type: incoming.type || existing.type,
    status,
    meta: incoming.meta || existing.meta,
    content: incoming.content || existing.content,
    id: existing.id || incoming.id,
    callID: existing.callID || incoming.callID,
    streamSeq,
    diffStats: incoming.diffStats || existing.diffStats,
    activityDetail: incoming.activityDetail || existing.activityDetail,
    source: mergeActivitySource(existing.source, incoming.source),
    partType: incoming.partType || existing.partType,
    internal: Boolean(existing.internal || incoming.internal),
  };
}

function extractActivityStepsFromParts(
  parts: MessagePart[],
  fallbackSource: ActivitySource,
): MessageStep[] {
  const fromParts: MessageStep[] = [];
  const stepIndexByCallId = new Map<string, number>();
  for (const part of parts) {
    const rec = asRecord(part);
    if (!rec) {
      continue;
    }
    const partType = normalizePartType(rec.type);
    if (
      partType !== "tool" &&
      partType !== "step-start" &&
      partType !== "step-finish" &&
      partType !== "patch"
    ) {
      continue;
    }

    const tool = asString(rec.tool);
    const toolLower = tool.toLowerCase();
    const isInternal = isInternalToolName(tool);

    const callID = asString(rec.callID) || asString(rec.callId) || undefined;

    const stateRec = asRecord(rec.state);
    // Extract input properties supporting both stateRec.input and rec.input
    const inputRec = asRecord(stateRec?.input) || asRecord(rec.input);
    const resultRec = asRecord(stateRec?.result);
    // OpenCode's hydrated SDK parts keep presentation data under `state`.
    // Preserve it while producing the canonical step rather than relying on a
    // second renderer-specific parser to rediscover the same values.
    const stateMetadata = asRecord(stateRec?.metadata) || asRecord(rec.metadata);
    const displayMetadata = asRecord(stateMetadata?.display);
    const compactMetadata: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(stateMetadata ?? {})) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        compactMetadata[key] = value;
      }
    }
    if (Number.isInteger(Number(displayMetadata?.lineStart))) {
      compactMetadata.lineStart = Number(displayMetadata?.lineStart);
    }
    if (Number.isInteger(Number(displayMetadata?.lineEnd))) {
      compactMetadata.lineEnd = Number(displayMetadata?.lineEnd);
    }
    const filePath =
      asString(inputRec?.filePath) ||
      asString(inputRec?.file) ||
      asString(inputRec?.path) ||
      asString(inputRec?.filename) ||
      asString(inputRec?.TargetFile) ||
      asString(inputRec?.AbsolutePath) ||
      asString(inputRec?.uri) ||
      asString(inputRec?.DirectoryPath) ||
      asString(inputRec?.SearchPath) ||
      asString(inputRec?.SearchDirectory) ||
      asString(rec.filePath) ||
      undefined;
    const metaValues = [
      asString(inputRec?.CommandId),
      asString(inputRec?.CommandLine),
      asString(inputRec?.Query),
      asString(inputRec?.Pattern),
      asString(inputRec?.pattern),
      asString(inputRec?.command),
      asString(inputRec?.query),
      asString(inputRec?.url),
      asString(inputRec?.Url),
    ].filter(Boolean);
    const explicitTitle =
      asString(rec.title) ||
      asString(stateRec?.title) ||
      asString(stateRec?.label);
    const meta =
      asString(rec.meta) ||
      asString(rec.detail) ||
      asString(rec.description) ||
      asString(stateRec?.meta) ||
      asString(stateRec?.detail) ||
      asString(stateRec?.description) ||
      metaValues[0] ||
      undefined;
    const statusValue = asString(stateRec?.status ?? rec.status);
    const existingIndex =
      callID && stepIndexByCallId.has(callID)
        ? stepIndexByCallId.get(callID)
        : undefined;
    const title =
      explicitTitle ||
      (tool ? `Running ${tool}...` : inferredStepTitle(rec));
    const normalizedStatus =
      partType === "step-finish"
        ? "done"
        : statusValue
          ? normalizeProgressStatus(statusValue)
          : partType === "step-start"
            ? "pending"
            : "done";
    const normalized: MessageStep = {
      type: partType || "step",
      title,
      content: filePath,
      status: normalizedStatus,
      source: fallbackSource,
      partType: partType || asString(rec.type) || undefined,
      internal: isInternal,
      meta,
      id: asString(rec.id) || undefined,
      callID,
      streamSeq: asOptionalNumber(rec.streamSeq),
      diffStats:
        normalizeDiffStats(resultRec?.diffStats) ||
        normalizeDiffStats(rec.diffStats),
      activityDetail:
        normalizeActivityDetail(resultRec?.activityDetail) ||
        normalizeActivityDetail(rec.activityDetail) ||
        (() => {
          const metadataPreview =
            asOptionalString(stateMetadata?.preview) ||
            asOptionalString(stateMetadata?.output);
          const metadataTruncated = stateMetadata?.truncated === true;
          const stateOutput = asOptionalString(stateRec?.output);
          const finalOutput = stateOutput || metadataPreview;

          return normalizeActivityDetail({
            kind: "tool_call",
            tool: tool || undefined,
            // Extract command and query directly from inputRec first to avoid shifting index bugs from metaValues
            command: asOptionalString(inputRec?.CommandLine ?? inputRec?.command) || metaValues[0],
            query: asOptionalString(
              inputRec?.Query ??
              inputRec?.query ??
              inputRec?.Pattern ??
              inputRec?.pattern
            ) || metaValues[2] || metaValues[3] || undefined,
            file: filePath,
            // Capture and pass the raw tool input properties
            input: inputRec || undefined,
            output: finalOutput,
            diffExcerpt: (() => {
              const diffExcerptRec = asRecord(stateRec?.diffExcerpt) || asRecord(resultRec?.diffExcerpt);
              if (!diffExcerptRec) return undefined;
              return {
                header: asOptionalString(diffExcerptRec.header),
                lines: Array.isArray(diffExcerptRec.lines) ? diffExcerptRec.lines.map(asString) : [],
                added: typeof diffExcerptRec.added === 'number' ? diffExcerptRec.added : undefined,
                deleted: typeof diffExcerptRec.deleted === 'number' ? diffExcerptRec.deleted : undefined,
              };
            })(),
            metadata: Object.keys(compactMetadata).length > 0
              ? compactMetadata
              : metadataTruncated
                ? { truncated: true }
                : undefined,
          });
        })(),
    };

    if (typeof existingIndex === "number") {
      // History can include multiple tool snapshots with the same callID.
      // Merge them so hydrated rows preserve the latest title/meta/status.
      fromParts[existingIndex] = mergeCanonicalActivityStep(
        fromParts[existingIndex],
        normalized,
      );
      continue;
    }

    if (isEditLikeStep(normalized)) {
      logger.info("[ACTIVITY STEP][EDIT] Extracted edit step from part", {
        title: normalized.title,
        type: normalized.type,
        partType: normalized.partType,
        status: normalized.status,
        content: normalized.content,
        diffStats: normalized.diffStats,
        activityDetail: normalized.activityDetail,
        rawPartKeys: Object.keys(rec),
      });
    }

    fromParts.push(normalized);
    if (callID) {
      stepIndexByCallId.set(callID, fromParts.length - 1);
    }
  }
  return fromParts;
}

function normalizeActivitySteps(
  message: Message,
  streaming: StreamingState | null,
  sanitizedMergedParts: MessagePart[],
): MessageStep[] {
  const messageId = getMessageId(message);
  const candidates: unknown[] = [];
  if (Array.isArray(message.steps)) {
    candidates.push(
      ...message.steps.map((step) => ({ ...step, source: step.source || "final" })),
    );
  }
  if (Array.isArray(message.progressEvents)) {
    candidates.push(
      ...message.progressEvents.map((step) => ({ ...step, source: step.source || "final" })),
    );
  }
  if (Array.isArray(streaming?.steps)) {
    candidates.push(
      ...streaming.steps.map((step) => ({ ...step, source: step.source || "stream" })),
    );
  }
  if (Array.isArray(streaming?.progressEvents)) {
    candidates.push(
      ...streaming.progressEvents.map((step) => ({ ...step, source: step.source || "stream" })),
    );
  }

  const merged: MessageStep[] = [];
  const indexByKey = new Map<string, number>();
  candidates.forEach((candidate, index) => {
    const normalized = normalizeActivityStepRecord(candidate, "final");
    if (!normalized) {
      return;
    }
    const key = activityStepMergeKey(normalized, index);
    const existingIndex = indexByKey.get(key);
    if (typeof existingIndex !== "number") {
      indexByKey.set(key, merged.length);
      merged.push(normalized);
      return;
    }
    merged[existingIndex] = mergeCanonicalActivityStep(
      merged[existingIndex],
      normalized,
    );
  });

  streamDebug("Timeline normalization: activity steps", {
    messageId,
    messageSteps: summarizeStepListForLog(
      Array.isArray(message.steps) ? message.steps : [],
    ),
    messageProgressEvents: summarizeStepListForLog(
      Array.isArray(message.progressEvents) ? message.progressEvents : [],
    ),
    streamingSteps: summarizeStepListForLog(
      Array.isArray(streaming?.steps) ? streaming.steps : [],
    ),
    streamingProgressEvents: summarizeStepListForLog(
      Array.isArray(streaming?.progressEvents) ? streaming.progressEvents : [],
    ),
    mergedSteps: summarizeStepListForLog(merged),
  });

  const editSteps = merged.filter(isEditLikeStep);
  if (editSteps.length > 0) {
    logger.info("[ACTIVITY STEP][EDIT] Rehydrated edit steps", {
      messageId,
      editCount: editSteps.length,
      editSteps: editSteps.map((s) => ({
        title: s.title,
        type: s.type,
        partType: s.partType,
        status: s.status,
        content: s.content,
        diffStats: s.diffStats,
        activityDetail: s.activityDetail,
      })),
    });
  }

  const fallback = extractActivityStepsFromParts(sanitizedMergedParts, "final");
  if (fallback.length > 0) {
    streamDebug("Timeline normalization: extracting fallback steps from parts", {
      messageId,
      fallbackSteps: summarizeStepListForLog(fallback),
    });
    fallback.forEach((normalized) => {
      const key = activityStepMergeKey(normalized, merged.length);
      const existingIndex = indexByKey.get(key);
      if (typeof existingIndex !== "number") {
        indexByKey.set(key, merged.length);
        merged.push(normalized);
        return;
      }
      merged[existingIndex] = mergeCanonicalActivityStep(
        merged[existingIndex],
        normalized,
      );
    });
  }

  return merged;
}

type StructuredInteractiveEvent = {
  type: 'question' | 'confirm' | 'quick_actions' | 'message';
  id?: string;
  title?: string;
  question?: string;
  message?: string;
  options?: InteractiveChoice[];
  actions?: InteractiveChoice[];
  confirmLabel?: string;
  cancelLabel?: string;
  dismissLabel?: string;
  multiSelect?: boolean;
  allowCustomInput?: boolean;
};

type StructuredSubagent = {
  id: string;
  backgroundTaskId?: string;
  name?: string;
  agentId?: string;
  agent?: string;
  agentRole?: string;
  agentType?: string;
  status?: string;
  progress?: number;
  description?: string;
  latestActivity?: string;
  childSessionId?: string;
  parentSessionId?: string;
  parentMessageId?: string;
  thinkingEvents?: SubagentThinkingEvent[];
  progressEvents?: SubagentProgressEvent[];
  timelineEvents?: SubagentTimelineEvent[];
};

type StructuredOutput = {
  responseType?: StructuredResponseType | string;
  message?: string;
  fileChanges?: StructuredFileChange[];
  plan?: {
    file?: string;
    files?: unknown[];
    content?: string;
    title?: string;
    intro?: string;
    summary?: string;
    fileCount?: number;
  };
  walkthrough?: StructuredWalkthrough;
  reasoning?: string[];
  progressUpdates?: StructuredProgressUpdate[];
  interactiveEvents?: StructuredInteractiveEvent[];
  subagents?: StructuredSubagent[];
  subagentsDelta?: {
    parentMessageId?: string;
    items: StructuredSubagent[];
  };
};

/**
 * Project structured-output subagent data into the canonical subagent store.
 *
 * SDK stream events remain the preferred source, but structured output is also
 * a supported transport.  Without this projection, valid `subagents` payloads
 * never reach `subagentsByParentMessageId`, leaving the inline card empty.
 */
export function applyStructuredSubagentPayload(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  structuredOutput: StructuredOutput,
  messageId: string,
): void {
  const state = getState();
  const fallbackParentMessageId =
    structuredOutput.subagentsDelta?.parentMessageId || messageId;
  const fallbackParentSessionId = state.currentSessionId;
  if (!fallbackParentMessageId || !fallbackParentSessionId) {
    return;
  }

  const incoming = [
    ...(Array.isArray(structuredOutput.subagents)
      ? structuredOutput.subagents
      : []),
    ...(Array.isArray(structuredOutput.subagentsDelta?.items)
      ? structuredOutput.subagentsDelta.items
      : []),
  ];
  if (incoming.length === 0) {
    return;
  }

  const summariesByParentMessageId: Record<string, SubagentSummary[]> = {};
  const detailsById: Record<string, SubagentDetail> = {};

  for (const item of incoming) {
    if (!item?.id) {
      continue;
    }
    const parentMessageId = item.parentMessageId || fallbackParentMessageId;
    const parentSessionId = item.parentSessionId || fallbackParentSessionId;
    if (!parentMessageId || !parentSessionId) {
      continue;
    }
    const status =
      item.status === "running" ||
      item.status === "done" ||
      item.status === "error" ||
      item.status === "orphaned" ||
      item.status === "cancelled"
        ? item.status
        : "pending";
    const latestActivity =
      sanitizeSubagentLabel(
        item.latestActivity || item.description || item.name || item.agentId || "",
      ) || "Subagent update";
    const detail: SubagentDetail = {
      id: item.id,
      backgroundTaskId: item.backgroundTaskId,
      parentSessionId,
      parentMessageId,
      childSessionId: item.childSessionId,
      agentId: item.agentId || item.agent || item.name,
      agentRole: item.agentRole || item.agentType,
      status,
      latestActivity,
      references: [],
      thinkingEvents: item.thinkingEvents || [],
      conversationEvents: [],
      progressEvents: item.progressEvents || [],
      timelineEvents: item.timelineEvents || [],
    };
    detailsById[detail.id] = detail;
    (summariesByParentMessageId[parentMessageId] ??= []).push(detail);
  }

  if (!hasSubagentSummaryEntries(summariesByParentMessageId)) {
    return;
  }
  dispatch({
    type: "UPSERT_SUBAGENT_SUMMARIES",
    payload: mergeSubagentSummaryPayload(
      state.subagentsByParentMessageId,
      summariesByParentMessageId,
    ),
  });
  dispatch({
    type: "UPSERT_SUBAGENT_DETAIL",
    payload: mergeSubagentDetailPayload(state.subagentDetailsById, detailsById),
  });
}

function buildStructuredOutputLogPreview(value: unknown): {
  type: string;
  preview: string;
  keys?: string[];
  responseType?: string;
} {
  const rec = asRecord(value);
  const previewSource = rec ?? value;
  let preview = "";
  try {
    preview = JSON.stringify(previewSource).slice(0, 1200);
  } catch {
    preview = String(previewSource);
  }

  return {
    type: Array.isArray(value) ? "array" : typeof value,
    preview,
    keys: rec ? Object.keys(rec) : undefined,
    responseType: rec
      ? firstNonEmptyString(rec.responseType, rec.type, rec.kind, rec.category)
      : undefined,
  };
}

function hasMeaningfulStructuredValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value && typeof value === "object") {
    return Object.keys(value as UnknownRecord).length > 0;
  }
  return false;
}

function getStructuredSemanticSnapshot(value: unknown): Record<string, unknown> {
  const rec = asRecord(value);
  if (!rec) {
    return {};
  }

  const planRec = asRecord(rec.plan);
  const questionRec = asRecord(rec.question);
  const topLevelQuestionChoices =
    (Array.isArray(rec.options) ? rec.options.length : 0) +
    (Array.isArray(rec.choices) ? rec.choices.length : 0) +
    (Array.isArray(rec.actions) ? rec.actions.length : 0);

  return {
    responseType: firstNonEmptyString(rec.responseType, rec.type, rec.kind, rec.category),
    message: firstNonEmptyString(rec.message, rec.content, rec.text),
    planFile: firstNonEmptyString(planRec?.file),
    planContent: firstNonEmptyString(planRec?.content),
    planFiles: Array.isArray(planRec?.files) ? planRec.files.length : 0,
    questionType: firstNonEmptyString(questionRec?.type),
    questionText: firstNonEmptyString(questionRec?.question, rec.question),
    questionOptions:
      (Array.isArray(questionRec?.options) ? questionRec.options.length : 0) +
      (Array.isArray(questionRec?.choices) ? questionRec.choices.length : 0) +
      (Array.isArray(questionRec?.actions) ? questionRec.actions.length : 0) +
      topLevelQuestionChoices,
    interactiveEvents: Array.isArray(rec.interactiveEvents) ? rec.interactiveEvents.length : 0,
    progressUpdates: Array.isArray(rec.progressUpdates) ? rec.progressUpdates.length : 0,
    reasoning: Array.isArray(rec.reasoning) ? rec.reasoning.length : 0,
    fileChanges: Array.isArray(rec.fileChanges) ? rec.fileChanges.length : 0,
    subagents: Array.isArray(rec.subagents) ? rec.subagents.length : 0,
    subagentsDeltaItems: Array.isArray(asRecord(rec.subagentsDelta)?.items)
      ? (asRecord(rec.subagentsDelta)?.items as unknown[]).length
      : Array.isArray(asRecord(rec.subagents_delta)?.items)
        ? (asRecord(rec.subagents_delta)?.items as unknown[]).length
        : 0,
  };
}

function detectStructuredFieldDrops(
  rawRecord: UnknownRecord,
  processedRecord: UnknownRecord,
): {
  droppedSemanticFields: string[];
  droppedTopLevelKeys: string[];
} {
  const rawSnapshot = getStructuredSemanticSnapshot(rawRecord);
  const processedSnapshot = getStructuredSemanticSnapshot(processedRecord);
  const droppedSemanticFields = Object.keys(rawSnapshot).filter((key) => {
    const rawValue = rawSnapshot[key];
    const processedValue = processedSnapshot[key];
    return hasMeaningfulStructuredValue(rawValue) && !hasMeaningfulStructuredValue(processedValue);
  });

  const ignoredRawKeys = new Set([
    "raw",
    "type",
    "kind",
    "category",
    "content",
    "text",
    "options",
    "choices",
    "actions",
    "allowCustomInput",
    "multiSelect",
  ]);
  const droppedTopLevelKeys = Object.keys(rawRecord).filter((key) => {
    if (ignoredRawKeys.has(key)) {
      return false;
    }
    return hasMeaningfulStructuredValue(rawRecord[key]) && !(key in processedRecord);
  });

  return {
    droppedSemanticFields,
    droppedTopLevelKeys,
  };
}

function logStructuredOutputValidationFailureComparison(params: {
  rawInput: unknown;
  rawRecord: UnknownRecord;
  sanitizedRecord: UnknownRecord;
  validationErrors: string[];
}): void {
  // Disabled - too verbose, logs for every text chunk
  // logger.info("Structured output validation raw candidates", {
  //   validationErrors: params.validationErrors,
  //   rawInput: buildStructuredOutputLogPreview(params.rawInput),
  //   rawRecord: buildStructuredOutputLogPreview(params.rawRecord),
  // });

  // logger.info("Structured output validation processed records", {
  //   validationErrors: params.validationErrors,
  //   sanitizedRecord: buildStructuredOutputLogPreview(params.sanitizedRecord),
  // });
}

function warnOnStructuredFieldDrop(
  rawRecord: UnknownRecord,
  processedRecord: UnknownRecord,
  context: {
    stage: "sanitized" | "normalized" | "salvaged";
    validationErrors?: string[];
  } = { stage: "normalized" },
): void {
  const dropReport = detectStructuredFieldDrops(rawRecord, processedRecord);
  if (
    dropReport.droppedSemanticFields.length === 0 &&
    dropReport.droppedTopLevelKeys.length === 0
  ) {
    return;
  }

  // Only log for responseTypes that matter (not text chunks)
  const responseType = rawRecord.responseType;
  if (responseType === 'message') {
    return; // Skip logging for regular message chunks
  }

  // Create unique key for deduplication
  const droppedFieldsCount = dropReport.droppedSemanticFields.length + dropReport.droppedTopLevelKeys.length;
  const validationKey = `${responseType}:${context.stage}:dropped${droppedFieldsCount}`;

  // Only log if we haven't seen this specific warning before
  if (!seenValidationWarnings.has(validationKey)) {
    logger.warn("[STRUCTURED-OUTPUT] Validation failed - fields were dropped", {
      responseType: rawRecord.responseType,
      stage: context.stage,
      droppedFields: droppedFieldsCount,
    });
    seenValidationWarnings.add(validationKey);
  }
}

function finalizeStructuredOutput(normalizedRecord: StructuredOutput): StructuredOutput {
  return {
    ...normalizedRecord,
  };
}

function normalizeWalkthrough(value: UnknownRecord | undefined): StructuredWalkthrough | undefined {
  if (!value) return undefined;
  const title = asString(value.title);
  const file = asString(value.file);
  if (!title || !file) return undefined;

  const changes = Array.isArray(value.changes)
    ? value.changes
      .map((item) => {
        const change = asRecord(item);
        const changeFile = asString(change?.file);
        const summary = asString(change?.summary);
        if (!changeFile || !summary) return undefined;
        const kind = asString(change?.kind);
        return {
          file: changeFile,
          summary,
          kind: ["added", "modified", "deleted", "renamed"].includes(kind)
            ? kind as WalkthroughChangeKind
            : undefined,
        };
      })
      .filter((item): item is NonNullable<StructuredWalkthrough["changes"]>[number] => !!item)
    : undefined;
  const verification = Array.isArray(value.verification)
    ? value.verification
      .map((item) => {
        const entry = asRecord(item);
        const summary = asString(entry?.summary);
        const status = asString(entry?.status);
        if (!summary || !["passed", "failed", "not_run"].includes(status)) return undefined;
        return {
          summary,
          status: status as WalkthroughVerificationStatus,
          command: asString(entry?.command) || undefined,
        };
      })
      .filter((item): item is NonNullable<StructuredWalkthrough["verification"]>[number] => !!item)
    : undefined;
  const steps = Array.isArray(value.steps)
    ? value.steps
      .map((item) => {
        const step = asRecord(item);
        const stepTitle = asString(step?.title);
        const summary = asString(step?.summary);
        const kind = asString(step?.kind);
        if (!stepTitle || !summary || !["inspect", "decide", "change", "verify", "note"].includes(kind)) {
          return undefined;
        }
        const files = Array.isArray(step?.files)
          ? step.files.filter((file): file is string => typeof file === "string" && file.trim().length > 0)
          : undefined;
        return {
          title: stepTitle,
          summary,
          kind: kind as WalkthroughStepKind,
          outcome: asString(step?.outcome) || undefined,
          files: files?.length ? files : undefined,
          command: asString(step?.command) || undefined,
        };
      })
      .filter((item): item is NonNullable<StructuredWalkthrough["steps"]>[number] => !!item)
    : undefined;

  return {
    title,
    file,
    content: asString(value.content) || undefined,
    summary: asString(value.summary) || undefined,
    steps: steps?.length ? steps : undefined,
    changes: changes?.length ? changes : undefined,
    verification: verification?.length ? verification : undefined,
    limitations: Array.isArray(value.limitations)
      ? value.limitations.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : undefined,
  };
}

function normalizeStructuredOutput(value: unknown): StructuredOutput | undefined {
  let candidate: unknown = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return undefined;
    }
  }
  const rec = asRecord(candidate);
  if (!rec) {
    return undefined;
  }
  const sanitizedRec = sanitizeStructuredOutput(rec);
  warnOnStructuredFieldDrop(rec, sanitizedRec, { stage: "sanitized" });
  const validation = validateStructuredOutput(sanitizedRec);
  if (!validation.valid) {
    logStructuredOutputValidationFailureComparison({
      rawInput: value,
      rawRecord: rec,
      sanitizedRecord: sanitizedRec,
      validationErrors: validation.errors,
    });
    const salvaged = salvageStructuredOutput(rec);
    if (salvaged) {
      warnOnStructuredFieldDrop(rec, salvaged as UnknownRecord, {
        stage: "salvaged",
        validationErrors: validation.errors,
      });
    }
    return salvaged ? finalizeStructuredOutput(salvaged) : undefined;
  }
  const rawResponseType =
    asString(sanitizedRec.responseType) || asString(rec.type) || asString(rec.kind) || undefined;
  if (!rawResponseType) {
    return undefined;
  }
  const responseType =
    rawResponseType.toLowerCase() === "interactive"
      ? undefined
      : ["question", "confirm", "quick_actions"].includes(rawResponseType.toLowerCase())
        ? undefined
        : rawResponseType;
  if (!responseType) {
    return undefined;
  }
  const messageText =
    asString(sanitizedRec.text) ||
    asString(sanitizedRec.message) ||
    asString((rec as UnknownRecord).text) ||
    asString((rec as UnknownRecord).message) ||
    undefined;
  const planRec = asRecord(sanitizedRec.plan) ?? asRecord(rec.plan);
  const normalizedPlan = planRec
    ? {
      file: asString(planRec.file) || undefined,
      files: Array.isArray(planRec.files) ? planRec.files : undefined,
      content: asString(planRec.content) || undefined,
      title: asString(planRec.title) || undefined,
      intro: asString(planRec.intro) || undefined,
      summary: asString(planRec.summary) || undefined,
      fileCount:
        typeof planRec.fileCount === "number" && Number.isFinite(planRec.fileCount)
          ? planRec.fileCount
          : undefined,
    }
    : undefined;
  const hasNormalizedPlan =
    !!normalizedPlan &&
    !!(
      normalizedPlan.file ||
      normalizedPlan.content ||
      (Array.isArray(normalizedPlan.files) && normalizedPlan.files.length > 0)
    );

  const walkthroughRec = asRecord(sanitizedRec.walkthrough) ?? asRecord(rec.walkthrough);
  const normalizedWalkthrough = isWalkthroughNarrativeDistinct(rec)
    ? normalizeWalkthrough(walkthroughRec)
    : undefined;

  const normalizeChoices = (raw: unknown): InteractiveChoice[] => {
    let candidate = raw;
    if (typeof candidate === "string") {
      try {
        candidate = JSON.parse(candidate);
      } catch {
        return [];
      }
    }
    if (!Array.isArray(candidate)) {
      return [];
    }
    return candidate
      .map((item) => {
        const option = asRecord(item);
        if (!option) {
          return null;
        }
        const label = asString(option.label) || asString(option.value);
        if (!label) {
          return null;
        }
        return {
          id: asString(option.id) || undefined,
          label,
          value: normalizeChoiceAnswerValue(asString(option.value), label),
          description: asString(option.description) || asString(option.detail) || undefined
        } as InteractiveChoice;
      })
      .filter((item): item is InteractiveChoice => !!item);
  };

  const normalizeInteractiveEvent = (
    raw: unknown,
    index: number
  ): StructuredInteractiveEvent | undefined => {
    const event = asRecord(raw);
    if (!event) {
      return undefined;
    }
    const typeRaw = (asString(event.type) || asString(event.kind)).toLowerCase();
    const id = asString(event.id) || `interactive-${Date.now()}-${index}`;

    if (typeRaw === 'confirm') {
      const question = asString(event.question) || asString(event.prompt) || asString(event.message);
      if (!question) {
        return undefined;
      }
      return {
        type: 'confirm',
        id,
        title: asString(event.title) || undefined,
        question,
        confirmLabel: asString(event.confirmLabel) || asString(event.confirm_text) || undefined,
        cancelLabel: asString(event.cancelLabel) || asString(event.cancel_text) || undefined
      };
    }

    if (typeRaw === 'quick_actions' || typeRaw === 'quick-actions') {
      const actions = normalizeChoices(event.actions ?? event.options);
      if (actions.length === 0) {
        return undefined;
      }
      return {
        type: 'quick_actions',
        id,
        title: asString(event.title) || asString(event.question) || undefined,
        actions
      };
    }

    if (typeRaw === 'message') {
      const message =
        asString(event.message) ||
        asString(event.content) ||
        asString(event.text);
      if (!message) {
        return undefined;
      }
      return {
        type: 'message',
        id,
        title: asString(event.title) || undefined,
        message,
        dismissLabel:
          asString(event.dismissLabel) ||
          asString(event.dismiss_label) ||
          undefined,
      };
    }

    return undefined;
  };

  const sanitizedInteractiveEvents = Array.isArray(sanitizedRec.interactiveEvents)
    ? sanitizedRec.interactiveEvents
    : undefined;
  const interactiveRaw =
    (sanitizedInteractiveEvents && sanitizedInteractiveEvents.length > 0
      ? sanitizedInteractiveEvents
      : undefined) ??
    rec.interactions ??
    rec.uiEvents;
  const singleInteractive = normalizeInteractiveEvent(interactiveRaw, 0);
  let interactiveEvents = Array.isArray(interactiveRaw)
    ? interactiveRaw
      .map((event, index) => normalizeInteractiveEvent(event, index))
      .filter((event): event is StructuredInteractiveEvent => !!event)
    : singleInteractive
      ? [singleInteractive]
      : [];

  const subagentsRaw =
    sanitizedRec.subagents ??
    (rec.spawnedSubagents as unknown) ??
    (rec.backgroundTasks as unknown) ??
    (rec.background_tasks as unknown);
  const resolveSubagentId = (subagent: UnknownRecord): string | undefined => {
    const backgroundId =
      asString(subagent.backgroundTaskId) ||
      asString(subagent.background_task_id);
    if (backgroundId && /^bg_[a-z0-9]+$/i.test(backgroundId)) {
      return backgroundId;
    }
    const directId = asString(subagent.id);
    if (directId) {
      return directId;
    }
    if (backgroundId) {
      return backgroundId;
    }
    const candidateAgentId =
      asString(subagent.agentId) ||
      asString(subagent.agent) ||
      asString(subagent.name);
    if (candidateAgentId && /^bg_[a-z0-9]+$/i.test(candidateAgentId)) {
      return candidateAgentId;
    }
    return undefined;
  };
  const resolveSubagentRole = (subagent: UnknownRecord): string | undefined => {
    const candidateFromAgentFields =
      asString(subagent.agent) || asString(subagent.agentId) || asString(subagent.name);
    const raw =
      asString(subagent.agentRole) ||
      asString(subagent.agent_role) ||
      asString(subagent.agentType) ||
      asString(subagent.agent_type) ||
      asString(subagent.role) ||
      asString(subagent.type) ||
      candidateFromAgentFields;
    const normalized = raw.trim().toLowerCase();
    if (!normalized) return undefined;
    const knownRoles = new Set([
      "explorer",
      "explore",
      "librarian",
      "library",
      "worker",
      "default",
      "researcher",
      "planner",
    ]);
    return knownRoles.has(normalized) ? normalized : undefined;
  };
  const normalizeSubagentStatus = (value: string): SubagentSummary['status'] => {
    const lowered = value.toLowerCase();
    if (lowered === 'running' || lowered === 'done' || lowered === 'error' || lowered === 'orphaned') {
      return lowered;
    }
    // Accept legacy persisted synonyms that were produced by an earlier
    // normalizer (e.g. "completed" instead of "done", "failed" instead of "error").
    if (lowered === 'completed' || lowered === 'finished' || lowered === 'success') {
      return 'done';
    }
    if (lowered === 'failed' || lowered === 'cancelled' || lowered === 'canceled') {
      return 'error';
    }
    return 'pending';
  };
  const normalizeSubagentProgressEvents = (
    raw: unknown,
    subagentId: string,
  ): SubagentProgressEvent[] | undefined => {
    if (!Array.isArray(raw)) {
      return undefined;
    }
    const events = raw
      .map((entry, index) => {
        const evt = asRecord(entry);
        if (!evt) {
          return null;
        }
        const title = sanitizeSubagentLabel(asString(evt.title));
        if (!title) {
          return null;
        }
        return {
          id: asString(evt.id) || `${subagentId}:progress:${index}`,
          title,
          status: normalizeProgressStatus(asString(evt.status)),
          meta: asString(evt.meta) || undefined,
          filePath:
            asString(evt.filePath) ||
            asString(evt.file) ||
            asString(evt.path) ||
            undefined,
          createdAt: asNumber(evt.createdAt, Date.now()),
          messageID: asString(evt.messageID) || undefined,
          partID: asString(evt.partID) || undefined,
          callID: asString(evt.callID) || undefined,
        } as SubagentProgressEvent;
      })
      .filter((item): item is SubagentProgressEvent => !!item);
    const normalized = normalizeSubagentProgressEventsForPresentation(events);
    return normalized.length > 0 ? normalized : undefined;
  };
  const normalizeSubagentThinkingEvents = (
    raw: unknown,
    subagentId: string,
  ): SubagentThinkingEvent[] | undefined => {
    if (!Array.isArray(raw)) {
      return undefined;
    }
    const events = raw
      .map((entry, index) => {
        const evt = asRecord(entry);
        if (!evt) {
          return null;
        }
        const text = asString(evt.text);
        if (!text) {
          return null;
        }
        return {
          id: asString(evt.id) || `${subagentId}:thinking:${index}`,
          text,
          createdAt: asNumber(evt.createdAt, Date.now()),
          messageID: asString(evt.messageID) || undefined,
          partID: asString(evt.partID) || undefined,
        } as SubagentThinkingEvent;
      })
      .filter((item): item is SubagentThinkingEvent => !!item);
    return events.length > 0 ? events : undefined;
  };
  const normalizeSubagentTimelineEvents = (
    raw: unknown,
    subagentId: string,
  ): SubagentTimelineEvent[] | undefined => {
    if (!Array.isArray(raw)) {
      return undefined;
    }
    const events = raw
      .map((entry, index) => {
        const evt = asRecord(entry);
        if (!evt) {
          return null;
        }
        const label = sanitizeSubagentLabel(asString(evt.label));
        if (!label) {
          return null;
        }
        return {
          key: asString(evt.key) || `${subagentId}:timeline:${index}`,
          type: asString(evt.type) || 'event',
          label,
          createdAt: asNumber(evt.createdAt, Date.now()),
          messageID: asString(evt.messageID) || undefined,
          partID: asString(evt.partID) || undefined,
          callID: asString(evt.callID) || undefined,
        } as SubagentTimelineEvent;
      })
      .filter((item): item is SubagentTimelineEvent => !!item);
    const normalized = normalizeSubagentTimelineEventsForPresentation(events);
    return normalized.length > 0 ? normalized : undefined;
  };
  const subagents = Array.isArray(subagentsRaw)
    ? subagentsRaw
      .map((item): StructuredSubagent | null => {
        const subagent = asRecord(item);
        if (!subagent) {
          return null;
        }
        const id = resolveSubagentId(subagent);
        if (!id) {
          return null;
        }
        return {
          id,
          backgroundTaskId:
            asString(subagent.backgroundTaskId) ||
            asString(subagent.background_task_id) ||
            undefined,
          name:
            asString(subagent.name) ||
            asString(subagent.agentId) ||
            asString(subagent.agent) ||
            undefined,
          agentId:
            asString(subagent.agentId) ||
            asString(subagent.agent) ||
            asString(subagent.name) ||
            undefined,
          agentRole: resolveSubagentRole(subagent),
          status: asString(subagent.status)
            ? normalizeSubagentStatus(asString(subagent.status))
            : undefined,
          progress: typeof subagent.progress === 'number' ? subagent.progress : undefined,
          description: asString(subagent.description) || undefined,
          latestActivity:
            sanitizeSubagentLabel(
              asString(subagent.latestActivity) ||
              asString(subagent.task) ||
              asString(subagent.description),
            ) || undefined,
          childSessionId: asString(subagent.childSessionId) || undefined,
          parentSessionId: asString(subagent.parentSessionId) || undefined,
          parentMessageId: asString(subagent.parentMessageId) || undefined,
          progressEvents: normalizeSubagentProgressEvents(subagent.progressEvents, id),
          thinkingEvents: normalizeSubagentThinkingEvents(subagent.thinkingEvents, id),
          timelineEvents: normalizeSubagentTimelineEvents(subagent.timelineEvents, id),
        };
      })
      .filter(Boolean) as StructuredSubagent[]
    : [];

  const subagentsDeltaRaw = (rec.subagentsDelta ?? rec.subagents_delta) as
    | { parentMessageId?: unknown; items?: unknown }
    | undefined;
  const subagentsDelta =
    subagentsDeltaRaw &&
      Array.isArray(subagentsDeltaRaw.items)
      ? {
        parentMessageId: asString(subagentsDeltaRaw.parentMessageId) || undefined,
        items: subagentsDeltaRaw.items
          .map((item) => {
            const subagent = asRecord(item);
            if (!subagent) {
              return null;
            }
            const id = resolveSubagentId(subagent);
            if (!id) {
              return null;
            }
            return {
              id,
              backgroundTaskId:
                asString(subagent.backgroundTaskId) ||
                asString(subagent.background_task_id) ||
                undefined,
              name: asString(subagent.name) || asString(subagent.agentId) || undefined,
              agentId:
                asString(subagent.agentId) ||
                asString(subagent.agent) ||
                asString(subagent.name) ||
                undefined,
              agentRole: resolveSubagentRole(subagent),
              status: asString(subagent.status) || undefined,
              progress: typeof subagent.progress === 'number' ? subagent.progress : undefined,
              description: asString(subagent.description) || undefined,
              latestActivity:
                sanitizeSubagentLabel(
                  asString(subagent.latestActivity) || asString(subagent.description),
                ) || undefined,
              childSessionId: asString(subagent.childSessionId) || undefined,
              parentSessionId: asString(subagent.parentSessionId) || undefined,
              parentMessageId: asString(subagent.parentMessageId) || undefined,
              progressEvents: normalizeSubagentProgressEvents(subagent.progressEvents, id),
              thinkingEvents: normalizeSubagentThinkingEvents(subagent.thinkingEvents, id),
              timelineEvents: normalizeSubagentTimelineEvents(subagent.timelineEvents, id),
            } as StructuredSubagent;
          })
          .filter(Boolean) as StructuredSubagent[]
      }
      : undefined;

  if (
    !messageText &&
    !hasNormalizedPlan &&
    !normalizedWalkthrough &&
    interactiveEvents.length === 0 &&
    subagents.length === 0 &&
    !subagentsDelta
  ) {
    return undefined;
  }

  const normalizedStructured = {
    responseType,
    message: messageText,
    plan: hasNormalizedPlan ? normalizedPlan : undefined,
    walkthrough: normalizedWalkthrough,
    interactiveEvents: interactiveEvents.length > 0 ? interactiveEvents : undefined,
    subagents: subagents.length > 0 ? subagents : undefined,
    subagentsDelta
  } satisfies StructuredOutput;
  warnOnStructuredFieldDrop(rec, normalizedStructured as UnknownRecord, {
    stage: "normalized",
  });
  return finalizeStructuredOutput(normalizedStructured);
}

function salvageStructuredOutput(value: unknown): StructuredOutput | undefined {
  const rec = asRecord(value);
  if (!rec) {
    return undefined;
  }

  const rawResponseType = firstNonEmptyString(
    asString(rec.responseType),
    asString(rec.type),
    asString(rec.kind),
  );
  const responseType =
    rawResponseType?.toLowerCase() === "interactive"
      ? "question"
      : rawResponseType?.toLowerCase();

  // OpenCode's StructuredOutput tool emits the message body as `text` while
  // the normalized contract uses `message`. If validation rejects the raw
  // provider shape, salvage must preserve that body instead of returning a
  // truthy structured object with no renderable response text.
  const message =
    asString(rec.message).trim() ||
    asString(rec.text).trim() ||
    undefined;
  const planRec = asRecord(rec.plan);
  const plan = planRec
    ? {
        file: asString(planRec.file) || undefined,
        files: Array.isArray(planRec.files) ? planRec.files : undefined,
        content: asString(planRec.content) || undefined,
        title: asString(planRec.title) || undefined,
        intro: asString(planRec.intro) || undefined,
        summary: asString(planRec.summary) || undefined,
        fileCount:
          typeof planRec.fileCount === "number" && Number.isFinite(planRec.fileCount)
            ? planRec.fileCount
            : undefined,
      }
    : undefined;
  const hasPlan =
    !!plan &&
    !!(
      asString(plan.file).trim() ||
      asString(plan.content).trim() ||
      (Array.isArray(plan.files) && plan.files.length > 0)
    );
  const walkthrough = isWalkthroughNarrativeDistinct(rec)
    ? normalizeWalkthrough(asRecord(rec.walkthrough))
    : undefined;

  const normalizedResponseType =
    responseType || (hasPlan ? "implementation_plan" : undefined);

  const rawInteractiveEvents = Array.isArray(rec.interactiveEvents)
    ? rec.interactiveEvents
    : undefined;
  const effectiveResponseType =
    normalizedResponseType || undefined;

  if (
    !effectiveResponseType &&
    !message &&
    !hasPlan &&
    !walkthrough &&
    !rawInteractiveEvents
  ) {
    return undefined;
  }

  return finalizeStructuredOutput({
    responseType: effectiveResponseType,
    message,
    plan: hasPlan ? plan : undefined,
    walkthrough,
    interactiveEvents: rawInteractiveEvents as StructuredOutput["interactiveEvents"] | undefined,
  });
}

function normalizeStructuredOutputWithFallback(value: unknown): StructuredOutput | undefined {
  return normalizeStructuredOutput(value) ?? salvageStructuredOutput(value);
}

function collectRawStructuredOutputCandidates(rec: UnknownRecord): unknown[] {
  const infoRec = asRecord(rec.info);
  return [
    rec.structuredOutput,
    rec.structured_output,
    rec.structured,
    infoRec?.structuredOutput,
    infoRec?.structured_output,
    infoRec?.structured,
  ].filter((candidate): candidate is unknown => typeof candidate !== "undefined" && candidate !== null);
}

function extractRawPlanFromStructuredCandidate(candidate: unknown): Message["plan"] | undefined {
  const rec = asRecord(candidate);
  if (!rec) {
    return undefined;
  }
  const planRec = asRecord(rec.plan);
  if (!planRec) {
    return undefined;
  }
  return {
    ...(planRec as Record<string, unknown>),
  } as Message["plan"];
}

function extractRawPlanFromMessageRecord(rec: UnknownRecord): Message["plan"] | undefined {
  for (const candidate of collectRawStructuredOutputCandidates(rec)) {
    const plan = extractRawPlanFromStructuredCandidate(candidate);
    if (plan) {
      return plan;
    }
  }
  return undefined;
}

function hasTruncatedContentMarker(value: unknown): boolean {
  if (typeof value === "string") {
    return /\.\.\.<truncated\s+\d+\s+chars>/i.test(value);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasTruncatedContentMarker(entry));
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      hasTruncatedContentMarker(entry),
    );
  }
  return false;
}

function structuredOutputFromStructuredOutputToolPart(part: unknown): StructuredOutput | undefined {
  const partRec = asRecord(part);
  if (!partRec) {
    return undefined;
  }

  const toolName = asString(partRec.tool).toLowerCase();
  if (toolName !== "structuredoutput" && toolName !== "structured_output") {
    return undefined;
  }

  const stateRec = asRecord(partRec.state);
  const inputRec =
    asRecord(stateRec?.input) ||
    asRecord(partRec.input) ||
    asRecord(partRec.arguments);
  if (!inputRec) {
    return undefined;
  }

  const questionCandidate =
    asRecord(inputRec.question) ||
    asRecord(asRecord(inputRec.questions)?.[0]) ||
    asRecord(inputRec.prompt);
  const responseType = firstNonEmptyString(
    inputRec.type,
    inputRec.responseType,
    partRec.responseType,
    stateRec?.responseType,
  )?.toLowerCase();
  const messageText = firstNonEmptyString(
    inputRec.text,
    inputRec.message,
    inputRec.content,
    stateRec?.message,
    stateRec?.content,
    stateRec?.text,
  );
  const planCandidate =
    asRecord(inputRec.plan) ||
    asRecord(stateRec?.plan) ||
    asRecord(partRec.plan);

  const candidate: Record<string, unknown> = {
    ...inputRec,
    ...(questionCandidate ? { question: questionCandidate } : {}),
    ...(planCandidate ? { plan: planCandidate } : {}),
  };
  if (responseType) {
    candidate.type = responseType;
    candidate.responseType = responseType;
  }
  if (messageText) {
    candidate.text = messageText;
    candidate.message = messageText;
  }

  const normalized = normalizeStructuredOutputWithFallback(candidate);
  if (normalized) {
    return normalized;
  }

  if (!responseType && !messageText && !planCandidate && !questionCandidate) {
    return undefined;
  }

  return candidate as StructuredOutput;
}

function fallbackStructuredOutputCandidateFromCentralizedEvent(
  payload: UnknownRecord,
  properties: UnknownRecord | null,
  infoRecord: UnknownRecord | null,
): StructuredOutput | undefined {
  const responseType =
    asString(payload.type) ||
    asString(payload.responseType) ||
    asString(properties?.responseType) ||
    asString(properties?.type) ||
    asString(infoRecord?.responseType) ||
    asString(infoRecord?.type);
  const message =
    asString(payload.text) ||
    asString(payload.message) ||
    asString(properties?.message) ||
    asString(properties?.text) ||
    asString(infoRecord?.message) ||
    asString(infoRecord?.text);
  const plan =
    asRecord(payload.plan) ||
    asRecord(properties?.plan) ||
    asRecord(infoRecord?.plan) ||
    undefined;

  if (!responseType && !message && !plan) {
    return undefined;
  }

  return {
    type: responseType,
    responseType,
    text: message,
    message,
    plan,
  };
}

function structuredOutputFromCentralizedEventPayload(
  payload: unknown,
  options?: { includeFallbackCandidate?: boolean },
): StructuredOutput | undefined {
  const event = normalizeCentralizedEventPayload(payload) ?? asRecord(payload);
  if (!event) {
    return undefined;
  }

  const properties = asRecord(event.properties);
  const infoRecord = getCentralizedEventInfo(event);
  const eventPart = getCentralizedEventPart(event);
  const structuredOutput =
    normalizeStructuredOutputWithFallback(event.structured) ??
    normalizeStructuredOutputWithFallback(event.structuredOutput) ??
    normalizeStructuredOutputWithFallback((event as UnknownRecord).structured_output) ??
    normalizeStructuredOutputWithFallback(properties?.structured) ??
    normalizeStructuredOutputWithFallback(properties?.structuredOutput) ??
    normalizeStructuredOutputWithFallback((properties as UnknownRecord | null)?.structured_output) ??
    normalizeStructuredOutputWithFallback(infoRecord?.structured) ??
    normalizeStructuredOutputWithFallback(infoRecord?.structuredOutput) ??
    normalizeStructuredOutputWithFallback((infoRecord as UnknownRecord | null)?.structured_output) ??
    structuredOutputFromStructuredOutputToolPart(eventPart);

  if (structuredOutput) {
    return structuredOutput;
  }

  if (options?.includeFallbackCandidate === false) {
    return undefined;
  }

  return fallbackStructuredOutputCandidateFromCentralizedEvent(event, properties, infoRecord);
}

export function structuredOutputFromRawSdkEventPayloads(
  rawSdkEventPayloads?: unknown[],
): StructuredOutput | undefined {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return undefined;
  }

  const normalizedPayloads = normalizeCentralizedEventPayloads(rawSdkEventPayloads);

  for (let index = normalizedPayloads.length - 1; index >= 0; index -= 1) {
    const structured = structuredOutputFromCentralizedEventPayload(
      normalizedPayloads[index],
      { includeFallbackCandidate: false },
    );
    if (structured) {
      return structured;
    }
  }

  return undefined;
}

/**
 * Checks if a centralized raw event payload represents an AI response chunk.
 * Supported shapes:
 * - `message.part.updated` with `properties.part.type === "text"`
 * - `sync` with `syncEvent.data.part.type === "text"`
 */
export function isAiResponseEvent(payload: unknown): boolean {
  const part = getCentralizedEventPart(payload);
  return (asString(part?.type) || asString(part?.partType)) === "text";
}

function resolveStructuredOutputFromMessageRecord(rec: UnknownRecord): StructuredOutput | undefined {
  const infoRec = asRecord(rec.info);
  const localCandidates: unknown[] = [
    (rec as UnknownRecord).structured,
    (infoRec as UnknownRecord | null)?.structured,
    rec.structuredOutput,
    (rec as UnknownRecord).structured_output,
    infoRec?.structuredOutput,
    (infoRec as UnknownRecord | null)?.structured_output,
  ];

  for (const candidate of localCandidates) {
    const normalized = normalizeStructuredOutputWithFallback(candidate);
    if (normalized) {
      return normalized;
    }
  }
  const rawSdkStructuredOutput = structuredOutputFromRawSdkEventPayloads(
    Array.isArray(rec.rawSdkEventPayloads) ? rec.rawSdkEventPayloads : undefined,
  );
  if (rawSdkStructuredOutput) {
    return rawSdkStructuredOutput;
  }
  return undefined;
}

// Normalize incoming todo-like records into a canonical Todo shape used by the
// reducer ingestion path. Returns null for malformed entries so callers can
// skip without throwing.
function normalizeTodoRecord(raw: unknown): TodoItem | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const id = asString(rec.id).trim();
  const text = firstNonEmptyString(rec.text, rec.content, rec.description) ?? "";
  const statusRaw = asString(rec.status).trim().toLowerCase();
  const sessionId = firstNonEmptyString(rec.sessionId, rec.sessionID) ?? "";
  const priorityRaw = asString(rec.priority).trim().toLowerCase();
  const priority =
    priorityRaw === "high" || priorityRaw === "medium" || priorityRaw === "low"
      ? priorityRaw
      : undefined;
  const source =
    asString(rec.source).trim().toLowerCase() === "sdk" ? "sdk" : undefined;

  if (!id || !text) return null;

  const allowedStatuses = new Set([
    'pending',
    'in_progress',
    'completed',
    'cancelled',
    'failed',
  ]);
  if (!allowedStatuses.has(statusRaw)) return null;

  return {
    id,
    text,
    status: statusRaw as TodoItem['status'],
    sessionId,
    parentMessageId:
      firstNonEmptyString(rec.parentMessageId, rec.parent_message_id, rec.messageId) ||
      undefined,
    description: asOptionalString(rec.description),
    ...(priority ? { priority } : {}),
    ...(source ? { source } : {}),
  };
}

function normalizeTodoList(rawItems: unknown[], expectedSessionId?: string): TodoItem[] {
  return rawItems
    .map((item) => {
      const normalized = normalizeTodoRecord(item);
      if (!normalized) {
        return null;
      }
      if (
        expectedSessionId &&
        normalized.sessionId &&
        normalized.sessionId !== expectedSessionId
      ) {
        return null;
      }
      return {
        ...normalized,
        sessionId: normalized.sessionId || expectedSessionId || "",
        parentMessageId: normalized.parentMessageId,
      };
    })
    .filter((item): item is TodoItem => !!item);
}

// Given a normalized todo record, decide whether to ADD_TODO_ITEM or
// UPDATE_TODO_ITEM so both stream-derived structured payloads and explicit
// todoUpdate postMessage events follow one ingestion path and produce the
// same reducer state. Malformed items are ignored by callers before calling
// this helper.
function ingestNormalizedTodo(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  item: TodoItem,
): void {
  const existingIds = new Set((getState().todoItems || []).map((t) => t.id));
  if (existingIds.has(item.id)) {
    const patch: Partial<TodoItem> = {
      text: item.text,
      status: item.status,
      parentMessageId: item.parentMessageId,
      description: item.description,
      priority: item.priority,
      source: item.source,
    };
    if (item.sessionId) patch.sessionId = item.sessionId;
    dispatch({ type: 'UPDATE_TODO_ITEM', payload: { id: item.id, patch } });
  } else {
    dispatch({ type: 'ADD_TODO_ITEM', payload: item });
  }
}

function toInteractiveEvents(structured?: StructuredOutput): InteractiveEvent[] {
  // Structured output crosses the extension/webview boundary at runtime.  Do
  // not assume a typed array is dense: a malformed or partially streamed
  // entry must not take down the whole chat while we inspect its discriminator.
  const events = Array.isArray(structured?.interactiveEvents)
    ? structured.interactiveEvents
    : [];
  const structuredRec = asRecord(structured as UnknownRecord | undefined);
  const contextMessage: string | undefined =
    asOptionalString(structuredRec?.displayPrompt) ||
    asOptionalString(structuredRec?.assistantPrompt) ||
    undefined;

  const mapped = events
    .map((event, index) => {
      if (!event || typeof event !== "object") {
        return undefined;
      }
      const id = event.id || `interactive-${Date.now()}-${index}`;
      if (event.type === 'confirm') {
        if (!event.question) {
          return undefined;
        }
        return {
          type: 'confirm',
          id,
          title: event.title,
          question: event.question,
          confirmLabel: event.confirmLabel,
          cancelLabel: event.cancelLabel,
          contextMessage,
        } as InteractiveEvent;
      }
      if (event.type === 'quick_actions') {
        const actions = Array.isArray(event.actions) ? event.actions : [];
        if (actions.length === 0) {
          return undefined;
        }
        return {
          type: 'quick_actions',
          id,
          title: event.title,
          actions,
          contextMessage,
        } as InteractiveEvent;
      }
      if (event.type === 'question') {
        const options = Array.isArray(event.options) ? event.options : [];
        const allowCustomInput = event.allowCustomInput === true;
        if (!event.question || (options.length < 2 && !allowCustomInput)) {
          return undefined;
        }
        return {
          type: 'question',
          id,
          title: event.title,
          question: event.question,
          options,
          multiSelect: event.multiSelect,
          allowCustomInput,
          contextMessage,
          requestID: event.requestID,
          questionIndex: event.questionIndex,
        } as InteractiveEvent;
      }
      if (event.type === 'message') {
        if (!event.message) {
          return undefined;
        }
        return {
          type: 'message',
          id,
          title: event.title,
          message: event.message,
          dismissLabel: event.dismissLabel,
          contextMessage,
        } as InteractiveEvent;
      }
      return undefined;
    })
    .filter((event): event is InteractiveEvent => !!event);

  return dedupeInteractiveEvents(mapped);
}

function interactiveChoiceKey(choice: InteractiveChoice): string {
  const label = normalizeComparableText(asString(choice.label));
  const value = normalizeComparableText(asString(choice.value) || asString(choice.label));
  const description = normalizeComparableText(asString(choice.description));
  return `${label}::${value}::${description}`;
}

function interactiveEventKey(event: InteractiveEvent): string {
  if (event.type === "question") {
    const options = Array.isArray(event.options)
      ? event.options.map(interactiveChoiceKey).join("|")
      : "";
    return [
      "question",
      normalizeComparableText(asString(event.title)),
      normalizeComparableText(asString(event.question)),
      options,
      event.multiSelect ? "1" : "0",
      event.allowCustomInput ? "1" : "0",
      normalizeComparableText(asString(event.contextMessage)),
    ].join("::");
  }
  if (event.type === "confirm") {
    return [
      "confirm",
      normalizeComparableText(asString(event.title)),
      normalizeComparableText(asString(event.question)),
      normalizeComparableText(asString(event.confirmLabel)),
      normalizeComparableText(asString(event.cancelLabel)),
      normalizeComparableText(asString(event.contextMessage)),
    ].join("::");
  }
  if (event.type === "quick_actions") {
    if (event.permissionID) {
      return ["permission", normalizeComparableText(asString(event.permissionID))].join("::");
    }
    const actions = Array.isArray(event.actions)
      ? event.actions.map(interactiveChoiceKey).join("|")
      : "";
    return [
      "quick_actions",
      normalizeComparableText(asString(event.title)),
      actions,
      normalizeComparableText(asString(event.contextMessage)),
    ].join("::");
  }
  return [
    "message",
    normalizeComparableText(asString(event.title)),
    normalizeComparableText(asString(event.message)),
    normalizeComparableText(asString(event.dismissLabel)),
    normalizeComparableText(asString(event.contextMessage)),
  ].join("::");
}

function dedupeInteractiveEvents(events: InteractiveEvent[]): InteractiveEvent[] {
  const seen = new Set<string>();
  const out: InteractiveEvent[] = [];
  for (const event of events) {
    const key = interactiveEventKey(event);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(event);
  }
  return out;
}

function hasBlockingInteractiveEvents(events: InteractiveEvent[]): boolean {
  return events.some(
    (event) =>
      event.type === "question" ||
      event.type === "confirm" ||
      event.type === "quick_actions",
  );
}

function isLikelyInteractiveAwaitTimeout(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized || !normalized.includes("timeout")) {
    return false;
  }

  return (
    normalized.includes("headers timeout") ||
    normalized.includes("header timeout") ||
    normalized.includes("und_err_headers_timeout") ||
    normalized.includes("request timed out") ||
    normalized.includes("response timeout") ||
    normalized.includes("body timeout")
  );
}

function isLikelyInteractiveHandoffAbort(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("messageabortederror") ||
    normalized === "aborted" ||
    normalized.endsWith(": aborted") ||
    normalized.includes("aborterror")
  );
}

function isLowSignalTimeoutFragment(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized.length <= 2) {
    return true;
  }

  const compact = normalized
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!compact) {
    return true;
  }

  if (
    compact === "me" ||
    compact === "let" ||
    compact === "let me" ||
    compact === "i" ||
    compact === "ill"
  ) {
    return true;
  }

  return false;
}

function normalizeInteractiveChoices(raw: unknown): InteractiveChoice[] {
  let candidate = raw;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(candidate)) {
    return [];
  }
  return candidate
    .map((item) => {
      const rec = asRecord(item);
      if (!rec) {
        return null;
      }
      const label = asString(rec.label) || asString(rec.value);
      if (!label) {
        return null;
      }
      return {
        id: asString(rec.id) || undefined,
        label,
        value: normalizeChoiceAnswerValue(asString(rec.value), label),
        description: asString(rec.description) || asString(rec.detail) || undefined,
        recommended: rec.recommended === true,
      } as InteractiveChoice;
    })
    .filter((item): item is InteractiveChoice => !!item);
}

function extractInteractivePromptText(record: UnknownRecord): string | undefined {
  const nestedQuestion = asRecord(record.question);
  return (
    asString(nestedQuestion?.displayPrompt) ||
    asString(nestedQuestion?.question) ||
    asString(nestedQuestion?.message) ||
    asString(nestedQuestion?.content) ||
    asString(record.displayPrompt) ||
    asString(record.question) ||
    asString(record.prompt) ||
    asString(record.message) ||
    asString(record.content) ||
    asString(record.text)
  ) || undefined;
}

function normalizeToolInteractiveEvent(
  record: UnknownRecord,
  fallbackId: string,
  fallbackTitle?: string,
): InteractiveEvent | undefined {
  const id = asString(record.id) || fallbackId;
  const typeRaw = asString(record.type).toLowerCase();
  const title = asString(record.title) || asString(record.header) || fallbackTitle || undefined;

  if (typeRaw === "message") {
    const message =
      asString(record.message) ||
      asString(record.content) ||
      asString(record.text);
    if (!message) {
      return undefined;
    }
    return {
      type: "message",
      id,
      title,
      message,
      dismissLabel: asString(record.dismissLabel) || undefined,
    };
  }

  if (typeRaw === "quick_actions" || typeRaw === "quick-actions") {
    const actions = normalizeInteractiveChoices(record.actions ?? record.options);
    if (actions.length === 0) {
      return undefined;
    }
    const prompt = extractInteractivePromptText(record);
    return {
      type: "quick_actions",
      id,
      title: title || "Quick actions",
      actions,
      contextMessage: prompt && prompt !== title ? prompt : undefined,
    };
  }

  const questionText =
    asString(record.question) ||
    asString(record.prompt) ||
    asString(record.message) ||
    asString(record.text) ||
    title;

  if (typeRaw === "confirm") {
    if (!questionText) {
      return undefined;
    }
    return {
      type: "confirm",
      id,
      title,
      question: questionText,
      confirmLabel: asString(record.confirmLabel) || undefined,
      cancelLabel: asString(record.cancelLabel) || undefined,
    };
  }

  const options = normalizeInteractiveChoices(
    record.options ?? record.choices ?? record.answers ?? record.actions,
  );
  const allowCustomInput =
    asBoolean(record.allowCustomInput, false) ||
    asBoolean(record.allow_custom_input, false) ||
    options.length === 0;

  if (!questionText) {
    return undefined;
  }
  if (options.length < 2 && !allowCustomInput) {
    return undefined;
  }

  return {
    type: "question",
    id,
    title,
    question: questionText,
    options,
    multiSelect: asBoolean(record.multiSelect, false),
    allowCustomInput,
  };
}

function interactiveEventsFromToolQuestionPart(part: UnknownRecord): InteractiveEvent[] {
  const toolName = asString(part.tool).toLowerCase();
  if (
    !toolName ||
    (toolName !== "question" &&
      !toolName.includes("request_user_input") &&
      !toolName.includes("request-user-input"))
  ) {
    return [];
  }

  const state = asRecord(part.state);
  const input =
    asRecord(state?.input) ||
    asRecord(part.input) ||
    asRecord(part.arguments) ||
    null;
  if (!input) {
    return [];
  }

  const rootTitle =
    asString(input.title) || asString(input.header) || asString(input.label) || undefined;
  const baseId =
    asString(part.callID) || asString(part.callId) || asString(part.id) || `interactive-${Date.now()}`;

  const listRaw =
    Array.isArray(input.questions) ? input.questions
      : Array.isArray(input.items) ? input.items
        : Array.isArray(input.prompts) ? input.prompts
          : Array.isArray(input.events) ? input.events
            : null;

  const records: UnknownRecord[] = [];
  if (Array.isArray(listRaw) && listRaw.length > 0) {
    listRaw.forEach((entry) => {
      const rec = asRecord(entry);
      if (rec) {
        records.push(rec);
      }
    });
  } else {
    const nestedQuestion = asRecord(input.question);
    records.push(nestedQuestion || input);
  }

  return records
    .map((record, index) =>
      normalizeToolInteractiveEvent(record, `${baseId}-${index}`, rootTitle),
    )
    .filter((event): event is InteractiveEvent => !!event);
}

function interactiveEventsFromQuestionAskedPayload(payload: UnknownRecord): InteractiveEvent[] {
  const request =
    asRecord(payload.properties) ||
    asRecord((payload as UnknownRecord).data) ||
    payload;
  const questions = Array.isArray(request.questions)
    ? request.questions
    : Array.isArray((payload as UnknownRecord).questions)
      ? (payload as UnknownRecord).questions
      : [];
  if (questions.length === 0) {
    return [];
  }

  const requestId =
    asString(request.id) ||
    asString((request as UnknownRecord).requestID) ||
    asString((request as UnknownRecord).requestId) ||
    `question-${Date.now()}`;
  return questions
    .map((entry, index) => {
      const question = asRecord(entry);
      if (!question) {
        return undefined;
      }
      const questionText =
        asString(question.question) ||
        asString(question.prompt) ||
        asString(question.message) ||
        asString(question.text);
      if (!questionText) {
        return undefined;
      }
      const options = normalizeInteractiveChoices(
        question.options ?? question.choices ?? question.answers,
      );
      const allowCustomInput =
        asBoolean(question.allowCustomInput, false) ||
        asBoolean(question.allow_custom_input, false) ||
        asBoolean(question.custom, false);
      if (options.length < 2 && !allowCustomInput) {
        return undefined;
      }
      return {
        type: "question",
        id: `${requestId}-${index}`,
        title: asString(question.header) || asString(question.title) || undefined,
        requestID: requestId,
        questionIndex: index,
        question: questionText,
        options,
        multiSelect:
          asBoolean(question.multiSelect, false) ||
          asBoolean(question.multiple, false),
        allowCustomInput,
      } as InteractiveEvent;
    })
    .filter((event): event is InteractiveEvent => !!event);
}

/**
 * Synthesizes a human-readable context message from tool-triggered interactive events.
 * Used when the AI calls the Question tool (no text in streaming.content) so the chat
 * bubble shows the question context alongside the interactive popover.
 */
function synthesizeQuestionContextMessage(events: InteractiveEvent[]): string {
  const questionEvents = events.filter(
    (e) => e.type === 'question' || e.type === 'confirm',
  ) as Array<{ type: string; question: string; title?: string }>;

  if (questionEvents.length === 0) {
    return '';
  }

  if (questionEvents.length === 1) {
    const ev = questionEvents[0];
    return ev.title ? `**${ev.title}**\n\n${ev.question}` : ev.question;
  }

  const lines = questionEvents.map((ev, i) => `${i + 1}. ${ev.question}`);
  return lines.join('\n');
}

function matchesStreamingReasoningLeak(
  content: string,
  streamingState?: StreamingState | null,
): boolean {
  const contentNorm = normalizeComparableText(content);
  if (!contentNorm || contentNorm.length < 40) {
    return false;
  }

  const contentTokens = comparableTokens(contentNorm);
  if (contentTokens.length < 5) {
    return false;
  }

  if (hasDuplicateTokenPattern(contentTokens)) {
    return true;
  }

  const reasoningCandidates = [
    asString(streamingState?.reasoning),
    ...(Array.isArray(streamingState?.reasoningEvents)
      ? streamingState!.reasoningEvents.map((event) =>
          asString((event as UnknownRecord).content) || asString(event.text),
        )
      : []),
  ]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  for (const reasoning of reasoningCandidates) {
    const reasoningNorm = normalizeComparableText(reasoning);
    if (!reasoningNorm) {
      continue;
    }
    if (
      contentNorm === reasoningNorm ||
      contentNorm.includes(reasoningNorm) ||
      reasoningNorm.includes(contentNorm)
    ) {
      return true;
    }

    const reasoningTokens = comparableTokens(reasoningNorm);
    if (reasoningTokens.length < 5) {
      continue;
    }
    const overlap = contentTokens.filter((token) =>
      reasoningTokens.includes(token),
    ).length;
    if (overlap / contentTokens.length > 0.6) {
      return true;
    }
  }

  return false;
}

function shouldOverrideStreamingContentWithInteractivePrompt(
  content: string,
  latestUserText = "",
  streamingState?: StreamingState | null,
): boolean {
  const trimmed = content.trim();
  const normalized = normalizeComparableText(content).toLowerCase();
  if (!normalized) {
    return true;
  }

  const normalizedUserText = normalizeComparableText(latestUserText).toLowerCase();
  if (normalizedUserText && normalized === normalizedUserText) {
    return true;
  }

  if (containsThoughtTagReasoning(trimmed)) {
    return true;
  }

  if (matchesStreamingReasoningLeak(trimmed, streamingState)) {
    return true;
  }

  // Some providers can leak tiny tool-intent fragments before the question
  // event is emitted (for example: "wants"). Treat these as placeholders.
  const likelyFragment =
    /^(?:wants?|wants?\s+to|ask(?:s|ing)?|question(?:s|ing)?)$/i.test(trimmed) &&
    trimmed.length <= 24;
  if (likelyFragment) {
    return true;
  }

  // FIX: If there's substantial content already (more than 150 chars),
  // preserve it instead of replacing with question context.
  // This prevents AI responses from disappearing when questions are asked.
  const CONTENT_THRESHOLD = 150;
  if (trimmed.length > CONTENT_THRESHOLD) {
    return false;
  }

  return (
    normalized === 'running question' ||
    normalized === 'question' ||
    normalized === 'question for you' ||
    normalized === 'quick input' ||
    normalized === 'awaiting your answer' ||
    normalized === 'awaiting your response' ||
    normalized === 'waiting for your answer' ||
    normalized === 'waiting for your response'
  );
}

function maybeInjectStreamingInteractiveContext(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  events: InteractiveEvent[],
): string | null {
  if (!Array.isArray(events) || events.length === 0) {
    return null;
  }

  const streamingState = getState().streaming;
  const currentContent = asString(streamingState?.content);
  const hasRenderableContent = !!streamingState?.hasRenderableContent;
  const latestUserText = latestUserMessageText(getState());
  if (
    hasRenderableContent &&
    !shouldOverrideStreamingContentWithInteractivePrompt(
      currentContent,
      latestUserText,
      streamingState,
    )
  ) {
    return null;
  }

  const synthesized = synthesizeQuestionContextMessage(events);
  if (!synthesized) {
    return null;
  }

  dispatch({
    type: 'UPDATE_STREAMING_CONTENT',
    payload: { content: synthesized, append: false, renderable: true },
  });

  return synthesized;
}

function inferredStepTitle(part: UnknownRecord): string {
  const title = asString(part.title).trim();
  if (title) {
    return title;
  }

  const description = asString(part.description).trim();
  if (description && !isOpaqueIdLike(description)) {
    return description;
  }

  const snapshot = asString(part.snapshot).trim();
  if (
    snapshot &&
    snapshot.length < 80 &&
    !/^https?:\/\//i.test(snapshot) &&
    !isOpaqueIdLike(snapshot)
  ) {
    return snapshot;
  }

  const meta = asString(part.meta).trim();
  if (meta && !isOpaqueIdLike(meta)) {
    return meta;
  }

  const partType = normalizePartType(part.type);
  if (partType === "subtask") {
    return "Starting subtask";
  }
  if (partType === "agent") {
    return "Assigning agent";
  }
  if (partType === "step-start") {
    return "Starting step";
  }
  if (partType === "step-finish") {
    return "Finishing step";
  }
  if (partType === "step-stop") {
    return "Stopping step";
  }
  if (partType === "patch") {
    return "Applying patch";
  }
  if (partType === "tool") {
    return "Running tool";
  }
  if (partType) {
    return `Processing ${partType}`;
  }

  return "Working...";
}

function shouldBootstrapStreamingFromPart(part: UnknownRecord | null): boolean {
  if (!part) {
    return false;
  }

  const partType = normalizePartType(part.type);
  // Do not let a late completed edit/tool event create a fresh "AI is typing"
  // stream after the final assistant message has already landed.
  if (isTerminalProgressPart(part, partType)) {
    return false;
  }
  // Include text parts to bootstrap streaming for regular content chunks
  if (
    partType === "reasoning" ||
    partType === "step-start" ||
    partType === "tool" ||
    partType === "patch" ||
    partType === "text" ||
    partType === "subtask" ||
    partType === "agent"
  ) {
    return true;
  }

  // Raw message.part.delta events can arrive without a typed `part`; their
  // properties object is passed here as the fallback part. Let a textual delta
  // establish the live snapshot so its first token can render immediately.
  const deltaField = asString(part.field).trim().toLowerCase();
  if (
    typeof part.delta === "string" &&
    (deltaField === "text" ||
      deltaField === "content" ||
      deltaField === "message" ||
      deltaField === "output_text")
  ) {
    return true;
  }

  const reasoningLike =
    asString(part.reasoning) ||
    asString(part.thought) ||
    asString(part.thinking);
  return Boolean(reasoningLike);
}

type AssistantStreamBootstrapContext = {
  eventType: string;
  eventRole: string;
  messageId: string | null;
  eventAgent?: string;
  eventModel?: Record<string, unknown> | null;
  eventModelID?: string;
  eventProviderID?: string;
  isExplicitStart: boolean;
  isAssistantUpdateStart: boolean;
  canBootstrapFromPart: boolean;
  hasSystemPatternEvent: boolean;
};

function buildStreamingMetadataFromCentralizedPayload(
  context: AssistantStreamBootstrapContext,
  state: AppState,
): Pick<StreamingState, "agent" | "model" | "modelID" | "providerID" | "variant"> {
  return {
    agent: context.eventAgent || state.selectedAgent || undefined,
    model:
      context.eventModel && typeof context.eventModel === "object"
        ? {
            modelID:
              asString(context.eventModel.modelID) ||
              state.selectedModel?.modelID ||
              "",
            providerID:
              asString(context.eventModel.providerID) ||
              state.selectedModel?.providerID ||
              "",
            name:
              asString((context.eventModel as Record<string, unknown>).name) ||
              undefined,
          }
        : undefined,
    modelID: context.eventModelID || state.selectedModel?.modelID,
    providerID: context.eventProviderID || state.selectedModel?.providerID,
    variant: state.thinkingLevel,
  };
}

function buildStreamingBootstrapState(
  context: AssistantStreamBootstrapContext,
  state: AppState,
): StreamingState {
  return {
    messageId: context.messageId,
    content: "",
    hasRenderableContent: false,
    reasoning: "",
    reasoningEvents: [],
    steps: [],
    progressEvents: [],
    edits: [],
    isActive: true,
    ...buildStreamingMetadataFromCentralizedPayload(context, state),
  };
}

function ensureStreamingBootstrapFromCentralizedPayload(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  context: AssistantStreamBootstrapContext,
): boolean {
  const state = getState();
  const current = state.streaming;
  const shouldStart =
    !current &&
    !context.hasSystemPatternEvent &&
    (context.isExplicitStart ||
      context.isAssistantUpdateStart ||
      context.canBootstrapFromPart ||
      state.isProcessing);

  if (!shouldStart) {
    return false;
  }

  dispatch({
    type: "SET_STREAMING",
    payload: buildStreamingBootstrapState(context, state),
  });
  dispatch({
    type: "SET_ASSISTANT_TURN_PENDING",
    payload: { pending: true, messageId: context.messageId },
  });
  dispatch({ type: "SET_PROCESSING", payload: true });
  return true;
}

function bindStreamingIdentityFromCentralizedPayload(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  context: AssistantStreamBootstrapContext,
): boolean {
  const state = getState();
  const current = state.streaming;

  // Event-stream rendering can begin from a generic SET_PROCESSING placeholder
  // before the first assistant payload has been parsed. That placeholder has no
  // messageId, which means the UI cannot scope session-level centralized debug
  // payloads back to the active assistant turn. Once a centralized SDK payload
  // gives us the real messageId, we adopt it here so the same centralized data
  // can drive the live card and the rehydrated card.
  if (!current || current.messageId || !context.messageId || context.hasSystemPatternEvent) {
    return false;
  }

  dispatch({
    type: "SET_STREAMING",
    payload: {
      ...current,
      messageId: context.messageId,
      ...buildStreamingMetadataFromCentralizedPayload(context, state),
    },
  });
  dispatch({
    type: "SET_ASSISTANT_TURN_PENDING",
    payload: { pending: true, messageId: context.messageId },
  });
  return true;
}

function isReasoningPart(part: UnknownRecord): boolean {
  const type = normalizePartType(part.type);
  return (
    type === 'reasoning' ||
    typeof part.reasoning !== 'undefined' ||
    typeof part.thought !== 'undefined' ||
    typeof part.thinking !== 'undefined'
  );
}

function isActivityLikePart(part: UnknownRecord): boolean {
  const activityKeys = [
    "title",
    "label",
    "summary",
    "status",
    "tool",
    "callID",
    "callId",
    "activityDetail",
    "diffStats",
    "filePath",
    "file",
    "path",
    "priority",
    "state",
    "input",
    "result",
  ];

  return activityKeys.some((key) => typeof part[key] !== "undefined");
}

function isRenderableAssistantTextPart(part: UnknownRecord): boolean {
  if (isReasoningPart(part)) {
    return false;
  }
  const type = normalizePartType(part.type);
  if (type) {
    return type === "text" || type === "message" || type === "output_text";
  }
  const hasTextLikeField =
    typeof part.text === "string" ||
    typeof part.content === "string" ||
    typeof part.delta === "string" ||
    typeof part.message === "string";
  if (!hasTextLikeField) {
    return false;
  }
  return !isActivityLikePart(part);
}

function isRenderableStreamingPartType(partType: string): boolean {
  return (
    partType === "text" ||
    partType === "message" ||
    partType === "output_text"
  );
}

function upsertStreamingStep(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  step: StreamingStep,
): void {
  const title = step.title.trim();
  if (!title) {
    return;
  }

  // Ignore streaming steps only when there is neither an active request nor an
  // active stream snapshot. The first tool/progress event can bootstrap
  // streaming before isProcessing has caught up.
  const state = getState();
  if (!state.isProcessing && !state.streaming?.isActive) {
    return;
  }

  const streaming = state.streaming;
  if (!streaming) {
    dispatch({
      type: "ADD_STREAMING_STEP",
      payload: {
        ...step,
        title,
      },
    });
    return;
  }

  const titleKey = title.toLowerCase();
  const stableIndex = streaming.steps.findIndex(
    (candidate) =>
      (step.id && candidate.id === step.id) ||
      (step.callID && candidate.callID === step.callID),
  );
  const isStepFinish =
    step.partType?.trim().toLowerCase() === "step-finish" ||
    step.status === "done" ||
    step.status === "error";
  // Title is presentation data, not activity identity. In particular,
  // consecutive step-start events frequently use the same generic title
  // ("Working" / "Running..."). Matching those by title makes the new start
  // overwrite the previous start-finish block, which looks like the entire
  // activity timeline was cleared. Without SDK IDs, only a finish may close
  // the latest still-open matching start; a new start must always append.
  const idx = stableIndex >= 0
    ? stableIndex
    : isStepFinish
      ? streaming.steps.findLastIndex(
        (candidate) =>
          candidate.title.trim().toLowerCase() === titleKey &&
          candidate.status !== "done" &&
          candidate.status !== "error",
      )
      : -1;

  if (idx < 0) {
    dispatch({
      type: "ADD_STREAMING_STEP",
      payload: {
        ...step,
        title,
      },
    });
    return;
  }

  const current = streaming.steps[idx];
  let nextStatus = step.status;
  if (
    (current.status === "done" || current.status === "error") &&
    step.status === "pending"
  ) {
    nextStatus = current.status;
  }

  dispatch({
    type: "UPDATE_STREAMING_STEP",
    payload: {
      index: idx,
      patch: {
        messageID: step.messageID || current.messageID,
        title,
        type: step.type || current.type,
        status: nextStatus || current.status,
        meta: step.meta || current.meta,
        filePath: step.filePath || current.filePath,
        diffStats: step.diffStats || current.diffStats,
        activityDetail: step.activityDetail || current.activityDetail,
        duration:
          typeof step.duration === "number" ? step.duration : current.duration,
      },
    },
  });
}

function contentFromParts(parts: unknown[]): string {
  const textSegments: string[] = [];
  let lastNormalizedSegment = "";

  for (const part of parts) {
    const rec = asRecord(part);
    if (!rec || !isRenderableAssistantTextPart(rec)) {
      continue;
    }

    const text =
      asRichString(rec.text) ||
      asRichString(rec.content) ||
      asRichString(rec.delta);
    if (!text) {
      continue;
    }

    const normalizedSegment = normalizeComparableText(text);
    if (normalizedSegment && normalizedSegment === lastNormalizedSegment) {
      continue;
    }

    textSegments.push(text);
    lastNormalizedSegment = normalizedSegment;
  }

  return textSegments.join("").trim();
}

function dedupeAdjacentRenderableTextParts(
  parts: MessagePart[],
): MessagePart[] {
  if (!Array.isArray(parts) || parts.length <= 1) {
    return parts;
  }

  const deduped: MessagePart[] = [];
  let lastNormalizedSegment = "";

  for (const part of parts) {
    const rec = asRecord(part);
    if (!rec || !isRenderableAssistantTextPart(rec)) {
      deduped.push(part);
      lastNormalizedSegment = "";
      continue;
    }

    const text =
      asRichString(rec.text) ||
      asRichString(rec.content) ||
      asRichString(rec.delta);
    if (!text) {
      deduped.push(part);
      lastNormalizedSegment = "";
      continue;
    }

    const normalizedSegment = normalizeComparableText(text);
    if (normalizedSegment && normalizedSegment === lastNormalizedSegment) {
      continue;
    }

    deduped.push(part);
    lastNormalizedSegment = normalizedSegment;
  }

  return deduped;
}

function collectReasoningFingerprintsForHydration(message: Message): Set<string> {
  const fingerprints = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value !== "string") {
      return;
    }
    const normalized = normalizeComparableText(value);
    if (normalized) {
      fingerprints.add(normalized);
    }
  };

  if (Array.isArray(message.reasoningEvents)) {
    for (const event of message.reasoningEvents) {
      const rec = asRecord(event);
      add(rec?.text);
    }
  }

  if (Array.isArray(message.parts)) {
    for (const part of message.parts) {
      const rec = asRecord(part);
      if (!rec) {
        continue;
      }
      add(rec.reasoning);
      add(rec.thought);
      add(rec.thinking);
      add(rec.text);
      add(rec.content);
    }
  }

  const rec = asRecord(message);
  add(rec?.reasoning);
  add(rec?.thinking);
  add(rec?.thoughts);

  return fingerprints;
}

function isReasoningLeakCandidateForHydration(
  value: string,
  message?: Message,
  parts?: unknown[],
): boolean {
  if (!value.trim()) {
    return false;
  }
  const candidateNorm = normalizeComparableText(value);
  if (!candidateNorm) {
    return false;
  }

  const reasoningFingerprints = collectReasoningFingerprintsForHydration(
    message ?? ({ parts } as Message),
  );
  for (const reasoningNorm of reasoningFingerprints) {
    if (!reasoningNorm) {
      continue;
    }
    if (candidateNorm === reasoningNorm) {
      return true;
    }
    if (
      candidateNorm.length < 220 &&
      (candidateNorm.includes(reasoningNorm) ||
        reasoningNorm.includes(candidateNorm))
    ) {
      return true;
    }
  }

  return false;
}

function extractRenderableAssistantTextForHydration(message: Message): string {
  const rec = asRecord(message);
  if (!rec) {
    return "";
  }
  const messageId =
    asString(asRecord(rec.info)?.id) || asString((rec as UnknownRecord).id) || null;
  const role = asString(rec.role) || asString(asRecord(rec.info)?.role) || null;
  const canonicalStructuredMessage = getCanonicalStructuredMessageText(message);
  if (canonicalStructuredMessage) {
    logger.info("[MESSAGE-HANDLER-TRACE] Hydration assistant text selected from structured payload", {
      messageId,
      role,
      source: "structured.message",
      preview: previewForLog(canonicalStructuredMessage),
      partsCount: Array.isArray(rec.parts) ? rec.parts.length : 0,
    });
    return canonicalStructuredMessage;
  }

  if (typeof rec.content === "string" && rec.content.trim()) {
    const content = rec.content.trim();
    const isLeakCandidate = isReasoningLeakCandidateForHydration(content, message, rec.parts);
    logger.info("[MESSAGE-HANDLER-TRACE] Hydration assistant text candidate from top-level content", {
      messageId,
      role,
      source: "content",
      preview: previewForLog(content),
      length: content.length,
      isReasoningLeakCandidate: isLeakCandidate,
      partsCount: Array.isArray(rec.parts) ? rec.parts.length : 0,
    });
    if (!isLeakCandidate) {
      return content;
    }
  }
  if (typeof rec.text === "string" && rec.text.trim()) {
    const text = rec.text.trim();
    const isLeakCandidate = isReasoningLeakCandidateForHydration(text, message, rec.parts);
    logger.info("[MESSAGE-HANDLER-TRACE] Hydration assistant text candidate from top-level text", {
      messageId,
      role,
      source: "text",
      preview: previewForLog(text),
      length: text.length,
      isReasoningLeakCandidate: isLeakCandidate,
      partsCount: Array.isArray(rec.parts) ? rec.parts.length : 0,
    });
    if (!isLeakCandidate) {
      return text;
    }
  }

  const parts = Array.isArray(rec.parts) ? rec.parts : [];
  const partsContent = contentFromParts(parts);
  logger.info("[MESSAGE-HANDLER-TRACE] Hydration assistant text fallback selected from parts", {
    messageId,
    role,
    source: "parts",
    preview: previewForLog(partsContent),
    length: partsContent.length,
    partsCount: parts.length,
  });
  return partsContent;
}

function isCanonicalAssistantDisplayMessage(message: Message): boolean {
  const rec = asRecord(message);
  if (!rec) {
    return false;
  }

  const structured = resolveStructuredOutputFromMessageRecord(rec);
  const responseType = firstNonEmptyString(
    structured?.type,
    structured?.responseType,
    asString(rec.type),
    asString(rec.responseType),
  )?.toLowerCase();

  if (responseType === "question" || responseType === "implementation_plan") {
    return true;
  }

  if (responseType !== "message") {
    return false;
  }

  return !!getCanonicalStructuredMessageText(message);
}

function reasoningFromParts(parts: unknown[]): string {
  return parts
    .map((part) => {
      const rec = asRecord(part);
      if (!rec) {
        return '';
      }

      const reasoning =
        asRichString(rec.reasoning) ||
        asRichString(rec.thought) ||
        asRichString(rec.thinking) ||
        (isReasoningPart(rec)
          ? asRichString(rec.text) || asRichString(rec.content) || asRichString(rec.delta)
          : '');
      return reasoning.trim();
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function summaryText(info: unknown): string {
  const summary = asRecord(asRecord(info)?.summary);
  if (!summary) {
    return '';
  }
  const title = asRichString(summary.title).trim();
  const body = asRichString(summary.body).trim();
  if (title && body) {
    return `${title}\n\n${body}`;
  }
  return title || body;
}

function getCanonicalStructuredMessageText(message: Message | UnknownRecord): string {
  const rec = asRecord(message);
  if (!rec) {
    return "";
  }
  const structured = resolveStructuredOutputFromMessageRecord(rec);
  const responseType = firstNonEmptyString(
    structured?.type,
    structured?.responseType,
    asString(rec.type),
    asString(rec.responseType),
  )?.toLowerCase();
  if (responseType !== "message") {
    return "";
  }
  const structuredMessage = asString(structured?.text ?? structured?.message).trim();
  if (!structuredMessage) {
    return "";
  }
  if (isReasoningLeakCandidateForHydration(structuredMessage, message as Message, rec.parts)) {
    return "";
  }
  return structuredMessage;
}

function latestUserMessageText(state: AppState): string {
  if (!state.messages || state.messages.length === 0) {
    return '';
  }

  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const msg = state.messages[i];
    const role = msg.role ?? msg.info?.role;
    if (role === 'user') {
      return extractMessageText(msg).trim();
    }
  }
  return '';
}

function stripLeadingUserEcho(text: string, state: AppState): string {
  const prompt = latestUserMessageText(state);
  if (!prompt) {
    return text;
  }

  const normalizedText = text.replace(/\r\n/g, '\n');
  const normalizedPrompt = prompt.replace(/\r\n/g, '\n').trim();
  const leadingWs = normalizedText.match(/^\s*/)?.[0] ?? '';
  const trimmed = normalizedText.trimStart();

  if (trimmed === normalizedPrompt) {
    return '';
  }

  if (trimmed.startsWith(normalizedPrompt)) {
    const remainder = trimmed.slice(normalizedPrompt.length);
    // Strip only clear prompt echo prefixes, keep normal model output intact.
    if (/^[\s:,\-.!?]*$/.test(remainder)) {
      return '';
    }
    if (/^\s+/.test(remainder)) {
      return `${leadingWs}${remainder.trimStart()}`;
    }
  }

  return text;
}

function normalizeComparableText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

function comparableTokens(value: string): string[] {
  return normalizeComparableText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function hasDuplicateTokenPattern(tokens: string[]): boolean {
  if (tokens.length < 4) {
    return false;
  }
  let duplicateAdjacentCount = 0;
  for (let i = 1; i < tokens.length; i += 1) {
    if (tokens[i] === tokens[i - 1]) {
      duplicateAdjacentCount += 1;
    }
  }
  return duplicateAdjacentCount >= 2 && duplicateAdjacentCount / tokens.length > 0.2;
}

/**
 * Decide whether the streaming-assembled content should replace the
 * server-provided final content during message normalization.
 *
 * Guards (in order):
 * 1. Reject if streaming content has <thought> tag reasoning.
 * 2. Reject if streaming content has duplicate-token patterns (garbled output
 *    from deltas appending across tool-call boundaries).
 * 3-6. Length/token-overlap heuristics — prefer richer stream snapshots only
 *    when they clearly contain the final content and aren't garbled.
 */
function shouldPreferStreamingContent(
  finalContent: string,
  streamingContent: string,
): boolean {
  if (splitMixedReasoningFromContent(streamingContent)) {
    return false;
  }
  if (containsThoughtTagReasoning(streamingContent)) {
    return false;
  }
  const streamTokens = comparableTokens(streamingContent);
  if (hasDuplicateTokenPattern(streamTokens)) {
    return false;
  }

  const finalNorm = normalizeComparableText(finalContent);
  const streamNorm = normalizeComparableText(streamingContent);
  if (!streamNorm) {
    return false;
  }
  if (!finalNorm) {
    return true;
  }
  if (streamNorm === finalNorm) {
    return false;
  }
  if (finalNorm.includes(streamNorm)) {
    return false;
  }
  // When the stream text clearly contains the final text as a subset, prefer the
  // richer stream snapshot so intermediate details are not dropped on finalize.
  if (streamNorm.includes(finalNorm) && streamNorm.length >= finalNorm.length + 24) {
    return true;
  }
  // Fallback: some providers condense final payloads so they are no longer literal
  // subsets. Keep stream text when final tokens mostly overlap but stream is much richer.
  if (streamNorm.length < finalNorm.length + 64) {
    return false;
  }
  const finalTokens = comparableTokens(finalNorm);
  if (finalTokens.length === 0) {
    return false;
  }
  const streamTokenSet = new Set(comparableTokens(streamNorm));
  let matchedFinalTokens = 0;
  for (const token of finalTokens) {
    if (streamTokenSet.has(token)) {
      matchedFinalTokens += 1;
    }
  }
  const overlapRatio = matchedFinalTokens / finalTokens.length;
  return overlapRatio >= 0.65 && matchedFinalTokens >= Math.min(6, finalTokens.length);
}

function partsWithStreamingContent(
  parts: MessagePart[] | undefined,
  streamingContent: string,
): MessagePart[] {
  if (!Array.isArray(parts) || parts.length === 0) {
    return [
      {
        type: "text",
        text: streamingContent,
      } as MessagePart,
    ];
  }

  let replaced = false;
  const updated = parts.map((part) => {
    if (replaced) {
      return part;
    }
    const rec = asRecord(part);
    if (!rec) {
      return part;
    }
    const partType = normalizePartType(rec.type);
    const hasTextLike =
      partType === "" ||
      partType === "text" ||
      typeof rec.text === "string" ||
      typeof rec.content === "string";
    if (!hasTextLike) {
      return part;
    }
    replaced = true;
    return {
      ...(part as MessagePart),
      type: partType || "text",
      text: streamingContent,
    } as MessagePart;
  });

  if (replaced) {
    return updated;
  }

  return [
    {
      type: "text",
      text: streamingContent,
    } as MessagePart,
    ...parts,
  ];
}

function pickBestContentCandidate(
  candidates: Array<string | undefined>,
): string {
  const normalizedCandidates = candidates.filter(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  if (normalizedCandidates.length === 0) {
    return "";
  }

  let best = normalizedCandidates[0];
  for (let index = 1; index < normalizedCandidates.length; index += 1) {
    const candidate = normalizedCandidates[index];
    const bestNorm = normalizeComparableText(best);
    const candidateNorm = normalizeComparableText(candidate);
    if (!candidateNorm) {
      continue;
    }
    if (!bestNorm) {
      best = candidate;
      continue;
    }
    if (
      candidateNorm.includes(bestNorm) &&
      candidateNorm.length >= bestNorm.length + 24
    ) {
      best = candidate;
      continue;
    }
    if (
      candidateNorm.length > bestNorm.length + 120 &&
      !bestNorm.includes(candidateNorm)
    ) {
      best = candidate;
    }
  }
  return best;
}

function sanitizeAssistantMessageEcho(message: Message, state: AppState): Message {
  const role = message.role ?? message.info?.role;
  if (role !== 'assistant') {
    return message;
  }

  const next = { ...message };
  if (typeof next.content === 'string' && next.content.trim()) {
    const stripped = stripLeadingUserEcho(next.content, state);
    if (stripped !== next.content) {
      next.content = stripped;
    }
  }

  if (Array.isArray(next.parts) && next.parts.length > 0) {
    const parts = [...next.parts];
    const firstTextLikeIndex = parts.findIndex((part) => {
      const type = (part.type ?? '').toLowerCase();
      return type === '' || type === 'text' || !!part.text || !!part.content;
    });
    if (firstTextLikeIndex >= 0) {
      const part = parts[firstTextLikeIndex];
      if (typeof part.text === 'string') {
        parts[firstTextLikeIndex] = { ...part, text: stripLeadingUserEcho(part.text, state) };
      } else if (typeof part.content === 'string') {
        parts[firstTextLikeIndex] = { ...part, content: stripLeadingUserEcho(part.content, state) };
      }
      next.parts = parts;
    }
  }

  return next;
}

function cloneRawSnapshot<T>(value: T): T {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value) as T;
    } catch {
      // Fall back to a shallow copy below.
    }
  }
  if (Array.isArray(value)) {
    return [...value] as T;
  }
  if (value && typeof value === "object") {
    return { ...(value as Record<string, unknown>) } as T;
  }
  return value;
}

function mergeReasoningEventSnapshots(
  finalizedEvents: ReasoningEvent[],
  streamingEvents: ReasoningEvent[],
): ReasoningEvent[] {
  const merged: ReasoningEvent[] = [];

  for (const event of [...finalizedEvents, ...streamingEvents]) {
    const textKey = normalizeComparableText(asString(event?.text));
    if (!textKey) {
      continue;
    }

    const matchingIndex = merged.findIndex((existing) => {
      const samePart =
        !!event.partID &&
        !!existing.partID &&
        event.partID === existing.partID;
      if (samePart) {
        return true;
      }

      const sameText =
        normalizeComparableText(asString(existing.text)) === textKey;
      const compatibleMessage =
        !event.messageID ||
        !existing.messageID ||
        event.messageID === existing.messageID;
      return sameText && compatibleMessage;
    });

    if (matchingIndex < 0) {
      merged.push({ ...event });
      continue;
    }

    const existing = merged[matchingIndex];
    merged[matchingIndex] = {
      ...event,
      ...existing,
      text:
        normalizeComparableText(asString(event.text)).length >
        normalizeComparableText(asString(existing.text)).length
          ? event.text
          : existing.text,
      partID: existing.partID ?? event.partID,
      messageID: existing.messageID ?? event.messageID,
      startedAt: existing.startedAt ?? event.startedAt,
      endedAt: existing.endedAt ?? event.endedAt,
    };
  }

  return merged;
}

export function normalizeMessage(message: Message, streaming: StreamingState | null): Message | undefined {
  const rec = asRecord(message);
  if (!rec) {
    // FIX: If this is an assistant message with parts, don't return undefined
    // This prevents question-type messages from being filtered during hydration
    const role = asString(message.role);
    const hasParts = Array.isArray((message as Message).parts) && (message as Message).parts.length > 0;
    if (role === 'assistant' && hasParts) {
      return message as Message; // Preserve assistant messages with parts
    }
    return streaming ? buildStreamingMessage(streaming) : undefined;
  }

  const rawSdkEventPayloadsSnapshot = Array.isArray(streaming?.rawSdkEventPayloads)
    ? cloneRawSnapshot(streaming.rawSdkEventPayloads)
    : Array.isArray(rec.rawSdkEventPayloads)
      ? cloneRawSnapshot(rec.rawSdkEventPayloads)
      : undefined;
  const parts = Array.isArray(rec.parts) ? rec.parts : [];
  const mergedParts = [...parts];
  const currentReasoning = reasoningFromParts(mergedParts);
  const directReasoningRaw = rec.reasoning ?? rec.thinking ?? rec.thoughts;
  const directReasoningChunks = Array.isArray(directReasoningRaw)
    ? directReasoningRaw
      .map((item) => asRichString(item).trim())
      .filter((item) => item.length > 0)
    : typeof directReasoningRaw !== "undefined"
      ? [asRichString(directReasoningRaw).trim()].filter((item) => item.length > 0)
      : [];
  if (directReasoningChunks.length > 0 && !currentReasoning) {
    for (const chunk of directReasoningChunks) {
      mergedParts.push({
        type: "reasoning",
        reasoning: chunk,
      });
    }
  }
  const hasReasoningAfterDirect = reasoningFromParts(mergedParts);
  if (streaming?.reasoning && !hasReasoningAfterDirect) {
    mergedParts.push({
      type: 'reasoning',
      reasoning: streaming.reasoning
    });
  }
  const detachedReasoningChunks: string[] = [];
  const hasStreamingReasoningSignal = Boolean(
    streaming?.reasoning?.trim() ||
      (Array.isArray(streaming?.reasoningEvents) &&
        streaming.reasoningEvents.length > 0),
  );
  const sanitizedMergedParts = mergedParts.map((part) => {
    const rec = asRecord(part);
    if (!rec || isReasoningPart(rec)) {
      return part;
    }
    const partType = normalizePartType(rec.type);
    const textLike =
      asRichString(rec.text) || asRichString(rec.content) || asRichString(rec.delta);
    if (!textLike) {
      return part;
    }
    const mixed = splitMixedReasoningFromContent(textLike);
    if (!mixed) {
      return part;
    }
    const detached = sanitizeReasoningChunk(mixed.reasoning).trim();
    if (detached) {
      detachedReasoningChunks.push(detached);
    }

    const nextPart: Record<string, unknown> = { ...(part as Record<string, unknown>) };
    if (typeof rec.text === "string" || partType === "text") {
      nextPart.type = partType || "text";
      nextPart.text = mixed.content;
    } else if (typeof rec.content === "string") {
      nextPart.content = mixed.content;
    } else if (typeof rec.delta === "string") {
      nextPart.delta = mixed.content;
    }
    return nextPart as MessagePart;
  });
  const normalizedPartsWithLeakFiltering = sanitizedMergedParts.map((part) => {
    const rec = asRecord(part);
    if (!rec || isReasoningPart(rec)) {
      return part;
    }
    const textLike =
      asRichString(rec.text) || asRichString(rec.content) || asRichString(rec.delta);
    if (!textLike || !hasStreamingReasoningSignal) {
      return part;
    }
    const candidateNorm = normalizeComparableText(textLike);
    const matchesKnownReasoning = detachedReasoningChunks.some(
      (chunk) => normalizeComparableText(chunk) === candidateNorm,
    );
    if (!matchesKnownReasoning) {
      return part;
    }
    const detached = sanitizeReasoningChunk(textLike).trim();
    if (detached) {
      detachedReasoningChunks.push(detached);
    }
    const nextPart: Record<string, unknown> = { ...(part as Record<string, unknown>) };
    if (typeof rec.text === "string" || normalizePartType(rec.type) === "text") {
      nextPart.type = normalizePartType(rec.type) || "text";
      nextPart.text = "";
    } else if (typeof rec.content === "string") {
      nextPart.content = "";
    } else if (typeof rec.delta === "string") {
      nextPart.delta = "";
    }
    return nextPart as MessagePart;
  });
  const normalizedParts = dedupeAdjacentRenderableTextParts(
    normalizedPartsWithLeakFiltering as MessagePart[],
  );

  const splitReasoningFromCandidate = (raw: string): string => {
    const mixed = splitMixedReasoningFromContent(raw);
    if (!mixed) {
      return raw;
    }
    const detached = sanitizeReasoningChunk(mixed.reasoning).trim();
    if (detached) {
      detachedReasoningChunks.push(detached);
    }
    return mixed.content;
  };

  // Normalize structured output early so content-source selection can rely on
  // structured responseType/message without falling back to free-form text.
  const normalizedStructuredOutput =
    resolveStructuredOutputFromMessageRecord(rec) ??
    normalizeStructuredOutputWithFallback(streaming?.structuredOutput);

  const role = asString(rec.role) || asString(asRecord(rec.info)?.role);
  const sourceMessageId =
    asString(asRecord(rec.info)?.id) ||
    asString(rec.id) ||
    asString(streaming?.messageId) ||
    "(unknown)";
  const nonReasoningPartsContent = contentFromParts(normalizedParts).trim();
  const contentFromTopLevel = pickBestContentCandidate([
    splitReasoningFromCandidate(asRichString(rec.content)),
    splitReasoningFromCandidate(asRichString(rec.text)),
    summaryText(rec.info),
  ]);
  const structuredMessage = asString(normalizedStructuredOutput?.message).trim();
  const provisionalResponseType = firstNonEmptyString(
    normalizedStructuredOutput?.responseType,
    asString(rec.responseType),
  )?.toLowerCase();
  const structuredInteractiveEvents = toInteractiveEvents(
    normalizedStructuredOutput,
  );
  const blockingStructuredInteractiveEvents = structuredInteractiveEvents.filter(
    (event) => {
      const type = asString((event as Record<string, unknown>)?.type).toLowerCase();
      return (
        type === "question" ||
        type === "confirm" ||
        type === "quick_actions" ||
        type === "quick-actions"
      );
    },
  );
  // Final SDK structured output is the canonical assistant body for explicit
  // structured message-like turns. Text parts can contain transitional bridge
  // text ("delivering summary directly", etc.) while the structured payload
  // carries the actual user-facing response.
  const shouldPreferStructuredMessage =
    (provisionalResponseType === "implementation_plan" ||
      provisionalResponseType === "message") &&
    structuredMessage.length > 0;
  const hasParts = Array.isArray(parts) && parts.length > 0;
  // Structured-first rule: when provider parts exist, non-reasoning text parts
  // are authoritative for assistant body rendering.
  let content = hasParts
      ? shouldPreferStructuredMessage
      ? structuredMessage
      : nonReasoningPartsContent || (provisionalResponseType === "message" ? structuredMessage : "")
    : structuredMessage || contentFromTopLevel;
  const contentSelectedSource = hasParts
    ? shouldPreferStructuredMessage
      ? "structured.message"
      : nonReasoningPartsContent
      ? "parts"
      : provisionalResponseType === "message" && structuredMessage
        ? "structured.message"
        : "none"
    : structuredMessage
      ? "structured.message"
      : contentFromTopLevel
        ? "top-level"
        : "none";
  if (
    hasParts &&
    !nonReasoningPartsContent &&
    contentFromTopLevel &&
    !content
  ) {
    logger.info("Dropping top-level content because message parts are authoritative", {
      messageId:
        asString(asRecord(rec.info)?.id) || asString((rec as UnknownRecord).id),
      topLevelContentPreview: contentFromTopLevel.slice(0, 220),
      partCount: parts.length,
      responseType: provisionalResponseType,
    });
  }
  if (
    nonReasoningPartsContent &&
    contentFromTopLevel &&
    normalizeComparableText(nonReasoningPartsContent) !==
    normalizeComparableText(contentFromTopLevel)
  ) {
    logger.info("Content source mismatch; preferring parts content", {
      messageId:
        asString(asRecord(rec.info)?.id) || asString((rec as UnknownRecord).id),
      partsContentPreview: nonReasoningPartsContent.slice(0, 220),
      topLevelContentPreview: contentFromTopLevel.slice(0, 220),
    });
  }

  const streamingRawContent = asString(streaming?.content);
  const streamingMixed = splitMixedReasoningFromContent(streamingRawContent);
  if (streamingMixed) {
    const detached = sanitizeReasoningChunk(streamingMixed.reasoning).trim();
    if (detached) {
      detachedReasoningChunks.push(detached);
    }
  }
  const streamingContent = streamingMixed ? streamingMixed.content : streamingRawContent;
  const hasRenderableStreamingContent = Boolean(streaming?.hasRenderableContent);
  const preferStreamingContent = shouldPreferStreamingContent(
    content || "",
    streamingContent,
  );
  const streamingContentMatchesReasoning = (() => {
    const streamNorm = normalizeComparableText(streamingContent);
    if (!streamNorm || streamNorm.length < 40) return false;
    const allReasoning = [
      hasReasoningAfterDirect,
      ...(streaming?.reasoningEvents?.map((e) => e.content || e.text || '') ?? []),
      ...detachedReasoningChunks,
    ].filter((r) => r && r.trim().length > 0);
    for (const reasoningChunk of allReasoning) {
      const chunkNorm = normalizeComparableText(reasoningChunk);
      if (!chunkNorm) continue;
      const streamTokens = comparableTokens(streamNorm);
      const reasoningTokens = comparableTokens(chunkNorm);
      if (streamTokens.length < 5 || reasoningTokens.length < 5) continue;
      const overlap = streamTokens.filter((t) => reasoningTokens.includes(t)).length;
      const ratio = overlap / streamTokens.length;
      if (ratio > 0.45) return true;
    }
    return false;
  })();
  const hasCanonicalAssistantContent =
    role === "assistant" && typeof content === "string" && content.trim().length > 0;
  const shouldUseStreamingContent =
    hasRenderableStreamingContent &&
    !nonReasoningPartsContent &&
    preferStreamingContent &&
    !streamingContentMatchesReasoning &&
    !hasCanonicalAssistantContent;
  if (role === "assistant") {
    logger.info("[MESSAGE-HANDLER-TRACE] Assistant message normalization candidate analysis", {
      messageId: sourceMessageId,
      role,
      responseType: provisionalResponseType ?? null,
      hasParts,
      contentSelectedSource,
      nonReasoningPartsContentPreview: previewForLog(nonReasoningPartsContent),
      contentFromTopLevelPreview: previewForLog(contentFromTopLevel),
      structuredMessagePreview: previewForLog(structuredMessage),
      streamingContentPreview: previewForLog(streamingContent),
      rawReasoningPreview: previewForLog(hasReasoningAfterDirect),
      detachedReasoningPreview: previewForLog(detachedReasoningChunks.join("\n\n")),
      hasRenderableStreamingContent,
      preferStreamingContent,
      hasCanonicalAssistantContent,
      shouldUseStreamingContent,
      streamingContentMatchesReasoning,
      normalizedStructuredOutputResponseType:
        normalizedStructuredOutput?.responseType ?? null,
    });
  }
  if (streaming && role === "assistant") {
    logger.info("[MESSAGE-HANDLER-TRACE] Assistant message normalization decision", {
      messageId: sourceMessageId,
      provisionalResponseType: provisionalResponseType ?? null,
      contentSelectedSource,
      finalContentLength: (content || "").length,
      finalContentPreview: previewForLog(content),
      streamingContentLength: streamingContent.length,
      streamingContentPreview: previewForLog(streamingContent),
      hasRenderableStreamingContent,
      preferStreamingContent,
      hasCanonicalAssistantContent,
      shouldUseStreamingContent,
      streamingContentMatchesReasoning,
      normalizedStructuredOutputResponseType:
        normalizedStructuredOutput?.responseType ?? null,
      normalizedStructuredOutputMessagePreview: previewForLog(
        normalizedStructuredOutput?.message,
      ),
      streamingSummary: summarizeStreamingForLog(streaming),
    });
  }
  const normalized: Message = {
    ...(message as Message),
    role: role || message.role || (parts.length > 0 ? 'assistant' : undefined),
    content: shouldUseStreamingContent ? streamingContent : content || message.content,
    parts: shouldUseStreamingContent
      ? partsWithStreamingContent(normalizedParts, streamingContent)
      : normalizedParts.length > 0
        ? (normalizedParts as Message['parts'])
        : message.parts
  };
  if (rawSdkEventPayloadsSnapshot) {
    (normalized as Record<string, unknown>).rawSdkEventPayloads = rawSdkEventPayloadsSnapshot;
  }

  const normalizedInfoRecord = asRecord(normalized.info) || {};
  const variant = firstNonEmptyString(
    asString(normalizedInfoRecord.variant),
    asString(rec.variant),
    asString(streaming?.variant),
  );
  normalized.info = {
    ...(normalized.info || {}),
    ...(variant ? { variant } : {}),
  };
  if (variant) {
    normalized.variant = variant;
  }

  // Preserve a normalized structured output payload so question/options data
  // survives message normalization even when the source uses legacy field names.
  if (normalizedStructuredOutput) {
    (normalized as Record<string, unknown>).structuredOutput = normalizedStructuredOutput;
    if (!normalized.responseType && normalizedStructuredOutput.responseType) {
      normalized.responseType = normalizedStructuredOutput.responseType as StructuredResponseType;
    }
    if (
      (!normalized.plan || typeof normalized.plan !== "object") &&
      normalizedStructuredOutput.plan &&
      typeof normalizedStructuredOutput.plan === "object"
    ) {
      normalized.plan = {
        ...normalizedStructuredOutput.plan,
      };
    }
    if (!normalized.walkthrough && normalizedStructuredOutput.walkthrough) {
      normalized.walkthrough = normalizedStructuredOutput.walkthrough;
    }
    if (
      (!Array.isArray(normalized.interactiveEvents) ||
        normalized.interactiveEvents.length === 0)
    ) {
      const structuredInteractiveEvents = toInteractiveEvents(
        normalizedStructuredOutput,
      );
      if (structuredInteractiveEvents.length > 0) {
        normalized.interactiveEvents = structuredInteractiveEvents;
      }
    }
  }

  if (
    (!normalized.plan || typeof normalized.plan !== "object") &&
    streaming?.plan &&
    typeof streaming.plan === "object"
  ) {
    normalized.plan = {
      ...streaming.plan,
    };
  }

  if (
    (!Array.isArray(normalized.interactiveEvents) ||
      normalized.interactiveEvents.length === 0) &&
    Array.isArray(streaming?.interactiveEvents) &&
    streaming.interactiveEvents.length > 0
  ) {
    normalized.interactiveEvents = [...streaming.interactiveEvents];
  }

  const rawStructuredOutputs = collectRawStructuredOutputCandidates(rec);
  if (rawStructuredOutputs.length > 0) {
    (normalized as Record<string, unknown>).rawStructuredOutputs = rawStructuredOutputs;
  }

  // Rebuild the legacy "raw debug" view from the centralized event tape so the
  // normalization path can continue to extract reasoning chunks from raw stream
  // payloads without depending on a missing helper or on the old rawResponse
  // shape. This keeps the centralized tape as the single source of truth.
  const parsedRawDebug = {
    parts: Array.isArray(rawSdkEventPayloadsSnapshot)
      ? rawSdkEventPayloadsSnapshot
          .map((payload) => getCentralizedEventPart(payload))
          .filter((part): part is UnknownRecord => !!part)
      : [],
  };

  if (!normalized.plan) {
    const rawPlan = extractRawPlanFromMessageRecord(rec);
    if (rawPlan) {
      normalized.plan = rawPlan as Message["plan"];
    }
  }

  const responseType = firstNonEmptyString(
    normalized.responseType,
    normalizedStructuredOutput?.responseType,
  )?.toLowerCase();
  const hasPlanAttachment =
    !!normalized.plan &&
    typeof normalized.plan === "object" &&
    !!(
      asString(normalized.plan.file).trim() ||
      asString(normalized.plan.content).trim() ||
      (Array.isArray(normalized.plan.files) && normalized.plan.files.length > 0)
    );
  if (!hasPlanAttachment && normalized.plan) {
    delete (normalized as Record<string, unknown>).plan;
  }
  if (hasPlanAttachment && responseType !== "implementation_plan") {
    normalized.responseType = "implementation_plan";
  }
  if (
    (responseType === "implementation_plan" || normalized.responseType === "implementation_plan") &&
    normalized.plan
  ) {
    const introFromPlan = asString(normalized.plan.intro).trim();
    const summaryFromPlan = asString(normalized.plan.summary).trim();
    const currentContent = asString(normalized.content).trim();
    if (!currentContent) {
      normalized.content = introFromPlan || summaryFromPlan;
    }
  }

  const existingReasoningEvents = Array.isArray(message.reasoningEvents)
    ? message.reasoningEvents
    : [];
  const mergedReasoningEvents = mergeReasoningEventSnapshots(
    existingReasoningEvents,
    streaming?.reasoningEvents ?? [],
  );
  const reasoningSources = new Set<ActivitySource>();
  if (Array.isArray(streaming?.reasoningEvents) && streaming.reasoningEvents.length > 0) {
    reasoningSources.add("stream");
  }
  if (Array.isArray(existingReasoningEvents) && existingReasoningEvents.length > 0) {
    reasoningSources.add("final");
  }

  const explicitReasoningFromFinalParts = parts
    .map((part) => asRecord(part))
    .filter((part): part is UnknownRecord => !!part)
    .filter((part) => isReasoningPart(part))
    .map((part) => {
      const text = sanitizeReasoningChunk(
        asRichString(part.reasoning) ||
        asRichString(part.thought) ||
        asRichString(part.thinking) ||
        asRichString(part.text) ||
        asRichString(part.content),
      ).trim();
      const timeStart = typeof asRecord(part.time)?.start === "number" ? asRecord(part.time)?.start as number : (typeof part.createdAt === "number" ? part.createdAt : Date.now());
      return { text, createdAt: timeStart };
    })
    .filter((chunk) => chunk.text.length > 0);
  if (explicitReasoningFromFinalParts.length > 0) {
    reasoningSources.add("final");
    for (const chunk of explicitReasoningFromFinalParts) {
      const norm = normalizeComparableText(chunk.text);
      if (!norm) continue;
      const alreadyTracked = mergedReasoningEvents.some(
        (event) => normalizeComparableText(asString(event.text)) === norm,
      );
      if (!alreadyTracked) {
        mergedReasoningEvents.push(chunk);
      }
    }
  }

  const explicitReasoningFromRawParts = parsedRawDebug.parts
    .map((part) => asRecord(part))
    .filter((part): part is UnknownRecord => !!part)
    .filter((part) => normalizePartType(part.type) === "reasoning")
    .map((part) => {
      const text = sanitizeReasoningChunk(
        asRichString(part.reasoning) ||
        asRichString(part.text) ||
        asRichString(part.content) ||
        asRichString(part.delta),
      ).trim();
      const timeStart = typeof asRecord(part.time)?.start === "number" ? asRecord(part.time)?.start as number : (typeof part.createdAt === "number" ? part.createdAt : Date.now());
      return { text, createdAt: timeStart };
    })
    .filter((chunk) => chunk.text.length > 0);
  if (explicitReasoningFromRawParts.length > 0) {
    reasoningSources.add("raw_debug");
    for (const chunk of explicitReasoningFromRawParts) {
      const norm = normalizeComparableText(chunk.text);
      if (!norm) continue;
      const alreadyTracked = mergedReasoningEvents.some(
        (event) => normalizeComparableText(asString(event.text)) === norm,
      );
      if (!alreadyTracked) {
        mergedReasoningEvents.push(chunk);
      }
    }
  }
  const streamingReasoningLeak = sanitizeReasoningChunk(
    streamingMixed ? streamingMixed.reasoning : asString(streaming?.content),
  ).trim();
  if (
    streamingReasoningLeak &&
    (containsThoughtTagReasoning(streamingReasoningLeak) || !!streamingMixed) &&
    !shouldPreferStreamingContent(content || "", streamingReasoningLeak)
  ) {
    const leakNorm = normalizeComparableText(streamingReasoningLeak);
    const finalNorm = normalizeComparableText(content || "");
    const leakAlreadyInFinal =
      !!leakNorm &&
      !!finalNorm &&
      (finalNorm.includes(leakNorm) || leakNorm.includes(finalNorm));
    const leakAlreadyTracked = mergedReasoningEvents.some(
      (event) => normalizeComparableText(asString(event.text)) === leakNorm,
    );
    if (!leakAlreadyInFinal && !leakAlreadyTracked) {
      mergedReasoningEvents.push({
        text: streamingReasoningLeak,
        createdAt: Date.now(),
      });
    }
  }
  if (detachedReasoningChunks.length > 0) {
    detachedReasoningChunks.forEach((chunk) => {
      const norm = normalizeComparableText(chunk);
      if (!norm) return;
      const alreadyTracked = mergedReasoningEvents.some(
        (event) => normalizeComparableText(asString(event.text)) === norm,
      );
      if (!alreadyTracked) {
        mergedReasoningEvents.push({ text: chunk, createdAt: Date.now() });
      }
    });
  }
  if (mergedReasoningEvents.length > 0) {
    normalized.reasoningEvents = mergedReasoningEvents;
    normalized.reasoningPayload = {
      events: mergedReasoningEvents,
      sources: Array.from(reasoningSources),
    };
  }

  const canonicalSteps = normalizeActivitySteps(
    normalized,
    streaming,
    normalizedPartsWithLeakFiltering as MessagePart[],
  );
  if (canonicalSteps.length > 0) {
    normalized.steps = canonicalSteps;
    normalized.progressEvents = canonicalSteps;

    // A native call_omo_agent tool is the authoritative creation record for a
    // background child. Project it into the same subagent collection consumed
    // by SubagentsInlineCard, so the card and the invocation row share one
    // detail contract during both streaming and hydration.
    const existingSubagents = Array.isArray(normalized.subagents)
      ? normalized.subagents
      : [];
    const invocationDetails = canonicalSteps
      .filter((step) => {
        const tool = asString(step.activityDetail?.tool).toLowerCase();
        const title = asString(step.title).toLowerCase();
        return tool === "call_omo_agent" || title === "call_omo_agent";
      })
      .map((step) => formatCallOmoAgentAsSubagentDetail({
        callID: step.callID,
        parentSessionId: firstNonEmptyString(
          asString(asRecord(normalized.info)?.sessionID),
          asString((normalized as UnknownRecord).sessionID),
        ),
        parentMessageId: getMessageId(normalized) || undefined,
        childSessionId: step.sessionID,
        startedAt: step.startedAt,
        endedAt: step.endedAt,
        status: step.status === "error" ? "error" : step.status === "done" ? "done" : "pending",
        activityDetail: step.activityDetail,
      }));
    if (invocationDetails.length > 0) {
      const merged = [...existingSubagents];
      for (const detail of invocationDetails) {
        const isAlreadyRepresented = merged.some((candidate) =>
          (detail.backgroundTaskId && candidate.backgroundTaskId === detail.backgroundTaskId) ||
          (detail.childSessionId && candidate.childSessionId === detail.childSessionId),
        );
        if (!isAlreadyRepresented) {
          merged.push(detail);
        }
      }
      normalized.subagents = merged;
    }
  }

  // Extract file edits from patch-type parts when edits are not already populated.
  if (!Array.isArray(normalized.edits) || normalized.edits.length === 0) {
    const fromParts: Array<{ file: string }> = [];
    for (const part of sanitizedMergedParts) {
      const rec = asRecord(part);
      if (!rec || asString(rec.type).toLowerCase() !== 'patch') continue;
      const files = Array.isArray(rec.files) ? rec.files : [];
      for (const f of files) {
        if (typeof f === 'string' && f) {
          fromParts.push({ file: f });
        }
      }
    }
    if (fromParts.length > 0) {
      normalized.edits = fromParts;
    }
  }
  if (
    (!Array.isArray(normalized.edits) || normalized.edits.length === 0) &&
    Array.isArray(streaming?.edits) &&
    streaming.edits.length > 0
  ) {
    normalized.edits = Array.from(new Set(streaming.edits))
      .filter((file) => typeof file === "string" && file.trim().length > 0)
      .map((file) => ({ file }));
  }

  // NOTE: When the AI triggers a question via a tool call (no text parts), content ends up
  // empty. Synthesize a context message from the Question tool parts so the chat bubble
  // always shows the question — during the live session AND after extension restart.
  const structuredEvents = Array.isArray(normalized.interactiveEvents)
    ? normalized.interactiveEvents
    : [];
  if (
    (structuredEvents.length > 0 &&
      shouldOverrideStreamingContentWithInteractivePrompt(
        asString(normalized.content),
        "",
        streaming,
      )) ||
    !normalized.content?.trim()
  ) {
    const synthesized = synthesizeQuestionContextMessage(structuredEvents);
    if (synthesized) {
      normalized.content = synthesized;
    }
  }

  if (!normalized.content?.trim()) {
    const questionParts = (sanitizedMergedParts as Array<unknown>).filter((p) => {
      const pr = asRecord(p);
      return !!pr && asString(pr.type).toLowerCase() === 'tool' && interactiveEventsFromToolQuestionPart(pr).length > 0;
    });
    if (questionParts.length > 0) {
      const allEvents: InteractiveEvent[] = [];
      for (const p of questionParts) {
        const pr = asRecord(p);
        if (pr) {
          allEvents.push(...interactiveEventsFromToolQuestionPart(pr));
        }
      }
      if (
        allEvents.length > 0 &&
        (!Array.isArray(normalized.interactiveEvents) ||
          normalized.interactiveEvents.length === 0)
      ) {
        normalized.interactiveEvents = allEvents;
      }
      if (
        allEvents.length > 0 &&
        !firstNonEmptyString(normalized.responseType, normalizedStructuredOutput?.responseType)
      ) {
        normalized.responseType = "question";
      }
      const synthesized = synthesizeQuestionContextMessage(allEvents);
      if (synthesized) {
        normalized.content = synthesized;
      }
    }
  }

  // Some providers emit internal reminder payloads with role="user" during
  // streaming/hydration. Canonicalize them to role="system" so downstream UI
  // consistently renders them as system messages.
  if (isInternalSystemReminderMessage(normalized)) {
    normalized.role = "system";
    normalized.info = {
      ...(normalized.info || {}),
      role: "system",
    };
  }

  return normalized;
}

function isFileResult(value: unknown): value is FileResult {
  const rec = asRecord(value);
  return !!rec && typeof rec.path === 'string' && typeof rec.name === 'string';
}

function isMentionResult(value: unknown): value is MentionResult {
  const rec = asRecord(value);
  if (!rec || typeof rec.type !== 'string') return false;
  const t = rec.type;
  if (t === 'agent') return typeof rec.id === 'string' && typeof rec.name === 'string';
  if (t === 'file') return typeof rec.path === 'string' && typeof rec.name === 'string';
  if (t === 'resource') return typeof rec.uri === 'string' && typeof rec.name === 'string' && typeof rec.clientName === 'string';
  return false;
}

function isSlashCommand(value: unknown): value is SlashCommand {
  const rec = asRecord(value);
  return !!rec && typeof rec.name === "string";
}

function isSkill(value: unknown): value is Skill {
  const rec = asRecord(value);
  return (
    !!rec &&
    typeof rec.name === "string" &&
    typeof rec.description === "string" &&
    typeof rec.enabled === "boolean" &&
    typeof rec.source === "string"
  );
}

function isQueueItem(value: unknown): value is QueueItem {
  const rec = asRecord(value);
  return (
    !!rec &&
    typeof rec.text === "string" &&
    (rec.id === undefined || typeof rec.id === "string") &&
    (rec.sessionId === undefined || typeof rec.sessionId === "string") &&
    (rec.createdAt === undefined || typeof rec.createdAt === "number")
  );
}

function isSession(value: unknown): value is Session {
  const rec = asRecord(value);
  return !!rec && typeof rec.id === 'string';
}

function isMessage(value: unknown): value is Message {
  const rec = asRecord(value);
  return (
    !!rec &&
    (typeof rec.role === 'string' ||
      typeof asRecord(rec.info)?.role === 'string' ||
      typeof rec.content === 'string' ||
      typeof rec.text === 'string' ||
      Array.isArray(rec.parts) ||
      Array.isArray(rec.subagents) ||
      Array.isArray(rec.reasoningEvents) ||
      Array.isArray(rec.progressEvents) ||
      Array.isArray(rec.steps))
  );
}

// NOTE: All subagent helper functions removed - now using modular system
// See: webview/shared/src/chat/lib/subagents/
// - eventNormalizer.ts, metadataExtractor.ts, eventBuilder.ts
// - dataNormalizer.ts, stateManager.ts, centralExtractor.ts, uiFormatter.ts

// ============================================================================
// REMOVED: All old subagent helper functions (1,843 lines removed)
// These functions are now in the modular system:
// - normalizeSubagentProgressEventsForPresentation → eventBuilder.ts
// - normalizeSubagentTimelineEventsForPresentation → eventBuilder.ts
// - normalizeSubagentSummary → dataNormalizer.ts
// - normalizeSubagentDetail → dataNormalizer.ts
// - normalizeSubagentSummaryMap → dataNormalizer.ts
// - normalizeSubagentDetailMap → dataNormalizer.ts
// - handleSubagentUpdatesFromCentralizedEvents (updated below)
// - extractSubagentsFromMessages → centralExtractor.ts
// - extractEventPart → eventNormalizer.ts
// - extractEventMessageID → eventnormalizer.ts
// - isSubagentToolName → eventNormalizer.ts
// - normalizeSubagentEvent → eventNormalizer.ts
// - extractSubagentMetadata → metadataExtractor.ts
// - buildConversationEvents → eventBuilder.ts
// - buildProgressEvents → eventBuilder.ts
// - buildTimelineEvents → eventBuilder.ts
// - extractSubagentDetailFromCentralizedEvents → centralExtractor.ts
// - extractSubagentDetailFromEvents → centralExtractor.ts
// - hydrateSubagentSummary → stateManager.ts
// - latestSubagentEventTimestamp → uiFormatter.ts
// - shouldFreezeSubagentForPresentation → uiFormatter.ts
// - normalizeHydratedSubagentDetail → (removed, not needed)
// - normalizeHydratedSubagentSummary → (removed, not needed)
// - normalizeHydratedSubagentMaps → (removed, not needed)
// - areSubagentListsEquivalent → stateManager.ts
// - mergeSubagentSummaries → stateManager.ts
// - hasSubagentSummaryEntries → stateManager.ts
// - mergeSubagentSummaryPayload → stateManager.ts
// - mergeUniqueSubagentEntries → stateManager.ts
// - mergeSubagentDetailRecord → stateManager.ts
// - mergeSubagentDetailPayload → stateManager.ts
// - applyStructuredSubagentPayload → (removed, disabled)
// ============================================================================

// ESSENTIAL UTILITIES - Still needed in messageHandler (not moved to modules)
function getMessageId(message: Message): string | null {
  return (
    asString(asRecord(message.info)?.id) ||
    asString((message as unknown as UnknownRecord).id) ||
    null
  );
}

/**
 * Shared parent-id parser for assistant messages.
 *
 * Keep this broad and reusable. OpenCode history may surface the parent through
 * normalized `info`, top-level legacy fields, or raw response metadata. Higher
 * layers should call this helper before adding their own fallback chain, because
 * divergent parent parsing is what lets reasoning/text from one assistant turn
 * leak into the next visible user turn.
 */
export function getMessageParentId(message: Message | undefined): string | null {
  if (!message) {
    return null;
  }
  const rec = asRecord(message);
  const info = asRecord(message.info);
  const rawResponse = asRecord(message.rawResponse);
  const rawInfo = asRecord(rawResponse?.info);
  return (
    firstNonEmptyString(
      asString(info?.parentID),
      asString(info?.parentId),
      asString(rec?.parentID),
      asString(rec?.parentId),
      asString(rawInfo?.parentID),
      asString(rawInfo?.parentId),
    ) ?? null
  );
}

function getMessageCompletedAt(message: Message | undefined): number | undefined {
  if (!message) {
    return undefined;
  }
  const info = asRecord(message.info);
  const infoTime = asRecord(info?.time);
  const topLevelTime = asRecord((message as unknown as UnknownRecord).time);
  const timing = asRecord((message as unknown as UnknownRecord).timing);
  const candidates = [
    infoTime?.completed,
    infoTime?.end,
    topLevelTime?.completed,
    topLevelTime?.end,
    timing?.completed,
    timing?.end,
    (message as unknown as UnknownRecord).completed,
    message.created,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function hydrateSubagentSummary(
  summary: SubagentSummary,
  detailsById: Record<string, SubagentDetail>,
): SubagentDetail {
  const detail = detailsById[summary.id];
  if (detail) {
    return compatNormalizeHydratedSubagentDetail(detail);
  }
  return compatHydrateSubagentSummary(summary);
}

function shouldFreezeSubagentForPresentation(
  detail: SubagentDetail,
  _message: Message | undefined,
  policy: SubagentPresentationPolicy | undefined,
  explicitFreezeFlag?: boolean,
): boolean {
  return (
    uiShouldFreezeSubagentForPresentation(
      detail,
      policy,
      explicitFreezeFlag,
    ) ||
    compatShouldFreezeSubagentForPresentation(detail, policy, explicitFreezeFlag)
  );
}

function normalizeHydratedSubagentDetail(
  detail: SubagentDetail,
  message: Message | undefined,
  freezeIncompleteStatuses: boolean,
): SubagentDetail {
  const normalizedBase = compatNormalizeHydratedSubagentDetail(detail);
  const normalizedForPresentation: SubagentDetail = {
    ...normalizedBase,
    latestActivity:
      sanitizeSubagentLabel(normalizedBase.latestActivity) || "Subagent update",
    progressEvents: normalizeSubagentProgressEventsForPresentation(
      Array.isArray(normalizedBase.progressEvents)
        ? normalizedBase.progressEvents
        : [],
    ),
    timelineEvents: normalizeSubagentTimelineEventsForPresentation(
      Array.isArray(normalizedBase.timelineEvents)
        ? normalizedBase.timelineEvents
        : [],
    ),
  };

  if (!freezeIncompleteStatuses) {
    return normalizedForPresentation;
  }

  if (
    normalizedForPresentation.status !== "pending" &&
    normalizedForPresentation.status !== "running" &&
    normalizedForPresentation.status !== "orphaned"
  ) {
    return normalizedForPresentation;
  }

  const completedAt =
    (typeof normalizedForPresentation.endedAt === "number" &&
    Number.isFinite(normalizedForPresentation.endedAt)
      ? normalizedForPresentation.endedAt
      : undefined) ??
    getMessageCompletedAt(message) ??
    latestSubagentEventTimestamp(normalizedForPresentation) ??
    normalizedForPresentation.startedAt;
  const startedAt =
    typeof normalizedForPresentation.startedAt === "number" &&
    Number.isFinite(normalizedForPresentation.startedAt)
      ? normalizedForPresentation.startedAt
      : undefined;

  const normalized: SubagentDetail = {
    ...normalizedForPresentation,
    status: "done",
    endedAt:
      typeof completedAt === "number"
        ? completedAt
        : normalizedForPresentation.endedAt,
    durationMs:
      typeof startedAt === "number" && typeof completedAt === "number"
        ? Math.max(0, completedAt - startedAt)
        : normalizedForPresentation.durationMs,
  };

  if (
    !normalized.latestActivity ||
    ["running", "pending", "orphaned"].includes(
      normalized.latestActivity.trim().toLowerCase(),
    )
  ) {
    normalized.latestActivity = "Completed";
  }

  return normalized;
}

function areSubagentListsEquivalent(
  previous: SubagentDetail[] | undefined,
  next: SubagentDetail[],
): boolean {
  if (compatAreSubagentListsEquivalent(previous ?? [], next)) {
    return true;
  }
  const prev = Array.isArray(previous) ? previous : [];
  if (prev.length !== next.length) {
    return false;
  }
  for (let index = 0; index < prev.length; index += 1) {
    const left = prev[index];
    const right = next[index];
    if (
      left.id !== right.id ||
      left.status !== right.status ||
      left.latestActivity !== right.latestActivity ||
      (left.durationMs ?? 0) !== (right.durationMs ?? 0) ||
      (left.progressEvents?.length ?? 0) !== (right.progressEvents?.length ?? 0) ||
      (left.thinkingEvents?.length ?? 0) !== (right.thinkingEvents?.length ?? 0) ||
      (left.conversationEvents?.length ?? 0) !== (right.conversationEvents?.length ?? 0) ||
      (left.timelineEvents?.length ?? 0) !== (right.timelineEvents?.length ?? 0)
    ) {
      return false;
    }
  }
  return true;
}

function normalizeHydratedSubagentMaps(
  summariesByParentMessageId: Record<string, SubagentSummary[]>,
  detailsById: Record<string, SubagentDetail>,
  messages: Message[],
  freezeIncompleteStatuses: boolean,
  policy?: SubagentPresentationPolicy,
  cancelIncompleteStatuses = false,
): {
  summariesByParentMessageId: Record<string, SubagentSummary[]>;
  detailsById: Record<string, SubagentDetail>;
} {
  if (!freezeIncompleteStatuses && (!policy || policy.mode !== "hydration")) {
    return { summariesByParentMessageId, detailsById };
  }

  const messageById = new Map<string, Message>();
  for (const message of messages) {
    const id = getMessageId(message);
    if (id) {
      messageById.set(id, message);
    }
  }

  const normalizedDetailsById: Record<string, SubagentDetail> = {};
  for (const [detailId, detail] of Object.entries(detailsById)) {
    const message = messageById.get(detail.parentMessageId);
    const freeze = shouldFreezeSubagentForPresentation(
      detail,
      message,
      policy,
      freezeIncompleteStatuses,
    );
    normalizedDetailsById[detailId] = normalizeHydratedSubagentDetail(
      detail,
      message,
      freeze,
    );
  }

  const normalizedSummariesByParentMessageId: Record<string, SubagentSummary[]> = {};
  for (const [parentMessageId, summaries] of Object.entries(summariesByParentMessageId)) {
    const message = messageById.get(parentMessageId);
    normalizedSummariesByParentMessageId[parentMessageId] = summaries.map((summary) => {
      const normalizedDetail = normalizedDetailsById[summary.id] ?? detailsById[summary.id];
      if (!normalizedDetail) {
        return summary;
      }
      return {
        ...summary,
        status: normalizedDetail.status,
        startedAt:
          typeof normalizedDetail.startedAt === "number"
            ? normalizedDetail.startedAt
            : summary.startedAt,
        endedAt:
          typeof normalizedDetail.endedAt === "number"
            ? normalizedDetail.endedAt
            : summary.endedAt,
        durationMs:
          typeof normalizedDetail.durationMs === "number"
            ? normalizedDetail.durationMs
            : summary.durationMs,
        latestActivity: normalizedDetail.latestActivity || summary.latestActivity,
      };
    });
  }

  const normalized = {
    summariesByParentMessageId: normalizedSummariesByParentMessageId,
    detailsById: normalizedDetailsById,
  };

  if (!cancelIncompleteStatuses) {
    return normalized;
  }

  const isIncomplete = (status: string | undefined) =>
    status === "pending" || status === "running" || status === "orphaned";
  const detailsAfterRestart = Object.fromEntries(
    Object.entries(normalized.detailsById).map(([id, detail]) => [
      id,
      isIncomplete(detail.status)
        ? { ...detail, status: "cancelled" as const, latestActivity: "Cancelled" }
        : detail,
    ]),
  );
  const summariesAfterRestart = Object.fromEntries(
    Object.entries(normalized.summariesByParentMessageId).map(([parentId, summaries]) => [
      parentId,
      summaries.map((summary) => {
        const detail = detailsAfterRestart[summary.id];
        if (detail) {
          return { ...summary, status: detail.status, latestActivity: detail.latestActivity };
        }
        return isIncomplete(summary.status)
          ? { ...summary, status: "cancelled" as const, latestActivity: "Cancelled" }
          : summary;
      }),
    ]),
  );
  return { summariesByParentMessageId: summariesAfterRestart, detailsById: detailsAfterRestart };
}

function canCoalesceAssistantHistoryMessages(
  left: Message,
  right: Message,
): boolean {
  const leftParentId = getMessageParentId(left);
  const rightParentId = getMessageParentId(right);
  if (leftParentId && rightParentId && leftParentId !== rightParentId) {
    return false;
  }
  const leftId = getMessageId(left);
  const rightId = getMessageId(right);
  if (leftId && rightId && leftId !== rightId) {
    return false;
  }
  return true;
}

function assistantHistoryBurstKey(message: Message): string {
  return getMessageParentId(message) || "__unparented_assistant_burst__";
}

function mergeAssistantActivitySteps(
  existing: MessageStep[] | undefined,
  incoming: MessageStep[] | undefined,
): MessageStep[] | undefined {
  const existingSteps = Array.isArray(existing) ? existing : [];
  const incomingSteps = Array.isArray(incoming) ? incoming : [];
  if (existingSteps.length === 0) {
    return incomingSteps.length > 0 ? incomingSteps : undefined;
  }
  if (incomingSteps.length === 0) {
    return existingSteps;
  }

  const merged: MessageStep[] = [];
  const indexByKey = new Map<string, number>();
  [...existingSteps, ...incomingSteps].forEach((step, index) => {
    const normalized = normalizeActivityStepRecord(step, "final");
    if (!normalized) {
      return;
    }
    const key = activityStepMergeKey(normalized, index);
    const existingIndex = indexByKey.get(key);
    if (typeof existingIndex !== "number") {
      indexByKey.set(key, merged.length);
      merged.push(normalized);
      return;
    }
    merged[existingIndex] = mergeCanonicalActivityStep(
      merged[existingIndex],
      normalized,
    );
  });

  return merged.length > 0 ? merged : undefined;
}

function activityArrayItemKey(item: unknown, index: number): string {
  const rec = asRecord(item);
  if (!rec) {
    return `primitive:${String(item)}:${index}`;
  }
  const id = asString(rec.id).trim();
  if (id) {
    return `id:${id}`;
  }
  const callID = (asString(rec.callID) || asString(rec.callId)).trim();
  if (callID) {
    return `call:${callID}`;
  }
  const file = (
    asString(rec.file) ||
    asString(rec.path) ||
    asString(rec.filePath)
  ).trim();
  if (file) {
    return `file:${file}`;
  }
  const createdAt = asString(rec.createdAt).trim();
  const text = normalizeComparableText(
    asString(rec.text) ||
      asString(rec.content) ||
      asString(rec.reasoning) ||
      asString(rec.question) ||
      asString(rec.title) ||
      asString(rec.message),
  );
  if (createdAt || text) {
    return `text:${createdAt}|${text}`;
  }
  return `index:${index}`;
}

function mergeActivityArrays<T>(
  existing: T[] | undefined,
  incoming: T[] | undefined,
): T[] | undefined {
  const existingItems = Array.isArray(existing) ? existing : [];
  const incomingItems = Array.isArray(incoming) ? incoming : [];
  if (existingItems.length === 0) {
    return incomingItems.length > 0 ? incomingItems : undefined;
  }
  if (incomingItems.length === 0) {
    return existingItems;
  }

  const merged: T[] = [];
  const indexByKey = new Map<string, number>();
  [...existingItems, ...incomingItems].forEach((item, index) => {
    const key = activityArrayItemKey(item, index);
    const existingIndex = indexByKey.get(key);
    if (typeof existingIndex !== "number") {
      indexByKey.set(key, merged.length);
      merged.push(item);
      return;
    }
    const previous = merged[existingIndex];
    if (asRecord(previous) && asRecord(item)) {
      merged[existingIndex] = {
        ...(previous as Record<string, unknown>),
        ...(item as Record<string, unknown>),
      } as T;
    } else {
      merged[existingIndex] = item;
    }
  });

  return merged.length > 0 ? merged : undefined;
}

function mergeAssistantReplacement(existing: Message, incoming: Message): Message {
  const mergedBurst = coalesceAssistantHistoryBurst([existing, incoming]);
  const progressEvents = mergeAssistantActivitySteps(
    existing.progressEvents,
    incoming.progressEvents,
  );
  const steps = mergeAssistantActivitySteps(existing.steps, incoming.steps);
  const reasoningEvents = mergeActivityArrays(
    existing.reasoningEvents,
    incoming.reasoningEvents,
  );
  const edits = mergeActivityArrays(existing.edits, incoming.edits);
  const interactiveEvents = mergeActivityArrays(
    existing.interactiveEvents,
    incoming.interactiveEvents,
  );
  const subagents = mergeActivityArrays(existing.subagents, incoming.subagents);

  streamDebug("Timeline: merging assistant replacement", {
    existingMessageId: getMessageId(existing),
    incomingMessageId: getMessageId(incoming),
    existingSteps: summarizeStepListForLog(
      Array.isArray(existing.steps) ? existing.steps : [],
    ),
    incomingSteps: summarizeStepListForLog(
      Array.isArray(incoming.steps) ? incoming.steps : [],
    ),
    mergedSteps: summarizeStepListForLog(
      Array.isArray(steps) ? steps : [],
    ),
    existingProgressEvents: summarizeStepListForLog(
      Array.isArray(existing.progressEvents) ? existing.progressEvents : [],
    ),
    incomingProgressEvents: summarizeStepListForLog(
      Array.isArray(incoming.progressEvents) ? incoming.progressEvents : [],
    ),
    mergedProgressEvents: summarizeStepListForLog(
      Array.isArray(progressEvents) ? progressEvents : [],
    ),
  });

  return {
    ...mergedBurst,
    reasoningEvents,
    progressEvents,
    steps,
    edits,
    interactiveEvents,
    subagents,
  };
}

function replaceMatchingAssistantTurn(
  messages: Message[] | undefined,
  incoming: Message,
  candidateIds: Array<string | null | undefined>,
): Message[] {
  const safeMessages = messages || [];
  const ids = new Set(candidateIds.map((id) => asString(id)).filter(Boolean));
  if (ids.size === 0) {
    streamDebug("Timeline: assistant turn append without ID", {
      incomingMessageId: getMessageId(incoming),
      incomingSummary: summarizeMessageForLog(incoming),
      incomingSteps: summarizeStepListForLog(
        Array.isArray(incoming.steps) ? incoming.steps : [],
      ),
      incomingProgressEvents: summarizeStepListForLog(
        Array.isArray(incoming.progressEvents) ? incoming.progressEvents : [],
      ),
    });
    return [...safeMessages, incoming];
  }

  for (let index = safeMessages.length - 1; index >= 0; index -= 1) {
    const message = safeMessages[index];
    if (!isAssistantHistoryMessage(message)) {
      continue;
    }
    const id = getMessageId(message);
    if (!id || !ids.has(id)) {
      continue;
    }
    const next = [...safeMessages];
    streamDebug("Timeline: assistant turn matched and replacing", {
      matchedId: id,
      candidateIds: Array.from(ids),
      existingSummary: summarizeMessageForLog(message),
      incomingSummary: summarizeMessageForLog(incoming),
      existingSteps: summarizeStepListForLog(
        Array.isArray(message.steps) ? message.steps : [],
      ),
      incomingSteps: summarizeStepListForLog(
        Array.isArray(incoming.steps) ? incoming.steps : [],
      ),
      existingProgressEvents: summarizeStepListForLog(
        Array.isArray(message.progressEvents) ? message.progressEvents : [],
      ),
      incomingProgressEvents: summarizeStepListForLog(
        Array.isArray(incoming.progressEvents) ? incoming.progressEvents : [],
      ),
    });
    next[index] = mergeAssistantReplacement(message, incoming);
    return next;
  }

  streamDebug("Timeline: assistant turn append without match", {
    candidateIds: Array.from(ids),
    incomingMessageId: getMessageId(incoming),
    incomingSummary: summarizeMessageForLog(incoming),
    incomingSteps: summarizeStepListForLog(
      Array.isArray(incoming.steps) ? incoming.steps : [],
    ),
    incomingProgressEvents: summarizeStepListForLog(
      Array.isArray(incoming.progressEvents) ? incoming.progressEvents : [],
    ),
  });
  return [...safeMessages, incoming];
}

// Updated handler to use modular system
function handleSubagentUpdatesFromCentralizedEvents(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState
): void {
  const currentState = getState();

  // Only the active stream has raw events. Completed turns are reconstructed
  // from `session.messages()` and carry their subtask parts on Message.
  const sessionEvents = currentState.streaming?.rawSdkEventPayloads ?? [];

  // Use the modular extraction system
  const { summariesByParentMessageId, detailsById } =
    modularExtractSubagentsFromCentralizedEvents(sessionEvents);

  // Dispatch updates to store
  if (Object.keys(summariesByParentMessageId).length > 0) {
    dispatch({
      type: "UPSERT_SUBAGENT_SUMMARIES",
      payload: summariesByParentMessageId,
    });
  }

  if (Object.keys(detailsById).length > 0) {
    dispatch({ type: "UPSERT_SUBAGENT_DETAIL", payload: detailsById });
  }
}
function syncSubagentMapsIntoMessages(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  summariesByParentMessageId: Record<string, SubagentSummary[]>,
  detailsById: Record<string, SubagentDetail>,
  mode: "merge" | "replace",
  options?: { freezeIncompleteStatuses?: boolean; presentationPolicy?: SubagentPresentationPolicy },
): void {
  const state = getState();
  const allSummariesByParentMessageId =
    mode === "replace"
      ? summariesByParentMessageId
      : {
        ...state.subagentsByParentMessageId,
        ...summariesByParentMessageId,
      };
  const allDetailsById =
    mode === "replace"
      ? detailsById
      : {
        ...state.subagentDetailsById,
        ...detailsById,
      };

  const messageIds = new Set<string>();
  if (state.messages && state.messages.length > 0) {
    state.messages.forEach((message) => {
      const messageId = getMessageId(message);
      if (messageId) {
        messageIds.add(messageId);
      }
    });
  }

  // Rebind orphaned summary groups (usually keyed by transient streaming IDs)
  // to the latest assistant message for the same session so cards survive
  // reload/session hydration even when final message IDs differ.
  const effectiveSummariesByParentMessageId: Record<string, SubagentSummary[]> = {
    ...allSummariesByParentMessageId,
  };
  for (const [parentMessageId, summaries] of Object.entries(
    allSummariesByParentMessageId,
  )) {
    if (!Array.isArray(summaries) || summaries.length === 0) {
      continue;
    }
    if (messageIds.has(parentMessageId)) {
      continue;
    }

    // DISABLED: Rebounding subagents to the 'latest' message causes 'ghosting'
    // where old subagents appear in new responses. Only allow direct ID matches.
    continue;
  }

  const updatedMessages: Message[] = [];
  let hasChanges = false;
  const nextMessages = (state.messages || []).map((message) => {
    const messageId = getMessageId(message);
    if (!messageId) {
      return message;
    }
    const summaries = effectiveSummariesByParentMessageId[messageId];
    if (!Array.isArray(summaries) || summaries.length === 0) {
      return message;
    }
    const freezeIncompleteStatuses =
      options?.freezeIncompleteStatuses === true ||
      policyAwareFreeze(
        summaries,
        allDetailsById,
        message,
        options?.presentationPolicy,
      );
    const hydratedSubagents = summaries.map((summary) =>
      normalizeHydratedSubagentDetail(
        hydrateSubagentSummary(summary, allDetailsById),
        message,
        freezeIncompleteStatuses,
      ),
    );
    if (areSubagentListsEquivalent(message.subagents, hydratedSubagents)) {
      return message;
    }

    hasChanges = true;
    const nextMessage: Message = {
      ...message,
      subagents: hydratedSubagents,
    };
    updatedMessages.push(nextMessage);
    return nextMessage;
  });

  if (!hasChanges) {
    return;
  }

  dispatch({ type: "SET_MESSAGES", payload: nextMessages });
}

function getSubagentPayloadSessionId(
  summariesByParentMessageId: Record<string, SubagentSummary[]>,
  detailsById: Record<string, SubagentDetail>,
): string | null {
  for (const summaries of Object.values(summariesByParentMessageId)) {
    if (!Array.isArray(summaries)) {
      continue;
    }
    for (const summary of summaries) {
      if (
        typeof summary?.parentSessionId === "string" &&
        summary.parentSessionId.length > 0
      ) {
        return summary.parentSessionId;
      }
    }
  }

  for (const detail of Object.values(detailsById)) {
    if (
      typeof detail?.parentSessionId === "string" &&
      detail.parentSessionId.length > 0
    ) {
      return detail.parentSessionId;
    }
  }

  return null;
}

function filterSubagentMapsForActiveSession(
  state: AppState,
  summariesByParentMessageId: Record<string, SubagentSummary[]>,
  detailsById: Record<string, SubagentDetail>,
): {
  summariesByParentMessageId: Record<string, SubagentSummary[]>;
  detailsById: Record<string, SubagentDetail>;
} {
  const activeSessionId = state.currentSessionId;
  if (!activeSessionId) {
    return { summariesByParentMessageId, detailsById };
  }

  const currentMessageIds = new Set<string>();
  if (state.messages && state.messages.length > 0) {
    state.messages.forEach((message) => {
      const messageId = getMessageId(message);
      if (messageId) {
        currentMessageIds.add(messageId);
      }
    });
  }
  const streamingMessageId = state.streaming?.messageId || null;

  const filteredSummariesByParentMessageId: Record<string, SubagentSummary[]> = {};
  const includedSubagentIds = new Set<string>();
  for (const [parentMessageId, summaries] of Object.entries(
    summariesByParentMessageId,
  )) {
    if (!Array.isArray(summaries) || summaries.length === 0) {
      continue;
    }

    const filtered = summaries.filter((summary) => {
      const explicitSessionId =
        typeof summary.parentSessionId === "string" &&
        summary.parentSessionId.length > 0
          ? summary.parentSessionId
          : null;
      if (explicitSessionId) {
        return explicitSessionId === activeSessionId;
      }
      return (
        currentMessageIds.has(summary.parentMessageId) ||
        (streamingMessageId !== null &&
          summary.parentMessageId === streamingMessageId)
      );
    });

    if (filtered.length === 0) {
      continue;
    }

    filteredSummariesByParentMessageId[parentMessageId] = filtered;
    filtered.forEach((entry) => {
      includedSubagentIds.add(entry.id);
    });
  }

  const filteredDetailsById: Record<string, SubagentDetail> = {};
  for (const [detailId, detail] of Object.entries(detailsById)) {
    if (includedSubagentIds.has(detailId)) {
      filteredDetailsById[detailId] = detail;
      continue;
    }
    if (
      typeof detail.parentSessionId === "string" &&
      detail.parentSessionId === activeSessionId
    ) {
      filteredDetailsById[detailId] = detail;
    }
  }

  return {
    summariesByParentMessageId: filteredSummariesByParentMessageId,
    detailsById: filteredDetailsById,
  };
}

function deriveSessionIdFromMessage(
  message: Message,
  fallbackSessionId: string | null,
): string | null {
  const info = asRecord(message.info);
  const infoSessionId =
    asString(info?.sessionID) || asString(info?.sessionId);
  if (infoSessionId) {
    return infoSessionId;
  }

  if (Array.isArray(message.subagents)) {
    for (const subagent of message.subagents) {
      const sessionId = asString(asRecord(subagent)?.parentSessionId);
      if (sessionId) {
        return sessionId;
      }
    }
  }

  return fallbackSessionId;
}

function extractMessageText(message: Message): string {
  const rec = asRecord(message);
  if (!rec) {
    return '';
  }
  const canonicalStructuredMessage = getCanonicalStructuredMessageText(message);
  if (canonicalStructuredMessage) {
    return canonicalStructuredMessage;
  }

  if (typeof rec.content === 'string' && rec.content.trim()) {
    return rec.content;
  }
  if (typeof rec.text === 'string' && rec.text.trim()) {
    return rec.text;
  }

  const parts = Array.isArray(rec.parts) ? rec.parts : [];
  const fromParts = contentFromParts(parts);
  if (fromParts) {
    return fromParts;
  }

  const summary = summaryText(rec.info);
  if (summary) {
    return summary;
  }

  // Reasoning is timeline-only. Returning it as a generic text fallback lets
  // a reasoning-only SDK envelope be mistaken for assistant response content
  // by hydration/deduplication paths, leaking thought text into the bubble.
  return "";
}

function isInternalSystemReminderMessage(message: Message): boolean {
  const role = asString(message.role) || asString(asRecord(message.info)?.role);
  const normalizedRole = role.toLowerCase().trim();
  if (normalizedRole !== "user" && normalizedRole !== "system") {
    return false;
  }

  const text = extractMessageText(message).trim();
  if (!text) {
    return false;
  }
  if (/\bproceed on this plan\./i.test(text)) {
    return false;
  }

  const normalizedText = text.toLowerCase();

  // Check for square-bracketed system messages at the start (e.g., [analyze-mode], [background task completed])
  const bracketPattern = /^\[[a-z][a-z0-9_\- ]*\]/i;
  const hasBracketPrefix = bracketPattern.test(text);
  // OpenCode can carry server-authored directives as user-role transport
  // envelopes. Treat a leading XML-like tag (for example `<analysis>`) the
  // same way as the existing bracketed directive forms.
  const angleTagPattern = /^<[a-z][a-z0-9_\-]*>/i;
  const hasAngleTagPrefix = angleTagPattern.test(text);

  return (
    normalizedText.includes("<system-reminder>") ||
    normalizedText.includes("<auto-slash-command>") ||
    normalizedText.includes("<!-- omo_internal_initiator -->") ||
    hasBracketPrefix ||
    hasAngleTagPrefix ||
    (normalizedText.includes("[search-model]") &&
      normalizedText.includes("maximize search effort"))
  );
}

function hasRenderableHistoryPayload(message: Message): boolean {
  // Don't filter out system reminder messages - they will be converted to system role
  // and rendered with the SystemMessage component
  // if (isInternalSystemReminderMessage(message)) {
  //   return false;
  // }

  // FIX: Check assistant messages with parts FIRST, before any other checks.
  // This ensures question-type messages with parts but no text content are preserved.
  // Prevents regression where assistant messages disappear after session restart.
  const role = asString(message.role) || asString(asRecord(message.info)?.role);
  if (role === "assistant" && Array.isArray(message.parts) && message.parts.length > 0) {
    return true;
  }

  const text = extractMessageText(message).trim();
  if (text.length > 0) {
    return true;
  }

  if (Array.isArray(message.images) && message.images.length > 0) {
    return true;
  }
  if (
    Array.isArray((message as unknown as UnknownRecord).attachments) &&
    ((message as unknown as UnknownRecord).attachments as unknown[]).length > 0
  ) {
    return true;
  }
  if (Array.isArray(message.subagents) && message.subagents.length > 0) {
    return true;
  }
  if (
    Array.isArray(message.interactiveEvents) &&
    message.interactiveEvents.length > 0
  ) {
    return true;
  }
  if (interactiveEventsFromMessage(message).length > 0) {
    return true;
  }
  if (Array.isArray(message.reasoningEvents) && message.reasoningEvents.length > 0) {
    return true;
  }
  if (Array.isArray(message.progressEvents) && message.progressEvents.length > 0) {
    return true;
  }
  if (Array.isArray(message.steps) && message.steps.length > 0) {
    return true;
  }
  if (Array.isArray(message.edits) && message.edits.length > 0) {
    return true;
  }
  if (
    typeof (message as unknown as UnknownRecord).error === 'string' &&
    asString((message as unknown as UnknownRecord).error).trim().length > 0
  ) {
    return true;
  }
  if (message.plan && typeof message.plan === 'object') {
    return true;
  }
  if (message.walkthrough && typeof message.walkthrough === 'object') {
    return true;
  }

  // Preserve assistant turns that only contain activity parts
  // (tool/reasoning/step/patch) so reload matches stream-time rendering.
  // Note: This check is now redundant since we moved it to the top,
  // but kept for clarity and backwards compatibility.

  if (Array.isArray(message.parts)) {
    return message.parts.some((part) => {
      const rec = asRecord(part);
      if (!rec) {
        return false;
      }
      return (
        asString(rec.filename).length > 0 ||
        asString(asRecord(rec.source)?.path).length > 0 ||
        asString(rec.url).length > 0
      );
    });
  }

  return false;
}

function isRenderableHistoryMessage(message: Message): boolean {
  const role = asString(message.role) || asString(asRecord(message.info)?.role);
  const hasPayload = hasRenderableHistoryPayload(message);
  if (role === 'user' || role === 'assistant') {
    return hasPayload;
  }
  return hasPayload;
}

function isAssistantHistoryMessage(message: Message | undefined): boolean {
  if (!message) {
    return false;
  }
  const role = asString(message.role) || asString(asRecord(message.info)?.role);
  return role.toLowerCase().trim() === "assistant";
}

function messagePartFingerprint(part: MessagePart): string {
  const rec = asRecord(part);
  if (!rec) {
    return "unknown";
  }
  const type = asString(rec.type).toLowerCase() || "unknown";
  const callId = asString(rec.callID) || asString(rec.callId);
  const tool = asString(rec.tool);
  const state = asRecord(rec.state);
  const status = asString(state?.status) || asString(rec.status);
  const title = asString(rec.title) || asString(state?.title);
  const filePath =
    asString(rec.filePath) ||
    asString(asRecord(state?.input)?.file) ||
    asString(asRecord(state?.input)?.path);
  const text = asRichString(rec.text || rec.content || rec.delta || rec.reasoning)
    .trim()
    .slice(0, 160);
  return [type, callId, tool, status, title, filePath, text].join("|");
}

function isTextLikePart(part: MessagePart): boolean {
  const rec = asRecord(part);
  if (!rec) {
    return false;
  }
  const type = asString(rec.type).toLowerCase();
  if (type === "text") {
    return true;
  }
  return (
    typeof rec.text === "string" ||
    typeof rec.content === "string" ||
    typeof rec.delta === "string"
  );
}

function coalesceAssistantHistoryBurst(burst: Message[]): Message {
  const base = {
    ...(burst[burst.length - 1] || burst[0]),
  } as Message;
  const burstParentId =
    burst.map((message) => getMessageParentId(message)).find((value): value is string => !!value) ?? null;
  if (burstParentId) {
    base.info = {
      ...(base.info ?? {}),
      parentID: firstNonEmptyString(
        asString(asRecord(base.info)?.parentID),
        asString(asRecord(base.info)?.parentId),
        burstParentId,
      ),
    };
  }
  const wasAborted = burst.some(
    (message) =>
      message?.aborted === true ||
      asRecord(message)?.aborted === true ||
      asRecord(asRecord(message)?.info)?.aborted === true,
  );
  const mergedParts: MessagePart[] = [];
  const seenPartFingerprints = new Set<string>();
  const seenReasoning = new Set<string>();
  const seenProgress = new Set<string>();
  const seenSteps = new Set<string>();
  const seenEdits = new Set<string>();
  let latestText = "";
  let latestTextScore = 0;
  let latestTextPart: MessagePart | undefined;
  let latestInteractiveEvents: InteractiveEvent[] | undefined;
  let latestPlan = base.plan;
  let latestWalkthrough = base.walkthrough;
  const subagentsByMessageId = new Map<string, Message["subagents"]>();
  let latestSubagentsWithoutMessageId: Message["subagents"] | undefined;
  let latestError = asString((base as unknown as UnknownRecord).error);
  // Rebuild the centralized raw tape in burst order so hydration matches the
  // exact stream chronology instead of inheriting the newest assistant turn.
  let mergedRawSdkEventPayloads: unknown[] | undefined;
  // Assistant phases arrive as separate SDK envelopes. The final structured
  // response is commonly nested under info.structured on the last envelope;
  // never let burst coalescing discard it just because an earlier phase used a
  // different field location. This is a preservation rule, not a dedupe rule.
  let latestStructuredOutput = asRecord(
    resolveStructuredOutputFromMessageRecord(base as unknown as UnknownRecord),
  );
  const mergeStructuredOutputRecords = (
    existing: UnknownRecord | null,
    incoming: UnknownRecord | null,
  ): UnknownRecord | null => {
    if (!existing && !incoming) {
      return null;
    }
    if (!existing) {
      return incoming ? { ...incoming } : null;
    }
    if (!incoming) {
      return existing ? { ...existing } : null;
    }

    const existingFileChanges = Array.isArray(existing.fileChanges)
      ? existing.fileChanges
      : [];
    const incomingFileChanges = Array.isArray(incoming.fileChanges)
      ? incoming.fileChanges
      : [];
    const mergedFileChanges =
      incomingFileChanges.length >= existingFileChanges.length
        ? incomingFileChanges
        : existingFileChanges;

    return {
      ...existing,
      ...incoming,
      ...(mergedFileChanges.length > 0 ? { fileChanges: mergedFileChanges } : {}),
    };
  };
  let canonicalMessageId: string | null = getMessageId(base);

  const appendReasoningEvent = (event: ReasoningEvent) => {
    const key = `${asNumber(event.createdAt)}|${normalizeComparableText(asString(event.text))}`;
    if (seenReasoning.has(key)) {
      return;
    }
    seenReasoning.add(key);
    const list = Array.isArray(base.reasoningEvents) ? base.reasoningEvents : [];
    base.reasoningEvents = [...list, event];
  };

  const appendProgressEvent = (event: MessageStep) => {
    const key = [
      asString(event.id),
      asString(event.callID),
      normalizeComparableText(asString(event.title)),
      asString(event.status),
      asString(event.filePath),
      asString(event.meta),
      asNumber(event.streamSeq),
    ].join("|");
    if (seenProgress.has(key)) {
      return;
    }
    seenProgress.add(key);
    const list = Array.isArray(base.progressEvents) ? base.progressEvents : [];
    base.progressEvents = [...list, event];
  };

  const appendStep = (step: MessageStep) => {
    const key = [
      asString(step.id),
      asString(step.callID),
      normalizeComparableText(asString(step.title)),
      asString(step.status),
      asString(step.filePath),
      asString(step.meta),
      asNumber(step.streamSeq),
    ].join("|");
    if (seenSteps.has(key)) {
      return;
    }
    seenSteps.add(key);
    const list = Array.isArray(base.steps) ? base.steps : [];
    base.steps = [...list, step];
  };

  const appendEdit = (edit: { file: string; added?: number; deleted?: number }) => {
    const key = normalizeComparableText(asString(edit.file));
    if (!key || seenEdits.has(key)) {
      return;
    }
    seenEdits.add(key);
    const list = Array.isArray(base.edits) ? base.edits : [];
    base.edits = [...list, edit];
  };

  for (const message of burst) {
    if (!message || typeof message !== "object") {
      continue;
    }

    const messageId = getMessageId(message);
    if (messageId) {
      canonicalMessageId = messageId;
      const baseRec = base as unknown as Record<string, unknown>;
      // We must preserve all message IDs merged during this burst so that 
      // the centralized event loop can properly map streamed events that 
      // were tagged with earlier IDs (e.g. reasoning or step events prior 
      // to a tool call finishing).
      if (!Array.isArray(baseRec.coalescedIds)) {
        baseRec.coalescedIds = [];
      }
      if (!baseRec.coalescedIds.includes(messageId)) {
        baseRec.coalescedIds.push(messageId);
      }
    }

    const content = extractRenderableAssistantTextForHydration(message).trim();
    if (content.length > 0) {
      const candidateTextScore =
        content.length + (isCanonicalAssistantDisplayMessage(message) ? 100000 : 0);
      if (candidateTextScore >= latestTextScore) {
        latestTextScore = candidateTextScore;
        latestText = content;
        latestTextPart = Array.isArray(message.parts)
          ? message.parts.find((part) => {
              const rec = asRecord(part);
              return !!rec && isRenderableAssistantTextPart(rec);
            })
          : undefined;
      }
    }

    if (
      Array.isArray(message.interactiveEvents) &&
      message.interactiveEvents.length > 0
    ) {
      latestInteractiveEvents = message.interactiveEvents;
    }
    if (message.plan && typeof message.plan === "object") {
      latestPlan = message.plan;
    }
    if (message.walkthrough && typeof message.walkthrough === "object") {
      latestWalkthrough = message.walkthrough;
    }
    if (Array.isArray(message.subagents) && message.subagents.length > 0) {
      if (messageId) {
        subagentsByMessageId.set(messageId, message.subagents);
      } else {
        latestSubagentsWithoutMessageId = message.subagents;
      }
    }
    const errorText = asString((message as unknown as UnknownRecord).error);
    if (errorText) {
      latestError = errorText;
    }
    if (Array.isArray((message as unknown as UnknownRecord).rawSdkEventPayloads)) {
      const rawSdkEventPayloads = (message as unknown as UnknownRecord).rawSdkEventPayloads as unknown[];
      if (rawSdkEventPayloads.length > 0) {
        mergedRawSdkEventPayloads = mergeRawSdkEventPayloads(
          mergedRawSdkEventPayloads,
          rawSdkEventPayloads,
        );
      }
    }
    const structured = asRecord(
      resolveStructuredOutputFromMessageRecord(message as unknown as UnknownRecord),
    );
    if (structured) {
      latestStructuredOutput = mergeStructuredOutputRecords(
        latestStructuredOutput,
        structured,
      );
    }

    if (Array.isArray(message.parts)) {
      for (const part of message.parts) {
        if (isTextLikePart(part)) {
          continue;
        }
        const key = messagePartFingerprint(part);
        if (seenPartFingerprints.has(key)) {
          continue;
        }
        seenPartFingerprints.add(key);
        mergedParts.push(part);
      }
    }

    if (Array.isArray(message.reasoningEvents)) {
      message.reasoningEvents.forEach(appendReasoningEvent);
    }
    if (Array.isArray(message.progressEvents)) {
      message.progressEvents.forEach(appendProgressEvent);
    }
    if (Array.isArray(message.steps)) {
      message.steps.forEach(appendStep);
    }
    if (Array.isArray(message.edits)) {
      message.edits.forEach(appendEdit);
    }
  }

  if (latestText.length > 0) {
    const source = asRecord(latestTextPart) ?? {};
    mergedParts.push({
      ...source,
      type: "text",
      text: latestText,
    } as MessagePart);
    base.content = latestText;
    base.text = latestText;
  }

  if (mergedParts.length > 0) {
    base.parts = mergedParts;
  }
  if (latestInteractiveEvents) {
    base.interactiveEvents = latestInteractiveEvents;
  }
  if (latestPlan) {
    base.plan = latestPlan;
  }
  if (latestWalkthrough) {
    base.walkthrough = latestWalkthrough;
  }
  const hasPlanAttachment =
    !!base.plan &&
    typeof base.plan === "object" &&
    !!(
      asString(base.plan.file).trim() ||
      asString(base.plan.content).trim() ||
      (Array.isArray(base.plan.files) && base.plan.files.length > 0)
    );
  if (hasPlanAttachment) {
    base.responseType = "implementation_plan";
    const structuredOut = asRecord(
      (base as unknown as UnknownRecord).structuredOutput,
    );
    if (structuredOut) {
      (base as unknown as UnknownRecord).structuredOutput = {
        ...structuredOut,
        responseType: "implementation_plan",
      };
    }
  }
  const scopedSubagents = (() => {
    let candidate: Message["subagents"] | undefined;
    if (canonicalMessageId) {
      candidate = subagentsByMessageId.get(canonicalMessageId);
    } else {
      candidate = latestSubagentsWithoutMessageId;
    }
    if (!Array.isArray(candidate) || candidate.length === 0) {
      return undefined;
    }
    if (!canonicalMessageId) {
      return candidate;
    }
    const filtered = candidate.filter((entry) => {
      const parentMessageId = asString(asRecord(entry)?.parentMessageId);
      return !parentMessageId || parentMessageId === canonicalMessageId;
    });
    return filtered.length > 0 ? filtered : undefined;
  })();
  // Subagent sync to messages disabled - using centralized events as single source of truth
  // Subagents should only come from the centralized store, not from message.subagents
  // if (scopedSubagents) {
  //   base.subagents = scopedSubagents;
  // } else {
  //   delete (base as UnknownRecord).subagents;
  // }
  if (latestError) {
    (base as unknown as UnknownRecord).error = latestError;
  }
  if (latestStructuredOutput) {
    (base as unknown as UnknownRecord).structuredOutput = latestStructuredOutput;
  }
  if (Array.isArray(mergedRawSdkEventPayloads) && mergedRawSdkEventPayloads.length > 0) {
    (base as unknown as UnknownRecord).rawSdkEventPayloads = mergedRawSdkEventPayloads;
  }

  if (canonicalMessageId) {
    base.id = canonicalMessageId;
    const infoRec = asRecord(base.info);
    base.info = infoRec
      ? { ...infoRec, id: canonicalMessageId }
      : ({ id: canonicalMessageId } as Record<string, unknown>);
  }

  if (wasAborted || base.aborted === true) {
    base.aborted = true;
    const infoRec = asRecord(base.info) || {};
    base.info = { ...infoRec, aborted: true };
  }

  return base;
}

export function rawSdkEventPayloadFingerprint(value: unknown): string {
  const rec = asRecord(value);
  if (!rec) {
    return `primitive:${String(value)}`;
  }
  const payloadRecord = asRecord(rec.payload);
  const eventToParse = payloadRecord ?? rec;
  const identity = normalizedCentralizedEventIdentity(rec);
  if (identity) {
    const syncEvent = asRecord(payloadRecord?.syncEvent) ?? asRecord(rec.syncEvent);
    const seq = asString(rec.seq, syncEvent?.seq, payloadRecord?.seq);
    if (seq) {
      return `identity:${identity}|seq:${seq}`;
    }
    return `identity:${identity}`;
  }
  const id = asString(eventToParse.id);
  if (id) {
    return `id:${id}`;
  }
  const properties = asRecord(eventToParse.properties);
  const type = asString(eventToParse.type);
  const part = asRecord(properties?.part);
  const info = asRecord(properties?.info);
  const messageId = asString(
    eventToParse.messageID,
    eventToParse.messageId,
    properties?.messageID,
    properties?.messageId,
    part?.messageID,
    part?.messageId,
    info?.messageID,
    info?.messageId,
  );
  const partId = asString(
    eventToParse.partID,
    eventToParse.partId,
    properties?.partID,
    properties?.partId,
    part?.id,
    part?.partID,
    part?.partId,
  );
  const time = asString(eventToParse.time, properties?.time);
  return `${type}|${messageId}|${partId}|${time}|${String(value)}`;
}

export function mergeRawSdkEventPayloads(
  preferred: unknown[] | undefined,
  alternate: unknown[] | undefined,
): unknown[] | undefined {
  const merged: unknown[] = [];
  const seen = new Set<string>();
  for (const source of [preferred, alternate]) {
    if (!Array.isArray(source) || source.length === 0) {
      continue;
    }
    for (let i = source.length - 1; i >= 0; i--) {
      const item = source[i];
      const key = rawSdkEventPayloadFingerprint(item);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(item);
    }
  }
  merged.reverse();
  return merged.length > 0 ? merged : undefined;
}

export function coalesceAdjacentAssistantHistoryMessages(messages: Message[]): Message[] {
  if (!Array.isArray(messages) || messages.length <= 1) {
    return messages;
  }

  const out: Message[] = [];
  let index = 0;
  while (index < messages.length) {
    const current = messages[index];
    if (!isAssistantHistoryMessage(current)) {
      out.push(current);
      index += 1;
      continue;
    }

    const burst: Message[] = [current];
    let burstKey = assistantHistoryBurstKey(current);
    let cursor = index + 1;
    while (cursor < messages.length && isAssistantHistoryMessage(messages[cursor])) {
      const next = messages[cursor];
      if (!canCoalesceAssistantHistoryMessages(burst[burst.length - 1], next)) {
        break;
      }
      const nextKey = assistantHistoryBurstKey(next);
      if (
        burstKey !== "__unparented_assistant_burst__" &&
        nextKey !== "__unparented_assistant_burst__" &&
        burstKey !== nextKey
      ) {
        break;
      }
      if (burstKey === "__unparented_assistant_burst__") {
        burstKey = nextKey;
      }
      burst.push(next);
      cursor += 1;
    }

    if (burst.length === 1) {
      out.push(current);
    } else {
      out.push(coalesceAssistantHistoryBurst(burst));
    }
    index = cursor;
  }

  return out;
}

function summarizeRenderMessageForDebug(message: Message, index: number): Record<string, unknown> {
  const info = asRecord(message.info);
  const structured = asRecord((message as unknown as UnknownRecord).structuredOutput);
  const text = extractMessageText(message).trim();
  return {
    index,
    id: getMessageId(message),
    role: asString(message.role) || asString(info?.role) || "unknown",
    responseType: asString(structured?.type ?? structured?.responseType).toLowerCase() || undefined,
    textLength: text.length,
    textPreview: text ? text.slice(0, 160) : undefined,
    hasPlan: !!message.plan,
    subagentCount: Array.isArray(message.subagents) ? message.subagents.length : 0,
    interactiveCount: Array.isArray(message.interactiveEvents) ? message.interactiveEvents.length : 0,
    partCount: Array.isArray(message.parts) ? message.parts.length : 0,
  };
}

function logRenderSnapshot(source: string, messages: Message[]): void {
  void source;
  void messages;
}

function logSourceSnapshot(source: string, messages: Message[] | unknown[]): void {
  void source;
  void messages;
}

function logFullPayloadSnapshot(
  stage: "SOURCE" | "PRE-RENDER",
  source: string,
  payload: Record<string, unknown>,
): void {
  void stage;
  void source;
  void payload;
}

function stripChoicePrefix(input: string): string {
  return input
    .replace(/^(?:[-*]|\u2022)\s+/, '')
    .replace(/^\d{1,2}[.)]\s+/, '')
    .replace(/^[a-zA-Z][.)]\s+/, '')
    .replace(/^>\s*/, '')
    .trim();
}

function stripMarkdownFormatting(input: string): string {
  return input
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isLikelyYesNoQuestion(question: string): boolean {
  return /^(do|does|did|is|are|was|were|can|could|should|would|will|have|has|had|may|might|am)\b/i.test(
    question.trim(),
  );
}

function normalizeChoiceFromLine(line: string, index: number): InteractiveChoice | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  const hasListPrefix = /^(?:[-*]|\u2022|\d{1,2}[.)]|[a-zA-Z][.)])\s+/.test(
    trimmed,
  );
  const hasLabelColon = /^[*_`"'(]*[A-Za-z][^?]{0,40}:\s+\S+/.test(trimmed);

  const candidate = stripMarkdownFormatting(stripChoicePrefix(trimmed));
  if (!hasListPrefix && !hasLabelColon) {
    const plainWords = candidate.split(/\s+/).filter(Boolean);
    const plainAllowed =
      candidate.length > 0 &&
      candidate.length <= 32 &&
      plainWords.length > 0 &&
      plainWords.length <= 4 &&
      /^[A-Za-z0-9 /+._-]+$/.test(candidate) &&
      !/[\\/]/.test(candidate);
    if (!plainAllowed) {
      return undefined;
    }
  }

  if (!candidate || candidate.length > 140 || candidate.includes('?')) {
    return undefined;
  }

  const looksPathLike =
    /(?:^|[\s"'`])(?:[A-Za-z]:\\|\.{0,2}[\\/]|[\w-]+[\\/][\w./\\-]+\.[A-Za-z0-9]{1,8})/.test(
      candidate,
    );
  if (looksPathLike && !hasLabelColon) {
    return undefined;
  }
  if (
    /auto-generated|generated file|timestamp/i.test(candidate) &&
    !/^(yes|no)\b/i.test(candidate)
  ) {
    return undefined;
  }

  let label = candidate;
  let description: string | undefined;
  const colonIndex = candidate.indexOf(':');
  if (colonIndex > 0 && colonIndex < 44) {
    label = candidate.slice(0, colonIndex).trim();
    const rest = candidate.slice(colonIndex + 1).trim();
    description = rest || undefined;
  }

  label = label.replace(/[.,;:]$/, '').trim();
  if (!label || label.length < 2 || label.split(/\s+/).length > 8) {
    return undefined;
  }

  return {
    id: `auto-opt-${index}`,
    label,
    value: label,
    description
  };
}

function dedupeChoices(choices: InteractiveChoice[]): InteractiveChoice[] {
  const out: InteractiveChoice[] = [];
  const seen = new Set<string>();
  choices.forEach((choice) => {
    const key = `${choice.label}::${choice.value || choice.label}`.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(choice);
  });
  return out;
}

function collectOptionsInDirection(
  lines: string[],
  startIndex: number,
  step: 1 | -1,
  maxScanDistance = 8
): InteractiveChoice[] {
  const collected: InteractiveChoice[] = [];
  let scanned = 0;
  for (let index = startIndex; index >= 0 && index < lines.length && scanned < maxScanDistance; index += step) {
    scanned += 1;
    const line = lines[index].trim();
    if (!line) {
      if (collected.length > 0) {
        break;
      }
      continue;
    }
    if (line.includes('?')) {
      if (collected.length > 0) {
        break;
      }
      continue;
    }

    const option = normalizeChoiceFromLine(line, collected.length);
    if (!option) {
      if (collected.length > 0) {
        break;
      }
      continue;
    }
    collected.push(option);
    if (collected.length >= 6) {
      break;
    }
  }

  if (step === -1) {
    collected.reverse();
  }
  return collected;
}

function extractInlineOrChoices(question: string): InteractiveChoice[] {
  const cleanQuestion = question.replace(/[?!.\s]+$/, '').trim();
  if (!/\bor\b/i.test(cleanQuestion)) {
    return [];
  }

  const useMatch = cleanQuestion.match(
    /\b(?:use|choose|pick|select|prefer|want)\s+([A-Za-z][A-Za-z0-9+._/-]{1,30})\s+or\s+([A-Za-z][A-Za-z0-9+._/-]{1,30})\b/i
  );
  if (useMatch) {
    const first = useMatch[1];
    const second = useMatch[2];
    return [
      { id: 'auto-opt-0', label: first, value: first },
      { id: 'auto-opt-1', label: second, value: second }
    ];
  }

  const genericMatch = cleanQuestion.match(
    /\b([A-Za-z][A-Za-z0-9+._/-]{1,30})\b\s+or\s+\b([A-Za-z][A-Za-z0-9+._/-]{1,30})\b/i
  );
  if (!genericMatch) {
    return [];
  }
  const first = genericMatch[1];
  const second = genericMatch[2];
  if (first.length < 2 || second.length < 2) {
    return [];
  }
  return [
    { id: 'auto-opt-0', label: first, value: first },
    { id: 'auto-opt-1', label: second, value: second }
  ];
}

function detectInteractiveEventsFromText(_text: string, _message: Message): InteractiveEvent[] {
  return [];
}

function interactiveEventsFromMessage(message: Message): InteractiveEvent[] {
  const role = asString(message.role) || asString(asRecord(message.info)?.role);
  if (role && role !== 'assistant') {
    return [];
  }

  if (Array.isArray(message.interactiveEvents) && message.interactiveEvents.length > 0) {
    return dedupeInteractiveEvents(message.interactiveEvents);
  }
  const rec = asRecord(message);
  if (!rec) {
    return [];
  }
  const structured = resolveStructuredOutputFromMessageRecord(rec);
  const fromStructured = toInteractiveEvents(structured);
  if (fromStructured.length > 0) {
    return dedupeInteractiveEvents(fromStructured);
  }

  const infoRec = asRecord(rec.info);
  const topLevelResponseType =
    asString(rec.responseType) ||
    asString(infoRec?.responseType) ||
    asString(asRecord(rec.structuredOutput)?.responseType) ||
    asString(asRecord(rec.structured_output)?.responseType) ||
    asString(asRecord(rec.structured)?.responseType) ||
    asString(asRecord(infoRec?.structuredOutput)?.responseType) ||
    asString(asRecord((infoRec as UnknownRecord | null)?.structured_output)?.responseType) ||
    asString(asRecord((infoRec as UnknownRecord | null)?.structured)?.responseType);
  const hasQuestionLikePayload =
    topLevelResponseType.toLowerCase() === "question" ||
    typeof rec.question !== "undefined" ||
    typeof infoRec?.question !== "undefined" ||
    typeof asRecord(rec.structuredOutput)?.question !== "undefined" ||
    typeof asRecord(rec.structured_output)?.question !== "undefined" ||
    typeof asRecord(rec.structured)?.question !== "undefined" ||
    typeof asRecord(infoRec?.structuredOutput)?.question !== "undefined" ||
    typeof asRecord((infoRec as UnknownRecord | null)?.structured_output)?.question !== "undefined" ||
    typeof asRecord((infoRec as UnknownRecord | null)?.structured)?.question !== "undefined";
  if (hasQuestionLikePayload) {
    const fallbackStructured = normalizeStructuredOutput({
      responseType: topLevelResponseType || "question",
      question:
        rec.question ??
        infoRec?.question ??
        asRecord(rec.structuredOutput)?.question ??
        asRecord(rec.structured_output)?.question ??
        asRecord(rec.structured)?.question ??
        asRecord(infoRec?.structuredOutput)?.question ??
        asRecord((infoRec as UnknownRecord | null)?.structured_output)?.question ??
        asRecord((infoRec as UnknownRecord | null)?.structured)?.question,
      options:
        (rec as UnknownRecord).options ??
        (infoRec as UnknownRecord | null)?.options,
      choices:
        (rec as UnknownRecord).choices ??
        (infoRec as UnknownRecord | null)?.choices,
      actions:
        (rec as UnknownRecord).actions ??
        (infoRec as UnknownRecord | null)?.actions,
      interactiveEvents:
        (rec as UnknownRecord).interactiveEvents ??
        (infoRec as UnknownRecord | null)?.interactiveEvents,
    });
    const fromTopLevel = toInteractiveEvents(fallbackStructured);
    if (fromTopLevel.length > 0) {
      return dedupeInteractiveEvents(fromTopLevel);
    }
  }
  return [];
}

function latestPendingInteractiveEvents(messages: Message[]): InteractiveEvent[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const role = asString(messages[index].role) || asString(asRecord(messages[index].info)?.role);
    if (role.toLowerCase().trim() === "user") {
      lastUserIndex = index;
      break;
    }
  }

  const unresolvedAssistantTail = messages.slice(lastUserIndex + 1);
  for (let index = unresolvedAssistantTail.length - 1; index >= 0; index -= 1) {
    const msg = unresolvedAssistantTail[index];
    const role = asString(msg.role) || asString(asRecord(msg.info)?.role);
    if (role.toLowerCase().trim() !== "assistant") {
      continue;
    }
    const events = interactiveEventsFromMessage(msg);
    if (events.length > 0) {
      return events;
    }
  }

  return [];
}

function requiresUserResponse(events: InteractiveEvent[]): boolean {
  return events.some((event) => {
    const type = asString((event as Record<string, unknown>)?.type).toLowerCase();
    return (
      type === "question" ||
      type === "confirm" ||
      type === "quick_actions" ||
      type === "quick-actions"
    );
  });
}

function backfillLiveInteractiveEventsIntoAssistantMessage(
  message: Message,
  liveInteractiveEvents: InteractiveEvent[],
): Message {
  if (
    !Array.isArray(liveInteractiveEvents) ||
    liveInteractiveEvents.length === 0 ||
    !requiresUserResponse(liveInteractiveEvents)
  ) {
    return message;
  }

  const role =
    asString(message.role) || asString(asRecord(message.info)?.role);
  if (role.toLowerCase().trim() !== "assistant") {
    return message;
  }

  if (interactiveEventsFromMessage(message).length > 0) {
    return message;
  }

  const existingStructured = asRecord(
    (message as unknown as UnknownRecord).structuredOutput,
  );

  return {
    ...message,
    responseType:
      asOptionalString((message as unknown as UnknownRecord).responseType) ||
      "question",
    interactiveEvents: liveInteractiveEvents,
    structuredOutput: {
      ...(existingStructured || {}),
      responseType:
        asString(existingStructured?.responseType) || "question",
      interactiveEvents: liveInteractiveEvents,
    },
  } as Message;
}

function interactiveEventsFromStreamingSnapshot(
  streaming: StreamingState | null | undefined,
): InteractiveEvent[] {
  if (!streaming) {
    return [];
  }
  if (
    Array.isArray(streaming.interactiveEvents) &&
    streaming.interactiveEvents.length > 0
  ) {
    return streaming.interactiveEvents;
  }
  const structuredEvents = toInteractiveEvents(streaming.structuredOutput);
  return structuredEvents.length > 0 ? structuredEvents : [];
}

function policyAwareFreeze(
  summaries: SubagentSummary[],
  detailsById: Record<string, SubagentDetail>,
  message: Message,
  policy?: SubagentPresentationPolicy,
): boolean {
  if (!policy || policy.mode !== "hydration") {
    return false;
  }
  return summaries.some((summary) =>
    shouldFreezeSubagentForPresentation(
      hydrateSubagentSummary(summary, detailsById),
      message,
      policy,
      false,
    ),
  );
}

function interactivePromptFromEvent(event: InteractiveEvent): string | undefined {
  if (event.type === "question" || event.type === "confirm") {
    return asOptionalString(event.question) || asOptionalString(event.title);
  }
  if (event.type === "message") {
    return asOptionalString(event.message) || asOptionalString(event.title);
  }
  if (event.type === "quick_actions") {
    return asOptionalString(event.title);
  }
  return undefined;
}

function containsInteractiveMarker(text: string): boolean {
  return /\[interactive:[^:\]]+:[^\]]+\]/i.test(text);
}

function parseInteractiveMarkerResponses(
  text: string,
): Array<{ eventId: string; answer: string }> {
  const responses: Array<{ eventId: string; answer: string }> = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const markerMatch = line.match(
      /^\[interactive:[^:\]]+:([^\]]+)\]\s*(.*)$/i,
    );
    if (!markerMatch) {
      continue;
    }
    const eventId = asString(markerMatch[1]).trim();
    const answer = asString(markerMatch[2]).trim();
    if (!eventId && !answer) {
      continue;
    }
    responses.push({ eventId, answer });
  }

  return responses;
}

function hydrateLegacyInteractiveUserMessages(messages: Message[]): Message[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  const questionByEventId = new Map<string, string>();
  let changed = false;
  const hydrated = messages.map((message) => {
    const role = asString(message.role) || asString(asRecord(message.info)?.role);
    if (role === "assistant") {
      const events = interactiveEventsFromMessage(message);
      events.forEach((event) => {
        const eventId = asOptionalString(event.id);
        const label = interactivePromptFromEvent(event);
        if (eventId && label) {
          questionByEventId.set(eventId, label);
        }
      });
      return message;
    }

    if (role !== "user") {
      return message;
    }

    const persistedVisibleText =
      asOptionalString(message.content) || asOptionalString(message.text);
    if (persistedVisibleText && !containsInteractiveMarker(persistedVisibleText)) {
      return message;
    }

    const markerSource =
      (persistedVisibleText && containsInteractiveMarker(persistedVisibleText)
        ? persistedVisibleText
        : undefined) ||
      contentFromParts(Array.isArray(message.parts) ? message.parts : []);
    if (!markerSource || !containsInteractiveMarker(markerSource)) {
      return message;
    }

    const responses = parseInteractiveMarkerResponses(markerSource);
    if (responses.length === 0) {
      return message;
    }

    const displayText = responses
      .map((response) => {
        const answer = response.answer.trim();
        const questionLabel = questionByEventId.get(response.eventId);
        if (questionLabel && answer) {
          return `**${questionLabel}**\n${answer}`;
        }
        if (questionLabel) {
          return `**${questionLabel}**`;
        }
        return answer;
      })
      .filter((value) => value.length > 0)
      .join("\n\n");

    if (!displayText) {
      return message;
    }

    changed = true;
    return {
      ...message,
      content: displayText,
      text: displayText,
    };
  });

  return changed ? hydrated : messages;
}

function hasQuestionFormattingForInteractiveDisplay(text: string): boolean {
  return /\*\*[^*]+\*\*/.test(text) || /^\s*(?:question|please confirm)\s*:/im.test(text);
}

function extractInteractiveAnswerSignature(message: Message): string | undefined {
  const role = asString(message.role) || asString(asRecord(message.info)?.role);
  if (role !== "user") {
    return undefined;
  }

  const markerSourceCandidates = [
    asOptionalString(message.content),
    asOptionalString(message.text),
    contentFromParts(Array.isArray(message.parts) ? message.parts : []),
  ].filter((value): value is string => !!value);
  const markerSource = markerSourceCandidates.find((value) =>
    containsInteractiveMarker(value),
  );
  if (markerSource) {
    const markerResponses = parseInteractiveMarkerResponses(markerSource);
    if (markerResponses.length > 0) {
      const joined = markerResponses
        .map((item) => normalizeComparableText(item.answer))
        .filter((item) => item.length > 0)
        .join("\n");
      return joined || undefined;
    }
  }

  const visibleText =
    asOptionalString(message.content) ||
    asOptionalString(message.text) ||
    contentFromParts(Array.isArray(message.parts) ? message.parts : []);
  if (!visibleText) {
    return undefined;
  }

  // Special handling for "Plan approved" messages - they should be deduplicated even without question formatting
  if (/\bproceed on this plan\./i.test(visibleText)) {
    return normalizeComparableText(visibleText.trim());
  }

  if (!hasQuestionFormattingForInteractiveDisplay(visibleText)) {
    return undefined;
  }

  const lines = visibleText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const answerLines = lines.filter((line) => {
    if (/^\*\*[^*]+\*\*$/.test(line)) {
      return false;
    }
    if (/^(?:question|please confirm)\s*:/i.test(line)) {
      return false;
    }
    return true;
  });
  if (answerLines.length === 0) {
    return undefined;
  }
  return answerLines.map((line) => normalizeComparableText(line)).join("\n");
}

function interactiveUserMessageRichness(message: Message): number {
  const visibleText =
    asOptionalString(message.content) ||
    asOptionalString(message.text) ||
    contentFromParts(Array.isArray(message.parts) ? message.parts : []);
  const markerSource = contentFromParts(Array.isArray(message.parts) ? message.parts : []);
  let score = 0;
  if (visibleText && hasQuestionFormattingForInteractiveDisplay(visibleText)) {
    score += 50;
  }
  if (markerSource && containsInteractiveMarker(markerSource)) {
    score += 20;
  }
  if (visibleText) {
    score += Math.min(30, Math.floor(visibleText.length / 20));
  }
  return score;
}

function dedupeInteractiveUserHydrationMessages(messages: Message[]): Message[] {
  if (!Array.isArray(messages) || messages.length <= 1) {
    return messages;
  }

  const deduped: Message[] = [];
  for (const message of messages) {
    const role = asString(message.role) || asString(asRecord(message.info)?.role);
    if (role !== "user") {
      deduped.push(message);
      continue;
    }

    const signature = extractInteractiveAnswerSignature(message);
    if (!signature) {
      deduped.push(message);
      continue;
    }

    const previous = deduped.length > 0 ? deduped[deduped.length - 1] : undefined;
    const previousRole = previous
      ? asString(previous.role) || asString(asRecord(previous.info)?.role)
      : "";
    if (previous && previousRole === "user") {
      const previousSignature = extractInteractiveAnswerSignature(previous);
      if (previousSignature && previousSignature === signature) {
        if (
          interactiveUserMessageRichness(message) >
          interactiveUserMessageRichness(previous)
        ) {
          deduped[deduped.length - 1] = message;
        }
        continue;
      }
    }

    deduped.push(message);
  }

  return deduped;
}

function messageHasAttachmentPayload(message: Message): boolean {
  if (Array.isArray(message.images) && message.images.length > 0) {
    return true;
  }
  if (!Array.isArray(message.parts)) {
    return false;
  }
  return message.parts.some((part) => {
    const filename = asString(part?.filename);
    const sourcePath = asString(asRecord(part?.source)?.path);
    return !!filename || !!sourcePath;
  });
}

function hydratedUserComparableText(message: Message): string | undefined {
  const role = asString(message.role) || asString(asRecord(message.info)?.role);
  if (role !== "user") {
    return undefined;
  }
  const visibleText =
    asOptionalString(message.content) ||
    asOptionalString(message.text) ||
    contentFromParts(Array.isArray(message.parts) ? message.parts : []);
  if (!visibleText) {
    return undefined;
  }
  const stripped = visibleText
    .replace(
      /```[a-zA-Z0-9_-]*\r?\n\s*\/\/\s*[^\n]*[\\/][^\n]*:\d+[^\n]*\r?\n[\s\S]*?```/g,
      "",
    )
    .trim();
  const normalized = normalizeComparableText(stripped);
  return normalized || undefined;
}

function hydratedUserRichnessForAttachmentDedup(message: Message): number {
  let score = 0;
  const visibleText =
    asOptionalString(message.content) ||
    asOptionalString(message.text) ||
    contentFromParts(Array.isArray(message.parts) ? message.parts : []);
  if (visibleText) {
    score += Math.min(40, Math.floor(visibleText.length / 20));
  }
  if (messageHasAttachmentPayload(message)) {
    score += 100;
  }
  if (Array.isArray(message.images)) {
    score += message.images.length * 20;
  }
  if (Array.isArray(message.parts)) {
    score += message.parts.length;
  }
  return score;
}

function dedupeHydratedUserAttachmentEchoMessages(messages: Message[]): Message[] {
  if (!Array.isArray(messages) || messages.length <= 1) {
    return messages;
  }

  const deduped: Message[] = [];
  for (const message of messages) {
    const role = asString(message.role) || asString(asRecord(message.info)?.role);
    if (role !== "user") {
      deduped.push(message);
      continue;
    }

    const currentText = hydratedUserComparableText(message);
    const previous = deduped.length > 0 ? deduped[deduped.length - 1] : undefined;
    const previousRole = previous
      ? asString(previous.role) || asString(asRecord(previous.info)?.role)
      : "";

    if (!previous || previousRole !== "user" || !currentText) {
      deduped.push(message);
      continue;
    }

    const previousText = hydratedUserComparableText(previous);
    if (!previousText || previousText !== currentText) {
      deduped.push(message);
      continue;
    }

    const currentHasAttachment = messageHasAttachmentPayload(message);
    const previousHasAttachment = messageHasAttachmentPayload(previous);
    if (!currentHasAttachment && !previousHasAttachment) {
      deduped.push(message);
      continue;
    }

    if (
      hydratedUserRichnessForAttachmentDedup(message) >
      hydratedUserRichnessForAttachmentDedup(previous)
    ) {
      deduped[deduped.length - 1] = message;
    }
  }

  return deduped;
}

export function dedupeSystemMessages(messages: Message[]): Message[] {
  if (!Array.isArray(messages) || messages.length <= 1) {
    return messages;
  }

  const deduped: Message[] = [];
  const seenSystemContents = new Set<string>();

  for (const message of messages) {
    const role = asString(message.role) || asString(asRecord(message.info)?.role);
    const content = asString(message.content) || '';

    if (role === 'system' && content) {
      // Normalize content for deduplication by trimming whitespace
      // This handles cases where the same system message has slight formatting differences
      const normalizedContent = content.trim();

      // Skip system messages with duplicate content
      if (seenSystemContents.has(normalizedContent)) {
        continue;
      }
      seenSystemContents.add(normalizedContent);
    }

    deduped.push(message);
  }

  return deduped;
}

/**
 * Deduplicates user messages with "proceed on this plan." content.
 * This fixes duplicate "Plan Approved" messages that may appear during hydration.
 * Only deduplicates exact content matches to avoid removing legitimate repeated plan approvals.
 */
export function dedupePlanProceedMessages(messages: Message[]): Message[] {
  if (!Array.isArray(messages) || messages.length <= 1) {
    return messages;
  }

  const deduped: Message[] = [];
  const seenPlanProceedMessages = new Set<string>();

  for (const message of messages) {
    const role = asString(message.role) || asString(asRecord(message.info)?.role);

    // Extract content from all possible locations (content, text, parts)
    // Note: hydrateLegacyInteractiveUserMessages runs before this, so interactive markers
    // should already be stripped and the answer text should be in content/text fields
    const content =
      asString(message.content) ||
      asString(message.text) ||
      contentFromParts(Array.isArray(message.parts) ? message.parts : []) ||
      '';

    // Check if this is a "Plan Approved" user message
    const isPlanProceed = role === 'user' && /\bproceed on this plan\./i.test(content);

    if (isPlanProceed) {
      // Extract only the "Plan approved" portion for deduplication
      // This handles cases where messages have additional content beyond "proceed on this plan."
      // We match the same pattern used for detection and use that as the deduplication key
      const planProceedMatch = content.match(/\bproceed on this plan\./i);
      const planProceedSignature = planProceedMatch ? planProceedMatch[0].trim().toLowerCase() : content.trim().toLowerCase().replace(/\s+/g, ' ');

      // Skip duplicate "Plan Approved" messages
      if (seenPlanProceedMessages.has(planProceedSignature)) {
        continue;
      }

      seenPlanProceedMessages.add(planProceedSignature);
    }

    deduped.push(message);
  }

  return deduped;
}

function buildStreamingMessage(streaming: StreamingState): Message {
  const content =
    asString(streaming.content).trim() ||
    asString(streaming.structuredOutput?.text).trim() ||
    asString(streaming.structuredOutput?.message).trim();

  const parts: any[] = [
    {
      type: "text",
      text: content,
    },
  ];
  if (streaming.reasoning) {
    parts.push({
      type: 'reasoning',
      reasoning: streaming.reasoning
    });
  }
  const canonicalSteps = normalizeActivitySteps(
    {
      role: "assistant",
      parts: parts as MessagePart[],
    } as Message,
    streaming,
    parts as MessagePart[],
  );

  return {
    role: "assistant",
    responseType: streaming.responseType,
    content,
    parts,
    plan: streaming.plan,
    reasoningEvents: streaming.reasoningEvents,
    progressEvents: canonicalSteps,
    steps: canonicalSteps,
    edits: streaming.edits.map((file) => ({ file })),
    interactiveEvents: streaming.interactiveEvents,
    structuredOutput: streaming.structuredOutput,
    rawSdkEventPayloads: streaming.rawSdkEventPayloads,
    info: {
      id: streaming.messageId ?? undefined,
      agent: streaming.agent,
      model: streaming.model,
      modelID: streaming.modelID,
      providerID: streaming.providerID,
      variant: streaming.variant,
      duration: streaming.usage?.duration,
    },
    variant: streaming.variant,
  };
}

function hasVisibleStreamingSnapshot(streaming: StreamingState | null | undefined): streaming is StreamingState {
  if (!streaming) {
    return false;
  }
  return (
    asString(streaming.content).trim().length > 0 ||
    asString(streaming.reasoning).trim().length > 0 ||
    (Array.isArray(streaming.reasoningEvents) && streaming.reasoningEvents.length > 0) ||
    (Array.isArray(streaming.progressEvents) && streaming.progressEvents.length > 0) ||
    (Array.isArray(streaming.steps) && streaming.steps.length > 0) ||
    (Array.isArray(streaming.edits) && streaming.edits.length > 0) ||
    (Array.isArray(streaming.interactiveEvents) && streaming.interactiveEvents.length > 0) ||
    (Array.isArray(streaming.rawSdkEventPayloads) && streaming.rawSdkEventPayloads.length > 0)
  );
}

function activityScoreFromMessages(messages: Message[]): number {
  return messages.reduce((score, message) => {
    const contentScore = asString(message.content).trim().length > 0 ? 1 : 0;
    const reasoningScore = Array.isArray(message.reasoningEvents)
      ? message.reasoningEvents.length
      : 0;
    const progressScore = Array.isArray(message.progressEvents)
      ? message.progressEvents.length * 3
      : 0;
    const stepScore = Array.isArray(message.steps)
      ? message.steps.length * 3
      : 0;
    const editScore = Array.isArray(message.edits) ? message.edits.length : 0;
    const interactiveScore = Array.isArray(message.interactiveEvents)
      ? message.interactiveEvents.length
      : 0;
    return (
      score +
      contentScore +
      reasoningScore +
      progressScore +
      stepScore +
      editScore +
      interactiveScore
    );
  }, 0);
}

function getHistoryTailSignature(messages: Message[]): {
  role: "user" | "assistant" | null;
  signature: string | null;
} {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }

    const role = (
      asString(message.role) || asString(asRecord(message.info)?.role)
    )
      .toLowerCase()
      .trim();
    if (role !== "user" && role !== "assistant") {
      continue;
    }

    const text = normalizeComparableText(extractMessageText(message));
    const id = getMessageId(message) || "";
    return {
      role: role as "user" | "assistant",
      signature: `${role}:${id || text}`,
    };
  }

  return {
    role: null,
    signature: null,
  };
}

export function shouldPreferCachedSwitchMessages(
  cachedMessages: Message[],
  incomingMessages: Message[],
): boolean {
  if (cachedMessages.length === 0) {
    return false;
  }

  const cachedScore = activityScoreFromMessages(cachedMessages);
  const incomingScore = activityScoreFromMessages(incomingMessages);
  if (cachedScore > incomingScore) {
    return true;
  }
  const cachedTail = getHistoryTailSignature(cachedMessages);
  const incomingTail = getHistoryTailSignature(incomingMessages);
  // When switching sessions mid-turn, the server snapshot can lag behind the
  // locally cached transcript. If the visible tail changed, keep the cached
  // version so the user’s latest message and assistant turn do not disappear.
  if (
    cachedTail.signature &&
    incomingTail.signature &&
    cachedTail.signature !== incomingTail.signature &&
    cachedMessages.length >= incomingMessages.length &&
    (cachedTail.role === "user" || cachedTail.role === "assistant")
  ) {
    return true;
  }

  return false;
}

function mergeStreamingSnapshotIntoHistory(
  messages: Message[],
  streaming: StreamingState,
): Message[] {
  const streamingMessage = buildStreamingMessage(streaming);
  const streamingMessageId =
    streaming.messageId ||
    asString(asRecord(streamingMessage.info)?.id) ||
    asString(streamingMessage.id) ||
    null;
  return replaceMatchingAssistantTurn(messages, streamingMessage, [streamingMessageId]);
}

function flushVisibleStreamingSnapshotToMessages(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  streamingOverride?: StreamingState | null,
): void {
  const streaming = streamingOverride ?? getState().streaming;
  if (!hasVisibleStreamingSnapshot(streaming)) {
    return;
  }

  const finalized =
    finalizeStreamingSnapshotSteps(streaming, "done") ?? streaming;
  const messages = getState().messages || [];
  const nextMessages = mergeStreamingSnapshotIntoHistory(messages, finalized);
  dispatch({ type: "SET_MESSAGES", payload: nextMessages });
}

/**
 * A session.error is SDK data, not merely a transient notification. Some
 * request failures never produce a matching assistant `message.updated`, so
 * retain it in the normal assistant-card path instead of showing a toast that
 * disappears from the transcript.
 */
function materializeSessionErrorMessage(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  errorMessage: string,
  eventId?: string,
  rawSdkEventPayload?: unknown,
): void {
  const state = getState();
  const streaming = state.streaming;
  const messageId = streaming?.messageId || (eventId ? `error-${eventId}` : `error-${Date.now()}`);
  const message: Message = {
    id: messageId,
    role: "assistant",
    agent: streaming?.agent,
    modelID: streaming?.modelID,
    providerID: streaming?.providerID,
    content: streaming?.content ?? "",
    reasoningEvents: streaming?.reasoningEvents,
    steps: streaming?.steps as Message["steps"],
    created: Date.now(),
    error: errorMessage,
    // The canonical transcript only renders data backed by the SDK event
    // tape. Keep this exact terminal event with the synthetic message so the
    // session-error transcript entry survives the normal projection.
    rawSdkEventPayloads: rawSdkEventPayload ? [rawSdkEventPayload] : [],
    info: {
      id: messageId,
      role: "assistant",
      time: { created: Date.now() },
    },
  };

  dispatch({
    type: "SET_MESSAGES",
    payload: replaceMatchingAssistantTurn(state.messages || [], message, [
      messageId,
      streaming?.messageId,
    ]),
  });
}

function finalizeStreamingSnapshotSteps(
  streaming: StreamingState | null | undefined,
  terminalStatus: "done" | "error" = "done",
): StreamingState | null | undefined {
  if (!streaming) {
    return streaming;
  }

  const normalizeStepStatus = (status: unknown): "pending" | "done" | "error" => {
    const normalized = normalizeProgressStatus(asString(status));
    return normalized === "pending" ? terminalStatus : normalized;
  };

  const steps = Array.isArray(streaming.steps)
    ? streaming.steps.map((step) => {
        const nextStatus = normalizeStepStatus(step.status);
        return nextStatus === step.status ? step : { ...step, status: nextStatus };
      })
    : streaming.steps;

  const progressEvents = Array.isArray(streaming.progressEvents)
    ? streaming.progressEvents.map((step) => {
        const nextStatus = normalizeStepStatus(step.status);
        return nextStatus === step.status ? step : { ...step, status: nextStatus };
      })
    : streaming.progressEvents;

  return {
    ...streaming,
    steps,
    progressEvents,
  };
}

function completeStreamingTurnFromTerminalEvent(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  payload: UnknownRecord,
  terminalStatus: "done" | "error" = "done",
): boolean {
  const state = getState();
  const streaming = state.streaming;
  if (
    !streaming?.isActive ||
    !terminalEventMatchesAssistantTurn(payload, [
      streaming.messageId,
      state.assistantTurnMessageId,
    ])
  ) {
    return false;
  }

  const finalized = finalizeStreamingSnapshotSteps(streaming, terminalStatus);
  if (finalized) {
    dispatch({
      type: "SET_STREAMING",
      payload: {
        ...finalized,
        hasTerminalStepSignal: true,
      },
    });
  }
  dispatch({
    type: "SET_ASSISTANT_TURN_PENDING",
    payload: { pending: false, messageId: null },
  });
  dispatch({ type: "SET_PROCESSING", payload: false });
  dispatch({ type: "FINISH_STREAMING" });
  return true;
}

function handleStreamEvent(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  payload: UnknownRecord,
  terminalErrorReached: boolean,
  shouldSuppressProcessingBootstrap: boolean = false,
  markAssistantTurnClosed?: (...messageIds: Array<string | null | undefined>) => void,
  knownReasoningPartIDs?: Set<string>,
  pendingRenderableTextPart?: { partID?: string; messageID?: string },
): void {
  const dispatchProcessingTrue = () => {
    if (!shouldSuppressProcessingBootstrap) {
      dispatch({ type: "SET_IS_PROCESSING", payload: true });
    }
  };

  // Log every stream event for comprehensive debugging
  // Keep live routing semantically identical to centralized-data hydration.
  // A top-level `sync` envelope is transport metadata; the actual event type,
  // part, and info belong to `syncEvent`. Reading the envelope here caused
  // activity to be persisted but not rendered until a later hydration pass.
  const eventType = getCentralizedEventType(payload);
  if (logger.wouldLog('debug')) {
    logger.debug(`Handling Stream Event: ${eventType}`, {
      timestamp: new Date().toISOString(),
      eventType,
      payloadKeys: objectKeys(payload),
      hasProperties: !!asRecord(payload.properties),
      hasPart: !!asRecord(payload.part),
      hasStructured: !!asRecord(payload.structured),
      terminalErrorReached,
    });
  }

  // Ignore streaming parts after a terminal error to prevent showing both
  // error banner and active streaming state simultaneously
  if (terminalErrorReached) {
    logger.warn(`Ignoring event due to terminal error: ${eventType}`);
    return;
  }

  const isPartUpdateEvent = eventType.startsWith("message.part.");
  const normalizedEventType = isPartUpdateEvent ? "message.part.updated" : eventType;
  const isHeartbeatEvent = isHeartbeatEventType(eventType);
  const state = getState();
  const current = state.streaming;
  const properties = asRecord(payload.properties);
  const partRecord =
    getCentralizedEventPart(payload) ?? asRecord(properties?.part);
  const infoRecord =
    getCentralizedEventInfo(payload) ??
    asRecord(payload.info) ??
    asRecord(properties?.info);
  const eventPart =
    getCentralizedEventPart(payload) ??
    asRecord(payload.part) ??
    partRecord ??
    (isPartUpdateEvent ? asRecord(properties) : null);
  const structuredRecord = asRecord(payload.structured);
  const structuredKind = asString(structuredRecord?.kind).toLowerCase();
  const structuredText =
    asString(structuredRecord?.text) ||
    asString(structuredRecord?.message);
  const structuredOutput = structuredOutputFromCentralizedEventPayload(payload, {
    includeFallbackCandidate: true,
  });
  const eventSessionId =
    asString(payload.sessionId) ||
    asString(payload.sessionID) ||
    asString(properties?.sessionId) ||
    asString(properties?.sessionID) ||
    asString(partRecord?.sessionId) ||
    asString(partRecord?.sessionID) ||
    asString(infoRecord?.sessionId) ||
    asString(infoRecord?.sessionID);

  if (eventSessionId && state.currentSessionId && eventSessionId !== state.currentSessionId) {
    return;
  }

  const eventRole = (
    asString(payload.role) ||
    asString(infoRecord?.role) ||
    asString(properties?.role) ||
    asString(partRecord?.role)
  ).trim().toLowerCase();

  // Filter out non-assistant roles (system messages are handled in the switch cases below)
  if (eventRole && eventRole !== 'assistant') {
    // Don't filter out user messages - they may contain system message patterns
    // that will be checked in the message.part.updated case
    if (eventRole !== 'user' && eventRole !== 'system') {
      return;
    }
  }

  const messageId =
    // Use the one canonical envelope reader here. In particular, it rejects
    // `evt_*` transport-frame IDs: those must never latch the assistant turn
    // before the real part.messageID arrives.
    extractEventMessageId(payload) ||
    current?.messageId ||
    null;

  // Ignore parts that echo the user's recent input to prevent them from incorrectly
  // bootstrapping an assistant streaming block and binding the wrong message ID.
  const isPartEcho = isPartUpdateEvent && Boolean(eventPart);
  const partText = asRichString(eventPart?.text) || asRichString(eventPart?.content) || "";
  const reasoningPartID =
    asString(payload.partID) ||
    asString(payload.partId) ||
    asString(properties?.partID) ||
    asString(properties?.partId) ||
    asString(eventPart?.id) ||
    undefined;

  if (isPartUpdateEvent && partText) {
    const currentMessages = state.messages || [];
    const lastMessage = currentMessages.length > 0 ? currentMessages[currentMessages.length - 1] : null;
    if (
      lastMessage &&
      lastMessage.role === "user" &&
      !lastMessage.id &&
      asString(lastMessage.content).trim() === partText.trim()
    ) {
      logger.debug("Ignoring stream event echoing user message");
      return;
    }
  }

  const extractSystemPatternText = (): string => {
    const candidates = [
      asRichString(payload.text),
      asRichString(payload.content),
      asRichString(payload.delta),
      asRichString(properties?.text),
      asRichString(properties?.content),
      asRichString(properties?.delta),
      asRichString(partRecord?.text),
      asRichString(partRecord?.content),
      asRichString(partRecord?.delta),
      asRichString(asRecord(payload.message)?.text),
      asRichString(asRecord(payload.message)?.content),
    ];
    for (const candidate of candidates) {
      const text = candidate.trim();
      if (text && hasSystemMessagePatternInText(text)) {
        return text;
      }
    }
    return "";
  };

  const upsertRealtimeSystemMessage = (rawText: string): void => {
    const text = rawText.trim();
    if (!text || !hasSystemMessagePatternInText(text)) {
      return;
    }

    const stateNow = getState();
    // Keep realtime system banners separate from the active assistant snapshot.
    // If we materialize the visible stream into history here, ChatShell will
    // render that assistant block from `messages` and also keep the live
    // StreamingCard mounted, which duplicates the entire assistant response.
    const existingMessages = stateNow.messages || [];
    const fallbackId = `sys-stream-${messageId || Date.now()}`;
    const matchedIndex = existingMessages.findIndex((msg) => {
      const msgRole = (
        asString(msg.role) ||
        asString(asRecord(msg.info)?.role)
      ).toLowerCase();
      if (msgRole !== "system") {
        return false;
      }
      const existingId =
        asString(asRecord(msg.info)?.id) || asString((msg as UnknownRecord).id);
      if (existingId && existingId === fallbackId) {
        return true;
      }
      return asString(msg.content) === text;
    });

    const nextMessages = [...existingMessages];
    const previous = matchedIndex >= 0 ? nextMessages[matchedIndex] : undefined;
    const previousContent = asString(previous?.content);
    const mergedContent =
      previousContent && !previousContent.includes(text)
        ? `${previousContent}\n${text}`.trim()
        : previousContent || text;
    const systemMessage: Message = {
      role: "system",
      content: mergedContent,
      parts: [{ type: "text", text: mergedContent }],
      time: { created: Date.now() },
      info: { role: "system", id: fallbackId },
    };
    if (matchedIndex >= 0) {
      nextMessages[matchedIndex] = systemMessage;
    } else {
      nextMessages.push(systemMessage);
    }
    dispatch({ type: "SET_MESSAGES", payload: nextMessages });
  };
  const systemPatternText = extractSystemPatternText();
  const hasSystemPatternEvent = !!systemPatternText;
  const isExplicitStart = eventType === 'start' || eventType === 'streamStart';
  const isSessionErrorEvent = eventType === "session.error" || eventType === "error";
  const isAssistantUpdateStart =
    eventType === 'message.updated' &&
    asString(infoRecord?.role) === 'assistant' &&
    !isFinishSignal(infoRecord?.finish);
  const eventPartType = normalizePartType(eventPart?.type);
  const isRolelessAssistantActivityPart =
    !eventRole &&
    ["reasoning", "step-start", "tool", "patch", "subtask", "agent"].includes(
      eventPartType,
    );
  const canBootstrapFromPart =
    isPartUpdateEvent &&
    // `message.part.*` activity frames commonly carry only part.messageID;
    // unlike `message.updated`, they omit role. The outer stream admission
    // already accepts these semantic activity parts, so requiring an explicit
    // assistant role here drops them before state.streaming can exist. Keep
    // roleless plain-text parts excluded: those can be user echoes.
    (eventRole === "assistant" || isRolelessAssistantActivityPart) &&
    shouldBootstrapStreamingFromPart(eventPart);
  const bootstrapContext: AssistantStreamBootstrapContext = {
    eventType,
    eventRole: asString(infoRecord?.role) || asString(payload.role),
    messageId,
    eventAgent: asString(infoRecord?.agent) || asString(payload.agent) || undefined,
    eventModel: asRecord(infoRecord?.model) || asRecord(payload.model),
    eventModelID: asString(infoRecord?.modelID) || asString(payload.modelID) || undefined,
    eventProviderID:
      asString(infoRecord?.providerID) || asString(payload.providerID) || undefined,
    isExplicitStart,
    isAssistantUpdateStart,
    canBootstrapFromPart,
    hasSystemPatternEvent,
  };

  // Ignore stray global stream events when neither a request is in progress nor the
  // event carries an explicit lifecycle signal. This prevents phantom "Thinking..." /
  // streaming UI on extension open while still allowing any event type to bootstrap the
  // streaming card once the user has sent a message (state.isProcessing = true).
  // Echo stripping inside the per-event switch cases handles residual false positives.
  if (!current && !state.isProcessing && !isExplicitStart && !isAssistantUpdateStart && !canBootstrapFromPart && !hasSystemPatternEvent && !isSessionErrorEvent) {
    return;
  }

  if (!shouldSuppressProcessingBootstrap && !isHeartbeatEvent && ensureStreamingBootstrapFromCentralizedPayload(
    dispatch,
    getState,
    bootstrapContext,
  )) {
    logger.info("[LOADING][HANDLER] stream bootstrap - new streaming + SET_PROCESSING(true)", {
      messageId,
      eventType,
      isExplicitStart,
      isAssistantUpdateStart,
      canBootstrapFromPart,
      currentSessionId: state.currentSessionId,
      processingSessionIds: state.processingSessionIds,
      wasProcessing: state.isProcessing,
      hadStreaming: !!current,
    });
  }
  if (!isHeartbeatEvent) {
    bindStreamingIdentityFromCentralizedPayload(
      dispatch,
      getState,
      bootstrapContext,
    );
  }

  // The activity timeline's hydrated view is projected from the centralized
  // SDK event tape. Mirror the same stable (non-delta, non-reasoning) event
  // into the active live snapshot so an SDK part does not need to be in this
  // handler's narrow per-type switch before it can render. This is especially
  // important for new OpenCode activity types: they must paint immediately,
  // not only after `session.messages()` rehydrates the turn.
  //
  // The shared disposition deliberately excludes high-frequency token and
  // reasoning frames, so this does not reintroduce per-token tape growth or
  // make the activity renderer process every delta.
  if (
    getState().streaming &&
    getCentralizedDebugPayloadDisposition(payload) === "persist"
  ) {
    dispatch({ type: "APPEND_SDK_EVENT_PAYLOAD", payload });
  }

  const streamResponseType = firstNonEmptyString(
    structuredOutput?.responseType,
    asString(payload.responseType),
    asString(properties?.responseType),
    asString(infoRecord?.responseType),
  )?.toLowerCase();
  const streamPlan = structuredOutput?.plan;
  const hasStreamPlan =
    !!streamPlan &&
    !!(
      asString(streamPlan.file).trim() ||
      asString(streamPlan.content).trim() ||
      (Array.isArray(streamPlan.files) && streamPlan.files.length > 0)
    );
  const normalizedStreamResponseType =
    streamResponseType || (hasStreamPlan ? "implementation_plan" : undefined);
  const shouldPatchStreamingStructured =
    !!structuredOutput || !!normalizedStreamResponseType || hasStreamPlan;
  if (shouldPatchStreamingStructured) {
    const streamNow = getState().streaming;
    if (streamNow) {
      dispatch({
        type: "SET_STREAMING",
        payload: {
          ...streamNow,
          responseType: normalizedStreamResponseType as StructuredResponseType | undefined,
          plan: hasStreamPlan ? streamPlan : streamNow.plan,
          structuredOutput: structuredOutput
            ? {
              ...structuredOutput,
              type:
                (normalizedStreamResponseType as StructuredResponseType | undefined) ??
                structuredOutput.type ??
                structuredOutput.responseType,
              responseType:
                (normalizedStreamResponseType as StructuredResponseType | undefined) ??
                structuredOutput.responseType ??
                structuredOutput.type,
            }
            : streamNow.structuredOutput,
        },
      });
    }
    if (!shouldSuppressProcessingBootstrap && !getState().assistantTurnPending) {
      dispatch({
        type: "SET_ASSISTANT_TURN_PENDING",
        payload: { pending: true, messageId },
      });
    }
  }

  // Pattern-based system reminders must not depend on role field correctness.
  // However, when the same content is already visible in the user prompt UI,
  // we do not want to materialize a second standalone system card below the
  // build/assistant response. Keep the stream moving, but avoid duplicating
  // the prompt echo in the conversation list.
  if (hasSystemPatternEvent) {
    dispatchProcessingTrue();
    return;
  }

  // Stray event guard: If this event carries a messageId that belongs to a different
  // response than the one currently streaming (e.g. from a background task or a stale
  // previous turn), we must drop the stream-mutating portion of the event to prevent
  // it from bleeding into the active UI streaming card.
  //
  // A completed question tool is the intentional exception. OpenCode completes the
  // question on the assistant message that asked it *after* the user-reply flow has
  // opened its continuation placeholder. Dropping that event loses `state.output`
  // (the captured answer) before the activity timeline can render it.
  const strayEventIsCompletedQuestionTool = (() => {
    const part = eventPart ?? partRecord;
    const toolState = asRecord(part?.state);
    return completedQuestionToolPresentation(
      part?.tool,
      toolState?.status ?? part?.status,
      toolState?.output,
    ).isCompleted;
  })();
  // `message.updated` rekeys a phase through React's reducer. A following
  // tool/step part can arrive before that reducer commit, so it still observes
  // the completed prior stream. The assistant-turn latch is already updated
  // in this situation; use that structural identity to preserve the activity
  // instead of classifying the new phase as stray.
  const shouldRecoverPendingAssistantPhasePart = Boolean(
    isPartUpdateEvent &&
      messageId &&
      state.assistantTurnMessageId === messageId &&
      current?.messageId &&
      current.messageId !== messageId &&
      !current.isActive,
  );
  if (shouldRecoverPendingAssistantPhasePart && current && messageId) {
    dispatch({
      type: "SET_STREAMING",
      payload: {
        ...current,
        messageId,
        isActive: true,
      },
    });
    if (config.debug.showSdkEventDebug) {
      logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] phase-part-rekey", {
        eventId: asString(payload.id) || null,
        eventType,
        partType: asString(eventPart?.type) || null,
        previousStreamingMessageId: current.messageId,
        recoveredStreamingMessageId: messageId,
        assistantTurnMessageId: state.assistantTurnMessageId,
        preservedStepCount: current.steps.length,
        preservedProgressCount: current.progressEvents.length,
      });
    }
  }
  const isStrayEvent = (() => {
    if (!messageId) return false;
    const currentStreamingMessageId = getState().streaming?.messageId;
    if (!currentStreamingMessageId) return false;
    if (messageId === currentStreamingMessageId) return false;
    
    // Some events explicitly bootstrap a new turn (like streamStart, or message.updated
    // which has its own re-keying logic). Those are not "stray", they are the start
    // of a *new* streaming sequence.
    if (normalizedEventType === "start" || normalizedEventType === "streamStart") return false;
    if (normalizedEventType === "message.updated") return false;
    if (shouldRecoverPendingAssistantPhasePart) return false;
    
    return !strayEventIsCompletedQuestionTool;
  })();

  if (isStrayEvent) {
    logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] part-rejected-stray", {
      normalizedEventType,
      eventMessageId: messageId,
      activeStreamingMessageId: getState().streaming?.messageId,
      assistantTurnMessageId: state.assistantTurnMessageId,
      streamingIsActive: state.streaming?.isActive ?? false,
      partType: asString(eventPart?.type) || null,
      reason: "message-id-does-not-match-active-or-recoverable-assistant-phase",
    });
    // For purely streaming UI events, we just drop them.
    // For lifecycle events like 'message.completed' or 'finish', we don't want them
    // to accidentally close the ACTIVE assistant turn. We should just early return.
    const isPurelyStreamEvent = [
      'contentDelta', 'content', 'text-delta', 'text',
      'reasoningDelta', 'reasoning', 'thinking',
      'stepStart', 'stepUpdate', 'stepDone', 'stepError',
      'edit', 'fileEdit',
      'message.part.updated', 'message.part.added', 'message.part.created',
      'finish', 'done', 'message.completed', 'session.completed',
      'error', 'session.error'
    ].includes(normalizedEventType);
    
    if (isPurelyStreamEvent) {
       return;
    }
  }

  switch (normalizedEventType) {
    case 'question.asked': {
      const interactiveEvents = interactiveEventsFromQuestionAskedPayload(payload);
      if (interactiveEvents.length > 0) {
        dispatch({ type: "SET_INTERACTIVE_EVENTS", payload: interactiveEvents });
        maybeInjectStreamingInteractiveContext(dispatch, getState, interactiveEvents);
      }
      break;
    }
    case 'permission.asked':
    case 'permission.request': {
      // Permission requests are mounted by `routeLiveEventToUi` before the
      // normal stream gate so paused turns are handled consistently.
      break;
    }
    case 'permission.replied': {
      const properties = asRecord(payload.properties) ?? payload;
      const permissionID =
        asString(properties.permissionID) ||
        asString(properties.requestID) ||
        asString(properties.id);
      if (permissionID) {
        dispatch({
          type: "SET_INTERACTIVE_EVENTS",
          payload: getState().interactiveEvents.filter(
            (event) => event.type !== "quick_actions" || event.permissionID !== permissionID,
          ),
        });
      }
      break;
    }
    case 'message.part.updated':
    case 'message.part.added':
    case 'message.part.created': {
      logger.debug(`Processing part event`, {
        normalizedEventType,
        messageId,
        hasPart: !!asRecord(payload.part),
        hasProperties: !!asRecord(payload.properties),
      });
      const properties = asRecord(payload.properties);
      // Keep this in lockstep with stream classification. A sync envelope
      // stores the actual part at `syncEvent.data.part`; using only the
      // top-level shape accepts/persists the event but drops it before it can
      // update StreamingState and the live activity timeline.
      const part =
        eventPart ??
        asRecord(payload.part) ??
        asRecord(properties?.part) ??
        properties;
      if (!part) {
        if (awaitingInteractiveTurnStart || isHeartbeatEvent) {
          logger.debug(
            `No part data during interactive transition/heartbeat, suppressing processing bootstrap`,
          );
          break;
        }
        logger.debug(`No part data, setting processing=true`);
        dispatchProcessingTrue();
        break;
      }

      // DEBUG: Log all part updates to see what's happening
      const currentPartType = normalizePartType(part.type);
      const currentStructuredKind = asString(payload.structuredKind) || asString(properties?.structuredKind) || '';
      logger.debug('message.part.updated', { partType: currentPartType, structuredKind: currentStructuredKind, hasText: !!part.text, hasContent: !!part.content });

      // Track if we're processing a reasoning part sequence
      const currentStreamingState = getState().streaming;
      const isInReasoningPart = currentStreamingState?.inReasoningPart || false;
      // Preserve whether this event started from a finished snapshot. The reducer
      // may reopen inactive streams on SET_PROCESSING(true), so terminal activity
      // needs a final guard before the generic keep-processing dispatch below.
      const wasStreamInactiveAtPartStart = currentStreamingState?.isActive === false;

      // Detect start of reasoning part sequence.
      // Also handle raw message.part.delta events where field="reasoning"/"thinking":
      // these carry the reasoning delta in properties.delta (not part.reasoning) and
      // properties.field (not part.type), so currentPartType is empty and the normal
      // reasoning detection misses them entirely — causing delta chunks to be mistakenly
      // routed to the content pipeline instead of the reasoning timeline.
      const deltaField = asString(properties?.field).trim().toLowerCase();
      const rawUpdatedDelta =
        asRichString(properties?.delta) ||
        asRichString(payload.delta) ||
        asRichString(part.delta);
      const rawPartText = asRichString(part.text) || asRichString(part.content);
      const isRawDeltaReasoningField =
        (eventType === "message.part.delta" || rawUpdatedDelta.trim().length > 0) &&
        (deltaField === "reasoning" || deltaField === "thinking");
      // A delta only describes a changing transport field. OpenCode can label
      // reasoning deltas as `field: "text"`, then emit the real assistant text
      // as a non-delta snapshot for the same part. Keep deltas out of the
      // response body; the completed snapshot still renders during the live
      // stream, without waiting for history hydration.
      const isRawDeltaTextField =
        (eventType === "message.part.delta" || rawUpdatedDelta.trim().length > 0) &&
        (deltaField === "text" ||
          deltaField === "content" ||
          deltaField === "message" ||
          deltaField === "output_text");
      // OpenCode currently emits a typed `reasoning` frame followed by token
      // deltas labeled `field: "text"` for the *same* part ID. React can batch
      // these native webview messages before its reducer state commits, so the
      // streaming-state identity below is not sufficient on its own. Retain
      // the transport identity at the handler boundary; this is structural
      // provenance, not a heuristic based on the text itself.
      if (currentPartType === "reasoning" && reasoningPartID) {
        knownReasoningPartIDs?.add(reasoningPartID);
      }
      const isDeltaForKnownReasoningPart = Boolean(
        rawUpdatedDelta.trim().length > 0 &&
        reasoningPartID &&
        (knownReasoningPartIDs?.has(reasoningPartID) ||
          currentStreamingState?.reasoningPartIDs?.includes(reasoningPartID)),
      );
      // `message.part.delta` only says which field changed (`text`); after the
      // SDK adapter normalizes it, that alone cannot distinguish assistant
      // response text from the `text` field of a reasoning part. The preceding
      // full part update establishes ownership by partID, so keep matching
      // deltas in the reasoning lane until a different part begins.
      const isDeltaForActiveReasoningPart = Boolean(
        rawUpdatedDelta.trim().length > 0 &&
        isInReasoningPart &&
        reasoningPartID &&
        currentStreamingState?.activeReasoningPartID === reasoningPartID,
      );
      const isReasoning =
        currentPartType === 'reasoning' ||
        currentStructuredKind === 'thinking' ||
        isRawDeltaReasoningField ||
        isRawDeltaTextField ||
        isDeltaForKnownReasoningPart ||
        isDeltaForActiveReasoningPart;
      
      // Only emit the "enter reasoning sequence" signal when we first detect a
      // reasoning part. For raw delta events this fires on every chunk, so guard
      // it with isInReasoningPart to avoid redundant dispatches that would
      // unnecessarily reset the reasoning string to '' on every chunk.
      if (isReasoning && !isInReasoningPart) {
        logger.debug('Starting reasoning part sequence - will drop all content', {
          partType: currentPartType,
          structuredKind: currentStructuredKind,
          isRawDeltaReasoningField,
          deltaField,
        });
        dispatch({
          type: 'UPDATE_STREAMING_REASONING',
          payload: {
            reasoning: '',
            append: false,
            inReasoningPart: true,
            partID: reasoningPartID,
            messageID: messageId || undefined,
          },
        });
      }

      // A reasoning part may briefly arrive as a text delta with the same
      // part ID. Persist that identity-level suppression so batching or a
      // later completed snapshot cannot reintroduce it into the response body.
      if (isReasoning && reasoningPartID && !isRawDeltaTextField) {
        dispatch({
          type: "SUPPRESS_STREAMING_TEXT_PART",
          payload: { partID: reasoningPartID },
        });
      }

      // Detect end of reasoning part (when we get ANY non-reasoning part after reasoning)
      // This ensures that if the assistant skips the text part and goes straight to a tool call
      // (e.g. for a question), we still reset the reasoning filter so the synthesized text is shown.
      // isInReasoningPart is read before dispatch and may be stale; track the effective value locally
      // to prevent the first non-reasoning part after reasoning from being misrouted.
      let effectiveInReasoningPart = isInReasoningPart;

      if (isInReasoningPart && !isReasoning) {
        logger.debug(`Ending reasoning part sequence - current part type is ${currentPartType}`);
        dispatch({ type: 'UPDATE_STREAMING_REASONING', payload: { reasoning: '', append: false, inReasoningPart: false } });
        effectiveInReasoningPart = false;
      }

      // CRITICAL FIX: When we detect a reasoning part, immediately set effectiveInReasoningPart to true
      // This ensures the current part's processing uses the correct flag, preventing reasoning leak into main content
      // This must happen AFTER the ending check above to avoid race conditions
      if (isReasoning) {
        effectiveInReasoningPart = true;
      }

      // Check for system message patterns early (before any content processing)
      // System messages like <auto-slash-command> come through as message.part.updated
      // events with role="user" but should be rendered as system messages
      const partText = asRichString(part.text) || asRichString(part.content) || '';
      if (partText && hasSystemMessagePatternInText(partText)) {
        break; // Don't process this as regular content
      }

      // Transport-level user echoes can be mislabeled by some providers.
      // Do not early-return here; continue parsing so assistant-like payloads
      // still render, while other guards prevent phantom stream bootstrap.

      const partType = normalizePartType(part.type);
      const deltaChunk =
        asRichString(properties?.delta) ||
        asRichString(payload.delta) ||
        asRichString(part.delta);
      const isDeltaReasoningChunk =
        !!deltaChunk ||
        normalizedEventType.toLowerCase().includes("delta") ||
        eventType.toLowerCase().includes("delta");
      const reasoningChunk =
        asRichString(part.reasoning) ||
        asRichString(part.thought) ||
        asRichString(part.thinking) ||
        asRichString(properties?.reasoning) ||
        asRichString(properties?.thought) ||
        asRichString(properties?.thinking) ||
        asRichString(payload.reasoning) ||
        asRichString(payload.thought) ||
        asRichString(payload.thinking);
      const textChunk =
        structuredText ||
        deltaChunk ||
        asRichString(part.text) ||
        asRichString(part.content) ||
        asRichString(properties?.text) ||
        asRichString(properties?.content);
      if (
        currentPartType === "text" &&
        !textChunk &&
        eventType !== "message.part.delta"
      ) {
        logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] text-part-empty", {
          eventId: asString(payload.id) || null,
          eventType,
          messageId,
          partKeys: Object.keys(part).slice(0, 16),
          propertyKeys: properties ? Object.keys(properties).slice(0, 16) : [],
          partTextLength: asRichString(part.text).length,
          partContentLength: asRichString(part.content).length,
          partDeltaLength: asRichString(part.delta).length,
          propertiesTextLength: asRichString(properties?.text).length,
          propertiesContentLength: asRichString(properties?.content).length,
          propertiesDeltaLength: asRichString(properties?.delta).length,
        });
      }
      const hasExplicitReasoningOnlyChunk =
        reasoningChunk.trim().length > 0 &&
        !deltaChunk &&
        !structuredText &&
        !asRichString(part.text) &&
        !asRichString(part.content) &&
        !asRichString(properties?.text) &&
        !asRichString(properties?.content);
      const isProgressPartType =
        partType === "tool" ||
        partType === "step-start" ||
        partType === "step-finish" ||
        partType === "step-stop" ||
        partType === "patch" ||
        partType === "subtask" ||
        partType === "agent";

      const interactiveEvents = toInteractiveEvents(structuredOutput);
      const hasBlockingInteractive =
        hasBlockingInteractiveEvents(interactiveEvents);
      if (interactiveEvents.length > 0) {
        dispatch({ type: "SET_INTERACTIVE_EVENTS", payload: interactiveEvents });
        maybeInjectStreamingInteractiveContext(
          dispatch,
          getState,
          interactiveEvents,
        );
        logger.info("[TRACE][HANDLER][PART_INTERACTIVE_EVENTS]", {
          eventType: normalizedEventType,
          messageId,
          structuredKind: currentStructuredKind || null,
          interactiveCount: interactiveEvents.length,
          blockingInteractive: hasBlockingInteractive,
          streamingExists: !!getState().streaming,
          streamingInteractiveCount: getState().streaming?.interactiveEvents?.length ?? 0,
        });
      }

      if (structuredOutput?.subagents || structuredOutput?.subagentsDelta) {
        applyStructuredSubagentPayload(dispatch, getState, structuredOutput, messageId || '');
        bindStreamingToParentMessageIdFromSubagents(
          dispatch,
          getState,
          getState().subagentsByParentMessageId,
        );
      }

      const streamingState = getState().streaming;

      // Guard: parts with embedded reasoning fields (type is "text" but carries
      // reasoning/thinking/thought data). Route the reasoning content to the
      // reasoning pipeline so it stays out of the visible assistant body.
      const hasEmbeddedReasoning =
        !isReasoning &&
        !hasExplicitReasoningOnlyChunk &&
        reasoningChunk.trim().length > 0;
      const isReasoningPart =
        partType === 'reasoning' ||
        structuredKind === 'thinking' ||
        effectiveInReasoningPart ||
        hasExplicitReasoningOnlyChunk ||
        hasEmbeddedReasoning;

      // Keep an evidence trail for each meaningful SDK part without logging
      // full payloads or every token delta. This is deliberately adjacent to
      // the classification boundary: it tells us whether a received event was
      // routed to assistant text, reasoning, or an activity row before any
      // reducer update can change the state we are trying to diagnose.
      const isHighFrequencyTextDelta =
        eventType === "message.part.delta" && deltaChunk.length > 0;
      if (config.debug.showSdkEventDebug && !isHighFrequencyTextDelta) {
        logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] part-classified", {
          eventId: asString(payload.id) || null,
          eventType,
          normalizedEventType,
          sessionId: firstNonEmptyString(
            asString(part.sessionID),
            asString(part.sessionId),
            state.currentSessionId,
          ) || null,
          messageId: messageId || null,
          partId: asString(part.id) || null,
          partType: partType || null,
          structuredKind: structuredKind || null,
          route: isReasoningPart
            ? "reasoning"
            : isProgressPartType
              ? "activity"
              : "assistant-text-candidate",
          textLength: textChunk.length,
          deltaLength: deltaChunk.length,
          reasoningLength: reasoningChunk.length,
          textPreview: textChunk.slice(0, 160),
          hasCurrentStreaming: Boolean(streamingState),
          currentStreamingMessageId: streamingState?.messageId || null,
          effectiveInReasoningPart,
          suppressedTextPart: Boolean(
            asString(part.id).trim() &&
              streamingState?.suppressedTextPartIDs?.includes(asString(part.id).trim()),
          ),
        });
      }

      if (isReasoningPart) {
        logger.debug('Processing reasoning part - routing to stepper only', { partType, structuredKind, isInReasoningPart, reasoningLength: (reasoningChunk || textChunk || '').length });

        // Extract reasoning content and route to stepper, NEVER to main content
        const reasoningContent = reasoningChunk || textChunk || '';
        const sanitized = sanitizeReasoningChunk(reasoningContent);
        if (sanitized) {
          dispatch({
            type: 'UPDATE_STREAMING_REASONING',
            payload: {
              reasoning: sanitized,
              append: true,
              delta: isDeltaReasoningChunk,
              partID: reasoningPartID,
              messageID: messageId || undefined,
            },
          });
        }

        // Skip main content processing for reasoning parts - let the case continue
        // to handle steps/tools/interactive events, but don't process text content
      } else {
        // Non-reasoning parts continue to normal content processing
        logger.debug('Processing non-reasoning content', { partType, structuredKind });
        logger.debug('Processing content', { partType, structuredKind, isInReasoningPart });

        // Lock: only explicit assistant message text can create trusted renderable
        // body content. Progress/lifecycle/tool chunks must never seed the bubble.
        const canAppendMainContent =
          partType !== "reasoning" &&
          structuredKind !== "thinking" &&
          (structuredKind === "message" ||
            ((!structuredKind || structuredKind === "message") &&
              (partType === "text" ||
                partType === "message" ||
                isRawDeltaTextField)));

        if (canAppendMainContent) {
          const textPartID = asString(part.id).trim();
          const isSuppressedToolPrelude = Boolean(
            textPartID &&
              streamingState?.suppressedTextPartIDs?.includes(textPartID),
          );
          if (isSuppressedToolPrelude) {
            // STREAMING INVARIANT: never re-promote a suppressed tool prelude.
            // The raw event tape commonly sends this as a later non-delta,
            // completed snapshot. It remains the same part and therefore is
            // still tool-phase bridge text, not a newly authored response.
            // A real answer arrives under a new text part ID and follows the
            // normal content path below. This is structural classification;
            // do not infer intent from the text itself.
            dispatchProcessingTrue();
            break;
          }
          let candidateChunk = textChunk;

          const rawReasoningLike = containsThoughtTagReasoning(candidateChunk);
          const mixedChunk = splitMixedReasoningFromContent(candidateChunk);
          if (rawReasoningLike && !mixedChunk) {
            const reasoningLeak = sanitizeReasoningChunk(candidateChunk);
            if (reasoningLeak) {
              dispatch({
                type: "UPDATE_STREAMING_REASONING",
                payload: {
                  reasoning: reasoningLeak,
                  append: true,
                  delta: isDeltaReasoningChunk,
                  partID: reasoningPartID,
                  messageID: messageId || undefined,
                },
              });
            }
            dispatchProcessingTrue();
            break;
          }

          if (mixedChunk) {
            const reasoningLeak = sanitizeReasoningChunk(mixedChunk.reasoning);
            if (reasoningLeak) {
              dispatch({
                type: "UPDATE_STREAMING_REASONING",
                payload: {
                  reasoning: reasoningLeak,
                  append: true,
                  delta: isDeltaReasoningChunk,
                  partID: reasoningPartID,
                  messageID: messageId || undefined,
                },
              });
            }
            candidateChunk = mixedChunk.content;
          }

          if (containsThoughtTagReasoning(candidateChunk)) {
            const reasoningLeak = sanitizeReasoningChunk(candidateChunk);
            if (reasoningLeak) {
              dispatch({
                type: "UPDATE_STREAMING_REASONING",
                payload: {
                  reasoning: reasoningLeak,
                  append: true,
                  delta: isDeltaReasoningChunk,
                  partID: reasoningPartID,
                  messageID: messageId || undefined,
                },
              });
            }
            dispatchProcessingTrue();
            break;
          }
          // Ignore id-like echoes that can appear before assistant output begins.
          if (isOpaqueIdLike(candidateChunk.trim())) {
            dispatchProcessingTrue();
            break;
          }
          const contentEmpty = !streamingState || !streamingState.content.trim();
          const cleanedChunk = contentEmpty
            ? stripLeadingUserEcho(candidateChunk, getState())
            : candidateChunk;
          const cleanedChunkWasUserEchoOnly = contentEmpty && !cleanedChunk;
          if (cleanedChunkWasUserEchoOnly) {
            streamDebug("Stream: suppressing user echo part", {
              eventType,
              messageId,
              partType,
              structuredKind,
            });
            break;
          }
          if (cleanedChunk) {
            const contentPatch = resolveStreamingContentUpdate(
              streamingState?.content || '',
              cleanedChunk,
              !!deltaChunk,
            );
            if (!contentPatch) {
              dispatchProcessingTrue();
              break;
            }
            streamDebug("Stream: message part updated chunk", {
              messageId,
              eventType,
              partType,
              append: contentPatch.append,
              length: cleanedChunk.length,
              preview: cleanedChunk.slice(0, 80),
            });
            const renderable =
              isRenderableStreamingPartType(partType) || isRawDeltaTextField;
            // A native `streamEvent` can arrive immediately before React has
            // committed the previous reducer action. Keep just the identity
            // needed for a following tool event to retract this temporary
            // text prelude; this is not transport/event deduplication.
            if (renderable && textPartID && messageId) {
              if (pendingRenderableTextPart) {
                Object.assign(pendingRenderableTextPart, {
                  partID: textPartID,
                  messageID: messageId,
                });
              }
            }
            dispatch({
              type: "UPDATE_STREAMING_CONTENT",
              payload: {
                content: contentPatch.content,
                append: contentPatch.append,
                renderable,
                partID: textPartID || undefined,
              },
            });
          }
        }
      } // End of if (!isReasoningPart) - skip content processing for reasoning parts

      if (partType === 'step-start' && structuredKind !== 'thinking') {
        upsertStreamingStep(dispatch, getState, {
          id: asString(part.id) || undefined,
          callID: asString(part.callID) || undefined,
          title: inferredStepTitle(part),
          type: 'step',
          status: 'pending',
          source: "stream",
          partType: "step-start",
          internal: false,
          startTime: Date.now()
        });
      }

      if (partType === 'step-finish' && structuredKind !== 'thinking') {
        const diffStatsRec = asRecord(part.diffStats);
        const diffStats = diffStatsRec
          ? {
            added: asNumber(diffStatsRec.added) || 0,
            deleted: asNumber(diffStatsRec.deleted) || 0,
          }
          : undefined;

        upsertStreamingStep(dispatch, getState, {
          id: asString(part.id) || undefined,
          callID: asString(part.callID) || undefined,
          title: inferredStepTitle(part),
          type: "step",
          status: "done",
          source: "stream",
          partType: "step-finish",
          internal: false,
          duration: asOptionalNumber(asRecord(part.timing)?.duration),
          diffStats,
        });
        // A completed activity step is not a completed assistant turn. OpenCode
        // emits step-finish between ordinary tools and reasoning/text phases.
        // Finishing the stream here makes the UI repeatedly render a few rows,
        // clear them, then bootstrap another partial card. Only explicit
        // message/session completion events own terminal stream finalization.
      }

      if (partType === 'tool') {
        const statePreludePartID = getState().streaming?.lastRenderableTextPartID;
        const projectedPreludePartID =
          pendingRenderableTextPart?.messageID &&
          messageId &&
          pendingRenderableTextPart.messageID === messageId
            ? pendingRenderableTextPart.partID
            : undefined;
        const preludePartID = statePreludePartID ?? projectedPreludePartID;
        const toolPartID = asString(part.id).trim();
        const preludeIsKnownReasoning = Boolean(
          preludePartID && knownReasoningPartIDs?.has(preludePartID),
        );
        if (preludePartID && preludePartID !== toolPartID && preludeIsKnownReasoning) {
          // Tool activity must never retract normal assistant text. Only a
          // part already identified structurally as reasoning is excluded
          // from the response body; this retains live assistant text across
          // every ordinary text → tool transition.
          dispatch({
            type: "SUPPRESS_STREAMING_TEXT_PART",
            payload: { partID: preludePartID },
          });
        }
        // Scoped/inactive-session processing can call handleStreamEvent without
        // the optional cross-event identity holder. Retraction is best-effort
        // bookkeeping only; never let a missing holder crash the stream.
        if (pendingRenderableTextPart?.partID === preludePartID) {
          Object.assign(pendingRenderableTextPart, {
            partID: undefined,
            messageID: undefined,
          });
        }
        const tool = asString(part.tool);
        const stateObj = asRecord(part.state);
        const inputObj = asRecord(stateObj?.input);
        const partInputObj = asRecord((part as UnknownRecord).input);
        const partMetadata = asRecord(stateObj?.metadata) ?? asRecord(part.metadata);
        const metadataFileDiff = asRecord(partMetadata?.filediff);
        const metadataFile = Array.isArray(partMetadata?.files)
          ? asRecord(partMetadata.files[0])
          : undefined;
        const filePath =
          asOptionalString(metadataFileDiff?.file) ||
          asOptionalString(metadataFile?.relativePath) ||
          asOptionalString(metadataFile?.filePath) ||
          asOptionalString(metadataFile?.path) ||
          extractFilePathCandidate(inputObj) ||
          extractFilePathCandidate(partInputObj) ||
          extractFilePathCandidate(stateObj?.result) ||
          asString(part.filePath) ||
          undefined;
        const metaValues = [
          asString(inputObj?.CommandId),
          asString(inputObj?.CommandLine),
          asString(inputObj?.Query),
          asString(inputObj?.Pattern),
          asString(inputObj?.pattern),
          asString(inputObj?.command),
          asString(inputObj?.query),
          asString(inputObj?.url),
          asString(inputObj?.Url),
        ].filter(Boolean);
        const commandValue = asOptionalString(
          inputObj?.CommandLine ?? inputObj?.command,
        );
        const queryValue = asOptionalString(
          inputObj?.Query ??
          inputObj?.query ??
          inputObj?.Pattern ??
          inputObj?.pattern,
        );
        const callID = asString(part.callID) || undefined;
        // A tool part's message ID identifies the assistant turn that owns the
        // activity. Do not substitute the currently active stream/parent turn
        // when the SDK supplied this more specific identity.
        const activityMessageID = firstNonEmptyString(
          asString(part.messageID),
          asString(part.messageId),
          messageId,
        ) || undefined;
        const sessionID =
          asString(part.sessionID) ||
          asString(part.sessionId) ||
          asString((stateObj as UnknownRecord)?.sessionID) ||
          asString((stateObj as UnknownRecord)?.sessionId) ||
          undefined;
        const toolName = tool.trim().toLowerCase();
        const normalizedPartStatus = normalizeProgressStatus(asString(part.status));
        const normalizedStateStatus = normalizeProgressStatus(
          asString(stateObj?.status),
        );
        const reportedToolStatus =
          normalizedPartStatus === "error" || normalizedStateStatus === "error"
            ? "error"
            : normalizedPartStatus === "done" ||
                normalizedPartStatus === "completed" ||
                normalizedStateStatus === "done" ||
                normalizedStateStatus === "completed"
              ? "done"
              : normalizedPartStatus === "running" || normalizedStateStatus === "running"
                ? "running"
                : "pending";
        const questionPresentation = completedQuestionToolPresentation(
          toolName,
          stateObj?.status ?? part.status,
          stateObj?.output,
        );
        const isCompletedQuestionTool = questionPresentation.isCompleted;
        const title =
          isCompletedQuestionTool
            ? questionPresentation.title!
            : asString(part.title) ||
              asString(stateObj?.title) ||
              (tool ? `Running ${tool}...` : inferredStepTitle(part));

        // Extract output from multiple possible sources
        // 1. From state.output (tool state)
        // 2. From metadata.preview (debug metadata)
        const stateOutput = asOptionalString(stateObj?.output);
        const metadataPreview =
          asOptionalString(partMetadata?.preview) ||
          asOptionalString(partMetadata?.output);
        const metadataTruncated = partMetadata?.truncated === true;
        const finalOutput = stateOutput || metadataPreview;

        const stateDiffExcerpt = asRecord(stateObj?.diffExcerpt);
        const explicitDiffExcerpt = stateDiffExcerpt ? {
          header: asOptionalString(stateDiffExcerpt.header),
          lines: Array.isArray(stateDiffExcerpt.lines) ? stateDiffExcerpt.lines.map(asString) : [],
          added: typeof stateDiffExcerpt.added === 'number' ? stateDiffExcerpt.added : undefined,
          deleted: typeof stateDiffExcerpt.deleted === 'number' ? stateDiffExcerpt.deleted : undefined,
        } : undefined;
        const metadataDiffStats =
          normalizeDiffStats(metadataFileDiff) ?? normalizeDiffStats(metadataFile);
        const diffExcerpt = explicitDiffExcerpt ?? diffExcerptFromPatch(
          metadataFileDiff?.patch ?? metadataFile?.patch ?? partMetadata?.diff ?? inputObj?.patchText,
          metadataDiffStats,
        ) ?? diffExcerptFromEditInput(inputObj);
        const resolvedDiffStats = metadataDiffStats ?? (
          diffExcerpt
            ? { added: diffExcerpt.added ?? 0, deleted: diffExcerpt.deleted ?? 0 }
            : undefined
        );

        // Debug logging to trace data flow
        if ((tool === 'read' || tool === 'Read') && finalOutput) {
          logger.info("[DEBUG] Read step output found", {
            tool,
            hasStateOutput: !!stateOutput,
            hasMetadataPreview: !!metadataPreview,
            metadataTruncated,
            finalOutputLength: finalOutput.length,
            outputPreview: finalOutput.slice(0, 100),
            callID,
          });
        }
        if ((tool === 'edit' || tool === 'write' || tool === 'modify') && diffExcerpt) {
          logger.info("[DEBUG] Edit step diffExcerpt found", {
            tool,
            hasDiffExcerpt: !!diffExcerpt,
            linesCount: diffExcerpt.lines?.length,
            callID,
          });
        }

        const firstQuestion = asRecord(
          Array.isArray(inputObj?.questions) ? inputObj.questions[0] : undefined,
        );
        const questionPrompt = asOptionalString(firstQuestion?.question);
        const baseActivityDetail: ActivityDetail | undefined =
            normalizeActivityDetail({
              kind: isCompletedQuestionTool ? "other" : "tool_call",
              tool: tool || undefined,
              command: commandValue,
              query: queryValue,
              file: filePath,
              input: inputObj || partInputObj || undefined,
              summary: isCompletedQuestionTool
                ? questionPresentation.summary || questionPresentation.title
                : questionPrompt || asOptionalString(part.meta),
              output: finalOutput,
              diffExcerpt: diffExcerpt,
              metadata: metadataTruncated ? { truncated: true } : undefined,
              sessionID,
            });

        const existing = (getState().streaming?.steps ?? []).find(
          (step) => !!callID && step.callID === callID
        );
        if (!existing) {
          upsertStreamingStep(dispatch, getState, {
            id: asString(part.id) || undefined,
            callID,
            messageID: activityMessageID,
            title,
            type: "tool",
            status: reportedToolStatus,
            source: "stream",
            partType: "tool",
            internal: isInternalToolName(tool),
            meta: asString(part.meta) || metaValues[0] || undefined,
            filePath,
            diffStats: resolvedDiffStats,
            sessionID,
            activityDetail: baseActivityDetail,
            startedAt: Date.now(),
            startTime: Date.now(),
          });
        } else {
          // Determine the final status for this tool step.
          // The backend reports completion in two places:
          //   1. part.status === 'done' (direct top-level field)
          //   2. part.state.status === 'done' (nested state object)
          //   3. part.state.result exists (implicit done — tool produced a result)
          const hasResult = stateObj && "result" in stateObj;
          const resolvedStatus =
            existing.status === "done" || existing.status === "error"
              ? existing.status
              : hasResult
                ? "done"
                : reportedToolStatus === "pending"
                  ? existing.status
                  : reportedToolStatus;

          upsertStreamingStep(dispatch, getState, {
            id: asString(part.id) || existing.id,
            callID,
            messageID: activityMessageID || existing.messageID,
            title,
            type: "tool",
            status: resolvedStatus,
            source: existing.source || "stream",
            partType: "tool",
            internal: Boolean(existing.internal || isInternalToolName(tool)),
            meta: asString(part.meta) || metaValues[0] || existing.meta,
            filePath: filePath || existing.filePath,
            diffStats: resolvedDiffStats || existing.diffStats,
            sessionID: sessionID || existing.sessionID,
            activityDetail: baseActivityDetail || existing.activityDetail,
          });
        }

        const toolStepEditLike = isEditLikeStep({
          type: "tool",
          title,
          partType: "tool",
          filePath,
          activityDetail: baseActivityDetail,
        } as StreamingStep);
        if (toolStepEditLike) {
          logger.info("[ACTIVITY STEP][EDIT] Streaming tool step (edit-like)", {
            messageId,
            title,
            tool,
            filePath,
            callID,
            activityDetail: baseActivityDetail,
            rawPart: part,
          });
        }

        if (filePath) {
          dispatch({ type: 'ADD_STREAMING_EDIT', payload: filePath });
        }

        const toolInteractiveEvents = interactiveEventsFromToolQuestionPart(part);
        if (
          tool === "question" ||
          tool.includes("question") ||
          tool.includes("request_user_input") ||
          tool.includes("request-user-input")
        ) {
          logger.info("[QUESTION DEBUG] tool-part interactive inspection", {
            messageId,
            tool,
            title,
            callID,
            toolStateStatus: asString(stateObj?.status),
            inputKeys: Object.keys(inputObj || {}),
            extractedEventCount: toolInteractiveEvents.length,
            extractedEvents: toolInteractiveEvents.map((event) => ({
              id: event.id,
              type: event.type,
              title: "title" in event ? event.title : undefined,
              question: event.type === "question" || event.type === "confirm" ? event.question : undefined,
              optionCount: event.type === "question" ? event.options.length : undefined,
            })),
          });
        }
        if (toolInteractiveEvents.length > 0) {
          dispatch({
            type: "SET_INTERACTIVE_EVENTS",
            payload: toolInteractiveEvents,
          });

          const injectedContent = maybeInjectStreamingInteractiveContext(
            dispatch,
            getState,
            toolInteractiveEvents,
          );

          if (hasBlockingInteractiveEvents(toolInteractiveEvents)) {
            const streamingNow = getState().streaming;
            const streamingOverride = injectedContent && streamingNow
              ? { ...streamingNow, content: injectedContent }
              : null;
            flushVisibleStreamingSnapshotToMessages(dispatch, getState, streamingOverride);
            dispatch({ type: "FINISH_STREAMING" });
            dispatch({ type: "SET_PROCESSING", payload: false });
            break;
          }
        }

      }

      if (
        (partType === "subtask" || partType === "agent") &&
        structuredKind !== "thinking"
      ) {
        upsertStreamingStep(dispatch, getState, {
          id: asString(part.id) || undefined,
          callID: asString(part.callID) || undefined,
          title: inferredStepTitle(part),
          type: "step",
          status: normalizeProgressStatus(asString(part.status)),
          source: "stream",
          partType: partType,
          internal: false,
          meta: asString(part.meta) || undefined,
          startTime: Date.now(),
        });
      }

      if (partType === 'patch') {
        const files = Array.isArray(part.files) ? part.files : [];
        const normalizedFiles = files
          .map((file) => asString(file))
          .filter((file): file is string => file.length > 0);
        const primaryPatchFile = normalizedFiles[0];
        logger.info("[ACTIVITY STEP][EDIT] Streaming patch part", {
          messageId,
          files,
          rawPart: part,
        });
        files.forEach((file) => {
          const path = asString(file);
          if (path) {
            dispatch({ type: 'ADD_STREAMING_EDIT', payload: path });
          }
        });
        upsertStreamingStep(dispatch, getState, {
          id: asString(part.id) || undefined,
          callID: asString(part.callID) || undefined,
          title: inferredStepTitle(part),
          type: "step",
          status: normalizeProgressStatus(asString(part.status) || asString(asRecord(part.state)?.status)),
          source: "stream",
          partType: partType,
          internal: false,
          meta: primaryPatchFile || asString(part.meta) || undefined,
          filePath: primaryPatchFile,
          activityDetail: normalizeActivityDetail({
            kind: "file_edit",
            summary: primaryPatchFile || inferredStepTitle(part),
            file: primaryPatchFile,
            files: normalizedFiles,
            metadata: { fileCount: normalizedFiles.length },
          }),
          startTime: Date.now(),
        });
      }

      if (
        structuredKind === "progress" &&
        !isProgressPartType &&
        !isReasoning &&
        partType
      ) {
        upsertStreamingStep(dispatch, getState, {
          id: asString(part.id) || undefined,
          callID: asString(part.callID) || undefined,
          title: inferredStepTitle(part),
          type: "step",
          status: normalizeProgressStatus(asString(part.status)),
          source: "stream",
          partType: partType,
          internal: false,
          meta: asString(part.meta) || undefined,
          startTime: Date.now(),
        });
      }

      if (wasStreamInactiveAtPartStart && isTerminalProgressPart(part, partType)) {
        dispatchProcessingTrue();
        break;
      }

      dispatchProcessingTrue();
      break;
    }
    case 'message.updated': {
      // `tokens.input` is the SDK's authoritative size of the context sent for
      // this turn. It arrives on the streaming update before the final response
      // is persisted, so update the inspector immediately instead of waiting
      // for a later history reload.
      const eventTokens =
        asRecord(infoRecord?.tokens) ??
        asRecord(properties?.tokens) ??
        asRecord(payload.tokens);
      // Context size is the SDK prompt size: uncached input plus cached
      // prompt tokens. SessionStats remains cumulative billing/usage data.
      const eventInputTokens = normalizeTokenCount(eventTokens?.input);
      const eventCacheReadTokens = normalizeTokenCount(eventTokens?.cache?.read);
      const contextInputTokens =
        eventInputTokens === undefined && eventCacheReadTokens === undefined
          ? undefined
          : (eventInputTokens ?? 0) + (eventCacheReadTokens ?? 0);
      if (contextInputTokens !== undefined) {
        const modelIdentity = {
          providerID: firstNonEmptyString(
            infoRecord?.providerID,
            asRecord(infoRecord?.model)?.providerID,
            payload.providerID,
          ),
          modelID: firstNonEmptyString(
            infoRecord?.modelID,
            asRecord(infoRecord?.model)?.modelID,
            payload.modelID,
          ),
        };
        dispatch({ type: "SET_CONTEXT_INPUT_TOKENS", payload: contextInputTokens });
        dispatch({
          type: "SET_CONTEXT_USAGE_PCT",
          payload: calculateContextUsagePct(
            contextInputTokens,
            getState(),
            modelIdentity,
          ),
        });
      }
      const updatedText =
        asRichString(payload.text) ||
        asRichString(payload.content) ||
        asRichString(properties?.text) ||
        asRichString(properties?.content);
      if (updatedText && hasSystemMessagePatternInText(updatedText)) {
        dispatchProcessingTrue();
        break;
      }
      // Some providers can emit final assistant updates with role mislabels.
      // Continue processing instead of dropping the update.
      logger.debug(`Processing message.updated`, {
        messageId,
        finish: asBoolean(asRecord(payload.info)?.finish, false),
        hasInfo: !!asRecord(payload.info),
      });
      const finish = resolveMessageUpdatedFinishSignal(payload, properties);
      const currentStreamingSnapshot = getState().streaming;
      const currentStreamingMessageId = currentStreamingSnapshot?.messageId ?? null;
      if (!currentStreamingSnapshot) {
        ensureStreamingBootstrapFromCentralizedPayload(
          dispatch,
          getState,
          bootstrapContext,
        );
      }
      const finishBelongsToActiveAssistantTurn = terminalEventMatchesAssistantTurn(
        payload,
        [getState().streaming?.messageId, getState().assistantTurnMessageId],
      );
      // Some OpenCode `message.updated` envelopes omit `role` after the
      // first assistant phase. They are still assistant-phase transitions:
      // a user/system update always declares its role, while treating an
      // unlabelled update as non-assistant leaves the stream keyed to the
      // completed prior phase. That makes every subsequent tool/text part
      // look stray and causes the live timeline to freeze or disappear.
      const shouldStartFreshAssistantTurn =
        eventRole !== "user" &&
        eventRole !== "system" &&
        !!messageId &&
        !!currentStreamingSnapshot &&
        !!currentStreamingMessageId &&
        currentStreamingMessageId !== messageId;

      if (config.debug.showSdkEventDebug && messageId && currentStreamingMessageId) {
        logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] assistant-phase-decision", {
          eventId: asString(payload.id) || null,
          eventRole: eventRole || null,
          eventMessageId: messageId,
          currentStreamingMessageId,
          shouldStartFreshAssistantTurn,
          reason: shouldStartFreshAssistantTurn
            ? "message-id-changed-and-event-is-not-user-or-system"
            : "same-message-or-explicit-non-assistant-role",
        });
      }

      if (shouldStartFreshAssistantTurn) {
        // OpenCode advances a single user turn through multiple assistant SDK
        // envelopes (text -> tools -> text). This is a live phase transition,
        // not a new conversation turn. Preserve the turn-level activity, but
        // reset response-body state: each assistant message ID owns its own
        // response card. Spreading the previous content/responseChunks here
        // makes phase N+1 render phase N's prose, then appends phase N+1 to it.
        // Activity is merged by the reducer; response text is deliberately not.
        const eventAgent = asString(infoRecord?.agent) || asString(payload.agent);
        const eventModel = asRecord(infoRecord?.model) || asRecord(payload.model);
        const eventModelID = asString(infoRecord?.modelID) || asString(payload.modelID);
        const eventProviderID = asString(infoRecord?.providerID) || asString(payload.providerID);
        dispatch({
          type: "SET_STREAMING",
          payload: {
            ...currentStreamingSnapshot,
            messageId,
            content: "",
            hasRenderableContent: false,
            reasoning: "",
            reasoningEvents: [],
            contentStartSeq: undefined,
            contentPartStartIndex: undefined,
            responseChunks: [],
            lastRenderableTextPartID: undefined,
            isActive: true,
            agent: eventAgent || getState().selectedAgent || undefined,
            model:
              eventModel && typeof eventModel === "object"
                ? {
                    modelID:
                      asString(eventModel.modelID) ||
                      getState().selectedModel?.modelID ||
                      "",
                    providerID:
                      asString(eventModel.providerID) ||
                      getState().selectedModel?.providerID ||
                      "",
                    name:
                      asString((eventModel as Record<string, unknown>).name) ||
                      undefined,
                  }
                : undefined,
            modelID: eventModelID || getState().selectedModel?.modelID,
            providerID: eventProviderID || getState().selectedModel?.providerID,
            variant: getState().thinkingLevel,
          },
        });
        dispatch({
          type: "SET_ASSISTANT_TURN_PENDING",
          payload: { pending: true, messageId },
        });
      }

      if (structuredOutput && messageId) {
        applyStructuredSubagentPayload(dispatch, getState, structuredOutput, messageId);
      }

      const liveStructuredInteractiveEvents = structuredOutput
        ? toInteractiveEvents(structuredOutput)
        : [];
      const liveHasBlockingInteractive = hasBlockingInteractiveEvents(
        liveStructuredInteractiveEvents,
      );
      logLiveStructuredTurn("message.updated", {
        messageId,
        eventRole: eventRole || null,
        finish,
        structuredKind: structuredKind || null,
        responseType:
          firstNonEmptyString(
            asString(structuredOutput?.responseType),
            asString(payload.responseType),
            asString(properties?.responseType),
            asString(infoRecord?.responseType),
          ) || null,
        structuredTextPreview: previewForLog(structuredText),
        structuredQuestionPreview: previewForLog(
          asString(asRecord((structuredOutput as UnknownRecord | undefined)?.question)?.question) ||
            asString(asRecord((structuredOutput as UnknownRecord | undefined)?.question)?.message) ||
            asString(asRecord((structuredOutput as UnknownRecord | undefined)?.question)?.content) ||
            asString(structuredOutput?.message),
        ),
        currentStreaming: summarizeStreamingForLog(getState().streaming),
        interactiveCount: liveStructuredInteractiveEvents.length,
        interactiveKinds: liveStructuredInteractiveEvents.map((event) => event.type),
      });
      if (liveStructuredInteractiveEvents.length > 0) {
        dispatch({
          type: "SET_INTERACTIVE_EVENTS",
          payload: liveStructuredInteractiveEvents,
        });
        const injectedContent = maybeInjectStreamingInteractiveContext(
          dispatch,
          getState,
          liveStructuredInteractiveEvents,
        );
      }

      const hasRenderableLiveStructuredUpdate =
        !!updatedText.trim() ||
        !!structuredText.trim() ||
        liveStructuredInteractiveEvents.length > 0;
      if (
        structuredKind === "lifecycle" &&
        !finish &&
        !hasRenderableLiveStructuredUpdate
      ) {
        streamDebug("Stream: suppressing lifecycle-only message update", {
          messageId,
          eventRole: eventRole || null,
          structuredKind,
          finish,
          currentStreaming: summarizeStreamingForLog(getState().streaming),
        });
        break;
      }

      logger.info("[TRACE][HANDLER][MESSAGE_UPDATED_STATE]", {
        messageId,
        finish,
        structuredKind: structuredKind || null,
        hasRenderableLiveStructuredUpdate,
        liveInteractiveCount: liveStructuredInteractiveEvents.length,
        currentStreamingMessageId: getState().streaming?.messageId ?? null,
        currentStreamingInteractiveCount: getState().streaming?.interactiveEvents?.length ?? 0,
        streamingExists: !!getState().streaming,
      });

      if (finish && structuredOutput) {
        const structuredMessage =
          structuredOutput.text ||
          structuredOutput.message;
        if (structuredMessage) {
          const streamingState = getState().streaming;
          const rawReasoningLike = containsThoughtTagReasoning(structuredMessage);
          const mixedMessage = splitMixedReasoningFromContent(
            structuredMessage,
          );
          let messageText = structuredMessage;
          if (mixedMessage) {
            const mixedReasoning = sanitizeReasoningChunk(mixedMessage.reasoning);
            if (mixedReasoning) {
              dispatch({
                type: 'UPDATE_STREAMING_REASONING',
                payload: { reasoning: mixedReasoning, append: true }
              });
            }
            messageText = mixedMessage.content;
          }

          if (rawReasoningLike && !mixedMessage) {
            const reasoningLeak = sanitizeReasoningChunk(structuredMessage);
            if (reasoningLeak) {
              dispatch({
                type: 'UPDATE_STREAMING_REASONING',
                payload: { reasoning: reasoningLeak, append: true }
              });
            }
          } else if (containsThoughtTagReasoning(messageText)) {
            const reasoningLeak = sanitizeReasoningChunk(messageText);
            if (reasoningLeak) {
              dispatch({
                type: 'UPDATE_STREAMING_REASONING',
                payload: { reasoning: reasoningLeak, append: true }
              });
            }
          } else {
            const canRenderStructuredMessageLive =
              !!structuredMessage || !!finish;
            if (!canRenderStructuredMessageLive) {
              const deferredReasoning = sanitizeReasoningChunk(messageText || structuredMessage);
              if (deferredReasoning) {
                dispatch({
                  type: "UPDATE_STREAMING_REASONING",
                  payload: { reasoning: deferredReasoning, append: true },
                });
              }
              dispatchProcessingTrue();
              break;
            }
            if (mixedMessage) {
              const contentPatch = resolveStreamingContentUpdate(
                streamingState?.content || '',
                messageText,
                false,
              );
              if (contentPatch) {
                dispatch({
                  type: 'UPDATE_STREAMING_CONTENT',
                  payload: {
                    content: contentPatch.content,
                    append: contentPatch.append,
                    renderable: canRenderStructuredMessageLive,
                  }
                });
              }
            } else {
              const contentPatch = resolveStreamingContentUpdate(
                streamingState?.content || '',
                structuredMessage,
                false,
              );
              if (contentPatch) {
                dispatch({
                  type: 'UPDATE_STREAMING_CONTENT',
                  payload: {
                    content: contentPatch.content,
                    append: contentPatch.append,
                    renderable: canRenderStructuredMessageLive,
                  }
                });
              }
            }
          }
        }

        // Legacy structured todo updates are intentionally disabled. The
        // authoritative source is the SDK-native todoSnapshot path.
        try {
          const todoSource =
            asRecord(payload.structuredOutput) ?? structuredRecord ?? asRecord(properties?.structuredOutput);
          const rawTodoItems = Array.isArray(todoSource?.todoItems) ? todoSource!.todoItems : undefined;
          if (
            structuredOutput &&
            ((structuredOutput.type || structuredOutput.responseType) === '__legacy_disabled_todo_update' ||
              asString(payload.responseType) === '__legacy_disabled_todo_update') &&
            Array.isArray(rawTodoItems)
          ) {
            for (const raw of rawTodoItems) {
              const normalized = normalizeTodoRecord(raw);
              if (!normalized) continue; // skip malformed items silently
              if (!normalized.parentMessageId && messageId) {
                normalized.parentMessageId = messageId;
              }
              ingestNormalizedTodo(dispatch, getState, normalized);
            }
          }
        } catch (e) {
          // Defensive: never allow malformed structured payloads to throw inside
          // the message handler — just skip and continue processing other parts.
          logger.warn('Failed to inspect legacy todo structured payload', { error: String(e) });
        }
      }



      if (finish) {
        if (!finishBelongsToActiveAssistantTurn) {
          logger.debug("Ignoring terminal event for a different assistant turn", {
            messageId,
            activeMessageIds: [
              currentStreamingMessageId,
              getState().assistantTurnMessageId,
            ].filter(Boolean),
          });
          break;
        }
        if (markAssistantTurnClosed) {
          markAssistantTurnClosed(
            asString(asRecord(payload.info)?.id),
            asString(asRecord(properties)?.messageID),
            asString(asRecord(properties)?.messageId),
            asString(payload.messageId),
            asString(payload.messageID),
          );
        }
        const finalized = finalizeStreamingSnapshotSteps(
          getState().streaming,
          asString(asRecord(payload.info)?.error) ||
            asString(asRecord(properties)?.error)
            ? "error"
            : "done",
        );
        if (finalized) {
          dispatch({
            type: "SET_STREAMING",
            payload: {
              ...finalized,
              hasAssistantFinishSignal: true,
            },
          });
        }
        dispatch({
          type: "SET_ASSISTANT_TURN_PENDING",
          payload: { pending: false, messageId: null },
        });
        dispatch({ type: "SET_PROCESSING", payload: false });
        dispatch({ type: "FINISH_STREAMING" });
      } else {
        if (eventRole !== "user") {
          dispatchProcessingTrue();
        }
      }
      break;
    }
    case 'session.error':
    case 'error': {
      // Extract the error message from multiple possible payload shapes.
      // Server payloads nest the message: { error: { name, data: { message } } }
      // Older payloads may use flat { message } or { error: "string" } shapes.
      const errorRecord =
        asRecord(properties?.error) ?? asRecord(payload.error);
      const errorDataRecord = asRecord(errorRecord?.data);
      const errorMessage =
        asString(properties?.message) ||
        asString(errorDataRecord?.message) ||
        asString(errorRecord?.message) ||
        asString(payload.message) ||
        asString(payload.error) ||
        asString(properties?.reason) ||
        asString(properties?.code) ||
        asString(payload.reason) ||
        asString(payload.code);
      const errorReason =
        asString(properties?.reason) ||
        asString(properties?.code) ||
        asString(payload.reason) ||
        asString(payload.code);

      // Only surface user-facing errors for genuine problems, not signaling
      // events. The inline conversation card is driven by the matching
      // message.updated sync event for streaming-time failures, but
      // pre-message failures (invalid parts, server validation) never emit a
      // message.updated — so we must surface those as in-conversation errors.
      const isSignalingEvent =
        errorReason?.includes("completed") ||
        errorReason?.includes("finished") ||
        errorReason?.includes("done");

      const isGenuineError =
        !!errorMessage &&
        errorMessage.trim().length > 0 &&
        !isSignalingEvent;

      if (isGenuineError) {
        if (config.debug.showSdkEventDebug) {
          logger.warn("[LIVE-STREAM-TRACE][ERROR] materializing", {
            eventId: asString(payload.id) || null,
            sessionId: eventSessionId || state.currentSessionId || null,
            message: errorMessage,
            source: "webview",
          });
        }
        logger.info("ERROR_FLOW: Showing genuine error to user", {
          normalizedEventType,
          errorMessage,
          errorReason,
        });
        // A session.error can arrive after the SDK has already finalized the
        // transcript. Surface its exact live payload through the toast channel
        // as well, so the actionable failure is not dependent on a later
        // history refresh retaining a synthetic assistant message.
        dispatch({ type: "ADD_ERROR_MESSAGE", payload: errorMessage });
        materializeSessionErrorMessage(
          dispatch,
          getState,
          errorMessage,
          asString(payload.id) || undefined,
          payload,
        );
      } else {
        logger.debug("Skipping error event - not user-facing", {
          normalizedEventType,
          errorMessage,
          errorReason,
        });
      }

      dispatch({
        type: "SET_ASSISTANT_TURN_PENDING",
        payload: { pending: false, messageId: null },
      });
      dispatch({ type: 'SET_PROCESSING', payload: false });
      dispatch({ type: 'FINISH_STREAMING' });
      break;
    }
    case 'start':
    case 'streamStart': {
      logger.debug(`Processing stream start`, {
        messageId,
        eventAgent: asString(infoRecord?.agent) || asString(payload.agent),
      });
      // Extract model/agent metadata from the event payload or fall back to app state
      const eventAgent = asString(infoRecord?.agent) || asString(payload.agent);
      const eventModel = asRecord(infoRecord?.model) || asRecord(payload.model);
      const eventModelID = asString(infoRecord?.modelID) || asString(payload.modelID);
      const eventProviderID = asString(infoRecord?.providerID) || asString(payload.providerID);
      const latestStreaming = getState().streaming;
      const hasVisibleExistingStreaming =
        hasVisibleStreamingSnapshot(latestStreaming);
      const duplicateStartForVisibleStream = !!(
        latestStreaming &&
        hasVisibleExistingStreaming &&
        (
          !messageId ||
          !latestStreaming.messageId ||
          latestStreaming.messageId === messageId
        )
      );
      const startMetadata = {
        agent: eventAgent || state.selectedAgent || undefined,
        model:
          eventModel && typeof eventModel === "object"
            ? {
              modelID:
                asString(eventModel.modelID) ||
                state.selectedModel?.modelID ||
                "",
              providerID:
                asString(eventModel.providerID) ||
                state.selectedModel?.providerID ||
                "",
              name:
                asString((eventModel as Record<string, unknown>).name) ||
                undefined,
            }
            : undefined,
        modelID: eventModelID || state.selectedModel?.modelID,
        providerID: eventProviderID || state.selectedModel?.providerID,
        variant: state.thinkingLevel,
      };

      dispatch({
        type: "SET_STREAMING",
        payload: duplicateStartForVisibleStream && latestStreaming
          ? {
            ...latestStreaming,
            messageId: latestStreaming.messageId || messageId,
            isActive: true,
            ...startMetadata,
          }
          : {
            messageId,
            content: "",
            hasRenderableContent: false,
            reasoning: "",
            reasoningEvents: [],
            steps: [],
            progressEvents: [],
            edits: [],
            isActive: true,
            // Include model/agent metadata for display during streaming
            ...startMetadata,
          },
      });
      dispatchProcessingTrue();
      break;
    }
    case 'contentDelta':
    case 'content':
    case 'text':
    case 'text-delta': {
      if (eventRole && eventRole !== "assistant") {
        dispatchProcessingTrue();
        break;
      }
      if (structuredKind && structuredKind !== "message") {
        dispatchProcessingTrue();
        break;
      }
      const chunk =
        asString(payload.delta) || asString(payload.text) || asString(payload.content) || asString(payload.chunk);
      if (chunk) {
        const streamingState = getState().streaming;
        const eventPartType = asString(eventPart?.type).toLowerCase();
        // `contentDelta` is a legacy envelope name, not proof that the chunk
        // is assistant response text. Providers can send a reasoning token
        // through this path after first declaring its part as `reasoning`.
        // Keep the identity check here in lockstep with message.part.updated
        // so a delayed/rewrapped reasoning delta never leaks into the AI card.
        const isKnownReasoningPart = Boolean(
          reasoningPartID &&
            (knownReasoningPartIDs?.has(reasoningPartID) ||
              streamingState?.reasoningPartIDs?.includes(reasoningPartID)),
        );
        const isTextFieldDelta = Boolean(asString(payload.delta).trim());
        const skipContentChunk =
          (streamingState?.inReasoningPart ?? false) ||
          isKnownReasoningPart ||
          isTextFieldDelta ||
          structuredKind === "thinking" ||
          eventPartType === "reasoning" ||
          partType === "reasoning" ||
          !!asString(payload.reasoning) ||
          !!asString(payload.thinking) ||
          !!asString(payload.thought);
        if (skipContentChunk) {
          if (
            eventPartType === "reasoning" ||
            partType === "reasoning" ||
            isTextFieldDelta
          ) {
            const sanitized = sanitizeReasoningChunk(chunk);
            if (sanitized) {
              dispatch({
                type: "UPDATE_STREAMING_REASONING",
                payload: {
                  reasoning: sanitized,
                  append: true,
                  partID: reasoningPartID,
                  messageID: messageId || undefined,
                  delta: true,
                },
              });
            }
          }
          dispatchProcessingTrue();
          break;
        }
        const contentEmpty = !streamingState || !streamingState.content.trim();
        let candidateChunk = contentEmpty
          ? stripLeadingUserEcho(chunk, getState())
          : chunk;
        const mixedChunk = splitMixedReasoningFromContent(candidateChunk);
        if (mixedChunk) {
          const mixedReasoning = sanitizeReasoningChunk(mixedChunk.reasoning);
          if (mixedReasoning) {
            dispatch({
              type: "UPDATE_STREAMING_REASONING",
              payload: {
                reasoning: mixedReasoning,
                append: true,
                partID: reasoningPartID,
                messageID: messageId || undefined,
                delta: true,
              },
            });
          }
          candidateChunk = mixedChunk.content;
        }
        const cleanedChunk = candidateChunk;
        if (!cleanedChunk) {
          break;
        }
        if (containsThoughtTagReasoning(cleanedChunk)) {
          const reasoningLeak = sanitizeReasoningChunk(cleanedChunk);
          if (reasoningLeak) {
            dispatch({
              type: "UPDATE_STREAMING_REASONING",
              payload: {
                reasoning: reasoningLeak,
                append: true,
                partID: reasoningPartID,
                messageID: messageId || undefined,
                delta: true,
              },
            });
          }
          break;
        }
        const fromDelta =
          eventType === 'contentDelta' ||
          eventType === 'text-delta' ||
          !!asString(payload.delta);
        const contentPatch = resolveStreamingContentUpdate(
          streamingState?.content || '',
          cleanedChunk,
          fromDelta,
        );
        if (!contentPatch) {
          break;
        }
        streamDebug("Stream: content delta chunk", {
          messageId,
          eventType,
          append: contentPatch.append,
          length: cleanedChunk.length,
          preview: cleanedChunk.slice(0, 80),
        });
        dispatch({
          type: 'UPDATE_STREAMING_CONTENT',
          payload: {
            content: contentPatch.content,
            append: contentPatch.append,
            // Mark content as renderable if we have actual non-empty content.
            // This fixes the chicken-and-egg problem where the first chunk
            // couldn't be marked renderable because streaming state wasn't
            // renderable yet, while avoiding rendering empty chunks.
            renderable: cleanedChunk.length > 0,
          },
        });
      }
      break;
    }
    case 'reasoningDelta':
    case 'reasoning':
    case 'thinking': {
      const chunk =
        asString(payload.delta) || asString(payload.reasoning) || asString(payload.thinking) || asString(payload.text);
      logger.debug(`Processing reasoning/thinking event`, {
        normalizedEventType,
        chunkLength: chunk.length,
        preview: chunk.slice(0, 100),
      });
      const sanitized = sanitizeReasoningChunk(chunk);
      if (sanitized) {
        dispatch({
          type: 'UPDATE_STREAMING_REASONING',
          payload: {
            reasoning: sanitized,
            append: true,
            partID: reasoningPartID,
            messageID: messageId || undefined,
            delta: true,
          },
        });
      }
      break;
    }
    case 'stepStart': {
      const stepTitle = asString(payload.title);
      const stepTypeRaw = asString(payload.stepType).toLowerCase();
      logger.debug(`Processing stepStart`, {
        normalizedEventType,
        stepTitle,
        stepType: stepTypeRaw,
      });
      const step: StreamingStep = {
        id: asString(payload.id) || undefined,
        callID: asString(payload.callID) || undefined,
        title: asString(payload.title, 'Working'),
        type:
          stepTypeRaw === 'tool' ||
            stepTypeRaw === 'reasoning' ||
            stepTypeRaw === 'thinking'
            ? (stepTypeRaw === "thinking" ? "reasoning" : stepTypeRaw)
            : 'step',
        status: 'pending',
        source: "stream",
        partType: "step-start",
        internal: false,
        meta: asString(payload.meta) || undefined,
        filePath: asString(payload.filePath) || undefined,
        startTime: Date.now()
      };
      // Legacy `stepStart` envelopes can be mirrored by both the direct event
      // stream and the sync stream. Route them through the same semantic
      // identity merge as `message.part.updated`; appending here would render
      // both transport copies as activity rows.
      upsertStreamingStep(dispatch, getState, step);
      break;
    }
    case 'stepUpdate': {
      logger.debug(`Processing stepUpdate`, {
        normalizedEventType,
        stepId: asString(payload.id) || asString(payload.callID),
      });
      dispatch({
        type: 'UPDATE_STREAMING_STEP',
        payload: {
          id: asString(payload.id) || undefined,
          callID: asString(payload.callID) || undefined,
          patch: {
            title: asString(payload.title) || undefined,
            meta: asString(payload.meta) || undefined,
            filePath: asString(payload.filePath) || undefined,
            source: "stream",
            partType: "step-update",
          }
        }
      });
      break;
    }
    case 'stepDone': {
      logger.debug(`Processing stepDone`, {
        normalizedEventType,
        stepId: asString(payload.id) || asString(payload.callID),
        stepStatus: asString(payload.status),
      });
      dispatch({
        type: 'UPDATE_STREAMING_STEP',
        payload: {
          id: asString(payload.id) || undefined,
          callID: asString(payload.callID) || undefined,
          patch: {
            status: 'done',
            duration: asOptionalNumber(payload.duration),
            source: "stream",
            partType: "step-finish",
          }
        }
      });
      break;
    }
    case 'stepError': {
      dispatch({
        type: 'UPDATE_STREAMING_STEP',
        payload: {
          id: asString(payload.id) || undefined,
          callID: asString(payload.callID) || undefined,
          patch: {
            status: 'error',
            meta: asString(payload.error) || asString(payload.meta) || 'Failed',
            source: "stream",
            partType: "step-error",
          }
        }
      });
      break;
    }
    case 'edit':
    case 'fileEdit': {
      const file = asString(payload.file) || asString(payload.path);
      if (file) {
        dispatch({ type: 'ADD_STREAMING_EDIT', payload: file });
      }
      break;
    }
    case 'message.completed':
    case 'session.completed':
    case 'finish':
    case 'done': {
      const completesAssistantTurn = normalizedEventType !== 'message.completed';
        const terminalStatus: "done" | "error" =
        asString(payload.error) || asString(asRecord(payload.info)?.error)
          ? "error"
          : "done";

      if (completesAssistantTurn && markAssistantTurnClosed) {
        markAssistantTurnClosed(
          asString(asRecord(payload.info)?.id),
          asString(asRecord(properties)?.messageID),
          asString(asRecord(properties)?.messageId),
          asString(payload.messageId),
          asString(payload.messageID),
        );
      }

      const finalized = finalizeStreamingSnapshotSteps(
        getState().streaming,
        terminalStatus,
      );
      if (finalized) {
        dispatch({
          type: "SET_STREAMING",
          payload: {
            ...finalized,
            ...(completesAssistantTurn
              ? { hasAssistantFinishSignal: true }
              : { hasTerminalStepSignal: true }),
          },
        });
      }
      if (!completesAssistantTurn) {
        break;
      }
      dispatch({
        type: 'FINISH_STREAMING',
        payload: {
          usage: {
            total: asNumber(payload.total, 0),
            duration: asOptionalNumber(payload.duration)
          }
        }
      });
      dispatch({
        type: "SET_ASSISTANT_TURN_PENDING",
        payload: { pending: false, messageId: null },
      });
      dispatch({ type: "SET_PROCESSING", payload: false });
      break;
    }
    default: {
      let consumed = false;
      const interactiveEvents = toInteractiveEvents(structuredOutput);
      const hasBlockingInteractive =
        hasBlockingInteractiveEvents(interactiveEvents);
      if (interactiveEvents.length > 0) {
        dispatch({ type: "SET_INTERACTIVE_EVENTS", payload: interactiveEvents });
        maybeInjectStreamingInteractiveContext(
          dispatch,
          getState,
          interactiveEvents,
        );
        logger.info("[TRACE][HANDLER][STRUCTURED_INTERACTIVE_EVENTS]", {
          eventType: normalizedEventType,
          messageId,
          structuredKind: structuredKind || null,
          interactiveCount: interactiveEvents.length,
          blockingInteractive: hasBlockingInteractive,
          streamingExists: !!getState().streaming,
          streamingInteractiveCount: getState().streaming?.interactiveEvents?.length ?? 0,
        });
        consumed = true;
      }

      if (structuredOutput?.subagents || structuredOutput?.subagentsDelta) {
        applyStructuredSubagentPayload(dispatch, getState, structuredOutput, messageId || '');
        bindStreamingToParentMessageIdFromSubagents(
          dispatch,
          getState,
          getState().subagentsByParentMessageId,
        );
        consumed = true;
      }

      if (structuredKind === "thinking" && structuredText) {
        const chunk = sanitizeReasoningChunk(structuredText);
        if (chunk) {
          dispatch({
            type: "UPDATE_STREAMING_REASONING",
            payload: { reasoning: chunk, append: true },
          });
          consumed = true;
        }
      } else if (structuredKind === "message" && structuredText) {
        const streamingState = getState().streaming;
        const rawReasoningLike = containsThoughtTagReasoning(structuredText);
        let messageText = structuredText;
        const mixedMessage = splitMixedReasoningFromContent(messageText);
        logLiveStructuredTurn("structured.message.before-render", {
          messageId,
          responseType:
            firstNonEmptyString(
              asString(structuredOutput?.responseType),
              asString(payload.responseType),
              asString(properties?.responseType),
              asString(infoRecord?.responseType),
            ) || null,
          structuredKind,
          rawReasoningLike,
          structuredTextPreview: previewForLog(structuredText),
          mixedReasoningPreview: previewForLog(mixedMessage?.reasoning),
          mixedContentPreview: previewForLog(mixedMessage?.content),
          streamingBefore: summarizeStreamingForLog(streamingState),
        });
        if (mixedMessage) {
          const mixedReasoning = sanitizeReasoningChunk(mixedMessage.reasoning);
          if (mixedReasoning) {
            dispatch({
              type: "UPDATE_STREAMING_REASONING",
              payload: { reasoning: mixedReasoning, append: true },
            });
            consumed = true;
          }
          messageText = mixedMessage.content;
        }
        if (rawReasoningLike && !mixedMessage) {
          const reasoningLeak = sanitizeReasoningChunk(structuredText);
          if (reasoningLeak) {
            dispatch({
              type: "UPDATE_STREAMING_REASONING",
              payload: { reasoning: reasoningLeak, append: true },
            });
            consumed = true;
          }
          break;
        }
        if (containsThoughtTagReasoning(messageText)) {
          const reasoningLeak = sanitizeReasoningChunk(messageText);
          if (reasoningLeak) {
            dispatch({
              type: "UPDATE_STREAMING_REASONING",
              payload: { reasoning: reasoningLeak, append: true },
            });
            consumed = true;
          }
          break;
        }
        const contentPatch = resolveStreamingContentUpdate(
          streamingState?.content || '',
          messageText,
          false,
        );
        logLiveStructuredTurn("structured.message.content-patch", {
          messageId,
          messageTextPreview: previewForLog(messageText),
          streamingContentPreview: previewForLog(streamingState?.content),
          contentPatch,
        });
        if (!contentPatch) {
          break;
        }
        dispatch({
          type: "UPDATE_STREAMING_CONTENT",
          payload: {
            content: contentPatch.content,
            append: contentPatch.append,
            renderable: true,
          },
        });
        consumed = true;
      } else if (structuredKind === "progress") {
        const fallbackPart = eventPart ?? properties ?? payload;
        const title = structuredText || inferredStepTitle(fallbackPart);
        if (title) {
          upsertStreamingStep(dispatch, getState, {
            id: asString(fallbackPart.id) || undefined,
            callID: asString(fallbackPart.callID) || undefined,
            title,
            type: "step",
            status: normalizeProgressStatus(asString(fallbackPart.status)),
            source: "stream",
            partType: normalizePartType(fallbackPart.type) || "progress",
            internal: false,
            meta: asString(fallbackPart.meta) || undefined,
            startTime: Date.now(),
          });
          consumed = true;
        }
      }

      if (consumed) {
        dispatchProcessingTrue();
      }
      break;
    }
  }

  // Log completion of event handling
  const finalState = getState();
  logger.debug(`Finished Processing: ${normalizedEventType}`, {
    timestamp: new Date().toISOString(),
    hasStreaming: !!finalState.streaming,
    streamingContentLength: finalState.streaming?.content?.length || 0,
    streamingReasoningLength: finalState.streaming?.reasoning?.length || 0,
    streamingStepsCount: finalState.streaming?.steps?.length || 0,
  });
}

function bindStreamingToParentMessageIdFromSubagents(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  summariesByParentMessageId: Record<string, SubagentSummary[]>,
): void {
  const parentMessageIds = Object.keys(summariesByParentMessageId).filter(Boolean);
  if (parentMessageIds.length === 0) {
    return;
  }

  const streaming = getState().streaming;
  if (!streaming || !streaming.isActive || streaming.messageId) {
    return;
  }

  dispatch({
    type: "SET_STREAMING",
    payload: {
      ...streaming,
      messageId: parentMessageIds[0],
    },
  });
}

function collectHydratedSubagentsFromState(
  state: AppState,
  parentMessageIds: Array<string | null | undefined>,
): SubagentDetail[] {
  const uniqueParentIds = Array.from(
    new Set(
      parentMessageIds.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      ),
    ),
  );
  if (uniqueParentIds.length === 0) {
    return [];
  }

  const byId = new Map<string, SubagentDetail>();
  for (const parentMessageId of uniqueParentIds) {
    const summaries = state.subagentsByParentMessageId[parentMessageId];
    if (!Array.isArray(summaries) || summaries.length === 0) {
      continue;
    }
    for (const summary of summaries) {
      byId.set(
        summary.id,
        hydrateSubagentSummary(summary, state.subagentDetailsById),
      );
    }
  }

  return Array.from(byId.values());
}

function mergeSubagentsIntoMessage(
  message: Message,
  hydratedFromState: SubagentDetail[],
  options?: { freezeIncompleteStatuses?: boolean; presentationPolicy?: SubagentPresentationPolicy },
): Message {
  if (hydratedFromState.length === 0) {
    return message;
  }

  const mergedById = new Map<string, SubagentDetail>();
  for (const entry of hydratedFromState) {
    mergedById.set(entry.id, entry);
  }

  const existing = Array.isArray(message.subagents) ? message.subagents : [];
  for (const entry of existing) {
    const current = mergedById.get(entry.id);
    if (!current) {
      mergedById.set(entry.id, entry);
      continue;
    }
    mergedById.set(entry.id, {
      ...current,
      ...entry,
      references:
        Array.isArray(entry.references) && entry.references.length > 0
          ? entry.references
          : current.references,
      thinkingEvents:
        Array.isArray(entry.thinkingEvents) && entry.thinkingEvents.length > 0
          ? entry.thinkingEvents
          : current.thinkingEvents,
      progressEvents:
        Array.isArray(entry.progressEvents) && entry.progressEvents.length > 0
          ? entry.progressEvents
          : current.progressEvents,
      timelineEvents:
        Array.isArray(entry.timelineEvents) && entry.timelineEvents.length > 0
          ? entry.timelineEvents
          : current.timelineEvents,
    });
  }

  return {
    ...message,
    subagents: Array.from(mergedById.values()).map((detail) =>
      normalizeHydratedSubagentDetail(
        detail,
        message,
        shouldFreezeSubagentForPresentation(
          detail,
          message,
          options?.presentationPolicy,
          options?.freezeIncompleteStatuses,
        ),
      ),
    ),
  };
}

function alignMessageSubagentParentIds(
  message: Message,
  parentMessageId: string | null,
): Message {
  if (!parentMessageId) {
    return message;
  }

  const existing = Array.isArray(message.subagents) ? message.subagents : [];
  if (existing.length === 0) {
    return message;
  }

  let changed = false;
  const nextSubagents = existing.map((entry) => {
    if (entry.parentMessageId === parentMessageId) {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      parentMessageId,
    };
  });

  if (!changed) {
    return message;
  }

  return {
    ...message,
    subagents: nextSubagents,
  };
}

function remapSubagentsToFinalMessageId(
  dispatch: Dispatch<AppAction>,
  getState: () => AppState,
  sourceMessageIds: Array<string | null | undefined>,
  finalMessageId: string | null,
): void {
  if (!finalMessageId) {
    return;
  }

  const state = getState();
  const persistedMessageIds = new Set<string>();
  if (state.messages && state.messages.length > 0) {
    state.messages.forEach((message) => {
      const messageId = getMessageId(message);
      if (messageId) {
        persistedMessageIds.add(messageId);
      }
    });
  }
  const uniqueSourceIds = Array.from(
    new Set(
      sourceMessageIds.filter(
        (value): value is string =>
          typeof value === "string" &&
          value.length > 0 &&
          !persistedMessageIds.has(value) &&
          value !== finalMessageId,
      ),
    ),
  );
  if (uniqueSourceIds.length === 0) {
    return;
  }

  const mergedSourceById = new Map<string, SubagentSummary>();
  for (const sourceMessageId of uniqueSourceIds) {
    const source = state.subagentsByParentMessageId[sourceMessageId];
    if (!Array.isArray(source) || source.length === 0) {
      continue;
    }
    source.forEach((entry) => {
      mergedSourceById.set(entry.id, {
        ...entry,
        parentMessageId: finalMessageId,
      });
    });
  }
  const updatedSource = Array.from(mergedSourceById.values());
  if (updatedSource.length === 0) {
    return;
  }
  const existingTarget = Array.isArray(
    state.subagentsByParentMessageId[finalMessageId],
  )
    ? state.subagentsByParentMessageId[finalMessageId]
    : [];
  const mergedById = new Map<string, SubagentSummary>();
  existingTarget.forEach((entry) => {
    mergedById.set(entry.id, entry);
  });
  updatedSource.forEach((entry) => {
    mergedById.set(entry.id, entry);
  });

  dispatch({
    type: "UPSERT_SUBAGENT_SUMMARIES",
    payload: {
      [finalMessageId]: Array.from(mergedById.values()),
    },
  });

  const detailUpdates: Record<string, SubagentDetail> = {};
  for (const entry of updatedSource) {
    const detail = state.subagentDetailsById[entry.id];
    if (detail && detail.parentMessageId !== finalMessageId) {
      detailUpdates[entry.id] = {
        ...detail,
        parentMessageId: finalMessageId,
      };
    }
  }
  if (Object.keys(detailUpdates).length > 0) {
    dispatch({ type: "UPSERT_SUBAGENT_DETAIL", payload: detailUpdates });
  }
}

export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState) {
  let latestStreamingSnapshot: StreamingState | null = null;
  let terminalErrorReached = false;
  let activeSubagentParentMessageIds = new Set<string>();
  // Retains reasoning-part provenance across native webview events that can
  // arrive before React commits the preceding reducer update.
  const knownReasoningPartIDs = new Set<string>();
  // Retains the one renderable text-part identity needed to retract an
  // immediate text → tool transition when individual native messages arrive
  // before React commits the first reducer action.
  const pendingRenderableTextPart: { partID?: string; messageID?: string } = {};
  const closedAssistantTurnMessageIds = new Set<string>();
  const stoppedSessionIds = new Set<string>();
  let awaitingInteractiveTurnStart = false;

  // Stopping is an immediate, user-owned transition. The server can still
  // deliver events that were already buffered when the abort was requested;
  // those events must not bootstrap another streaming card for the stopped
  // turn. A subsequent userMessageAppended event removes the session from this
  // set when a genuinely new turn begins.
  const isStoppedSession = (...sessionIds: Array<string | null | undefined>) => {
    const sessionId = firstNonEmptyString(...sessionIds);
    return !!sessionId && stoppedSessionIds.has(sessionId);
  };

  // A handler can be recreated after the SDK history has already supplied the
  // final assistant envelope. Reconstruct the terminal latch from that
  // authoritative transcript so a late stream/status frame cannot set the
  // loading state back to true.
  const hasRenderedTerminalAssistantBlock = (state: AppState): boolean => {
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const message = state.messages[index];
      const info = asRecord(message.info);
      const role = firstNonEmptyString(
        asString(info?.role),
        asString(message.role),
      )?.trim().toLowerCase();
      if (role === "user") {
        return false;
      }
      if (role !== "assistant") {
        continue;
      }
      const finish = firstNonEmptyString(
        asString(info?.finish),
        asString((message as UnknownRecord).finish),
      )?.trim().toLowerCase();
      return Boolean(
        message.aborted === true ||
        asBoolean(info?.aborted, false) ||
        finish === "stop" ||
        finish === "length" ||
        finish === "done" ||
        finish === "completed",
      );
    }
    return false;
  };

  const markAssistantTurnClosed = (...messageIds: Array<string | null | undefined>) => {
    for (const messageId of messageIds) {
      if (messageId) {
        closedAssistantTurnMessageIds.add(messageId);
      }
    }
  };

  const recordSessionIdleStatus = (sessionId: string | null): void => {
    const state = getState();
    const resolvedSessionId = sessionId || state.currentSessionId || null;
    logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] idle-status-observed", {
      sessionId: resolvedSessionId,
      currentSessionId: state.currentSessionId,
      streamingMessageId: state.streaming?.messageId ?? null,
      streamingSteps: state.streaming?.steps?.length ?? 0,
      isProcessing: state.isProcessing,
      processingSessionIds: state.processingSessionIds,
    });

    // The SDK's idle frame is terminal for the current turn. Keep the session
    // in the same closed-session latch used by an explicit Stop so a delayed
    // processing-session update cannot re-mount the loading ticker. A new
    // userMessageAppended already removes this latch before it starts its next
    // turn; no transcript/activity data is cleared here.
    if (resolvedSessionId) {
      stoppedSessionIds.add(resolvedSessionId);
    }

    // `session.status: idle` / `session.idle` are the SDK's terminal
    // lifecycle signal. Do not wait for a later history refresh to remove the
    // session from the transport hint, otherwise the Stop control and loading
    // ticker can remain mounted after a request failure or terminal tool turn.
    const remainingProcessingSessionIds = resolvedSessionId
      ? state.processingSessionIds.filter((id) => id !== resolvedSessionId)
      : state.processingSessionIds;
    if (remainingProcessingSessionIds.length !== state.processingSessionIds.length) {
      dispatch({
        type: "SET_PROCESSING_SESSIONS",
        payload: remainingProcessingSessionIds,
      });
    }

    if (!resolvedSessionId || resolvedSessionId === state.currentSessionId) {
      dispatch({
        type: "SET_ASSISTANT_TURN_PENDING",
        payload: { pending: false, messageId: null },
      });
      dispatch({ type: "SET_PROCESSING", payload: false });
      // FINISH_STREAMING preserves the already rendered content/activity, but
      // makes it inactive so the UI no longer treats this turn as loading.
      dispatch({ type: "FINISH_STREAMING" });
      if (config.debug.showSdkEventDebug) {
        logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] idle-cleared-loading", {
          sessionId: resolvedSessionId,
          removedProcessingSession: remainingProcessingSessionIds.length !== state.processingSessionIds.length,
          source: "webview",
        });
      }
    }
  };

  const streamEventCanStartVisibleAssistantTurn = (payload: UnknownRecord): boolean => {
    // Use the same semantic envelope readers as handleStreamEvent. SDK stream
    // frames can arrive as `{ type: "sync", syncEvent: { type, data } }`;
    // treating `sync` as the event type here rejects a valid first assistant
    // part before the renderer gets a chance to unwrap it.
    const eventType = getCentralizedEventType(payload);
    if (eventType === "start" || eventType === "streamStart") {
      return true;
    }
    if (eventType === "question.asked") {
      return interactiveEventsFromQuestionAskedPayload(payload).length > 0;
    }

    const properties = asRecord(payload.properties);
    const partRecord = getCentralizedEventPart(payload) ?? asRecord(properties?.part);
    const infoRecord = getCentralizedEventInfo(payload) ?? asRecord(properties?.info);
    const eventPart =
      getCentralizedEventPart(payload) ??
      asRecord(payload.part) ??
      partRecord ??
      (eventType.startsWith("message.part.") ? asRecord(properties) : null);

    if (eventType.startsWith("message.part.") && shouldBootstrapStreamingFromPart(eventPart)) {
      return true;
    }

    const updatedText =
      asRichString(payload.text) ||
      asRichString(payload.content) ||
      asRichString(properties?.text) ||
      asRichString(properties?.content) ||
      asRichString(eventPart?.text) ||
      asRichString(eventPart?.content) ||
      asRichString(eventPart?.message);
    if (updatedText.trim()) {
      return true;
    }

    const structuredText =
      asRichString(eventPart?.reasoning) ||
      asRichString(eventPart?.thought) ||
      asRichString(eventPart?.thinking);
    if (normalizePartType(eventPart?.type) === "reasoning" || structuredText.trim()) {
      return true;
    }

    const structuredOutput = structuredOutputFromCentralizedEventPayload(payload, {
      includeFallbackCandidate: false,
    });

    if (structuredOutput) {
      return true;
    }

    return false;
  };

  const upsertPermissionRequest = (
    payload: unknown,
    fallbackSessionID?: string | null,
  ) => {
    const request = permissionRequestFromSdkPayload(payload, fallbackSessionID);
    if (!request || request.sessionID !== getState().currentSessionId) return;
    const interactiveId = `permission-request-${request.id}`;
    if (getState().interactiveEvents.some((event) => event.id === interactiveId)) return;
    dispatch({
      type: "SET_INTERACTIVE_EVENTS",
      payload: [...getState().interactiveEvents, {
        type: "quick_actions",
        id: interactiveId,
        title: `Allow ${request.permission || "operation"}?`,
        uiCategory: "quick_input",
        contextMessage: request.patterns.length > 0
          ? `OpenCode requests **${request.permission || "operation"}** access to:\n\n${request.patterns.map((pattern) => `\`${String(pattern)}\``).join("\n")}`
          : "OpenCode requests your permission to continue.",
        permissionID: request.id,
        sessionID: request.sessionID,
        permissionPatterns: request.patterns.map((pattern) => String(pattern)),
        permissionName: request.permission,
        actions: [
          { id: "once", label: "Allow", value: "once", recommended: true },
          ...(request.always.length > 0
            ? [{ id: "always", label: "Always allow", value: "always" }]
            : []),
          { id: "reject", label: "Reject", value: "reject" },
        ],
      }],
    });
  };

  /** Route all ephemeral SDK UI events through one observable path. */
  const routeLiveEventToUi = (
    payload: unknown,
    sessionId: string | null,
    source: "streamEvent" | "streamEventBatch" | "liveEventStreamDebugBatch",
    index = 0,
  ) => {
    // This is deliberately before normal stream gating: a paused agent may no
    // longer report `processing`, but a permission request must still render.
    upsertPermissionRequest(payload, sessionId);
    const liveRoute = routeLiveEvent(payload, index);

    if (liveRoute.toast) {
      dispatch({
        type: "APPEND_LIVE_TOAST_NOTIFICATION",
        payload: { sessionId, notification: liveRoute.toast },
      });
    }
    if (liveRoute.sessionStatus) {
      dispatch({ type: "UPDATE_LIVE_SESSION_STATUS", payload: liveRoute.sessionStatus });
    }
    return liveRoute;
  };

  // Keep the SDK debug panel useful without recreating the old performance
  // problem: retain references to the already-received payloads, group them
  // into one reducer update per session/batch, and let the reducer enforce the
  // fixed-size window. Nothing here is serialized or persisted.
  const appendLiveEventsToDebugPanel = (
    items: Array<{ event: unknown; sessionId: string | null }>,
  ) => {
    if (!config.debug.showSdkEventDebug || items.length === 0) {
      return;
    }
    const eventsBySessionId = new Map<string, unknown[]>();
    for (const item of items) {
      const sessionId = item.sessionId || getState().currentSessionId;
      if (!sessionId) {
        continue;
      }
      const sessionEvents = eventsBySessionId.get(sessionId);
      if (sessionEvents) {
        sessionEvents.push(item.event);
      } else {
        eventsBySessionId.set(sessionId, [item.event]);
      }
    }
    for (const [sessionId, events] of eventsBySessionId) {
      const appendResult = appendLiveSdkDebugEvents(sessionId, events);
      const traceableEvents = events
        .map((event) => {
          const record = asRecord(event);
          const eventType = getCentralizedEventType(record ?? {});
          const part = getCentralizedEventPart(record ?? {});
          const delta = asString(part?.delta) || asString(asRecord(record?.properties)?.delta);
          return {
            eventId: asString(record?.id) || null,
            eventType,
            partType: asString(part?.type) || null,
            partId: asString(part?.id) || null,
            messageId:
              asString(part?.messageID) ||
              asString(part?.messageId) ||
              extractEventMessageId(record ?? {}) ||
              null,
            isHighFrequencyDelta:
              eventType.startsWith("message.part.") && delta.length > 0,
          };
        })
        .filter((event) => event.eventType !== "server.heartbeat" && !event.isHighFrequencyDelta);
      if (traceableEvents.length > 0) {
        logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] debug-store-appended", {
          sessionId,
          receivedCount: events.length,
          storedCount: appendResult.storedCount,
          retainedCount: appendResult.retainedCount,
          traceableEvents,
        });
      }
    }
  };

  const isLikelyInteractiveAnswerSubmissionMessage = (message: Message): boolean => {
    const role = asString(message.role) || asString(asRecord(message.info)?.role);
    if (role !== "user") {
      return false;
    }
    if (message.interactiveSubmit === true) {
      return true;
    }
    const text =
      asOptionalString(message.content) ||
      asOptionalString(message.text) ||
      contentFromParts(Array.isArray(message.parts) ? message.parts : []);
    if (!text) {
      return false;
    }
    if (
      /(?:^|\n)\s*question\s+\d+\s*:/i.test(text) &&
      /(?:^|\n)\s*answer\s*:/i.test(text)
    ) {
      return true;
    }
    if (containsInteractiveMarker(text)) {
      return true;
    }
    return false;
  };

  const trackActiveSubagentParentIds = (
    summariesByParentMessageId: Record<string, SubagentSummary[]>,
  ) => {
    Object.entries(summariesByParentMessageId).forEach(
      ([parentMessageId, summaries]) => {
        if (
          parentMessageId &&
          Array.isArray(summaries) &&
          summaries.length > 0
        ) {
          activeSubagentParentMessageIds.add(parentMessageId);
        }
      },
    );
  };

  return (event: MessageEvent) => {
    try {
      const data = asRecord(event.data);
      if (!data) {
        logger.warn('Received event with no data');
        return;
      }

      const type = asString(data.type);
      const eventMessageId = extractEventMessageId(data);

      // Avoid allocating and retaining the complete IPC payload when debug
      // output is filtered. This listener runs for every stream batch.
      if (logger.wouldLog('debug')) {
        logger.debug(`Received Event: ${type}`, {
          timestamp: new Date().toISOString(),
          eventType: type,
          dataKeys: Object.keys(data),
          // Never pass the full event graph to DevTools. Console entries retain
          // object references and can keep complete streamed payloads alive.
          eventCount: Array.isArray(data.events) ? data.events.length : undefined,
        });
      }

      // Set processing state BEFORE handling message types to ensure streaming state is created early.
      // Never bootstrap "in progress" UI from compaction lifecycle messages.
      // Also suppress once the active assistant turn has finished: trailing events
      // (session.diff, replayed parent-user messages) don't carry the assistant id,
      // so we fall back to the live assistantTurnMessageId latch.
      const currentAssistantTurnMessageId = getState().assistantTurnMessageId || null;
      const currentStreamingMessageId = getState().streaming?.messageId || null;
      const currentAssistantTurnIsClosed =
        !!currentAssistantTurnMessageId &&
        closedAssistantTurnMessageIds.has(currentAssistantTurnMessageId);
      const currentStreamingTurnIsClosed =
        !!currentStreamingMessageId &&
        closedAssistantTurnMessageIds.has(currentStreamingMessageId);
      const shouldSuppressProcessingBootstrap = !!(
        awaitingInteractiveTurnStart &&
        asBoolean(data.processing, false) &&
        (
          type !== "streamEvent" ||
          !streamEventCanStartVisibleAssistantTurn(asRecord(data.event) ?? data)
        )
      ) || (
        !!eventMessageId &&
        closedAssistantTurnMessageIds.has(eventMessageId)
      ) || currentAssistantTurnIsClosed || currentStreamingTurnIsClosed ||
        isStoppedSession(
          asString(data.sessionId),
          asString(data.sessionID),
          getState().currentSessionId,
        );
      if (
        asBoolean(data.processing, false) &&
        type !== "compactionStatus" &&
        type !== "compactionViewState" &&
        !shouldSuppressProcessingBootstrap
      ) {
        dispatch({ type: "SET_PROCESSING", payload: true });
      }

      switch (type) {
        case "initState":
        case "init": {
          closedAssistantTurnMessageIds.clear();
          terminalErrorReached = false;
          activeSubagentParentMessageIds = new Set<string>();
          const initSessionId =
            asString(asRecord(data.state)?.sessionId) ||
            asString(asRecord(data.state)?.currentSessionId) ||
            asString(data.sessionId) ||
            asString(data.currentSessionId) ||
            null;
          if (initSessionId) {
            logger.setSession(initSessionId);
          }
          const state = asRecord(data.state) ?? data;
          const stateBeforeInit = getState();
          const sessionId =
            asString(state.sessionId) || asString(state.currentSessionId) || null;
          const previousMessages = Array.isArray(stateBeforeInit.messages)
            ? stateBeforeInit.messages
            : [];
          const previousSessionsList = Array.isArray(stateBeforeInit.sessionsList)
            ? stateBeforeInit.sessionsList
            : [];
          const processingSessionIds = asArray(
            state.processingSessionIds,
            (item): item is string => typeof item === "string",
          );
          const selectedModelRecord = asRecord(state.selectedModel);
          const selectedModel = selectedModelRecord
            ? {
              providerID: asString(selectedModelRecord.providerID),
              modelID: asString(selectedModelRecord.modelID),
            }
            : null;

          if (
            sessionId &&
            !stateBeforeInit.receivedInitState &&
            previousMessages.length === 0 &&
            !stateBeforeInit.isLoadingSession
          ) {
            const existingSession = previousSessionsList.find(
              (session) => session.id === sessionId,
            );
            dispatch({
              type: "START_SESSION_LOADING",
              payload: {
                sessionId,
                title: existingSession?.title || sessionId,
              },
            });
          }

          dispatch({
            type: "SET_PROCESSING_SESSIONS",
            payload: processingSessionIds,
          });
          if (sessionId) {
            dispatch({ type: "SET_SESSION_ID", payload: sessionId });
            if (processingSessionIds.includes(sessionId)) {
              dispatch({ type: "SET_PROCESSING", payload: true });
            }
          }
          logger.info("[LOADING][HANDLER] initState processed", {
            sessionId,
            processingSessionIds,
            sessionIsProcessing: processingSessionIds.includes(sessionId ?? ""),
            isProcessingBefore: stateBeforeInit.isProcessing,
            streamingExistsBefore: !!stateBeforeInit.streaming,
            hasMessagesBefore: previousMessages.length,
          });
          dispatch({
            type: "SET_SERVER_STATUS",
            payload: asString(state.serverStatus, "connected"),
          });
          dispatch({
            type: "SET_SDK_VERSION",
            payload: asString(state.sdkVersion) || undefined,
          });
          dispatch({
            type: "SET_SERVER_ERROR",
            payload: asString(state.serverError) || undefined,
          });
          dispatch({
            type: "SET_SELECTED_MODEL",
            payload:
              selectedModel?.providerID && selectedModel?.modelID
                ? selectedModel
                : null,
          });
          dispatch({
            type: "SET_SELECTED_AGENT",
            payload: asString(state.selectedAgent),
          });
          dispatch({
            type: "SET_SERVER_VERSION",
            payload: asString(state.serverVersion) || undefined,
          });
          dispatch({
            type: "SET_COMPATIBILITY_WARNINGS",
            payload: normalizeCompatibilityWarnings(state.compatibilityWarnings),
          });
          const initCompatibilityToast = compatibilityWarningToast(
            normalizeCompatibilityWarnings(state.compatibilityWarnings),
            asOptionalString(state.sdkVersion),
            asOptionalString(state.serverVersion),
            sessionId,
          );
          if (initCompatibilityToast) {
            dispatch({
              type: "APPEND_LIVE_TOAST_NOTIFICATION",
              payload: { sessionId, notification: initCompatibilityToast },
            });
          }
          dispatch({ type: "SET_RECEIVED_INIT_STATE", payload: true });
          // Startup should become interactive as soon as initState arrives.
          // chatHistory is still allowed to hydrate afterward, but we do not
          // keep the shell blocked behind the session-loading overlay while
          // waiting on the fallback timeout.
          dispatch({ type: "END_SESSION_LOADING" });

          // Store workspace root on window object for use in file path display
          const workspaceRoot = asString(state.workspaceRoot);
          if (workspaceRoot) {
            // @ts-expect-error - setting __workspace_root__ for use in file path utilities
            window.__workspace_root__ = workspaceRoot;
          }

          // Clear/init todos from initState. The authoritative list arrives via
          // SDK-backed todoSnapshot messages; initState may carry an empty list
          // to prevent stale tasks while hydration is in flight.
          const rawTodoItems = Array.isArray(state.todoItems) ? state.todoItems : [];
          if (Array.isArray(state.todoItems)) {
            dispatch({
              type: 'SET_TODO_ITEMS',
              payload: normalizeTodoList(rawTodoItems, asString(state.currentSessionId)),
            });
          }

          const showLogger = state.showLogger;
          if (typeof showLogger === "boolean") {
            logger.setShowLogger(showLogger);
            dispatch({ type: "SET_SHOW_LOGGER", payload: showLogger });
          }
          break;
        }
        case "modelsList": {
          const models = asArray(
            data.models,
            (item): item is AppState["availableModels"][number] => {
              const rec = asRecord(item);
              const contextLimit =
                typeof rec?.contextLimit === "number"
                  ? rec.contextLimit
                  : undefined;
              const variantsValid =
                typeof rec?.variants === "undefined" ||
                (Array.isArray(rec.variants) &&
                  rec.variants.every((value) => typeof value === "string"));
              return (
                !!rec &&
                typeof rec.modelID === "string" &&
                typeof rec.providerID === "string" &&
                typeof rec.name === "string" &&
                (typeof rec.reasoning === "undefined" ||
                  typeof rec.reasoning === "boolean") &&
                variantsValid &&
                (contextLimit === undefined ||
                  (Number.isFinite(contextLimit) && contextLimit > 0))
              );
            },
          );
          dispatch({ type: "SET_MODELS_LIST", payload: models });

          // Handle configured providers from SDK config.providers()
          if (data.configuredProviders && Array.isArray(data.configuredProviders)) {
            const providers = asArray(
              data.configuredProviders,
              (item): item is string => typeof item === "string"
            );
            dispatch({ type: "SET_CONFIGURED_PROVIDERS", payload: providers });
          }

          dispatchContextUsageFromMessages(dispatch, getState(), getState().messages);
          break;
        }
        case "agentsList": {
          const agents = asArray(
            data.agents,
            (item): item is AppState["availableAgents"][number] => {
              const rec = asRecord(item);
              return (
                !!rec &&
                typeof rec.id === "string" &&
                typeof rec.name === "string" &&
                typeof rec.description === "string"
              );
            },
          );
          dispatch({ type: "SET_AGENTS_LIST", payload: agents });
          break;
        }
        case "statusUpdate": {
          dispatch({
            type: "SET_SERVER_STATUS",
            payload: asString(data.status, "unknown"),
          });
          if (typeof data.serverVersion !== "undefined") {
            dispatch({
              type: "SET_SERVER_VERSION",
              payload: asString(data.serverVersion) || undefined,
            });
          }
          if (typeof data.sdkVersion !== "undefined") {
            dispatch({
              type: "SET_SDK_VERSION",
              payload: asString(data.sdkVersion) || undefined,
            });
          }
          dispatch({
            type: "SET_SERVER_ERROR",
            payload: asString(data.serverError) || undefined,
          });
          break;
        }
        case "compatibilityStatus": {
          const compatibilityWarnings = normalizeCompatibilityWarnings(data.compatibilityWarnings);
          dispatch({
            type: "SET_COMPATIBILITY_WARNINGS",
            payload: compatibilityWarnings,
          });
          const compatibilityToast = compatibilityWarningToast(
            compatibilityWarnings,
            asOptionalString(data.sdkVersion) || getState().sdkVersion,
            asOptionalString(data.serverVersion) || getState().serverVersion,
            getState().currentSessionId,
          );
          if (compatibilityToast) {
            dispatch({
              type: "APPEND_LIVE_TOAST_NOTIFICATION",
              payload: {
                sessionId: getState().currentSessionId,
                notification: compatibilityToast,
              },
            });
          }
          break;
        }
        case "compactionStatus": {
          const sessionId = asString(data.sessionId);
          const currentSessionId = getState().currentSessionId;
          if (sessionId && currentSessionId && sessionId !== currentSessionId) {
            break;
          }
          const status = asString(data.status).toLowerCase();
          if (status !== "running" && status !== "done" && status !== "error") {
            break;
          }
          const normalizedStatus = status as "running" | "done" | "error";
          dispatch({
            type: "SET_COMPACTION_STATUS",
            payload: {
              status: normalizedStatus,
              at: asOptionalNumber(data.at),
              error: asString(data.error) || undefined,
              notice: asString(data.notice) || undefined,
              compactionDividerIndex: asOptionalNumber(data.compactionDividerIndex),
              compactionDividerBeforeMessageId: asOptionalString(
                data.compactionDividerBeforeMessageId,
              ),
              compactionDividerAfterMessageId: asOptionalString(
                data.compactionDividerAfterMessageId,
              ),
              collapsed:
                typeof data.collapsed === "boolean"
                  ? data.collapsed
                  : undefined,
              baselineStats: asSessionStats(data.baselineStats),
            },
          });
          if (normalizedStatus === "done") {
            const nextState = getState();
            if (nextState.currentSessionId) {
              vscode.postMessage({
                type: "setCompactionViewState",
                sessionId: nextState.currentSessionId,
                lastCompactedAt: nextState.lastCompactedAt,
                compactionDividerIndex: nextState.compactionDividerIndex,
                compactionDividerBeforeMessageId:
                  nextState.compactionDividerBeforeMessageId,
                compactionDividerAfterMessageId:
                  nextState.compactionDividerAfterMessageId,
                baselineStats: nextState.compactionBaselineStats,
                collapsed: nextState.compactedMessagesCollapsed,
              });
            }
          }
          if (normalizedStatus !== "running") {
            const stateAfterCompactionStatus = getState();
            const hasActiveAssistantStream =
              stateAfterCompactionStatus.streaming?.isActive === true ||
              stateAfterCompactionStatus.assistantTurnPending === true ||
              isProcessingInCurrentSession(
                stateAfterCompactionStatus.isProcessing,
                stateAfterCompactionStatus.currentSessionId,
                stateAfterCompactionStatus.processingSessionIds,
              );

            // Context compaction is a side operation, not an assistant-turn
            // terminal signal. Long conversations commonly complete compaction
            // between tool snapshots; clearing the live stream here drops all
            // subsequent activity until session.messages() rehydrates it.
            // Only clear an orphaned snapshot when no assistant turn is active.
            if (!hasActiveAssistantStream) {
              flushVisibleStreamingSnapshotToMessages(dispatch, getState);
              latestStreamingSnapshot = null;
              dispatch({ type: "SET_STEERING", payload: false });
              dispatch({ type: "SET_PROCESSING", payload: false });
              dispatch({ type: "FINISH_STREAMING" });
              dispatch({ type: "SET_STREAMING", payload: null });
            }
          }
          break;
        }
        case "compactionViewState": {
          const sessionId = asString(data.sessionId);
          const currentSessionId = getState().currentSessionId;
          if (sessionId && currentSessionId && sessionId !== currentSessionId) {
            break;
          }
          dispatch({
            type: "SET_COMPACTION_VIEW_STATE",
            payload: {
              lastCompactedAt: asOptionalNumber(data.lastCompactedAt),
              compactionDividerIndex: asOptionalNumber(data.compactionDividerIndex),
              compactionDividerBeforeMessageId: asOptionalString(
                data.compactionDividerBeforeMessageId,
              ),
              compactionDividerAfterMessageId: asOptionalString(
                data.compactionDividerAfterMessageId,
              ),
              collapsed:
                typeof data.collapsed === "boolean"
                  ? data.collapsed
                  : undefined,
              baselineStats: asSessionStats(data.baselineStats),
            },
          });
          break;
        }
        case "stopRequestHandled": {
          awaitingInteractiveTurnStart = false;
          const handledSessionId = firstNonEmptyString(
            asString(data.sessionId),
            asString(data.sessionID),
            getState().currentSessionId ?? undefined,
          );
          const currentSessionId = getState().currentSessionId;
          if (
            handledSessionId &&
            currentSessionId &&
            handledSessionId !== currentSessionId
          ) {
            break;
          }
          if (handledSessionId) {
            stoppedSessionIds.add(handledSessionId);
          }
          const currentStreaming = getState().streaming;
          latestStreamingSnapshot = currentStreaming ?? latestStreamingSnapshot;

          // Persist the streaming snapshot to prevent content loss
          // Once content is rendered, it should be treated as locked data
          if (latestStreamingSnapshot) {
            const currentMessages = getState().messages;

            // Convert streaming snapshot to a message
            let normalizedMessage = buildStreamingMessage(latestStreamingSnapshot);

            // Sanitize the message
            const sanitized = sanitizeAssistantMessageEcho(
              normalizedMessage,
              getState(),
            );

            // Handle subagents if present
            const streamingMessageId = latestStreamingSnapshot.messageId || null;
            const hydratedSubagentsFromState = collectHydratedSubagentsFromState(
              getState(),
              [
                streamingMessageId,
                ...Array.from(activeSubagentParentMessageIds),
              ],
            );

            if (hydratedSubagentsFromState.length > 0) {
              const withSubagents = mergeSubagentsIntoMessage(
                sanitized,
                hydratedSubagentsFromState,
                {
                  freezeIncompleteStatuses: true, // Freeze since we're stopping
                  presentationPolicy: { mode: "stream", sessionProcessing: false },
                },
              );
              if (withSubagents) {
                normalizedMessage = withSubagents;
              }
            }

            // Set aborted flag to indicate user stopped the response and clear
            // stale blocking interactive payloads so the interrupted badge can
            // render for the finalized assistant turn.
            (normalizedMessage as unknown as UnknownRecord).aborted = true;
            normalizedMessage.interactiveEvents = [];
            const normalizedInfo = asRecord(normalizedMessage.info) || {};
            normalizedMessage.info = {
              ...normalizedInfo,
              aborted: true,
            };

            const normalizedMessageId =
              asString(asRecord(normalizedMessage.info)?.id) ||
              asString((normalizedMessage as unknown as UnknownRecord).id) ||
              null;
            markAssistantTurnClosed(normalizedMessageId, streamingMessageId);

            // Persist to messages array (locked data). Replace matching assistant
            // turn instead of blind-append so already rendered content is never
            // displaced by a duplicate/empty terminal card.
            dispatch({
              type: "SET_MESSAGES",
              payload: replaceMatchingAssistantTurn(currentMessages, normalizedMessage, [
                normalizedMessageId,
                streamingMessageId,
              ]),
            });

            // Update subagents from centralized events (single source of truth)
            handleSubagentUpdatesFromCentralizedEvents(dispatch, getState);

          }

          dispatch({ type: "SET_STEERING", payload: false });
          dispatch({
            type: "SET_ASSISTANT_TURN_PENDING",
            payload: { pending: false, messageId: null },
          });
          dispatch({ type: "SET_PROCESSING", payload: false });
          dispatch({ type: "FINISH_STREAMING" });
          dispatch({ type: "SET_STREAMING", payload: null });
          dispatch({ type: "SET_INTERACTIVE_EVENTS", payload: [] });
          break;
        }
        case "messageResponse": {
          awaitingInteractiveTurnStart = false;
          const msg =
            (asRecord(data.message) as Message | null) ??
            (data as unknown as Message);
          const responseSessionId =
            firstNonEmptyString(
              asString(data.sessionId),
              asString(data.sessionID),
              deriveSessionIdFromMessage(msg, getState().currentSessionId),
            ) ?? undefined;
          const responseMessageId = getMessageId(msg);
          if (
            isStoppedSession(responseSessionId, getState().currentSessionId) ||
            (responseMessageId && closedAssistantTurnMessageIds.has(responseMessageId))
          ) {
            logger.info("[STOP] ignoring late message response", {
              sessionId: responseSessionId ?? getState().currentSessionId ?? null,
              messageId: responseMessageId,
            });
            break;
          }
          const currentMessages = getState().messages;

          // FORBIDDEN TO REMOVE - token accumulation for sticky header
          const tokensInput = msg.tokens?.input || msg.info?.tokens?.input || 0;
          dispatch({
            type: "ACCUMULATE_SESSION_STATS",
            payload: {
              input: tokensInput,
              output: msg.tokens?.output || msg.info?.tokens?.output || 0,
              read: msg.tokens?.cache?.read || msg.info?.tokens?.cache?.read || 0,
              write:
                msg.tokens?.cache?.write || msg.info?.tokens?.cache?.write || 0,
              duration:
                msg.duration || msg.timing?.duration || msg.info?.duration || 0,
            },
          });

          dispatch({
            type: "SET_CONTEXT_USAGE_PCT",
            payload: calculateContextUsagePct(
              getMessageInputTokens(msg),
              getState(),
              getMessageModelIdentity(msg),
            ),
          });
          dispatch({
            type: "SET_CONTEXT_INPUT_TOKENS",
            payload: getMessageInputTokens(msg),
          });

          const currentStateForResponse = getState();
          const currentStreaming = currentStateForResponse.streaming;
          const snapshotMessageId = latestStreamingSnapshot?.messageId || null;
          const hasOwnResponsePayload =
            !!asString(msg.content).trim() ||
            !!asString(msg.text).trim() ||
            (Array.isArray(msg.parts) && msg.parts.length > 0);
          const shouldDropMismatchedSnapshot =
            !!responseMessageId &&
            !!snapshotMessageId &&
            snapshotMessageId !== responseMessageId &&
            hasOwnResponsePayload;
          if (
            !currentStreaming &&
            latestStreamingSnapshot &&
            responseMessageId &&
            snapshotMessageId &&
            snapshotMessageId !== responseMessageId
          ) {
            streamDebug(
              "Stream: message ID mismatch, preserving latest snapshot",
              {
                responseMessageId,
                snapshotMessageId,
                shouldDropMismatchedSnapshot,
              },
            );
          }
          // Always prefer the latest local streaming snapshot for final normalization.
          // Some providers emit different IDs between stream events and final response.
          const plainTextFallbackFinal =
            asBoolean(asRecord(msg)?.plainTextFallback, false) ||
            asBoolean(asRecord(asRecord(msg)?.info)?.plainTextFallback, false);
          // A terminal SDK envelope with its own message ID (such as a task
          // tool result) is not a finalization of the card that is currently
          // streaming. Keep that card live and do not fold its activity into
          // the distinct envelope.
          const snapshotStreaming = shouldDropMismatchedSnapshot
            ? null
            : currentStreaming ?? latestStreamingSnapshot;
          const hasStreamingSnapshotActivity =
            hasVisibleStreamingSnapshot(snapshotStreaming);
          const interactiveEventsInResponse = isMessage(msg)
            ? interactiveEventsFromMessage(msg)
            : [];
          const shouldPreserveStreamingSnapshot =
            !plainTextFallbackFinal ||
            interactiveEventsInResponse.length > 0 ||
            hasStreamingSnapshotActivity;
          const terminalStatus: "done" | "error" =
            asString(msg.error) || asString(asRecord(asRecord(msg.info)?.error)?.message)
              ? "error"
              : "done";
          const streaming = shouldPreserveStreamingSnapshot
            ? finalizeStreamingSnapshotSteps(snapshotStreaming, terminalStatus)
            : null;
          streamDebug("Stream response: pre-normalization state", {
            responseSessionId: responseSessionId ?? null,
            responseMessageId: responseMessageId ?? null,
            snapshotMessageId,
            hasOwnResponsePayload,
            shouldDropMismatchedSnapshot,
            plainTextFallbackFinal,
            hasStreamingSnapshotActivity,
            shouldPreserveStreamingSnapshot,
            terminalStatus,
            responseMessage: summarizeMessageForLog(msg),
            currentStreaming: summarizeStreamingForLog(currentStreaming),
            snapshotStreaming: summarizeStreamingForLog(snapshotStreaming),
            finalizedStreaming: summarizeStreamingForLog(streaming),
          });
          let normalizedMessage = isMessage(msg)
            ? normalizeMessage(msg, streaming)
            : streaming
              ? buildStreamingMessage(streaming)
              : undefined;
          if (
            normalizedMessage &&
            snapshotStreaming &&
            interactiveEventsInResponse.length > 0
          ) {
            const hasCanonicalActivity =
              (Array.isArray(normalizedMessage.steps) &&
                normalizedMessage.steps.length > 0) ||
              (Array.isArray(normalizedMessage.progressEvents) &&
                normalizedMessage.progressEvents.length > 0);
            if (!hasCanonicalActivity) {
              const mergedSteps = normalizeActivitySteps(
                normalizedMessage,
                {
                  ...snapshotStreaming,
                  content: "",
                  hasRenderableContent: false,
                  reasoning: "",
                  reasoningEvents: [],
                },
                Array.isArray(normalizedMessage.parts)
                  ? (normalizedMessage.parts as MessagePart[])
                  : [],
              );
              if (mergedSteps.length > 0) {
                normalizedMessage = {
                  ...normalizedMessage,
                  steps: mergedSteps,
                  progressEvents: mergedSteps,
                };
              }
            }
          }
          let finalMessageId: string | null = null;
          let streamingMessageId: string | null = null;
          if (normalizedMessage) {
            streamingMessageId =
              currentStreaming?.messageId || snapshotMessageId;
            let sanitized = sanitizeAssistantMessageEcho(
              normalizedMessage,
              getState(),
            );

            // Extract error from info.error and set to message.error for display
            const infoRec = asRecord(sanitized.info);
            const errorRec = asRecord(infoRec?.error);
            if (errorRec) {
              const errorName = asString(errorRec.name);
              const errorData = asRecord(errorRec.data);
              const errorMessage = asString(errorData?.message) || asString(errorRec.message);
              if (errorMessage) {
                (sanitized as unknown as UnknownRecord).error = errorName
                  ? `${errorName}: ${errorMessage}`
                  : errorMessage;
              }
            }
            const provisionalFinalMessageId =
              asString(asRecord(sanitized.info)?.id) ||
              asString(sanitized.id) ||
              responseMessageId ||
              null;
            const hydratedSubagentsFromState = collectHydratedSubagentsFromState(
              getState(),
              [
                provisionalFinalMessageId,
                streamingMessageId,
                ...Array.from(activeSubagentParentMessageIds),
              ],
            );
            if (hydratedSubagentsFromState.length > 0) {
              sanitized = mergeSubagentsIntoMessage(
                sanitized,
                hydratedSubagentsFromState,
                {
                  freezeIncompleteStatuses: false,
                  presentationPolicy: { mode: "stream", sessionProcessing: true },
                },
              );
            }
            // CRITICAL FIX: Ensure ID consistency between streaming and final message
            // This prevents the final message from having a different ID than the streaming message,
            // which causes the UI to not update until session refresh
            const hasExistingInfoId = !!asString(asRecord(sanitized.info)?.id);
            const hasExistingTopLevelId = !!asString(sanitized.id);
            const shouldUseStreamingId = !hasExistingInfoId && !hasExistingTopLevelId && streamingMessageId;

            if (shouldUseStreamingId) {
              sanitized = {
                ...sanitized,
                id: streamingMessageId,
                info: {
                  ...(sanitized.info || {}),
                  id: streamingMessageId,
                },
              };
            }
            const preferredParentMessageId =
              asString(asRecord(sanitized.info)?.id) ||
              asString(sanitized.id) ||
              responseMessageId ||
              streamingMessageId ||
              null;
            sanitized = alignMessageSubagentParentIds(
              sanitized,
              preferredParentMessageId,
            );
            sanitized = backfillLiveInteractiveEventsIntoAssistantMessage(
              sanitized,
              interactiveEventsFromStreamingSnapshot(snapshotStreaming),
            );

            streamDebug("Stream response: post-normalization state", {
              responseMessageId: responseMessageId ?? null,
              streamingMessageId: streamingMessageId ?? null,
              snapshotMessageId,
              normalizedMessage: summarizeMessageForLog(normalizedMessage),
              sanitizedMessage: summarizeMessageForLog(sanitized),
              snapshotStreaming: summarizeStreamingForLog(snapshotStreaming),
            });

            finalMessageId =
              asString(asRecord(sanitized.info)?.id) ||
              asString(sanitized.id) ||
              responseMessageId ||
              streamingMessageId ||
              null;
            dispatch({
              type: "SET_MESSAGES",
              payload: replaceMatchingAssistantTurn(
                currentMessages,
                sanitized,
                [
                  finalMessageId,
                  responseMessageId,
                  // A completed SDK envelope with its own parts (for example
                  // a task tool) owns a distinct message ID. Do not merge it
                  // into a preceding stream snapshot that has a different ID.
                  ...(shouldDropMismatchedSnapshot
                    ? []
                    : [streamingMessageId, snapshotMessageId]),
                ],
              ),
            });
            remapSubagentsToFinalMessageId(
              dispatch,
              getState,
              [streamingMessageId, ...Array.from(activeSubagentParentMessageIds)],
              finalMessageId,
            );
            // Update subagents from centralized events (single source of truth)
            handleSubagentUpdatesFromCentralizedEvents(dispatch, getState);
            const interactiveEvents = interactiveEventsFromMessage(sanitized);
            if (interactiveEvents.length > 0) {
              dispatch({
                type: "SET_INTERACTIVE_EVENTS",
                payload: interactiveEvents,
              });
            }

          }
          const isMatchingStreamingMessage =
            streamingMessageId && finalMessageId && streamingMessageId === finalMessageId;
          const hasVisibleCurrentStreamingSnapshot = hasVisibleStreamingSnapshot(currentStreaming);
          const responseBelongsToDifferentAssistantPhase = Boolean(
            hasVisibleCurrentStreamingSnapshot &&
            streamingMessageId &&
            finalMessageId &&
            streamingMessageId !== finalMessageId,
          );
          // Only clear streaming state if this messageResponse matches the
          // current stream, or if the final payload is authoritative enough to
          // replace the local snapshot without losing visible assistant output.
          // IMPORTANT: an assistant turn can contain several SDK message IDs.
          // A mismatched response with an already-rendered activity timeline is
          // an intermediate phase response, not permission to clear the live
          // card. Clearing here drops the previous step block immediately when
          // the next step-start arrives. FINISH_STREAMING preserves that block
          // and the next phase is merged into it by the reducer.
          const responseHasAuthoritativePayload =
            !shouldDropMismatchedSnapshot &&
            (hasOwnResponsePayload || interactiveEventsInResponse.length > 0);
          const shouldClearStreamingAfterResponse =
            !responseBelongsToDifferentAssistantPhase &&
            (isMatchingStreamingMessage ||
              !currentStreaming ||
              !streamingMessageId ||
              responseHasAuthoritativePayload);
          streamDebug("Stream response: completion decision", {
            responseMessageId: responseMessageId ?? null,
            finalMessageId,
            streamingMessageId: streamingMessageId ?? null,
            snapshotMessageId,
            isMatchingStreamingMessage,
            hasOwnResponsePayload,
            interactiveEventsInResponse: interactiveEventsInResponse.length,
            shouldClearStreamingAfterResponse,
            currentStreaming: summarizeStreamingForLog(currentStreaming),
            latestStreamingSnapshot: summarizeStreamingForLog(
              latestStreamingSnapshot,
            ),
          });

          if (shouldClearStreamingAfterResponse) {
            if (!normalizedMessage) {
              flushVisibleStreamingSnapshotToMessages(
                dispatch,
                getState,
                snapshotStreaming,
              );
            }
            latestStreamingSnapshot = null;
            activeSubagentParentMessageIds = new Set<string>();
          }
          markAssistantTurnClosed(
            finalMessageId,
            responseMessageId,
            streamingMessageId,
            snapshotMessageId,
          );
          const isActiveSession = !responseSessionId || responseSessionId === getState().currentSessionId;
          if (isActiveSession) {
            dispatch({
              type: "SET_ASSISTANT_TURN_PENDING",
              payload: { pending: false, messageId: null },
            });
            dispatch({ type: "SET_PROCESSING", payload: false });
            if (shouldClearStreamingAfterResponse) {
              dispatch({ type: "SET_STREAMING", payload: null });
            } else {
              dispatch({ type: "FINISH_STREAMING" });
            }
          }
          break;
        }
        case "chatHistory": {
          let canonicalMessages: Message[] = [];
          let chatHistorySessionId = "";
          const sdkContextInputTokens = normalizeTokenCount(
            (data as UnknownRecord).contextInputTokens,
          );
          let hydrationPresentationPolicy: SubagentPresentationPolicy = {
            mode: "hydration",
            sessionProcessing: false,
          };
          const cancelIncompleteHydratedSubagents = false;
          try {
            terminalErrorReached = false;
            const historyAvailable = asBoolean(
              (data as UnknownRecord).available,
              true,
            );
            if (!historyAvailable) {
              const unavailableSessionId = asString(data.sessionId);
              const currentState = getState();
              const shouldPreserveVisibleTranscript = !!(
                unavailableSessionId &&
                currentState.currentSessionId === unavailableSessionId &&
                currentState.messages.length > 0
              );
              const unavailableReason =
                asString((data as UnknownRecord).unavailableReason) === "not_found"
                  ? "not_found"
                  : "unavailable";
              if (unavailableSessionId) {
                dispatch({ type: "SET_SESSION_ID", payload: unavailableSessionId });
              }
              // A transient or server-side decoding failure must not erase a
              // transcript that is already visible in this webview. A newly
              // opened unavailable session still starts empty and renders the
              // dedicated recovery state below.
              if (!shouldPreserveVisibleTranscript) {
                dispatch({ type: "SET_MESSAGES", payload: [] });
              }
              dispatch({
                type: "SET_PROCESSING_SESSIONS",
                payload: getState().processingSessionIds.filter(
                  (sessionId) => sessionId !== unavailableSessionId,
                ),
              });
              dispatch({
                type: "SET_SESSION_LOAD_ERROR",
                payload: unavailableSessionId
                  ? {
                      sessionId: unavailableSessionId,
                      reason: unavailableReason,
                      message:
                        asString((data as UnknownRecord).unavailableMessage) ||
                        "The conversation could not be loaded from the OpenCode server.",
                      status: normalizeTokenCount(
                        (data as UnknownRecord).unavailableStatus,
                      ),
                    }
                  : null,
              });
              dispatch({ type: "SET_PROCESSING", payload: false });
              dispatch({ type: "SET_STREAMING", payload: null });
              dispatch({
                type: "SET_ASSISTANT_TURN_PENDING",
                payload: { pending: false, messageId: null },
              });
              dispatch({ type: "END_SESSION_LOADING" });
              break;
            }
            dispatch({ type: "SET_SESSION_LOAD_ERROR", payload: null });
            const sdkMessages = asArray(data.messages, isMessage);
            // Some in-stream maintenance updates (notably compaction) publish
            // a renderable transcript only. They deliberately do not carry the
            // SDK `session.messages()` snapshot. That is not an authoritative
            // turn boundary and must never replace or clear the live stream.
            const hasAuthoritativeSdkSnapshot = Object.prototype.hasOwnProperty.call(
              data,
              "sdkMessages",
            );
            const rawSdkMessages = asArray<unknown>(
              (data as UnknownRecord).sdkMessages,
              (_item): _item is unknown => true,
            );
            const hydratedHistoryIsTerminal =
              hasTerminalAssistantReplyForLatestSdkTurn(rawSdkMessages);
            const historySessionId = asString(data.sessionId) || null;
            if (historySessionId) {
              logger.setSession(historySessionId);
            }
            const currentState = getState();
            const isSameActiveSessionHistory = !!(
              historySessionId && currentState.currentSessionId === historySessionId
            );
            const hasEmptySdkSnapshot =
              sdkMessages.length === 0 && rawSdkMessages.length === 0;
            const hasVisibleCurrentTranscript = currentState.messages.length > 0;
            const historySessionStreaming = historySessionId
              ? currentState.currentSessionId === historySessionId
                ? currentState.streaming
                : currentState.streamingBySessionId?.[historySessionId]
              : null;
            const hasNewerLocalAssistantTurn = Boolean(
              isSameActiveSessionHistory &&
                (
                  historySessionStreaming?.isActive ||
                  currentState.assistantTurnPending ||
                  isProcessingInCurrentSession(
                    currentState.isProcessing,
                    currentState.currentSessionId,
                    currentState.processingSessionIds,
                  )
                ),
            );
            // session.messages() can temporarily end at the previous completed
            // assistant reply while the next reply is still live. Do not let
            // that stale history terminal marker erase the newer local stream.
            const hydratedTurnIsTerminal =
              hydratedHistoryIsTerminal && !hasNewerLocalAssistantTurn;
            const hasLiveEventsForHistorySession =
              !!historySessionStreaming && hasVisibleStreamingSnapshot(historySessionStreaming);

            // A post-stop refresh can race OpenCode's session persistence. An
            // empty response for the already-visible session is therefore not
            // authoritative: the stop handler has just locked the live
            // snapshot into `messages`. Keep that snapshot (and its raw live
            // events) until session.messages() returns a real replacement.
            // A genuinely new/empty session still passes through because it
            // has no current transcript or live event buffer to protect.
            const shouldPreserveEmptySameSessionSnapshot =
              isSameActiveSessionHistory &&
              hasEmptySdkSnapshot &&
              (hasVisibleCurrentTranscript || hasLiveEventsForHistorySession);
            if (shouldPreserveEmptySameSessionSnapshot) {
              logger.warn("Ignoring empty SDK hydration snapshot for visible session", {
                sessionId: historySessionId,
                renderedMessageCount: currentState.messages.length,
                liveEventCount:
                  historySessionStreaming?.rawSdkEventPayloads?.length ?? 0,
              });
              dispatch({ type: "END_SESSION_LOADING" });
              break;
            }

            if (
              hasAuthoritativeSdkSnapshot &&
              historySessionId &&
              config.debug.showSdkEventDebug
            ) {
              // This is the unmodified `session.messages()` payload supplied
              // by the extension host, not the adapted render transcript.
              setRehydratedSdkDebugMessages(historySessionId, rawSdkMessages);
            }

            // Keep raw live diagnostics while a non-terminal turn is active.
            // In particular, compaction publishes a transcript-only update in
            // the middle of a response. Clearing the buffer there made the
            // debug panel (and the evidence for the live render path) empty
            // until the final SDK hydration.
            if (hasAuthoritativeSdkSnapshot && hydratedTurnIsTerminal) {
              if (config.debug.showSdkEventDebug) {
                logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] debug-store-cleared-terminal-hydration", {
                  sessionId: historySessionId,
                  sdkMessageCount: rawSdkMessages.length,
                });
              }
              clearLiveSdkDebugEvents(historySessionId ?? undefined);
            } else if (config.debug.showSdkEventDebug && historySessionId) {
              logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] debug-store-preserved-history-update", {
                sessionId: historySessionId,
                hasAuthoritativeSdkSnapshot,
                hydratedTurnIsTerminal,
              });
            }
            // Hydration renders the SDK `session.messages()` snapshot only.
            const sourceMessages = sdkMessages;
            const normalizedMessages = sourceMessages
              .map((msg) => normalizeMessage(msg, null))
              .filter((msg): msg is Message => !!msg)
              // A parent history response can occasionally include child
              // session envelopes. Those belong to the subagent modal, never
              // the main transcript. Keep session-less legacy records, but
              // reject any explicitly owned by a different SDK session.
              .filter((msg) => {
                const messageInfo = asRecord(msg.info);
                const messageSessionId = firstNonEmptyString(
                  asString(messageInfo?.sessionID),
                  asString(messageInfo?.sessionId),
                  asString((msg as UnknownRecord).sessionID),
                  asString((msg as UnknownRecord).sessionId),
                );
                return !historySessionId || !messageSessionId || messageSessionId === historySessionId;
              })
              .filter((msg) => isRenderableHistoryMessage(msg));
            // `session.messages()` returns complete SDK message envelopes.
            // Adjacent assistant messages can be distinct turns sharing the
            // same parent user message (tool calls followed by a final reply),
            // so preserve their SDK message-ID boundary during hydration.
            const messages = normalizedMessages;
            const hydratedMessages = hydrateLegacyInteractiveUserMessages(messages);
            const dedupedHydratedMessages =
              dedupeInteractiveUserHydrationMessages(hydratedMessages);
            const dedupedHydratedAttachmentEchoMessages =
              dedupeHydratedUserAttachmentEchoMessages(dedupedHydratedMessages);
            const dedupedPlanProceedMessages =
              dedupePlanProceedMessages(dedupedHydratedAttachmentEchoMessages);
            const dedupedSystemMessages =
              dedupeSystemMessages(dedupedPlanProceedMessages);
            if (config.debug.showSdkEventDebug) {
              const summarizeHydratedSteps = (records: unknown[]) =>
                records
                  .map((record) => asRecord(record))
                  .filter((record): record is UnknownRecord => Boolean(record))
                  .map((record) => {
                    const info = asRecord(record.info);
                    const parts = asArray(record.parts, (part): part is UnknownRecord => Boolean(asRecord(part)));
                    const partTools = parts
                      .filter((part) => asString(part.type).trim().toLowerCase() === "tool")
                      .map((part) => ({
                        partId: asString(part.id) || asString(part.partID) || null,
                        callId: asString(part.callID) || asString(part.callId) || null,
                        tool: asString(part.tool) || asString(part.name) || null,
                        messageId: asString(part.messageID) || asString(part.messageId) || null,
                      }));
                    // The host adapter stores hydrated tool parts in `steps`
                    // rather than duplicating them in message.parts. Include
                    // that canonical form in the trace as well.
                    const steps = asArray(record.steps, (step): step is UnknownRecord => Boolean(asRecord(step)));
                    const stepTools = steps.map((step) => ({
                      partId: asString(step.id) || asString(step.partID) || null,
                      callId: asString(step.callID) || asString(step.callId) || null,
                      tool: asString(step.type) || asString(step.partType) || asString(step.title) || null,
                      messageId: asString(step.messageID) || asString(step.messageId) || null,
                    }));
                    const tools = partTools.length > 0 ? partTools : stepTools;
                    return {
                      id: asString(record.id) || asString(info?.id) || null,
                      parentId: asString(info?.parentID) || asString(info?.parentId) || null,
                      role: asString(record.role) || asString(info?.role) || null,
                      partCount: parts.length,
                      stepCount: steps.length,
                      tools,
                    };
                  })
                  .filter((record) => record.role === "assistant" && record.tools.length > 0);
              logger.warn("[HYDRATION-STEP-TRACE][WEBVIEW] history-normalized", {
                sessionId: historySessionId,
                adapterAssistantToolMessages: summarizeHydratedSteps(sdkMessages),
                normalizedAssistantToolMessages: summarizeHydratedSteps(normalizedMessages),
                canonicalAssistantToolMessages: summarizeHydratedSteps(dedupedSystemMessages),
              });
            }
            activeSubagentParentMessageIds = new Set<string>();

            chatHistorySessionId = asString(data.sessionId);
            const payloadProcessingSessionIds = asArray(
              data.processingSessionIds,
              (item): item is string => typeof item === "string",
            );
            const inheritedProcessingSessionIds =
              payloadProcessingSessionIds.length > 0
                ? payloadProcessingSessionIds
                : currentState.processingSessionIds;
            // LOCKED REHYDRATION INVARIANT: SDK history is durable turn state;
            // processingSessionIds is an eventually-consistent transport hint.
            // A terminal latest SDK envelope must atomically evict this session
            // from the hint list or the independently rendered composer will
            // keep showing Stop after the response card is already complete.
            const effectiveProcessingSessionIds = hydratedTurnIsTerminal
              ? inheritedProcessingSessionIds.filter(
                  (sessionId) => sessionId !== chatHistorySessionId,
                )
              : inheritedProcessingSessionIds;
            dispatch({
              type: "SET_PROCESSING_SESSIONS",
              payload: effectiveProcessingSessionIds,
            });
            const isSessionProcessing = !!(chatHistorySessionId &&
              effectiveProcessingSessionIds.includes(chatHistorySessionId));
            const currentStreamingSnapshot = currentState.streaming;
            const isSameActiveSessionHydration = !!(
              chatHistorySessionId &&
              currentState.currentSessionId === chatHistorySessionId
            );
            const hasVisibleLiveStreamingSnapshot =
              hasVisibleStreamingSnapshot(currentStreamingSnapshot);
            const shouldPreserveActiveStreaming =
              !hydratedTurnIsTerminal &&
              isSameActiveSessionHydration &&
              // A completed phase can mark the snapshot inactive before the
              // next assistant phase arrives. A non-terminal SDK hydration is
              // not authority to erase that already-rendered timeline or text.
              // Only a terminal hydration may replace it.
              hasVisibleLiveStreamingSnapshot;
            if (isSameActiveSessionHydration && currentStreamingSnapshot) {
              logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] hydration-streaming-decision", {
                outcome: shouldPreserveActiveStreaming
                  ? "PRESERVED_VISIBLE_LIVE_SNAPSHOT"
                  : "HYDRATION_MAY_REPLACE_STREAMING",
                sessionId: chatHistorySessionId,
                hydratedTurnIsTerminal,
                hasAuthoritativeSdkSnapshot,
                streamingMessageId: currentStreamingSnapshot.messageId ?? null,
                streamingActive: currentStreamingSnapshot.isActive,
                streamingVisible: hasVisibleLiveStreamingSnapshot,
                stepCount: currentStreamingSnapshot.steps?.length ?? 0,
                progressCount: currentStreamingSnapshot.progressEvents?.length ?? 0,
                contentLength: currentStreamingSnapshot.content?.length ?? 0,
              });
            }
            // Set loading state if we're loading a different session
            const isSwitchingSession = !!(
              chatHistorySessionId &&
              currentState.currentSessionId !== chatHistorySessionId
            );
            const suppressSessionLoading = asBoolean(
              (data as UnknownRecord).suppressSessionLoading,
              false,
            );
            if (suppressSessionLoading) {
              logger.warn("[FORK_TRACE][WEBVIEW] fork chatHistory received", {
                chatHistorySessionId,
                previousSessionId: currentState.currentSessionId,
                isSwitchingSession,
                isSessionProcessing,
                payloadProcessingSessionIds,
                effectiveProcessingSessionIds,
                priorIsProcessing: currentState.isProcessing,
                priorIsLoadingSession: currentState.isLoadingSession,
                priorStreamingActive: currentStreamingSnapshot?.isActive ?? false,
                priorStreamingMessageId: currentStreamingSnapshot?.messageId ?? null,
                shouldPreserveActiveStreaming,
                messageCount: dedupedSystemMessages.length,
              });
            }
            if (isSwitchingSession && !suppressSessionLoading) {
              // Look up the session title from the sessions list
              const session = (currentState.sessionsList ?? []).find(s => s.id === chatHistorySessionId);
              const sessionTitle = session?.title || chatHistorySessionId;

              dispatch({
                type: "START_SESSION_LOADING",
                payload: { sessionId: chatHistorySessionId, title: sessionTitle }
              });
            }

            hydrationPresentationPolicy = {
              mode: "hydration",
              sessionProcessing:
                isSessionProcessing || shouldPreserveActiveStreaming,
            };

            if (!shouldPreserveActiveStreaming) {
              latestStreamingSnapshot = null;
            }

            if (hydratedTurnIsTerminal) {
              // These three fields feed separate UI surfaces (transcript,
              // ticker, and composer). Clear them as one terminal transition;
              // clearing only one is the historical source of this regression.
              dispatch({ type: "FINISH_STREAMING" });
              dispatch({ type: "SET_STREAMING", payload: null });
              dispatch({
                type: "SET_ASSISTANT_TURN_PENDING",
                payload: { pending: false },
              });
            }

            if (
              !shouldPreserveActiveStreaming &&
              (!isSwitchingSession || suppressSessionLoading)
            ) {
              dispatch({ type: "SET_STREAMING", payload: null });
              dispatch({ type: "SET_PROCESSING", payload: isSessionProcessing });
            }
            canonicalMessages = dedupedSystemMessages;
            if (chatHistorySessionId) {
              dispatch({ type: "SET_SESSION_ID", payload: chatHistorySessionId });
            }

            dispatch({ type: "SET_MESSAGES", payload: canonicalMessages });
            // Rehydrated transcript messages retain their centralized raw SDK
            // event tape. Replay permission requests through the exact same
            // extractor used by live SSE so a webview reload cannot hide an
            // already-pending approval.
            for (const message of canonicalMessages) {
              const rawEvents = (message as UnknownRecord).rawSdkEventPayloads;
              if (!Array.isArray(rawEvents)) continue;
              for (const rawEvent of rawEvents) {
                upsertPermissionRequest(rawEvent, chatHistorySessionId);
              }
            }
            if (suppressSessionLoading) {
              const stateAfterForkHistory = getState();
              logger.warn("[FORK_TRACE][WEBVIEW] fork chatHistory applied", {
                currentSessionId: stateAfterForkHistory.currentSessionId,
                isProcessing: stateAfterForkHistory.isProcessing,
                isLoadingSession: stateAfterForkHistory.isLoadingSession,
                processingSessionIds: stateAfterForkHistory.processingSessionIds,
                streamingActive: stateAfterForkHistory.streaming?.isActive ?? false,
                streamingMessageId: stateAfterForkHistory.streaming?.messageId ?? null,
                assistantTurnPending: stateAfterForkHistory.assistantTurnPending,
                assistantTurnMessageId: stateAfterForkHistory.assistantTurnMessageId,
                messageCount: stateAfterForkHistory.messages.length,
              });
            }
          } catch (error) {
            dispatch({ type: "END_SESSION_LOADING" });
            throw error;
          }

          const stateAfterMessages = getState();
          if (chatHistorySessionId && stateAfterMessages.currentSessionId !== chatHistorySessionId) {
            dispatch({ type: "SET_SESSION_ID", payload: chatHistorySessionId });
          }

          if (chatHistorySessionId && stateAfterMessages.currentSessionId === chatHistorySessionId) {
            dispatch({ type: "SET_TODO_ITEMS", payload: [] });
          }
          // Session is now fully loaded - clear loading state.
          // This is intentionally unconditional so startup hydration clears loading
          // even when chatHistory omits sessionId.
          dispatch({ type: "END_SESSION_LOADING" });

          // FORBIDDEN TO REMOVE - recalculate session stats from full history
          const stats = { input: 0, output: 0, read: 0, write: 0, duration: 0 };
          canonicalMessages.forEach((msg) => {
            stats.input += msg.tokens?.input || msg.info?.tokens?.input || 0;
            stats.output += msg.tokens?.output || msg.info?.tokens?.output || 0;
            stats.read +=
              msg.tokens?.cache?.read || msg.info?.tokens?.cache?.read || 0;
            stats.write +=
              msg.tokens?.cache?.write || msg.info?.tokens?.cache?.write || 0;
            stats.duration +=
              msg.duration || msg.timing?.duration || msg.info?.duration || 0;
          });
          dispatch({ type: "RESET_SESSION_STATS", payload: stats });
          dispatchContextUsageFromMessages(dispatch, getState(), canonicalMessages);
          // The extension resolves this from `client.session.messages()` rather
          // than from the renderable transcript. Prefer it whenever available.
          if (sdkContextInputTokens !== undefined) {
            dispatch({
              type: "SET_CONTEXT_INPUT_TOKENS",
              payload: sdkContextInputTokens,
            });
            dispatch({
              type: "SET_CONTEXT_USAGE_PCT",
              payload: calculateContextUsagePct(sdkContextInputTokens, getState()),
            });
          }
          dispatch({ type: "CLEAR_SUBAGENTS_FOR_SESSION" });

          // A subagent is owned by the assistant message that contains its
          // invocation. Reassert that relationship from the enclosing
          // transcript message during hydration: child-session events can
          // carry their own message id, but that id must never become the key
          // used by the parent response card.
          const detailsById = Object.fromEntries(
            canonicalMessages.flatMap((message) => {
              const parentMessageId = getMessageId(message);
              const parentSessionId = firstNonEmptyString(
                asString(asRecord(message.info)?.sessionID),
                asString((message as UnknownRecord).sessionID),
              );
              return (message.subagents ?? []).map((detail) => [
                detail.id,
                {
                  ...detail,
                  parentMessageId: parentMessageId || detail.parentMessageId,
                  parentSessionId: parentSessionId || detail.parentSessionId,
                },
              ]);
            }),
          );
          const summariesByParentMessageId = canonicalMessages.reduce<
            Record<string, SubagentSummary[]>
          >((summaries, message) => {
            const parentMessageId = getMessageId(message);
            const details = message.subagents ?? [];
            if (!parentMessageId || details.length === 0) {
              return summaries;
            }
            summaries[parentMessageId] = details.map((detail) => ({
              id: detail.id,
              parentMessageId,
              parentSessionId: detail.parentSessionId,
              agentId: detail.agentId,
              status: detail.status,
              latestActivity: detail.latestActivity,
            }));
            return summaries;
          }, {});
          const extractedHydratedSubagents = { summariesByParentMessageId, detailsById };

          const normalizedHydratedSubagents = normalizeHydratedSubagentMaps(
            extractedHydratedSubagents.summariesByParentMessageId,
            extractedHydratedSubagents.detailsById,
            canonicalMessages,
            false,
            hydrationPresentationPolicy,
            cancelIncompleteHydratedSubagents,
          );
          if (
            Object.keys(normalizedHydratedSubagents.summariesByParentMessageId)
              .length > 0
          ) {
            dispatch({
              type: "UPSERT_SUBAGENT_SUMMARIES",
              payload: normalizedHydratedSubagents.summariesByParentMessageId,
            });
          }
          if (Object.keys(normalizedHydratedSubagents.detailsById).length > 0) {
            dispatch({
              type: "UPSERT_SUBAGENT_DETAIL",
              payload: normalizedHydratedSubagents.detailsById,
            });
          }
          const latestInteractive = latestPendingInteractiveEvents(canonicalMessages);
          dispatch({
            type: "SET_INTERACTIVE_EVENTS",
            payload: latestInteractive,
          });
          logRenderSnapshot("chatHistory", canonicalMessages);
          break;
        }
        case "subagentSnapshot": {
          // DISABLED: Using centralized events as single source of truth
          // Backend should not send pre-processed subagent data
          break;
        }
        /* ORIGINAL CODE - DISABLED (commented out to prevent syntax errors)
        logger.info('[SUBAGENT][REHYDRATED] subagentSnapshot received', {
          logger.info('[SUBAGENT][REHYDRATED] subagentSnapshot received', {
            rawSummaryKeys: Object.keys(data.summariesByParentMessageId ?? data.subagentsByParentMessageId ?? {}),
            rawDetailKeys: Object.keys(data.detailsById ?? data.subagentDetailsById ?? {}),
            activeSessionId: getState().currentSessionId,
          });

          // Log detailed subagent data structure
          const rawSummaries = data.summariesByParentMessageId ?? data.subagentsByParentMessageId ?? {};
          const rawDetails = data.detailsById ?? data.subagentDetailsById ?? {};

          logger.info('[SUBAGENT][REHYDRATED] detailed subagent data inspection', {
            summaryCount: Object.keys(rawSummaries).length,
            detailsCount: Object.keys(rawDetails).length,
            // Sample first few subagents to see actual values
            sampleSummaries: Object.entries(rawSummaries).slice(0, 2).map(([parentId, subagents]) => ({
              parentId,
              subagentArray: Array.isArray(subagents) ? subagents.slice(0, 2).map(s => ({
                id: typeof s === 'object' && s !== null ? (s as any).id : undefined,
                agentId: typeof s === 'object' && s !== null ? (s as any).agentId : undefined,
                agent: typeof s === 'object' && s !== null ? (s as any).agent : undefined,
                provider: typeof s === 'object' && s !== null ? (s as any).provider ?? (s as any).providerID : undefined,
                model: typeof s === 'object' && s !== null ? (s as any).model ?? (s as any).modelID : undefined,
                status: typeof s === 'object' && s !== null ? (s as any).status : undefined,
              })) : [],
            })),
            sampleDetails: Object.entries(rawDetails).slice(0, 2).map(([detailId, detail]) => ({
              detailId,
              provider: typeof detail === 'object' && detail !== null ? (detail as any).provider ?? (detail as any).providerID : undefined,
              model: typeof detail === 'object' && detail !== null ? (detail as any).model ?? (detail as any).modelID : undefined,
              agentId: typeof detail === 'object' && detail !== null ? (detail as any).agentId : undefined,
            })),
          });

          const snapshotPolicy: SubagentPresentationPolicy = {
            mode: "hydration",
            sessionProcessing: getState().processing,
          };
          const rawSummariesByParentMessageId = normalizeSubagentSummaryMap(
            data.summariesByParentMessageId ?? data.subagentsByParentMessageId,
          );
          const rawDetailsById = normalizeSubagentDetailMap(
            data.detailsById ?? data.subagentDetailsById,
          );
          const activeSessionId = getState().currentSessionId;
          const payloadSessionId = getSubagentPayloadSessionId(
            rawSummariesByParentMessageId,
            rawDetailsById,
          );
          logger.info('[SUBAGENT][REHYDRATED] subagentSnapshot pre-render pull', {
            activeSessionId,
            payloadSessionId,
            rawSummaryParentKeys: Object.keys(rawSummariesByParentMessageId),
            rawDetailIds: Object.keys(rawDetailsById),
            processing: getState().processing,
            streamingMessageId: getState().streaming?.messageId ?? null,
          });

          // Log normalized subagent data to check if provider/model info is preserved
          logger.info('[SUBAGENT][REHYDRATED] normalized subagent data inspection', {
            normalizedSummaryCount: Object.keys(rawSummariesByParentMessageId).length,
            normalizedDetailsCount: Object.keys(rawDetailsById).length,
            sampleNormalizedSummaries: Object.entries(rawSummariesByParentMessageId).slice(0, 2).map(([parentId, subagents]) => ({
              parentId,
              subagentCount: Array.isArray(subagents) ? subagents.length : 0,
              sampleSubagent: Array.isArray(subagents) && subagents.length > 0 ? {
                id: subagents[0]?.id,
                agentId: subagents[0]?.agentId,
                provider: subagents[0]?.provider ?? subagents[0]?.providerID,
                model: subagents[0]?.model ?? subagents[0]?.modelID,
                status: subagents[0]?.status,
              } : null,
            })),
            sampleNormalizedDetails: Object.entries(rawDetailsById).slice(0, 2).map(([detailId, detail]) => ({
              detailId,
              provider: detail?.provider ?? detail?.providerID,
              model: detail?.model ?? detail?.modelID,
              agentId: detail?.agentId,
            })),
          });
          if (
            activeSessionId &&
            payloadSessionId &&
            payloadSessionId !== activeSessionId
          ) {
            logger.debug(
              "Ignoring subagentSnapshot payload for inactive session",
              {
                activeSessionId,
                payloadSessionId,
              },
            );
            break;
          }
          const scopedSnapshot = filterSubagentMapsForActiveSession(
            getState(),
            rawSummariesByParentMessageId,
            rawDetailsById,
          );
          const summariesByParentMessageId =
            scopedSnapshot.summariesByParentMessageId;
          const detailsById = scopedSnapshot.detailsById;
          const hasSnapshotSubagents =
            hasSubagentSummaryEntries(summariesByParentMessageId) ||
            Object.keys(detailsById).length > 0;

          // Defensive fallback: some session/history hydration flows can emit an
          // empty snapshot right after chatHistory has already restored subagents
          // from persisted messages. Avoid clobbering those restored cards.
          if (!hasSnapshotSubagents) {
            // Fallback to centralized events (single source of truth)
            const fallback = extractSubagentsFromCentralizedEvents(
              getState().streaming?.rawSdkEventPayloads ?? [],
            );
            const normalizedFallback = normalizeHydratedSubagentMaps(
              fallback.summariesByParentMessageId,
              fallback.detailsById,
              getState().messages,
              false,
              snapshotPolicy,
            );
            if (
              Object.keys(normalizedFallback.summariesByParentMessageId).length >
              0 ||
              Object.keys(normalizedFallback.detailsById).length > 0
            ) {
              trackActiveSubagentParentIds(
                normalizedFallback.summariesByParentMessageId,
              );
              dispatch({
                type: "UPSERT_SUBAGENT_SUMMARIES",
                payload: normalizedFallback.summariesByParentMessageId,
              });
              dispatch({
                type: "UPSERT_SUBAGENT_DETAIL",
                payload: normalizedFallback.detailsById,
              });
              syncSubagentMapsIntoMessages(
                dispatch,
                getState,
                normalizedFallback.summariesByParentMessageId,
                normalizedFallback.detailsById,
                "merge",
                {
                  freezeIncompleteStatuses: false,
                  presentationPolicy: snapshotPolicy,
                },
              );
              break;
            }
          }
          const normalizedSnapshot = normalizeHydratedSubagentMaps(
            summariesByParentMessageId,
            detailsById,
            getState().messages,
            false,
            snapshotPolicy,
          );

          // Log final normalized snapshot before rendering
          logger.info('[SUBAGENT][REHYDRATED] final normalized snapshot before render', {
            summaryCount: Object.keys(normalizedSnapshot.summariesByParentMessageId).length,
            detailsCount: Object.keys(normalizedSnapshot.detailsById).length,
            sampleFinalSummaries: Object.entries(normalizedSnapshot.summariesByParentMessageId).slice(0, 2).map(([parentId, subagents]) => ({
              parentId,
              subagentCount: Array.isArray(subagents) ? subagents.length : 0,
              sampleSubagent: Array.isArray(subagents) && subagents.length > 0 ? {
                id: subagents[0]?.id,
                agentId: subagents[0]?.agentId,
                provider: subagents[0]?.provider ?? subagents[0]?.providerID,
                model: subagents[0]?.model ?? subagents[0]?.modelID,
                status: subagents[0]?.status,
              } : null,
            })),
            sampleFinalDetails: Object.entries(normalizedSnapshot.detailsById).slice(0, 2).map(([detailId, detail]) => ({
              detailId,
              provider: detail?.provider ?? detail?.providerID,
              model: detail?.model ?? detail?.modelID,
              agentId: detail?.agentId,
            })),
          });

          const hasNormalizedSnapshotSubagents =
            hasSubagentSummaryEntries(
              normalizedSnapshot.summariesByParentMessageId,
            ) || Object.keys(normalizedSnapshot.detailsById).length > 0;
          if (!hasNormalizedSnapshotSubagents) {
            const existingState = getState();
            const hasExistingRenderedSubagents =
              hasSubagentSummaryEntries(
                existingState.subagentsByParentMessageId,
              ) || Object.keys(existingState.subagentDetailsById).length > 0;
            if (hasExistingRenderedSubagents) {
              break;
            }
          }
          trackActiveSubagentParentIds(
            normalizedSnapshot.summariesByParentMessageId,
          );
          dispatch({ type: "CLEAR_SUBAGENTS_FOR_SESSION" });
          if (
            Object.keys(normalizedSnapshot.summariesByParentMessageId).length > 0
          ) {
            dispatch({
              type: "UPSERT_SUBAGENT_SUMMARIES",
              payload: normalizedSnapshot.summariesByParentMessageId,
            });
          }
          if (Object.keys(normalizedSnapshot.detailsById).length > 0) {
            dispatch({
              type: "UPSERT_SUBAGENT_DETAIL",
              payload: normalizedSnapshot.detailsById,
            });
          }
          bindStreamingToParentMessageIdFromSubagents(
            dispatch,
            getState,
            normalizedSnapshot.summariesByParentMessageId,
          );
          syncSubagentMapsIntoMessages(
            dispatch,
            getState,
            normalizedSnapshot.summariesByParentMessageId,
            normalizedSnapshot.detailsById,
            "replace",
            {
              freezeIncompleteStatuses: false,
              presentationPolicy: snapshotPolicy,
            },
          );
          break;
          logger.info('[SUBAGENT][REHYDRATED] subagentSnapshot received', {
            rawSummaryKeys: Object.keys(data.summariesByParentMessageId ?? data.subagentsByParentMessageId ?? {}),
            rawDetailKeys: Object.keys(data.detailsById ?? data.subagentDetailsById ?? {}),
            activeSessionId: getState().currentSessionId,
          });

          // Log detailed subagent data structure
          const rawSummaries = data.summariesByParentMessageId ?? data.subagentsByParentMessageId ?? {};
          const rawDetails = data.detailsById ?? data.subagentDetailsById ?? {};

          logger.info('[SUBAGENT][REHYDRATED] detailed subagent data inspection', {
            summaryCount: Object.keys(rawSummaries).length,
            detailsCount: Object.keys(rawDetails).length,
            // Sample first few subagents to see actual values
            sampleSummaries: Object.entries(rawSummaries).slice(0, 2).map(([parentId, subagents]) => ({
              parentId,
              subagentArray: Array.isArray(subagents) ? subagents.slice(0, 2).map(s => ({
                id: typeof s === 'object' && s !== null ? (s as any).id : undefined,
                agentId: typeof s === 'object' && s !== null ? (s as any).agentId : undefined,
                agent: typeof s === 'object' && s !== null ? (s as any).agent : undefined,
                provider: typeof s === 'object' && s !== null ? (s as any).provider ?? (s as any).providerID : undefined,
                model: typeof s === 'object' && s !== null ? (s as any).model ?? (s as any).modelID : undefined,
                status: typeof s === 'object' && s !== null ? (s as any).status : undefined,
              })) : [],
            })),
            sampleDetails: Object.entries(rawDetails).slice(0, 2).map(([detailId, detail]) => ({
              detailId,
              provider: typeof detail === 'object' && detail !== null ? (detail as any).provider ?? (detail as any).providerID : undefined,
              model: typeof detail === 'object' && detail !== null ? (detail as any).model ?? (detail as any).modelID : undefined,
              agentId: typeof detail === 'object' && detail !== null ? (detail as any).agentId : undefined,
            })),
          });

          const snapshotPolicy: SubagentPresentationPolicy = {
            mode: "hydration",
            sessionProcessing: getState().processing,
          };
          const rawSummariesByParentMessageId = normalizeSubagentSummaryMap(
            data.summariesByParentMessageId ?? data.subagentsByParentMessageId,
          );
          const rawDetailsById = normalizeSubagentDetailMap(
            data.detailsById ?? data.subagentDetailsById,
          );
          const activeSessionId = getState().currentSessionId;
          const payloadSessionId = getSubagentPayloadSessionId(
            rawSummariesByParentMessageId,
            rawDetailsById,
          );
          logger.info('[SUBAGENT][REHYDRATED] subagentSnapshot pre-render pull', {
            activeSessionId,
            payloadSessionId,
            rawSummaryParentKeys: Object.keys(rawSummariesByParentMessageId),
            rawDetailIds: Object.keys(rawDetailsById),
            processing: getState().processing,
            streamingMessageId: getState().streaming?.messageId ?? null,
          });

          // Log normalized subagent data to check if provider/model info is preserved
          logger.info('[SUBAGENT][REHYDRATED] normalized subagent data inspection', {
            normalizedSummaryCount: Object.keys(rawSummariesByParentMessageId).length,
            normalizedDetailsCount: Object.keys(rawDetailsById).length,
            sampleNormalizedSummaries: Object.entries(rawSummariesByParentMessageId).slice(0, 2).map(([parentId, subagents]) => ({
              parentId,
              subagentCount: Array.isArray(subagents) ? subagents.length : 0,
              sampleSubagent: Array.isArray(subagents) && subagents.length > 0 ? {
                id: subagents[0]?.id,
                agentId: subagents[0]?.agentId,
                provider: subagents[0]?.provider ?? subagents[0]?.providerID,
                model: subagents[0]?.model ?? subagents[0]?.modelID,
                status: subagents[0]?.status,
              } : null,
            })),
            sampleNormalizedDetails: Object.entries(rawDetailsById).slice(0, 2).map(([detailId, detail]) => ({
              detailId,
              provider: detail?.provider ?? detail?.providerID,
              model: detail?.model ?? detail?.modelID,
              agentId: detail?.agentId,
            })),
          });
          if (
            activeSessionId &&
            payloadSessionId &&
            payloadSessionId !== activeSessionId
          ) {
            logger.debug(
              "Ignoring subagentSnapshot payload for inactive session",
              {
                activeSessionId,
                payloadSessionId,
              },
            );
            break;
          }
          const scopedSnapshot = filterSubagentMapsForActiveSession(
            getState(),
            rawSummariesByParentMessageId,
            rawDetailsById,
          );
          const summariesByParentMessageId =
            scopedSnapshot.summariesByParentMessageId;
          const detailsById = scopedSnapshot.detailsById;
          const hasSnapshotSubagents =
            hasSubagentSummaryEntries(summariesByParentMessageId) ||
            Object.keys(detailsById).length > 0;

          // Defensive fallback: some session/history hydration flows can emit an
          // empty snapshot right after chatHistory has already restored subagents
          // from persisted messages. Avoid clobbering those restored cards.
          if (!hasSnapshotSubagents) {
            // Fallback to centralized events (single source of truth)
            const fallback = extractSubagentsFromCentralizedEvents(
              getState().streaming?.rawSdkEventPayloads ?? [],
            );
            const normalizedFallback = normalizeHydratedSubagentMaps(
              fallback.summariesByParentMessageId,
              fallback.detailsById,
              getState().messages,
              false,
              snapshotPolicy,
            );
            if (
              Object.keys(normalizedFallback.summariesByParentMessageId).length >
              0 ||
              Object.keys(normalizedFallback.detailsById).length > 0
            ) {
              trackActiveSubagentParentIds(
                normalizedFallback.summariesByParentMessageId,
              );
              dispatch({
                type: "UPSERT_SUBAGENT_SUMMARIES",
                payload: normalizedFallback.summariesByParentMessageId,
              });
              dispatch({
                type: "UPSERT_SUBAGENT_DETAIL",
                payload: normalizedFallback.detailsById,
              });
              syncSubagentMapsIntoMessages(
                dispatch,
                getState,
                normalizedFallback.summariesByParentMessageId,
                normalizedFallback.detailsById,
                "merge",
                {
                  freezeIncompleteStatuses: false,
                  presentationPolicy: snapshotPolicy,
                },
              );
              break;
            }
          }
          const normalizedSnapshot = normalizeHydratedSubagentMaps(
            summariesByParentMessageId,
            detailsById,
            getState().messages,
            false,
            snapshotPolicy,
          );

          // Log final normalized snapshot before rendering
          logger.info('[SUBAGENT][REHYDRATED] final normalized snapshot before render', {
            summaryCount: Object.keys(normalizedSnapshot.summariesByParentMessageId).length,
            detailsCount: Object.keys(normalizedSnapshot.detailsById).length,
            sampleFinalSummaries: Object.entries(normalizedSnapshot.summariesByParentMessageId).slice(0, 2).map(([parentId, subagents]) => ({
              parentId,
              subagentCount: Array.isArray(subagents) ? subagents.length : 0,
              sampleSubagent: Array.isArray(subagents) && subagents.length > 0 ? {
                id: subagents[0]?.id,
                agentId: subagents[0]?.agentId,
                provider: subagents[0]?.provider ?? subagents[0]?.providerID,
                model: subagents[0]?.model ?? subagents[0]?.modelID,
                status: subagents[0]?.status,
              } : null,
            })),
            sampleFinalDetails: Object.entries(normalizedSnapshot.detailsById).slice(0, 2).map(([detailId, detail]) => ({
              detailId,
              provider: detail?.provider ?? detail?.providerID,
              model: detail?.model ?? detail?.modelID,
              agentId: detail?.agentId,
            })),
          });

          const hasNormalizedSnapshotSubagents =
            hasSubagentSummaryEntries(
              normalizedSnapshot.summariesByParentMessageId,
            ) || Object.keys(normalizedSnapshot.detailsById).length > 0;
          if (!hasNormalizedSnapshotSubagents) {
            const existingState = getState();
            const hasExistingRenderedSubagents =
              hasSubagentSummaryEntries(
                existingState.subagentsByParentMessageId,
              ) || Object.keys(existingState.subagentDetailsById).length > 0;
            if (hasExistingRenderedSubagents) {
              break;
            }
          }
          trackActiveSubagentParentIds(
            normalizedSnapshot.summariesByParentMessageId,
          );
          dispatch({ type: "CLEAR_SUBAGENTS_FOR_SESSION" });
          if (
            Object.keys(normalizedSnapshot.summariesByParentMessageId).length > 0
          ) {
            dispatch({
              type: "UPSERT_SUBAGENT_SUMMARIES",
              payload: normalizedSnapshot.summariesByParentMessageId,
            });
          }
          if (Object.keys(normalizedSnapshot.detailsById).length > 0) {
            dispatch({
              type: "UPSERT_SUBAGENT_DETAIL",
              payload: normalizedSnapshot.detailsById,
            });
          }
          bindStreamingToParentMessageIdFromSubagents(
            dispatch,
            getState,
            normalizedSnapshot.summariesByParentMessageId,
          );
          syncSubagentMapsIntoMessages(
            dispatch,
            getState,
            normalizedSnapshot.summariesByParentMessageId,
            normalizedSnapshot.detailsById,
            "replace",
            {
              freezeIncompleteStatuses: false,
              presentationPolicy: snapshotPolicy,
            },
          );
          break;
        }
        */ // END OF DISABLED subagentSnapshot CODE
        case "subagentUpdate": {
          const streamPolicy: SubagentPresentationPolicy = {
            mode: "stream",
            sessionProcessing: getState().processing,
            liveParentMessageIds:
              getState().streaming?.messageId
                ? new Set([getState().streaming?.messageId as string])
                : undefined,
          };
          const rawSummariesByParentMessageId = normalizeSubagentSummaryMap(
            data.summariesByParentMessageId ?? data.subagentsByParentMessageId,
          );
          const rawDetailsById = normalizeSubagentDetailMap(
            data.detailsById ?? data.subagentDetailsById,
          );

          // Log detailed incoming update data
          logger.info('[SUBAGENT][EVENT STREAM] detailed subagent update inspection', {
            summaryCount: Object.keys(rawSummariesByParentMessageId).length,
            detailsCount: Object.keys(rawDetailsById).length,
            sampleSummaries: Object.entries(rawSummariesByParentMessageId).slice(0, 2).map(([parentId, subagents]) => ({
              parentId,
              subagentCount: Array.isArray(subagents) ? subagents.length : 0,
              sampleSubagent: Array.isArray(subagents) && subagents.length > 0 ? {
                id: subagents[0]?.id,
                agentId: subagents[0]?.agentId,
                provider: subagents[0]?.provider ?? subagents[0]?.providerID,
                model: subagents[0]?.model ?? subagents[0]?.modelID,
                status: subagents[0]?.status,
              } : null,
            })),
            sampleDetails: Object.entries(rawDetailsById).slice(0, 2).map(([detailId, detail]) => ({
              detailId,
              provider: detail?.provider ?? detail?.providerID,
              model: detail?.model ?? detail?.modelID,
              agentId: detail?.agentId,
            })),
          });

          const activeSessionId = getState().currentSessionId;
          const payloadSessionId = getSubagentPayloadSessionId(
            rawSummariesByParentMessageId,
            rawDetailsById,
          );
          logger.info('[SUBAGENT][EVENT STREAM] subagentUpdate pre-render pull', {
            activeSessionId,
            payloadSessionId,
            rawSummaryParentKeys: Object.keys(rawSummariesByParentMessageId),
            rawDetailIds: Object.keys(rawDetailsById),
            processing: getState().processing,
            streamingMessageId: getState().streaming?.messageId ?? null,
          });
          if (
            activeSessionId &&
            payloadSessionId &&
            payloadSessionId !== activeSessionId
          ) {
            logger.debug(
              "Ignoring subagentUpdate payload for inactive session",
              {
                activeSessionId,
                payloadSessionId,
              },
            );
            break;
          }
          const scopedUpdate = filterSubagentMapsForActiveSession(
            getState(),
            rawSummariesByParentMessageId,
            rawDetailsById,
          );
          const summariesByParentMessageId =
            scopedUpdate.summariesByParentMessageId;
          const detailsById = scopedUpdate.detailsById;

          // Log scoped data after filtering for active session
          logger.info('[SUBAGENT][EVENT STREAM] scoped data after filtering', {
            scopedSummaryCount: Object.keys(summariesByParentMessageId).length,
            scopedDetailsCount: Object.keys(detailsById).length,
            sampleScopedSummaries: Object.entries(summariesByParentMessageId).slice(0, 2).map(([parentId, subagents]) => ({
              parentId,
              subagentCount: Array.isArray(subagents) ? subagents.length : 0,
              sampleSubagent: Array.isArray(subagents) && subagents.length > 0 ? {
                id: subagents[0]?.id,
                agentId: subagents[0]?.agentId,
                provider: subagents[0]?.provider,
                model: subagents[0]?.model,
                status: subagents[0]?.status,
                keys: subagents[0] ? Object.keys(subagents[0]) : [],
              } : null,
            })),
            sampleScopedDetails: Object.entries(detailsById).slice(0, 2).map(([detailId, detail]) => ({
              detailId,
              provider: detail?.provider,
              model: detail?.model,
              agentId: detail?.agentId,
              keys: detail ? Object.keys(detail) : [],
            })),
          });

          const hasScopedSubagents =
            hasSubagentSummaryEntries(summariesByParentMessageId) ||
            Object.keys(detailsById).length > 0;
          if (!hasScopedSubagents) {
            break;
          }
          const normalizedUpdate = normalizeHydratedSubagentMaps(
            summariesByParentMessageId,
            detailsById,
            getState().messages,
            false,
            streamPolicy,
          );
          const mergedSummaryUpdate = mergeSubagentSummaryPayload(
            getState().subagentsByParentMessageId,
            normalizedUpdate.summariesByParentMessageId,
          );
          const mergedDetailUpdate = mergeSubagentDetailPayload(
            getState().subagentDetailsById,
            normalizedUpdate.detailsById,
          );
          trackActiveSubagentParentIds(
            normalizedUpdate.summariesByParentMessageId,
          );
          if (hasSubagentSummaryEntries(mergedSummaryUpdate)) {
            dispatch({
              type: "UPSERT_SUBAGENT_SUMMARIES",
              payload: mergedSummaryUpdate,
            });
          }
          if (Object.keys(mergedDetailUpdate).length > 0) {
            dispatch({
              type: "UPSERT_SUBAGENT_DETAIL",
              payload: mergedDetailUpdate,
            });
          }
          bindStreamingToParentMessageIdFromSubagents(
            dispatch,
            getState,
            normalizedUpdate.summariesByParentMessageId,
          );
          syncSubagentMapsIntoMessages(
            dispatch,
            getState,
            mergedSummaryUpdate,
            mergedDetailUpdate,
            "merge",
            {
              freezeIncompleteStatuses: false,
              presentationPolicy: streamPolicy,
            },
          );
          break;
        }
        case "liveEventStreamDebugBatch": {
          const events = Array.isArray(data.events) ? data.events : [];
          const debugEvents: Array<{ event: unknown; sessionId: string | null }> = [];
          for (const [eventIndex, item] of events.entries()) {
            const itemRecord = asRecord(item);
            const event = asRecord(itemRecord?.event) ?? itemRecord ?? {};
            const sessionId =
              extractCentralizedEventSessionId(event) ||
              asString(itemRecord?.sessionId) ||
              asString(itemRecord?.sessionID) ||
              getState().currentSessionId ||
              null;
            debugEvents.push({ event, sessionId });
            // Startup `tui.show` notifications can bypass streamEvent. Route
            // them directly without retaining a duplicate diagnostic tape.
            const liveRoute = routeLiveEventToUi(
              event,
              sessionId,
              "liveEventStreamDebugBatch",
              eventIndex,
            );
            if (liveRoute.sessionStatus?.statusType === "idle") {
              recordSessionIdleStatus(sessionId);
            }
          }
          appendLiveEventsToDebugPanel(debugEvents);
          break;
        }
        case "streamEvent": {
          const stateBeforeStreamEvent = getState();
          const payload = asRecord(data.event) ?? data;
          const streamEventType = asString(payload.type) || "unknown";
          const envelopeSessionId =
            asString(data.sessionId) ||
            asString(data.sessionID);
          const eventSessionId =
            extractCentralizedEventSessionId(payload) || envelopeSessionId;
          const activeSessionId = stateBeforeStreamEvent.currentSessionId;
          const resolvedStreamSessionId = eventSessionId || activeSessionId || null;
          const canStartVisibleAssistantTurn =
            streamEventCanStartVisibleAssistantTurn(payload);
          const streamPart = getCentralizedEventPart(payload);
          const streamDelta =
            asString(streamPart?.delta) ||
            asString(asRecord(payload.properties)?.delta);
          const isHighFrequencyStreamDelta =
            getCentralizedEventType(payload).startsWith("message.part.") &&
            streamDelta.length > 0;
          if (!isHighFrequencyStreamDelta && streamEventType !== "server.heartbeat") {
            logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] received", {
              sessionId: resolvedStreamSessionId,
              eventId: asString(payload.id) || null,
              envelopeType: streamEventType,
              eventType: getCentralizedEventType(payload),
              envelopeSessionId: envelopeSessionId || null,
              sdkSessionId: extractCentralizedEventSessionId(payload) || null,
              activeSessionId: activeSessionId || null,
              partType: asString(streamPart?.type) || null,
              partId: asString(streamPart?.id) || null,
              messageId: extractEventMessageId(payload),
              partKeys: streamPart ? Object.keys(streamPart).slice(0, 16) : [],
              partTextLength: asRichString(streamPart?.text).length,
              partContentLength: asRichString(streamPart?.content).length,
              partDeltaLength: asRichString(streamPart?.delta).length,
            });
          }
          // `session.status` is intentionally filtered from the centralized
          // transcript, but it remains valuable transient diagnostic data.
          // Store it in the bounded Live Events buffer before any lifecycle
          // gate can discard the event from normal stream processing.
          const isSessionStatusEvent = streamEventType === "session.status";
          if (isSessionStatusEvent) {
            appendLiveEventsToDebugPanel([
              { event: payload, sessionId: resolvedStreamSessionId },
            ]);
          }
          const isActiveSessionTerminalTranscript =
            (!resolvedStreamSessionId || resolvedStreamSessionId === activeSessionId) &&
            hasRenderedTerminalAssistantBlock(stateBeforeStreamEvent);
          const isTerminalSessionError =
            getCentralizedEventType(payload) === "session.error" ||
            getCentralizedEventType(payload) === "error";
          if (isActiveSessionTerminalTranscript && !isTerminalSessionError) {
            // The assistant block already says it is done. Keep the raw event
            // available for the SDK debug panel, but do not let it bootstrap
            // processing, pending-turn, or streaming state again.
            logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] rejected-terminal-transcript", {
              sessionId: resolvedStreamSessionId,
              eventId: asString(payload.id) || null,
              eventType: getCentralizedEventType(payload),
            });
            appendLiveEventsToDebugPanel([
              { event: payload, sessionId: resolvedStreamSessionId },
            ]);
            dispatch({ type: "SET_ASSISTANT_TURN_PENDING", payload: { pending: false } });
            dispatch({ type: "SET_PROCESSING", payload: false });
            dispatch({ type: "FINISH_STREAMING" });
            break;
          }
          if (isTerminalSessionError && config.debug.showSdkEventDebug) {
            logger.warn("[LIVE-STREAM-TRACE][ERROR] admitted-after-terminal-card", {
              sessionId: resolvedStreamSessionId,
              eventId: asString(payload.id) || null,
              eventType: getCentralizedEventType(payload),
              source: "webview",
            });
          }
          // A retry status is actionable UI state (for example a provider
          // usage-limit reset time), not a buffered assistant-content frame.
          // Let it reach the live-status route even after a prior stop so the
          // user can see why the session is waiting. Other late events remain
          // suppressed to prevent a stopped turn from resuming its content.
          if (
            isStoppedSession(eventSessionId, activeSessionId) &&
            streamEventType !== "session.status" &&
            !isTerminalSessionError
          ) {
            logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] rejected-stopped-session", {
              sessionId: eventSessionId || activeSessionId || null,
              eventId: asString(payload.id) || null,
              eventType: getCentralizedEventType(payload),
            });
            logger.info("[LIVE-EVENT] ignoring late event for stopped session", {
              streamEventType,
              sessionId: eventSessionId || activeSessionId || null,
            });
            break;
          }
          const hasConfirmedProcessingSession = !!(
            (eventSessionId &&
              stateBeforeStreamEvent.processingSessionIds.includes(eventSessionId)) ||
            (!eventSessionId &&
              activeSessionId &&
              stateBeforeStreamEvent.processingSessionIds.includes(activeSessionId))
          );
          // Accept stream events when either:
          // 1) global processing is true, OR
          // 2) backend confirms the session is processing, OR
          // 3) we already have a stream snapshot in flight, OR
          // 4) this is an explicit stream start signal (can race ahead of state flags).
          const isExplicitStreamStart =
            streamEventType === "start" || streamEventType === "streamStart";
          // Permission prompts intentionally arrive while the agent is paused,
          // so they may be the first event observed after the processing flag
          // has been cleared. They still require immediate UI mounting.
          const isPermissionRequest =
            streamEventType === "permission.asked" ||
            streamEventType === "permission.request";
          const isSessionErrorEvent =
            getCentralizedEventType(payload) === "session.error" ||
            getCentralizedEventType(payload) === "error";
          const liveRoute = routeLiveEventToUi(
            payload,
            eventSessionId || activeSessionId || null,
            "streamEvent",
          );
          if (liveRoute.sessionStatus?.statusType === "idle") {
            recordSessionIdleStatus(resolvedStreamSessionId);
            appendLiveEventsToDebugPanel([
              { event: payload, sessionId: resolvedStreamSessionId },
            ]);
            break;
          }
          if (!isSessionStatusEvent) {
            appendLiveEventsToDebugPanel([
              { event: payload, sessionId: eventSessionId || activeSessionId || null },
            ]);
          }
          const liveToastNotification = liveRoute.toast ?? null;
          const liveSessionStatus = liveRoute.sessionStatus ?? null;
          const shouldLogStreamEvent = !streamEventType.includes("message.part") ||
                                      streamEventType === "message.completed" ||
                                      streamEventType === "session.completed";

          logger.info("[LIVE-EVENT] streamEvent received", {
            streamEventType,
            eventSessionId: eventSessionId || null,
            activeSessionId: activeSessionId || null,
            hasToast: !!liveToastNotification,
            hasStatus: !!liveSessionStatus,
            statusType: liveSessionStatus?.statusType ?? null,
            toastType: liveToastNotification?.type ?? null,
          });

          if (
            !stateBeforeStreamEvent.isProcessing &&
            !hasConfirmedProcessingSession &&
            !stateBeforeStreamEvent.streaming &&
            !isExplicitStreamStart &&
            !isPermissionRequest &&
            !isSessionErrorEvent &&
            !canStartVisibleAssistantTurn
          ) {
            if (config.debug.showSdkEventDebug) {
              logger.warn("[LIVE-STREAM-DIAG] event rejected before streaming state", {
                streamEventType,
                sessionId: eventSessionId || activeSessionId || null,
                eventId: asString(payload.id) || null,
                isProcessing: stateBeforeStreamEvent.isProcessing,
                hasConfirmedProcessingSession,
                hasStreaming: !!stateBeforeStreamEvent.streaming,
                isExplicitStreamStart,
                isPermissionRequest,
                canStartVisibleAssistantTurn,
              });
            }
            logger.info("[LIVE-EVENT] breaking early — no active streaming/processing state", {
              streamEventType,
              isProcessing: stateBeforeStreamEvent.isProcessing,
              hasConfirmedProcessingSession,
              hasStreaming: !!stateBeforeStreamEvent.streaming,
              isExplicitStreamStart,
              canStartVisibleAssistantTurn,
              hasToast: !!liveToastNotification,
              hasStatus: !!liveSessionStatus,
            });
            break;
          }
          if (terminalErrorReached && (getState().isProcessing || hasConfirmedProcessingSession)) {
            terminalErrorReached = false;
          }
          const streamingBefore = stateBeforeStreamEvent.streaming;
          if (streamingBefore) {
            latestStreamingSnapshot = streamingBefore;
          }

          // Reset per-turn activity bookkeeping on an explicit stream start.
          // Do not clear `stoppedSessionIds` here: OpenCode can emit a late
          // continuation start after an abort request. Only a new user message
          // is allowed to open that session for rendering again.
          if (streamEventType === "start" || streamEventType === "streamStart") {
            terminalErrorReached = false;
            activeSubagentParentMessageIds = new Set<string>();
          }

          if (
            eventSessionId &&
            activeSessionId &&
            eventSessionId !== activeSessionId
          ) {
            let scopedState: AppState = {
              ...stateBeforeStreamEvent,
              currentSessionId: eventSessionId,
              isProcessing: true,
              streaming:
                stateBeforeStreamEvent.streamingBySessionId?.[eventSessionId] ??
                null,
            };
            const scopedGetState = () => scopedState;
            const scopedDispatch: Dispatch<AppAction> = (action) => {
              switch (action.type) {
                case "ADD_ERROR_MESSAGE":
                  // See the batch path below: scoped streaming state must not
                  // swallow a user-facing session error just because the event
                  // arrived for a session other than the selected transcript.
                  dispatch(action);
                  if (config.debug.showSdkEventDebug) {
                    logger.warn("[LIVE-STREAM-TRACE][ERROR] toast-forwarded-from-scoped-event", {
                      eventId: asString(payload.id) || null,
                      eventSessionId: eventSessionId || null,
                      activeSessionId: activeSessionId || null,
                      message: action.payload,
                    });
                  }
                  break;
                case "SET_STREAMING":
                case "APPEND_SDK_EVENT_PAYLOAD":
                case "UPDATE_STREAMING_CONTENT":
                case "SUPPRESS_STREAMING_TEXT_PART":
                case "UPDATE_STREAMING_REASONING":
                case "SET_IN_REASONING_PART":
                case "SET_ASSISTANT_TURN_PENDING":
                case "ADD_STREAMING_STEP":
                case "UPDATE_STREAMING_STEP":
                case "ADD_STREAMING_EDIT":
                case "UPDATE_LIVE_SESSION_STATUS":
                case "FINISH_STREAMING":
                case "SET_PROCESSING":
                  scopedState = appReducer(scopedState, action);
                  break;
                default:
                  break;
              }
            };
            const processScopedStreamEvent = () => {
              handleStreamEvent(
                scopedDispatch,
                scopedGetState,
                payload,
                terminalErrorReached,
                shouldSuppressProcessingBootstrap,
                markAssistantTurnClosed,
                knownReasoningPartIDs,
              );
              dispatch({
                type: "SET_SESSION_STREAMING",
                payload: {
                  sessionId: eventSessionId,
                  streaming: scopedState.streaming,
                },
              });
            };
            // Inactive sessions retain their own live stream cache. Deferring
            // these updates means activity disappears when the user switches
            // to that session mid-turn, so use the same direct path as the
            // currently selected session.
            processScopedStreamEvent();
            break;
          }
          // Live response state is user-visible, time-sensitive UI. Marking
          // every token update as a transition lets a continuous stream keep
          // interrupting the previous transition, so React may not commit the
          // assistant card until the terminal history refresh. The provider
          // already bounds delivery to small batches; process the active
          // session synchronously so each batch can paint.
          handleStreamEvent(
            dispatch,
            getState,
            payload,
            terminalErrorReached,
            shouldSuppressProcessingBootstrap,
            markAssistantTurnClosed,
            knownReasoningPartIDs,
            pendingRenderableTextPart,
          );
          const streamingAfter = getState().streaming;
          const handledPart = getCentralizedEventPart(payload);
          const handledDelta =
            asString(handledPart?.delta) ||
            asString(asRecord(payload.properties)?.delta);
          const handledEventType = getCentralizedEventType(payload);
          const activityReduced = Boolean(
            streamingBefore &&
            streamingAfter &&
            ((streamingAfter.steps?.length ?? 0) < (streamingBefore.steps?.length ?? 0) ||
              (streamingAfter.progressEvents?.length ?? 0) < (streamingBefore.progressEvents?.length ?? 0) ||
              (streamingAfter.edits?.length ?? 0) < (streamingBefore.edits?.length ?? 0)),
          );
          const contentReduced = Boolean(
            streamingBefore &&
            streamingAfter &&
            (streamingAfter.content?.length ?? 0) < (streamingBefore.content?.length ?? 0),
          );
          const streamIdentityChanged = Boolean(
            streamingBefore?.messageId &&
            streamingAfter?.messageId &&
            streamingBefore.messageId !== streamingAfter.messageId,
          );
          if (
            handledEventType !== "server.heartbeat" &&
            (activityReduced || contentReduced || streamIdentityChanged ||
              (streamingBefore && !streamingAfter))
          ) {
            logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] state-transition", {
              outcome: activityReduced || contentReduced
                ? "STATE_REDUCED"
                : streamIdentityChanged
                  ? "STREAM_IDENTITY_CHANGED"
                  : "STREAMING_STATE_CLEARED",
              sessionId: eventSessionId || activeSessionId || null,
              eventId: asString(payload.id) || null,
              eventType: handledEventType,
              partType: asString(handledPart?.type) || null,
              eventMessageId: extractEventMessageId(payload),
              before: streamingBefore ? {
                messageId: streamingBefore.messageId || null,
                active: streamingBefore.isActive,
                contentLength: streamingBefore.content?.length ?? 0,
                stepCount: streamingBefore.steps?.length ?? 0,
                progressCount: streamingBefore.progressEvents?.length ?? 0,
                editCount: streamingBefore.edits?.length ?? 0,
              } : null,
              after: streamingAfter ? {
                messageId: streamingAfter.messageId || null,
                active: streamingAfter.isActive,
                contentLength: streamingAfter.content?.length ?? 0,
                stepCount: streamingAfter.steps?.length ?? 0,
                progressCount: streamingAfter.progressEvents?.length ?? 0,
                editCount: streamingAfter.edits?.length ?? 0,
              } : null,
              assistantTurnMessageId: getState().assistantTurnMessageId || null,
            });
          }
          if (
            handledEventType !== "server.heartbeat" &&
            !(handledEventType.startsWith("message.part.") && handledDelta.length > 0)
          ) {
            logger.info("[LIVE-STREAM-TRACE][WEBVIEW] stream-state-after-event", {
              sessionId: eventSessionId || activeSessionId || null,
              eventId: asString(payload.id) || null,
              eventType: handledEventType,
              partType: asString(handledPart?.type) || null,
              streamingExists: !!streamingAfter,
              streamingMessageId: streamingAfter?.messageId ?? null,
              contentLength: streamingAfter?.content?.length ?? 0,
              reasoningLength: streamingAfter?.reasoning?.length ?? 0,
              stepCount: streamingAfter?.steps?.length ?? 0,
              progressCount: streamingAfter?.progressEvents?.length ?? 0,
              editCount: streamingAfter?.edits?.length ?? 0,
            });
          }
          if (streamingAfter) {
            latestStreamingSnapshot = streamingAfter;
            const eventPart = getCentralizedEventPart(payload);
            const eventDelta =
              asString(eventPart?.delta) ||
              asString(asRecord(payload.properties)?.delta);
            const isHighFrequencyStreamDelta =
              getCentralizedEventType(payload).startsWith("message.part.") &&
              eventDelta.length > 0;
            if (!isHighFrequencyStreamDelta && streamEventType !== "server.heartbeat") {
              logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] streaming-state-stored", {
                sessionId: eventSessionId || activeSessionId || null,
                eventId: asString(payload.id) || null,
                eventType: getCentralizedEventType(payload),
                semanticMessageId: extractEventMessageId(payload),
                partType: asString(eventPart?.type) || null,
                streamingMessageId: streamingAfter.messageId || null,
                assistantTurnMessageId: getState().assistantTurnMessageId || null,
                isActive: streamingAfter.isActive,
                hasRenderableContent: streamingAfter.hasRenderableContent ?? false,
                contentLength: streamingAfter.content?.length ?? 0,
                reasoningLength: streamingAfter.reasoning?.length ?? 0,
                reasoningEventCount: streamingAfter.reasoningEvents?.length ?? 0,
                stepCount: streamingAfter.steps?.length ?? 0,
                progressCount: streamingAfter.progressEvents?.length ?? 0,
                editCount: streamingAfter.edits?.length ?? 0,
              });
            }
            const hasVisibleStreamingActivity = Boolean(
              streamingAfter.hasRenderableContent ||
              streamingAfter.content ||
              streamingAfter.reasoning ||
              streamingAfter.reasoningEvents?.length ||
              streamingAfter.steps?.length ||
              streamingAfter.progressEvents?.length ||
              streamingAfter.edits?.length ||
              streamingAfter.interactiveEvents?.length,
            );
            if (config.debug.showSdkEventDebug && canStartVisibleAssistantTurn && !hasVisibleStreamingActivity) {
              const eventPart = getCentralizedEventPart(payload);
              logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] event-not-stored", {
                outcome: "FAILURE_NOT_STORED",
                streamEventType,
                sessionId: eventSessionId || activeSessionId || null,
                eventId: asString(payload.id) || null,
                eventPartType: asString(eventPart?.type) || null,
                eventPartId: asString(eventPart?.id) || null,
                eventMessageId:
                  asString(eventPart?.messageID) ||
                  asString(eventPart?.messageId) ||
                  null,
                streamingMessageId: streamingAfter.messageId || null,
                assistantTurnMessageId: getState().assistantTurnMessageId || null,
              });
            }
          } else if (config.debug.showSdkEventDebug && canStartVisibleAssistantTurn) {
            logger.warn("[LIVE-STREAM-TRACE][WEBVIEW] event-no-streaming-state", {
              outcome: "FAILURE_NO_STREAMING_STATE",
              streamEventType,
              sessionId: eventSessionId || activeSessionId || null,
              eventId: asString(payload.id) || null,
              assistantTurnMessageId: getState().assistantTurnMessageId || null,
              isProcessing: getState().isProcessing,
              processingSessionIds: getState().processingSessionIds,
            });
          }


          if (
            streamEventType === "message.updated" ||
            streamEventType === "message.completed" ||
            streamEventType === "session.completed"
          ) {
            const stateNow = getState();

            // Extract properties and check for finish signal to turn off loading state
            const properties = asRecord(payload.properties);
            const finish = resolveMessageUpdatedFinishSignal(payload, properties);

            if (
              finish &&
              terminalEventMatchesAssistantTurn(payload, [
                stateNow.streaming?.messageId,
                stateNow.assistantTurnMessageId,
              ])
            ) {
              // Turn off loading state but don't end the AI turn
              dispatch({ type: "SET_PROCESSING", payload: false });

              logger.info("Stream event: Processing finish signal detected, turning off loading state", {
                streamEventType,
                finish,
                sessionId: eventSessionId || activeSessionId || null,
              });
            }
          }
          break;
        }
        case "streamEventBatch": {
          const events = Array.isArray(data.events) ? data.events : [];
          const debugEvents: Array<{ event: unknown; sessionId: string | null }> = [];
          const batchStartedAt = performance.now();
          // Perf rationale: React's useReducer dispatch commits state
          // asynchronously — stateRef.current only updates on the next render
          // commit, so a post-dispatch getState() snapshot can return
          // pre-batch state. Reading getState() here produces false-zero
          // streamingContentLength / streamingReasoningLength readings in the
          // perf metric. trackedDispatch mirrors the reducer's append/replace
          // logic on the dispatched payloads so the metric reflects post-batch
          // state regardless of commit timing. Removing this accumulator (or
          // emitting the metric outside processBatchEvents) will reintroduce
          // the false-zero streaming-perf reports documented in
          // tests/webview/stream-performance-debug.test.mjs.
          const stateAtBatchStart = getState();
          // React does not commit useReducer state between dispatches made in
          // the same message callback. Keep a local reducer mirror so event N
          // observes the stream created/updated by event N-1. Without this,
          // every delta in an initial multi-event batch can re-bootstrap an
          // empty StreamingState and erase the preceding chunk.
          let stateWithinBatch = stateAtBatchStart;
          const getStateWithinBatch = () => stateWithinBatch;
          let trackedStreamingContentLength =
            stateAtBatchStart.streaming?.content?.length ?? 0;
          let trackedStreamingReasoningLength =
            stateAtBatchStart.streaming?.reasoning?.length ?? 0;
          const trackedDispatch: Dispatch<AppAction> = (action) => {
            if (action && action.type === "UPDATE_STREAMING_CONTENT" && action.payload) {
              const incomingLen =
                typeof action.payload.content === "string"
                  ? action.payload.content.length
                  : 0;
              trackedStreamingContentLength = action.payload.append
                ? trackedStreamingContentLength + incomingLen
                : incomingLen;
            } else if (
              action &&
              action.type === "UPDATE_STREAMING_REASONING" &&
              action.payload
            ) {
              const incomingLen =
                typeof action.payload.reasoning === "string"
                  ? action.payload.reasoning.length
                  : 0;
              // Reasoning reducer performs dedupe/merge that can shrink the
              // resulting string below a naive concat; this upper-bound length
              // is sufficient for diagnostic signal.
              trackedStreamingReasoningLength = action.payload.append
                ? trackedStreamingReasoningLength + incomingLen
                : incomingLen;
            }
            stateWithinBatch = appReducer(stateWithinBatch, action);
            dispatch(action);
          };
          const processBatchEvents = () => {
            for (const [eventIndex, item] of events.entries()) {
              const itemRecord = asRecord(item);
              const evtPayload = asRecord(itemRecord?.event) ?? itemRecord ?? {};
              const evtType = getCentralizedEventType(evtPayload) || "unknown";
              const isTerminalSessionError =
                evtType === "session.error" || evtType === "error";
              const envelopeSessionId =
                asString(itemRecord?.sessionId) ||
                asString(itemRecord?.sessionID);
              const eventSessionId =
                extractCentralizedEventSessionId(evtPayload) || envelopeSessionId;
              const stateBeforeBatchEvent = getState();
              const activeSessionId = stateBeforeBatchEvent.currentSessionId;
              const resolvedBatchSessionId = eventSessionId || activeSessionId || null;
              const isSessionStatusEvent = evtType === "session.status";
              // Keep status frames in the temporary debug buffer even though
              // the centralized transcript filter excludes them as live-only.
              if (isSessionStatusEvent) {
                appendLiveEventsToDebugPanel([
                  { event: evtPayload, sessionId: resolvedBatchSessionId },
                ]);
              } else {
                debugEvents.push({
                  event: evtPayload,
                  sessionId: resolvedBatchSessionId,
                });
              }
              // Keep session.status visible after a stopped/terminal turn.
              // Retry metadata can arrive after the stop acknowledgement and
              // contains the only user-facing explanation and retry time.
              if (
                isStoppedSession(eventSessionId, activeSessionId) &&
                evtType !== "session.status" &&
                !isTerminalSessionError
              ) {
                logger.info("[LIVE-EVENT] ignoring late batch event for stopped session", {
                  streamEventType: evtType,
                  sessionId: eventSessionId || activeSessionId || null,
                });
                continue;
              }
              if (isTerminalSessionError && config.debug.showSdkEventDebug) {
                logger.warn("[LIVE-STREAM-TRACE][ERROR] batch-admitted", {
                  eventId: asString(evtPayload.id) || null,
                  eventType: evtType,
                  eventSessionId: eventSessionId || null,
                  activeSessionId: activeSessionId || null,
                  isStopped: isStoppedSession(eventSessionId, activeSessionId),
                  source: "streamEventBatch",
                });
              }
              const liveRoute = routeLiveEventToUi(
                evtPayload,
                eventSessionId || activeSessionId || null,
                "streamEventBatch",
                eventIndex,
              );
              if (liveRoute.sessionStatus?.statusType === "idle") {
                recordSessionIdleStatus(resolvedBatchSessionId);
                continue;
              }
              if (
                eventSessionId &&
                activeSessionId &&
                eventSessionId !== activeSessionId
              ) {
                let scopedState: AppState = {
                  ...stateBeforeBatchEvent,
                  currentSessionId: eventSessionId,
                  isProcessing: true,
                  streaming:
                    stateBeforeBatchEvent.streamingBySessionId?.[eventSessionId] ??
                    null,
                };
                const scopedGetState = () => scopedState;
                const scopedDispatch: Dispatch<AppAction> = (action) => {
                  switch (action.type) {
                    case "ADD_ERROR_MESSAGE":
                      // A session.error is user-visible even if its stream is
                      // cached for another session. The scoped reducer only
                      // owns that session's streaming snapshot, so forward the
                      // toast to the real store instead of silently dropping it.
                      dispatch(action);
                      if (config.debug.showSdkEventDebug) {
                        logger.warn("[LIVE-STREAM-TRACE][ERROR] toast-forwarded-from-scoped-batch", {
                          eventId: asString(evtPayload.id) || null,
                          eventSessionId: eventSessionId || null,
                          activeSessionId: activeSessionId || null,
                          message: action.payload,
                        });
                      }
                      break;
                    case "SET_STREAMING":
                    case "APPEND_SDK_EVENT_PAYLOAD":
                    case "UPDATE_STREAMING_CONTENT":
                    case "SUPPRESS_STREAMING_TEXT_PART":
                    case "UPDATE_STREAMING_REASONING":
                    case "SET_IN_REASONING_PART":
                    case "SET_ASSISTANT_TURN_PENDING":
                    case "ADD_STREAMING_STEP":
                    case "UPDATE_STREAMING_STEP":
                    case "ADD_STREAMING_EDIT":
                    case "UPDATE_LIVE_SESSION_STATUS":
                    case "FINISH_STREAMING":
                    case "SET_PROCESSING":
                      scopedState = appReducer(scopedState, action);
                      break;
                    default:
                      break;
                  }
                };
                const scopedEventMessageId = extractEventMessageId(evtPayload);
                const scopedTurnIsClosed = !!(
                  (scopedEventMessageId &&
                    closedAssistantTurnMessageIds.has(scopedEventMessageId)) ||
                  (scopedState.streaming?.messageId &&
                    closedAssistantTurnMessageIds.has(scopedState.streaming.messageId))
                );
                handleStreamEvent(
                  scopedDispatch,
                  scopedGetState,
                  evtPayload,
                  terminalErrorReached,
                  scopedTurnIsClosed,
                  markAssistantTurnClosed,
                  knownReasoningPartIDs,
                );
                dispatch({
                  type: "SET_SESSION_STREAMING",
                  payload: {
                    sessionId: eventSessionId,
                    streaming: scopedState.streaming,
                  },
                });
              } else {
                const batchEventMessageId = extractEventMessageId(evtPayload);
                const activeStreamingMessageId =
                  getStateWithinBatch().streaming?.messageId;
                const batchTurnIsClosed = !!(
                  (batchEventMessageId &&
                    closedAssistantTurnMessageIds.has(batchEventMessageId)) ||
                  (activeStreamingMessageId &&
                    closedAssistantTurnMessageIds.has(activeStreamingMessageId))
                );
                handleStreamEvent(
                  trackedDispatch,
                  getStateWithinBatch,
                  evtPayload,
                  terminalErrorReached,
                  batchTurnIsClosed,
                  markAssistantTurnClosed,
                  knownReasoningPartIDs,
                );
              }

              if (
                evtType === "message.updated" ||
                evtType === "message.completed" ||
                evtType === "session.completed"
              ) {
                const finish = resolveMessageUpdatedFinishSignal(
                  evtPayload,
                  asRecord(evtPayload.properties),
                );
                if (
                  finish &&
                  terminalEventMatchesAssistantTurn(evtPayload, [
                    getStateWithinBatch().streaming?.messageId,
                    getStateWithinBatch().assistantTurnMessageId,
                  ])
                ) {
                  dispatch({ type: "SET_PROCESSING", payload: false });
                }
              }
            }
            appendLiveEventsToDebugPanel(debugEvents);
            // Emit inside processBatchEvents so the tracked accumulators
            // have observed every dispatched payload before the read.
            logger.streamPerformance("stream-event-batch", {
              eventCount: events.length,
              durationMs: Number((performance.now() - batchStartedAt).toFixed(2)),
              streamingContentLength: trackedStreamingContentLength,
              streamingReasoningLength: trackedStreamingReasoningLength,
            });
          };
          // Do not put the active assistant stream in a React transition.
          // Continuous low-priority batches can be starved until completion,
          // leaving the response surface empty despite accepted SDK events.
          processBatchEvents();
          const streamingAfter = stateWithinBatch.streaming;
          if (streamingAfter) {
            latestStreamingSnapshot = streamingAfter;
          }
          break;
        }
        case "streamEventEnrich": {
          const stateBeforeEnrich = getState();
          if (
            !stateBeforeEnrich.isProcessing &&
            !stateBeforeEnrich.streaming
          ) {
            break;
          }
          const callID = asString(data.callID);
          const diffStatsRec = asRecord(data.diffStats);
          const activityDetail = normalizeActivityDetail(data.activityDetail);
          const diffStats =
            diffStatsRec
              ? {
                added: asNumber(diffStatsRec.added) || 0,
                deleted: asNumber(diffStatsRec.deleted) || 0,
              }
              : undefined;
          if (!callID || (!diffStats && !activityDetail)) {
            break;
          }
          dispatch({
            type: "UPDATE_STREAMING_STEP",
            payload: {
              callID,
              patch: {
                ...(diffStats ? { diffStats } : {}),
                ...(activityDetail ? { activityDetail } : {}),
              },
            },
          });
          break;
        }
        case "errorToast": {
          const toastMessage = asString(data.message);
          if (toastMessage) {
            dispatch({ type: "ADD_ERROR_MESSAGE", payload: toastMessage });
          }
          break;
        }
        case "error": {
          const errorMsg = asString(data.message, "Unknown error");

          // Log all error messages to understand what's being received
          logger.info("ERROR_FLOW: Backend error message received", {
            errorMsg,
            messageLength: errorMsg.length,
            dataKeys: Object.keys(data),
            sessionId: data.sessionId,
            timestamp: new Date().toISOString(),
          });

          // Filter out spurious error messages that aren't real user-facing errors
          // Check for generic error patterns that should be ignored
          const genericErrorPatterns = [
            "An error occurred while processing your request",
            "Unknown error",
            "error processing your request",
            "something went wrong",
            "there was an error",
            "an error has occurred",
            "unable to process",
            "failed to process",
          ];

          const isGenericError = genericErrorPatterns.some((pattern) =>
            errorMsg.toLowerCase().includes(pattern.toLowerCase())
          );

          const hasSpecificErrorDetails = errorMsg &&
            (errorMsg.includes("quota") ||
             errorMsg.includes("limit") ||
             errorMsg.includes("rate") ||
             errorMsg.includes("429") ||
             errorMsg.toLowerCase().includes("network") ||
             errorMsg.toLowerCase().includes("connection") ||
             errorMsg.toLowerCase().includes("timeout") && !errorMsg.includes("processing"));

          // Only show errors that are NOT generic AND have specific error details
          if (!errorMsg || isGenericError || !hasSpecificErrorDetails) {
            logger.info("ERROR_FLOW: Skipping generic backend error", {
              errorMsg,
              isGenericError,
              hasSpecificErrorDetails,
              reason: isGenericError ? "Generic error pattern" : !hasSpecificErrorDetails ? "No specific error details" : "Empty message",
            });
            // Still clear processing state, but don't show error to user
            dispatch({ type: "SET_PROCESSING", payload: false });
            dispatch({ type: "FINISH_STREAMING" });
            dispatch({ type: "SET_STREAMING", payload: null });
            break;
          }

          logger.info("ERROR_FLOW: Showing specific backend error to user", {
            errorMsg,
          });

          const stateBeforeError = getState();
          const currentStreaming = stateBeforeError.streaming;
          const errorSessionId = firstNonEmptyString(
            asString(data.sessionId),
            asString(data.sessionID),
            stateBeforeError.currentSessionId ?? undefined,
          );

          // User explicitly stopped this session. Ignore trailing transport errors
          // so a rendered assistant turn is not replaced by an error-only card.
          if (errorSessionId && stoppedSessionIds.has(errorSessionId)) {
            dispatch({ type: "SET_PROCESSING", payload: false });
            dispatch({ type: "FINISH_STREAMING" });
            dispatch({ type: "SET_STREAMING", payload: null });
            break;
          }

          // When the AI is actively streaming meaningful content and a transport
          // timeout fires (e.g. undici headers timeout), the response is still
          // arriving — suppress the error banner so the live response isn't
          // interrupted by a stale transport timeout notification.
          const isTimeoutError = isLikelyInteractiveAwaitTimeout(errorMsg);
          const streamHasContent = currentStreaming &&
            currentStreaming.content &&
            currentStreaming.content.trim().length > 0 &&
            !containsThoughtTagReasoning(currentStreaming.content);
          if (isTimeoutError && streamHasContent) {
            latestStreamingSnapshot = currentStreaming ?? latestStreamingSnapshot;
            break;
          }

          latestStreamingSnapshot = null;
          terminalErrorReached = true;

          // If we were in the middle of a stream, preserve it as a message so the user
          // can see partial output + the error banner + retry.
          // The error is shown via partialMessage.error inside AssistantMessage,
          // which renders the ErrorBanner at the bottom of the message.
          if (currentStreaming) {
            // If the streamed content is an AI internal monologue (tool-use narration like
            // "Let me search for...", "Let me read the file..."), it has no user-facing value.
            // Suppress it so only the error banner is shown rather than garbled reasoning text.
            const rawContent = currentStreaming.content ?? "";
            const timeoutLikeError = isLikelyInteractiveAwaitTimeout(errorMsg);
            const contentIsReasoningMonologue =
              containsThoughtTagReasoning(rawContent);
            const suppressLowSignalTimeoutFragment =
              timeoutLikeError && isLowSignalTimeoutFragment(rawContent);
            const partialMessage: Message = {
              id: currentStreaming.messageId || `error-${Date.now()}`,
              role: "assistant",
              agent: currentStreaming.agent,
              modelID: currentStreaming.modelID,
              providerID: currentStreaming.providerID,
              content:
                contentIsReasoningMonologue || suppressLowSignalTimeoutFragment
                  ? ""
                  : rawContent,
              reasoningEvents: currentStreaming.reasoningEvents,
              steps: currentStreaming.steps as any,
              created: Date.now(),
              error: errorMsg,
            };
            const messages = getState().messages;
            const partialMessageId =
              asString(asRecord(partialMessage.info)?.id) ||
              asString((partialMessage as unknown as UnknownRecord).id) ||
              currentStreaming.messageId ||
              null;
            dispatch({
              type: "SET_MESSAGES",
              payload: replaceMatchingAssistantTurn(messages, partialMessage, [
                partialMessageId,
                currentStreaming.messageId,
              ]),
            });
          } else {
            const messages = stateBeforeError.messages || [];
            const hasRenderedAssistantTurn = messages.some((message) => {
              if (!isAssistantHistoryMessage(message)) {
                return false;
              }
              return hasRenderableHistoryPayload(message);
            });
            if (hasRenderedAssistantTurn) {
              dispatch({ type: "SET_PROCESSING", payload: false });
              dispatch({ type: "FINISH_STREAMING" });
              dispatch({ type: "SET_STREAMING", payload: null });
              break;
            }
            // No active stream — create an error-only message so the error banner
            // appears at the bottom of the message instead of at the top of the chat.
            const errorMessage: Message = {
              id: `error-${Date.now()}`,
              role: "assistant",
              content: "",
              error: errorMsg,
              created: Date.now(),
            };
            dispatch({
              type: "SET_MESSAGES",
              payload: [...messages, errorMessage],
            });
          }

          dispatch({ type: "SET_PROCESSING", payload: false });
          dispatch({ type: "FINISH_STREAMING" });
          dispatch({ type: "SET_STREAMING", payload: null });
          break;
        }
        case "appendPrompt": {
          const current = getState().inputValue;
          const extra = asString(data.text);
          const next = current ? `${current}\n${extra}` : extra;
          dispatch({ type: "SET_INPUT_VALUE", payload: next });
          break;
        }
        case "addContext": {
          const item = asRecord(data.context);
          if (!item) {
            break;
          }
          const context: ContextItem = {
            file: asString(item.file) || "",
            lineInfo: asString(item.lineInfo) || "",
            isAuto: asBoolean(item.isAuto, false),
            content: asString(item.content),
            languageId: asString(item.languageId),
          };
          if (!context.file) {
            break;
          }
          const selected = getState().selectedContexts || [];

          let nextSelected = [...selected];

          // If it's an auto context, remove any existing auto context
          if (context.isAuto) {
            nextSelected = nextSelected.filter((c) => !c.isAuto);
          }

          // Avoid exact duplicates
          const exists = nextSelected.some(
            (c) => c.file === context.file && c.lineInfo === context.lineInfo,
          );

          if (!exists) {
            nextSelected.push(context);
          }

          dispatch({ type: "SET_SELECTED_CONTEXTS", payload: nextSelected });
          break;
        }
        case "clearAutoContext": {
          const selected = getState().selectedContexts || [];
          const nextSelected = selected.filter((c) => !c.isAuto);
          if (nextSelected.length !== selected.length) {
            dispatch({ type: "SET_SELECTED_CONTEXTS", payload: nextSelected });
          }
          break;
        }
        case "fileSearchResults": {
          const results = asArray(data.results, isFileResult);
          dispatch({ type: "SET_FILE_SUGGESTIONS", payload: results });
          dispatch({
            type: "SET_SHOW_FILE_SUGGESTIONS",
            payload: results.length > 0,
          });
          dispatch({ type: "SET_SUGGESTION_INDEX", payload: 0 });
          break;
        }
        case "mentionResults": {
          const results = asArray(data.results, isMentionResult);
          dispatch({ type: "SET_MENTION_SUGGESTIONS", payload: results });
          dispatch({ type: "SET_SHOW_MENTION_SUGGESTIONS", payload: results.length > 0 });
          dispatch({ type: "SET_MENTION_INDEX", payload: 0 });
          break;
        }
        case "commandsList": {
          const commands = asArray(data.commands, isSlashCommand);
          logger.debug('Commands loaded', { commandCount: commands.length });

          dispatch({ type: "SET_COMMANDS_LIST", payload: commands });
          break;
        }
        case "mySkills": {
          const skills = asArray(data.skills, isSkill);
          logger.debug('Skills loaded', { skillCount: skills.length });
          dispatch({ type: "SET_SKILLS_LIST", payload: skills });
          break;
        }
        case "sessionsList": {
          const currentSessionId = asString(data.currentSessionId) || null;
          dispatch({
            type: "SET_SESSIONS_LIST",
            payload: asArray(data.sessions, isSession),
          });
          if (currentSessionId) {
            dispatch({
              type: "SET_SESSION_ID",
              payload: currentSessionId,
            });
          }
          break;
        }
        case "revertStateUpdate": {
          const revertRaw = asRecord(data.revertState);
          if (!revertRaw) {
            dispatch({ type: "SET_REVERT_STATE", payload: null });
            break;
          }
          const messageID = asString(revertRaw.messageID);
          if (!messageID) {
            dispatch({ type: "SET_REVERT_STATE", payload: null });
            break;
          }
          dispatch({
            type: "SET_REVERT_STATE",
            payload: {
              messageID,
              partID: asString(revertRaw.partID) || undefined,
              snapshot: asString(revertRaw.snapshot) || undefined,
              diff: asString(revertRaw.diff) || undefined,
            },
          });
          break;
        }
        case "sessionTitleUpdated": {
          const sessionId = asString(data.sessionId);
          const title = asString(data.title);
          if (sessionId && title) {
            dispatch({ type: "UPDATE_SESSION_TITLE", payload: { sessionId, title } });
          }
          break;
        }
        case "permissionResolved": {
          const permissionID = asString(data.permissionID) || asString(data.permissionId);
          if (permissionID) {
            dispatch({
              type: "SET_INTERACTIVE_EVENTS",
              payload: getState().interactiveEvents.filter(
                (event) => event.type !== "quick_actions" || event.permissionID !== permissionID,
              ),
            });
          }
          break;
        }
        case "permissionReplyFailed": {
          const error = asString(data.error) || "Unable to submit permission response";
          dispatch({ type: "ADD_ERROR_MESSAGE", payload: error });
          break;
        }
        case "pendingInteractions": {
          const interactionSessionId = asString(data.sessionId);
          if (!interactionSessionId || interactionSessionId !== getState().currentSessionId) {
            break;
          }
          const permissions = asArray<UnknownRecord>(
            data.permissions,
            (item): item is UnknownRecord => !!asRecord(item),
          );
          const pendingPermissionIDs = new Set(
            permissions
              .map((permission) => permissionRequestFromSdkPayload(permission, interactionSessionId)?.id)
              .filter((id): id is string => !!id),
          );
          dispatch({
            type: "SET_INTERACTIVE_EVENTS",
            payload: getState().interactiveEvents.filter(
              (event) =>
                event.type !== "quick_actions" ||
                !event.permissionID ||
                pendingPermissionIDs.has(event.permissionID),
            ),
          });
          for (const permission of permissions) {
            upsertPermissionRequest(permission, interactionSessionId);
          }
          break;
        }
        case "userMessageAppended": {
          terminalErrorReached = false;
          const message = data.message as Message;
          const messageSessionId =
            firstNonEmptyString(
              asString(data.sessionId),
              asString(data.sessionID),
            ) ?? null;
          const appendedClientRequestId = asOptionalString(data.clientRequestId);
          const resumedSessionId = firstNonEmptyString(
            messageSessionId ?? undefined,
            getState().currentSessionId ?? undefined,
          );
          if (resumedSessionId) {
            stoppedSessionIds.delete(resumedSessionId);
          }
          if (messageSessionId) {
            dispatch({ type: "SET_SESSION_ID", payload: messageSessionId });
          }
          if (message && typeof message === "object") {
            const appendedRole = firstNonEmptyString(
              message.role,
              message.info?.role,
            )?.toLowerCase();
            if (appendedRole === "user" && appendedClientRequestId) {
              const candidateSessionIds = Array.from(
                new Set(
                  [
                    messageSessionId,
                    getState().currentSessionId ?? null,
                    PENDING_CURRENT_SESSION_KEY,
                  ].filter(
                    (value): value is string =>
                      typeof value === "string" && value.trim().length > 0,
                  ),
                ),
              );
              const messageCreatedAt =
                typeof message.time?.created === "number"
                  ? message.time.created
                  : typeof message.info?.time?.created === "number"
                    ? message.info.time.created
                    : typeof message.created === "number"
                      ? message.created
                      : typeof (message as { createdAt?: number }).createdAt === "number"
                        ? (message as { createdAt?: number }).createdAt
                        : undefined;
              for (const sessionId of candidateSessionIds) {
                // Confirm the optimistic overlay against the host echo, but do
                // not remove it yet. The centralized transcript still needs a
                // beat to catch up, and deleting the optimistic bubble here
                // causes the visible gap where the user message disappears just
                // as the assistant begins streaming.
                //
                // Why confirmation still matters before centralized ownership:
                // - it upgrades the optimistic bubble with the host-confirmed
                //   timestamp / images / interactive flag
                // - it stores the host-side message identity as a first-class
                //   ownership hint for later reconciliation
                // - it lets the pending overlay survive the handoff without
                //   having to rely purely on fuzzy text matching
                dispatch({
                  type: "CONFIRM_PENDING_USER_MESSAGE",
                  payload: {
                    sessionId,
                    clientRequestId: appendedClientRequestId,
                    messageId: firstNonEmptyString(
                      message.info?.id,
                      message.id,
                      message.messageId,
                    ),
                    createdAt: messageCreatedAt,
                    text: firstNonEmptyString(
                      message.content,
                      message.text,
                      message.info?.content,
                      message.info?.text,
                    ),
                    images: Array.isArray(message.images)
                      ? message.images.filter(
                        (image): image is string => typeof image === "string",
                      )
                      : undefined,
                    interactiveSubmit:
                      typeof message.interactiveSubmit === "boolean"
                        ? message.interactiveSubmit
                        : undefined,
                  },
                });
              }
            }
            const pendingInteractive = latestPendingInteractiveEvents(
              getState().messages || [],
            );
            const isInteractiveAnswerSubmission =
              isLikelyInteractiveAnswerSubmissionMessage(message);
            if (pendingInteractive.length > 0 && !isInteractiveAnswerSubmission) {
              // A brand-new user message should not inherit a stale interactive
              // prompt from the previous assistant turn. If the popover was
              // not rendered or was skipped, clear it here so the new message
              // starts a fresh turn instead of being replayed as an answer.
              dispatch({ type: "SET_INTERACTIVE_EVENTS", payload: [] });
              awaitingInteractiveTurnStart = false;
            }
            // A new user message starts a new turn. Never carry the previous
            // turn's streaming snapshot forward, or stop/retry can replay a
            // stale interactive question card.
            latestStreamingSnapshot = null;
            activeSubagentParentMessageIds = new Set<string>();
            if (isInteractiveAnswerSubmission) {
              awaitingInteractiveTurnStart = true;
              // Interactive answer submit starts a brand-new assistant turn.
              // Clear stale stream snapshots so previous turn content cannot leak
              // into the next turn. Do NOT flush the streaming snapshot — it was
              // already canonicalized by question.asked / SET_PROCESSING_SESSIONS.
              // A second flush replaces the existing message with the raw streaming
              // snapshot, which can lose structured output fields and clear content.
              latestStreamingSnapshot = null;
              activeSubagentParentMessageIds = new Set<string>();
              // Clear stale streaming so the next turn starts from a clean state,
              // but do NOT clear isProcessing here. The extension host already
              // sent a SET_PROCESSING_SESSIONS update with the active session
              // marked as processing. Flipping isProcessing to false just as the
              // next turn begins causes the UI to toggle between loading/not-loading,
              // leaving the composer in a confusing stale-loading posture while
              // real stream events are still being dispatched.
              dispatch({ type: "SET_STEERING", payload: false });
              // Replace streaming with a fresh empty card so the loading
              // indicator stays visible while the next turn starts, instead
              // of a gap with no feedback between answer and response.
              const questionReplyPlaceholderId = `question-reply-${Date.now()}`;
              dispatch({
                type: "SET_STREAMING",
                payload: {
                  messageId: questionReplyPlaceholderId,
                  content: "",
                  reasoning: "",
                  reasoningEvents: [],
                  steps: [],
                  progressEvents: [],
                  edits: [],
                  interactiveEvents: [],
                  isActive: true,
                  hasRenderableContent: false,
                },
              });
              // Defensive cleanup: once an interactive answer bundle is echoed back
              // from the extension host, clear any stale quick-input popover state.
              // This prevents already-answered prompts from lingering in the composer.
              dispatch({ type: "SET_INTERACTIVE_EVENTS", payload: [] });
            }
            // Get current state
            const currentState = getState();
            const currentMessages = currentState.messages || [];
            const updatedMessages = [...currentMessages];
            const currentStreaming = currentState.streaming;
            const hasStaleEmptyStreamingPlaceholder =
              !!currentStreaming &&
              currentStreaming.isActive === true &&
              !hasVisibleStreamingSnapshot(currentStreaming) &&
              !currentStreaming.messageId;
            if (hasStaleEmptyStreamingPlaceholder) {
              // Preserve the shell until the next live stream event replaces it.
              // Clearing here can hide the assistant card before realtime payloads
              // have a chance to populate it.
              logger.info("[TRACE][HANDLER][PRESERVE_EMPTY_STREAMING_PLACEHOLDER]", {
                currentSessionId: currentState.currentSessionId,
                streamingMessageId: currentStreaming.messageId ?? null,
                streamingActive: currentStreaming.isActive,
                hasVisibleStreamingSnapshot: hasVisibleStreamingSnapshot(currentStreaming),
              });
            }
            const persistedAssistantMessageIds = new Set(
              currentMessages
                .filter((candidate) => isAssistantHistoryMessage(candidate))
                .map((candidate) =>
                  firstNonEmptyString(
                    asString(asRecord(candidate.info)?.id),
                    asString(candidate.id),
                  ),
                )
                .filter((id): id is string => Boolean(id)),
            );

            // BUG FIX: If there is an inactive streaming message, flush it to messages
            // before appending the new user message. Otherwise, the queued user message appears
            // ABOVE the finished AI response (which would still be sitting in state.streaming).
            const currentStreamingMessageId = firstNonEmptyString(
              asString(currentStreaming?.messageId),
              asString(asRecord(currentStreaming as unknown as UnknownRecord)?.id),
            );
            const hasPersistedAssistantSnapshot =
              !!currentStreamingMessageId &&
              persistedAssistantMessageIds.has(currentStreamingMessageId);
            if (hasPersistedAssistantSnapshot) {
              dispatch({ type: "SET_STREAMING", payload: null });
            } else if (currentStreaming && !currentStreaming.isActive) {
              const flushedMessage = buildStreamingMessage(currentStreaming);
              updatedMessages.push(flushedMessage);
              dispatch({ type: "SET_STREAMING", payload: null });
            }

            const messageText = asString(message.content).trim();
            const lastMsg = currentMessages.length > 0 ? currentMessages[currentMessages.length - 1] : null;
            const isDuplicateOptimistic = lastMsg &&
              lastMsg.role === "user" &&
              asString(lastMsg.content).trim() === messageText;

            if (!isDuplicateOptimistic) {
              updatedMessages.push(message);
            }

            dispatch({
              type: "SET_MESSAGES",
              payload: updatedMessages,
            });
            // Don't clear dismissed interactive events - they should stay dismissed
            // If a user closed a popover, it shouldn't reappear when they send a new message
          }
          break;
        }
        case "sessionsListUpdate":
        case "SET_PROCESSING_SESSIONS": {
          const rawSessionIds =
            type === "sessionsListUpdate" ? data.processingSessionIds : data.payload;
          const sessionIds = asArray(
            rawSessionIds,
            (item): item is string => typeof item === "string",
          );
          dispatch({
            type: "SET_PROCESSING_SESSIONS",
            payload: sessionIds.filter((sessionId) => !stoppedSessionIds.has(sessionId)),
          });
          break;
        }
        case "queueUpdate": {
          const sessionId = asString(data.sessionId) || null;
          dispatch({
            type: "SET_QUEUE",
            payload: {
              sessionId,
              queue: asArray(data.queue, isQueueItem),
            },
          });
          break;
        }
        case "queueExecutionStarted": {
          dispatch({ type: "SET_EXECUTING_QUEUE", payload: { sessionId: asString(data.sessionId), executing: true } });
          break;
        }
        case "queueExecutionFinished": {
          dispatch({ type: "SET_EXECUTING_QUEUE", payload: { sessionId: asString(data.sessionId), executing: false } });
          break;
        }
        case "quotaData":
        case "quotaUpdate": {
          dispatch({ type: "SET_QUOTA_DATA", payload: data.data as QuotaData });
          break;
        }
        case "mcpStatus": {
          // Payload: { servers: Record<string, { status: string; error?: string }>, toolIds?: string[] }
          const serversRec = asRecord(data.servers);
          const toolIds: string[] = Array.isArray(data.toolIds)
            ? (data.toolIds as unknown[]).filter(
              (t): t is string => typeof t === "string",
            )
            : [];
          if (serversRec) {
            const mcpServers: McpServerInfo[] = Object.entries(serversRec).map(
              ([name, raw]) => {
                const entry = asRecord(raw);
                const status =
                  (asString(entry?.status) as McpServerStatus) || "disconnected";
                const error = entry?.error ? asString(entry.error) : undefined;
                // Associate tools whose ID starts with `name/` convention
                const serverTools = toolIds.filter(
                  (id) =>
                    id === name ||
                    id.startsWith(`${name}/`) ||
                    id.startsWith(`${name}_`),
                );
                return {
                  name,
                  status,
                  error,
                  tools: serverTools,
                  managed: entry?.managed === true,
                  profileId: asString(entry?.profileId) || undefined,
                  kind: entry?.kind === "local" || entry?.kind === "remote" ? entry.kind : undefined,
                };
              },
            );
            dispatch({ type: "SET_MCP_SERVERS", payload: mcpServers });
          }
          break;
        }
        case "mcpOperationResult": {
          if (data.success === false) {
            dispatch({
              type: "ADD_ERROR_MESSAGE",
              payload: asString(data.error) || "MCP operation failed.",
            });
          }
          break;
        }
        case "lspStatus": {
          // Payload: { servers: Array<LspStatus> }
          const rawServers = Array.isArray(data.servers) ? data.servers : [];
          const lspServers: LspServerInfo[] = rawServers.map((raw) => {
            const entry = asRecord(raw) ?? {};
            return {
              id: asString(entry.id),
              name: asString(entry.name),
              root: asString(entry.root),
              status: asString(entry.status) === "error" ? "error" : "connected",
            };
          });
          dispatch({ type: "SET_LSP_SERVERS", payload: lspServers });
          break;
        }
        case "todoSnapshot": {
          try {
            const sessionId = asString(data.sessionId);
            const currentSessionId = getState().currentSessionId;
            if (sessionId && currentSessionId && sessionId !== currentSessionId) {
              break;
            }
            const rawItems = Array.isArray(data.items) ? data.items : [];
            dispatch({
              type: "SET_TODO_ITEMS",
              payload: normalizeTodoList(rawItems, sessionId || currentSessionId || undefined),
            });
          } catch (e) {
            logger.warn("Failed to process todoSnapshot postMessage", { error: String(e) });
          }
          break;
        }
        case "todoUpdate": {
          // Normalize the incoming item to the canonical shape and ingest via
          // the shared ingestion helper so stream-origin and direct postMessage
          // messages produce identical reducer effects.
          try {
            const action = asString(data.action);
            const item = data.item;
            // Guard: ignore malformed or missing items silently.
            if (!item) break;
            const normalized = normalizeTodoRecord(item);
            if (!normalized) break;

            // Keep a clear, test-friendly branching for add/update so existing
            // string-based regression tests continue to match the handler body.
            if (action === "add") {
              dispatch({
                type: "ADD_TODO_ITEM",
                payload: {
                  id: normalized.id,
                  text: normalized.text,
                  status: normalized.status,
                  sessionId: normalized.sessionId ?? "",
                  parentMessageId: normalized.parentMessageId,
                  description: normalized.description,
                  priority: normalized.priority,
                  source: normalized.source,
                },
              });
            } else if (action === "update") {
              const patch: Partial<TodoItem> = {
                text: normalized.text,
                status: normalized.status,
                parentMessageId: normalized.parentMessageId,
                description: normalized.description,
                priority: normalized.priority,
                source: normalized.source,
              };
              if (normalized.sessionId) patch.sessionId = normalized.sessionId;
              dispatch({ type: "UPDATE_TODO_ITEM", payload: { id: normalized.id, patch } });
            } else {
              // Unknown action: fall back to unified ingestion which will decide
              // whether to add or update based on existing state.
              ingestNormalizedTodo(dispatch, getState, normalized);
            }
          } catch (e) {
            // Defensive: do not allow a malformed postMessage to throw.
            logger.warn("Failed to process todoUpdate postMessage", { error: String(e) });
          }
          break;
        }
        case "thinkingLevelUpdate": {
          const level = asString(data.level) as any;
          dispatch({ type: "SET_THINKING_LEVEL", payload: level || "" });
          break;
        }
        case "modelCapabilityUpdate": {
          try {
            const capRec = asRecord(data.capability);
            dispatch({
              type: "SET_MODEL_CAPABILITY",
              payload: capRec
                ? {
                  reasoning: Boolean(capRec.reasoning),
                  variants: Array.isArray(capRec.variants)
                    ? (capRec.variants as string[])
                    : undefined,
                  thinkingConfig: capRec.thinkingConfig as Record<string, unknown> | undefined,
                }
                : null,
            });
          } catch (e) {
            // Defensive: do not allow malformed postMessage to throw
            logger.warn("Failed to process modelCapabilityUpdate postMessage", { error: String(e) });
          }
          break;
        }
        case "addPlanAttachment": {
          const p = asRecord(data.payload);
          if (!p) break;
          dispatch({
            type: "ADD_ATTACHMENT",
            payload: {
              id: asString(p.id) || `plan-${Date.now()}`,
              filename: asString(p.filename, "Implementation Plan"),
              mimeType: asString(p.mimeType, "text/markdown"),
              dataUrl: asString(p.dataUrl),
            },
          });
          break;
        }
        case "injectThemeCss": {
          const css = asString(data.css);
          if (css) {
            let styleTag = document.getElementById("vscode-theme-icons");
            const previousCss = styleTag?.textContent ?? "";
            if (!styleTag) {
              styleTag = document.createElement("style");
              styleTag.id = "vscode-theme-icons";
              document.head.appendChild(styleTag);
            }
            if (previousCss === css) {
              break;
            }
            styleTag.textContent = css;
            // Force re-render of FileIcon components to check for theme icons
            dispatch({ type: "THEME_CSS_INJECTED" });
          }
          break;
        }
        case "opencodeConfig": {
          // Handle OpenCode configuration with file list
          const files = asArray(data.files, (item): item is AppState["opencodeConfig"]["files"][number] => {
            const rec = asRecord(item);
            return !!rec && typeof rec.name === 'string' && typeof rec.path === 'string';
          });

          dispatch({
            type: 'SET_OPENCODE_CONFIG',
            payload: {
              content: asString(data.content) || '',
              filePath: asString(data.filePath) || '',
              fileName: asString(data.fileName) || '',
              isGlobal: false, // TODO: determine if global vs workspace
              files,
            },
          });
          break;
        }
        case "opencodeConfigSaved": {
          dispatch({
            type: 'SET_OPENCODE_CONFIG_SAVE_STATUS',
            payload: {
              success: asBoolean(data.success, false),
              filePath: asString(data.filePath) || '',
              savedAt: Date.now(),
              message: asString(data.message),
              error: asString(data.error),
            },
          });
          break;
        }
        case "opencodeConfigError": {
          // Handle error loading config
          dispatch({
            type: 'SET_OPENCODE_CONFIG',
            payload: {
              content: '',
              filePath: '',
              fileName: '',
              isGlobal: false,
              error: asString(data.error) || 'Failed to load configuration',
              files: [],
            },
          });
          break;
        }
        default:
          break;
      }

      const candidate = asRecord(data.message);
      if (candidate) {
        const text = extractMessageText(candidate as Message);
        if (text && asString(data.type) === "appendPrompt") {
          const current = getState().inputValue;
          dispatch({
            type: "SET_INPUT_VALUE",
            payload: current ? `${current}\n}${text}` : text,
          });
        }
      }
    } catch (error) {
      const eventRecord = asRecord(event.data);
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error processing message', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        eventType: asString(eventRecord?.type) || 'unknown',
        eventKeys: objectKeys(eventRecord).slice(0, 80),
        eventCount: Array.isArray(eventRecord?.events) ? eventRecord.events.length : undefined,
      });
      dispatch({
        type: "ADD_ERROR_MESSAGE",
        payload: `An unexpected UI error occurred while processing an event. Some data may be missing or stuck. Please check the logs. Error: ${errorMessage}`
      });
    }
  };
}
