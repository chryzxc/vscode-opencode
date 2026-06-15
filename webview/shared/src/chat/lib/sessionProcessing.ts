import { getFinalAssistantResponseText } from "./rawResponse";
import type { Message } from "./types";

export function isProcessingInCurrentSession(
  isProcessing: boolean,
  currentSessionId: string | null,
  processingSessionIds: string[],
): boolean {
  if (!isProcessing) {
    return false;
  }
  if (!currentSessionId) {
    return isProcessing;
  }
  if (
    !Array.isArray(processingSessionIds) ||
    processingSessionIds.length === 0
  ) {
    // FIX: If processing is active but we have no session mapping yet, show loading state
    // This prevents missing loading indicators during initial processing or when
    // processingSessionIds hasn't been updated yet
    return isProcessing;
  }
  return processingSessionIds.includes(currentSessionId);
}

export function hasCompletedAssistantReplyForLatestTurn(
  messages: Message[],
): boolean {
  if (!Array.isArray(messages) || messages.length === 0) {
    return false;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const role = String(message?.role ?? message?.info?.role ?? "").toLowerCase();

    if (role === "assistant") {
      // Prefer the raw assistant tape when deciding whether the latest turn is
      // finished. This keeps the UI aligned with the source-of-truth payload
      // instead of relying on a stale processing flag.
      const rawAssistantText = getFinalAssistantResponseText(message.rawResponse);
      const structuredText =
        typeof message.structuredOutput?.message === "string"
          ? message.structuredOutput.message.trim()
          : "";
      const content =
        typeof message.content === "string" ? message.content.trim() : "";
      return Boolean(rawAssistantText || structuredText || content);
    }

    if (role === "user") {
      return false;
    }
  }

  return false;
}

export function hasActiveAssistantTurnContext(
  messages: Message[],
  isStreamingActive: boolean,
  assistantTurnPending: boolean,
): boolean {
  if (isStreamingActive || assistantTurnPending) {
    return true;
  }
  return Array.isArray(messages) && messages.length > 0;
}

export function isAssistantRespondingInCurrentSession(
  isProcessing: boolean,
  currentSessionId: string | null,
  processingSessionIds: string[],
  isStreamingActive: boolean,
  assistantTurnPending: boolean,
  hasAssistantFinishSignal?: boolean,
  hasTerminalStepSignal?: boolean,
  hasCompletedAssistantReplyForLatestTurn?: boolean,
  hasActiveTurnContext?: boolean,
): boolean {
  // Keep the composer stop button and the transcript loading affordance tied to
  // the same "AI is still active" signal. The transport can briefly lose the
  // processing flag while stream activity is still flowing, so we treat either
  // live streaming or a pending assistant turn as still responding.
  if (!hasActiveTurnContext) {
    return false;
  }

  if (hasAssistantFinishSignal || hasTerminalStepSignal || hasCompletedAssistantReplyForLatestTurn) {
    return false;
  }

  const isProcessingOrStreaming = isProcessingInCurrentSession(isProcessing, currentSessionId, processingSessionIds) || isStreamingActive;

  return isProcessingOrStreaming || assistantTurnPending;
}
