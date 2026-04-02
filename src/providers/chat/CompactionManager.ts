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
    private processHistoryMessages: (messages: any[], sessionId: string) => any[],
  ) {
    // postMessage callback will be set by shell
    this.postMessage = () => { };
  }

  private postMessage: (msg: any) => void;

  setPostMessage(fn: (msg: any) => void): void {
    this.postMessage = fn;
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
        ? this.processHistoryMessages(rawMessages, sessionId)
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
    baselineStats?: CompactionBaselineStats;
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
   * Get selected model context limit
   */
  getSelectedModelContextLimit(): number | undefined {
    // This will be provided by the shell via callback
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
    if (!responseData?.usage) {
      return;
    }

    const contextLimit = this.getSelectedModelContextLimit();
    if (!contextLimit) {
      return;
    }

    const totalTokens = (responseData.usage.inputTokens || 0) +
      (responseData.usage.totalTokens || 0) +
      (responseData.usage.prompt_tokens || 0);

    const threshold = Math.floor(contextLimit * 0.8);
    if (totalTokens < threshold) {
      return;
    }

    if (this.compactingSessions.has(sessionId)) {
      return;
    }

    this.logger.info("Auto-compaction threshold reached", {
      sessionId,
      totalTokens,
      threshold,
      contextLimit,
    });

    await this.handleCompactSession(
      sessionId,
      { auto: true, threshold: totalTokens },
      sessionService,
    );
  }

  /**
   * Handle compact session
   */
  async handleCompactSession(
    sessionId: string,
    options: { auto?: boolean; threshold?: number },
    sessionService: any,
  ): Promise<void> {
    if (this.compactingSessions.has(sessionId)) {
      this.logger.warn("Compaction already in progress", { sessionId });
      return;
    }

    this.compactingSessions.add(sessionId);

    try {
      const dividerState = await this.resolveSessionCompactionDividerState(
        sessionId,
        sessionService,
      );

      this.postCompactionStatus({
        sessionId,
        status: "running",
      });

      const response = await this.serverManager.compactSession(sessionId);

      if (!response?.data) {
        throw new Error("No data in compaction response");
      }

      const baselineStats = this.normalizeCompactionBaselineStats(
        response.data.baselineStats,
      );

      const state: PersistedCompactionViewState = {
        lastCompactedAt: Date.now(),
        baselineStats,
        collapsed: false,
        compactionDividerIndex: dividerState.compactionDividerIndex,
        compactionDividerBeforeMessageId:
          dividerState.compactionDividerBeforeMessageId,
        compactionDividerAfterMessageId:
          dividerState.compactionDividerAfterMessageId,
      };

      await this.persistAndPublishCompactionViewState(sessionId, state);

      this.postCompactionStatus({
        sessionId,
        status: "done",
        compacted: true,
        baselineStats,
        compactionDividerBeforeMessageId:
          dividerState.compactionDividerBeforeMessageId,
        compactionDividerAfterMessageId:
          dividerState.compactionDividerAfterMessageId,
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
