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

function hasInjectedSystemPromptShape(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    /^\[[^\]]+\]/.test(normalized) ||
    /^<[^>]+>/.test(normalized) ||
    /^\/\*/.test(normalized)
  );
}

function splitInjectedSystemPromptFromUserText(raw: string): string {
  // Keep this normalization aligned with `UserMessage` rendering.
  //
  // Search-mode / slash-skill sends can be persisted as one user message whose
  // raw text contains both:
  // 1. an injected transport/system reminder ("[search-mode] ..."), and
  // 2. the actual user prompt after a `---` separator.
  //
  // The conversation UI renders only the trailing user portion as the bubble
  // text and lifts the injected prefix into a separate system card. If pending
  // reconciliation compares the optimistic bubble against the un-split raw
  // centralized text, the optimistic copy survives and renders a duplicate user
  // bubble at the bottom during streaming. Always compare using the same
  // user-visible text shape that `UserMessage` uses.
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

function getMessageRole(message: Message): string {
  return firstNonEmptyString(message.role, message.info?.role)?.toLowerCase() ?? "";
}

function getMessageIdentityCandidates(message: Message): string[] {
  // Centralized transcript dedupe can collapse multiple user IDs into one
  // visible bubble and retain the older IDs inside `coalescedIds`. Pending
  // reconciliation must treat any of those IDs as ownership of the same turn,
  // otherwise the optimistic overlay can linger even though the canonical user
  // message is already on screen.
  const primaryId = firstNonEmptyString(message.info?.id, message.id, message.messageId);
  const coalescedIds = Array.isArray((message as { coalescedIds?: unknown }).coalescedIds)
    ? ((message as { coalescedIds?: unknown[] }).coalescedIds ?? []).filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    )
    : [];
  return Array.from(new Set([primaryId, ...coalescedIds].filter(Boolean) as string[]));
}

function getMessageText(message: Message): string {
  const raw = firstNonEmptyString(
    message.content,
    message.text,
    message.info?.content,
    message.info?.text,
  ) ?? "";
  return splitInjectedSystemPromptFromUserText(raw);
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
  // Strongest ownership signal: once the optimistic bubble has been confirmed
  // against a host echo, prefer ID-based matching over text matching. Note that
  // the confirmed ID may later appear as either the canonical visible ID or a
  // coalesced alias after centralized dedupe.
  if (
    pending.confirmedMessageId &&
    getMessageIdentityCandidates(message).includes(pending.confirmedMessageId)
  ) {
    return true;
  }
  // Fallback ownership signal: compare normalized user-visible text, not the
  // raw centralized payload. This is essential for search-mode/system-injected
  // user messages where the persisted raw text includes a system prelude that
  // is rendered separately from the user bubble.
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
  // Pending overlay messages should look like normal user messages to the
  // renderer, including timestamps, so the optimistic bubble and the canonical
  // bubble occupy the same visual shape during handoff.
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
      ...(pending.attachments ?? []).map((attachment) => ({
        type: "file" as const,
        mime: attachment.mimeType,
        filename: attachment.filename,
        url: attachment.dataUrl,
      })),
    ],
    images: pending.images,
    attachments: pending.attachments,
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
  // this helper only answers "should the optimistic overlay still be visible?".
  //
  // This intentionally allows a confirmed optimistic bubble to stay rendered
  // for a short time after `userMessageAppended` if the centralized tape has
  // not yet produced the owning user message. Removing it earlier causes the
  // "message disappears right when the assistant starts responding" gap.
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
