import type { StructuredResponseType as SharedStructuredResponseType } from "./generated/structuredOutputSchema";
import type { DisplayError } from "../../../../../src/providers/chat/types";

export interface SessionStats {
  input: number;
  output: number;
  read: number;
  write: number;
  duration: number;
}

export interface Model {
  modelID: string;
  providerID: string;
  name: string;
  providerName?: string;
  contextLimit?: number;
  reasoning?: boolean;
  variants?: string[];
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  mode?: "subagent" | "primary" | "all";
  builtIn?: boolean;
  color?: string;
}

export interface Session {
  id: string;
  title?: string;
  createdAt?: number;
  parentSessionId?: string;
}

export interface ContextItem {
  file: string;
  lineInfo: string;
  isAuto?: boolean;
  content?: string;
  languageId?: string;
}

export interface FileResult {
  path: string;
  name: string;
}

/** Mirrors TUI @ autocomplete categories: agents, files, MCP resources. */
export type MentionResult =
  | { type: "agent"; id: string; name: string; description?: string; color?: string }
  | { type: "file"; path: string; name: string }
  | { type: "resource"; uri: string; name: string; description?: string; clientName: string; mimeType?: string };

export interface SlashCommand {
  name: string;
  description?: string;
  agent?: string;
  model?: string;
  template?: string;
  source?: string;
  subtask?: boolean;
}

/**
 * Skill info from SkillManagementService
 */
export interface Skill {
  name: string;
  description: string;
  path: string;
  enabled: boolean;
  source: "project" | "global" | "server";
}

/**
 * Custom skill definition stored locally
 */
export interface SkillDefinition {
  name: string;
  displayName: string;
  version: string;
  description: string;
  agent?: string;
  model?: string;
  template?: string;
  subtask?: boolean;
  author?: string;
  homepage?: string;
  repository?: string;
  license?: string;
  installedAt: string;
  installedFrom: string;
  lastUpdated: string;
  dependencies?: {
    skills?: string[];
    minVersion?: string;
  };
  $schema?: string;
}

/**
 * Metadata index for all installed skills
 */
export interface SkillsMetadata {
  version: number;
  skills: {
    [skillName: string]: {
      path: string;
      version: string;
      installedAt: string;
      installedFrom: string;
      lastChecked: string;
      hash?: string;
    };
  };
  settings: {
    autoUpdate: boolean;
    updateCheckInterval: number;
  };
}

/**
 * Installation result
 */
export interface InstallResult {
  success: boolean;
  skill?: SkillDefinition;
  error?: string;
  details?: Array<{ field: string; message: string }>;
}

/**
 * Progress update during installation
 */
export interface ProgressUpdate {
  stage: 'downloading' | 'validating' | 'checking_conflicts' | 'saving' | 'updating_metadata';
  percent: number;
  message: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors?: Array<{ field: string; message: string }>;
}

/**
 * Webview message types for skill operations
 */
export type SkillMessage =
  | { type: 'getMySkills' }
  | { type: 'installSkill'; source: 'url' | 'file' | 'git'; data: string }
  | { type: 'removeSkill'; name: string }
  | { type: 'updateSkill'; name: string }
  | { type: 'editSkill'; name: string; updates: Partial<SkillDefinition> }
  | { type: 'checkUpdates' }
  | { type: 'validateSkill'; skill: unknown };

/**
 * Webview response types for skill operations
 */
export type SkillResponse =
  | { type: 'mySkills'; skills: SkillDefinition[] }
  | { type: 'skillInstalled'; skill: SkillDefinition }
  | { type: 'skillRemoved'; name: string }
  | { type: 'skillUpdated'; name: string; newVersion: string }
  | { type: 'updatesAvailable'; updates: { [name: string]: string } }
  | { type: 'installProgress'; progress: ProgressUpdate }
  | { type: 'skillError'; error: string };

export interface QueueItem {
  id: string;
  sessionId: string;
  createdAt: number;
  text: string;
  files?: string[];
  contexts?: ContextItem[];
  images?: unknown[];
  agent?: string;
}

export interface PendingUserMessage {
  id: string;
  sessionId: string;
  createdAt: number;
  text: string;
  clientRequestId?: string;
  images?: string[];
  attachments?: AttachmentItem[];
  /** File/resource contexts selected through @ mentions before SDK hydration. */
  contexts?: ContextItem[];
  interactiveSubmit?: boolean;
  confirmedMessageId?: string;
  confirmedAt?: number;
}

export interface StreamingStep {
  id?: string;
  callID?: string;
  sessionID?: string;
  title: string;
  type: "step" | "tool" | "reasoning";
  status: "pending" | "running" | "done" | "completed" | "error";
  source?: "stream" | "final" | "raw_debug";
  partType?: string;
  internal?: boolean;
  meta?: string;
  filePath?: string;
  startedAt?: number;
  endedAt?: number;
  startTime?: number;
  /** Monotonic sequence stamp (Date.now()) set by the store when the step first arrives. */
  streamSeq?: number;
  duration?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  diffStats?: { added: number; deleted: number };
  activityDetail?: ActivityDetail;
  showLogger?: boolean;
}

export interface ReasoningEvent {
  text: string;
  createdAt: number;
  partID?: string;
  messageID?: string;
  /** Unix-ms timestamps supplied by the SDK reasoning part. */
  startedAt?: number;
  endedAt?: number;
  delta?: boolean;
}

export interface StreamingState {
  messageId: string | null;
  content: string;
  /** True only after explicit renderable assistant text/message content is observed. */
  hasRenderableContent?: boolean;
  reasoning: string;
  reasoningEvents: ReasoningEvent[];
  steps: StreamingStep[];
  progressEvents: StreamingStep[];
  /** Explicit assistant completion signal from the live message payload. */
  hasAssistantFinishSignal?: boolean;
  hasTerminalStepSignal?: boolean;
  edits: string[];
  isActive: boolean;
  usage?: { total: number; duration?: number };
  /** Date.now() timestamp recorded when the first non-empty content chunk arrives. */
  contentStartSeq?: number;
  /** Metadata about the model/agent being used for this streaming response */
  agent?: string;
  model?: { modelID: string; providerID: string; name?: string };
  modelID?: string;
  providerID?: string;
  variant?: string;
  responseType?: StructuredResponseType;
  type?: StructuredResponseType;
  plan?: {
    file?: string;
    files?: unknown[];
    content?: string;
    title?: string;
    intro?: string;
    summary?: string;
    fileCount?: number;
  };
  structuredOutput?: {
    type?: StructuredResponseType;
    text?: string;
    /** @deprecated legacy alias kept for compatibility while the schema migrates to `type`. */
    responseType?: StructuredResponseType;
    /** @deprecated legacy alias kept for compatibility while the schema migrates to `text`. */
    message?: string;
    plan?: {
      file?: string;
      files?: unknown[];
      content?: string;
      title?: string;
      intro?: string;
      summary?: string;
      fileCount?: number;
    };
    progressUpdates?: Array<{
      title?: string;
      status?: "pending" | "done" | "error";
      kind?: "tool_call" | "file_edit" | "command" | "read" | "search" | "other";
      command?: string;
      output?: string;
      file?: string;
      diffStats?: {
        added?: number;
        deleted?: number;
      };
      diffExcerpt?: ActivityDiffExcerpt;
    }>;
    interactiveEvents?: InteractiveEvent[];
  };
  interactiveEvents?: InteractiveEvent[];
  liveSessionStatus?: {
    statusType: string;
    message?: string;
    attempt?: number;
    next?: number;
    sessionId?: string;
    source?: string;
    updatedAt?: number;
  };
  rawStructuredOutputs?: unknown[];
  inThoughtBlock?: boolean;
  /** Track if currently processing a reasoning part to prevent content leakage */
  inReasoningPart?: boolean;
  rawSdkEventPayloads?: unknown[];
}

export interface MessageInfo {
  id?: string;
  /** Parent user-message ID for an SDK assistant envelope. */
  parentID?: string;
  agent?: string;
  role?: string;
  model?: { modelID: string; providerID: string };
  modelID?: string;
  providerID?: string;
  variant?: string;
  summary?: {
    title?: string;
    body?: string;
  };
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  duration?: number;
  finish?: boolean;
  structured?: {
    fileChanges?: StructuredFileChange[];
  } & Record<string, unknown>;
  structuredOutput?: {
    fileChanges?: StructuredFileChange[];
  } & Record<string, unknown>;
  terminalRawIndex?: number;
  interruptedPresentation?: "inline" | "detached";
}

export interface MessagePartSource {
  path?: string;
  type?: string;
  uri?: string;
  languageId?: string;
  lineInfo?: string;
  name?: string;
  kind?: number;
  range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } };
  text?: { value: string; start: number; end: number };
}

export interface MessagePart {
  type?: string;
  text?: string;
  /** True for SDK transport text that is not user-visible message content. */
  synthetic?: boolean;
  content?: string;
  message?: string;
  reasoning?: string;
  thought?: string;
  thinking?: string;
  url?: string;
  filename?: string;
  files?: string[];
  hash?: string;
  source?: MessagePartSource;
  mime?: string;
}

export interface SourceRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface CodeSelectionSource extends MessagePartSource {
  type: "file";
  path: string;
  text: { value: string; start: number; end: number };
  lineInfo?: string;
  languageId?: string;
}

export interface CodeSelectionMessagePart extends MessagePart {
  type: "file";
  mime?: string;
  filename?: string;
  url?: string;
  source: CodeSelectionSource;
}

export interface OpenCodeRawResponsePart {
  type?: string;
  text?: string;
  content?: string;
  message?: string;
  reasoning?: string;
  thought?: string;
  thinking?: string;
  reason?: string;
  snapshot?: string;
  id?: string;
  sessionID?: string;
  messageID?: string;
  time?: {
    start?: number;
    end?: number;
    [key: string]: unknown;
  };
  state?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface OpenCodeRawResponseInfo {
  parentID?: string;
  role?: string;
  mode?: string;
  agent?: string;
  variant?: string;
  path?: {
    cwd?: string;
    root?: string;
    [key: string]: unknown;
  };
  cost?: number;
  tokens?: {
    total?: number;
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: {
      read?: number;
      write?: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  modelID?: string;
  providerID?: string;
  time?: {
    created?: number;
    completed?: number;
    start?: number;
    end?: number;
    [key: string]: unknown;
  };
  finish?: string;
  id?: string;
  sessionID?: string;
  structured?: Record<string, unknown>;
  structuredOutput?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface OpenCodeRawResponse {
  info?: OpenCodeRawResponseInfo;
  parts?: OpenCodeRawResponsePart[];
  message?: string;
  text?: string;
  content?: string;
  structured?: Record<string, unknown>;
  structuredOutput?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MessageEdit {
  file: string;
  added?: number;
  deleted?: number;
}

export interface MessageStep {
  type: string;
  title: string;
  content?: string;
  status?: string;
  source?: "stream" | "final" | "raw_debug";
  partType?: string;
  internal?: boolean;
  meta?: string;
  diffStats?: { added: number; deleted: number };
  activityDetail?: ActivityDetail;
  /** Tool-call deduplication key, mirrors StreamingStep.callID */
  callID?: string;
  /** Step identity key, mirrors StreamingStep.id */
  id?: string;
  /** SDK message/session ownership retained for hydrated tool parts. */
  messageID?: string;
  sessionID?: string;
  /** SDK tool execution timestamps in Unix milliseconds. */
  startedAt?: number;
  endedAt?: number;
  /** Arrival-order sequence number, mirrors StreamingStep.streamSeq — used to replay interleaved timeline on reload */
  streamSeq?: number;
  /** File path associated with this step, used for deduplication */
  filePath?: string;
}

export interface CentralizedDebugSourceData {
  sessionId?: string;
  rawSdkEventPayloads?: unknown[];
}

export interface CentralizedDebugData {
  rawEventStream?: CentralizedDebugSourceData;
}

export interface MessageChangeSummaryFile {
  file: string;
  added: number;
  deleted: number;
  diffExcerpt?: ActivityDiffExcerpt;
}

export interface StructuredFileChange {
  file: string;
  kind?: "file_edit" | "file_create" | "file_delete" | "file_move" | "other";
  diffStats?: {
    added?: number;
    deleted?: number;
  };
  diffExcerpt?: ActivityDiffExcerpt;
}

export interface MessageChangeSummary {
  messageId?: string;
  filesChanged: number;
  added: number;
  deleted: number;
  files: MessageChangeSummaryFile[];
}

export interface CentralizedSessionDiffFile {
  file: string;
  patch?: string;
  additions?: number;
  deletions?: number;
  status?: string;
}

export interface CentralizedSessionDiffEvent {
  id?: string;
  sessionId?: string;
  messageId?: string;
  createdAt?: number;
  files: CentralizedSessionDiffFile[];
}

export interface ActivityDiffExcerpt {
  header?: string;
  lines?: string[];
  added?: number;
  deleted?: number;
}

export interface ActivityDetail {
  kind?: "tool_call" | "file_edit" | "command" | "read" | "search" | "other";
  summary?: string;
  command?: string;
  input?: Record<string, unknown>;
  files?: string[];
  output?: string;
  backgroundTaskId?: string;
  backgroundOutput?: string;
  tool?: string;
  query?: string;
  file?: string;
  isDirectory?: boolean;
  /** Display title for read steps (e.g., relative path like "desktop/renderer/package.json") */
  title?: string;
  diffExcerpt?: ActivityDiffExcerpt;
  metadata?: Record<string, string | number | boolean>;
  sessionID?: string;
}

export interface InteractiveChoice {
  id?: string;
  label: string;
  value?: string;
  description?: string;
  recommended?: boolean;
}

export type InteractiveUiCategory = "quick_input" | "passive";

export interface InteractiveQuestionEvent {
  type: 'question';
  id: string;
  title?: string;
  uiCategory?: InteractiveUiCategory;
  /** SDK-native question request id, used to reply through /question/{requestID}/reply. */
  requestID?: string;
  /** SDK-native index of this question within the request. */
  questionIndex?: number;
  question: string;
  options: InteractiveChoice[];
  multiSelect?: boolean;
  allowCustomInput?: boolean;
  answer?: string;
  answers?: string[];
  /** Optional full AI context shown as header in the popup card. Sourced from displayPrompt. */
  contextMessage?: string;
}

export interface InteractiveConfirmEvent {
  type: 'confirm';
  id: string;
  title?: string;
  uiCategory?: InteractiveUiCategory;
  question: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional full AI context shown as header in the popup card. Sourced from displayPrompt. */
  contextMessage?: string;
}

export interface InteractiveQuickActionsEvent {
  type: 'quick_actions';
  id: string;
  title?: string;
  uiCategory?: InteractiveUiCategory;
  actions: InteractiveChoice[];
  /** Optional full AI context shown as header in the popup card. Sourced from displayPrompt. */
  contextMessage?: string;
}

export interface InteractiveMessageEvent {
  type: 'message';
  id: string;
  title?: string;
  uiCategory?: InteractiveUiCategory;
  message: string;
  dismissLabel?: string;
  /** Optional full AI context shown as header in the popup card. Sourced from displayPrompt. */
  contextMessage?: string;
}

export type InteractiveEvent =
  | InteractiveQuestionEvent
  | InteractiveConfirmEvent
  | InteractiveQuickActionsEvent
  | InteractiveMessageEvent;

// REFACTORED: Subagent types now exported from modular system
// These imports maintain backward compatibility while using the single source of truth
import type { SubagentStatus } from './subagents/types';
import type { SubagentReference } from './subagents/types';
import type { SubagentTimelineEvent } from './subagents/types';
import type { SubagentThinkingEvent } from './subagents/types';
import type { SubagentConversationEvent } from './subagents/types';
import type { SubagentProgressEvent } from './subagents/types';
import type { SubagentSummary } from './subagents/types';
import type { SubagentDetail } from './subagents/types';
import type { SubagentEntityStore } from './subagents/types';
import type { NormalizedSubagentEvent } from './subagents/types';

// Re-export for backward compatibility
export type { SubagentStatus, SubagentReference, SubagentTimelineEvent, SubagentThinkingEvent, SubagentConversationEvent, SubagentProgressEvent, SubagentSummary, SubagentDetail, SubagentEntityStore, NormalizedSubagentEvent, SubagentPresentationPolicy };


export interface Message {
  role?: string;
  responseType?: StructuredResponseType;
  structuredOutput?: {
    responseType?: StructuredResponseType;
    message?: string;
    fileChanges?: StructuredFileChange[];
    plan?: {
      file?: string;
      files?: unknown[];
      content?: string;
      title?: string;
      intro?: string;
      summary?: string;
      fileCount?: number;
    };
  };
  parts?: MessagePart[];
  text?: string;

  content?: string;
  rawResponse?: OpenCodeRawResponse | string;
  rawSdkEventPayloads?: unknown[];
  reasoningPayload?: {
    events: ReasoningEvent[];
    sources?: Array<"stream" | "final" | "raw_debug">;
  };
  reasoningEvents?: ReasoningEvent[];
  progressEvents?: MessageStep[];
  info?: MessageInfo;
  plan?: {
    file?: string;
    files?: unknown[];
    content?: string;
    title?: string;
    intro?: string;
    summary?: string;
    fileCount?: number;
  };
  edits?: MessageEdit[];
  steps?: MessageStep[];
  timing?: { duration?: number };
  changeSummary?: MessageChangeSummary;
  // Optional image attachments as data URLs
  images?: string[];
  // Optional structured attachments
  attachments?: AttachmentItem[];
  // Optional subagent summaries/details
  subagents?: SubagentDetail[];
  // Optional interactive UI event payloads
  interactiveEvents?: InteractiveEvent[];
  rawStructuredOutputs?: unknown[];
  // Optional top-level fields for backwards compatibility with flattened persisted messages
  // These fields are also in info, but older persisted messages may have them at top level
  id?: string;
  agent?: string;
  model?: { modelID: string; providerID: string; name?: string };
  modelID?: string;
  providerID?: string;
  variant?: string;
  summary?: { title?: string; body?: string };
  tokens?: {
    input?: number;
    output?: number;
    cache?: { read?: number; write?: number };
  };
  duration?: number;
  created?: number;
  /** Optional error message if the generation failed */
  error?: string;
  /** Optional retry hint: resend prompt without structured output schema */
  retryWithoutStructuredOutput?: boolean;
  /** Optional persistent retry status for UI banners */
  retryState?: "retrying_without_structured_output";
  /** Optional persistent retry banner message */
  retryMessage?: string;
  /** Optional retry banner timestamp */
  retryStartedAt?: number;
  /** Indicates this assistant message is a plain-text fallback after structured output failure. */
  plainTextFallback?: boolean;
  /** Short user-facing fallback note for hover/tooltips. */
  plainTextFallbackMessage?: string;
  /** Optional compact reason for fallback (debug-friendly). */
  plainTextFallbackReason?: string;
  /** Indicates this assistant message was aborted by the user (stop button). */
  aborted?: boolean;
  /** Carries the centralized raw index for a detached terminal lifecycle marker. */
  terminalRawIndex?: number;
  /**
   * Single source of truth for how an interrupted assistant turn should render:
   * `inline` keeps the badge on the assistant card; `detached` renders a later
   * synthetic interruption row at the centralized abort position.
   */
  interruptedPresentation?: "inline" | "detached";
  /** Marks a user echo as an interactive popover answer submission. */
  interactiveSubmit?: boolean;
  /** Optional structured error information for display in the UI */
  displayError?: DisplayError;
}

export type StructuredResponseType = SharedStructuredResponseType;

export interface QuotaItem {
  label: string;
  remainPercent: number;
  usedTotalDisplay?: string;
  percentLabel?: string;
  resetLabel?: string;
  note?: string;
}

export interface PlatformQuota {
  platform: string;
  account: string;
  accountLabel?: string;
  title?: string;
  status: 'ok' | 'warning' | 'error';
  error?: string;
  quotas: QuotaItem[];
}

export interface QuotaData {
  platforms: PlatformQuota[];
  lastUpdated: number;
}

export interface CompatibilityWarning {
  component: "sdk" | "server";
  status: "untested" | "unknown";
  version?: string;
  supportedRange: string;
  message: string;
}

// ── MCP / LSP Server Info Types ────────────────────────────────────────────────

export type McpServerStatus =
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'needs_auth'
  | 'needs_client_registration'
  | 'disabled';

export interface McpServerInfo {
  /** Server name as registered in opencode config */
  name: string;
  status: McpServerStatus;
  /** Present when status is 'failed' or 'needs_client_registration' */
  error?: string;
  /** Tool IDs belonging to this server (matched by prefix convention) */
  tools: string[];
}

export interface LspServerInfo {
  id: string;
  name: string;
  root: string;
  status: 'connected' | 'error';
}

export interface AppState {
  selectedFiles: string[];
  selectedContexts: ContextItem[];
  /** Maps @filename mentions to their full paths for SDK attachment */
  fileMentionPaths: Record<string, string>;
  availableModels: Model[];
  /** Provider IDs that are configured/connected in OpenCode (from SDK config.providers()) */
  configuredProviders: string[];
  selectedModel: { providerID: string; modelID: string } | null;
  modelSearchQuery: string;
  availableAgents: Agent[];
  selectedAgent: string;
  agentSearchQuery: string;
  isProcessing: boolean;
  isSteering: boolean;
  currentSessionId: string | null;
  messages: Message[];
  messagesBySessionId?: Record<string, Message[]>;
  /**
   * LOCKED CONTRACT — copied only from the current OpenCode SDK server
   * `client.session.messages()` response. This is an in-memory debug mirror,
   * never persisted and never a source/fallback for rehydration.
   */
  sdkMessagesBySessionId?: Record<string, unknown[]>;
  /** Unfiltered live stream mirror for debugging; intentionally never persisted. */
  liveEventStreamBySessionId?: Record<string, unknown[]>;
  liveToastNotificationsBySessionId?: Record<string, import("./toastEvents").CentralizedToastNotification[]>;
  promptQueue: QueueItem[];
  queueBySessionId: Record<string, QueueItem[]>;
  pendingUserMessagesBySessionId?: Record<string, PendingUserMessage[]>;
  isExecutingQueue: boolean; // Legacy global flag, to be removed or used carefully
  executingQueueSessionIds: Set<string>;
  isQueueOpen: boolean;
  isSidebarOpen: boolean;
  isSessionModalOpen: boolean;
  isExtendedPanelOpen: boolean;
  isQuotaPopoverOpen: boolean;
  sessionsList: Session[];
  processingSessionIds: string[];
  sessionEdits: Set<string>;
  sessionStats: SessionStats;
  sessionsStatsById?: Record<string, SessionStats>;
  /** Indicates a session is currently being loaded from persistence */
  isLoadingSession: boolean;
  /** User-facing title of the session being loaded */
  loadingSessionTitle: string | null;
  /** ID of the session being loaded (null if not loading) */
  loadingSessionId: string | null;
  /** True while the current assistant turn is still in flight, even if the live stream briefly drops out. */
  assistantTurnPending: boolean;
  /** Message ID for the assistant turn that is still in flight. */
  assistantTurnMessageId: string | null;
  streaming: StreamingState | null;
  /** Last known streaming snapshot by session, used when returning to active sessions. */
  streamingBySessionId?: Record<string, StreamingState>;
  inputValue: string;
  fileSuggestions: FileResult[];
  showFileSuggestions: boolean;
  selectedSuggestionIndex: number;
  mentionSuggestions: MentionResult[];
  showMentionSuggestions: boolean;
  selectedMentionIndex: number;
  availableCommands: SlashCommand[];
  commandsLoaded: boolean;
  receivedInitState: boolean;
  serverStatus: string;
  serverError?: string;
  sdkVersion?: string;
  serverVersion?: string;
  compatibilityWarnings: CompatibilityWarning[];
  modelDropdownOpen: boolean;
  agentDropdownOpen: boolean;
  thinkingDropdownOpen: boolean;
  modelCapability?: ModelCapability | null;
  isCompacting: boolean;
  lastCompactedAt?: number;
  compactionError?: string;
  compactionNotice?: string;
  compactionBaselineStats?: SessionStats;
  compactionDividerIndex?: number;
  compactionDividerBeforeMessageId?: string;
  compactionDividerAfterMessageId?: string;
  compactedMessagesCollapsed: boolean;
  errorMessages: string[];
  quotaData: QuotaData | null | undefined;
  quotaIsRefreshing: boolean;
  attachments?: AttachmentItem[];
  thinkingLevel?: ThinkingLevel;
  todoItems?: TodoItem[];
  subagentStore: SubagentEntityStore;
  subagentsByParentMessageId: Record<string, SubagentSummary[]>;
  subagentDetailsById: Record<string, SubagentDetail>;
  selectedSubagentId: string | null;
  subagentsPanelOpen: boolean;
  interactiveEvents: InteractiveEvent[];
  dismissedInteractiveEventKeys: Set<string>;
  mcpServers: McpServerInfo[];
  lspServers: LspServerInfo[];
  /** Latest SDK-reported input tokens, i.e. the current model context size. */
  contextInputTokens?: number;
  contextUsagePct?: number; // 0–100, context window usage from tokens.input / contextLimit
  opencodeConfig?: {
    content: string;
    filePath: string;
    fileName: string;
    isGlobal: boolean;
    error?: string;
    files?: ConfigFileInfo[]; // Available config files
  };
  opencodeConfigSaveStatus?: {
    success: boolean;
    filePath: string;
    savedAt: number;
    message?: string;
    error?: string;
  };
  configFiles?: ConfigFilesState;
  revertState?: RevertState | null;
  /** Incremented when theme CSS is injected to force FileIcon components to re-check for theme icons */
  themeCssVersion: number;
}

export interface RevertState {
  messageID: string;
  partID?: string;
  snapshot?: string;
  diff?: string;
}

export interface ConfigFileInfo {
  name: string;
  path: string;
  lastModified: number;
  size: number;
}

export interface AttachmentItem {
  id: string;
  dataUrl: string;
  filename?: string;
  mimeType: string;
}

export type ThinkingLevel = string;

export interface ModelCapability {
  reasoning: boolean;
  variants?: string[];
  thinkingConfig?: Record<string, unknown> | null;
}

export interface TodoItem {
  id?: string;
  text?: string;
  content?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'failed' | string;
  sessionId?: string;
  parentMessageId?: string;
  // optional human-friendly description used by the UI
  description?: string;
  priority?: 'high' | 'medium' | 'low';
  source?: 'sdk';
}

export interface PlanComment {
  id: string;
  anchor: {
    startLine: number;
    endLine: number;
    selectedText: string;
    surroundingText?: string;
  };
  text: string;
  createdAt: number;
  resolved?: boolean;
}

export interface ConfigFile {
  name: string;
  path: string;
  content: string;
  lastModified: number;
  size: number;
}

export interface ConfigFilesState {
  files: ConfigFile[];
  activeFileName: string | null;
  isSaving: boolean;
  globalError: string;
}
