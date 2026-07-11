import type { CentralizedSessionDiffEvent, Message } from "./types";

export type ProjectedConversationRenderKind = string;

export type ProjectedRenderMessageEntry = {
  message: Message;
  index: number;
  ids: string[];
  rawOrder: number;
  renderKind: ProjectedConversationRenderKind;
};

export type ProjectedConversationEntry =
  | {
      kind: "message";
      key: string;
      message: Message;
      messageIndex: number;
      order: number;
      renderKind: ProjectedConversationRenderKind;
    }
  | {
      kind: "session.diff";
      key: string;
      diff: CentralizedSessionDiffEvent;
      order: number;
    };

function firstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function getProjectedMessageTimestamp(message: Message): number | undefined {
  return firstFiniteNumber(
    message.created,
    (message as { createdAt?: number }).createdAt,
    message.info?.created,
    (message.info as { createdAt?: number } | undefined)?.createdAt,
    message.time?.created,
    message.info?.time?.created,
  );
}

/**
 * Convert already-canonical render messages into conversation entries.
 *
 * IMPORTANT:
 * Ordering is intentionally based on message creation time first, then raw tape
 * order as a tie-breaker.
 *
 * We still avoid rebuilding user/assistant grouping here, but relying only on
 * input array position left one remaining failure mode: centralized events for
 * a turn can arrive in a sequence that reorders the newest visible user bubble.
 * Using timestamps keeps the display aligned with when the user/system/assistant
 * messages were actually created, while `rawOrder` preserves deterministic
 * behavior when timestamps are missing or equal.
 */
export function buildMessageConversationEntries(
  renderMessageEntries: ProjectedRenderMessageEntry[],
): ProjectedConversationEntry[] {
  const conversationEntries: ProjectedConversationEntry[] = [];
  const orderedEntries = [...renderMessageEntries].sort((left, right) => {
    const leftTimestamp = getProjectedMessageTimestamp(left.message);
    const rightTimestamp = getProjectedMessageTimestamp(right.message);
    if (typeof leftTimestamp === "number" || typeof rightTimestamp === "number") {
      if (typeof leftTimestamp !== "number") {
        return 1;
      }
      if (typeof rightTimestamp !== "number") {
        return -1;
      }
      if (leftTimestamp !== rightTimestamp) {
        return leftTimestamp - rightTimestamp;
      }
    }
    if (left.rawOrder !== right.rawOrder) {
      return left.rawOrder - right.rawOrder;
    }
    return left.index - right.index;
  });

  let visibleIndex = 0;
  for (let index = 0; index < orderedEntries.length; index += 1) {
    const entry = orderedEntries[index];
    if (entry.renderKind === "hidden") {
      continue;
    }
    const messageId = entry.ids[0] ?? `idx:${entry.index}`;
    conversationEntries.push({
      kind: "message",
      key: `message:${messageId}`,
      message: entry.message,
      messageIndex: entry.index,
      order: visibleIndex * 10,
      renderKind: entry.renderKind,
    });
    visibleIndex++;
  }

  return conversationEntries;
}

/**
 * Count how many canonical message entries existed on or before a raw tape
 * index. Diff cards use this to place themselves relative to the one canonical
 * message order instead of owning a separate ordering system.
 *
 * Hidden assistant placeholders are intentionally excluded here. They are useful
 * for transcript reconstruction, but they do not consume visible vertical space
 * in the rendered conversation. Counting them would push `session.error` and
 * similar inline rows below later visible user messages.
 */
export function countCanonicalMessagesAtOrBeforeRawIndex(
  renderMessageEntries: ProjectedRenderMessageEntry[],
  rawIndex: number,
): number {
  return renderMessageEntries.filter(
    (entry) => entry.renderKind !== "hidden" && entry.rawOrder <= rawIndex,
  ).length;
}
