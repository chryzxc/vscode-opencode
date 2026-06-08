/**
 * SubagentPersistence Module
 *
 * Handles persisting/loading subagent snapshots and building payloads from messages.
 *
 * Extracted from ChatViewProvider.ts (~250 lines)
 */

import * as vscode from "vscode";
import type { SubagentTracker } from "../../services/SubagentTracker";
import type { SubagentUpdatePayload } from "../../services/SubagentTracker";

export class SubagentPersistence {
  private static readonly SUBAGENT_SNAPSHOT_PREFIX =
    "opencode.session.subagents.";

  constructor(
    private workspaceState: vscode.Memento,
    private subagentTracker: SubagentTracker,
    private logger: ReturnType<typeof import("../../utils/Logger").createLogger>,
    private asRecord: (value: unknown) => Record<string, unknown> | undefined,
    private firstNonEmptyString: (...values: unknown[]) => string | undefined,
    private normalizeSubagentStatus: (status: unknown) => string,
    private mergeSubagentEntries: (existing: any[], updates: any[]) => any[],
    private hydrateSubagentsFromPayload: (
      parentMessageId: string,
      payload: SubagentUpdatePayload,
      sessionId: string,
    ) => any[],
    private resolveSubagentPayloadSessionId: (payload: {
      summariesByParentMessageId?: Record<string, unknown>;
      sessionId?: string;
      childSessionId?: string;
    }) => string | undefined,
  ) { }

  /**
   * Get storage key for subagent snapshot
   */
  getSubagentSnapshotStorageKey(sessionId: string): string {
    return `${SubagentPersistence.SUBAGENT_SNAPSHOT_PREFIX}${sessionId}`;
  }

  /**
   * Normalize subagent payload
   */
  normalizeSubagentPayload(
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

  /**
   * Merge subagent payloads
   */
  mergeSubagentPayloads(
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
    for (const parentMessageId of Array.from(parentMessageIds)) {
      const merged = this.mergeSubagentEntries(
        Array.isArray(existingSummaries[parentMessageId]) ? existingSummaries[parentMessageId] as any[] : [],
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
    for (const detailId of Array.from(detailIds)) {
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

  /**
   * Load persisted subagent snapshot
   */
  async loadPersistedSubagentSnapshot(
    sessionId: string,
  ): Promise<SubagentUpdatePayload | null> {
    const raw = this.workspaceState.get<unknown>(
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

  /**
   * Save persisted subagent snapshot
   */
  async savePersistedSubagentSnapshot(
    sessionId: string,
    payload: SubagentUpdatePayload,
  ): Promise<void> {
    await this.workspaceState.update(
      this.getSubagentSnapshotStorageKey(sessionId),
      payload,
    );
  }

  /**
   * Clear persisted subagent snapshot
   */
  async clearPersistedSubagentSnapshot(
    sessionId: string,
  ): Promise<void> {
    await this.workspaceState.update(
      this.getSubagentSnapshotStorageKey(sessionId),
      undefined,
    );
  }

  /**
   * Persist subagent live state
   */
  async persistSubagentLiveState(
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

  /**
   * Build subagent payload from message
   */
  buildSubagentPayloadFromMessage(
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
      if (!Array.isArray(normalized.conversationEvents)) {
        normalized.conversationEvents = [];
      }
      if (!Array.isArray(normalized.timelineEvents)) {
        normalized.timelineEvents = [];
      }

      // Log what provider/model data is available
      this.logger.info('[SUBAGENT][PERSIST] Extracting subagent from message', {
        id,
        hasProviderID: Boolean(normalized.providerID),
        hasModelID: Boolean(normalized.modelID),
        hasAgentId: Boolean(normalized.agentId),
        providerID: normalized.providerID,
        modelID: normalized.modelID,
        agentId: normalized.agentId,
        originalKeys: Object.keys(subagent),
      });

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

  /**
   * Persist subagent update snapshot
   */
  async persistSubagentUpdateSnapshot(
    payload: {
      summariesByParentMessageId?: Record<string, unknown>;
      detailsById?: Record<string, unknown>;
    },
    currentSessionId: string | undefined,
    sessionService: any,
    postMessage: (msg: any) => void,
  ): Promise<void> {
    const summariesMap = this.asRecord(payload.summariesByParentMessageId) || {};
    const parentMessageIds = Object.keys(summariesMap).filter(Boolean);
    if (parentMessageIds.length === 0) {
      return;
    }

    const sessionId =
      this.resolveSubagentPayloadSessionId(payload) || currentSessionId;
    if (!sessionId) {
      return;
    }

    const normalizedPayload = this.normalizeSubagentPayload(payload);
    await this.persistSubagentLiveState(sessionId, normalizedPayload);

    const cachedMessages = await sessionService.loadSessionMessages(
      sessionId,
    );
    if (!Array.isArray(cachedMessages) || cachedMessages.length === 0) {
      return;
    }

    let hasChanges = false;
    const nextMessages = cachedMessages.map((rawMessage: any) => {
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
        Array.isArray(message.subagents) ? message.subagents as any[] : [],
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

    await sessionService.saveSessionMessages(sessionId, nextMessages);
  }

  /**
   * Sync subagent snapshot for session
   */
  async syncSubagentSnapshotForSession(
    sessionId: string,
    messages: any[],
  ): Promise<SubagentUpdatePayload> {
    this.subagentTracker.resetForSession(sessionId);
    this.subagentTracker.seedFromMessages(messages);
    const trackerSnapshot = this.subagentTracker.getSnapshotPayload();
    const persistedSnapshot =
      await this.loadPersistedSubagentSnapshot(sessionId);
    const mergedSnapshot = persistedSnapshot
      ? this.mergeSubagentPayloads(persistedSnapshot, trackerSnapshot)
      : trackerSnapshot;
    // Note: postMessage callback will be set by the shell
    // this.view?.webview.postMessage({
    //   type: "subagentSnapshot",
    //   ...mergedSnapshot,
    // });
    await this.savePersistedSubagentSnapshot(sessionId, mergedSnapshot);
    return mergedSnapshot;
  }
}
