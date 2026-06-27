/**
 * Compatibility utilities for subagent data processing.
 *
 * These functions provide backward compatibility during the refactoring
 * from the legacy monolithic messageHandler to the modular system.
 */

import type { SubagentSummary, SubagentDetail, SubagentPresentationPolicy } from './types';

/**
 * Normalizes a hydrated subagent detail for presentation.
 */
export function normalizeHydratedSubagentDetail(detail: SubagentDetail): SubagentDetail {
  // Ensure all required fields are present and properly formatted
  return {
    ...detail,
    conversationEvents: detail.conversationEvents || [],
    progressEvents: detail.progressEvents || [],
    timelineEvents: detail.timelineEvents || [],
    thinkingEvents: detail.thinkingEvents || [],
  };
}

/**
 * Hydrates a subagent summary with additional detail data.
 */
export function hydrateSubagentSummary(summary: SubagentSummary, detail?: SubagentDetail): SubagentDetail {
  if (!detail) {
    // Return minimal detail structure from summary
    return {
      ...summary,
      conversationEvents: [],
      progressEvents: [],
      timelineEvents: [],
      thinkingEvents: [],
      hydrationUnavailable: true,
    };
  }

  return detail;
}

/**
 * Compares two subagent lists for equivalence.
 */
export function areSubagentListsEquivalent(
  listA: SubagentSummary[],
  listB: SubagentSummary[]
): boolean {
  if (listA.length !== listB.length) {
    return false;
  }

  const mapA = new Map(listA.map(s => [s.id, s]));
  const mapB = new Map(listB.map(s => [s.id, s]));

  if (mapA.size !== mapB.size) {
    return false;
  }

  for (const [id, subA] of mapA) {
    const subB = mapB.get(id);
    if (!subB) {
      return false;
    }

    // Compare key fields that matter for equivalence
    if (
      subA.status !== subB.status ||
      subA.latestActivity !== subB.latestActivity ||
      subA.durationMs !== subB.durationMs ||
      subA.agentRole !== subB.agentRole
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Determines if a subagent should be frozen for presentation based on policy.
 */
export function shouldFreezeSubagentForPresentation(
  subagent: SubagentSummary,
  policy?: SubagentPresentationPolicy
): boolean {
  if (!policy) {
    return false;
  }

  // In hydration mode, freeze completed subagents
  if (policy.mode === 'hydration' && subagent.status === 'done') {
    return true;
  }

  // In stream mode, freeze if not a live message
  if (policy.mode === 'stream' && policy.liveParentMessageIds) {
    return !policy.liveParentMessageIds.has(subagent.parentMessageId);
  }

  return false;
}

/**
 * Applies structured subagent payload to existing detail data.
 */
export function applyStructuredSubagentPayload(
  existing: SubagentDetail,
  incoming: Partial<SubagentDetail>
): SubagentDetail {
  return {
    ...existing,
    ...incoming,
    // Merge arrays rather than replace
    conversationEvents: incoming.conversationEvents || existing.conversationEvents || [],
    progressEvents: incoming.progressEvents || existing.progressEvents || [],
    timelineEvents: incoming.timelineEvents || existing.timelineEvents || [],
    thinkingEvents: incoming.thinkingEvents || existing.thinkingEvents || [],
    // Merge references
    references: incoming.references || existing.references,
  };
}