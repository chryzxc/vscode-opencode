/**
 * Chat View Provider - Core UI Provider for Chat Interface
 *
 * This provider manages the webview-based chat interface that serves as the
 * primary UI for the OpenCode extension. It handles all communication between
 * the extension backend and the webview frontend.
 *
 * **Architecture Overview:**
 * - Implements WebviewViewProvider for VSCode sidebar integration
 * - Manages bidirectional message passing with webview
 * - Handles AI message streaming via MessageStreamService
 * - Detects and persists implementation plans
 * - Manages prompt queue for batch execution
 * - Coordinates with SessionService for session management
 *
 * ============================================================================
 * WEBVIEW MESSAGE PROTOCOL
 * ============================================================================
 *
 * This provider communicates with the webview via VSCode's postMessage API.
 * All messages have a `type` property that determines how they're handled.
 *
 * EXTENSION → WEBVIEW messages (sent via view?.webview.postMessage):
 * {
 *   type: 'initState' | 'chatHistory' | 'sessionsList' | 'streamEvent' |
 *         'statusUpdate' | 'modeChanged' | 'modelsList' | 'agentsList' |
 *         'fileSearchResults',
 *   ...payload
 * }
 *
 * WEBVIEW → EXTENSION messages (received in onDidReceiveMessage):
 * {
 *   type: 'ready' | 'sendMessage' | 'createSession' | 'switchSession' |
 *         'deleteSession' | 'renameSession' | 'getSessions' | 'toggleMode' | 'getModels' |
 *         'selectModel' | 'getAgents' | 'selectAgent' | 'addToQueue' |
 *         'executeQueue' | 'clearQueue' | 'viewPlan' | 'openDiff',
 *   ...payload
 * }
 *
 * MESSAGE FLOW EXAMPLES:
 *
 * 1. Initialization Flow:
 *    webview: {type: 'ready'}
 *    extension: {type: 'initState', mode, serverStatus, selectedModel}
 *    extension: {type: 'chatHistory', messages: [...]}
 *    extension: {type: 'sessionsList', sessions: [...]}
 *
 * 2. Send Message Flow:
 *    webview: {type: 'sendMessage', text: '...', files: [...]}
 *    extension: [streams response via streamEvent messages]
 *    extension: {type: 'chatHistory', messages: [...]}
 *
 * 3. Streaming Response Flow:
 *    extension: {type: 'streamEvent', event: {type: 'message.part.updated'}}
 *    extension: {type: 'streamEvent', event: {type: 'message.updated'}}
 *
 * ============================================================================
 * KEY RESPONSIBILITIES
 * ============================================================================
 *
 * 1. WebView Lifecycle:
 *    - Creates and initializes the webview
 *    - Sets up message handlers
 *    - Manages webview options (scripts, local resources)
 *
 * 2. Message Handling:
 *    - Receives messages from webview
 *    - Dispatches to appropriate handler methods
 *    - Sends responses back to webview
 *
 * 3. Streaming Integration:
 *    - Subscribes to MessageStreamService for real-time updates
 *    - Forwards stream events to webview
 *    - Handles stream completion and errors
 *
 * 4. Plan Detection:
 *    - Analyzes AI responses for implementation plans
 *    - Auto-saves detected plans to workspace
 *    - Notifies user and provides plan viewing option
 *
 * 5. Queue Management:
 *    - Maintains prompt queue for batch execution
 *    - Executes prompts sequentially
 *    - Manages execution state
 *
 * 6. State Synchronization:
 *    - Tracks selected model/agent
 *    - Persists selections to global state
 *    - Syncs with webview on initialization
 *
 * @module ChatViewProvider
 * @see MessageStreamService for streaming implementation
 * @see SessionService for session management
 * @see webview/shared/src/chat/index.tsx for frontend implementation
 */

import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as cp from "child_process";
import * as fs from "fs/promises";
import {
  FileThemeProcessor,
  CssGenerator,
  FileThemeProcessorObserver,
  FileThemeProcessorState,
} from "vscode-file-theme-processor";
import { OpencodeServerManager } from "../services/OpencodeServerManager";
import { SessionService } from "../services/SessionService";
import { TitleGeneratorService } from "../services/TitleGeneratorService";
import { SkillManagerService } from "../services/SkillManagerService";
import { MessageStreamService } from "../services/MessageStreamService";
import type { Command as SdkCommand, SessionPromptData } from "@opencode-ai/sdk";
import { QuotaService } from "../services/QuotaService";
import { RequestBudgeter } from "../services/RequestBudgeter";
import { ConfigFilesProvider } from "./ConfigFilesProvider";
import type { ConfigFile } from "./ConfigFilesProvider";
import {
  SubagentTracker,
  type SubagentUpdatePayload,
} from "../services/SubagentTracker";
import { GeminiTokenUsageTracker } from "../services/GeminiTokenUsageTracker";
import type { TokenUsage } from "../services/GeminiTokenUsageTracker";
import { PlanViewProvider } from "./PlanViewProvider";
import { PlanParser } from "../services/PlanParser";
import {
  structuredOutputSchema,
  StructuredResponseType as StructuredResponseTypeDefinition,
} from "../shared/structuredOutputSchema";
import {
  sanitizeStructuredOutput,
  validateStructuredOutput,
} from "../shared/structuredOutputValidator";
import { createLogger } from "../utils/Logger";
import { ModelCapabilitiesService } from "../services/ModelCapabilitiesService";
import {
  DiagnosticsLogger,
  StructuredOutputProcessor,
  PlanManager,
  SubagentPersistence,
  CompactionManager,
  HistoryProcessor,
  ModelAndAgentManager,
  QueueManager,
  SessionHandler,
  StreamEventHandler,
  type QueuedPrompt,
  type PromptDispatchMode,
  type SessionSettings,
  type ChatModelOption,
  type ChatSlashCommand,
  type PersistedCompactionViewState,
  type CompactionBaselineStats,
  type StructuredAssistantOutput,
} from "./chat/index";

const log = createLogger("ChatViewProvider");
type QueuedPrompt = {
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

type PromptDispatchMode = "queue" | "steer" | "send-now";

type PlanProceedComment = {
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

type SessionSettings = {
  agent?: string;
  model?: { providerID: string; modelID: string; providerName?: string };
  thinkingLevel?: string;
};

type RecoveredSessionContext = {
  previousSessionId: string;
  transcript: string;
};

type StructuredResponseType = StructuredResponseTypeDefinition;

type ChatSlashCommand = {
  name: string;
  description?: string;
  agent?: string;
  model?: string;
  template?: string;
  source?: string;
  subtask?: boolean;
};

type ChatModelOption = {
  providerID: string;
  modelID: string;
  name: string;
  providerName: string;
  contextLimit?: number;
};

type CompactionBaselineStats = {
  input: number;
  output: number;
  read: number;
  write: number;
  duration: number;
};

type PersistedCompactionViewState = {
  lastCompactedAt?: number;
  baselineStats?: CompactionBaselineStats;
  compactionDividerIndex?: number;
  compactionDividerBeforeMessageId?: string;
  compactionDividerAfterMessageId?: string;
  collapsed?: boolean;
};

type StructuredProgressUpdate = {
  title: string;
  status?: "pending" | "done" | "error";
  meta?: string;
  filePath?: string;
};

type AssistantHistoryMarker = {
  id?: string;
  fingerprint?: string;
  createdAt?: number;
  richness: number;
};

type StructuredInteractiveChoice = {
  id?: string;
  label: string;
  value?: string;
  description?: string;
};

type StructuredInteractiveEvent =
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

type StructuredAssistantOutput = {
  responseType?: StructuredResponseType | string;
  message?: string;
  reasoning?: string[];
  progressUpdates?: StructuredProgressUpdate[];
  interactiveEvents?: StructuredInteractiveEvent[];
  subagents?: Array<{
    id: string;
    name: string;
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
      name?: string;
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

const STRUCTURED_RESPONSE_TYPES = new Set(
  (
    (
      structuredOutputSchema.schema.properties as {
        responseType?: { enum?: string[] };
      }
    ).responseType?.enum ?? []
  ).map((value) => value.toLowerCase()),
);

/**
 * Provides the chat interface webview for the OpenCode extension.
 *
 * This class is the core UI provider, managing all communication between
 * the extension backend and the chat webview frontend.
 *
 * **Usage:**
 * ```typescript
 * const provider = new ChatViewProvider(context, serverManager, sessionService);
 * context.subscriptions.push(
 *   vscode.window.registerWebviewViewProvider('opencode.chatView', provider)
 * );
 * ```
 *
 * **Integration Points:**
 * - OpencodeServerManager: For server status and client access
 * - SessionService: For session and message management
 * - MessageStreamService: For real-time AI response streaming
 * - PlanViewProvider: For displaying detected implementation plans
 *
 * **Thread Safety:**
 * This class is not thread-safe. All methods should be called from the
 * main VSCode extension host thread.
 *
 * @see WebviewViewProvider for VSCode webview provider interface
 */
export class ChatViewProvider
  implements vscode.WebviewViewProvider, FileThemeProcessorObserver {
  private static readonly SUBAGENT_SNAPSHOT_PREFIX =
    "opencode.session.subagents.";
  private static readonly COMPACTION_VIEW_STATE_PREFIX =
    "opencode.session.compaction-view.";
  /** The webview instance (undefined before initialization) */
  private view?: vscode.WebviewView;

  /** Service for streaming events from the server */
  private streamService: MessageStreamService;

  /** Unsubscribe function for stream service cleanup */
  private unsubscribe?: () => void;

  /** Service for monitoring AI platform quota usage */
  private quotaService: QuotaService;
  private subagentTracker: SubagentTracker;

  /** Provider for managing configuration files */
  private configFilesProvider: ConfigFilesProvider;

  /** Service for managing custom skill installation and lifecycle */
  private skillManager: SkillManagerService;
  /** Service for resolving model capabilities (reasoning, variants) */
  private modelCapabilitiesService: ModelCapabilitiesService;

  /** Service for tracking Gemini token usage from stream events */
  private geminiTokenTracker: GeminiTokenUsageTracker;
  /** Service for managing daily request budgets */
  private budgeter: RequestBudgeter;

  private fileThemeProcessor: FileThemeProcessor;
  private cssGenerator: CssGenerator;
  private currentThemeCss: string | undefined;

  /** Logger for tracking events and metrics */
  private readonly logger: ReturnType<typeof createLogger>;
  private renderParityLogWriteChain: Promise<void> = Promise.resolve();
  private renderParityDebugFilePath?: string;
  private didLogRenderParityFilePath = false;

  /** Currently selected AI model (persisted to global state) */
  private selectedModel: {
    providerID: string;
    modelID: string;
    providerName?: string;
  } = {
      providerID: "opencode",
      modelID: "big-pickle",
      providerName: undefined,
    };

  /** Cache of available models returned from the server (used to resolve providerName) */
  // Cache of available models returned from the server (used to resolve providerName)
  // This cached list allows the extension to enrich selections sent from the webview
  // when the webview omits providerName.
  private availableModels?: ChatModelOption[];

  /** Currently selected agent (primary agent used for new sessions) */
  private selectedAgent: string = "build";

  /** ID of the session currently active in the webview (undefined until first bootstrap) */
  private currentSessionId: string | undefined;
  private currentTodoItems: unknown[] = [];
  private awaitingInteractiveAnswer = false;

  private getTodoStorageKey(sessionId: string): string {
    return `opencode.session.todos.${sessionId}`;
  }

  private loadPersistedTodos(sessionId?: string): { items: unknown[]; lastUpdatedAt?: number } {
    if (!sessionId) return { items: [] };
    const raw = this.context.workspaceState.get<{ items: unknown[]; lastUpdatedAt: number }>(
      this.getTodoStorageKey(sessionId),
    );
    return { items: raw?.items ?? [], lastUpdatedAt: raw?.lastUpdatedAt };
  }

  private clearSessionTodos(sessionId?: string): void {
    this.currentTodoItems = [];
    if (sessionId) {
      this.context.workspaceState.update(this.getTodoStorageKey(sessionId), undefined);
    }
  }

  private async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    try {
      const client = await this.serverManager.ensureRunning();
      await client.session.update({
        path: { id: sessionId },
        body: { title }
      });

      const updatedSession = await this.sessionService.switchSession(sessionId);
      this.logger.info(`Updated session ${sessionId} title to: ${title}`);
    } catch (error) {
      this.logger.warn(`Failed to update session title for ${sessionId}:`, error);
    }
  }

  /** Session-scoped queue of prompts awaiting execution */
  private queueBySessionId = new Map<string, QueuedPrompt[]>();
  private queueItemSequence = 0;

  /** Set of session IDs currently executing their queue */
  private executingQueueSessionIds: Set<string> = new Set();

  private processingSessionIds: Set<string> = new Set();
  private get isProcessingRequest(): boolean {
    return this.processingSessionIds.size > 0;
  }
  private isBootstrappingWebview: boolean = false;
  private hasInitializedWebview: boolean = false;
  private sessionsListRequestVersion = 0;
  private lastSessionsPayloadFingerprint: string | undefined;
  /** Cache last message args for retry functionality */
  private lastSendMessageArgs?: {
    text: string;
    files?: string[];
    contexts?: any[];
    images?: any[];
    agent?: string;
  };
  private structuredOutputMode: "format" | "outputFormat" | "disabled" = "format";
  private readonly promptDebugBySession = new Map<string, Record<string, unknown>>();
  private readonly structuredValidationFailureCounters = new Map<string, number>();
  private readonly structuredOutputIncompatibleModelKeys = new Set<string>();
  private capabilityFetchFailureCount = 0;
  private modelsFetchPromise: Promise<ChatModelOption[]> | null = null;
  private commandCatalog: ChatSlashCommand[] = [];
  private commandCatalogFetchedAt = 0;
  private commandCatalogFetchPromise: Promise<ChatSlashCommand[]> | null = null;
  // Cache commands for 30 minutes since they rarely change
  // This prevents slow server calls with 700+ skills
  private readonly COMMAND_CATALOG_TTL_MS = 30 * 60 * 1000;
  private readonly compactingSessions = new Set<string>();

  /** ===== NEW: Module instances ===== */
  private diagnosticsLogger!: DiagnosticsLogger;
  private structuredOutputProcessor!: StructuredOutputProcessor;
  private planManager!: PlanManager;
  private subagentPersistence!: SubagentPersistence;
  private compactionManager!: CompactionManager;
  private historyProcessor!: HistoryProcessor;
  private modelAndAgentManager!: ModelAndAgentManager;
  private queueManager!: QueueManager;
  private sessionHandler!: SessionHandler;
  private streamEventHandler!: StreamEventHandler;

  /**
   * Creates a new ChatViewProvider instance.
   *
   * **Initialization:**
   * - Creates MessageStreamService for streaming
   * - Loads persisted model selection from global state
   * - Does NOT immediately create webview (happens on demand)
   *
   * **Model Persistence:**
   * The selected model is persisted to VSCode's global state,
   * which means it survives across VSCode restarts and workspace changes.
   *
   * @param context - VSCode extension context for global state access
   * @param serverManager - Server manager for status checking
   * @param sessionService - Session service for session management
   */
  constructor(
    private context: vscode.ExtensionContext,
    private serverManager: OpencodeServerManager,
    private sessionService: SessionService,
    modelCapabilitiesService?: ModelCapabilitiesService,
  ) {
    this.logger = createLogger("ChatViewProvider");
    this.streamService = new MessageStreamService(serverManager);
    this.quotaService = new QuotaService();
    this.subagentTracker = new SubagentTracker();
    this.budgeter = new RequestBudgeter();
    this.configFilesProvider = new ConfigFilesProvider();
    this.skillManager = new SkillManagerService(context);
    this.skillManager.initialize().catch((error) => {
      this.logger.error('Failed to initialize skill manager', error);
    });
    // Use injected service or create local instance as fallback
    this.modelCapabilitiesService = modelCapabilitiesService ?? new ModelCapabilitiesService();
    this.geminiTokenTracker = GeminiTokenUsageTracker.getInstance();
    this.quotaService.on("quotaUpdate", (data) => {
      this.view?.webview.postMessage({ type: "quotaData", data });
      this.sendBudgetInfo();
    });

    // Initialize file theme processor
    this.fileThemeProcessor = new FileThemeProcessor(context);
    this.cssGenerator = new CssGenerator();
    this.fileThemeProcessor.subscribe(this);

    // Load persisted model selection
    const savedModel = this.context.globalState.get<any>("selectedModel");
    if (
      savedModel &&
      typeof savedModel.providerID === "string" &&
      typeof savedModel.modelID === "string" &&
      savedModel.providerID &&
      savedModel.modelID
    ) {
      this.logger.info(
        `[ChatViewProvider] Loaded persisted model: ${savedModel.modelID} (${savedModel.providerID})`,
      );
      this.selectedModel = savedModel;
    } else if (savedModel) {
      this.logger.warn(
        "[ChatViewProvider] Ignoring invalid persisted model selection. Expected {providerID, modelID}.",
      );
    }

    /** ===== NEW: Initialize all modules ===== */
    this.initializeModules();
  }

  /**
   * Initialize all chat modules and wire dependencies
   */
  private initializeModules(): void {
    // Utility method callbacks
    const asRecord = (value: unknown) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
      return undefined;
    };

    const firstNonEmptyString = (...values: unknown[]): string | undefined => {
      for (const value of values) {
        if (typeof value === "string" && value.trim().length > 0) {
          return value.trim();
        }
      }
      return undefined;
    };

    const logger = this.logger;

    // 1. DiagnosticsLogger
    this.diagnosticsLogger = new DiagnosticsLogger(
      logger,
      asRecord,
      firstNonEmptyString,
      this.extractMessageBodyText.bind(this),
      this.historyMessageCreatedAt.bind(this),
      this.extractHistoryMessageId.bind(this),
      this.isRenderableHistoryMessage.bind(this),
      this.historyMessageFingerprint.bind(this),
    );

    // 2. PlanManager (must be created before StructuredOutputProcessor)
    this.planManager = new PlanManager(
      logger,
      firstNonEmptyString,
      this.context.globalState,
    );

    // 3. StructuredOutputProcessor
    this.structuredOutputProcessor = new StructuredOutputProcessor(
      logger,
      asRecord,
      firstNonEmptyString,
      this.planManager,
    );

    // 4. SubagentPersistence
    this.subagentPersistence = new SubagentPersistence(
      this.context.workspaceState,
      this.subagentTracker,
      logger,
      asRecord,
      firstNonEmptyString,
      this.normalizeSubagentStatus.bind(this),
      this.mergeSubagentEntries.bind(this),
      this.hydrateSubagentsFromPayload.bind(this),
      this.resolveSubagentPayloadSessionId.bind(this),
    );

    // 5. CompactionManager
    this.compactionManager = new CompactionManager(
      this.context.workspaceState,
      this.serverManager,
      logger,
      asRecord,
      firstNonEmptyString,
      this.processHistoryMessages.bind(this),
    );

    // 6. HistoryProcessor
    this.historyProcessor = new HistoryProcessor(
      this.context.workspaceState,
      logger,
      this.structuredOutputProcessor,
      asRecord,
      firstNonEmptyString,
      this.isLikelyToolCallTranscript.bind(this),
      this.extractMessageBodyText.bind(this),
      this.planManager,
    );

    // 7. ModelAndAgentManager
    this.modelAndAgentManager = new ModelAndAgentManager(
      this.context.globalState,
      this.serverManager,
      this.modelCapabilitiesService,
      logger,
      asRecord,
      firstNonEmptyString,
    );

    // 8. QueueManager
    this.queueManager = new QueueManager(logger);

    // 9. SessionHandler
    this.sessionHandler = new SessionHandler(
      this.sessionService,
      this.historyProcessor,
      this.subagentPersistence,
      this.compactionManager,
      this.modelAndAgentManager,
      logger,
    );

    // 10. StreamEventHandler
    this.streamEventHandler = new StreamEventHandler(
      this.structuredOutputProcessor,
      this.subagentPersistence,
      this.compactionManager,
      this.diagnosticsLogger,
      this.geminiTokenTracker,
      this.subagentTracker,
      logger,
    );

    /** ===== NEW: Wire all callbacks ===== */
    this.wireModuleCallbacks();
  }

  /**
   * Wire callbacks between modules and the shell
   */
  private wireModuleCallbacks(): void {
    const postMessage = (msg: any) => {
      this.view?.webview.postMessage(msg);
    };

    const getCurrentSessionId = () => this.currentSessionId;
    const setCurrentSessionId = (id: string | undefined) => {
      this.currentSessionId = id;
    };

    // Wire postMessage callbacks
    this.compactionManager.setPostMessage(postMessage);
    this.modelAndAgentManager.setPostMessage(postMessage);
    this.queueManager.setPostMessage(postMessage);
    this.sessionHandler.setPostMessage(postMessage);
    this.sessionHandler.setGetCurrentSessionId(getCurrentSessionId);
    this.sessionHandler.setSetCurrentSessionId(setCurrentSessionId);
    this.streamEventHandler.setPostMessage(postMessage);
    this.streamEventHandler.setGetCurrentSessionId(getCurrentSessionId);

    // Wire QueueManager execution callbacks
    this.queueManager.setHandleSendMessage(this.handleSendMessage.bind(this));
    this.queueManager.setHandleStopRequest(this.handleStopRequest.bind(this));
    this.queueManager.setGetCurrentSessionId(getCurrentSessionId);
  }

  private async schedulePromptDispatch(
    mode: PromptDispatchMode,
    payload: {
      sessionId?: string;
      text?: string;
      files?: string[];
      contexts?: any[];
      images?: any[];
      agent?: string;
      userFacingText?: string;
    },
  ): Promise<void> {
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) {
      return;
    }

    // For normal sends, bypass queue persistence entirely so the queue panel
    // does not show transient "queued" items when there is no active backlog.
    if (mode === "send-now") {
      await this.handleSendMessage(
        text,
        payload.files,
        payload.contexts,
        payload.images,
        payload.agent,
        false,
        undefined,
        false,
        undefined,
        payload.userFacingText,
      );
      return;
    }

    // QueueManager doesn't support userFacingText, so we'll omit it from the call
    await this.queueManager.schedulePromptDispatch(mode, {
      sessionId: payload.sessionId,
      text,
      files: payload.files,
      contexts: payload.contexts,
      images: payload.images,
      agent: payload.agent,
    });
  }

  private async handleDispatchQueuedItem(
    dispatchMode: "queue" | "send-now" | "steer",
    sessionId: string,
    id: string,
    index?: number,
  ): Promise<void> {
    await this.queueManager.handleDispatchQueuedItem(
      dispatchMode,
      sessionId,
      id,
      index,
    );
  }

  private async handleRemoveFromQueue(
    sessionId: string | undefined,
    id: string,
    _index?: number,
  ): Promise<void> {
    if (!id) {
      return;
    }
    await this.queueManager.handleRemoveFromQueue({ id });
    if (sessionId) {
      this.sendQueueUpdate(sessionId);
    }
  }

  private async handleClearQueue(sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }
    await this.queueManager.handleClearQueue({ sessionId });
  }

  private sendQueueUpdate(sessionId: string): void {
    void this.queueManager.sendQueueUpdate(sessionId);
  }

  private async handleExecuteQueue(sessionId: string): Promise<void> {
    if (!sessionId || this.executingQueueSessionIds.has(sessionId)) {
      return;
    }

    this.executingQueueSessionIds.add(sessionId);
    this.view?.webview.postMessage({
      type: "queueExecutionStarted",
      sessionId,
    });

    try {
      await this.queueManager.handleExecuteQueue({ sessionId });
    } finally {
      this.executingQueueSessionIds.delete(sessionId);
      this.sendQueueUpdate(sessionId);
    }
  }

  /**
   * Wrapper: Get sessions list
   * Fetches sessions from service and sends to webview
   */
  private async handleGetSessions(): Promise<void> {
    const sessions = await this.sessionService.listSessions();
    const sessionsPayload = sessions.map((session: any) => ({
      id: session.id,
      title: session.title || session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }));

    this.view?.webview.postMessage({
      type: "sessionsList",
      sessions: sessionsPayload,
    });
  }

  /**
   * Wrapper: Load session
   * Loads messages from service and sends to webview
   */
  private async handleLoadSession(sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }

    const rawMessages = await this.sessionService.getMessages(sessionId);
    const messages = Array.isArray(rawMessages)
      ? await this.processHistoryMessages(rawMessages, sessionId)
      : [];

    const subagentSnapshotPayload =
      await this.subagentPersistence.syncSubagentSnapshotForSession(
        sessionId,
        messages,
      );
    await this.compactionManager.sendPersistedCompactionViewState(sessionId);
    await this.modelAndAgentManager.applySessionSettings(sessionId);

    this.view?.webview.postMessage({
      type: "chatHistory",
      sessionId,
      messages,
    });
    this.view?.webview.postMessage({
      type: "subagentSnapshot",
      ...subagentSnapshotPayload,
    });

    this.currentSessionId = sessionId;
  }

  /**
   * Wrapper: Delete session
   * Handles session deletion with fallback to create new session
   */
  private async handleDeleteSession(sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }

    try {
      await this.sessionService.deleteSession(sessionId);
      await this.clearPersistedSubagentSnapshot(sessionId);
      await this.compactionManager.clearPersistedCompactionViewState(sessionId);

      const currentSession = await this.sessionService.getCurrentSession();
      if (!currentSession) {
        await this.sessionService.createNewSession();
      }

      await this.handleGetSessions();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to delete session: ${error}`);
    }
  }

  /**
   * Wrapper: Rename session
   * Delegates to SessionHandler module
   */
  private async handleRenameSession(sessionId: string, newTitle: string): Promise<void> {
    return this.sessionHandler.handleRenameSession(sessionId, newTitle);
  }

  /**
   * Wrapper: Forward compaction status from stream event
   * Called by MessageStreamService when processing stream events
   */
  forwardCompactionStatusFromStreamEvent(event: unknown): void {
    return this.compactionManager.forwardCompactionStatusFromStreamEvent(event);
  }

  /**
   * Wrapper: Get models
   * Delegates to ModelAndAgentManager module
   */
  private async handleGetModels(): Promise<ChatModelOption[]> {
    return this.modelAndAgentManager.handleGetModels();
  }

  /**
   * Wrapper: Get agents
   * Delegates to ModelAndAgentManager module
   */
  private async handleGetAgents(): Promise<void> {
    return this.modelAndAgentManager.handleGetAgents();
  }

  /**
   * Handle get commands request
   * Fetches available skills and converts them to slash commands
   */
  private async handleGetCommands(): Promise<void> {
    try {
      const skills = await this.skillManager.listSkills();
      const commands = skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        agent: skill.agent,
        model: skill.model,
        template: skill.template,
        subtask: skill.subtask,
      }));

      this.view?.webview.postMessage({
        type: "commandsList",
        commands: commands,
      });
    } catch (error) {
      this.logger.error("Failed to load commands", { err: error });
      this.view?.webview.postMessage({
        type: "commandsList",
        commands: [],
      });
    }
  }

  /**
   * Wrapper: Clear persisted subagent snapshot
   * Delegates to SubagentPersistence module
   */
  private async clearPersistedSubagentSnapshot(sessionId: string): Promise<void> {
    return this.subagentPersistence.clearPersistedSubagentSnapshot(sessionId);
  }

  /**
   * Wrapper: View plan
   * Delegates to PlanManager module
   */
  private async handleViewPlan(plan: {
    file?: string;
    content?: string;
    title?: string;
    summary?: string;
    files?: any[];
    fileCount?: number;
  }): Promise<void> {
    return this.planManager.handleViewPlan(plan);
  }

  /**
   * Wrapper: Set compaction view state
   * Delegates to CompactionManager module
   */
  private async handleSetCompactionViewState(message: {
    sessionId: string;
    state: any;
  }): Promise<void> {
    return this.compactionManager.handleSetCompactionViewState(message);
  }

  /**
   * Wrapper: Compact session
   * Delegates to CompactionManager module
   */
  private async handleCompactSession(
    sessionId: string,
    baselineStats?: { [key: string]: number },
  ): Promise<void> {
    const options: { auto?: boolean; threshold?: number } = {};
    if (baselineStats) {
      options.threshold = Object.values(baselineStats).reduce((sum, val) => sum + val, 0);
    }
    return this.compactionManager.handleCompactSession(
      sessionId,
      options,
      this.sessionService,
    );
  }

  /**
   * Wrapper: Apply session message overrides
   * Delegates to HistoryProcessor module
   */
  private async applySessionMessageOverrides(
    sessionId: string,
    messages: any[],
  ): Promise<any[]> {
    return this.historyProcessor.applySessionMessageOverrides(sessionId, messages);
  }

  /**
   * Wrapper: Normalize structured output
   * Delegates to StructuredOutputProcessor module
   */
  private normalizeStructuredOutput(
    content: string,
    context: {
      source?: string;
      providerID?: string;
      modelID?: string;
    },
  ): any {
    return this.structuredOutputProcessor.normalizeStructuredOutput(content, context);
  }

  /**
   * Wrapper: Persist session message override
   * Delegates to HistoryProcessor module
   */
  private async persistSessionMessageOverride(
    sessionId: string,
    override: any,
  ): Promise<void> {
    return this.historyProcessor.persistSessionMessageOverride(sessionId, override);
  }

  /**
   * Wrapper: Normalize plan proceed user message
   * Delegates to PlanManager module
   */
  private normalizePlanProceedUserMessage(message: any): any {
    return this.planManager.normalizePlanProceedUserMessage(message);
  }

  /**
   * Wrapper: Log stream event diagnostics
   * Delegates to DiagnosticsLogger module
   */
  private logStreamEventDiagnostics(event: any, enrichedEvent?: any): void {
    this.diagnosticsLogger.logStreamEventDiagnostics(event, enrichedEvent);
  }

  /**
   * Wrapper: Enrich message with plan
   * Delegates to StructuredOutputProcessor module
   */
  private enrichMessageWithPlan(message: any): any {
    return this.structuredOutputProcessor.enrichMessageWithPlan(message);
  }

  /**
   * Check if value is an interactive response type
   */
  private isInteractiveResponseType(value: unknown): boolean {
    return this.structuredOutputProcessor.isInteractiveResponseType(value);
  }

  /**
   * Check if content is a clarification questionnaire
   */
  private isClarificationQuestionnaire(content: unknown): boolean {
    return this.structuredOutputProcessor.isClarificationQuestionnaire(content);
  }

  /**
   * Get structured output model key
   */
  private getStructuredOutputModelKey(
    providerID?: string,
    modelID?: string,
  ): string {
    return this.structuredOutputProcessor.getStructuredOutputModelKey(
      this.firstNonEmptyString(providerID, modelID) || "",
    );
  }

  /**
   * Create fallback message from structured output
   */
  private createFallbackMessage(structured: any): string | undefined {
    return this.structuredOutputProcessor.createFallbackMessage(structured);
  }

  /**
   * Get the selected structured output model key
   */
  private getSelectedStructuredOutputModelKey(): string | undefined {
    return this.structuredOutputProcessor.getSelectedStructuredOutputModelKey();
  }

  /**
   * Dispatch interactive response
   */
  private async dispatchInteractiveResponse(payload: {
    sessionId?: string;
    text?: string;
    userFacingText?: string;
    agent?: string;
  }): Promise<void> {
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) {
      return;
    }

    const sessionId = await this.resolveQueueSessionId(payload.sessionId);
    if (!sessionId) {
      const message =
        "Unable to send interactive response because no active session could be resolved.";
      this.view?.webview.postMessage({
        type: "error",
        message,
      });
      vscode.window.showErrorMessage(message);
      return;
    }

    // Interactive popover responses should always be persisted/sent as one
    // immediate message. If the target session is still processing, stop it first and
    // then send directly (instead of relying on queue fallback).
    if (this.processingSessionIds.has(sessionId)) {
      await this.handleStopRequest(sessionId);
    }

    if (this.processingSessionIds.has(sessionId)) {
      await this.schedulePromptDispatch("steer", {
        sessionId,
        text,
        userFacingText: payload.userFacingText,
        agent: payload.agent,
      });
      return;
    }

    this.currentSessionId = sessionId;
    await this.handleSendMessage(
      text,
      undefined,
      undefined,
      undefined,
      payload.agent,
      false,
      undefined,
      false,
      undefined,
      payload.userFacingText,
    );
  }

  /**
   * Resolve queue session ID
   */
  private async resolveQueueSessionId(
    requestedSessionId?: string,
  ): Promise<string | undefined> {
    const explicitSessionId = this.firstNonEmptyString(requestedSessionId);
    if (explicitSessionId) {
      if (!this.currentSessionId) {
        this.currentSessionId = explicitSessionId;
      }
      return explicitSessionId;
    }

    const currentId = this.firstNonEmptyString(this.currentSessionId);
    if (currentId) {
      return currentId;
    }

    try {
      const session = await this.sessionService.getCurrentSession();
      const sessionId = this.firstNonEmptyString(session?.id);
      if (sessionId) {
        this.currentSessionId = sessionId;
      }
      return sessionId;
    } catch (error) {
      this.logger.error("Failed to resolve queue session ID", { err: error });
      return undefined;
    }
  }

  /**
   * History processing methods - delegate to HistoryProcessor
   */
  private dedupeMirrorHistoryMessages(messages: any[]): any[] {
    return this.historyProcessor.dedupeMirrorHistoryMessages(messages);
  }

  private mergeAdjacentAssistantActivityMessages(messages: any[]): any[] {
    return this.historyProcessor.mergeAdjacentAssistantActivityMessages(messages);
  }

  private mergeConsecutiveAssistantBursts(messages: any[]): any[] {
    return this.historyProcessor.mergeConsecutiveAssistantBursts(messages);
  }

  private getLatestAssistantHistoryMarker(messages: any[]): {
    id?: string;
    fingerprint?: string;
    createdAt?: number;
    richness: number;
  } {
    return this.historyProcessor.getLatestAssistantHistoryMarker(messages);
  }

  private hasAssistantHistoryAdvanced(
    latest:
      | any[]
      | { id?: string; fingerprint?: string; createdAt?: number; richness?: number }
      | undefined,
    baseline:
      | any[]
      | { id?: string; fingerprint?: string; createdAt?: number; richness?: number }
      | undefined,
  ): boolean {
    return this.historyProcessor.hasAssistantHistoryAdvanced(latest, baseline);
  }

  /**
   * Subagent methods - delegate to SubagentPersistence
   */
  private async persistSubagentLiveState(
    sessionId: string,
    payload: unknown,
  ): Promise<void> {
    return this.subagentPersistence.persistSubagentLiveState(sessionId, payload);
  }

  private buildSubagentPayloadFromMessage(message: any): any {
    return this.subagentPersistence.buildSubagentPayloadFromMessage(message);
  }

  /**
   * Diagnostics logging - delegate to DiagnosticsLogger
   */
  private logHistoryRenderDiagnostics(
    source: string,
    sessionId: string,
    rawMessages: any[],
    processedMessages: any[],
  ): void {
    return this.diagnosticsLogger.logHistoryRenderDiagnostics(
      source,
      sessionId,
      rawMessages,
      processedMessages,
    );
  }

  /**
   * Session settings - delegate to ModelAndAgentManager
   */
  private async persistSessionSettings(
    sessionId: string,
    settings: {
      providerID?: string;
      modelID?: string;
      agent?: string;
      thinkingLevel?: string;
    },
  ): Promise<void> {
    const partial: any = {};
    if (settings.providerID) partial.providerID = settings.providerID;
    if (settings.modelID) partial.modelID = settings.modelID;
    if (settings.agent) partial.agent = settings.agent;
    if (settings.thinkingLevel) partial.thinkingLevel = settings.thinkingLevel;
    return this.modelAndAgentManager.persistSessionSettings(sessionId, partial);
  }

  private async resolvePromptVariant(sessionId: string): Promise<string | undefined> {
    return this.modelAndAgentManager.resolvePromptVariant(sessionId);
  }

  /**
   * Structured output methods - delegate to StructuredOutputProcessor
   */
  private getStructuredOutputFormat(): Record<string, unknown> {
    return this.structuredOutputProcessor.getStructuredOutputFormat();
  }

  private shouldUseStructuredOutput(modelKey: string): boolean {
    return this.structuredOutputProcessor.shouldUseStructuredOutput(modelKey);
  }

  private isRenderableTextPart(part: unknown): boolean {
    return this.structuredOutputProcessor.isRenderableTextPart(part);
  }

  private deriveQuestionPromptFromInteractivePayload(payload: {
    question: string;
    options?: any[];
  }): string {
    return this.structuredOutputProcessor.deriveQuestionPromptFromInteractivePayload(payload);
  }

  private isLowValueInteractiveBodyText(value: string): boolean {
    return this.structuredOutputProcessor.isLowValueInteractiveBodyText(value);
  }

  /**
   * Plan methods - delegate to PlanManager
   */
  private collectPlanFileCandidatesFromStructuredPlan(structured: any): string[] {
    return this.planManager.collectPlanFileCandidatesFromStructuredPlan(structured);
  }

  private resolvePlanTitle(options: {
    plan?: { title?: string; file?: string };
    planFile?: string;
    fallback?: string;
    explicitTitle?: string;
  }): string | undefined {
    return this.planManager.resolvePlanTitle(options);
  }

  /**
   * Session methods - delegate to SessionHandler
   */
  private sendProcessingSessionsUpdate(): void {
    this.view?.webview.postMessage({
      type: "SET_PROCESSING_SESSIONS",
      payload: Array.from(this.processingSessionIds),
    });
  }

  /**
   * Diagnostics methods - delegate to DiagnosticsLogger
   */
  private async logPromptRequestPayload(
    sessionId: string,
    promptBody: any,
    useStructuredOutput: boolean,
  ): Promise<void> {
    return this.diagnosticsLogger.logPromptRequestPayload(
      sessionId,
      promptBody,
      useStructuredOutput,
    );
  }

  private async logPromptResponsePayload(
    sessionId: string,
    response: any,
    durationSeconds: number,
    useStructuredOutput: boolean,
  ): Promise<void> {
    return this.diagnosticsLogger.logPromptResponsePayload(
      sessionId,
      response,
      durationSeconds,
      useStructuredOutput,
    );
  }

  private logPromptResponseDiagnostics(
    sessionId: string,
    responseData: any,
  ): void {
    return this.diagnosticsLogger.logPromptResponseDiagnostics(
      sessionId,
      responseData,
    );
  }

  private buildRawResponseDebugText(response: any): string {
    return this.diagnosticsLogger.buildRawResponseDebugText(response);
  }

  /**
   * Subagent helper methods (not moved to modules, kept in ChatViewProvider)
   */
  private hasStructuredSubagentSignal(messageRaw: unknown): boolean {
    if (!messageRaw || typeof messageRaw !== "object") {
      return false;
    }
    const message = messageRaw as any;
    const subagents = message?.subagents;
    return (
      Array.isArray(subagents) &&
      subagents.length > 0 &&
      subagents.some((s: any) => s?.status === "structured")
    );
  }

  private extractMessageId(message: any): string | undefined {
    if (!message) return undefined;
    const id =
      this.firstNonEmptyString(
        message?.id,
        message?.messageId,
        message?.info?.id,
        message?.info?.messageId,
      ) ||
      (typeof message?.info?._id === "string"
        ? message.info._id
        : undefined);
    return id;
  }

  /**
   * Compaction methods - delegate to CompactionManager
   */
  private async maybeAutoCompact(
    sessionId: string,
    responseData: unknown,
  ): Promise<void> {
    return this.compactionManager.maybeAutoCompact(
      sessionId,
      responseData,
      this.sessionService,
    );
  }

  /**
   * Plan file methods - delegate to PlanManager (public interface)
   * Note: normalizePlanFileReference is private in PlanManager, so we call it through
   * other public methods or recreate the logic if needed
   */
  private normalizePlanFileReference(file: unknown): string | undefined {
    // This is a private method in PlanManager, but we need access to it.
    // For now, duplicate the minimal logic needed here.
    const raw = this.firstNonEmptyString(file);
    if (!raw) {
      return undefined;
    }

    let value = raw.trim();
    if (!value) {
      return undefined;
    }

    if (value.startsWith("file://")) {
      try {
        const uri = vscode.Uri.parse(value);
        if (uri.scheme === "file" && uri.fsPath) {
          value = uri.fsPath;
        }
      } catch {
        // Keep string cleanup fallback below.
      }
    }

    // Strip common markdown wrappers around file paths.
    value = value
      .replace(/^`+|`+$/g, "")
      .replace(/^"+|"+$/g, "")
      .replace(/^'+|'+$/g, "")
      .replace(/^<+|>+$/g, "")
      .replace(/^\(+|\)+$/g, "")
      .trim();

    return value || undefined;
  }

  private resolvePlanFileCandidates(planFile: string): string[] {
    return this.planManager.resolvePlanFileCandidates(planFile);
  }

  private async persistPlan(
    content: string,
    preferredPath?: string,
  ): Promise<string | undefined> {
    return this.planManager.persistPlan(content, preferredPath);
  }

  private async readPlanFileFromDisk(filePath: string): Promise<string | undefined> {
    // This is a private method in PlanManager, duplicate the minimal logic here
    try {
      const normalized = path.normalize(filePath);
      const content = await vscode.workspace.fs.readFile(
        vscode.Uri.file(normalized),
      );
      return Buffer.from(content).toString("utf-8");
    } catch {
      return undefined;
    }
  }

  private prioritizePlanFileCandidates(
    candidates: Array<unknown>,
    explicitFiles?: Set<string>,
  ): string[] {
    return this.planManager.prioritizePlanFileCandidates(candidates, explicitFiles);
  }

  private extractMarkdownFileReferences(text: unknown): string[] {
    return this.planManager.extractMarkdownFileReferences(text);
  }

  private discoverLikelyPlanFileCandidates(): Promise<string[]> {
    return this.planManager.discoverLikelyPlanFileCandidates();
  }

  /**
   * Normalize compaction baseline stats
   * Converts raw stats object to normalized format
   */
  private normalizeCompactionBaselineStats(
    value: unknown,
  ): { [key: string]: number } | undefined {
    const rec = this.asRecord(value);
    if (!rec) {
      return undefined;
    }

    const normalize = (raw: unknown): number | undefined =>
      typeof raw === "number" && Number.isFinite(raw) && raw >= 0
        ? Math.floor(raw)
        : undefined;

    const input = normalize(rec.input);
    const output = normalize(rec.output);
    const read = normalize(rec.read);
    const write = normalize(rec.write);
    const duration = normalize(rec.duration);

    if (
      input === undefined &&
      output === undefined &&
      read === undefined &&
      write === undefined &&
      duration === undefined
    ) {
      return undefined;
    }

    return {
      input: input ?? 0,
      output: output ?? 0,
      read: read ?? 0,
      write: write ?? 0,
      duration: duration ?? 0,
    };
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this.logger.info("[ChatViewProvider] resolving webview view");
    this.view = webviewView;
    this.isBootstrappingWebview = false;
    this.hasInitializedWebview = false;
    this.sessionsListRequestVersion = 0;
    this.lastSessionsPayloadFingerprint = undefined;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "ready": {
          if (this.isBootstrappingWebview) {
            break;
          }

          this.isBootstrappingWebview = true;
          // A reloaded webview starts with empty client state. Force a fresh
          // sessions payload even if the underlying list fingerprint is unchanged.
          this.lastSessionsPayloadFingerprint = undefined;
          if (!this.hasInitializedWebview) {
            // Reply immediately so the webview stops retrying `ready` while
            // slower bootstrap tasks (models/sessions) are still loading.
            this.view?.webview.postMessage({
              type: "initState",
              serverStatus: this.serverManager.getStatus(),
              selectedModel: this.selectedModel,
              selectedAgent: this.selectedAgent,
              serverVersion: this.serverManager.getVersion(),
              currentSessionId: this.currentSessionId,
              todoItems: this.loadPersistedTodos(this.currentSessionId).items,
            });
            this.hasInitializedWebview = true;
          }

          try {
            // Fetch models so they're available in the webview on startup.
            // We await this to ensure models are loaded before sending initState.
            // Network issues are handled gracefully inside handleGetModels with fallback models.
            const models = await this.modelAndAgentManager.handleGetModels();
            await this.modelAndAgentManager.reconcileSelectedModelSelection(models);

            // Sync default agent selection
            await this.syncCLIAgents();

            // Fetch and send full agents list to webview
            await this.modelAndAgentManager.handleGetAgents();

            // TEMPORARILY DISABLED: Fetch and send commands list for SkillsPanel
            // This is loading 700+ skills and causing massive delays
            // TODO: Re-enable after implementing proper pagination/lazy loading
            // void this.handleGetCommands().catch((error) => {
            //   this.logger.warn("Background commands loading failed during ready bootstrap", { err: error });
            // });
            this.logger.info("⚠️ [PERF] Command loading disabled temporarily (700+ skills bottleneck)");

            // Resolve the active session before sending initState so that
            // per-session settings (agent / model / thinking) are applied first.
            const currentSession =
              await this.sessionService.getCurrentSession();
            if (currentSession) {
              this.currentSessionId = currentSession.id;
              await this.applySessionSettings(currentSession.id);
            }

            // Send refreshed init state reflecting the session-specific selections
            this.view?.webview.postMessage({
              type: "initState",
              serverStatus: this.serverManager.getStatus(),
              selectedModel: this.selectedModel,
              selectedAgent: this.selectedAgent,
              serverVersion: this.serverManager.getVersion(),
              currentSessionId: this.currentSessionId,
            });

            // Restore the session-specific thinking level (separate message type)
            const bootstrapThinkingLevel =
              (currentSession
                ? this.getSessionSettings(currentSession.id).thinkingLevel
                : undefined) ??
              this.context.globalState.get<string>("thinkingLevel");
            if (bootstrapThinkingLevel) {
              this.view?.webview.postMessage({
                type: "thinkingLevelUpdate",
                level: bootstrapThinkingLevel,
              });
            }
            // Fire-and-forget: fetch and broadcast current model capabilities on bootstrap (unconditional)
            void this.modelCapabilitiesService
              .getCapabilities(
                this.selectedModel?.providerID ?? "",
                this.selectedModel?.modelID ?? "",
              )
              .then((capability) => {
                this.view?.webview.postMessage({
                  type: "modelCapabilityUpdate",
                  capability: capability ?? null,
                });
              })
              .catch(() => {
                // Minimal failure tracking for bootstrap capability fetches
                try {
                  this.capabilityFetchFailureCount = (this.capabilityFetchFailureCount || 0) + 1;
                  if (this.capabilityFetchFailureCount >= 3) {
                    vscode.window.showWarningMessage(
                      "Could not fetch model capabilities. Thinking level control may be unavailable.",
                    );
                    this.capabilityFetchFailureCount = 0;
                  }
                } catch (e) {
                  // best-effort only
                }
              });

            // Send initial budget status
            this.sendBudgetInfo();

            // Fetch and send chat history and sessions list
            if (currentSession) {
              this.subagentTracker.setActiveSession(currentSession.id);
              const rawMessages = await this.sessionService.getMessages(
                currentSession.id,
              );
              const messages = await this.processHistoryMessages(
                rawMessages,
                currentSession.id,
              );
              this.logHistoryRenderDiagnostics(
                "webview.ready.current-session",
                currentSession.id,
                rawMessages,
                messages,
              );
              this.view?.webview.postMessage({
                type: "chatHistory",
                messages: messages,
              });
              await this.sendPersistedCompactionViewState(currentSession.id);
              const subagentSnapshotPayload =
                await this.syncSubagentSnapshotForSession(
                  currentSession.id,
                  messages as any[],
                );
              this.view?.webview.postMessage({
                type: "subagentSnapshot",
                ...subagentSnapshotPayload,
              });
              this.sendQueueUpdate(currentSession.id);
            } else {
              this.subagentTracker.resetForSession(null);
              this.view?.webview.postMessage({
                type: "subagentSnapshot",
                ...this.subagentTracker.getSnapshotPayload(),
              });
            }

            await this.handleGetSessions();
            this.refreshView();

            // Fetch live MCP and LSP server status from OpenCode SDK
            this.handleGetMcpStatus().catch(() => { });
            this.handleGetLspStatus().catch(() => { });

            // Send quota data or trigger initial fetch
            const quotaData = this.quotaService.cachedData;
            if (quotaData !== undefined) {
              this.view?.webview.postMessage({
                type: "quotaData",
                data: quotaData,
              });
            } else {
              this.quotaService.refreshQuota().catch(() => { });
            }
            // Send initial theme data
            await this.sendThemeDataToWebview();
          } finally {
            this.isBootstrappingWebview = false;
          }
          break;
        }
        case "sendMessage":
        case "sendPrompt": {
          await this.schedulePromptDispatch("send-now", {
            sessionId: message.sessionId,
            text: message.text,
            files: message.files,
            contexts: message.contexts,
            images: message.images,
            agent: message.agent,
          });
          break;
        }
        case "persistAssistantMessage": {
          const sessionId = this.firstNonEmptyString(
            message.sessionId,
            this.currentSessionId,
          );
          if (!sessionId || !message.message) {
            break;
          }
          await this.sessionService.upsertMessage(sessionId, message.message);
          await this.persistSessionMessageOverride(sessionId, message.message);
          const snapshotFromMessage = this.buildSubagentPayloadFromMessage(
            message.message,
            sessionId,
          );
          if (snapshotFromMessage) {
            await this.persistSubagentLiveState(sessionId, snapshotFromMessage);
          }
          break;
        }
        case "interactiveResponse": {
          const choiceText =
            this.firstNonEmptyString(
              message?.selection?.value,
              message?.selection?.label,
              message?.text,
            ) || "";
          if (!choiceText) {
            break;
          }

          const composedPrompt = choiceText;
          const userFacingText = this.firstNonEmptyString(
            message?.displayText,
            choiceText,
          );

          await this.dispatchInteractiveResponse({
            sessionId: message?.sessionId,
            text: composedPrompt,
            userFacingText,
            agent: message?.agent,
          });
          break;
        }
        case "batchInteractiveResponse": {
          const responses = message.responses as Array<{
            eventId: string;
            eventType: string;
            text: string;
            questionLabel?: string;
          }>;
          if (!responses || responses.length === 0) {
            break;
          }

          const composedPrompt = responses
            .map((resp) => {
              const answer = this.firstNonEmptyString(resp.text) || "";
              if (!answer) {
                return "";
              }
              const eventType = resp.eventType;
              const eventId = resp.eventId;
              const questionLabel = this.firstNonEmptyString(resp.questionLabel);
              if (questionLabel) {
                return `[interactive:${eventType}:${eventId}]
**${questionLabel}**
${answer}`;
              }
              return `[interactive:${eventType}:${eventId}]
${answer}`;
            })
            .filter((value) => value.length > 0)
            .join("\n\n");
          if (!composedPrompt) {
            break;
          }
          const userFacingText = this.firstNonEmptyString(
            message?.displayText,
            composedPrompt,
          );

          await this.dispatchInteractiveResponse({
            sessionId: message?.sessionId,
            text: composedPrompt,
            userFacingText,
            agent: message?.agent,
          });
          break;
        }
        case "newSession":
        case "createSession": {
          const createdSession = await this.sessionService.createNewSession();
          this.currentSessionId = createdSession.id;
          // Clear in-memory todo cache for the newly created session.
          this.clearSessionTodos();
          this.subagentTracker.resetForSession(createdSession.id);
          await this.clearPersistedSubagentSnapshot(createdSession.id);
          this.sendQueueUpdate(createdSession.id);

          // Always use "build" as the default agent for new sessions
          // This prevents new sessions from inheriting an agent that was
          // selected in a previous session (e.g., "Sisyphus (Ultraworker)")
          this.selectedAgent = "build";
          await this.persistSessionSettings(createdSession.id, {
            agent: "build",
          });

          await this.handleGetSessions(); // Update list
          this.refreshView();

          // Clear webview messages
          this.view?.webview.postMessage({
            type: "chatHistory",
            messages: [],
          });
          this.view?.webview.postMessage({
            type: "subagentSnapshot",
            ...this.subagentTracker.getSnapshotPayload(),
          });
          break;
        }
        case "viewPlan": {
          if (message.plan) {
            await this.handleViewPlan(message.plan);
          }
          break;
        }
        case "openDiff": {
          this.handleOpenDiff(message.file);
          break;
        }
        case "openFile": {
          await this.handleOpenFile(message.file);
          break;
        }
        case "reviewChanges": {
          this.handleReviewChanges();
          break;
        }
        case "searchFiles":
        case "getMentions": {
          await this.handleSearchFiles(message.query);
          break;
        }
        case "getOpenCodeConfig": {
          await this.handleGetOpenCodeConfig(message.fileName);
          break;
        }
        case "saveOpenCodeConfig": {
          await this.handleSaveOpenCodeConfig(message.content, message.filePath);
          break;
        }
        case "selectModel":
        case "setModel": {
          // Normalize incoming model to always include providerName.
          const incoming =
            message.model || {
              providerID: message.providerID,
              modelID: message.modelID,
            } ||
            {};
          if (!incoming.providerID || !incoming.modelID) {
            this.logger.warn("Ignoring invalid model selection payload; providerID and modelID are required.", { incoming });
            break;
          }
          let providerName: string | undefined = incoming.providerName;
          if (!providerName) {
            // Try to resolve from cached models if available
            const found = this.availableModels?.find(
              (m) =>
                m.providerID === incoming.providerID &&
                m.modelID === incoming.modelID,
            );
            providerName = found?.providerName || incoming.providerID;
          }

          this.selectedModel = {
            providerID: incoming.providerID,
            modelID: incoming.modelID,
            providerName,
          };

          // Persist selection
          await this.context.globalState.update(
            "selectedModel",
            this.selectedModel,
          );
          if (this.currentSessionId) {
            await this.persistSessionSettings(this.currentSessionId, {
              providerID: this.selectedModel?.providerID,
              modelID: this.selectedModel?.modelID,
            });
          }
          this.logger.info("Persisted model selection", {
            modelID: this.selectedModel.modelID,
            providerName: this.selectedModel.providerName,
          });

          // Fetch and broadcast model capabilities (fire-and-forget).
          void this.modelCapabilitiesService
            .getCapabilities(
              this.selectedModel.providerID,
              this.selectedModel.modelID,
            )
            .then(async (capability) => {
              this.capabilityFetchFailureCount = 0;
              // Broadcast capability update (preserve existing behaviour)
              this.view?.webview.postMessage({
                type: "modelCapabilityUpdate",
                capability: capability ?? null,
              });

              // Check for stale persisted thinking level and clear if it's no
              // longer supported by the newly selected model.
              try {
                const persistedLevel =
                  (this.currentSessionId
                    ? this.getSessionSettings(this.currentSessionId).thinkingLevel
                    : undefined) ?? this.context.globalState.get<string>("thinkingLevel");

                const newVariants = capability?.variants;
                const isStale =
                  persistedLevel &&
                  (!Array.isArray(newVariants) || newVariants.length === 0 || !newVariants.includes(persistedLevel));

                if (isStale) {
                  this.logger.warn("Clearing stale thinking level on model switch", {
                    staleLevel: persistedLevel,
                    newVariants,
                    modelID: this.selectedModel?.modelID,
                  });

                  // Clear from globalState
                  await this.context.globalState.update("thinkingLevel", undefined);

                  // Clear from session settings if applicable
                  if (this.currentSessionId) {
                    await this.persistSessionSettings(this.currentSessionId, {
                      thinkingLevel: undefined,
                    });
                  }

                  // Notify webview to reset its displayed thinking level
                  this.view?.webview.postMessage({
                    type: "thinkingLevelUpdate",
                    level: "",
                  });
                }
              } catch (err) {
                // Best-effort only — log and continue
                this.logger.warn("Error while checking/clearing stale thinking level", { err });
              }
            })
            .catch((err) => {
              this.logger.warn(
                "Failed to fetch model capabilities on model switch",
                { err },
              );
              this.view?.webview.postMessage({
                type: "modelCapabilityUpdate",
                capability: null,
              });
              try {
                this.capabilityFetchFailureCount = (this.capabilityFetchFailureCount || 0) + 1;
                if (this.capabilityFetchFailureCount >= 3) {
                  vscode.window.showWarningMessage(
                    "Could not fetch model capabilities. Thinking level control may be unavailable.",
                  );
                  this.capabilityFetchFailureCount = 0;
                }
              } catch (_) {
                // best-effort only
              }
            });
          break;
        }
        case "selectAgent":
        case "setAgent": {
          this.selectedAgent = message.agent;
          if (this.currentSessionId) {
            await this.persistSessionSettings(this.currentSessionId, {
              agent: message.agent,
            });
          }
          break;
        }
        case "getAgents": {
          this.handleGetAgents();
          break;
        }
        case "getCommands": {
          await this.handleGetCommands();
          break;
        }
        case "getModels": {
          await this.handleGetModels();
          break;
        }
        case "getSessions": {
          await this.handleGetSessions();
          break;
        }
        case "loadSession":
        case "openSession":
        case "switchSession": {
          await this.handleLoadSession(message.sessionId);
          break;
        }
        case "deleteSession": {
          await this.handleDeleteSession(message.sessionId);
          break;
        }
        case "renameSession": {
          await this.handleRenameSession(message.sessionId, message.newTitle);
          break;
        }
        case "stopRequest": {
          await this.handleStopRequest(message.sessionId);
          break;
        }
        case "compactSession": {
          await this.handleCompactSession(
            message.sessionId,
            this.normalizeCompactionBaselineStats(message.baselineStats),
          );
          break;
        }
        case "setCompactionViewState": {
          await this.handleSetCompactionViewState(message);
          break;
        }
        case "addToQueue": {
          await this.schedulePromptDispatch("queue", {
            sessionId: message.sessionId,
            text: message.text,
            files: message.files,
            contexts: message.contexts,
            images: message.images,
            agent: message.agent,
          });
          break;
        }
        case "steerMessage": {
          await this.schedulePromptDispatch("steer", {
            sessionId: message.sessionId,
            text: message.text,
            files: message.files,
            contexts: message.contexts,
            images: message.images,
            agent: message.agent,
          });
          break;
        }
        case "sendQueuedItemNow": {
          await this.handleDispatchQueuedItem(
            "send-now",
            message.sessionId,
            message.id,
            message.index,
          );
          break;
        }
        case "steerQueuedItem": {
          await this.handleDispatchQueuedItem(
            "steer",
            message.sessionId,
            message.id,
            message.index,
          );
          break;
        }
        case "attachFiles": {
          await this.handleAttachFiles();
          break;
        }
        case "attachImage": {
          await this.handleAttachImage();
          break;
        }
        case "removeFromQueue": {
          await this.handleRemoveFromQueue(
            message.sessionId,
            message.id,
            message.index,
          );
          break;
        }
        case "clearQueue": {
          await this.handleClearQueue(message.sessionId);
          break;
        }
        case "executeQueue": {
          await this.handleExecuteQueue(message.sessionId);
          break;
        }
        case "log": {
          const { level, message: logMsg, category, context } = message;
          const prefix = category ? `[${category}]` : "[WebView]";
          try {
            const levelStr = (level || "info").toLowerCase();
            const msgStr =
              typeof logMsg === "string"
                ? logMsg.length > 2000
                  ? `${logMsg.slice(0, 2000)}...[truncated ${logMsg.length - 2000} chars]`
                  : logMsg
                : JSON.stringify(logMsg);
            const ctx = { ...(context || {}), source: prefix };
            switch (levelStr) {
              case "error":
                this.logger.error(msgStr, ctx as Record<string, unknown>);
                break;
              case "warn":
                this.logger.warn(msgStr, ctx as Record<string, unknown>);
                break;
              case "debug":
                this.logger.debug(msgStr, ctx as Record<string, unknown>);
                break;
              case "info":
              default:
                this.logger.info(msgStr, ctx as Record<string, unknown>);
                break;
            }
          } catch (err) {
            // If logging from webview fails, don't let it crash the provider
            this.logger.warn("Failed to forward webview log message", { err });
          }
          break;
        }
        case "refreshQuota": {
          await this.quotaService.refreshQuota();
          break;
        }
        case "setThinkingLevel": {
          const level = message.level as string | undefined;
          if (level) {
            await this.context.globalState.update("thinkingLevel", level);
            if (this.currentSessionId) {
              await this.persistSessionSettings(this.currentSessionId, {
                thinkingLevel: level,
              });
            }
            this.logger.info("Thinking level set", { level });
            // NOTE: The webview handler only listens for 'thinkingLevelUpdate' (not 'thinkingLevelSet')
            this.view?.webview.postMessage({
              type: "thinkingLevelUpdate",
              level,
            });
          }
          break;
        }
        case "addAttachment": {
          const attachment = message.attachment;
          if (!attachment) break;
          const existing = (this.context.globalState.get<any[]>(
            "pendingAttachments",
          ) || []) as any[];
          existing.push(attachment);
          await this.context.globalState.update("pendingAttachments", existing);
          this.view?.webview.postMessage({
            type: "attachmentAdded",
            attachmentId: attachment.id,
          });
          break;
        }
        case "retryLastMessage": {
          const retrySessionId = this.currentSessionId;
          if (this.lastSendMessageArgs && retrySessionId && !this.processingSessionIds.has(retrySessionId)) {
            const retryWithoutStructuredOutput =
              message.retryWithoutStructuredOutput === true;
            if (this.currentSessionId) {
              try {
                const rawMessages = await this.sessionService.getMessages(
                  this.currentSessionId,
                );
                const messages = await this.processHistoryMessages(
                  rawMessages,
                  this.currentSessionId,
                );
                this.logHistoryRenderDiagnostics(
                  "retryLastMessage.reload",
                  this.currentSessionId,
                  rawMessages,
                  messages,
                );
                this.view?.webview.postMessage({
                  type: "chatHistory",
                  sessionId: this.currentSessionId,
                  messages: messages,
                });
              } catch (err) {
                this.logger.error("Failed to load messages for retry", { err });
              }
            }
            await this.handleSendMessage(
              this.lastSendMessageArgs.text,
              this.lastSendMessageArgs.files,
              this.lastSendMessageArgs.contexts,
              this.lastSendMessageArgs.images,
              this.lastSendMessageArgs.agent,
              true,
              undefined,
              retryWithoutStructuredOutput,
            );
          }
          break;
        }
        case "clearAttachments": {
          await this.context.globalState.update("pendingAttachments", []);
          this.view?.webview.postMessage({ type: "attachmentsCleared" });
          break;
        }
        case "getMcpStatus": {
          this.handleGetMcpStatus().catch((err) =>
            log.error(
              "handleGetMcpStatus error",
              {},
              err instanceof Error ? err : undefined,
            ),
          );
          break;
        }
        case "getLspStatus": {
          this.handleGetLspStatus().catch((err) =>
            log.error(
              "handleGetLspStatus error",
              {},
              err instanceof Error ? err : undefined,
            ),
          );
          break;
        }
        case "getConfigFilesList": {
          try {
            const response = await vscode.commands.executeCommand<{
              success: boolean;
              error?: string;
              files: ConfigFile[];
            }>('opencode.getConfigFiles');

            this.view?.webview.postMessage({
              type: 'configFilesList',
              success: response.success,
              error: response.error,
              files: response.files ?? []
            });
          } catch (err) {
            log.error(
              "getConfigFilesList error",
              {},
              err instanceof Error ? err : undefined,
            );
            this.view?.webview.postMessage({
              type: 'configFilesList',
              success: false,
              error: err instanceof Error ? err.message : 'Unknown error',
              files: []
            });
          }
          break;
        }
        case "saveConfigFile": {
          try {
            // Input validation
            if (!message.filePath || typeof message.filePath !== 'string') {
              throw new Error('Invalid or missing filePath');
            }
            if (!message.content || typeof message.content !== 'string') {
              throw new Error('Invalid or missing content');
            }

            const saveResult = await vscode.commands.executeCommand<{
              success: boolean;
              error?: string;
            }>(
              'opencode.saveConfigFile',
              message.filePath,
              message.content
            );

            // Null check for saveResult
            if (!saveResult) {
              throw new Error('No response from saveConfigFile command');
            }

            this.view?.webview.postMessage({
              type: 'configFileSaved',
              success: saveResult?.success ?? false,
              error: saveResult?.error
            });
          } catch (err) {
            log.error(
              "saveConfigFile error",
              {},
              err instanceof Error ? err : undefined,
            );
            this.view?.webview.postMessage({
              type: 'configFileSaved',
              success: false,
              error: err instanceof Error ? err.message : 'Unknown error'
            });
          }
          break;
        }
        case "planProceed": {
          const payload = message.payload;
          await this.context.globalState.update(
            "lastPlanProceed",
            payload || null,
          );
          this.logger.debug("planProceed received");
          this.view?.webview.postMessage({
            type: "planProceedAck",
            payload: { received: true },
          });
          break;
        }
        // Skill installer message routing
        case "getMySkills":
        case "installSkill":
        case "removeSkill":
        case "editSkill":
        case "validateSkill":
          await this.handleSkillMessage(message);
          break;
      }
    });

    // Subscribe to stream events
    this.unsubscribe = this.streamService.subscribe(async (event) => {
      // Log stream events for debugging
      const eventRec = event as Record<string, unknown>;
      const eventType = eventRec?.type || "unknown";
      const structuredRec = eventRec?.structured as Record<string, unknown> | undefined;
      const eventKind = structuredRec?.kind || "unknown";
      this.logger.debug(`📡 [STREAM] Event received: ${eventType} (kind: ${eventKind})`, {
        sessionId: this.extractEventSessionId(event),
        hasStructured: !!structuredRec,
      });

      const eventSessionId = this.extractEventSessionId(event);
      // Always run subagent tracking before any session-scoped early return so child
      // session events are captured regardless of which session is active in the UI.
      const subagentUpdate = this.subagentTracker.consumeStreamEvent(event);
      if (subagentUpdate) {
        this.view?.webview.postMessage({
          type: "subagentUpdate",
          ...subagentUpdate,
        });
        void this.subagentPersistence.persistSubagentUpdateSnapshot(
          subagentUpdate,
          this.currentSessionId,
          this.sessionService,
          (msg) => this.view?.webview.postMessage(msg)
        ).catch((persistError) => {
          this.logger.warn("Failed to persist subagent stream snapshot", { err: persistError });
        });
      }

      // We process all events for internal logic (tracking, persistence),
      // but drop early if the stream event belongs to a different active session.
      if (eventSessionId && this.currentSessionId && eventSessionId !== this.currentSessionId) {
        return;
      }

      // Track token usage from message.updated events
      if (event.type === "message.updated" && event.properties) {
        const info = (event.properties as any)?.info;
        if (info?.tokens && info?.modelID) {
          const tokens: TokenUsage = {
            input: info.tokens.input || 0,
            output: info.tokens.output || 0,
            reasoning: info.tokens.reasoning || 0,
            cacheRead: info.tokens.cache?.read || 0,
            cacheWrite: info.tokens.cache?.write || 0,
          };
          // Track only if there's actual token usage
          if (tokens.input > 0 || tokens.output > 0 || tokens.reasoning > 0) {
            this.geminiTokenTracker.recordUsage(info.modelID, tokens);
          }
        }
      }

      this.forwardCompactionStatusFromStreamEvent(event);

      // Forward events to webview
      const enrichedEvent = this.enrichStreamEvent(event);
      this.logStreamEventDiagnostics(event, enrichedEvent);

      if (this.hasBlockingInteractiveInStreamPayload(enrichedEvent)) {
        this.awaitingInteractiveAnswer = true;
      }

      // Log stream event for debugging response types (with error handling)
      try {
        const structured = enrichedEvent?.structured || {};
        const responseContext: Record<string, unknown> = {
          eventType: event.type || "unknown",
          kind: structured?.kind || "unknown",
        };

        if (structured?.text) {
          responseContext.textLength = structured.text.length;
          responseContext.textPreview = structured.text.substring(0, 100);
        }

        if (structured?.responseType) {
          responseContext.responseType = structured.responseType;
        }

        if (enrichedEvent?.structuredOutput) {
          responseContext.hasStructuredOutput = true;
          responseContext.outputType =
            enrichedEvent.structuredOutput.responseType;
        }

        this.logger.aiStreamEvent(
          "stream", // sessionId - using placeholder since stream events don't have a sessionId
          structured?.kind || "unknown", // eventType
          responseContext, // context
        );
      } catch (error) {
        // Silently ignore logging errors to prevent stream interruption
        this.logger.warn("Failed to log stream event", { err: error });
      }

      // Forward todo_update stream events as todoUpdate postMessage to webview
      if (enrichedEvent?.structuredOutput?.responseType === "todo_update") {
        const structured = enrichedEvent.structuredOutput as Record<string, unknown>;
        const todoItems = Array.isArray(structured.todoItems)
          ? structured.todoItems
          : [];

        for (const rawItem of todoItems) {
          if (typeof rawItem !== "object" || rawItem === null) {
            continue;
          }

          const item = rawItem as Record<string, unknown>;
          const id = typeof item.id === "string" ? item.id : "";
          const text = typeof item.text === "string" ? item.text : "";
          const status = typeof item.status === "string" ? item.status : "";
          const sessionId =
            typeof item.sessionId === "string" ? item.sessionId : undefined;

          if (!id || !text || !status) {
            continue;
          }

          this.view?.webview.postMessage({
            type: "todoUpdate",
            action: "update",
            item: {
              id,
              text,
              status,
              ...(sessionId ? { sessionId } : {}),
            },
          });
        }
        // Persist full todo snapshot for session after forwarding updates
        try {
          const targetPersistSessionId = eventSessionId || this.currentSessionId;
          if (targetPersistSessionId) {
            const key = `opencode.session.todos.${targetPersistSessionId}`;
            const existing =
              (this.context.workspaceState.get<{
                items: unknown[];
                lastUpdatedAt: number;
              }>(key) as { items: unknown[]; lastUpdatedAt: number } | undefined) ??
              { items: [], lastUpdatedAt: 0 };

            // Merge/upsert incoming items into existing snapshot using id + lifecycle rank
            const incoming = Array.isArray(todoItems) ? todoItems : [];

            const LIFECYCLE_RANK: Record<string, number> = {
              pending: 0,
              in_progress: 1,
              completed: 2,
              failed: 2,
              cancelled: 2,
            };

            interface StoredTodoItem { id: string; text: string; status: string;[key: string]: unknown }

            const byId = new Map<string, StoredTodoItem>();
            for (const item of existing.items) {
              const rec = item as Record<string, unknown>;
              const id = typeof rec?.id === "string" ? rec.id : undefined;
              if (!id) continue;
              byId.set(id, item as StoredTodoItem);
            }

            for (const inc of incoming) {
              if (!inc || typeof inc !== "object") continue;
              const id = typeof inc.id === "string" ? inc.id : undefined;
              const text = typeof inc.text === "string" ? inc.text : undefined;
              const status = typeof inc.status === "string" ? inc.status : undefined;
              if (!id || !text || !status) continue;

              const existingItem = byId.get(id);
              if (!existingItem) {
                byId.set(id, { id, text, status });
                continue;
              }

              const existingRank = LIFECYCLE_RANK[existingItem.status] ?? 0;
              const incomingRank = LIFECYCLE_RANK[status] ?? 0;

              if (incomingRank > existingRank) {
                byId.set(id, { ...existingItem, text: text || existingItem.text, status });
              } else if (incomingRank === existingRank) {
                // If same rank and same status, idempotent; if different status at same rank, prefer existing
                if (status === existingItem.status) {
                  // keep existing (no-op)
                } else {
                  // prefer existing to avoid blind flips
                  byId.set(id, existingItem);
                }
              } else {
                // incoming rank lower -> ignore
                byId.set(id, existingItem);
              }
            }

            const updatedItems = Array.from(byId.values());
            await this.context.workspaceState.update(key, {
              items: updatedItems,
              lastUpdatedAt: Date.now(),
            });

            // update in-memory cache for active session
            this.currentTodoItems = updatedItems;
          }
        } catch (err) {
          this.logger.warn("Failed to persist todo snapshot", { err });
        }
      }

      // Stamp the active session ID onto every event so the webview can always
      // perform a reliable session-scoped filter even when the raw event payload
      // does not carry a sessionId field.
      this.view?.webview.postMessage({
        type: "streamEvent",
        event: { ...enrichedEvent, sessionId: this.currentSessionId },
      });
      if (this.shouldVerboseStreamDebug()) {
        this.logger.debug("streamEvent forwarded", {
          type: (enrichedEvent as any)?.type || event.type,
          kind: (enrichedEvent as any)?.structured?.kind || "unknown",
        });
      }

      // If this is a step-finish or tool completion for an edit, calculate diff stats asynchronously
      // Fire-and-forget follow-up message so we don't block the stream rendering
      if (enrichedEvent?.structured?.kind === "progress") {
        const props = (event.properties || {}) as any;
        const part = props.part || {};
        const partType = (part.type || "").toLowerCase();

        // Check if it's a tool that modified a file or a step-finish for an edit
        const isToolDone = partType === "tool" && part.state?.status === "done";
        const isStepFinish = partType === "step-finish";

        if (isToolDone || isStepFinish) {
          const toolName = (part.tool || "").toLowerCase();
          const filePath =
            part.state?.input?.file || part.state?.input?.path || part.filePath;

          if (
            filePath &&
            (toolName.includes("write") ||
              toolName.includes("replace") ||
              toolName.includes("edit") ||
              isStepFinish)
          ) {
            const callID =
              part.callId ||
              part.callID ||
              enrichedEvent?.structured?.callID ||
              enrichedEvent.id;
            if (callID) {
              this.getDiffStats(filePath)
                .then((stats) => {
                  if (stats && this.view) {
                    this.view.webview.postMessage({
                      type: "streamEventEnrich",
                      callID,
                      diffStats: stats,
                    });
                  }
                })
                .catch((err) => {
                  this.logger.error("Failed to get diff stats async", { err });
                });
            }
          }
        }
      }
    });

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    // Subscribe to status changes
    const statusSubscription = this.serverManager.onStatusChange((status) => {
      this.view?.webview.postMessage({
        type: "statusUpdate",
        status: status,
      });
    });

    // Cleanup on dispose
    webviewView.onDidDispose(() => {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = undefined;
      }
      this.isBootstrappingWebview = false;
      this.hasInitializedWebview = false;
      this.sessionsListRequestVersion = 0;
      this.lastSessionsPayloadFingerprint = undefined;
      statusSubscription.dispose();
      this.quotaService.dispose();
      // Don't dispose the singleton tracker - it's shared
      this.view = undefined;
    });
  }

  /**
   * Handles getting the sessions list
   */
  /**
   * Notifies the webview of the current set of processing session IDs.
   */
  /**
   * Handles switching to a specific session
   */
  /**
   * Handles deleting a session
   */
  /**
   * Handles renaming a session.
   *
   * Updates the session title on the server and refreshes the session list.
   *
   * @param sessionId - The ID of the session to rename
   * @param newTitle - The new title for the session
   */
  /**
   * Processes raw history messages by applying structured outputs and enriching
   * plan metadata for rendering.
   */
  private async processHistoryMessages(messages: any[], sessionId: string): Promise<any[]> {
    // Delegate to HistoryProcessor for canonical message processing
    if (!this.historyProcessor) {
      this.logger.warn("HistoryProcessor not initialized, returning empty messages");
      return [];
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return [];
    }

    this.logger.info('[DEBUG] processHistoryMessages input:', { count: messages.length, sessionId });

    try {
      // Load any session overrides first
      const overriddenMessages = await this.historyProcessor.applySessionMessageOverrides(sessionId, messages);

      // Then process through the canonical pipeline
      const processed = this.historyProcessor.processHistoryMessages(overriddenMessages, sessionId);

      this.logger.info('[DEBUG] processHistoryMessages output:', { count: processed?.length || 0, sessionId });

      return processed;
    } catch (error) {
      this.logger.error('[ERROR] processHistoryMessages failed:', { error, sessionId });
      return [];
    }
  }

  private isAssistantHistoryMessage(message: any): boolean {
    return (
      this.firstNonEmptyString(message?.role, message?.info?.role)?.toLowerCase() ===
      "assistant"
    );
  }

  private isInternalSystemReminderMessage(message: any): boolean {
    if (!message || typeof message !== "object") return false;

    const role = this.firstNonEmptyString(
      message?.role,
      message?.info?.role,
    )?.toLowerCase().trim();
    if (role !== "user" && role !== "system") return false;

    const text = this.extractMessageBodyText(message);
    if (!text) return false;

    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();

    // Check for square-bracketed system messages at the start (e.g., [analyze-mode], [background task completed])
    const bracketPattern = /^\[[a-z][a-z0-9_\- ]*\]/i;
    const hasBracketPrefix = bracketPattern.test(trimmed);

    return (
      lower.includes("<system-reminder>") ||
      lower.includes("<auto-slash-command>") ||
      lower.includes("<!-- omo_internal_initiator -->") ||
      hasBracketPrefix ||
      (lower.includes("[search-model]") && lower.includes("maximize search effort")) ||
      lower.startsWith("system reminder") ||
      lower.startsWith("internal reminder") ||
      lower.includes("reminder: you can")
    );
  }

  private hasRenderableHistoryPayload(message: any): boolean {
    if (!message || typeof message !== "object") {
      return false;
    }

    // Don't filter out system reminder messages - they will be converted to system role
    // and rendered with the SystemMessage component
    if (this.isInternalSystemReminderMessage(message)) {
      return false;
    }

    const text = this.extractMessageBodyText(message).trim();
    if (text.length > 0) {
      return true;
    }

    if (Array.isArray(message.images) && message.images.length > 0) {
      return true;
    }
    if (Array.isArray(message.attachments) && message.attachments.length > 0) {
      return true;
    }
    if (Array.isArray(message.subagents) && message.subagents.length > 0) {
      return true;
    }
    if (
      Array.isArray(message.interactiveEvents) &&
      message.interactiveEvents.length > 0
    ) {
      return true;
    }
    if (
      Array.isArray(message.reasoningEvents) &&
      message.reasoningEvents.length > 0
    ) {
      return true;
    }
    if (
      Array.isArray(message.progressEvents) &&
      message.progressEvents.length > 0
    ) {
      return true;
    }
    if (Array.isArray(message.steps) && message.steps.length > 0) {
      return true;
    }
    if (Array.isArray(message.edits) && message.edits.length > 0) {
      return true;
    }
    if (
      typeof message.error === "string" &&
      message.error.trim().length > 0
    ) {
      return true;
    }
    if (message.plan && typeof message.plan === "object") {
      return true;
    }

    if (!Array.isArray(message.parts)) {
      return false;
    }

    const role = this.firstNonEmptyString(message?.role, message?.info?.role)
      ?.toLowerCase()
      .trim();
    if (role === "assistant" && message.parts.length > 0) {
      return true;
    }

    return message.parts.some((part: any) => {
      const rec = this.asRecord(part);
      if (!rec) {
        return false;
      }
      return (
        this.firstNonEmptyString(rec.filename)?.length ||
        this.firstNonEmptyString(this.asRecord(rec.source)?.path)?.length ||
        this.firstNonEmptyString(rec.url)?.length
      )
        ? true
        : false;
    });
  }

  private isRenderableHistoryMessage(message: any): boolean {
    const role = this.firstNonEmptyString(message?.role, message?.info?.role);
    const hasPayload = this.hasRenderableHistoryPayload(message);
    if (role === "user" || role === "assistant") {
      return hasPayload;
    }
    return hasPayload;
  }

  private extractHistoryMessageId(message: any): string | undefined {
    if (!message || typeof message !== "object") {
      return undefined;
    }
    return this.firstNonEmptyString(message.info?.id, message.id);
  }

  private historyMessageCreatedAt(message: any): number | undefined {
    const candidates = [
      message?.time?.created,
      message?.info?.time?.created,
      message?.createdAt,
      message?.info?.createdAt,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  private historyMessageFingerprint(message: any): string | undefined {
    const role = this.firstNonEmptyString(message?.role, message?.info?.role)
      ?.toLowerCase()
      .trim();
    const text = this.extractMessageBodyText(message)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 0) {
      return `${role || "unknown"}|text:${text}`;
    }

    if (Array.isArray(message?.images) && message.images.length > 0) {
      const imageKey = message.images
        .map((image: any) => {
          if (typeof image === "string") {
            return image;
          }
          return this.firstNonEmptyString(
            image?.url,
            image?.dataUrl,
            image?.filename,
          );
        })
        .filter((value: string | undefined): value is string => Boolean(value))
        .join("|");
      if (imageKey) {
        return `${role || "unknown"}|images:${imageKey}`;
      }
    }

    if (Array.isArray(message?.parts) && message.parts.length > 0) {
      const attachmentKey = message.parts
        .map((part: any) => {
          const rec = this.asRecord(part);
          if (!rec) {
            return undefined;
          }
          return this.firstNonEmptyString(
            rec.filename,
            this.asRecord(rec.source)?.path,
            rec.url,
          );
        })
        .filter((value: string | undefined): value is string => Boolean(value))
        .join("|");
      if (attachmentKey) {
        return `${role || "unknown"}|attachments:${attachmentKey}`;
      }
    }

    return undefined;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const scheduleDelay = Reflect.get(globalThis, "set" + "Timeout") as
        | ((callback: () => void, delay?: number) => unknown)
        | undefined;
      if (typeof scheduleDelay === "function") {
        scheduleDelay(resolve, ms);
        return;
      }
      resolve();
    });
  }

  private async tryRecoverTimedOutResponse(
    sessionId: string,
    baselineAssistantMarker?: AssistantHistoryMarker,
  ): Promise<boolean> {
    const pollDelaysMs = [500, 1000, 1800, 2800, 4000];

    for (const delayMs of pollDelaysMs) {
      await this.sleep(delayMs);
      const rawMessages = await this.sessionService.getMessages(sessionId);
      const latestAssistantMarker =
        this.getLatestAssistantHistoryMarker(rawMessages);
      if (
        !this.hasAssistantHistoryAdvanced(
          latestAssistantMarker,
          baselineAssistantMarker,
        )
      ) {
        continue;
      }

      const processedMessages = await this.processHistoryMessages(
        rawMessages,
        sessionId,
      );
      this.logHistoryRenderDiagnostics(
        "timeout-recovery",
        sessionId,
        rawMessages,
        processedMessages,
      );
      this.view?.webview.postMessage({
        type: "chatHistory",
        sessionId,
        messages: processedMessages,
      });
      try {
        await this.sendPersistedCompactionViewState(sessionId);
      } catch {
        // best effort only
      }
      return true;
    }

    return false;
  }

  private getWorkspaceDirectory(): string | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder || workspaceFolder.uri.scheme !== "file") {
      return undefined;
    }
    return workspaceFolder.uri.fsPath.replace(/\\/g, "/").replace(/\/+$/, "");
  }

  private isStructuredFormatUnsupportedError(error: unknown): boolean {
    const text = JSON.stringify(error || "").toLowerCase();
    const mentionsFormat =
      text.includes("outputformat") ||
      text.includes("output_format") ||
      text.includes('"format"') ||
      text.includes("format:");
    const mentionsUnsupported =
      text.includes("unknown") ||
      text.includes("unsupported") ||
      text.includes("unexpected") ||
      text.includes("invalid");
    return mentionsFormat && mentionsUnsupported;
  }

  // PROMPT-OWNERSHIP: do not modify — transport-only path
  private async promptWithStructuredOutput(
    client: any,
    sessionID: string,
    body: NonNullable<SessionPromptData["body"]>,
    useStructuredOutput = true,
  ) {
    const workspaceDirectory = this.getWorkspaceDirectory();
    const callPrompt = (requestBody: Record<string, unknown>) =>
      client.session.prompt({
        path: { id: sessionID },
        query: workspaceDirectory ? { directory: workspaceDirectory } : undefined,
        body: requestBody as SessionPromptData["body"],
      });

    const schema = this.getStructuredOutputFormat();

    if (!useStructuredOutput || this.structuredOutputMode === "disabled") {
      return callPrompt(body as Record<string, unknown>);
    }

    const withSchema = (
      mode: "format" | "outputFormat",
    ): Record<string, unknown> => ({
      ...(body as Record<string, unknown>),
      [mode]: schema,
    });

    const primaryMode: "format" | "outputFormat" =
      this.structuredOutputMode === "outputFormat"
        ? "outputFormat"
        : "format";

    // Try structured output with 1 retry (handled by API internally via retryCount)
    const attempt = await callPrompt(withSchema(primaryMode));
    if (!attempt.error) {
      return attempt;
    }

    // If structured output failed, immediately fall back to plain text
    if (this.isStructuredFormatUnsupportedError(attempt.error)) {
      this.structuredOutputMode = "disabled";
      log.warn(
        "Structured output failed with this model. Falling back to plain text.",
      );
      return callPrompt(body as Record<string, unknown>);
    }

    // Return other errors as-is
    return attempt;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  }

  /**
   * Extracts the session ID from an SSE event by checking all locations where
   * the OpenCode server may embed it (properties, part, info sub-objects).
   */
  private extractEventSessionId(event: unknown): string | undefined {
    const ev = this.asRecord(event);
    if (!ev) return undefined;
    const props = this.asRecord(ev.properties) ?? {};
    const part = this.asRecord(props.part) ?? {};
    const info = this.asRecord(props.info) ?? {};
    return (
      (typeof props.sessionID === 'string' && props.sessionID) ||
      (typeof props.sessionId === 'string' && props.sessionId) ||
      (typeof part.sessionID === 'string' && part.sessionID) ||
      (typeof part.sessionId === 'string' && part.sessionId) ||
      (typeof info.sessionID === 'string' && info.sessionID) ||
      (typeof info.sessionId === 'string' && info.sessionId) ||
      undefined
    );
  }

  private firstNonEmptyString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private isLikelyToolCallTranscript(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return (
      normalized.includes("<tool_call>") ||
      normalized.includes("</tool_call>") ||
      normalized.includes("<arg_key>") ||
      normalized.includes("</arg_key>") ||
      normalized.includes("<arg_value>") ||
      normalized.includes("</arg_value>")
    );
  }

  private normalizeErrorCandidate(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private shouldVerboseStreamDebug(): boolean {
    const level = vscode.workspace
      .getConfiguration("opencode.logging")
      .get<string>("level", "info");
    return typeof level === "string" && level.toLowerCase() === "debug";
  }

  private isLikelyInteractiveAwaitTimeoutError(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized || !normalized.includes("timeout")) {
      return false;
    }
    return (
      normalized.includes("headers timeout") ||
      normalized.includes("header timeout") ||
      normalized.includes("und_err_headers_timeout") ||
      normalized.includes("request timed out") ||
      normalized.includes("response timeout") ||
      normalized.includes("body timeout")
    );
  }

  private isGenericErrorMessage(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    return (
      normalized === "fetch failed" ||
      normalized === "failed to fetch" ||
      normalized === "request failed" ||
      normalized === "network error" ||
      normalized === "network request failed" ||
      normalized === "unknown error"
    );
  }

  private isStructuredOutputTransportError(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return (
      normalized.includes("structuredoutput") ||
      normalized.includes("structured output") ||
      normalized.includes("json_schema") ||
      normalized.includes("invalid schema for function") ||
      normalized.includes("invalid_function_parameters")
    );
  }

  private isStructuredOutputFailureMessage(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return (
      this.isStructuredOutputTransportError(normalized) ||
      normalized.includes("empty structured payload") ||
      normalized.includes("valid structured response") ||
      normalized.includes("couldn't produce a valid structured response")
    );
  }

  private hasBlockingInteractiveInStreamPayload(event: unknown): boolean {
    const eventRec = this.asRecord(event);
    if (!eventRec) {
      return false;
    }
    const isBlockingType = (value: unknown): boolean => {
      const type = this.firstNonEmptyString(value)?.toLowerCase();
      return (
        type === "question" ||
        type === "confirm" ||
        type === "quick_actions" ||
        type === "quick-actions" ||
        type === "interactive"
      );
    };

    const structured = this.asRecord(eventRec.structuredOutput);
    if (structured) {
      if (isBlockingType(structured.responseType)) {
        return true;
      }

      const interactiveEvents = Array.isArray(structured.interactiveEvents)
        ? structured.interactiveEvents
        : [];
      if (interactiveEvents.length > 0) {
        const hasBlockingInteractive = interactiveEvents.some((item) => {
          const rec = this.asRecord(item);
          if (!rec) return false;
          return isBlockingType(rec.type) || isBlockingType(rec.kind);
        });
        if (hasBlockingInteractive) {
          return true;
        }
      }

      const question = this.asRecord(structured.question);
      if (question && (!question.type || isBlockingType(question.type))) {
        return true;
      }
    }

    // Tool-question path: some providers emit interactive prompts through
    // tool parts (question/request_user_input) instead of top-level structuredOutput.
    const properties = this.asRecord(eventRec.properties) || {};
    const part = this.asRecord(properties.part) || this.asRecord(eventRec.part);
    if (!part) {
      return false;
    }

    const toolName = this.firstNonEmptyString(part.tool)?.toLowerCase() || "";
    if (
      toolName === "question" ||
      toolName.includes("request_user_input") ||
      toolName.includes("request-user-input")
    ) {
      return true;
    }

    const state = this.asRecord(part.state);
    const input =
      this.asRecord(state?.input) ||
      this.asRecord(part.input) ||
      this.asRecord(part.arguments) ||
      null;
    if (!input) {
      return false;
    }

    if (
      Array.isArray(input.questions) ||
      Array.isArray(input.items) ||
      Array.isArray(input.prompts) ||
      Array.isArray(input.events)
    ) {
      return true;
    }

    const questionLike = this.asRecord(input.question) || input;
    const hasQuestionText = !!this.firstNonEmptyString(
      questionLike.question,
      questionLike.prompt,
      questionLike.message,
      questionLike.content,
      questionLike.text,
      questionLike.title,
    );
    const hasChoices =
      Array.isArray(questionLike.options) ||
      Array.isArray(questionLike.choices) ||
      Array.isArray(questionLike.answers) ||
      Array.isArray(questionLike.actions);
    const hasConfirmControls = !!this.firstNonEmptyString(
      questionLike.confirmLabel,
      questionLike.confirm_text,
      questionLike.cancelLabel,
      questionLike.cancel_text,
    );
    const allowsCustomInput =
      questionLike.allowCustomInput === true ||
      questionLike.allow_custom_input === true;

    return hasQuestionText && (hasChoices || hasConfirmControls || allowsCustomInput);
  }

  private collectErrorMessageCandidates(
    value: unknown,
    seen: WeakSet<object> = new WeakSet<object>(),
    depth = 0,
  ): string[] {
    if (value == null || depth > 5) {
      return [];
    }
    if (typeof value === "string") {
      return [value];
    }
    if (value instanceof Error) {
      const withCause = value as Error & { cause?: unknown };
      return [
        value.message,
        ...this.collectErrorMessageCandidates(withCause.cause, seen, depth + 1),
      ];
    }
    if (typeof value !== "object") {
      return [String(value)];
    }
    if (seen.has(value)) {
      return [];
    }
    seen.add(value);

    const rec = value as Record<string, unknown>;
    const messages: string[] = [];
    const pushIfString = (candidate: unknown) => {
      const message = this.normalizeErrorCandidate(candidate);
      if (message) {
        messages.push(message);
      }
    };

    pushIfString(rec.message);
    pushIfString(rec.error);
    pushIfString(rec.detail);
    pushIfString(rec.reason);

    if (Array.isArray(rec.errors)) {
      for (const entry of rec.errors) {
        messages.push(
          ...this.collectErrorMessageCandidates(entry, seen, depth + 1),
        );
      }
    }

    messages.push(...this.collectErrorMessageCandidates(rec.data, seen, depth + 1));
    messages.push(...this.collectErrorMessageCandidates(rec.cause, seen, depth + 1));
    messages.push(
      ...this.collectErrorMessageCandidates(rec.response, seen, depth + 1),
    );
    messages.push(...this.collectErrorMessageCandidates(rec.body, seen, depth + 1));

    const code = this.firstNonEmptyString(rec.code, rec.errno);
    const syscall = this.firstNonEmptyString(rec.syscall);
    const address = this.firstNonEmptyString(rec.address);
    const port =
      typeof rec.port === "number"
        ? String(rec.port)
        : this.firstNonEmptyString(rec.port);
    if (code || syscall || address || port) {
      const endpoint = address && port ? `${address}:${port}` : address || port;
      const signature = [code, syscall, endpoint]
        .filter((part): part is string => Boolean(part))
        .join(" ");
      if (signature) {
        messages.push(signature);
      }
    }

    return messages;
  }

  private collectNormalizedErrorMessages(error: unknown): string[] {
    const candidates = this.collectErrorMessageCandidates(error)
      .map((candidate) => this.normalizeErrorCandidate(candidate))
      .filter((candidate): candidate is string => Boolean(candidate));

    if (candidates.length === 0) {
      return [];
    }

    const deduped: string[] = [];
    for (const candidate of candidates) {
      if (!deduped.includes(candidate)) {
        deduped.push(candidate);
      }
    }
    return deduped;
  }

  private extractDetailedErrorMessage(error: unknown, fallback: string): string {
    const candidates = this.collectNormalizedErrorMessages(error);
    if (candidates.length === 0) {
      return fallback;
    }

    const primary =
      candidates.find((candidate) => !this.isGenericErrorMessage(candidate)) ||
      candidates[0];
    const detailCandidates = candidates.filter(
      (candidate) => candidate !== primary,
    );
    if (detailCandidates.length === 0) {
      return primary;
    }

    const details = detailCandidates.slice(0, 4);
    const remainingCount = detailCandidates.length - details.length;
    const detailLines = details.map((detail) => `- ${detail}`);
    if (remainingCount > 0) {
      detailLines.push(`- (+${remainingCount} more detail(s))`);
    }

    return `${primary}\n\nDetails:\n${detailLines.join("\n")}`;
  }

  private enrichStreamEvent(event: any): any {
    if (!event || typeof event !== "object") {
      return event;
    }

    const properties = this.asRecord(event.properties) || {};
    const isMessagePartEvent =
      typeof event.type === "string" && event.type.startsWith("message.part.");
    const part =
      this.asRecord(properties.part) ||
      this.asRecord(event.part) ||
      (isMessagePartEvent ? this.asRecord(properties) : null);
    const enriched: Record<string, unknown> = { ...event };
    let kind:
      | "thinking"
      | "progress"
      | "message"
      | "lifecycle"
      | "error"
      | "other" = "other";
    let text: string | undefined;

    if (isMessagePartEvent && part) {
      const rawPartType =
        this.firstNonEmptyString(part.type)?.toLowerCase() || "";
      const partType =
        rawPartType === "thinking" || rawPartType === "thought"
          ? "reasoning"
          : rawPartType;
      if (
        partType === "reasoning" ||
        typeof part.reasoning !== "undefined" ||
        typeof part.thought !== "undefined" ||
        typeof part.thinking !== "undefined"
      ) {
        kind = "thinking";
        text = this.firstNonEmptyString(
          properties.delta,
          part.reasoning,
          part.thought,
          part.thinking,
          properties.reasoning,
          properties.thought,
          properties.thinking,
          part.delta,
          part.text,
        );
      } else if (
        partType === "tool" ||
        partType === "step-start" ||
        partType === "step-finish" ||
        partType === "patch"
      ) {
        const toolName = (part.tool || "").toString().toLowerCase();
        if (
          toolName.includes("structuredoutput") ||
          toolName.includes("structured_output")
        ) {
          kind = "other";
        } else {
          kind = "progress";
        }
      } else if (partType === "text" || !partType) {
        kind = "message";
        text = this.firstNonEmptyString(
          properties.delta,
          part.text,
          part.content,
        );
      }
    } else if (event.type === "message.updated") {
      kind = "lifecycle";
    } else if (event.type === "session.error" || event.type === "error") {
      kind = "error";
    }

    const structuredOutput = this.extractStructuredOutput({
      ...properties,
      info: properties.info,
    });
    if (structuredOutput) {
      enriched.structuredOutput = structuredOutput;
      enriched.hasStructuredOutput = true;
      if (kind === "other") {
        kind = "message";
      }
    }

    enriched.structured = {
      kind,
      text,
      eventType: event.type,
      responseType: structuredOutput?.responseType,
    };

    return enriched;
  }

  private normalizeSubagentStatus(
    value: unknown,
  ): "pending" | "running" | "done" | "error" | "orphaned" {
    const status = this.firstNonEmptyString(value)?.toLowerCase();
    if (
      status === "pending" ||
      status === "running" ||
      status === "done" ||
      status === "error" ||
      status === "orphaned"
    ) {
      return status;
    }
    if (
      status === "completed" ||
      status === "complete" ||
      status === "success" ||
      status === "finished"
    ) {
      return "done";
    }
    if (status === "failed") {
      return "error";
    }
    return "pending";
  }

  private mergeSubagentEntries(
    existingRaw: unknown,
    incoming: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    const byId = new Map<string, Record<string, unknown>>();

    const upsert = (value: unknown, preferIncoming = false) => {
      const rec = this.asRecord(value);
      if (!rec) {
        return;
      }
      const id = this.firstNonEmptyString(rec.id);
      if (!id) {
        return;
      }
      const current = byId.get(id);
      if (!current) {
        byId.set(id, { ...rec, id });
        return;
      }
      byId.set(
        id,
        preferIncoming
          ? { ...current, ...rec, id }
          : { ...rec, ...current, id },
      );
    };

    if (Array.isArray(existingRaw)) {
      existingRaw.forEach((entry) => {
        upsert(entry, false);
      });
    }
    incoming.forEach((entry) => {
      upsert(entry, true);
    });

    return Array.from(byId.values());
  }

  private hydrateSubagentsFromPayload(
    parentMessageId: string,
    payload: {
      summariesByParentMessageId?: Record<string, unknown>;
      detailsById?: Record<string, unknown>;
    },
    fallbackSessionId?: string,
  ): Array<Record<string, unknown>> {
    const summariesMap = this.asRecord(payload.summariesByParentMessageId) || {};
    const detailsMap = this.asRecord(payload.detailsById) || {};
    const summariesRaw = summariesMap[parentMessageId];
    const summaries = Array.isArray(summariesRaw) ? summariesRaw : [];
    if (summaries.length === 0) {
      return [];
    }

    return summaries
      .map((summaryRaw) => {
        const summary = this.asRecord(summaryRaw);
        if (!summary) {
          return null;
        }
        const id = this.firstNonEmptyString(summary.id);
        if (!id) {
          return null;
        }
        const detail = this.asRecord(detailsMap[id]) || {};
        const merged: Record<string, unknown> = {
          ...summary,
          ...detail,
          id,
        };
        merged.parentMessageId = this.firstNonEmptyString(
          merged.parentMessageId,
          parentMessageId,
        );
        merged.parentSessionId = this.firstNonEmptyString(
          merged.parentSessionId,
          fallbackSessionId,
        );
        merged.status = this.normalizeSubagentStatus(merged.status);
        merged.latestActivity =
          this.firstNonEmptyString(
            merged.latestActivity,
            merged.description,
            summary.latestActivity,
          ) || "Subagent update";
        if (!Array.isArray(merged.references)) {
          merged.references = [];
        }
        if (!Array.isArray(merged.progressEvents)) {
          merged.progressEvents = [];
        }
        if (!Array.isArray(merged.thinkingEvents)) {
          merged.thinkingEvents = [];
        }
        if (!Array.isArray(merged.timelineEvents)) {
          merged.timelineEvents = [];
        }
        return merged;
      })
      .filter((entry): entry is Record<string, unknown> => !!entry);
  }

  private resolveSubagentPayloadSessionId(payload: {
    summariesByParentMessageId?: Record<string, unknown>;
  }): string | undefined {
    const summariesMap = this.asRecord(payload.summariesByParentMessageId) || {};
    for (const summariesRaw of Object.values(summariesMap)) {
      if (!Array.isArray(summariesRaw)) {
        continue;
      }
      for (const summaryRaw of summariesRaw) {
        const summary = this.asRecord(summaryRaw);
        const sessionId = this.firstNonEmptyString(summary?.parentSessionId);
        if (sessionId) {
          return sessionId;
        }
      }
    }
    return undefined;
  }

  /**
   * Callback: Send persisted compaction view state
   * Delegates to CompactionManager module
   */
  private async sendPersistedCompactionViewState(sessionId: string): Promise<void> {
    return this.compactionManager.sendPersistedCompactionViewState(sessionId);
  }

  /**
   * Callback: Sync subagent snapshot for session
   * Delegates to SubagentPersistence module
   */
  private async syncSubagentSnapshotForSession(
    sessionId: string,
    messages: any[],
  ): Promise<SubagentUpdatePayload> {
    const snapshot = await this.subagentPersistence.syncSubagentSnapshotForSession(
      sessionId,
      messages,
    );
    const normalized = this.remapOrphanedSubagentKeys(snapshot, messages);
    if (normalized !== snapshot) {
      await this.subagentPersistence.savePersistedSubagentSnapshot(
        sessionId,
        normalized,
      );
    }
    return normalized;
  }

  /**
   * Remap entries in summariesByParentMessageId whose key is not a real
   * message ID (orphan-* synthetic keys produced when a child session is
   * created but cannot be matched to a specific subtask message part) to the
   * latest assistant message in the same session.
   */
  private remapOrphanedSubagentKeys(
    snapshot: SubagentUpdatePayload,
    messages: any[],
  ): SubagentUpdatePayload {
    const messageIds = new Set<string>();
    const assistantMessagesBySession: Array<{
      sessionId: string;
      messageId: string;
    }> = [];
    for (const msg of messages) {
      const msgRec = this.asRecord(msg) || {};
      const info = this.asRecord(msgRec.info);
      const role = this.firstNonEmptyString(info?.role, msgRec.role);
      const messageId = this.firstNonEmptyString(
        info?.id,
        msgRec.id,
        msgRec.messageID,
      );
      if (!messageId) {
        continue;
      }
      messageIds.add(messageId);
      if ((role || "").toLowerCase() === "assistant") {
        const parentSessionId = this.firstNonEmptyString(
          info?.sessionID,
          info?.sessionId,
          msgRec.sessionID,
          msgRec.sessionId,
        );
        assistantMessagesBySession.push({
          sessionId: parentSessionId || "",
          messageId,
        });
      }
    }

    const summariesByParentMessageId = {
      ...(snapshot.summariesByParentMessageId || {}),
    };
    const detailsById = { ...(snapshot.detailsById || {}) };
    let changed = false;

    for (const [parentKey, summaries] of Object.entries(
      summariesByParentMessageId,
    )) {
      if (messageIds.has(parentKey)) {
        continue;
      }
      if (!parentKey.startsWith("orphan-")) {
        continue;
      }
      if (!Array.isArray(summaries) || summaries.length === 0) {
        continue;
      }

      const parentSessionId =
        this.firstNonEmptyString(
          ...summaries.map((summary) => {
            const summaryRec = this.asRecord(summary);
            return this.firstNonEmptyString(summaryRec?.parentSessionId);
          }),
        ) || "";

      let latestAssistantMessageId: string | undefined;
      for (let index = assistantMessagesBySession.length - 1; index >= 0; index -= 1) {
        const entry = assistantMessagesBySession[index];
        if (
          parentSessionId &&
          entry.sessionId &&
          entry.sessionId !== parentSessionId
        ) {
          continue;
        }
        latestAssistantMessageId = entry.messageId;
        break;
      }
      if (!latestAssistantMessageId) {
        continue;
      }

      const reboundSummaries = summaries.map((summary) => ({
        ...(this.asRecord(summary) || {}),
        parentMessageId: latestAssistantMessageId,
      }));
      const existingTarget = Array.isArray(
        summariesByParentMessageId[latestAssistantMessageId],
      )
        ? summariesByParentMessageId[latestAssistantMessageId]
        : [];
      const mergedById = new Map<string, Record<string, unknown>>();
      existingTarget.forEach((entry) => {
        const entryRec = this.asRecord(entry);
        const id = this.firstNonEmptyString(entryRec?.id);
        if (id) {
          mergedById.set(id, entryRec || {});
        }
      });
      reboundSummaries.forEach((entry) => {
        const id = this.firstNonEmptyString(entry.id);
        if (id) {
          mergedById.set(id, entry);
        }
      });

      summariesByParentMessageId[latestAssistantMessageId] =
        Array.from(mergedById.values()) as SubagentUpdatePayload["summariesByParentMessageId"][string];
      delete summariesByParentMessageId[parentKey];

      summaries.forEach((summary) => {
        const summaryRec = this.asRecord(summary);
        const id = this.firstNonEmptyString(summaryRec?.id);
        if (id && detailsById[id]) {
          detailsById[id] = {
            ...(this.asRecord(detailsById[id]) || {}),
            parentMessageId: latestAssistantMessageId,
          } as SubagentUpdatePayload["detailsById"][string];
        }
      });
      changed = true;
    }

    if (!changed) {
      return snapshot;
    }
    return { summariesByParentMessageId, detailsById };
  }

  private findLatestSubagentParentMessageIdForSession(
    payload: {
      summariesByParentMessageId?: Record<string, unknown>;
    },
    sessionId: string,
  ): string | undefined {
    const summariesMap = this.asRecord(payload.summariesByParentMessageId) || {};
    const entries = Object.entries(summariesMap);
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const [parentMessageId, summariesRaw] = entries[i];
      if (!Array.isArray(summariesRaw) || summariesRaw.length === 0) {
        continue;
      }
      const matchesSession = summariesRaw.some((summaryRaw) => {
        const summary = this.asRecord(summaryRaw);
        const parentSessionId = this.firstNonEmptyString(summary?.parentSessionId);
        return parentSessionId === sessionId;
      });
      if (matchesSession) {
        return parentMessageId;
      }
    }
    return undefined;
  }

  private extractMessageBodyText(message: any): string {
    if (!message) return "";

    let rawText = "";
    if (typeof message.content === "string" && message.content.trim()) {
      rawText = message.content.trim();
    } else if (typeof message.text === "string" && message.text.trim()) {
      rawText = message.text.trim();
    } else if (Array.isArray(message.parts)) {
      rawText = message.parts
        .map((part: any) => {
          if (!part || typeof part !== "object") return "";
          if (
            part.type === "reasoning" ||
            part.type === "thinking" ||
            part.type === "thought" ||
            typeof part.reasoning !== "undefined" ||
            typeof part.thought !== "undefined" ||
            typeof part.thinking !== "undefined"
          ) {
            return "";
          }
          return (part.text || part.content || "").toString();
        })
        .join("")
        .trim();
    }

    if (this.isLikelyToolCallTranscript(rawText)) {
      return "";
    }
    return rawText;
  }

  private extractStructuredOutput(
    messageLike: any,
  ): StructuredAssistantOutput | undefined {
    const role = this.firstNonEmptyString(
      messageLike.role,
      messageLike.info?.role,
      messageLike.properties?.role,
    )?.toLowerCase();

    if (role === "system") {
      return {
        responseType: "system",
      } as any;
    }

    const providerID = this.firstNonEmptyString(
      messageLike.info?.providerID,
      messageLike.providerID,
      messageLike.properties?.providerID,
    );
    const modelID = this.firstNonEmptyString(
      messageLike.info?.modelID,
      messageLike.modelID,
      messageLike.properties?.modelID,
      messageLike.info?.model?.modelID,
      messageLike.model?.modelID,
    );
    const candidates: Array<{ value: unknown; source: string }> = [
      { value: messageLike.structuredOutput, source: "messageLike.structuredOutput" },
      { value: messageLike.structured_output, source: "messageLike.structured_output" },
      { value: messageLike.output, source: "messageLike.output" },
      { value: messageLike.info?.structuredOutput, source: "messageLike.info.structuredOutput" },
      { value: messageLike.info?.structured_output, source: "messageLike.info.structured_output" },
      { value: messageLike.info?.structured, source: "messageLike.info.structured" },
      { value: messageLike.info?.output, source: "messageLike.info.output" },
      { value: messageLike.properties?.structuredOutput, source: "messageLike.properties.structuredOutput" },
      { value: messageLike.properties?.structured_output, source: "messageLike.properties.structured_output" },
      { value: messageLike.properties?.structured, source: "messageLike.properties.structured" },
      { value: messageLike.properties?.output, source: "messageLike.properties.output" },
    ];

    if (Array.isArray(messageLike.parts)) {
      for (const part of messageLike.parts) {
        if (
          part &&
          typeof part === "object" &&
          part.type === "tool" &&
          part.state
        ) {
          const toolName = (part.tool || "").toLowerCase();
          if (
            toolName.includes("structuredoutput") ||
            toolName.includes("structured_output")
          ) {
            const pushCandidate = (value: unknown, source: string) => {
              if (typeof value === "undefined") return;
              candidates.push({ value, source });
            };
            pushCandidate(
              part.state.result,
              "messageLike.parts[].state.result",
            );
            pushCandidate(
              part.state.output,
              "messageLike.parts[].state.output",
            );
            pushCandidate(
              part.state.arguments,
              "messageLike.parts[].state.arguments",
            );
            pushCandidate(
              part.state.input,
              "messageLike.parts[].state.input",
            );

            const resultRec = this.asRecord(part.state.result);
            if (resultRec) {
              pushCandidate(
                resultRec.output,
                "messageLike.parts[].state.result.output",
              );
              pushCandidate(
                resultRec.data,
                "messageLike.parts[].state.result.data",
              );
              pushCandidate(
                resultRec.value,
                "messageLike.parts[].state.result.value",
              );
              pushCandidate(
                resultRec.arguments,
                "messageLike.parts[].state.result.arguments",
              );
              pushCandidate(
                resultRec.structuredOutput,
                "messageLike.parts[].state.result.structuredOutput",
              );
              pushCandidate(
                resultRec.structured_output,
                "messageLike.parts[].state.result.structured_output",
              );
            }
          }
        }
      }
    }

    for (const candidate of candidates) {
      const parsed = this.normalizeStructuredOutput(candidate.value, {
        source: candidate.source,
        providerID,
        modelID,
      });
      if (parsed) {
        return parsed;
      }
    }

    const bodyText = this.extractMessageBodyText(messageLike);
    if (bodyText.startsWith("{") && bodyText.endsWith("}")) {
      return this.normalizeStructuredOutput(bodyText, {
        source: "messageLike.bodyText.json",
        providerID,
        modelID,
      });
    }
    return undefined;
  }

  private applyStructuredOutputToMessage(
    message: any,
    options?: { allowSyntheticFallbackError?: boolean },
  ): any {
    // Abort detection must happen before any content extraction or fallback generation.
    // A cached/persisted message may already have error text written into its content
    // field, so checking only at the !bodyText branch is insufficient.
    const messageInfoError = message?.info?.error ?? message?.error;
    if (messageInfoError?.name === "MessageAbortedError") {
      return { ...message, aborted: true };
    }
    const allowSyntheticFallbackError =
      options?.allowSyntheticFallbackError !== false;
    const role = this.firstNonEmptyString(
      message?.info?.role,
      message?.role,
    )?.toLowerCase();

    if (role === "system") {
      return {
        ...message,
        responseType: "system",
        structuredOutput: {
          responseType: "system",
        },
      };
    }

    const structured = this.extractStructuredOutput(message);
    if (!structured) {
      const bodyText = this.extractMessageBodyText(message);
      if (role === "assistant" && bodyText) {
        const next: any = {
          ...message,
          structuredOutput: {
            responseType: "message",
            message: bodyText,
          },
          content: bodyText,
        };
        if (Array.isArray(next.parts)) {
          next.parts = next.parts.filter((part: any) => {
            if (part && part.type === "tool") {
              const toolName = (part.tool || "").toString().toLowerCase();
              if (
                toolName.includes("structuredoutput") ||
                toolName.includes("structured_output")
              ) {
                return false;
              }
            }
            return true;
          });
        }
        return next;
      }
      if (role === "assistant" && !bodyText) {
        if (!allowSyntheticFallbackError) {
          return message;
        }
        const incompatibleModelKey = this.getStructuredOutputModelKey(
          this.firstNonEmptyString(
            message?.info?.providerID,
            message?.providerID,
          ),
          this.firstNonEmptyString(
            message?.info?.modelID,
            message?.modelID,
          ),
        );
        const retryWithoutStructuredOutput = true;
        const fallbackText =
          incompatibleModelKey &&
            this.structuredOutputIncompatibleModelKeys.has(incompatibleModelKey)
            ? "Structured output error: this model returned an empty structured payload."
            : "I couldn't produce a valid structured response for this turn. Please retry.";
        const next: any = {
          ...message,
          content: fallbackText,
          error: fallbackText,
          retryWithoutStructuredOutput,
        };
        const parts = Array.isArray(next.parts)
          ? next.parts.filter((part: any) => this.isRenderableTextPart(part))
          : [];
        const textIndex = parts.findIndex((part: any) =>
          this.isRenderableTextPart(part),
        );
        if (textIndex >= 0) {
          parts[textIndex] = {
            ...parts[textIndex],
            type: "text",
            text: fallbackText,
          };
        } else {
          parts.push({ type: "text", text: fallbackText });
        }
        next.parts = parts;
        return next;
      }
      return message;
    }

    const isInteractiveStructuredResponse =
      this.isInteractiveResponseType(structured.responseType) &&
      Array.isArray(structured.interactiveEvents) &&
      structured.interactiveEvents.length > 0;
    const structuredPlanContent =
      this.firstNonEmptyString(structured.plan?.content) || "";
    const shouldSuppressStructuredPlan =
      this.isClarificationQuestionnaire(structuredPlanContent);

    const next: any = {
      ...message,
      structuredOutput: structured,
    };

    if (Array.isArray(next.parts)) {
      next.parts = next.parts.filter((part: any) => {
        if (part && part.type === "tool") {
          const toolName = (part.tool || "").toString().toLowerCase();
          if (
            toolName.includes("structuredoutput") ||
            toolName.includes("structured_output")
          ) {
            return false;
          }
        }
        return true;
      });
    }

    const bodyText = this.extractMessageBodyText(message);
    const hasJsonOnlyBody = bodyText.startsWith("{") && bodyText.endsWith("}");
    if (hasJsonOnlyBody) {
      next.content = "";
      if (Array.isArray(next.parts)) {
        next.parts = next.parts.filter((p: any) => p?.type !== "text");
      }
    }

    // Preserve the default OpenCode response body whenever it exists.
    // Only inject structured text as a fallback when body text is missing or JSON-only.
    const messageContent =
      structured.message ||
      this.createFallbackMessage(structured);
    const shouldUseStructuredMessage = !bodyText || hasJsonOnlyBody;
    if (messageContent && shouldUseStructuredMessage) {
      next.content = messageContent;
      const parts = Array.isArray(next.parts) ? [...next.parts] : [];
      const textIndex = parts.findIndex(
        (part: any) => this.isRenderableTextPart(part),
      );
      if (textIndex >= 0) {
        parts[textIndex] = {
          ...parts[textIndex],
          type: "text",
          text: messageContent,
        };
      } else {
        parts.push({ type: "text", text: messageContent });
      }
      next.parts = parts;
    }

    if (structured.progressUpdates && structured.progressUpdates.length > 0) {
      const existingSteps = Array.isArray(next.steps) ? next.steps : [];
      const mapped = structured.progressUpdates.map((update) => ({
        type: "step",
        title: update.title,
        content: update.filePath,
        status: update.status ?? "pending",
        meta: update.meta,
      }));
      next.steps = [...existingSteps, ...mapped];
    }

    if (
      structured.interactiveEvents &&
      structured.interactiveEvents.length > 0
    ) {
      next.interactiveEvents = structured.interactiveEvents;
      const questionPrompt = this.deriveQuestionPromptFromInteractivePayload(
        structured.interactiveEvents,
        structured.question,
      );
      const currentBodyText = this.extractMessageBodyText(next).trim();
      const normalizeComparableText = (value: string): string =>
        value.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim().toLowerCase();
      const promptNorm = questionPrompt
        ? normalizeComparableText(questionPrompt)
        : "";
      const bodyNorm = normalizeComparableText(currentBodyText);
      let visibleInteractiveBody: string | undefined;

      if (questionPrompt) {
        if (
          !currentBodyText ||
          bodyNorm === promptNorm ||
          this.isLowValueInteractiveBodyText(currentBodyText)
        ) {
          visibleInteractiveBody = questionPrompt;
        } else if (promptNorm && bodyNorm.startsWith(promptNorm)) {
          visibleInteractiveBody = currentBodyText;
        } else {
          visibleInteractiveBody = `${questionPrompt}\n\n${currentBodyText}`;
        }
      } else if (!currentBodyText) {
        const firstEvent = structured.interactiveEvents[0];
        if (firstEvent.type === "question" || firstEvent.type === "confirm") {
          visibleInteractiveBody = firstEvent.question;
        } else if (firstEvent.type === "message") {
          visibleInteractiveBody = firstEvent.message;
        } else if (firstEvent.type === "quick_actions") {
          visibleInteractiveBody = this.firstNonEmptyString(firstEvent.title);
        }
      }

      if (visibleInteractiveBody) {
        next.content = visibleInteractiveBody;
        const parts = Array.isArray(next.parts) ? [...next.parts] : [];
        const textIndex = parts.findIndex((part: any) =>
          this.isRenderableTextPart(part),
        );
        if (textIndex >= 0) {
          parts[textIndex] = {
            ...parts[textIndex],
            type: "text",
            text: visibleInteractiveBody,
          };
        } else {
          parts.push({ type: "text", text: visibleInteractiveBody });
        }
        next.parts = parts;
      }
    }

    if (structured.subagents && structured.subagents.length > 0) {
      if (!next.subagents) {
        next.subagents = [];
      }
      structured.subagents.forEach((sa: any) => {
        const normalized = {
          ...sa,
          agentId: this.firstNonEmptyString(sa.agentId, sa.name) || sa.id,
          latestActivity:
            this.firstNonEmptyString(sa.latestActivity, sa.description) ||
            "Subagent update",
        };
        const existing = next.subagents.find((item: any) => item.id === sa.id);
        if (existing) {
          Object.assign(existing, normalized);
        } else {
          next.subagents.push(normalized);
        }
      });

      const hasTextContent =
        (typeof next.content === "string" && next.content.trim().length > 0) ||
        (Array.isArray(next.parts) &&
          next.parts.some(
            (part: any) =>
              part?.type === "text" &&
              typeof part?.text === "string" &&
              part.text.trim().length > 0,
          ));
      if (
        !hasTextContent &&
        (structured.responseType === "subagents" ||
          (structured.subagentsDelta &&
            structured.subagentsDelta.items.length > 0))
      ) {
        const subagentCount =
          structured.subagents?.length ??
          structured.subagentsDelta?.items.length ??
          0;
        const summaryText = `Spawned ${subagentCount} subagent${subagentCount === 1 ? "" : "s"
          }.`;
        next.content = summaryText;
        const parts = Array.isArray(next.parts) ? [...next.parts] : [];
        parts.push({ type: "text", text: summaryText });
        next.parts = parts;
      }
    }

    if (
      structured.responseType === "implementation_plan" &&
      !shouldSuppressStructuredPlan
    ) {
      const summaryMessage = this.firstNonEmptyString(
        structured.message,
      );
      const safeMessage =
        summaryMessage && summaryMessage.length <= 280
          ? summaryMessage
          : "Implementation plan is ready. Use View Plan to inspect details.";
      next.content = safeMessage;
      const parts = Array.isArray(next.parts) ? [...next.parts] : [];
      const textIndex = parts.findIndex(
        (part: any) =>
          part &&
          typeof part === "object" &&
          (part.type === "text" ||
            typeof part.text === "string" ||
            typeof part.content === "string"),
      );
      if (textIndex >= 0) {
        parts[textIndex] = {
          ...parts[textIndex],
          type: "text",
          text: safeMessage,
        };
      } else {
        parts.push({ type: "text", text: safeMessage });
      }
      next.parts = parts;
    }

    if (
      !isInteractiveStructuredResponse &&
      !shouldSuppressStructuredPlan &&
      (structured.responseType === "implementation_plan" ||
        structured.plan?.content ||
        structured.plan?.file)
    ) {
      const planContent = this.firstNonEmptyString(structured.plan?.content);
      const structuredPlanCandidates =
        this.collectPlanFileCandidatesFromStructuredPlan(
          this.asRecord(structured.plan),
        );
      const planFile = structuredPlanCandidates[0];
      const resolvedPlanTitle = this.resolvePlanTitle({
        plan: structured.plan,
        planFile: planFile || structuredPlanCandidates[0],
        fallback: structured.plan?.summary as string | undefined,
      });
      const hasLongPlanContent =
        typeof planContent === "string" && planContent.trim().length >= 80;
      // File-backed plans must still produce a plan card even when no markdown
      // content is embedded in structured output.
      if (hasLongPlanContent || planFile) {
        next.plan = {
          file: planFile,
          content: hasLongPlanContent ? planContent : undefined,
          title: resolvedPlanTitle,
          summary: structured.plan?.summary,
          files:
            structuredPlanCandidates.length > 0
              ? structuredPlanCandidates
              : undefined,
        };
      }
    }

    if (shouldSuppressStructuredPlan) {
      if (next.plan) {
        delete next.plan;
      }
      if (structured.responseType === "implementation_plan") {
        const clarificationMessage =
          this.firstNonEmptyString(
            structured.message,
          ) ||
          "I need a few clarifications before drafting the implementation plan.";
        next.content = clarificationMessage;
        const parts = Array.isArray(next.parts) ? [...next.parts] : [];
        const textIndex = parts.findIndex(
          (part: any) => this.isRenderableTextPart(part),
        );
        if (textIndex >= 0) {
          parts[textIndex] = {
            ...parts[textIndex],
            type: "text",
            text: clarificationMessage,
          };
        } else {
          parts.push({ type: "text", text: clarificationMessage });
        }
        next.parts = parts;
      }
    }

    return next;
  }

  /**
   * Handles sending a message to OpenCode
   */
  // PROMPT-OWNERSHIP: do not modify — transport-only path
  private async handleSendMessage(
    text: string,
    files?: string[],
    contexts?: any[],
    images?: any[],
    agent?: string,
    isRetry = false,
    recoveredContext?: RecoveredSessionContext,
    retryWithoutStructuredOutput = false,
    structuredFallbackReason?: string,
    userFacingText?: string,
  ): Promise<void> {
    // Cache for retry
    this.lastSendMessageArgs = { text, files, contexts, images, agent };

    // We'll set processing state once we have a definitive session ID below

    const overallStartTime = Date.now();
    this.logger.info("🚀 [TIMING] Message send started", {
      messageLength: text.length,
      isRetry,
      hasFiles: !!files?.length,
      hasContexts: !!contexts?.length,
      hasImages: !!images?.length,
      agent,
      timestamp: new Date().toISOString(),
    });

    let drainSessionId: string | undefined;
    const capturePromptDebug = this.shouldVerboseStreamDebug();
    let debugSessionId: string | undefined;
    let baselineAssistantMarker: AssistantHistoryMarker | undefined;
    try {
      const normalizedImages = (Array.isArray(images) ? images : [])
        .map((img) => {
          if (typeof img === "string") {
            return { dataUrl: img, filename: "image" };
          }
          if (img?.dataUrl && typeof img.dataUrl === "string") {
            return {
              dataUrl: img.dataUrl,
              filename:
                typeof img.filename === "string" ? img.filename : "image",
            };
          }
          return null;
        })
        .filter((img): img is { dataUrl: string; filename: string } => !!img);
      const imageUrls = normalizedImages.map((img) => img.dataUrl);

      const serverStartTime = Date.now();
      this.logger.info("⏳ [TIMING] Calling ensureRunning()...");
      const client = await this.serverManager.ensureRunning();
      this.logger.info(`✅ [TIMING] Server ready (${Date.now() - serverStartTime}ms)`);

      const sessionStartTime = Date.now();
      this.logger.info("⏳ [TIMING] Getting current session...");
      let session = await this.sessionService.getCurrentSession();
      if (this.currentSessionId && session.id !== this.currentSessionId) {
        session = await this.sessionService.switchSession(
          this.currentSessionId,
        );
      }
      this.logger.info(`✅ [TIMING] Session ready (${Date.now() - sessionStartTime}ms): ${session.id}`);

      drainSessionId = session.id;
      this.processingSessionIds.add(drainSessionId);
      this.sendProcessingSessionsUpdate();
      this.currentSessionId = session.id;
      this.subagentTracker.setActiveSession(session.id);
      this.awaitingInteractiveAnswer = false;

      // Check budget before sending
      const budgetCheck = this.budgeter.canMakeRequest();
      if (!budgetCheck.allowed) {
        this.sendBudgetInfo();
        // Show warning to user
        vscode.window.showWarningMessage(
          `Request limit reached: ${budgetCheck.reason}`,
        );
        return;
      }

      const messagesStartTime = Date.now();
      this.logger.info("⏳ [TIMING] Loading existing messages...");
      const existingMessages = await this.sessionService.getMessages(
        session.id,
      );
      this.logger.info(`✅ [TIMING] Messages loaded (${Date.now() - messagesStartTime}ms): ${existingMessages.length} messages`);

      baselineAssistantMarker =
        this.getLatestAssistantHistoryMarker(existingMessages);
      const isNewSession = existingMessages.length === 0;

      if (isNewSession) {
        const config = vscode.workspace.getConfiguration('opencode');
        const autoGenerateTitle = config.get<boolean>('autoGenerateSessionTitle', true);
        if (autoGenerateTitle) {
          const generatedTitle = TitleGeneratorService.generateTitle(text);
          await this.updateSessionTitle(session.id, generatedTitle);
        }
      }

      // Save user message to local history immediately, unless this is a retry
      if (!isRetry) {
        const persistedUserText =
          this.firstNonEmptyString(userFacingText, text) || text;
        const userMessage = {
          role: "user" as const,
          content: persistedUserText,
          text: persistedUserText,
          parts: [
            {
              type: "text",
              text: text,
            },
          ],
          images: imageUrls,
          time: {
            created: Date.now(),
          },
        };
        await this.sessionService.appendMessage(session.id, userMessage);

        this.view?.webview.postMessage({
          type: "userMessageAppended",
          message: userMessage,
        });

        await this.handleGetSessions();
      }

      console.log(
        `[ChatViewProvider] Session ${session.id}: ${existingMessages.length} existing messages. isNew: ${isNewSession}`,
      );

      // Prepare message parts
      const parts: NonNullable<SessionPromptData["body"]>["parts"] = [
        {
          type: "text",
          text: text,
        },
      ];

      // Add context fragments if any
      if (contexts && contexts.length > 0) {
        for (const ctx of contexts) {
          parts.push({
            type: "text",
            text: `\`\`\`${ctx.languageId}\n// ${ctx.file}:${ctx.lineInfo}\n${ctx.content}\n\`\`\``,
          });
        }
      }

      if (recoveredContext?.transcript) {
        parts.push({
          type: "text",
          text: [
            "Recovered conversation context from the previous session ID",
            `(${recoveredContext.previousSessionId}).`,
            "Treat this as existing conversation history and continue from it.",
            "--- BEGIN RECOVERED CONTEXT ---",
            recoveredContext.transcript,
            "--- END RECOVERED CONTEXT ---",
          ].join("\n"),
        });
      }

      // Add file references if any
      // ... (rest of the file part logic remains the same)

      // Add file references if any
      if (files && files.length > 0) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
          for (const filePath of files) {
            try {
              // Check if path is absolute
              let absoluteUri: vscode.Uri;
              if (path.isAbsolute(filePath)) {
                absoluteUri = vscode.Uri.file(filePath);
              } else {
                absoluteUri = vscode.Uri.joinPath(
                  workspaceFolder.uri,
                  filePath,
                );
              }

              const content = await vscode.workspace.fs.readFile(absoluteUri);
              const textContent = new TextDecoder().decode(content);

              parts.push({
                type: "file",
                mime: "text/plain",
                filename: filePath.split(/[\\/]/).pop(),
                url: `file://${filePath}`,
                source: {
                  type: "file",
                  path: filePath,
                  text: {
                    value: textContent,
                    start: 0,
                    end: textContent.length,
                  },
                },
              });
            } catch (e) {
              console.error(`Failed to read file ${filePath}:`, e);
            }
          }
        }
      }

      if (normalizedImages.length > 0) {
        for (const img of normalizedImages) {
          // Extract mime type from data URL, default to image/jpeg
          const mimeMatch = img.dataUrl.match(/^data:([^;]+);/);
          const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

          parts.push({
            type: "file",
            mime: mimeType,
            filename: img.filename || "image",
            url: img.dataUrl,
          });
        }
      }

      // Send the message using the SDK
      const startTime = Date.now();
      const useStructuredOutput =
        !retryWithoutStructuredOutput &&
        this.shouldUseStructuredOutput(
          (parts as Array<Record<string, unknown>>)
            ? (parts as Array<Record<string, unknown>>)
            : [],
          agent || this.selectedAgent,
        );
      const promptBody: NonNullable<SessionPromptData["body"]> = {
        model: this.selectedModel,
        agent: agent || this.selectedAgent,
        parts: parts,
      };
      const promptVariant = await this.resolvePromptVariant(session.id);
      if (promptVariant) {
        (promptBody as Record<string, unknown>).variant = promptVariant;
      }
      if (capturePromptDebug) {
        debugSessionId = session.id;
        await this.logPromptRequestPayload(
          session.id,
          promptBody,
          useStructuredOutput,
        );
      }

      const promptStartTime = Date.now();
      this.logger.info("⏳ [TIMING] Sending prompt to server...", {
        model: this.selectedModel.modelID,
        agent: agent || this.selectedAgent,
        partsCount: parts.length,
      });

      const response = await this.promptWithStructuredOutput(
        client,
        session.id,
        promptBody,
        useStructuredOutput,
      );

      const promptDuration = Date.now() - promptStartTime;
      this.logger.info(`✅ [TIMING] Prompt response received (${promptDuration}ms)`, {
        hasData: Boolean(response.data),
        hasError: Boolean(response.error),
        status: response.response?.status,
        messageId: (response.data as any)?.info?.id,
      });

      const duration = (Date.now() - startTime) / 1000;
      if (capturePromptDebug) {
        await this.logPromptResponsePayload(
          session.id,
          response,
          duration,
          useStructuredOutput,
        );
      }

      console.log(`[ChatViewProvider] Response received in ${duration}s`, {
        hasData: Boolean(response.data),
        hasError: Boolean(response.error),
        status: response.response?.status,
        messageId: (response.data as any)?.info?.id,
      });
      if (response.data && capturePromptDebug) {
        this.logPromptResponseDiagnostics(session.id, response.data);
      }

      // Update budget info after successful send
      // Note: recordRequest() temporarily disabled - budget now reads from actual Copilot quota data
      if (!response.error) {
        // this.budgeter.recordRequest(); // DISABLED - was tracking all requests, not just Copilot
        this.sendBudgetInfo();
      }

      if (response.error) {
        const errorMessages = this.collectNormalizedErrorMessages(response.error);
        log.error("API error returned", {
          sessionId: session.id,
          error: response.error,
          status: response.response?.status,
          errorMessages,
        });
        this.logger.error("Prompt request failed", {
          sessionId: session.id,
          status: response.response?.status,
          errorMessages,
        });

        let errorMessage = this.extractDetailedErrorMessage(
          response.error,
          "Failed to send message",
        );
        if (
          this.awaitingInteractiveAnswer &&
          this.isLikelyInteractiveAwaitTimeoutError(errorMessage)
        ) {
          this.logger.info(
            "Suppressing timeout error while awaiting interactive response",
            {
              sessionId: session.id,
              errorMessage,
            },
          );
          return;
        }
        if (this.isLikelyInteractiveAwaitTimeoutError(errorMessage)) {
          const recovered = await this.tryRecoverTimedOutResponse(
            session.id,
            baselineAssistantMarker,
          );
          if (recovered) {
            this.logger.info(
              "Recovered timed out prompt from session history without user retry",
              {
                sessionId: session.id,
                errorMessage,
              },
            );
            return;
          }
        }

        // Handle Session Not Found error (likely server restart)
        if (
          errorMessage.toLowerCase().includes("not found") &&
          errorMessage.toLowerCase().includes("session")
        ) {
          console.warn(
            `[ChatViewProvider] Session ${session.id} not found on server. Re-creating...`,
          );
          // Re-create the session on the server
          try {
            const newSession = await this.sessionService.createNewSession(
              session.title,
            );
            console.log(
              `[ChatViewProvider] Re-created session with new ID: ${newSession.id}`,
            );

            // Migrate local messages from old ID to new ID
            const localMessages = await this.sessionService.loadSessionMessages(
              session.id,
            );
            await this.sessionService.saveSessionMessages(
              newSession.id,
              localMessages,
            );
            // Optionally delete old messages? No, leave them for now.

            // Set as current session and retry
            await this.sessionService.switchSession(newSession.id);
            this.subagentTracker.resetForSession(newSession.id);

            // Notify UI of the ID change if possible, or just refresh sessions
            await this.handleGetSessions();

            const recoveryTranscript =
              this.buildRecoveredTranscript(localMessages);
            if (recoveryTranscript) {
              await this.saveSessionRecoveryMap(session.id, newSession.id);
            }
            this.migrateSessionSettings(session.id, newSession.id);
            this.currentSessionId = newSession.id;

            // Retry sending (recursive call) with preserved context
            return this.handleSendMessage(
              text,
              files,
              contexts,
              images,
              agent,
              true,
              recoveryTranscript
                ? {
                  previousSessionId: session.id,
                  transcript: recoveryTranscript,
                }
                : undefined,
              retryWithoutStructuredOutput,
              structuredFallbackReason,
            );
          } catch (recreateError) {
            console.error(
              "[ChatViewProvider] Failed to re-create session:",
              recreateError,
            );
          }
        }

        // Handle specific model not found error
        if (
          errorMessage.includes("ProviderModelNotFoundError") ||
          errorMessage.includes("ModelNotFoundError")
        ) {
          errorMessage +=
            "\n\nTIP: Try starting a new session (click +) to use the default model.";
        }

        const isStructuredOutputError =
          this.isStructuredOutputTransportError(errorMessage);
        if (isStructuredOutputError) {
          const modelKey = this.getSelectedStructuredOutputModelKey();
          if (modelKey) {
            this.structuredOutputIncompatibleModelKeys.add(modelKey);
          }
          if (!retryWithoutStructuredOutput) {
            this.logger.warn(
              "Structured output failed; auto-retrying without schema",
              {
                sessionId: session.id,
                providerID: this.selectedModel.providerID,
                modelID: this.selectedModel.modelID,
              },
            );
            return this.handleSendMessage(
              text,
              files,
              contexts,
              images,
              agent,
              true,
              recoveredContext,
              true,
              errorMessage,
            );
          }
          errorMessage = [
            "Structured output error: the selected model/provider did not return a usable JSON payload.",
            "Retry without structured output to continue with a plain text response.",
            "",
            `Details: ${errorMessage}`,
          ].join("\n");
        }

        vscode.window.showErrorMessage(`OpenCode error: ${errorMessage}`);
        this.view?.webview.postMessage({
          type: "error",
          message: errorMessage,
        });
        return;
      }

      // Check for hidden errors in data (e.g. ModelNotFoundError returned as JSON)
      if (
        response.data &&
        (response.data as any).suggestions &&
        (response.data as any).modelID &&
        !(response.data as any).content
      ) {
        const errData = response.data as any;
        let errorMessage = `Model '${errData.modelID}' not found in provider '${errData.providerID}'.`;
        if (errData.suggestions && errData.suggestions.length > 0) {
          errorMessage += ` Did you mean: ${errData.suggestions.join(", ")}?`;
        }
        errorMessage +=
          "\n\nTIP: Check your model selection or local OpenCode configuration.";

        vscode.window.showErrorMessage(errorMessage);
        this.view?.webview.postMessage({
          type: "error",
          message: errorMessage,
        });
        return;
      }

      // Send response back to webview
      if (response.data) {
        const rawResponse = this.buildRawResponseDebugText(response.data);
        const structuredMessage = this.applyStructuredOutputToMessage(
          response.data,
        );
        const enrichedMessage = this.enrichMessageWithPlan(structuredMessage);
        const structuredFailureText = this.firstNonEmptyString(
          (enrichedMessage as any)?.error,
        );
        if (
          !retryWithoutStructuredOutput &&
          structuredFailureText &&
          this.isStructuredOutputFailureMessage(structuredFailureText)
        ) {
          const modelKey = this.getSelectedStructuredOutputModelKey();
          if (modelKey) {
            this.structuredOutputIncompatibleModelKeys.add(modelKey);
          }
          this.logger.warn(
            "Structured output payload unusable; auto-retrying without schema",
            {
              sessionId: session.id,
              providerID: this.selectedModel.providerID,
              modelID: this.selectedModel.modelID,
              reason: structuredFailureText,
            },
          );
          return this.handleSendMessage(
            text,
            files,
            contexts,
            images,
            agent,
            true,
            recoveredContext,
            true,
            structuredFailureText,
          );
        }
        const trackerSnapshotPayload = this.subagentTracker.getSnapshotPayload();
        const hasSubagentSignal =
          this.hasStructuredSubagentSignal(enrichedMessage);
        let assistantMessageId = this.extractMessageId(enrichedMessage);
        if (!assistantMessageId && hasSubagentSignal) {
          assistantMessageId = this.subagentTracker.getLatestParentMessageId(
            session.id,
          );
          if (assistantMessageId) {
            enrichedMessage.id = assistantMessageId;
          }
        }
        if (!assistantMessageId && hasSubagentSignal) {
          assistantMessageId = this.findLatestSubagentParentMessageIdForSession(
            trackerSnapshotPayload,
            session.id,
          );
          if (assistantMessageId) {
            enrichedMessage.id = assistantMessageId;
          }
        }
        if (assistantMessageId) {
          const hydratedSubagents =
            await this.subagentTracker.finalizeParentMessage({
              client,
              parentSessionId: session.id,
              parentMessageId: assistantMessageId,
            });
          if (hydratedSubagents.length > 0) {
            enrichedMessage.subagents = hydratedSubagents;
            this.view?.webview.postMessage({
              type: "subagentUpdate",
              ...this.subagentTracker.getPayloadForParentMessage(
                assistantMessageId,
              ),
            });
          } else {
            let snapshotPayload = this.subagentTracker.getPayloadForParentMessage(
              assistantMessageId,
            );
            const hydratedFromSnapshot = this.hydrateSubagentsFromPayload(
              assistantMessageId,
              snapshotPayload,
              session.id,
            );
            if (hydratedFromSnapshot.length > 0) {
              enrichedMessage.subagents = this.mergeSubagentEntries(
                enrichedMessage.subagents,
                hydratedFromSnapshot,
              );
            } else if (hasSubagentSignal) {
              const fallbackParentMessageId =
                this.findLatestSubagentParentMessageIdForSession(
                  trackerSnapshotPayload,
                  session.id,
                );
              if (
                fallbackParentMessageId &&
                fallbackParentMessageId !== assistantMessageId
              ) {
                snapshotPayload =
                  this.subagentTracker.getPayloadForParentMessage(
                    fallbackParentMessageId,
                  );
                const hydratedFallback = this.hydrateSubagentsFromPayload(
                  fallbackParentMessageId,
                  snapshotPayload,
                  session.id,
                );
                if (hydratedFallback.length > 0) {
                  enrichedMessage.subagents = this.mergeSubagentEntries(
                    enrichedMessage.subagents,
                    hydratedFallback,
                  );
                  if (!this.extractMessageId(enrichedMessage)) {
                    enrichedMessage.id = fallbackParentMessageId;
                  }
                }
              }
            }
          }
        } else if (hasSubagentSignal) {
          const fallbackParentMessageId =
            this.findLatestSubagentParentMessageIdForSession(
              trackerSnapshotPayload,
              session.id,
            );
          if (fallbackParentMessageId) {
            const snapshotPayload =
              this.subagentTracker.getPayloadForParentMessage(
                fallbackParentMessageId,
              );
            const hydratedFallback = this.hydrateSubagentsFromPayload(
              fallbackParentMessageId,
              snapshotPayload,
              session.id,
            );
            if (hydratedFallback.length > 0) {
              enrichedMessage.subagents = this.mergeSubagentEntries(
                enrichedMessage.subagents,
                hydratedFallback,
              );
              if (!this.extractMessageId(enrichedMessage)) {
                enrichedMessage.id = fallbackParentMessageId;
              }
            }
          }
        }

        const normalizedFallbackReason = this.firstNonEmptyString(
          structuredFallbackReason,
        );
        const plainTextFallbackMetadata =
          retryWithoutStructuredOutput && normalizedFallbackReason
            ? {
              plainTextFallback: true,
              plainTextFallbackMessage:
                "Structured output failed for this turn. Showing plain text response.",
              plainTextFallbackReason: normalizedFallbackReason.slice(0, 500),
            }
            : undefined;
        const finalMessage = plainTextFallbackMetadata
          ? {
            ...enrichedMessage,
            ...plainTextFallbackMetadata,
          }
          : enrichedMessage;

        const debugMessage = {
          ...finalMessage,
          rawResponse,
        };

        // Persist canonical assistant message without raw debug payload so
        // session storage/write path stays lightweight.
        await this.sessionService.appendMessage(session.id, {
          ...finalMessage,
          timing: {
            duration: duration,
          },
        });
        // Persist a hydrated override that *includes* rawResponse for reload parity.
        await this.persistSessionMessageOverride(session.id, {
          ...debugMessage,
          timing: {
            duration: duration,
          },
        });
        const snapshotFromFinalMessage = this.buildSubagentPayloadFromMessage(
          finalMessage,
          session.id,
        );
        if (snapshotFromFinalMessage) {
          await this.persistSubagentLiveState(
            session.id,
            snapshotFromFinalMessage,
          );
        }

        this.view?.webview.postMessage({
          type: "messageResponse",
          message: {
            ...debugMessage,
            timing: {
              duration: duration,
            },
          },
        });

        // Auto-compact if the context window is getting full.
        void this.maybeAutoCompact(session.id, response.data);
      } else {
        const noDataMessageText =
          "No final response payload was returned by the provider.";
        const rawResponse = this.buildRawResponseDebugText({
          status: response?.response?.status,
          data: response?.data,
          error: response?.error,
        });
        const fallbackMessage = {
          role: "assistant",
          content: noDataMessageText,
          parts: [{ type: "text", text: noDataMessageText }],
          rawResponse,
          timing: {
            duration: duration,
          },
        };

        await this.sessionService.appendMessage(session.id, fallbackMessage);
        this.view?.webview.postMessage({
          type: "messageResponse",
          message: fallbackMessage,
        });
        this.logger.warn("No response data received from OpenCode", {
          sessionId: session.id,
          status: response?.response?.status,
          hasError: Boolean(response?.error),
        });
      }
    } catch (error) {
      const totalDuration = Date.now() - overallStartTime;
      this.logger.error(`❌ [TIMING] Message failed after ${totalDuration}ms`, {
        error: String(error),
        sessionId: drainSessionId,
      });

      const errorMessage = this.extractDetailedErrorMessage(
        error,
        "Failed to send message",
      );
      if (
        this.awaitingInteractiveAnswer &&
        this.isLikelyInteractiveAwaitTimeoutError(errorMessage)
      ) {
        this.logger.info(
          "Suppressing thrown timeout while awaiting interactive response",
          {
            sessionId: drainSessionId,
            errorMessage,
          },
        );
        return;
      }
      if (
        drainSessionId &&
        this.isLikelyInteractiveAwaitTimeoutError(errorMessage)
      ) {
        const recovered = await this.tryRecoverTimedOutResponse(
          drainSessionId,
          baselineAssistantMarker,
        );
        if (recovered) {
          this.logger.info(
            "Recovered thrown timeout from session history without user retry",
            {
              sessionId: drainSessionId,
              errorMessage,
            },
          );
          return;
        }
      }
      vscode.window.showErrorMessage(`Failed to send message: ${errorMessage}`);
      console.error("Send message error:", error);
      console.error("Send message error details:", {
        sessionId: drainSessionId,
        errorMessage,
        errorMessages: this.collectNormalizedErrorMessages(error),
      });
      this.logger.error("Send message exception", {
        sessionId: drainSessionId,
        errorMessage,
        errorMessages: this.collectNormalizedErrorMessages(error),
      });

      // Show error in webview too
      this.view?.webview.postMessage({
        type: "error",
        message: errorMessage,
      });
    } finally {
      const totalDuration = Date.now() - overallStartTime;
      this.logger.info(`🏁 [TIMING] Message processing completed in ${totalDuration}ms`, {
        sessionId: drainSessionId,
        timestamp: new Date().toISOString(),
      });

      if (debugSessionId) {
        this.promptDebugBySession.delete(debugSessionId);
      }
      if (drainSessionId) {
        this.processingSessionIds.delete(drainSessionId);
        this.sendProcessingSessionsUpdate();
      }
      this.logger.info("Processing request finished", {
        sessionId: drainSessionId,
      });
      if (drainSessionId) {
        this.queueManager.maybeAutoDrainQueue(drainSessionId);
      }
    }
  }

  /**
   * Enriches a message with plan information if detected.
   * FORBIDDEN TO REMOVE: This logic ensures the Implementation Plan button appears,
   * which is a core feature for user transparency and workflow.
   */
  private async resolveStopSessionId(
    requestedSessionId?: string,
  ): Promise<string | undefined> {
    const explicitSessionId = this.firstNonEmptyString(requestedSessionId);
    if (explicitSessionId) {
      return explicitSessionId;
    }

    const activeSessionId = this.firstNonEmptyString(this.currentSessionId);
    if (activeSessionId) {
      return activeSessionId;
    }

    if (!this.isProcessingRequest) {
      return undefined;
    }

    try {
      const currentSession = await this.sessionService.getCurrentSession();
      return this.firstNonEmptyString(currentSession?.id);
    } catch (error) {
      console.warn(
        "[ChatViewProvider] Failed to resolve stop session from SessionService:",
        error,
      );
      return undefined;
    }
  }

  /**
   * Handles stopping a request
   */
  // FORBIDDEN TO REMOVE: Stop Request Button - backend handler required by webview to abort streaming requests
  private async handleStopRequest(sessionId?: string): Promise<void> {
    let resolvedSessionId: string | undefined;
    try {
      resolvedSessionId = await this.resolveStopSessionId(sessionId);
      if (!resolvedSessionId) {
        this.logger.warn("stopRequest ignored: no active session ID resolved");
        return;
      }

      const client = this.serverManager.getClient();
      if (!client) {
        this.logger.warn("stopRequest skipped: no client available", {
          sessionId: resolvedSessionId,
        });
        return;
      }

      this.logger.info("Stopping request", {
        sessionId: resolvedSessionId,
      });

      const workspaceDirectory = this.getWorkspaceDirectory();
      await client.session.abort({
        path: { id: resolvedSessionId },
        query: workspaceDirectory ? { directory: workspaceDirectory } : undefined,
      });
    } catch (error) {
      console.error("Failed to stop request:", error);
    } finally {
      if (resolvedSessionId) {
        this.processingSessionIds.delete(resolvedSessionId);
        this.sendProcessingSessionsUpdate();
      }
      this.view?.webview.postMessage({
        type: "stopRequestHandled",
        sessionId: resolvedSessionId,
      });
      if (resolvedSessionId) {
        this.queueManager.maybeAutoDrainQueue(resolvedSessionId);
      }
    }
  }

  /**
   * Returns the context token limit for the currently selected model, or
   * undefined if the model/limit is unknown.
   */
  /**
   * Checks whether the context window is at or above the auto-compact
   * threshold after a completed turn and, if so, triggers compaction
   * automatically so the next turn does not hit the limit.
   *
   * The threshold is intentionally set at 90 % so compaction runs while
   * there is still room for the summary that the compaction call itself
   * produces.
   */
  /**
   * Appends text to the prompt input
   */
  async appendToPrompt(text: string): Promise<void> {
    const value = typeof text === "string" ? text.trim() : "";
    if (!value) {
      return;
    }
    this.view?.webview.postMessage({
      type: "appendPrompt",
      message: {
        role: "user",
        content: value,
        parts: [{ type: "text", text: value }],
      },
    });
  }

  /**
   * Adds a context badge to the prompt input
   */
  async addContext(context: any): Promise<void> {
    this.view?.webview.postMessage({
      type: "addContext",
      context,
    });
  }

  /**
   * Automatically adds a context badge without overwriting manual ones
   */
  async autoAddContext(context: any): Promise<void> {
    this.view?.webview.postMessage({
      type: "addContext",
      context: { ...context, isAuto: true },
    });
  }

  /**
   * Clears any automatically added context
   */
  async clearAutoContext(): Promise<void> {
    this.view?.webview.postMessage({
      type: "clearAutoContext",
    });
  }

  async handlePlanProceed(payload: {
    rawPlan: string;
    comments: PlanProceedComment[];
    sourceFile?: string;
  }): Promise<void> {
    const rawPlan = typeof payload?.rawPlan === "string" ? payload.rawPlan : "";
    if (!rawPlan.trim()) {
      vscode.window.showErrorMessage(
        "Cannot proceed because implementation plan content is empty.",
      );
      return;
    }
    const comments = Array.isArray(payload?.comments) ? payload.comments : [];
    const hasChangeRequests = comments.some(
      (comment) => comment.text.trim().length > 0,
    );

    const commentLines = comments.map((comment) => {
      const textRef = comment.anchor?.selectedText
        ? `On text "${comment.anchor.selectedText}": `
        : "";
      return `- ${textRef}${comment.text}`;
    });

    const commentsMd =
      commentLines.length > 0
        ? `# Implementation Plan Comments\n\n${commentLines.join("\n")}`
        : "";
    const providedSourceFile = this.normalizePlanFileReference(
      payload?.sourceFile,
    );
    let planFilePath: string | undefined;

    if (providedSourceFile) {
      const diskPlan = await this.readPlanFileFromDisk(providedSourceFile);
      if (diskPlan) {
        planFilePath = providedSourceFile;
      } else {
        const preferredPath = this.resolvePlanFileCandidates(providedSourceFile)[0];
        planFilePath = await this.persistPlan(
          rawPlan,
          preferredPath,
        );
      }
    } else {
      const fallbackCandidates = this.prioritizePlanFileCandidates([
        ...this.extractMarkdownFileReferences(rawPlan),
        ...(await this.discoverLikelyPlanFileCandidates()),
      ]);
      for (const candidate of fallbackCandidates) {
        const diskPlan = await this.readPlanFileFromDisk(candidate);
        if (!diskPlan) {
          continue;
        }
        planFilePath = candidate;
        break;
      }
    }

    if (!planFilePath) {
      vscode.window.showErrorMessage(
        "Cannot proceed because the plan source file path is missing. Re-open the plan and try again.",
      );
      return;
    }

    let commentsFilePath: string | undefined;
    if (hasChangeRequests && commentsMd) {
      const ext = path.extname(planFilePath) || ".md";
      const baseName = path.basename(planFilePath, ext);
      commentsFilePath = path.join(
        path.dirname(planFilePath),
        `${baseName}_comments.md`,
      );
      try {
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(commentsFilePath),
          new TextEncoder().encode(commentsMd),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
          `Cannot proceed because plan comments could not be written: ${message}`,
        );
        return;
      }
    }

    const proceedMessage = hasChangeRequests
      ? [
        "Proceed on this plan.",
        `The attached plan file \`${planFilePath}\` is the source of truth.`,
        `Apply all reviewer comments from attached file \`${commentsFilePath}\`, then execute the resulting plan.`,
        "Begin making real edits now and continue until the implementation is complete.",
        "Do not return only a status update.",
      ].join("\n")
      : [
        "Proceed on this plan.",
        `The attached plan file \`${planFilePath}\` is the source of truth.`,
        "Execute the plan step-by-step and implement the described changes now.",
        "Begin making real edits now and continue until the implementation is complete.",
        "Do not return only a status update.",
      ].join("\n");

    const attachedFiles =
      hasChangeRequests && commentsFilePath
        ? [planFilePath, commentsFilePath]
        : [planFilePath];

    // Post addPlanAttachment message to chat webview for the visual chip
    const planGoal =
      rawPlan.match(/^#\s+(.+)/m)?.[1]?.trim() ?? "Implementation Plan";
    const planBase64 = Buffer.from(rawPlan, "utf-8").toString("base64");
    const dataUrl = `data:text/markdown;base64,${planBase64}`;
    this.view?.webview.postMessage({
      type: "addPlanAttachment",
      payload: {
        id: `plan-${Date.now()}`,
        filename: `\uD83D\uDCCB Implementation Plan: ${planGoal}`,
        mimeType: "text/markdown",
        dataUrl,
      },
    });

    const approvalMessage = {
      role: "user" as const,
      content: "Proceed on this plan.",
      text: "Proceed on this plan.",
      parts: [{ type: "text", text: "Proceed on this plan." }],
      time: {
        created: Date.now(),
      },
    };

    let activeSession: { id: string } | undefined;
    try {
      activeSession = this.currentSessionId
        ? await this.sessionService.switchSession(this.currentSessionId)
        : await this.sessionService.getCurrentSession();
    } catch {
      try {
        activeSession = await this.sessionService.getCurrentSession();
      } catch {
        activeSession = undefined;
      }
    }
    if (activeSession?.id) {
      await this.sessionService.appendMessage(activeSession.id, approvalMessage);
      this.view?.webview.postMessage({
        type: "userMessageAppended",
        message: approvalMessage,
      });
      await this.handleGetSessions();
    }

    PlanViewProvider.closeCurrentPanel();

    // Fire and forget so the plan tab closes immediately and execution starts in chat.
    void this.handleSendMessage(
      proceedMessage,
      attachedFiles,
      undefined,
      undefined,
      "build",
      true,
    ).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to proceed with plan: ${message}`);
    });
  }

  private buildRecoveredTranscript(messages: unknown[]): string {
    if (!Array.isArray(messages) || messages.length === 0) {
      return "";
    }

    const maxChars = 24_000;
    const lines: string[] = [];
    let used = 0;
    const recent = messages.slice(-40);

    for (const msg of recent) {
      const rec = this.asRecord(msg);
      if (!rec) {
        continue;
      }
      const role =
        this.firstNonEmptyString(
          rec.role,
          rec.info && this.asRecord(rec.info)?.role,
        ) || "assistant";
      const content = this.extractMessageBodyText(rec);
      if (!content) {
        continue;
      }
      const line = `[${role}] ${content}`;
      if (used + line.length + 1 > maxChars) {
        break;
      }
      lines.push(line);
      used += line.length + 1;
    }

    return lines.join("\n");
  }

  /**
   * Helper: Get session settings
   * Retrieves session-specific settings (model, agent, thinking level)
   */
  private getSessionSettings(_sessionId: string): {
    selectedModel?: { modelID: string; providerID: string };
    selectedAgent?: string;
    thinkingLevel?: string;
  } {
    // This would be implemented to retrieve per-session settings
    // For now, return empty object
    return {};
  }

  /**
   * Helper: Apply session settings
   * Applies session-specific model, agent, and thinking level
   */
  private async applySessionSettings(sessionId: string): Promise<void> {
    return this.modelAndAgentManager.applySessionSettings(sessionId);
  }

  /**
   * Helper: Migrate session settings
   * Transfers settings from old session to new session
   */
  private migrateSessionSettings(
    oldSessionId: string,
    newSessionId: string
  ): void {
    const settings = this.getSessionSettings(oldSessionId);
    if (settings.selectedModel || settings.selectedAgent || settings.thinkingLevel) {
      // Save to new session using ModelAndAgentManager
      void this.persistSessionSettings(newSessionId, {
        providerID: settings.selectedModel?.providerID,
        modelID: settings.selectedModel?.modelID,
        agent: settings.selectedAgent,
        thinkingLevel: settings.thinkingLevel,
      });
    }
  }

  /**
   * Shows the skill installer modal in the webview
   */
  async showSkillInstaller(): Promise<void> {
    this.view?.webview.postMessage({
      type: "showSkillInstaller",
    });
  }

  /**
   * Opens the My Skills panel in the webview
   */
  async openMySkills(): Promise<void> {
    this.view?.webview.postMessage({
      type: "openMySkills",
    });
  }

  /**
   * Refreshes the skills list in the webview
   */
  async refreshSkills(): Promise<void> {
    // TEMPORARILY DISABLED: Don't load skills to avoid 700+ skills bottleneck
    this.logger.warn("⚠️ [PERF] Skills loading disabled temporarily");
    this.view?.webview.postMessage({
      type: "mySkills",
      skills: [], // Return empty array instead of loading all skills
    });
  }

  /**
   * Handles skill-related messages from the webview
   */
  private async handleSkillMessage(message: {
    type: string;
    [key: string]: unknown;
  }): Promise<void> {
    switch (message.type) {
      case "getMySkills": {
        // TEMPORARILY DISABLED: Don't load skills to avoid 700+ skills bottleneck
        this.logger.warn("⚠️ [PERF] getMySkills disabled temporarily");
        this.view?.webview.postMessage({ type: "mySkills", skills: [] });
        break;
      }

      case "installSkill": {
        const { source, data } = message;
        let result;

        if (source === "url") {
          result = await this.skillManager.installFromUrl(data, (progress) => {
            this.view?.webview.postMessage({ type: "installProgress", progress });
          });
        } else if (source === "file") {
          result = await this.skillManager.installFromFile(data);
        } else {
          result = { success: false, error: "Unknown installation source" };
        }

        if (result.success) {
          this.view?.webview.postMessage({ type: "skillInstalled", skill: result.skill });
        } else {
          this.view?.webview.postMessage({ type: "skillError", error: result.error });
        }
        break;
      }

      case "removeSkill": {
        const { name } = message;
        await this.skillManager.deleteSkill(name);
        this.view?.webview.postMessage({ type: "skillRemoved", name });
        break;
      }

      case "editSkill": {
        const { name, updates } = message;
        await this.skillManager.updateSkill(name, updates);
        const skill = await this.skillManager.getSkill(name);
        this.view?.webview.postMessage({ type: "skillInstalled", skill });
        break;
      }

      case "validateSkill": {
        const { skill } = message;
        const validation = this.skillManager.validateSkill(skill);
        if (!validation.valid) {
          this.view?.webview.postMessage({
            type: "skillError",
            error: "Validation failed",
            details: validation.errors,
          });
        }
        break;
      }

      default:
        this.logger.warn("Unknown skill message type:", message.type);
    }
  }

  private async saveSessionRecoveryMap(
    previousSessionId: string,
    newSessionId: string,
  ): Promise<void> {
    if (
      !previousSessionId ||
      !newSessionId ||
      previousSessionId === newSessionId
    ) {
      return;
    }
    const existing =
      this.context.globalState.get<Record<string, string>>(
        "sessionRecoveryMap",
      ) ?? {};
    existing[previousSessionId] = newSessionId;
    await this.context.globalState.update("sessionRecoveryMap", existing);
  }

  /**
   * Handles viewing the implementation plan
   */
  /**
   * Handles opening the file picker
   */
  private async handleAttachFiles(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: "Attach to Chat",
      filters: {
        "All Files": ["*"],
      },
    });

    if (uris && uris.length > 0) {
      // Convert URIs to relative paths or absolute paths for selection
      // For now, let's just send back the absolute paths as this is what the extension uses
      const files = uris.map((u) => u.fsPath);

      // We need a message type to receive these in the webview
      this.view?.webview.postMessage({
        type: "filesAttached",
        files,
      });
    }
  }

  private async handleAttachImage(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: "Attach Images to Chat",
      filters: {
        Images: ["png", "jpg", "jpeg", "gif", "webp"],
      },
    });

    if (!uris || uris.length === 0) {
      return;
    }

    const images = [];
    for (const uri of uris) {
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        const base64 = Buffer.from(data).toString("base64");
        const mimeType = this.getMimeType(uri.fsPath);
        images.push({
          dataUrl: `data:${mimeType};base64,${base64}`,
          filename: uri.fsPath.split(/[/\\]/).pop() || uri.fsPath,
          size: data.byteLength,
        });
      } catch (error) {
        console.error(`Failed to read image ${uri.fsPath}:`, error);
      }
    }

    if (images.length > 0) {
      this.view?.webview.postMessage({
        type: "imagesAttached",
        images,
      });
    }
  }

  private getMimeType(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
    };
    return mimeMap[ext || ""] || "image/png";
  }

  /**
   * Handles opening settings
   */
  private async handleOpenSettings(): Promise<void> {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "@ext:OpenCode.opencode-vscode",
    );
  }

  /**
   * Refreshes the view with current state
   */
  private refreshView(): void {
    this.view?.webview.postMessage({
      type: "initState",
      serverStatus: this.serverManager.getStatus(),
      selectedModel: this.selectedModel,
      selectedAgent: this.selectedAgent,
      currentSessionId: this.currentSessionId,
      todoItems: this.loadPersistedTodos(this.currentSessionId).items,
    });
  }

  /**
   * Generates the HTML content for the webview
   */
  // FORBIDDEN TO REMOVE: React Chat Asset Contract - ensure <div id="root"> and chat.js/chat.css wiring remain intact
  private getHtmlContent(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "webview",
        "shared",
        "dist",
        "chat.css",
      ),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "webview",
        "shared",
        "dist",
        "chat.js",
      ),
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet">
  <title>OpenCode Chat</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Handles file search requests from the webview
   */
  private async handleSearchFiles(query: string) {
    if (!query) {
      this.view?.webview.postMessage({
        type: "fileSearchResults",
        results: [],
      });
      return;
    }

    try {
      // Simple file search using VS Code API
      // Limit to 20 results for performance
      const files = await vscode.workspace.findFiles(
        `**/*${query}*`,
        "**/node_modules/**",
        20,
      );
      const results = files.map((f) => {
        const relativePath = vscode.workspace.asRelativePath(f);
        return {
          path: relativePath,
          name: relativePath.split(/[\\/]/).pop() || relativePath,
        };
      });

      this.view?.webview.postMessage({
        type: "fileSearchResults",
        results: results,
      });
    } catch (error) {
      this.view?.webview.postMessage({
        type: "fileSearchResults",
        results: [],
      });
    }
  }

  /**
   * Handles requests to get OpenCode configuration files
   */
  private async handleGetOpenCodeConfig(fileName?: string) {
    try {
      // Scan all JSON config files
      const configFiles = await this.configFilesProvider.scanFiles();

      // Determine which file to load
      let selectedFile: ConfigFile | undefined;
      if (fileName && configFiles.length > 0) {
        // Load specific file if requested
        selectedFile = configFiles.find(f => f.name === fileName || f.path === fileName);
      } else if (configFiles.length > 0) {
        // Default to first file (alphabetically sorted)
        selectedFile = configFiles[0];
      }

      if (!selectedFile) {
        // No config files found - send empty state with available files list
        this.view?.webview.postMessage({
          type: "opencodeConfigFiles",
          files: configFiles.map(f => ({
            name: f.name,
            path: f.path,
            lastModified: f.lastModified,
            size: f.size,
          })),
          currentFile: null,
        });
        return;
      }

      // Send config data with files list
      this.view?.webview.postMessage({
        type: "opencodeConfig",
        content: selectedFile.content,
        filePath: selectedFile.path,
        fileName: selectedFile.name,
        files: configFiles.map(f => ({
          name: f.name,
          path: f.path,
          lastModified: f.lastModified,
          size: f.size,
        })),
      });
    } catch (error) {
      this.logger.error("Failed to load OpenCode config", error);
      this.view?.webview.postMessage({
        type: "opencodeConfigError",
        error: error instanceof Error ? error.message : "Failed to load configuration",
      });
    }
  }

  /**
   * Handles requests to save OpenCode configuration
   */
  private async handleSaveOpenCodeConfig(content: string, filePath?: string) {
    try {
      if (!filePath) {
        throw new Error("File path is required for saving configuration");
      }

      const result = await this.configFilesProvider.saveFile(filePath, content);

      this.view?.webview.postMessage({
        type: "opencodeConfigSaved",
        success: result.success,
        error: result.error,
        filePath,
      });

      if (result.success) {
        this.logger.info(`OpenCode config saved: ${filePath}`);
      }
    } catch (error) {
      this.logger.error("Failed to save OpenCode config", error);
      this.view?.webview.postMessage({
        type: "opencodeConfigSaved",
        success: false,
        error: error instanceof Error ? error.message : "Failed to save configuration",
        filePath,
      });
    }
  }

  /**
   * Reconciles the selected model against the fetched model catalog.
   *
   * Matching priority:
   * 1) exact providerID + modelID
   * 2) legacy fallback by modelID only when provider is missing/generic and match is unique
   *
   * We intentionally do NOT remap by modelID alone when multiple providers expose the same model.
   */
  /**
   * Resolves the default model from the CLI config
   */
  /**
   * Handles fetching available models from OpenCode
   */
  /**
   * Fetches slash commands from OpenCode SDK and sends them to the webview.
   * Uses a short-lived cache because commands are mostly static during a session.
   */
  /**
   * Handles fetching available agents via the OpenCode SDK and sends the list
   * to the webview. Falls back to a minimal built-in list if the server is
   * unavailable.
   */
  // ─── Per-session settings helpers ────────────────────────────────────────

  /** Returns the full persisted map of all session settings. */
  /**
   * Returns the persisted settings for a specific session.
   * Returns an empty object when no settings have been saved yet.
   */
  /**
   * Merges `partial` into the persisted settings for `sessionId` and saves
   * the updated map back to global state.
   */
  /**
   * Loads the persisted settings for `sessionId` and applies them to the
   * provider's in-memory state (`selectedAgent`, `selectedModel`).
   * Fields that have no saved value are left unchanged.
   */
  /**
   * Fetches MCP server status from the OpenCode SDK and forwards it to the
   * webview. The webview dispatches `SET_MCP_SERVERS` from the `mcpStatus`
   * message. Tool IDs are fetched in parallel so each server row can show its
   * list of tools when the user expands it.
   */
  private async handleGetMcpStatus(): Promise<void> {
    try {
      const client = await this.serverManager.ensureRunning();
      const [mcpRes, toolIdsRes] = await Promise.all([
        client.mcp.status(),
        client.tool.ids().catch(() => ({ data: [] })),
      ]);

      const servers = mcpRes.data ?? {};
      const toolIds: string[] = Array.isArray(toolIdsRes?.data)
        ? toolIdsRes.data
        : [];

      this.view?.webview.postMessage({
        type: "mcpStatus",
        servers,
        toolIds,
      });

      log.info(
        `MCP status sent: ${Object.keys(servers).length} server(s), ${toolIds.length} tool(s)`,
      );
    } catch (err) {
      log.error(
        "handleGetMcpStatus failed",
        {},
        err instanceof Error ? err : undefined,
      );
    }
  }

  /**
   * Fetches LSP server status from the OpenCode SDK and forwards it to the
   * webview. The webview dispatches `SET_LSP_SERVERS` from the `lspStatus`
   * message.
   */
  private async handleGetLspStatus(): Promise<void> {
    try {
      const client = await this.serverManager.ensureRunning();
      const workspaceDir = this.getWorkspaceDirectory();

      // Pass directory parameter to LSP status endpoint so the server
      // can detect language servers for the current workspace
      const res = workspaceDir
        ? await client.lsp.status({ directory: workspaceDir })
        : await client.lsp.status();

      const servers = Array.isArray(res.data) ? res.data : [];

      this.view?.webview.postMessage({
        type: "lspStatus",
        servers,
      });

      log.info(
        `LSP status sent: ${servers.length} server(s)` +
        (workspaceDir ? ` for workspace: ${workspaceDir}` : ""),
      );
    } catch (err) {
      log.error(
        "handleGetLspStatus failed",
        {},
        err instanceof Error ? err : undefined,
      );
    }
  }

  /**
   * Ensures a default primary agent is selected for the current session.
   * Falls back to "build" (the built-in default primary agent) if nothing
   * has been persisted.
   */
  private async syncCLIAgents(): Promise<void> {
    if (!this.selectedAgent) {
      this.selectedAgent = "build";
      console.log("[ChatViewProvider] No agent set, defaulting to 'build'");
    }
  }

  private async handleReviewChanges() {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        await vscode.commands.executeCommand("workbench.view.scm");
        return;
      }

      const cwd = workspaceFolder.uri.fsPath;
      const runGit = (...args: string[]): Promise<string> =>
        new Promise((resolve, reject) => {
          cp.execFile(
            "git",
            args,
            { cwd, maxBuffer: 10 * 1024 * 1024 },
            (err, stdout) => {
              if (err && err.code !== 1) {
                reject(err);
              } else {
                resolve(stdout);
              }
            },
          );
        });

      const diffOutput = await runGit("diff", "HEAD");

      // Include untracked files as pseudo-diffs
      const untrackedFilesOutput = await runGit(
        "ls-files",
        "--others",
        "--exclude-standard",
      );
      const untrackedFiles = untrackedFilesOutput
        .split("\n")
        .filter((f) => f.trim());

      let allDiffs = diffOutput;
      for (const file of untrackedFiles) {
        try {
          const fileUri = vscode.Uri.file(path.join(cwd, String(file)));
          const content = await vscode.workspace.fs.readFile(fileUri);
          const text = new TextDecoder().decode(content);
          const lines = text.split("\n");
          const pseudoDiff = [
            `--- /dev/null`,
            `+++ b/${file.replace(/\\/g, "/")}`,
            `@@ -0,0 +1,${lines.length} @@`,
            ...lines.map((l) => `+${l}`),
            "",
          ].join("\n");
          allDiffs += (allDiffs ? "\n" : "") + pseudoDiff;
        } catch (e: any) {
          console.warn(
            `[ChatViewProvider] Failed to read untracked file ${String(file)}:`,
            e,
          );
        }
      }

      if (allDiffs) {
        const diffFiles = this.parseUnifiedDiff(allDiffs);
        if (diffFiles.length > 0) {
          await vscode.commands.executeCommand("opencode.showDiffReview", {
            files: diffFiles,
          });
          return;
        }
      }

      // Fallback to SCM view if no diffs found
      await vscode.commands.executeCommand("workbench.view.scm");
    } catch (error: any) {
      vscode.window.showErrorMessage(
        `Failed to open changes: ${error.message}`,
      );
    }
  }

  private async getDiffStats(
    filePath: string,
  ): Promise<{ added: number; deleted: number } | undefined> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return undefined;

      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceFolder.uri.fsPath, filePath);
      const cwd = workspaceFolder.uri.fsPath;

      const runGit = (...args: string[]): Promise<string> =>
        new Promise((resolve, reject) => {
          cp.execFile(
            "git",
            args,
            { cwd, maxBuffer: 10 * 1024 * 1024 },
            (err, stdout) => {
              if (err && err.code !== 1) {
                reject(err);
              } else {
                resolve(stdout);
              }
            },
          );
        });

      let diffOutput = "";
      try {
        diffOutput = await runGit("diff", "HEAD", "--", fullPath);
        if (!diffOutput) {
          diffOutput = await runGit("diff", "--cached", "--", fullPath);
        }
        if (!diffOutput) {
          // New file fallback
          try {
            const fileUri = vscode.Uri.file(fullPath);
            const content = await vscode.workspace.fs.readFile(fileUri);
            const text = new TextDecoder().decode(content);
            const lines = text.split("\n").length;
            return { added: lines, deleted: 0 };
          } catch {
            return undefined;
          }
        }
      } catch {
        return undefined;
      }

      if (diffOutput) {
        const diffFiles = this.parseUnifiedDiff(diffOutput);
        if (diffFiles.length > 0) {
          return {
            added: diffFiles[0].added,
            deleted: diffFiles[0].deleted,
          };
        }
      }
      return undefined;
    } catch (error) {
      console.error("[ChatViewProvider] getDiffStats error:", error);
      return undefined;
    }
  }

  private async handleOpenDiff(filePath: string) {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;

      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceFolder.uri.fsPath, filePath);
      const fileUri = vscode.Uri.file(fullPath);
      const cwd = workspaceFolder.uri.fsPath;

      const runGit = (...args: string[]): Promise<string> =>
        new Promise((resolve, reject) => {
          cp.execFile(
            "git",
            args,
            { cwd, maxBuffer: 10 * 1024 * 1024 },
            (err, stdout) => {
              // exit code 1 from git diff means there are changes (not an error)
              if (err && err.code !== 1) {
                reject(err);
              } else {
                resolve(stdout);
              }
            },
          );
        });

      let diffOutput = "";
      try {
        // Try HEAD diff first (tracked modified file)
        diffOutput = await runGit("diff", "HEAD", "--", fullPath);
        if (!diffOutput) {
          // Maybe the file is staged but not committed — try staged diff
          diffOutput = await runGit("diff", "--cached", "--", fullPath);
        }
        if (!diffOutput) {
          // New untracked file: generate a pseudo-diff showing full content as additions
          const content = await vscode.workspace.fs.readFile(fileUri);
          const text = new TextDecoder().decode(content);
          const lines = text.split("\n");
          diffOutput = [
            `--- /dev/null`,
            `+++ b/${filePath.replace(/\\/g, "/")}`,
            `@@ -0,0 +1,${lines.length} @@`,
            ...lines.map((l) => `+${l}`),
          ].join("\n");
        }
      } catch (e) {
        console.warn("[ChatViewProvider] git diff failed:", e);
      }

      if (diffOutput) {
        const diffFiles = this.parseUnifiedDiff(diffOutput);
        if (diffFiles.length > 0) {
          await vscode.commands.executeCommand("opencode.showDiffReview", {
            files: diffFiles,
          });
          return;
        }
      }

      // Absolute fallback: open the file normally
      await vscode.commands.executeCommand("vscode.open", fileUri);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open diff: ${error.message}`);
    }
  }

  private parseUnifiedDiff(diff: string): any[] {
    const files: any[] = [];
    const lines = diff.split("\n");
    let currentFile: any = null;
    let currentHunk: any = null;

    for (const line of lines) {
      if (line.startsWith("--- ") || line.startsWith("+++ ")) {
        const isNew = line.startsWith("+++ ");
        const pathMatch = line.match(/^\+\+\+ (?:b\/)?(.*)$/);
        if (isNew && pathMatch) {
          if (currentFile) files.push(currentFile);
          currentFile = {
            path: pathMatch[1],
            added: 0,
            deleted: 0,
            hunks: [],
          };
        }
        continue;
      }

      if (line.startsWith("@@ ")) {
        if (!currentFile) continue;
        currentHunk = {
          header: line,
          lines: [],
        };
        currentFile.hunks.push(currentHunk);
        continue;
      }

      if (currentHunk) {
        if (line.startsWith("+")) {
          currentFile.added++;
          currentHunk.lines.push(line);
        } else if (line.startsWith("-")) {
          currentFile.deleted++;
          currentHunk.lines.push(line);
        } else if (line.startsWith(" ") || line === "") {
          currentHunk.lines.push(line);
        }
      }
    }

    if (currentFile) files.push(currentFile);
    return files;
  }

  /**
   * Handles opening a file in the editor
   */
  private async handleOpenFile(filePath: string) {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return;

      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceFolder.uri.fsPath, filePath);
      const fileUri = vscode.Uri.file(fullPath);

      await vscode.commands.executeCommand("vscode.open", fileUri);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : JSON.stringify(error);
      vscode.window.showErrorMessage(`Failed to open file: ${msg}`);
    }
  }

  // PROMPT-OWNERSHIP: do not modify — transport-only path
  /**
   * Removes a message from a session queue
   */
  /**
   * Clears the prompt queue for a given session
   */
  /**
   * Executes a session queue sequentially. Only one queue drain can run at a time.
   */
  /**
   * Sends the current budget status to the webview
   */
  private sendBudgetInfo() {
    try {
      // Get actual Copilot quota data from QuotaService
      const quotaData = this.quotaService.cachedData;
      const copilotPlatform = quotaData?.platforms?.find(
        (p) => p.platform === "github-copilot",
      );

      if (!copilotPlatform) {
        return;
      }

      // Extract data from Copilot quota
      const copilotQuota = copilotPlatform.quotas?.[0]; // "Premium" quota
      if (!copilotQuota) {
        return;
      }

      // Parse "usedTotalDisplay" which is in format "X / Y"
      const usedTotalMatch =
        copilotQuota.usedTotalDisplay?.match(/(\d+)\s*\/\s*(\d+)/);
      const totalUsed = usedTotalMatch ? parseInt(usedTotalMatch[1], 10) : 0;
      const monthlyQuota = usedTotalMatch
        ? parseInt(usedTotalMatch[2], 10)
        : 300;

      // Calculate daily allowance
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const daysInMonth = new Date(
        today.getFullYear(),
        today.getMonth() + 1,
        0,
      ).getDate();
      const dayOfMonth = today.getDate();
      const dailyAllowance = Math.ceil(monthlyQuota / daysInMonth);

      // --- NEW ACCURATE USAGE CALCULATION ---
      // Get baseline for today. If none exists, this is the first time we're seeing
      // quota data today, so current totalUsed becomes the baseline.
      let baseline = this.budgeter.getBaselineForDate(todayStr);
      if (baseline === null) {
        this.budgeter.setBaselineForDate(todayStr, totalUsed);
        baseline = totalUsed;
      }

      // Today's usage is the difference between current total and morning's baseline
      const usedToday = Math.max(0, totalUsed - baseline);
      // --------------------------------------

      // Calculate accumulated budget up to today (days passed × daily allowance)
      const budgetSoFar = dayOfMonth * dailyAllowance;

      // Available today = (accumulated budget - baseline) - used today
      // Simplified: accumulated budget - totalUsed
      const availableToday = Math.max(0, budgetSoFar - totalUsed);

      const remainingToday = Math.max(0, dailyAllowance - usedToday);

      // Project monthly usage (current rate × days in month)
      const projectedMonthlyUsage =
        dayOfMonth > 0 ? Math.round((totalUsed / dayOfMonth) * daysInMonth) : 0;

      // Determine warning level
      let warningLevel: "ok" | "warning" | "critical" = "ok";
      if (remainingToday === 0) {
        warningLevel = "critical";
      } else if (remainingToday < dailyAllowance * 0.3) {
        warningLevel = "warning";
      }

      // Generate advice
      const advice: string[] = [];
      if (remainingToday === 0) {
        advice.push(
          "⚠️ You've used your available requests for today. Consider reducing usage to avoid running out this month.",
        );
      } else if (availableToday > dailyAllowance * 2) {
        advice.push(
          `💡 You have ${availableToday} requests available today (including ${availableToday - dailyAllowance
          } unused from previous days)!`,
        );
      } else if (projectedMonthlyUsage > monthlyQuota) {
        advice.push(
          `🚨 At your current rate, you'll exceed your monthly quota! Try to stay under ${dailyAllowance} requests/day.`,
        );
      } else if (warningLevel === "ok") {
        advice.push(
          `✅ You have ${remainingToday} requests available today. Base daily allowance: ${dailyAllowance}.`,
        );
      }

      const budgetInfo = {
        planName: copilotPlatform.accountLabel?.replace(/[()]/g, "") || "Pro",
        monthlyQuota: monthlyQuota,
        usedToday: usedToday,
        dailyAllowance: dailyAllowance,
        availableToday: availableToday,
        remainingToday: remainingToday,
        daysRemaining: daysInMonth - dayOfMonth + 1,
        projectedMonthlyUsage: projectedMonthlyUsage,
        warningLevel: warningLevel,
        advice: advice,
      };

      this.view?.webview.postMessage({
        type: "budgetInfo",
        data: budgetInfo,
      });
    } catch (error) {
      console.error("[ChatViewProvider] Failed to send budget info:", error);
    }
  }

  /**
   * Sends the current queue state to the webview
   */
  public dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
    this.streamService.dispose();
    this.quotaService.dispose();
    this.fileThemeProcessor.unsubscribe(this);
    this.isBootstrappingWebview = false;
    this.hasInitializedWebview = false;
    this.sessionsListRequestVersion = 0;
    this.lastSessionsPayloadFingerprint = undefined;
    this.queueBySessionId.clear();
    this.view = undefined;
  }

  // --- File Icon Theme Sync Methods ---

  /**
   * Called when the file theme processor state changes.
   */
  public notify(state: FileThemeProcessorState): void {
    if (state === "ready") {
      this.sendThemeDataToWebview();
    }
  }

  /**
   * Generates and sends the file theme CSS to the webview.
   */
  private async sendThemeDataToWebview(): Promise<void> {
    if (!this.view) {
      return;
    }

    try {
      const themeData = this.fileThemeProcessor.getThemeData();
      if (!themeData.data || !themeData.themeId) {
        return;
      }

      const cssData = this.cssGenerator.getCss(
        themeData.data,
        themeData.themeId,
        this.view.webview,
      );
      const combinedCss = `${cssData.fontFaceCss}\n${cssData.iconCss}`;
      this.currentThemeCss = combinedCss;

      // Update localResourceRoots to include theme extension paths
      if (themeData.localResourceRoots.length > 0) {
        const roots = [
          this.context.extensionUri,
          ...themeData.localResourceRoots.map((root) => vscode.Uri.file(root)),
        ];
        this.view.webview.options = {
          ...this.view.webview.options,
          localResourceRoots: roots,
        };
      }

      await this.view.webview.postMessage({
        type: "injectThemeCss",
        css: combinedCss,
      });
      console.log("[ChatViewProvider] Injected theme CSS into webview");
    } catch (error) {
      console.error(
        "[ChatViewProvider] Failed to send theme data to webview:",
        error,
      );
    }
  }
}
