/**
 * SessionHandler Module
 *
 * Session CRUD operations (load, delete, rename, create, get sessions list).
 *
 * Extracted from ChatViewProvider.ts (~250 lines)
 */

import type { SessionService } from "../../services/SessionService";
import type { HistoryProcessor } from "./HistoryProcessor";
import type { SubagentPersistence } from "./SubagentPersistence";
import type { CompactionManager } from "./CompactionManager";
import type { ModelAndAgentManager } from "./ModelAndAgentManager";

export class SessionHandler {
  private sessionsListRequestVersion = 0;
  private lastSessionsPayloadFingerprint = "";
  private processingSessionIds = new Set<string>();

  constructor(
    private sessionService: SessionService,
    private historyProcessor: HistoryProcessor,
    private subagentPersistence: SubagentPersistence,
    private compactionManager: CompactionManager,
    private modelAndAgentManager: ModelAndAgentManager,
    private logger: ReturnType<typeof import("../../utils/Logger").createLogger>,
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

      const centralizedSessionData = await this.sessionService.loadCentralizedSessionData(
        sessionId,
      );
      const rawSdkEventPayloads = centralizedSessionData.rawSdkEventPayloads;
      const rawMessages = await this.sessionService.getMessages(sessionId);
      const fallbackMessages = Array.isArray(rawMessages) ? rawMessages : [];
      const messages = await this.historyProcessor.processHistoryMessages(
        fallbackMessages,
        sessionId,
      );

      await this.subagentPersistence.syncSubagentSnapshotForSession(sessionId, messages);
      await this.modelAndAgentManager.applySessionSettings(sessionId);

      this.postMessage({
        type: "chatHistory",
        sessionId,
        messages,
        rawSdkEventPayloads,
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

  /**
   * Handle delete session request
   */
  async handleDeleteSession(sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }

    try {
      await this.sessionService.deleteSession(sessionId);
      await this.subagentPersistence.clearPersistedSubagentSnapshot(sessionId);
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
