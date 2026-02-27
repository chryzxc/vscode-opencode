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
 *         'deleteSession' | 'getSessions' | 'toggleMode' | 'getModels' |
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
 * @see webview/chat/app.js for frontend implementation
 */

import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as cp from "child_process";
import { OpencodeServerManager } from "../services/OpencodeServerManager";
import { SessionService } from "../services/SessionService";
import { MessageStreamService } from "../services/MessageStreamService";
import type { Session, SessionPromptData } from "@opencode-ai/sdk";
import { QuotaService } from "../services/QuotaService";
import { SubagentTracker } from "../services/SubagentTracker";
import { PlanViewProvider } from "./PlanViewProvider";
import { createLogger } from "../utils/Logger";

const log = createLogger("ChatViewProvider");
type QueuedPrompt = {
  text: string;
  files?: string[];
  contexts?: any[];
  images?: any[];
  agent?: string;
};

type PlanProceedComment = {
  id: string;
  anchor: {
    startLine: number;
    endLine: number;
    selectedText: string;
  };
  text: string;
  createdAt: number;
};

type StructuredResponseType =
  | "message"
  | "implementation_plan"
  | "progress_update"
  | "error";

type StructuredProgressUpdate = {
  title: string;
  status?: "pending" | "done" | "error";
  meta?: string;
  filePath?: string;
};

type StructuredAssistantOutput = {
  responseType?: StructuredResponseType | string;
  message?: string;
  reasoning?: string[];
  progressUpdates?: StructuredProgressUpdate[];
  plan?: {
    file?: string;
    content?: string;
    title?: string;
    summary?: string;
  };
};

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
export class ChatViewProvider implements vscode.WebviewViewProvider {
  /** The webview instance (undefined before initialization) */
  private view?: vscode.WebviewView;

  /** Service for streaming events from the server */
  private streamService: MessageStreamService;

  /** Unsubscribe function for stream service cleanup */
  private unsubscribe?: () => void;

  /** Service for monitoring AI platform quota usage */
  private quotaService: QuotaService;
  private subagentTracker: SubagentTracker;

  /** Currently selected AI model (persisted to global state) */
  private selectedModel: { providerID: string; modelID: string; providerName?: string } = {
    providerID: "opencode",
    modelID: "big-pickle",
    providerName: undefined,
  };

  /** Cache of available models returned from the server (used to resolve providerName) */
  // Cache of available models returned from the server (used to resolve providerName)
  // This cached list allows the extension to enrich selections sent from the webview
  // when the webview omits providerName.
  private availableModels?: Array<{
    providerID: string;
    modelID: string;
    name: string;
    providerName: string;
  }>;

  /** Currently selected CLI agent */
  private selectedAgent: string = "general";

  /** Queue of prompts awaiting execution */
  private queue: QueuedPrompt[] = [];

  /** Flag indicating if queue is currently being executed */
  private isExecutingQueue: boolean = false;

  private isProcessingRequest: boolean = false;
  private isBootstrappingWebview: boolean = false;
  private hasInitializedWebview: boolean = false;
  private structuredOutputMode: "outputFormat" | "format" | "disabled" =
    "outputFormat";
  private modelsFetchPromise: Promise<
    Array<{
      providerID: string;
      modelID: string;
      name: string;
      providerName: string;
    }>
  > | null = null;

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
    this.streamService = new MessageStreamService(serverManager);
    this.quotaService = new QuotaService();
    this.subagentTracker = new SubagentTracker();
    this.quotaService.on("quotaUpdate", (data) => {
      this.view?.webview.postMessage({ type: "quotaData", data });
    });

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
          if (!this.hasInitializedWebview) {
            // Reply immediately so the webview stops retrying `ready` while
            // slower bootstrap tasks (models/sessions) are still loading.
            this.view?.webview.postMessage({
              type: "initState",
              serverStatus: this.serverManager.getStatus(),
              selectedModel: this.selectedModel,
              selectedAgent: this.selectedAgent,
            });
            this.hasInitializedWebview = true;
          }

          try {
          // Fetch models first to ensure we have correct provider IDs
          const models = await this.handleGetModels();

          // Reconcile selected model by full identity (provider + model), not model ID alone.
          await this.reconcileSelectedModelSelection(models);

          // Fetch agents and default agent from CLI
          await this.syncCLIAgents();

          // Send refreshed init state after model/agent resolution
          this.view?.webview.postMessage({
            type: "initState",
            serverStatus: this.serverManager.getStatus(),
            selectedModel: this.selectedModel,
            selectedAgent: this.selectedAgent,
          });

          // Fetch and send chat history and sessions list
          const currentSession = await this.sessionService.getCurrentSession();
          if (currentSession) {
            this.subagentTracker.setActiveSession(currentSession.id);
            const rawMessages = await this.sessionService.getMessages(
              currentSession.id,
            );
            const messages = rawMessages.map((m: any) =>
              this.enrichMessageWithPlan(this.applyStructuredOutputToMessage(m)),
            );
            this.view?.webview.postMessage({
              type: "chatHistory",
              messages: messages,
            });
            this.syncSubagentSnapshotForSession(currentSession.id, messages as any[]);
          } else {
            this.subagentTracker.resetForSession(null);
            this.view?.webview.postMessage({
              type: "subagentSnapshot",
              ...this.subagentTracker.getSnapshotPayload(),
            });
          }

          await this.handleGetSessions();
          this.refreshView();

          // Send quota data or trigger initial fetch
          const quotaData = this.quotaService.cachedData;
          if (quotaData) {
            this.view?.webview.postMessage({ type: "quotaData", data: quotaData });
          } else {
            this.quotaService.refreshQuota().catch(() => {});
          }
          } finally {
            this.isBootstrappingWebview = false;
          }
          break;
        }
        case "sendMessage":
        case "sendPrompt": {
          await this.handleSendMessage(
            message.text,
            message.files,
            message.contexts,
            message.images,
            message.agent,
          );
          break;
        }
        case "newSession":
        case "createSession": {
          const createdSession = await this.sessionService.createNewSession();
          this.subagentTracker.resetForSession(createdSession.id);
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
            message.model ||
            {
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
              (m) => m.providerID === incoming.providerID && m.modelID === incoming.modelID,
            );
            providerName = found?.providerName || incoming.providerID;
          }

          this.selectedModel = {
            providerID: incoming.providerID,
            modelID: incoming.modelID,
            providerName,
          };

          // Persist selection
          await this.context.globalState.update("selectedModel", this.selectedModel);
          console.log(
            `[ChatViewProvider] Persisted model selection: ${this.selectedModel.modelID} (${this.selectedModel.providerName})`,
          );
          break;
        }
        case "selectAgent":
        case "setAgent": {
          this.selectedAgent = message.agent;
          break;
        }
        case "getAgents": {
          this.handleGetAgents();
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
        case "stopRequest": {
          await this.handleStopRequest(message.sessionId);
          break;
        }
        case "addToQueue": {
          this.handleAddToQueue(
            message.text,
            message.files,
            message.contexts,
            message.images,
            message.agent,
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
          this.handleRemoveFromQueue(message.index);
          break;
        }
        case "clearQueue": {
          this.handleClearQueue();
          break;
        }
        case "executeQueue": {
          this.handleExecuteQueue();
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
            console.log(`[ChatViewProvider] Thinking level set to ${level}`);
            this.view?.webview.postMessage({ type: "thinkingLevelSet", level });
          }
          break;
        }
        case "addAttachment": {
          const attachment = message.attachment;
          if (!attachment) break;
          const existing = (this.context.globalState.get<any[]>("pendingAttachments") || []) as any[];
          existing.push(attachment);
          await this.context.globalState.update("pendingAttachments", existing);
          this.view?.webview.postMessage({ type: "attachmentAdded", attachmentId: attachment.id });
          break;
        }
        case "clearAttachments": {
          await this.context.globalState.update("pendingAttachments", []);
          this.view?.webview.postMessage({ type: "attachmentsCleared" });
          break;
        }
        case "planProceed": {
          const payload = message.payload;
          await this.context.globalState.update("lastPlanProceed", payload || null);
          console.log("[ChatViewProvider] planProceed received");
          this.view?.webview.postMessage({ type: "planProceedAck", payload: { received: true } });
          break;
        }
      }
    });

    // Subscribe to stream events
    this.unsubscribe = this.streamService.subscribe((event) => {
      const subagentUpdate = this.subagentTracker.consumeStreamEvent(event);
      if (subagentUpdate) {
        this.view?.webview.postMessage({
          type: "subagentUpdate",
          ...subagentUpdate,
        });
      }

      // Forward events to webview
      const enrichedEvent = this.enrichStreamEvent(event);
      this.view?.webview.postMessage({
        type: "streamEvent",
        event: enrichedEvent,
      });
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
      statusSubscription.dispose();
      this.quotaService.dispose();
      this.view = undefined;
    });
  }

  /**
   * Handles getting the sessions list
   */
  private async handleGetSessions(): Promise<void> {
    try {
      const sessions = await this.sessionService.listSessions();
      const currentSession = await this.sessionService.getCurrentSession();

      // Transform Session objects to match webview expectations
      // SDK Session has nested `time.created`, webview expects `createdAt`
      const transformedSessions = sessions.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.time?.created,
      }));

      this.view?.webview.postMessage({
        type: "sessionsList",
        sessions: transformedSessions,
        currentSessionId: currentSession?.id,
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
      this.subagentTracker.setActiveSession(sessionId);

      // Reload history for the new session
      const rawMessages = await this.sessionService.getMessages(sessionId);
      const messages = rawMessages.map((m: any) =>
        this.enrichMessageWithPlan(this.applyStructuredOutputToMessage(m)),
      );

      this.view?.webview.postMessage({
        type: "chatHistory",
        messages: messages,
      });
      this.syncSubagentSnapshotForSession(sessionId, messages as any[]);

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
      const wasCurrentSession = (await this.sessionService.getCurrentSession())?.id === sessionId;

      await this.sessionService.deleteSession(sessionId);
      await this.handleGetSessions();

      // If we deleted the current session, create a new one and clear messages
      if (wasCurrentSession) {
        const currentSession = await this.sessionService.getCurrentSession();
        if (!currentSession) {
          await this.sessionService.createNewSession();
        }
        this.subagentTracker.resetForSession(currentSession?.id || null);
        this.view?.webview.postMessage({
          type: "chatHistory",
          messages: [],
        });
        this.view?.webview.postMessage({
          type: "subagentSnapshot",
          ...this.subagentTracker.getSnapshotPayload(),
        });
        await this.handleGetSessions();
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to delete session: ${error}`);
    }
  }

  /**
   * Gets the unified system instruction
   */
  private getSystemInstruction(): string {
    return "";
  }

  private getStructuredOutputFormat(): Record<string, unknown> {
    return {
      type: "json_schema",
      name: "opencode_assistant_response",
      strict: false,
      schema: {
        type: "object",
        additionalProperties: true,
        properties: {
          responseType: {
            type: "string",
            enum: ["message", "implementation_plan", "progress_update", "error"],
          },
          message: { type: "string" },
          reasoning: {
            type: "array",
            items: { type: "string" },
          },
          progressUpdates: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                title: { type: "string" },
                status: { type: "string", enum: ["pending", "done", "error"] },
                meta: { type: "string" },
                filePath: { type: "string" },
              },
            },
          },
          plan: {
            type: "object",
            additionalProperties: true,
            properties: {
              file: { type: "string" },
              content: { type: "string" },
              title: { type: "string" },
              summary: { type: "string" },
            },
          },
        },
      },
    };
  }

  private isStructuredFormatUnsupportedError(error: unknown): boolean {
    const text = JSON.stringify(error || "").toLowerCase();
    const mentionsFormat =
      text.includes("outputformat") ||
      text.includes("output_format") ||
      text.includes("\"format\"") ||
      text.includes("format:");
    const mentionsUnsupported =
      text.includes("unknown") ||
      text.includes("unsupported") ||
      text.includes("unexpected") ||
      text.includes("invalid");
    return mentionsFormat && mentionsUnsupported;
  }

  private async promptWithStructuredOutput(
    client: any,
    sessionID: string,
    body: NonNullable<SessionPromptData["body"]>,
  ) {
    const callPrompt = (requestBody: Record<string, unknown>) =>
      client.session.prompt({
        path: { id: sessionID },
        body: requestBody as SessionPromptData["body"],
      });

    const schema = this.getStructuredOutputFormat();

    if (this.structuredOutputMode === "disabled") {
      return callPrompt(body as Record<string, unknown>);
    }

    const requestWithFormat: Record<string, unknown> =
      this.structuredOutputMode === "format"
        ? { ...(body as Record<string, unknown>), format: schema }
        : { ...(body as Record<string, unknown>), outputFormat: schema };
    const firstAttempt = await callPrompt(requestWithFormat);
    if (!firstAttempt.error) {
      return firstAttempt;
    }

    if (!this.isStructuredFormatUnsupportedError(firstAttempt.error)) {
      return firstAttempt;
    }

    if (this.structuredOutputMode === "outputFormat") {
      this.structuredOutputMode = "format";
      const secondAttempt = await callPrompt({
        ...(body as Record<string, unknown>),
        format: schema,
      });
      if (!secondAttempt.error) {
        return secondAttempt;
      }
      if (!this.isStructuredFormatUnsupportedError(secondAttempt.error)) {
        return secondAttempt;
      }
    }

    this.structuredOutputMode = "disabled";
    log.warn(
      "Structured output format is not supported by this OpenCode server version. Falling back to plain prompts.",
    );
    return callPrompt(body as Record<string, unknown>);
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

  private extractMessageId(message: any): string | undefined {
    if (!message || typeof message !== "object") {
      return undefined;
    }
    return this.firstNonEmptyString(
      message?.info?.id,
      message?.id,
      message?.messageID,
    );
  }

  private syncSubagentSnapshotForSession(
    sessionId: string,
    messages: any[],
  ): void {
    this.subagentTracker.resetForSession(sessionId);
    this.subagentTracker.seedFromMessages(messages);
    this.view?.webview.postMessage({
      type: "subagentSnapshot",
      ...this.subagentTracker.getSnapshotPayload(),
    });
  }

  private normalizeStructuredOutput(raw: unknown): StructuredAssistantOutput | undefined {
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

    const responseType = this.firstNonEmptyString(
      rec.responseType,
      rec.type,
      rec.kind,
      rec.category,
    );
    const message = this.firstNonEmptyString(
      rec.message,
      rec.output,
      rec.answer,
      rec.content,
      rec.text,
    );

    const reasoningRaw = rec.reasoning ?? rec.thinking ?? rec.thoughts;
    const reasoning = Array.isArray(reasoningRaw)
      ? reasoningRaw
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      : typeof reasoningRaw === "string" && reasoningRaw.trim()
        ? [reasoningRaw.trim()]
        : [];

    const progressRaw = rec.progressUpdates ?? rec.progress_updates;
    const progressUpdates = Array.isArray(progressRaw)
      ? progressRaw
          .map((item) => {
            const update = this.asRecord(item);
            if (!update) return null;
            const title = this.firstNonEmptyString(update.title, update.message);
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

    const planRec = this.asRecord(rec.plan);
    const plan =
      planRec || responseType === "implementation_plan"
        ? {
            file: this.firstNonEmptyString(planRec?.file) || "implementation_plan.md",
            content: this.firstNonEmptyString(
              planRec?.content,
              planRec?.markdown,
              message,
            ),
            title: this.firstNonEmptyString(planRec?.title),
            summary: this.firstNonEmptyString(planRec?.summary),
          }
        : undefined;

    if (!responseType && !message && reasoning.length === 0 && progressUpdates.length === 0 && !plan?.content) {
      return undefined;
    }

    return {
      responseType,
      message,
      reasoning: reasoning.length > 0 ? reasoning : undefined,
      progressUpdates: progressUpdates.length > 0 ? progressUpdates : undefined,
      plan: plan?.content ? plan : undefined,
    };
  }

  private extractMessageBodyText(message: any): string {
    if (!message) return "";
    if (typeof message.content === "string" && message.content.trim()) {
      return message.content.trim();
    }
    if (typeof message.text === "string" && message.text.trim()) {
      return message.text.trim();
    }
    if (Array.isArray(message.parts)) {
      return message.parts
        .map((part: any) => {
          if (!part || typeof part !== "object") return "";
          if (
            part.type === "reasoning" ||
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
    return "";
  }

  private extractStructuredOutput(messageLike: any): StructuredAssistantOutput | undefined {
    if (!messageLike) return undefined;
    const candidates: unknown[] = [
      messageLike.structuredOutput,
      messageLike.structured_output,
      messageLike.output,
      messageLike.info?.structuredOutput,
      messageLike.info?.structured_output,
      messageLike.info?.output,
      messageLike.properties?.structuredOutput,
      messageLike.properties?.structured_output,
      messageLike.properties?.output,
    ];
    for (const candidate of candidates) {
      const parsed = this.normalizeStructuredOutput(candidate);
      if (parsed) {
        return parsed;
      }
    }

    const bodyText = this.extractMessageBodyText(messageLike);
    if (bodyText.startsWith("{") && bodyText.endsWith("}")) {
      return this.normalizeStructuredOutput(bodyText);
    }
    return undefined;
  }

  private applyStructuredOutputToMessage(message: any): any {
    const structured = this.extractStructuredOutput(message);
    if (!structured) {
      return message;
    }

    const next = {
      ...message,
      structuredOutput: structured,
    };

    if (structured.message) {
      next.content = structured.message;
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
          text: structured.message,
        };
      } else {
        parts.push({ type: "text", text: structured.message });
      }
      next.parts = parts;
    }

    if (structured.reasoning && structured.reasoning.length > 0) {
      const parts = Array.isArray(next.parts) ? [...next.parts] : [];
      const hasReasoningPart = parts.some((part: any) => part?.type === "reasoning");
      if (!hasReasoningPart) {
        structured.reasoning.forEach((chunk) => {
          parts.push({ type: "reasoning", reasoning: chunk });
        });
        next.parts = parts;
      }
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
      structured.responseType === "implementation_plan" ||
      structured.plan?.content
    ) {
      const planContent =
        structured.plan?.content || structured.message || next.content || "";
      if (typeof planContent === "string" && planContent.trim().length >= 200) {
        next.plan = {
          file: structured.plan?.file || "implementation_plan.md",
          content: planContent,
        };
      }
    }

    return next;
  }

  private enrichStreamEvent(event: any): any {
    if (!event || typeof event !== "object") {
      return event;
    }

    const properties = this.asRecord(event.properties) || {};
    const part = this.asRecord(properties.part);
    const next: Record<string, unknown> = { ...event };
    let kind: "thinking" | "progress" | "message" | "lifecycle" | "error" | "other" = "other";
    let text: string | undefined;

    if (event.type === "message.part.updated" && part) {
      const partType = this.firstNonEmptyString(part.type)?.toLowerCase() || "";
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
          part.text,
        );
      } else if (
        partType === "tool" ||
        partType === "step-start" ||
        partType === "step-finish" ||
        partType === "patch"
      ) {
        kind = "progress";
      } else if (partType === "text" || !partType) {
        kind = "message";
        text = this.firstNonEmptyString(properties.delta, part.text, part.content);
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
  private async handleSendMessage(
    text: string,
    files?: string[],
    contexts?: any[],
    images?: any[],
    agent?: string,
  ): Promise<void> {
    this.isProcessingRequest = true;
    try {
      const normalizedImages = (images || [])
        .map((img) => {
          if (typeof img === "string") {
            return { dataUrl: img, filename: "image" };
          }
          if (img?.dataUrl && typeof img.dataUrl === "string") {
            return {
              dataUrl: img.dataUrl,
              filename: typeof img.filename === "string" ? img.filename : "image",
            };
          }
          return null;
        })
        .filter((img): img is { dataUrl: string; filename: string } => !!img);
      const imageUrls = normalizedImages.map((img) => img.dataUrl);

      const client = await this.serverManager.ensureRunning();
      const session = await this.sessionService.getCurrentSession();
      this.subagentTracker.setActiveSession(session.id);

      const existingMessages = await this.sessionService.getMessages(
        session.id,
      );
      const isNewSession = existingMessages.length === 0;

      // Save user message to local history immediately
      await this.sessionService.appendMessage(session.id, {
        role: "user",
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
      });
      await this.handleGetSessions();

      console.log(
        `[ChatViewProvider] Session ${session.id}: ${existingMessages.length} existing messages. isNew: ${isNewSession}`,
      );

      // Prepare message parts
      const parts: NonNullable<SessionPromptData["body"]>["parts"] = [
        {
          type: "text",
          text: (isNewSession ? this.getSystemInstruction() : "") + text,
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
          const imageMarkdown = `![${img.filename || "image"}](${img.dataUrl})`;
          parts.push({
            type: "text",
            text: imageMarkdown,
          });
        }
      }

      // Send the message using the SDK
      const startTime = Date.now();
      const response = await this.promptWithStructuredOutput(client, session.id, {
        model: this.selectedModel,
        agent: agent || this.selectedAgent,
        parts: parts,
      });
      const duration = (Date.now() - startTime) / 1000;

      console.log(`[ChatViewProvider] Response received in ${duration}s`, {
        hasData: Boolean(response.data),
        hasError: Boolean(response.error),
        status: response.response?.status,
        messageId: (response.data as any)?.info?.id,
      });

      if (response.error) {
        log.error("API error returned", {
          sessionId: session.id,
          error: response.error,
          status: response.response?.status,
        });

        // Safely extract error message
        let errorMessage = "Failed to send message";
        const err = response.error as any;

        if (Array.isArray(err.errors) && err.errors.length > 0) {
          errorMessage = err.errors[0].message || JSON.stringify(err.errors[0]);
        } else if (err.data && err.data.message) {
          errorMessage = err.data.message;
        } else if (err.message) {
          errorMessage = err.message;
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

            // Retry sending (recursive call)
            return this.handleSendMessage(text, files, contexts, images, agent);
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
        const structuredMessage = this.applyStructuredOutputToMessage(response.data);
        const enrichedMessage = this.enrichMessageWithPlan(structuredMessage);
        const assistantMessageId = this.extractMessageId(enrichedMessage);
        if (assistantMessageId) {
          const hydratedSubagents = await this.subagentTracker.finalizeParentMessage({
            client,
            parentSessionId: session.id,
            parentMessageId: assistantMessageId,
          });
          if (hydratedSubagents.length > 0) {
            enrichedMessage.subagents = hydratedSubagents;
            this.view?.webview.postMessage({
              type: "subagentUpdate",
              ...this.subagentTracker.getPayloadForParentMessage(assistantMessageId),
            });
          }
        }

        // Save assistant message to local history
        await this.sessionService.appendMessage(session.id, {
          ...enrichedMessage,
          timing: {
            duration: duration,
          },
        });

        this.view?.webview.postMessage({
          type: "messageResponse",
          message: {
            ...enrichedMessage,
            timing: {
              duration: duration,
            },
          },
        });
      } else {
        console.warn("No response data received from OpenCode");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to send message: ${errorMessage}`);
      console.error("Send message error:", error);

      // Show error in webview too
      this.view?.webview.postMessage({
        type: "error",
        message: errorMessage,
      });
    } finally {
      this.isProcessingRequest = false;
      if (!this.isExecutingQueue && this.queue.length > 0) {
        void this.handleExecuteQueue();
      }
    }
  }

  /**
   * Enriches a message with plan information if detected.
   * FORBIDDEN TO REMOVE: This logic ensures the Implementation Plan button appears,
   * which is a core feature for user transparency and workflow.
   */
  private enrichMessageWithPlan(message: any): any {
    if (!message) return message;

    const structured = this.extractStructuredOutput(message);
    if (structured) {
      const structuredPlanContent =
        structured.plan?.content ||
        (structured.responseType === "implementation_plan"
          ? structured.message
          : undefined);
      if (
        structuredPlanContent &&
        typeof structuredPlanContent === "string" &&
        structuredPlanContent.length >= 200
      ) {
        this.persistPlan(structuredPlanContent).catch((err) => {
          console.error(
            "[ChatViewProvider] Failed to auto-persist structured plan:",
            err,
          );
        });
        return {
          ...message,
          structuredOutput: structured,
          plan: {
            file: structured.plan?.file || "implementation_plan.md",
            content: structuredPlanContent,
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
      edits.some(
        (e: any) => e.file && e.file.endsWith("implementation_plan.md"),
      ) ||
      parts.some(
        (p: any) =>
          p.type === "patch" &&
          p.files &&
          p.files.some((f: string) => f.endsWith("implementation_plan.md")),
      );

    // 2. Fallback: Check for plan-like content in message summary, parts, or plain content
    const partsContent = parts
      .map((p: any) => {
        let c = p.text || p.content || p.reasoning || "";
        // Check for file part text/language if available
        if (p.type === "text" && p.text) c += " " + p.text;
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
    const hasStructuralMarkers = /##\s|###\s|\- \[ \]|Files:|Steps:|Goal:/i.test(fullContent) ||
      // Long content is likely a real plan even if markers are missing
      fullContent.length > 500;

    const hasPlanKeywords = basicPlanKeywordMatch && hasStructuralMarkers;

    if (hasPlanFile || hasPlanKeywords) {
      // Extract the content that looks like a plan to pass it directly
      // in case the file isn't written yet.
      const planContent = message.content || partsContent;
      // Minimum-length guard: avoid false positives on short "I'll help" replies
      if (!planContent || planContent.length < 200) {
        return message;
      }

      // PERSISTENCE FIX: Automatically save the detected plan to disk
      // This ensures handleViewPlan can read it even if the SDK didn't write it.
      if (planContent.length > 100) {
        this.persistPlan(planContent).catch((err) => {
          console.error("[ChatViewProvider] Failed to auto-persist plan:", err);
        });
      }

      return {
        ...message,
        plan: {
          file: "implementation_plan.md",
          content: planContent,
        },
      };
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

  /**
   * Handles stopping a request
   */
  // FORBIDDEN TO REMOVE: Stop Request Button - backend handler required by webview to abort streaming requests
  private async handleStopRequest(sessionId: string): Promise<void> {
    try {
      const client = this.serverManager.getClient();
      if (!client) {
        return;
      }

      console.log(
        `[ChatViewProvider] Stopping request for session ${sessionId}`,
      );

      await client.session.abort({
        path: { id: sessionId },
      });
    } catch (error) {
      console.error("Failed to stop request:", error);
    }
  }

  /**
   * Appends text to the prompt input
   */
  async appendToPrompt(text: string): Promise<void> {
    this.view?.webview.postMessage({
      type: "appendPrompt",
      text,
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

  async handlePlanProceed(payload: {
    rawPlan: string;
    comments: PlanProceedComment[];
  }): Promise<void> {
    const rawPlan = typeof payload?.rawPlan === "string" ? payload.rawPlan : "";
    const comments = Array.isArray(payload?.comments) ? payload.comments : [];

    const commentLines = comments.map((comment) => {
      const lineNumber = (comment.anchor?.startLine ?? 0) + 1;
      return `- Line ${lineNumber}: ${comment.text}`;
    });

    const updatedPlanMd =
      commentLines.length > 0
        ? `${rawPlan}\n\n## Comments\n\n${commentLines.join("\n")}`
        : rawPlan;

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const planFilePath = workspaceFolder
      ? path.join(workspaceFolder.uri.fsPath, "implementation_plan.md")
      : path.join(os.tmpdir(), `opencode-plan-${Date.now()}.md`);

    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(planFilePath),
      new TextEncoder().encode(updatedPlanMd),
    );

    await this.handleSendMessage("Proceed", [planFilePath]);

    // Post addPlanAttachment message to chat webview for the visual chip
    const planGoal = rawPlan.match(/^#\s+(.+)/m)?.[1]?.trim() ?? 'Implementation Plan';
    const planBase64 = Buffer.from(updatedPlanMd, 'utf-8').toString('base64');
    const dataUrl = `data:text/markdown;base64,${planBase64}`;
    this.view?.webview.postMessage({
      type: 'addPlanAttachment',
      payload: {
        id: `plan-${Date.now()}`,
        filename: `\uD83D\uDCCB Implementation Plan: ${planGoal}`,
        mimeType: 'text/markdown',
        dataUrl,
      }
    });
    PlanViewProvider.closeCurrentPanel();
  }

  /**
   * Handles viewing the implementation plan
   */
  private async handleViewPlan(plan: { file?: string; content?: string }): Promise<void> {
    let planData: string | undefined;

    // First, try to use the plan content directly if available
    if (plan.content && typeof plan.content === "string") {
      planData = plan.content;
      console.log("[ChatViewProvider] Using plan content from message");
    }
    // Otherwise, if it looks like a filename, try to read the actual file
    else if (plan.file && plan.file.endsWith(".md") && !plan.file.includes("\n")) {
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

    // If we have plan data, show it
    if (planData) {
      await vscode.commands.executeCommand("opencode.showPlan", planData);
    } else {
      vscode.window.showErrorMessage("Could not read plan file: No plan content available");
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
          filename: uri.fsPath.split(/[\\/]/).pop() || uri.fsPath,
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
    models: Array<{ providerID: string; modelID: string; name: string; providerName?: string }>,
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
        await this.context.globalState.update("selectedModel", this.selectedModel);
      }
      return;
    }

    const isLegacyGenericProvider =
      !this.selectedModel.providerID || this.selectedModel.providerID === "opencode";
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
      await this.context.globalState.update("selectedModel", this.selectedModel);
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
    models: Array<{ providerID: string; modelID: string; name: string; providerName?: string }>,
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
        const providerModelMatch = defaultId.match(/^([^\/:\s]+)[\/:](.+)$/);
        let match:
          | { providerID: string; modelID: string; name: string; providerName?: string }
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
                (m.providerName || "").toLowerCase() === providerRef.toLowerCase() &&
                (m.modelID === modelRef || m.name === modelRef),
            );
          }
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
  private async handleGetModels(): Promise<
    Array<{
      providerID: string;
      modelID: string;
      name: string;
      providerName: string;
    }>
  > {
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
        const models: Array<{
          providerID: string;
          modelID: string;
          name: string;
          providerName: string;
        }> = [];

        for (const provider of response.data.all) {
          if (provider.models) {
            for (const [modelID, modelConfig] of Object.entries(
              provider.models,
            )) {
              models.push({
                providerID: provider.id,
                modelID: modelID,
                name: (modelConfig as any).name || modelID,
                providerName: provider.name || provider.id,
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
   * Handles fetching available agents
   */
  private async handleGetAgents(): Promise<void> {
    const agents = await this.getCLIAgents();

    this.view?.webview.postMessage({
      type: "agentsList",
      agents,
      selectedAgent: this.selectedAgent,
    });
  }

  /**
   * Syncs agents and default agent from CLI
   */
  private async syncCLIAgents(): Promise<void> {
    try {
      // Get default agent first
      const defaultAgent = await this.getCLIDefaultAgent();
      if (defaultAgent) {
        this.selectedAgent = defaultAgent;
        console.log(
          `[ChatViewProvider] Default agent set from CLI: ${this.selectedAgent}`,
        );
      }
    } catch (error) {
      console.error("[ChatViewProvider] Failed to sync CLI agents:", error);
    }
  }

  /**
   * Fetches the default agent from CLI config
   */
  private async getCLIDefaultAgent(): Promise<string> {
    return new Promise((resolve) => {
      cp.exec("opencode debug config", (error, stdout) => {
        if (error) {
          console.error(
            "[ChatViewProvider] Error fetching default agent:",
            error,
          );
          resolve("sisyphus"); // Default fallback
          return;
        }
        try {
          const config = JSON.parse(stdout);
          resolve(config.default_agent || "sisyphus");
        } catch (e) {
          console.error("[ChatViewProvider] Error parsing CLI config:", e);
          resolve("sisyphus");
        }
      });
    });
  }

  /**
   * Fetches the list of available agents from CLI
   */
  private async getCLIAgents(): Promise<
    Array<{ id: string; name: string; description: string }>
  > {
    return new Promise((resolve) => {
      cp.exec("opencode agent list", (error, stdout) => {
        if (error) {
          console.error("[ChatViewProvider] Error fetching agents:", error);
          resolve([
            {
              id: "sisyphus",
              name: "Sisyphus",
              description: "Default OpenCode Agent",
            },
          ]);
          return;
        }

        const lines = stdout.split("\n");
        const agents: Array<{ id: string; name: string; description: string }> =
          [];

        // Always include sisyphus if it's the default but not in list
        const discoveredIds = new Set<string>();

        for (const line of lines) {
          const trimmed = line.trim();
          // Filter for lines that look like agent names (no leading space, not JSON)
          if (
            trimmed &&
            !line.startsWith(" ") &&
            !trimmed.startsWith("[") &&
            !trimmed.startsWith("]") &&
            !trimmed.startsWith("{") &&
            !trimmed.startsWith("}") &&
            !trimmed.includes(":")
          ) {
            const id = trimmed.split(" ")[0];
            if (!discoveredIds.has(id)) {
              agents.push({
                id,
                name: trimmed,
                description: `OpenCode CLI Agent: ${trimmed}`,
              });
              discoveredIds.add(id);
            }
          }
        }

        // Add sisyphus if not present as it's often the default
        if (!discoveredIds.has("sisyphus")) {
          agents.unshift({
            id: "sisyphus",
            name: "Sisyphus (default)",
            description: "Default OpenCode Agent",
          });
        }

        resolve(agents);
      });
    });
  }

  private async handleReviewChanges() {
    try {
      // In VS Code, the standard way to review changes is the Source Control view
      await vscode.commands.executeCommand("workbench.view.scm");
    } catch (error: any) {
      vscode.window.showErrorMessage(
        `Failed to open changes: ${error.message}`,
      );
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

      // In a real scenario, we'd compare against a backup or git state.
      // For now, if we don't have the original, we just open the file.
      // Ideally, we'd have the 'original' URI stored in a session temp folder.

      // Let's try to find if there's a backup (this is speculative but good for the logic)
      // For this implementation, we will use the file itself as both sides OR
      // check if it's a git repo and use the HEAD version.

      try {
        // Try to get HEAD content via git if available
        const gitExtension =
          vscode.extensions.getExtension("vscode.git")?.exports;
        if (gitExtension) {
          const api = gitExtension.getAPI(1);
          const repository = api.repositories[0];
          if (repository) {
            // This is the correct way to show a diff in VS Code for git-tracked files
            await vscode.commands.executeCommand("git.openChange", fileUri);
            return;
          }
        }
      } catch (e) {
        // Fallback to simple open if git fails
      }

      // Default fallback: Just open the file if we can't do a proper diff
      await vscode.commands.executeCommand("vscode.open", fileUri);
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to open diff: ${error.message}`);
    }
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

  /**
   * Adds a message to the prompt queue
   */
  private handleAddToQueue(
    text: string,
    files?: string[],
    contexts?: any[],
    images?: any[],
    agent?: string,
  ) {
    this.queue.push({ text, files, contexts, images, agent });
    this.sendQueueUpdate();
  }

  /**
   * Removes a message from the prompt queue
   */
  private handleRemoveFromQueue(index: number) {
    if (index >= 0 && index < this.queue.length) {
      this.queue.splice(index, 1);
      this.sendQueueUpdate();
    }
  }

  /**
   * Clears the prompt queue
   */
  private handleClearQueue() {
    this.queue = [];
    this.sendQueueUpdate();
  }

  /**
   * Executes the prompt queue sequentially
   */
  private async handleExecuteQueue() {
    if (this.isExecutingQueue || this.queue.length === 0) {
      return;
    }

    this.isExecutingQueue = true;
    this.view?.webview.postMessage({ type: "queueExecutionStarted" });

    try {
      while (this.queue.length > 0) {
        const item = this.queue[0];
        // We await handleSendMessage to ensure sequential processing
        // Note: For streaming, we might need more complex sync, but this is a solid start.
        await this.handleSendMessage(
          item.text,
          item.files,
          item.contexts,
          item.images,
          item.agent,
        );

        // Remove the processed item
        this.queue.shift();
        this.sendQueueUpdate();

        // Small delay to allow UI/Server to settle
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error("[ChatViewProvider] Queue execution failed:", error);
      vscode.window.showErrorMessage(`Queue execution error: ${error}`);
    } finally {
      this.isExecutingQueue = false;
      this.view?.webview.postMessage({ type: "queueExecutionFinished" });
    }
  }

  /**
   * Sends the current queue state to the webview
   */
  private sendQueueUpdate() {
    this.view?.webview.postMessage({
      type: "queueUpdate",
      queue: this.queue,
    });
  }
}
