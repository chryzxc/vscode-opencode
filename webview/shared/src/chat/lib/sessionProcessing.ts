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
