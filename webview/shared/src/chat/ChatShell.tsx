import { Fragment, memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Archive, X } from "lucide-react";

import { AppProvider, shallowEqual, useAppDispatch, useAppState } from "./lib/store";
import { perfProbe } from "./lib/streamingPerfProbe";
import {
  asString,
  createMessageHandler,
  extractSubagentsFromCentralizedEvents,
  getCentralizedEventInfo,
  getCentralizedEventPart,
  getCentralizedEventType,
  getMessageParentId,
  normalizeCentralizedEventPayloads,
  normalizeMessage,
  normalizeSubagentDetail,
} from "./lib/messageHandler";
import {
  isBackgroundTaskReminderMessage,
} from "./lib/backgroundTaskOwnership";
import {
  classifyCentralizedTranscriptMessage,
  isExplicitSystemTransportText,
} from "./lib/transcriptMessageClassification";
import type { TranscriptMessageRenderKind } from "./lib/transcriptMessageClassification";
import {
  isProcessingInCurrentSession,
  latestAssistantMessageIdFromCentralizedTape,
  computeQueuedUserMessageIndexes,
  shouldDeferComposerSendInCurrentSession,
} from "./lib/sessionProcessing";
import {
  getRepresentedPendingUserMessageIds,
  getVisiblePendingUserMessages,
  pendingUserMessageToMessage,
  PENDING_CURRENT_SESSION_KEY,
} from "./lib/pendingUserMessages";
import {
  buildMessageConversationEntries,
  countCanonicalMessagesAtOrBeforeRawIndex,
  getCollapsedConversationEntries,
} from "./lib/conversationProjection";
import { buildAssistantBlockPresentation } from "./lib/assistantBlockPresentation";
import { buildRenderBlocks } from "./lib/renderContract";
import vscode from "./lib/vscode";
import logger from "./lib/logger";
import { config } from "../config";

import {
  StickyHeader,
  HistorySidebar,
  MobileRightSummary,
  InputWrapper,
} from "./PanelComponents";
import { LiveEventBanner } from "./ToastOverlay";
import { StreamingCard } from "./StreamingComponents";
import {
  AIStatusTicker,
  BackgroundTaskReminderMessage,
  ResponseMessage,
  SdkEventDebugPanel,
  EmptyState,
  FileChangesSection,
  PermissionCard,
  SystemMessage,
  ThinkingBubble,
  UserMessage,
} from "./MessageComponents";
import { SkillInstallerModal } from "./SkillInstallerModal";
import { SessionModal } from "./components/SessionModal";
import type { AppState, CentralizedSessionDiffEvent, Message } from "./lib/types";

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

function extractSessionErrorMessage(value: unknown): string | undefined {
  const record = asRecord(value);
  const nestedError = asRecord(record?.error);
  const nestedErrorData = asRecord(nestedError?.data);
  return firstNonEmptyString(
    nestedErrorData?.message,
    nestedError?.message,
    record?.message,
    typeof record?.error === "string" ? record.error : undefined,
    record?.reason,
    record?.code,
  );
}

function isGenericSessionErrorMessage(message: string | undefined): boolean {
  const normalized = normalizeComparableText(message);
  if (!normalized) {
    return true;
  }
  return [
    "model did not produce structured output",
    "unexpected server error",
    "unknown error",
    "request failed",
    "operation failed",
  ].includes(normalized);
}

type CentralizedSessionErrorEvent = {
  id?: string;
  sessionId?: string;
  createdAt?: number;
  message: string;
  rawIndex: number;
  source: "session.error" | "error" | "message.updated";
};

function parseCentralizedSessionErrorEvent(
  payload: unknown,
  rawIndex: number,
): CentralizedSessionErrorEvent | null {
  const event = asRecord(payload);
  if (!event) return null;

  const eventType = getCentralizedEventType(event);
  if (
    eventType !== "session.error" &&
    eventType !== "error" &&
    eventType !== "message.updated"
  ) {
    return null;
  }

  const properties = asRecord(event.properties);
  const info = getCentralizedEventInfo(event);
  const syncData = asRecord(asRecord(event.syncEvent)?.data);
  const sessionId = firstNonEmptyString(
    properties?.sessionID,
    properties?.sessionId,
    syncData?.sessionID,
    syncData?.sessionId,
    event.sessionID,
    event.sessionId,
    info?.sessionID,
    info?.sessionId,
  );
  const createdAt =
    typeof properties?.time === "number"
      ? properties.time
      : typeof syncData?.time === "number"
        ? syncData.time
        : typeof event.time === "number"
          ? event.time
          : undefined;

  if (eventType === "session.error" || eventType === "error") {
    const message =
      extractSessionErrorMessage(properties) ??
      extractSessionErrorMessage(event) ??
      extractSessionErrorMessage(syncData);
    if (!message) return null;
    return {
      id: firstNonEmptyString(event.id, properties?.id, syncData?.id),
      sessionId,
      createdAt,
      message,
      rawIndex,
      source: eventType,
    };
  }

  const message = extractSessionErrorMessage(info);
  if (!message) return null;
  return {
    id: firstNonEmptyString(info?.id, info?.messageID, info?.messageId, event.id),
    sessionId,
    createdAt,
    message,
    rawIndex,
    source: "message.updated",
  };
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

function hasInjectedSystemPromptShape(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    /^\[[^\]]+\]/.test(normalized) ||
    /^<[^>]+>/.test(normalized) ||
    /^\/\*/.test(normalized)
  );
}

function splitInjectedSystemPromptFromUserText(raw: string): string {
  const sanitized = raw.trim();
  if (!sanitized) {
    return "";
  }
  const separatorMatch = sanitized.match(/(?:\r?\n)---(?:\r?\n)+/);
  if (!separatorMatch) {
    return sanitized;
  }
  const separatorIndex = sanitized.indexOf(separatorMatch[0]);
  if (separatorIndex <= 0) {
    return sanitized;
  }
  const systemText = sanitized.slice(0, separatorIndex).trim();
  const userText = sanitized.slice(separatorIndex + separatorMatch[0].length).trim();
  if (!systemText || !userText || !hasInjectedSystemPromptShape(systemText)) {
    return sanitized;
  }
  return userText;
}

function isSyntheticUserToolText(value: string): boolean {
  const normalized = normalizeComparableText(value);
  if (!normalized) {
    return false;
  }
  if (
    normalized.startsWith("called the ") &&
    normalized.includes(" tool with the following input:")
  ) {
    return true;
  }
  return value.includes("<path>") && value.includes("</path>") && value.includes("<content>");
}

function buildVisibleUserMessageText(
  rawText: string | undefined,
  parts: unknown[] | undefined,
): string {
  const visibleTexts = (parts ?? [])
    .map((part) => asRecord(part))
    .filter((part) => part?.synthetic !== true)
    .map((part) =>
      firstNonEmptyString(
        part?.message,
        part?.text,
        part?.content,
      ) ?? "",
    )
    .map((text) => splitInjectedSystemPromptFromUserText(text))
    .filter((text) => text.length > 0 && !isSyntheticUserToolText(text));

  if (visibleTexts.length === 0) {
    return splitInjectedSystemPromptFromUserText(rawText ?? "");
  }

  const dedupedTexts: string[] = [];
  for (const text of visibleTexts) {
    if (
      dedupedTexts.some(
        (existing) => normalizeComparableText(existing) === normalizeComparableText(text),
      )
    ) {
      continue;
    }
    dedupedTexts.push(text);
  }
  return dedupedTexts.join("\n\n").trim();
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

// TRACE logging disabled for performance
// function logBackgroundTaskReminderTrace(
//   stage: string,
//   payload: Record<string, unknown>,
// ): void {
//   logger.info(`[TRACE][BG_TASK_REMINDER][${stage}]`, payload);
//   if (process.env.NODE_ENV === "development") {
//     console.info(`[TRACE][BG_TASK_REMINDER][${stage}]`, payload);
//   }
// }
// NOOP placeholder to prevent breaking calls
const logBackgroundTaskReminderTrace = (_stage: string, _payload: Record<string, unknown>) => {
  // NOOP - logging disabled for performance
};

function getCanonicalMessageCreatedAt(message: Message): number {
  if (typeof message.created === "number") {
    return message.created;
  }
  if (typeof (message as { createdAt?: number }).createdAt === "number") {
    return (message as { createdAt?: number }).createdAt as number;
  }
  if (typeof message.info?.created === "number") {
    return message.info.created;
  }
  if (typeof (message.info as { createdAt?: number } | undefined)?.createdAt === "number") {
    return (message.info as { createdAt?: number }).createdAt as number;
  }
  if (typeof message.time?.created === "number") {
    return message.time.created;
  }
  if (typeof message.info?.time?.created === "number") {
    return message.info.time.created;
  }
  return 0;
}

type CentralizedAssistantTurnIndex = {
  assistantParentIdByMessageId: Map<string, string>;
  firstRawIndexByMessageId: Map<string, number>;
};

function getAssistantMessageIdBeforeRawIndex(
  rawSdkEventPayloads: unknown[],
  rawIndexExclusive: number,
): string | null {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return null;
  }

  for (
    let index = Math.min(rawIndexExclusive - 1, rawSdkEventPayloads.length - 1);
    index >= 0;
    index -= 1
  ) {
    const event = asRecord(rawSdkEventPayloads[index]);
    if (!event) {
      continue;
    }

    const properties = asRecord(event.properties);
    const info =
      asRecord(properties?.info) ??
      asRecord(event.info) ??
      getCentralizedEventInfo(event);
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

  return null;
}

/**
 * Canonical message identity for centralized transcript rendering.
 *
 * Do not remove `coalescedIds` from this lookup. Duplicate user echoes can be
 * collapsed into one visible bubble, but their assistant child and raw events
 * may still reference the duplicate id. Treating those duplicate ids as aliases
 * is what keeps finalized text, reasoning, tool calls, and subagents attached
 * to the visible message instead of disappearing after dedupe.
 */
function getMessageAndCoalescedIds(message: Message): string[] {
  const ids = [
    getCanonicalMessageId(message),
    ...(Array.isArray((message as any).coalescedIds) ? (message as any).coalescedIds : []),
  ];
  return Array.from(
    new Set(
      ids.filter((value): value is string =>
        typeof value === "string" && value.trim().length > 0,
      ),
    ),
  );
}

function getCentralizedAssistantParentId(
  message: Message,
  turnIndex: CentralizedAssistantTurnIndex,
  fallbackParentId?: string,
): string | undefined {
  // IMPORTANT: this is the one parent-id fallback chain for centralized
  // assistant turns. Keep render ordering, dedupe repair, subagent attachment,
  // and conversation pairing pointed here instead of adding local fallbacks.
  //
  // Centralized history can expose the same relationship through different
  // envelopes:
  // - live/normal events usually carry `message.info.parentID`
  // - hydrated sync events may only expose parent links through indexed
  //   `message.updated` records
  // - deduped messages may need to resolve parent links through a coalesced id
  //
  // If this chain is split again, the old bug returns: the first assistant block
  // can disappear and its reasoning/content can be rendered under the next user
  // message.
  return firstNonEmptyString(
    getMessageParentId(message),
    ...getMessageAndCoalescedIds(message).map((id) =>
      turnIndex.assistantParentIdByMessageId.get(id),
    ),
    fallbackParentId,
  );
}

function applyCentralizedAssistantTurnIdentity(
  message: Message,
  turnIndex: CentralizedAssistantTurnIndex,
  fallbackParentId?: string,
): Message {
  // normalizeMessage can rebuild `info` from mixed legacy/SDK shapes. Always
  // reapply the centralized parent link after normalization so the rendered
  // assistant remains wired to the user message that produced it.
  const parentId = getCentralizedAssistantParentId(message, turnIndex, fallbackParentId);
  if (!parentId) {
    return message;
  }
  return {
    ...message,
    info: {
      ...message.info,
      parentID: parentId,
    } as Message["info"],
  };
}

function getCentralizedPartMessageId(part: Record<string, unknown> | null): string | undefined {
  return firstNonEmptyString(part?.messageID, part?.messageId);
}

function getCentralizedEventCreatedAt(
  event: Record<string, unknown>,
  part: Record<string, unknown> | null,
): number | undefined {
  const properties = asRecord(event.properties);
  const info = getCentralizedEventInfo(event);
  const infoTime = asRecord(info?.time);
  return typeof properties?.time === "number"
    ? properties.time
    : typeof infoTime?.created === "number"
      ? (infoTime.created as number)
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
  rawSdkEventPayloads: unknown[],
  options: { alreadyNormalized?: boolean } = {},
): Message[] {
  // Normalize the centralized tape once so this conversation builder only
  // consumes one canonical event envelope regardless of whether the original
  // payload was a direct `properties.part` event or a sync-wrapped event.
  const normalizedRawSdkEventPayloads = options.alreadyNormalized
    ? rawSdkEventPayloads
    : normalizeCentralizedEventPayloads(rawSdkEventPayloads);
  if (normalizedRawSdkEventPayloads.length === 0) {
    return [];
  }
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
  const assistantDescriptorsById = new Map<string, {
    messageId: string;
    parentId?: string;
    createdAt?: number;
  }>();
  const assistantDescriptorIdsByParent = new Map<string, string[]>();
  const userDescriptors: Array<{
    messageId: string;
    text: string;
    createdAt?: number;
    rawIndex: number;
  }> = [];
  const systemDescriptors: Array<{
    messageId: string;
    text: string;
    createdAt?: number;
    rawIndex: number;
  }> = [];
  const pendingTextDescriptors: Array<{
    messageId: string;
    text: string;
    createdAt?: number;
    rawIndex: number;
  }> = [];
  const messageRolesById = new Map<string, string>();
  const assistantParentIdByMessageId = new Map<string, string>();
  const userMessageIds = new Set<string>();
  const systemMessageIds = new Set<string>();
  const rawEventsByMessageId = new Map<string, unknown[]>();
  const partsByMessageId = new Map<string, unknown[]>();
  const firstRawIndexByMessageId = new Map<string, number>();
  const createdAtByMessageId = new Map<string, number>();
  const rawIndexByEvent = new Map<unknown, number>();
  const coalescedIdsByMessageId = new Map<string, string[]>();
  const centralizedAssistantTurnIndex: CentralizedAssistantTurnIndex = {
    assistantParentIdByMessageId,
    firstRawIndexByMessageId,
  };
  const latestAssistantMessageId =
    latestAssistantMessageIdFromCentralizedTape(normalizedRawSdkEventPayloads);
  const isAbortLikeCentralizedSignal = (value: unknown): boolean => {
    const normalized = firstNonEmptyString(value)?.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return (
      normalized.includes("messageabortederror") ||
      normalized === "aborted" ||
      normalized.endsWith(": aborted") ||
      normalized.includes("aborterror")
    );
  };
  const isCentralizedAbortEvent = (event: unknown): boolean => {
    const eventRec = asRecord(event);
    if (!eventRec) {
      return false;
    }
    const eventType = getCentralizedEventType(eventRec);
    if (
      eventType !== "session.error" &&
      eventType !== "error" &&
      eventType !== "message.updated"
    ) {
      return false;
    }

    const properties = asRecord(eventRec.properties);
    const info = getCentralizedEventInfo(eventRec);
    const errorRec =
      asRecord(properties?.error) ??
      asRecord(eventRec.error) ??
      asRecord(info?.error);
    const errorData = asRecord(errorRec?.data);

    return (
      info?.aborted === true ||
      errorRec?.aborted === true ||
      isAbortLikeCentralizedSignal(errorRec?.name) ||
      isAbortLikeCentralizedSignal(errorRec?.message) ||
      isAbortLikeCentralizedSignal(errorData?.message) ||
      isAbortLikeCentralizedSignal(properties?.message) ||
      isAbortLikeCentralizedSignal(eventRec.message)
    );
  };
  const lastAbortRawIndex = (() => {
    for (
      let rawIndex = normalizedRawSdkEventPayloads.length - 1;
      rawIndex >= 0;
      rawIndex -= 1
    ) {
      if (isCentralizedAbortEvent(normalizedRawSdkEventPayloads[rawIndex])) {
        return rawIndex;
      }
    }
    return -1;
  })();
  const assistantMessageIdBeforeAbort =
    lastAbortRawIndex >= 0
      ? getAssistantMessageIdBeforeRawIndex(
          normalizedRawSdkEventPayloads,
          lastAbortRawIndex,
        )
      : null;
  const rememberAssistantDescriptor = (descriptor: {
    messageId: string;
    parentId?: string;
    createdAt?: number;
  }): void => {
    const existing = assistantDescriptorsById.get(descriptor.messageId);
    if (
      !existing ||
      (!existing.parentId && descriptor.parentId) ||
      (
        existing.parentId === descriptor.parentId &&
        typeof descriptor.createdAt === "number" &&
        (existing.createdAt ?? -Infinity) <= descriptor.createdAt
      )
    ) {
      assistantDescriptorsById.set(descriptor.messageId, descriptor);
    }

    const parentKey = descriptor.parentId || descriptor.messageId;
    const existingIds = assistantDescriptorIdsByParent.get(parentKey) ?? [];
    if (!existingIds.includes(descriptor.messageId)) {
      existingIds.push(descriptor.messageId);
      assistantDescriptorIdsByParent.set(parentKey, existingIds);
    }
  };

  for (let rawIndex = 0; rawIndex < normalizedRawSdkEventPayloads.length; rawIndex += 1) {
    const payload = normalizedRawSdkEventPayloads[rawIndex];
    const event = asRecord(payload);
    if (!event) {
      continue;
    }
    rawIndexByEvent.set(event, rawIndex);
    const eventPart = getCentralizedEventPart(event);
    const eventMessageId = getCentralizedEventMessageId(event, eventPart);
    if (eventMessageId) {
      const existing = rawEventsByMessageId.get(eventMessageId) ?? [];
      existing.push(event);
      rawEventsByMessageId.set(eventMessageId, existing);
      if (!firstRawIndexByMessageId.has(eventMessageId)) {
        firstRawIndexByMessageId.set(eventMessageId, rawIndex);
      }
      const eventCreatedAt = getCentralizedEventCreatedAt(event, eventPart);
      if (typeof eventCreatedAt === "number") {
        const existingCreatedAt = createdAtByMessageId.get(eventMessageId);
        if (
          typeof existingCreatedAt !== "number" ||
          eventCreatedAt < existingCreatedAt
        ) {
          createdAtByMessageId.set(eventMessageId, eventCreatedAt);
        }
      }
    }

    if (getCentralizedEventType(event) === "message.updated") {
      const info = getCentralizedEventInfo(event);
      const role = firstNonEmptyString(info?.role)?.toLowerCase();
      const messageId = firstNonEmptyString(info?.id, info?.messageID, info?.messageId);
      if (messageId && role) {
        messageRolesById.set(messageId, role);
        if (role === "user") {
          userMessageIds.add(messageId);
        }
        if (role === "system") {
          systemMessageIds.add(messageId);
        }
      }
      if (role !== "assistant") {
        continue;
      }
      const assistantId = messageId;
      const parentId = firstNonEmptyString(info?.parentID, info?.parentId);
      if (parentId) {
        assistantParentIds.add(parentId);
        if (assistantId) {
          assistantParentIdByMessageId.set(assistantId, parentId);
        }
        userMessageIds.add(parentId);
      }
      if (!assistantId) {
        continue;
      }

      assistantMessageIds.add(assistantId);
      const createdAt =
        typeof asRecord(info?.time)?.created === "number"
          ? (asRecord(info?.time)?.created as number)
          : undefined;
      rememberAssistantDescriptor({
        messageId: assistantId,
        parentId: parentId || undefined,
        createdAt,
      });
      continue;
    }

    if (getCentralizedEventType(event) !== "message.part.updated") {
      continue;
    }
    const part = eventPart;
    const messageId = getCentralizedPartMessageId(part);

    // Register role from the part event's info if we haven't already. Some
    // system messages arrive via message.part.updated without a matching
    // message.updated event (or with mismatched IDs), causing them to default
    // to "user" and render as right-aligned user bubbles instead of full-width
    // system cards.
    if (messageId && !messageRolesById.has(messageId)) {
      const partEventInfo = getCentralizedEventInfo(event);
      const partEventRole = firstNonEmptyString(partEventInfo?.role)?.toLowerCase();
      if (partEventRole) {
        messageRolesById.set(messageId, partEventRole);
        if (partEventRole === "user") {
          userMessageIds.add(messageId);
        }
        if (partEventRole === "system") {
          systemMessageIds.add(messageId);
        }
      }
    }

    // A tape containing only text parts has no definitive assistant boundary,
    // so latestAssistantMessageIdFromCentralizedTape may use its last-text
    // fallback. Do not let that fallback claim transport system prompts such
    // as `[search-mode]` before they reach the system-message classifier.
    const isStandaloneSystemTextPart =
      firstNonEmptyString(part?.type)?.toLowerCase() === "text" &&
        isExplicitSystemTransportText(
        firstNonEmptyString(part?.text, part?.content) ?? "",
      );

    // OpenCode transports mode directives as user-role messages, even though
    // they are server-authored context. The explicit `[search-mode]` / tag
    // shape is more specific than that transport role, so retain it as a
    // system message for this messageID. Without this override a matching
    // message.updated event makes the directive disappear from SystemMessage
    // rendering (or turn into a right-aligned user bubble).
    if (messageId && isStandaloneSystemTextPart) {
      systemMessageIds.add(messageId);
      messageRolesById.set(messageId, "system");
      userMessageIds.delete(messageId);
    }
    const isAssistantOwnedPart =
      !isStandaloneSystemTextPart &&
      messageId &&
      isAssistantOwnedCentralizedPartEvent(
        event,
        part,
        assistantMessageIds,
        latestAssistantMessageId,
      );
    if (messageId) {
      const existingParts = partsByMessageId.get(messageId) ?? [];
      existingParts.push(part);
      partsByMessageId.set(messageId, existingParts);
    }

    if (isAssistantOwnedPart) {
      assistantMessageIds.add(messageId);
      const parentId = firstNonEmptyString(
        assistantParentIdByMessageId.get(messageId),
      );
      if (parentId) {
        assistantParentIds.add(parentId);
        assistantParentIdByMessageId.set(messageId, parentId);
        userMessageIds.add(parentId);
      }
      const createdAt = getCentralizedEventCreatedAt(event, part);
      rememberAssistantDescriptor({
        messageId,
        parentId: parentId || undefined,
        createdAt,
      });
      continue;
    }

    if (firstNonEmptyString(part?.type)?.toLowerCase() !== "text") {
      continue;
    }
    const text = firstNonEmptyString(part?.text, part?.content);

    if (!messageId || !text) {
      continue;
    }

    pendingTextDescriptors.push({
      messageId,
      text,
      createdAt:
        getCentralizedEventCreatedAt(event, part) ??
        createdAtByMessageId.get(messageId),
      rawIndex,
    });
  }

  for (const descriptor of pendingTextDescriptors) {
    const centralizedRole = messageRolesById.get(descriptor.messageId);
    const isKnownSystemMessage =
      systemMessageIds.has(descriptor.messageId) ||
      centralizedRole === "system";
    const isKnownUserMessage =
      userMessageIds.has(descriptor.messageId) ||
      centralizedRole === "user";
    if (isKnownSystemMessage) {
      if (!systemDescriptors.some((entry) => entry.messageId === descriptor.messageId)) {
        systemDescriptors.push(descriptor);
      }
      continue;
    }
    if (
      !isKnownUserMessage &&
      centralizedRole !== "assistant" &&
      !assistantMessageIds.has(descriptor.messageId) &&
      isExplicitSystemTransportText(descriptor.text)
    ) {
      if (!systemDescriptors.some((entry) => entry.messageId === descriptor.messageId)) {
        systemDescriptors.push(descriptor);
      }
      continue;
    }
    const isUserOwnedTextPart =
      isKnownUserMessage ||
      (!assistantMessageIds.has(descriptor.messageId) && centralizedRole !== "assistant");

    if (
      !isUserOwnedTextPart ||
      userDescriptors.some((entry) => entry.messageId === descriptor.messageId)
    ) {
      continue;
    }

    userDescriptors.push(descriptor);
  }

  const seenMessageIds = new Set<string>();
  const canonicalUserIdByDuplicateId = new Map<string, string>();
  const canonicalAssistantIdByDuplicateId = new Map<string, string>();
  const userDescriptorsByText = new Map<string, typeof userDescriptors>();

  // Deduplication in this renderer is aliasing, not deletion.
  //
  // The centralized tape can contain duplicate user text parts for one visible
  // turn. Some follow-up records, however, are still keyed to the duplicate user
  // or duplicate assistant id. When we collapse the duplicate bubble, we must
  // keep those ids in `coalescedIdsByMessageId` so later lookups can still find
  // raw events, reasoning parts, finalized text, token metadata, and subagents.
  const addCoalescedId = (canonicalId: string | undefined, duplicateId: string | undefined): void => {
    if (!canonicalId || !duplicateId || canonicalId === duplicateId) {
      return;
    }
    const existing = coalescedIdsByMessageId.get(canonicalId) ?? [];
    if (!existing.includes(duplicateId)) {
      existing.push(duplicateId);
      coalescedIdsByMessageId.set(canonicalId, existing);
    }
  };

  const getMessageAndCoalescedIdsForId = (messageId: string | undefined): string[] => {
    if (!messageId) {
      return [];
    }
    return Array.from(new Set([messageId, ...(coalescedIdsByMessageId.get(messageId) ?? [])]));
  };

  // Read centralized payloads through canonical + coalesced ids. This is the
  // guard that prevents data wired to a deduped-away id from vanishing in the UI.
  const getRawEventsForMessageId = (messageId: string | undefined): unknown[] => {
    return getMessageAndCoalescedIdsForId(messageId)
      .flatMap((id) => rawEventsByMessageId.get(id) ?? [])
      .sort((left, right) => {
        const leftIndex = rawIndexByEvent.get(left) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = rawIndexByEvent.get(right) ?? Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
      });
  };

  const getPartsForMessageId = (messageId: string | undefined): unknown[] => {
    return getMessageAndCoalescedIdsForId(messageId)
      .flatMap((id) => partsByMessageId.get(id) ?? []);
  };

  // Group only exact normalized user text duplicates. If this becomes broader
  // than text equality, unrelated turns can be merged and assistant blocks will
  // drift to the wrong user message.
  for (const descriptor of userDescriptors) {
    const textKey = normalizeComparableText(descriptor.text);
    if (!textKey) {
      continue;
    }
    const group = userDescriptorsByText.get(textKey) ?? [];
    group.push(descriptor);
    userDescriptorsByText.set(textKey, group);
  }

  for (const duplicateGroup of userDescriptorsByText.values()) {
    if (duplicateGroup.length < 2) {
      continue;
    }

    // Split exact text matches by timestamp to avoid merging completely distinct
    // turns (e.g. typing "continue" twice separated by minutes). Optimistic
    // echoes and sync re-hydrations will have identical or very close timestamps.
    const clusters: Array<typeof duplicateGroup> = [];
    for (const descriptor of duplicateGroup) {
      let matchedCluster = false;
      for (const cluster of clusters) {
        const cCreatedAt = cluster[0].createdAt;
        if (typeof cCreatedAt === "number" && typeof descriptor.createdAt === "number") {
          if (Math.abs(cCreatedAt - descriptor.createdAt) < 5000) {
            cluster.push(descriptor);
            matchedCluster = true;
            break;
          }
        } else {
          // Fallback for edge cases missing timestamps
          cluster.push(descriptor);
          matchedCluster = true;
          break;
        }
      }
      if (!matchedCluster) {
        clusters.push([descriptor]);
      }
    }

    for (const cluster of clusters) {
      if (cluster.length < 2) {
        continue;
      }
      // Prefer the latest duplicate as the visible canonical bubble because the
      // centralized tape often emits the final, fully wired user/assistant pair
      // after an earlier optimistic echo. Older ids are retained as aliases.
      const canonical = [...cluster].sort((left, right) => {
        const leftCreated = typeof left.createdAt === "number" ? left.createdAt : left.rawIndex;
        const rightCreated = typeof right.createdAt === "number" ? right.createdAt : right.rawIndex;
        if (leftCreated !== rightCreated) {
          return rightCreated - leftCreated;
        }
        return right.rawIndex - left.rawIndex;
      })[0];
      const canonicalAssistantIds =
        assistantDescriptorIdsByParent.get(canonical.messageId) ?? [];
      for (const duplicate of cluster) {
        if (duplicate.messageId === canonical.messageId) {
          continue;
        }
        canonicalUserIdByDuplicateId.set(duplicate.messageId, canonical.messageId);
        addCoalescedId(canonical.messageId, duplicate.messageId);

        const duplicateAssistantIds =
          assistantDescriptorIdsByParent.get(duplicate.messageId) ?? [];
        if (canonicalAssistantIds.length > 0 && duplicateAssistantIds.length > 0) {
          duplicateAssistantIds.forEach((duplicateAssistantId, index) => {
            const canonicalAssistantId =
              canonicalAssistantIds[Math.min(index, canonicalAssistantIds.length - 1)];
            if (!canonicalAssistantId) {
              return;
            }
            canonicalAssistantIdByDuplicateId.set(
              duplicateAssistantId,
              canonicalAssistantId,
            );
            addCoalescedId(canonicalAssistantId, duplicateAssistantId);
          });
        }
      }
    }
  }

  const preferredAssistantDescriptorById = new Map<string, {
    messageId: string;
    parentId?: string;
    createdAt?: number;
  }>();
  for (const descriptor of assistantDescriptorsById.values()) {
    const existing = preferredAssistantDescriptorById.get(descriptor.messageId);
    if (
      !existing ||
      (!existing.parentId && descriptor.parentId) ||
      (
        existing.parentId === descriptor.parentId &&
        typeof descriptor.createdAt === "number" &&
        (existing.createdAt ?? -Infinity) <= descriptor.createdAt
      )
    ) {
      preferredAssistantDescriptorById.set(descriptor.messageId, descriptor);
    }
  }

  for (const descriptor of preferredAssistantDescriptorById.values()) {
    if (
      canonicalAssistantIdByDuplicateId.has(descriptor.messageId) ||
      assistantParentIds.has(descriptor.messageId) ||
      seenMessageIds.has(descriptor.messageId)
    ) {
      continue;
    }
    seenMessageIds.add(descriptor.messageId);

    const collectedParts = getPartsForMessageId(descriptor.messageId);
    const rawSdkEventPayloads = getRawEventsForMessageId(descriptor.messageId);

    const rawAssistantMessage = {
      id: descriptor.messageId,
      role: "assistant",
      info: {
        id: descriptor.messageId,
        role: "assistant",
        created: descriptor.createdAt,
        createdAt: descriptor.createdAt,
        time:
          typeof descriptor.createdAt === "number"
            ? { created: descriptor.createdAt }
            : undefined,
        parentID: descriptor.parentId,
      },
      coalescedIds: coalescedIdsByMessageId.get(descriptor.messageId) ?? undefined,
      created: descriptor.createdAt,
      createdAt: descriptor.createdAt,
      time:
        typeof descriptor.createdAt === "number"
          ? { created: descriptor.createdAt }
          : undefined,
      parts: collectedParts.length > 0 ? collectedParts : undefined,
      rawSdkEventPayloads,
    } as Message;

    const normalized = applyCentralizedAssistantTurnIdentity(
      normalizeMessage(rawAssistantMessage, null) ?? rawAssistantMessage,
      centralizedAssistantTurnIndex,
      descriptor.parentId,
    );
    const hasMessageScopedAbortSignal = rawSdkEventPayloads.some((event) =>
      isCentralizedAbortEvent(event),
    );
    const isLatestAssistantTurnAbortedBySessionError =
      descriptor.messageId ===
        (assistantMessageIdBeforeAbort || latestAssistantMessageId) &&
      lastAbortRawIndex >= 0 &&
      (firstRawIndexByMessageId.get(descriptor.messageId) ?? Number.MAX_SAFE_INTEGER) <=
        lastAbortRawIndex;
    if (hasMessageScopedAbortSignal || isLatestAssistantTurnAbortedBySessionError) {
      normalized.aborted = true;
      normalized.interactiveEvents = [];
      // Preserve the centralized terminal raw index on the assistant message,
      // but do NOT use it to move the assistant card itself. The response block
      // still belongs at its canonical turn position (after the user prompt that
      // created it). This metadata only exists so the projection layer can emit
      // a separate late interruption marker when the abort row lands after newer
      // visible transcript content.
      (normalized as Record<string, unknown>).terminalRawIndex =
        hasMessageScopedAbortSignal
          ? Math.max(
              ...rawSdkEventPayloads
                .map((event) => rawIndexByEvent.get(event))
                .filter((index): index is number => typeof index === "number"),
            )
          : lastAbortRawIndex;
      normalized.info = {
        ...(normalized.info || {}),
        aborted: true,
        interruptedPresentation: "inline",
        terminalRawIndex:
          hasMessageScopedAbortSignal
            ? Math.max(
                ...rawSdkEventPayloads
                  .map((event) => rawIndexByEvent.get(event))
                  .filter((index): index is number => typeof index === "number"),
              )
            : lastAbortRawIndex,
      };
      normalized.interruptedPresentation = "inline";
    }
    merged.push(normalized);
  }

  for (const descriptor of userDescriptors) {
    if (
      canonicalUserIdByDuplicateId.has(descriptor.messageId) ||
      seenMessageIds.has(descriptor.messageId)
    ) {
      continue;
    }
    seenMessageIds.add(descriptor.messageId);

    const userParts = getPartsForMessageId(descriptor.messageId);
    const visibleUserText = buildVisibleUserMessageText(descriptor.text, userParts);

    merged.push({
      id: descriptor.messageId,
      role: "user",
      content: visibleUserText,
      text: visibleUserText,
      info: {
        id: descriptor.messageId,
        role: "user",
        created: descriptor.createdAt,
        createdAt: descriptor.createdAt,
        time:
          typeof descriptor.createdAt === "number"
            ? { created: descriptor.createdAt }
            : undefined,
      },
      coalescedIds: coalescedIdsByMessageId.get(descriptor.messageId) ?? undefined,
      created: descriptor.createdAt,
      createdAt: descriptor.createdAt,
      parts: userParts,
      rawSdkEventPayloads: getRawEventsForMessageId(descriptor.messageId),
    } as Message);
  }

  for (const descriptor of systemDescriptors) {
    if (seenMessageIds.has(descriptor.messageId)) {
      continue;
    }
    seenMessageIds.add(descriptor.messageId);

    merged.push({
      id: descriptor.messageId,
      role: "system",
      content: descriptor.text,
      text: descriptor.text,
      info: {
        id: descriptor.messageId,
        role: "system",
        created: descriptor.createdAt,
        createdAt: descriptor.createdAt,
        time:
          typeof descriptor.createdAt === "number"
            ? { created: descriptor.createdAt }
            : undefined,
      },
      created: descriptor.createdAt,
      createdAt: descriptor.createdAt,
      parts: getPartsForMessageId(descriptor.messageId),
      rawSdkEventPayloads: getRawEventsForMessageId(descriptor.messageId),
    } as Message);
  }

  // IMPORTANT: stop here. Do not append leftover `messages` that never appeared
  // in the centralized tape. Session hydration can load chatHistory faster than
  // rawSdkEventPayloads, and any final fallback here recreates the bug where
  // non-centralized user/assistant/system messages paint before the tape does.

  const sorted = merged.sort((left, right) => {
    const leftCreated = getCanonicalMessageCreatedAt(left);
    const rightCreated = getCanonicalMessageCreatedAt(right);
    if (leftCreated !== rightCreated) {
      return leftCreated - rightCreated;
    }

    const leftId = firstNonEmptyString(left.info?.id, left.id, left.messageId) ?? "";
    const rightId = firstNonEmptyString(right.info?.id, right.id, right.messageId) ?? "";
    const rawIndexForMessage = (messageId: string): number =>
      firstRawIndexByMessageId.get(messageId) ?? Number.MAX_SAFE_INTEGER;
    const orderForMessage = (message: Message, messageId: string): number => {
      const role = firstNonEmptyString(message.role, message.info?.role)?.toLowerCase();
      if (role === "assistant") {
        const parentId = getCentralizedAssistantParentId(message, centralizedAssistantTurnIndex);
        if (parentId) {
          const parentRaw = firstRawIndexByMessageId.get(parentId);
          if (typeof parentRaw === "number") {
            return parentRaw + 0.5;
          }
        }
      }
      return firstRawIndexByMessageId.get(messageId) ?? Number.MAX_SAFE_INTEGER;
    };
    const leftOrder = orderForMessage(left, leftId);
    const rightOrder = orderForMessage(right, rightId);
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    const leftRawIndex = rawIndexForMessage(leftId);
    const rightRawIndex = rawIndexForMessage(rightId);
    if (leftRawIndex !== rightRawIndex) {
      return leftRawIndex - rightRawIndex;
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

    // Attach the card to the assistant response that emitted the tool part.
    const { detailsById } = extractSubagentsFromCentralizedEvents(messageEvents, messageId);

    // Convert details to subagent format
    const subagents = Object.values(detailsById).map(detail => normalizeSubagentDetail(detail));

    // Only add subagents array if we found any
    if (subagents.length === 0) {
      return message;
    }

    return {
      ...message,
      subagents,
    } as Message;
  });

  // The centralized tape already gives us the exact assistant sibling phases
  // for one user turn (question tool phase, answer continuation, etc.). Do not
  // collapse adjacent assistant messages here or we lose the raw ordering and
  // recreate the bug where the later text answer jumps above the earlier
  // question phase.
  return messagesWithSubagents;
}

type ConversationRenderEntry =
  | {
      kind: "message";
      key: string;
      message: Message;
      messageIndex: number;
      order: number;
      renderKind: TranscriptMessageRenderKind;
    }
  | {
      kind: "session.diff";
      key: string;
      diff: CentralizedSessionDiffEvent;
      order: number;
    }
  | {
      kind: "fileChanges";
      key: string;
      message: Message;
      ownerMessageId: string;
      order: number;
    }
  | {
      kind: "assistant.abort";
      key: string;
      messageId?: string;
      order: number;
    }
  | {
      kind: "session.error";
      key: string;
      error: CentralizedSessionErrorEvent;
      order: number;
    };

type CentralizedTranscriptProjection = {
  renderMessages: Message[];
  conversationEntries: ConversationRenderEntry[];
};

/**
 * Extract file-change diffs from centralized tape events.  Handles both
 * live SSE events (type:"session.diff" / "message.updated") and hydrated
 * sync-wrapped events (type:"sync" → syncEvent.data.info).  Uses the
 * centralized helpers getCentralizedEventType / getCentralizedEventInfo
 * so callers never need to unwrap sync envelopes themselves.
 *
 * For message.updated events the diffs live at info.summary.diffs —
 * these are emitted by the server when an assistant turn produces file
 * changes and are persisted into the centralized tape for every session.
 */
function parseCentralizedSessionDiffEvent(
  payload: unknown,
  rawIndex: number,
): CentralizedSessionDiffEvent | null {
  const event = asRecord(payload);
  if (!event) return null;

  const eventType = getCentralizedEventType(event);
  const properties = asRecord(event.properties);
  const info = getCentralizedEventInfo(event);
  const syncData = asRecord(asRecord(event.syncEvent)?.data);

  const resolveSessionId = () =>
    firstNonEmptyString(
      properties?.sessionID, properties?.sessionId,
      syncData?.sessionID, syncData?.sessionId,
      event.sessionId, event.sessionID,
    );

  if (eventType === "session.diff") {
    const rawDiffs = Array.isArray(properties?.diff)
      ? properties.diff
      : Array.isArray(event.diff)
        ? event.diff
        : Array.isArray(syncData?.diff)
          ? syncData.diff
          : [];
    const files = rawDiffs
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => !!item)
      .map((item) => ({
        file: firstNonEmptyString(item.file) ?? "",
        patch: firstNonEmptyString(item.patch),
        additions: typeof item.additions === "number" ? item.additions : typeof item.additions === "string" ? Number(item.additions) : undefined,
        deletions: typeof item.deletions === "number" ? item.deletions : typeof item.deletions === "string" ? Number(item.deletions) : undefined,
        status: firstNonEmptyString(item.status),
      }))
      .filter((item) => item.file.length > 0);
    if (files.length === 0) return null;
    const eventTime = typeof properties?.time === "number" ? properties.time : typeof syncData?.time === "number" ? syncData.time : typeof event.time === "number" ? event.time : undefined;
    // session.diff events don't always carry a message ID, but when they do
    // (e.g. inside properties or syncData), preserve it so the undo button
    // can target the exact message that owns these file changes.
    const diffMessageId = firstNonEmptyString(
      properties?.messageID,
      properties?.messageId,
      syncData?.messageID,
      syncData?.messageId,
      info?.id,
    );
    return { id: firstNonEmptyString(event.id), sessionId: resolveSessionId(), messageId: diffMessageId, createdAt: eventTime, files };
  }

  if (eventType === "message.updated") {
    const summary = asRecord(info?.summary);
    const diffs = summary?.diffs;
    if (!Array.isArray(diffs) || diffs.length === 0) return null;
    const files = diffs
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => !!item)
      .map((item) => ({
        file: firstNonEmptyString(item.file) ?? "",
        patch: firstNonEmptyString(item.patch),
        additions: typeof item.additions === "number" ? item.additions : typeof item.additions === "string" ? Number(item.additions) : undefined,
        deletions: typeof item.deletions === "number" ? item.deletions : typeof item.deletions === "string" ? Number(item.deletions) : undefined,
        status: firstNonEmptyString(item.status),
      }))
      .filter((item) => item.file.length > 0);
    if (files.length === 0) return null;
    const updatedMessageId = firstNonEmptyString(
      info?.id,
      properties?.id,
      properties?.messageID,
      syncData?.id,
      syncData?.messageID,
    );
    return { id: firstNonEmptyString(event.id), sessionId: resolveSessionId(), messageId: updatedMessageId, createdAt: undefined, files };
  }

  return null;
}

function buildCentralizedSessionDiffFingerprint(
  diff: CentralizedSessionDiffEvent,
): string {
  const fileFingerprint = (Array.isArray(diff.files) ? diff.files : [])
    .map((file) => ({
      file: normalizeComparableText(file.file),
      patch: normalizeComparableText(file.patch),
      additions:
        typeof file.additions === "number" && Number.isFinite(file.additions)
          ? file.additions
          : 0,
      deletions:
        typeof file.deletions === "number" && Number.isFinite(file.deletions)
          ? file.deletions
          : 0,
      status: normalizeComparableText(file.status),
    }))
    .sort((left, right) => left.file.localeCompare(right.file));

  return JSON.stringify({
    sessionId: firstNonEmptyString(diff.sessionId),
    files: fileFingerprint,
  });
}

export function buildCentralizedConversationEntries(
  rawSdkEventPayloads: unknown[],
): ConversationRenderEntry[] {
  return buildCentralizedTranscriptProjection(rawSdkEventPayloads)
    .conversationEntries;
}

function buildCentralizedTranscriptProjection(
  rawSdkEventPayloads: unknown[],
): CentralizedTranscriptProjection {
  const normalizedRawSdkEventPayloads = normalizeCentralizedEventPayloads(rawSdkEventPayloads);
  const renderMessages = buildCentralizedRenderMessages(
    normalizedRawSdkEventPayloads,
    { alreadyNormalized: true },
  );
  const firstRawIndexByMessageId = new Map<string, number>();
  const conversationEntries: ConversationRenderEntry[] = [];

  // Projection should not invent a second ordering system. The canonical
  // centralized render-message builder already resolved duplicate ids and
  // produced transcript order. This layer only records each message's earliest
  // raw tape index so non-message cards can be inserted relative to that single
  // canonical order.
  for (let rawIndex = 0; rawIndex < normalizedRawSdkEventPayloads.length; rawIndex += 1) {
    const event = asRecord(normalizedRawSdkEventPayloads[rawIndex]);
    if (!event) {
      continue;
    }
    const info = getCentralizedEventInfo(event);
    const part = getCentralizedEventPart(event);
    const messageId = firstNonEmptyString(
      info?.id,
      info?.messageID,
      info?.messageId,
      part?.messageID,
      part?.messageId,
    );
    if (messageId && !firstRawIndexByMessageId.has(messageId)) {
      firstRawIndexByMessageId.set(messageId, rawIndex);
    }
  }

  const getRawOrderForMessage = (message: Message): number => {
    const rawIndexes = getMessageAndCoalescedIds(message)
      .map((messageId) => firstRawIndexByMessageId.get(messageId))
      .filter((value): value is number => typeof value === "number");
    return rawIndexes.length > 0 ? Math.min(...rawIndexes) : Number.MAX_SAFE_INTEGER;
  };

  const renderMessageEntries = renderMessages.map((message, index) => ({
    message,
    index,
    ids: getMessageAndCoalescedIds(message),
    rawOrder: getRawOrderForMessage(message),
    role: firstNonEmptyString(message.role, message.info?.role)?.toLowerCase() ?? "",
    renderKind: classifyCentralizedTranscriptMessage({
      message,
      rawSdkEventPayloads: normalizedRawSdkEventPayloads,
      messages: renderMessages,
    }),
  }));
  const getTerminalRawIndex = (message: Message): number | undefined => {
    return typeof message.terminalRawIndex === "number"
      ? message.terminalRawIndex
      : typeof message.info?.terminalRawIndex === "number"
        ? message.info.terminalRawIndex
        : undefined;
  };

  const getConversationOrderAfterRawIndex = (
    rawIndex: number,
    offset: number,
  ): number => {
    // IMPORTANT:
    // Non-message transcript rows (session.error, session.diff, detached abort)
    // must anchor against the *visible* canonical transcript, not against raw
    // centralized message count or hidden assistant placeholders.
    //
    // Example failure mode this prevents:
    // - user message
    // - hidden assistant placeholder with no renderable bubble yet
    // - session.error
    // - next user message
    //
    // If we count the hidden assistant row, or if we multiply by the next slot
    // directly, the session.error card is pushed below the later user message.
    // We instead anchor to the last visible message at-or-before this raw tape
    // index, then place the non-message row inside that message's 10-point slot.
    const visibleMessageCount = countCanonicalMessagesAtOrBeforeRawIndex(
      renderMessageEntries,
      rawIndex,
    );
    return (visibleMessageCount - 1) * 10 + offset;
  };

  for (const entry of renderMessageEntries) {
    const terminalRawIndex = getTerminalRawIndex(entry.message);
    if (
      entry.message.aborted !== true ||
      typeof terminalRawIndex !== "number" ||
      terminalRawIndex <= entry.rawOrder
    ) {
      continue;
    }

    const hasInterveningCanonicalMessage = renderMessageEntries.some(
      (candidate) =>
        candidate.index !== entry.index &&
        candidate.renderKind !== "hidden" &&
        candidate.rawOrder > entry.rawOrder &&
        candidate.rawOrder <= terminalRawIndex,
    );
    if (!hasInterveningCanonicalMessage) {
      continue;
    }

    // Detach only the interruption badge, not the assistant card.
    //
    // Required ordering contract:
    // 1. user prompt that started the turn
    // 2. assistant response card with its real content/timeline
    // 3. newer user turns that may already exist in the centralized tape
    // 4. a trailing interruption marker if the SDK abort row arrived later
    //
    // Marking the message this way lets ResponseMessage hide its inline badge,
    // while this projection emits a separate `assistant.abort` entry at the
    // terminal raw position below. Without this split, we can only choose one of
    // two bad outcomes: either the assistant card moves too late, or the badge
    // renders too early inside the assistant card.
    entry.message = {
      ...entry.message,
      interruptedPresentation: "detached",
      info: {
        ...(entry.message.info || {}),
        interruptedPresentation: "detached",
      },
    };
  }

  renderMessageEntries
    .filter((entry) => isBackgroundTaskReminderMessage(entry.message))
    .forEach((entry) => {
      logBackgroundTaskReminderTrace("ORDER_SOURCE", {
        messageId: getCanonicalMessageId(entry.message),
        rawOrder: entry.rawOrder,
        index: entry.index,
        emittedDuringUserPass: true,
        role: entry.role,
      });
    });

  renderMessageEntries
    .filter((entry) => isBackgroundTaskReminderMessage(entry.message))
    .forEach((entry, index) => {
      logBackgroundTaskReminderTrace("ORDER_FINAL", {
        messageId: getCanonicalMessageId(entry.message),
        orderedIndex: index,
        rawOrder: entry.rawOrder,
        index: entry.index,
      });
    });

  const userEntries = renderMessageEntries
    .filter((entry) => entry.role === "user")
    .sort((left, right) => {
      if (left.rawOrder !== right.rawOrder) return left.rawOrder - right.rawOrder;
      return left.index - right.index;
    });

  const userEntryByOwnedId = new Map<string, (typeof renderMessageEntries)[number]>();
  for (const entry of userEntries) {
    for (const id of entry.ids) {
      if (!userEntryByOwnedId.has(id)) {
        userEntryByOwnedId.set(id, entry);
      }
    }
  }

  const assistantParentIdByMessageId = new Map<string, string>();
  for (let rawIndex = 0; rawIndex < normalizedRawSdkEventPayloads.length; rawIndex += 1) {
    const event = asRecord(normalizedRawSdkEventPayloads[rawIndex]);
    if (!event) {
      continue;
    }
    const info = getCentralizedEventInfo(event);
    const part = getCentralizedEventPart(event);
    const messageId = firstNonEmptyString(
      info?.id,
      info?.messageID,
      info?.messageId,
      part?.messageID,
      part?.messageId,
    );
    const role = firstNonEmptyString(info?.role)?.toLowerCase();
    const parentId = firstNonEmptyString(info?.parentID, info?.parentId);
    if (messageId && role === "assistant" && parentId) {
      assistantParentIdByMessageId.set(messageId, parentId);
    }
  }

  const centralizedAssistantTurnIndex: CentralizedAssistantTurnIndex = {
    assistantParentIdByMessageId,
    firstRawIndexByMessageId,
  };

  const assistantEntriesByUserPrimaryId = new Map<
    string,
    Array<(typeof renderMessageEntries)[number]>
  >();
  for (const entry of renderMessageEntries) {
    if (entry.role !== "assistant") {
      continue;
    }
    const parentId = getCentralizedAssistantParentId(entry.message, centralizedAssistantTurnIndex);
    const parentUserEntry = parentId ? userEntryByOwnedId.get(parentId) : undefined;
    const parentUserPrimaryId = parentUserEntry?.ids[0];
    if (!parentUserPrimaryId) {
      continue;
    }
    const siblings = assistantEntriesByUserPrimaryId.get(parentUserPrimaryId);
    if (siblings) {
      siblings.push(entry);
      continue;
    }
    assistantEntriesByUserPrimaryId.set(parentUserPrimaryId, [entry]);
  }

  const orderedMessageEntries: typeof renderMessageEntries = [];
  const emittedMessageIndexes = new Set<number>();
  const pushMessageEntry = (entry: (typeof renderMessageEntries)[number] | undefined): void => {
    if (!entry || emittedMessageIndexes.has(entry.index)) {
      return;
    }
    emittedMessageIndexes.add(entry.index);
    orderedMessageEntries.push(entry);
  };

  const entriesByRawOrder = [...renderMessageEntries].sort((left, right) => {
    if (left.rawOrder !== right.rawOrder) return left.rawOrder - right.rawOrder;
    return left.index - right.index;
  });

  for (const entry of entriesByRawOrder) {
    if (emittedMessageIndexes.has(entry.index)) {
      continue;
    }

    if (entry.role !== "user") {
      pushMessageEntry(entry);
      continue;
    }

    pushMessageEntry(entry);
    const assistantEntries = assistantEntriesByUserPrimaryId
      .get(entry.ids[0] ?? "")
      ?.sort((left, right) => {
        if (left.rawOrder !== right.rawOrder) return left.rawOrder - right.rawOrder;
        return left.index - right.index;
      });
    assistantEntries?.forEach((assistantEntry) => {
      pushMessageEntry(assistantEntry);
    });
  }

  const builtConversationEntries: ConversationRenderEntry[] = [];
  for (let index = 0; index < orderedMessageEntries.length; index += 1) {
    const entry = orderedMessageEntries[index];
    builtConversationEntries.push({
      kind: "message",
      key: `message:${entry.ids[0] ?? entry.index}`,
      message: entry.message,
      messageIndex: entry.index,
      order: index * 10,
      renderKind: entry.renderKind,
    });
  }

  builtConversationEntries.forEach((entry) => {
    if (entry.kind !== "message") {
      return;
    }
    if (entry.renderKind === "hidden") {
      return;
    }
    if (
      entry.renderKind === "background-task-reminder" ||
      entry.renderKind === "hidden"
    ) {
      logBackgroundTaskReminderTrace("RENDER_ENTRY", {
        messageId: firstNonEmptyString(entry.key.replace(/^message:/, "")) ?? entry.key,
        renderKind: entry.renderKind,
        rawOrder:
          renderMessageEntries.find((candidate) => candidate.index === entry.messageIndex)
            ?.rawOrder ?? Number.MAX_SAFE_INTEGER,
        index: entry.messageIndex,
      });
    }
    conversationEntries.push(entry);
  });

  for (const entry of renderMessageEntries) {
    const terminalRawIndex = getTerminalRawIndex(entry.message);
    if (
      entry.message.aborted !== true ||
      entry.message.interruptedPresentation !== "detached" ||
      typeof terminalRawIndex !== "number"
    ) {
      continue;
    }

    // Place the detached interruption badge using the canonical message count at
    // the abort row. This keeps the badge in raw-tape order relative to later
    // user/system/diff entries without disturbing the already-correct placement
    // of the assistant response card itself.
    conversationEntries.push({
      kind: "assistant.abort",
      key: `assistant.abort:${entry.ids[0] ?? entry.index}`,
      messageId: entry.ids[0],
      order: getConversationOrderAfterRawIndex(terminalRawIndex, 7),
    });
  }

  const seenSessionDiffFingerprints = new Set<string>();
  for (let rawIndex = 0; rawIndex < normalizedRawSdkEventPayloads.length; rawIndex += 1) {
    const event = asRecord(normalizedRawSdkEventPayloads[rawIndex]);
    if (!event) {
      continue;
    }
    const diff = parseCentralizedSessionDiffEvent(event, rawIndex);
    if (!diff) {
      continue;
    }
    const diffFingerprint = buildCentralizedSessionDiffFingerprint(diff);
    if (seenSessionDiffFingerprints.has(diffFingerprint)) {
      continue;
    }
    seenSessionDiffFingerprints.add(diffFingerprint);
    conversationEntries.push({
      kind: "session.diff",
      key: `session.diff:${diff.id ?? rawIndex}`,
      diff,
      order: getConversationOrderAfterRawIndex(rawIndex, 5),
    });
  }

  const parsedSessionErrorEvents = normalizedRawSdkEventPayloads
    .map((payload, rawIndex) => parseCentralizedSessionErrorEvent(payload, rawIndex))
    .filter((event): event is CentralizedSessionErrorEvent => !!event);
  const primarySessionErrorEvents = parsedSessionErrorEvents.filter(
    (candidateError) => candidateError.source !== "message.updated",
  );
  const primarySpecificSessionErrorEvents = primarySessionErrorEvents.filter(
    (candidateError) => !isGenericSessionErrorMessage(candidateError.message),
  );
  const fallbackSpecificSessionErrorEvents = parsedSessionErrorEvents.filter(
    (candidateError) =>
      candidateError.source === "message.updated" &&
      !isGenericSessionErrorMessage(candidateError.message),
  );
  const sessionErrorEvents = primarySpecificSessionErrorEvents.length > 0
    ? primarySpecificSessionErrorEvents
    : fallbackSpecificSessionErrorEvents.length > 0
      ? fallbackSpecificSessionErrorEvents
      : primarySessionErrorEvents.length > 0
        ? primarySessionErrorEvents
        : parsedSessionErrorEvents;
  const hasSpecificSessionErrorEvent = sessionErrorEvents.some(
    (candidateError) => !isGenericSessionErrorMessage(candidateError.message),
  );
  const seenSessionErrorFingerprints = new Set<string>();
  for (const errorEvent of sessionErrorEvents) {
    if (
      hasSpecificSessionErrorEvent &&
      isGenericSessionErrorMessage(errorEvent.message)
    ) {
      continue;
    }
    // IMPORTANT: dedupe must stay event-specific, not message-text-specific.
    // Different assistant turns can fail with the exact same server message,
    // and collapsing by `{sessionId, message, source}` would hide later
    // failures from the transcript. Include the concrete event identity so each
    // errored turn can still surface its own inline session-error row.
    const fingerprint = JSON.stringify({
      sessionId: errorEvent.sessionId ?? "",
      id: errorEvent.id ?? null,
      rawIndex: errorEvent.rawIndex,
      message: errorEvent.message,
      source: errorEvent.source,
    });
    if (seenSessionErrorFingerprints.has(fingerprint)) {
      continue;
    }
    seenSessionErrorFingerprints.add(fingerprint);
    conversationEntries.push({
      kind: "session.error",
      key: `session.error:${errorEvent.id ?? errorEvent.rawIndex}`,
      error: errorEvent,
      order: getConversationOrderAfterRawIndex(errorEvent.rawIndex, 6),
    });
  }

  return {
    renderMessages,
    conversationEntries: conversationEntries.sort((left, right) => left.order - right.order),
  };
}

function collectMessageIdentityCandidates(message?: Message): string[] {
  if (!message) {
    return [];
  }

  const candidates = [
    firstNonEmptyString(message.info?.id, message.id, message.messageId),
    ...(Array.isArray((message as any).coalescedIds)
      ? ((message as any).coalescedIds as string[])
      : []),
  ];

  return Array.from(
    new Set(
      candidates.filter(
        (candidate): candidate is string =>
          typeof candidate === "string" && candidate.trim().length > 0,
      ),
    ),
  );
}

type StreamViewportState = {
  isFollowing: boolean;
  unseenUpdateCount: number;
};

type ScrollRenderViewport = {
  scrollTop: number;
  viewportHeight: number;
};

type VirtualizedConversationWindow = {
  startIndex: number;
  endIndex: number;
  topPaddingHeight: number;
  bottomPaddingHeight: number;
  shouldVirtualize: boolean;
};

const AUTO_FOLLOW_THRESHOLD_PX = 96;
const VIRTUALIZED_TRANSCRIPT_MIN_ENTRIES = 250;
const VIRTUALIZED_TRANSCRIPT_OVERSCAN_PX = 1400;
const VIRTUALIZED_TRANSCRIPT_FALLBACK_VIEWPORT_PX = 800;
const STATIC_TRANSCRIPT_VIEWPORT: ScrollRenderViewport = {
  scrollTop: 0,
  viewportHeight: VIRTUALIZED_TRANSCRIPT_FALLBACK_VIEWPORT_PX,
};
const COMPACTION_DIVIDER_ESTIMATED_HEIGHT = 72;
// content-visibility: auto renders off-screen entries lazily using
// contain-intrinsic-size placeholders. After snapping to bottom on session
// load, newly-visible entries paint with real heights, growing scrollHeight
// and leaving the viewport above the true bottom. Keep pinning across frames
// until the height stabilizes (capped to avoid runaway loops).
const SESSION_LOAD_SCROLL_STABILIZE_FRAMES = 12;

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
    <div className="flex items-center justify-center">
      <AIStatusTicker />
    </div>
  );
}

type ConversationTranscriptProps = {
  blockExpandedState: Map<string, boolean>;
  compactionDividerIndex?: number;
  currentSessionId: string | null;
  diffByBlockKey: Map<string, CentralizedSessionDiffEvent>;
  hydratedFileChangesByBlockKey: Set<string>;
  hasLiveAssistantTurn: boolean;
  assistantTurnMessageId: string | null;
  interactiveEvents: AppState["interactiveEvents"];
  isCompressed: boolean;
  isProcessing: boolean;
  lastCompactedAt?: number;
  renderMessages: Message[];
  resolveAgentColor: (agentId?: string) => string;
  selectedAgent: string;
  streamingAgent?: string;
  isStreamingActive: boolean;
  subagentDetailsById: AppState["subagentDetailsById"];
  subagentsByParentMessageId: AppState["subagentsByParentMessageId"];
  todoItems: AppState["todoItems"];
  visibleConversationEntries: ConversationRenderEntry[];
  scrollViewport: ScrollRenderViewport;
  onSetBlockExpanded: (blockKey: string, expanded: boolean) => void;
};

function getTranscriptEntryContainIntrinsicSize(
  entry: ConversationRenderEntry,
  options: { isHiddenByBlock?: boolean } = {},
): string {
  if (entry.kind === "session.error") {
    return "132px";
  }
  if (entry.kind === "fileChanges") {
    return "104px";
  }
  if (entry.kind !== "message") {
    return "56px";
  }

  // content-visibility: auto uses contain-intrinsic-size as the off-screen
  // placeholder. Hidden-by-collapse cards are display:none (0px real height)
  // but would still reserve 320px each, inflating the scrollbar and causing
  // scroll snapping. Must return 0px to match the real collapsed footprint.
  if (options.isHiddenByBlock) {
    return "0px";
  }

  const role = firstNonEmptyString(entry.message.role, entry.message.info?.role)?.toLowerCase();
  if (role === "assistant") {
    return "320px";
  }
  if (role === "user") {
    return "120px";
  }
  return "160px";
}

function estimateConversationEntryHeight(entry: ConversationRenderEntry): number {
  if (entry.kind === "assistant.abort") {
    return 56;
  }
  if (entry.kind === "session.error") {
    return 132;
  }
  if (entry.kind === "session.diff") {
    return 0;
  }
  if (entry.kind === "fileChanges") {
    return 104;
  }
  const role = firstNonEmptyString(entry.message.role, entry.message.info?.role)?.toLowerCase();
  const renderKind = entry.renderKind;
  if (renderKind === "user" || role === "user") {
    return 120;
  }
  if (renderKind === "system") {
    return 88;
  }
  if (renderKind === "permission") {
    return 104;
  }
  if (renderKind === "background-task-reminder") {
    return 92;
  }
  return 320;
}

function findFirstPrefixIndexAtOrAbove(prefixHeights: number[], value: number): number {
  let low = 0;
  let high = prefixHeights.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (prefixHeights[mid] < value) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function buildVirtualizedConversationWindow(params: {
  entryPrefixHeights: number[];
  totalEntries: number;
  scrollViewport: ScrollRenderViewport;
}): VirtualizedConversationWindow {
  const { entryPrefixHeights, totalEntries, scrollViewport } = params;
  const { scrollTop, viewportHeight } = scrollViewport;
  const effectiveViewportHeight =
    viewportHeight > 0 ? viewportHeight : VIRTUALIZED_TRANSCRIPT_FALLBACK_VIEWPORT_PX;

  if (
    totalEntries < VIRTUALIZED_TRANSCRIPT_MIN_ENTRIES ||
    entryPrefixHeights.length !== totalEntries + 1
  ) {
    return {
      startIndex: 0,
      endIndex: totalEntries,
      topPaddingHeight: 0,
      bottomPaddingHeight: 0,
      shouldVirtualize: false,
    };
  }

  const overscan = Math.max(VIRTUALIZED_TRANSCRIPT_OVERSCAN_PX, effectiveViewportHeight);
  const windowTop = Math.max(0, scrollTop - overscan);
  const windowBottom = scrollTop + effectiveViewportHeight + overscan;
  const totalHeight = entryPrefixHeights[totalEntries] ?? 0;

  const startIndex = Math.max(
    0,
    Math.min(
      totalEntries,
      findFirstPrefixIndexAtOrAbove(entryPrefixHeights, windowTop) - 1,
    ),
  );
  const endIndex = Math.max(
    startIndex,
    Math.min(
      totalEntries,
      findFirstPrefixIndexAtOrAbove(
        entryPrefixHeights,
        Math.min(windowBottom, totalHeight),
      ),
    ),
  );

  return {
    startIndex,
    endIndex,
    topPaddingHeight: entryPrefixHeights[startIndex] ?? 0,
    bottomPaddingHeight: Math.max(
      0,
      totalHeight - (entryPrefixHeights[endIndex] ?? totalHeight),
    ),
    shouldVirtualize: true,
  };
}

const MemoizedConversationTranscript = memo(function ConversationTranscript({
  blockExpandedState,
  compactionDividerIndex,
  currentSessionId,
  diffByBlockKey,
  hydratedFileChangesByBlockKey,
  hasLiveAssistantTurn,
  assistantTurnMessageId,
  interactiveEvents,
  isCompressed,
  isProcessing,
  lastCompactedAt,
  renderMessages,
  resolveAgentColor,
  selectedAgent,
  streamingAgent,
  isStreamingActive,
  subagentDetailsById,
  subagentsByParentMessageId,
  todoItems,
  visibleConversationEntries,
  scrollViewport,
  onSetBlockExpanded,
}: ConversationTranscriptProps) {
  const measuredEntryHeightsRef = useRef<Map<string, number>>(new Map());
  const observedEntryNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [measuredHeightsVersion, setMeasuredHeightsVersion] = useState(0);

  const queuedUserMessageIndexes = useMemo(
    () =>
      hasLiveAssistantTurn
        ? computeQueuedUserMessageIndexes(renderMessages, assistantTurnMessageId)
        : new Set<number>(),
    [assistantTurnMessageId, hasLiveAssistantTurn, renderMessages],
  );

  // Ref-based callback cache to keep onSetBlockExpanded references stable across renders.
  // The parent's onSetBlockExpanded is useCallback([], []) so it's already stable, but the
  // per-blockGroup wrapper arrow created in the map loop was new every render, completely
  // breaking React.memo on ResponseMessage for every assistant card.
  const onSetBlockExpandedRef = useRef(onSetBlockExpanded);
  onSetBlockExpandedRef.current = onSetBlockExpanded;
  const blockGroupHandlerCacheRef = useRef<Map<string, (expanded: boolean) => void>>(new Map());
  const getBlockGroupExpandHandler = (blockGroupKey: string) => {
    let handler = blockGroupHandlerCacheRef.current.get(blockGroupKey);
    if (!handler) {
      handler = (expanded: boolean) => onSetBlockExpandedRef.current(blockGroupKey, expanded);
      blockGroupHandlerCacheRef.current.set(blockGroupKey, handler);
    }
    return handler;
  };

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      let changed = false;

      for (const resizeEntry of entries) {
        const target = resizeEntry.target as HTMLDivElement;
        const entryKey = target.dataset.virtualEntryKey;
        if (!entryKey) {
          continue;
        }

        const nextHeight = Math.ceil(
          resizeEntry.borderBoxSize && resizeEntry.borderBoxSize.length > 0
            ? resizeEntry.borderBoxSize[0].blockSize
            : resizeEntry.contentRect.height,
        );
        if (!Number.isFinite(nextHeight) || nextHeight <= 0) {
          continue;
        }
        if (measuredEntryHeightsRef.current.get(entryKey) === nextHeight) {
          continue;
        }
        measuredEntryHeightsRef.current.set(entryKey, nextHeight);
        changed = true;
      }

      if (changed) {
        setMeasuredHeightsVersion((current) => current + 1);
      }
    });

    resizeObserverRef.current = observer;
    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
      observedEntryNodesRef.current.clear();
    };
  }, []);

  const attachMeasuredEntryNode = useCallback((entryKey: string, node: HTMLDivElement | null) => {
    const observer = resizeObserverRef.current;
    const previousNode = observedEntryNodesRef.current.get(entryKey);
    if (previousNode && previousNode !== node && observer) {
      observer.unobserve(previousNode);
    }

    if (!node) {
      observedEntryNodesRef.current.delete(entryKey);
      return;
    }

    observedEntryNodesRef.current.set(entryKey, node);
    node.dataset.virtualEntryKey = entryKey;

    const measuredHeight = Math.ceil(node.getBoundingClientRect().height);
    if (
      Number.isFinite(measuredHeight) &&
      measuredHeight > 0 &&
      measuredEntryHeightsRef.current.get(entryKey) !== measuredHeight
    ) {
      measuredEntryHeightsRef.current.set(entryKey, measuredHeight);
      setMeasuredHeightsVersion((current) => current + 1);
    }

    observer?.observe(node);
  }, []);

  const {
    entryBlockKeys,
    isFirstInBlockByIndex,
    isAbsoluteLastInBlockByIndex,
    isLastTextInBlockByIndex,
    blockSizeByKey,
    blockHasInlineAbortByKey,
  } = useMemo(
    () => buildAssistantBlockPresentation(
      visibleConversationEntries.map((entry, index) => {
        if (entry.kind !== "message") {
          return {};
        }
        const message = entry.message;
        return {
          role: message.role ?? message.info?.role,
          userBlockKey: firstNonEmptyString(message.info?.id, message.id) ?? `user:${index}`,
          // Child assistant messages retain their parentID-driven grouping.
          // Non-subagent assistant envelopes continue in the current response
          // block; their exact message ownership is enforced during hydration.
          assistantBlockKey: firstNonEmptyString(message.info?.parentID) ?? undefined,
          hasResponseText: Boolean(
            message.content || message.text || message.info?.content || message.info?.text,
          ),
          hasInlineAbort:
            message.aborted === true && message.interruptedPresentation === "inline",
        };
      }),
    ),
    [visibleConversationEntries],
  );

  const { entryPrefixHeights, messageCountPrefix } = useMemo(() => {
    const prefixHeights = new Array<number>(visibleConversationEntries.length + 1).fill(0);
    const messagePrefix = new Array<number>(visibleConversationEntries.length + 1).fill(0);
    let messageCountSeen = 0;

    for (let index = 0; index < visibleConversationEntries.length; index += 1) {
      const entry = visibleConversationEntries[index];
      const hasDividerBefore =
        !isCompressed &&
        typeof compactionDividerIndex === "number" &&
        compactionDividerIndex === messageCountSeen;

      // Block visibility must be resolved before consulting the measured
      // height cache. Hidden cards are display:none and occupy 0px, but
      // the cache may still hold a stale expanded measurement. Trusting
      // that stale value would inflate the virtualization padding the same
      // way the content-visibility intrinsic-size hint does.
      let isHiddenByBlock = false;
      if (
        entry.kind === "message" &&
        entry.renderKind !== "user" &&
        entry.renderKind !== "system" &&
        entry.renderKind !== "permission" &&
        entry.renderKind !== "background-task-reminder"
      ) {
        const blockGroupKey = entryBlockKeys[index];
        const isAbsoluteLastInBlock = isAbsoluteLastInBlockByIndex.get(index) ?? false;
        const isLastTextInBlock = isLastTextInBlockByIndex.get(index) ?? false;
        const blockSize = blockSizeByKey.get(blockGroupKey) ?? 1;
        const isLiveBlock =
          hasLiveAssistantTurn &&
          blockGroupKey === entryBlockKeys[entryBlockKeys.length - 1];
        // A response block must remain fully expanded while it is streaming.
        // Once the stream ends, the default collapsed state takes over and
        // the completed-turn affordances can appear.
        const isBlockExpanded =
          isLiveBlock || blockExpandedState.get(blockGroupKey) === true;
        const isLastInBlock = isBlockExpanded ? isAbsoluteLastInBlock : isLastTextInBlock;
        isHiddenByBlock = blockSize > 1 && !isLastInBlock && !isBlockExpanded;
      }

      const measuredHeight = measuredEntryHeightsRef.current.get(entry.key);
      let estimatedHeight = 0;
      if (isHiddenByBlock) {
        estimatedHeight = 0;
      } else if (typeof measuredHeight === "number") {
        estimatedHeight = measuredHeight;
      } else {
        estimatedHeight =
          estimateConversationEntryHeight(entry) +
          (hasDividerBefore ? COMPACTION_DIVIDER_ESTIMATED_HEIGHT : 0);
      }

      prefixHeights[index + 1] = prefixHeights[index] + estimatedHeight;
      messagePrefix[index + 1] =
        messagePrefix[index] + (entry.kind === "message" ? 1 : 0);

      if (entry.kind === "message") {
        messageCountSeen += 1;
      }
    }

    return {
      entryPrefixHeights: prefixHeights,
      messageCountPrefix: messagePrefix,
    };
  }, [
    visibleConversationEntries,
    measuredHeightsVersion,
    isCompressed,
    compactionDividerIndex,
    entryBlockKeys,
    isAbsoluteLastInBlockByIndex,
    isLastTextInBlockByIndex,
    blockSizeByKey,
    blockExpandedState,
    hasLiveAssistantTurn,
  ]);

  const transcriptWindow = useMemo(
    () =>
      buildVirtualizedConversationWindow({
        entryPrefixHeights,
        totalEntries: visibleConversationEntries.length,
        scrollViewport,
      }),
    [entryPrefixHeights, visibleConversationEntries.length, scrollViewport],
  );
  const renderedConversationEntries = transcriptWindow.shouldVirtualize
    ? visibleConversationEntries.slice(
        transcriptWindow.startIndex,
        transcriptWindow.endIndex,
      )
    : visibleConversationEntries;
  let messageCountSeen = messageCountPrefix[transcriptWindow.startIndex] ?? 0;

  return (
    <>
      {transcriptWindow.topPaddingHeight > 0 ? (
        <div
          aria-hidden="true"
          style={{ height: `${transcriptWindow.topPaddingHeight}px` }}
        />
      ) : null}
      {renderedConversationEntries.map((entry, sliceIndex) => {
        const entryIndex = transcriptWindow.startIndex + sliceIndex;
        const dividerHere = !isCompressed && compactionDividerIndex === messageCountSeen;

        if (entry.kind === "message") {
          const message = entry.message;
          const index = entry.messageIndex;
          const role = message.role ?? message.info?.role ?? "user";
          const previousIndex = index - 1;
          const previousMessage =
            previousIndex >= 0 ? renderMessages[previousIndex] : undefined;
          const previousEntryBlockKey =
            entryIndex > 0 ? entryBlockKeys[entryIndex - 1] : undefined;
          const isContiguous =
            role === "assistant" &&
            previousMessage?.role === "assistant" &&
            // Adjacent SDK assistant envelopes can be separate phases of the
            // same user turn. Only suppress repeated card chrome when they
            // intentionally share a render block; distinct `info.id` values
            // must retain their own position and activity timeline.
            entryBlockKeys[entryIndex] === previousEntryBlockKey &&
            (previousMessage.info?.agent === message.info?.agent ||
              (!previousMessage.info?.agent && !message.info?.agent));

          let messageNode: JSX.Element | null;
          let entryHiddenByBlock = false;
          if (entry.renderKind === "user") {
            messageNode = (
              <UserMessage
                message={message}
                isQueued={queuedUserMessageIndexes.has(index)}
              />
            );
          } else if (entry.renderKind === "background-task-reminder") {
            messageNode = (
              <BackgroundTaskReminderMessage
                message={message}
                messages={renderMessages}
              />
            );
          } else if (entry.renderKind === "system") {
            const systemAgentId =
              message.info?.agent ?? streamingAgent ?? selectedAgent;

            messageNode = (
              <SystemMessage
                content={message.content ?? message.text ?? ""}
                accentColor={resolveAgentColor(systemAgentId)}
              />
            );
          } else if (entry.renderKind === "permission") {
            messageNode = <PermissionCard perm={message} />;
          } else {
            const blockGroupKey = entryBlockKeys[entryIndex];
            const isAbsoluteLastInBlock =
              isAbsoluteLastInBlockByIndex.get(entryIndex) ?? false;
            const isFirstInBlock = isFirstInBlockByIndex.get(entryIndex) ?? true;
            const isLastTextInBlock = isLastTextInBlockByIndex.get(entryIndex) ?? false;
            const blockSize = blockSizeByKey.get(blockGroupKey) ?? 1;
            const isLiveBlock =
              hasLiveAssistantTurn && blockGroupKey === entryBlockKeys[entryBlockKeys.length - 1];
            // Do not allow a persisted collapsed state to hide active stream
            // content. Completed blocks return to the default collapsed view.
            const isBlockExpanded =
              isLiveBlock || blockExpandedState.get(blockGroupKey) === true;
            const isLastInBlock = isBlockExpanded ? isAbsoluteLastInBlock : isLastTextInBlock;
            // The header belongs to the response block, not every individual
            // assistant message. When collapsed, pin it to the visible summary
            // card; when expanded, pin it to the first card in the block.
            const isBlockHeaderAnchor =
              blockSize <= 1 || (isBlockExpanded ? isFirstInBlock : isLastInBlock);
            const isHiddenByBlock = blockSize > 1 && !isLastInBlock && !isBlockExpanded;
            entryHiddenByBlock = isHiddenByBlock;

            messageNode = (
              <ResponseMessage
                message={message}
                isContiguous={isContiguous}
                interactiveEvents={interactiveEvents}
                messages={renderMessages}
                currentSessionId={currentSessionId}
                hideFileChangesSection={
                  diffByBlockKey.has(blockGroupKey) ||
                  hydratedFileChangesByBlockKey.has(blockGroupKey)
                }
                centralizedDiffEvent={
                  isLastInBlock &&
                  blockGroupKey &&
                  !(isLiveBlock && (isProcessing || isStreamingActive))
                    ? diffByBlockKey.get(blockGroupKey)
                    : undefined
                }
                subagentsByParentMessageId={subagentsByParentMessageId}
                subagentDetailsById={subagentDetailsById}
                todoItems={todoItems}
                blockGroupKey={blockGroupKey}
                isLastInBlock={isLastInBlock}
                isBlockExpanded={isBlockExpanded}
                isBlockStreaming={isLiveBlock}
                isBlockHeaderAnchor={isBlockHeaderAnchor}
                blockSize={blockSize}
                isHiddenByBlock={isHiddenByBlock}
                blockHasInlineAbort={blockHasInlineAbortByKey.get(blockGroupKey)}
                onSetBlockExpanded={getBlockGroupExpandHandler(blockGroupKey)}
              />
            );
          }

          messageCountSeen += 1;

          return (
            <div
              key={entry.key}
              ref={(node) => attachMeasuredEntryNode(entry.key, node)}
            >
              {dividerHere ? <CompactionDivider at={lastCompactedAt} /> : null}
              <div
                style={{
                  contentVisibility: "auto",
                  containIntrinsicSize: getTranscriptEntryContainIntrinsicSize(entry, {
                    isHiddenByBlock: entryHiddenByBlock,
                  }),
                }}
              >
                {messageNode}
              </div>
            </div>
          );
        }

        if (entry.kind === "assistant.abort") {
          return (
            <div
              key={entry.key}
              ref={(node) => attachMeasuredEntryNode(entry.key, node)}
            >
              {dividerHere ? <CompactionDivider at={lastCompactedAt} /> : null}
              <div
                style={{
                  contentVisibility: "auto",
                  containIntrinsicSize: getTranscriptEntryContainIntrinsicSize(entry),
                }}
              >
                <div className="px-4">
                  <div className="mt-2 flex items-center justify-center">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium tracking-wide text-amber-400">
                      <div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                      <span>Interrupted</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        if (entry.kind === "fileChanges") {
          // SDK rehydration stores `info.summary.diffs` on the user envelope.
          // This dedicated transcript entry is the only rendering path for
          // those summaries; centralized `session.diff` events are rendered on
          // the assistant response card below. Do not remove this row or a
          // rehydrated diff becomes invisible after a session reload.
          const changeSummary = entry.message.changeSummary;
          return changeSummary?.files?.length ? (
            <div
              key={entry.key}
              ref={(node) => attachMeasuredEntryNode(entry.key, node)}
            >
              {dividerHere ? <CompactionDivider at={lastCompactedAt} /> : null}
              <div className="oc-message-enter mb-4">
                <FileChangesSection
                  structuredFileChanges={[]}
                  changeSummary={changeSummary}
                  messageId={changeSummary.messageId || entry.message.id || null}
                  sessionId={currentSessionId}
                />
              </div>
            </div>
          ) : null;
        }

        if (entry.kind === "session.diff") {
          return null;
        }

        if (entry.kind === "session.error") {
          return (
            <CompactErrorItem 
              key={entry.key} 
              entry={entry} 
              dividerHere={dividerHere} 
              lastCompactedAt={lastCompactedAt} 
            />
          );
        }

        return (
          <div
            key={entry.key}
            ref={(node) => attachMeasuredEntryNode(entry.key, node)}
          >
            {dividerHere ? <CompactionDivider at={lastCompactedAt} /> : null}
          </div>
        );
      })}
      {transcriptWindow.bottomPaddingHeight > 0 ? (
        <div
          aria-hidden="true"
          style={{ height: `${transcriptWindow.bottomPaddingHeight}px` }}
        />
      ) : null}
    </>
  );
});

function CompactErrorItem({ entry, dividerHere, lastCompactedAt }: { entry: any; dividerHere: boolean; lastCompactedAt: number }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const errorMessage = entry.error?.message || "Unknown error";
  const isExpandable = errorMessage.length > 150 || errorMessage.includes("\n");

  return (
    <div>
      {dividerHere ? <CompactionDivider at={lastCompactedAt} /> : null}
      <div
        style={{
          contentVisibility: "auto",
          containIntrinsicSize: "auto 50px",
        }}
      >
        <div className="mb-2">
          <div
            className="w-full rounded-[10px] border px-3 py-2.5 text-left transition-colors"
            style={{
              background: "color-mix(in srgb, var(--vscode-errorForeground) 8%, transparent)",
              borderColor: "color-mix(in srgb, var(--vscode-errorForeground) 15%, transparent)",
            }}
          >
            <div className="flex min-w-0 items-start gap-3">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full mt-0.5"
                style={{
                  background: "color-mix(in srgb, var(--vscode-errorForeground) 15%, transparent)",
                  color: "var(--vscode-errorForeground)",
                }}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div
                  className="text-[13px] leading-relaxed font-medium cursor-pointer"
                  style={{ color: "var(--vscode-errorForeground)", wordBreak: "break-word" }}
                  onClick={() => isExpandable && setIsExpanded(!isExpanded)}
                >
                  <div className={isExpanded ? "" : "line-clamp-2"}>
                    {errorMessage}
                  </div>
                </div>
                {isExpandable && (
                  <button
                    type="button"
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="mt-1.5 text-[11px] font-semibold opacity-80 hover:opacity-100 transition-opacity"
                    style={{ color: "var(--vscode-errorForeground)" }}
                  >
                    {isExpanded ? "Show less" : "Show more"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatContent() {
  // Perf probe: capture render start timestamp at top of body (cheap read,
  // only when probe is enabled). Recorded in a no-deps useEffect that runs
  // after commit, giving us full render+commit time.
  const renderStart = perfProbe.isEnabled() ? performance.now() : 0;
  const state = useAppState(
    (appState) => ({
      assistantTurnMessageId: appState.assistantTurnMessageId,
      assistantTurnPending: appState.assistantTurnPending,
      availableAgents: appState.availableAgents,
      compactedMessagesCollapsed: appState.compactedMessagesCollapsed,
      compactionBaselineStats: appState.compactionBaselineStats,
      compactionDividerAfterMessageId: appState.compactionDividerAfterMessageId,
      compactionDividerBeforeMessageId: appState.compactionDividerBeforeMessageId,
      compactionDividerIndex: appState.compactionDividerIndex,
      currentSessionId: appState.currentSessionId,
      errorMessages: appState.errorMessages,
      interactiveEvents: appState.interactiveEvents,
      isCompacting: appState.isCompacting,
      isLoadingSession: appState.isLoadingSession,
      isProcessing: appState.isProcessing,
      isSessionModalOpen: appState.isSessionModalOpen,
      lastCompactedAt: appState.lastCompactedAt,
      loadingSessionId: appState.loadingSessionId,
      liveToastNotificationsBySessionId: appState.liveToastNotificationsBySessionId,
      pendingUserMessagesBySessionId: appState.pendingUserMessagesBySessionId,
      processingSessionIds: appState.processingSessionIds,
      messages: appState.messages,
      receivedInitState: appState.receivedInitState,
      revertState: appState.revertState,
      selectedAgent: appState.selectedAgent,
      serverStatus: appState.serverStatus,
      streaming: appState.streaming,
      subagentDetailsById: appState.subagentDetailsById,
      subagentsByParentMessageId: appState.subagentsByParentMessageId,
      todoItems: appState.todoItems,
    }),
    shallowEqual,
  );
  const dispatch = useAppDispatch();

  // Perf probe: record render+commit duration for ChatContent. No deps so it
  // fires after every commit. Zero work when probe disabled.
  useEffect(() => {
    if (renderStart > 0) {
      perfProbe.recordRender(performance.now() - renderStart);
    }
  });
  const stateRef = useRef(state);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const [streamViewport, setStreamViewport] = useState<StreamViewportState>({
    isFollowing: true,
    unseenUpdateCount: 0,
  });
  const [scrollRenderViewport, setScrollRenderViewport] = useState<ScrollRenderViewport>({
    scrollTop: 0,
    viewportHeight: 0,
  });
  const [showSkillInstaller, setShowSkillInstaller] = useState(false);
  // Shared collapse/expand state for contiguous assistant message blocks.
  // Keyed by blockGroupKey (the parentID shared by all assistant messages in
  // the same block). A missing key means "collapsed" (the default).
  // The final assistant card in each block is exempt from collapsing and always
  // shows its full content, so it is never wired to this map.
  const [blockExpandedState, setBlockExpandedState] = useState<Map<string, boolean>>(new Map());
  const handleSetBlockExpanded = useCallback((blockKey: string, expanded: boolean) => {
    setBlockExpandedState((prev) => {
      const next = new Map(prev);
      next.set(blockKey, expanded);
      return next;
    });
  }, []);

  // Track loading state timing to ensure minimum display duration
  const loadingStartTimeRef = useRef<number | null>(null);
  const LOADING_MIN_DISPLAY_MS = 500; // Show loading state for at least 500ms so users can perceive it
  const streamViewportRef = useRef(streamViewport);
  const previousIsLoadingSessionRef = useRef(state.isLoadingSession);
  const previousReceivedInitStateRef = useRef(state.receivedInitState);
  const previousStreamingActiveRef = useRef(Boolean(state.streaming?.isActive));
  // Baseline renderMessages.length captured when isFollowing flips to false.
  // "Jump to latest (N)" renders N = currentLength - baseline. null = recapture
  // on next entry to the not-following branch. Replaces a throttled +1 timer
  // that counted stream ticks rather than actual new canonical messages.
  const unseenBaselineMessageCountRef = useRef<number | null>(null);
  // Throttle follow-mode scroll writes to roughly one frame (33ms ~= 30fps).
  // Writing scrollTop on every tiny stream mutation can fight user input and create
  // visible hitching. A small throttle preserves "stick to bottom" behavior without
  // overdriving layout/reflow during heavy token streams.
  const lastFollowAutoScrollAtRef = useRef(0);

  const resolveAgentColor = useCallback((agentId?: string) => {
    if (!agentId) return "var(--oc-accent)";

    const match = (state.availableAgents ?? []).find(
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
  useEffect(() => {
    streamViewportRef.current = streamViewport;
  }, [streamViewport]);

  // Completed history is the SDK `session.messages()` snapshot adapted by the
  // extension host. Raw SDK events are retained only by the active streaming
  // overlay and are never replayed or persisted as a second transcript.
  const renderMessages = state.messages;
  const deferredRenderMessages = useDeferredValue(renderMessages);
  // Priority 2 — Defer streaming-dependent props passed to MemoizedConversationTranscript.
  // During event streaming, these values change on every stream batch. Without deferral,
  // they defeat React.memo on the transcript and force full re-renders on the hot path,
  // blocking the main thread and causing scroll jank. useDeferredValue lets React keep
  // the previous (stable) reference during urgent scroll/input and only flush the updated
  // value when the main thread is idle. The transcript may briefly show slightly stale
  // subagent/todo data during active scrolling — acceptable trade-off for smooth UX.
  const deferredInteractiveEvents = useDeferredValue(state.interactiveEvents);
  const deferredStreamingAgent = useDeferredValue(state.streaming?.agent);
  const deferredSubagentDetailsById = useDeferredValue(state.subagentDetailsById);
  const deferredSubagentsByParentMessageId = useDeferredValue(
    state.subagentsByParentMessageId,
  );
  const deferredTodoItems = useDeferredValue(state.todoItems);
  // STREAMING RENDER INVARIANT: the live response card must always receive
  // the current StreamingState. The centralized tape can update while layout
  // code temporarily considers the viewport not "following" (including on
  // initial mount and during automatic scroll adjustment). Freezing a prior
  // streaming snapshot here leaves the loading ticker visible even though the
  // raw centralized tape already contains tool/reasoning activity.
  //
  // Transcript rendering remains deferred/virtualized above; only this one
  // live response card stays synchronous with accepted stream events.
  const presentedStreaming = state.streaming;
  const pendingUserMessages = useMemo(() => {
    const bySessionId = state.pendingUserMessagesBySessionId ?? {};
    const sessionKey = state.currentSessionId ?? PENDING_CURRENT_SESSION_KEY;
    return bySessionId[sessionKey] ?? [];
  }, [state.pendingUserMessagesBySessionId, state.currentSessionId]);
  const visiblePendingUserMessages = useMemo(
    () => getVisiblePendingUserMessages(pendingUserMessages, renderMessages),
    [pendingUserMessages, renderMessages],
  );

  useEffect(() => {
    const sessionId = state.currentSessionId ?? PENDING_CURRENT_SESSION_KEY;
    const representedIds = getRepresentedPendingUserMessageIds(
      pendingUserMessages,
      renderMessages,
    );
    if (representedIds.length === 0) {
      return;
    }
    // This is the optimistic-to-canonical handoff. The local overlay message
    // should disappear only after the centralized transcript already contains
    // the matching user turn, otherwise the composer feels fast but the bubble
    // flickers or jumps when streaming starts.
    dispatch({
      type: "REMOVE_PENDING_USER_MESSAGES",
      payload: {
        sessionId,
        ids: representedIds,
      },
    });
  }, [dispatch, pendingUserMessages, renderMessages, state.currentSessionId]);

  useEffect(() => {
    const isStreamingNow = Boolean(state.streaming?.isActive);
    const justLoadedInitialChat =
      !previousReceivedInitStateRef.current && state.receivedInitState;
    const justFinishedSessionLoad =
      previousIsLoadingSessionRef.current && !state.isLoadingSession;
    const justFinishedAiResponse =
      previousStreamingActiveRef.current && !isStreamingNow;
    const shouldSnapToLatest =
      renderMessages.length > 0 &&
      (justLoadedInitialChat || justFinishedSessionLoad);

    // Only auto-scroll after AI finishes if user is already near the bottom.
    const shouldFollowAfterResponse =
      justFinishedAiResponse && streamViewportRef.current.isFollowing;

    if (shouldSnapToLatest || shouldFollowAfterResponse) {
      setStreamViewport({ isFollowing: true, unseenUpdateCount: 0 });
      const root = messagesScrollRef.current;
      if (root) {
        let lastScrollHeight = -1;
        let stabilizeFrames = 0;
        const pinToBottom = () => {
          const currentScrollHeight = root.scrollHeight;
          // Stop if the user scrolled away during stabilization.
          if (stabilizeFrames > 0) {
            const distanceFromBottom =
              currentScrollHeight - root.scrollTop - root.clientHeight;
            if (distanceFromBottom > AUTO_FOLLOW_THRESHOLD_PX) {
              return;
            }
          }
          root.scrollTop = currentScrollHeight;
          stabilizeFrames++;
          if (
            currentScrollHeight !== lastScrollHeight &&
            stabilizeFrames < SESSION_LOAD_SCROLL_STABILIZE_FRAMES
          ) {
            lastScrollHeight = currentScrollHeight;
            requestAnimationFrame(pinToBottom);
          }
        };
        requestAnimationFrame(pinToBottom);
      }
    } else if (justFinishedAiResponse) {
      unseenBaselineMessageCountRef.current = null;
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
    state.receivedInitState,
    state.streaming?.isActive,
    renderMessages.length,
  ]);

  // Register message listener. Wraps createMessageHandler with perf-probe
  // timing so per-message-type handler cost can be attributed during streaming.
  useEffect(() => {
    const innerHandler = createMessageHandler(dispatch, () => stateRef.current);
    const handler = (event: MessageEvent) => {
      if (!perfProbe.isEnabled()) {
        innerHandler(event);
        return;
      }
      const msgType = (event.data as { type?: unknown })?.type;
      const start = performance.now();
      innerHandler(event);
      perfProbe.recordMessage(msgType, performance.now() - start);
    };
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
    // A wheel/trackpad gesture can move less than the near-bottom threshold.
    // Remember the intent briefly so the viewport observer cannot immediately
    // turn follow mode back on and pull the user to the latest event.
    let manualScrollIntentUntil = 0;
    // Cache scrollHeight from rAF callbacks so the hot scroll path never
    // reads layout-triggering properties synchronously. During streaming,
    // reading root.scrollHeight in onScroll forces the browser to flush
    // pending DOM mutations (forced synchronous layout), which causes the
    // scroll jank/freezes users see during event streams.
    let cachedScrollHeight = root.scrollHeight;
    // In-handler throttle for the scroll-input diagnostic. The logger has
    // its own per-metric throttle, but checking it still constructs a
    // payload object and reads DOM properties; gate that work here so the
    // common scroll event stays a near-no-op.
    let lastScrollInputLogAt = 0;
    const pauseFollow = (source: "scroll" | "wheel" | "touch") => {
      manualScrollIntentUntil = Date.now() + 180;
      if (!streamViewportRef.current.isFollowing) {
        return;
      }
      streamViewportRef.current = {
        ...streamViewportRef.current,
        isFollowing: false,
      };
      unseenBaselineMessageCountRef.current = null;
      setStreamViewport((prev) =>
        prev.isFollowing ? { ...prev, isFollowing: false } : prev,
      );
      logger.streamPerformance("scroll-intent", {
        source,
        streamingActive: Boolean(stateRef.current.streaming?.isActive),
      });
    };
    const updateViewportState = () => {
      rafId = null;
      const nextScrollTop = root.scrollTop;
      const nextViewportHeight = root.clientHeight;
      // Refresh the cache inside rAF — the browser has already run layout
      // at this point, so this read does not trigger a forced sync reflow.
      cachedScrollHeight = root.scrollHeight;
      const nearBottom =
        cachedScrollHeight - nextScrollTop - nextViewportHeight <=
        AUTO_FOLLOW_THRESHOLD_PX;
      const isAtBottom =
        cachedScrollHeight - nextScrollTop - nextViewportHeight <= 2;
      setScrollRenderViewport((prev) =>
        prev.scrollTop === nextScrollTop && prev.viewportHeight === nextViewportHeight
          ? prev
          : {
              scrollTop: nextScrollTop,
              viewportHeight: nextViewportHeight,
            },
      );
      const wasFollowing = streamViewportRef.current.isFollowing;
      if (wasFollowing && !nearBottom) {
        streamViewportRef.current = {
          ...streamViewportRef.current,
          isFollowing: false,
        };
        unseenBaselineMessageCountRef.current = null;
        setStreamViewport((prev) =>
          prev.isFollowing ? { ...prev, isFollowing: false } : prev,
        );
      } else if (
        !wasFollowing &&
        isAtBottom &&
        Date.now() >= manualScrollIntentUntil
      ) {
        streamViewportRef.current = {
          ...streamViewportRef.current,
          isFollowing: true,
          unseenUpdateCount: 0,
        };
        setStreamViewport((prev) =>
          prev.isFollowing && prev.unseenUpdateCount === 0
            ? prev
            : { isFollowing: true, unseenUpdateCount: 0 },
        );
      }
    };
    const onScroll = () => {
      const currentScrollTop = root.scrollTop;
      const distanceFromBottom =
        cachedScrollHeight - currentScrollTop - root.clientHeight;
      const now = performance.now();
      if (now - lastScrollInputLogAt >= 250) {
        lastScrollInputLogAt = now;
        logger.streamPerformance("scroll-input", {
          scrollTop: Math.round(currentScrollTop),
          distanceFromBottom: Math.round(distanceFromBottom),
          following: streamViewportRef.current.isFollowing,
          streamingActive: Boolean(stateRef.current.streaming?.isActive),
        });
      }
      if (
        distanceFromBottom > AUTO_FOLLOW_THRESHOLD_PX &&
        streamViewportRef.current.isFollowing
      ) {
        pauseFollow("scroll");
      }
      if (rafId !== null) {
        return;
      }
      rafId = requestAnimationFrame(updateViewportState);
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY !== 0) {
        pauseFollow("wheel");
      }
    };
    const onTouchStart = () => pauseFollow("touch");
    updateViewportState();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(updateViewportState);
      });
      resizeObserver.observe(root);
    }

    root.addEventListener("scroll", onScroll, { passive: true });
    root.addEventListener("wheel", onWheel, { passive: true });
    root.addEventListener("touchstart", onTouchStart, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("touchstart", onTouchStart);
      resizeObserver?.disconnect();
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
          lastFollowAutoScrollAtRef.current = now;
          // Defer the scrollHeight read + scrollTop write to the next animation
          // frame. Inside rAF the browser has already flushed pending DOM
          // mutations and run layout, so reading scrollHeight does NOT force a
          // synchronous layout reflow. The prior synchronous
          // `root.scrollTop = root.scrollHeight` on every stream batch (this
          // effect fires per state.streaming identity change, ~20-30+×/sec)
          // forced the browser to flush pending DOM mutations on each batch and
          // saturated the main thread, which was the dominant cause of the
          // streaming lag/freezes users reported. Smooth scrolling resumes once
          // streaming ends because this effect stops firing.
          requestAnimationFrame(() => {
            if (!streamViewportRef.current.isFollowing) return;
            const el = messagesScrollRef.current;
            if (!el) return;
            el.scrollTop = el.scrollHeight;
          });
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
      // Count = currentLength - baseline. renderMessages.length grows only on
      // new canonical messages, so token updates don't inflate the badge. null
      // baseline = first entry after unfollow: capture then skip (delta is 0).
      if (unseenBaselineMessageCountRef.current === null) {
        unseenBaselineMessageCountRef.current = renderMessages.length;
        return;
      }
      const delta = Math.max(
        0,
        renderMessages.length - unseenBaselineMessageCountRef.current,
      );
      setStreamViewport((prev) =>
        prev.unseenUpdateCount === delta
          ? prev
          : { ...prev, unseenUpdateCount: delta },
      );
    }
  }, [renderMessages, state.streaming]);

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

  const isAiResponding = isProcessingInCurrentSession(
    state.isProcessing,
    state.currentSessionId,
    state.processingSessionIds,
  );
  const hasAnyRenderableConversation =
    renderMessages.length > 0 ||
    Boolean(state.streaming?.isActive);
  const hasLiveAssistantTurn = shouldDeferComposerSendInCurrentSession(
    state.currentSessionId,
    state.processingSessionIds,
    Boolean(state.streaming?.isActive),
    state.assistantTurnPending,
  );
  // Check if we're switching to a different session (loading conversation)
  // Uses the new isLoadingSession state which is set during session switches
  // Note: We don't check if loadingSessionId === currentSessionId because during
  // the transition, currentSessionId hasn't been updated yet (timing issue)
  const isSwitchingSession = false;
  const isConnecting = false;

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
  // FIXED: Use hasRenderableContent from SDK instead of checking content length.
  //
  // Loading must dismiss as soon as ANY visible streaming activity arrives —
  // not just text content. Tool calls, reasoning, progress events, and
  // interactive prompts all represent the assistant doing work that belongs
  // in the streaming card, not behind a ThinkingBubble placeholder. Keeping
  // the bubble up when these are already in state was causing users to see
  // "stuck loading" even though tool calls had arrived.
  const streamingForActivity = state.streaming;
  const hasRenderableStreamingContent = Boolean(
    streamingForActivity?.hasRenderableContent ||
      (streamingForActivity?.isActive &&
        ((streamingForActivity.reasoning?.length ?? 0) > 0 ||
          (streamingForActivity.reasoningEvents?.length ?? 0) > 0 ||
          (streamingForActivity.steps?.length ?? 0) > 0 ||
          (streamingForActivity.progressEvents?.length ?? 0) > 0 ||
          (streamingForActivity.interactiveEvents?.length ?? 0) > 0)),
  );

  let hasTerminalAssistantBlock = false;
  let terminalAssistantMessageId: string | null = null;
  let hasNewerUserMessageAfterTerminalAssistant = false;
  // The centralized tape is authoritative for a completed assistant turn. A
  // delayed progress/status event must not re-open its loading bubble after
  // the message has already reported `finish: "stop"`. We deliberately only
  // unlock this guard once a later user block (or a differently identified
  // live assistant turn) starts.
  for (let i = renderMessages.length - 1; i >= 0; i -= 1) {
    const message = renderMessages[i];
    const role = firstNonEmptyString(message.info?.role, message.role)
      ?.trim()
      .toLowerCase();
    if (role === "user") {
      hasNewerUserMessageAfterTerminalAssistant = true;
      continue;
    }
    if (role !== "assistant") {
      continue;
    }

    const rawEvents = (message as Record<string, unknown>).rawSdkEventPayloads;
    const hasTerminalFinishSignal =
      message.aborted === true ||
      message.info?.aborted === true ||
      message.finish === "stop" ||
      message.info?.finish === "stop" ||
      (Array.isArray(rawEvents) &&
        rawEvents.some((rawEvent) => {
          const raw = asRecord(rawEvent);
          const properties = asRecord(raw?.properties);
          const data = asRecord(raw?.data);
          const info =
            getCentralizedEventInfo(raw ?? {}) ??
            asRecord(properties?.info) ??
            asRecord(data?.info) ??
            asRecord(asRecord(data?.properties)?.info);
          const finish = firstNonEmptyString(
            info?.finish,
            raw?.finish,
            properties?.finish,
            data?.finish,
          )?.trim().toLowerCase();
          return (
            finish === "stop" ||
            finish === "length" ||
            finish === "done" ||
            finish === "completed" ||
            Boolean(asRecord(info?.time)?.completed)
          );
        }));

    if (hasTerminalFinishSignal) {
      hasTerminalAssistantBlock = true;
      terminalAssistantMessageId = firstNonEmptyString(
        message.info?.id,
        message.id,
      );
    }
    break;
  }

  const activeStreamingMessageId = firstNonEmptyString(state.streaming?.messageId);
  const hasStartedNewAssistantTurn =
    Boolean(state.streaming?.isActive) &&
    Boolean(activeStreamingMessageId) &&
    Boolean(terminalAssistantMessageId) &&
    activeStreamingMessageId !== terminalAssistantMessageId;
  const isAiResponseBlockFinished = Boolean(
    (state.streaming && !state.streaming.isActive) ||
    (hasTerminalAssistantBlock &&
      !hasNewerUserMessageAfterTerminalAssistant &&
      !hasStartedNewAssistantTurn)
  );

  const showAiResponseLoading =
    !state.isLoadingSession && // Direct state check to avoid timing issues
    hasLiveAssistantTurn &&
    !state.isCompacting &&
    !hasRenderableStreamingContent &&
    !isAiResponseBlockFinished;

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
    (loadingStartTimeRef.current &&
      loadingElapsedTime < LOADING_MIN_DISPLAY_MS &&
      !hasRenderableStreamingContent &&
      hasLiveAssistantTurn); // Extended for minimum duration

  useEffect(() => {
    if (!state.isLoadingSession && !showAiResponseLoading && !showExtendedLoading) {
      return;
    }
    logger.warn("[FORK_TRACE][SHELL] loading UI derived", {
      currentSessionId: state.currentSessionId,
      isLoadingSession: state.isLoadingSession,
      loadingSessionId: state.loadingSessionId,
      isProcessing: state.isProcessing,
      processingSessionIds: state.processingSessionIds,
      assistantTurnPending: state.assistantTurnPending,
      assistantTurnMessageId: state.assistantTurnMessageId,
      streamingActive: state.streaming?.isActive ?? false,
      streamingMessageId: state.streaming?.messageId ?? null,
      hasLiveAssistantTurn,
      isAiResponding,
      hasRenderableStreamingContent,
      isAiResponseBlockFinished,
      showAiResponseLoading,
      showExtendedLoading: Boolean(showExtendedLoading),
      renderedMessageCount: renderMessages.length,
    });
  }, [
    hasLiveAssistantTurn,
    hasRenderableStreamingContent,
    isAiResponding,
    isAiResponseBlockFinished,
    renderMessages.length,
    showAiResponseLoading,
    showExtendedLoading,
    state.assistantTurnMessageId,
    state.assistantTurnPending,
    state.currentSessionId,
    state.isLoadingSession,
    state.isProcessing,
    state.loadingSessionId,
    state.processingSessionIds,
    state.streaming?.isActive,
    state.streaming?.messageId,
  ]);

  const compactionDividerIndex =
    typeof state.compactionDividerIndex === "number"
      ? Math.max(
          0,
          Math.min(state.compactionDividerIndex, renderMessages.length),
        )
      : undefined;
  const hasCompactedSegment =
    typeof compactionDividerIndex === "number" && compactionDividerIndex > 0;
  const isCompressed = hasCompactedSegment && state.compactedMessagesCollapsed;
  const hiddenMessageCount = isCompressed ? compactionDividerIndex : 0;
  const visibleStartIndex = isCompressed ? compactionDividerIndex : 0;
  const rehydratedRenderBlocks = useMemo(
    () => buildRenderBlocks({ kind: "rehydrated", messages: renderMessages }),
    [renderMessages],
  );
  const liveRenderBlocks = useMemo(
    () => buildRenderBlocks({
      kind: "live",
      messages: renderMessages,
      streaming: presentedStreaming,
    }),
    [renderMessages, presentedStreaming],
  );
  const renderedLiveStreaming = liveRenderBlocks.find(
    (block): block is Extract<typeof block, { kind: "streaming" }> => block.kind === "streaming",
  )?.streaming;
  const conversationEntries = useMemo<ConversationRenderEntry[]>(() => {
    const messageBlocks = rehydratedRenderBlocks.filter(
      (block): block is Extract<typeof block, { kind: "message" }> => block.kind === "message",
    );
    const fileChangeBlocks = rehydratedRenderBlocks.filter(
      (block): block is Extract<typeof block, { kind: "fileChanges" }> => block.kind === "fileChanges",
    );
    const fileChangeBlockByOwnerId = new Map(
      fileChangeBlocks.map((block) => [block.ownerMessageId, block]),
    );
    const emittedFileChangeOwnerIds = new Set<string>();
    const entries: ConversationRenderEntry[] = [];

    for (let messageIndex = 0; messageIndex < messageBlocks.length; messageIndex += 1) {
      const { message } = messageBlocks[messageIndex];
      const messageId = firstNonEmptyString(message.id, message.info?.id) ?? `message:${messageIndex}`;
      const role = firstNonEmptyString(message.role, message.info?.role)?.toLowerCase();
      entries.push({
        kind: "message",
        key: messageId,
        message,
        messageIndex,
        order: entries.length,
        // `session.messages()` can include server-authored system envelopes.
        // Preserve that role here so the existing SystemMessage component is
        // selected instead of treating every non-user message as an assistant
        // response card.
        renderKind:
          role === "user" ? "user" : role === "system" ? "system" : "assistant",
      });

      // A session summary is carried by the SDK user envelope, but its visual
      // placement belongs after that turn's final assistant envelope. Keep the
      // data untouched and use the typed SDK parentID only to place its block.
      const ownerUserMessageId =
        role === "assistant" ? firstNonEmptyString(message.info?.parentID) : undefined;
      if (!ownerUserMessageId || emittedFileChangeOwnerIds.has(ownerUserMessageId)) {
        continue;
      }
      const nextMessage = messageBlocks[messageIndex + 1]?.message;
      const nextRole = firstNonEmptyString(nextMessage?.role, nextMessage?.info?.role)?.toLowerCase();
      const nextParentId = firstNonEmptyString(nextMessage?.info?.parentID);
      const isLastAssistantForUserTurn =
        nextRole !== "assistant" || nextParentId !== ownerUserMessageId;
      const fileChangeBlock = fileChangeBlockByOwnerId.get(ownerUserMessageId);
      if (!isLastAssistantForUserTurn || !fileChangeBlock) {
        continue;
      }
      emittedFileChangeOwnerIds.add(ownerUserMessageId);
      entries.push({
        kind: "fileChanges",
        key: `file-changes:${ownerUserMessageId}`,
        message: fileChangeBlock.message,
        ownerMessageId: ownerUserMessageId,
        order: entries.length,
      });
    }

    return entries;
  }, [rehydratedRenderBlocks]);
  const baseVisibleConversationEntries = useMemo(() => {
    if (!isCompressed) {
      return conversationEntries;
    }
    return getCollapsedConversationEntries(
      conversationEntries,
      visibleStartIndex,
    );
  }, [conversationEntries, isCompressed, visibleStartIndex]);

  const visibleConversationEntries = useMemo(() => {
    if (visiblePendingUserMessages.length === 0) {
      return baseVisibleConversationEntries;
    }

    const sortedPending = [...visiblePendingUserMessages].sort((a, b) => a.createdAt - b.createdAt);
    const combined: ConversationRenderEntry[] = [];
    let pendingIdx = 0;

    for (const entry of baseVisibleConversationEntries) {
      let entryTime = 0;
      if (entry.kind === "message") {
        entryTime = getCanonicalMessageCreatedAt(entry.message);
      } else if (entry.kind === "session.diff") {
        entryTime = entry.diff.createdAt ?? 0;
      } else if (entry.kind === "session.error") {
        entryTime = entry.error.createdAt ?? 0;
      }

      while (
        pendingIdx < sortedPending.length &&
        entryTime > 0 &&
        sortedPending[pendingIdx].createdAt < entryTime
      ) {
        const pending = sortedPending[pendingIdx];
        combined.push({
          kind: "message",
          key: `pending-user:${pending.id}`,
          message: pendingUserMessageToMessage(pending),
          messageIndex: -1,
          order: 0,
          renderKind: "user",
        });
        pendingIdx++;
      }
      combined.push(entry);
    }

    while (pendingIdx < sortedPending.length) {
      const pending = sortedPending[pendingIdx];
      combined.push({
        kind: "message",
        key: `pending-user:${pending.id}`,
        message: pendingUserMessageToMessage(pending),
        messageIndex: -1,
        order: 0,
        renderKind: "user",
      });
      pendingIdx++;
    }

    return combined;
  }, [baseVisibleConversationEntries, visiblePendingUserMessages]);
  const deferredVisibleConversationEntries = useDeferredValue(visibleConversationEntries);
  const transcriptScrollViewport =
    deferredVisibleConversationEntries.length >= VIRTUALIZED_TRANSCRIPT_MIN_ENTRIES
      ? scrollRenderViewport
      : STATIC_TRANSCRIPT_VIEWPORT;
  const visibleMessages = useMemo(
    () =>
      visibleConversationEntries
        .filter((entry): entry is Extract<ConversationRenderEntry, { kind: "message" }> =>
          entry.kind === "message",
        )
        .map((entry) => entry.message),
    [visibleConversationEntries],
  );
  const hasVisibleCentralizedSessionDiffEntries = useMemo(
    () => visibleConversationEntries.some((entry) => entry.kind === "session.diff"),
    [visibleConversationEntries],
  );
  // Group session.diff entries by the preceding user-message ID (block key).
  // Each AI-response block between two user messages gets its own diff card
  // rendered at the bottom of the last (non-collapsed) assistant message.
  // When a block has multiple diffs their files are merged into one card.
  const diffByBlockKey = useMemo(() => {
    const map = new Map<string, CentralizedSessionDiffEvent>();
    let currentBlockKey = "initial";
    for (let i = 0; i < visibleConversationEntries.length; i++) {
      const e = visibleConversationEntries[i];
      if (e.kind === "message") {
        const role = firstNonEmptyString(e.message.role, e.message.info?.role);
        if (role === "user") {
          currentBlockKey = firstNonEmptyString(e.message.info?.id, e.message.id) ?? `user:${i}`;
        }
      }
      if (e.kind === "session.diff") {
        const diff = (e as any).diff as CentralizedSessionDiffEvent | undefined;
        if (diff && Array.isArray(diff.files) && diff.files.length > 0) {
          const existing = map.get(currentBlockKey);
          if (existing) {
            map.set(currentBlockKey, { ...existing, files: [...existing.files, ...diff.files] });
          } else {
            map.set(currentBlockKey, diff);
          }
        }
      }
    }
    return map;
  }, [visibleConversationEntries]);
  // A rehydrated SDK summary belongs to its user envelope and is rendered as a
  // dedicated transcript row. Suppress only the matching assistant block's
  // generic file-change fallback, which may independently discover the same
  // edit from a patch/tool part.
  const hydratedFileChangesByBlockKey = useMemo(() => {
    const blockKeys = new Set<string>();
    let currentBlockKey = "initial";
    for (let index = 0; index < visibleConversationEntries.length; index += 1) {
      const entry = visibleConversationEntries[index];
      if (entry.kind === "message") {
        const role = firstNonEmptyString(entry.message.role, entry.message.info?.role);
        if (role === "user") {
          currentBlockKey = firstNonEmptyString(entry.message.info?.id, entry.message.id) ?? `user:${index}`;
        }
      }
      if (entry.kind === "fileChanges") {
        blockKeys.add(currentBlockKey);
      }
    }
    return blockKeys;
  }, [visibleConversationEntries]);
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
        .flatMap((message) => collectMessageIdentityCandidates(message))
        .filter((messageId): messageId is string => typeof messageId === "string" && messageId.length > 0),
    [renderMessages],
  );
  const errorToasts = state.errorMessages;

  useEffect(() => {
    if (errorToasts.length > 0 && config.debug.showBrowserConsole) {
      console.log("ERROR_FLOW: Error messages in ChatShell", {
        timestamp: new Date().toISOString(),
        errorCount: errorToasts.length,
        errorMessages: errorToasts,
      });
    }
  }, [errorToasts]);

  const jumpToLatest = () => {
    unseenBaselineMessageCountRef.current = null;
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

      {/* === LEFT: History sidebar overlay (hamburger-toggled, absolute positioned) === */}
      <HistorySidebar />

      {/* === MIDDLE: Main conversation column (flex-1, scrollable message list + input) === */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* FORBIDDEN TO REMOVE: StickyHeader (token/session stats) - core UX for token visibility */}
        <StickyHeader />

        {/* In-flow notification row: it reserves space instead of obscuring the transcript. */}
        <LiveEventBanner
          sessionId={state.currentSessionId}
          rawSdkEventPayloads={state.streaming?.rawSdkEventPayloads}
          liveNotifications={
            state.currentSessionId
              ? state.liveToastNotificationsBySessionId?.[state.currentSessionId]
              : undefined
          }
        />

        {/* Mobile-only extended panel summary and collapsible details */}
        <MobileRightSummary />

        {/* Message list */}
        <div
          ref={messagesScrollRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-2.5 sm:px-5"
          style={{ background: "var(--oc-chat-bg)" }}
        >
          {isSwitchingSession ? (
            <div className="flex h-full items-center justify-center">
              <SessionLoadingSpinner />
            </div>
          ) : (
            <>
              {!hasAnyRenderableConversation &&
              !state.streaming &&
              !isAiResponding ? (
                <EmptyState
                  serverStatus={state.serverStatus}
                  receivedInitState={state.receivedInitState}
                  currentSessionId={state.currentSessionId}
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

          <SdkEventDebugPanel />

          <MemoizedConversationTranscript
            blockExpandedState={blockExpandedState}
            compactionDividerIndex={compactionDividerIndex}
            currentSessionId={state.currentSessionId}
            diffByBlockKey={diffByBlockKey}
            hydratedFileChangesByBlockKey={hydratedFileChangesByBlockKey}
            hasLiveAssistantTurn={hasLiveAssistantTurn}
            assistantTurnMessageId={state.assistantTurnMessageId}
            interactiveEvents={deferredInteractiveEvents}
            isCompressed={isCompressed}
            isProcessing={state.isProcessing}
            lastCompactedAt={state.lastCompactedAt}
            onSetBlockExpanded={handleSetBlockExpanded}
            renderMessages={deferredRenderMessages}
            resolveAgentColor={resolveAgentColor}
            selectedAgent={state.selectedAgent}
            streamingAgent={deferredStreamingAgent}
            isStreamingActive={Boolean(state.streaming?.isActive)}
            subagentDetailsById={deferredSubagentDetailsById}
            subagentsByParentMessageId={deferredSubagentsByParentMessageId}
            todoItems={deferredTodoItems}
            visibleConversationEntries={deferredVisibleConversationEntries}
            scrollViewport={transcriptScrollViewport}
          />

              {!isCompressed && compactionDividerIndex === renderMessages.length ? (
                <CompactionDivider at={state.lastCompactedAt} />
              ) : null}

              {/* Keep the live wrapper only until the centralized transcript owns the
                  current assistant turn. After that, render a single assistant card
                  from the transcript so activity and response content stay unified. */}
          {!(hasTranscriptAssistantForCurrentTurn && !presentedStreaming?.isActive) ? (
            <StreamingCard
              streaming={renderedLiveStreaming}
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
              todoItems={state.todoItems}
            />
          ) : null}

          {/* Single loading indicator pinned to the bottom of the chat. */}
          {showExtendedLoading ? (
            <ThinkingBubble />
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
