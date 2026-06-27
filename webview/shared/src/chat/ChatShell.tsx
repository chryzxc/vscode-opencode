import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, X } from "lucide-react";

import { AppProvider, useAppDispatch, useAppState } from "./lib/store";
import {
  createMessageHandler,
  coalesceAdjacentAssistantHistoryMessages,
  extractSubagentsFromCentralizedEvents,
  getCentralizedEventInfo,
  getCentralizedEventPart,
  getCentralizedEventType,
  normalizeCentralizedEventPayloads,
  normalizeMessage,
  normalizeSubagentDetail,
} from "./lib/messageHandler";
import {
  isAssistantRespondingInCurrentSession,
  isProcessingInCurrentSession,
  latestAssistantMessageIdFromCentralizedTape,
  latestSessionStatusTypeFromCentralizedTape,
} from "./lib/sessionProcessing";
import { hasSystemMessagePatternInText } from "./lib/store";
import vscode from "./lib/vscode";
import logger, { getGlobalShowBrowserConsole } from "./lib/logger";

import {
  StickyHeader,
  HistorySidebar,
  MobileRightSummary,
  InputWrapper,
  ActiveTaskPanel,
  QuotaMonitor,
  TodoPanel,
  McpPanel,
  LspPanel,
  AgentsPanel,
  SkillsPanel,
  SettingsPanel,
} from "./PanelComponents";
import { CentralizedToastOverlay } from "./ToastOverlay";
import { StreamingCard } from "./StreamingComponents";
import {
  ResponseMessage,
  CentralizedDebugPanel,
  EmptyState,
  FileChangesSection,
  PermissionCard,
  SystemMessage,
  ThinkingBubble,
  UserMessage,
} from "./MessageComponents";
import { SkillInstallerModal } from "./SkillInstallerModal";
import { SessionModal } from "./components/SessionModal";
import type { CentralizedSessionDiffEvent, Message } from "./lib/types";

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeComparableText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function renderMessageContentSignature(message: Message): string {
  return [
    firstNonEmptyString(message.role, message.info?.role) ?? "",
    normalizeComparableText(
      firstNonEmptyString(
        message.content,
        message.text,
        message.info?.content,
        message.info?.text,
      ),
    ),
  ].join("::");
}

function getCanonicalMessageId(message: Message): string | undefined {
  return firstNonEmptyString(message.info?.id, message.id, message.messageId);
}

function getCanonicalMessageCreatedAt(message: Message): number {
  if (typeof message.created === "number") {
    return message.created;
  }
  if (typeof message.info?.created === "number") {
    return message.info.created;
  }
  return 0;
}

function getCentralizedPartMessageId(part: Record<string, unknown> | null): string | undefined {
  return firstNonEmptyString(part?.messageID, part?.messageId);
}

function getCentralizedEventCreatedAt(
  event: Record<string, unknown>,
  part: Record<string, unknown> | null,
): number | undefined {
  const properties = asRecord(event.properties);
  return typeof properties?.time === "number"
    ? properties.time
    : typeof asRecord(part?.time)?.start === "number"
      ? (asRecord(part?.time)?.start as number)
      : typeof asRecord(part?.time)?.end === "number"
        ? (asRecord(part?.time)?.end as number)
        : undefined;
}

function getCentralizedEventMessageId(
  event: Record<string, unknown>,
  part?: Record<string, unknown> | null,
): string | undefined {
  const info = getCentralizedEventInfo(event);
  const resolvedPart = typeof part === "undefined" ? getCentralizedEventPart(event) : part;
  const payloadRecord = asRecord(event.payload);
  const payloadSyncEvent = asRecord(payloadRecord?.syncEvent);
  const payloadSyncData = asRecord(payloadSyncEvent?.data);
  const payloadSyncDataPart = asRecord(payloadSyncData?.part);

  return firstNonEmptyString(
    info?.id,
    info?.messageID,
    info?.messageId,
    resolvedPart?.messageID,
    resolvedPart?.messageId,
    payloadSyncDataPart?.messageID,
    payloadSyncDataPart?.messageId,
  );
}

function isAssistantOwnedCentralizedPartEvent(
  event: Record<string, unknown>,
  part: Record<string, unknown> | null,
  sourceMessagesById: Map<string, Message>,
  assistantMessageIds: Set<string>,
  latestAssistantMessageId: string | null,
): boolean {
  const messageId = getCentralizedPartMessageId(part);
  if (!part || !messageId) {
    return false;
  }

  if (assistantMessageIds.has(messageId)) {
    return true;
  }

  const sourceMessage = sourceMessagesById.get(messageId);
  const sourceRole = firstNonEmptyString(sourceMessage?.role, sourceMessage?.info?.role)?.toLowerCase();
  if (sourceRole === "assistant") {
    return true;
  }

  const partType = firstNonEmptyString(part.type)?.toLowerCase();
  const toolName = firstNonEmptyString(part.tool, part.name)?.toLowerCase();
  if (
    toolName ||
    partType === "tool" ||
    partType === "reasoning" ||
    partType === "step-start" ||
    partType === "step-finish" ||
    partType === "output_text" ||
    partType === "message"
  ) {
    return true;
  }

  if (latestAssistantMessageId && messageId === latestAssistantMessageId) {
    return true;
  }

  return (
    getCentralizedEventType(event) === "message.part.updated" &&
    partType === "text" &&
    !!latestAssistantMessageId &&
    messageId === latestAssistantMessageId
  );
}

function buildCentralizedRenderMessages(
  messages: Message[],
  rawSdkEventPayloads: unknown[],
): Message[] {
  // Normalize the centralized tape once so this conversation builder only
  // consumes one canonical event envelope regardless of whether the original
  // payload was a direct `properties.part` event or a sync-wrapped event.
  const normalizedRawSdkEventPayloads = normalizeCentralizedEventPayloads(rawSdkEventPayloads);
  /**
   * ============================================================================
   * STRICT CENTRALIZED DATA ENFORCEMENT
   * ============================================================================
   * Per strict architectural requirements: All data that will be rendered in the 
   * conversation list MUST come from the centralized data (rawSdkEventPayloads), 
   * nothing else. 
   * 
   * We do NOT render optimistic messages from the local `messages` state. 
   * Even user messages are purely derived from the central tape echoing them back.
   * If a message is not in `rawSdkEventPayloads`, it does not exist in the UI.
   * ============================================================================
   */
  const merged: Message[] = [];
  const assistantParentIds = new Set<string>();
  const assistantMessageIds = new Set<string>();
  const assistantDescriptorsByParent = new Map<string, {
    messageId: string;
    parentId?: string;
    createdAt?: number;
  }>();
  const userDescriptors: Array<{
    messageId: string;
    text: string;
    createdAt?: number;
  }> = [];
  const sourceMessagesById = new Map<string, Message>();
  const rawEventsByMessageId = new Map<string, unknown[]>();
  const partsByMessageId = new Map<string, unknown[]>();
  const firstRawIndexByMessageId = new Map<string, number>();
  const latestAssistantMessageId =
    latestAssistantMessageIdFromCentralizedTape(normalizedRawSdkEventPayloads);

  for (const message of messages) {
    const messageId = getCanonicalMessageId(message);
    if (!messageId || sourceMessagesById.has(messageId)) {
      continue;
    }
    sourceMessagesById.set(messageId, message);
  }

  for (let rawIndex = 0; rawIndex < normalizedRawSdkEventPayloads.length; rawIndex += 1) {
    const payload = normalizedRawSdkEventPayloads[rawIndex];
    const event = asRecord(payload);
    if (!event) {
      continue;
    }
    const eventPart = getCentralizedEventPart(event);
    const eventMessageId = getCentralizedEventMessageId(event, eventPart);
    if (eventMessageId) {
      const existing = rawEventsByMessageId.get(eventMessageId) ?? [];
      existing.push(event);
      rawEventsByMessageId.set(eventMessageId, existing);
      if (!firstRawIndexByMessageId.has(eventMessageId)) {
        firstRawIndexByMessageId.set(eventMessageId, rawIndex);
      }
    }

    if (getCentralizedEventType(event) === "message.updated") {
      const info = getCentralizedEventInfo(event);
      if (firstNonEmptyString(info?.role)?.toLowerCase() !== "assistant") {
        continue;
      }
      const assistantId = firstNonEmptyString(info?.id, info?.messageID, info?.messageId);
      const parentId = firstNonEmptyString(info?.parentID, info?.parentId);
      if (parentId) {
        assistantParentIds.add(parentId);
      }
      if (!assistantId) {
        continue;
      }

      assistantMessageIds.add(assistantId);
      const createdAt =
        typeof asRecord(info?.time)?.created === "number"
          ? (asRecord(info?.time)?.created as number)
          : undefined;
      const parentKey = parentId || assistantId;
      const existing = assistantDescriptorsByParent.get(parentKey);
      if (
        !existing ||
        (typeof createdAt === "number" && (existing.createdAt ?? -Infinity) <= createdAt)
      ) {
        assistantDescriptorsByParent.set(parentKey, {
          messageId: assistantId,
          parentId: parentId || undefined,
          createdAt,
        });
      }
      continue;
    }

    if (getCentralizedEventType(event) !== "message.part.updated") {
      continue;
    }
    const part = eventPart;
    const messageId = getCentralizedPartMessageId(part);
    if (
      messageId &&
      isAssistantOwnedCentralizedPartEvent(
        event,
        part,
        sourceMessagesById,
        assistantMessageIds,
        latestAssistantMessageId,
      )
    ) {
      assistantMessageIds.add(messageId);
      const sourceMessage = sourceMessagesById.get(messageId);
      const parentId = firstNonEmptyString(
        sourceMessage?.info?.parentID,
        sourceMessage?.info?.parentId,
      );
      const createdAt = getCentralizedEventCreatedAt(event, part);
      const parentKey = parentId || messageId;
      const existing = assistantDescriptorsByParent.get(parentKey);
      if (
        !existing ||
        (typeof createdAt === "number" && (existing.createdAt ?? -Infinity) <= createdAt)
      ) {
        assistantDescriptorsByParent.set(parentKey, {
          messageId,
          parentId: parentId || undefined,
          createdAt,
        });
      }
      // Extract and collect the part for this message
      if (part) {
        const existingParts = partsByMessageId.get(messageId) ?? [];
        existingParts.push(part);
        partsByMessageId.set(messageId, existingParts);
      }
      continue;
    }

    if (firstNonEmptyString(part?.type)?.toLowerCase() !== "text") {
      continue;
    }
    const text = firstNonEmptyString(part?.text, part?.content);
    const isUserOwnedTextPart = !!messageId && !assistantMessageIds.has(messageId);
      
    // Strictly ONLY push if it is a user text part from the tape
    if (
      !messageId ||
      !text ||
      !isUserOwnedTextPart ||
      userDescriptors.some((descriptor) => descriptor.messageId === messageId)
    ) {
      continue;
    }

    userDescriptors.push({
      messageId,
      text,
      createdAt: getCentralizedEventCreatedAt(event, part),
    });
  }

  const seenMessageIds = new Set<string>();

  console.log('[BUILD_MESSAGES] Filtering assistant messages', {
    totalDescriptors: assistantDescriptorsByParent.size,
    assistantParentIds: Array.from(assistantParentIds),
    filteredCount: 0,
  });

  for (const descriptor of assistantDescriptorsByParent.values()) {
    if (
      assistantParentIds.has(descriptor.messageId) ||
      seenMessageIds.has(descriptor.messageId)
    ) {
      console.log('[BUILD_MESSAGES] Skipping filtered message', {
        messageId: descriptor.messageId,
        reason: assistantParentIds.has(descriptor.messageId) ? 'is_parent' : 'already_seen',
      });
      continue;
    }
    seenMessageIds.add(descriptor.messageId);

    const sourceMessage = sourceMessagesById.get(descriptor.messageId);
    const collectedParts = partsByMessageId.get(descriptor.messageId) ?? [];

    console.log('[BUILD_MESSAGES] Adding assistant message', {
      messageId: descriptor.messageId,
      hasSourceMessage: !!sourceMessage,
      collectedPartsCount: collectedParts.length,
      rawEventsCount: rawEventsByMessageId.get(descriptor.messageId)?.length ?? 0,
    });

    if (sourceMessage) {
      const rawSourceMessage = {
        ...sourceMessage,
        parts: collectedParts.length > 0 ? collectedParts : sourceMessage.parts,
        rawSdkEventPayloads:
          rawEventsByMessageId.get(descriptor.messageId) ??
          sourceMessage.rawSdkEventPayloads,
      } as Message;
      
      const normalized = normalizeMessage(rawSourceMessage, null) ?? rawSourceMessage;
      merged.push(normalized);
      continue;
    }

    const rawAssistantMessage = {
      id: descriptor.messageId,
      role: "assistant",
      info: {
        id: descriptor.messageId,
        role: "assistant",
        created: descriptor.createdAt,
        parentID: descriptor.parentId,
      },
      created: descriptor.createdAt,
      parts: collectedParts.length > 0 ? collectedParts : undefined,
      rawSdkEventPayloads: rawEventsByMessageId.get(descriptor.messageId) ?? [],
    } as Message;
    
    const normalized = normalizeMessage(rawAssistantMessage, null) ?? rawAssistantMessage;
    merged.push(normalized);

    console.log('[BUILD_MESSAGES] Created assistant message from descriptor', {
      messageId: descriptor.messageId,
      parentId: descriptor.parentId,
      partsCount: collectedParts.length,
      rawEventsCount: rawEventsByMessageId.get(descriptor.messageId)?.length ?? 0,
    });
  }

  console.log('[BUILD_MESSAGES] Final message list', {
    totalMessages: merged.length,
    messageIds: merged.map(m => firstNonEmptyString(m.info?.id, m.id, m.messageId)),
    messagesWithDetails: merged.map(m => ({
      id: firstNonEmptyString(m.info?.id, m.id, m.messageId),
      role: m.role ?? m.info?.role,
      parentId: firstNonEmptyString(m.info?.parentID, m.info?.parentId),
      hasRawSdkEvents: Array.isArray(m.rawSdkEventPayloads) && m.rawSdkEventPayloads.length > 0,
      rawSdkEventsCount: m.rawSdkEventPayloads?.length || 0,
      hasSubagents: Array.isArray(m.subagents) && m.subagents.length > 0,
      subagentsCount: Array.isArray(m.subagents) ? m.subagents.length : 0,
      hasContent: !!(m.content || m.text || m.parts?.length)
    }))
  });

  // Check specifically for assistant messages
  const assistantMessages = merged.filter(m => {
    const role = firstNonEmptyString(m.role, m.info?.role)?.toLowerCase();
    return role === 'assistant';
  });

  console.log('[BUILD_MESSAGES] Assistant messages in final list:', {
    assistantMessageCount: assistantMessages.length,
    assistantMessageIds: assistantMessages.map(m => firstNonEmptyString(m.info?.id, m.id, m.messageId)),
    assistantMessagesWithSubagents: assistantMessages.filter(m => Array.isArray(m.subagents) && m.subagents.length > 0).length
  });

  for (const descriptor of userDescriptors) {
    if (seenMessageIds.has(descriptor.messageId)) {
      continue;
    }
    seenMessageIds.add(descriptor.messageId);

    const sourceMessage = sourceMessagesById.get(descriptor.messageId);
    if (sourceMessage) {
      merged.push({
        ...sourceMessage,
        rawSdkEventPayloads:
          rawEventsByMessageId.get(descriptor.messageId) ??
          sourceMessage.rawSdkEventPayloads,
      });
      continue;
    }

    merged.push({
      id: descriptor.messageId,
      role: "user",
      content: descriptor.text,
      text: descriptor.text,
      info: {
        id: descriptor.messageId,
        role: "user",
      },
      created: descriptor.createdAt,
      rawSdkEventPayloads: rawEventsByMessageId.get(descriptor.messageId) ?? [],
    } as Message);
  }

  for (const message of messages) {
    const role = firstNonEmptyString(message.role, message.info?.role)?.toLowerCase();
    if (role !== "assistant") {
      continue;
    }
    const messageId = firstNonEmptyString(message.info?.id, message.id, message.messageId);
    if (!messageId || seenMessageIds.has(messageId)) {
      continue;
    }
    seenMessageIds.add(messageId);
    merged.push({
      ...message,
      rawSdkEventPayloads:
        rawEventsByMessageId.get(messageId) ??
        message.rawSdkEventPayloads,
    });
  }

  const sorted = merged.sort((left, right) => {
    const leftId = firstNonEmptyString(left.info?.id, left.id, left.messageId) ?? "";
    const rightId = firstNonEmptyString(right.info?.id, right.id, right.messageId) ?? "";
    const leftRaw = firstRawIndexByMessageId.get(leftId) ?? Number.MAX_SAFE_INTEGER;
    const rightRaw = firstRawIndexByMessageId.get(rightId) ?? Number.MAX_SAFE_INTEGER;
    if (leftRaw !== rightRaw) {
      return leftRaw - rightRaw;
    }
    const leftCreated = getCanonicalMessageCreatedAt(left);
    const rightCreated = getCanonicalMessageCreatedAt(right);
    if (leftCreated !== rightCreated) {
      return leftCreated - rightCreated;
    }
    return 0;
  });

  // Extract subagents from centralized events and attach to messages
  // This ensures the subagent modal uses centralized data as the source of truth
  const messagesWithSubagents = sorted.map((message) => {
    const messageId = firstNonEmptyString(message.info?.id, message.id, message.messageId);
    if (!messageId) {
      return message;
    }

    // Extract subagents from this message's centralized events
    const messageEvents = message.rawSdkEventPayloads ?? [];

    // For assistant messages, use the parentID (user message) as the parent message ID
    // This ensures subagents are associated with the user message that triggered them
    const role = firstNonEmptyString(message.role, message.info?.role)?.toLowerCase();

    console.log('🔍 [SUBAGENT_ATTACHMENT] Processing message for subagent extraction', {
      messageId,
      role,
      hasRawEvents: messageEvents.length > 0,
      rawEventsCount: messageEvents.length,
      messageParentId: firstNonEmptyString(message.info?.parentID, message.info?.parentId)
    });

    const parentMessageId = role === "assistant"
      ? firstNonEmptyString(message.info?.parentID, message.info?.parentId)
      : messageId;

    console.log('🔍 [SUBAGENT_ATTACHMENT] Using parent message ID for extraction', {
      originalMessageId: messageId,
      role,
      parentMessageId,
      isAssistantMessage: role === "assistant"
    });

    const { detailsById } = extractSubagentsFromCentralizedEvents(messageEvents, parentMessageId);

    // Convert details to subagent format
    const subagents = Object.values(detailsById).map(detail => normalizeSubagentDetail(detail));

    console.log('🔍 [SUBAGENT_ATTACHMENT] Extraction results', {
      messageId,
      role,
      parentMessageId,
      subagentsFound: subagents.length,
      subagentIds: subagents.map(s => s.id)
    });

    // Only add subagents array if we found any
    if (subagents.length === 0) {
      console.log('⚠️ [SUBAGENT_ATTACHMENT] No subagents found for message', { messageId, role });
      return message;
    }

    console.log('✅ [SUBAGENT_ATTACHMENT] Successfully attached subagents to message', {
      messageId,
      role,
      parentMessageId,
      subagentsCount: subagents.length,
      subagents: subagents.map(s => ({ id: s.id, agentId: s.agentId, parentMessageId: s.parentMessageId }))
    });

    return {
      ...message,
      subagents,
    } as Message;
  });

  console.log('[BUILD_MESSAGES] Added subagents from centralized data', {
    totalMessages: messagesWithSubagents.length,
    messagesWithSubagents: messagesWithSubagents.filter(m => Array.isArray(m.subagents) && m.subagents.length > 0).length,
  });

  return coalesceAdjacentAssistantHistoryMessages(messagesWithSubagents);
}

type ConversationRenderEntry =
  | {
      kind: "message";
      key: string;
      message: Message;
      messageIndex: number;
      order: number;
    }
  | {
      kind: "session.diff";
      key: string;
      diff: CentralizedSessionDiffEvent;
      order: number;
    };

function parseCentralizedSessionDiffEvent(
  payload: unknown,
  rawIndex: number,
): CentralizedSessionDiffEvent | null {
  const event = asRecord(payload);
  if (!event || firstNonEmptyString(event.type) !== "session.diff") {
    return null;
  }

  const properties = asRecord(event.properties);
  const rawDiffs = Array.isArray(properties?.diff)
    ? properties.diff
    : Array.isArray(event.diff)
      ? event.diff
      : [];
  const files = rawDiffs
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => !!item)
    .map((item) => ({
      file: firstNonEmptyString(item.file) ?? "",
      patch: firstNonEmptyString(item.patch),
      additions:
        typeof item.additions === "number"
          ? item.additions
          : typeof item.additions === "string"
            ? Number(item.additions)
            : undefined,
      deletions:
        typeof item.deletions === "number"
          ? item.deletions
          : typeof item.deletions === "string"
            ? Number(item.deletions)
            : undefined,
      status: firstNonEmptyString(item.status),
    }))
    .filter((item) => item.file.length > 0);

  if (files.length === 0) {
    return null;
  }

  const eventTime =
    typeof properties?.time === "number"
      ? properties.time
      : typeof event.time === "number"
        ? event.time
        : undefined;

  return {
    id: firstNonEmptyString(event.id),
    sessionId: firstNonEmptyString(properties?.sessionID, event.sessionId),
    createdAt: eventTime,
    files,
  };
}

function buildCentralizedConversationEntries(
  messages: Message[],
  rawSdkEventPayloads: unknown[],
): ConversationRenderEntry[] {
  const normalizedRawSdkEventPayloads = normalizeCentralizedEventPayloads(rawSdkEventPayloads);
  const renderMessages = buildCentralizedRenderMessages(messages, normalizedRawSdkEventPayloads);
  const messageById = new Map<string, Message>();
  const messageIndexById = new Map<string, number>();
  const emittedMessageIds = new Set<string>();
  const entries: ConversationRenderEntry[] = [];

  for (let index = 0; index < renderMessages.length; index += 1) {
    const message = renderMessages[index];
    const messageId = firstNonEmptyString(
      message.info?.id,
      message.id,
      message.messageId,
    );
    if (messageId && !messageById.has(messageId)) {
      messageById.set(messageId, message);
      messageIndexById.set(messageId, index);
    }
  }

  for (let rawIndex = 0; rawIndex < normalizedRawSdkEventPayloads.length; rawIndex += 1) {
    const event = asRecord(normalizedRawSdkEventPayloads[rawIndex]);
    if (!event) {
      continue;
    }

    const info = getCentralizedEventInfo(event);
    const part = getCentralizedEventPart(event);
    const diff = parseCentralizedSessionDiffEvent(event, rawIndex);
    if (diff) {
      entries.push({
        kind: "session.diff",
        key: `session.diff:${diff.id ?? rawIndex}`,
        diff,
        order: rawIndex,
      });
      continue;
    }

    const messageId = firstNonEmptyString(
      info?.id,
      info?.messageID,
      info?.messageId,
      part?.messageID,
      part?.messageId,
    );
    if (!messageId || emittedMessageIds.has(messageId)) {
      continue;
    }

    const message = messageById.get(messageId);
    if (!message) {
      continue;
    }

    emittedMessageIds.add(messageId);
    entries.push({
      kind: "message",
      key: `message:${messageId}`,
      message,
      messageIndex: messageIndexById.get(messageId) ?? entries.length,
      order: rawIndex,
    });
  }

  for (let index = 0; index < renderMessages.length; index += 1) {
    const message = renderMessages[index];
    const messageId = firstNonEmptyString(
      message.info?.id,
      message.id,
      message.messageId,
    );
    if (!messageId || emittedMessageIds.has(messageId)) {
      continue;
    }
    emittedMessageIds.add(messageId);
    entries.push({
      kind: "message",
      key: `message:${messageId}`,
      message,
      messageIndex: index,
      order: Number.MAX_SAFE_INTEGER + index,
    });
  }

  return entries;
}

type StreamViewportState = {
  isFollowing: boolean;
  unseenUpdateCount: number;
};

const AUTO_FOLLOW_THRESHOLD_PX = 96;
const WEBVIEW_BOOTSTRAP_CACHE_KEY = "opencode.chat.bootstrap.v1";

function formatCompactionTime(at?: number): string | undefined {
  if (typeof at !== "number") {
    return undefined;
  }
  return new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function CompactionDivider({
  at,
  collapsed,
  hiddenMessageCount,
  onToggle,
}: {
  at?: number;
  collapsed?: boolean;
  hiddenMessageCount?: number;
  onToggle?: () => void;
}) {
  const compactedAt = formatCompactionTime(at);
  const isInteractive = typeof collapsed === "boolean" && typeof onToggle === "function";
  const summary =
    collapsed && typeof hiddenMessageCount === "number"
      ? `${hiddenMessageCount} compacted message${hiddenMessageCount === 1 ? "" : "s"} hidden`
      : "Compacted history";
  const meta = collapsed
    ? compactedAt
      ? `Compacted ${compactedAt}`
      : "Session archive"
    : compactedAt
      ? `Compacted ${compactedAt}`
      : "Archive boundary";
  const actionLabel = collapsed ? "Show history" : "Hide history";

  return (
    <div className="oc-compaction-divider-wrap -mx-6 py-2 sm:-mx-8">
      <div className="oc-compaction-divider">
        <span className="oc-compaction-divider-line" />
        {isInteractive ? (
          <button
            type="button"
            onClick={onToggle}
            className="oc-compaction-divider-card oc-compaction-divider-card-button"
            aria-pressed={!collapsed}
            title={collapsed ? "Show compacted messages" : "Hide compacted messages"}
            data-collapsed={collapsed ? "true" : "false"}
          >
            <span className="oc-compaction-divider-icon" aria-hidden="true">
              <Archive className="h-3.5 w-3.5" />
            </span>
            <span className="oc-compaction-divider-copy">
              <span className="oc-compaction-divider-label">{summary}</span>
              <span className="oc-compaction-divider-meta">{meta}</span>
            </span>
            <span className="oc-compaction-divider-action">{actionLabel}</span>
          </button>
        ) : (
          <div className="oc-compaction-divider-card" aria-label={meta}>
            <span className="oc-compaction-divider-icon" aria-hidden="true">
              <Archive className="h-3.5 w-3.5" />
            </span>
            <span className="oc-compaction-divider-copy">
              <span className="oc-compaction-divider-label">{summary}</span>
              <span className="oc-compaction-divider-meta">{meta}</span>
            </span>
          </div>
        )}
        <span className="oc-compaction-divider-line" />
      </div>
    </div>
  );
}

function getToastSeverity(message: string): "warning" | "error" {
  const normalized = message.trim().toLowerCase();
  return normalized.includes("warning") ? "warning" : "error";
}

function SessionLoadingSpinner() {
  return (
    <div className="flex items-center justify-center gap-2">
      {/* Three dot loading animation */}
      <div className="flex gap-1.5">
        <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: '0s' }} />
        <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: '0.2s' }} />
        <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: '0.4s' }} />
      </div>
    </div>
  );
}

function ChatContent() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const stateRef = useRef(state);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const [streamViewport, setStreamViewport] = useState<StreamViewportState>({
    isFollowing: true,
    unseenUpdateCount: 0,
  });
  const [showSkillInstaller, setShowSkillInstaller] = useState(false);
  const [dismissedCompatibilityWarningSignature, setDismissedCompatibilityWarningSignature] =
    useState<string | null>(null);

  // Track loading state timing to ensure minimum display duration
  const loadingStartTimeRef = useRef<number | null>(null);
  const LOADING_MIN_DISPLAY_MS = 500; // Show loading state for at least 500ms so users can perceive it
  const streamViewportRef = useRef(streamViewport);
  const previousIsLoadingSessionRef = useRef(state.isLoadingSession);
  const previousReceivedInitStateRef = useRef(state.receivedInitState);
  const previousStreamingActiveRef = useRef(Boolean(state.streaming?.isActive));
  const didHydrateBootstrapRef = useRef(false);
  // Throttle "unseen updates" increments while the user is scrolled away from the
  // bottom. Stream events can arrive dozens of times per second, and incrementing
  // this counter for every tick causes avoidable React work during manual scrolling.
  const lastUnseenIncrementAtRef = useRef(0);
  // Throttle follow-mode scroll writes to roughly one frame (33ms ~= 30fps).
  // Writing scrollTop on every tiny stream mutation can fight user input and create
  // visible hitching. A small throttle preserves "stick to bottom" behavior without
  // overdriving layout/reflow during heavy token streams.
  const lastFollowAutoScrollAtRef = useRef(0);

  const resolveAgentColor = useCallback((agentId?: string) => {
    if (!agentId) return "var(--oc-accent)";

    const match = state.availableAgents.find(
      (agent) =>
        agent.id === agentId ||
        agent.name.toLowerCase() === agentId.toLowerCase(),
    );

    return match?.color ?? "var(--oc-accent)";
  }, [state.availableAgents]);

  // Keep ref current so message handler closure always reads latest state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  // Hydrate last known session/messages immediately on webview re-open so UI
  // does not flash a blank/loading screen while extension bootstrap completes.
  useEffect(() => {
    if (didHydrateBootstrapRef.current) {
      return;
    }
    didHydrateBootstrapRef.current = true;

    try {
      const raw = window.sessionStorage.getItem(WEBVIEW_BOOTSTRAP_CACHE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as {
        currentSessionId?: string;
        messagesBySessionId?: Record<string, Message[]>;
      };

      const sessionId =
        typeof parsed?.currentSessionId === "string" &&
        parsed.currentSessionId.trim().length > 0
          ? parsed.currentSessionId
          : null;
      const messagesBySessionId =
        parsed?.messagesBySessionId &&
        typeof parsed.messagesBySessionId === "object"
          ? parsed.messagesBySessionId
          : {};

      if (!sessionId) {
        return;
      }

      const cachedMessages = Array.isArray(messagesBySessionId[sessionId])
        ? messagesBySessionId[sessionId]
        : [];

      dispatch({ type: "SET_SESSION_ID", payload: sessionId });
      dispatch({
        type: "CACHE_SESSION_MESSAGES",
        payload: { sessionId, messages: cachedMessages },
      });
      if (cachedMessages.length > 0) {
        dispatch({ type: "HYDRATE_SESSION_FROM_CACHE", payload: { sessionId } });
      }
    } catch {
      // best-effort hydration only
    }
  }, [dispatch]);

  // Persist a lightweight session/message snapshot for fast restore across
  // sidebar/extension switches that recreate the webview.
  useEffect(() => {
    if (state.streaming?.isActive) {
      return;
    }
    try {
      const nextSnapshot = {
        currentSessionId: state.currentSessionId,
        messagesBySessionId: state.messagesBySessionId,
      };
      window.sessionStorage.setItem(
        WEBVIEW_BOOTSTRAP_CACHE_KEY,
        JSON.stringify(nextSnapshot),
      );
    } catch {
      // storage can fail in restricted webview scenarios; ignore gracefully
    }
  }, [state.currentSessionId, state.messagesBySessionId, state.streaming?.isActive]);

  useEffect(() => {
    streamViewportRef.current = streamViewport;
  }, [streamViewport]);

  useEffect(() => {
    const isStreamingNow = Boolean(state.streaming?.isActive);
    const justLoadedInitialChat =
      !previousReceivedInitStateRef.current && state.receivedInitState;
    const justFinishedSessionLoad =
      previousIsLoadingSessionRef.current && !state.isLoadingSession;
    const justFinishedAiResponse =
      previousStreamingActiveRef.current && !isStreamingNow;
    const shouldSnapToLatest =
      state.messages.length > 0 &&
      (justLoadedInitialChat || justFinishedSessionLoad);

    // Only auto-scroll after AI finishes if user is already near the bottom.
    const shouldFollowAfterResponse =
      justFinishedAiResponse && streamViewportRef.current.isFollowing;

    if (shouldSnapToLatest || shouldFollowAfterResponse) {
      setStreamViewport({ isFollowing: true, unseenUpdateCount: 0 });
      requestAnimationFrame(() => {
        const root = messagesScrollRef.current;
        if (root) {
          root.scrollTop = root.scrollHeight;
        }
      });
    } else if (justFinishedAiResponse) {
      setStreamViewport((prev) =>
        prev.unseenUpdateCount === 0
          ? prev
          : { ...prev, unseenUpdateCount: 0 },
      );
    }

    previousReceivedInitStateRef.current = state.receivedInitState;
    previousIsLoadingSessionRef.current = state.isLoadingSession;
    previousStreamingActiveRef.current = isStreamingNow;
  }, [
    state.isLoadingSession,
    state.messages.length,
    state.receivedInitState,
    state.streaming?.isActive,
  ]);

  // Register message listener
  useEffect(() => {
    const handler = createMessageHandler(dispatch, () => stateRef.current);
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [dispatch]);

  // Listen for skill installer messages
  useEffect(() => {
    const handleSkillMessages = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "showSkillInstaller") {
        setShowSkillInstaller(true);
      }
    };

    window.addEventListener("message", handleSkillMessages);
    return () => window.removeEventListener("message", handleSkillMessages);
  }, []);

  // Send ready + retry until initState received
  useEffect(() => {
    vscode.postMessage({ type: "ready" });
    const interval = setInterval(() => {
      if (!stateRef.current.receivedInitState) {
        vscode.postMessage({ type: "ready" });
      } else {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const root = messagesScrollRef.current;
    if (!root) return;

    let rafId: number | null = null;
    const updateViewportState = () => {
      rafId = null;
      const nearBottom =
        root.scrollHeight - root.scrollTop - root.clientHeight <=
        AUTO_FOLLOW_THRESHOLD_PX;
      setStreamViewport((prev) => {
        if (nearBottom) {
          if (prev.isFollowing && prev.unseenUpdateCount === 0) {
            return prev;
          }
          return { isFollowing: true, unseenUpdateCount: 0 };
        }
        if (!prev.isFollowing) {
          return prev;
        }
        return { ...prev, isFollowing: false };
      });
    };
    const onScroll = () => {
      if (rafId !== null) {
        return;
      }
      rafId = requestAnimationFrame(updateViewportState);
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);

  useEffect(() => {
    if (streamViewportRef.current.isFollowing) {
      const root = messagesScrollRef.current;
      if (root) {
        const now = Date.now();
        // Keep follow-mode pinned, but at a controlled cadence. This replaced a
        // MutationObserver-per-change strategy that was too eager during streaming.
        if (now - lastFollowAutoScrollAtRef.current >= 33) {
          root.scrollTop = root.scrollHeight;
          lastFollowAutoScrollAtRef.current = now;
        }
      }
      if (streamViewportRef.current.unseenUpdateCount > 0) {
        setStreamViewport((prev) =>
          prev.unseenUpdateCount === 0
            ? prev
            : { ...prev, unseenUpdateCount: 0 },
        );
      }
      return;
    }

    if (state.streaming?.isActive) {
      const now = Date.now();
      // When user is not following, we still surface activity via the "Jump to latest"
      // badge. Throttle count updates so the badge reflects progress without creating
      // a render storm on high-frequency stream bursts.
      if (now - lastUnseenIncrementAtRef.current < 120) {
        return;
      }
      lastUnseenIncrementAtRef.current = now;
      setStreamViewport((prev) => ({
        ...prev,
        unseenUpdateCount: Math.min(prev.unseenUpdateCount + 1, 999),
      }));
    }
  }, [state.messages, state.streaming]);

  // Safety net: Clear loading state if it takes too long (10 seconds)
  // Note: END_SESSION_LOADING is normally dispatched in messageHandler after chatHistory loads
  // This timeout only handles edge cases where loading state gets stuck
  useEffect(() => {
    if (!state.isLoadingSession) return;

    const timeoutId = setTimeout(() => {
      if (state.isLoadingSession) {
        dispatch({ type: "END_SESSION_LOADING" });
      }
    }, 10000); // 10 second timeout

    return () => clearTimeout(timeoutId);
  }, [state.isLoadingSession, dispatch]);

  // Check if AI is currently responding (processing user message)
  const isAiResponding = isProcessingInCurrentSession(
    state.isProcessing,
    state.currentSessionId,
    state.processingSessionIds,
  );
  const centralizedSessionRawSdkEventPayloads =
    state.currentSessionId &&
    Array.isArray(state.rawSdkEventPayloadsBySessionId?.[state.currentSessionId])
      ? state.rawSdkEventPayloadsBySessionId[state.currentSessionId]
      : [];
  const hasAnyRenderableConversation =
    state.messages.length > 0 ||
    Boolean(state.streaming?.isActive);
  const isAiStillResponding = isAssistantRespondingInCurrentSession(
    state.isProcessing,
    state.currentSessionId,
    state.processingSessionIds,
    Boolean(state.streaming?.isActive),
    state.assistantTurnPending,
    hasAnyRenderableConversation,
    centralizedSessionRawSdkEventPayloads,
  );
  const latestSessionStatusType = latestSessionStatusTypeFromCentralizedTape(
    centralizedSessionRawSdkEventPayloads,
  );

  // Check if we're switching to a different session (loading conversation)
  // Uses the new isLoadingSession state which is set during session switches
  // Note: We don't check if loadingSessionId === currentSessionId because during
  // the transition, currentSessionId hasn't been updated yet (timing issue)
  const isSwitchingSession = false;
  const isConnecting = false;

  const compatibilityWarningSignature = state.compatibilityWarnings
    .map((warning) => `${warning.component}:${warning.version ?? "unknown"}:${warning.status}:${warning.supportedRange}`)
    .join("|");
  useEffect(() => {
    if (!compatibilityWarningSignature) {
      setDismissedCompatibilityWarningSignature(null);
      return;
    }
    setDismissedCompatibilityWarningSignature((current) =>
      current === compatibilityWarningSignature ? current : null,
    );
  }, [compatibilityWarningSignature]);

  if (isConnecting) {
    return (
      <div className="oc-shell relative flex h-screen items-center justify-center overflow-hidden bg-oc-bg text-oc-text">
        <div className="flex flex-col items-center gap-4">
          <div className="flex gap-1.5">
            <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: '0s' }} />
            <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: '0.2s' }} />
            <div className="h-2 w-2 rounded-full bg-oc-accent animate-[pulse_1.4s_ease-in-out_infinite]" style={{ animationDelay: '0.4s' }} />
          </div>
          <div className="text-sm text-oc-text-soft opacity-70 font-medium">
            Connecting…
          </div>
        </div>
      </div>
    );
  }

  // Keep the loading bubble visible for the entire active assistant turn.
  // Live stream payloads can arrive before the final assistant message is
  // finalized, but the user still needs a clear "AI is responding" signal.
  const streamingSteps = state.streaming?.steps ?? [];
  const streamingProgressEvents = state.streaming?.progressEvents ?? [];
  const streamingEdits = state.streaming?.edits ?? [];
  const streamingInteractiveEvents = state.streaming?.interactiveEvents ?? [];
  const interactiveEvents = state.interactiveEvents ?? [];
  const hasAssistantText =
    !!state.streaming?.content &&
    state.streaming.content.trim().length > 0;
  const hasVisibleStreamingPayload = Boolean(
    state.streaming &&
      (state.streaming.content.trim().length > 0 ||
        state.streaming.reasoning.trim().length > 0 ||
        streamingSteps.length > 0 ||
        streamingProgressEvents.length > 0 ||
        streamingEdits.length > 0 ||
        streamingInteractiveEvents.length > 0 ||
        interactiveEvents.length > 0),
  );
  // Show AI response loading indicator (thinking bubble) when:
  // 1. NOT switching sessions (session loading takes precedence), AND
  // 2. AI is still responding and the assistant turn has not finalized yet.
  // FIXED: Use hasRenderableContent from SDK instead of checking content length
  const hasRenderableStreamingContent = Boolean(state.streaming?.hasRenderableContent);
  const showAiResponseLoading =
    !state.isLoadingSession && // Direct state check to avoid timing issues
    isAiStillResponding && // Keep loading affordance visible while the turn is active
    !state.isCompacting;

  // Enforce minimum display duration for loading state
  // This ensures users can perceive the loading indicator even when content arrives quickly
  const now = Date.now();
  const loadingElapsedTime = loadingStartTimeRef.current ? now - loadingStartTimeRef.current : 0;

  if (showAiResponseLoading && !loadingStartTimeRef.current) {
    // Loading state just started - record the timestamp
    loadingStartTimeRef.current = now;
  } else if (!showAiResponseLoading && loadingStartTimeRef.current) {
    // Loading state ended - reset the timestamp
    loadingStartTimeRef.current = null;
  }

  // Extend the loading state display time if content arrived too quickly
  const showExtendedLoading =
    showAiResponseLoading || // Normal loading state
    (loadingStartTimeRef.current && loadingElapsedTime < LOADING_MIN_DISPLAY_MS && isAiStillResponding); // Extended for minimum duration

  useEffect(() => {
    if (!state.streaming && interactiveEvents.length === 0 && !showExtendedLoading) {
      return;
    }

    logger.info("[TRACE][RENDER][CHAT_SHELL]", {
      sessionId: state.currentSessionId,
      streamingActive: !!state.streaming?.isActive,
      streamingMessageId: state.streaming?.messageId ?? null,
      streamingContentLength: state.streaming?.content?.length ?? 0,
      streamingReasoningLength: state.streaming?.reasoning?.length ?? 0,
      streamingSteps: state.streaming?.steps?.length ?? 0,
      streamingProgressEvents: state.streaming?.progressEvents?.length ?? 0,
      streamingInteractiveEvents: state.streaming?.interactiveEvents?.length ?? 0,
      interactiveEvents: interactiveEvents.length,
      hasRenderableStreamingContent,
      hasVisibleStreamingPayload,
      showAiResponseLoading,
      showExtendedLoading,
    });
    if (process.env.NODE_ENV === 'development') {
      console.info("[TRACE][RENDER][CHAT_SHELL]", {
        sessionId: state.currentSessionId,
        streamingActive: !!state.streaming?.isActive,
        streamingMessageId: state.streaming?.messageId ?? null,
        streamingContentLength: state.streaming?.content?.length ?? 0,
        streamingReasoningLength: state.streaming?.reasoning?.length ?? 0,
        streamingSteps: state.streaming?.steps?.length ?? 0,
        streamingProgressEvents: state.streaming?.progressEvents?.length ?? 0,
        streamingInteractiveEvents: state.streaming?.interactiveEvents?.length ?? 0,
        interactiveEvents: interactiveEvents.length,
        hasRenderableStreamingContent,
        hasVisibleStreamingPayload,
        showAiResponseLoading,
        showExtendedLoading,
      });
    }
  }, [
    state.currentSessionId,
    state.streaming,
    interactiveEvents.length,
    hasRenderableStreamingContent,
    hasVisibleStreamingPayload,
    showAiResponseLoading,
    showExtendedLoading,
  ]);

  // DEBUG: Log loading state calculation
  if (process.env.NODE_ENV === 'development' && (state.isProcessing || state.streaming?.isActive || showExtendedLoading)) {
    logger.info('[LOADING][RENDER] Loading state calculation', {
      isLoadingSession: state.isLoadingSession,
      isProcessing: state.isProcessing,
      currentSessionId: state.currentSessionId,
      processingSessionIds: state.processingSessionIds,
      isAiResponding,
      isCompacting: state.isCompacting,
      hasRenderableStreamingContent,
      hasAssistantText,
      streamingIsActive: state.streaming?.isActive,
      streamingContentLength: state.streaming?.content?.length || 0,
      streamingExists: !!state.streaming,
      streamingHasRenderableContent: state.streaming?.hasRenderableContent,
      showAiResponseLoading,
      showExtendedLoading,
      willShowThinkingBubble: showExtendedLoading,
      willShowStreamingCard: !!state.streaming && (hasRenderableStreamingContent || state.streaming?.isActive),
      loadingStartTime: loadingStartTimeRef.current,
      loadingElapsedTime,
      LOADING_MIN_DISPLAY_MS,
      sessionId: state.currentSessionId,
      timestamp: now,
      source: 'webview',
    });
  }

  const compactionDividerIndex =
    typeof state.compactionDividerIndex === "number"
      ? Math.max(
          0,
          Math.min(state.compactionDividerIndex, state.messages.length),
        )
      : undefined;
  const hasCompactedSegment =
    typeof compactionDividerIndex === "number" && compactionDividerIndex > 0;
  const isCompressed = hasCompactedSegment && state.compactedMessagesCollapsed;
  const hiddenMessageCount = isCompressed ? compactionDividerIndex : 0;
  const visibleStartIndex = isCompressed ? compactionDividerIndex : 0;
  const renderMessages = useMemo(
    () =>
      buildCentralizedRenderMessages(
        state.messages,
        centralizedSessionRawSdkEventPayloads,
      ),
    [centralizedSessionRawSdkEventPayloads, state.messages],
  );
  const hasCentralizedSessionDiffEntries = useMemo(
    () =>
      centralizedSessionRawSdkEventPayloads.some((payload) => {
        const event = asRecord(payload);
        return event && firstNonEmptyString(event.type) === "session.diff";
      }),
    [centralizedSessionRawSdkEventPayloads],
  );
  const conversationEntries = useMemo(
    () =>
      buildCentralizedConversationEntries(
        state.messages,
        centralizedSessionRawSdkEventPayloads,
      ),
    [centralizedSessionRawSdkEventPayloads, state.messages],
  );
  const visibleConversationEntries = useMemo(() => {
    let messageCount = 0;
    const visible: ConversationRenderEntry[] = [];

    for (const entry of conversationEntries) {
      if (!isCompressed || messageCount >= visibleStartIndex) {
        visible.push(entry);
      }
      if (entry.kind === "message") {
        messageCount += 1;
      }
    }

    return visible;
  }, [conversationEntries, isCompressed, visibleStartIndex]);
  const visibleMessages = useMemo(
    () =>
      visibleConversationEntries
        .filter((entry): entry is Extract<ConversationRenderEntry, { kind: "message" }> =>
          entry.kind === "message",
        )
        .map((entry) => entry.message),
    [visibleConversationEntries],
  );
  const hasTranscriptAssistantForCurrentTurn = useMemo(() => {
    let lastUserEntryIndex = -1;
    for (let index = 0; index < visibleConversationEntries.length; index += 1) {
      const entry = visibleConversationEntries[index];
      if (entry.kind !== "message") {
        continue;
      }
      const role = firstNonEmptyString(entry.message.role, entry.message.info?.role);
      if (role === "user") {
        lastUserEntryIndex = index;
      }
    }

    if (lastUserEntryIndex < 0) {
      return false;
    }

    for (let index = lastUserEntryIndex + 1; index < visibleConversationEntries.length; index += 1) {
      const entry = visibleConversationEntries[index];
      if (entry.kind !== "message") {
        continue;
      }
      const role = firstNonEmptyString(entry.message.role, entry.message.info?.role);
      if (role === "assistant") {
        return true;
      }
    }

    return false;
  }, [visibleConversationEntries]);
  const transcriptAssistantMessageIds = useMemo(
    () =>
      renderMessages
        .filter((message) => firstNonEmptyString(message.role, message.info?.role) === "assistant")
        .map((message) => getCanonicalMessageId(message))
        .filter((messageId): messageId is string => typeof messageId === "string" && messageId.length > 0),
    [renderMessages],
  );
  const hasCompatibilityWarnings = state.compatibilityWarnings.length > 0;
  const errorToasts = state.errorMessages;

  useEffect(() => {
    if (errorToasts.length > 0 && getGlobalShowBrowserConsole()) {
      console.log("ERROR_FLOW: Error messages in ChatShell", {
        timestamp: new Date().toISOString(),
        errorCount: errorToasts.length,
        errorMessages: errorToasts,
      });
    }
  }, [errorToasts]);

  const jumpToLatest = () => {
    setStreamViewport({ isFollowing: true, unseenUpdateCount: 0 });
    const root = messagesScrollRef.current;
    if (root) {
      root.scrollTop = root.scrollHeight;
    }
  };

  const getStableMessageKey = (msg: Message, absoluteIndex: number, role: string): string => {
    const infoId =
      typeof msg.info?.id === "string" && msg.info.id.trim().length > 0
        ? msg.info.id
        : null;
    if (infoId) {
      return infoId;
    }

    const topLevelId =
      typeof msg.id === "string" && msg.id.trim().length > 0 ? msg.id : null;
    if (topLevelId) {
      return topLevelId;
    }

    const createdAt =
      typeof msg.created === "number" && Number.isFinite(msg.created)
        ? msg.created
        : typeof msg.info?.created === "number" && Number.isFinite(msg.info.created)
          ? msg.info.created
          : null;

    return createdAt !== null
      ? `${role}:${createdAt}:${absoluteIndex}`
      : `${role}:idx:${absoluteIndex}`;
  };

  return (
    <div className="oc-shell relative flex h-screen overflow-hidden bg-oc-bg text-oc-text">
      {errorToasts.length > 0 ? (
        <div className="pointer-events-none absolute right-3 top-3 z-50 flex w-full max-w-sm flex-col gap-2.5">
          {errorToasts.map((message, index) => (
            (() => {
              const severity = getToastSeverity(message);
              const isWarning = severity === "warning";
              return (
                <div
                  key={`${index}:${message}`}
                  className={`pointer-events-auto overflow-hidden rounded-lg border shadow-[0_14px_36px_rgba(0,0,0,0.28)] backdrop-blur ${
                    isWarning
                      ? "border-yellow-500/40 bg-[rgba(64,44,18,0.92)]"
                      : "border-red-500/40 bg-[rgba(60,18,24,0.92)]"
                  }`}
                >
              <div className="flex items-start justify-between gap-2.5 px-3 py-2.5">
                <div className="min-w-0">
                  <div
                    className={`text-[10px] font-semibold uppercase tracking-[0.08em] ${
                      isWarning ? "text-yellow-300" : "text-red-300"
                    }`}
                  >
                    {isWarning ? "Warning" : "Error"}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap break-words text-[12.5px] leading-6 text-oc-text">
                    {message}
                  </div>
                </div>
                <button
                  type="button"
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-white/10 text-oc-text-soft transition-colors hover:bg-white/5 hover:text-oc-text"
                  aria-label="Dismiss error notification"
                  title="Dismiss error notification"
                  onClick={() =>
                    dispatch({ type: "REMOVE_ERROR_MESSAGE", payload: index })
                  }
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
                </div>
              );
            })()
          ))}
        </div>
      ) : null}

      {/* Raw centralized SDK toast events are rendered here so the UI stays driven by the same event tape. */}
      <CentralizedToastOverlay
        sessionId={state.currentSessionId}
        rawSdkEventPayloads={
          state.currentSessionId
            ? state.rawSdkEventPayloadsBySessionId?.[state.currentSessionId]
            : undefined
        }
      />

      {/* === LEFT: History sidebar overlay (hamburger-toggled, absolute positioned) === */}
      <HistorySidebar />

      {/* === MIDDLE: Main conversation column (flex-1, scrollable message list + input) === */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* FORBIDDEN TO REMOVE: StickyHeader (token/session stats) - core UX for token visibility */}
        <StickyHeader />

        {/* Mobile-only extended panel summary and collapsible details */}
        <MobileRightSummary />

        {/* Message list */}
        <div
          ref={messagesScrollRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2.5 py-2.5 sm:px-4"
          style={{ background: "var(--oc-chat-bg)" }}
        >
          {isSwitchingSession ? (
            <div className="flex h-full items-center justify-center">
              <SessionLoadingSpinner />
            </div>
          ) : (
            <>
              {hasCompatibilityWarnings &&
              dismissedCompatibilityWarningSignature !== compatibilityWarningSignature ? (
                <div className="mb-2.5 px-2.5">
                  <div className="rounded-xl border oc-warning-border oc-warning-bg p-3">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-oc-yellow">
                        OpenCode compatibility warning
                      </div>
                      <button
                        type="button"
                        className="flex h-6 w-6 items-center justify-center rounded-md border border-oc-border-soft text-oc-text-soft transition-colors hover:bg-white/5 hover:text-oc-text"
                        aria-label="Dismiss compatibility warning"
                        title="Dismiss compatibility warning"
                        onClick={() =>
                          setDismissedCompatibilityWarningSignature(
                            compatibilityWarningSignature,
                          )
                        }
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="space-y-2 text-sm leading-relaxed text-oc-text-soft opacity-90">
                      {state.compatibilityWarnings.map((warning) => (
                        <div
                          key={`${warning.component}:${warning.version ?? "unknown"}:${warning.status}`}
                          className="rounded-lg border border-oc-border-soft bg-black/10 px-3 py-2"
                        >
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-oc-yellow">
                              {warning.component === "sdk"
                                ? "OpenCode SDK"
                                : "OpenCode TUI"}
                            </div>
                            <div className="rounded-full border border-oc-border-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-oc-text-soft">
                              {warning.status}
                            </div>
                          </div>
                          <div className="space-y-0.5 text-[13px] leading-relaxed">
                            <div>
                              Detected: {warning.version ?? "unknown"}
                            </div>
                            <div>
                              Supported: {warning.supportedRange}
                            </div>
                            <div className="text-oc-text-soft opacity-80">
                              {warning.message}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {!hasAnyRenderableConversation &&
              !state.streaming &&
              !isAiResponding ? (
                <EmptyState
                  serverStatus={state.serverStatus}
                  receivedInitState={state.receivedInitState}
                  currentSessionId={state.currentSessionId}
                  messagesBySessionId={state.messagesBySessionId}
                />
              ) : null}

              {hasCompactedSegment && isCompressed ? (
                <CompactionDivider
                  at={state.lastCompactedAt}
                  collapsed={isCompressed}
                  hiddenMessageCount={hiddenMessageCount}
                  onToggle={() => {
                    const nextCollapsed = !state.compactedMessagesCollapsed;
                    dispatch({
                      type: "SET_COMPACTED_MESSAGES_COLLAPSED",
                      payload: nextCollapsed,
                    });
                    if (state.currentSessionId) {
                      vscode.postMessage({
                        type: "setCompactionViewState",
                        sessionId: state.currentSessionId,
                        collapsed: nextCollapsed,
                        compactionDividerIndex: state.compactionDividerIndex,
                        compactionDividerBeforeMessageId:
                          state.compactionDividerBeforeMessageId,
                        compactionDividerAfterMessageId:
                          state.compactionDividerAfterMessageId,
                        lastCompactedAt: state.lastCompactedAt,
                        baselineStats: state.compactionBaselineStats,
                      });
                    }
                  }}
                />
              ) : null}

          <CentralizedDebugPanel />

          {(() => {
            let messageCountSeen = 0;
            return visibleConversationEntries.map((entry) => {
              const dividerHere = !isCompressed && compactionDividerIndex === messageCountSeen;
              if (entry.kind === "message") {
                const msg = entry.message;
                const idx = entry.messageIndex;
                const role = msg.role ?? msg.info?.role ?? "user";
                const messageId = msg.info?.id ?? msg.id ?? msg.messageId ?? null;
                const prevIdx = idx - 1;
                const prevMsg =
                  prevIdx >= 0 ? renderMessages[prevIdx] : undefined;
                const isContiguous =
                  role === "assistant" &&
                  prevMsg?.role === "assistant" &&
                  (prevMsg.info?.agent === msg.info?.agent ||
                    (!prevMsg.info?.agent && !msg.info?.agent));
                const streamingMessageId = state.streaming?.messageId ?? null;
                const liveTurnMessageId =
                  state.assistantTurnMessageId ?? streamingMessageId;

                console.log('🔍 [MESSAGE_RENDERING] Checking if message should be hidden', {
                  messageId,
                  role,
                  streamingIsActive: Boolean(state.streaming?.isActive),
                  streamingMessageId,
                  liveTurnMessageId,
                  hasRawSdkEventPayloads: Array.isArray(msg.rawSdkEventPayloads),
                  rawSdkEventPayloadsCount: msg.rawSdkEventPayloads?.length || 0,
                  msgSubagents: Array.isArray(msg.subagents) ? msg.subagents.length : 'none'
                });

                /**
                 * Determine if this is a live streaming assistant turn that should be hidden.
                 *
                 * IMPORTANT: Assistant messages should ALWAYS be rendered during rehydration
                 * (when streaming is not active) to ensure subagents and other content are visible.
                 *
                 * The only time we hide an assistant message is during live streaming when
                 * we're showing streaming components instead of the final message.
                 *
                 * REHYDRATION DETECTION: If the message has rawSdkEventPayloads and completed
                 * processing state, it's from rehydration, not live streaming.
                 */
                const isFromRehydration = Array.isArray(msg.rawSdkEventPayloads) && msg.rawSdkEventPayloads.length > 0;
                const isLiveStreamingAssistantTurn =
                  !isFromRehydration && // Never hide messages during rehydration
                  Boolean(state.streaming?.isActive) &&
                  role === "assistant" &&
                  !!liveTurnMessageId &&
                  liveTurnMessageId === messageId;

                console.log('🔍 [MESSAGE_RENDERING] Live streaming decision', {
                  messageId,
                  role,
                  isFromRehydration,
                  isLiveStreamingAssistantTurn,
                  willHideMessage: isLiveStreamingAssistantTurn
                });

                let messageNode: JSX.Element | null;
                if (role === "user") {
                  messageNode = <UserMessage message={msg} />;
                } else if (role === "system") {
                  const systemAgentId =
                    msg.info?.agent ?? state.streaming?.agent ?? state.selectedAgent;

                  messageNode = (
                    <SystemMessage
                      content={msg.content ?? msg.text ?? ""}
                      accentColor={resolveAgentColor(systemAgentId)}
                    />
                  );
                } else if ((msg as Record<string, unknown>).type === "permission") {
                  messageNode = <PermissionCard perm={msg} />;
                } else {
                  messageNode = (
                    <ResponseMessage
                      message={msg}
                      isContiguous={isContiguous}
                      interactiveEvents={state.interactiveEvents}
                      messages={state.messages}
                      currentSessionId={state.currentSessionId}
                      hideFileChangesSection={hasCentralizedSessionDiffEntries}
                      subagentsByParentMessageId={state.subagentsByParentMessageId}
                      subagentDetailsById={state.subagentDetailsById}
                      availableAgents={state.availableAgents}
                      todoItems={state.todoItems}
                    />
                  );
                }

                /**
                 * CRITICAL: Don't hide assistant messages during rehydration!
                 *
                 * Assistant messages contain subagent cards and other important content.
                 * We only hide them during active live streaming to avoid duplicates with
                 * streaming components. During rehydration (streaming not active), we must
                 * render assistant messages so subagents and other content appear.
                 */
                if (isLiveStreamingAssistantTurn) {
                  console.log('🚫 [MESSAGE_RENDERING] HIDING message (live streaming assistant turn)', {
                    messageId,
                    role,
                    isFromRehydration,
                    isLiveStreamingAssistantTurn
                  });
                  messageNode = null;
                } else {
                  console.log('✅ [MESSAGE_RENDERING] SHOWING message', {
                    messageId,
                    role,
                    hasSubagents: Array.isArray(msg.subagents) && msg.subagents.length > 0,
                    subagentsCount: Array.isArray(msg.subagents) ? msg.subagents.length : 0
                  });
                }

                messageCountSeen += 1;

                return (
                  <Fragment key={entry.key}>
                    {dividerHere ? <CompactionDivider at={state.lastCompactedAt} /> : null}
                    {messageNode}
                  </Fragment>
                );
              }

              return (
                <Fragment key={entry.key}>
                  {dividerHere ? <CompactionDivider at={state.lastCompactedAt} /> : null}
                  <FileChangesSection
                    structuredFileChanges={[]}
                    centralizedDiffEvent={entry.diff}
                    sessionId={state.currentSessionId}
                  />
                </Fragment>
              );
            });
          })()}

          {!isCompressed && compactionDividerIndex === state.messages.length ? (
            <CompactionDivider at={state.lastCompactedAt} />
          ) : null}

          {/* Keep the live wrapper only until the centralized transcript owns the
              current assistant turn. After that, render a single assistant card
              from the transcript so activity and response content stay unified. */}
          {!hasTranscriptAssistantForCurrentTurn ? (
            <StreamingCard
              streaming={state.streaming}
              isContiguous={
                visibleMessages.length > 0 &&
                visibleMessages[visibleMessages.length - 1].role === "assistant"
              }
              interactiveEvents={state.interactiveEvents}
              assistantTurnMessageId={state.assistantTurnMessageId}
              transcriptAssistantMessageIds={transcriptAssistantMessageIds}
              hasTranscriptAssistantForCurrentTurn={hasTranscriptAssistantForCurrentTurn}
              currentSessionId={state.currentSessionId}
              subagentsByParentMessageId={state.subagentsByParentMessageId}
              subagentDetailsById={state.subagentDetailsById}
              availableAgents={state.availableAgents}
              todoItems={state.todoItems}
            />
          ) : null}

          {/* Single loading indicator pinned to the bottom of the chat. */}
          {showExtendedLoading ? (
            <ThinkingBubble statusType={latestSessionStatusType} />
          ) : null}

          {state.isCompacting ? (
            <div className="sticky bottom-3 z-20 mb-2 flex justify-center px-4 pointer-events-none">
              <div className="rounded-full border border-oc-accent bg-oc-panel px-3 py-1 text-[11px] font-medium text-oc-accent shadow-sm">
                Compacting conversation...
              </div>
            </div>
          ) : null}

          {!streamViewport.isFollowing &&
          streamViewport.unseenUpdateCount > 0 ? (
            <div className="sticky bottom-3 z-20 flex justify-end pr-2.5">
              <button
                type="button"
                onClick={jumpToLatest}
                className="oc-accent-soft-action rounded-md px-2.5 py-1.5 text-[11px] font-semibold shadow-sm transition-colors"
              >
                Jump to latest ({streamViewport.unseenUpdateCount})
              </button>
            </div>
          ) : null}

          <div ref={messagesEndRef} />
        </>
          )}
        </div>

        {/* Input area (queue panel is embedded inside InputWrapper) */}
        {!isSwitchingSession && <InputWrapper />}
      </div>

      {/* === RIGHT: Extended panel — desktop only (>= 1100px), contains stats/quota/tasks === */}
      <aside className="oc-right-panel hidden w-[368px] shrink-0 overflow-y-auto self-stretch border-l border-oc-border bg-oc-panel [@media(min-width:1100px)]:block">
        <ActiveTaskPanel />
        <QuotaMonitor />
        {/* TEMPORARY: Hidden during modularization; keep TodoPanel implementation intact for later re-enable. */}
        {false && <TodoPanel />}
        <McpPanel />
        <LspPanel />
        <SkillsPanel />
        <AgentsPanel />
        <SettingsPanel />
      </aside>

      {/* Skill Installer Modal */}
      <SkillInstallerModal
        isOpen={showSkillInstaller}
        onClose={() => setShowSkillInstaller(false)}
      />

      {/* Session Modal */}
      {state.isSessionModalOpen ? (
        <SessionModal
          isOpen={state.isSessionModalOpen}
          onClose={() => dispatch({ type: "SET_SESSION_MODAL_OPEN", payload: false })}
        />
      ) : null}

    </div>
  );
}

export default function ChatShell() {
  return (
    <AppProvider>
      <ChatContent />
      <style>{`
        .file-mention-chip {
          color: #60a5fa;
          font-weight: 700;
          cursor: pointer;
          text-decoration: underline;
          text-decoration-style: solid;
          text-decoration-color: #60a5fa;
          text-underline-offset: 2px;
          transition: all 0.2s ease;
        }

        .file-mention-chip:hover {
          color: #93c5fd;
          text-decoration-color: #93c5fd;
        }

        .file-mention-chip:active {
          color: #3b82f6;
        }
      `}</style>
    </AppProvider>
  );
}
