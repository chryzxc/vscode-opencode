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
import type { OutputFormatJsonSchema } from "@opencode-ai/sdk/v2";
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
import {
  adaptSdkMessages,
  adaptSubtaskPart as sdkAdaptSubtaskPart,
} from "../services/SdkMessageAdapter";
import { SessionService } from "../services/SessionService";
import { SessionSnapshotLoader } from "../services/SessionSnapshotLoader";
import { SkillManagerService } from "../services/SkillManagerService";
import { SkillManagementService } from "../services/SkillManagementService";
import {
  getSdkResponseData,
  getSdkResponseError,
  normalizeSdkAssistantMessage,
} from "../services/opencodeSdkCompat";
import {
  type CompatibilityResult,
  checkOpencodeSdkVersion,
  checkOpencodeServerVersion,
  detectInstalledOpencodeSdkVersion,
} from "../services/opencodeVersionCompatibility";
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

function decodeTextDataUrl(dataUrl: string, mimeType: string): string | undefined {
  if (!mimeType.toLowerCase().startsWith("text/")) {
    return undefined;
  }

  const separator = dataUrl.indexOf(",");
  if (separator < 0) {
    return undefined;
  }

  const metadata = dataUrl.slice(0, separator).toLowerCase();
  const payload = dataUrl.slice(separator + 1);
  try {
    return metadata.includes(";base64")
      ? Buffer.from(payload, "base64").toString("utf8")
      : decodeURIComponent(payload);
  } catch {
    return undefined;
  }
}

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
  private static readonly STREAM_WEBVIEW_FLUSH_INTERVAL_MS = 50;
  private static readonly MAX_STREAM_WEBVIEW_EVENTS_PER_BATCH = 8;
  private static readonly STREAM_WEBVIEW_BACKLOG_YIELD_MS = 16;
  private static readonly MAX_STREAM_WEBVIEW_TOOL_OUTPUT_CHARS = 16_384;

  private static readonly SUBAGENT_SNAPSHOT_PREFIX =
    "opencode.session.subagents.";
  private static readonly COMPACTION_VIEW_STATE_PREFIX =
    "opencode.session.compaction-view.";
  private isDisposed = false;
  /** The webview instance (undefined before initialization) */
  private view?: vscode.WebviewView;

  /** Service for streaming events from the server */
  private streamService: MessageStreamService;

  /** Unsubscribe function for stream service cleanup */
  private unsubscribe?: () => void;
  /** Disposable for the webview message listener. */
  private webviewMessageListener?: vscode.Disposable;
  private readonly handleQuotaUpdate = (data: unknown) => {
    this.view?.webview.postMessage({ type: "quotaData", data });
  };
  private activeViewCleanup?: () => void;

  /** Service for monitoring AI platform quota usage */
  private quotaService: QuotaService;
  private sessionSnapshotLoader: SessionSnapshotLoader;
  private subagentTracker: SubagentTracker;
  private readonly streamedSubtaskPartsBySessionId = new Map<string, {
    sessionID: string;
    messageID?: string;
    agent?: string;
    parentSessionId?: string;
    part: Record<string, unknown>;
  }>();
  private readonly pendingSdkSubagentRefreshes = new Set<string>();
  /** Sessions whose persisted live subagents were finalized for this host instance. */
  private recoveredSubagentSessions = new Set<string>();

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
  private turnEpochBySession = new Map<string, number>();
  private pendingStreamWebviewEvents: Array<{ event: unknown; sessionId?: string }> = [];
  private streamWebviewFlushTimer: ReturnType<typeof setTimeout> | undefined;
  private lastStreamPerformanceLogAt = 0;
  /**
   * Debug-only mirror of every event that reaches this provider. This is sent
   * to the webview but deliberately never enters SessionService persistence.
   */
  private pendingLiveEventDebugEvents: Array<{ event: unknown; sessionId?: string }> = [];
  private liveEventDebugFlushTimer: ReturnType<typeof setTimeout> | undefined;
  private currentTodoItems: unknown[] = [];
  private compatibilityWarningsOverride: CompatibilityResult[] | null = null;

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

  private enqueueStreamWebviewEvent(
    event: unknown,
    sessionId: string | undefined,
    flushImmediately = false,
  ): void {
    this.pendingStreamWebviewEvents.push({ event, sessionId });

    if (flushImmediately) {
      // Lifecycle events should start delivery immediately, but must not
      // bypass the per-message cap. A terminal event can arrive behind a large
      // tool/subagent burst; posting that entire backlog in one IPC message
      // blocks the webview and makes scrolling freeze.
      this.flushStreamWebviewEvents();
      return;
    }

    if (this.streamWebviewFlushTimer) {
      return;
    }

    this.streamWebviewFlushTimer = setTimeout(() => {
      this.flushStreamWebviewEvents();
    }, ChatViewProvider.STREAM_WEBVIEW_FLUSH_INTERVAL_MS);
  }

  private truncateStreamToolTextForWebview(value: unknown): unknown {
    if (typeof value !== "string") {
      return value;
    }
    const limit = ChatViewProvider.MAX_STREAM_WEBVIEW_TOOL_OUTPUT_CHARS;
    if (value.length <= limit) {
      return value;
    }
    return `${value.slice(0, limit)}\n\n[Output truncated in the live chat view: ${value.length - limit} characters omitted]`;
  }

  // Depth cap for cloneAndTruncateStreamPayload. SDK events are flat-ish
  // (type/properties/part/info/structured/message — typically 3-4 levels),
  // but we leave headroom for nested tool inputs. Removing this cap risks
  // unbounded recursion on adversarial payloads.
  private static readonly STREAM_PAYLOAD_MAX_CLONE_DEPTH = 16;

  /**
   * Build a webview-bound stream event with oversized string fields bounded
   * to MAX_STREAM_WEBVIEW_TOOL_OUTPUT_CHARS. The persisted SDK event (the
   * original reference passed to handleStreamEvent) is never mutated — only
   * the webview-bound copy is slimmed.
   *
   * Perf rationale: VS Code's postMessage uses structured-clone serialization
   * across the webview IPC boundary. On large SDK events (full accumulated
   * message content, large tool outputs, full file reads) serialization
   * blocks the extension host main thread for 30-60ms — empirically
   * measured as the dominant source of streaming freezes via the
   * `[STREAM-PERF] provider-webview-flush` metric.
   *
   * Contract rationale: webview still receives full content via `chatHistory`
   * after the stream completes, and MarkdownRenderer already bounds its own
   * rendering at 150KB, so per-field truncation at 16KB during streaming is
   * a safe conservative cap that preserves all product behaviour.
   *
   * Removing this method, or bypassing it on the postMessage path, will
   * reintroduce the streaming freezes documented in
   * tests/webview/stream-event-main-thread-performance.test.mjs.
   */
  private buildWebviewStreamEvent(enrichedEvent: unknown): unknown {
    if (!enrichedEvent || typeof enrichedEvent !== "object") {
      return enrichedEvent;
    }
    // Per the webview transport contract: centralizedEventPayload is built by
    // spreading enrichedEvent first, then layering on the truncated deep
    // clone. Last-write-wins means truncated values overwrite the originals
    // for any oversized field.
    const truncatedDeepClone = this.cloneAndTruncateStreamPayload(enrichedEvent);
    const centralizedEventPayload = {
      ...enrichedEvent,
      ...(truncatedDeepClone as Record<string, unknown>),
    };
    return centralizedEventPayload;
  }

  private cloneAndTruncateStreamPayload(node: unknown, depth = 0): unknown {
    if (depth > ChatViewProvider.STREAM_PAYLOAD_MAX_CLONE_DEPTH) {
      return node;
    }
    if (typeof node === "string") {
      return this.truncateStreamToolTextForWebview(node);
    }
    if (Array.isArray(node)) {
      return node.map((entry) => this.cloneAndTruncateStreamPayload(entry, depth + 1));
    }
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      const rec = node as Record<string, unknown>;
      for (const key of Object.keys(rec)) {
        out[key] = this.cloneAndTruncateStreamPayload(rec[key], depth + 1);
      }
      return out;
    }
    return node;
  }

  private flushStreamWebviewEvents(): void {
    const startedAt = performance.now();
    if (this.streamWebviewFlushTimer) {
      clearTimeout(this.streamWebviewFlushTimer);
      this.streamWebviewFlushTimer = undefined;
    }

    const pending = this.pendingStreamWebviewEvents.splice(
      0,
      ChatViewProvider.MAX_STREAM_WEBVIEW_EVENTS_PER_BATCH,
    );
    if (pending.length === 0) {
      return;
    }
    const hasBacklog = this.pendingStreamWebviewEvents.length > 0;

    if (pending.length === 1) {
      const item = pending[0];
      this.view?.webview.postMessage({
        type: "streamEvent",
        event: item.event,
        sessionId: item.sessionId,
      });
      this.logStreamPerformance("provider-webview-flush", startedAt, 1);
      this.scheduleStreamWebviewBacklogFlush(hasBacklog);
      return;
    }

    this.view?.webview.postMessage({
      type: "streamEventBatch",
      events: pending.map((item) => ({
        event: item.event,
        sessionId: item.sessionId,
      })),
    });
    this.logStreamPerformance("provider-webview-flush", startedAt, pending.length);
    this.scheduleStreamWebviewBacklogFlush(hasBacklog);
  }

  private scheduleStreamWebviewBacklogFlush(hasBacklog: boolean): void {
    if (!hasBacklog || this.streamWebviewFlushTimer) {
      return;
    }
    this.streamWebviewFlushTimer = setTimeout(() => {
      this.flushStreamWebviewEvents();
    }, ChatViewProvider.STREAM_WEBVIEW_BACKLOG_YIELD_MS);
  }

  private logStreamPerformance(
    metric: string,
    startedAt: number,
    batchSize: number,
  ): void {
    const now = Date.now();
    if (now - this.lastStreamPerformanceLogAt < 250) {
      return;
    }
    this.lastStreamPerformanceLogAt = now;
    this.logger.info(`[STREAM-PERF] ${metric}`, {
      batchSize,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
    });
  }

  private enqueueLiveEventDebugEvent(
    event: unknown,
    sessionId: string | undefined,
  ): void {
    this.pendingLiveEventDebugEvents.push({ event, sessionId });
    if (this.liveEventDebugFlushTimer) {
      return;
    }
    this.liveEventDebugFlushTimer = setTimeout(() => {
      this.flushLiveEventDebugEvents();
    }, 32);
  }

  private flushLiveEventDebugEvents(): void {
    if (this.liveEventDebugFlushTimer) {
      clearTimeout(this.liveEventDebugFlushTimer);
      this.liveEventDebugFlushTimer = undefined;
    }
    const events = this.pendingLiveEventDebugEvents;
    if (events.length === 0) {
      return;
    }
    this.pendingLiveEventDebugEvents = [];
    this.view?.webview.postMessage({
      type: "liveEventStreamDebugBatch",
      events,
    });
  }

  /**
   * Create a stable optimistic message identifier for the local conversation
   * cache.
   *
   * The centralized chat renderer only keeps locally appended messages when
   * they have an identifier. Rehydrated sessions can therefore "lose" the
   * just-sent user bubble unless the optimistic message is tagged with a
   * message ID immediately. We use a namespaced id so the webview and persisted
   * history can treat the message as a first-class turn until the server tape
   * catches up.
   */
  private createOptimisticMessageId(
    sessionId: string,
    role: "user" | "assistant" | "system" = "user",
  ): string {
    return `${role}-${sessionId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
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
        sessionID: sessionId,
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

  private async refreshPendingInteractionsFromSdk(sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }

    const extractList = (response: unknown, fallbackKey: "questions" | "permissions"): unknown[] => {
      if (Array.isArray(response)) {
        return response;
      }
      const responseRecord = this.asRecord(response);
      if (!responseRecord) {
        return [];
      }
      if (Array.isArray(responseRecord.data)) {
        return responseRecord.data;
      }
      if (Array.isArray(responseRecord[fallbackKey])) {
        return responseRecord[fallbackKey] as unknown[];
      }
      return [];
    };

    const belongsToSession = (entry: unknown): boolean => {
      const record = this.asRecord(entry);
      return this.firstNonEmptyString(record?.sessionID, record?.sessionId) === sessionId;
    };

    try {
      const client = await this.serverManager.ensureRunning();
      let questions: unknown[] = [];
      let permissions: unknown[] = [];

      try {
        const questionResponse = await (client as any).question.list();
        questions = extractList(questionResponse, "questions").filter(belongsToSession);
      } catch (questionError) {
        this.logger.warn("Failed to list pending SDK questions", {
          sessionId,
          error: questionError instanceof Error ? questionError.message : String(questionError),
        });
      }

      try {
        const permissionResponse = await (client as any).permission.list();
        permissions = extractList(permissionResponse, "permissions").filter(belongsToSession);
      } catch (permissionError) {
        this.logger.warn("Failed to list pending SDK permissions", {
          sessionId,
          error: permissionError instanceof Error ? permissionError.message : String(permissionError),
        });
      }

      this.view?.webview.postMessage({
        type: "pendingInteractions",
        sessionId,
        questions,
        permissions,
      });

      this.logger.debug("Refreshed pending interactions from SDK", {
        sessionId,
        questionCount: questions.length,
        permissionCount: permissions.length,
      });
    } catch (error) {
      this.logger.warn("Failed to refresh pending interactions from SDK", {
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
        const resp = await client.session.get({ sessionID: sessionId });
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
  private recentPromptDispatch?:
    | {
      signature: string;
      at: number;
    }
    | undefined;
  private readonly seenClientRequestIds = new Map<string, number>();
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
  /** OpenCode v2 accepts structured output only through the typed `format` field. */
  private structuredOutputMode: "format" | "disabled" = "format";
  /**
   * A successful prompt is insufficient: OpenCode persists `format` on the
   * user message and validates it again in `session.messages()`. Cache the
   * round-trip check so each server lifecycle pays for one no-reply probe.
   */
  private structuredOutputFormatCompatibility?: Promise<boolean>;
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
  private readonly sessionDiffFromStream = new Map<string, Array<{ file: string; added: number; deleted: number; patch?: string }>>();
  private readonly recentUiErrorToastTimestamps = new Map<string, number>();
  private readonly UI_ERROR_TOAST_DEDUPE_WINDOW_MS = 15_000;
  private lastCompatibilityWarningSignature: string | undefined;
  private readonly installedSdkVersion = detectInstalledOpencodeSdkVersion();

  /** ===== NEW: Module instances ===== */
  private diagnosticsLogger!: DiagnosticsLogger;
  private structuredOutputProcessor!: StructuredOutputProcessor;
  private planManager!: PlanManager;
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
    this.logger = createLogger(LoggingCategories.CHAT_VIEW);
    this.streamService = new MessageStreamService(serverManager);
    this.quotaService = new QuotaService();
    this.sessionSnapshotLoader = new SessionSnapshotLoader(serverManager);
    this.subagentTracker = new SubagentTracker(() => this.selectedModel);
    this.configFilesProvider = new ConfigFilesProvider();
    this.skillManager = new SkillManagerService(context);
    this.skillManager.initialize().catch((error) => {
      this.logger.error('Failed to initialize skill manager', error);
    });
    // Use injected service or create local instance as fallback
    this.modelCapabilitiesService = modelCapabilitiesService ?? new ModelCapabilitiesService();
    this.geminiTokenTracker = GeminiTokenUsageTracker.getInstance();
    this.quotaService.on("quotaUpdate", this.handleQuotaUpdate);

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
      this.logger.info("[OPENCOD GO MODEL] Persisted model restored on startup", {
        providerID: savedModel.providerID,
        modelID: savedModel.modelID,
        providerName: savedModel.providerName,
      });
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

    // 4. CompactionManager
    this.compactionManager = new CompactionManager(
      this.context.workspaceState,
      this.serverManager,
      logger,
      asRecord,
      firstNonEmptyString,
      this.processHistoryMessages.bind(this),
    );

    // 5. HistoryProcessor
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

    // 6. ModelAndAgentManager
    this.modelAndAgentManager = new ModelAndAgentManager(
      this.context.globalState,
      this.serverManager,
      this.modelCapabilitiesService,
      logger,
      asRecord,
      firstNonEmptyString,
    );

    // 7. QueueManager
    this.queueManager = new QueueManager(logger);

    // 8. SessionHandler
    this.sessionHandler = new SessionHandler(
      this.sessionService,
      this.compactionManager,
      this.modelAndAgentManager,
      logger,
      this.sessionSnapshotLoader,
    );

    // 9. StreamEventHandler
    this.streamEventHandler = new StreamEventHandler(
      this.structuredOutputProcessor,
      this.compactionManager,
      this.diagnosticsLogger,
      this.geminiTokenTracker,
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
      clientRequestId?: string;
      text?: string;
      files?: string[];
      contexts?: any[];
      images?: any[];
      agent?: string;
      userFacingText?: string;
      interactiveSubmit?: boolean;
      avoidAbortIfProcessing?: boolean;
      forceSendNow?: boolean;
    },
  ): Promise<void> {
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) {
      this.logger.debug('[MessageFlow] Empty message, skipping dispatch');
      return;
    }

    const sessionId = await this.resolveQueueSessionId(payload.sessionId);
    if (!sessionId) {
      this.logger.warn('[MessageFlow] No valid session ID for message dispatch', {
        providedSessionId: payload.sessionId,
        currentSessionId: this.currentSessionId
      });
      return;
    }

    const clientRequestId =
      typeof payload.clientRequestId === "string"
        ? payload.clientRequestId.trim()
        : "";
    if (clientRequestId && this.hasSeenClientRequest(sessionId, clientRequestId)) {
      this.logger.warn("[MessageFlow] Ignoring duplicate client request dispatch", {
        mode,
        sessionId,
        clientRequestId,
        textPreview: text.slice(0, 160),
      });
      return;
    }

    this.logger.debug('[MessageFlow] Prompt dispatch initiated', {
      mode,
      sessionId,
      clientRequestId: clientRequestId || undefined,
      textLength: text.length,
      hasFiles: (payload.files?.length ?? 0) > 0,
      hasContexts: (payload.contexts?.length ?? 0) > 0,
      hasImages: (payload.images?.length ?? 0) > 0
    });

    if (mode === "send-now") {
      const dedupeWindowMs = 1500;
      const dedupeSignature = JSON.stringify({
        sessionId,
        text,
        files: Array.isArray(payload.files) ? [...payload.files].sort() : [],
        contexts: Array.isArray(payload.contexts)
          ? payload.contexts.map((ctx) =>
            JSON.stringify({
              file: ctx?.file ?? null,
              lineInfo: ctx?.lineInfo ?? null,
              languageId: ctx?.languageId ?? null,
              content: ctx?.content ?? null,
            }),
          )
          : [],
        images: Array.isArray(payload.images)
          ? payload.images.map((image) =>
            typeof image === "string"
              ? image
              : JSON.stringify({
                filename: image?.filename ?? null,
                dataUrl: image?.dataUrl ?? null,
              }),
          )
          : [],
        agent: payload.agent ?? null,
        interactiveSubmit: payload.interactiveSubmit === true,
      });
      const now = Date.now();
      if (
        this.recentPromptDispatch &&
        this.recentPromptDispatch.signature === dedupeSignature &&
        now - this.recentPromptDispatch.at <= dedupeWindowMs
      ) {
        this.logger.warn("[MessageFlow] Ignoring duplicate send-now prompt dispatch", {
          sessionId,
          dedupeWindowMs,
          interactiveSubmit: payload.interactiveSubmit === true,
          textPreview: text.slice(0, 160),
        });
        return;
      }
      this.recentPromptDispatch = {
        signature: dedupeSignature,
        at: now,
      };
    }

    if (clientRequestId) {
      this.rememberClientRequest(sessionId, clientRequestId);
    }

    const isMainTurnProcessing = this.isSessionMainTurnProcessing(sessionId);
    let effectiveMode = mode;

    // The SDK exposes session status as the authoritative live-turn signal.
    // Do not infer a queue from transcript/message IDs or from our local
    // processing set: both can lag behind the server and incorrectly label an
    // ordinary turn as queued. The SDK has no per-message queue status, so once
    // it reports busy/retry the extension QueueManager owns each queued item.
    if (
      mode === "send-now" &&
      !payload.interactiveSubmit &&
      !payload.forceSendNow
    ) {
      try {
        const client = await this.serverManager.ensureRunning();
        const statusResponse = await client.session.status({
          ...(this.getWorkspaceDirectory()
            ? { directory: this.getWorkspaceDirectory() }
            : {}),
        });
        const statusBySession =
          (statusResponse as any)?.data ?? statusResponse;
        const statusType =
          statusBySession && typeof statusBySession === "object"
            ? (statusBySession as Record<string, any>)[sessionId]?.type
            : undefined;
        if (statusType === "busy" || statusType === "retry") {
          effectiveMode = "queue";
        }
      } catch (error) {
        // Preserve the existing direct-send behavior if status cannot be read;
        // a failed status lookup must not manufacture a queue state.
        this.logger.debug("[MessageFlow] SDK session status unavailable", {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.debug('[MessageFlow] Mode resolution', {
      requestedMode: mode,
      effectiveMode,
      sessionId,
      isProcessing: isMainTurnProcessing,
      effectiveProcessing: this.getEffectiveProcessingSessionIds().includes(sessionId),
      forceSendNow: payload.forceSendNow
    });

    // Interactive answer submits are real user turns. The previous question
    // turn should already be finalized when the blocking question event is
    // streamed, so answer submits can bypass queue/steer without aborting it.
    // Other force-send paths can still stop an active request before sending.
    if (
      mode === "send-now" &&
      payload.forceSendNow &&
      !payload.avoidAbortIfProcessing &&
      isMainTurnProcessing
    ) {
      this.logger.debug('[MessageFlow] Aborting active request before new message', {
        sessionId,
        avoidAbortIfProcessing: payload.avoidAbortIfProcessing
      });
      await this.handleStopRequest(sessionId, {
        suppressWebviewNotification: true,
        skipQueueDrain: true,
      });
    }

    if (effectiveMode === "send-now") {
      this.logger.debug('[MessageFlow] Queue bypass - sending directly', {
        sessionId,
        textLength: text.length
      });
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
        {
          clientRequestId: clientRequestId || undefined,
          interactiveSubmit: payload.interactiveSubmit === true,
        },
      );
      return;
    }

    const promptId = `q-${Date.now()}-${this.queueItemSequence}`;
    this.queueItemSequence += 1;
    const prompt: QueuedPrompt = {
      id: promptId,
      clientRequestId: clientRequestId || undefined,
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

    this.logger.debug('[MessageFlow] Prompt added to queue', {
      promptId,
      sessionId,
      effectiveMode,
      queuePosition: this.queueManager.getQueueState().length
    });

    if (effectiveMode === "queue") {
      this.logger.debug('[MessageFlow] Message queued (not executing)', {
        sessionId,
        promptId
      });
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

  private clientRequestKey(sessionId: string, clientRequestId: string): string {
    return `${sessionId}::${clientRequestId}`;
  }

  private pruneSeenClientRequests(now = Date.now()): void {
    const ttlMs = 10 * 60 * 1000;
    for (const [key, seenAt] of this.seenClientRequestIds.entries()) {
      if (now - seenAt > ttlMs) {
        this.seenClientRequestIds.delete(key);
      }
    }
  }

  private hasSeenClientRequest(sessionId: string, clientRequestId: string): boolean {
    this.pruneSeenClientRequests();
    return this.seenClientRequestIds.has(
      this.clientRequestKey(sessionId, clientRequestId),
    );
  }

  private rememberClientRequest(sessionId: string, clientRequestId: string): void {
    const now = Date.now();
    this.pruneSeenClientRequests(now);
    this.seenClientRequestIds.set(
      this.clientRequestKey(sessionId, clientRequestId),
      now,
    );
  }

  private async handleDispatchQueuedItem(
    dispatchMode: "queue" | "send-now" | "steer",
    sessionId: string,
    id: string,
    index?: number,
  ): Promise<unknown> {
    return await this.queueManager.handleDispatchQueuedItem(
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
      let processedMessages: any[];
      try {
        const sdkMessages = await this.sessionSnapshotLoader.loadMessagesOnly(childSessionId);
        processedMessages = adaptSdkMessages(sdkMessages);
      } catch (sdkError) {
        this.logger.warn("SDK child session transcript load failed; falling back", {
          subagentId,
          childSessionId,
          error: sdkError instanceof Error ? sdkError.message : String(sdkError),
        });
        const rawMessages = await this.sessionService.getMessages(childSessionId);
        processedMessages = await this.processHistoryMessages(
          Array.isArray(rawMessages) ? rawMessages : [],
          childSessionId,
        );
      }

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

  private markTurnStreamStarted(sessionId: string): void {
    const currentEpoch = (this.turnEpochBySession.get(sessionId) ?? 0) + 1;
    this.turnEpochBySession.set(sessionId, currentEpoch);
  }

  private async schedulePostTurnSdkRefresh(sessionId: string, _messageId?: string): Promise<void> {
    const epoch = this.turnEpochBySession.get(sessionId) ?? 0;
    // Small delay to let the server finalize the message.
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Check if a new turn started during the delay.
    if (this.turnEpochBySession.get(sessionId) !== epoch) return;

    try {
      // A complete session snapshot is cheap compared with replaying a raw
      // event tape and uses the established chatHistory protocol, avoiding a
      // second, partially handled finalization message type.
      const history = await this.loadSdkRenderableHistory(sessionId);
      if (!history.available) {
        this.logger.warn("Post-turn SDK refresh skipped: snapshot unavailable", {
          sessionId,
        });
        return;
      }
      this.view?.webview.postMessage({
        type: "chatHistory",
        sessionId,
        messages: history.messages,
        sdkMessages: history.sdkMessages,
        contextInputTokens: history.contextInputTokens,
        processingSessionIds: this.getEffectiveProcessingSessionIds(),
      });
      await this.refreshPendingInteractionsFromSdk(sessionId);
    } catch (err) {
      this.logger.warn("Post-turn SDK refresh failed", {
        sessionId,
        error: String(err),
      });
    }
  }

  private captureStreamedSubtaskPart(
    parentSessionId: string | undefined,
    properties: Record<string, unknown>,
    part: Record<string, unknown>,
  ): void {
    if ((typeof part?.type === "string" ? part.type.toLowerCase() : "") !== "subtask") {
      return;
    }
    const childSessionId = this.firstNonEmptyString(part.sessionID, part.sessionId, part.childSessionId);
    if (!childSessionId) {
      return;
    }
    const info = this.asRecord(properties.info) || {};
    this.streamedSubtaskPartsBySessionId.set(childSessionId, {
      sessionID: childSessionId,
      messageID: this.firstNonEmptyString(part.messageID, part.messageId, info.id),
      agent: this.firstNonEmptyString(part.agent),
      parentSessionId,
      part: { ...part },
    });
  }

  private scheduleSdkSubagentChildrenRefresh(parentSessionId: string): void {
    const hasSubtaskForParent = Array.from(this.streamedSubtaskPartsBySessionId.values()).some(
      (metadata) => metadata.parentSessionId === parentSessionId,
    );
    if (!hasSubtaskForParent || this.pendingSdkSubagentRefreshes.has(parentSessionId)) {
      return;
    }

    this.pendingSdkSubagentRefreshes.add(parentSessionId);
    setTimeout(() => {
      void this.refreshSubagentsFromSdkChildren(parentSessionId).finally(() => {
        this.pendingSdkSubagentRefreshes.delete(parentSessionId);
      });
    }, 200);
  }

  private async refreshSubagentsFromSdkChildren(parentSessionId: string): Promise<void> {
    try {
      const snapshot = await this.sessionSnapshotLoader.loadSnapshot(parentSessionId);
      const childrenById = new Map<string, any>();
      for (const child of snapshot.children ?? []) {
        const childSession = child?.session;
        if (typeof childSession?.id === "string" && childSession.id.length > 0) {
          childrenById.set(childSession.id, childSession);
        }
      }

      if (childrenById.size === 0) {
        return;
      }

      const detailsById: Record<string, Record<string, unknown>> = {};
      const subagentDetails: Record<string, unknown>[] = [];
      const subagentsByParentMessageId: Record<string, Record<string, unknown>[]> = {};

      for (const sdkMessage of snapshot.messages ?? []) {
        const info = sdkMessage?.info as any;
        const parts = Array.isArray(sdkMessage?.parts) ? sdkMessage.parts : [];
        for (const candidatePart of parts) {
          const subtaskPart = candidatePart as any;
          if (subtaskPart?.type !== "subtask") {
            continue;
          }
          const childSessionId = this.firstNonEmptyString(subtaskPart.sessionID, subtaskPart.sessionId);
          const childSession = childSessionId ? childrenById.get(childSessionId) : undefined;
          if (!childSessionId || !childSession) {
            continue;
          }

          const baseDetail = sdkAdaptSubtaskPart(subtaskPart, info);
          const detail = this.enrichSdkSubtaskDetail(baseDetail as any, subtaskPart, childSession, parentSessionId);
          detailsById[detail.id as string] = detail;
          subagentDetails.push(detail);
          const parentMessageId = this.firstNonEmptyString(detail.parentMessageId, subtaskPart.messageID, info?.id);
          if (parentMessageId) {
            subagentsByParentMessageId[parentMessageId] = [
              ...(subagentsByParentMessageId[parentMessageId] ?? []),
              detail,
            ];
          }
        }
      }

      if (subagentDetails.length === 0) {
        return;
      }

      this.view?.webview.postMessage({
        type: "subagentHydrationUpdate",
        sessionId: parentSessionId,
        subagentDetails,
      });
      this.view?.webview.postMessage({
        type: "subagentUpdate",
        sessionId: parentSessionId,
        detailsById,
        subagentDetailsById: detailsById,
        subagentsByParentMessageId,
      });
    } catch (error) {
      this.logger.warn("SDK child-session subagent refresh failed", {
        sessionId: parentSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private enrichSdkSubtaskDetail(
    baseDetail: Record<string, unknown>,
    part: Record<string, unknown>,
    childSession: any,
    parentSessionId: string,
  ): Record<string, unknown> {
    const childTime = this.asRecord(childSession?.time) || {};
    const childModel = this.asRecord(childSession?.model) || {};
    const partModel = this.asRecord(part?.model) || {};
    const title = this.firstNonEmptyString(
      childSession?.title,
      part.description,
      part.prompt,
      childSession?.id,
    ) || "Subagent";
    const status = typeof childTime.completed === "number"
      ? "done"
      : typeof childTime.updated === "number"
        ? "running"
        : this.normalizeSubagentStatus(baseDetail.status);

    return {
      ...baseDetail,
      id: this.firstNonEmptyString(baseDetail.id, childSession?.id) || title,
      name: title,
      title,
      parentSessionId,
      parentMessageId: this.firstNonEmptyString(baseDetail.parentMessageId, part.messageID),
      childSessionId: childSession?.id,
      agentId: this.firstNonEmptyString(baseDetail.agentId, part.agent),
      agent: this.firstNonEmptyString(part.agent, baseDetail.agentId),
      providerID: this.firstNonEmptyString(childModel.providerID, partModel.providerID, baseDetail.providerID),
      modelID: this.firstNonEmptyString(childModel.modelID, partModel.modelID, baseDetail.modelID),
      model: childSession?.model ?? part.model,
      status,
      latestActivity: this.firstNonEmptyString(childSession?.summary, baseDetail.latestActivity, title),
      tokens: childSession?.tokens,
      cost: childSession?.cost,
      summary: childSession?.summary,
      createdAt: typeof childTime.created === "number" ? childTime.created : undefined,
      updatedAt: typeof childTime.updated === "number" ? childTime.updated : undefined,
      completedAt: typeof childTime.completed === "number" ? childTime.completed : undefined,
    };
  }

  private isTerminalStreamState(
    eventType: string,
    properties: Record<string, unknown>,
    info: Record<string, unknown>,
  ): boolean {
    const terminalEventTypes = new Set([
      "message.complete",
      "message.completed",
      "message.error",
      "message.aborted",
      "session.completed",
      "session.error",
      "error",
    ]);
    if (terminalEventTypes.has(eventType)) {
      return true;
    }

    const normalize = (value: unknown): string | undefined =>
      typeof value === "string" ? value.trim().toLowerCase() : undefined;
    const truthyTerminal = (value: unknown): boolean =>
      value === true ||
      ["true", "done", "stop", "complete", "completed", "success", "finished", "finish", "error", "aborted", "abort", "idle"].includes(normalize(value) || "");

    if (eventType === "session.status") {
      const status = normalize(
        properties.status ??
        properties.state ??
        (properties.session as Record<string, unknown> | undefined)?.status ??
        (properties.info as Record<string, unknown> | undefined)?.status,
      );
      return status === "idle";
    }

    if (eventType !== "message.updated") {
      return false;
    }

    return (
      truthyTerminal(info.finish) ||
      truthyTerminal(info.completed) ||
      truthyTerminal(info.error) ||
      truthyTerminal(info.aborted) ||
      truthyTerminal(properties.finish) ||
      truthyTerminal(properties.completed) ||
      truthyTerminal(properties.error) ||
      truthyTerminal(properties.aborted)
    );
  }

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
      const sessionHistory = await this.loadSdkRenderableHistory(
        sessionId,
      );
      const messages = sessionHistory.messages;

      this.logger.debug('[handleLoadSession] Processed messages', {
        sessionId,
        processedCount: messages.length,
        willSendToWebview: true
      });

      this.subagentTracker.resetForSession(sessionId);

      // Step 2: Log diagnostic information for debugging
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

      // Step 3: Send chatHistory FIRST (before initState)
      // This ensures the webview can detect the session switch properly
      this.view?.webview.postMessage({
        type: "chatHistory",
        sessionId: sessionId,
        messages: messages,
        sdkMessages: sessionHistory.sdkMessages,
        contextInputTokens: sessionHistory.contextInputTokens,
        
        processingSessionIds: this.getEffectiveProcessingSessionIds(),
      });
      await this.compactionManager.sendCompactionViewStateForMessages(
        sessionId,
        messages,
      );

      // Step 4: NOW send initState with the updated session ID
      // This comes AFTER chatHistory so the session switch is already detected
      this.maybeShowCompatibilityWarningNotice(this.getCompatibilityWarnings());
      this.view?.webview.postMessage({
        type: "initState",
        serverStatus: this.serverManager.getStatus(),
        serverError: this.serverManager.getStatus() === "error" ? this.serverManager.getLastError() : undefined,
        selectedModel: this.modelAndAgentManager.getSelectedModel(),
        selectedAgent: this.modelAndAgentManager.getSelectedAgent(),
        sdkVersion: this.installedSdkVersion,
        serverVersion: this.serverManager.getVersion(),
        workspaceRoot: this.getWorkspaceDirectory(),
        currentSessionId: this.currentSessionId,
        processingSessionIds: this.getEffectiveProcessingSessionIds(),
        compatibilityWarnings: this.getCompatibilityWarnings(),
        showLogger: vscode.workspace.getConfiguration("opencode.logging").get<boolean>("showLogger", true),
        todoItems: [],
      });
      void this.refreshSdkTodosForSession(this.currentSessionId);
      void this.refreshPendingInteractionsFromSdk(sessionId);

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

      // Sync persisted revert state so the webview knows if this session
      // is currently reverted (Undo button → Restore after reload).
      await this.syncRevertStateFromServer(sessionId);

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
    this.logger.debug("Fetching skills from OpenCode server");

    try {
      const client = await this.serverManager.ensureRunning();
      if (!client) {
        this.logger.error("Failed to get client for command fetching");
        this.sendCommandsToWebview([]);
        return;
      }

      let currentModel = this.selectedModel?.modelID
        ? { provider: this.selectedModel.providerID, model: this.selectedModel.modelID }
        : undefined;
      if (!currentModel) {
        this.logger.debug("No current model selected, using defaults for command fetch");
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
        this.logger.warn("Failed to load command catalog", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      this.logger.debug("Fetching tools from server", {
        provider: currentModel.provider,
        model: currentModel.model
      });

      const toolsResponse = await client.tool.list({
        provider: currentModel.provider,
        model: currentModel.model
      });

      if (!toolsResponse.data) {
        this.logger.warn("No tools data returned from server");
        this.sendCommandsToWebview(commands);
        return;
      }

      const tools = toolsResponse.data;
      this.logger.debug("Fetched tools from server", {
        toolCount: tools.length,
      });

      const skillTool = tools.find(tool => tool.id === 'skill');

      if (skillTool && skillTool.description) {
        const normalizedDescription = skillTool.description.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = normalizedDescription.split('\n');

        let inAvailableSection = false;
        let currentSkill: { name: string; description: string; source?: string } | null = null;

        for (const line of lines) {
          if (line.includes('## Available Skills') || line.includes('Available Skills')) {
            inAvailableSection = true;
            continue;
          }

          if (inAvailableSection) {
            const match = line.match(/^-\s*\*\*([^*]+)\*\*:\s*(.+)$/);
            if (match) {
              if (currentSkill) {
                commands.push(currentSkill);
              }
              currentSkill = {
                name: match[1].trim(),
                description: match[2].trim(),
                source: "skill",
              };
            } else if (line.startsWith('##') || line.startsWith('---')) {
              if (currentSkill) {
                commands.push(currentSkill);
                currentSkill = null;
              }
              break;
            } else if (line.trim().startsWith('- ') && currentSkill) {
              currentSkill.description += '\n' + line.trim().substring(2);
            } else if (line.trim().length > 0 && currentSkill) {
              currentSkill.description += '\n' + line.trim();
            }
          }
        }

        if (currentSkill) {
          commands.push(currentSkill);
        }

        this.logger.info("Parsed skills from server", {
          count: commands.length,
        });
      } else {
        this.logger.warn("No skill tool found or no description");
      }

      if (commands.length === 0) {
        this.logger.warn("No commands found after fetch", {
          suggestion: 'Check OpenCode server status and ensure skills are enabled',
        });
      }

      this.sendCommandsToWebview(commands);
    } catch (error) {
      this.logger.error("Failed to load commands", {
        error: error instanceof Error ? error.message : String(error),
      });

      this.sendCommandsToWebview([]);
    }
  }

  /**
   * Send commands to the webview
   * Centralized method for sending slash commands to the chat interface
   */
  private sendCommandsToWebview(commands: Array<{ name: string; description?: string; source?: string }>): void {
    if (!this.view) {
      this.logger.error("Cannot send commands - webview is not available");
      return;
    }

    if (!this.view.webview) {
      this.logger.error("Cannot send commands - webview.webview is not available");
      return;
    }

    const message = {
      type: "commandsList",
      commands: commands,
    };

    this.logger.debug("Posting commands to webview", {
      commandCount: message.commands.length,
    });

    try {
      const result = this.view.webview.postMessage(message);

      if (!result) {
        this.logger.warn("postMessage returned false - webview may not be ready");
      }
    } catch (error) {
      this.logger.error("postMessage threw an error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
    if (settings.providerID || settings.modelID) {
      const model: Record<string, string> = {};
      if (settings.providerID) model.providerID = settings.providerID;
      if (settings.modelID) model.modelID = settings.modelID;
      partial.model = model;
    }
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
  private getStructuredOutputFormat(): OutputFormatJsonSchema {
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
    // Only propagate subagent-owned sessions when the parent session is still
    // actively processing. If the main turn has already finished (not in
    // processingSessionIds), dangling "pending"/"running" subagents from the
    // previous turn must NOT re-inflate the effective list — otherwise the
    // webview sees the session as busy and defers the next user message,
    // causing it to wait behind a non-existent turn instead of starting
    // a new one immediately.
    if (this.processingSessionIds.size > 0) {
      for (const sessionId of this.subagentTracker.getActiveProcessingSessionIds()) {
        // Only include if the parent session is itself still processing
        if (this.processingSessionIds.has(sessionId)) {
          ids.add(sessionId);
        }
      }
    }
    return Array.from(ids);
  }

  private isSessionEffectivelyProcessing(sessionId: string | undefined): boolean {
    return !!sessionId && this.getEffectiveProcessingSessionIds().includes(sessionId);
  }

  private isSessionMainTurnProcessing(sessionId: string | undefined): boolean {
    if (!sessionId) {
      return false;
    }
    // This intentionally excludes getEffectiveProcessingSessionIds(), because that
    // helper folds in active subagent/child work for UI badges. Composer dispatch
    // decisions must only care about the main assistant turn for this exact
    // session. Otherwise a completed top-level response can look "busy" because a
    // child activity is still present, and a normal user send gets routed into the
    // visible QueueManager/steer path even though the Stop button is gone.
    return this.processingSessionIds.has(sessionId);
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

    // Check for stream event properties that contain the actual message ID
    const info = this.asRecord(message?.info) || {};
    const properties = this.asRecord(message?.properties) || {};

    // In stream events, info.id might be an event ID (evt_...), so we need to find the actual message ID
    const possibleEventId = this.firstNonEmptyString(info?.id, message?.id);

    // If this looks like an event ID, try to get the actual message ID from event properties
    if (possibleEventId?.startsWith('evt_')) {
      // For stream events, the message ID should be in properties.info.id or properties.messageId
      const propertiesInfo = this.asRecord(properties?.info) || {};
      const streamMessageId = this.firstNonEmptyString(
        this.firstNonEmptyString(propertiesInfo?.id),
        this.firstNonEmptyString(properties?.messageId),
        this.firstNonEmptyString(properties?.id),
      );
      if (streamMessageId && (streamMessageId.startsWith('msg_') || streamMessageId.startsWith('evt_'))) {
        return streamMessageId.startsWith('msg_') ? streamMessageId : possibleEventId;
      }
    }

    // Standard message ID extraction
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

  private logRawEditStepEvent(event: any, enrichedEvent?: any): void {
    const eventRec = event as Record<string, unknown>;
    const properties = (eventRec?.properties as Record<string, unknown>) || {};
    const part = (properties?.part as Record<string, unknown>) || {};
    const partType = String(part?.type || "").toLowerCase();
    const toolName = String(part?.tool || "").toLowerCase();
    const structuredOutput =
      (enrichedEvent?.structuredOutput as Record<string, unknown>) ||
      (eventRec?.structuredOutput as Record<string, unknown>) ||
      (properties?.structuredOutput as Record<string, unknown>) ||
      {};
    const fileChanges = Array.isArray(structuredOutput?.fileChanges)
      ? structuredOutput.fileChanges
      : [];
    const editFileChanges = fileChanges.filter((change: any) =>
      change?.kind === "file_edit" || change?.kind === "file_create" || change?.kind === "file_delete"
    );
    const activityDetail = part?.activityDetail as Record<string, unknown> | undefined;

    const isPatch = partType === "patch";
    const isEditTool = partType === "tool" && (
      toolName.includes("write") || toolName.includes("replace") ||
      toolName.includes("edit") || toolName.includes("patch")
    );
    const hasFileChanges = editFileChanges.length > 0;
    const isActivityEdit = activityDetail?.kind === "file_edit";

    if (!isPatch && !isEditTool && !hasFileChanges && !isActivityEdit) {
      return;
    }

    this.logger.info("[ACTIVITY STEP][EDIT] Raw SDK event data", {
      eventType: eventRec?.type,
      partType,
      toolName: part?.tool,
      filePath: part?.filePath || (part?.state as any)?.input?.file || (part?.state as any)?.input?.path,
      diffStats: part?.diffStats,
      activityDetail,
      fileChanges: editFileChanges,
      rawPartKeys: Object.keys(part),
    });
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

  private postErrorToast(rawMessage: unknown): void {
    const message =
      typeof rawMessage === "string"
        ? rawMessage.replace(/\s+/g, " ").trim()
        : "";
    if (!message) {
      return;
    }
    if (this.shouldSuppressErrorToast(message)) {
      this.logger.warn("Suppressing non-fatal error toast", {
        message,
      });
      return;
    }

    const now = Date.now();
    for (const [key, timestamp] of this.recentUiErrorToastTimestamps.entries()) {
      if (now - timestamp > this.UI_ERROR_TOAST_DEDUPE_WINDOW_MS) {
        this.recentUiErrorToastTimestamps.delete(key);
      }
    }

    const signature = message.toLowerCase();
    const previousTimestamp = this.recentUiErrorToastTimestamps.get(signature);
    if (
      typeof previousTimestamp === "number" &&
      now - previousTimestamp < this.UI_ERROR_TOAST_DEDUPE_WINDOW_MS
    ) {
      return;
    }

    this.recentUiErrorToastTimestamps.set(signature, now);
    this.view?.webview.postMessage({
      type: "errorToast",
      message,
    });
  }

  private shouldSuppressErrorToast(message: string): boolean {
    return /MaxListenersExceededWarning/i.test(message);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this.logger.info("[ChatViewProvider] resolving webview view");
    // A provider can be resolved again before the previous view fully tears
    // down. Dispose the prior view-scoped listeners first so subscriptions do
    // not stack across reloads/reopens.
    this.activeViewCleanup?.();
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

    // Handle messages from webview.
    // We dispose any previous listener first so a re-resolved webview does not
    // accumulate duplicate handlers that retain this provider instance.
    this.webviewMessageListener?.dispose();
    this.webviewMessageListener = webviewView.webview.onDidReceiveMessage(async (message) => {
      const { type } = message;

      // Log all UI interactions for debugging
      this.logger.logUIInteraction('ChatView', type, message.type, message as Record<string, unknown>);

      switch (type) {
        case "webviewLog": {
          const level = typeof message.level === "string" ? message.level.toLowerCase() : "info";
          const logMessage =
            typeof message.message === "string" ? message.message : "[webviewLog]";
          const context =
            message.context && typeof message.context === "object"
              ? (message.context as Record<string, unknown>)
              : {};
          
          // Add webview source indicator to context
          const enrichedContext = {
            ...context,
            source: 'webview',
          };
          
          if (level === "debug") {
            this.logger.debug(logMessage, enrichedContext);
          } else if (level === "warn") {
            this.logger.warn(logMessage, enrichedContext);
          } else if (level === "error") {
            this.logger.error(logMessage, enrichedContext);
          } else {
            this.logger.info(logMessage, enrichedContext);
          }
          break;
        }
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
              sdkVersion: this.installedSdkVersion,
              serverVersion: this.serverManager.getVersion(),
              workspaceRoot: this.getWorkspaceDirectory(),
              currentSessionId: this.currentSessionId,
              processingSessionIds: this.getEffectiveProcessingSessionIds(),
              showLogger: vscode.workspace.getConfiguration("opencode.logging").get<boolean>("showLogger", true),
              todoItems: [],
            });
            this.hasInitializedWebview = true;
          }

          try {
            // Fetch models so they're available in the webview on startup.
            // We await this to ensure models are loaded before sending initState.
            // Network issues are handled gracefully inside handleGetModels with fallback models.
            void (async () => {
              const models = await this.modelAndAgentManager.handleGetModels();
              await this.modelAndAgentManager.reconcileSelectedModelSelection(
                models,
              );

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
            })().catch((error) => {
              this.logger.warn("Background model/agent bootstrap failed", {
                error:
                  error instanceof Error ? error.message : String(error),
              });
            });

            // Resolve the active session before sending initState so that
            // per-session settings (agent / model / thinking) are applied first.
            const currentSession =
              await this.sessionService.getCurrentSession();
            if (currentSession) {
              this.currentSessionId = currentSession.id;
              await this.applySessionSettings(currentSession.id);
            }

            // Send refreshed init state reflecting the session-specific selections
            this.maybeShowCompatibilityWarningNotice(this.getCompatibilityWarnings());
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
              compatibilityWarnings: this.getCompatibilityWarnings(),
              showLogger: vscode.workspace.getConfiguration("opencode.logging").get<boolean>("showLogger", true),
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
              const sessionHistory = await this.loadSdkRenderableHistory(
                currentSession.id,
              );
              const messages = sessionHistory.messages;
              this.logHistoryRenderDiagnostics(
                "webview.ready.current-session",
                currentSession.id,
                [],
                messages,
              );
              this.view?.webview.postMessage({
                type: "chatHistory",
                sessionId: currentSession.id,
                messages: messages,
                sdkMessages: sessionHistory.sdkMessages,
                contextInputTokens: sessionHistory.contextInputTokens,
                
                processingSessionIds: this.getEffectiveProcessingSessionIds(),
              });
              await this.sendPersistedCompactionViewState(currentSession.id);
              this.subagentTracker.resetForSession(currentSession.id);
              this.sendQueueUpdate(currentSession.id);
            } else {
              this.subagentTracker.resetForSession(null);
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
          this.logger.debug("Received prompt dispatch from webview", {
            type: message.type,
            sessionId: message.sessionId,
            clientRequestId: message.clientRequestId,
          });
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
              clientRequestId: message.clientRequestId,
              sessionId: message.sessionId,
              text: message.text,
              files: message.files,
              contexts: message.contexts,
              images: message.images,
              agent: message.agent,
              // Interactive popover submits should behave like a normal direct
              // user send, even if stale processing flags briefly linger from
              // the preceding question turn.
              interactiveSubmit: isInteractiveSubmit,
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
        case "questionReply": {
          this.logger.error("[DEBUG][HOST] Entered questionReply handler", { message });
          const requestID = this.firstNonEmptyString(message.requestID);
          const replySessionId = this.firstNonEmptyString(
            message.sessionId,
            this.currentSessionId,
          );
          const answers = Array.isArray(message.answers)
            ? message.answers
              .map((entry: unknown) =>
                Array.isArray(entry)
                  ? entry.filter((item): item is string => typeof item === "string")
                  : typeof entry === "string"
                    ? [entry]
                    : [],
              )
              .filter((entry: string[]) => entry.length > 0)
            : [];
          if (answers.length === 0) {
            this.logger.error("[DEBUG][HOST] Ignoring malformed question reply", {
              hasRequestID: !!requestID,
              answersLength: answers.length,
            });
            break;
          }
          try {
            const displayText = answers
              .map((entry: string[]) => entry.join(" ").trim())
              .filter((entry: string) => entry.length > 0)
              .join("\n");
            if (replySessionId) {
              this.processingSessionIds.add(replySessionId);
              this.activeStreamSessionId = replySessionId;
              this.markTurnStreamStarted(replySessionId);
              this.sendProcessingSessionsUpdate();
            }
            let answerMessageId: string | undefined;
            if (replySessionId && displayText) {
              const answerMessage = {
                id: this.createOptimisticMessageId(replySessionId, "user"),
                role: "user" as const,
                content: displayText,
                text: displayText,
                interactiveSubmit: true,
                sessionID: replySessionId,
                parts: [
                  {
                    type: "text",
                    text: displayText,
                  },
                ],
                time: {
                  created: Date.now(),
                },
              };
              answerMessageId = answerMessage.id;
              await this.sessionService.appendMessage(replySessionId, answerMessage);
              this.logger.error("[DEBUG][HOST] [CENTRALIZED-TAPE] persisted_raw_user_reply", {
                sessionId: replySessionId,
                messageId: answerMessage.id,
                textLength: displayText.length,
              });
              this.view?.webview.postMessage({
                type: "userMessageAppended",
                message: answerMessage,
                sessionId: replySessionId,
              });
            }
            const client = await this.serverManager.ensureRunning();
            
            // Check if the question is actively pending on the server in a running agent loop
            let isAnswerable = true;
            if (!requestID) {
              isAnswerable = false;
              this.logger.error("[DEBUG][HOST] Question has no requestID, marking as stale");
            } else {
              try {
                this.logger.error("[DEBUG][HOST] Checking if question is answerable using question.list", { replySessionId });
                // We MUST check question.list. If the session is rehydrated (server restarted), 
                // question.reply() succeeds but the agent loop doesn't wake up!
                // question.list() will only return the question if the agent loop is actively waiting for it.
                const pendingQuestionsResult = await (client as any).question.list({
                  sessionID: replySessionId,
                  directory: this.getWorkspaceDirectory(),
                });
                const questionsArray = Array.isArray(pendingQuestionsResult) 
                  ? pendingQuestionsResult 
                  : (pendingQuestionsResult?.questions || pendingQuestionsResult?.data || []);
                const isPending = questionsArray.some((q: any) => q.requestID === requestID);
                
                if (!isPending) {
                  this.logger.error("[DEBUG][HOST] Question not found in active loop, marking as stale", { requestID });
                  isAnswerable = false;
                } else {
                  this.logger.error("[DEBUG][HOST] Question is actively pending. Executing question.reply", {
                    requestID,
                    answers,
                    directory: this.getWorkspaceDirectory()
                  });
                  
                  await (client as any).question.reply({
                    requestID,
                    answers,
                    directory: this.getWorkspaceDirectory(),
                  });
                  const refreshSessionId = replySessionId || this.currentSessionId;
                  if (refreshSessionId) {
                    void this.refreshPendingInteractionsFromSdk(refreshSessionId);
                  }
                  
                  this.logger.error("[DEBUG][HOST] Successfully executed question.reply");
                }
              } catch (err) {
                this.logger.error("[DEBUG][HOST] Failed to check pending questions or reply (likely stale), falling back", { err: String(err) });
                isAnswerable = false;
              }
            }


            if (!isAnswerable) {
              this.logger.error("[DEBUG][HOST] Question not in active loop (server rehydrated). Pre-answering in DB then kicking agent loop via promptAsync.", { requestID });
              if (replySessionId && requestID && displayText) {
                // STEP 1: Pre-answer the question in the OpenCode DB.
                // The agent loop will replay history, find this answer, and continue processing.
                try {
                  this.logger.error("[DEBUG][HOST] Pre-answering question in DB via question.reply", { requestID, answers });
                  await (client as any).question.reply({
                    requestID,
                    answers,
                    directory: this.getWorkspaceDirectory(),
                  });
                  const refreshSessionId = replySessionId || this.currentSessionId;
                  if (refreshSessionId) {
                    void this.refreshPendingInteractionsFromSdk(refreshSessionId);
                  }
                  this.logger.error("[DEBUG][HOST] question.reply to pre-answer DB succeeded", { requestID });
                } catch (replyErr) {
                  // Non-fatal: if it fails (e.g. already answered), we still try to kick the loop.
                  this.logger.error("[DEBUG][HOST] question.reply pre-answer failed (non-fatal)", { error: String(replyErr) });
                }

                // STEP 2: Set up our streaming state BEFORE starting the agent loop
                // so SSE events are properly forwarded to the webview.
                this.processingSessionIds.add(replySessionId);
                this.activeStreamSessionId = replySessionId;
                this.markTurnStreamStarted(replySessionId);
                this.sendProcessingSessionsUpdate();
                this.logger.error("[DEBUG][HOST] Processing state set, kicking agent loop via promptAsync", { replySessionId });

                // STEP 3: Use client.session.promptAsync (fire-and-forget, returns 202 immediately).
                // We MUST NOT use client.session.prompt() here — that endpoint blocks the HTTP
                // connection for the entire agent turn (timeout: false) and deadlocks the extension.
                // promptAsync returns immediately and streams events via SSE.
                // NOTE: client.session is Session2 in the v2 SDK — promptAsync is defined on Session2.
                // The path is client.session.promptAsync, NOT client.v2.session.promptAsync.
                try {
                  const promptAsyncFn = (client as any)?.session?.promptAsync;
                  if (typeof promptAsyncFn === "function") {
                    await promptAsyncFn.call((client as any).session, {
                      sessionID: replySessionId,
                      directory: this.getWorkspaceDirectory(),
                      // Include the agent so the server uses the correct agent instead of
                      // falling back to the workspace default (which may not exist).
                      agent: this.modelAndAgentManager.getSelectedAgent(),
                      // Include parts so the agent knows what the user answered
                      parts: [{ type: "text", text: displayText }],
                    });
                    this.logger.error("[DEBUG][HOST] promptAsync succeeded - agent loop kicked", { replySessionId });
                  } else {
                    // promptAsync unavailable (old server). This is a hard blocker — we cannot
                    // safely fall back to the blocking prompt() since it deadlocks the extension
                    // and breaks the stop button. Report error and clean up processing state.
                    this.logger.error("[DEBUG][HOST] promptAsync not found on client.session — cannot safely kick agent loop without deadlocking");
                    this.processingSessionIds.delete(replySessionId);
                    if (this.activeStreamSessionId === replySessionId) {
                      this.activeStreamSessionId = undefined;
                    }
                    this.sendProcessingSessionsUpdate();
                    this.view?.webview.postMessage({
                      type: "error",
                      message: "This question is from a previous session and the server does not support async resume. Please start a new message.",
                    });
                  }
                } catch (kickErr) {
                  this.logger.error("[DEBUG][HOST] Failed to kick agent loop via promptAsync", { error: String(kickErr) });
                  // Clean up processing state since we failed to start the loop
                  this.processingSessionIds.delete(replySessionId);
                  if (this.activeStreamSessionId === replySessionId) {
                    this.activeStreamSessionId = undefined;
                  }
                  this.sendProcessingSessionsUpdate();
                }
              }
            }

          } catch (err) {
            this.logger.error("[DEBUG][HOST] Error in questionReply handler", { error: String(err) });
            if (replySessionId) {
              this.processingSessionIds.delete(replySessionId);
              if (this.activeStreamSessionId === replySessionId) {
                this.activeStreamSessionId = undefined;
              }
              this.sendProcessingSessionsUpdate();
            }
            this.logger.error(
              "Failed to reply to OpenCode question",
              { requestID, error: (err as Error).message },
              err as Error,
            );
            this.view?.webview.postMessage({
              type: "error",
              message: `Failed to answer question: ${(err as Error).message}`,
            });
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
              sessionId: createdSession.id,
              messages: [],
              sdkMessages: [],
              rawMessages: [],
            });

            // Non-blocking follow-up work:
            // - Persist per-session defaults
            // - Clear persisted subagent snapshot
            // - Refresh sessions list from server
            void (async () => {
              try {
                await Promise.all([
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
        case "unrevertSession": {
          await this.handleUnrevertSession(
            this.firstNonEmptyString(message.sessionId),
          );
          break;
        }
        case "getMessageFileDiffPreview": {
          await this.handleGetMessageFileDiffPreview(
            this.firstNonEmptyString(message.messageId),
            this.firstNonEmptyString(message.file),
            this.firstNonEmptyString(message.sessionId, this.currentSessionId),
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
          let resolvedMatch: ChatModelOption | undefined;
          if (!providerName) {
            // Try to resolve from discovered models if available.
            resolvedMatch = knownModels.find(
              (m) =>
                m.providerID === incoming.providerID &&
                m.modelID === incoming.modelID,
            );
            providerName = resolvedMatch?.providerName || incoming.providerID;
          }

          this.selectedModel = {
            providerID: incoming.providerID,
            modelID: incoming.modelID,
            providerName,
          };
          this.logger.info("[OPENCOD GO MODEL] Model selected from webview", {
            providerID: incoming.providerID,
            modelID: incoming.modelID,
            providerName,
            knownModelsCount: knownModels.length,
            resolvedFromCache: !incoming.providerName && !!resolvedMatch,
          });
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
        case "abortResponse": {
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
            clientRequestId: message.clientRequestId,
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
          // Clean up via the same stop flow the user-triggered Stop button uses so
          // retries do not inherit a half-active timed-out stream.
          if (this.processingSessionIds.has(retrySessionId) || this.activeStreamSessionId === retrySessionId) {
            this.logger.info("retryLastMessage: stopping stale in-flight session before retry", {
              sessionId: retrySessionId,
            });
            await this.handleStopRequest(retrySessionId, {
              skipQueueDrain: true,
            });
          }
          const retryWithoutStructuredOutput =
            message.retryWithoutStructuredOutput === true;
          // Reload chat history to show clean state before retry
          try {
            const sessionHistory = await this.loadSdkRenderableHistory(
              retrySessionId,
            );
            const messages = sessionHistory.messages;
            this.logHistoryRenderDiagnostics(
              "retryLastMessage.reload",
              retrySessionId,
              [],
              messages,
            );
            this.view?.webview.postMessage({
              type: "chatHistory",
              sessionId: retrySessionId,
              messages: messages,
              sdkMessages: sessionHistory.sdkMessages,
              contextInputTokens: sessionHistory.contextInputTokens,
              
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
            log.error("Failed to handle MCP status request", {
              error: err instanceof Error ? err.message : String(err),
            }, err instanceof Error ? err : undefined),
          );
          break;
        }
        case "getLspStatus": {
          this.handleGetLspStatus().catch((err) =>
            log.error("Failed to handle LSP status request", {
              error: err instanceof Error ? err.message : String(err),
            }, err instanceof Error ? err : undefined),
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
            log.error("Failed to get config files list", {
              error: err instanceof Error ? err.message : String(err),
            }, err instanceof Error ? err : undefined);
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
            log.error("Failed to save config file", {
              filePath: message.filePath,
              error: err instanceof Error ? err.message : String(err),
            }, err instanceof Error ? err : undefined);
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
          this.logger.info('[PlanFlow] User approved plan execution', {
            hasPayload: !!payload,
            sessionId: this.currentSessionId
          });

          await this.context.globalState.update(
            "lastPlanProceed",
            payload || null,
          );

          this.logger.debug('[PlanFlow] Plan proceed acknowledgment sent');
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
    this.unsubscribe = this.streamService.subscribe(async (event, rawEvent) => {
      // Log stream events for debugging
      const eventRec = event as Record<string, unknown>;
      const eventType = (eventRec?.type as string) || "unknown";
      const properties = (eventRec?.properties as Record<string, unknown> | undefined) || {};
      const part = (properties?.part as Record<string, unknown> | undefined) || {};
      const eventKind = (part?.type as string | undefined) || "unknown";
      const streamEventSessionId = this.extractEventSessionId(event);
      if (this.shouldVerboseStreamDebug()) {
        this.logger.debug("[CENTRALIZED-TAPE][HOST] stream_callback_received", {
          eventType,
          eventSessionId: streamEventSessionId,
          activeStreamSessionId: this.activeStreamSessionId,
          currentSessionId: this.currentSessionId,
          processingSessionIds: Array.from(this.processingSessionIds),
          source: typeof eventRec?.source === "string" ? eventRec.source : undefined,
          partType: typeof part?.type === "string" ? part.type : undefined,
          hasRawEvent: typeof rawEvent !== "undefined",
        });
      }

      const isTerminalLifecycleEvent =
        eventType === "session.completed" ||
        eventType === "session.error" ||
        eventType === "error";
      if (eventType === "message.updated" || isTerminalLifecycleEvent) {
        const props = (eventRec?.properties as Record<string, unknown> | undefined) || {};
        const info = (props?.info as Record<string, unknown> | undefined) || {};
        this.logger.debug("[OPENCOD GO MODEL] Stream lifecycle event", {
          eventType,
          sessionId: streamEventSessionId,
          providerID: info?.providerID,
          modelID: info?.modelID,
          messageId: info?.id,
          finish: info?.finish,
          activeStreamSessionId: this.activeStreamSessionId,
          currentSessionId: this.currentSessionId,
          processingSessions: Array.from(this.processingSessionIds),
        });
      }
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
      if (eventType === "question.asked") {
        const props = (eventRec?.properties as Record<string, unknown> | undefined) || {};
        const questions = Array.isArray(props.questions) ? props.questions : [];
        this.logger.debug("SDK question.asked received", {
          sessionId: eventSessionId,
          requestID:
            typeof props.requestID === "string"
              ? props.requestID
              : typeof props.id === "string"
                ? props.id
                : undefined,
          questionCount: questions.length,
          firstQuestion:
            questions.length > 0 && typeof (questions[0] as Record<string, unknown>)?.question === "string"
              ? (questions[0] as Record<string, unknown>).question
              : undefined,
          rawPropertiesKeys: Object.keys(props),
        });
      }
      if (eventType === "permission.asked" || eventType === "permission.request") {
        const props = (eventRec?.properties as Record<string, unknown> | undefined) || {};
        const sessionId = this.firstNonEmptyString(
          props.sessionID,
          props.sessionId,
          this.activeStreamSessionId,
          this.currentSessionId,
        );
        this.logger.debug("SDK permission request received", {
          sessionId,
          permissionId:
            typeof props.id === "string"
              ? props.id
              : typeof props.requestID === "string"
                ? props.requestID
                : undefined,
          permission: typeof props.permission === "string" ? props.permission : undefined,
          patternCount: Array.isArray(props.patterns) ? props.patterns.length : 0,
          rawPropertiesKeys: Object.keys(props),
        });
      }
      // Always run subagent tracking before any session-scoped early return so child
      // session events are captured regardless of which session is active in the UI.
      const subagentUpdate = this.subagentTracker.consumeStreamEvent(event);
      // Child-session events (including session.error) belong in the parent
      // session's card, persisted tape, and debug panel. Preserve the original
      // child ID inside the event payload, but use the tracker-resolved parent
      // ID as the storage/display bucket.
      const subagentParentSessionId = subagentUpdate
        ? this.resolveSubagentPayloadSessionId(subagentUpdate)
        : undefined;
      if (subagentUpdate) {
        this.view?.webview.postMessage({
          type: "subagentUpdate",
          ...subagentUpdate,
        });
        this.sendProcessingSessionsUpdate();
      }

      // The client-only mirror is only needed for live-only UI events that
      // deliberately bypass the persisted transcript. Mirroring every token
      // doubled IPC and reducer work during normal streams.
      if (
        eventType === "tui.show" ||
        eventType === "tui.toast.show" ||
        eventType === "session.status"
      ) {
        this.enqueueLiveEventDebugEvent(
          event,
          subagentParentSessionId ||
            eventSessionId ||
            this.activeStreamSessionId ||
            this.currentSessionId,
        );
      }
      if (eventType === "tui.show" || eventType === "tui.toast.show") {
        this.logger.info("[LIVE-TOAST][HOST] captured", {
          eventType,
          eventId: typeof (event as Record<string, unknown>).id === "string"
            ? (event as Record<string, unknown>).id
            : undefined,
          eventSessionId,
          resolvedSessionId:
            subagentParentSessionId ||
            eventSessionId ||
            this.activeStreamSessionId ||
            this.currentSessionId,
          properties: (event as Record<string, unknown>).properties,
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
        this.logger.info("[CENTRALIZED-TAPE][HOST] stream_event_consumed_before_persist", {
          reason: "todo-updated",
          eventType,
          eventSessionId,
          activeStreamSessionId: this.activeStreamSessionId,
          currentSessionId: this.currentSessionId,
        });
        return;
      }
      if (
        await this.compactionManager.handleSdkCompactionStreamEvent(
          event,
          this.sessionService,
        )
      ) {
        this.logger.info("[CENTRALIZED-TAPE][HOST] stream_event_consumed_before_persist", {
          reason: "compaction",
          eventType,
          eventSessionId,
          activeStreamSessionId: this.activeStreamSessionId,
          currentSessionId: this.currentSessionId,
        });
        return;
      }


      const shouldBypassProcessingGate =
        eventType === "question.asked" ||
        eventType === "permission.asked" ||
        eventType === "permission.request" ||
        eventType === "message.updated" ||
        eventType === "message.complete" ||
        eventType === "message.completed" ||
        eventType === "message.error" ||
        eventType === "message.aborted" ||
        eventType === "session.completed" ||
        eventType === "session.error" ||
        eventType === "error" ||
        eventType === "session.diff" ||
        eventType === "session.status";
      if (
        eventSessionId &&
        !shouldBypassProcessingGate &&
        !this.isSessionEffectivelyProcessing(eventSessionId)
      ) {
        this.logger.warn("[CENTRALIZED-TAPE][HOST] stream_event_skipped_before_persist", {
          reason: "non-processing-session",
          sessionId: eventSessionId,
          eventType: event.type,
          activeStreamSessionId: this.activeStreamSessionId,
          currentSessionId: this.currentSessionId,
          processingSessionIds: Array.from(this.processingSessionIds),
        });
        return;
      }
      // For events without an explicit sessionId, check the active stream session.
      // If activeStreamSessionId was cleared (e.g., after stop), skip these events.
      if (
        !eventSessionId &&
        this.activeStreamSessionId &&
        !shouldBypassProcessingGate &&
        !this.isSessionEffectivelyProcessing(this.activeStreamSessionId)
      ) {
        this.logger.warn("[CENTRALIZED-TAPE][HOST] stream_event_skipped_before_persist", {
          reason: "stopped-active-stream-session",
          activeStreamSessionId: this.activeStreamSessionId,
          eventType: event.type,
          currentSessionId: this.currentSessionId,
          processingSessionIds: Array.from(this.processingSessionIds),
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
        // Capture file-change diffs from message.updated summary for changeSummary
        if (eventSessionId && info?.summary?.diffs && Array.isArray(info.summary.diffs)) {
          const diffs: Array<{ file: string; added: number; deleted: number; patch?: string }> = [];
          for (const d of info.summary.diffs) {
            const file = typeof (d as any)?.file === "string" ? (d as any).file : "";
            if (!file) continue;
            diffs.push({
              file,
              added: Math.max(0, Number((d as any)?.additions) || 0),
              deleted: Math.max(0, Number((d as any)?.deletions) || 0),
              patch: typeof (d as any)?.patch === "string" ? (d as any).patch : undefined,
            });
          }
          if (diffs.length > 0) {
            this.sessionDiffFromStream.set(eventSessionId, diffs);
          }
        }
      }

      this.forwardCompactionStatusFromStreamEvent(event);

      const enrichedEvent = this.enrichStreamEvent(event);
      this.logRawEditStepEvent(event, enrichedEvent);

      // Forward events to webview
      const hasBlockingInteractive = this.hasBlockingInteractiveInStreamPayload(
        enrichedEvent || event,
      );
      if (eventType === "question.asked") {
        const enrichedRec = (enrichedEvent || event) as Record<string, unknown>;
        const props = (enrichedRec.properties as Record<string, unknown> | undefined) || {};
        this.logger.debug("Forwarding question.asked to webview", {
          sessionId: eventSessionId,
          hasBlockingInteractive,
          requestID:
            typeof props.requestID === "string"
              ? props.requestID
              : typeof props.id === "string"
                ? props.id
                : undefined,
          questionCount: Array.isArray(props.questions) ? props.questions.length : 0,
        });
      }
      this.logStreamEventDiagnostics(event, enrichedEvent);
      const partType = typeof part?.type === "string" ? part.type.toLowerCase() : "";

      // Log stream event for debugging response types (with error handling)
      try {
        const responseContext: Record<string, unknown> = {
          eventType: event.type || "unknown",
          kind: typeof part?.type === "string" ? part.type : "unknown",
        };

        const responseText =
          (typeof part?.reasoning === "string" && part.reasoning) ||
          (typeof part?.thought === "string" && part.thought) ||
          (typeof part?.thinking === "string" && part.thinking) ||
          (typeof part?.text === "string" && part.text) ||
          (typeof part?.content === "string" && part.content) ||
          undefined;

        if (responseText) {
          responseContext.textLength = responseText.length;
          responseContext.textPreview = responseText.substring(0, 100);
        }

        if (enrichedEvent?.structuredOutput) {
          responseContext.hasStructuredOutput = true;
          responseContext.outputType =
            enrichedEvent.structuredOutput.type ||
            enrichedEvent.structuredOutput.responseType;
        }

        this.logger.aiStreamEvent(
          "stream", // sessionId - using placeholder since stream events don't have a sessionId
          partType || "unknown", // eventType
          responseContext, // context
        );
      } catch (error) {
        // Silently ignore logging errors to prevent stream interruption
        this.logger.warn("Failed to log stream event", { err: error });
      }

      const resolvedSessionId =
        subagentParentSessionId ||
        eventSessionId ||
        this.activeStreamSessionId ||
        this.currentSessionId;

      const info = (properties?.info as Record<string, unknown> | undefined) || {};
      const messageId =
        typeof info?.id === "string"
          ? info.id
          : typeof properties?.messageId === "string"
            ? properties.messageId
            : typeof properties?.messageID === "string"
              ? properties.messageID
              : undefined;
      const isTerminalState = this.isTerminalStreamState(eventType, properties, info);
      this.captureStreamedSubtaskPart(resolvedSessionId, properties, part);
      if (resolvedSessionId && isTerminalState) {
        this.scheduleSdkSubagentChildrenRefresh(resolvedSessionId);
      }
      const preRenderPreview =
        (typeof part?.delta === "string" && part.delta) ||
        (typeof part?.text === "string" && part.text) ||
        (typeof part?.content === "string" && part.content) ||
        (typeof properties?.delta === "string" && properties.delta) ||
        (typeof properties?.text === "string" && properties.text) ||
        (typeof properties?.content === "string" && properties.content) ||
        undefined;

      if (this.shouldVerboseStreamDebug()) {
        this.logger.debug("[CHAT-STREAMING] queueing stream event for webview", {
          eventType: event.type || "unknown",
          sessionId: resolvedSessionId,
          activeStreamSessionId: this.activeStreamSessionId,
          currentSessionId: this.currentSessionId,
          messageId,
          partType: typeof part?.type === "string" ? part.type : undefined,
          hasStructuredOutput: Boolean((enrichedEvent as any)?.structuredOutput),
          preview:
            typeof preRenderPreview === "string"
              ? preRenderPreview.slice(0, 160)
              : undefined,
        });
      }

      // Build a detached, truncated webview-bound payload. The persisted SDK
      // event (the original reference passed to handleStreamEvent) is never
      // mutated — only the webview-bound copy is slimmed. Session ownership
      // still travels in the surrounding webview protocol envelope.
      const eventForWebview = this.buildWebviewStreamEvent(enrichedEvent || event);
      const shouldFlushWebviewImmediately =
        eventType === "question.asked" ||
        eventType === "permission.asked" ||
        eventType === "permission.request" ||
        isTerminalState ||
        // Tool/progress activity is the first visible evidence of work. Do not
        // leave it behind the 50 ms presentation batch while the raw tape has
        // already been persisted; the webview must be able to replace its
        // loading placeholder as soon as this event reaches the host.
        (
          eventType.startsWith("message.part.") &&
          ["tool", "step-start", "step-finish", "step-stop", "patch", "subtask", "agent"].includes(partType)
        );
      this.enqueueStreamWebviewEvent(
        eventForWebview,
        resolvedSessionId,
        shouldFlushWebviewImmediately,
      );
      if (
        eventType === "question.asked" ||
        eventType === "permission.asked" ||
        eventType === "permission.request"
      ) {
        const sessionId = this.firstNonEmptyString(
          properties.sessionID,
          properties.sessionId,
          this.activeStreamSessionId,
          this.currentSessionId,
        );
        if (sessionId) {
          void this.refreshPendingInteractionsFromSdk(sessionId);
        }
      }
      if (!resolvedSessionId) {
        this.logger.warn("[CENTRALIZED-TAPE][HOST] skipped_raw_event_without_session", {
          eventType: typeof (enrichedEvent as Record<string, unknown>)?.type === "string"
            ? (enrichedEvent as Record<string, unknown>).type
            : event.type || "unknown",
          activeStreamSessionId: this.activeStreamSessionId,
          currentSessionId: this.currentSessionId,
          hasRawEvent: typeof rawEvent !== "undefined",
        });
      }
      if (resolvedSessionId && isTerminalState) {
        void this.schedulePostTurnSdkRefresh(resolvedSessionId, messageId);
        this.processingSessionIds.delete(resolvedSessionId);
        if (this.activeStreamSessionId === resolvedSessionId) {
          this.activeStreamSessionId = undefined;
        }
        
        const client = this.serverManager.getClient();
        const assistantMessageId = this.subagentTracker.getLatestParentMessageId(resolvedSessionId);
        
        if (client && assistantMessageId) {
          // Fire-and-forget finalize to freeze incomplete subagents, then update UI state
          void this.subagentTracker.finalizeParentMessage({
            client,
            parentSessionId: resolvedSessionId,
            parentMessageId: assistantMessageId,
          }).then(() => {
            this.sendProcessingSessionsUpdate();
          });
        } else {
          this.sendProcessingSessionsUpdate();
        }
      }

      if (this.shouldVerboseStreamDebug()) {
        this.logger.debug("streamEvent forwarded", {
          type: (enrichedEvent as any)?.type || event.type,
          kind: partType || "unknown",
          hasBlockingInteractive,
        });
      }

      // If this is a step-finish or tool completion for an edit, calculate diff stats asynchronously
      // Fire-and-forget follow-up message so we don't block the stream rendering
      if (partType === "tool" || partType === "step-finish") {
        const props = (event.properties || {}) as any;
        const part = props.part || {};
        const currentPartType = (part.type || "").toLowerCase();

        // Check if it's a tool that modified a file or a step-finish for an edit
        const isToolDone = currentPartType === "tool" && part.state?.status === "done";
        const isStepFinish = currentPartType === "step-finish";

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
      const serverError =
        status === "error" ? this.serverManager.getLastError() : undefined;
      this.view?.webview.postMessage({
        type: "statusUpdate",
        status: status,
        sdkVersion: this.installedSdkVersion,
        serverVersion: this.serverManager.getVersion(),
        serverError,
      });
      if (serverError) {
        this.postErrorToast(serverError);
      }
      this.broadcastCompatibilityWarnings();
    });
    const serverErrorOutputSubscription = this.serverManager.onServerErrorOutput(
      (snippet) => {
        this.postErrorToast(snippet);
      },
    );
    this.postErrorToast(this.serverManager.getLastServerErrorOutput());

    const cleanupCurrentViewResources = () => {
      if (this.webviewMessageListener) {
        this.webviewMessageListener.dispose();
        this.webviewMessageListener = undefined;
      }
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = undefined;
      }
      this.flushStreamWebviewEvents();
      this.flushLiveEventDebugEvents();
      this.isBootstrappingWebview = false;
      this.hasInitializedWebview = false;
      this.sessionsListRequestVersion = 0;
      this.lastSessionsPayloadFingerprint = undefined;
      statusSubscription.dispose();
      serverErrorOutputSubscription.dispose();
      // Don't dispose the singleton tracker - it's shared
      if (this.view === webviewView) {
        this.view = undefined;
      }
      if (this.activeViewCleanup === cleanupCurrentViewResources) {
        this.activeViewCleanup = undefined;
      }
    };
    this.activeViewCleanup = cleanupCurrentViewResources;

    // Cleanup on dispose
    webviewView.onDidDispose(() => {
      if (this.activeViewCleanup === cleanupCurrentViewResources) {
        cleanupCurrentViewResources();
      }
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

    try {
      // Load any session overrides first
      const overriddenMessages = await this.historyProcessor.applySessionMessageOverrides(sessionId, messages);

      // Then process through the canonical pipeline
      const processed = await this.historyProcessor.processHistoryMessages(overriddenMessages, sessionId);

      return processed || [];
    } catch (error) {
      this.logger.error("[DIFF PREVIEW] processHistoryMessages failed", {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Return original messages as fallback
      return messages;
    }
  }

  private truncateLargeStrings(obj: any, maxLen: number = 200000): any {
    if (!obj || typeof obj !== "object") return obj;
    const seen = new WeakSet();
    const stack = [obj];
    
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);
      
      if (Array.isArray(current)) {
        for (let i = 0; i < current.length; i++) {
          const item = current[i];
          if (typeof item === "string") {
            if (item.length > maxLen) {
              current[i] = item.slice(0, maxLen) + "\n...[truncated " + (item.length - maxLen) + " chars]";
            }
          } else if (item && typeof item === "object") {
            stack.push(item);
          }
        }
      } else {
        for (const key in current) {
          if (Object.prototype.hasOwnProperty.call(current, key)) {
            const item = current[key];
            if (typeof item === "string") {
              if (item.length > maxLen) {
                current[key] = item.slice(0, maxLen) + "\n...[truncated " + (item.length - maxLen) + " chars]";
              }
            } else if (item && typeof item === "object") {
              stack.push(item);
            }
          }
        }
      }
    }
    return obj;
  }

  private async loadSdkRenderableHistory(sessionId: string): Promise<{
    /** False only when the SDK request itself failed; an empty session is available. */
    available: boolean;
    messages: any[];
    sdkMessages: unknown[];
    /** Latest SDK-reported context size for the session's most recent assistant turn. */
    contextInputTokens?: number;
  }> {
    this.logger.debug(`[loadSdkRenderableHistory] START sessionId=${sessionId}`);
    const start = Date.now();
    try {
      // LOCKED CONTRACT — REHYDRATION SOURCE OF TRUTH
      // Hydrate directly from the unmodified OpenCode SDK server
      // `session.messages()` response. The result is adapted only at the
      // webview boundary; never replace this with centralized event
      // persistence, SessionService caches, or webview-local data.
      const sdkMessages = await this.sessionSnapshotLoader.loadMessagesOnly(sessionId);
      const messages = adaptSdkMessages(sdkMessages);
      const latestAssistantMessage = [...sdkMessages]
        .reverse()
        .find((message) => message.info.role === "assistant");
      const contextInputTokens = latestAssistantMessage?.info.role === "assistant"
        ? latestAssistantMessage.info.tokens.input
        : undefined;

      this.logger.debug("[SDK-DEBUG][HOST] loaded_renderable_history", {
        sessionId,
        sdkMessageCount: sdkMessages.length,
        renderableMessageCount: messages.length,
        durationMs: Date.now() - start,
      });

      return {
        available: true,
        messages,
        sdkMessages,
        contextInputTokens,
      };
    } catch (err: any) {
      this.logger.error(`[loadSdkRenderableHistory] ERROR: ${err.message}`, { stack: err.stack });
      return {
        available: false,
        messages: [],
        sdkMessages: [],
        contextInputTokens: undefined,
      };
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

  private structuredFormatValidationError(error: unknown): boolean {
    const text = JSON.stringify(error || "").toLowerCase();
    return (
      text.includes("outputformatjsonschema") ||
      text.includes("schema rejection") ||
      this.isStructuredFormatUnsupportedError(error)
    );
  }

  /**
   * Verify the actual server round trip before we persist structured output on
   * a user session. This uses `noReply`, so it neither invokes a model nor
   * spends tokens. It deliberately uses the same `format` sent by real prompts.
   */
  private ensureStructuredOutputFormatCompatibility(client: any): Promise<boolean> {
    if (this.structuredOutputFormatCompatibility) {
      return this.structuredOutputFormatCompatibility;
    }

    this.structuredOutputFormatCompatibility = (async () => {
      const workspaceDirectory = this.getWorkspaceDirectory();
      let probeSessionId: string | undefined;

      try {
        const created = await client.session.create({
          ...(workspaceDirectory ? { directory: workspaceDirectory } : {}),
          title: "OpenCode structured-output compatibility probe",
        });
        probeSessionId = this.firstNonEmptyString(created?.data?.id);
        if (!probeSessionId || created?.error) {
          this.logger.warn("Structured-output compatibility probe could not create a session", {
            error: created?.error,
          });
          return true;
        }

        const prompt = await client.session.prompt({
          sessionID: probeSessionId,
          ...(workspaceDirectory ? { directory: workspaceDirectory } : {}),
          noReply: true,
          parts: [{ type: "text", text: "SDK compatibility probe" }],
          format: this.getStructuredOutputFormat(),
        });
        if (prompt?.error) {
          if (this.structuredFormatValidationError(prompt.error)) {
            this.logger.warn("OpenCode rejected the structured-output format during prompt validation", {
              error: prompt.error,
            });
            return false;
          }
          // Do not disable a working feature for a transient probe failure.
          this.logger.warn("Structured-output compatibility probe prompt failed unexpectedly", {
            error: prompt.error,
          });
          return true;
        }

        const messages = await client.session.messages({
          sessionID: probeSessionId,
          ...(workspaceDirectory ? { directory: workspaceDirectory } : {}),
        });
        if (messages?.error && this.structuredFormatValidationError(messages.error)) {
          this.logger.warn("OpenCode rejected the persisted structured-output format during session rehydration", {
            error: messages.error,
          });
          return false;
        }
        return true;
      } catch (error) {
        // A probe must never prevent a normal user prompt because the server
        // may be reconnecting. Known validator failures are handled above.
        this.logger.warn("Structured-output compatibility probe failed unexpectedly", {
          error: error instanceof Error ? error.message : String(error),
        });
        return true;
      } finally {
        if (probeSessionId) {
          try {
            await client.session.delete({
              sessionID: probeSessionId,
              ...(workspaceDirectory ? { directory: workspaceDirectory } : {}),
            });
          } catch (error) {
            this.logger.warn("Failed to clean up structured-output compatibility probe session", {
              sessionId: probeSessionId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    })();

    return this.structuredOutputFormatCompatibility;
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
      sessionID: sessionID,
      ...(workspaceDirectory ? { directory: workspaceDirectory } : {}),
      command: slashInvocation.command,
      arguments: slashInvocation.arguments,
      agent: agent || this.selectedAgent,
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
      this.logger.info("[OPENCOD GO MODEL] SDK prompt call details", {
        sessionID,
        model: (requestBody as any)?.model,
        agent: (requestBody as any)?.agent,
        partsCount: (requestBody as any)?.parts?.length,
        partTypes: (requestBody as any)?.parts?.map((p: any) => p.type),
        hasFiles: options?.hasFiles,
        hasContexts: options?.hasContexts,
        hasImages: options?.hasImages,
        useStructuredOutput,
      });

      const promise = client.session.prompt({
        sessionID: sessionID,
        ...(workspaceDirectory ? { directory: workspaceDirectory } : {}),
        ...(requestBody as Record<string, unknown>),
      });

      // Add timing tracking
      promise.then((result: { error?: unknown; data?: unknown }) => {
        const sdkDuration = Date.now() - sdkStartTime;
        this.logger.performance(`SDK prompt call completed`, sdkDuration, {
          sessionID,
          hasError: Boolean(result.error),
          hasData: Boolean(result.data),
        });
        this.logger.info("[OPENCOD GO MODEL] SDK prompt resolved", {
          sessionID,
          elapsedMs: sdkDuration,
          hasData: Boolean(result.data),
          hasError: Boolean(result.error),
          errorMessage: result.error instanceof Error ? result.error.message : String(result.error ?? ""),
        });
      }).catch((error: Error) => {
        const sdkDuration = Date.now() - sdkStartTime;
        this.logger.error(`SDK prompt call failed after ${sdkDuration}ms`, {
          sessionID,
          error: error.message,
        });
        this.logger.error("[OPENCOD GO MODEL] SDK prompt rejected", {
          sessionID,
          elapsedMs: sdkDuration,
          error: error.message,
          errorName: error.name,
          stack: error.stack?.substring(0, 500),
        });
      });

      return promise;
    };

    const schema = this.getStructuredOutputFormat();

    if (!useStructuredOutput || this.structuredOutputMode === "disabled") {
      return callPrompt(body as Record<string, unknown>);
    }

    if (!(await this.ensureStructuredOutputFormatCompatibility(client))) {
      this.structuredOutputMode = "disabled";
      this.logger.warn(
        "OpenCode server rejected structured output during the SDK rehydration probe. Falling back to plain text before sending the user prompt.",
      );
      return callPrompt(body as Record<string, unknown>);
    }

    // `outputFormat` was a legacy, untyped compatibility path. Never send it:
    // the SDK server persists this field on the user message and validates it
    // again when `session.messages()` rehydrates the session.
    const withSchema = (): Record<string, unknown> => ({
      ...(body as Record<string, unknown>),
      format: schema,
    });

    // Try structured output with 1 retry (handled by API internally via retryCount)
    const attempt = await callPrompt(withSchema());
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
   * the OpenCode server may embed it (properties, part, info sub-objects, syncEvent wrappers, etc).
   */
  private extractEventSessionId(event: unknown): string | undefined {
    const ev = this.asRecord(event);
    if (!ev) return undefined;
    const props = this.asRecord(ev.properties) ?? {};
    const part = this.asRecord(props.part) ?? {};
    const info = this.asRecord(props.info) ?? {};
    const syncEvent = this.asRecord(ev.syncEvent) ?? {};
    const syncData = this.asRecord(syncEvent.data) ?? {};
    
    return (
      (typeof ev.sessionID === 'string' && ev.sessionID) ||
      (typeof ev.sessionId === 'string' && ev.sessionId) ||
      (typeof syncEvent.aggregateID === 'string' && syncEvent.aggregateID) ||
      (typeof syncEvent.sessionId === 'string' && syncEvent.sessionId) ||
      (typeof syncEvent.sessionID === 'string' && syncEvent.sessionID) ||
      (typeof syncData.sessionID === 'string' && syncData.sessionID) ||
      (typeof syncData.sessionId === 'string' && syncData.sessionId) ||
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

    if (eventRec.type === "question.asked") {
      const properties = this.asRecord(eventRec.properties) || {};
      const questions = Array.isArray(properties.questions)
        ? properties.questions
        : [];
      if (questions.some((item) => isRenderableToolQuestion(item))) {
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
    const questionToolStatus = this.firstNonEmptyString(
      state?.status,
      part.status,
    )?.toLowerCase();
    const questionToolMetadata = this.asRecord(state?.metadata);
    const questionToolAnswers = Array.isArray(questionToolMetadata?.answers)
      ? questionToolMetadata.answers
      : [];
    const questionToolOutput = this.firstNonEmptyString(state?.output, part.output);
    const completedQuestionToolHasAnswer =
      questionToolStatus === "completed" &&
      (questionToolAnswers.length > 0 ||
        !!questionToolOutput ||
        questionToolMetadata?.truncated === false);
    const input =
      this.asRecord(state?.input) ||
      this.asRecord(part.input) ||
      this.asRecord(part.arguments) ||
      null;
    if (!input) {
      return false;
    }

    if (isQuestionTool) {
      if (completedQuestionToolHasAnswer) {
        return false;
      }
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

  private isLikelyInteractiveTransportFailure(errorMessage: string): boolean {
    const isTimeout = ["timeout", "timed out", "expired", "took too long", "exceeded time limit"]
      .some(pattern => errorMessage.toLowerCase().includes(pattern));
    return isTimeout;
  }

  private async cleanupTimedOutSession(sessionId: string, errorMessage?: string): Promise<void> {
    this.logger.warn("Cleaning up timed out session", { sessionId, errorMessage });
    await this.handleStopRequest(sessionId, { skipQueueDrain: true });
  }

  private getUserFacingSendErrorMessage(errorMessage: string): string {
    const normalized = errorMessage.trim().toLowerCase();
    if (!normalized) {
      return "Something went wrong while sending the message. Please try again.";
    }
    
    // Use the timeout checking logic that used to be here
    const isTimeout = ["timeout", "timed out", "expired", "took too long", "exceeded time limit"]
      .some(pattern => normalized.includes(pattern));
      
    if (isTimeout) {
      return "The model did not respond in time. Please retry.";
    }
    
    return errorMessage.trim();
  }

  private enrichStreamEvent(event: any): any {
    if (!event || typeof event !== "object") {
      return event;
    }

    const properties = this.asRecord(event.properties) || {};
    const enriched: Record<string, unknown> = { ...event };

    const structuredOutput = this.extractStructuredOutput({
      ...properties,
      info: properties.info,
    });
    if (structuredOutput) {
      enriched.structuredOutput = structuredOutput;
      enriched.hasStructuredOutput = true;
    }

    return enriched;
  }

  private normalizeSubagentStatus(
    value: unknown,
  ): "pending" | "running" | "done" | "error" | "orphaned" | "cancelled" {
    const status = this.firstNonEmptyString(value)?.toLowerCase();
    if (
      status === "pending" ||
      status === "running" ||
      status === "done" ||
      status === "error" ||
      status === "orphaned" ||
      status === "cancelled"
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
    if (Array.isArray(message.parts)) {
      rawText = message.parts
        .map((part: any) => {
          if (!part || typeof part !== "object") return "";
          if (!this.isRenderableTextPart(part)) {
            return "";
          }
          return (part.text || part.content || part.message || "").toString();
        })
        .join(" ")
        .trim();
    }

    if (!rawText && message?.rawResponse) {
      const rawResponseRec = (() => {
        const direct = this.asRecord(message.rawResponse);
        if (direct) {
          return direct;
        }
        if (typeof message.rawResponse !== "string") {
          return undefined;
        }
        const trimmed = message.rawResponse.trim();
        if (!trimmed) {
          return undefined;
        }
        try {
          return this.asRecord(JSON.parse(trimmed));
        } catch {
          return undefined;
        }
      })();
      const rawResponseParts = Array.isArray(rawResponseRec?.parts)
        ? rawResponseRec.parts
        : [];
      rawText = rawResponseParts
        .map((part: any) => {
          if (!part || typeof part !== "object") return "";
          if (!this.isRenderableTextPart(part)) {
            return "";
          }
          return (part.text || part.content || part.message || "").toString();
        })
        .join(" ")
        .trim();
    }

    if (!rawText && typeof message.structuredOutput?.text === "string") {
      rawText = message.structuredOutput.text.trim();
    } else if (!rawText && typeof message.structuredOutput?.message === "string") {
      rawText = message.structuredOutput.message.trim();
    }

    if (!rawText && typeof message.content === "string" && message.content.trim()) {
      rawText = message.content.trim();
    } else if (!rawText && typeof message.text === "string" && message.text.trim()) {
      rawText = message.text.trim();
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
    const parseRawResponseRecord = (rawResponse: unknown): Record<string, unknown> | undefined => {
      const direct = this.asRecord(rawResponse);
      if (direct) {
        return direct;
      }
      if (typeof rawResponse !== "string") {
        return undefined;
      }
      const trimmed = rawResponse.trim();
      if (!trimmed) {
        return undefined;
      }
      try {
        return this.asRecord(JSON.parse(trimmed));
      } catch {
        return undefined;
      }
    };

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
    const rawResponseRec = parseRawResponseRecord(messageLike.rawResponse);
    const rawResponseInfoRec = this.asRecord(rawResponseRec?.info);
    const candidates: Array<{ value: unknown; source: string }> = [
      { value: messageLike.structured, source: "messageLike.structured" },
      { value: messageLike.info?.structuredOutput, source: "messageLike.info.structuredOutput" },
      { value: messageLike.info?.structured_output, source: "messageLike.info.structured_output" },
      { value: messageLike.info?.structured, source: "messageLike.info.structured" },
      { value: messageLike.info?.output, source: "messageLike.info.output" },
      { value: messageLike.properties?.structuredOutput, source: "messageLike.properties.structuredOutput" },
      { value: messageLike.properties?.structured_output, source: "messageLike.properties.structured_output" },
      { value: messageLike.properties?.structured, source: "messageLike.properties.structured" },
      { value: messageLike.properties?.output, source: "messageLike.properties.output" },
      { value: rawResponseRec?.structured, source: "messageLike.rawResponse.structured" },
      { value: rawResponseRec?.structuredOutput, source: "messageLike.rawResponse.structuredOutput" },
      { value: rawResponseInfoRec?.structured, source: "messageLike.rawResponse.info.structured" },
      { value: rawResponseInfoRec?.structuredOutput, source: "messageLike.rawResponse.info.structuredOutput" },
      { value: messageLike.structuredOutput, source: "messageLike.structuredOutput" },
      { value: messageLike.output, source: "messageLike.output" },
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

    let matchedSource = "none";
    for (const candidate of candidates) {
      const parsed = this.normalizeStructuredOutput(candidate.value as string, {
        source: candidate.source,
        providerID,
        modelID,
      });
      if (parsed) {
        matchedSource = candidate.source;
        this.logger.debug("[CLIENT FACING] extractStructuredOutput MATCH", {
          messageId: messageLike?.id || messageLike?.info?.id,
          source: candidate.source,
          responseType: parsed.responseType,
          messagePreview: String(parsed.message).slice(0, 200),
          hasRawResponse: !!messageLike?.rawResponse,
        });
        return parsed;
      }
    }
    this.logger.debug("[CLIENT FACING] extractStructuredOutput NO MATCH", {
      messageId: messageLike?.id || messageLike?.info?.id,
      checkedSources: candidates.map(c => c.source),
      hasStructOutput: !!messageLike?.structuredOutput,
      hasStruct: !!messageLike?.structured,
      hasRawResponse: !!messageLike?.rawResponse,
      structOutputMsg: String(messageLike?.structuredOutput?.message).slice(0, 200),
      rawResponsePreview: String(messageLike?.rawResponse).slice(0, 300),
    });

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
            type: "message",
            text: bodyText,
            responseType: "message",
            message: bodyText,
          },
          content: bodyText,
          text: bodyText,
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
          () => false // No timeout detection
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

    // Prefer the structured output message when it carries meaningful text,
    // falling back to the raw response body only when structured output is empty.
    const messageContent =
      structured.message ||
      this.createFallbackMessage(structured);
    const hasMeaningfulStructuredMessage =
      typeof messageContent === "string" && messageContent.trim().length > 0;
    if (hasMeaningfulStructuredMessage) {
      this.logger.debug("[CLIENT FACING] applyStructuredOutputToMessage SET_CONTENT", {
        messageId: message?.id || message?.info?.id,
        oldContent: String(message?.content).slice(0, 200),
        newContent: String(messageContent).slice(0, 200),
        structMessage: String(structured?.text ?? structured?.message).slice(0, 200),
        from: "structured.text",
      });
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
        question: ((structured as any).question as string) ?? '',
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
    sendMeta?: { interactiveSubmit?: boolean; clientRequestId?: string },
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
      clientRequestId: sendMeta?.clientRequestId,
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
      // `images` is the legacy transport field used by the composer for every
      // pasted attachment. Preserve its MIME type here so text snippets remain
      // files instead of being converted into image parts downstream.
      const normalizedAttachments = (Array.isArray(images) ? images : [])
        .map((img) => {
          if (typeof img === "string") {
            const mimeMatch = img.match(/^data:([^;,]+)/);
            return {
              dataUrl: img,
              filename: "image",
              mimeType: mimeMatch ? mimeMatch[1] : "image/jpeg",
              textContent: decodeTextDataUrl(
                img,
                mimeMatch ? mimeMatch[1] : "image/jpeg",
              ),
            };
          }
          if (img?.dataUrl && typeof img.dataUrl === "string") {
            const mimeType =
              typeof img.mimeType === "string"
                ? img.mimeType
                : (img.dataUrl.match(/^data:([^;,]+)/)?.[1] ?? "image/jpeg");
            return {
              dataUrl: img.dataUrl,
              filename:
                typeof img.filename === "string" ? img.filename : "image",
              mimeType,
              textContent: decodeTextDataUrl(img.dataUrl, mimeType),
            };
          }
          return null;
        })
        .filter(
          (
            attachment,
          ): attachment is {
            dataUrl: string;
            filename: string;
            mimeType: string;
            textContent: string | undefined;
          } => !!attachment,
        );
      const imageUrls = normalizedAttachments
        .filter((attachment) => attachment.mimeType.toLowerCase().startsWith("image/"))
        .map((attachment) => attachment.dataUrl);

      const serverStartTime = Date.now();
      this.logger.debug("Ensuring server is running", { sessionId: this.currentSessionId });
      const client = await this.serverManager.ensureRunning();
      this.logger.performance("Server ready", Date.now() - serverStartTime);

      const sessionStartTime = Date.now();
      let session = await this.sessionService.getCurrentSession();
      if (this.currentSessionId && session.id !== this.currentSessionId) {
        session = await this.sessionService.switchSession(
          this.currentSessionId,
        );
      }
      this.logger.performance("Session ready", Date.now() - sessionStartTime, {
        sessionId: session.id,
      });

      drainSessionId = session.id;
      this.processingSessionIds.add(drainSessionId);
      this.markTurnStreamStarted(drainSessionId);
      this.logger.info("[OPENCOD GO MODEL] Processing started (loading state ON)", {
        sessionId: drainSessionId,
        providerID: this.selectedModel.providerID,
        modelID: this.selectedModel.modelID,
        providerName: this.selectedModel.providerName,
        processingCount: this.processingSessionIds.size,
      });
      this.sendProcessingSessionsUpdate();
      this.currentSessionId = session.id;
      this.activeStreamSessionId = session.id;
      this.sessionsWithFileChangeEvidence.delete(session.id);
      this.sessionDiffFromStream.delete(session.id);
      this.subagentTracker.setActiveSession(session.id);
      // New user turns are independent from any previous question popover.

      const messagesStartTime = Date.now();
      const existingMessages = await this.sessionService.getMessages(
        session.id,
      );
      this.logger.performance("Messages loaded", Date.now() - messagesStartTime, {
        count: existingMessages.length,
      });

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
          this.logger.info("[CENTRALIZED-TAPE][HOST] persisted_raw_system_message", {
            sessionId: session.id,
            textLength: slashSkillSystemReminder.length,
          });
          this.view?.webview.postMessage({
            type: "userMessageAppended",
            sessionId: session.id,
            message: systemMessage,
          });
        }
        const userMessage = {
          id: this.createOptimisticMessageId(session.id, "user"),
          role: "user" as const,
          content: persistedUserText,
          text: persistedUserText,
          interactiveSubmit: sendMeta?.interactiveSubmit === true,
          sessionID: session.id,
          parts: [
            {
              type: "text",
              text: text,
            },
            ...normalizedAttachments.map((attachment) => ({
              type: "file" as const,
              mime: attachment.mimeType,
              filename: attachment.filename,
              url: attachment.dataUrl,
            })),
          ],
          images: imageUrls,
          time: {
            created: Date.now(),
          },
        };
        await this.sessionService.appendMessage(session.id, userMessage);
        this.logger.info("[CENTRALIZED-TAPE][HOST] persisted_raw_user_message", {
          sessionId: session.id,
          messageId: userMessage.id,
          textLength: persistedUserText.length,
          hasImages: imageUrls.length > 0,
        });

        this.view?.webview.postMessage({
          type: "userMessageAppended",
          sessionId: session.id,
          clientRequestId: sendMeta?.clientRequestId,
          message: userMessage,
        });

        await this.handleGetSessions();
      }

      log.debug("Session message context loaded", {
        sessionId: session.id,
        existingMessageCount: existingMessages.length,
        isNewSession,
      });

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
            const selectionContent = ctx.content;
            const selectionPath = ctx.file;
            const selectionDataUrl = `data:text/plain;base64,${Buffer.from(
              selectionContent,
              "utf-8",
            ).toString("base64")}`;
            const selectionPathWithLineInfo =
              selectionPath && ctx.lineInfo
                ? `${selectionPath}:${ctx.lineInfo}`
                : selectionPath;
            parts.push({
              type: "file",
              mime: "text/plain",
              filename: selectionPathWithLineInfo,
              url: selectionDataUrl,
              source: {
                type: "file",
                path: selectionPath || "",
                text: {
                  value: selectionContent,
                  start: 0,
                  end: selectionContent.length,
                },
                lineInfo: ctx.lineInfo || "",
                languageId: ctx.languageId || "",
              } as any,
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
                mime: "text/plain",
                filename: ctx.file.split(/[\\/]/).pop(),
                url: absoluteUri.toString(),
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
              log.warn("Failed to read file context", {
                file: ctx.file,
                error: error instanceof Error ? error.message : String(error),
              });
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
                url: absoluteUri.toString(),
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
              log.error("Failed to read attached file", {
                filePath,
                error: e instanceof Error ? e.message : String(e),
              }, e as Error);
            }
          }
        }
      }

      if (normalizedAttachments.length > 0) {
        for (const attachment of normalizedAttachments) {
          parts.push({
            type: "file",
            mime: attachment.mimeType,
            filename: attachment.filename || "attachment",
            url: attachment.dataUrl,
          });
          // Unlike image inputs, text snippets cannot be consumed by a vision
          // model. Include their exact contents as a prompt part so the model
          // does not need to resolve the display filename from the workspace.
          if (attachment.textContent !== undefined) {
            parts.push({ type: "text", text: attachment.textContent });
          }
        }
      }

      // Send the message using the SDK
      const startTime = Date.now();
      const thinkingLevel = this.modelAndAgentManager.getEffectiveThinkingLevel(session.id);
      const modelReasoning = this.resolveCapabilityForModel(
        this.selectedModel.providerID,
        this.selectedModel.modelID,
      )?.reasoning ?? false;
      const disableThinkingStructuredOutput =
        thinkingLevel === "auto" ||
        (thinkingLevel === "none" && modelReasoning);
      const useStructuredOutput =
        !slashCommandInvocation &&
        !retryWithoutStructuredOutput &&
        !disableThinkingStructuredOutput &&
        this.shouldUseStructuredOutput(
          this.getStructuredOutputModelKey(this.selectedModel.providerID, this.selectedModel.modelID)
        );
      const promptBody: NonNullable<SessionPromptData["body"]> = {
        model: this.selectedModel,
        agent: agent || this.selectedAgent,
        parts: parts,
      };
      this.logger.info("[OPENCOD GO MODEL] Prompt body constructed", {
        sessionId: session.id,
        model: {
          providerID: this.selectedModel.providerID,
          modelID: this.selectedModel.modelID,
          providerName: this.selectedModel.providerName,
        },
        agent: agent || this.selectedAgent,
        partsCount: parts.length,
        partTypes: parts.map((p: any) => p.type),
      });
      const promptVariant = await this.resolvePromptVariant(session.id);
      if (thinkingLevel === "none" || thinkingLevel === "auto") {
        (promptBody as Record<string, unknown>).variant = null;
      } else if (promptVariant) {
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
      this.logger.info("Sending prompt to server", {
        sessionId: session.id,
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
        : await (async () => {
          this.logger.info("[OPENCOD GO MODEL] Calling SDK prompt...", {
            sessionId: session.id,
            providerID: this.selectedModel.providerID,
            modelID: this.selectedModel.modelID,
            timestamp: new Date().toISOString(),
          });
          const startCall = Date.now();
          try {
            const result = await this.promptWithStructuredOutput(
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
            this.logger.info("[OPENCOD GO MODEL] SDK prompt call returned", {
              sessionId: session.id,
              providerID: this.selectedModel.providerID,
              modelID: this.selectedModel.modelID,
              elapsedMs: Date.now() - startCall,
              hasData: Boolean((result as any)?.data),
              hasError: Boolean((result as any)?.error),
              status: (result as any)?.response?.status,
            });
            return result;
          } catch (callError) {
            this.logger.error("[OPENCOD GO MODEL] SDK prompt call threw", {
              sessionId: session.id,
              providerID: this.selectedModel.providerID,
              modelID: this.selectedModel.modelID,
              elapsedMs: Date.now() - startCall,
              error: callError instanceof Error ? callError.message : String(callError),
              errorName: callError instanceof Error ? callError.name : typeof callError,
            });
            throw callError;
          }
        })();

      const promptDuration = Date.now() - promptStartTime;
      const responseData = getSdkResponseData(response);
      const responseError = getSdkResponseError(response);
      const responseMessage = normalizeSdkAssistantMessage(response);
      this.logger.info("ERROR_FLOW: SDK Response analysis", {
        timestamp: new Date().toISOString(),
        sessionId: session.id,
        promptDuration,
        hasData: Boolean(responseData),
        hasError: Boolean(responseError),
        status: response.response?.status,
        messageId: (responseData as any)?.info?.id,
        responseKeys: response ? Object.keys(response) : [],
        responseDataKeys: responseData ? Object.keys(responseData) : [],
        errorKeys: responseError ? Object.keys(responseError) : [],
      });
      this.logger.performance("Prompt response received", promptDuration, {
        hasData: Boolean(responseData),
        hasError: Boolean(responseError),
        status: response.response?.status,
        messageId: (responseData as any)?.info?.id,
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

      log.debug("AI response received", {
        sessionId: session.id,
        durationSeconds: duration,
        hasData: Boolean(responseData),
        hasError: Boolean(responseError),
        status: response.response?.status,
        messageId: (responseData as any)?.info?.id,
      });
      if (responseData && capturePromptDebug) {
        this.logPromptResponseDiagnostics(session.id, responseData);
      }

      if (responseError) {
        const errorMessages = this.collectNormalizedErrorMessages(responseError);
        log.error("API error returned", {
          sessionId: session.id,
          model: { providerID: this.selectedModel.providerID, modelID: this.selectedModel.modelID },
          error: responseError,
          status: response.response?.status,
          errorMessages,
        });
        this.logger.error("[OPENCOD GO MODEL] API error for model", {
          sessionId: session.id,
          providerID: this.selectedModel.providerID,
          modelID: this.selectedModel.modelID,
          providerName: this.selectedModel.providerName,
          status: response.response?.status,
          errorMessages,
        });
        this.logger.error("Prompt request failed", {
          sessionId: session.id,
          status: response.response?.status,
          errorMessages,
        });

        let errorMessage = this.extractDetailedErrorMessage(
          responseError,
          "Failed to send message",
        );

        // Handle Session Not Found error (likely server restart)
        if (
          errorMessage.toLowerCase().includes("not found") &&
          errorMessage.toLowerCase().includes("session")
        ) {
          log.warn("Session not found on server, attempting recovery", {
            sessionId: session.id,
            action: "recreating-session",
          });
          // Re-create the session on the server
          try {
            const localMessages = await this.sessionService.loadSessionMessages(
              session.id,
            );
            const newSession = await this.sessionService.createNewSession(
              session.title,
            );
            log.info("Session recovered successfully", {
              oldSessionId: session.id,
              newSessionId: newSession.id,
              migratedMessageCount: localMessages.length,
            });

            // Migrate local messages from old ID to new ID
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
            log.error("Session recovery failed", {
              sessionId: session.id,
              error: recreateError instanceof Error ? recreateError.message : String(recreateError),
            }, recreateError as Error);
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

        const userFacingErrorMessage =
          this.getUserFacingSendErrorMessage(errorMessage);
        this.logger.info("ERROR_FLOW: Sending error event to webview", {
          timestamp: new Date().toISOString(),
          sessionId: session.id,
          errorMessage: userFacingErrorMessage,
          originalError: errorMessage,
          status: response.response?.status,
        });
        vscode.window.showErrorMessage(`OpenCode error: ${userFacingErrorMessage}`);
        this.view?.webview.postMessage({
          type: "error",
          message: userFacingErrorMessage,
          sessionId: session.id,
        });

        if (this.isLikelyInteractiveTransportFailure(errorMessage)) {
          await this.cleanupTimedOutSession(session.id, errorMessage);
        }

        return;
      }

      // Check for hidden errors in data (e.g. ModelNotFoundError returned as JSON)
      if (
        responseData &&
        (responseData as any).suggestions &&
        (responseData as any).modelID &&
        !(responseData as any).content
      ) {
        const errData = responseData as any;
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
      if (responseMessage) {
        const rawResponse = this.buildRawResponseDebugText(responseData);
        const structuredMessage = this.applyStructuredOutputToMessage(
          responseMessage,
        );
        const enrichedMessage = await this.enrichMessageWithPlan(structuredMessage);
        const safeCorrectMessageFromRawResponse = (() => {
          if (!rawResponse) return undefined;
          try {
            const parsed = JSON.parse(rawResponse);
            const msg = parsed?.info?.structured?.text ?? parsed?.info?.structured?.message;
            return typeof msg === "string" && msg.trim() ? msg.trim() : undefined;
          } catch { return undefined; }
        })();
        this.logger.debug("[CLIENT FACING] safetyNet", {
          messageId: enrichedMessage?.id || enrichedMessage?.info?.id,
          rawContent: String(enrichedMessage?.content).slice(0, 200),
          rawText: String(enrichedMessage?.text).slice(0, 200),
          structOutMessage: String(enrichedMessage?.structuredOutput?.message).slice(0, 200),
          rawResponseCorrectMsg: safeCorrectMessageFromRawResponse?.slice(0, 200),
          hasRawResponse: !!rawResponse,
          structOutExists: !!enrichedMessage?.structuredOutput,
          willFixContent: !!(safeCorrectMessageFromRawResponse && enrichedMessage?.content !== safeCorrectMessageFromRawResponse),
        });
        if (safeCorrectMessageFromRawResponse) {
          enrichedMessage.content = safeCorrectMessageFromRawResponse;
          enrichedMessage.text = safeCorrectMessageFromRawResponse;
          if (!enrichedMessage.structuredOutput) {
            enrichedMessage.structuredOutput = {
              type: "message",
              text: safeCorrectMessageFromRawResponse,
              responseType: "message",
              message: safeCorrectMessageFromRawResponse,
            };
          } else if (enrichedMessage.structuredOutput.text !== safeCorrectMessageFromRawResponse) {
            enrichedMessage.structuredOutput = {
              ...enrichedMessage.structuredOutput,
              text: safeCorrectMessageFromRawResponse,
              message: safeCorrectMessageFromRawResponse,
            };
          }
        }
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
            this.messageHasFileChangeEvidence(finalMessage) ||
            this.sessionDiffFromStream.has(session.id));
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
          } else {
            // Fallback: use diffs captured from message.updated SSE events
            const streamDiffs = this.sessionDiffFromStream.get(session.id);
            if (streamDiffs && streamDiffs.length > 0) {
              const files = streamDiffs.map((d) => ({
                file: d.file,
                added: d.added,
                deleted: d.deleted,
                diffExcerpt: d.patch
                  ? {
                      lines: d.patch.split(/\r?\n/).filter(
                        (line: string) => line.trim().length > 0,
                      ),
                    }
                  : undefined,
              }));
              finalMessage = {
                ...finalMessage,
                changeSummary: {
                  files,
                  messageId: finalAssistantMessageId,
                },
              };
            }
          }
        }

        const debugMessage = {
          ...finalMessage,
          rawResponse,
        };

        this.logger.debug("[CLIENT FACING] SENDING_TO_WEBVIEW", {
          messageId: debugMessage?.id || debugMessage?.info?.id,
          content: String(debugMessage?.content).slice(0, 200),
          text: String(debugMessage?.text).slice(0, 200),
          structOutMsg: String(debugMessage?.structuredOutput?.message).slice(0, 200),
          hasRawResponse: !!debugMessage?.rawResponse,
          type: "messageResponse",
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
        void this.maybeAutoCompact(session.id, responseData);
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
      this.logger.error(`Message send failed`, {
        error: String(error),
        sessionId: drainSessionId,
        durationMs: totalDuration,
      }, error instanceof Error ? error : new Error(String(error)));

      const errorMessage = this.extractDetailedErrorMessage(
        error,
        "Failed to send message",
      );
      const userFacingErrorMessage =
        this.getUserFacingSendErrorMessage(errorMessage);
      vscode.window.showErrorMessage(`Failed to send message: ${userFacingErrorMessage}`);
      this.logger.error("Send message exception", {
        sessionId: drainSessionId,
        errorMessage,
        errorMessages: this.collectNormalizedErrorMessages(error),
      });

      // Show error in webview too
      this.view?.webview.postMessage({
        type: "error",
        message: userFacingErrorMessage,
      });

      if (this.isLikelyInteractiveTransportFailure(errorMessage) && drainSessionId) {
        await this.cleanupTimedOutSession(drainSessionId, errorMessage);
      }
    } finally {
      const totalDuration = Date.now() - overallStartTime;
      log.featureStep(flow, 'message_processing_completed', {
        duration: totalDuration,
        sessionId: drainSessionId,
        timestamp: new Date().toISOString(),
      });

      this.logger.performance("Message processing completed", totalDuration, {
        sessionId: drainSessionId,
      });

      if (debugSessionId) {
        this.promptDebugBySession.delete(debugSessionId);
      }
      if (drainSessionId) {
        const shouldPreserveInteractiveContinuation =
          sendMeta?.interactiveSubmit === true &&
          this.activeStreamSessionId === drainSessionId &&
          this.processingSessionIds.has(drainSessionId);
        if (shouldPreserveInteractiveContinuation) {
          this.logger.info(
            "[OPENCOD GO MODEL] Preserving processing state for interactive continuation",
            {
              sessionId: drainSessionId,
              providerID: this.selectedModel.providerID,
              modelID: this.selectedModel.modelID,
            },
          );
        } else {
          this.processingSessionIds.delete(drainSessionId);
          this.sessionsWithFileChangeEvidence.delete(drainSessionId);
          if (this.activeStreamSessionId === drainSessionId) {
            this.activeStreamSessionId = undefined;
          }
          this.sendProcessingSessionsUpdate();
          this.logger.info("[OPENCOD GO MODEL] Processing ended (loading state OFF)", {
            sessionId: drainSessionId,
            providerID: this.selectedModel.providerID,
            modelID: this.selectedModel.modelID,
          });
        }

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
    if (explicitSessionId && this.isSessionEffectivelyProcessing(explicitSessionId)) {
      return explicitSessionId;
    }

    const activeStreamSessionId = this.firstNonEmptyString(this.activeStreamSessionId);
    if (
      activeStreamSessionId &&
      this.isSessionEffectivelyProcessing(activeStreamSessionId)
    ) {
      return activeStreamSessionId;
    }

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
      log.warn("Failed to resolve active session for stop request", {
        error: error instanceof Error ? error.message : String(error),
      });
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

      // A stop is a local user decision first.  Do not leave the webview
      // waiting for either the abort HTTP request or its terminal SSE event:
      // both can fail while the server/stream is unhealthy.  Finalize locally
      // so late events for this request are obsolete and cannot keep the UI
      // loading forever.
      this.processingSessionIds.delete(resolvedSessionId);
      this.sessionsWithFileChangeEvidence.delete(resolvedSessionId);
      if (this.activeStreamSessionId === resolvedSessionId) {
        this.activeStreamSessionId = undefined;
      }
      this.sendProcessingSessionsUpdate();
      void this.schedulePostTurnSdkRefresh(resolvedSessionId);

      if (!options?.suppressWebviewNotification) {
        this.view?.webview.postMessage({
          type: "stopRequestHandled",
          sessionId: resolvedSessionId,
        });
      }

      const client = this.serverManager.getClient();
      if (!client) {
        this.logger.warn("stopRequest finalized locally: no client available", {
          sessionId: resolvedSessionId,
        });
        return;
      }

      this.logger.info("Stopping request", {
        sessionId: resolvedSessionId,
      });

      const workspaceDirectory = this.getWorkspaceDirectory();

      // Abort remains best-effort after local finalization.  An error here is
      // diagnostic only; the user has already stopped this turn in the UI.
      // The extension uses the SDK v2 convenience client. Its typed
      // `session.abort` parameters are flattened as `{ sessionID, directory }`
      // and map to POST /session/{sessionID}/abort.
      void client.session.abort({
        sessionID: resolvedSessionId,
        ...(workspaceDirectory ? { directory: workspaceDirectory } : {}),
      }).then((result) => {
        if (result.error) {
          log.error("Failed to abort active request", {
            sessionId: resolvedSessionId,
            error: String(result.error),
          });
          return;
        }
        this.logger.info("SDK session abort accepted", {
          sessionId: resolvedSessionId,
        });
      }).catch((error: unknown) => {
        log.error("Failed to abort active request", {
          sessionId: resolvedSessionId,
          error: error instanceof Error ? error.message : String(error),
        }, error as Error);
      });
    } finally {
      // Local finalization above intentionally does not depend on stream health.
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
        log.error("Failed to read attached image", {
          filePath: uri.fsPath,
          error: error instanceof Error ? error.message : String(error),
        }, error as Error);
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
    this.maybeShowCompatibilityWarningNotice(this.getCompatibilityWarnings());
    this.view?.webview.postMessage({
      type: "initState",
      serverStatus: this.serverManager.getStatus(),
      serverError:
        this.serverManager.getStatus() === "error"
          ? this.serverManager.getLastError()
          : undefined,
      selectedModel: this.selectedModel,
      selectedAgent: this.selectedAgent,
      sdkVersion: this.installedSdkVersion,
      serverVersion: this.serverManager.getVersion(),
      workspaceRoot: this.getWorkspaceDirectory(),
      currentSessionId: this.currentSessionId,
      processingSessionIds: this.getEffectiveProcessingSessionIds(),
      compatibilityWarnings: this.getCompatibilityWarnings(),
      showLogger: vscode.workspace.getConfiguration("opencode.logging").get<boolean>("showLogger", true),
      todoItems: [],
    });
    void this.refreshSdkTodosForSession(this.currentSessionId);
  }

  private getCompatibilityWarnings(): CompatibilityResult[] {
    const warnings: CompatibilityResult[] = [];

    const sdkCompatibility = checkOpencodeSdkVersion(
      detectInstalledOpencodeSdkVersion(),
    );
    if (sdkCompatibility.status !== "supported") {
      warnings.push(sdkCompatibility);
    }

    const serverVersion = this.serverManager.getVersion();
    if (serverVersion) {
      const serverCompatibility = checkOpencodeServerVersion(serverVersion);
      if (serverCompatibility.status !== "supported") {
        warnings.push(serverCompatibility);
      }
    }

    return warnings;
  }

  public setCompatibilityWarningsOverride(
    warnings: CompatibilityResult[] | null,
  ): void {
    this.compatibilityWarningsOverride = warnings;
    const nextWarnings = this.getCompatibilityWarnings();
    this.maybeShowCompatibilityWarningNotice(nextWarnings);
    this.view?.webview.postMessage({
      type: "compatibilityStatus",
      compatibilityWarnings: nextWarnings,
    });
    this.refreshView();
  }

  private maybeShowCompatibilityWarningNotice(
    compatibilityWarnings: ReturnType<ChatViewProvider["getCompatibilityWarnings"]>,
  ): void {
    if (compatibilityWarnings.length === 0) {
      this.lastCompatibilityWarningSignature = undefined;
      return;
    }

    const signature = compatibilityWarnings
      .map((warning) =>
        [
          warning.component,
          warning.status,
          warning.version ?? "unknown",
          warning.supportedRange,
        ].join(":"),
      )
      .join("|");

    if (this.lastCompatibilityWarningSignature === signature) {
      return;
    }

    this.lastCompatibilityWarningSignature = signature;
    const summary = compatibilityWarnings
      .map((warning) => warning.message)
      .join("\n");
    vscode.window.showWarningMessage(summary);
  }

  private broadcastCompatibilityWarnings(): void {
    const compatibilityWarnings = this.getCompatibilityWarnings();
    this.maybeShowCompatibilityWarningNotice(compatibilityWarnings);
    this.view?.webview.postMessage({
      type: "compatibilityStatus",
      compatibilityWarnings: compatibilityWarnings,
    });
  }

  /**
   * Generates the HTML content for the webview
   */
  // FORBIDDEN TO REMOVE: React Chat Asset Contract - ensure <div id="root"> and chat.js/chat.css wiring remain intact
  private getHtmlContent(webview: vscode.Webview): string {
    const iconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "resources", "icon.svg"),
    );
    const escapeHtmlAttribute = (value: string): string =>
      value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "webview",
        "shared",
        "dist",
        "chat.css",
      ),
    ).with({ query: `t=${Date.now()}` });
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "webview",
        "shared",
        "dist",
        "chat.js",
      ),
    ).with({ query: `t=${Date.now()}` });

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
  <div id="root" data-opencode-icon-uri="${escapeHtmlAttribute(iconUri.toString())}"></div>
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
      log.error("Failed to search files", {
        query,
        error: error instanceof Error ? error.message : String(error),
      }, error as Error);
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
        query: query || "",
      });

      if (response.data && Array.isArray(response.data)) {
        const items = response.data.map((filePath: string) => {
          const name = filePath.split(/[\\/]/).pop() || filePath;
          return { path: filePath, name };
        });
        return { items, source: 'opencode-sdk' };
      }

    } catch (error) {
      log.warn("SDK file search failed, using VS Code fallback", {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
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
          log.warn("Agent search failed for mentions", {
            query: q,
            error: e instanceof Error ? e.message : String(e),
          });
          return [] as Array<{ type: "agent"; id: string; name: string; description?: string; color?: string }>;
        }),
        this.searchFilesForMentions(client, q).catch((e) => {
          log.warn("File search failed for mentions", {
            query: q,
            error: e instanceof Error ? e.message : String(e),
          });
          return [] as Array<{ type: "file"; path: string; name: string }>;
        }),
        this.searchMcpResources(client, q).catch((e) => {
          log.warn("Resource search failed for mentions", {
            query: q,
            error: e instanceof Error ? e.message : String(e),
          });
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
      log.error("Failed to process mentions request", {
        query,
        error: error instanceof Error ? error.message : String(error),
      }, error as Error);
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

      log.info("MCP server status sent to webview", {
        serverCount: Object.keys(servers).length,
        toolCount: toolIds.length,
      });

      log.endFeatureFlow(flow, { result: 'completed', serverCount: Object.keys(servers).length, toolCount: toolIds.length });
    } catch (err) {
      log.error("Failed to get MCP server status", {
        error: err instanceof Error ? err.message : String(err),
      }, err instanceof Error ? err : undefined);
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

      log.info("LSP server status sent to webview", {
        serverCount: servers.length,
        workspaceDir,
      });

      log.endFeatureFlow(flow, { result: 'completed', serverCount: servers.length });
    } catch (err) {
      log.error("Failed to get LSP server status", {
        error: err instanceof Error ? err.message : String(err),
      }, err instanceof Error ? err : undefined);
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
            sessionID: sessionId,
            directory: workspaceDir, messageID: messageId,
          })
        : await client.session.diff({
            sessionID: sessionId,
            messageID: messageId,
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
              (item): item is { file: string; added: number; deleted: number; diffExcerpt: { header?: string; lines: string[]; added?: number; deleted?: number } | undefined } =>
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
    // Surface the early-return case so the user knows why nothing happened
    // instead of silently failing.
    if (!targetMessageId || !targetSessionId) {
      vscode.window.showWarningMessage(
        "Unable to undo changes: missing message or session identifier.",
      );
      return;
    }

    try {
      const client = await this.serverManager.ensureRunning();
      const workspaceDir = this.getWorkspaceDirectory();
      // The v2 SDK defaults to ThrowOnError=false, which means HTTP errors
      // (400 BadRequest, 404 NotFound, 409 SessionBusy) are returned in
      // result.error — NOT thrown. We must check result.error explicitly
      // before accessing result.data, otherwise the undo silently fails.
      const revertResult = await client.session.revert({
        sessionID: targetSessionId,
        messageID: targetMessageId,
        ...(workspaceDir ? { directory: workspaceDir } : {}),
      });
      const revertError = (
        revertResult as unknown as { error?: unknown }
      )?.error;
      if (revertError) {
        const errorMessage =
          revertError instanceof Error
            ? revertError.message
            : typeof revertError === "object" &&
                revertError !== null
              ? String(
                  (revertError as Record<string, unknown>).message ??
                    (revertError as Record<string, unknown>).data ??
                    revertError,
                )
              : String(revertError);
        this.logger.error("Undo changes: server returned error", {
          messageId: targetMessageId,
          sessionId: targetSessionId,
          error: errorMessage,
        });
        vscode.window.showErrorMessage(
          `Failed to undo changes: ${errorMessage}`,
        );
        return;
      }

      const sessionData = (
        revertResult as unknown as { data?: unknown }
      )?.data;
      const revertField =
        (sessionData as Record<string, unknown> | undefined)?.revert ??
        undefined;
      const revertRecord =
        revertField && typeof revertField === "object"
          ? (revertField as Record<string, unknown>)
          : null;
      const optionalStr = (key: string): string | undefined => {
        const v = revertRecord ? revertRecord[key] : undefined;
        return typeof v === "string" && v.length > 0 ? v : undefined;
      };
      const revertState = revertRecord
        ? {
            messageID:
              optionalStr("messageID") ?? targetMessageId,
            partID: optionalStr("partID"),
            snapshot: optionalStr("snapshot"),
            diff: optionalStr("diff"),
          }
        : null;
      this.view?.webview.postMessage({
        type: "revertStateUpdate",
        revertState,
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

  private async handleUnrevertSession(
    requestedSessionId?: string,
  ): Promise<void> {
    const targetSessionId = this.firstNonEmptyString(
      requestedSessionId,
      this.currentSessionId,
    );
    if (!targetSessionId) {
      vscode.window.showWarningMessage(
        "Unable to restore: missing session identifier.",
      );
      return;
    }

    try {
      const client = await this.serverManager.ensureRunning();
      const workspaceDir = this.getWorkspaceDirectory();
      // Same ThrowOnError=false pattern as handleUndoMessageChanges —
      // HTTP errors land in result.error, not in catch.
      const unrevertResult = await client.session.unrevert({
        sessionID: targetSessionId,
        ...(workspaceDir ? { directory: workspaceDir } : {}),
      });

      const unrevertError = (
        unrevertResult as unknown as { error?: unknown }
      )?.error;
      if (unrevertError) {
        const errorMessage =
          unrevertError instanceof Error
            ? unrevertError.message
            : typeof unrevertError === "object" &&
                unrevertError !== null
              ? String(
                  (unrevertError as Record<string, unknown>).message ??
                    (unrevertError as Record<string, unknown>).data ??
                    unrevertError,
                )
              : String(unrevertError);
        this.logger.error("Restore: server returned error", {
          sessionId: targetSessionId,
          error: errorMessage,
        });
        vscode.window.showErrorMessage(
          `Failed to restore: ${errorMessage}`,
        );
        return;
      }

      this.view?.webview.postMessage({
        type: "revertStateUpdate",
        revertState: null,
      });

      await this.handleLoadSession(targetSessionId);
      await this.handleGetSessions();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to restore reverted messages", {
        sessionId: targetSessionId,
        error: errorMessage,
      });
      vscode.window.showErrorMessage(`Failed to restore: ${errorMessage}`);
    }
  }

  private async syncRevertStateFromServer(sessionId: string): Promise<void> {
    try {
      const client = await this.serverManager.ensureRunning();
      const resp = await client.session.get({ sessionID: sessionId });
      const revert = (resp.data as Record<string, unknown> | undefined)?.revert as
        | { messageID?: string; partID?: string; snapshot?: string; diff?: string }
        | undefined;
      if (revert?.messageID) {
        this.view?.webview.postMessage({
          type: "revertStateUpdate",
          revertState: {
            messageID: revert.messageID,
            partID: revert.partID,
            snapshot: revert.snapshot,
            diff: revert.diff,
          },
        });
      } else {
        this.view?.webview.postMessage({
          type: "revertStateUpdate",
          revertState: null,
        });
      }
    } catch (error) {
      this.logger.debug("syncRevertStateFromServer: could not fetch session", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleGetMessageFileDiffPreview(
    messageId?: string,
    filePath?: string,
    requestedSessionId?: string,
  ): Promise<void> {
    const targetMessageId = this.firstNonEmptyString(messageId);
    const targetFilePath = this.firstNonEmptyString(filePath);
    const targetSessionId = this.firstNonEmptyString(
      requestedSessionId,
      this.currentSessionId,
    );
    if (!targetMessageId || !targetFilePath || !targetSessionId || !this.view) {
      return;
    }

    let diffExcerpt:
      | { header?: string; lines: string[]; added?: number; deleted?: number }
      | undefined;
    try {
      const client = await this.serverManager.ensureRunning();
      const workspaceDir = this.getWorkspaceDirectory();
      const diffResponse = workspaceDir
        ? await client.session.diff({
            sessionID: targetSessionId,
            directory: workspaceDir, messageID: targetMessageId,
          })
        : await client.session.diff({
            sessionID: targetSessionId,
            messageID: targetMessageId,
          });
      const rows = Array.isArray(diffResponse?.data)
        ? (diffResponse.data as Array<Record<string, unknown>>)
        : [];
      const normalizedTarget = targetFilePath.replace(/\\/g, "/").toLowerCase();
      const matched = rows.find((row) => {
        const file = this.firstNonEmptyString(row?.file)?.replace(/\\/g, "/").toLowerCase();
        return !!file && (file === normalizedTarget || file.endsWith(`/${normalizedTarget}`));
      });
      if (matched) {
        diffExcerpt = this.buildSdkDiffExcerpt({
          file: this.firstNonEmptyString(matched.file),
          before: typeof matched.before === "string" ? matched.before : undefined,
          after: typeof matched.after === "string" ? matched.after : undefined,
          patch: typeof matched.patch === "string" ? matched.patch : undefined,
        });
      }
      if (!diffExcerpt) {
        const enrichment = await this.getDiffActivityEnrichment(targetFilePath);
        diffExcerpt = enrichment?.diffExcerpt;
      }
    } catch (error) {
      this.logger.warn("Failed to fetch message file diff preview", {
        messageId: targetMessageId,
        file: targetFilePath,
        sessionId: targetSessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.view.webview.postMessage({
      type: "messageFileDiffPreview",
      messageId: targetMessageId,
      sessionId: targetSessionId,
      file: targetFilePath,
      diffExcerpt,
    });
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
      log.error("Failed to get diff activity enrichment", {
        error: error instanceof Error ? error.message : String(error),
      }, error as Error);
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
    // Mark disposed first so any in-flight async chains (e.g. title generation)
    // bail out early and don't hold closure references to this instance.
    this.isDisposed = true;
    this.activeViewCleanup?.();
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
    this.flushStreamWebviewEvents();
    this.flushLiveEventDebugEvents();
    this.quotaService.off("quotaUpdate", this.handleQuotaUpdate);
    if (this.webviewMessageListener) {
      this.webviewMessageListener.dispose();
      this.webviewMessageListener = undefined;
    }
    this.streamService.dispose();
    this.quotaService.dispose();
    void this.sessionService.dispose();
    this.fileThemeProcessor.unsubscribe(this);
    this.isBootstrappingWebview = false;
    this.hasInitializedWebview = false;
    this.sessionsListRequestVersion = 0;
    this.lastSessionsPayloadFingerprint = undefined;
    // Memory fix: explicitly clear all session-keyed Maps and Sets so they
    // don't retain historical data if the provider is re-opened in the same
    // VS Code session (webview re-mount without full extension deactivation).
    this.queueBySessionId.clear();
    this.promptDebugBySession.clear();
    this.structuredValidationFailureCounters.clear();
    this.recentUiErrorToastTimestamps.clear();
    this.compactingSessions.clear();
    this.sessionsWithFileChangeEvidence.clear();
    this.sessionDiffFromStream.clear();
    this.processingSessionIds.clear();
    this.seenClientRequestIds.clear();
    this.executingQueueSessionIds.clear();
    this.sessionsNeedingTitle?.clear();
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
      log.debug("Theme CSS injected successfully", {
        themeId: themeData.themeId,
        cssLength: combinedCss.length,
      });
    } catch (error) {
      log.error("Failed to send theme data to webview", {
        error: error instanceof Error ? error.message : String(error),
      }, error as Error,
      );
    }
  }
}
