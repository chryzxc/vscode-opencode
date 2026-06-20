/**
 * Shared type definitions for ChatViewProvider modules
 *
 * This file contains all shared types used across the chat modules.
 * Originally defined in ChatViewProvider.ts (lines 137-364).
 */

import type {
  StructuredResponseType as StructuredResponseTypeDefinition,
} from "../../shared/structuredOutputSchema";

/**
 * A queued prompt waiting to be executed
 */
export type QueuedPrompt = {
  id: string;
  sessionId: string;
  createdAt: number;
  text: string;
  userFacingText?: string;
  files?: string[];
  contexts?: {
    file: string;
    lineInfo: string;
    content: string;
    languageId: string;
  }[];
  images?: {
    dataUrl: string;
    filename?: string;
  }[];
  agent?: string;
};

/**
 * Mode for dispatching a prompt
 */
export type PromptDispatchMode = "queue" | "steer" | "send-now";

/**
 * A comment on a plan proceed action
 */
export type PlanProceedComment = {
  id: string;
  anchor: {
    startLine: number;
    endLine: number;
    selectedText: string;
    surroundingText?: string;
  };
  text: string;
  createdAt: number;
};

/**
 * Session-specific settings
 */
export type SessionSettings = {
  agent?: string;
  model?: { providerID: string; modelID: string; providerName?: string };
  thinkingLevel?: string;
  thinkingByModel?: Record<string, string>;
};

/**
 * Context recovered from a previous session
 */
export type RecoveredSessionContext = {
  previousSessionId: string;
  transcript: string;
};

/**
 * Structured response type from the schema
 */
export type StructuredResponseType = StructuredResponseTypeDefinition;

/**
 * A slash command available in the chat
 */
export type ChatSlashCommand = {
  name: string;
  description?: string;
  agent?: string;
  model?: string;
  template?: string;
  source?: string;
  subtask?: boolean;
};

/**
 * A model option available for selection
 */
export type ChatModelOption = {
  providerID: string;
  modelID: string;
  name: string;
  providerName: string;
  contextLimit?: number;
  reasoning?: boolean;
  variants?: string[];
};

/**
 * Statistics from a compaction baseline
 */
export type CompactionBaselineStats = {
  input: number;
  output: number;
  read: number;
  write: number;
  duration: number;
};

/**
 * Persisted compaction view state for a session
 */
export type PersistedCompactionViewState = {
  lastCompactedAt?: number;
  baselineStats?: CompactionBaselineStats;
  compactionDividerIndex?: number;
  compactionDividerBeforeMessageId?: string;
  compactionDividerAfterMessageId?: string;
  collapsed?: boolean;
};

/**
 * A progress update in a structured response
 */
export type StructuredProgressUpdate = {
  title: string;
  status?: "pending" | "done" | "error";
  meta?: string;
  filePath?: string;
  // Activity kind for categorization
  kind?: "tool_call" | "file_edit" | "command" | "read" | "search" | "other";
  // File path for file edit operations
  file?: string;
  // Command text for bash/shell operations
  command?: string;
  // Terminal output from command execution
  output?: string;
  // Diff statistics for file edits
  diffStats?: {
    added?: number;
    deleted?: number;
  };
  // Compact diff preview showing representative code changes
  diffExcerpt?: {
    header?: string;
    lines?: string[];
    added?: number;
    deleted?: number;
  };
};

/**
 * A marker for assistant history messages
 */
export type AssistantHistoryMarker = {
  id?: string;
  fingerprint?: string;
  createdAt?: number;
  richness: number;
};

/**
 * An interactive choice in a structured response
 */
export type StructuredInteractiveChoice = {
  id?: string;
  label: string;
  value?: string;
  description?: string;
};

/**
 * An interactive event in a structured response
 */
export type StructuredInteractiveEvent =
  | {
      type: "question";
      id?: string;
      title?: string;
      question: string;
      options: StructuredInteractiveChoice[];
      multiSelect?: boolean;
      allowCustomInput?: boolean;
    }
  | {
      type: "confirm";
      id?: string;
      title?: string;
      question: string;
      confirmLabel?: string;
      cancelLabel?: string;
    }
  | {
      type: "quick_actions";
      id?: string;
      title?: string;
      actions: StructuredInteractiveChoice[];
    }
  | {
      type: "message";
      id?: string;
      title?: string;
      message: string;
      dismissLabel?: string;
    };

/**
 * Structured assistant output containing various response types
 */
export type StructuredAssistantOutput = {
  type?: StructuredResponseType | string;
  text?: string;
  /** @deprecated legacy alias kept for compatibility while the schema migrates to `type`. */
  responseType?: StructuredResponseType | string;
  /** @deprecated legacy alias kept for compatibility while the schema migrates to `text`. */
  message?: string;
  raw?: Record<string, unknown>;
  /**
   * Per-file change metadata emitted by structured output.
   * Runtime normalization may coerce malformed provider payloads before validation.
   */
  fileChanges?: Array<{
    file: string;
    kind?: string;
    diffStats?: {
      added?: number;
      deleted?: number;
    };
    diffExcerpt?: {
      header?: string;
      lines?: string[];
      added?: number;
      deleted?: number;
    };
  }>;
  reasoning?: string[];
  progressUpdates?: StructuredProgressUpdate[];
  interactiveEvents?: StructuredInteractiveEvent[];
  subagents?: Array<{
    id: string;
    backgroundTaskId?: string;
    name: string;
    agentRole?: string;
    agentType?: string;
    status?: string;
    progress?: number;
    description?: string;
    latestActivity?: string;
    childSessionId?: string;
    parentSessionId?: string;
    parentMessageId?: string;
    timelineEvents?: Array<{
      key?: string;
      type?: string;
      label?: string;
      createdAt?: number;
      messageID?: string;
      partID?: string;
      callID?: string;
    }>;
    progressEvents?: Array<{
      id?: string;
      title?: string;
      status?: string;
      meta?: string;
      filePath?: string;
      createdAt?: number;
      messageID?: string;
      partID?: string;
      callID?: string;
    }>;
    thinkingEvents?: Array<{
      id?: string;
      text?: string;
      createdAt?: number;
      messageID?: string;
      partID?: string;
    }>;
  }>;
  subagentsDelta?: {
    parentMessageId?: string;
    items: Array<{
      id: string;
      backgroundTaskId?: string;
      name?: string;
      agentRole?: string;
      agentType?: string;
      status?: string;
      progress?: number;
      description?: string;
      latestActivity?: string;
      childSessionId?: string;
      parentSessionId?: string;
      parentMessageId?: string;
    }>;
  };
  plan?: {
    file?: string;
    content?: string;
    title?: string;
    intro?: string;
    summary?: string;
    files?: any[]; // To match ImplementationPlan structure
    fileCount?: number;
  };
  question?: {
    type?: string;
    id?: string;
    title?: string;
    question?: string;
    multiSelect?: boolean;
    allowCustomInput?: boolean;
    options?: Array<{ id?: string; label?: string; value?: string; description?: string }>;
    actions?: Array<{ id?: string; label?: string; value?: string; description?: string }>;
    confirmLabel?: string;
    cancelLabel?: string;
    dismissLabel?: string;
    message?: string;
    content?: string;
  };
};

/**
 * Set of all valid structured response types (lowercase)
 */
export const STRUCTURED_RESPONSE_TYPES = new Set(
  (
    (
      (structuredOutputSchema as any).schema?.properties as {
        type?: { enum?: string[] };
      }
    )?.type?.enum ?? []
  ).map((value: string) => value.toLowerCase()),
);

/**
 * Normalized error structure for display in webview
 */
export interface DisplayError {
  type: 'api_error' | 'timeout' | 'structured_output_failure' | 'unknown';
  message: string;
  originalError?: string; // Raw error for debugging
  canRetry: boolean;
  retryWithoutStructuredOutput?: boolean;
  metadata?: {
    statusCode?: number;
    errorName?: string;
    provider?: string;
    model?: string;
  };
}

// Re-import structuredOutputSchema for the constant above
import { structuredOutputSchema } from "../../shared/structuredOutputSchema";
