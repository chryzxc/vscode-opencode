import type { SubagentDetail, SubagentStatus, SubagentSummary } from "./types";

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function firstFinite(...values: unknown[]): number | undefined {
  for (const value of values) {
    const normalized = finiteNumber(value);
    if (typeof normalized === "number") {
      return normalized;
    }
  }
  return undefined;
}

export function getSubagentDisplayDurationMs(
  subagent: SubagentSummary,
  detail?: SubagentDetail,
  now: number = Date.now(),
  resolvedStatus?: SubagentStatus,
): number {
  const status = resolvedStatus || detail?.status || subagent.status;
  const startedAt = firstFinite(subagent.startedAt, detail?.startedAt);
  const endedAt = firstFinite(subagent.endedAt, detail?.endedAt);
  const durationMs = firstFinite(subagent.durationMs, detail?.durationMs) ?? 0;

  if (status === "running" || status === "pending") {
    if (typeof startedAt !== "number") {
      return durationMs;
    }
    const liveElapsed = Math.max(0, now - startedAt);
    return Math.max(durationMs, liveElapsed);
  }

  if (typeof startedAt === "number" && typeof endedAt === "number") {
    return Math.max(0, endedAt - startedAt);
  }

  return durationMs;
}

export function getSubagentDisplayActivity(
  subagent: SubagentSummary,
  detail: SubagentDetail | undefined,
  resolvedStatus: SubagentStatus,
  statusText: string,
): string {
  const activity = (subagent.latestActivity || detail?.latestActivity || "").trim();
  if (!activity) {
    return statusText;
  }

  const normalizedActivity = activity.toLowerCase();
  const hasStaleNonTerminalActivity =
    normalizedActivity === "running" ||
    normalizedActivity === "pending" ||
    normalizedActivity === "initializing" ||
    normalizedActivity === "waiting for next progress...";

  if (
    (resolvedStatus === "done" ||
      resolvedStatus === "error" ||
      resolvedStatus === "orphaned") &&
    hasStaleNonTerminalActivity
  ) {
    return statusText;
  }

  return activity;
}
