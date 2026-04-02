/**
 * REFACTORING GUIDE: ChatViewProvider.ts Shell Transformation
 *
 * This document shows the key changes needed to transform ChatViewProvider.ts
 * into a thin orchestration shell that uses the extracted modules.
 *
 * ==============================================================================
 * 1. ADD NEW IMPORTS
 * ==============================================================================
 */

// Add these imports after the existing imports (around line 135):
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
} from "./chat/index";

/*
 * ==============================================================================
 * 2. ADD MODULE FIELDS (around line 430, after existing fields)
 * ==============================================================================
 */

export class ChatViewProvider implements vscode.WebviewViewProvider, FileThemeProcessorObserver {
  // ... existing fields ...

  /** ===== NEW: Module instances ===== */
  private diagnosticsLogger: DiagnosticsLogger;
  private structuredOutputProcessor: StructuredOutputProcessor;
  private planManager: PlanManager;
  private subagentPersistence: SubagentPersistence;
  private compactionManager: CompactionManager;
  private historyProcessor: HistoryProcessor;
  private modelAndAgentManager: ModelAndAgentManager;
  private queueManager: QueueManager;
  private sessionHandler: SessionHandler;
  private streamEventHandler: StreamEventHandler;

  /** ===== REMOVED: These fields are now owned by modules ===== */
  // private renderParityLogWriteChain: Promise<void> = Promise.resolve();
  // private renderParityDebugFilePath?: string;
  // private didLogRenderParityFilePath = false;
  // private promptDebugBySession = new Map<string, Record<string, unknown>>();
  // private structuredOutputMode: "format" | "outputFormat" | "disabled" = "format";
  // private readonly structuredValidationFailureCounters = new Map<string, number>();
  // private readonly structuredOutputIncompatibleModelKeys = new Set<string>();
  // private compactingSessions = new Set<string>();
  // private queueBySessionId = new Map<string, QueuedPrompt[]>();
  // private queueItemSequence = 0;
  // private executingQueueSessionIds = new Set<string>();
  // private selectedModel: { providerID: string; modelID: string; providerName?: string };
  // private availableModels: ChatModelOption[] = [];
  // private selectedAgent?: string;
  // private modelsFetchPromise: Promise<ChatModelOption[]> | null = null;
  // private commandCatalog: ChatSlashCommand[] = [];
  // private commandCatalogFetchedAt = 0;
  // private sessionsListRequestVersion = 0;
  // private lastSessionsPayloadFingerprint = "";
  // private processingSessionIds = new Set<string>();

  /*
   * ==============================================================================
   * 3. UPDATE CONSTRUCTOR (around line 650)
   * ==============================================================================
   */

  constructor(
    private context: vscode.ExtensionContext,
    private serverManager: OpencodeServerManager,
    private sessionService: SessionService,
    private skillManagerService: SkillManagerService,
    private streamService: MessageStreamService,
    private quotaService: QuotaService,
    private subagentTracker: SubagentTracker,
    private geminiTokenTracker: GeminiTokenUsageTracker,
    private planViewProvider: PlanViewProvider,
    private modelCapabilitiesService: ModelCapabilitiesService,
    private configFilesProvider: ConfigFilesProvider,
  ) {
    // ... existing initialization up to line 680 ...

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

    // Create logger
    const logger = this.logger;

    // 1. DiagnosticsLogger
    this.diagnosticsLogger = new DiagnosticsLogger(
      logger,
      asRecord,
      firstNonEmptyString,
      // Pass other required callbacks
      this.extractMessageBodyText.bind(this),
      this.historyMessageCreatedAt.bind(this),
      this.extractHistoryMessageId.bind(this),
      this.isRenderableHistoryMessage.bind(this),
      this.historyMessageFingerprint.bind(this),
    );

    // 2. StructuredOutputProcessor
    this.structuredOutputProcessor = new StructuredOutputProcessor(
      logger,
      asRecord,
      firstNonEmptyString,
    );

    // 3. PlanManager
    this.planManager = new PlanManager(
      logger,
      firstNonEmptyString,
      this.context.globalState,
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
  }

  /*
   * ==============================================================================
   * 4. UPDATE STREAM SUBSCRIPTION (around line 1543)
   * ==============================================================================
   */

  // In resolveWebviewView(), replace the existing stream subscription with:
  this.unsubscribe = this.streamService.subscribe(async (event) => {
    await this.streamEventHandler.handleStreamEvent(event);
  });

  /*
   * ==============================================================================
   * 5. SIMPLIFY MESSAGE DISPATCH (around line 1300-1800)
   * ==============================================================================
   */

  // In onDidReceiveMessage(), replace switch cases with module delegations:

  private async onDidReceiveMessage(message: any): Promise<void> {
    switch (message.type) {
      // Session management
      case "getSessions":
        await this.sessionHandler.handleGetSessions();
        break;

      case "loadSession":
        await this.sessionHandler.handleLoadSession(message);
        break;

      case "deleteSession":
        await this.sessionHandler.handleDeleteSession(message);
        break;

      case "renameSession":
        await this.sessionHandler.handleRenameSession(message);
        break;

      // Queue management
      case "addToQueue":
        const prompt = this.queueManager.createQueuedPrompt(
          message.sessionId || this.currentSessionId || "",
          message.text,
          message.mode || "send-now",
          {
            userFacingText: message.userFacingText,
            files: message.files,
            contexts: message.contexts,
            images: message.images,
            agent: message.agent,
          },
        );
        await this.queueManager.enqueuePrompt(prompt);
        break;

      case "executeQueue":
        await this.queueManager.handleExecuteQueue(message);
        break;

      case "clearQueue":
        await this.queueManager.handleClearQueue(message);
        break;

      case "removeFromQueue":
        await this.queueManager.handleRemoveFromQueue(message);
        break;

      case "dispatchQueuedItem":
        await this.queueManager.handleDispatchQueuedItem(message);
        break;

      // Model and agent management
      case "getModels":
        const models = await this.modelAndAgentManager.handleGetModels();
        break;

      case "selectModel":
        await this.modelAndAgentManager.setSelectedModel(message.model);
        break;

      case "getAgents":
        await this.modelAndAgentManager.handleGetAgents();
        break;

      case "selectAgent":
        this.modelAndAgentManager.setSelectedAgent(message.agent);
        break;

      case "getCommands":
        await this.modelAndAgentManager.handleGetCommands();
        break;

      // Plan management
      case "viewPlan":
        await this.planManager.handleViewPlan(message.plan, this.planViewProvider);
        break;

      // Compaction
      case "setCompactionViewState":
        await this.compactionManager.handleSetCompactionViewState(message);
        break;

      case "compactSession":
        await this.compactionManager.handleCompactSession(
          message.sessionId,
          { auto: false },
          this.sessionService,
        );
        break;

      // Keep core message sending in shell (complex orchestration)
      case "sendMessage":
        await this.handleSendMessage(
          message.text,
          message.sessionId,
          {
            files: message.files,
            contexts: message.contexts,
            images: message.images,
          },
          message.agent,
        );
        break;

      // ... other simple cases remain unchanged ...
    }
  }

  /*
   * ==============================================================================
   * 6. DELETE EXTRACTED METHODS (lines 478-5108 approximately)
   * ==============================================================================
   */

  // DELETE these methods - they're now in modules:
  // - getMessageOverrideStorageKey through clearSessionMessageOverrides (478-486)
  // - processHistoryMessages through hasAssistantHistoryAdvanced (2095-3032)
  // - logStreamEventDiagnostics through shouldVerboseStreamDebug (4586-5090)
  // - getSubagentSnapshotStorageKey through syncSubagentSnapshotForSession (4127-5108)
  // - normalizePlanFileReference through resolvePlanTitle (3256-3387, 7760-7795, 8673-9132)
  // - getCompactionViewStateStorageKey through forwardCompactionStatusFromStreamEvent (4229-8287)
  // - handleGetModels through applySessionSettings (9404-9893, 3199-3219, 8538-8556)
  // - getSessionQueue through sendQueueUpdate (10368-10852)

  /*
   * ==============================================================================
   * 7. KEEP IN SHELL (Core orchestration methods)
   * ==============================================================================
   */

  // KEEP these methods - they're core orchestration:
  // - resolveWebviewView (webview lifecycle)
  // - getHtmlContent (webview HTML generation)
  // - refreshView (re-render trigger)
  // - handleSendMessage (complex send orchestration)
  // - promptWithStructuredOutput (structured output wrapper)
  // - sleep / tryRecoverTimedOutResponse (utilities)
  // - All VS Code integration methods
  // - All todo persistence helpers
  // - All skill message handlers
  // - Public API methods (appendToPrompt, addContext, etc.)
  // - sendBudgetInfo (budget methods)
  // - Utility methods (asRecord, extractEventSessionId, etc.)

  /*
   * ==============================================================================
   * 8. UPDATE dispose() METHOD
   * ==============================================================================
   */

  dispose(): void {
    this.unsubscribe?.();
    // Modules don't need explicit disposal in this architecture
  }
}
