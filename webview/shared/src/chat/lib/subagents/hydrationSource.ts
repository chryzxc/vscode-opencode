import type { SubagentDetail, SubagentSummary } from "./types";
import { extractSubagentsFromCentralizedEvents } from "./centralExtractor";

type UnknownRecord = Record<string, unknown>;

export type HydratedSubagentProjection = {
  summariesByParentMessageId: Record<string, SubagentSummary[]>;
  detailsById: Record<string, SubagentDetail>;
};

/**
 * Resolve the source for a hydrated subagent view.
 *
 * The raw SDK tape is authoritative. The persisted projection is intentionally
 * a compatibility fallback for historic/orphaned sessions whose event tape
 * predates complete parent-child linking.
 */
export function resolveHydratedSubagentProjection(
  rawSdkEventPayloads: unknown[],
  persisted?: UnknownRecord,
): HydratedSubagentProjection {
  const fromRaw = extractSubagentsFromCentralizedEvents(rawSdkEventPayloads);
  const persistedDetails =
    (persisted?.detailsById as Record<string, SubagentDetail> | undefined) || {};
  const persistedSummaries =
    (persisted?.summariesByParentMessageId as Record<string, SubagentSummary[]> | undefined) || {};
  const terminalPersistedDetails = Object.fromEntries(
    Object.entries(persistedDetails).filter(([, detail]) => detail?.status === "cancelled"),
  );
  if (
    Object.keys(fromRaw.summariesByParentMessageId).length > 0 ||
    Object.keys(fromRaw.detailsById).length > 0
  ) {
    // The raw tape owns activity data, but it has no lifecycle boundary at a
    // host restart. A persisted cancellation is therefore authoritative for
    // that one terminal state; otherwise an old `running` tool event revives.
    if (Object.keys(terminalPersistedDetails).length === 0) {
      return fromRaw;
    }

    const detailsById = { ...fromRaw.detailsById, ...terminalPersistedDetails };
    const summariesByParentMessageId = Object.fromEntries(
      Object.entries(fromRaw.summariesByParentMessageId).map(([parentId, summaries]) => [
        parentId,
        summaries.map((summary) => {
          const terminalDetail = detailsById[summary.id];
          return terminalDetail?.status === "cancelled"
            ? { ...summary, status: "cancelled" as const, latestActivity: "Cancelled" }
            : summary;
        }),
      ]),
    );
    // Retain cancelled projections which the raw tape cannot associate with a
    // parent anymore (a common shape in older cached sessions).
    for (const [parentId, summaries] of Object.entries(persistedSummaries)) {
      const missing = summaries.filter((summary) =>
        summary.status === "cancelled" &&
        !summariesByParentMessageId[parentId]?.some((current) => current.id === summary.id),
      );
      if (missing.length > 0) {
        summariesByParentMessageId[parentId] = [
          ...(summariesByParentMessageId[parentId] || []),
          ...missing,
        ];
      }
    }
    return { summariesByParentMessageId, detailsById };
  }

  return {
    summariesByParentMessageId:
      persistedSummaries,
    detailsById:
      persistedDetails,
  };
}
