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

export interface StreamingStep {
  id?: string;
  callID?: string;
  title: string;
  type: "step" | "tool" | "reasoning";
  status: "pending" | "done" | "error";
  source?: "stream" | "final" | "raw_debug";
  partType?: string;
  internal?: boolean;
  meta?: string;
  filePath?: string;
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
}

export interface ReasoningEvent {
  text: string;
  createdAt: number;
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
    responseType?: StructuredResponseType;
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
  };
  interactiveEvents?: InteractiveEvent[];
  rawStructuredOutputs?: unknown[];
  inThoughtBlock?: boolean;
  /** Track if currently processing a reasoning part to prevent content leakage */
  inReasoningPart?: boolean;
  rawSdkEventPayloads?: unknown[];
}

export interface MessageInfo {
  id?: string;
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
}

export interface MessagePart {
  type?: string;
  text?: string;
  content?: string;
  message?: string;
  reasoning?: string;
  thought?: string;
  thinking?: string;
  url?: string;
  filename?: string;
  files?: string[];
  hash?: string;
  source?: { path?: string };
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
  /** Arrival-order sequence number, mirrors StreamingStep.streamSeq — used to replay interleaved timeline on reload */
  streamSeq?: number;
  /** File path associated with this step, used for deduplication */
  filePath?: string;
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
  output?: string;
  tool?: string;
  query?: string;
  file?: string;
  diffExcerpt?: ActivityDiffExcerpt;
  metadata?: Record<string, string | number | boolean>;
}

export interface InteractiveChoice {
  id?: string;
  label: string;
  value?: string;
  description?: string;
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

export type SubagentStatus = 'pending' | 'running' | 'done' | 'error' | 'orphaned';

export interface SubagentReference {
  messageID?: string;
  partID?: string;
  callID?: string;
}

export interface SubagentTimelineEvent {
  key: string;
  type: string;
  label: string;
  createdAt: number;
  messageID?: string;
  partID?: string;
  callID?: string;
}

export interface SubagentThinkingEvent {
  id: string;
  text: string;
  createdAt: number;
  messageID?: string;
  partID?: string;
}

export interface SubagentConversationEvent {
  id: string;
  role: string;
  kind: 'message' | 'reasoning' | 'step';
  text: string;
  createdAt: number;
  messageID?: string;
  partID?: string;
}

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

export interface SubagentDetail extends SubagentSummary {
  thinkingEvents: SubagentThinkingEvent[];
  conversationEvents?: SubagentConversationEvent[];
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
  rawResponse?: unknown;
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
  promptQueue: QueueItem[];
  queueBySessionId: Record<string, QueueItem[]>;
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
  subagentsByParentMessageId: Record<string, SubagentSummary[]>;
  subagentDetailsById: Record<string, SubagentDetail>;
  selectedSubagentId: string | null;
  subagentsPanelOpen: boolean;
  interactiveEvents: InteractiveEvent[];
  dismissedInteractiveEventKeys: Set<string>;
  mcpServers: McpServerInfo[];
  lspServers: LspServerInfo[];
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
  /** Incremented when theme CSS is injected to force FileIcon components to re-check for theme icons */
  themeCssVersion: number;
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
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'failed';
  sessionId: string;
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
