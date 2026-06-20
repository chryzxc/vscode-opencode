function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

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

export function latestAssistantMessageIdFromCentralizedTape(
  rawSdkEventPayloads?: unknown[],
): string | null {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return null;
  }

  for (let index = rawSdkEventPayloads.length - 1; index >= 0; index -= 1) {
    const event = asRecord(rawSdkEventPayloads[index]);
    if (!event) {
      continue;
    }

    const properties = asRecord(event.properties);
    const info = asRecord(properties?.info) ?? asRecord(event.info);
    const part = asRecord(properties?.part) ?? asRecord(event.part);

    if (
      asString(event.type).trim() === "message.updated" &&
      asString(info?.role).trim().toLowerCase() === "assistant"
    ) {
      const assistantId = firstNonEmptyString(info?.id, info?.messageID, info?.messageId);
      if (assistantId) {
        return assistantId;
      }
    }

    if (asString(part?.type).trim().toLowerCase() === "step-finish") {
      const assistantId = firstNonEmptyString(part?.messageID, part?.messageId);
      if (assistantId) {
        return assistantId;
      }
    }
  }

  return null;
}

export function hasCompletedAssistantReplyInCentralizedTape(
  rawSdkEventPayloads?: unknown[],
): boolean {
  const latestAssistantMessageId =
    latestAssistantMessageIdFromCentralizedTape(rawSdkEventPayloads);
  if (!latestAssistantMessageId || !Array.isArray(rawSdkEventPayloads)) {
    return false;
  }

  for (let index = rawSdkEventPayloads.length - 1; index >= 0; index -= 1) {
    const event = asRecord(rawSdkEventPayloads[index]);
    if (!event) {
      continue;
    }

    const properties = asRecord(event.properties);
    const info = asRecord(properties?.info) ?? asRecord(event.info);
    const part = asRecord(properties?.part) ?? asRecord(event.part);

    if (
      asString(event.type).trim() === "message.updated" &&
      firstNonEmptyString(info?.id, info?.messageID, info?.messageId) ===
        latestAssistantMessageId
    ) {
      const finish = asString(info?.finish).trim();
      if (finish) {
        return true;
      }
    }

    if (
      asString(event.type).trim() === "message.part.updated" &&
      asString(part?.type).trim().toLowerCase() === "step-finish" &&
      firstNonEmptyString(part?.messageID, part?.messageId) ===
        latestAssistantMessageId
    ) {
      return true;
    }
  }

  return false;
}

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
  rawSdkEventPayloads?: unknown[],
): boolean {
  return hasCompletedAssistantReplyInCentralizedTape(rawSdkEventPayloads);
}

export function isAssistantRespondingInCurrentSession(
  isProcessing: boolean,
  currentSessionId: string | null,
  processingSessionIds: string[],
  isStreamingActive: boolean,
  assistantTurnPending: boolean,
  hasConversationContext: boolean,
): boolean {
  // A blank/new session can briefly inherit a processing session flag from
  // bootstrap or session switching, but that alone should not show the stop
  // button or loading affordance. Require actual turn context before treating
  // processing as an active assistant response.
  if (!hasConversationContext) {
    return false;
  }
  return (
    isProcessingInCurrentSession(isProcessing, currentSessionId, processingSessionIds) ||
    isStreamingActive ||
    assistantTurnPending
  );
}
