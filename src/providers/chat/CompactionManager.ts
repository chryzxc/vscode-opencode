/**
 * CompactionManager Module
 *
 * Handles context compaction lifecycle, persistence, and UI state management.
 *
 * Extracted from ChatViewProvider.ts (~300 lines)
 */

import * as vscode from "vscode";
import type { OpencodeServerManager } from "../../services/OpencodeServerManager";
import type { CompactionBaselineStats, PersistedCompactionViewState } from "./types";

type CompactSessionOptions = {
  auto?: boolean;
  threshold?: number;
  baselineStats?: CompactionBaselineStats;
};

type ResolvedCompactionDividerState = {
  compactionDividerIndex?: number;
  compactionDividerBeforeMessageId?: string;
  compactionDividerAfterMessageId?: string;
};

export class CompactionManager {
  private static readonly COMPACTION_VIEW_STATE_PREFIX =
    "opencode.session.compaction-view.";

  private compactingSessions = new Set<string>();

  constructor(
    private workspaceState: vscode.Memento,
    private serverManager: OpencodeServerManager,
    private logger: ReturnType<typeof import("../../utils/Logger").createLogger>,
    private asRecord: (value: unknown) => Record<string, unknown> | undefined,
    private firstNonEmptyString: (...values: unknown[]) => string | undefined,
    private processHistoryMessages: (messages: any[], sessionId: string) => Promise<any[]>,
  ) {
    // postMessage callback will be set by shell
    this.postMessage = () => { };
    this.getSelectedModelContextLimit = () => undefined;
    this.getSelectedModel = () => undefined;
  }

  private postMessage: (msg: any) => void;
  private getSelectedModelContextLimit: () => number | undefined;
  private getSelectedModel: () => { providerID: string; modelID: string } | undefined;

  setPostMessage(fn: (msg: any) => void): void {
    this.postMessage = fn;
  }

  setGetSelectedModelContextLimit(fn: () => number | undefined): void {
    this.getSelectedModelContextLimit = fn;
  }

  setGetSelectedModel(fn: () => { providerID: string; modelID: string } | undefined): void {
    this.getSelectedModel = fn;
  }

  private normalizeTokenCount(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : undefined;
  }

  private extractSdkContextInputTokens(responseData: unknown): number | undefined {
    const rec = this.asRecord(responseData);
    if (!rec) {
      return undefined;
    }

    const info = this.asRecord(rec.info);
    const infoTokens = this.asRecord(info?.tokens);
    const directTokens = this.asRecord(rec.tokens);

    return this.normalizeTokenCount(infoTokens?.input) ??
      this.normalizeTokenCount(directTokens?.input);
  }

  private didSdkConfirmCompaction(response: { data?: unknown } | undefined): boolean {
    const data = response?.data;

    if (data === true || data === undefined) {
      return true;
    }
    if (data === false || data === null) {
      return false;
    }

    const rec = this.asRecord(data);
    if (!rec) {
      return false;
    }

    if (rec.compacted === true || rec.success === true || rec.ok === true) {
      return true;
    }

    const status = this.firstNonEmptyString(rec.status)?.toLowerCase();
    if (status && ["ok", "success", "done", "completed", "compacted"].includes(status)) {
      return true;
    }

    return false;
  }

  private compactMessageSignature(messages: any[]): string {
    if (!Array.isArray(messages) || messages.length === 0) {
      return "empty";
    }

    return messages
      .map((message) => {
        const rec = this.asRecord(message) || {};
        const info = this.asRecord(rec.info) || {};
        const id = this.firstNonEmptyString(rec.id, rec.messageId, info.id) || "";
        const role = this.firstNonEmptyString(rec.role, info.role, rec.sender) || "";
        const body = this.firstNonEmptyString(rec.content, rec.text) || "";
        return `${id}|${role}|${body.slice(0, 180)}`;
      })
      .join("\n");
  }

  private getMessageId(message: unknown): string | undefined {
    const rec = this.asRecord(message);
    const info = this.asRecord(rec?.info);
    return this.firstNonEmptyString(
      rec?.id,
      rec?.messageId,
      rec?.messageID,
      info?.id,
      info?.messageId,
      info?.messageID,
    );
  }

  private findMessageIndexById(messages: any[], messageId: string): number {
    return messages.findIndex((message) => this.getMessageId(message) === messageId);
  }

  private extractLatestCompactionPart(messages: any[]): Record<string, unknown> | undefined {
    let latest: Record<string, unknown> | undefined;
    for (const message of messages) {
      const rec = this.asRecord(message);
      const parts = Array.isArray(rec?.parts) ? rec.parts : [];
      for (const rawPart of parts) {
        const part = this.asRecord(rawPart);
        const type = this.firstNonEmptyString(part?.type)?.toLowerCase();
        if (type === "compaction") {
          latest = part;
        }
      }
    }
    return latest;
  }

  private resolveDividerStateFromTailStartId(
    messages: any[],
    tailStartId: string | undefined,
  ): ResolvedCompactionDividerState | undefined {
    if (!tailStartId) {
      return undefined;
    }

    const dividerIndex = this.findMessageIndexById(messages, tailStartId);
    if (dividerIndex <= 0) {
      return undefined;
    }

    return {
      compactionDividerIndex: dividerIndex,
      compactionDividerBeforeMessageId: this.getMessageId(messages[dividerIndex - 1]),
      compactionDividerAfterMessageId: tailStartId,
    };
  }

  resolveSdkCompactionDividerState(messages: any[]): ResolvedCompactionDividerState | undefined {
    if (!Array.isArray(messages) || messages.length === 0) {
      return undefined;
    }

    const compactionPart = this.extractLatestCompactionPart(messages);
    const tailStartId = this.firstNonEmptyString(
      compactionPart?.tail_start_id,
      compactionPart?.tailStartId,
      compactionPart?.tailStartID,
    );

    return this.resolveDividerStateFromTailStartId(messages, tailStartId);
  }

  resolveSdkCompactionViewState(
    messages: any[],
    existingState?: PersistedCompactionViewState | null,
  ): PersistedCompactionViewState | null {
    const dividerState = this.resolveSdkCompactionDividerState(messages);
    if (!dividerState?.compactionDividerIndex) {
      return null;
    }

    return {
      lastCompactedAt: existingState?.lastCompactedAt ?? Date.now(),
      baselineStats: existingState?.baselineStats,
      collapsed: existingState?.collapsed ?? true,
      ...dividerState,
    };
  }

  /**
   * Get storage key for compaction view state
   */
  getCompactionViewStateStorageKey(sessionId: string): string {
    return `${CompactionManager.COMPACTION_VIEW_STATE_PREFIX}${sessionId}`;
  }

  /**
   * Normalize compaction baseline stats
   */
  normalizeCompactionBaselineStats(
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

  /**
   * Normalize compaction view state
   */
  normalizeCompactionViewState(
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

  /**
   * Load persisted compaction view state
   */
  async loadPersistedCompactionViewState(
    sessionId: string,
  ): Promise<PersistedCompactionViewState | null> {
    const raw = this.workspaceState.get<unknown>(
      this.getCompactionViewStateStorageKey(sessionId),
    );
    return this.normalizeCompactionViewState(raw);
  }

  /**
   * Save persisted compaction view state
   */
  async savePersistedCompactionViewState(
    sessionId: string,
    state: PersistedCompactionViewState,
  ): Promise<void> {
    await this.workspaceState.update(
      this.getCompactionViewStateStorageKey(sessionId),
      state,
    );
  }

  /**
   * Clear persisted compaction view state
   */
  async clearPersistedCompactionViewState(
    sessionId: string,
  ): Promise<void> {
    await this.workspaceState.update(
      this.getCompactionViewStateStorageKey(sessionId),
      undefined,
    );
  }

  /**
   * Post compaction view state to webview
   */
  postCompactionViewState(
    sessionId: string,
    state: PersistedCompactionViewState,
  ): void {
    this.postMessage({
      type: "compactionViewState",
      sessionId,
      ...state,
    });
  }

  /**
   * Send persisted compaction view state to webview
   */
  async sendPersistedCompactionViewState(
    sessionId: string,
  ): Promise<void> {
    const state = await this.loadPersistedCompactionViewState(sessionId);
    if (!state) {
      return;
    }
    this.postCompactionViewState(sessionId, state);
  }

  async sendCompactionViewStateForMessages(
    sessionId: string,
    messages: any[],
  ): Promise<void> {
    const persisted = await this.loadPersistedCompactionViewState(sessionId);
    const sdkState = this.resolveSdkCompactionViewState(messages, persisted);
    if (sdkState) {
      await this.persistAndPublishCompactionViewState(sessionId, sdkState);
      return;
    }

    if (persisted) {
      this.postCompactionViewState(sessionId, persisted);
    }
  }

  /**
   * Resolve session compaction divider state
   */
  async resolveSessionCompactionDividerState(
    sessionId: string,
    sessionService: any,
  ): Promise<{
    compactionDividerIndex?: number;
    compactionDividerBeforeMessageId?: string;
    compactionDividerAfterMessageId?: string;
  }> {
    try {
      const rawMessages = await sessionService.getMessages(sessionId);
      const messages = Array.isArray(rawMessages)
        ? await this.processHistoryMessages(rawMessages, sessionId)
        : [];

      const state = await this.loadPersistedCompactionViewState(sessionId);
      if (!state) {
        return {};
      }

      const dividerIndex = state.compactionDividerIndex;
      if (dividerIndex === undefined || dividerIndex < 0 || dividerIndex >= messages.length) {
        return {};
      }

      const beforeMessage = messages[dividerIndex];
      const afterMessage = messages[dividerIndex + 1];

      return {
        compactionDividerIndex: dividerIndex,
        compactionDividerBeforeMessageId: this.firstNonEmptyString(
          beforeMessage?.id,
          beforeMessage?.messageId,
        ),
        compactionDividerAfterMessageId: this.firstNonEmptyString(
          afterMessage?.id,
          afterMessage?.messageId,
        ),
      };
    } catch {
      return {};
    }
  }

  /**
   * Post compaction status
   */
  postCompactionStatus(payload: {
    sessionId: string;
    status: string;
    error?: string;
    compacted?: boolean;
    notice?: string;
    baselineStats?: CompactionBaselineStats;
    compactionDividerIndex?: number;
    compactionDividerBeforeMessageId?: string;
    compactionDividerAfterMessageId?: string;
  }): void {
    this.postMessage({
      type: "compactionStatus",
      ...payload,
    });
  }

  /**
   * Persist and publish compaction view state
   */
  async persistAndPublishCompactionViewState(
    sessionId: string,
    state: PersistedCompactionViewState,
  ): Promise<void> {
    await this.savePersistedCompactionViewState(sessionId, state);
    this.postCompactionViewState(sessionId, state);
  }

  /**
   * Handle set compaction view state
   */
  async handleSetCompactionViewState(message: {
    sessionId: string;
    collapsed?: boolean;
    compactionDividerIndex?: number;
    compactionDividerBeforeMessageId?: string;
    compactionDividerAfterMessageId?: string;
  }): Promise<void> {
    const { sessionId, collapsed } = message;
    const state = await this.loadPersistedCompactionViewState(sessionId);
    if (!state) {
      return;
    }
    state.collapsed = collapsed;
    if (
      typeof message.compactionDividerIndex === "number" &&
      Number.isFinite(message.compactionDividerIndex) &&
      message.compactionDividerIndex >= 0
    ) {
      state.compactionDividerIndex = Math.floor(message.compactionDividerIndex);
    }
    const dividerBefore = this.firstNonEmptyString(
      message.compactionDividerBeforeMessageId,
    );
    if (dividerBefore) {
      state.compactionDividerBeforeMessageId = dividerBefore;
    }
    const dividerAfter = this.firstNonEmptyString(
      message.compactionDividerAfterMessageId,
    );
    if (dividerAfter) {
      state.compactionDividerAfterMessageId = dividerAfter;
    }
    await this.persistAndPublishCompactionViewState(sessionId, state);
  }

  /**
   * Resolve compaction session ID
   */
  async resolveCompactionSessionId(message: {
    sessionId?: string;
    compactSession?: string;
  }): Promise<string | undefined> {
    if (message.sessionId) {
      return message.sessionId;
    }
    if (message.compactSession) {
      return message.compactSession;
    }
    return undefined;
  }

  /**
   * Maybe auto compact session
   */
  async maybeAutoCompact(
    sessionId: string,
    responseData: any,
    sessionService: any,
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration("opencode");
    if (config.get<boolean>("autoCompact", true) === false) {
      return;
    }

    const contextLimit = this.getSelectedModelContextLimit();
    if (!contextLimit) {
      return;
    }

    const inputTokens = this.extractSdkContextInputTokens(responseData);
    if (inputTokens === undefined) {
      return;
    }

    const thresholdRatioRaw = config.get<number>("autoCompactThreshold", 0.9);
    const thresholdRatio =
      typeof thresholdRatioRaw === "number" &&
        Number.isFinite(thresholdRatioRaw) &&
        thresholdRatioRaw >= 0.5 &&
        thresholdRatioRaw <= 0.99
        ? thresholdRatioRaw
        : 0.9;
    const threshold = Math.floor(contextLimit * thresholdRatio);
    if (inputTokens < threshold) {
      return;
    }

    if (this.compactingSessions.has(sessionId)) {
      return;
    }

    this.logger.info("Auto-compaction threshold reached", {
      sessionId,
      inputTokens,
      threshold,
      contextLimit,
    });

    await this.handleCompactSession(
      sessionId,
      { auto: true, threshold: inputTokens },
      sessionService,
    );
  }

  /**
   * Handle compact session
   */
  async handleCompactSession(
    sessionId: string,
    options: CompactSessionOptions,
    sessionService: any,
  ): Promise<void> {
    if (this.compactingSessions.has(sessionId)) {
      this.logger.warn("Compaction already in progress", { sessionId });
      return;
    }

    this.compactingSessions.add(sessionId);

    try {
      const preRawMessages = await sessionService.getMessages(sessionId);
      const preMessages = Array.isArray(preRawMessages)
        ? await this.processHistoryMessages(preRawMessages, sessionId)
        : [];
      const preSignature = this.compactMessageSignature(preMessages);

      const dividerState = await this.resolveSessionCompactionDividerState(
        sessionId,
        sessionService,
      );

      this.postCompactionStatus({
        sessionId,
        status: "running",
      });

      const selectedModel = this.getSelectedModel();
      if (!selectedModel?.providerID || !selectedModel?.modelID) {
        throw new Error("Cannot compact session: selected model is required");
      }

      const response = await this.serverManager.compactSession(sessionId, {
        providerID: selectedModel.providerID,
        modelID: selectedModel.modelID,
      });

      if (!this.didSdkConfirmCompaction(response)) {
        throw new Error("OpenCode did not confirm session compaction");
      }

      const baselineStats = options.baselineStats;

      const refreshedRawMessages = await sessionService.getMessages(sessionId);
      const refreshedMessages = Array.isArray(refreshedRawMessages)
        ? await this.processHistoryMessages(refreshedRawMessages, sessionId)
        : [];
      const sdkState = this.resolveSdkCompactionViewState(refreshedMessages);
      const state: PersistedCompactionViewState = sdkState ?? {
        lastCompactedAt: Date.now(),
        baselineStats,
        collapsed: true,
        // If the SDK did not expose a tail anchor, keep rewritten history visible.
        compactionDividerIndex: 0,
        compactionDividerBeforeMessageId: undefined,
        compactionDividerAfterMessageId: undefined,
      };
      if (baselineStats && !state.baselineStats) {
        state.baselineStats = baselineStats;
      }

      await this.persistAndPublishCompactionViewState(sessionId, state);
      const postSignature = this.compactMessageSignature(refreshedMessages);
      const noVisibleChange = preSignature === postSignature;

      this.postMessage({
        type: "chatHistory",
        sessionId,
        messages: refreshedMessages,
      });

      this.postCompactionStatus({
        sessionId,
        status: "done",
        compacted: !noVisibleChange,
        notice: noVisibleChange
          ? "Nothing to compact yet. This session is already concise."
          : undefined,
        baselineStats,
        compactionDividerIndex: state.compactionDividerIndex,
        compactionDividerBeforeMessageId: state.compactionDividerBeforeMessageId,
        compactionDividerAfterMessageId: state.compactionDividerAfterMessageId,
      });

      this.logger.info("Session compacted successfully", {
        sessionId,
        auto: options.auto,
        baselineStats,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error("Session compaction failed", {
        sessionId,
        error: errorMessage,
      });

      this.postCompactionStatus({
        sessionId,
        status: "error",
        error: errorMessage,
      });
    } finally {
      this.compactingSessions.delete(sessionId);
    }
  }

  async handleSdkCompactionStreamEvent(
    event: unknown,
    sessionService: any,
  ): Promise<boolean> {
    const rec = this.asRecord(event);
    if (!rec) {
      return false;
    }

    const type = this.firstNonEmptyString(rec.type)?.toLowerCase();
    const properties = this.asRecord(rec.properties) ?? {};
    const part = this.asRecord(properties.part);
    const sessionId = this.firstNonEmptyString(
      properties.sessionID,
      properties.sessionId,
      part?.sessionID,
      part?.sessionId,
      rec.sessionID,
      rec.sessionId,
    );

    const isCompactionPart =
      type?.startsWith("message.part.") &&
      this.firstNonEmptyString(part?.type)?.toLowerCase() === "compaction";
    const isStarted = type === "session.next.compaction.started";
    const isDelta = type === "session.next.compaction.delta";
    const isEnded =
      type === "session.next.compaction.ended" ||
      type === "session.compacted";

    if (!isCompactionPart && !isStarted && !isDelta && !isEnded) {
      return false;
    }
    if (!sessionId) {
      return true;
    }

    if (isStarted || isCompactionPart) {
      this.postCompactionStatus({
        sessionId,
        status: "running",
      });
      return true;
    }

    if (isDelta) {
      return true;
    }

    try {
      const refreshedRawMessages = await sessionService.getMessages(sessionId);
      const refreshedMessages = Array.isArray(refreshedRawMessages)
        ? await this.processHistoryMessages(refreshedRawMessages, sessionId)
        : [];
      const state =
        this.resolveSdkCompactionViewState(refreshedMessages) ?? {
          lastCompactedAt: Date.now(),
          collapsed: true,
          compactionDividerIndex: 0,
          compactionDividerBeforeMessageId: undefined,
          compactionDividerAfterMessageId: undefined,
        };

      await this.persistAndPublishCompactionViewState(sessionId, state);
      this.postMessage({
        type: "chatHistory",
        sessionId,
        messages: refreshedMessages,
      });
      this.postCompactionStatus({
        sessionId,
        status: "done",
        compacted: true,
        compactionDividerIndex: state.compactionDividerIndex,
        compactionDividerBeforeMessageId: state.compactionDividerBeforeMessageId,
        compactionDividerAfterMessageId: state.compactionDividerAfterMessageId,
        baselineStats: state.baselineStats,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to refresh compacted session", {
        sessionId,
        error: errorMessage,
      });
      this.postCompactionStatus({
        sessionId,
        status: "error",
        error: errorMessage,
      });
    }

    return true;
  }

  /**
   * Forward compaction status from stream event
   */
  forwardCompactionStatusFromStreamEvent(event: unknown): void {
    const rec = this.asRecord(event);
    if (!rec) return;

    const sessionId = this.firstNonEmptyString(
      rec.sessionId,
      rec.sessionID,
    );
    if (!sessionId) return;

    const status = this.firstNonEmptyString(rec.status);
    const normalizedStatus = status === "completed" ? "done" : status;
    const compacted = rec.compacted === true;
    const error = this.firstNonEmptyString(rec.error);
    const baselineStats = this.normalizeCompactionBaselineStats(rec.baselineStats);
    const compactionDividerBeforeMessageId = this.firstNonEmptyString(
      rec.compactionDividerBeforeMessageId,
    );
    const compactionDividerAfterMessageId = this.firstNonEmptyString(
      rec.compactionDividerAfterMessageId,
    );

    if (
      !normalizedStatus &&
      !compacted &&
      !error &&
      !baselineStats &&
      !compactionDividerBeforeMessageId &&
      !compactionDividerAfterMessageId
    ) {
      return;
    }

    this.postCompactionStatus({
      sessionId,
      status: normalizedStatus || "unknown",
      compacted,
      error,
      baselineStats,
      compactionDividerBeforeMessageId,
      compactionDividerAfterMessageId,
    });
  }
}
