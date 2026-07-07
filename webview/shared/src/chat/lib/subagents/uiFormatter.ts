/**
 * UI formatter module for subagent processing.
 *
 * This module handles formatting data for UI consumption, display logic,
 * calculating derived properties, and providing UI-ready data.
 */

import type { SubagentDetail, SubagentSummary, SubagentStatus } from './types';

/**
 * Format subagent duration for display
 */
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

/**
 * Format subagent activity text for display
 */
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

/**
 * Get latest event timestamp across all event types
 */
export function latestSubagentEventTimestamp(detail: SubagentDetail): number | undefined {
  const candidates: number[] = [];

  if (Array.isArray(detail.thinkingEvents)) {
    detail.thinkingEvents.forEach((event) => {
      if (typeof event.createdAt === "number" && Number.isFinite(event.createdAt)) {
        candidates.push(event.createdAt);
      }
    });
  }

  if (Array.isArray(detail.progressEvents)) {
    detail.progressEvents.forEach((event) => {
      if (typeof event.createdAt === "number" && Number.isFinite(event.createdAt)) {
        candidates.push(event.createdAt);
      }
    });
  }

  if (Array.isArray(detail.timelineEvents)) {
    detail.timelineEvents.forEach((event) => {
      if (typeof event.createdAt === "number" && Number.isFinite(event.createdAt)) {
        candidates.push(event.createdAt);
      }
    });
  }

  if (candidates.length === 0) {
    return undefined;
  }
  return Math.max(...candidates);
}

/**
 * Determine if subagent should be frozen for presentation
 */
export function shouldFreezeSubagentForPresentation(
  detail: SubagentDetail,
  policy: { mode?: "hydration" | "live"; liveParentMessageIds?: Set<string>; sessionProcessing?: boolean } | undefined,
  explicitFreezeFlag?: boolean,
): boolean {
  if (explicitFreezeFlag === true) {
    return true;
  }
  if (!policy || policy.mode !== "hydration") {
    return false;
  }

  const status = detail.status;
  if (status !== "pending" && status !== "running" && status !== "orphaned") {
    return false;
  }

  if (policy.liveParentMessageIds?.has(detail.parentMessageId)) {
    return false;
  }

  return policy.sessionProcessing !== true;
}

/**
 * Resolve display status based on events and metadata
 */
export function resolveDisplayStatus(detail: SubagentDetail): SubagentStatus {
  const status = (detail.status || "running").toLowerCase() as SubagentStatus;

  if (status === "error" || status === "orphaned" || status === "pending") {
    return status;
  }

  const timeline = Array.isArray(detail.timelineEvents) ? detail.timelineEvents : [];
  const progress = Array.isArray(detail.progressEvents) ? detail.progressEvents : [];
  const conversation = Array.isArray(detail.conversationEvents) ? detail.conversationEvents : [];

  const latestTimeline = [...timeline].sort((a, b) => b.createdAt - a.createdAt)[0];
  const latestProgress = [...progress].sort((a, b) => b.createdAt - a.createdAt)[0];
  const latestConversation = [...conversation].sort((a, b) => b.createdAt - a.createdAt)[0];

  // Terminal stop marker should count as completion
  const hasTerminalStop =
    isStopLike(latestTimeline?.type) ||
    isStopLike(latestTimeline?.label) ||
    isStopLike(latestProgress?.title) ||
    isStopLike(latestConversation?.kind);

  if (hasTerminalStop) {
    return "done";
  }

  // Strict rule: never show DONE without an explicit terminal stop marker
  if (status === "done") {
    return "running";
  }

  return status === "running" ? "running" : "pending";
}

/**
 * Check if value is a background task ID
 */
export function isBackgroundTaskId(value: string | undefined): boolean {
  if (!value) return false;
  return /^bg_[a-z0-9]+$/i.test(value.trim());
}

/**
 * Check if value represents a stop event
 */
export function isStopLike(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "stop" || normalized === "stopped";
}

/**
 * Derive subagent role from available metadata
 */
export function deriveSubagentRole(subagent: SubagentSummary | SubagentDetail): string {
  if (subagent.agentRole) {
    return subagent.agentRole;
  }

  // Try to derive from other fields
  const agentId = subagent.agentId || '';
  const normalizedId = agentId.toLowerCase();

  if (normalizedId.includes('explore') || normalizedId.includes('explorer')) {
    return 'explore';
  }
  if (normalizedId.includes('librarian') || normalizedId.includes('library')) {
    return 'librarian';
  }
  if (normalizedId.includes('worker')) {
    return 'worker';
  }
  if (normalizedId.includes('researcher')) {
    return 'researcher';
  }
  if (normalizedId.includes('planner')) {
    return 'planner';
  }

  return 'default';
}

/**
 * Format subagent role for display
 */
export function formatSubagentRole(role: string | undefined): string {
  if (!role) return 'Agent';

  const normalized = role.toLowerCase();
  const roleDisplayNames: Record<string, string> = {
    'explore': 'Explorer',
    'explorer': 'Explorer',
    'librarian': 'Librarian',
    'library': 'Librarian',
    'worker': 'Worker',
    'default': 'Agent',
    'researcher': 'Researcher',
    'planner': 'Planner',
  };

  return roleDisplayNames[normalized] || role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Format subagent status for display
 */
export function formatSubagentStatus(status: SubagentStatus): string {
  const statusDisplayNames: Record<SubagentStatus, string> = {
    'pending': 'Pending',
    'running': 'Running',
    'done': 'Complete',
    'error': 'Error',
    'orphaned': 'Orphaned',
  };

  return statusDisplayNames[status] || status;
}

/**
 * Calculate subagent completion percentage
 */
export function calculateSubagentCompletion(detail: SubagentDetail): number {
  const progressEvents = detail.progressEvents || [];
  const completedEvents = progressEvents.filter(e => e.status === 'done').length;

  if (progressEvents.length === 0) {
    // If no progress events, estimate based on status
    switch (detail.status) {
      case 'done': return 100;
      case 'error': return 100;
      case 'running': return 50;
      case 'pending': return 0;
      default: return 0;
    }
  }

  return Math.round((completedEvents / progressEvents.length) * 100);
}

/**
 * Check if subagent is currently active
 */
export function isSubagentActive(detail: SubagentDetail): boolean {
  const status = resolveDisplayStatus(detail);
  return status === 'running' || status === 'pending';
}

/**
 * Check if subagent has terminal state
 */
export function isSubagentTerminal(detail: SubagentDetail): boolean {
  const status = resolveDisplayStatus(detail);
  return status === 'done' || status === 'error' || status === 'orphaned';
}

/**
 * Get subagent display color based on status
 */
export function getSubagentStatusColor(status: SubagentStatus): string {
  const colorMap: Record<SubagentStatus, string> = {
    'pending': 'text-yellow-600',
    'running': 'text-blue-600',
    'done': 'text-green-600',
    'error': 'text-red-600',
    'orphaned': 'text-gray-600',
  };

  return colorMap[status] || 'text-gray-600';
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(timestamp: number | undefined): string {
  if (!timestamp || typeof timestamp !== 'number') {
    return 'Unknown';
  }

  const date = new Date(timestamp);
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Format duration for display
 */
export function formatDuration(durationMs: number | undefined): string {
  if (!durationMs || typeof durationMs !== 'number') {
    return 'Unknown';
  }

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

// Utility functions
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