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
    // If processing is global/legacy and we have no session mapping yet, do not
    // assume this session is active.
    return false;
  }
  return processingSessionIds.includes(currentSessionId);
}
