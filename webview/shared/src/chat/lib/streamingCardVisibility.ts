import type { AppState, StreamingState } from "./types";

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
  if (hasTranscriptAssistantForCurrentTurn && !streaming.isActive) return false;

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

  // The transcript can receive an assistant placeholder before the live turn
  // finishes. It does not own the live reasoning/tool/progress overlay, so
  // suppressing this card at that point makes all streaming activity vanish.
  // Deduplicate only after the live stream has completed and hydration owns
  // the full turn.
  if (hasMatchingAssistantTurnInTranscript && !streaming.isActive) return false;

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
