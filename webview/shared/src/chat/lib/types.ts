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
}

export interface Agent {
  id: string;
  name: string;
  description: string;
}

export interface Session {
  id: string;
  title?: string;
  createdAt?: number;
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

export interface QueueItem {
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
  meta?: string;
  filePath?: string;
  startTime?: number;
  /** Monotonic sequence stamp (Date.now()) set by the store when the step first arrives. */
  streamSeq?: number;
  duration?: number;
  tokens?: {
    input?: number;
    output?: number;
    cache?: { read?: number; write?: number };
  };
}

export interface ReasoningEvent {
  text: string;
  createdAt: number;
}

export interface StreamingState {
  messageId: string | null;
  content: string;
  reasoning: string;
  reasoningEvents: ReasoningEvent[];
  steps: StreamingStep[];
  progressEvents: StreamingStep[];
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
}

export interface MessageInfo {
  id?: string;
  agent?: string;
  role?: string;
  model?: { modelID: string; providerID: string };
  modelID?: string;
  providerID?: string;
  summary?: {
    title?: string;
    body?: string;
  };
  tokens?: {
    input?: number;
    output?: number;
    cache?: { read?: number; write?: number };
  };
  duration?: number;
  finish?: boolean;
}

export interface MessagePart {
  type?: string;
  text?: string;
  content?: string;
  reasoning?: string;
  thought?: string;
  thinking?: string;
  url?: string;
  filename?: string;
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
  meta?: string;
}

export interface InteractiveChoice {
  id?: string;
  label: string;
  value?: string;
  description?: string;
}

export interface InteractiveQuestionEvent {
  type: 'question';
  id: string;
  title?: string;
  question: string;
  options: InteractiveChoice[];
  multiSelect?: boolean;
  allowCustomInput?: boolean;
}

export interface InteractiveConfirmEvent {
  type: 'confirm';
  id: string;
  title?: string;
  question: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface InteractiveQuickActionsEvent {
  type: 'quick_actions';
  id: string;
  title?: string;
  actions: InteractiveChoice[];
}

export type InteractiveEvent =
  | InteractiveQuestionEvent
  | InteractiveConfirmEvent
  | InteractiveQuickActionsEvent;

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
  parentSessionId: string;
  parentMessageId: string;
  childSessionId?: string;
  agentId?: string;
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
  parts?: MessagePart[];
  text?: string;
  content?: string;
  reasoningEvents?: ReasoningEvent[];
  progressEvents?: MessageStep[];
  info?: MessageInfo;
  plan?: unknown;
  edits?: MessageEdit[];
  steps?: MessageStep[];
  timing?: { duration?: number };
  // Optional image attachments as data URLs
  images?: string[];
  // Optional structured attachments
  attachments?: AttachmentItem[];
  // Optional subagent summaries/details
  subagents?: SubagentDetail[];
  // Optional interactive UI event payloads
  interactiveEvents?: InteractiveEvent[];
  // Optional top-level fields for backwards compatibility with flattened persisted messages
  // These fields are also in info, but older persisted messages may have them at top level
  id?: string;
  agent?: string;
  model?: { modelID: string; providerID: string; name?: string };
  modelID?: string;
  providerID?: string;
  summary?: { title?: string; body?: string };
  tokens?: {
    input?: number;
    output?: number;
    cache?: { read?: number; write?: number };
  };
  duration?: number;
  created?: number;
}

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

// ── Budget Management Types ─────────────────────────────────────────────────────

export interface BudgetInfo {
  planName: string;
  monthlyQuota: number;
  usedToday: number;
  dailyAllowance: number;
  remainingToday: number;
  daysRemaining: number;
  projectedMonthlyUsage: number;
  warningLevel: 'ok' | 'warning' | 'critical';
  advice: string[];
}

export interface AppState {
  selectedFiles: string[];
  selectedContexts: ContextItem[];
  availableModels: Model[];
  selectedModel: { providerID: string; modelID: string } | null;
  modelSearchQuery: string;
  availableAgents: Agent[];
  selectedAgent: string;
  agentSearchQuery: string;
  isProcessing: boolean;
  currentSessionId: string | null;
  messages: Message[];
  promptQueue: QueueItem[];
  isExecutingQueue: boolean;
  isQueueOpen: boolean;
  isSidebarOpen: boolean;
  sessionsList: Session[];
  sessionEdits: Set<string>;
  sessionStats: SessionStats;
  sessionsStatsById?: Record<string, SessionStats>;
  streaming: StreamingState | null;
  inputValue: string;
  fileSuggestions: FileResult[];
  showFileSuggestions: boolean;
  selectedSuggestionIndex: number;
  receivedInitState: boolean;
  serverStatus: string;
  modelDropdownOpen: boolean;
  agentDropdownOpen: boolean;
  thinkingDropdownOpen: boolean;
  errorMessages: string[];
  quotaData: QuotaData | null;
  quotaIsRefreshing: boolean;
  attachments?: AttachmentItem[];
  thinkingLevel?: ThinkingLevel;
  todoItems?: TodoItem[];
  subagentsByParentMessageId: Record<string, SubagentSummary[]>;
  subagentDetailsById: Record<string, SubagentDetail>;
  selectedSubagentId: string | null;
  subagentsPanelOpen: boolean;
  interactiveEvents: InteractiveEvent[];
  budgetInfo: BudgetInfo | null;
}

export interface AttachmentItem {
  id: string;
  dataUrl: string;
  filename?: string;
  mimeType: string;
}

export type ThinkingLevel = 'high' | 'medium' | 'low';

export interface TodoItem {
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  sessionId: string;
  // optional human-friendly description used by the UI
  description?: string;
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
}
