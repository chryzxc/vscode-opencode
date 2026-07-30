import type { AppState, StreamingState } from "./types";

function normalizeComparableText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Bridge assistant phase IDs only when the current turn already renders the same response. */
export function hasMatchingTranscriptContent(
  streaming: StreamingState | null | undefined,
  transcriptAssistantContents: string[] = [],
): boolean {
  const content = normalizeComparableText(streaming?.content ?? "");
  if (!content) return false;
  return transcriptAssistantContents.some((candidate) => {
    const transcriptContent = normalizeComparableText(candidate);
    return transcriptContent === content || transcriptContent.includes(content);
  });
}

/** Keep live activity, but do not paint text already owned by the transcript. */
export function suppressDuplicateStreamingContent(
  streaming: StreamingState,
  transcriptAssistantContents: string[] = [],
): StreamingState {
  const content = normalizeComparableText(streaming.content);
  // The live text may be a partial snapshot while the transcript already has
  // the completed version of that same response. Exact equality is too weak:
  // it lets the same AI response appear once in the transcript and once in
  // the activity-preserving live overlay. Suppress only when the transcript
  // contains the whole live snapshot; a genuinely newer live suffix remains
  // visible until the transcript catches up.
  if (!content || !hasMatchingTranscriptContent(streaming, transcriptAssistantContents)) {
    return streaming;
  }

  return {
    ...streaming,
    content: "",
    hasRenderableContent: false,
    responseChunks: [],
  };
}

export type ShouldShowStreamingCardInput = {
  streaming: StreamingState | null;
  interactiveEvents?: AppState["interactiveEvents"];
  assistantTurnMessageId?: AppState["assistantTurnMessageId"];
  transcriptAssistantMessageIds?: string[];
  hasTranscriptAssistantForCurrentTurn?: boolean;
  subagentsByParentMessageId?: AppState["subagentsByParentMessageId"];
};

export function shouldShowStreamingCard({
  streaming,
  interactiveEvents,
  assistantTurnMessageId,
  transcriptAssistantMessageIds,
  hasTranscriptAssistantForCurrentTurn,
  subagentsByParentMessageId,
}: ShouldShowStreamingCardInput): boolean {
  if (!streaming) return false;

  const candidateIds = new Set(
    [streaming.messageId, assistantTurnMessageId]
      .filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0,
      )
      .map((value) => value.trim()),
  );

  const hasMatchingAssistantTurnInTranscript =
    candidateIds.size > 0 &&
    Array.isArray(transcriptAssistantMessageIds) &&
    transcriptAssistantMessageIds.some((messageId) => candidateIds.has(messageId));

  // OpenCode can interleave several response messages with reasoning and tool
  // activity in one assistant turn. Transcript text is therefore not a handoff
  // signal while events are still arriving: hiding the live card drops the
  // following activity/response phases from the UI. Hand off only after the
  // explicit assistant-finish lifecycle signal and a rendered transcript
  // response for this exact turn.
  if (
    hasMatchingAssistantTurnInTranscript &&
    !streaming.isActive &&
    hasTranscriptAssistantForCurrentTurn
  ) {
    return false;
  }

  const hasRenderableText =
    streaming.hasRenderableContent === true &&
    streaming.content.trim().length > 0;
  if (hasRenderableText) return true;
  if (streaming.reasoning.trim().length > 0) return true;
  if (
    Array.isArray(streaming.reasoningEvents) &&
    streaming.reasoningEvents.length > 0
  ) {
    return true;
  }
  if (streaming.edits.length > 0) return true;
  if (
    Array.isArray(streaming.interactiveEvents) &&
    streaming.interactiveEvents.length > 0
  ) {
    return true;
  }
  if (Array.isArray(interactiveEvents) && interactiveEvents.length > 0) {
    return true;
  }
  if (streaming.liveSessionStatus) return true;
  if (streaming.steps.length > 0 || streaming.progressEvents.length > 0) return true;
  if (streaming.messageId) {
    const liveSubagents = subagentsByParentMessageId?.[streaming.messageId];
    if (Array.isArray(liveSubagents) && liveSubagents.length > 0) {
      return true;
    }
  }

  return false;
}
