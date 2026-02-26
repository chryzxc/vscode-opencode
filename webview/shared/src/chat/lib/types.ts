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
}

export interface ContextItem {
  file: string;
  lineInfo: string;
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
  type: 'step' | 'tool' | 'reasoning';
  status: 'pending' | 'done' | 'error';
  meta?: string;
  filePath?: string;
  startTime?: number;
  duration?: number;
  tokens?: {
    input?: number;
    output?: number;
    cache?: { read?: number; write?: number };
  };
}

export interface StreamingState {
  messageId: string | null;
  content: string;
  reasoning: string;
  steps: StreamingStep[];
  edits: string[];
  isActive: boolean;
  usage?: { total: number; duration?: number };
}

export interface MessageInfo {
  id?: string;
  agent?: string;
  model?: { modelID: string; providerID: string };
  modelID?: string;
  providerID?: string;
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

export interface Message {
  role?: string;
  parts?: MessagePart[];
  text?: string;
  content?: string;
  info?: MessageInfo;
  plan?: unknown;
  edits?: MessageEdit[];
  steps?: MessageStep[];
  timing?: { duration?: number };
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
  streaming: StreamingState | null;
  inputValue: string;
  fileSuggestions: FileResult[];
  showFileSuggestions: boolean;
  selectedSuggestionIndex: number;
  receivedInitState: boolean;
  serverStatus: string;
  modelDropdownOpen: boolean;
  agentDropdownOpen: boolean;
  errorMessages: string[];
  quotaData: QuotaData | null;
  quotaIsRefreshing: boolean;
}
