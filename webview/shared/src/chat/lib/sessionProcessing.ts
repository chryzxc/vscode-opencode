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

export function latestSessionStatusTypeFromCentralizedTape(
  rawSdkEventPayloads?: unknown[],
): string | null {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return null;
  }

  for (let index = rawSdkEventPayloads.length - 1; index >= 0; index -= 1) {
    const event = asRecord(rawSdkEventPayloads[index]);
    if (!event || asString(event.type).trim() !== "session.status") {
      continue;
    }

    const properties = asRecord(event.properties);
    const status = asRecord(properties?.status) ?? asRecord(event.status);
    const statusType = firstNonEmptyString(status?.type, status?.status);
    if (statusType) {
      return statusType.trim().toLowerCase();
    }
  }

  return null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function latestCentralizedEventTimestamp(
  rawSdkEventPayloads?: unknown[],
): number | null {
  if (!Array.isArray(rawSdkEventPayloads) || rawSdkEventPayloads.length === 0) {
    return null;
  }

  let latest: number | null = null;

  for (const entry of rawSdkEventPayloads) {
    const event = asRecord(entry);
    if (!event) {
      continue;
    }

    const properties = asRecord(event.properties);
    const info = asRecord(properties?.info) ?? asRecord(event.info);
    const part = asRecord(properties?.part) ?? asRecord(event.part);
    const partTime = asRecord(part?.time);
    const infoTime = asRecord(info?.time);

    const candidates = [
      asNumber(properties?.time),
      asNumber(event.time),
      asNumber(partTime?.end),
      asNumber(partTime?.start),
      asNumber(infoTime?.completed),
      asNumber(infoTime?.updated),
      asNumber(infoTime?.created),
    ];

    for (const candidate of candidates) {
      if (typeof candidate !== "number") {
        continue;
      }
      latest = latest === null ? candidate : Math.max(latest, candidate);
    }
  }

  return latest;
}

const CENTRALIZED_ACTIVITY_FRESHNESS_WINDOW_MS = 30_000;

function hasRecentCentralizedActivity(
  rawSdkEventPayloads?: unknown[],
  nowMs: number = Date.now(),
): boolean {
  const latestTimestamp = latestCentralizedEventTimestamp(rawSdkEventPayloads);
  if (typeof latestTimestamp !== "number") {
    return false;
  }
  return nowMs - latestTimestamp <= CENTRALIZED_ACTIVITY_FRESHNESS_WINDOW_MS;
}

function latestRoleBoundaryIndexes(messages: unknown[] | undefined): {
  lastUserIndex: number;
  lastAssistantIndex: number;
} {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { lastUserIndex: -1, lastAssistantIndex: -1 };
  }

  let lastUserIndex = -1;
  let lastAssistantIndex = -1;

  for (let index = 0; index < messages.length; index += 1) {
    const message = asRecord(messages[index]);
    const role = asString(message?.role).trim().toLowerCase();
    if (role === "user") {
      lastUserIndex = index;
    } else if (role === "assistant") {
      lastAssistantIndex = index;
    }
  }

  return { lastUserIndex, lastAssistantIndex };
}

/**
 * Returns true only when the current visible transcript still belongs to an
 * in-flight assistant turn.
 *
 * This is intentionally stricter than "any conversation exists" so cached or
 * rehydrated transcripts with a completed assistant reply do not keep the stop
 * button / loading affordance alive just because stale processing flags are
 * still present elsewhere in state.
 */
export function hasActiveAssistantTurnContext(
  messages: unknown[] | undefined,
  isStreamingActive: boolean,
  assistantTurnPending: boolean,
): boolean {
  if (isStreamingActive || assistantTurnPending) {
    return true;
  }

  const { lastUserIndex, lastAssistantIndex } = latestRoleBoundaryIndexes(messages);
  return lastUserIndex > lastAssistantIndex;
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

export function hasActiveAssistantReplyInCentralizedTape(
  rawSdkEventPayloads?: unknown[],
): boolean {
  // If the backend explicitly says the session is not busy (e.g. "waiting", "idle")
  // then the assistant is done, even if we missed a step-finish or message finish event.
  const latestStatusType = latestSessionStatusTypeFromCentralizedTape(rawSdkEventPayloads);
  if (latestStatusType && !hasBusySessionStatusInCentralizedTape(rawSdkEventPayloads)) {
    return false;
  }

  return !!latestAssistantMessageIdFromCentralizedTape(rawSdkEventPayloads) &&
    !hasCompletedAssistantReplyInCentralizedTape(rawSdkEventPayloads);
}

export function hasBusySessionStatusInCentralizedTape(
  rawSdkEventPayloads?: unknown[],
): boolean {
  const latestStatusType = latestSessionStatusTypeFromCentralizedTape(rawSdkEventPayloads);
  return (
    latestStatusType === "busy" ||
    latestStatusType === "running" ||
    latestStatusType === "processing" ||
    latestStatusType === "in_progress" ||
    latestStatusType === "streaming"
  );
}

export function isAssistantRespondingInCurrentSession(
  isProcessing: boolean,
  currentSessionId: string | null,
  processingSessionIds: string[],
  isStreamingActive: boolean,
  assistantTurnPending: boolean,
  hasConversationContext: boolean,
  rawSdkEventPayloads?: unknown[],
): boolean {
  const isProcessingInSession = isProcessingInCurrentSession(
    isProcessing,
    currentSessionId,
    processingSessionIds,
  );
  const hasActiveCentralizedReply =
    hasActiveAssistantReplyInCentralizedTape(rawSdkEventPayloads);
  const hasBusyCentralizedSession =
    hasBusySessionStatusInCentralizedTape(rawSdkEventPayloads) &&
    !hasCompletedAssistantReplyInCentralizedTape(rawSdkEventPayloads);
  const hasLiveTurnSignal =
    isProcessingInSession || isStreamingActive || assistantTurnPending;
  const canUseCentralizedFallback =
    hasLiveTurnSignal || hasRecentCentralizedActivity(rawSdkEventPayloads);

  // A blank/new session can briefly inherit processing-like state from
  // bootstrap or stale persisted tape. Require either visible turn context or
  // fresh live-ish centralized activity before showing loading.
  if (
    !hasConversationContext &&
    !(canUseCentralizedFallback && (hasActiveCentralizedReply || hasBusyCentralizedSession))
  ) {
    return false;
  }
  return (
    isProcessingInSession ||
    isStreamingActive ||
    assistantTurnPending ||
    (canUseCentralizedFallback &&
      (hasActiveCentralizedReply || hasBusyCentralizedSession))
  );
}
