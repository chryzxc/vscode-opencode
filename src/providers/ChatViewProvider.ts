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

import type { FileDiff, SessionPromptData } from "@opencode-ai/sdk" with { "resolution-mode": "import" };
import * as cp from "child_process";
import * as path from "path";
import * as vscode from "vscode";
import { ErrorBuilder } from "./chat/ErrorBuilder";
import type { DisplayError } from "./chat/types";
import {
  CssGenerator,
  FileThemeProcessor,
  FileThemeProcessorObserver,
  FileThemeProcessorState,
} from "vscode-file-theme-processor";
import type { TokenUsage } from "../services/GeminiTokenUsageTracker";
import { GeminiTokenUsageTracker } from "../services/GeminiTokenUsageTracker";
import { MessageStreamService } from "../services/MessageStreamService";
import { ModelCapabilitiesService } from "../services/ModelCapabilitiesService";
import { OpencodeServerManager } from "../services/OpencodeServerManager";
import { QuotaService } from "../services/QuotaService";
import { SessionService } from "../services/SessionService";
import { SkillManagerService } from "../services/SkillManagerService";
import { SkillManagementService } from "../services/SkillManagementService";
import {
  SubagentTracker,
  type SubagentUpdatePayload,
} from "../services/SubagentTracker";
import { createLogger } from "../utils/Logger";
import { LoggingCategories } from "../utils/LoggingSchema";
import {
  CompactionManager,
  DiagnosticsLogger,
  HistoryProcessor,
  ModelAndAgentManager,
  PlanManager,
  QueueManager,
  SessionHandler,
  StreamEventHandler,
  StructuredOutputProcessor,
  SubagentPersistence,
  type AssistantHistoryMarker,
  type ChatModelOption,
  type ChatSlashCommand,
  type CompactionBaselineStats,
  type PlanProceedComment,
  type PromptDispatchMode,
  type QueuedPrompt,
  type RecoveredSessionContext,
  type StructuredAssistantOutput
} from "./chat/index";
import type { ConfigFile } from "./ConfigFilesProvider";
import { ConfigFilesProvider } from "./ConfigFilesProvider";
import { PlanViewProvider } from "./PlanViewProvider";

const log = createLogger(LoggingCategories.CHAT_VIEW);

type MessageChangeSummary = {
  messageId: string;
  filesChanged: number;
  added: number;
  deleted: number;
  files: Array<{
    file: string;
    added: number;
    deleted: number;
    diffExcerpt?: {
      header?: string;
      lines: string[];
      added?: number;
      deleted?: number;
    };
  }>;
};

// All types (QueuedPrompt, PromptDispatchMode, SessionSettings, ChatModelOption,
// ChatSlashCommand, PersistedCompactionViewState, CompactionBaselineStats,
// StructuredProgressUpdate, AssistantHistoryMarker, StructuredInteractiveChoice,
// StructuredInteractiveEvent, StructuredAssistantOutput, PlanProceedComment,
// RecoveredSessionContext) and constants (STRUCTURED_RESPONSE_TYPES) are now
// imported from ./chat/index

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

  /** Current chat mode (e.g., 'chat', 'agent', etc.) */
  private currentMode: string = "chat";

  /** ID of the session currently active in the webview (undefined until first bootstrap) */
  private currentSessionId: string | undefined;
  /** Session ID that owns the currently active AI stream. Used to prevent
   *  cross-session event leakage when the user switches sessions while a
   *  response is still streaming from the server. */
  private activeStreamSessionId: string | undefined;
  private currentTodoItems: unknown[] = [];

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

  private normalizeTodoStatus(value: unknown): "pending" | "in_progress" | "completed" | "cancelled" | "failed" {
    const normalized =
      typeof value === "string" ? value.trim().toLowerCase() : "";
    if (
      normalized === "in_progress" ||
      normalized === "completed" ||
      normalized === "cancelled" ||
      normalized === "failed"
    ) {
      return normalized;
    }
    return "pending";
  }

  private normalizeTodoPriority(value: unknown): "high" | "medium" | "low" | undefined {
    const normalized =
      typeof value === "string" ? value.trim().toLowerCase() : "";
    if (normalized === "high" || normalized === "medium" || normalized === "low") {
      return normalized;
    }
    return undefined;
  }

  private stableTodoId(sessionId: string, content: string, index: number): string {
    let hash = 0;
    const basis = `${sessionId}:${index}:${content}`;
    for (let i = 0; i < basis.length; i += 1) {
      hash = ((hash << 5) - hash + basis.charCodeAt(i)) | 0;
    }
    return `sdk-todo:${sessionId}:${index}:${Math.abs(hash)}`;
  }

  private normalizeSdkTodoItems(sessionId: string, rawTodos: unknown[]): unknown[] {
    return rawTodos
      .map((rawTodo, index) => {
        const todo = this.asRecord(rawTodo);
        if (!todo) {
          return undefined;
        }

        const text =
          this.firstNonEmptyString(todo.content, todo.text, todo.description) ?? "";
        if (!text) {
          return undefined;
        }

        const id =
          this.firstNonEmptyString(todo.id) ??
          this.stableTodoId(sessionId, text, index);
        const priority = this.normalizeTodoPriority(todo.priority);

        return {
          id,
          text,
          description: text,
          status: this.normalizeTodoStatus(todo.status),
          sessionId,
          ...(priority ? { priority } : {}),
          source: "sdk",
        };
      })
      .filter((todo): todo is NonNullable<typeof todo> => !!todo);
  }

  private async persistNormalizedTodoItems(
    targetSessionId: string,
    items: unknown[],
  ): Promise<void> {
    await this.context.workspaceState.update(this.getTodoStorageKey(targetSessionId), {
      items,
      lastUpdatedAt: Date.now(),
    });
    this.currentTodoItems = items;
  }

  private postTodoSnapshot(
    sessionId: string,
    items: unknown[],
    source: "sdk-event" | "sdk-hydration" | "sdk-cache",
  ): void {
    this.view?.webview.postMessage({
      type: "todoSnapshot",
      sessionId,
      items,
      source,
    });
  }

  private async refreshSdkTodosForSession(
    sessionId: string | undefined,
    source: "sdk-hydration" | "sdk-cache" = "sdk-hydration",
  ): Promise<void> {
    if (!sessionId) {
      return;
    }

    try {
      const client = await this.serverManager.ensureRunning();
      const response = await client.session.todo({
        path: { id: sessionId },
      });
      const items = this.normalizeSdkTodoItems(
        sessionId,
        Array.isArray(response.data) ? response.data : [],
      );
      await this.persistNormalizedTodoItems(sessionId, items);
      this.postTodoSnapshot(sessionId, items, source);
    } catch (error) {
      const cached = this.loadPersistedTodos(sessionId).items;
      if (cached.length > 0) {
        this.postTodoSnapshot(sessionId, cached, "sdk-cache");
      }
      this.logger.warn("Failed to refresh SDK todo snapshot", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleSdkTodoUpdatedEvent(
    event: unknown,
    fallbackSessionId?: string,
  ): Promise<boolean> {
    const ev = this.asRecord(event);
    if (ev?.type !== "todo.updated") {
      return false;
    }

    const props = this.asRecord(ev.properties) ?? {};
    const sessionId =
      this.firstNonEmptyString(props.sessionID, props.sessionId, fallbackSessionId);
    const rawTodos = Array.isArray(props.todos) ? props.todos : [];
    if (!sessionId) {
      this.logger.warn("Received todo.updated without session id");
      return true;
    }

    const items = this.normalizeSdkTodoItems(sessionId, rawTodos);
    await this.persistNormalizedTodoItems(sessionId, items);
    this.postTodoSnapshot(sessionId, items, "sdk-event");
    return true;
  }

  private clearSessionTodos(sessionId?: string): void {
    this.currentTodoItems = [];
    if (sessionId) {
      this.context.workspaceState.update(this.getTodoStorageKey(sessionId), undefined);
    }
  }

  private handleServerSessionTitleUpdate(sessionId: string, title: string): void {
    if (!title || title === "Untitled chat") return;

    this.sessionService.updateLocalSessionTitle(sessionId, title);

    this.view?.webview.postMessage({
      type: "sessionTitleUpdated",
      sessionId,
      title,
    });

    this.sessionHandler.handleGetSessions().catch((err) => {
      this.logger.warn("Failed to refresh sessions list after title update", { error: String(err) });
    });
  }

  private fetchServerSessionTitle(sessionId: string): void {
    this.sessionsNeedingTitle ??= new Set();
    this.sessionsNeedingTitle.add(sessionId);
  }

  private async triggerSessionTitleGeneration(sessionId: string): Promise<void> {
    const client = await this.serverManager.ensureRunning();
    for (const delay of [3000, 6000, 12000]) {
      await new Promise((r) => setTimeout(r, delay));
      try {
        const resp = await client.session.get({ path: { id: sessionId } });
        const title = resp.data?.title;
        if (title && title !== "Untitled chat" && title !== "New Session") {
          this.handleServerSessionTitleUpdate(sessionId, title);
          return;
        }
      } catch {
        break;
      }
    }

    await this.sessionHandler.handleGetSessions();
  }

  /** Session-scoped queue of prompts awaiting execution */
  private queueBySessionId = new Map<string, QueuedPrompt[]>();
  private sessionsNeedingTitle?: Set<string>;
  private queueItemSequence = 0;

  /** Set of session IDs currently executing their queue */
  private executingQueueSessionIds: Set<string> = new Set();

  private processingSessionIds: Set<string> = new Set();
  private get isProcessingRequest(): boolean {
    return this.getEffectiveProcessingSessionIds().length > 0;
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
  private readonly sessionsWithFileChangeEvidence = new Set<string>();

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
   * @param skillManagementService - Service for managing discovered skills
   * @param modelCapabilitiesService - Optional model capabilities service
   */
  constructor(
    private context: vscode.ExtensionContext,
    private serverManager: OpencodeServerManager,
    private sessionService: SessionService,
    private skillManagementService?: SkillManagementService,
    modelCapabilitiesService?: ModelCapabilitiesService,
  ) {
    this.logger = createLogger("ChatViewProvider");
    this.streamService = new MessageStreamService(serverManager);
    this.quotaService = new QuotaService();
    this.subagentTracker = new SubagentTracker();
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
    this.compactionManager.setGetSelectedModelContextLimit(() => {
      const selected = this.modelAndAgentManager.getSelectedModel();
      const matched = this.modelAndAgentManager
        .getAvailableModels()
        .find(
          (model) =>
            model.providerID === selected.providerID &&
            model.modelID === selected.modelID,
        );
      return matched?.contextLimit;
    });
    this.compactionManager.setGetSelectedModel(() => {
      const selected = this.modelAndAgentManager.getSelectedModel();
      return selected?.providerID && selected?.modelID
        ? { providerID: selected.providerID, modelID: selected.modelID }
        : undefined;
    });
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
      avoidAbortIfProcessing?: boolean;
      forceSendNow?: boolean;
    },
  ): Promise<void> {
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) {
      return;
    }

    const sessionId = await this.resolveQueueSessionId(payload.sessionId);
    if (!sessionId) {
      return;
    }

    const effectiveMode =
      mode === "send-now" &&
      !payload.forceSendNow &&
      this.getEffectiveProcessingSessionIds().includes(sessionId)
        ? "steer"
        : mode;

    // Interactive answer submits are real user turns. The previous question
    // turn should already be finalized when the blocking question event is
    // streamed, so answer submits can bypass queue/steer without aborting it.
    // Other force-send paths can still stop an active request before sending.
    if (
      mode === "send-now" &&
      payload.forceSendNow &&
      !payload.avoidAbortIfProcessing &&
      this.getEffectiveProcessingSessionIds().includes(sessionId)
    ) {
      await this.handleStopRequest(sessionId, {
        suppressWebviewNotification: true,
        skipQueueDrain: true,
      });
    }

    // For normal sends, bypass queue persistence entirely so the queue panel
    // does not show transient "queued" items when there is no active backlog.
    if (effectiveMode === "send-now") {
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

    const promptId = `q-${Date.now()}-${this.queueItemSequence}`;
    this.queueItemSequence += 1;
    const prompt: QueuedPrompt = {
      id: promptId,
      sessionId,
      createdAt: Date.now(),
      text,
      userFacingText: payload.userFacingText,
      files: payload.files,
      contexts: payload.contexts,
      images: payload.images,
      agent: payload.agent,
    };

    this.queueManager.enqueuePrompt(prompt, effectiveMode !== "queue");
    this.sendQueueUpdate(sessionId);

    if (effectiveMode === "queue") {
      return;
    }

    if (this.isProcessingRequest) {
      if (payload.avoidAbortIfProcessing) {
        return;
      }
      if (sessionId === this.currentSessionId) {
        await this.handleStopRequest(sessionId);
      }
      return;
    }

    await this.handleExecuteQueue(sessionId);
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
    const flow = log.startFeatureFlow('ExecuteQueue', { sessionId });

    if (!sessionId || this.executingQueueSessionIds.has(sessionId)) {
      if (this.executingQueueSessionIds.has(sessionId)) {
        log.endFeatureFlow(flow, { status: 'skipped', reason: 'Queue already executing' });
      } else {
        log.endFeatureFlow(flow, { status: 'failed', reason: 'No sessionId provided' });
      }
      return;
    }

    log.featureStep(flow, 'queue_execution_started');
    this.executingQueueSessionIds.add(sessionId);
    this.view?.webview.postMessage({
      type: "queueExecutionStarted",
      sessionId,
    });

    try {
      await this.queueManager.handleExecuteQueue({ sessionId });
      log.endFeatureFlow(flow, { status: 'completed', sessionId });
    } catch (error) {
      log.error('Failed to execute queue', { sessionId }, error as Error);
      log.endFeatureFlow(flow, { status: 'failed', error: String(error) });
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
    const sessionIds = new Set(
      sessions
        .map((session: any) => this.firstNonEmptyString(session?.id))
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );
    const topLevelSessions = sessions.filter((session: any) => {
      const parentSessionId = this.firstNonEmptyString(
        session?.parentSessionId,
        session?.parentID,
        session?.parentId,
      );
      const sessionId = this.firstNonEmptyString(session?.id);
      if (!parentSessionId) {
        return true;
      }
      if (sessionId && parentSessionId === sessionId) {
        return true;
      }
      return !sessionIds.has(parentSessionId);
    });
    const sessionsPayload = topLevelSessions.map((session: any) => ({
      id: session.id,
      title: session.title || session.id,
      createdAt:
        (typeof session.createdAt === "number" && Number.isFinite(session.createdAt)
          ? session.createdAt
          : typeof session.time?.created === "number" && Number.isFinite(session.time.created)
            ? session.time.created
            : undefined),
      updatedAt:
        (typeof session.updatedAt === "number" && Number.isFinite(session.updatedAt)
          ? session.updatedAt
          : typeof session.time?.updated === "number" && Number.isFinite(session.time.updated)
            ? session.time.updated
            : undefined),
      parentSessionId: this.firstNonEmptyString(
        session.parentSessionId,
        session.parentID,
        session.parentId,
      ),
    }));

    this.view?.webview.postMessage({
      type: "sessionsList",
      sessions: sessionsPayload,
    });
  }

  private async handleGetSubagentConversation(message: {
    subagentId?: string;
    childSessionId?: string;
    parentSessionId?: string;
    parentMessageId?: string;
    status?: string;
    latestActivity?: string;
  }): Promise<void> {
    const subagentId = this.firstNonEmptyString(message?.subagentId);
    const childSessionId = this.firstNonEmptyString(message?.childSessionId);
    const parentSessionId = this.firstNonEmptyString(
      message?.parentSessionId,
      this.currentSessionId,
    );
    const parentMessageId = this.firstNonEmptyString(message?.parentMessageId);
    if (!subagentId || !childSessionId || !parentSessionId || !parentMessageId) {
      return;
    }

    try {
      const rawMessages = await this.sessionService.getMessages(childSessionId);
      const processedMessages = await this.processHistoryMessages(
        Array.isArray(rawMessages) ? rawMessages : [],
        childSessionId,
      );

      const conversationEvents = this.buildAssistantConversationEvents(
        processedMessages,
      );
      if (conversationEvents.length === 0) {
        return;
      }

      const latestConversationText =
        conversationEvents[conversationEvents.length - 1]?.text || "";

      this.view?.webview.postMessage({
        type: "subagentUpdate",
        detailsById: {
          [subagentId]: {
            id: subagentId,
            parentSessionId,
            parentMessageId,
            childSessionId,
            status:
              this.firstNonEmptyString(message?.status, "done") || "done",
            latestActivity:
              this.firstNonEmptyString(
                message?.latestActivity,
                latestConversationText.slice(0, 120),
                "Completed",
              ) || "Completed",
            references: [],
            thinkingEvents: [],
            progressEvents: [],
            timelineEvents: [],
            conversationEvents,
          },
        },
      });
    } catch (error) {
      this.logger.warn("Failed to hydrate subagent conversation", {
        subagentId,
        childSessionId,
        error: (error as Error)?.message || String(error),
      });
    }
  }

  private buildAssistantConversationEvents(
    messages: any[],
  ): Array<{
    id: string;
    role: string;
    kind: "message" | "reasoning" | "step";
    text: string;
    createdAt: number;
    messageID?: string;
    partID?: string;
  }> {
    const events: Array<{
      id: string;
      role: string;
      kind: "message" | "reasoning" | "step";
      text: string;
      createdAt: number;
      messageID?: string;
      partID?: string;
    }> = [];

    const append = (
      role: string,
      kind: "message" | "reasoning" | "step",
      textRaw: string,
      createdAt: number,
      messageID?: string,
      partID?: string,
    ) => {
      const text = typeof textRaw === "string" ? textRaw.trim() : "";
      if (!text) {
        return;
      }
      events.push({
        id: `${messageID || "msg"}:${kind}:${events.length}`,
        role: role || "assistant",
        kind,
        text,
        createdAt,
        messageID,
        partID,
      });
    };

    const getCreatedAt = (message: any): number => {
      const info = this.asRecord(message?.info) || {};
      const infoTime = this.asRecord(info.time) || {};
      const msgTime = this.asRecord(message?.time) || {};
      const candidates = [
        infoTime.created,
        infoTime.updated,
        infoTime.completed,
        msgTime.created,
        msgTime.updated,
        msgTime.completed,
        message?.createdAt,
        message?.created,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "number" && Number.isFinite(candidate)) {
          return candidate;
        }
      }
      return Date.now();
    };

    for (const message of Array.isArray(messages) ? messages : []) {
      const info = this.asRecord(message?.info) || {};
      const role = this.firstNonEmptyString(info.role, message?.role, "assistant");
      if ((role || "").toLowerCase() !== "assistant") {
        continue;
      }
      const messageID = this.firstNonEmptyString(
        info.id,
        message?.id,
        message?.messageID,
      );
      const createdAt = getCreatedAt(message);
      const content = this.extractMessageBodyText(message);
      if (content) {
        append("assistant", "message", content, createdAt, messageID);
      }

      if (Array.isArray(message?.reasoningEvents)) {
        message.reasoningEvents.forEach((event: any, index: number) => {
          const text = this.firstNonEmptyString(event?.text);
          if (!text) {
            return;
          }
          append(
            "assistant",
            "reasoning",
            text,
            typeof event?.createdAt === "number" ? event.createdAt : createdAt,
            messageID,
            this.firstNonEmptyString(event?.partID, event?.partId),
          );
        });
      }

      const steps = Array.isArray(message?.steps)
        ? message.steps
        : Array.isArray(message?.progressEvents)
          ? message.progressEvents
          : [];
      steps.forEach((step: any) => {
        const title = this.firstNonEmptyString(step?.title);
        const meta = this.firstNonEmptyString(step?.meta);
        const status = this.firstNonEmptyString(step?.status);
        const stepText = [title, meta, status].filter(Boolean).join(" - ");
        if (!stepText) {
          return;
        }
        append(
          "assistant",
          "step",
          stepText,
          typeof step?.createdAt === "number" ? step.createdAt : createdAt,
          messageID,
          this.firstNonEmptyString(step?.partID, step?.partId),
        );
      });
    }

    return events;
  }

  /**
   * Wrapper: Load session
   * Loads messages from service and sends to webview
   */
  private async handleLoadSession(sessionId: string): Promise<void> {
    const flow = log.startFeatureFlow('LoadSession', { sessionId });

    if (!sessionId) {
      log.endFeatureFlow(flow, { status: 'failed', reason: 'No sessionId provided' });
      return;
    }

    try {
      // CRITICAL: Switch the active session in SessionService
      // This updates the service's internal state and persists it
      await this.sessionService.switchSession(sessionId);
      this.currentSessionId = sessionId;
      this.subagentTracker.setActiveSession(sessionId);
      // Clear in-memory todo cache to avoid cross-session leakage
      this.clearSessionTodos(sessionId);

      // Restore per-session agent / model / thinking selections
      await this.modelAndAgentManager.applySessionSettings(sessionId);

      // ============================================================================
      // CRITICAL: Message Ordering for Session Switch
      // ============================================================================
      //
      // PROBLEM: When switching sessions, if we send initState BEFORE chatHistory,
      // the webview updates its currentSessionId to the new session ID. When the
      // chatHistory message arrives later, the webview compares:
      //   currentState.currentSessionId === chatHistorySessionId
      // Both are the new session ID, so it thinks it's NOT a session switch and
      // doesn't properly reload the conversation.
      //
      // SOLUTION: Send chatHistory BEFORE initState so:
      // 1. chatHistory arrives with NEW session ID while webview still has OLD session ID
      // 2. Webview detects the mismatch and properly handles session switch
      // 3. initState arrives after and updates the session ID for subsequent operations
      //
      // See: webview/shared/src/chat/lib/messageHandler.ts case "chatHistory"
      // Lines 8274-8278: Session switch detection logic
      // ============================================================================

      // Step 1: Load and process messages for the new session
      const rawMessages = await this.sessionService.getMessages(sessionId);

      this.logger.info('[handleLoadSession] Fetched raw messages', {
        sessionId,
        rawCount: rawMessages?.length || 0,
        isRawMessagesArray: Array.isArray(rawMessages)
      });

      const messages = Array.isArray(rawMessages)
        ? await this.processHistoryMessages(rawMessages, sessionId)
        : [];

      this.logger.info('[handleLoadSession] Processed messages', {
        sessionId,
        processedCount: messages.length,
        willSendToWebview: true
      });

      // Step 2: Sync subagent state for the new session
      const subagentSnapshotPayload =
        await this.subagentPersistence.syncSubagentSnapshotForSession(
          sessionId,
          messages,
        );
      await this.compactionManager.sendPersistedCompactionViewState(sessionId);

      // Step 3: Log diagnostic information for debugging
      const planMessages = messages.filter((m: any) => m?.plan);
      log.debug('Sending messages to webview', {
        totalMessages: messages.length,
        planMessagesCount: planMessages.length,
        samplePlanMessage: planMessages[0] ? {
          hasPlan: !!planMessages[0].plan,
          planKeys: planMessages[0].plan ? Object.keys(planMessages[0].plan) : [],
          planFile: planMessages[0].plan?.file,
          planValue: planMessages[0].plan
        } : null
      });

      // Step 4: Send chatHistory FIRST (before initState)
      // This ensures the webview can detect the session switch properly
      this.view?.webview.postMessage({
        type: "chatHistory",
        sessionId: sessionId,
        messages: messages,
        processingSessionIds: this.getEffectiveProcessingSessionIds(),
      });
      this.view?.webview.postMessage({
        type: "subagentSnapshot",
        ...subagentSnapshotPayload,
      });

      // Step 5: NOW send initState with the updated session ID
      // This comes AFTER chatHistory so the session switch is already detected
      this.view?.webview.postMessage({
        type: "initState",
        serverStatus: this.serverManager.getStatus(),
        serverError: this.serverManager.getStatus() === "error" ? this.serverManager.getLastError() : undefined,
        selectedModel: this.modelAndAgentManager.getSelectedModel(),
        selectedAgent: this.modelAndAgentManager.getSelectedAgent(),
        serverVersion: this.serverManager.getVersion(),
        workspaceRoot: this.getWorkspaceDirectory(),
        currentSessionId: this.currentSessionId,
        processingSessionIds: this.getEffectiveProcessingSessionIds(),
        todoItems: [],
      });
      void this.refreshSdkTodosForSession(this.currentSessionId);

      const sessionThinkingLevel =
        this.modelAndAgentManager.getEffectiveThinkingLevel(sessionId);
      if (sessionThinkingLevel) {
        this.view?.webview.postMessage({
          type: "thinkingLevelUpdate",
          level: sessionThinkingLevel,
        });
      }

      const selectedOnLoad = this.modelAndAgentManager.getSelectedModel();
      const immediateOnLoad = this.resolveCapabilityForModel(
        selectedOnLoad?.providerID ?? "",
        selectedOnLoad?.modelID ?? "",
        null,
      );
      if (immediateOnLoad) {
        this.view?.webview.postMessage({
          type: "modelCapabilityUpdate",
          capability: immediateOnLoad,
        });
      }

      // Fire-and-forget: fetch and broadcast current model capabilities on session load
      void this.modelCapabilitiesService
        .getCapabilities(
          this.modelAndAgentManager.getSelectedModel()?.providerID ?? "",
          this.modelAndAgentManager.getSelectedModel()?.modelID ?? "",
        )
        .then((capability) => {
          const merged = this.resolveCapabilityForModel(
            this.modelAndAgentManager.getSelectedModel()?.providerID ?? "",
            this.modelAndAgentManager.getSelectedModel()?.modelID ?? "",
            capability,
          );
          if (merged) {
            this.view?.webview.postMessage({
              type: "modelCapabilityUpdate",
              capability: merged,
            });
          }
        })
        .catch(() => {
          // Minimal failure tracking for session-load capability fetches
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

      // Update the list selection
      await this.handleGetSessions();
    } catch (error) {
      log.error('Failed to load session', { sessionId }, error as Error);
      vscode.window.showErrorMessage(`Failed to load session: ${error}`);
      log.endFeatureFlow(flow, { status: 'failed', error: String(error) });
    } finally {
      // always finalize flow (was previously guarded by !flow.result)
      log.endFeatureFlow(flow, { status: 'completed', sessionId });
    }
  }

  /**
   * Wrapper: Delete session
   * Handles session deletion with fallback to create new session
   */
  private async handleDeleteSession(sessionId: string): Promise<void> {
    const flow = log.startFeatureFlow('DeleteSession', { sessionId });

    if (!sessionId) {
      log.endFeatureFlow(flow, { status: 'failed', reason: 'No sessionId provided' });
      return;
    }

    try {
      log.featureStep(flow, 'deleting_session');
      await this.sessionService.deleteSession(sessionId);
      await this.clearPersistedSubagentSnapshot(sessionId);
      await this.compactionManager.clearPersistedCompactionViewState(sessionId);

      const currentSession = await this.sessionService.getCurrentSession();
      if (!currentSession) {
        await this.sessionService.createNewSession();
      }

      await this.handleGetSessions();
      log.endFeatureFlow(flow, { status: 'completed', sessionId });
    } catch (error) {
      log.error('Failed to delete session', { sessionId }, error as Error);
      vscode.window.showErrorMessage(`Failed to delete session: ${error}`);
      log.endFeatureFlow(flow, { status: 'failed', error: String(error) });
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
    this.logger.info('[handleGetCommands] Starting to fetch skills from OpenCode server');

    try {
      // Ensure server is running
      this.logger.info('[handleGetCommands] Ensuring server is running...');
      const client = await this.serverManager.ensureRunning();
      if (!client) {
        this.logger.error('[handleGetCommands] Failed to get client even after ensureRunning()');
        this.sendCommandsToWebview([]);
        return;
      }

      this.logger.info('[handleGetCommands] Server is running, client available');

      // Get the current model and provider
      let currentModel = this.selectedModel?.modelID
        ? { provider: this.selectedModel.providerID, model: this.selectedModel.modelID }
        : undefined;
      if (!currentModel) {
        this.logger.warn('[handleGetCommands] No current model selected, using defaults');
        currentModel = { provider: 'anthropic', model: 'claude-sonnet-4-6' };
      }

      const commands: Array<{ name: string; description?: string; source?: string }> = [];

      try {
        const commandResponse = await client.command.list();
        const commandItems = Array.isArray(commandResponse.data)
          ? commandResponse.data
          : [];
        for (const item of commandItems) {
          const rawName = this.firstNonEmptyString(item?.name);
          const name = rawName?.replace(/^\//, "");
          if (!name) {
            continue;
          }
          commands.push({
            name,
            description: this.firstNonEmptyString(item?.description),
            source: "command",
          });
        }
      } catch (error) {
        this.logger.warn('[handleGetCommands] Failed to load command catalog', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      this.logger.info('[handleGetCommands] Fetching tools from OpenCode server', {
        provider: currentModel.provider,
        model: currentModel.model
      });

      // Use the OpenCode SDK client to get the list of available tools
      const toolsResponse = await client.tool.list({
        query: {
          provider: currentModel.provider,
          model: currentModel.model
        }
      });

      if (!toolsResponse.data) {
        this.logger.warn('[handleGetCommands] No tools data returned from server');
        this.sendCommandsToWebview(commands);
        return;
      }

      const tools = toolsResponse.data;
      this.logger.info('[handleGetCommands] Fetched tools from server', {
        toolCount: tools.length,
        toolIds: tools.map(t => t.id),
        allTools: JSON.stringify(tools.map(t => ({
          id: t.id,
          hasDescription: !!t.description,
          descLength: t.description?.length || 0
        })))
      });

      // Find the skill tool
      const skillTool = tools.find(tool => tool.id === 'skill');

      this.logger.info('[handleGetCommands] Looking for skill tool', {
        found: !!skillTool,
        hasDescription: !!skillTool?.description,
        descPreview: skillTool?.description?.substring(0, 200)
      });

      if (skillTool && skillTool.description) {
        // Parse the available skills from the skill tool's description
        // Format: ## Available Skills\n- **skill-name**: description
        // Show ALL skills in slash commands (even disabled ones) for manual use
        // The config controls which skills OpenCode auto-loads, not what's visible

        // Normalize line endings to handle \r\n (Windows) and \r (old Mac)
        const normalizedDescription = skillTool.description.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = normalizedDescription.split('\n');
        this.logger.info('[handleGetCommands] Splitting description into lines', {
          lineCount: lines.length,
          firstLines: lines.slice(0, 5),
          fullDescription: skillTool.description.substring(0, 500)
        });

        let inAvailableSection = false;
        let currentSkill: { name: string; description: string; source?: string } | null = null;

        for (const line of lines) {
          if (line.includes('## Available Skills') || line.includes('Available Skills')) {
            inAvailableSection = true;
            continue;
          }

          if (inAvailableSection) {
            // Match format: - **skill-name**: description
            const match = line.match(/^-\s*\*\*([^*]+)\*\*:\s*(.+)$/);
            if (match) {
              // Save previous skill if any
              if (currentSkill) {
                commands.push(currentSkill);
              }
              // Start new skill
              currentSkill = {
                name: match[1].trim(),
                description: match[2].trim(),
                source: "skill",
              };
            } else if (line.startsWith('##') || line.startsWith('---')) {
              // End of skills section - save last skill
              if (currentSkill) {
                commands.push(currentSkill);
                currentSkill = null; // Clear to prevent double-push
              }
              break;
            } else if (line.trim().startsWith('- ') && currentSkill) {
              // Continuation of description - remove the '- ' prefix
              currentSkill.description += '\n' + line.trim().substring(2);
            } else if (line.trim().length > 0 && currentSkill) {
              // Continuation of description (lines without '- ' prefix)
              currentSkill.description += '\n' + line.trim();
            }
          }
        }

        // Don't forget to push the last skill if we didn't hit a break condition
        if (currentSkill) {
          commands.push(currentSkill);
        }

        this.logger.info('[handleGetCommands] Parsed ALL skills from skill tool', {
          count: commands.length,
          skills: commands.map(c => ({ name: c.name, descLength: c.description?.length || 0 }))
        });
      } else {
        this.logger.warn('[handleGetCommands] No skill tool found or no description');
      }

      // If no skills found, do NOT fall back to all tools
      // This prevents showing system tools (edit, read, bash, etc.) as if they were skills
      if (commands.length === 0) {
        this.logger.warn('[handleGetCommands] No skills found, sending empty command list');
      }

      this.logger.info('[handleGetCommands] Sending commands to webview', {
        commandCount: commands.length,
        commands: commands.slice(0, 10).map(c => ({ name: c.name, desc: c.description }))
      });

      if (commands.length === 0) {
        this.logger.warn('[handleGetCommands] No commands found - this might indicate:', {
          reasons: [
            'Server not started or not ready',
            'No skills available in current config',
            'Skills not discovered by server',
            'Tool list API changed'
          ],
          suggestion: 'Check OpenCode server status and ensure skills are enabled in config'
        });
      }

      // Send the commands to the webview
      this.sendCommandsToWebview(commands);
    } catch (error) {
      this.logger.error('[handleGetCommands] Failed to load commands', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });

      // Still send empty commands array to frontend even on error
      this.sendCommandsToWebview([]);
    }
  }

  /**
   * Send commands to the webview
   * Centralized method for sending slash commands to the chat interface
   */
  private sendCommandsToWebview(commands: Array<{ name: string; description?: string; source?: string }>): void {
    // CRITICAL: Check if view is available before sending message
    if (!this.view) {
      this.logger.error('[sendCommandsToWebview] Cannot send commands - webview is not available');
      return;
    }

    if (!this.view.webview) {
      this.logger.error('[sendCommandsToWebview] Cannot send commands - webview.webview is not available');
      return;
    }

    const message = {
      type: "commandsList",
      commands: commands,
    };

    this.logger.info('[sendCommandsToWebview] Posting message to webview', {
      messageType: message.type,
      commandsCount: message.commands.length,
      commandsPreview: message.commands.slice(0, 3).map(c => c.name)
    });

    try {
      const result = this.view.webview.postMessage(message);
      this.logger.info('[sendCommandsToWebview] postMessage returned', {
        success: result,
        result: String(result)
      });

      if (!result) {
        this.logger.error('[sendCommandsToWebview] postMessage returned false - webview may not be ready');
      }
    } catch (postError) {
      this.logger.error('[sendCommandsToWebview] postMessage threw an error', {
        error: postError instanceof Error ? postError.message : String(postError),
        stack: postError instanceof Error ? postError.stack : undefined
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
    intro?: string;
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
    const options: {
      auto?: boolean;
      threshold?: number;
      baselineStats?: CompactionBaselineStats;
    } = {};
    if (baselineStats) {
      options.threshold = Object.values(baselineStats).reduce((sum, val) => sum + val, 0);
      options.baselineStats =
        this.compactionManager.normalizeCompactionBaselineStats(baselineStats);
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
  private async enrichMessageWithPlan(message: any): Promise<any> {
    return await this.structuredOutputProcessor.enrichMessageWithPlan(message);
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

    // Interactive answers are just normal user turns now. Question responses
    // are final assistant messages; there is no interactive-wait handoff.
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
    await this.subagentPersistence.persistSubagentLiveState(sessionId, payload as SubagentUpdatePayload);
  }

  private buildSubagentPayloadFromMessage(message: any, sessionId?: string): any {
    return this.subagentPersistence.buildSubagentPayloadFromMessage(message, sessionId ?? '');
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
      thinkingByModel?: Record<string, string>;
    },
  ): Promise<void> {
    const partial: any = {};
    if (settings.providerID) partial.providerID = settings.providerID;
    if (settings.modelID) partial.modelID = settings.modelID;
    if (settings.agent) partial.agent = settings.agent;
    if ("thinkingLevel" in settings) partial.thinkingLevel = settings.thinkingLevel;
    if (settings.thinkingByModel) partial.thinkingByModel = settings.thinkingByModel;
    return this.modelAndAgentManager.persistSessionSettings(sessionId, partial);
  }

  private async resolvePromptVariant(sessionId: string): Promise<string | undefined> {
    return this.modelAndAgentManager.resolvePromptVariant(sessionId);
  }

  private resolveCapabilityForModel(
    providerID: string,
    modelID: string,
    capability?: { reasoning?: boolean; variants?: string[] } | null,
  ): { reasoning: boolean; variants?: string[] } | null {
    const knownModel = this.modelAndAgentManager
      .getAvailableModels()
      .find((m) => m.providerID === providerID && m.modelID === modelID);

    const knownVariants = Array.isArray(knownModel?.variants)
      ? knownModel.variants
      : [];
    const incomingVariants = Array.isArray(capability?.variants)
      ? capability!.variants!
      : [];
    const variants = incomingVariants.length > 0 ? incomingVariants : knownVariants;
    const reasoning =
      Boolean(capability?.reasoning) ||
      Boolean(knownModel?.reasoning) ||
      variants.length > 0;

    if (!knownModel && !capability) {
      return null;
    }

    return {
      reasoning,
      variants: variants.length > 0 ? variants : undefined,
    };
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
  private getEffectiveProcessingSessionIds(): string[] {
    const ids = new Set(this.processingSessionIds);
    if (this.activeStreamSessionId && this.processingSessionIds.size > 0) {
      ids.add(this.activeStreamSessionId);
    }
    for (const sessionId of this.subagentTracker.getActiveProcessingSessionIds()) {
      ids.add(sessionId);
    }
    return Array.from(ids);
  }

  private isSessionEffectivelyProcessing(sessionId: string | undefined): boolean {
    return !!sessionId && this.getEffectiveProcessingSessionIds().includes(sessionId);
  }

  private sendProcessingSessionsUpdate(): void {
    this.view?.webview.postMessage({
      type: "SET_PROCESSING_SESSIONS",
      payload: this.getEffectiveProcessingSessionIds(),
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

    const webviewOptions = {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [this.context.extensionUri],
    };
    webviewView.webview.options = webviewOptions;

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      const { type } = message;

      // Log all UI interactions for debugging
      this.logger.logUIInteraction('ChatView', type, message.type, message as Record<string, unknown>);

      switch (type) {
        case "ready": {
          this.logger.debug(`${LoggingCategories.UI_INTERACTION} Webview ready`, {
            viewType: 'chat',
          });

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
              serverError: this.serverManager.getStatus() === "error" ? this.serverManager.getLastError() : undefined,
              selectedModel: this.selectedModel,
              selectedAgent: this.selectedAgent,
              serverVersion: this.serverManager.getVersion(),
              workspaceRoot: this.getWorkspaceDirectory(),
              currentSessionId: this.currentSessionId,
              processingSessionIds: this.getEffectiveProcessingSessionIds(),
              todoItems: [],
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
              serverError: this.serverManager.getStatus() === "error" ? this.serverManager.getLastError() : undefined,
              selectedModel: this.selectedModel,
              selectedAgent: this.selectedAgent,
              serverVersion: this.serverManager.getVersion(),
              workspaceRoot: this.getWorkspaceDirectory(),
              currentSessionId: this.currentSessionId,
              processingSessionIds: this.getEffectiveProcessingSessionIds(),
            });
            void this.refreshSdkTodosForSession(this.currentSessionId);

            // Restore the session-specific thinking level (separate message type)
            const bootstrapThinkingLevel = currentSession
              ? this.modelAndAgentManager.getEffectiveThinkingLevel(currentSession.id)
              : this.modelAndAgentManager.getEffectiveThinkingLevel();
            if (bootstrapThinkingLevel) {
              this.view?.webview.postMessage({
                type: "thinkingLevelUpdate",
                level: bootstrapThinkingLevel,
              });
            }

            const immediateOnBootstrap = this.resolveCapabilityForModel(
              this.selectedModel?.providerID ?? "",
              this.selectedModel?.modelID ?? "",
              null,
            );
            if (immediateOnBootstrap) {
              this.view?.webview.postMessage({
                type: "modelCapabilityUpdate",
                capability: immediateOnBootstrap,
              });
            }
            // Fire-and-forget: fetch and broadcast current model capabilities on bootstrap (unconditional)
            void this.modelCapabilitiesService
              .getCapabilities(
                this.selectedModel?.providerID ?? "",
                this.selectedModel?.modelID ?? "",
              )
              .then((capability) => {
                const merged = this.resolveCapabilityForModel(
                  this.selectedModel?.providerID ?? "",
                  this.selectedModel?.modelID ?? "",
                  capability,
                );
                if (merged) {
                  this.view?.webview.postMessage({
                    type: "modelCapabilityUpdate",
                    capability: merged,
                  });
                }
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
                sessionId: currentSession.id,
                messages: messages,
                processingSessionIds: this.getEffectiveProcessingSessionIds(),
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
          const correlationId = this.logger.startFeatureFlow('send-message', {
            hasFiles: message.files?.length > 0,
            hasImages: message.images?.length > 0,
            textLength: message.text?.length,
          });

          this.logger.info(`${LoggingCategories.UI_INTERACTION} User initiated message send`, {
            correlationId,
            hasFiles: message.files?.length > 0,
            hasImages: message.images?.length > 0,
            textLength: message.text?.length,
          });

          try {
            const isInteractiveSubmit = message?.interactiveSubmit === true;
            await this.schedulePromptDispatch("send-now", {
              sessionId: message.sessionId,
              text: message.text,
              files: message.files,
              contexts: message.contexts,
              images: message.images,
              agent: message.agent,
              // Interactive popover submits should behave like a normal direct
              // user send, even if stale processing flags briefly linger from
              // the preceding question turn.
              forceSendNow: isInteractiveSubmit,
              avoidAbortIfProcessing: isInteractiveSubmit,
            });
            this.logger.endFeatureFlow(correlationId, { success: true });
          } catch (err) {
            this.logger.error(
              `${LoggingCategories.UI_INTERACTION} Failed to send message`,
              { correlationId, error: (err as Error).message }
            );
            this.logger.endFeatureFlow(correlationId, { success: false });
          }
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
        case "newSession":
        case "createSession": {
          const correlationId = this.logger.startFeatureFlow('create-session');

          this.logger.info(`${LoggingCategories.UI_INTERACTION} User creating new session`, {
            correlationId,
          });

          try {
            const createdSession = await this.sessionService.createNewSession();
            this.currentSessionId = createdSession.id;
            this.selectedAgent = "build";
            this.logger.info(`${LoggingCategories.UI_INTERACTION} New session created`, {
              correlationId,
              sessionId: createdSession.id,
            });
            this.logger.endFeatureFlow(correlationId, {
              success: true,
              sessionId: createdSession.id,
            });

            // Clear in-memory todo cache for the newly created session.
            this.clearSessionTodos();
            this.subagentTracker.resetForSession(createdSession.id);
            this.sendQueueUpdate(createdSession.id);

            // Always use "build" as the default agent for new sessions.
            // Apply this before refresh so the UI updates immediately.
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

            // Non-blocking follow-up work:
            // - Persist per-session defaults
            // - Clear persisted subagent snapshot
            // - Refresh sessions list from server
            void (async () => {
              try {
                await Promise.all([
                  this.clearPersistedSubagentSnapshot(createdSession.id),
                  this.persistSessionSettings(createdSession.id, {
                    agent: "build",
                  }),
                ]);
                await this.handleGetSessions(); // Update list
              } catch (backgroundError) {
                this.logger.warn("Post-create session sync failed", {
                  sessionId: createdSession.id,
                  error:
                    backgroundError instanceof Error
                      ? backgroundError.message
                      : String(backgroundError),
                });
              }
            })();
          } catch (error) {
            this.logger.error(
              `${LoggingCategories.UI_INTERACTION} Failed to create session`,
              { correlationId, error: (error as Error).message }
            );
            this.logger.endFeatureFlow(correlationId, { success: false });
          }
          break;
        }
        case "viewPlan": {
          this.logger.logUIInteraction('ChatView', 'view-plan', message.plan, {
            planFile: message.plan,
          });

          this.logger.info(`${LoggingCategories.UI_INTERACTION} User viewing plan`, {
            planFile: message.plan,
          });

          if (message.plan) {
            await this.handleViewPlan(message.plan);
          }
          break;
        }
        case "openDiff": {
          this.handleOpenDiff(message.file);
          break;
        }
        case "copyToClipboard": {
          const text = this.firstNonEmptyString(message.text);
          if (!text) {
            break;
          }
          await vscode.env.clipboard.writeText(text);
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
        case "reviewMessageChanges": {
          const files = Array.isArray(message.files)
            ? message.files
                .map((file: unknown) => this.firstNonEmptyString(file))
                .filter((file: string | undefined): file is string => Boolean(file))
            : undefined;
          this.handleReviewChanges(files);
          break;
        }
        case "undoMessageChanges": {
          await this.handleUndoMessageChanges(
            this.firstNonEmptyString(message.messageId),
            this.firstNonEmptyString(message.sessionId),
          );
          break;
        }
        case "searchFiles":
        case "getMentions": {
          await this.handleMentions(message.query);
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
          const knownModels = this.modelAndAgentManager.getAvailableModels();
          let providerName: string | undefined = incoming.providerName;
          if (!providerName) {
            // Try to resolve from discovered models if available.
            const found = knownModels.find(
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
          await this.modelAndAgentManager.setSelectedModel(this.selectedModel);

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

          const selectedModelOption = knownModels.find(
            (m) =>
              m.providerID === this.selectedModel.providerID &&
              m.modelID === this.selectedModel.modelID,
          );
          if (selectedModelOption) {
            // Prefer immediate SDK-derived capability from provider.list() so
            // the UI remains stable even when network fallback lookups fail.
            const immediateCapability = this.resolveCapabilityForModel(
              this.selectedModel.providerID,
              this.selectedModel.modelID,
              {
                reasoning: Boolean(selectedModelOption.reasoning),
                variants: Array.isArray(selectedModelOption.variants)
                  ? selectedModelOption.variants
                  : [],
              },
            );
            this.view?.webview.postMessage({
              type: "modelCapabilityUpdate",
              capability: immediateCapability,
            });
          }

          // Fetch and broadcast model capabilities (fire-and-forget).
          void this.modelCapabilitiesService
            .getCapabilities(
              this.selectedModel.providerID,
              this.selectedModel.modelID,
            )
            .then(async (capability) => {
              this.capabilityFetchFailureCount = 0;
              // Broadcast capability update only when we have a real payload.
              // Avoid replacing a valid capability with null on transient misses.
              const merged = this.resolveCapabilityForModel(
                this.selectedModel.providerID,
                this.selectedModel.modelID,
                capability,
              );
              if (merged) {
                this.view?.webview.postMessage({
                  type: "modelCapabilityUpdate",
                  capability: merged,
                });
              }

              // Check for stale persisted thinking level and clear if it's no
              // longer supported by the newly selected model.
              try {
                const selectedLevel = this.modelAndAgentManager.getEffectiveThinkingLevel(
                  this.currentSessionId ?? undefined,
                );
                this.view?.webview.postMessage({
                  type: "thinkingLevelUpdate",
                  level: selectedLevel ?? "",
                });
              } catch (err) {
                // Best-effort only — log and continue
                this.logger.warn("Error while syncing thinking level on model switch", { err });
              }
            })
            .catch((err) => {
              this.logger.warn(
                "Failed to fetch model capabilities on model switch",
                { err },
              );
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
          const oldAgent = this.selectedAgent;
          this.selectedAgent = message.agent;

          this.logger.logStateChange(
            'selected-agent',
            oldAgent,
            message.agent,
            'user-selection'
          );

          this.logger.info(`${LoggingCategories.UI_INTERACTION} User selected agent`, {
            fromAgent: oldAgent,
            toAgent: message.agent,
          });

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
          this.logger.info('[onDidReceiveMessage] Received getCommands message');
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
        case "getSubagentConversation": {
          await this.handleGetSubagentConversation(message);
          break;
        }
        case "loadSession":
        case "openSession":
        case "switchSession": {
          const correlationId = this.logger.startFeatureFlow('switch-session', {
            targetSessionId: message.sessionId,
          });

          this.logger.info(`${LoggingCategories.UI_INTERACTION} User switching session`, {
            correlationId,
            fromSessionId: this.currentSessionId,
            toSessionId: message.sessionId,
          });

          try {
            await this.handleLoadSession(message.sessionId);
            this.logger.endFeatureFlow(correlationId, { success: true });
          } catch (error) {
            this.logger.error(
              `${LoggingCategories.UI_INTERACTION} Failed to switch session`,
              { correlationId, fromSessionId: this.currentSessionId, toSessionId: message.sessionId, error: (error as Error).message }
            );
            this.logger.endFeatureFlow(correlationId, { success: false });
          }
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
        case "restartServer": {
          await this.serverManager.restartServer();
          await this.handleGetLspStatus().catch(() => { });
          await this.handleGetMcpStatus().catch(() => { });
          break;
        }
        case "setThinkingLevel": {
          const level = message.level as string | undefined;
          if (level) {
            await this.modelAndAgentManager.setThinkingLevel(
              level,
              this.currentSessionId ?? undefined,
            );
            this.logger.info("Thinking level set", { level });
            // NOTE: The webview handler only listens for 'thinkingLevelUpdate' (not 'thinkingLevelSet')
            this.view?.webview.postMessage({
              type: "thinkingLevelUpdate",
              level,
            });
          }
          break;
        }
        case "toggleMode": {
          const correlationId = this.logger.startFeatureFlow('toggle-mode', {
            fromMode: this.currentMode,
            toMode: message.mode,
          });

          this.logger.info('User toggled chat mode', {
            correlationId,
            fromMode: this.currentMode,
            toMode: message.mode,
          });

          try {
            await this.handleToggleMode(message.mode);
            this.logger.endFeatureFlow(correlationId, { success: true });
          } catch (error) {
            this.logger.error('Failed to toggle mode', {
              correlationId,
              error: (error as Error).message,
            });
            this.logger.endFeatureFlow(correlationId, { success: false });
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
          if (!this.lastSendMessageArgs) {
            this.logger.warn("retryLastMessage failed: no lastSendMessageArgs");
            break;
          }
          if (!retrySessionId) {
            this.logger.warn("retryLastMessage failed: no currentSessionId");
            break;
          }
          // Clean up any stale processing state that might be blocking the retry
          if (this.processingSessionIds.has(retrySessionId)) {
            this.logger.info("retryLastMessage: clearing stale processing state", { sessionId: retrySessionId });
            this.processingSessionIds.delete(retrySessionId);
            this.sendProcessingSessionsUpdate();
          }
          const retryWithoutStructuredOutput =
            message.retryWithoutStructuredOutput === true;
          // Reload chat history to show clean state before retry
          try {
            const rawMessages = await this.sessionService.getMessages(
              retrySessionId,
            );
            const messages = await this.processHistoryMessages(
              rawMessages,
              retrySessionId,
            );
            this.logHistoryRenderDiagnostics(
              "retryLastMessage.reload",
              retrySessionId,
              rawMessages,
              messages,
            );
            this.view?.webview.postMessage({
              type: "chatHistory",
              sessionId: retrySessionId,
              messages: messages,
              processingSessionIds: this.getEffectiveProcessingSessionIds(),
            });
          } catch (err) {
            this.logger.error("Failed to load messages for retry", { err });
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
        default: {
          this.logger.debug(`${LoggingCategories.UI_INTERACTION} Unhandled message type`, {
            messageType: type,
          });
        }
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
      if (eventType === "session.diff") {
        const props = (eventRec?.properties as Record<string, unknown> | undefined) || {};
        const diffs = Array.isArray(props?.diff) ? (props.diff as Array<Record<string, unknown>>) : [];
        this.logger.debug("session.diff stream event observed", {
          sessionId: this.extractEventSessionId(event),
          rows: diffs.length,
          withPatch: diffs.filter((row) => typeof row?.patch === "string" && row.patch.length > 0).length,
          sampleFiles: diffs.slice(0, 8).map((row) => String(row?.file || "")),
        });
      }

      const eventSessionId = this.extractEventSessionId(event);
      // Always run subagent tracking before any session-scoped early return so child
      // session events are captured regardless of which session is active in the UI.
      const subagentUpdate = this.subagentTracker.consumeStreamEvent(event);
      if (subagentUpdate) {
        this.view?.webview.postMessage({
          type: "subagentUpdate",
          ...subagentUpdate,
        });
        this.sendProcessingSessionsUpdate();
        void this.subagentPersistence.persistSubagentUpdateSnapshot(
          subagentUpdate,
          this.currentSessionId,
          this.sessionService,
          (msg) => this.view?.webview.postMessage(msg)
        ).catch((persistError) => {
          this.logger.warn("Failed to persist subagent stream snapshot", { err: persistError });
        });
      }

      // Sync server-generated session title from session.updated events.
      // The OpenCode server generates titles using a small model after processing
      // the first message — we pick up the AI-generated title here.
      if (event.type === "session.updated") {
        const eventAny = event as any;
        const props = eventAny.properties as any ?? {};
        const title =
          eventAny.title ||
          props.title ||
          props.info?.title ||
          props.session?.title;
        const titleSessionId =
          eventAny.id ||
          eventAny.sessionId ||
          eventAny.sessionID ||
          props.id ||
          props.sessionId ||
          props.sessionID ||
          props.info?.id;
        if (titleSessionId && typeof title === "string" && title !== "Untitled chat") {
          this.handleServerSessionTitleUpdate(titleSessionId, title);
        }
      }

      // Explicitly session-scoped stream events must still reach the webview
      // when that session is inactive. The webview keeps per-session streaming
      // caches so switching back to an active stream can restore its timeline.
      // When the event carries no sessionId, keep using activeStreamSessionId
      // to attribute it. If the user switched sessions mid-stream, forwarding
      // with that resolved id lets the webview update the inactive session's
      // streaming cache instead of losing activity events.
      if (await this.handleSdkTodoUpdatedEvent(event, eventSessionId)) {
        return;
      }
      // Skip forwarding events for sessions that were stopped by the user.
      // After abort() is called, in-flight stream events may still arrive from
      // the server, but we should not forward them to the webview.
      if (eventSessionId && !this.isSessionEffectivelyProcessing(eventSessionId)) {
        this.logger.debug("Skipping stream event for non-processing session", {
          sessionId: eventSessionId,
          eventType: event.type,
        });
        return;
      }
      // For events without an explicit sessionId, check the active stream session.
      // If activeStreamSessionId was cleared (e.g., after stop), skip these events.
      if (!eventSessionId && this.activeStreamSessionId && !this.isSessionEffectivelyProcessing(this.activeStreamSessionId)) {
        this.logger.debug("Skipping stream event for stopped active stream session", {
          activeStreamSessionId: this.activeStreamSessionId,
          eventType: event.type,
        });
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
      const hasBlockingInteractive = this.hasBlockingInteractiveInStreamPayload(
        enrichedEvent || event,
      );
      this.logStreamEventDiagnostics(event, enrichedEvent);

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

      // Only stamp sessionId when we can be confident the event belongs to the
      // current session.  If the event already carries a sessionId, preserve it;
      // otherwise use activeStreamSessionId (set when the prompt was dispatched)
      // so the webview receives a reliable session-scoped event.
      const resolvedSessionId = eventSessionId || this.activeStreamSessionId || this.currentSessionId;
      this.view?.webview.postMessage({
        type: "streamEvent",
        event: { ...enrichedEvent, sessionId: resolvedSessionId },
      });
      if (hasBlockingInteractive && resolvedSessionId) {
        this.processingSessionIds.delete(resolvedSessionId);
        if (this.activeStreamSessionId === resolvedSessionId) {
          this.activeStreamSessionId = undefined;
        }
        this.sendProcessingSessionsUpdate();
      }
      if (this.shouldVerboseStreamDebug()) {
        this.logger.debug("streamEvent forwarded", {
          type: (enrichedEvent as any)?.type || event.type,
          kind: (enrichedEvent as any)?.structured?.kind || "unknown",
          finalizedForInteractive: hasBlockingInteractive,
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
            if (resolvedSessionId) {
              this.sessionsWithFileChangeEvidence.add(resolvedSessionId);
            }
            const callID =
              part.callId ||
              part.callID ||
              enrichedEvent?.structured?.callID ||
              enrichedEvent.id;
            if (callID) {
              const toolNameRaw =
                typeof part.tool === "string" ? part.tool : undefined;
              const partInput = part.state?.input ?? {};
              const commandHint =
                (typeof partInput.CommandLine === "string" && partInput.CommandLine) ||
                (typeof partInput.command === "string" && partInput.command) ||
                undefined;
              const queryHint =
                (typeof partInput.Query === "string" && partInput.Query) ||
                (typeof partInput.query === "string" && partInput.query) ||
                (typeof partInput.Pattern === "string" && partInput.Pattern) ||
                (typeof partInput.pattern === "string" && partInput.pattern) ||
                undefined;
              this.getDiffActivityEnrichment(filePath)
                .then((enrichment) => {
                  if (enrichment && this.view) {
                    this.view.webview.postMessage({
                      type: "streamEventEnrich",
                      callID,
                      diffStats: enrichment.diffStats,
                      activityDetail: {
                        kind: "file_edit",
                        tool: toolNameRaw,
                        command: commandHint,
                        query: queryHint,
                        file: filePath,
                        diffExcerpt: enrichment.diffExcerpt,
                      },
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
        serverError:
          status === "error" ? this.serverManager.getLastError() : undefined,
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
      this.logger.warn('[processHistoryMessages] No messages to process', { sessionId, count: messages?.length });
      return [];
    }

    this.logger.info('[DEBUG] processHistoryMessages input:', { count: messages.length, sessionId });

    try {
      // Load any session overrides first
      const overriddenMessages = await this.historyProcessor.applySessionMessageOverrides(sessionId, messages);

      this.logger.info('[DEBUG] After applySessionMessageOverrides:', { count: overriddenMessages?.length || 0 });

      // Then process through the canonical pipeline
      const processed = await this.historyProcessor.processHistoryMessages(overriddenMessages, sessionId);

      this.logger.info('[DEBUG] processHistoryMessages output:', { count: processed?.length || 0, sessionId });

      return processed || [];
    } catch (error) {
      this.logger.error('[ERROR] processHistoryMessages failed:', { error: error instanceof Error ? error.message : String(error), sessionId, stack: error instanceof Error ? error.stack : undefined });
      // Return original messages as fallback
      return messages;
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
      return true;
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

  private getTimeoutRecoveryPollDelays(failureMessage?: string): number[] {
    const timeoutLikeFailure = this.isLikelyInteractiveAwaitTimeoutError(
      this.firstNonEmptyString(failureMessage) || "",
    );
    if (!timeoutLikeFailure) {
      return [500, 1000, 1800, 2800, 4000];
    }

    // Timeout-like transport failures are often transient while the model is
    // still working. Keep polling longer before surfacing a hard error.
    return [500, 1000, 1800, 2800, 4000, 5500, 7000, 9000, 12000, 15000, 20000, 25000, 30000];
  }

  private async getSessionStatusType(
    sessionId: string,
  ): Promise<"idle" | "busy" | "retry" | undefined> {
    const client = this.serverManager.getClient();
    if (!client) {
      return undefined;
    }

    try {
      const workspaceDirectory = this.getWorkspaceDirectory();
      const response = workspaceDirectory
        ? await client.session.status({
            query: { directory: workspaceDirectory },
          })
        : await client.session.status({});
      const statusMap =
        (response?.data as Record<string, { type?: unknown }>) || {};
      const status = statusMap[sessionId];
      const type = this.firstNonEmptyString(status?.type)?.toLowerCase();
      if (type === "idle" || type === "busy" || type === "retry") {
        return type;
      }
      return undefined;
    } catch (error) {
      this.logger.debug("Failed to fetch session status during timeout recovery", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private async tryRecoverTimedOutResponse(
    sessionId: string,
    baselineAssistantMarker?: AssistantHistoryMarker,
    failureMessage?: string,
  ): Promise<boolean> {
    const pollDelaysMs = this.getTimeoutRecoveryPollDelays(failureMessage);
    const timeoutLikeFailure = this.isLikelyInteractiveAwaitTimeoutError(
      this.firstNonEmptyString(failureMessage) || "",
    );
    const startedAt = Date.now();
    const maxWaitMs = timeoutLikeFailure ? 30 * 60 * 1000 : 60 * 1000;
    this.logger.info("Attempting timeout recovery from session history", {
      sessionId,
      timeoutLikeFailure,
      pollAttempts: pollDelaysMs.length,
      maxWaitMs,
    });

    for (let attemptIndex = 0; ; attemptIndex += 1) {
      const delayMs =
        pollDelaysMs[Math.min(attemptIndex, pollDelaysMs.length - 1)];
      await this.sleep(delayMs);
      let rawMessages: any[] | undefined;
      try {
        rawMessages = await this.sessionService.getMessages(sessionId);
      } catch (error) {
        this.logger.warn("Timeout recovery poll failed to fetch session messages", {
          sessionId,
          attempt: attemptIndex + 1,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (Array.isArray(rawMessages)) {
        const latestAssistantMarker =
          this.getLatestAssistantHistoryMarker(rawMessages);
        if (
          this.hasAssistantHistoryAdvanced(
            latestAssistantMarker,
            baselineAssistantMarker,
          )
        ) {
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
            processingSessionIds: this.getEffectiveProcessingSessionIds(),
          });
          this.logger.info("Timeout recovery succeeded from session history", {
            sessionId,
            attempt: attemptIndex + 1,
            delayMs,
          });
          try {
            await this.sendPersistedCompactionViewState(sessionId);
          } catch {
            // best effort only
          }
          return true;
        }
      }

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= maxWaitMs) {
        break;
      }

      if (!timeoutLikeFailure) {
        if (attemptIndex >= pollDelaysMs.length - 1) {
          break;
        }
        continue;
      }

      // User stopped/cancelled or session switched away from active processing.
      if (!this.processingSessionIds.has(sessionId)) {
        this.logger.info("Ending timeout recovery because session is no longer processing", {
          sessionId,
          attempt: attemptIndex + 1,
          elapsedMs,
        });
        return false;
      }

      const statusType = await this.getSessionStatusType(sessionId);
      if (statusType === "idle") {
        // Server reports idle and still no assistant message advance.
        break;
      }

      if (attemptIndex > 0 && attemptIndex % 4 === 0) {
        this.logger.info("Still waiting for final assistant response after timeout-like transport error", {
          sessionId,
          attempt: attemptIndex + 1,
          elapsedMs,
          statusType: statusType || "unknown",
        });
      }
    }

    this.logger.warn("Timeout recovery exhausted without assistant history advance", {
      sessionId,
      timeoutLikeFailure,
      pollAttempts: pollDelaysMs.length,
      elapsedMs: Date.now() - startedAt,
    });
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

  private parseSlashSkillInvocation(text: string): { name: string; request: string } | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) {
      return null;
    }

    if (this.planManager.isPlanProceedMessageText(trimmed)) {
      return null;
    }

    const match = trimmed.match(/^\/([^\s/]+)(?:\s+([\s\S]*))?$/);
    if (!match) {
      return null;
    }

    return {
      name: match[1],
      request: match[2]?.trim() || "",
    };
  }

  private skillNameMatches(candidate: string, requested: string): boolean {
    return (
      candidate === requested ||
      candidate.endsWith(`:${requested}`) ||
      requested.endsWith(`:${candidate}`)
    );
  }

  private async resolveSlashSkillInvocation(
    client: any,
    text: string,
  ): Promise<{ name: string; request: string; description?: string } | null> {
    const invocation = this.parseSlashSkillInvocation(text);
    if (!invocation || !this.skillManagementService) {
      return null;
    }

    const skills = await this.skillManagementService.getAllSkills(client);
    const skill = skills.find((item) =>
      this.skillNameMatches(item.name, invocation.name),
    );
    if (!skill) {
      return null;
    }

    return {
      ...invocation,
      name: skill.name,
      description: skill.description,
    };
  }

  private async resolveSlashCommandInvocation(
    client: any,
    text: string,
  ): Promise<{ command: string; arguments: string } | null> {
    const invocation = this.parseSlashSkillInvocation(text);
    if (!invocation) {
      return null;
    }

    try {
      const response = await client.command.list();
      const commands = Array.isArray(response.data) ? response.data : [];
      const match = commands.find((item: any) => {
        const name = this.firstNonEmptyString(item?.name)?.replace(/^\//, "");
        return name === invocation.name;
      });
      if (!match) {
        return null;
      }
      return {
        command: invocation.name,
        arguments: invocation.request,
      };
    } catch (error) {
      this.logger.warn('[resolveSlashCommandInvocation] Failed to load command catalog', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async executeSlashCommandInvocation(
    client: any,
    sessionID: string,
    slashInvocation: { command: string; arguments: string },
    agent?: string,
  ) {
    const workspaceDirectory = this.getWorkspaceDirectory();
    return client.session.command({
      path: { id: sessionID },
      query: workspaceDirectory ? { directory: workspaceDirectory } : undefined,
      body: {
        command: slashInvocation.command,
        arguments: slashInvocation.arguments,
        agent: agent || this.selectedAgent,
      },
    });
  }

  private buildSlashSkillSystemReminder(invocation: {
    name: string;
    request: string;
    description?: string;
  }): string {
    const lines = [
      "<auto-slash-command>",
      `Skill invoked: ${invocation.name}`,
    ];
    if (invocation.description) {
      lines.push(`Description: ${invocation.description}`);
    }
    lines.push(
      `Use the skill tool with name="${invocation.name}" before answering, then apply the loaded skill instructions to the user request.`,
      "</auto-slash-command>",
    );
    return lines.join("\n");
  }

  // PROMPT-OWNERSHIP: do not modify — transport-only path
  private async promptWithStructuredOutput(
    client: any,
    sessionID: string,
    body: NonNullable<SessionPromptData["body"]>,
    useStructuredOutput = true,
    options?: {
      hasFiles?: boolean;
      hasContexts?: boolean;
      hasImages?: boolean;
    },
  ) {
    const workspaceDirectory = this.getWorkspaceDirectory();

    const callPrompt = (requestBody: Record<string, unknown>) => {
      const sdkStartTime = Date.now();
      this.logger.debug("Initiating SDK prompt call", {
        sessionID,
        useStructuredOutput,
        hasFiles: options?.hasFiles,
        hasContexts: options?.hasContexts,
        hasImages: options?.hasImages,
      });

      const promise = client.session.prompt({
        path: { id: sessionID },
        query: workspaceDirectory ? { directory: workspaceDirectory } : undefined,
        body: requestBody as SessionPromptData["body"],
      });

      // Add timing tracking
      promise.then((result: { error?: unknown; data?: unknown }) => {
        const sdkDuration = Date.now() - sdkStartTime;
        this.logger.performance(`SDK prompt call completed`, sdkDuration, {
          sessionID,
          hasError: Boolean(result.error),
          hasData: Boolean(result.data),
        });
      }).catch((error: Error) => {
        const sdkDuration = Date.now() - sdkStartTime;
        this.logger.error(`SDK prompt call failed after ${sdkDuration}ms`, {
          sessionID,
          error: error.message,
        });
      });

      return promise;
    };

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
    // Don't filter out invoke blocks - they contain structured XML content that should be preserved
    if (normalized.includes("<invoke>") || normalized.includes("</invoke>")) {
      return false;
    }
    return (
      normalized.includes("<function_call>") ||
      normalized.includes("</function_call>") ||
      normalized.includes("<function_calls>") ||
      normalized.includes("</function_calls>")
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

  private isLikelyInteractiveTransportFailure(message: string): boolean {
    return (
      this.isLikelyInteractiveAwaitTimeoutError(message) ||
      this.isGenericErrorMessage(message)
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
        type === "quick-actions"
      );
    };
    const hasChoiceList = (value: unknown, minimum = 1): boolean =>
      Array.isArray(value) && value.length >= minimum;
    const getToolQuestionText = (questionLike: Record<string, unknown>): string | undefined =>
      this.firstNonEmptyString(
        questionLike.question,
        questionLike.prompt,
        questionLike.message,
        questionLike.text,
        questionLike.title,
      );
    const hasStructuredQuestionText = (
      questionLike: Record<string, unknown>,
    ): boolean =>
      !!this.firstNonEmptyString(questionLike.question, questionLike.text);
    const isRenderableStructuredInteractiveEvent = (value: unknown): boolean => {
      const questionLike = this.asRecord(value);
      if (!questionLike) {
        return false;
      }
      const type = this.firstNonEmptyString(questionLike.type)?.toLowerCase();
      if (type === "confirm") {
        return !!this.firstNonEmptyString(questionLike.question);
      }
      if (type === "quick_actions" || type === "quick-actions") {
        return hasChoiceList(questionLike.actions);
      }
      if (type === "question") {
        return (
          !!this.firstNonEmptyString(questionLike.question) &&
          hasChoiceList(questionLike.options, 2)
        );
      }
      return false;
    };
    const isRenderableStructuredQuestion = (value: unknown): boolean => {
      const questionLike = this.asRecord(value);
      if (!questionLike || !hasStructuredQuestionText(questionLike)) {
        return false;
      }
      const type =
        this.firstNonEmptyString(questionLike.type)?.toLowerCase() || "question";
      if (type === "confirm") {
        return true;
      }
      if (type === "quick_actions" || type === "quick-actions") {
        return hasChoiceList(questionLike.actions);
      }
      if (type === "message") {
        return false;
      }
      return hasChoiceList(questionLike.options, 2);
    };
    const normalizeToolChoices = (...values: unknown[]): unknown[] => {
      for (const value of values) {
        if (Array.isArray(value)) {
          return value;
        }
      }
      return [];
    };
    const isRenderableToolQuestion = (value: unknown): boolean => {
      const questionLike = this.asRecord(value);
      if (!questionLike) {
        return false;
      }
      const type = this.firstNonEmptyString(questionLike.type)?.toLowerCase();
      if (type === "message") {
        return false;
      }
      if (type === "quick_actions" || type === "quick-actions") {
        return normalizeToolChoices(
          questionLike.actions,
          questionLike.options,
        ).length > 0;
      }

      const questionText = getToolQuestionText(questionLike);
      if (!questionText) {
        return false;
      }
      if (type === "confirm") {
        return true;
      }

      const options = normalizeToolChoices(
        questionLike.options,
        questionLike.choices,
        questionLike.answers,
        questionLike.actions,
      );
      const allowsCustomInput =
        questionLike.allowCustomInput === true ||
        questionLike.allow_custom_input === true ||
        options.length === 0;

      return options.length >= 2 || allowsCustomInput;
    };
    const structured = this.asRecord(eventRec.structuredOutput);
    if (structured) {
      const interactiveEvents = Array.isArray(structured.interactiveEvents)
        ? structured.interactiveEvents
        : [];
      if (interactiveEvents.length > 0) {
        const hasBlockingInteractive = interactiveEvents.some((item) => {
          const rec = this.asRecord(item);
          if (!rec) return false;
          return (
            isBlockingType(rec.type) &&
            isRenderableStructuredInteractiveEvent(rec)
          );
        });
        if (hasBlockingInteractive) {
          return true;
        }
      }

      const question = this.asRecord(structured.question);
      if (question && isRenderableStructuredQuestion(question)) {
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
    const isQuestionTool =
      toolName === "question" ||
      toolName.includes("request_user_input") ||
      toolName.includes("request-user-input");

    const state = this.asRecord(part.state);
    const input =
      this.asRecord(state?.input) ||
      this.asRecord(part.input) ||
      this.asRecord(part.arguments) ||
      null;
    if (!input) {
      return false;
    }

    if (isQuestionTool) {
      const inputCollections = [
        input.questions,
        input.items,
        input.prompts,
        input.events,
      ];
      if (
        inputCollections.some(
          (collection) =>
            Array.isArray(collection) &&
            collection.some((item) => isRenderableToolQuestion(item)),
        )
      ) {
        return true;
      }
    }

    return isQuestionTool && isRenderableToolQuestion(this.asRecord(input.question) || input);
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
        if (!Array.isArray(merged.conversationEvents)) {
          merged.conversationEvents = [];
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
        const id = this.firstNonEmptyString((entry as Record<string, unknown>).id);
        if (id) {
          mergedById.set(id, entry as Record<string, unknown>);
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

  private hasNonTextActivityParts(message: any): boolean {
    if (!message || typeof message !== "object" || !Array.isArray(message.parts)) {
      return false;
    }
    return message.parts.some((part: any) => {
      const rec = this.asRecord(part);
      if (!rec) {
        return false;
      }
      if (this.isRenderableTextPart(rec)) {
        return false;
      }
      const partType = this.firstNonEmptyString(rec.type, rec.kind)?.toLowerCase();
      if (partType === "tool") {
        const toolName = this.firstNonEmptyString(rec.tool, rec.name)?.toLowerCase();
        if (
          toolName?.includes("structuredoutput") ||
          toolName?.includes("structured_output")
        ) {
          return false;
        }
      }
      return true;
    });
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
      const parsed = this.normalizeStructuredOutput(candidate.value as string, {
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
    const isAssistantLikeRole =
      role === "assistant" ||
      (!role &&
        Boolean(
          this.firstNonEmptyString(
            message?.info?.modelID,
            message?.modelID,
            message?.info?.providerID,
            message?.providerID,
          ),
        ));

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
      if (isAssistantLikeRole && bodyText) {
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
      if (isAssistantLikeRole && !bodyText) {
        // Keep partial stop/activity turns intact so activity/reasoning widgets can render.
        // These turns may have no assistant text body but still contain useful non-text parts.
        if (this.hasNonTextActivityParts(message)) {
          return message;
        }
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

        // Use ErrorBuilder to extract actual error message
        const errorBuilder = new ErrorBuilder(
          this.logger,
          this.isLikelyInteractiveAwaitTimeoutError.bind(this)
        );
        const displayError = errorBuilder.extractError(message);

        const fallbackText = displayError?.message ||
          (incompatibleModelKey &&
            this.structuredOutputIncompatibleModelKeys.has(incompatibleModelKey)
            ? "Structured output error: this model returned an empty structured payload."
            : "I couldn't produce a valid structured response for this turn. Please retry.");

        const next: any = {
          ...message,
          content: fallbackText,
          error: fallbackText,
          displayError: displayError,
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

    // DEBUG: Check structured object immediately after extraction
    log.debug('Structured object after extraction', {
      responseType: structured.responseType,
      hasPlan: 'plan' in structured,
      planKeys: structured.plan ? Object.keys(structured.plan) : [],
      planValue: structured.plan,
      planFile: structured.plan?.file,
      allStructuredKeys: Object.keys(structured)
    });

    const structuredPlanContent =
      this.firstNonEmptyString(structured.plan?.content) || "";
    const shouldSuppressStructuredPlan =
      this.isClarificationQuestionnaire(structuredPlanContent);

    const next: any = {
      ...message,
      structuredOutput: structured,
    };

    // DEBUG: Log immediately after creating next object
    log.debug('applyStructuredOutputToMessage: next object created', {
      messageId: next.id,
      hasStructuredOutput: 'structuredOutput' in next,
      structuredOutputResponseType: next.structuredOutput?.responseType,
      structuredOutputHasPlan: next.structuredOutput?.plan ? 'yes' : 'no',
      structuredOutputPlanFile: next.structuredOutput?.plan?.file,
      originalMessageHasPlan: 'plan' in message,
      originalMessagePlanFile: message.plan?.file
    });

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
      const mapped = structured.progressUpdates.map((update) => {
        const step: any = {
          type: "step",
          title: update.title,
          content: update.filePath,
          status: update.status ?? "pending",
          meta: update.meta,
        };

        // Extract diff information for file edit operations
        if (update.kind || update.file || update.diffStats || update.diffExcerpt) {
          step.activityDetail = {
            kind: update.kind,
            summary: update.title,
            command: update.command,
            output: update.output,
            file: update.file,
            diffStats: update.diffStats,
            diffExcerpt: update.diffExcerpt,
          };
        }

        // Set filePath if available
        if (update.file) {
          step.filePath = update.file;
        }

        // Set diffStats if available
        if (update.diffStats) {
          step.diffStats = update.diffStats;
        }

        return step;
      });
      next.steps = [...existingSteps, ...mapped];
    }

    if (
      structured.interactiveEvents &&
      structured.interactiveEvents.length > 0
    ) {
      next.interactiveEvents = structured.interactiveEvents;
      const questionPrompt = this.deriveQuestionPromptFromInteractivePayload({
        question: (structured.question as string) ?? '',
        options: structured.interactiveEvents as any[],
      });
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
        structured.plan?.intro,
        structured.plan?.summary,
      );
      if (summaryMessage) {
        next.content = summaryMessage;
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
            text: summaryMessage,
          };
        } else {
          parts.push({ type: "text", text: summaryMessage });
        }
        next.parts = parts;
      }
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

      // DEBUG: Log plan file extraction
      log.debug('Plan file extraction', {
        hasStructuredPlan: !!structured.plan,
        structuredPlanKeys: structured.plan ? Object.keys(structured.plan) : [],
        structuredPlanFile: structured.plan?.file,
        candidatesCount: structuredPlanCandidates.length,
        candidates: structuredPlanCandidates,
        planFile: planFile,
        planFileUndefined: planFile === undefined
      });

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

        // DEBUG: Log the final plan object being set
        log.debug('Plan object set on next', {
          hasPlan: !!next.plan,
          planFile: next.plan?.file,
          planKeys: next.plan ? Object.keys(next.plan) : [],
          fullPlanObject: next.plan ? JSON.stringify(next.plan, null, 2) : 'undefined'
        });

        // DEBUG: Try to serialize the entire next object to check for circular references
        try {
          const serialized = JSON.stringify(next);
          log.debug('Message serialization successful', {
            serializedLength: serialized.length,
            hasPlanInSerialized: serialized.includes('"plan"'),
            planSubstring: serialized.includes('"file"') ? serialized.substring(serialized.indexOf('"plan"'), serialized.indexOf('"plan"') + 200) : 'NOT FOUND'
          });
        } catch (e) {
          log.debug('Message serialization FAILED', { error: e });
        }
      } else {
        log.debug('Plan NOT set - condition failed', {
          hasLongPlanContent,
          planFile,
          planFileUndefined: planFile === undefined,
          hasLongPlanContentFalse: !hasLongPlanContent,
          noPlanFile: !planFile
        });
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
    // Start feature flow tracking
    const flow = log.startFeatureFlow('SendMessage', {
      messageLength: text.length,
      isRetry,
      hasFiles: !!files?.length,
      fileCount: files?.length || 0,
      hasContexts: !!contexts?.length,
      contextCount: contexts?.length || 0,
      hasImages: !!images?.length,
      imageCount: images?.length || 0,
      agent,
    });

    // Cache for retry
    this.lastSendMessageArgs = { text, files, contexts, images, agent };

    // We'll set processing state once we have a definitive session ID below

    const overallStartTime = Date.now();
    log.featureStep(flow, 'message_send_started', {
      messageLength: text.length,
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
      this.activeStreamSessionId = session.id;
      this.sessionsWithFileChangeEvidence.delete(session.id);
      this.subagentTracker.setActiveSession(session.id);
      // New user turns are independent from any previous question popover.

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
        this.fetchServerSessionTitle(session.id);
      }

      const slashSkillInvocation = await this.resolveSlashSkillInvocation(
        client,
        text,
      );
      const slashCommandInvocation = slashSkillInvocation
        ? null
        : await this.resolveSlashCommandInvocation(client, text);
      const slashSkillSystemReminder = slashSkillInvocation
        ? this.buildSlashSkillSystemReminder(slashSkillInvocation)
        : undefined;
      const modelInputText = slashSkillSystemReminder
        ? `${slashSkillSystemReminder}\n\n${slashSkillInvocation?.request || text}`
        : text;

      // Save user message to local history immediately, unless this is a retry
      if (!isRetry) {
        const persistedUserText =
          this.firstNonEmptyString(userFacingText, text) || text;
        if (slashSkillSystemReminder) {
          const systemMessage = {
            role: "system" as const,
            content: slashSkillSystemReminder,
            text: slashSkillSystemReminder,
            responseType: "system" as const,
            parts: [
              {
                type: "text",
                text: slashSkillSystemReminder,
              },
            ],
            time: {
              created: Date.now(),
            },
          };
          await this.sessionService.appendMessage(session.id, systemMessage);
          this.view?.webview.postMessage({
            type: "userMessageAppended",
            message: systemMessage,
          });
        }
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

      log.debug(
        `Session ${session.id}: ${existingMessages.length} existing messages. isNew: ${isNewSession}`,
      );

      // Prepare message parts
      const parts: NonNullable<SessionPromptData["body"]>["parts"] = [
        {
          type: "text",
          text: modelInputText,
        },
      ];

      // Add context fragments if any
      if (contexts && contexts.length > 0) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        for (const ctx of contexts) {
          if (ctx.file && ctx.file.startsWith("resource:")) {
            const resourceUri = ctx.file.replace("resource:", "");
            parts.push({
              type: "file",
              mime: ctx.languageId || "text/plain",
              url: resourceUri,
              source: {
                type: "resource" as const,
                uri: resourceUri,
              } as any,
            });
          } else if (ctx.content) {
            parts.push({
              type: "text",
              text: `\`\`\`${ctx.languageId}\n// ${ctx.file}:${ctx.lineInfo}\n${ctx.content}\n\`\`\``,
            });
          } else if (ctx.file && workspaceFolder) {
            // Handle file paths without content (attached via @)
            try {
              let absoluteUri: vscode.Uri;
              if (path.isAbsolute(ctx.file)) {
                absoluteUri = vscode.Uri.file(ctx.file);
              } else {
                absoluteUri = vscode.Uri.joinPath(workspaceFolder.uri, ctx.file);
              }
              const content = await vscode.workspace.fs.readFile(absoluteUri);
              const textContent = new TextDecoder().decode(content);
              parts.push({
                type: "file",
                mime: ctx.languageId || "text/plain",
                filename: ctx.file.split(/[\\/]/).pop(),
                url: `file://${ctx.file}`,
                source: {
                  type: "file",
                  path: ctx.file,
                  text: {
                    value: textContent,
                    start: 0,
                    end: textContent.length,
                  },
                },
              } as any);
            } catch (error) {
              log.warn(`Failed to read file context: ${ctx.file}`, { error });
            }
          }
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
              log.error(`Failed to read file ${filePath}`, { filePath }, e as Error);
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
        !slashCommandInvocation &&
        !retryWithoutStructuredOutput &&
        this.shouldUseStructuredOutput(
          this.getStructuredOutputModelKey(this.selectedModel.providerID, this.selectedModel.modelID)
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
        hasFiles: Boolean(files?.length),
        hasContexts: Boolean(contexts?.length),
        hasImages: Boolean(images?.length),
        slashSkill: slashSkillInvocation?.name,
        slashCommand: slashCommandInvocation?.command,
      });

      const response = slashCommandInvocation
        ? await this.executeSlashCommandInvocation(
          client,
          session.id,
          slashCommandInvocation,
          agent,
        )
        : await this.promptWithStructuredOutput(
          client,
          session.id,
          promptBody,
          useStructuredOutput,
          {
            hasFiles: Boolean(files?.length),
            hasContexts: Boolean(contexts?.length),
            hasImages: Boolean(images?.length),
          },
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

      log.debug(`Response received in ${duration}s`, {
        hasData: Boolean(response.data),
        hasError: Boolean(response.error),
        status: response.response?.status,
        messageId: (response.data as any)?.info?.id,
      });
      if (response.data && capturePromptDebug) {
        this.logPromptResponseDiagnostics(session.id, response.data);
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
        if (this.isLikelyInteractiveTransportFailure(errorMessage)) {
          const recovered = await this.tryRecoverTimedOutResponse(
            session.id,
            baselineAssistantMarker,
            errorMessage,
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
          log.warn(
            `Session ${session.id} not found on server. Re-creating...`,
          );
          // Re-create the session on the server
          try {
            const newSession = await this.sessionService.createNewSession(
              session.title,
            );
            log.info(
              `Re-created session with new ID: ${newSession.id}`,
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
            log.error(
              "Failed to re-create session",
              {},
              recreateError as Error,
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
            const retryFlow = log.startFeatureFlow('StructuredOutputRetry', {
              sessionId: session.id,
              providerID: this.selectedModel.providerID,
              modelID: this.selectedModel.modelID,
              errorMessage,
            });

            this.logger.warn(
              "Structured output failed; auto-retrying without schema",
              {
                sessionId: session.id,
                providerID: this.selectedModel.providerID,
                modelID: this.selectedModel.modelID,
              },
            );
            log.featureStep(retryFlow, 'retrying_without_structured_output');

            const result = await this.handleSendMessage(
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

            log.endFeatureFlow(retryFlow, { status: 'completed', retrySuccess: true });
            return result;
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
        const enrichedMessage = await this.enrichMessageWithPlan(structuredMessage);
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
        let finalMessage = plainTextFallbackMetadata
          ? {
            ...enrichedMessage,
            ...plainTextFallbackMetadata,
          }
          : enrichedMessage;

        if (promptVariant) {
          const infoRecord = this.asRecord((finalMessage as Record<string, unknown>).info) || {};
          finalMessage = {
            ...finalMessage,
            variant: promptVariant,
            info: {
              ...infoRecord,
              variant: promptVariant,
            },
          };
        }

        const finalAssistantMessageId = this.extractMessageId(finalMessage);
        const shouldAttachChangeSummary =
          !!finalAssistantMessageId &&
          (this.sessionsWithFileChangeEvidence.has(session.id) ||
            this.messageHasFileChangeEvidence(finalMessage));
        if (finalAssistantMessageId && shouldAttachChangeSummary) {
          const changeSummary = await this.summarizeSessionDiffForMessage(
            client,
            session.id,
            finalAssistantMessageId,
          );
          if (changeSummary) {
            finalMessage = {
              ...finalMessage,
              changeSummary,
            };
          }
        }

        const debugMessage = {
          ...finalMessage,
          rawResponse,
        };

        // DEBUG: Log right after creating debugMessage
        log.debug('debugMessage created', {
          hasPlan: 'plan' in debugMessage,
          planFile: debugMessage.plan?.file,
          planKeys: debugMessage.plan ? Object.keys(debugMessage.plan) : [],
          hasStructuredOutput: 'structuredOutput' in debugMessage,
          structuredOutputResponseType: debugMessage.structuredOutput?.responseType,
          structuredOutputHasPlan: debugMessage.structuredOutput?.plan ? 'yes' : 'no',
          structuredOutputPlanFile: debugMessage.structuredOutput?.plan?.file
        });

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

        // DEBUG: Log message right before sending to webview
        log.debug('SENDING message to webview', {
          hasPlan: 'plan' in debugMessage,
          planKeys: debugMessage.plan ? Object.keys(debugMessage.plan) : [],
          planFile: debugMessage.plan?.file,
          messageType: debugMessage.type,
          messageResponse: debugMessage.responseType,
          structuredOutputResponseType: debugMessage.structuredOutput?.responseType,
          fullMessageKeys: Object.keys(debugMessage)
        });

        // Try to serialize to check for circular references
        try {
          const serialized = JSON.stringify(debugMessage);
          log.debug('Serialization check', {
            success: true,
            length: serialized.length,
            hasPlanInSerialized: serialized.includes('"plan"'),
            hasFileInSerialized: serialized.includes('"file"'),
            planSubstring: serialized.includes('"plan"') ? serialized.substring(serialized.indexOf('"plan"'), Math.min(serialized.indexOf('"plan"') + 300, serialized.length)) : 'NOT FOUND'
          });
        } catch (e) {
          log.debug('Serialization FAILED', { error: e });
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
        drainSessionId &&
        this.isLikelyInteractiveTransportFailure(errorMessage)
      ) {
        if (
          this.subagentTracker
            .getActiveProcessingSessionIds()
            .includes(drainSessionId)
        ) {
          this.logger.info(
            "Suppressing timeout while background subagents are still active",
            {
              sessionId: drainSessionId,
              errorMessage,
            },
          );
          this.sendProcessingSessionsUpdate();
          return;
        }
        const recovered = await this.tryRecoverTimedOutResponse(
          drainSessionId,
          baselineAssistantMarker,
          errorMessage,
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
      log.featureStep(flow, 'message_processing_completed', {
        duration: totalDuration,
        sessionId: drainSessionId,
        timestamp: new Date().toISOString(),
      });

      this.logger.info(`🏁 [TIMING] Message processing completed in ${totalDuration}ms`, {
        sessionId: drainSessionId,
        timestamp: new Date().toISOString(),
      });

      if (debugSessionId) {
        this.promptDebugBySession.delete(debugSessionId);
      }
      if (drainSessionId) {
        this.processingSessionIds.delete(drainSessionId);
        this.sessionsWithFileChangeEvidence.delete(drainSessionId);
        if (this.activeStreamSessionId === drainSessionId) {
          this.activeStreamSessionId = undefined;
        }
        this.sendProcessingSessionsUpdate();

        if (this.sessionsNeedingTitle?.has(drainSessionId)) {
          this.sessionsNeedingTitle.delete(drainSessionId);
          void this.triggerSessionTitleGeneration(drainSessionId);
        }
      }
      this.logger.info("Processing request finished", {
        sessionId: drainSessionId,
      });
      if (drainSessionId) {
        void this.handleExecuteQueue(drainSessionId);
      }

      // End feature flow tracking
      log.endFeatureFlow(flow, { status: 'completed', totalDuration });
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
      log.warn(
        "Failed to resolve stop session from SessionService",
        { error },
      );
      return undefined;
    }
  }

  /**
   * Handles stopping a request
   */
  // FORBIDDEN TO REMOVE: Stop Request Button - backend handler required by webview to abort streaming requests
  private async handleStopRequest(
    sessionId?: string,
    options?: { suppressWebviewNotification?: boolean; skipQueueDrain?: boolean },
  ): Promise<void> {
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
      log.error("Failed to stop request", {}, error as Error);
    } finally {
      if (resolvedSessionId) {
        this.processingSessionIds.delete(resolvedSessionId);
        if (this.activeStreamSessionId === resolvedSessionId) {
          this.activeStreamSessionId = undefined;
        }
        this.sendProcessingSessionsUpdate();
      }
      if (!options?.suppressWebviewNotification) {
        this.view?.webview.postMessage({
          type: "stopRequestHandled",
          sessionId: resolvedSessionId,
        });
      }
      if (resolvedSessionId && !options?.skipQueueDrain) {
        void this.handleExecuteQueue(resolvedSessionId);
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

    PlanViewProvider.closeCurrentPanel();

    // Fire and forget so the plan tab closes immediately and execution starts in chat.
    void this.handleSendMessage(
      proceedMessage,
      attachedFiles,
      undefined,
      undefined,
      "build",
      false,
      undefined,
      false,
      undefined,
      "Proceed on this plan.",
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
    if (!this.skillManagementService) {
      this.logger.warn('[refreshSkills] SkillManagementService not available');
      this.view?.webview.postMessage({ type: "mySkills", skills: [] });
      return;
    }

    try {
      const client = await this.serverManager.ensureRunning();
      const skills = await this.skillManagementService.getAllSkills(client);

      this.logger.info('[refreshSkills] Sending skills to webview', {
        skillCount: skills.length,
      });

      this.view?.webview.postMessage({
        type: "mySkills",
        skills,
      });
    } catch (error) {
      this.logger.error('[refreshSkills] Failed to load skills', { error });
      this.view?.webview.postMessage({ type: "mySkills", skills: [] });
    }
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
        if (!this.skillManagementService) {
          this.view?.webview.postMessage({ type: "mySkills", skills: [] });
          break;
        }

        try {
          const client = await this.serverManager.ensureRunning();
          const skills = await this.skillManagementService.getAllSkills(client);
          this.view?.webview.postMessage({ type: "mySkills", skills });
        } catch (error) {
          this.logger.error('[getMySkills] Failed to load skills', { error });
          this.view?.webview.postMessage({ type: "mySkills", skills: [] });
        }
        break;
      }

      case "installSkill": {
        const { source, data } = message;
        let result;

        if (source === "url") {
          result = await this.skillManager.installFromUrl(data as string, (progress) => {
            this.view?.webview.postMessage({ type: "installProgress", progress });
          });
        } else if (source === "file") {
          result = await this.skillManager.installFromFile(data as string);
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
        await this.skillManager.deleteSkill(name as string);
        this.view?.webview.postMessage({ type: "skillRemoved", name });
        break;
      }

      case "editSkill": {
        const { name, updates } = message;
        await this.skillManager.updateSkill(name as string, updates as any);
        const skill = await this.skillManager.getSkill(name as string);
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
        this.logger.warn("Unknown skill message type:", { type: message.type });
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
        log.error(`Failed to read image ${uri.fsPath}`, { uri: uri.fsPath }, error as Error);
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
   * Handle mode toggle with logging
   */
  private async handleToggleMode(newMode: string): Promise<void> {
    const oldMode = this.currentMode;
    this.currentMode = newMode;

    // Only log the state change here, not in the message handler
    this.logger.logStateChange('current-mode', oldMode, newMode, 'mode-toggle');

    // Send mode update to webview
    this.view?.webview.postMessage({
      type: 'modeChanged',
      mode: newMode,
    });
  }

  /**
   * Refreshes the view with current state
   */
  private refreshView(): void {
    this.view?.webview.postMessage({
      type: "initState",
      serverStatus: this.serverManager.getStatus(),
      serverError:
        this.serverManager.getStatus() === "error"
          ? this.serverManager.getLastError()
          : undefined,
      selectedModel: this.selectedModel,
      selectedAgent: this.selectedAgent,
      workspaceRoot: this.getWorkspaceDirectory(),
      currentSessionId: this.currentSessionId,
      processingSessionIds: this.getEffectiveProcessingSessionIds(),
      todoItems: [],
    });
    void this.refreshSdkTodosForSession(this.currentSessionId);
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

    const themeCssBlock = this.currentThemeCss
      ? `<style id="vscode-theme-icons">${this.currentThemeCss}</style>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};">
  <link href="${styleUri}" rel="stylesheet">
  ${themeCssBlock}
  <title>OpenCode Chat</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Handles file search via OpenCode SDK (fuzzy + frecency), falls back to VS Code.
   */
  private async handleSearchFiles(query: string) {
    const flow = log.startFeatureFlow('FileSearch', { queryLength: query?.length ?? 0 });

    try {
      log.featureStep(flow, 'searching_files_sdk', { query });
      const startTime = Date.now();

      const results = await this.searchFilesViaSDK(query);

      const duration = Date.now() - startTime;

      log.featureStep(flow, 'search_completed', {
        source: results.source,
        resultCount: results.items.length,
        duration,
      });

      this.view?.webview.postMessage({
        type: "fileSearchResults",
        results: results.items,
      });

      log.endFeatureFlow(flow, { result: 'completed', source: results.source, resultCount: results.items.length, duration });
    } catch (error) {
      log.error('File search failed', { query }, error as Error);
      log.endFeatureFlow(flow, { result: 'failed', error: String(error) });
      this.view?.webview.postMessage({
        type: "fileSearchResults",
        results: [],
      });
    }
  }

  /**
   * Search files via SDK with VS Code fallback.
   */
  private async searchFilesViaSDK(query: string): Promise<{ items: Array<{ path: string; name: string }>; source: string }> {
    try {
      const client = await this.serverManager.ensureRunning();

      const response = await client.find.files({
        query: {
          query: query || "",
        },
      });

      if (response.data && Array.isArray(response.data)) {
        const items = response.data.map((filePath: string) => {
          const name = filePath.split(/[\\/]/).pop() || filePath;
          return { path: filePath, name };
        });
        return { items, source: 'opencode-sdk' };
      }

    } catch (error) {
      log.warn('SDK file search failed, falling back to VS Code', { query, error: String(error) });
    }

    return this.searchFilesViaVSCode(query);
  }

  /**
   * Fallback file search using VS Code workspace API.
   */
  private async searchFilesViaVSCode(query: string): Promise<{ items: Array<{ path: string; name: string }>; source: string }> {
    if (!query) {
      return { items: [], source: 'vscode-fallback' };
    }

    const files = await vscode.workspace.findFiles(
      `**/*${query}*`,
      "**/node_modules/**",
      20,
    );

    const items = files.map((f) => {
      const relativePath = vscode.workspace.asRelativePath(f);
      return {
        path: relativePath,
        name: relativePath.split(/[\\/]/).pop() || relativePath,
      };
    });

    return { items, source: 'vscode-fallback' };
  }

  private async handleMentions(query: string) {
    const flow = log.startFeatureFlow('Mentions', { queryLength: query?.length ?? 0 });

    try {
      const client = await this.serverManager.ensureRunning();
      const q = (query || "").toLowerCase();
      const results: Array<{
        type: "agent" | "file" | "resource";
        [key: string]: unknown;
      }> = [];

      const [agentResults, fileResults, resourceResults] = await Promise.all([
        this.searchAgents(client, q).catch((e) => {
          log.warn("Agent search failed in handleMentions", { error: String(e) });
          return [] as Array<{ type: "agent"; id: string; name: string; description?: string; color?: string }>;
        }),
        this.searchFilesForMentions(client, q).catch((e) => {
          log.warn("File search failed in handleMentions", { error: String(e) });
          return [] as Array<{ type: "file"; path: string; name: string }>;
        }),
        this.searchMcpResources(client, q).catch((e) => {
          log.warn("Resource search failed in handleMentions", { error: String(e) });
          return [] as Array<{ type: "resource"; uri: string; name: string; description?: string; clientName: string; mimeType?: string }>;
        }),
      ]);

      results.push(...agentResults, ...fileResults, ...resourceResults);

      log.featureStep(flow, "mentions_completed", {
        agentCount: agentResults.length,
        fileCount: fileResults.length,
        resourceCount: resourceResults.length,
      });

      this.view?.webview.postMessage({
        type: "mentionResults",
        results,
      });

      log.endFeatureFlow(flow, { result: "completed", totalCount: results.length });
    } catch (error) {
      log.error("Mentions failed", { query }, error as Error);
      log.endFeatureFlow(flow, { result: "failed", error: String(error) });
      this.view?.webview.postMessage({ type: "mentionResults", results: [] });
    }
  }

  private async searchAgents(
    client: NonNullable<Awaited<ReturnType<typeof this.serverManager.ensureRunning>>>,
    query: string,
  ): Promise<Array<{ type: "agent"; id: string; name: string; description?: string; color?: string }>> {
    if (!client || typeof (client as any).app?.agents !== "function") {
      return [];
    }

    const HIDDEN_AGENTS = new Set(["compaction", "title", "summary"]);
    const response = await (client as any).app.agents();
    if (!response?.data || !Array.isArray(response.data)) {
      return [];
    }

    const agents = response.data
      .filter((a: any) => {
        const mode = a.mode as string;
        return (
          (mode === "primary" || mode === "all") &&
          !HIDDEN_AGENTS.has(a.name as string)
        );
      })
      .map((a: any) => {
        const id = a.name as string;
        const displayName = id.charAt(0).toUpperCase() + id.slice(1);
        return {
          type: "agent" as const,
          id,
          name: displayName,
          description: (a.description as string | undefined) ?? `OpenCode ${displayName} agent`,
          color: a.color as string | undefined,
        };
      });

    if (!query) return agents.slice(0, 10);
    return agents
      .filter((a: { name: string; id: string }) => a.name.toLowerCase().includes(query) || a.id.toLowerCase().includes(query))
      .slice(0, 10);
  }

  private async searchFilesForMentions(
    client: NonNullable<Awaited<ReturnType<typeof this.serverManager.ensureRunning>>>,
    query: string,
  ): Promise<Array<{ type: "file"; path: string; name: string }>> {
    const sdkResult = await this.searchFilesViaSDK(query);
    return sdkResult.items.map((item) => ({
      type: "file" as const,
      ...item,
    }));
  }

  private async searchMcpResources(
    client: NonNullable<Awaited<ReturnType<typeof this.serverManager.ensureRunning>>>,
    query: string,
  ): Promise<Array<{ type: "resource"; uri: string; name: string; description?: string; clientName: string; mimeType?: string }>> {
    const port = this.serverManager.getPort();
    if (!port) return [];

    const baseUrl = `http://127.0.0.1:${port}`;
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspace = workspaceFolders?.[0]?.uri?.fsPath ?? "";

    try {
      const fetchUrl = `${baseUrl}/experimental/resource?workspace=${encodeURIComponent(workspace)}`;
      const resp = await fetch(fetchUrl);
      if (!resp.ok) return [];

      const body = await resp.json() as Record<string, {
        name?: string;
        uri?: string;
        description?: string;
        mimeType?: string;
        client?: string;
      }>;

      const resources = Object.values(body || {})
        .filter((r) => r.name && r.uri && r.client)
        .map((r) => ({
          type: "resource" as const,
          uri: r.uri!,
          name: r.name!,
          description: r.description,
          clientName: r.client!,
          mimeType: r.mimeType,
        }));

      if (!query) return resources.slice(0, 10);
      return resources
        .filter((r) =>
          r.name.toLowerCase().includes(query) ||
          (r.description && r.description.toLowerCase().includes(query)) ||
          r.clientName.toLowerCase().includes(query)
        )
        .slice(0, 10);
    } catch {
      return [];
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
      this.logger.error("Failed to load OpenCode config", undefined, error instanceof Error ? error : new Error(String(error)));
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
    const flow = log.startFeatureFlow('SaveConfig', { filePath, contentLength: content.length });

    try {
      if (!filePath) {
        log.endFeatureFlow(flow, { result: 'failed', reason: 'No file path provided' });
        throw new Error("File path is required for saving configuration");
      }

      log.featureStep(flow, 'saving_config_file', { filePath, contentLength: content.length });
      const result = await this.configFilesProvider.saveFile(filePath, content);

      this.view?.webview.postMessage({
        type: "opencodeConfigSaved",
        success: result.success,
        error: result.error,
        filePath,
      });

      if (result.success) {
        this.logger.info(`OpenCode config saved: ${filePath}`);
        log.endFeatureFlow(flow, { result: 'completed', filePath });
      } else {
        log.endFeatureFlow(flow, { result: 'failed', error: result.error });
      }
    } catch (error) {
      this.logger.error("Failed to save OpenCode config", undefined, error instanceof Error ? error : new Error(String(error)));
      log.endFeatureFlow(flow, { result: 'failed', error: String(error) });
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
    const flow = log.startFeatureFlow('GetMcpStatus', {});

    try {
      log.featureStep(flow, 'fetching_mcp_status');
      const client = await this.serverManager.ensureRunning();

      log.featureStep(flow, 'fetching_mcp_and_tool_data');
      const [mcpRes, toolIdsRes] = await Promise.all([
        client.mcp.status(),
        client.tool.ids().catch(() => ({ data: [] })),
      ]);

      const servers = mcpRes.data ?? {};
      const toolIds: string[] = Array.isArray(toolIdsRes?.data)
        ? toolIdsRes.data
        : [];

      log.featureStep(flow, 'sending_status_to_webview', {
        serverCount: Object.keys(servers).length,
        toolCount: toolIds.length,
      });

      this.view?.webview.postMessage({
        type: "mcpStatus",
        servers,
        toolIds,
      });

      log.info(
        `MCP status sent: ${Object.keys(servers).length} server(s), ${toolIds.length} tool(s)`,
      );

      log.endFeatureFlow(flow, { result: 'completed', serverCount: Object.keys(servers).length, toolCount: toolIds.length });
    } catch (err) {
      log.error(
        "handleGetMcpStatus failed",
        {},
        err instanceof Error ? err : undefined,
      );
      log.endFeatureFlow(flow, { result: 'failed', error: String(err) });
    }
  }

  /**
   * Fetches LSP server status from the OpenCode SDK and forwards it to the
   * webview. The webview dispatches `SET_LSP_SERVERS` from the `lspStatus`
   * message.
   */
  private async handleGetLspStatus(): Promise<void> {
    const flow = log.startFeatureFlow('GetLspStatus', {});

    try {
      log.featureStep(flow, 'fetching_server_status');
      const client = await this.serverManager.ensureRunning();
      const workspaceDir = this.getWorkspaceDirectory();

      log.featureStep(flow, 'fetching_lsp_status', { workspaceDir });
      // Pass directory parameter to LSP status endpoint so the server
      // can detect language servers for the current workspace
      const res = workspaceDir
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? await client.lsp.status({ directory: workspaceDir } as any)
        : await client.lsp.status();

      const servers = Array.isArray(res.data) ? res.data : [];

      log.featureStep(flow, 'sending_status_to_webview', { serverCount: servers.length });
      this.view?.webview.postMessage({
        type: "lspStatus",
        servers,
      });

      log.info(
        `LSP status sent: ${servers.length} server(s)` +
        (workspaceDir ? ` for workspace: ${workspaceDir}` : ""),
      );

      log.endFeatureFlow(flow, { result: 'completed', serverCount: servers.length });
    } catch (err) {
      log.error(
        "handleGetLspStatus failed",
        {},
        err instanceof Error ? err : undefined,
      );
      log.endFeatureFlow(flow, { result: 'failed', error: String(err) });
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
      log.info("No agent set, defaulting to 'build'");
    }
  }

  private async summarizeSessionDiffForMessage(
    client: Awaited<ReturnType<OpencodeServerManager["ensureRunning"]>>,
    sessionId: string,
    messageId: string,
  ): Promise<MessageChangeSummary | undefined> {
    try {
      const workspaceDir = this.getWorkspaceDirectory();
      const diffResponse = workspaceDir
        ? await client.session.diff({
            path: { id: sessionId },
            query: { directory: workspaceDir, messageID: messageId },
          })
        : await client.session.diff({
            path: { id: sessionId },
            query: { messageID: messageId },
          });

      const diffData = Array.isArray(diffResponse?.data)
        ? (diffResponse.data as Array<Record<string, unknown>>)
        : [];
      this.logger.debug("session.diff response received", {
        sessionId,
        messageId,
        rows: diffData.length,
        withPatch: diffData.filter((row) => typeof row?.patch === "string" && row.patch.length > 0).length,
        withBeforeAfter: diffData.filter(
          (row) =>
            typeof row?.before === "string" &&
            row.before.length > 0 &&
            typeof row?.after === "string" &&
            row.after.length > 0,
        ).length,
        sampleFiles: diffData.slice(0, 8).map((row) => String(row?.file || "")),
      });

      const rows = Array.isArray(diffResponse?.data)
        ? (diffResponse.data as FileDiff[])
            .map((item) => {
              const itemRec = this.asRecord(item) || {};
              const file = this.firstNonEmptyString(itemRec.file);
              return {
                file,
                added:
                  typeof itemRec.additions === "number" && Number.isFinite(itemRec.additions)
                    ? Math.max(0, itemRec.additions)
                    : 0,
                deleted:
                  typeof itemRec.deletions === "number" && Number.isFinite(itemRec.deletions)
                    ? Math.max(0, itemRec.deletions)
                    : 0,
                diffExcerpt: this.buildSdkDiffExcerpt({
                  file,
                  before:
                    typeof itemRec.before === "string" ? itemRec.before : undefined,
                  after:
                    typeof itemRec.after === "string" ? itemRec.after : undefined,
                  patch:
                    typeof itemRec.patch === "string" ? itemRec.patch : undefined,
                }),
              };
            })
            .filter(
              (item): item is { file: string; added: number; deleted: number; diffExcerpt?: { header?: string; lines: string[]; added?: number; deleted?: number } } =>
                Boolean(item.file),
            )
        : [];

      if (rows.length === 0) {
        return undefined;
      }

      const MAX_PREVIEW_FILES = 20;
      const enrichedRows = await Promise.all(
        rows.map(async (row, index) => {
          if (index >= MAX_PREVIEW_FILES) {
            return row;
          }
          const enrichment = row.diffExcerpt
            ? undefined
            : await this.getDiffActivityEnrichment(row.file);
          const diffStats = enrichment?.diffStats;
          return {
            ...row,
            added:
              row.added > 0 || row.deleted > 0
                ? row.added
                : diffStats?.added ?? row.added,
            deleted:
              row.added > 0 || row.deleted > 0
                ? row.deleted
                : diffStats?.deleted ?? row.deleted,
            diffExcerpt: enrichment?.diffExcerpt ?? row.diffExcerpt,
          };
        }),
      );

      this.logger.debug("session.diff summary built", {
        sessionId,
        messageId,
        rows: enrichedRows.length,
        rowsWithExcerpt: enrichedRows.filter(
          (row) => Array.isArray(row.diffExcerpt?.lines) && row.diffExcerpt.lines.length > 0,
        ).length,
        rowsWithoutExcerpt: enrichedRows.filter(
          (row) => !Array.isArray(row.diffExcerpt?.lines) || row.diffExcerpt.lines.length === 0,
        ).map((row) => row.file).slice(0, 12),
      });

      const added = enrichedRows.reduce((sum, row) => sum + row.added, 0);
      const deleted = enrichedRows.reduce((sum, row) => sum + row.deleted, 0);

      return {
        messageId,
        filesChanged: enrichedRows.length,
        added,
        deleted,
        files: enrichedRows,
      };
    } catch (error) {
      this.logger.warn("Failed to summarize session diff for message", {
        sessionId,
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private messageHasFileChangeEvidence(message: unknown): boolean {
    const rec = this.asRecord(message);
    if (!rec) {
      return false;
    }

    if (Array.isArray(rec.edits) && rec.edits.length > 0) {
      return true;
    }

    const hasDiffStats = (value: unknown): boolean => {
      const diffStats = this.asRecord(value);
      if (!diffStats) {
        return false;
      }
      return (
        typeof diffStats.added === "number" ||
        typeof diffStats.deleted === "number" ||
        typeof diffStats.additions === "number" ||
        typeof diffStats.deletions === "number"
      );
    };

    const hasFileActivity = (value: unknown): boolean => {
      const item = this.asRecord(value);
      if (!item) {
        return false;
      }
      const activityDetail = this.asRecord(item.activityDetail);
      const toolName = this.firstNonEmptyString(
        item.tool,
        item.name,
        activityDetail?.tool,
      )?.toLowerCase();
      const partType = this.firstNonEmptyString(item.type, item.partType)
        ?.toLowerCase();
      return Boolean(
        this.firstNonEmptyString(
          item.file,
          item.filePath,
          item.path,
          activityDetail?.file,
        ) ||
          hasDiffStats(item.diffStats) ||
          hasDiffStats(activityDetail?.diffStats) ||
          this.asRecord(activityDetail?.diffExcerpt) ||
          partType === "patch" ||
          toolName?.includes("write") ||
          toolName?.includes("edit") ||
          toolName?.includes("replace"),
      );
    };

    const arraysToScan = [
      rec.steps,
      rec.progressEvents,
      rec.parts,
      rec.toolCalls,
      rec.tool_calls,
    ];
    return arraysToScan.some(
      (items) => Array.isArray(items) && items.some(hasFileActivity),
    );
  }

  private async handleUndoMessageChanges(
    messageId?: string,
    requestedSessionId?: string,
  ): Promise<void> {
    const targetMessageId = this.firstNonEmptyString(messageId);
    const targetSessionId = this.firstNonEmptyString(
      requestedSessionId,
      this.currentSessionId,
    );
    if (!targetMessageId || !targetSessionId) {
      return;
    }

    try {
      const client = await this.serverManager.ensureRunning();
      const workspaceDir = this.getWorkspaceDirectory();
      await client.session.revert({
        path: { id: targetSessionId },
        query: workspaceDir ? { directory: workspaceDir } : undefined,
        body: { messageID: targetMessageId },
      });

      await this.handleLoadSession(targetSessionId);
      await this.handleGetSessions();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to undo message changes", {
        messageId: targetMessageId,
        sessionId: targetSessionId,
        error: errorMessage,
      });
      vscode.window.showErrorMessage(`Failed to undo changes: ${errorMessage}`);
    }
  }

  private async handleReviewChanges(targetFiles?: string[]) {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        await vscode.commands.executeCommand("workbench.view.scm");
        return;
      }

      const cwd = workspaceFolder.uri.fsPath;
      const normalizedTargetFiles = Array.isArray(targetFiles)
        ? targetFiles
            .map((file) => file.trim())
            .filter((file) => file.length > 0)
        : [];

      // For specific files, open each in VSCode's default diff viewer
      if (normalizedTargetFiles.length > 0) {
        for (const file of normalizedTargetFiles) {
          const fullPath = path.isAbsolute(file) ? file : path.join(cwd, file);
          const fileUri = vscode.Uri.file(fullPath);
          await vscode.commands.executeCommand("git.openChange", fileUri);
        }
      } else {
        // No specific files - show SCM view
        await vscode.commands.executeCommand("workbench.view.scm");
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(
        `Failed to open changes: ${error.message}`,
      );
    }
  }

  private buildDiffExcerpt(diffOutput: string): {
    header?: string;
    lines: string[];
    added?: number;
    deleted?: number;
  } | undefined {
    const diffFiles = this.parseUnifiedDiff(diffOutput);
    if (diffFiles.length === 0) {
      return undefined;
    }
    const firstFile = diffFiles[0];
    const firstHunk = Array.isArray(firstFile.hunks) ? firstFile.hunks[0] : undefined;
    if (!firstHunk || !Array.isArray(firstHunk.lines) || firstHunk.lines.length === 0) {
      return undefined;
    }
    return {
      header: typeof firstHunk.header === "string" ? firstHunk.header : undefined,
      lines: firstHunk.lines.slice(0, 40).map((line: unknown) =>
        typeof line === "string" ? line.slice(0, 300) : "",
      ),
      added:
        typeof firstFile.added === "number" && Number.isFinite(firstFile.added)
          ? firstFile.added
          : undefined,
      deleted:
        typeof firstFile.deleted === "number" && Number.isFinite(firstFile.deleted)
          ? firstFile.deleted
          : undefined,
    };
  }

  private buildSdkDiffExcerpt(
    diff: { file?: string; before?: string; after?: string; patch?: string },
  ): {
    header?: string;
    lines: string[];
    added?: number;
    deleted?: number;
  } | undefined {
    const patchText = typeof diff.patch === "string" ? diff.patch : "";
    if (patchText.trim().length > 0) {
      return this.buildDiffExcerpt(patchText);
    }

    const beforeText = typeof diff.before === "string" ? diff.before : "";
    const afterText = typeof diff.after === "string" ? diff.after : "";
    if (!beforeText && !afterText) {
      return undefined;
    }

    const beforeLines = beforeText.split("\n");
    const afterLines = afterText.split("\n");
    const maxLines = Math.max(beforeLines.length, afterLines.length);
    let firstDiffIndex = 0;
    for (let i = 0; i < maxLines; i++) {
      if ((beforeLines[i] ?? "") !== (afterLines[i] ?? "")) {
        firstDiffIndex = i;
        break;
      }
    }
    const start = Math.max(0, firstDiffIndex - 2);
    const end = Math.min(maxLines, start + 10);
    const lines: string[] = [];
    for (let i = start; i < end; i++) {
      const beforeLine = beforeLines[i];
      const afterLine = afterLines[i];
      if (beforeLine === afterLine) {
        if (typeof beforeLine === "string") {
          lines.push(` ${beforeLine.slice(0, 299)}`);
        }
        continue;
      }
      if (typeof beforeLine === "string") {
        lines.push(`-${beforeLine.slice(0, 299)}`);
      }
      if (typeof afterLine === "string") {
        lines.push(`+${afterLine.slice(0, 299)}`);
      }
    }

    if (lines.length === 0) {
      return undefined;
    }

    return {
      header: diff.file ? `@@ ${diff.file} @@` : undefined,
      lines,
    };
  }

  private async getDiffActivityEnrichment(
    filePath: string,
  ): Promise<
    | {
      diffStats?: { added: number; deleted: number };
      diffExcerpt?: { header?: string; lines: string[]; added?: number; deleted?: number };
    }
    | undefined
  > {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) return undefined;

      const workspacePath = workspaceFolder.uri.fsPath;
      const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspacePath, filePath);
      const relativePath = path.relative(workspacePath, fullPath).replace(/\\/g, "/");
      const cwd = workspacePath;

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

      const candidates = Array.from(
        new Set(
          [filePath, relativePath, fullPath]
            .map((value) => value.trim())
            .filter((value) => value.length > 0 && !value.startsWith("..")),
        ),
      );

      let diffOutput = "";
      try {
        for (const candidate of candidates) {
          diffOutput = await runGit("diff", "HEAD", "--", candidate);
          if (!diffOutput) {
            diffOutput = await runGit("diff", "--cached", "--", candidate);
          }
          if (diffOutput) {
            break;
          }
        }
        if (!diffOutput) {
          // New file fallback
          try {
            const fileUri = vscode.Uri.file(fullPath);
            const content = await vscode.workspace.fs.readFile(fileUri);
            const text = new TextDecoder().decode(content);
            const lines = text.split("\n");
            return {
              diffStats: { added: lines.length, deleted: 0 },
              diffExcerpt: {
                header: `@@ -0,0 +1,${lines.length} @@`,
                lines: lines.slice(0, 40).map((line) => `+${line.slice(0, 299)}`),
                added: lines.length,
                deleted: 0,
              },
            };
          } catch {
            return undefined;
          }
        }
      } catch {
        return undefined;
      }

      if (diffOutput) {
        const diffFiles = this.parseUnifiedDiff(diffOutput);
        if (diffFiles.length > 0 && diffFiles[0]) {
          return {
            diffStats: {
              added: diffFiles[0].added,
              deleted: diffFiles[0].deleted,
            },
            diffExcerpt: this.buildDiffExcerpt(diffOutput),
          };
        }
      }
      return undefined;
    } catch (error) {
      log.error("getDiffActivityEnrichment error", {}, error as Error);
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

      // Use VS Code's builtin git diff viewer
      // Try git.openChange command first (available in VS Code's git extension)
      try {
        await vscode.commands.executeCommand("git.openChange", fileUri);
        return;
      } catch {
        // Fallback: open the file normally - VS Code will show git diff decorations
        await vscode.commands.executeCommand("vscode.open", fileUri);
      }
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
      log.debug("Injected theme CSS into webview");
    } catch (error) {
      log.error(
        "Failed to send theme data to webview",
        {},
        error as Error,
      );
    }
  }
}
