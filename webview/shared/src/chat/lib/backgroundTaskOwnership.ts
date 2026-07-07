import { getCentralizedEventPart } from "./messageHandler";

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
