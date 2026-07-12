import {
  getCentralizedEventInfo,
  getCentralizedEventPart,
  getCentralizedEventType,
} from "./messageHandler";

import type { Message } from "./types";

export type ParsedBackgroundTaskReminder = {
  taskId?: string;
  description?: string;
  duration?: string;
  statusLine?: string;
};

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getMessageAndCoalescedIds(message: Message): string[] {
  const ids = [
    firstNonEmptyString(message.info?.id, message.id, message.messageId),
    ...(Array.isArray((message as Record<string, unknown>).coalescedIds)
      ? ((message as Record<string, unknown>).coalescedIds as string[])
      : []),
  ];
  return Array.from(
    new Set(
      ids.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      ),
    ),
  );
}

function getCentralizedEventMessageId(payload: unknown): string | undefined {
  const part = getCentralizedEventPart(payload);
  const info = getCentralizedEventInfo(payload);
  return firstNonEmptyString(
    part?.messageID,
    part?.messageId,
    info?.id,
    info?.messageID,
    info?.messageId,
  );
}

/**
 * Determines whether a would-be main-transcript message is actually emitted
 * by a child/subagent session.
 *
 * Important centralized-tape contract:
 * - The parent chat intentionally retains forwarded child events in its raw
 *   tape. The subagent card/modal reads that same tape to build its activity
 *   timeline and conversation.
 * - A forwarded event has two session identities: its outer envelope
 *   (`event.sessionId`) remains the parent session for routing/persistence,
 *   while the event payload (`properties.sessionID`, `part.sessionID`, or
 *   `info.sessionID`) names the child session that actually produced it.
 * - Therefore a child text part can look exactly like an ordinary assistant
 *   response if a transcript renderer only considers `role` and `messageID`.
 *   Rendering it in the main list duplicates subagent work as a parent AI
 *   response.
 *
 * This is deliberately a visibility decision only. Do not remove, rewrite,
 * or filter these raw events at ingestion: doing so would break the subagent
 * detail timeline, tool steps, and hydrated conversation. The main transcript
 * must simply return `hidden` for messages whose scoped session differs from
 * their parent-tape envelope session.
 *
 * The comparison requires both IDs, so ordinary current-session events and
 * incomplete/legacy events without explicit session metadata stay visible.
 */
export function isCrossSessionSubagentMessage(params: {
  message: Message | undefined;
  rawSdkEventPayloads: unknown[];
}): boolean {
  const { message, rawSdkEventPayloads } = params;
  if (!message || !Array.isArray(rawSdkEventPayloads)) {
    return false;
  }

  const messageIds = new Set(getMessageAndCoalescedIds(message));
  if (messageIds.size === 0) {
    return false;
  }

  // Prefer the message-scoped event slice built by the centralized renderer.
  // Its coalesced aliases ensure that a duplicate/rehydrated message cannot
  // escape this ownership check. The full tape fallback supports callers that
  // only have a normalized Message shell.
  const messageEvents = Array.isArray(message.rawSdkEventPayloads)
    ? message.rawSdkEventPayloads
    : rawSdkEventPayloads.filter((payload) => {
        const messageId = getCentralizedEventMessageId(payload);
        return !!messageId && messageIds.has(messageId);
      });

  return messageEvents.some((payload) => {
    const event = asRecord(payload);
    if (!event) {
      return false;
    }
    const properties = asRecord(event.properties);
    const syncData = asRecord(asRecord(event.syncEvent)?.data);
    const part = getCentralizedEventPart(payload);
    const info = getCentralizedEventInfo(payload);
    // Never compare `event.sessionId` with itself after normalization. The
    // outer field is the parent routing envelope; the scoped fields below are
    // the authoritative producer session for this specific message/part.
    const envelopeSessionId = firstNonEmptyString(event.sessionId, event.sessionID);
    const scopedSessionId = firstNonEmptyString(
      part?.sessionID,
      part?.sessionId,
      info?.sessionID,
      info?.sessionId,
      properties?.sessionID,
      properties?.sessionId,
      syncData?.sessionID,
      syncData?.sessionId,
    );
    return !!envelopeSessionId && !!scopedSessionId && envelopeSessionId !== scopedSessionId;
  });
}

function extractMessageTextForReminderLookup(message: Message | undefined): string {
  if (!message) {
    return "";
  }

  const direct = firstNonEmptyString(
    message.content,
    message.text,
    message.info?.content,
    message.info?.text,
  );
  if (direct) {
    return direct;
  }

  if (!Array.isArray(message.parts)) {
    return "";
  }

  return message.parts
    .map((part) => firstNonEmptyString(part.text, part.content, part.message) ?? "")
    .filter((text) => text.length > 0)
    .join("\n");
}

export function extractReminderMessageTextForId(
  rawSdkEventPayloads: unknown[] | undefined,
  messageId: string | null | undefined,
  messages?: Message[],
): string {
  if (!messageId) {
    return "";
  }

  const sourceMessage = Array.isArray(messages)
    ? messages.find((candidate) => getMessageAndCoalescedIds(candidate).includes(messageId))
    : undefined;
  const sourceText = extractMessageTextForReminderLookup(sourceMessage);
  if (sourceText) {
    return sourceText;
  }

  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return "";
  }

  let best = "";
  for (const payload of rawSdkEventPayloads) {
    const part = getCentralizedEventPart(payload);
    const partMessageId = firstNonEmptyString(part?.messageID, part?.messageId);
    if (partMessageId !== messageId) {
      continue;
    }
    const partType = firstNonEmptyString(part?.type)?.toLowerCase();
    if (partType !== "text") {
      continue;
    }
    const text = firstNonEmptyString(part?.text, part?.content, part?.message) ?? "";
    if (text.length > best.length) {
      best = text;
    }
  }

  return best;
}

export function backgroundTaskIdFromReminderText(text: string): string | undefined {
  const match = text.match(/background_output\(task_id="([^"]+)"\)/i);
  return match?.[1]?.trim() || undefined;
}

export function getBackgroundTaskReminderTaskId(
  message: Message | undefined,
): string | undefined {
  const text = extractMessageTextForReminderLookup(message);
  if (!text) {
    return undefined;
  }
  const parsed = parseBackgroundTaskReminderText(text);
  return parsed.taskId || backgroundTaskIdFromReminderText(text);
}

export function parseBackgroundTaskReminderText(text: string): ParsedBackgroundTaskReminder {
  const normalized = text.trim();
  if (!normalized) {
    return {};
  }

  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const idLine = lines.find((line) => /^\*\*id:\*\*/i.test(line));
  const descriptionLine = lines.find((line) => /^\*\*description:\*\*/i.test(line));
  const durationLine = lines.find((line) => /^\*\*duration:\*\*/i.test(line));
  const statusLine = lines.find(
    (line) =>
      /\btask(?:s)? still in progress\b/i.test(line) ||
      /\byou will be notified when all complete\b/i.test(line),
  );

  const taskIdFromLine = idLine?.match(/`([^`]+)`/)?.[1]?.trim();
  const taskId = taskIdFromLine || backgroundTaskIdFromReminderText(normalized);
  const description = descriptionLine
    ?.replace(/^\*\*description:\*\*/i, "")
    .trim();
  const duration = durationLine
    ?.replace(/^\*\*duration:\*\*/i, "")
    .trim();

  return {
    taskId: taskId || undefined,
    description: description || undefined,
    duration: duration || undefined,
    statusLine: statusLine || undefined,
  };
}

export function isBackgroundTaskReminderText(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("[background task completed]") ||
    normalized.includes("background_output(task_id=")
  );
}

export function isBackgroundTaskReminderMessage(message: Message | undefined): boolean {
  if (!message) {
    return false;
  }
  const text = extractMessageTextForReminderLookup(message);
  return text.length > 0 && isBackgroundTaskReminderText(text);
}

export function getBackgroundTaskParentMessageId(
  message: Message | undefined,
): string | undefined {
  if (!message) {
    return undefined;
  }
  return firstNonEmptyString(
    message.info?.parentID,
    message.info?.parentId,
    (asRecord(message)?.parentID as string | undefined),
    (asRecord(message)?.parentId as string | undefined),
  );
}

export function getBackgroundTaskChildAssistantMessages(
  messages: Message[] | undefined,
  reminderMessageId: string | null | undefined,
): Message[] {
  if (!reminderMessageId || !Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((candidate) => {
      const role = firstNonEmptyString(candidate.role, candidate.info?.role)?.toLowerCase();
      return role === "assistant" && getBackgroundTaskParentMessageId(candidate) === reminderMessageId;
    })
    .sort((left, right) => {
      const leftCreated =
        typeof left.created === "number"
          ? left.created
          : typeof left.info?.created === "number"
            ? left.info.created
            : typeof asRecord(left.info?.time)?.created === "number"
              ? (asRecord(left.info?.time)?.created as number)
              : 0;
      const rightCreated =
        typeof right.created === "number"
          ? right.created
          : typeof right.info?.created === "number"
            ? right.info.created
            : typeof asRecord(right.info?.time)?.created === "number"
              ? (asRecord(right.info?.time)?.created as number)
              : 0;
      return leftCreated - rightCreated;
    });
}

export function findBackgroundTaskReminderMessageByTaskId(
  messages: Message[] | undefined,
  taskId: string | undefined,
): Message | undefined {
  const normalizedTaskId = firstNonEmptyString(taskId);
  if (!normalizedTaskId || !Array.isArray(messages)) {
    return undefined;
  }

  return messages.find((message) => {
    if (!isBackgroundTaskReminderMessage(message)) {
      return false;
    }
    return getBackgroundTaskReminderTaskId(message) === normalizedTaskId;
  });
}

export function hasBackgroundTaskLaunchForTaskId(
  rawSdkEventPayloads: unknown[] | undefined,
  taskId: string | undefined,
): boolean {
  const normalizedTaskId = firstNonEmptyString(taskId);
  if (!normalizedTaskId || !Array.isArray(rawSdkEventPayloads)) {
    return false;
  }

  for (const payload of rawSdkEventPayloads) {
    const part = getCentralizedEventPart(payload);
    const tool = firstNonEmptyString(part?.tool, part?.name)?.toLowerCase();
    if (tool !== "call_omo_agent") {
      continue;
    }

    const state = asRecord(part?.state);
    const input = asRecord(state?.input);
    const output = firstNonEmptyString(state?.output, part?.output) ?? "";
    const candidateTaskId =
      firstNonEmptyString(
        input?.task_id,
        input?.taskId,
        (asRecord(state?.metadata)?.task_id as string | undefined),
        (asRecord(state?.metadata)?.taskId as string | undefined),
      ) ||
      output.match(/task id:\s*(bg_[a-z0-9]+)/i)?.[1]?.trim();

    if (candidateTaskId === normalizedTaskId) {
      return true;
    }
  }

  return false;
}

export function isBackgroundTaskChildAssistantMessage(params: {
  message: Message | undefined;
  rawSdkEventPayloads: unknown[];
  messages?: Message[];
}): boolean {
  const { message, rawSdkEventPayloads, messages } = params;
  if (!message) {
    return false;
  }

  const role = firstNonEmptyString(message.role, message.info?.role)?.toLowerCase();
  if (role !== "assistant") {
    return false;
  }

  const parentMessageId = getBackgroundTaskParentMessageId(message);
  if (!parentMessageId) {
    return false;
  }

  const parentReminderText = extractReminderMessageTextForId(
    rawSdkEventPayloads,
    parentMessageId,
    messages,
  );
  if (
    !parentReminderText ||
    !isBackgroundTaskReminderText(parentReminderText)
  ) {
    return false;
  }

  return true;
}

/**
 * Subagent sessions begin with a server-authored user message so the child
 * agent receives its assignment. That transport message can be present in the
 * parent session's centralized tape, but it is not a prompt written by the
 * person using the chat and must not create a user bubble there.
 *
 * `prt_` is deliberately not used as an identifier: it is the normal prefix
 * for every message part. Instead, resolve the part's messageID to its
 * message.updated parent and require the explicit initiator protocol marker
 * plus the child-agent metadata supplied by the server.
 */
export function isSubagentInitiatorMessage(params: {
  message: Message | undefined;
  rawSdkEventPayloads: unknown[];
}): boolean {
  const { message, rawSdkEventPayloads } = params;
  if (!message || !Array.isArray(rawSdkEventPayloads)) {
    return false;
  }

  const role = firstNonEmptyString(message.role, message.info?.role)?.toLowerCase();
  if (role !== "user") {
    return false;
  }

  const messageId = firstNonEmptyString(message.info?.id, message.id, message.messageId);
  if (!messageId) {
    return false;
  }

  const text = extractMessageTextForReminderLookup(message).toLowerCase();
  if (!text.includes("<!-- omo_internal_initiator -->")) {
    return false;
  }

  return rawSdkEventPayloads.some((payload) => {
    if (getCentralizedEventType(payload) !== "message.updated") {
      return false;
    }
    const info = getCentralizedEventInfo(payload);
    const eventMessageId = firstNonEmptyString(info?.id, info?.messageID, info?.messageId);
    const eventRole = firstNonEmptyString(info?.role)?.toLowerCase();
    const agent = firstNonEmptyString(info?.agent);
    return eventMessageId === messageId && eventRole === "user" && !!agent;
  });
}
