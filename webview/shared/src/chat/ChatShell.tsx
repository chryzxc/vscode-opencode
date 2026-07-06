import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, X } from "lucide-react";

import { AppProvider, shallowEqual, useAppDispatch, useAppState } from "./lib/store";
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
  getBackgroundTaskReminderTaskId,
  hasBackgroundTaskLaunchForTaskId,
  isBackgroundTaskReminderMessage,
  isBackgroundTaskChildAssistantMessage,
} from "./lib/backgroundTaskOwnership";
import {
  isProcessingInCurrentSession,
  latestAssistantMessageIdFromCentralizedTape,
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
} from "./lib/conversationProjection";
import vscode from "./lib/vscode";
import logger from "./lib/logger";
import { config } from "../config";

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
  AIStatusTicker,
  BackgroundTaskReminderMessage,
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

type ConversationMessageRenderKind =
  | "user"
  | "assistant"
  | "system"
  | "permission"
  | "background-task-reminder"
  | "hidden";

function classifyConversationMessageRenderKind(params: {
  message: Message;
  rawSdkEventPayloads: unknown[];
  messages: Message[];
}): ConversationMessageRenderKind {
  const { message, rawSdkEventPayloads, messages } = params;
  const role = firstNonEmptyString(message.role, message.info?.role)?.toLowerCase() ?? "user";
  const text = firstNonEmptyString(
    message.content,
    message.text,
    message.info?.content,
    message.info?.text,
  ) ?? "";

  if (
    isBackgroundTaskChildAssistantMessage({
      message,
      rawSdkEventPayloads,
      messages,
    })
  ) {
    return "hidden";
  }

  if (isBackgroundTaskReminderMessage(message)) {
    const backgroundTaskId = getBackgroundTaskReminderTaskId(message);
    return hasBackgroundTaskLaunchForTaskId(rawSdkEventPayloads, backgroundTaskId)
      ? "hidden"
      : "background-task-reminder";
  }

  if (role === "system") {
    return text.length > 0 ? "system" : "hidden";
  }

  if ((message as Record<string, unknown>).type === "permission") {
    return "permission";
  }

  if (role === "user") {
    return "user";
  }

  return "assistant";
}

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

function buildCentralizedRenderMessages(rawSdkEventPayloads: unknown[]): Message[] {
  // Normalize the centralized tape once so this conversation builder only
  // consumes one canonical event envelope regardless of whether the original
  // payload was a direct `properties.part` event or a sync-wrapped event.
  const normalizedRawSdkEventPayloads = normalizeCentralizedEventPayloads(rawSdkEventPayloads);
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
    if (
      messageId &&
      isAssistantOwnedCentralizedPartEvent(
        event,
        part,
        assistantMessageIds,
        latestAssistantMessageId,
      )
    ) {
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
    // Prefer the latest duplicate as the visible canonical bubble because the
    // centralized tape often emits the final, fully wired user/assistant pair
    // after an earlier optimistic echo. Older ids are retained as aliases.
    const canonical = [...duplicateGroup].sort((left, right) => {
      const leftCreated = typeof left.createdAt === "number" ? left.createdAt : left.rawIndex;
      const rightCreated = typeof right.createdAt === "number" ? right.createdAt : right.rawIndex;
      if (leftCreated !== rightCreated) {
        return rightCreated - leftCreated;
      }
      return right.rawIndex - left.rawIndex;
    })[0];
    const canonicalAssistantIds =
      assistantDescriptorIdsByParent.get(canonical.messageId) ?? [];
    for (const duplicate of duplicateGroup) {
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

    merged.push({
      id: descriptor.messageId,
      role: "user",
      content: descriptor.text,
      text: descriptor.text,
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

    // For assistant messages, use the parentID (user message) as the parent message ID
    // This ensures subagents are associated with the user message that triggered them
    const role = firstNonEmptyString(message.role, message.info?.role)?.toLowerCase();

    const parentMessageId = role === "assistant"
      ? getCentralizedAssistantParentId(message, centralizedAssistantTurnIndex)
      : messageId;

    const { detailsById } = extractSubagentsFromCentralizedEvents(messageEvents, parentMessageId);

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
      renderKind: ConversationMessageRenderKind;
    }
  | {
      kind: "session.diff";
      key: string;
      diff: CentralizedSessionDiffEvent;
      order: number;
    }
  | {
      kind: "assistant.abort";
      key: string;
      messageId?: string;
      order: number;
    };

type CentralizedTranscriptProjection = {
  renderMessages: Message[];
  conversationEntries: ConversationRenderEntry[];
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

function buildCentralizedTranscriptProjection(
  rawSdkEventPayloads: unknown[],
): CentralizedTranscriptProjection {
  const normalizedRawSdkEventPayloads = normalizeCentralizedEventPayloads(rawSdkEventPayloads);
  const renderMessages = buildCentralizedRenderMessages(normalizedRawSdkEventPayloads);
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
    renderKind: classifyConversationMessageRenderKind({
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

  buildMessageConversationEntries(renderMessageEntries).forEach((entry) => {
    if (entry.kind !== "message") {
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
      order:
        countCanonicalMessagesAtOrBeforeRawIndex(
          renderMessageEntries,
          terminalRawIndex,
        ) * 10 + 7,
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
    const priorMessageCount = countCanonicalMessagesAtOrBeforeRawIndex(
      renderMessageEntries,
      rawIndex,
    );
    conversationEntries.push({
      kind: "session.diff",
      key: `session.diff:${diff.id ?? rawIndex}`,
      diff,
      order: priorMessageCount * 10 + 5,
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
    <div className="flex items-center justify-center">
      <AIStatusTicker />
    </div>
  );
}

function ChatContent() {
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
      compatibilityWarnings: appState.compatibilityWarnings,
      currentSessionId: appState.currentSessionId,
      errorMessages: appState.errorMessages,
      interactiveEvents: appState.interactiveEvents,
      isCompacting: appState.isCompacting,
      isLoadingSession: appState.isLoadingSession,
      isProcessing: appState.isProcessing,
      isSessionModalOpen: appState.isSessionModalOpen,
      lastCompactedAt: appState.lastCompactedAt,
      pendingDeferredPromptsBySessionId: appState.pendingDeferredPromptsBySessionId,
      pendingUserMessagesBySessionId: appState.pendingUserMessagesBySessionId,
      processingSessionIds: appState.processingSessionIds,
      rawSdkEventPayloadsBySessionId: appState.rawSdkEventPayloadsBySessionId,
      receivedInitState: appState.receivedInitState,
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
  // Hydrate last known session/centralized tape immediately on webview re-open so UI
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
        rawSdkEventPayloadsBySessionId?: Record<string, unknown[]>;
      };

      const sessionId =
        typeof parsed?.currentSessionId === "string" &&
        parsed.currentSessionId.trim().length > 0
          ? parsed.currentSessionId
          : null;
      const rawSdkEventPayloadsBySessionId =
        parsed?.rawSdkEventPayloadsBySessionId &&
        typeof parsed.rawSdkEventPayloadsBySessionId === "object"
          ? parsed.rawSdkEventPayloadsBySessionId
          : {};

      if (!sessionId) {
        return;
      }

      const cachedRawSdkEventPayloads = Array.isArray(
        rawSdkEventPayloadsBySessionId[sessionId],
      )
        ? rawSdkEventPayloadsBySessionId[sessionId]
        : [];

      dispatch({ type: "SET_SESSION_ID", payload: sessionId });
      if (cachedRawSdkEventPayloads.length > 0) {
        dispatch({
          type: "SET_RAW_SDK_EVENT_PAYLOADS",
          payload: { sessionId, events: cachedRawSdkEventPayloads },
        });
      }
    } catch {
      // best-effort hydration only
    }
  }, [dispatch]);

  // Persist a lightweight session/centralized-tape snapshot for fast restore across
  // sidebar/extension switches that recreate the webview.
  useEffect(() => {
    if (state.streaming?.isActive) {
      return;
    }
    try {
      const nextSnapshot = {
        currentSessionId: state.currentSessionId,
        rawSdkEventPayloadsBySessionId: state.rawSdkEventPayloadsBySessionId,
      };
      window.sessionStorage.setItem(
        WEBVIEW_BOOTSTRAP_CACHE_KEY,
        JSON.stringify(nextSnapshot),
      );
    } catch {
      // storage can fail in restricted webview scenarios; ignore gracefully
    }
  }, [state.currentSessionId, state.rawSdkEventPayloadsBySessionId, state.streaming?.isActive]);

  useEffect(() => {
    streamViewportRef.current = streamViewport;
  }, [streamViewport]);

  const centralizedSessionRawSdkEventPayloads =
    state.currentSessionId &&
    Array.isArray(state.rawSdkEventPayloadsBySessionId?.[state.currentSessionId])
      ? state.rawSdkEventPayloadsBySessionId[state.currentSessionId]
      : [];
  const transcriptProjection = useMemo(
    () => buildCentralizedTranscriptProjection(centralizedSessionRawSdkEventPayloads),
    [centralizedSessionRawSdkEventPayloads],
  );
  const renderMessages = transcriptProjection.renderMessages;
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
    state.receivedInitState,
    state.streaming?.isActive,
    renderMessages.length,
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
    centralizedSessionRawSdkEventPayloads.length > 0 ||
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
    hasLiveAssistantTurn &&
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
    (loadingStartTimeRef.current &&
      loadingElapsedTime < LOADING_MIN_DISPLAY_MS &&
      hasLiveAssistantTurn); // Extended for minimum duration

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
  const hasCentralizedSessionDiffEntries = useMemo(
    () =>
      centralizedSessionRawSdkEventPayloads.some((payload) => {
        const event = asRecord(payload);
        return event && firstNonEmptyString(event.type) === "session.diff";
      }),
    [centralizedSessionRawSdkEventPayloads],
  );
  const conversationEntries = transcriptProjection.conversationEntries;
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
        .flatMap((message) => collectMessageIdentityCandidates(message))
        .filter((messageId): messageId is string => typeof messageId === "string" && messageId.length > 0),
    [renderMessages],
  );
  const hasCompatibilityWarnings = state.compatibilityWarnings.length > 0;
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
        liveNotifications={
          state.currentSessionId
            ? state.liveToastNotificationsBySessionId?.[state.currentSessionId]
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
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-2.5 sm:px-5"
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
                  rawSdkEventPayloadsBySessionId={state.rawSdkEventPayloadsBySessionId}
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

            // Step 1 — assign a blockGroupKey to every entry in a single pass.
            // The key is the ID of the last user message seen before each entry,
            // so all assistant cards that appear between the same two user
            // messages share one key and collapse/expand as a single unit.
            const entryBlockKeys: string[] = [];
            let currentBlockKey = "initial";
            // Also collect assistant entry positions for step 2.
            const assistantBlockEntries: Array<{ index: number; key: string }> = [];
            for (let i = 0; i < visibleConversationEntries.length; i++) {
              const e = visibleConversationEntries[i];
              if (e.kind === "message") {
                const eRole = e.message.role ?? e.message.info?.role;
                if (eRole === "user") {
                  currentBlockKey =
                    firstNonEmptyString(e.message.info?.id, e.message.id) ??
                    `user:${i}`;
                } else if (eRole === "assistant") {
                  // Record the position now, after currentBlockKey has been set
                  // by the preceding user message.
                  assistantBlockEntries.push({ index: i, key: currentBlockKey });
                }
              }
              entryBlockKeys.push(currentBlockKey);
            }

            // Step 2 — compute block visibility roles for each assistant
            // entry by looking ONLY at adjacent ASSISTANT entries.
            // System messages, permission cards, and other non-assistant entries
            // share the block key but must NOT count as siblings — otherwise a
            // single AI card that follows a system message would be incorrectly
            // tagged as "last in a multi-card block" and lose its collapse button.
            const isFirstInBlockByIndex = new Map<number, boolean>();
            const isAbsoluteLastInBlockByIndex = new Map<number, boolean>();
            
            // Track the last entry that has text for each block key.
            // Why: In a multi-card block (e.g. multiple tool calls followed by a final response),
            // collapsing the block hides all the intermediate "timeline-only" cards.
            // If the absolute last card in the block has no text (e.g. just another tool call or a void completion),
            // and we hid the previous card (which actually contained the final text), the user would see a collapsed
            // block with NO textual response. To prevent this, we identify the LAST card in the block that ACTUALLY
            // has text, and treat THAT card as the "visible" anchor when collapsed.
            const lastTextIndexByKey = new Map<string, number>();
            for (let pos = 0; pos < assistantBlockEntries.length; pos++) {
              const { index, key } = assistantBlockEntries[pos];
              const msg = visibleConversationEntries[index].message;
              const hasText = Boolean(msg.content || msg.text || msg.info?.content || msg.info?.text);
              if (hasText) {
                lastTextIndexByKey.set(key, index);
              }
            }
            const isLastTextInBlockByIndex = new Map<number, boolean>();

            for (let pos = 0; pos < assistantBlockEntries.length; pos++) {
              const { index, key } = assistantBlockEntries[pos];
              const prevKey = pos > 0 ? assistantBlockEntries[pos - 1].key : null;
              const nextKey =
                pos < assistantBlockEntries.length - 1
                  ? assistantBlockEntries[pos + 1].key
                  : null;
              
              // First in block: no preceding assistant card with the same key.
              const isFirst = prevKey !== key;
              const isAbsoluteLast = nextKey !== key;
              isFirstInBlockByIndex.set(index, isFirst);

              // Only apply multi-card logic if the block has more than 1 card
              const isMultiCardBlock = prevKey === key || nextKey === key;
              isAbsoluteLastInBlockByIndex.set(index, isMultiCardBlock ? isAbsoluteLast : false);

              // Find the logical last entry for this block when collapsed
              const lastTextIndex = lastTextIndexByKey.get(key);
              let isLastText = false;
              if (isMultiCardBlock) {
                if (lastTextIndex !== undefined) {
                  isLastText = index === lastTextIndex;
                } else {
                  isLastText = isAbsoluteLast; // fallback to absolute last if no text
                }
              }
              isLastTextInBlockByIndex.set(index, isLastText);
            }

            // Count assistant cards per block so components can distinguish
            // single-card blocks (collapse individually) from multi-card blocks
            // (collapse as a unified group).
            const blockSizeByKey = new Map<string, number>();
            for (const { key } of assistantBlockEntries) {
              blockSizeByKey.set(key, (blockSizeByKey.get(key) ?? 0) + 1);
            }

            const renderedEntries = visibleConversationEntries.map((entry, entryIndex) => {
              const dividerHere = !isCompressed && compactionDividerIndex === messageCountSeen;
              if (entry.kind === "message") {
                const msg = entry.message;
                const idx = entry.messageIndex;
                const role = msg.role ?? msg.info?.role ?? "user";
                const prevIdx = idx - 1;
                const prevMsg =
                  prevIdx >= 0 ? renderMessages[prevIdx] : undefined;
                const isContiguous =
                  role === "assistant" &&
                  prevMsg?.role === "assistant" &&
                  (prevMsg.info?.agent === msg.info?.agent ||
                    (!prevMsg.info?.agent && !msg.info?.agent));
                /**
                 * Render invariant: never clear a centralized transcript card.
                 *
                 * During live streaming the StreamingCard may still be visible while
                 * the centralized tape is catching up. Once the tape has produced a
                 * transcript message, this branch must keep that message mounted and
                 * let StreamingCard suppress its own live-only duplicate. Do not add
                 * a `messageNode = null` branch here; that recreates the flicker where
                 * an already-rendered assistant block disappears mid-stream.
                 */
                let messageNode: JSX.Element | null;
                if (entry.renderKind === "user") {
                  messageNode = <UserMessage message={msg} />;
                } else if (entry.renderKind === "background-task-reminder") {
                  messageNode = (
                    <BackgroundTaskReminderMessage
                      message={msg}
                      messages={renderMessages}
                    />
                  );
                } else if (entry.renderKind === "system") {
                  const systemAgentId =
                    msg.info?.agent ?? state.streaming?.agent ?? state.selectedAgent;

                  messageNode = (
                    <SystemMessage
                      content={msg.content ?? msg.text ?? ""}
                      accentColor={resolveAgentColor(systemAgentId)}
                    />
                  );
                } else if (entry.renderKind === "permission") {
                  messageNode = <PermissionCard perm={msg} />;
                } else {
                  // All assistant cards between the same two user messages
                  // share a blockGroupKey (the preceding user message ID).
                  const blockGroupKey = entryBlockKeys[entryIndex];

                  // isFirstInBlock was pre-computed above
                  const isFirstInBlock = isFirstInBlockByIndex.get(entryIndex) ?? true;
                  const isAbsoluteLastInBlock = isAbsoluteLastInBlockByIndex.get(entryIndex) ?? false;
                  const isLastTextInBlock = isLastTextInBlockByIndex.get(entryIndex) ?? false;

                  // Total number of assistant cards in this block.
                  const blockSize = blockSizeByKey.get(blockGroupKey) ?? 1;

                  // The active block defaults to expanded while the AI is responding.
                  // When the AI finishes responding, it defaults to false (collapsed).
                  const isLiveBlock = hasLiveAssistantTurn && blockGroupKey === entryBlockKeys[entryBlockKeys.length - 1];
                  const isBlockExpanded = blockExpandedState.get(blockGroupKey) ?? (isLiveBlock ? true : false);

                  // The card that acts as the "last" card for UI purposes depends on whether the block is expanded!
                  // If expanded, the absolute last card gets the "Collapse" button.
                  // If collapsed, the last card WITH TEXT gets the "[X earlier steps collapsed]" pill (so it remains visible).
                  const isLastInBlock = isBlockExpanded ? isAbsoluteLastInBlock : isLastTextInBlock;

                  // Non-last cards in a multi-card block are hidden entirely
                  // when the block is collapsed. Only the "last" card remains
                  // visible as the "final AI response".
                  const isHiddenByBlock = blockSize > 1 && !isLastInBlock && !isBlockExpanded;

                  messageNode = (
                    <ResponseMessage
                      message={msg}
                      isContiguous={isContiguous}
                      interactiveEvents={state.interactiveEvents}
                      messages={renderMessages}
                      currentSessionId={state.currentSessionId}
                      hideFileChangesSection={hasCentralizedSessionDiffEntries}
                      subagentsByParentMessageId={state.subagentsByParentMessageId}
                      subagentDetailsById={state.subagentDetailsById}
                      todoItems={state.todoItems}
                      blockGroupKey={blockGroupKey}
                      isLastInBlock={isLastInBlock}
                      isBlockExpanded={isBlockExpanded}
                      blockSize={blockSize}
                      isHiddenByBlock={isHiddenByBlock}
                      onSetBlockExpanded={(expanded: boolean) =>
                        handleSetBlockExpanded(blockGroupKey, expanded)
                      }
                    />
                  );
                }

                /**
                 * CRITICAL: Do not hide assistant messages during rehydration or
                 * streaming.
                 *
                 * Assistant messages contain the canonical response body, subagent cards,
                 * and other centralized content. Never unmount one after it has rendered;
                 * the live StreamingCard can hide itself when the transcript owns the turn.
                 */
                messageCountSeen += 1;

                return (
                  <Fragment key={entry.key}>
                    {dividerHere ? <CompactionDivider at={state.lastCompactedAt} /> : null}
                    {messageNode}
                  </Fragment>
                );
              }

              if (entry.kind === "assistant.abort") {
                return (
                  <Fragment key={entry.key}>
                    {dividerHere ? <CompactionDivider at={state.lastCompactedAt} /> : null}
                    <div className="px-4">
                      <div className="mt-2 flex items-center justify-center">
                        <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium tracking-wide text-amber-400">
                          <div className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                          <span>Interrupted</span>
                        </div>
                      </div>
                    </div>
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
            const pendingEntries = visiblePendingUserMessages.map((pendingMessage) => (
              <UserMessage
                key={`pending-user:${pendingMessage.id}`}
                message={pendingUserMessageToMessage(pendingMessage)}
              />
            ));
            return [...renderedEntries, ...pendingEntries];
          })()}

              {!isCompressed && compactionDividerIndex === renderMessages.length ? (
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
