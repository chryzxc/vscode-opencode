/**
 * Subagent-related type definitions.
 *
 * This module contains all types related to subagent data structures,
 * providing a single source of truth for subagent typing across the application.
 */

/**
 * Current lifecycle status of a subagent session.
 */
export type SubagentStatus = 'pending' | 'running' | 'done' | 'error' | 'orphaned';

/**
 * Reference identifiers for connecting subagent events to parent message/parts.
 */
export interface SubagentReference {
  messageID?: string;
  partID?: string;
  callID?: string;
}

/**
 * Timeline event representing a significant point in subagent execution.
 */
export interface SubagentTimelineEvent {
  key: string;
  type: string;
  label: string;
  createdAt: number;
  messageID?: string;
  partID?: string;
  callID?: string;
}

/**
 * Thinking event showing subagent reasoning process.
 */
export interface SubagentThinkingEvent {
  id: string;
  text: string;
  createdAt: number;
  messageID?: string;
  partID?: string;
}

/**
 * Conversation event representing assistant messages in subagent dialogue.
 */
export interface SubagentConversationEvent {
  id: string;
  role: string;
  kind: 'message' | 'reasoning' | 'step';
  text: string;
  createdAt: number;
  messageID?: string;
  partID?: string;
}

/**
 * Progress event showing step completion in subagent workflow.
 */
export interface SubagentProgressEvent {
  id: string;
  title: string;
  status: 'pending' | 'done' | 'error';
  meta?: string;
  filePath?: string;
  createdAt: number;
  messageID?: string;
  partID?: string;
  callID?: string;
}

/**
 * Summary information about a subagent (lightweight reference).
 */
export interface SubagentSummary {
  id: string;
  backgroundTaskId?: string;
  parentSessionId: string;
  parentMessageId: string;
  childSessionId?: string;
  agentId?: string;
  agentRole?: string;
  providerID?: string;
  modelID?: string;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  status: SubagentStatus;
  latestActivity: string;
  references: SubagentReference[];
}

/**
 * Detailed subagent information including all events and metadata.
 */
export interface SubagentDetail extends SubagentSummary {
  thinkingEvents: SubagentThinkingEvent[];
  conversationEvents?: SubagentConversationEvent[];
  rawConversationEvents?: unknown[];
  progressEvents: SubagentProgressEvent[];
  timelineEvents: SubagentTimelineEvent[];
  tokenUsage?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  errorText?: string;
  hydrationUnavailable?: boolean;
}

/**
 * Normalized event structure for subagent extraction processing.
 */
export interface NormalizedSubagentEvent {
  id: string;
  type: string;
  tool?: string;
  callID?: string;
  messageID?: string;
  partID?: string;
  sessionId?: string;
  timestamp: number;
  rawEvent: unknown;
}

/**
 * Store state structure for subagent data.
 */
export interface SubagentState {
  subagentsByParentMessageId: Record<string, SubagentSummary[]>;
  subagentDetailsById: Record<string, SubagentDetail>;
  selectedSubagentId: string | null;
  subagentsPanelOpen: boolean;
}

/**
 * Presentation policy for subagent data display.
 */
export interface SubagentPresentationPolicy {
  mode: "stream" | "hydration";
  sessionProcessing?: boolean;
  liveParentMessageIds?: Set<string>;
}

/**
 * Action types for subagent state updates.
 */
export type SubagentAction =
  | { type: 'UPSERT_SUBAGENT_SUMMARIES'; payload: Record<string, SubagentSummary[]> }
  | { type: 'UPSERT_SUBAGENT_DETAIL'; payload: Record<string, SubagentDetail> }
  | { type: 'SELECT_SUBAGENT'; payload: string | null }
  | { type: 'SET_SUBAGENTS_PANEL_OPEN'; payload: boolean }
  | { type: 'CLEAR_SUBAGENTS_FOR_SESSION'; payload: string };