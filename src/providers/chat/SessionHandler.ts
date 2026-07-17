/**
 * SessionHandler Module
 *
 * Session CRUD operations (load, delete, rename, create, get sessions list).
 *
 * Extracted from ChatViewProvider.ts (~250 lines)
 */

import type { SessionService } from "../../services/SessionService";
import { adaptSdkMessages } from "../../services/SdkMessageAdapter";
import type { SdkRenderedMessage } from "../../services/SdkMessageAdapter";
import type { SessionSnapshotLoader } from "../../services/SessionSnapshotLoader";
import type { CompactionManager } from "./CompactionManager";
import type { ModelAndAgentManager } from "./ModelAndAgentManager";

export class SessionHandler {
  private sessionsListRequestVersion = 0;
  private lastSessionsPayloadFingerprint = "";
  private processingSessionIds = new Set<string>();

  constructor(
    private sessionService: SessionService,
    private compactionManager: CompactionManager,
    private modelAndAgentManager: ModelAndAgentManager,
    private logger: ReturnType<typeof import("../../utils/Logger").createLogger>,
    private sessionSnapshotLoader: SessionSnapshotLoader,
  ) {
    this.postMessage = () => {};
    this.getCurrentSessionId = () => undefined;
    this.setCurrentSessionId = () => {};
  }

  private postMessage: (msg: any) => void;
  private getCurrentSessionId: () => string | undefined;
  private setCurrentSessionId: (id: string | undefined) => void;

  setPostMessage(fn: (msg: any) => void): void {
    this.postMessage = fn;
  }

  setGetCurrentSessionId(fn: () => string | undefined): void {
    this.getCurrentSessionId = fn;
  }

  setSetCurrentSessionId(fn: (id: string | undefined) => void): void {
    this.setCurrentSessionId = fn;
  }

  /**
   * Handle get sessions request
   */
  async handleGetSessions(): Promise<void> {
    this.sessionsListRequestVersion += 1;
    const currentVersion = this.sessionsListRequestVersion;

    try {
      const sessions = await this.sessionService.listSessions();
      const sessionIds = new Set(
        sessions
          .map((session: any) =>
            typeof session?.id === "string" ? session.id.trim() : "",
          )
          .filter((id: string) => id.length > 0),
      );
      const topLevelSessions = sessions.filter((session: any) => {
        const sessionId =
          typeof session?.id === "string" ? session.id.trim() : "";
        const parentSessionId =
          typeof session?.parentSessionId === "string" &&
          session.parentSessionId.trim().length > 0
            ? session.parentSessionId.trim()
            : typeof session?.parentID === "string" &&
              session.parentID.trim().length > 0
              ? session.parentID.trim()
              : "";
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
        parentSessionId:
          (typeof session.parentSessionId === "string" &&
          session.parentSessionId.trim().length > 0
            ? session.parentSessionId
            : typeof session.parentID === "string" &&
              session.parentID.trim().length > 0
              ? session.parentID
              : undefined),
      }));

      const fingerprint = JSON.stringify(sessionsPayload);
      if (fingerprint === this.lastSessionsPayloadFingerprint) {
        return;
      }
      this.lastSessionsPayloadFingerprint = fingerprint;

      if (currentVersion !== this.sessionsListRequestVersion) {
        return;
      }

      this.postMessage({
        type: "sessionsList",
        sessions: sessionsPayload,
      });
    } catch (error) {
      this.logger.error("Failed to get sessions", { error });
    }
  }

  /**
   * Send processing sessions update
   */
  sendProcessingSessionsUpdate(): void {
    this.postMessage({
      type: "sessionsListUpdate",
      processingSessionIds: Array.from(this.processingSessionIds),
    });
  }

  /**
   * Handle load session request
   */
  async handleLoadSession(message: { sessionId: string }): Promise<void> {
    const { sessionId } = message;
    if (!sessionId) {
      return;
    }

    if (this.processingSessionIds.has(sessionId)) {
      this.logger.warn("Session already loading", { sessionId });
      return;
    }

    this.processingSessionIds.add(sessionId);
    this.sendProcessingSessionsUpdate();

    try {
      // CRITICAL: Switch the active session in SessionService
      // This updates the service's internal state and persists it
      await this.sessionService.switchSession(sessionId);

      // SDK inspection mode: session.messages() is the only transcript source.
      // It returns the raw `{ info, parts }[]` OpenCode response. The adapter is
      // solely a display projection; no centralized event tape or local message
      // cache is read as a fallback.
      const sdkMessages = await this.sessionSnapshotLoader.loadMessagesOnly(sessionId);
      const messages = adaptSdkMessages(sdkMessages);

      await this.modelAndAgentManager.applySessionSettings(sessionId);

      this.postMessage({
        type: "chatHistory",
        sessionId,
        messages,
        sdkMessages,
      });
      await this.compactionManager.sendCompactionViewStateForMessages(
        sessionId,
        messages,
      );

      this.setCurrentSessionId(sessionId);
      this.logger.info("Session loaded", { sessionId, messageCount: messages.length });

    } catch (error) {
      this.logger.error("Failed to load session", { sessionId, error });
    } finally {
      this.processingSessionIds.delete(sessionId);
      this.sendProcessingSessionsUpdate();
    }
  }

  private async enrichSubagentsFromSdkChildren(sessionId: string, messages: any[]): Promise<any[]> {
    try {
      const snapshot = await this.sessionSnapshotLoader.loadSnapshot(sessionId);
      const childrenById = new Map<string, any>();
      for (const child of snapshot.children ?? []) {
        const childSession = child?.session;
        if (typeof childSession?.id === "string" && childSession.id.length > 0) {
          childrenById.set(childSession.id, childSession);
        }
      }

      if (childrenById.size === 0) {
        return messages;
      }

      const enrichedMessages = messages.map((loadedMessage) => ({
        ...loadedMessage,
        subagents: Array.isArray(loadedMessage?.subagents)
          ? [...loadedMessage.subagents]
          : [],
      }));
      const messagesById = new Map<string, any>();
      for (const loadedMessage of enrichedMessages) {
        const messageId = this.getMessageId(loadedMessage);
        if (messageId) {
          messagesById.set(messageId, loadedMessage);
        }
      }

      for (const sdkMessage of snapshot.messages ?? []) {
        const parts = Array.isArray(sdkMessage?.parts) ? sdkMessage.parts : [];
        for (const part of parts) {
          if (part?.type !== "subtask") {
            continue;
          }

          const childSessionId = typeof part.sessionID === "string" ? part.sessionID : undefined;
          if (!childSessionId) {
            continue;
          }

          const childSession = childrenById.get(childSessionId);
          if (!childSession) {
            continue;
          }

          const parentMessageId =
            (typeof part.messageID === "string" && part.messageID.length > 0 ? part.messageID : undefined) ??
            (typeof sdkMessage?.info?.id === "string" ? sdkMessage.info.id : undefined);
          const parentMessage = parentMessageId ? messagesById.get(parentMessageId) : undefined;
          if (!parentMessage || !parentMessageId) {
            continue;
          }

          const detail = this.buildSdkChildSubagentDetail({
            parentSessionId: sessionId,
            parentMessageId,
            part,
            childSession,
          });
          this.upsertSubagentDetail(parentMessage, detail);
        }
      }

      return enrichedMessages;
    } catch (error) {
      this.logger.warn("SDK subagent enrichment failed", { sessionId, error: String(error) });
      return messages;
    }
  }

  async loadChildSessionTranscript(childSessionId: string): Promise<SdkRenderedMessage[]> {
    const sdkMessages = await this.sessionSnapshotLoader.loadMessagesOnly(childSessionId);
    return adaptSdkMessages(sdkMessages);
  }

  private extractSubagentDetails(messages: any[]): any[] {
    const details: any[] = [];
    for (const message of messages) {
      if (Array.isArray(message?.subagents)) {
        details.push(...message.subagents);
      }
    }
    return details;
  }

  private buildSdkChildSubagentDetail(args: {
    parentSessionId: string;
    parentMessageId: string;
    part: any;
    childSession: any;
  }): any {
    const { parentSessionId, parentMessageId, part, childSession } = args;
    const childTime = childSession?.time ?? {};
    const partModel = part?.model ?? {};
    const childModel = childSession?.model ?? {};
    const title = this.optionalString(childSession?.title)
      ?? this.optionalString(part?.description)
      ?? this.optionalString(part?.prompt)
      ?? childSession.id;

    return {
      id: childSession.id,
      name: title,
      title,
      parentSessionId,
      parentMessageId,
      childSessionId: childSession.id,
      agentId: this.optionalString(part?.agent),
      agent: this.optionalString(part?.agent),
      providerID: this.optionalString(childModel?.providerID) ?? this.optionalString(partModel?.providerID),
      modelID: this.optionalString(childModel?.modelID) ?? this.optionalString(partModel?.modelID),
      model: childSession?.model ?? part?.model,
      status: this.deriveChildSessionStatus(childSession),
      latestActivity: this.optionalString(childSession?.summary) ?? title,
      tokens: childSession?.tokens,
      cost: childSession?.cost,
      summary: childSession?.summary,
      createdAt: this.optionalNumber(childTime?.created),
      updatedAt: this.optionalNumber(childTime?.updated),
      completedAt: this.optionalNumber(childTime?.completed),
      references: [{ messageID: parentMessageId, partID: part?.id }],
      thinkingEvents: [],
      progressEvents: [],
      timelineEvents: [],
    };
  }

  private upsertSubagentDetail(message: any, detail: any): void {
    const subagents = Array.isArray(message.subagents) ? message.subagents : [];
    const existingIndex = subagents.findIndex((existing: any) => {
      const existingChildSessionId = existing?.childSessionId ?? existing?.sessionID ?? existing?.id;
      return existingChildSessionId === detail.childSessionId;
    });
    if (existingIndex >= 0) {
      subagents[existingIndex] = { ...subagents[existingIndex], ...detail };
    } else {
      subagents.push(detail);
    }
    message.subagents = subagents;
  }

  private getMessageId(message: any): string | undefined {
    return this.optionalString(message?.id) ?? this.optionalString(message?.info?.id);
  }

  private deriveChildSessionStatus(childSession: any): string {
    const time = childSession?.time ?? {};
    if (typeof time.completed === "number") {
      return "completed";
    }
    if (typeof time.updated === "number" && time.updated > 0) {
      return "running";
    }
    return "pending";
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private optionalNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  /**
   * Handle delete session request
   */
  async handleDeleteSession(sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }

    try {
      await this.sessionService.deleteSession(sessionId);
      await this.compactionManager.clearPersistedCompactionViewState(sessionId);

      const currentSessionId = this.getCurrentSessionId();
      if (currentSessionId === sessionId) {
        this.setCurrentSessionId(undefined);
      }

      await this.handleGetSessions();
      this.logger.info("Session deleted", { sessionId });
    } catch (error) {
      this.logger.error("Failed to delete session", { sessionId, error });
    }
  }

  /**
   * Handle rename session request
   */
  async handleRenameSession(sessionId: string, newTitle: string): Promise<void> {
    if (!sessionId || !newTitle) {
      return;
    }

    try {
      await this.sessionService.renameSession(sessionId, newTitle);
      await this.handleGetSessions();
      this.logger.info("Session renamed", { sessionId, newTitle });
    } catch (error) {
      this.logger.error("Failed to rename session", { sessionId, error });
    }
  }
}
