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
import {
  FileThemeProcessor,
  CssGenerator,
  FileThemeProcessorObserver,
  FileThemeProcessorState,
} from "vscode-file-theme-processor";
import { OpencodeServerManager } from "../services/OpencodeServerManager";
import { SessionService } from "../services/SessionService";
import { MessageStreamService } from "../services/MessageStreamService";
import type { Command as SdkCommand, SessionPromptData } from "@opencode-ai/sdk";
import { QuotaService } from "../services/QuotaService";
import { RequestBudgeter } from "../services/RequestBudgeter";
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

const log = createLogger("ChatViewProvider");
type QueuedPrompt = {
  id: string;
  sessionId: string;
  createdAt: number;
  text: string;
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
  assistantMessage?: string;
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

  /** Service for tracking Gemini token usage from stream events */
  private geminiTokenTracker: GeminiTokenUsageTracker;
  /** Service for managing daily request budgets */
  private budgeter: RequestBudgeter;

  private fileThemeProcessor: FileThemeProcessor;
  private cssGenerator: CssGenerator;
  private currentThemeCss: string | undefined;

  /** Logger for tracking events and metrics */
  private readonly logger: ReturnType<typeof createLogger>;

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

  /** Session-scoped queue of prompts awaiting execution */
  private queueBySessionId = new Map<string, QueuedPrompt[]>();
  private queueItemSequence = 0;

  /** Flag indicating if queue is currently being executed */
  private isExecutingQueue: boolean = false;

  private isProcessingRequest: boolean = false;
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
  private modelsFetchPromise: Promise<ChatModelOption[]> | null = null;
  private commandCatalog: ChatSlashCommand[] = [];
  private commandCatalogFetchedAt = 0;
  private commandCatalogFetchPromise: Promise<ChatSlashCommand[]> | null = null;
  private readonly COMMAND_CATALOG_TTL_MS = 5 * 60 * 1000;
  private readonly compactingSessions = new Set<string>();

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
  ) {
    this.logger = createLogger("ChatViewProvider");
    this.streamService = new MessageStreamService(serverManager);
    this.quotaService = new QuotaService();
    this.subagentTracker = new SubagentTracker();
    this.budgeter = new RequestBudgeter();
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
      console.log(
        `[ChatViewProvider] Loaded persisted model: ${savedModel.modelID} (${savedModel.providerID})`,
      );
      this.selectedModel = savedModel;
    } else if (savedModel) {
      console.warn(
        "[ChatViewProvider] Ignoring invalid persisted model selection. Expected {providerID, modelID}.",
      );
    }
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    console.log("[ChatViewProvider] resolving webview view");
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
            // Fetch models first to ensure we have correct provider IDs
            const models = await this.handleGetModels();

            // Reconcile selected model by full identity (provider + model), not model ID alone.
            await this.reconcileSelectedModelSelection(models);

            // Sync default agent selection
            await this.syncCLIAgents();

            // Fetch and send full agents list to webview
            await this.handleGetAgents();

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

            // Send initial budget status
            this.sendBudgetInfo();

            // Fetch and send chat history and sessions list
            if (currentSession) {
              this.subagentTracker.setActiveSession(currentSession.id);
              const rawMessages = await this.sessionService.getMessages(
                currentSession.id,
              );
              const messages = this.processHistoryMessages(rawMessages);
              this.view?.webview.postMessage({
                type: "chatHistory",
                messages: messages,
              });
              await this.sendPersistedCompactionViewState(currentSession.id);
              await this.syncSubagentSnapshotForSession(
                currentSession.id,
                messages as any[],
              );
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

          await this.schedulePromptDispatch(
            this.isProcessingRequest ? "queue" : "send-now",
            {
              sessionId: message?.sessionId,
              text: composedPrompt,
              agent: message?.agent,
            },
          );
          break;
        }
        case "batchInteractiveResponse": {
          const responses = message.responses as Array<{
            eventId: string;
            eventType: string;
            text: string;
          }>;
          if (!responses || responses.length === 0) {
            break;
          }

          const composedPrompt = responses
            .map((resp) => this.firstNonEmptyString(resp.text) || "")
            .filter((value) => value.length > 0)
            .join("\n");
          if (!composedPrompt) {
            break;
          }

          await this.schedulePromptDispatch(
            this.isProcessingRequest ? "queue" : "send-now",
            {
              sessionId: message?.sessionId,
              text: composedPrompt,
              agent: message?.agent,
            },
          );
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
        case "searchFiles": {
          await this.handleSearchFiles(message.query);
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
            console.warn(
              "[ChatViewProvider] Ignoring invalid model selection payload; providerID and modelID are required.",
              incoming,
            );
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
              model: this.selectedModel,
            });
          }
          console.log(
            `[ChatViewProvider] Persisted model selection: ${this.selectedModel.modelID} (${this.selectedModel.providerName})`,
          );
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
          const { level, message: logMsg } = message;
          const cappedLog =
            typeof logMsg === "string" && logMsg.length > 2000
              ? `${logMsg.slice(0, 2000)}...[truncated ${logMsg.length - 2000} chars]`
              : logMsg;
          const prefix = "[WebView]";
          switch (level) {
            case "error":
              console.error(prefix, cappedLog);
              break;
            case "warn":
              console.warn(prefix, cappedLog);
              break;
            default:
              console.log(prefix, cappedLog);
              break;
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
            console.log(`[ChatViewProvider] Thinking level set to ${level}`);
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
          if (this.lastSendMessageArgs && !this.isProcessingRequest) {
            const retryWithoutStructuredOutput =
              message.retryWithoutStructuredOutput === true;
            if (this.currentSessionId) {
              try {
                const rawMessages = await this.sessionService.getMessages(
                  this.currentSessionId,
                );
                const messages = this.processHistoryMessages(rawMessages);
                this.view?.webview.postMessage({
                  type: "chatHistory",
                  sessionId: this.currentSessionId,
                  messages: messages,
                });
              } catch (err) {
                console.error("Failed to load messages for retry", err);
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
          console.log("[ChatViewProvider] planProceed received");
          this.view?.webview.postMessage({
            type: "planProceedAck",
            payload: { received: true },
          });
          break;
        }
      }
    });

    // Subscribe to stream events
    this.unsubscribe = this.streamService.subscribe(async (event) => {
      this.logStreamEventDiagnostics(event);

      const subagentUpdate = this.subagentTracker.consumeStreamEvent(event);
      if (subagentUpdate) {
        this.view?.webview.postMessage({
          type: "subagentUpdate",
          ...subagentUpdate,
        });
        void this.persistSubagentUpdateSnapshot(subagentUpdate).catch(
          (persistError) => {
            console.warn(
              "[ChatViewProvider] Failed to persist subagent stream snapshot:",
              persistError,
            );
          },
        );
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
       console.error("[ChatViewProvider] Failed to log stream event:", error);
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
          if (this.currentSessionId) {
            const key = `opencode.session.todos.${this.currentSessionId}`;
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

            interface StoredTodoItem { id: string; text: string; status: string; [key: string]: unknown }

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
          console.warn("[ChatViewProvider] Failed to persist todo snapshot:", err);
        }
      }

     this.view?.webview.postMessage({
       type: "streamEvent",
       event: enrichedEvent,
     });
      if (this.shouldVerboseStreamDebug()) {
        console.log("[ChatViewProvider] streamEvent forwarded", {
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
                  console.error(
                    "[ChatViewProvider] Failed to get diff stats async:",
                    err,
                  );
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
  private async handleGetSessions(): Promise<void> {
    const requestVersion = ++this.sessionsListRequestVersion;

    try {
      const sessions = await this.sessionService.listSessions();
      const currentSession = await this.sessionService.getCurrentSession();

      // Transform Session objects to match webview expectations
      // SDK Session has nested `time.created`, webview expects `createdAt`
      const transformedSessions = sessions.map((s: any) => ({
        id: s.id,
        title: s.title,
        createdAt: s.time?.created,
        parentSessionId:
          s.parentID || s.parentId || s.parentSessionId || undefined,
      }));
      const sessionsById = new Map<string, (typeof transformedSessions)[number]>();
      for (const session of transformedSessions) {
        if (!session?.id || typeof session.id !== "string") {
          continue;
        }
        const id = session.id.trim();
        if (!id) {
          continue;
        }

        const normalizedSession =
          id === session.id ? session : { ...session, id };
        const existing = sessionsById.get(id);
        if (!existing) {
          sessionsById.set(id, normalizedSession);
          continue;
        }

        const existingCreatedAt = existing.createdAt ?? 0;
        const incomingCreatedAt = normalizedSession.createdAt ?? 0;
        const preferred =
          incomingCreatedAt >= existingCreatedAt
            ? normalizedSession
            : existing;
        const fallback = preferred === normalizedSession ? existing : normalizedSession;

        sessionsById.set(id, {
          ...fallback,
          ...preferred,
          id,
          title: preferred.title || fallback.title,
          parentSessionId:
            preferred.parentSessionId || fallback.parentSessionId || undefined,
        });
      }
      const dedupedSessions = Array.from(sessionsById.values()).sort(
        (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
      );
      const currentSessionId = currentSession?.id;

      // Ignore stale async results so an older list response cannot clobber a newer one.
      if (requestVersion !== this.sessionsListRequestVersion) {
        return;
      }

      const payloadFingerprint = JSON.stringify({
        currentSessionId,
        sessions: dedupedSessions.map((session) => ({
          id: session.id,
          title: session.title ?? "",
          createdAt: session.createdAt ?? null,
          parentSessionId: session.parentSessionId ?? null,
        })),
      });
      if (payloadFingerprint === this.lastSessionsPayloadFingerprint) {
        return;
      }
      this.lastSessionsPayloadFingerprint = payloadFingerprint;

      this.view?.webview.postMessage({
        type: "sessionsList",
        sessions: dedupedSessions,
        currentSessionId,
      });
    } catch (error) {
      console.error("Failed to get sessions:", error);
    }
  }

  /**
   * Handles switching to a specific session
   */
  private async handleLoadSession(sessionId: string): Promise<void> {
    try {
      await this.sessionService.switchSession(sessionId);
      this.currentSessionId = sessionId;
      this.subagentTracker.setActiveSession(sessionId);
      // Clear in-memory todo cache to avoid cross-session leakage; will be
      // rehydrated from persisted snapshot when initState is sent.
      this.clearSessionTodos();

      // Restore per-session agent / model / thinking selections
      await this.applySessionSettings(sessionId);

      // Notify the webview of the restored selections for this session
            this.view?.webview.postMessage({
              type: "initState",
              serverStatus: this.serverManager.getStatus(),
              selectedModel: this.selectedModel,
              selectedAgent: this.selectedAgent,
              serverVersion: this.serverManager.getVersion(),
              currentSessionId: this.currentSessionId,
              todoItems: this.loadPersistedTodos(this.currentSessionId).items,
            });
      const sessionThinkingLevel =
        this.getSessionSettings(sessionId).thinkingLevel ??
        this.context.globalState.get<string>("thinkingLevel");
      if (sessionThinkingLevel) {
        this.view?.webview.postMessage({
          type: "thinkingLevelUpdate",
          level: sessionThinkingLevel,
        });
      }

      // Reload history for the new session
      const rawMessages = await this.sessionService.getMessages(sessionId);
      const messages = this.processHistoryMessages(rawMessages);

      this.view?.webview.postMessage({
        type: "chatHistory",
        sessionId: sessionId,
        messages: messages,
      });
      await this.sendPersistedCompactionViewState(sessionId);
      await this.syncSubagentSnapshotForSession(sessionId, messages as any[]);
      this.sendQueueUpdate(sessionId);

      // Update the list selection
      await this.handleGetSessions();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to load session: ${error}`);
    }
  }

  /**
   * Handles deleting a session
   */
  private async handleDeleteSession(sessionId: string): Promise<void> {
    try {
      // Get current session before deletion to check if we're deleting the active one
      const wasCurrentSession =
        (await this.sessionService.getCurrentSession())?.id === sessionId;

      await this.sessionService.deleteSession(sessionId);
      this.queueBySessionId.delete(sessionId);
      await this.clearPersistedSubagentSnapshot(sessionId);
      await this.clearPersistedCompactionViewState(sessionId);
      // Clear persisted todo state for the deleted session
      this.clearSessionTodos(sessionId);
      await this.handleGetSessions();

      // If we deleted the current session, create a new one and clear messages
      if (wasCurrentSession) {
        let currentSession = await this.sessionService.getCurrentSession();
        if (!currentSession) {
          currentSession = await this.sessionService.createNewSession();
        }
        this.currentSessionId = currentSession?.id;
        // Clear in-memory todo cache when active session changes after deletion
        this.clearSessionTodos();
        this.subagentTracker.resetForSession(currentSession?.id || null);
        this.view?.webview.postMessage({
          type: "chatHistory",
          messages: [],
        });
        this.view?.webview.postMessage({
          type: "subagentSnapshot",
          ...this.subagentTracker.getSnapshotPayload(),
        });
        if (this.currentSessionId) {
          this.sendQueueUpdate(this.currentSessionId);
        }
        await this.handleGetSessions();
      } else {
        this.sendQueueUpdate(this.currentSessionId);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to delete session: ${error}`);
    }
  }

  /**
   * Handles renaming a session.
   *
   * Updates the session title on the server and refreshes the session list.
   *
   * @param sessionId - The ID of the session to rename
   * @param newTitle - The new title for the session
   */
  private async handleRenameSession(
    sessionId: string,
    newTitle: string,
  ): Promise<void> {
    try {
      await this.sessionService.renameSession(sessionId, newTitle);
      await this.handleGetSessions(); // Refresh the session list
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to rename session: ${error}`);
    }
  }

  /**
   * Processes raw history messages by stripping legacy system instructions,
   * applying structured outputs, and enriching with plans.
   */
  private processHistoryMessages(rawMessages: any[]): any[] {
    return rawMessages.map((m: any) => {
      if (m.role === "user" && Array.isArray(m.parts)) {
        m.parts = m.parts.map((p: any) => {
          if (p.type === "text" && typeof p.text === "string") {
            const stripped = this.stripLegacyInstruction(p.text);
            if (stripped !== p.text) {
              return { ...p, text: stripped };
            }
          }
          return p;
        });
      }
      return this.enrichMessageWithPlan(this.applyStructuredOutputToMessage(m));
    });
  }

  private stripLegacyInstruction(text: string): string {
    if (!text) return "";
    const legacyInstruction = this.getLegacySystemInstruction();
    const legacyWithNewline = legacyInstruction + "\n";

    if (text.startsWith(legacyWithNewline)) {
      return text.substring(legacyWithNewline.length);
    }
    if (text.startsWith(legacyInstruction)) {
      return text.substring(legacyInstruction.length);
    }
    return text;
  }

  /**
   * Gets the unified system instruction
   */
  private getLegacySystemInstruction(): string {
    return [
      "You are an assistant integrated in a VS Code extension UI that expects structured JSON output.",
      "Always produce a JSON object matching the provided json_schema when structured output format is enabled.",
      "Set responseType explicitly and keep message concise for chat rendering.",
      "responseType rules:",
      "- implementation_plan: put full markdown only in plan.content, include plan.title, keep message short.",
      "- question: use top-level question object (type/question/options). Do not return plain prose questions.",
      "- If you need clarifications before planning, use responseType question with question payload and do not emit implementation_plan.",
      "- progress_update: use progressUpdates for machine-readable steps.",
      "- subagents: include subagents[] with id/name/status/latestActivity and optional progress/thinking/timeline events.",
      "For subagent updates, prioritize structured fields over narrative text so the UI can render clickable subagent cards.",
    ].join("\n");
  }

  private getStructuredOutputFormat(): Record<string, unknown> {
    const topLevel = structuredOutputSchema as unknown as Record<string, unknown>;
    const schemaRecord = this.asRecord(topLevel.schema);
    const properties = this.asRecord(schemaRecord?.properties) ?? {};
    const required = Array.isArray(schemaRecord?.required)
      ? (schemaRecord?.required as string[]).filter(
        (item) => typeof item === "string" && item.trim().length > 0,
      )
      : ["responseType"];

    // Send a docs-style minimal JSON schema to maximize compatibility across providers.
    return {
      type: "json_schema",
      retryCount:
        typeof topLevel.retryCount === "number" ? topLevel.retryCount : 1,
      schema: {
        type: "object",
        properties,
        required,
      },
    };
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
    const primaryAttempt = await callPrompt(withSchema(primaryMode));
    if (!primaryAttempt.error) {
      return primaryAttempt;
    }

    if (!this.isStructuredFormatUnsupportedError(primaryAttempt.error)) {
      return primaryAttempt;
    }

    const secondaryMode: "format" | "outputFormat" =
      primaryMode === "format" ? "outputFormat" : "format";
    const secondaryAttempt = await callPrompt(withSchema(secondaryMode));
    if (!secondaryAttempt.error) {
      this.structuredOutputMode = secondaryMode;
      return secondaryAttempt;
    }

    if (this.isStructuredFormatUnsupportedError(secondaryAttempt.error)) {
      this.structuredOutputMode = "disabled";
      log.warn(
        "Structured output format is not supported by this OpenCode server version. Falling back to plain prompts.",
      );
      return callPrompt(body as Record<string, unknown>);
    }

    return secondaryAttempt;
  }

  private shouldUseStructuredOutput(
    _parts: Array<Record<string, unknown>>,
    _agent?: string,
  ): boolean {
    if (this.structuredOutputMode === "disabled") {
      return false;
    }
    const modelKey = this.getSelectedStructuredOutputModelKey();
    if (
      modelKey &&
      this.structuredOutputIncompatibleModelKeys.has(modelKey)
    ) {
      return false;
    }

    return true;
  }

  private resolvePromptVariant(sessionId: string): string | undefined {
    const savedLevel =
      this.getSessionSettings(sessionId).thinkingLevel ??
      this.context.globalState.get<string>("thinkingLevel");
    if (!savedLevel) {
      return undefined;
    }

    const normalizedLevel = savedLevel.toLowerCase().trim();
    if (!normalizedLevel) {
      return undefined;
    }

    // Claude "thinking" model families commonly expose "max" rather than "high".
    const modelID = (this.selectedModel.modelID || "").toLowerCase();
    if (
      normalizedLevel === "high" &&
      modelID.includes("claude") &&
      modelID.includes("thinking")
    ) {
      return "max";
    }

    return normalizedLevel;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  }

  private firstNonEmptyString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private getStructuredOutputModelKey(
    providerID?: string,
    modelID?: string,
  ): string | undefined {
    const provider = this.firstNonEmptyString(providerID)?.toLowerCase();
    const model = this.firstNonEmptyString(modelID)?.toLowerCase();
    if (!provider || !model) {
      return undefined;
    }
    return `${provider}/${model}`;
  }

  private getSelectedStructuredOutputModelKey(): string | undefined {
    return this.getStructuredOutputModelKey(
      this.selectedModel.providerID,
      this.selectedModel.modelID,
    );
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

  private extractErrorMessage(error: unknown, fallback: string): string {
    const candidates = this.collectErrorMessageCandidates(error)
      .map((candidate) => this.normalizeErrorCandidate(candidate))
      .filter((candidate): candidate is string => Boolean(candidate));

    if (candidates.length === 0) {
      return fallback;
    }

    const deduped: string[] = [];
    for (const candidate of candidates) {
      if (!deduped.includes(candidate)) {
        deduped.push(candidate);
      }
    }

    const specific = deduped.find(
      (candidate) => !this.isGenericErrorMessage(candidate),
    );
    return specific || deduped[0];
  }

  private shouldVerboseStreamDebug(): boolean {
    const level = vscode.workspace
      .getConfiguration("opencode.logging")
      .get<string>("level", "info");
    return typeof level === "string" && level.toLowerCase() === "debug";
  }

  private isReasoningPartLike(part: unknown): boolean {
    const rec = this.asRecord(part);
    if (!rec) return false;
    const type = this.firstNonEmptyString(rec.type)?.toLowerCase();
    return (
      type === "reasoning" ||
      type === "thinking" ||
      type === "thought" ||
      typeof rec.reasoning !== "undefined" ||
      typeof rec.thinking !== "undefined" ||
      typeof rec.thought !== "undefined"
    );
  }

  private isRenderableTextPart(part: unknown): boolean {
    const rec = this.asRecord(part);
    if (!rec || this.isReasoningPartLike(rec)) return false;
    return (
      rec.type === "text" ||
      typeof rec.text === "string" ||
      typeof rec.content === "string"
    );
  }

  private isInteractiveResponseType(value: unknown): boolean {
    const responseType = this.firstNonEmptyString(value)?.toLowerCase();
    return responseType === "question";
  }

  private isClarificationQuestionnaire(content: unknown): boolean {
    if (typeof content !== "string") {
      return false;
    }

    const text = content.trim();
    if (!text || text.length < 40) {
      return false;
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      return false;
    }

    const questionLines = lines.filter((line) => line.includes("?"));
    if (questionLines.length < 2) {
      return false;
    }

    const clarificationHintCount = questionLines.filter((line) =>
      /\b(what|which|who|where|when|why|how|do you|would you|could you|provider|scope|payment|stack|type)\b/i.test(
        line,
      ),
    ).length;
    if (clarificationHintCount < 2) {
      return false;
    }

    const hasExplicitPlanSections =
      /(?:^|\n)\s*##\s*(proposed changes|verification plan)\b/i.test(text) ||
      /\[(MODIFY|NEW|DELETE)\]/i.test(text) ||
      /(?:^|\n)\s*-\s*\[[ xX]\]\s+/m.test(text);

    return !hasExplicitPlanSections;
  }

  private extractMessageId(message: any): string | undefined {
    if (!message || typeof message !== "object") {
      return undefined;
    }
    return this.firstNonEmptyString(message?.info?.id, message?.id);
  }

  private hasStructuredSubagentSignal(messageRaw: unknown): boolean {
    const message = this.asRecord(messageRaw);
    if (!message) {
      return false;
    }

    if (Array.isArray(message.subagents) && message.subagents.length > 0) {
      return true;
    }

    const structured = this.asRecord(message.structuredOutput);
    if (!structured) {
      return false;
    }

    if (Array.isArray(structured.subagents) && structured.subagents.length > 0) {
      return true;
    }

    const delta = this.asRecord(structured.subagentsDelta);
    if (Array.isArray(delta?.items) && delta.items.length > 0) {
      return true;
    }

    const responseType = this.firstNonEmptyString(structured.responseType);
    return responseType?.toLowerCase() === "subagents";
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

  private getSubagentSnapshotStorageKey(sessionId: string): string {
    return `${ChatViewProvider.SUBAGENT_SNAPSHOT_PREFIX}${sessionId}`;
  }

  private normalizeSubagentPayload(
    payload: unknown,
  ): SubagentUpdatePayload {
    const rec = this.asRecord(payload) || {};
    const summariesByParentMessageId =
      this.asRecord(rec.summariesByParentMessageId) || {};
    const detailsById = this.asRecord(rec.detailsById) || {};
    return {
      summariesByParentMessageId:
        summariesByParentMessageId as SubagentUpdatePayload["summariesByParentMessageId"],
      detailsById: detailsById as SubagentUpdatePayload["detailsById"],
    };
  }

  private mergeSubagentPayloads(
    existing: SubagentUpdatePayload,
    incoming: SubagentUpdatePayload,
  ): SubagentUpdatePayload {
    const mergedSummaries: Record<string, unknown[]> = {};
    const existingSummaries =
      this.asRecord(existing.summariesByParentMessageId) || {};
    const incomingSummaries =
      this.asRecord(incoming.summariesByParentMessageId) || {};
    const parentMessageIds = new Set<string>([
      ...Object.keys(existingSummaries),
      ...Object.keys(incomingSummaries),
    ]);
    for (const parentMessageId of parentMessageIds) {
      const merged = this.mergeSubagentEntries(
        existingSummaries[parentMessageId],
        Array.isArray(incomingSummaries[parentMessageId])
          ? (incomingSummaries[parentMessageId] as Array<Record<string, unknown>>)
          : [],
      );
      if (merged.length > 0) {
        mergedSummaries[parentMessageId] = merged;
      }
    }

    const mergedDetails: Record<string, unknown> = {};
    const existingDetails = this.asRecord(existing.detailsById) || {};
    const incomingDetails = this.asRecord(incoming.detailsById) || {};
    const detailIds = new Set<string>([
      ...Object.keys(existingDetails),
      ...Object.keys(incomingDetails),
    ]);
    for (const detailId of detailIds) {
      const prev = this.asRecord(existingDetails[detailId]) || {};
      const next = this.asRecord(incomingDetails[detailId]) || {};
      mergedDetails[detailId] = {
        ...prev,
        ...next,
        id: this.firstNonEmptyString(next.id, prev.id, detailId) || detailId,
      };
    }

    return {
      summariesByParentMessageId:
        mergedSummaries as SubagentUpdatePayload["summariesByParentMessageId"],
      detailsById: mergedDetails as SubagentUpdatePayload["detailsById"],
    };
  }

  private async loadPersistedSubagentSnapshot(
    sessionId: string,
  ): Promise<SubagentUpdatePayload | null> {
    const raw = this.context.workspaceState.get<unknown>(
      this.getSubagentSnapshotStorageKey(sessionId),
    );
    if (!raw) {
      return null;
    }
    const normalized = this.normalizeSubagentPayload(raw);
    const hasEntries =
      Object.keys(normalized.summariesByParentMessageId || {}).length > 0 ||
      Object.keys(normalized.detailsById || {}).length > 0;
    return hasEntries ? normalized : null;
  }

  private async savePersistedSubagentSnapshot(
    sessionId: string,
    payload: SubagentUpdatePayload,
  ): Promise<void> {
    await this.context.workspaceState.update(
      this.getSubagentSnapshotStorageKey(sessionId),
      payload,
    );
  }

  private async clearPersistedSubagentSnapshot(
    sessionId: string,
  ): Promise<void> {
    await this.context.workspaceState.update(
      this.getSubagentSnapshotStorageKey(sessionId),
      undefined,
    );
  }

  private getCompactionViewStateStorageKey(sessionId: string): string {
    return `${ChatViewProvider.COMPACTION_VIEW_STATE_PREFIX}${sessionId}`;
  }

  private normalizeCompactionBaselineStats(
    value: unknown,
  ): CompactionBaselineStats | undefined {
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

  private normalizeCompactionViewState(
    value: unknown,
  ): PersistedCompactionViewState | null {
    const rec = this.asRecord(value);
    if (!rec) {
      return null;
    }

    const next: PersistedCompactionViewState = {};
    if (
      typeof rec.lastCompactedAt === "number" &&
      Number.isFinite(rec.lastCompactedAt) &&
      rec.lastCompactedAt > 0
    ) {
      next.lastCompactedAt = Math.floor(rec.lastCompactedAt);
    }
    const baselineStats = this.normalizeCompactionBaselineStats(
      rec.baselineStats,
    );
    if (baselineStats) {
      next.baselineStats = baselineStats;
    }
    if (
      typeof rec.compactionDividerIndex === "number" &&
      Number.isFinite(rec.compactionDividerIndex) &&
      rec.compactionDividerIndex >= 0
    ) {
      next.compactionDividerIndex = Math.floor(rec.compactionDividerIndex);
    }
    const dividerBeforeMessageId = this.firstNonEmptyString(
      rec.compactionDividerBeforeMessageId,
    );
    if (dividerBeforeMessageId) {
      next.compactionDividerBeforeMessageId = dividerBeforeMessageId;
    }
    const dividerAfterMessageId = this.firstNonEmptyString(
      rec.compactionDividerAfterMessageId,
    );
    if (dividerAfterMessageId) {
      next.compactionDividerAfterMessageId = dividerAfterMessageId;
    }
    if (typeof rec.collapsed === "boolean") {
      next.collapsed = rec.collapsed;
    }

    return Object.keys(next).length > 0 ? next : null;
  }

  private async loadPersistedCompactionViewState(
    sessionId: string,
  ): Promise<PersistedCompactionViewState | null> {
    const raw = this.context.workspaceState.get<unknown>(
      this.getCompactionViewStateStorageKey(sessionId),
    );
    return this.normalizeCompactionViewState(raw);
  }

  private async savePersistedCompactionViewState(
    sessionId: string,
    state: PersistedCompactionViewState,
  ): Promise<void> {
    await this.context.workspaceState.update(
      this.getCompactionViewStateStorageKey(sessionId),
      state,
    );
  }

  private async clearPersistedCompactionViewState(
    sessionId: string,
  ): Promise<void> {
    await this.context.workspaceState.update(
      this.getCompactionViewStateStorageKey(sessionId),
      undefined,
    );
  }

  private postCompactionViewState(
    sessionId: string,
    state: PersistedCompactionViewState,
  ): void {
    this.view?.webview.postMessage({
      type: "compactionViewState",
      sessionId,
      ...state,
    });
  }

  private async sendPersistedCompactionViewState(
    sessionId: string,
  ): Promise<void> {
    const state = await this.loadPersistedCompactionViewState(sessionId);
    if (!state) {
      return;
    }
    this.postCompactionViewState(sessionId, state);
  }

  private async resolveSessionCompactionDividerState(
    sessionId: string,
  ): Promise<{
    compactionDividerIndex?: number;
    compactionDividerBeforeMessageId?: string;
    compactionDividerAfterMessageId?: string;
  }> {
    try {
      const rawMessages = await this.sessionService.getMessages(sessionId);
      const messages = Array.isArray(rawMessages)
        ? this.processHistoryMessages(rawMessages)
        : [];
      const compactionDividerIndex = messages.length;
      const compactionDividerBeforeMessageId =
        compactionDividerIndex > 0
          ? this.extractMessageId(messages[compactionDividerIndex - 1])
          : undefined;
      const compactionDividerAfterMessageId =
        compactionDividerIndex < messages.length
          ? this.extractMessageId(messages[compactionDividerIndex])
          : undefined;
      return {
        compactionDividerIndex,
        compactionDividerBeforeMessageId,
        compactionDividerAfterMessageId,
      };
    } catch (error) {
      console.warn(
        `[ChatViewProvider] Failed to resolve compaction divider state for session ${sessionId}:`,
        error,
      );
      return {};
    }
  }

  private async persistSubagentLiveState(
    sessionId: string,
    payload: SubagentUpdatePayload,
  ): Promise<SubagentUpdatePayload> {
    const existing = await this.loadPersistedSubagentSnapshot(sessionId);
    const merged = existing
      ? this.mergeSubagentPayloads(existing, payload)
      : payload;
    await this.savePersistedSubagentSnapshot(sessionId, merged);
    return merged;
  }

  private buildSubagentPayloadFromMessage(
    messageRaw: unknown,
    fallbackSessionId: string,
  ): SubagentUpdatePayload | null {
    const message = this.asRecord(messageRaw);
    if (!message) {
      return null;
    }
    const info = this.asRecord(message.info);
    const messageId = this.firstNonEmptyString(
      info?.id,
      message.id,
      message.messageID,
    );
    const subagentsRaw = Array.isArray(message.subagents)
      ? message.subagents
      : [];
    if (!messageId || subagentsRaw.length === 0) {
      return null;
    }

    const summaries: Array<Record<string, unknown>> = [];
    const detailsById: Record<string, unknown> = {};

    for (const subagentRaw of subagentsRaw) {
      const subagent = this.asRecord(subagentRaw);
      if (!subagent) {
        continue;
      }
      const id = this.firstNonEmptyString(subagent.id);
      if (!id) {
        continue;
      }
      const parentSessionId = this.firstNonEmptyString(
        subagent.parentSessionId,
        fallbackSessionId,
      );
      const parentMessageId = this.firstNonEmptyString(
        subagent.parentMessageId,
        messageId,
      );
      if (!parentSessionId || !parentMessageId) {
        continue;
      }

      const normalized: Record<string, unknown> = {
        ...subagent,
        id,
        parentSessionId,
        parentMessageId,
        status: this.normalizeSubagentStatus(subagent.status),
        latestActivity:
          this.firstNonEmptyString(
            subagent.latestActivity,
            subagent.description,
          ) || "Subagent update",
      };
      if (!Array.isArray(normalized.references)) {
        normalized.references = [];
      }
      if (!Array.isArray(normalized.progressEvents)) {
        normalized.progressEvents = [];
      }
      if (!Array.isArray(normalized.thinkingEvents)) {
        normalized.thinkingEvents = [];
      }
      if (!Array.isArray(normalized.timelineEvents)) {
        normalized.timelineEvents = [];
      }

      summaries.push({
        id,
        parentSessionId,
        parentMessageId,
        childSessionId: normalized.childSessionId,
        agentId: normalized.agentId,
        providerID: normalized.providerID,
        modelID: normalized.modelID,
        startedAt: normalized.startedAt,
        endedAt: normalized.endedAt,
        durationMs: normalized.durationMs,
        status: normalized.status,
        latestActivity: normalized.latestActivity,
        references: normalized.references,
      });
      detailsById[id] = normalized;
    }

    if (summaries.length === 0) {
      return null;
    }

    return {
      summariesByParentMessageId: {
        [messageId]: summaries as SubagentUpdatePayload["summariesByParentMessageId"][string],
      } as SubagentUpdatePayload["summariesByParentMessageId"],
      detailsById: detailsById as SubagentUpdatePayload["detailsById"],
    };
  }

  private async persistSubagentUpdateSnapshot(payload: {
    summariesByParentMessageId?: Record<string, unknown>;
    detailsById?: Record<string, unknown>;
  }): Promise<void> {
    const summariesMap = this.asRecord(payload.summariesByParentMessageId) || {};
    const parentMessageIds = Object.keys(summariesMap).filter(Boolean);
    if (parentMessageIds.length === 0) {
      return;
    }

    const sessionId =
      this.currentSessionId || this.resolveSubagentPayloadSessionId(payload);
    if (!sessionId) {
      return;
    }

    const normalizedPayload = this.normalizeSubagentPayload(payload);
    await this.persistSubagentLiveState(sessionId, normalizedPayload);

    const cachedMessages = await this.sessionService.loadSessionMessages(
      sessionId,
    );
    if (!Array.isArray(cachedMessages) || cachedMessages.length === 0) {
      return;
    }

    let hasChanges = false;
    const nextMessages = cachedMessages.map((rawMessage) => {
      const message = this.asRecord(rawMessage);
      if (!message) {
        return rawMessage;
      }

      const info = this.asRecord(message.info);
      const messageId = this.firstNonEmptyString(
        info?.id,
        message.id,
        message.messageID,
      );
      if (!messageId || !parentMessageIds.includes(messageId)) {
        return rawMessage;
      }

      const incomingSubagents = this.hydrateSubagentsFromPayload(
        messageId,
        normalizedPayload,
        sessionId,
      );
      if (incomingSubagents.length === 0) {
        return rawMessage;
      }

      const mergedSubagents = this.mergeSubagentEntries(
        message.subagents,
        incomingSubagents,
      );
      const nextMessage: Record<string, unknown> = {
        ...message,
        subagents: mergedSubagents,
      };
      hasChanges = true;
      return nextMessage;
    });

    if (!hasChanges) {
      return;
    }

    await this.sessionService.saveSessionMessages(sessionId, nextMessages);
  }

  private logStreamEventDiagnostics(event: any): void {
    if (!this.shouldVerboseStreamDebug()) {
      return;
    }

    const eventType =
      typeof event?.type === "string" ? event.type : "unknown";
    const properties = this.asRecord(event?.properties) || {};
    const part = this.asRecord(properties?.part);
    const info = this.asRecord(properties?.info);

    const sessionID =
      this.firstNonEmptyString(
        properties?.sessionID,
        properties?.sessionId,
        part?.sessionID,
        part?.sessionId,
        info?.sessionID,
        info?.sessionId,
      ) || undefined;
    const messageID =
      this.firstNonEmptyString(
        properties?.messageID,
        properties?.messageId,
        part?.messageID,
        part?.messageId,
        info?.id,
      ) || undefined;

    if (eventType === "server.heartbeat") {
      console.log("[ChatViewProvider] stream heartbeat", {
        source: this.firstNonEmptyString(event?.source),
        directory: this.firstNonEmptyString(event?.directory),
      });
      return;
    }

    console.log("[ChatViewProvider] stream event received", {
      type: eventType,
      source: this.firstNonEmptyString(event?.source),
      directory: this.firstNonEmptyString(event?.directory),
      sessionID,
      messageID,
      partType: this.firstNonEmptyString(part?.type),
      hasProperties: Object.keys(properties).length > 0,
    });
  }

  private logPromptResponseDiagnostics(
    sessionId: string,
    responseData: any,
  ): void {
    if (!this.shouldVerboseStreamDebug()) {
      return;
    }

    if (!responseData || typeof responseData !== "object") {
      return;
    }

    const info = this.asRecord(responseData.info);
    const messageId = this.firstNonEmptyString(info?.id, responseData.id);
    const parts = Array.isArray(responseData.parts) ? responseData.parts : [];

    console.log("[ChatViewProvider] Final response diagnostics", {
      sessionId,
      messageId,
      partCount: parts.length,
      partTypes: parts.map((part: any) =>
        typeof part?.type === "string" ? part.type : "unknown",
      ),
      role: this.firstNonEmptyString(info?.role, responseData.role),
      modelID: this.firstNonEmptyString(info?.modelID, responseData.modelID),
      providerID: this.firstNonEmptyString(
        info?.providerID,
        responseData.providerID,
      ),
    });

    parts.forEach((part: any, index: number) => {
      const partRec = this.asRecord(part) || {};
      const preview = this.firstNonEmptyString(
        partRec.delta,
        partRec.text,
        partRec.content,
        partRec.reasoning,
        partRec.message,
      );
      console.log("[ChatViewProvider] Final response part", {
        sessionId,
        messageId,
        index,
        type: this.firstNonEmptyString(partRec.type) || "unknown",
        preview:
          typeof preview === "string" ? preview.slice(0, 220) : undefined,
      });
    });
  }

  private sanitizeDebugPayload(value: unknown): unknown {
    const maxDepth = 6;
    const maxArrayItems = 30;
    const maxObjectKeys = 80;
    const maxStringLength = 4000;
    const seen = new WeakSet<object>();

    const walk = (input: unknown, depth: number): unknown => {
      if (input === null || typeof input === "boolean" || typeof input === "number") {
        return input;
      }
      if (typeof input === "string") {
        if (input.startsWith("data:")) {
          return `<data-url omitted; length=${input.length}>`;
        }
        if (input.length > maxStringLength) {
          const truncatedBy = input.length - maxStringLength;
          return `${input.slice(0, maxStringLength)} ...<truncated ${truncatedBy} chars>`;
        }
        return input;
      }
      if (typeof input === "bigint") {
        return input.toString();
      }
      if (typeof input === "undefined") {
        return undefined;
      }
      if (typeof input === "function") {
        return "<function>";
      }
      if (typeof input !== "object") {
        return String(input);
      }

      if (seen.has(input as object)) {
        return "<circular>";
      }
      seen.add(input as object);

      if (depth >= maxDepth) {
        return "<max-depth>";
      }

      if (Array.isArray(input)) {
        const items = input
          .slice(0, maxArrayItems)
          .map((item) => walk(item, depth + 1));
        if (input.length > maxArrayItems) {
          items.push(
            `<truncated array; omitted ${input.length - maxArrayItems} item(s)>`,
          );
        }
        return items;
      }

      const rec = this.asRecord(input) || {};
      const entries = Object.entries(rec).slice(0, maxObjectKeys);
      const out: Record<string, unknown> = {};
      entries.forEach(([key, val]) => {
        const next = walk(val, depth + 1);
        if (typeof next !== "undefined") {
          out[key] = next;
        }
      });
      if (Object.keys(rec).length > maxObjectKeys) {
        out.__truncatedKeys = `<omitted ${Object.keys(rec).length - maxObjectKeys} key(s)>`;
      }
      return out;
    };

    return walk(value, 0);
  }

  private buildRawResponseDebugText(value: unknown): string {
    const maxChars = 30000;
    let text: string;
    try {
      text = JSON.stringify(this.sanitizeDebugPayload(value), null, 2);
    } catch {
      try {
        text = String(value);
      } catch {
        text = "<unserializable response payload>";
      }
    }
    if (!text) {
      return "";
    }
    if (text.length <= maxChars) {
      return text;
    }
    return `${text.slice(0, maxChars)}\n...<truncated ${text.length - maxChars} chars>`;
  }

  private getDebugFilePath(): string | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder || workspaceFolder.uri.scheme !== "file") {
      return undefined;
    }
    return path.join(
      workspaceFolder.uri.fsPath,
      ".opencode-debug",
      "last-ai-exchange.json",
    );
  }

  private async persistAiDebugSnapshot(
    snapshot: Record<string, unknown>,
  ): Promise<void> {
    try {
      const filePath = this.getDebugFilePath();
      if (!filePath) return;

      const dirPath = path.dirname(filePath);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(filePath),
        new TextEncoder().encode(`${JSON.stringify(snapshot, null, 2)}\n`),
      );
      this.logger.info("AI debug snapshot written", { filePath });
    } catch (error) {
      this.logger.warn("Failed to persist AI debug snapshot", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async logPromptRequestPayload(
    sessionId: string,
    promptBody: NonNullable<SessionPromptData["body"]>,
    useStructuredOutput: boolean,
  ): Promise<void> {
    const requestRecord: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      sessionId,
      useStructuredOutput,
      prompt: this.sanitizeDebugPayload(promptBody),
    };
    this.promptDebugBySession.set(sessionId, requestRecord);

    this.logger.info("AI DEBUG request payload", {
      sessionId,
      useStructuredOutput,
      prompt: requestRecord.prompt,
    });
    console.log(
      "[ChatViewProvider][AI_DEBUG][request]",
      JSON.stringify(requestRecord, null, 2),
    );
    await this.persistAiDebugSnapshot({
      phase: "request",
      ...requestRecord,
    });
  }

  private async logPromptResponsePayload(
    sessionId: string,
    response: any,
    durationSeconds: number,
    useStructuredOutput: boolean,
  ): Promise<void> {
    const requestRecord = this.promptDebugBySession.get(sessionId);
    const responseRecord: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      sessionId,
      useStructuredOutput,
      durationSeconds,
      status: response?.response?.status,
      hasData: Boolean(response?.data),
      hasError: Boolean(response?.error),
      error: this.sanitizeDebugPayload(response?.error),
      data: this.sanitizeDebugPayload(response?.data),
    };

    const combined: Record<string, unknown> = {
      phase: "response",
      request: requestRecord,
      response: responseRecord,
    };
    this.logger.info("AI DEBUG response payload", {
      sessionId,
      useStructuredOutput,
      status: responseRecord.status,
      hasData: responseRecord.hasData,
      hasError: responseRecord.hasError,
    });
    console.log(
      "[ChatViewProvider][AI_DEBUG][response]",
      JSON.stringify(combined, null, 2),
    );
    await this.persistAiDebugSnapshot(combined);
    this.promptDebugBySession.delete(sessionId);
  }

  private async syncSubagentSnapshotForSession(
    sessionId: string,
    messages: any[],
  ): Promise<void> {
    this.subagentTracker.resetForSession(sessionId);
    this.subagentTracker.seedFromMessages(messages);
    const trackerSnapshot = this.subagentTracker.getSnapshotPayload();
    const persistedSnapshot =
      await this.loadPersistedSubagentSnapshot(sessionId);
    const mergedSnapshot = persistedSnapshot
      ? this.mergeSubagentPayloads(persistedSnapshot, trackerSnapshot)
      : trackerSnapshot;
    this.view?.webview.postMessage({
      type: "subagentSnapshot",
      ...mergedSnapshot,
    });
    await this.savePersistedSubagentSnapshot(sessionId, mergedSnapshot);
  }

  private recordStructuredValidationFailure(
    record: Record<string, unknown>,
    errors: string[],
    diagnostics?: {
      source?: string;
      providerID?: string;
      modelID?: string;
    },
  ): void {
    const responseType =
      this.firstNonEmptyString(
        record.responseType,
        record.type,
        record.kind,
        record.category,
      ) || "unknown";
    const providerID =
      this.firstNonEmptyString(diagnostics?.providerID) ||
      this.firstNonEmptyString(this.selectedModel.providerID) ||
      "unknown";
    const modelID =
      this.firstNonEmptyString(diagnostics?.modelID) ||
      this.firstNonEmptyString(this.selectedModel.modelID) ||
      "unknown";
    const source = this.firstNonEmptyString(diagnostics?.source) || "unknown";

    const key = `${responseType}|${providerID}/${modelID}`;
    const nextCount =
      (this.structuredValidationFailureCounters.get(key) || 0) + 1;
    this.structuredValidationFailureCounters.set(key, nextCount);
    const modelKey = this.getStructuredOutputModelKey(providerID, modelID);
    const sourceLower = (diagnostics?.source || "").toLowerCase();
    const cameFromStructuredPayload =
      sourceLower.includes("structured") ||
      sourceLower.includes("parts[].state.input") ||
      sourceLower.includes("parts[].state.result");
    const missingRequiredMessagePayload = errors.some(
      (error) =>
        error.includes("responseType is required") ||
        error.includes(
          "message responseType requires assistantMessage or message string",
        ),
    );
    const hasNoRenderableMessage = !this.firstNonEmptyString(
      record.assistantMessage,
      record.message,
    );

    if (
      modelKey &&
      cameFromStructuredPayload &&
      missingRequiredMessagePayload &&
      hasNoRenderableMessage &&
      !this.structuredOutputIncompatibleModelKeys.has(modelKey)
    ) {
      this.structuredOutputIncompatibleModelKeys.add(modelKey);
      this.logger.warn(
        "Detected empty structured payload pattern; disabling structured-output mode for this model",
        {
          modelKey,
          source: diagnostics?.source,
          errors,
        },
      );
    }

    const shouldLogAggregate =
      nextCount === 1 ||
      nextCount === 5 ||
      nextCount === 10 ||
      nextCount % 25 === 0;

    if (shouldLogAggregate) {
      this.logger.warn("Structured output validation failure aggregate", {
        key,
        count: nextCount,
        responseType,
        providerID,
        modelID,
        source,
        errors,
      });
    }
  }

  private normalizeStructuredOutput(
    raw: unknown,
    diagnostics?: {
      source?: string;
      providerID?: string;
      modelID?: string;
    },
  ): StructuredAssistantOutput | undefined {
    let value: unknown = raw;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        return undefined;
      }
    }

    const rec = this.asRecord(value);
    if (!rec) {
      return undefined;
    }

    const sanitizedRec = sanitizeStructuredOutput(rec);
    const assistantMessageCandidate = this.firstNonEmptyString(
      sanitizedRec.assistantMessage,
      sanitizedRec.message,
    );

    let responseTypeRaw =
      this.firstNonEmptyString(
        sanitizedRec.responseType,
        rec.type,
        rec.kind,
        rec.category,
      ) ||
      (assistantMessageCandidate ? "message" : undefined);

    if (responseTypeRaw?.toLowerCase() === "conversation") {
      responseTypeRaw = "message";
    }
    if (responseTypeRaw?.toLowerCase() === "interactive") {
      responseTypeRaw = "question";
    }

    if (
      responseTypeRaw &&
      !STRUCTURED_RESPONSE_TYPES.has(responseTypeRaw.toLowerCase())
    ) {
      responseTypeRaw = assistantMessageCandidate ? "message" : undefined;
    }

    if (!responseTypeRaw) {
      return undefined;
    }

    let canonicalRec: Record<string, unknown> = {
      ...sanitizedRec,
      responseType: responseTypeRaw,
    };
    if (
      assistantMessageCandidate &&
      !this.firstNonEmptyString(
        canonicalRec.assistantMessage,
        canonicalRec.message,
      )
    ) {
      canonicalRec.assistantMessage = assistantMessageCandidate;
    }

    let validation = validateStructuredOutput(canonicalRec);
    if (!validation.valid && assistantMessageCandidate) {
      canonicalRec = {
        responseType: "message",
        assistantMessage: assistantMessageCandidate,
        message: assistantMessageCandidate,
      };
      validation = validateStructuredOutput(canonicalRec);
    }
    if (!validation.valid) {
      this.logger.warn("Structured output validation failed", {
        errors: validation.errors,
        source: diagnostics?.source,
        providerID: diagnostics?.providerID,
        modelID: diagnostics?.modelID,
      });
      this.recordStructuredValidationFailure(
        canonicalRec,
        validation.errors,
        diagnostics,
      );
      return undefined;
    }

    const sanitizedCanonicalRec = sanitizeStructuredOutput(canonicalRec);
    const responseType = this.firstNonEmptyString(
      sanitizedCanonicalRec.responseType,
    );
    if (!responseType) {
      return undefined;
    }

    const assistantMessage = this.firstNonEmptyString(
      sanitizedCanonicalRec.assistantMessage,
      sanitizedCanonicalRec.message,
    );
    const message = this.firstNonEmptyString(sanitizedCanonicalRec.message);

    const reasoningRaw = sanitizedCanonicalRec.reasoning;
    const reasoning = Array.isArray(reasoningRaw)
      ? reasoningRaw
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
      : typeof reasoningRaw === "string" && reasoningRaw.trim()
        ? [reasoningRaw.trim()]
        : [];
    const normalizeComparableText = (value: string): string =>
      value.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim().toLowerCase();
    const stripAssistantEchoFromReasoning = (
      chunk: string,
      replyText?: string,
    ): string => {
      const trimmedChunk = chunk.trim();
      if (!trimmedChunk) {
        return "";
      }
      if (!replyText) {
        return trimmedChunk;
      }
      const trimmedReply = replyText.trim();
      if (!trimmedReply) {
        return trimmedChunk;
      }
      if (
        normalizeComparableText(trimmedChunk) ===
        normalizeComparableText(trimmedReply)
      ) {
        return "";
      }
      if (trimmedChunk.startsWith(trimmedReply)) {
        return trimmedChunk
          .slice(trimmedReply.length)
          .replace(/^[\s:;,\-.!?]+/, "")
          .trim();
      }
      return trimmedChunk;
    };
    const cleanedReasoning = reasoning
      .map((chunk) =>
        stripAssistantEchoFromReasoning(chunk, assistantMessage || message),
      )
      .filter(Boolean);

    const progressRaw =
      sanitizedCanonicalRec.progressUpdates ?? (rec.progress_updates as unknown);
    const progressUpdates = Array.isArray(progressRaw)
      ? progressRaw
        .map((item) => {
          const update = this.asRecord(item);
          if (!update) return null;
          const title = this.firstNonEmptyString(
            update.title,
            update.message,
          );
          if (!title) return null;
          const status = this.firstNonEmptyString(update.status);
          const normalizedStatus =
            status === "done" || status === "error" || status === "pending"
              ? status
              : undefined;
          return {
            title,
            status: normalizedStatus,
            meta: this.firstNonEmptyString(update.meta, update.detail),
            filePath: this.firstNonEmptyString(
              update.filePath,
              update.file,
              update.path,
            ),
          } as StructuredProgressUpdate;
        })
        .filter((item): item is StructuredProgressUpdate => !!item)
      : [];

    const normalizeChoices = (
      value: unknown,
    ): StructuredInteractiveChoice[] => {
      if (!Array.isArray(value)) return [];
      return value
        .map((item) => {
          const choice = this.asRecord(item);
          if (!choice) return null;
          const label = this.firstNonEmptyString(choice.label, choice.value);
          if (!label) return null;
          return {
            id: this.firstNonEmptyString(choice.id),
            label,
            value: this.firstNonEmptyString(choice.value) || label,
            description: this.firstNonEmptyString(
              choice.description,
              choice.detail,
            ),
          } as StructuredInteractiveChoice;
        })
        .filter((item): item is StructuredInteractiveChoice => !!item);
    };

    const normalizeInteractiveEvent = (
      value: unknown,
      index: number,
    ): StructuredInteractiveEvent | null => {
      const event = this.asRecord(value);
      if (!event) return null;
      const eventType = this.firstNonEmptyString(
        event.type,
        event.kind,
      )?.toLowerCase();
      const id =
        this.firstNonEmptyString(event.id) ||
        `interactive-${Date.now()}-${index}`;

      if (eventType === "confirm") {
        const question = this.firstNonEmptyString(
          event.question,
          event.prompt,
          event.message,
        );
        if (!question) return null;
        return {
          type: "confirm",
          id,
          title: this.firstNonEmptyString(event.title),
          question,
          confirmLabel: this.firstNonEmptyString(
            event.confirmLabel,
            event.confirm_text,
          ),
          cancelLabel: this.firstNonEmptyString(
            event.cancelLabel,
            event.cancel_text,
          ),
        };
      }

      if (eventType === "quick_actions" || eventType === "quick-actions") {
        const actions = normalizeChoices(event.actions ?? event.options);
        if (actions.length === 0) return null;
        return {
          type: "quick_actions",
          id,
          title: this.firstNonEmptyString(event.title, event.question),
          actions,
        };
      }

      if (eventType === "question" || eventType === "interactive") {
        const question = this.firstNonEmptyString(
          event.question,
          event.prompt,
          event.title,
        );
        const options = normalizeChoices(event.options ?? event.choices);
        if (!question || options.length < 2) return null;
        return {
          type: "question",
          id,
          title: this.firstNonEmptyString(event.title),
          question,
          options,
          multiSelect: event.multiSelect === true,
          allowCustomInput: event.allowCustomInput === true,
        };
      }

      if (eventType === "message") {
        const message = this.firstNonEmptyString(
          event.message,
          event.content,
          event.text,
        );
        if (!message) return null;
        return {
          type: "message",
          id,
          title: this.firstNonEmptyString(event.title),
          message,
          dismissLabel: this.firstNonEmptyString(
            event.dismissLabel,
            event.dismiss_label,
          ),
        };
      }

      return null;
    };

    const interactiveRaw =
      sanitizedCanonicalRec.interactiveEvents ??
      rec.interactions ??
      rec.uiEvents ??
      rec.question ??
      rec.questions;
    const singleInteractive = normalizeInteractiveEvent(interactiveRaw, 0);
    let interactiveEvents = Array.isArray(interactiveRaw)
      ? interactiveRaw
        .map((item, index) => normalizeInteractiveEvent(item, index))
        .filter((item): item is StructuredInteractiveEvent => !!item)
      : singleInteractive
        ? [singleInteractive]
        : [];

    if (interactiveEvents.length === 0) {
      const rootQuestion = this.firstNonEmptyString(rec.question, rec.prompt);
      const rootOptions = normalizeChoices(rec.options ?? rec.choices);
      if (rootQuestion && rootOptions.length >= 2) {
        interactiveEvents = [
          {
            type: "question",
            id: `interactive-${Date.now()}-0`,
            title: this.firstNonEmptyString(rec.title),
            question: rootQuestion,
            options: rootOptions,
            multiSelect: rec.multiSelect === true,
            allowCustomInput: rec.allowCustomInput === true,
          },
        ];
      }
    }

    if (
      interactiveEvents.length === 0 &&
      this.isInteractiveResponseType(responseType)
    ) {
      const fallbackQuestion =
        this.firstNonEmptyString(rec.question, rec.prompt, message) ||
        "I need a quick clarification before I continue.";
      interactiveEvents = [
        {
          type: "question",
          id: `interactive-${Date.now()}-fallback`,
          title: this.firstNonEmptyString(rec.title) || "Question",
          question: fallbackQuestion,
          options: [
            { id: "yes", label: "Yes", value: "yes" },
            { id: "no", label: "No", value: "no" },
          ],
          allowCustomInput: true,
        },
      ];
      this.logger.warn(
        "Coerced interactive response into fallback question event",
        {
          source: diagnostics?.source,
          providerID: diagnostics?.providerID,
          modelID: diagnostics?.modelID,
          responseType,
        },
      );
    }

    const subagentsDeltaRaw = this.asRecord(
      sanitizedCanonicalRec.subagentsDelta ?? rec.subagents_delta,
    );
    const subagentsDeltaItems = Array.isArray(subagentsDeltaRaw?.items)
      ? (subagentsDeltaRaw?.items
        .map((entry) => {
          const item = this.asRecord(entry);
          if (!item) return null;
          const id = this.firstNonEmptyString(item.id);
          if (!id) return null;
          return {
            id,
            name: this.firstNonEmptyString(item.name, item.agentId),
            status: this.firstNonEmptyString(item.status),
            progress:
              typeof item.progress === "number" &&
                Number.isFinite(item.progress)
                ? item.progress
                : undefined,
            description: this.firstNonEmptyString(item.description),
            latestActivity: this.firstNonEmptyString(
              item.latestActivity,
              item.description,
            ),
            childSessionId: this.firstNonEmptyString(item.childSessionId),
            parentSessionId: this.firstNonEmptyString(item.parentSessionId),
            parentMessageId: this.firstNonEmptyString(item.parentMessageId),
          };
        })
        .filter(Boolean) as Array<{
          id: string;
          name?: string;
          status?: string;
          progress?: number;
          description?: string;
          latestActivity?: string;
          childSessionId?: string;
          parentSessionId?: string;
          parentMessageId?: string;
        }>)
      : undefined;
    const subagentsDelta =
      subagentsDeltaItems && subagentsDeltaItems.length > 0
        ? {
          parentMessageId: this.firstNonEmptyString(
            subagentsDeltaRaw?.parentMessageId,
          ),
          items: subagentsDeltaItems as Array<{
            id: string;
            name?: string;
            status?: string;
            progress?: number;
            description?: string;
            latestActivity?: string;
            childSessionId?: string;
            parentSessionId?: string;
            parentMessageId?: string;
          }>,
        }
        : undefined;

    const subagentsRaw =
      sanitizedCanonicalRec.subagents ?? (rec.spawnedSubagents as unknown);
    const subagents = Array.isArray(subagentsRaw)
      ? (subagentsRaw
        .map((item, index) => {
          const subagent = this.asRecord(item);
          if (!subagent) return null;
          const id = this.firstNonEmptyString(subagent.id);
          if (!id) return null;
          const status = this.firstNonEmptyString(
            subagent.status,
          )?.toLowerCase();
          const normalizedStatus =
            status === "pending" ||
              status === "running" ||
              status === "done" ||
              status === "error" ||
              status === "orphaned"
              ? status
              : undefined;
          const progressValue = subagent.progress;
          const progress =
            typeof progressValue === "number" &&
              Number.isFinite(progressValue)
              ? progressValue
              : undefined;
          const normalizeProgressEvents = (value: unknown) => {
            if (!Array.isArray(value)) return undefined;
            const events = value
              .map((entry, eventIndex) => {
                const evt = this.asRecord(entry);
                if (!evt) return null;
                const title = this.firstNonEmptyString(evt.title);
                if (!title) return null;
                return {
                  id:
                    this.firstNonEmptyString(evt.id) ||
                    `${id}:progress:${eventIndex}`,
                  title,
                  status: this.firstNonEmptyString(evt.status),
                  meta: this.firstNonEmptyString(evt.meta),
                  filePath: this.firstNonEmptyString(
                    evt.filePath,
                    evt.file,
                    evt.path,
                  ),
                  createdAt:
                    typeof evt.createdAt === "number"
                      ? evt.createdAt
                      : undefined,
                  messageID: this.firstNonEmptyString(evt.messageID),
                  partID: this.firstNonEmptyString(evt.partID),
                  callID: this.firstNonEmptyString(evt.callID),
                };
              })
              .filter(Boolean) as Array<{
                id: string;
                title: string;
                status?: string;
                meta?: string;
                filePath?: string;
                createdAt?: number;
                messageID?: string;
                partID?: string;
                callID?: string;
              }>;
            return events.length > 0 ? events : undefined;
          };
          const normalizeThinkingEvents = (value: unknown) => {
            if (!Array.isArray(value)) return undefined;
            const events = value
              .map((entry, eventIndex) => {
                const evt = this.asRecord(entry);
                if (!evt) return null;
                const text = this.firstNonEmptyString(evt.text);
                if (!text) return null;
                return {
                  id:
                    this.firstNonEmptyString(evt.id) ||
                    `${id}:thinking:${eventIndex}`,
                  text,
                  createdAt:
                    typeof evt.createdAt === "number"
                      ? evt.createdAt
                      : undefined,
                  messageID: this.firstNonEmptyString(evt.messageID),
                  partID: this.firstNonEmptyString(evt.partID),
                };
              })
              .filter(Boolean) as Array<{
                id: string;
                text: string;
                createdAt?: number;
                messageID?: string;
                partID?: string;
              }>;
            return events.length > 0 ? events : undefined;
          };
          const normalizeTimelineEvents = (value: unknown) => {
            if (!Array.isArray(value)) return undefined;
            const events = value
              .map((entry, eventIndex) => {
                const evt = this.asRecord(entry);
                if (!evt) return null;
                const label = this.firstNonEmptyString(evt.label);
                if (!label) return null;
                return {
                  key:
                    this.firstNonEmptyString(evt.key) ||
                    `${id}:timeline:${eventIndex}`,
                  type: this.firstNonEmptyString(evt.type) || "event",
                  label,
                  createdAt:
                    typeof evt.createdAt === "number"
                      ? evt.createdAt
                      : undefined,
                  messageID: this.firstNonEmptyString(evt.messageID),
                  partID: this.firstNonEmptyString(evt.partID),
                  callID: this.firstNonEmptyString(evt.callID),
                };
              })
              .filter(Boolean) as Array<{
                key: string;
                type: string;
                label: string;
                createdAt?: number;
                messageID?: string;
                partID?: string;
                callID?: string;
              }>;
            return events.length > 0 ? events : undefined;
          };
          return {
            id,
            name:
              this.firstNonEmptyString(
                subagent.name,
                subagent.agentId,
                subagent.id,
              ) || id,
            status: normalizedStatus,
            progress,
            description: this.firstNonEmptyString(subagent.description),
            latestActivity: this.firstNonEmptyString(
              subagent.latestActivity,
              subagent.description,
            ),
            childSessionId: this.firstNonEmptyString(subagent.childSessionId),
            parentSessionId: this.firstNonEmptyString(
              subagent.parentSessionId,
            ),
            parentMessageId: this.firstNonEmptyString(
              subagent.parentMessageId,
            ),
            progressEvents: normalizeProgressEvents(subagent.progressEvents),
            thinkingEvents: normalizeThinkingEvents(subagent.thinkingEvents),
            timelineEvents: normalizeTimelineEvents(subagent.timelineEvents),
          };
        })
        .filter((item) => !!item) as NonNullable<
          StructuredAssistantOutput["subagents"]
        >)
      : undefined;

    const isInteractiveResponse =
      this.isInteractiveResponseType(responseType) &&
      interactiveEvents.length > 0;

    const planRec = this.asRecord(sanitizedCanonicalRec.plan ?? rec.plan);

    // Determine if the plan content looks like a clarification questionnaire.
    // Question-first precedence: if the response is interactive OR the plan
    // content appears to be a clarification questionnaire, we must NOT treat
    // it as a real implementation plan. This prevents a model from returning
    // an `implementation_plan` responseType while embedding clarifying
    // questions inside the plan body.
    const candidatePlanContent = this.firstNonEmptyString(
      planRec?.content,
      planRec?.markdown,
      sanitizedCanonicalRec.message,
      sanitizedCanonicalRec.assistantMessage,
    );
    const isClarification = this.isClarificationQuestionnaire(candidatePlanContent);

    if (isInteractiveResponse && planRec) {
      this.logger.warn("Ignoring plan payload for interactive response", {
        source: diagnostics?.source,
        providerID: diagnostics?.providerID,
        modelID: diagnostics?.modelID,
      });
    }

    // Bounded telemetry for plan-suppression decisions. Avoid logging any raw
    // message or plan content — include only booleans/ids/responseType.
    const responseTypeSafe = responseType || "unknown";
    const shouldAttachPlan = !isInteractiveResponse && !isClarification && (planRec || responseType === "implementation_plan");
    if (!shouldAttachPlan) {
      const reason = isInteractiveResponse
        ? "interactive-wins"
        : isClarification
          ? "clarification-detected"
          : "heuristic-rejected";
      this.logger.debug("Plan suppressed", {
        source: "normalizeStructuredOutput",
        reason,
        responseType: responseTypeSafe,
        hasInteractiveEvents: !!isInteractiveResponse,
        isClarification: !!isClarification,
      });
    }

    // Only surface a plan when: (1) this is NOT an interactive response, and
    // (2) the content does not look like a clarification questionnaire, and
    // (3) either the structured record includes a plan OR the declared
    // responseType is 'implementation_plan'. This centralizes the precedence
    // logic so downstream consumers cannot mistakenly attach a plan when the
    // model is actually asking clarifying questions.
    const plan =
      shouldAttachPlan
        ? {
            file:
              this.firstNonEmptyString(planRec?.file) ||
              "implementation_plan.md",
            content: this.firstNonEmptyString(
              planRec?.content,
              planRec?.markdown,
            ),
            title: this.firstNonEmptyString(planRec?.title),
            summary: this.firstNonEmptyString(planRec?.summary),
          }
        : undefined;

    if (
      !assistantMessage &&
      !message &&
      cleanedReasoning.length === 0 &&
      progressUpdates.length === 0 &&
      interactiveEvents.length === 0 &&
      (!subagents || subagents.length === 0) &&
      !plan?.content &&
      !subagentsDelta
    ) {
      return undefined;
    }

    const rawQuestion = this.asRecord(
      sanitizedCanonicalRec.question ?? rec.question,
    );

    return {
      responseType,
      assistantMessage,
      message,
      reasoning: cleanedReasoning.length > 0 ? cleanedReasoning : undefined,
      progressUpdates: progressUpdates.length > 0 ? progressUpdates : undefined,
      interactiveEvents:
        interactiveEvents.length > 0 ? interactiveEvents : undefined,
      subagents: subagents && subagents.length > 0 ? subagents : undefined,
      subagentsDelta,
      plan: plan?.content ? plan : undefined,
      question: rawQuestion ?? undefined,
    };
  }

  private createFallbackMessage(
    structured: StructuredAssistantOutput,
  ): string | undefined {
    if (!structured.responseType) return undefined;

    const { responseType, progressUpdates, interactiveEvents, plan } =
      structured;

    switch (responseType) {
      case "implementation_plan":
        return plan?.title ? `📋 ${plan.title}` : "📋 Implementation Plan";
      case "progress_update":
        if (progressUpdates && progressUpdates.length > 0) {
          const titles = progressUpdates.map((p) => p.title).join(", ");
          return `Progress: ${titles}`;
        }
        return "📊 Working on tasks...";
      case "question":
        if (interactiveEvents && interactiveEvents.length > 0) {
          const firstEvent = interactiveEvents[0];
          if (firstEvent.type === "question" && firstEvent.question) {
            return firstEvent.question;
          } else if (firstEvent.type === "confirm" && firstEvent.question) {
            return firstEvent.question;
          } else if (firstEvent.type === "message" && firstEvent.message) {
            return firstEvent.message;
          }
        }
        return "❓ Question for you";
      case "subagents":
        return "🤖 Spawned subagents...";
      case "error":
        return "⚠️ An error occurred";
      case "message":
      default:
        return undefined;
    }
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

    const cleaned = this.stripLegacyInstruction(rawText);
    if (this.isLikelyToolCallTranscript(cleaned)) {
      return "";
    }
    return cleaned;
  }

  private extractStructuredOutput(
    messageLike: any,
  ): StructuredAssistantOutput | undefined {
    if (!messageLike) return undefined;
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

  private applyStructuredOutputToMessage(message: any): any {
    const structured = this.extractStructuredOutput(message);
    if (!structured) {
      const role = this.firstNonEmptyString(
        message?.info?.role,
        message?.role,
      )?.toLowerCase();
      const bodyText = this.extractMessageBodyText(message);
      if (role === "assistant" && bodyText) {
        const next: any = {
          ...message,
          structuredOutput: {
            responseType: "message",
            assistantMessage: bodyText,
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
      structured.assistantMessage ||
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
      const hasMessageBody =
        (typeof next.content === "string" && next.content.trim().length > 0) ||
        (Array.isArray(next.parts) &&
          next.parts.some(
            (part: any) =>
              part?.type === "text" &&
              typeof part?.text === "string" &&
              part.text.trim().length > 0,
          ));
      if (!hasMessageBody) {
        const firstEvent = structured.interactiveEvents[0];
        if (firstEvent.type === "question" || firstEvent.type === "confirm") {
          next.content = firstEvent.question;
          const parts = Array.isArray(next.parts) ? [...next.parts] : [];
          parts.push({ type: "text", text: firstEvent.question });
          next.parts = parts;
        } else if (firstEvent.type === "message") {
          next.content = firstEvent.message;
          const parts = Array.isArray(next.parts) ? [...next.parts] : [];
          parts.push({ type: "text", text: firstEvent.message });
          next.parts = parts;
        }
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
        structured.assistantMessage,
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
        structured.plan?.content)
    ) {
      const planContent = structured.plan?.content || "";
      if (typeof planContent === "string" && planContent.trim().length >= 80) {
        next.plan = {
          file: structured.plan?.file || "implementation_plan.md",
          content: planContent,
          title: structured.plan?.title,
          summary: structured.plan?.summary,
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
            structured.assistantMessage,
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
    const next: Record<string, unknown> = { ...event };
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
      next.structuredOutput = structuredOutput;
      if (kind === "other") {
        kind = "message";
      }
    }

    next.structured = {
      kind,
      text,
      eventType: event.type,
      responseType: structuredOutput?.responseType,
    };

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
  ): Promise<void> {
    // Cache for retry
    this.lastSendMessageArgs = { text, files, contexts, images, agent };
    this.isProcessingRequest = true;
    let drainSessionId: string | undefined;
    const capturePromptDebug = this.shouldVerboseStreamDebug();
    let debugSessionId: string | undefined;
    try {
      const normalizedImages = (images || [])
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

      const client = await this.serverManager.ensureRunning();
      let session = await this.sessionService.getCurrentSession();
      if (this.currentSessionId && session.id !== this.currentSessionId) {
        session = await this.sessionService.switchSession(
          this.currentSessionId,
        );
      }
      this.currentSessionId = session.id;
      drainSessionId = session.id;
      this.subagentTracker.setActiveSession(session.id);

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

      const existingMessages = await this.sessionService.getMessages(
        session.id,
      );
      const isNewSession = existingMessages.length === 0;

      // Save user message to local history immediately, unless this is a retry
      if (!isRetry) {
        const userMessage = {
          role: "user" as const,
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
          parts as Array<Record<string, unknown>>,
          agent || this.selectedAgent,
        );
      const promptBody: NonNullable<SessionPromptData["body"]> = {
        model: this.selectedModel,
        agent: agent || this.selectedAgent,
        parts: parts,
      };
      const promptVariant = this.resolvePromptVariant(session.id);
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
      const response = await this.promptWithStructuredOutput(
        client,
        session.id,
        promptBody,
        useStructuredOutput,
      );
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
        log.error("API error returned", {
          sessionId: session.id,
          error: response.error,
          status: response.response?.status,
        });

        let errorMessage = this.extractErrorMessage(
          response.error,
          "Failed to send message",
        );

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
      const errorMessage = this.extractErrorMessage(
        error,
        "Failed to send message",
      );
      vscode.window.showErrorMessage(`Failed to send message: ${errorMessage}`);
      console.error("Send message error:", error);

      // Show error in webview too
      this.view?.webview.postMessage({
        type: "error",
        message: errorMessage,
      });
    } finally {
      if (debugSessionId) {
        this.promptDebugBySession.delete(debugSessionId);
      }
      this.isProcessingRequest = false;
      this.maybeAutoDrainQueue(drainSessionId);
    }
  }

  /**
   * Enriches a message with plan information if detected.
   * FORBIDDEN TO REMOVE: This logic ensures the Implementation Plan button appears,
   * which is a core feature for user transparency and workflow.
   */
  private enrichMessageWithPlan(message: any): any {
    if (!message) return message;

    const role = message?.info?.role || message?.role;
    if (typeof role === "string" && role.toLowerCase() !== "assistant") {
      return message;
    }

    const fallbackPlanFile = "implementation_plan.md";
    const planFilePattern = /implementation_plan(?:_[a-z0-9-]+)?\.md/i;

    const structured = this.extractStructuredOutput(message);
    const structuredResponseType = this.firstNonEmptyString(
      structured?.responseType,
      message?.structuredOutput?.responseType,
    );
    const hasInteractiveEvents =
      (Array.isArray(structured?.interactiveEvents) &&
        structured.interactiveEvents.length > 0) ||
      (Array.isArray(message?.interactiveEvents) &&
        message.interactiveEvents.length > 0);
    const isInteractiveClarificationResponse =
      this.isInteractiveResponseType(structuredResponseType) &&
      hasInteractiveEvents;

    if (isInteractiveClarificationResponse) {
      if (message.plan) {
        this.logger.debug("Plan suppressed", {
          source: "enrichMessageWithPlan",
          reason: "interactive-wins",
          responseType: structuredResponseType || "unknown",
          hasInteractiveEvents: !!hasInteractiveEvents,
          isClarification: false,
        });
        const nextMessage = { ...message };
        delete nextMessage.plan;
        return nextMessage;
      }
      return message;
    }

    if (structured) {
      const structuredPlanContent = structured.plan?.content;
      if (
        structuredPlanContent &&
        typeof structuredPlanContent === "string" &&
        structuredPlanContent.length >= 200
      ) {
        if (this.isClarificationQuestionnaire(structuredPlanContent)) {
          return message;
        }
        this.persistPlan(structuredPlanContent).catch((err) => {
          console.error(
            "[ChatViewProvider] Failed to auto-persist structured plan:",
            err,
          );
        });

        // Resolve the plan filename: prefer what the agent declared in structured
        // output, then look for a matching filename in the message edits/patches,
        // then fall back to the default. The viewer reads this to load the live
        // file from disk so the user sees the exact content the agent wrote.
        const editsForPlan: any[] = message.edits || [];
        const partsForPlan: any[] = message.parts || [];
        const editPlanFile: string | undefined =
          editsForPlan.find((e: any) => e.file && planFilePattern.test(e.file))?.file ||
          (() => {
            for (const p of partsForPlan) {
              if (p.type === "patch" && Array.isArray(p.files)) {
                const f = p.files.find((f: string) => planFilePattern.test(f));
                if (f) return f;
              }
            }
            return undefined;
          })();

        return {
          ...message,
          structuredOutput: structured,
          plan: {
            file: structured.plan?.file || editPlanFile || fallbackPlanFile,
            content: structuredPlanContent,
            title: structured.plan?.title,
            summary: structured.plan?.summary,
            fileCount: Array.isArray(structured.plan?.files) ? structured.plan.files.length : 0,
          },
        };
      }
    }

    // Check for implementation plan in edits, parts, or message content
    const edits = message.edits || [];
    const parts = message.parts || [];
    const info = message.info || {};

    // 1. Check for explicit filename in edits/parts
    const hasPlanFile =
      edits.some((e: any) => e.file && planFilePattern.test(e.file)) ||
      parts.some(
        (p: any) =>
          p.type === "patch" &&
          p.files &&
          p.files.some((f: string) => planFilePattern.test(f)),
      );

    // 2. Fallback: Check for plan-like content in message summary, parts, or plain content
    const partsContent = parts
      .filter((p: any) => this.isRenderableTextPart(p)) // ignore reasoning parts directly
      .map((p: any) => {
        let c = p.text || p.content || "";
        if (p.files && Array.isArray(p.files)) c += " " + p.files.join(" ");
        return c;
      })
      .join(" ");

    const fullContent =
      (info.summary?.title || "") +
      " " +
      (info.summary?.body || "") +
      " " +
      (message.content || "") +
      " " +
      partsContent;

    // Broadened regex to catch more variations of "Implementation Plan"
    // Also check if the title itself strongly indicates a plan
    const basicPlanKeywordMatch =
      /implementation\s*plan/i.test(fullContent) ||
      /goal\s*description/i.test(fullContent) ||
      /proposed\s*changes/i.test(fullContent) ||
      /implementation_plan\.md/i.test(fullContent) ||
      (/(plan|roadmap)/i.test(info.summary?.title || "") &&
        /(implementation|feature)/i.test(info.summary?.title || ""));

    // Require structural markers to avoid false positives from short mentions
    const hasStructuralMarkers =
      /##\s|###\s|- \[ \]|Files:|Steps:|Goal:/i.test(fullContent) ||
      // Long content is likely a real plan even if markers are missing
      fullContent.length > 500;

    const hasPlanKeywords = basicPlanKeywordMatch && hasStructuralMarkers;
    const looksLikeClarificationQuestions =
      this.isClarificationQuestionnaire(fullContent);

    // If the content looks like a clarification questionnaire, never promote it
    // into an implementation plan. If a plan was already attached, strip it.
    if (looksLikeClarificationQuestions) {
      if (message.plan) {
        this.logger.debug("Plan suppressed", {
          source: "enrichMessageWithPlan",
          reason: "clarification-detected",
          responseType: structuredResponseType || "unknown",
          hasInteractiveEvents: !!hasInteractiveEvents,
          isClarification: true,
        });
        const nextMessage = { ...message };
        delete nextMessage.plan;
        return nextMessage;
      }
      return message;
    }

    if (hasPlanFile || hasPlanKeywords) {
      // Extract and clean the plan content using the PlanParser
      let rawContent = message.content || partsContent;

      // If the AI structured output placed the overarching title in the summary but not the text, inject it as the H1
      const summaryTitle = info.summary?.title;
      if (summaryTitle && !rawContent.includes(summaryTitle)) {
        rawContent = `# ${summaryTitle}\n\n${rawContent}`;
      }

      const parsed = PlanParser.parse(rawContent);
      const cleanPlanContent = PlanParser.toMarkdown(parsed);

      // PERSISTENCE: Automatically save the cleaned plan to disk.
      // This ensures handleViewPlan can read it even if the SDK didn't write it.
      // We only persist if it actually looks like a valid plan (has a goal or files/steps).
      if (
        cleanPlanContent.length > 100 &&
        (parsed.goal || parsed.files.length > 0 || parsed.steps.length > 0)
      ) {
        this.persistPlan(cleanPlanContent).catch((err) => {
          console.error(
            "[ChatViewProvider] Failed to auto-persist cleaned plan:",
            err,
          );
        });
      }

      const nextMessage = {
        ...message,
        plan: {
          file: fallbackPlanFile,
          content: cleanPlanContent,
          title: parsed.goal,
          summary: parsed.description,
          fileCount: parsed.files.length,
        },
      };
      if (message?.structuredOutput?.responseType !== "implementation_plan") {
        const safeMessage =
          "Implementation plan is ready. Use View Plan to inspect details.";
        nextMessage.content = safeMessage;
        const parts = Array.isArray(nextMessage.parts)
          ? [...nextMessage.parts]
          : [];
        const textIndex = parts.findIndex(
          (part: any) => this.isRenderableTextPart(part),
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
        nextMessage.parts = parts;
      }
      return nextMessage;
    }

    return message;
  }

  /**
   * Automatically persists an implementation plan to the workspace
   */
  private async persistPlan(content: string): Promise<void> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) return;

      const filePath = path.join(
        workspaceFolders[0].uri.fsPath,
        "implementation_plan.md",
      );
      const fileUri = vscode.Uri.file(filePath);

      // Extra safety: only write if it looks like a real plan
      if (
        !content.includes("# Implementation Plan") &&
        !content.includes("Proposed Changes")
      ) {
        return;
      }

      await vscode.workspace.fs.writeFile(
        fileUri,
        new TextEncoder().encode(content),
      );
      console.log(`[ChatViewProvider] Auto-persisted plan to ${filePath}`);
    } catch (err) {
      console.error("[ChatViewProvider] persistPlan error:", err);
    }
  }

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
        console.warn(
          "[ChatViewProvider] stopRequest ignored: no active session ID could be resolved.",
        );
        return;
      }

      const client = this.serverManager.getClient();
      if (!client) {
        console.warn(
          `[ChatViewProvider] stopRequest skipped: no server client available for session ${resolvedSessionId}.`,
        );
        return;
      }

      console.log(
        `[ChatViewProvider] Stopping request for session ${resolvedSessionId}`,
      );

      const workspaceDirectory = this.getWorkspaceDirectory();
      await client.session.abort({
        path: { id: resolvedSessionId },
        query: workspaceDirectory ? { directory: workspaceDirectory } : undefined,
      });
    } catch (error) {
      console.error("Failed to stop request:", error);
    } finally {
      this.isProcessingRequest = false;
      this.view?.webview.postMessage({
        type: "stopRequestHandled",
        sessionId: resolvedSessionId,
      });
      this.maybeAutoDrainQueue(resolvedSessionId);
    }
  }

  private postCompactionStatus(payload: {
    status: "running" | "done" | "error";
    sessionId?: string;
    at?: number;
    error?: string;
    baselineStats?: CompactionBaselineStats;
    compactionDividerIndex?: number;
    compactionDividerBeforeMessageId?: string;
    compactionDividerAfterMessageId?: string;
    collapsed?: boolean;
  }): void {
    this.view?.webview.postMessage({
      type: "compactionStatus",
      ...payload,
    });
  }

  private async persistAndPublishCompactionViewState(
    sessionId: string,
    patch: PersistedCompactionViewState,
  ): Promise<PersistedCompactionViewState | null> {
    const existing = await this.loadPersistedCompactionViewState(sessionId);
    const mergedRaw: PersistedCompactionViewState = {
      ...(existing || {}),
      ...patch,
    };
    const normalized = this.normalizeCompactionViewState(mergedRaw);
    if (!normalized) {
      await this.clearPersistedCompactionViewState(sessionId);
      return null;
    }
    await this.savePersistedCompactionViewState(sessionId, normalized);
    this.postCompactionViewState(sessionId, normalized);
    return normalized;
  }

  private async handleSetCompactionViewState(
    message: Record<string, unknown>,
  ): Promise<void> {
    const sessionId = await this.resolveCompactionSessionId(
      this.firstNonEmptyString(message.sessionId),
    );
    if (!sessionId) {
      return;
    }

    const patch: PersistedCompactionViewState = {};
    if (typeof message.lastCompactedAt === "number") {
      patch.lastCompactedAt = message.lastCompactedAt;
    }
    if (typeof message.compactionDividerIndex === "number") {
      patch.compactionDividerIndex = message.compactionDividerIndex;
    }
    const dividerBeforeMessageId = this.firstNonEmptyString(
      message.compactionDividerBeforeMessageId,
    );
    if (dividerBeforeMessageId) {
      patch.compactionDividerBeforeMessageId = dividerBeforeMessageId;
    }
    const dividerAfterMessageId = this.firstNonEmptyString(
      message.compactionDividerAfterMessageId,
    );
    if (dividerAfterMessageId) {
      patch.compactionDividerAfterMessageId = dividerAfterMessageId;
    }
    const baselineStats = this.normalizeCompactionBaselineStats(
      message.baselineStats,
    );
    if (baselineStats) {
      patch.baselineStats = baselineStats;
    }
    if (typeof message.collapsed === "boolean") {
      patch.collapsed = message.collapsed;
    }
    if (Object.keys(patch).length === 0) {
      return;
    }

    await this.persistAndPublishCompactionViewState(sessionId, patch);
  }

  private async resolveCompactionSessionId(
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

    try {
      const currentSession = await this.sessionService.getCurrentSession();
      return this.firstNonEmptyString(currentSession?.id);
    } catch (error) {
      console.warn(
        "[ChatViewProvider] Failed to resolve compaction session from SessionService:",
        error,
      );
      return undefined;
    }
  }

  /**
   * Returns the context token limit for the currently selected model, or
   * undefined if the model/limit is unknown.
   */
  private getSelectedModelContextLimit(): number | undefined {
    if (!this.availableModels?.length || !this.selectedModel) {
      return undefined;
    }
    const matched = this.availableModels.find(
      (m) =>
        m.providerID === this.selectedModel.providerID &&
        m.modelID === this.selectedModel.modelID,
    );
    const limit = matched?.contextLimit;
    return typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : undefined;
  }

  /**
   * Checks whether the context window is at or above the auto-compact
   * threshold after a completed turn and, if so, triggers compaction
   * automatically so the next turn does not hit the limit.
   *
   * The threshold is intentionally set at 90 % so compaction runs while
   * there is still room for the summary that the compaction call itself
   * produces.
   */
  private async maybeAutoCompact(
    sessionId: string,
    responseData: unknown,
  ): Promise<void> {
    if (this.compactingSessions.has(sessionId)) {
      return; // already compacting
    }

    const contextLimit = this.getSelectedModelContextLimit();
    if (!contextLimit) {
      return; // context limit unknown – can't evaluate threshold
    }

    // The `info.tokens.input` field carries the number of tokens that were
    // sent to the model in this turn (i.e. the current context window size).
    const info = (responseData as any)?.info;
    const inputTokens: number = info?.tokens?.input ?? 0;
    if (inputTokens <= 0) {
      return;
    }

    const pct = inputTokens / contextLimit;
    const AUTO_COMPACT_THRESHOLD = 0.9; // 90 %
    if (pct < AUTO_COMPACT_THRESHOLD) {
      return;
    }

    console.log(
      `[ChatViewProvider] Auto-compacting session ${sessionId}: ${inputTokens.toLocaleString()} / ${contextLimit.toLocaleString()} tokens (${Math.round(pct * 100)}%)`,
    );
    vscode.window.showInformationMessage(
      `Context window is ${Math.round(pct * 100)}% full — auto-compacting session to free space…`,
    );

    // Fire-and-forget: compaction runs independently from the current turn.
    this.handleCompactSession(sessionId).catch((err) => {
      console.error("[ChatViewProvider] Auto-compact failed:", err);
    });
  }

  private async handleCompactSession(
    requestedSessionId?: string,
    baselineStats?: CompactionBaselineStats,
  ): Promise<void> {
    const sessionId = await this.resolveCompactionSessionId(requestedSessionId);
    if (!sessionId) {
      this.postCompactionStatus({
        status: "error",
        error: "No active session available for compaction.",
      });
      return;
    }

    const providerID = this.firstNonEmptyString(this.selectedModel.providerID);
    const modelID = this.firstNonEmptyString(this.selectedModel.modelID);
    if (!providerID || !modelID) {
      this.postCompactionStatus({
        status: "error",
        sessionId,
        error: "No model selected for compaction.",
      });
      return;
    }

    const dividerState = await this.resolveSessionCompactionDividerState(
      sessionId,
    );
    this.compactingSessions.add(sessionId);
    this.postCompactionStatus({ status: "running", sessionId });

    try {
      const client = await this.serverManager.ensureRunning();
      const workspaceDirectory = this.getWorkspaceDirectory();
      await client.session.summarize({
        path: { id: sessionId },
        query: workspaceDirectory ? { directory: workspaceDirectory } : undefined,
        body: {
          providerID,
          modelID,
        },
      });
      const compactedAt = Date.now();
      // Always use a zero baseline after compaction. The old messages are
      // replaced by a summary on the server, so subtracting pre-compaction
      // stats would make the context-window meter show 0. Zero baseline means
      // the meter shows the actual tokens currently in context (summary +
      // any new messages since the compact).
      const zeroBaseline: CompactionBaselineStats = {
        input: 0,
        output: 0,
        read: 0,
        write: 0,
        duration: 0,
      };
      await this.persistAndPublishCompactionViewState(
        sessionId,
        {
          lastCompactedAt: compactedAt,
          baselineStats: zeroBaseline,
          // divider at 0 — old messages no longer exist; the summary appears
          // as a regular message so there is nothing to collapse.
          compactionDividerIndex: 0,
          collapsed: true,
        },
      );
      this.compactingSessions.delete(sessionId);
      this.postCompactionStatus({
        status: "done",
        sessionId,
        at: compactedAt,
        baselineStats: zeroBaseline,
        compactionDividerIndex: 0,
        collapsed: true,
      });

      // Reload the session history so the summary message produced by the
      // compaction is immediately visible and its token count drives the meter.
      try {
        // Discard the stale local cache so getMessages fetches from the server.
        await this.sessionService.saveSessionMessages(sessionId, []);
        const freshMessages = await this.sessionService.getMessages(sessionId);
        const processedMessages = this.processHistoryMessages(freshMessages);
        this.view?.webview.postMessage({
          type: "chatHistory",
          sessionId,
          messages: processedMessages,
        });
        await this.sendPersistedCompactionViewState(sessionId);
      } catch (reloadError) {
        console.warn(
          "[ChatViewProvider] Failed to reload history after compaction:",
          reloadError,
        );
      }
    } catch (error) {
      this.compactingSessions.delete(sessionId);
      const msg =
        error instanceof Error
          ? error.message
          : "Failed to compact the current session.";
      this.postCompactionStatus({
        status: "error",
        sessionId,
        error: msg,
      });
    }
  }

  private forwardCompactionStatusFromStreamEvent(event: unknown): void {
    const eventRec = this.asRecord(event);
    if (!eventRec) {
      return;
    }

    const eventType = this.firstNonEmptyString(eventRec.type);
    if (!eventType) {
      return;
    }

    if (eventType !== "session.updated" && eventType !== "session.compacted") {
      return;
    }

    const propertiesRec = this.asRecord(eventRec.properties) || {};
    const infoRec = this.asRecord(propertiesRec.info);
    const timeRec = this.asRecord(infoRec?.time);
    const sessionId = this.firstNonEmptyString(
      propertiesRec.sessionID,
      propertiesRec.sessionId,
      infoRec?.id,
    );
    const activeSessionId = this.firstNonEmptyString(this.currentSessionId);

    if (activeSessionId && sessionId && sessionId !== activeSessionId) {
      return;
    }

    const targetSessionId = sessionId || activeSessionId;
    if (!targetSessionId) {
      return;
    }

    if (eventType === "session.compacted") {
      this.compactingSessions.delete(targetSessionId);
      const compactedAt = Date.now();
      void this.persistAndPublishCompactionViewState(targetSessionId, {
        lastCompactedAt: compactedAt,
        collapsed: true,
      })
        .then((persistedState) => {
          this.postCompactionStatus({
            status: "done",
            sessionId: targetSessionId,
            at: compactedAt,
            baselineStats: persistedState?.baselineStats,
            compactionDividerIndex: persistedState?.compactionDividerIndex,
            compactionDividerBeforeMessageId:
              persistedState?.compactionDividerBeforeMessageId,
            compactionDividerAfterMessageId:
              persistedState?.compactionDividerAfterMessageId,
            collapsed: true,
          });
        })
        .catch(() => {
          this.postCompactionStatus({
            status: "done",
            sessionId: targetSessionId,
            at: compactedAt,
            collapsed: true,
          });
        });
      return;
    }

    const compactingAtRaw = timeRec?.compacting;
    const compactingAt =
      typeof compactingAtRaw === "number" &&
        Number.isFinite(compactingAtRaw) &&
        compactingAtRaw > 0
        ? Math.floor(compactingAtRaw)
        : undefined;

    if (compactingAt) {
      if (!this.compactingSessions.has(targetSessionId)) {
        this.compactingSessions.add(targetSessionId);
        this.postCompactionStatus({
          status: "running",
          sessionId: targetSessionId,
          at: compactingAt,
        });
      }
      return;
    }

    if (this.compactingSessions.has(targetSessionId)) {
      this.compactingSessions.delete(targetSessionId);
      const updatedAtRaw = timeRec?.updated;
      const updatedAt =
        typeof updatedAtRaw === "number" &&
          Number.isFinite(updatedAtRaw) &&
          updatedAtRaw > 0
          ? Math.floor(updatedAtRaw)
          : Date.now();
      void this.persistAndPublishCompactionViewState(targetSessionId, {
        lastCompactedAt: updatedAt,
        collapsed: true,
      })
        .then((persistedState) => {
          this.postCompactionStatus({
            status: "done",
            sessionId: targetSessionId,
            at: updatedAt,
            baselineStats: persistedState?.baselineStats,
            compactionDividerIndex: persistedState?.compactionDividerIndex,
            compactionDividerBeforeMessageId:
              persistedState?.compactionDividerBeforeMessageId,
            compactionDividerAfterMessageId:
              persistedState?.compactionDividerAfterMessageId,
            collapsed: true,
          });
        })
        .catch(() => {
          this.postCompactionStatus({
            status: "done",
            sessionId: targetSessionId,
            at: updatedAt,
            collapsed: true,
          });
        });
    }
  }

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

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const artifactId = this.createPlanArtifactId();
    const planFilename = this.createPlanFilename(artifactId);
    const commentsFilename = this.createPlanCommentsFilename(artifactId);
    const planFilePath = workspaceFolder
      ? path.join(workspaceFolder.uri.fsPath, planFilename)
      : path.join(os.tmpdir(), `opencode-plan-${Date.now()}.md`);
    const commentsFilePath = workspaceFolder
      ? path.join(workspaceFolder.uri.fsPath, commentsFilename)
      : path.join(os.tmpdir(), `opencode-plan-comments-${Date.now()}.md`);

    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(planFilePath),
      new TextEncoder().encode(rawPlan),
    );

    if (hasChangeRequests && commentsMd) {
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(commentsFilePath),
        new TextEncoder().encode(commentsMd),
      );
    }

    const proceedMessage = hasChangeRequests
      ? [
        "Proceed on this plan.",
        `The attached file \`${planFilename}\` is the source of truth.`,
        `Apply all reviewer comments from \`${commentsFilename}\`, then execute the resulting plan.`,
        "Begin making real edits now and continue until the implementation is complete.",
        "Do not return only a status update.",
      ].join("\n")
      : [
        "Proceed on this plan.",
        `The attached file \`${planFilename}\` is the source of truth.`,
        "Execute the plan step-by-step and implement the described changes now.",
        "Begin making real edits now and continue until the implementation is complete.",
        "Do not return only a status update.",
      ].join("\n");

    const attachedFiles = hasChangeRequests
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

    PlanViewProvider.closeCurrentPanel();

    // Fire and forget so the plan tab closes immediately and execution starts in chat.
    void this.handleSendMessage(
      proceedMessage,
      attachedFiles,
      undefined,
      undefined,
      "build",
    ).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to proceed with plan: ${message}`);
    });
  }

  private createPlanArtifactId(): string {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, "")
      .slice(0, 14);
    const random = Math.random().toString(36).slice(2, 8);
    return `${timestamp}-${random}`;
  }

  private createPlanFilename(id: string = this.createPlanArtifactId()): string {
    return `implementation_plan_${id}.md`;
  }

  private createPlanCommentsFilename(
    id: string = this.createPlanArtifactId(),
  ): string {
    return `implementation_plan_comments_${id}.md`;
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

  private migrateSessionSettings(
    oldSessionId: string,
    newSessionId: string,
  ): void {
    if (!oldSessionId || !newSessionId || oldSessionId === newSessionId) {
      return;
    }
    const map = this.getSessionSettingsMap();
    const oldSettings = map[oldSessionId];
    if (!oldSettings) {
      return;
    }
    map[newSessionId] = { ...oldSettings, ...map[newSessionId] };
    void this.context.globalState.update("sessionSettings", map);
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
  private async handleViewPlan(plan: {
    file?: string;
    content?: string;
    title?: string;
  }): Promise<void> {
    let planData: string | undefined;

    // Prefer the file on disk — it is the source of truth.
    // The AI writes the actual plan via tool calls; the structured-output
    // plan.content field may be an earlier draft or summary that differs
    // from what ended up on disk.
    if (
      plan.file &&
      plan.file.endsWith(".md") &&
      !plan.file.includes("\n")
    ) {
      try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
          const filePath = path.join(workspaceFolders[0].uri.fsPath, plan.file);
          const fileUri = vscode.Uri.file(filePath);
          const uint8Array = await vscode.workspace.fs.readFile(fileUri);
          planData = new TextDecoder().decode(uint8Array);
          console.log(`[ChatViewProvider] Read plan from file ${filePath}`);
        }
      } catch (err) {
        console.error(
          `[ChatViewProvider] Failed to read plan file ${plan.file}:`,
          err,
        );
      }
    }

    // Fall back to the structured-output content if the file could not be read
    if (!planData && plan.content && typeof plan.content === "string") {
      planData = plan.content;
      console.log(
        "[ChatViewProvider] Using plan content from structured output (file unavailable)",
      );
    }

    // If we have plan data, show it
    if (planData) {
      const fallbackTitle = planData.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
      await vscode.commands.executeCommand("opencode.showPlan", {
        content: planData,
        title: this.firstNonEmptyString(plan.title, fallbackTitle),
      });
    } else {
      vscode.window.showErrorMessage(
        "Could not read plan file: No plan content available",
      );
    }
  }

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
   * Reconciles the selected model against the fetched model catalog.
   *
   * Matching priority:
   * 1) exact providerID + modelID
   * 2) legacy fallback by modelID only when provider is missing/generic and match is unique
   *
   * We intentionally do NOT remap by modelID alone when multiple providers expose the same model.
   */
  private async reconcileSelectedModelSelection(
    models: Array<{
      providerID: string;
      modelID: string;
      name: string;
      providerName?: string;
    }>,
  ): Promise<void> {
    if (!models.length) {
      return;
    }

    const exact = models.find(
      (m) =>
        m.providerID === this.selectedModel.providerID &&
        m.modelID === this.selectedModel.modelID,
    );
    if (exact) {
      const nextProviderName = exact.providerName || exact.providerID;
      if (this.selectedModel.providerName !== nextProviderName) {
        this.selectedModel = {
          ...this.selectedModel,
          providerName: nextProviderName,
        };
        await this.context.globalState.update(
          "selectedModel",
          this.selectedModel,
        );
      }
      return;
    }

    const isLegacyGenericProvider =
      !this.selectedModel.providerID ||
      this.selectedModel.providerID === "opencode";
    if (!isLegacyGenericProvider) {
      console.warn(
        `[ChatViewProvider] Persisted model ${this.selectedModel.providerID}/${this.selectedModel.modelID} not found in provider catalog; keeping persisted selection unchanged.`,
      );
      return;
    }

    const candidates = models.filter(
      (m) => m.modelID === this.selectedModel.modelID,
    );
    if (candidates.length === 1) {
      const match = candidates[0];
      this.selectedModel = {
        providerID: match.providerID,
        modelID: match.modelID,
        providerName: match.providerName || match.providerID,
      };
      await this.context.globalState.update(
        "selectedModel",
        this.selectedModel,
      );
      console.log(
        `[ChatViewProvider] Reconciled legacy model selection to ${this.selectedModel.providerID}/${this.selectedModel.modelID}.`,
      );
      return;
    }

    if (candidates.length > 1) {
      console.warn(
        `[ChatViewProvider] Ambiguous modelID '${this.selectedModel.modelID}' across multiple providers; refusing to auto-remap. Please select provider/model explicitly.`,
      );
    }
  }

  /**
   * Resolves the default model from the CLI config
   */
  private async resolveDefaultModel(
    models: Array<{
      providerID: string;
      modelID: string;
      name: string;
      providerName?: string;
    }>,
  ): Promise<void> {
    // Only attempt if we are still on the hardcoded default AND we haven't loaded a persisted model
    // We check if the current model is exactly the hardcoded default to allow CLI sync.
    // However, if we loaded from globalState, we want to keep that unless it's invalid.
    // So, if we have a persisted model that is NOT the hardcoded default, we skip this.

    const savedModel = this.context.globalState.get<{
      providerID: string;
      modelID: string;
    }>("selectedModel");

    // If we have a saved model and it matches what we currently have (meaning we loaded it in constructor),
    // and it's NOT the hardcoded default, then we respect the user's choice and do NOT overwrite with CLI.
    if (
      savedModel &&
      this.selectedModel.modelID === savedModel.modelID &&
      this.selectedModel.providerID === savedModel.providerID &&
      (this.selectedModel.modelID !== "big-pickle" ||
        this.selectedModel.providerID !== "opencode")
    ) {
      return;
    }

    if (
      this.selectedModel.modelID !== "big-pickle" ||
      this.selectedModel.providerID !== "opencode"
    ) {
      return;
    }

    try {
      const cp = await import("child_process");
      const util = await import("util");
      const execAsync = util.promisify(cp.exec);

      const { stdout } = await execAsync("opencode config get default_model");
      const defaultId = stdout.trim();

      if (defaultId) {
        console.log(`[ChatViewProvider] Found CLI default model: ${defaultId}`);
        const providerModelMatch = defaultId.match(/^([^/:\s]+)[/:](.+)$/);
        let match:
          | {
            providerID: string;
            modelID: string;
            name: string;
            providerName?: string;
          }
          | undefined;

        // Preferred: explicit provider/model pair
        if (providerModelMatch) {
          const providerRef = providerModelMatch[1].trim();
          const modelRef = providerModelMatch[2].trim();
          match = models.find(
            (m) =>
              m.providerID === providerRef &&
              (m.modelID === modelRef || m.name === modelRef),
          );
          if (!match) {
            match = models.find(
              (m) =>
                (m.providerName || "").toLowerCase() ===
                providerRef.toLowerCase() &&
                (m.modelID === modelRef || m.name === modelRef),
            );
          }
        }

        if (match) {
          this.selectedModel = {
            modelID: match.modelID,
            providerID: match.providerID,
            providerName: match.providerName || match.providerID,
          };
          console.log(
            `[ChatViewProvider] Synced default model to: ${match.modelID} (${match.providerID})`,
          );
        } else {
          // Backward-compatible fallback: allow model-only identifiers only when unique
          const byModelId = models.filter((m) => m.modelID === defaultId);
          if (byModelId.length === 1) {
            match = byModelId[0];
          } else {
            const byName = models.filter((m) => m.name === defaultId);
            if (byName.length === 1) {
              match = byName[0];
            }
          }
        }

        if (match) {
          this.selectedModel = {
            providerID: match.providerID,
            modelID: match.modelID,
            providerName: match.providerName || match.providerID,
          };
          await this.context.globalState.update(
            "selectedModel",
            this.selectedModel,
          );
          console.log(
            `[ChatViewProvider] Synced default model to: ${match.modelID} (${match.providerID})`,
          );
        } else {
          console.warn(
            `[ChatViewProvider] Could not uniquely resolve CLI default model '${defaultId}'. Keeping current selection ${this.selectedModel.providerID}/${this.selectedModel.modelID}.`,
          );
        }
      }
    } catch (error) {
      console.warn(
        "[ChatViewProvider] Failed to resolve default model from CLI:",
        error,
      );
    }
  }

  /**
   * Handles fetching available models from OpenCode
   */
  private async handleGetModels(): Promise<ChatModelOption[]> {
    if (this.modelsFetchPromise) {
      return this.modelsFetchPromise;
    }

    this.modelsFetchPromise = (async () => {
      try {
        const client = await this.serverManager.ensureRunning();

        // Add timeout to provider list call
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Provider list timeout")), 15000),
        );

        // Use provider.list() instead of config.get() to see all available models
        const response = (await Promise.race([
          client.provider.list(),
          timeoutPromise,
        ])) as any; // Type assertion since race result type is union

        if (response.data && response.data.all) {
          const models: ChatModelOption[] = [];

          for (const provider of response.data.all) {
            if (provider.models) {
              for (const [modelID, modelConfig] of Object.entries(
                provider.models,
              )) {
                const limitRec = this.asRecord((modelConfig as any).limit);
                const contextLimitRaw = limitRec?.context;
                const contextLimit =
                  typeof contextLimitRaw === "number" &&
                    Number.isFinite(contextLimitRaw) &&
                    contextLimitRaw > 0
                    ? Math.floor(contextLimitRaw)
                    : undefined;
                models.push({
                  providerID: provider.id,
                  modelID: modelID,
                  name: (modelConfig as any).name || modelID,
                  providerName: provider.name || provider.id,
                  contextLimit,
                });
              }
            }
          }

          console.log(
            `Discovered ${models.length} total models across all providers`,
          );

          // Cache models for later resolution and try to sync default model before sending to UI
          this.availableModels = models;
          await this.resolveDefaultModel(models);

          this.view?.webview.postMessage({
            type: "modelsList",
            models,
            selectedModel: this.selectedModel,
          });

          return models;
        }
      } catch (error) {
        console.error("Failed to get models:", error);
        // Send empty list to allow UI to proceed
        this.availableModels = [];
        this.view?.webview.postMessage({
          type: "modelsList",
          models: [],
          selectedModel: this.selectedModel,
        });
      }
      return [];
    })();

    try {
      return await this.modelsFetchPromise;
    } finally {
      this.modelsFetchPromise = null;
    }
  }

  /**
   * Fetches slash commands from OpenCode SDK and sends them to the webview.
   * Uses a short-lived cache because commands are mostly static during a session.
   */
  private async handleGetCommands(): Promise<void> {
    try {
      const commands = await this.loadCommandCatalog();
      this.view?.webview.postMessage({
        type: "commandsList",
        commands,
      });
    } catch (error) {
      console.error("[ChatViewProvider] Failed to fetch command catalog:", error);
      this.view?.webview.postMessage({
        type: "commandsList",
        commands: [],
      });
    }
  }

  private async loadCommandCatalog(forceRefresh = false): Promise<ChatSlashCommand[]> {
    const cacheIsFresh =
      !forceRefresh &&
      this.commandCatalog.length > 0 &&
      Date.now() - this.commandCatalogFetchedAt < this.COMMAND_CATALOG_TTL_MS;
    if (cacheIsFresh) {
      return this.commandCatalog;
    }

    if (this.commandCatalogFetchPromise) {
      return this.commandCatalogFetchPromise;
    }

    this.commandCatalogFetchPromise = (async () => {
      const client = await this.serverManager.ensureRunning();
      const response = await client.command.list();
      const rawItems = Array.isArray(response.data) ? response.data : [];
      const commands: ChatSlashCommand[] = rawItems
        .map((item) => this.normalizeSlashCommand(item))
        .filter((item): item is ChatSlashCommand => !!item)
        .sort((a, b) => a.name.localeCompare(b.name));

      this.commandCatalog = commands;
      this.commandCatalogFetchedAt = Date.now();
      return commands;
    })();

    try {
      return await this.commandCatalogFetchPromise;
    } finally {
      this.commandCatalogFetchPromise = null;
    }
  }

  private normalizeSlashCommand(item: SdkCommand | unknown): ChatSlashCommand | null {
    const rec = this.asRecord(item);
    if (!rec) {
      return null;
    }

    const rawName = this.firstNonEmptyString(rec.name);
    if (!rawName) {
      return null;
    }

    const name = rawName.replace(/^\//, "");
    if (!name) {
      return null;
    }

    return {
      name,
      description: this.firstNonEmptyString(rec.description),
      agent: this.firstNonEmptyString(rec.agent),
      model: this.firstNonEmptyString(rec.model),
      template: this.firstNonEmptyString(rec.template),
      source: this.firstNonEmptyString(rec.source),
      subtask: typeof rec.subtask === "boolean" ? rec.subtask : undefined,
    };
  }

  /**
   * Handles fetching available agents via the OpenCode SDK and sends the list
   * to the webview. Falls back to a minimal built-in list if the server is
   * unavailable.
   */
  // ─── Per-session settings helpers ────────────────────────────────────────

  /** Returns the full persisted map of all session settings. */
  private getSessionSettingsMap(): Record<string, SessionSettings> {
    return (
      this.context.globalState.get<Record<string, SessionSettings>>(
        "sessionSettings",
      ) ?? {}
    );
  }

  /**
   * Returns the persisted settings for a specific session.
   * Returns an empty object when no settings have been saved yet.
   */
  private getSessionSettings(sessionId: string): SessionSettings {
    return this.getSessionSettingsMap()[sessionId] ?? {};
  }

  /**
   * Merges `partial` into the persisted settings for `sessionId` and saves
   * the updated map back to global state.
   */
  private async persistSessionSettings(
    sessionId: string,
    partial: Partial<SessionSettings>,
  ): Promise<void> {
    const map = this.getSessionSettingsMap();
    map[sessionId] = { ...map[sessionId], ...partial };
    await this.context.globalState.update("sessionSettings", map);
  }

  /**
   * Loads the persisted settings for `sessionId` and applies them to the
   * provider's in-memory state (`selectedAgent`, `selectedModel`).
   * Fields that have no saved value are left unchanged.
   */
  private async applySessionSettings(sessionId: string): Promise<void> {
    const settings = this.getSessionSettings(sessionId);
    if (settings.agent) {
      this.selectedAgent = settings.agent;
      console.log(
        `[ChatViewProvider] Restored agent '${settings.agent}' for session ${sessionId}`,
      );
    }
    if (settings.model?.providerID && settings.model?.modelID) {
      this.selectedModel = settings.model;
      console.log(
        `[ChatViewProvider] Restored model '${settings.model.modelID}' for session ${sessionId}`,
      );
    }
  }

  private async handleGetAgents(): Promise<void> {
    // Hidden system agents that run automatically and are not user-selectable.
    const HIDDEN_SYSTEM_AGENTS = new Set(["compaction", "title", "summary"]);

    // Default built-in primary agents that must always appear in the list.
    // The SDK's app.agents() endpoint only returns plugin-registered agents
    // (e.g. oh-my-opencode) and does not enumerate the built-in ones, so we
    // ensure they are always present by merging them in manually.
    const BUILTIN_AGENTS: Array<{
      id: string;
      name: string;
      description: string;
      mode: "primary" | "subagent" | "all";
      builtIn: boolean;
    }> = [
        {
          id: "build",
          name: "Build",
          description:
            "Default agent for development work with all tools enabled",
          mode: "primary",
          builtIn: true,
        },
        {
          id: "plan",
          name: "Plan",
          description:
            "Restricted agent for planning and analysis without making changes",
          mode: "primary",
          builtIn: true,
        },
      ];

    try {
      const client = await this.serverManager.ensureRunning();
      const response = await client.app.agents();

      if (response.data && Array.isArray(response.data)) {
        const sdkAgents: Array<{
          id: string;
          name: string;
          description: string;
        }> = response.data
          .filter((agent: any) => {
            const mode = agent.mode as string;
            // Only expose agents that can be selected as a primary agent.
            return (
              (mode === "primary" || mode === "all") &&
              !HIDDEN_SYSTEM_AGENTS.has(agent.name as string)
            );
          })
          .map((agent: any) => {
            const id = agent.name as string;
            const displayName = id.charAt(0).toUpperCase() + id.slice(1);
            return {
              id,
              name: displayName,
              description:
                (agent.description as string | undefined) ??
                `OpenCode ${displayName} agent`,
              mode: agent.mode as "subagent" | "primary" | "all",
              builtIn: agent.builtIn as boolean,
              color: agent.color as string | undefined,
            };
          });

        // Prepend any built-in agents that the SDK did not return, so the
        // user always sees build + plan even when only plugin agents come back.
        // SDK results take precedence when names overlap (respecting config overrides).
        const sdkIds = new Set(sdkAgents.map((a) => a.id));
        const agents = [
          ...BUILTIN_AGENTS.filter((a) => !sdkIds.has(a.id)),
          ...sdkAgents,
        ];

        // Set a sensible default if none has been chosen yet.
        if (!this.selectedAgent && agents.length > 0) {
          this.selectedAgent = agents[0].id;
        }

        console.log(
          `[ChatViewProvider] Fetched ${sdkAgents.length} agent(s) via SDK; merged to ${agents.length} total (including built-ins)`,
        );

        this.view?.webview.postMessage({
          type: "agentsList",
          agents,
          selectedAgent: this.selectedAgent,
        });
        return;
      }
    } catch (error) {
      console.error(
        "[ChatViewProvider] Failed to fetch agents via SDK:",
        error,
      );
    }

    // Fallback: send only the guaranteed built-in primary agents.
    this.view?.webview.postMessage({
      type: "agentsList",
      agents: BUILTIN_AGENTS,
      selectedAgent: this.selectedAgent || "build",
    });
  }

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
      const res = await client.lsp.status();
      const servers = Array.isArray(res.data) ? res.data : [];

      this.view?.webview.postMessage({
        type: "lspStatus",
        servers,
      });

      log.info(`LSP status sent: ${servers.length} server(s)`);
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
          const fileUri = vscode.Uri.file(path.join(cwd, file));
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
        } catch (e) {
          console.warn(
            `[ChatViewProvider] Failed to read untracked file ${file}:`,
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
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open file: ${error.message}`);
    }
  }

  private getSessionQueue(sessionId: string): QueuedPrompt[] {
    return this.queueBySessionId.get(sessionId) ?? [];
  }

  private setSessionQueue(sessionId: string, queue: QueuedPrompt[]): void {
    if (queue.length > 0) {
      this.queueBySessionId.set(sessionId, queue);
      return;
    }
    this.queueBySessionId.delete(sessionId);
  }

  private createQueuedPrompt(
    sessionId: string,
    text: string,
    files?: string[],
    contexts?: any[],
    images?: any[],
    agent?: string,
  ): QueuedPrompt {
    this.queueItemSequence += 1;
    return {
      id: `q-${Date.now()}-${this.queueItemSequence}`,
      sessionId,
      createdAt: Date.now(),
      text,
      files,
      contexts,
      images,
      agent,
    };
  }

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
      console.error(
        "[ChatViewProvider] Failed to resolve queue session ID:",
        error,
      );
      return undefined;
    }
  }

  private enqueuePrompt(
    sessionId: string,
    prompt: QueuedPrompt,
    atFront: boolean,
  ): void {
    const queue = this.getSessionQueue(sessionId);
    const nextQueue = atFront ? [prompt, ...queue] : [...queue, prompt];
    this.setSessionQueue(sessionId, nextQueue);
    this.sendQueueUpdate(sessionId);
  }

  private takeQueuedPrompt(
    sessionId: string,
    itemId?: string,
    index?: number,
  ): QueuedPrompt | undefined {
    const queue = this.getSessionQueue(sessionId);
    if (queue.length === 0) {
      return undefined;
    }

    const byIdIndex =
      typeof itemId === "string" && itemId.length > 0
        ? queue.findIndex((item) => item.id === itemId)
        : -1;
    const targetIndex =
      byIdIndex >= 0
        ? byIdIndex
        : typeof index === "number" && index >= 0 && index < queue.length
          ? index
          : -1;
    if (targetIndex < 0) {
      return undefined;
    }

    const [item] = queue.splice(targetIndex, 1);
    this.setSessionQueue(sessionId, queue);
    this.sendQueueUpdate(sessionId);
    return item;
  }

  // PROMPT-OWNERSHIP: do not modify — transport-only path
  private async schedulePromptDispatch(
    mode: PromptDispatchMode,
    payload: {
      sessionId?: string;
      text?: string;
      files?: string[];
      contexts?: any[];
      images?: any[];
      agent?: string;
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
      mode === "send-now" && this.isProcessingRequest ? "steer" : mode;
    const prompt = this.createQueuedPrompt(
      sessionId,
      text,
      payload.files,
      payload.contexts,
      payload.images,
      payload.agent,
    );
    const atFront = effectiveMode !== "queue";
    this.enqueuePrompt(sessionId, prompt, atFront);

    if (effectiveMode === "queue") {
      return;
    }

    if (this.isProcessingRequest) {
      if (sessionId === this.currentSessionId) {
        await this.handleStopRequest(sessionId);
      }
      return;
    }

    await this.handleExecuteQueue(sessionId);
  }

  private async handleDispatchQueuedItem(
    mode: PromptDispatchMode,
    requestedSessionId?: string,
    itemId?: string,
    index?: number,
  ): Promise<void> {
    const sessionId = await this.resolveQueueSessionId(requestedSessionId);
    if (!sessionId) {
      return;
    }

    const queuedItem = this.takeQueuedPrompt(sessionId, itemId, index);
    if (!queuedItem) {
      return;
    }

    await this.schedulePromptDispatch(mode, {
      sessionId,
      text: queuedItem.text,
      files: queuedItem.files,
      contexts: queuedItem.contexts,
      images: queuedItem.images,
      agent: queuedItem.agent,
    });
  }

  /**
   * Removes a message from a session queue
   */
  private async handleRemoveFromQueue(
    requestedSessionId?: string,
    itemId?: string,
    index?: number,
  ): Promise<void> {
    const sessionId = await this.resolveQueueSessionId(requestedSessionId);
    if (!sessionId) {
      return;
    }
    this.takeQueuedPrompt(sessionId, itemId, index);
  }

  /**
   * Clears the prompt queue for a given session
   */
  private async handleClearQueue(requestedSessionId?: string): Promise<void> {
    const sessionId = await this.resolveQueueSessionId(requestedSessionId);
    if (!sessionId) {
      return;
    }
    this.setSessionQueue(sessionId, []);
    this.sendQueueUpdate(sessionId);
  }

  /**
   * Executes a session queue sequentially. Only one queue drain can run at a time.
   */
  private async handleExecuteQueue(requestedSessionId?: string): Promise<void> {
    const sessionId = await this.resolveQueueSessionId(requestedSessionId);
    if (!sessionId) {
      return;
    }

    if (this.isExecutingQueue || this.isProcessingRequest) {
      return;
    }

    if (sessionId !== this.currentSessionId) {
      return;
    }

    if (this.getSessionQueue(sessionId).length === 0) {
      return;
    }

    this.isExecutingQueue = true;
    this.view?.webview.postMessage({
      type: "queueExecutionStarted",
      sessionId,
    });

    try {
      while (sessionId === this.currentSessionId && !this.isProcessingRequest) {
        const nextItem = this.takeQueuedPrompt(sessionId, undefined, 0);
        if (!nextItem) {
          break;
        }

        await this.handleSendMessage(
          nextItem.text,
          nextItem.files,
          nextItem.contexts,
          nextItem.images,
          nextItem.agent,
        );
      }
    } catch (error) {
      console.error("[ChatViewProvider] Queue execution failed:", error);
      vscode.window.showErrorMessage(`Queue execution error: ${error}`);
    } finally {
      this.isExecutingQueue = false;
      this.view?.webview.postMessage({
        type: "queueExecutionFinished",
        sessionId,
      });
      this.sendQueueUpdate(sessionId);
    }
  }

  private maybeAutoDrainQueue(sessionId?: string): void {
    const targetSessionId = this.firstNonEmptyString(sessionId);
    if (!targetSessionId) {
      return;
    }
    if (this.isExecutingQueue || this.isProcessingRequest) {
      return;
    }
    if (targetSessionId !== this.currentSessionId) {
      return;
    }
    if (this.getSessionQueue(targetSessionId).length === 0) {
      return;
    }
    void this.handleExecuteQueue(targetSessionId);
  }

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
  private sendQueueUpdate(sessionId?: string) {
    const targetSessionId = this.firstNonEmptyString(
      sessionId,
      this.currentSessionId,
    );
    if (!targetSessionId) {
      return;
    }
    this.view?.webview.postMessage({
      type: "queueUpdate",
      sessionId: targetSessionId,
      queue: this.getSessionQueue(targetSessionId),
    });
  }

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
