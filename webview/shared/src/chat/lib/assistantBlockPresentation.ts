/**
 * Presentation metadata for the contiguous assistant messages that belong to
 * one user turn. Keeping this separate from ChatShell prevents the collapsed,
 * expanded, and streaming render paths from independently deciding which card
 * is the top, visible, or final card in a response block.
 */
export interface AssistantBlockPresentationEntry {
  role?: string;
  /** Stable user message id, supplied only for user entries. */
  userBlockKey?: string;
  /**
   * Stable assistant message id. When available, an SDK message envelope is
   * its own response block even when it shares a parent user message with
   * another assistant envelope (for example, a tool-call turn then a final
   * answer).
   */
  assistantBlockKey?: string;
  /** True when the assistant entry has user-visible response text. */
  hasResponseText?: boolean;
  /** True when an aborted assistant entry must be represented inline. */
  hasInlineAbort?: boolean;
  /** Exact structured activity snapshot for an activity-only assistant entry. */
  activitySnapshotKey?: string;
}

export interface AssistantBlockPresentation {
  /** The response-block key in effect for every transcript entry. */
  entryBlockKeys: string[];
  /** The first assistant card in each response block. */
  isFirstInBlockByIndex: Map<number, boolean>;
  /** The physical final assistant card, used while the block is expanded. */
  isAbsoluteLastInBlockByIndex: Map<number, boolean>;
  /** The last text-bearing assistant card, used while the block is collapsed. */
  isLastTextInBlockByIndex: Map<number, boolean>;
  blockSizeByKey: Map<string, number>;
  blockHasInlineAbortByKey: Map<string, boolean>;
  /** Activity-only SDK fragments that repeat an earlier identical snapshot in the same turn. */
  isDuplicateActivityByIndex: Map<number, boolean>;
}

/**
 * Build all response-block facts in one pass over normalized transcript
 * entries. A collapsed block must retain its last text-bearing card, while an
 * expanded or live block must retain every card and put block metadata on the
 * first one. Those are presentation rules, not message-data mutations.
 */
export function buildAssistantBlockPresentation(
  entries: AssistantBlockPresentationEntry[],
): AssistantBlockPresentation {
  const entryBlockKeys: string[] = [];
  const assistantEntries: Array<{ index: number; key: string }> = [];
  let currentBlockKey = "initial";

  entries.forEach((entry, index) => {
    const role = entry.role?.toLowerCase();
    if (role === "user") {
      currentBlockKey = entry.userBlockKey || `user:${index}`;
    } else if (role === "assistant") {
      const assistantBlockKey = entry.assistantBlockKey?.trim();
      // Transcript order is authoritative for visible response ownership. SDK
      // question continuations can reuse the original parentID even after a
      // user answer has been inserted, so parentID must not pull that later
      // assistant card back into the previous response block. Contiguous
      // assistant phases stay together under the current user turn; the
      // assistant key is only a fallback before the first user entry exists.
      const key = currentBlockKey !== "initial"
        ? currentBlockKey
        : assistantBlockKey || currentBlockKey;
      assistantEntries.push({ index, key });
      entryBlockKeys.push(key);
      return;
    }
    entryBlockKeys.push(currentBlockKey);
  });

  const lastTextIndexByKey = new Map<string, number>();
  for (const { index, key } of assistantEntries) {
    if (entries[index]?.hasResponseText) {
      lastTextIndexByKey.set(key, index);
    }
  }

  const isFirstInBlockByIndex = new Map<number, boolean>();
  const isAbsoluteLastInBlockByIndex = new Map<number, boolean>();
  const isLastTextInBlockByIndex = new Map<number, boolean>();
  const blockSizeByKey = new Map<string, number>();
  const blockHasInlineAbortByKey = new Map<string, boolean>();
  const isDuplicateActivityByIndex = new Map<number, boolean>();
  const seenActivitySnapshotsByBlock = new Map<string, Set<string>>();

  assistantEntries.forEach(({ index, key }, position) => {
    const previousKey = position > 0 ? assistantEntries[position - 1].key : undefined;
    const nextKey = position < assistantEntries.length - 1
      ? assistantEntries[position + 1].key
      : undefined;
    const isMultiCardBlock = previousKey === key || nextKey === key;
    const isAbsoluteLast = nextKey !== key;

    isFirstInBlockByIndex.set(index, previousKey !== key);
    isAbsoluteLastInBlockByIndex.set(index, isMultiCardBlock && isAbsoluteLast);
    const lastTextIndex = lastTextIndexByKey.get(key);
    isLastTextInBlockByIndex.set(
      index,
      isMultiCardBlock && (
        lastTextIndex === undefined ? isAbsoluteLast : lastTextIndex === index
      ),
    );
    blockSizeByKey.set(key, (blockSizeByKey.get(key) ?? 0) + 1);
    const activitySnapshotKey = entries[index]?.activitySnapshotKey;
    if (activitySnapshotKey) {
      const seenSnapshots = seenActivitySnapshotsByBlock.get(key) ?? new Set<string>();
      isDuplicateActivityByIndex.set(index, seenSnapshots.has(activitySnapshotKey));
      seenSnapshots.add(activitySnapshotKey);
      seenActivitySnapshotsByBlock.set(key, seenSnapshots);
    }
    if (entries[index]?.hasInlineAbort) {
      blockHasInlineAbortByKey.set(key, true);
    }
  });

  return {
    entryBlockKeys,
    isFirstInBlockByIndex,
    isAbsoluteLastInBlockByIndex,
    isLastTextInBlockByIndex,
    blockSizeByKey,
    blockHasInlineAbortByKey,
    isDuplicateActivityByIndex,
  };
}
