/**
 * Metadata extractor module for subagent processing.
 *
 * This module handles extraction of subagent identity, role, status, and metadata
 * from normalized event structures.
 */

import type { SubagentSummary } from './types';
import { asRecord, asString } from '../messageHandler';

/**
 * Resolve subagent ID from various possible fields
 */
export function resolveSubagentId(subagent: Record<string, unknown>): string | undefined {
  const backgroundId =
    asString(subagent.backgroundTaskId) ||
    asString(subagent.background_task_id);
  if (backgroundId && /^bg_[a-z0-9]+$/i.test(backgroundId)) {
    return backgroundId;
  }
  const directId = asString(subagent.id);
  if (directId) {
    return directId;
  }
  if (backgroundId) {
    return backgroundId;
  }
  const candidateAgentId =
    asString(subagent.agentId) ||
    asString(subagent.agent) ||
    asString(subagent.name);
  if (candidateAgentId && /^bg_[a-z0-9]+$/i.test(candidateAgentId)) {
    return candidateAgentId;
  }
  return undefined;
}

/**
 * Resolve subagent role from various possible fields
 */
export function resolveSubagentRole(subagent: Record<string, unknown>): string | undefined {
  const candidateFromAgentFields =
    asString(subagent.agent) || asString(subagent.agentId) || asString(subagent.name);
  const raw =
    asString(subagent.agentRole) ||
    asString(subagent.agent_role) ||
    asString(subagent.agentType) ||
    asString(subagent.agent_type) ||
    asString(subagent.role) ||
    asString(subagent.type) ||
    candidateFromAgentFields;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return undefined;
  const knownRoles = new Set([
    "explorer",
    "explore",
    "librarian",
    "library",
    "worker",
    "default",
    "researcher",
    "planner",
  ]);
  return knownRoles.has(normalized) ? normalized : undefined;
}

/**
 * Normalize subagent status to standard values
 */
export function normalizeSubagentStatus(value: string): SubagentSummary['status'] {
  const lowered = value.toLowerCase();
  if (lowered === 'running' || lowered === 'done' || lowered === 'error' || lowered === 'orphaned') {
    return lowered;
  }
  // Accept legacy persisted synonyms that were produced by an earlier
  // normalizer (e.g. "completed" instead of "done", "failed" instead of "error").
  if (lowered === 'completed' || lowered === 'finished' || lowered === 'success') {
    return 'done';
  }
  if (lowered === 'failed' || lowered === 'cancelled' || lowered === 'canceled') {
    return 'error';
  }
  return 'pending';
}

/**
 * Extract basic subagent metadata from the parent omo_agent event
 */
export function extractSubagentMetadata(event: Record<string, unknown>): {
  toolName: string;
  status: string;
  backgroundTaskId: string;
  agentRole: string;
  inputPrompt: string;
  inputTask: string;
  output: string;
} | null {
  const properties = asRecord(event.properties);
  const part = asRecord(properties?.part ?? event.part);
  if (!part) return null;

  const state = asRecord(part?.state);
  const input = asRecord(state?.input || part.input);
  const output = state?.output || part.output;

  const toolName = asString(part.tool || 'omo_agent');
  const status = asString(state?.status || part.status || 'pending');
  const backgroundTaskId = asString(input?.task_id || input?.taskId || part.backgroundTaskId) || '';
  const agentRole = asString(input?.agent || input?.subagent_type || 'assistant');
  const inputPrompt = asString(input?.prompt || input?.description || '');
  const inputTask = asString(input?.task || '');
  const outputText = asString(output || '');

  return {
    toolName,
    status,
    backgroundTaskId,
    agentRole,
    inputPrompt,
    inputTask,
    output: outputText,
  };
}

/**
 * Extract agent identifier from event
 */
export function extractAgentId(event: Record<string, unknown>): string | undefined {
  const properties = asRecord(event.properties);
  const part = asRecord(properties?.part);
  const state = asRecord(part?.state);
  const input = asRecord(state?.input);

  return asString(input?.agentId) ||
         asString(input?.agent_id) ||
         asString(part?.agentId) ||
         asString(part?.agent_id) ||
         asString(properties?.agentId) ||
         undefined;
}

/**
 * Extract provider and model information from event
 */
export function extractProviderModel(event: Record<string, unknown>): {
  providerID?: string;
  modelID?: string;
} {
  const properties = asRecord(event.properties);
  const part = asRecord(properties?.part);
  const state = asRecord(part?.state);
  const input = asRecord(state?.input);

  const providerID = asString(input?.providerID) ||
                    asString(input?.provider_id) ||
                    asString(part?.providerID) ||
                    asString(properties?.providerID) ||
                    undefined;

  const modelID = asString(input?.modelID) ||
                 asString(input?.model_id) ||
                 asString(part?.modelID) ||
                 asString(properties?.modelID) ||
                 undefined;

  return { providerID, modelID };
}

/**
 * Extract timing information from event
 */
export function extractTimingInfo(event: Record<string, unknown>): {
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
} {
  const properties = asRecord(event.properties);
  const part = asRecord(properties?.part);
  const state = asRecord(part?.state);

  const startedAt = asNumber(state?.startedAt) ||
                   asNumber(state?.started_at) ||
                   asNumber(part?.startedAt) ||
                   asNumber(properties?.time) ||
                   undefined;

  const endedAt = asNumber(state?.endedAt) ||
                asNumber(state?.ended_at) ||
                asNumber(part?.endedAt) ||
                undefined;

  const durationMs = startedAt && endedAt ? endedAt - startedAt :
                   asNumber(state?.durationMs) ||
                   asNumber(state?.duration_ms) ||
                   asNumber(part?.durationMs) ||
                   undefined;

  return { startedAt, endedAt, durationMs };
}

/**
 * Determine subagent status from event and timing information
 */
export function determineSubagentStatus(
  eventStatus: string | undefined,
  timingInfo: { startedAt?: number; endedAt?: number }
): SubagentSummary['status'] {
  if (eventStatus) {
    return normalizeSubagentStatus(eventStatus);
  }

  // If no explicit status, infer from timing
  if (!timingInfo.startedAt) {
    return 'pending';
  }
  if (timingInfo.endedAt) {
    return 'done';
  }
  return 'running';
}

/**
 * Extract latest activity description from event
 */
export function extractLatestActivity(event: Record<string, unknown>): string {
  const properties = asRecord(event.properties);
  const part = asRecord(properties?.part);
  const state = asRecord(part?.state);
  const output = state?.output || part.output;

  if (asString(output)) {
    return asString(output)!;
  }

  return asString(state?.status) || asString(part?.status) || 'Initializing...';
}

// Type utilities
function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) return parsed;
  }
  return undefined;
}