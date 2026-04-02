/**
 * Centralized logging schema for consistent structured logging
 *
 * Defines categories, event types, and context schemas used across
 * the entire OpenCode extension for debug-friendly, searchable logs.
 */

/**
 * Logging categories correspond to major components/modules
 * Use these as the "category" parameter in logger calls
 */
export const LoggingCategories = {
  EXTENSION: 'Extension',
  CHAT_VIEW: 'ChatView',
  SESSION_SERVICE: 'SessionService',
  QUEUE_MANAGER: 'QueueManager',
  MODEL_AGENT_MANAGER: 'ModelAgentManager',
  PLAN_MANAGER: 'PlanManager',
  STREAM_HANDLER: 'StreamHandler',
  SERVER_MANAGER: 'ServerManager',
  UI_INTERACTION: 'UIInteraction',
  FEATURE_FLOW: 'FeatureFlow',
} as const;

/**
 * Standard event types for structured logging
 */
export const LogEventTypes = {
  FEATURE_START: 'feature_start',
  FEATURE_END: 'feature_end',
  STATE_CHANGE: 'state_change',
  UI_ACTION: 'ui_action',
} as const;

/**
 * Context schema types for type-safe logging contexts
 */
export interface LogContext {
  correlationId?: string;
  sessionId?: string;
  timestamp?: string;
}

/**
 * Feature flow tracking interface
 */
export interface FeatureFlowLog {
  featureName: string;
  correlationId: string;
  startTime: number;
  steps: Array<{
    stepName: string;
    timestamp: number;
    context?: LogContext;
  }>;
  metadata?: Record<string, unknown>;
}

/**
 * State change log interface
 */
export interface StateChangeLog {
  stateKey: string;
  oldValue: unknown;
  newValue: unknown;
  correlationId?: string;
}

/**
 * UI interaction log interface
 */
export interface UIInteractionLog {
  component: string;
  action: string;
  element?: string;
  payload?: Record<string, unknown>;
}
