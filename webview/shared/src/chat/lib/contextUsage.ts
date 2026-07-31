/**
 * Derive the context percentage from the values displayed beside the meter.
 *
 * The SDK percentage is useful when the token count or model limit is absent,
 * but it must not override a usable token count/limit pair. In particular,
 * compaction temporarily resets the stored percentage to 0 while the SDK
 * context metadata is being rehydrated. Rendering that transient value would
 * show `469,996 / 1,000,000` with a misleading `0%` badge.
 */
export function resolveContextUsagePct(
  usedTokens: number,
  contextLimit: number,
  reportedPct?: number,
): number {
  if (
    Number.isFinite(usedTokens) &&
    usedTokens > 0 &&
    Number.isFinite(contextLimit) &&
    contextLimit > 0
  ) {
    return Math.min(100, Math.max(0, Math.round((usedTokens / contextLimit) * 100)));
  }

  if (typeof reportedPct === "number" && Number.isFinite(reportedPct)) {
    return Math.min(100, Math.max(0, Math.round(reportedPct)));
  }

  return 0;
}
