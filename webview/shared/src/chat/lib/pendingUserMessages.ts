import type { Message, PendingUserMessage } from "./types";

export const PENDING_CURRENT_SESSION_KEY = "__pending__:current";

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function normalizeComparableText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function getMessageRole(message: Message): string {
  return firstNonEmptyString(message.role, message.info?.role)?.toLowerCase() ?? "";
}

function getMessageText(message: Message): string {
  return firstNonEmptyString(
    message.content,
    message.text,
    message.info?.content,
    message.info?.text,
  ) ?? "";
}

function getMessageCreatedAt(message: Message): number | undefined {
  if (typeof message.created === "number") {
    return message.created;
  }
  if (typeof message.info?.created === "number") {
    return message.info.created;
  }
  if (typeof message.time?.created === "number") {
    return message.time.created;
  }
  if (typeof message.info?.time?.created === "number") {
    return message.info.time.created;
  }
  return undefined;
}

function isRepresentedByCentralizedMessage(
  pending: PendingUserMessage,
  message: Message,
): boolean {
  if (getMessageRole(message) !== "user") {
    return false;
  }
  const messageId = firstNonEmptyString(message.info?.id, message.id, message.messageId);
  if (
    pending.confirmedMessageId &&
    messageId &&
    pending.confirmedMessageId === messageId
  ) {
    return true;
  }
  if (normalizeComparableText(getMessageText(message)) !== normalizeComparableText(pending.text)) {
    return false;
  }

  const centralizedCreatedAt = getMessageCreatedAt(message);
  if (typeof centralizedCreatedAt !== "number") {
    return true;
  }

  return Math.abs(centralizedCreatedAt - pending.createdAt) <= 30_000;
}

export function pendingUserMessageToMessage(pending: PendingUserMessage): Message {
  return {
    id: pending.id,
    role: "user",
    content: pending.text,
    text: pending.text,
    createdAt: pending.createdAt,
    interactiveSubmit: pending.interactiveSubmit,
    sessionID: pending.sessionId,
    info: {
      id: pending.id,
      role: "user",
      createdAt: pending.createdAt,
      time: {
        created: pending.createdAt,
      },
    },
    parts: [
      {
        type: "text",
        text: pending.text,
      },
    ],
    images: pending.images,
    created: pending.createdAt,
    time: {
      created: pending.createdAt,
    },
  };
}

export function getVisiblePendingUserMessages(
  pendingMessages: PendingUserMessage[],
  centralizedMessages: Message[],
): PendingUserMessage[] {
  // Visibility is decided only by whether the canonical transcript now contains
  // a matching recent user turn. We do not attempt to merge or reorder here;
  // this helper only answers "should the optimistic overlay still be visible?"
  return pendingMessages.filter(
    (pending) =>
      !centralizedMessages.some((message) =>
        isRepresentedByCentralizedMessage(pending, message),
      ),
  );
}

export function getRepresentedPendingUserMessageIds(
  pendingMessages: PendingUserMessage[],
  centralizedMessages: Message[],
): string[] {
  // Once the centralized tape owns a user turn, the optimistic overlay should
  // be removed by id so React does not render both copies during the handoff.
  return pendingMessages
    .filter((pending) =>
      centralizedMessages.some((message) =>
        isRepresentedByCentralizedMessage(pending, message),
      ),
    )
    .map((pending) => pending.id);
}

export function getPendingUserMessageIdsForClientRequest(
  pendingMessages: PendingUserMessage[],
  clientRequestId: string,
): string[] {
  const normalizedRequestId = clientRequestId.trim();
  if (!normalizedRequestId) {
    return [];
  }
  return pendingMessages
    .filter((pending) => pending.clientRequestId === normalizedRequestId)
    .map((pending) => pending.id);
}
