/**
 * Custom hooks for subagent data access.
 *
 * These hooks provide a clean interface for UI components to access
 * subagent data from the app state, abstracting away the complexity
 * of data access and formatting.
 */

import { useAppState, shallowEqual } from '../lib/store';
import type { SubagentSummary, SubagentDetail } from '../lib/subagents/types';
import {
  getSubagentDisplayDurationMs,
  getSubagentDisplayActivity,
  resolveDisplayStatus,
  formatSubagentRole,
  formatSubagentStatus,
  calculateSubagentCompletion,
  isSubagentActive,
  getSubagentStatusColor
} from '../lib/subagents/uiFormatter';

const EMPTY_SUBAGENT_SUMMARIES: SubagentSummary[] = [];

/**
 * Hook to access subagent summaries for a specific parent message
 */
export function useSubagentSummaries(parentMessageId: string | undefined) {
  return useAppState((state) =>
    parentMessageId
      ? state.subagentsByParentMessageId[parentMessageId] || EMPTY_SUBAGENT_SUMMARIES
      : EMPTY_SUBAGENT_SUMMARIES,
  );
}

/**
 * Hook to access subagent details by ID
 */
export function useSubagentDetail(subagentId: string | undefined) {
  return useAppState((state) =>
    subagentId ? state.subagentDetailsById[subagentId] || undefined : undefined,
  );
}

/**
 * Hook to access all subagent details with display formatting
 */
export function useSubagentsForParentMessage(parentMessageId: string | undefined) {
  const summaries = useSubagentSummaries(parentMessageId);
  const detailsById = useAppState((state) => state.subagentDetailsById);

  return summaries.map(summary => {
    const detail = detailsById[summary.id];
    const displayStatus = detail ? resolveDisplayStatus(detail) : summary.status;
    const resolvedStatus = detail ? resolveDisplayStatus(detail) : summary.status;

    return {
      ...summary,
      detail,
      displayStatus,
      resolvedStatus,
      formattedRole: formatSubagentRole(summary.agentRole),
      formattedStatus: formatSubagentStatus(resolvedStatus),
      displayDurationMs: getSubagentDisplayDurationMs(summary, detail),
      displayActivity: getSubagentDisplayActivity(summary, detail, resolvedStatus, formatSubagentStatus(resolvedStatus)),
      completionPercentage: detail ? calculateSubagentCompletion(detail) : 0,
      isActive: detail ? isSubagentActive(detail) : false,
      statusColor: getSubagentStatusColor(resolvedStatus),
      hasConversationEvents: Boolean(detail?.conversationEvents?.length),
      hasProgressEvents: Boolean(detail?.progressEvents?.length),
      hasTimelineEvents: Boolean(detail?.timelineEvents?.length),
      conversationEventsCount: detail?.conversationEvents?.length || 0,
      progressEventsCount: detail?.progressEvents?.length || 0,
      timelineEventsCount: detail?.timelineEvents?.length || 0,
    };
  });
}

/**
 * Hook to access formatted subagent detail for a specific subagent
 */
export function useFormattedSubagentDetail(subagentId: string | undefined) {
  const detail = useSubagentDetail(subagentId);

  if (!detail) {
    return undefined;
  }

  const displayStatus = resolveDisplayStatus(detail);

  return {
    ...detail,
    displayStatus,
    formattedRole: formatSubagentRole(detail.agentRole),
    formattedStatus: formatSubagentStatus(displayStatus),
    displayDurationMs: getSubagentDisplayDurationMs(detail, detail),
    displayActivity: getSubagentDisplayActivity(detail, detail, displayStatus, formatSubagentStatus(displayStatus)),
    completionPercentage: calculateSubagentCompletion(detail),
    isActive: isSubagentActive(detail),
    statusColor: getSubagentStatusColor(displayStatus),
    hasConversationEvents: Boolean(detail.conversationEvents?.length),
    hasProgressEvents: Boolean(detail.progressEvents?.length),
    hasTimelineEvents: Boolean(detail.timelineEvents?.length),
    conversationEventsCount: detail.conversationEvents?.length || 0,
    progressEventsCount: detail.progressEvents?.length || 0,
    timelineEventsCount: detail.timelineEvents?.length || 0,
  };
}

/**
 * Hook to access subagent panel state
 */
export function useSubagentPanel() {
  return useAppState(
    (state) => ({
      isOpen: state.subagentsPanelOpen,
      selectedSubagentId: state.selectedSubagentId,
      subagentsByParentMessageId: state.subagentsByParentMessageId,
      subagentDetailsById: state.subagentDetailsById,
    }),
    shallowEqual,
  );
}

/**
 * Hook to check if there are any subagents for the current session
 */
export function useHasSubagents() {
  const { subagentsByParentMessageId } = useSubagentPanel();
  return Object.values(subagentsByParentMessageId).some(
    summaries => Array.isArray(summaries) && summaries.length > 0
  );
}

/**
 * Hook to get subagent count for a parent message
 */
export function useSubagentCount(parentMessageId: string | undefined) {
  const summaries = useSubagentSummaries(parentMessageId);
  return summaries.length;
}

/**
 * Hook to get all active subagents across all parent messages
 */
export function useAllActiveSubagents() {
  const { subagentsByParentMessageId, subagentDetailsById } = useSubagentPanel();

  const allSubagents: Array<{
    summary: SubagentSummary;
    detail: SubagentDetail | undefined;
    displayStatus: string;
    formattedRole: string;
    formattedStatus: string;
    isActive: boolean;
  }> = [];

  Object.entries(subagentsByParentMessageId).forEach(([parentMessageId, summaries]) => {
    summaries.forEach(summary => {
      const detail = subagentDetailsById[summary.id];
      const displayStatus = detail ? resolveDisplayStatus(detail) : summary.status;

      allSubagents.push({
        summary,
        detail,
        displayStatus,
        formattedRole: formatSubagentRole(summary.agentRole),
        formattedStatus: formatSubagentStatus(displayStatus),
        isActive: detail ? isSubagentActive(detail) : false,
      });
    });
  });

  return allSubagents;
}
