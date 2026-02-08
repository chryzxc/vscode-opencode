import * as vscode from 'vscode';
import { OpencodeServerManager } from './OpencodeServerManager';
import type { Session } from "@opencode-ai/sdk";

export type SessionMode = 'plan' | 'build';

export class SessionService {
  private currentSession: Session | null = null;
  private currentMode: SessionMode = "build";
  private sessionHistory: Session[] = [];
  private initializationPromise: Promise<void> | null = null;

  // Persistence keys
  private static readonly SESSIONS_KEY = "opencode.sessions";
  private static readonly MESSAGES_PREFIX = "opencode.session.messages.";
  private static readonly MODE_KEY = "opencode.currentMode";
  private static readonly SESSION_ID_KEY = "opencode.currentSessionId";

  /**
   * More flexible message type for local persistence and UI
   */
  public static readonly MESSAGE_FALLBACK_ID = "opencode.fallback";

  constructor(
    private context: vscode.ExtensionContext,
    private serverManager: OpencodeServerManager,
  ) {
    this.initializationPromise = this.loadPersistedState();
  }

  /**
   * Creates a new session
   */
  async createNewSession(title?: string): Promise<Session> {
    const client = await this.serverManager.ensureRunning();

    // Create the session
    const response = await client.session.create({
      body: {
        title: title || `Session ${new Date().toLocaleTimeString()}`,
      },
    });

    if (!response.data) {
      const errorDetails = JSON.stringify(response.error || {}, null, 2);
      console.error(
        `[SessionService] Failed to create session. Status: ${response.response.status}. Error: ${errorDetails}`,
      );
      const em = (response.error || {}) as {
        message?: string;
        errors?: Array<{ message?: string }>;
      };
      const msg =
        em?.message ||
        (Array.isArray(em?.errors) ? em.errors[0]?.message : undefined) ||
        "Unknown error";
      throw new Error(`Failed to create session: ${msg}`);
    }

    const session = response.data;
    this.currentSession = session;

    // Check if session already exists in history
    const exists = this.sessionHistory.find((s) => s.id === session.id);
    if (!exists) {
      this.sessionHistory.unshift(session);
    }

    this.persistState();

    return session;
  }

  /**
   * Gets the current active session, creating one if needed
   */
  async getCurrentSession(): Promise<Session> {
    // Wait for initialization to complete if it's running
    if (this.initializationPromise) {
      await this.initializationPromise;
    }

    if (this.currentSession) {
      return this.currentSession;
    }

    return this.createNewSession();
  }

  /**
   * Lists all sessions
   */
  async listSessions(): Promise<Session[]> {
    try {
      const client = await this.serverManager.ensureRunning();
      const response = await client.session.list();

      if (response.data) {
        // Merge server sessions with local history
        const serverSessions = response.data;
        const localSessions = this.sessionHistory;

        // Use a map to merge by ID, prioritizing server data but keeping local-only ones
        const mergedMap = new Map<string, Session>();
        localSessions.forEach((s) => mergedMap.set(s.id, s));
        serverSessions.forEach((s) => mergedMap.set(s.id, s));

        this.sessionHistory = Array.from(mergedMap.values()).sort((a, b) => {
          // Sort by creation time (descending)
          const timeA = a.time?.created || 0;
          const timeB = b.time?.created || 0;
          return timeB - timeA;
        });

        this.persistState();
      }
    } catch (error) {
      console.error(
        "[SessionService] Failed to fetch sessions from server:",
        error,
      );
      // Fallback to local history
    }

    return this.sessionHistory;
  }

  /**
   * Switches to a different session
   */
  async switchSession(sessionId: string): Promise<Session> {
    const client = await this.serverManager.ensureRunning();
    const response = await client.session.get({
      path: { id: sessionId },
    });

    if (!response.data) {
      throw new Error("Session not found");
    }

    this.currentSession = response.data;
    this.persistState();

    return response.data;
  }

  /**
   * Deletes a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const client = await this.serverManager.ensureRunning();
    await client.session.delete({
      path: { id: sessionId },
    });

    if (this.currentSession?.id === sessionId) {
      this.currentSession = null;
    }

    this.sessionHistory = this.sessionHistory.filter((s) => s.id !== sessionId);
    this.persistState();
  }

  /**
   * Gets messages for a session
   */
  async getMessages(sessionId: string): Promise<any[]> {
    console.log(`[SessionService] Fetching messages for session ${sessionId}`);

    try {
      const client = await this.serverManager.ensureRunning();
      const response = await client.session.messages({
        path: {
          id: sessionId,
        },
      });

      if (response.data && response.data.length > 0) {
        console.log(
          `[SessionService] Fetched ${response.data.length} messages from server`,
        );
        // Map to a flatter format for the UI and persistence
        const mappedMessages = response.data.map(
          (m: { info: unknown; parts: unknown[] }) => ({
            ...(m.info as Record<string, unknown>),
            parts: m.parts,
          }),
        );
        // Persist to local storage
        await this.saveSessionMessages(sessionId, mappedMessages);
        return mappedMessages;
      }
    } catch (error) {
      console.warn(
        `[SessionService] Error fetching messages from server:`,
        error,
      );
    }

    // Fallback to local storage
    const localMessages = await this.loadSessionMessages(sessionId);
    console.log(
      `[SessionService] Returning ${localMessages.length} local messages for ${sessionId}`,
    );
    return localMessages;
  }

  /**
   * Saves messages for a specific session to local storage
   */
  async saveSessionMessages(
    sessionId: string,
    messages: unknown[],
  ): Promise<void> {
    await this.context.workspaceState.update(
      `${SessionService.MESSAGES_PREFIX}${sessionId}`,
      messages,
    );
  }

  /**
   * Loads messages for a specific session from local storage
   */
  async loadSessionMessages(sessionId: string): Promise<unknown[]> {
    return (
      this.context.workspaceState.get<unknown[]>(
        `${SessionService.MESSAGES_PREFIX}${sessionId}`,
      ) || []
    );
  }

  /**
   * Adds a new message to the local history for a session
   */
  async appendMessage(sessionId: string, message: unknown): Promise<void> {
    const messages = await this.loadSessionMessages(sessionId);
    messages.push(message);
    await this.saveSessionMessages(sessionId, messages);
  }

  /**
   * Gets the current mode (plan/build)
   */
  getMode(): SessionMode {
    return this.currentMode;
  }

  /**
   * Sets the mode (plan/build)
   */
  setMode(mode: SessionMode): void {
    this.currentMode = mode;
    this.persistState();
  }

  /**
   * Toggles between plan and build mode
   */
  toggleMode(): SessionMode {
    this.currentMode = this.currentMode === "plan" ? "build" : "plan";
    this.persistState();
    return this.currentMode;
  }

  /**
   * Loads persisted state from workspace storage
   */
  private async loadPersistedState(): Promise<void> {
    const config = vscode.workspace.getConfiguration("opencode");
    if (!config.get("persistSessions", true)) {
      return;
    }

    // Load session list
    this.sessionHistory = this.context.workspaceState.get<Session[]>(
      SessionService.SESSIONS_KEY,
      [],
    );

    const sessionId = this.context.workspaceState.get<string>(
      SessionService.SESSION_ID_KEY,
    );
    const mode = this.context.workspaceState.get<SessionMode>(
      SessionService.MODE_KEY,
      "build",
    );

    this.currentMode = mode;

    if (sessionId) {
      try {
        await this.switchSession(sessionId);
      } catch (e) {
        console.log(
          "[SessionService] Session not found on server, keeping local stub:",
          sessionId,
        );
        // If not on server, find in history to keep it as "active" in UI
        const stub = this.sessionHistory.find((s) => s.id === sessionId);
        if (stub) {
          this.currentSession = stub;
        }
      }
    }
  }

  /**
   * Persists state to workspace storage
   */
  private persistState(): void {
    const config = vscode.workspace.getConfiguration("opencode");
    if (!config.get("persistSessions", true)) {
      return;
    }

    this.context.workspaceState.update(
      SessionService.SESSIONS_KEY,
      this.sessionHistory,
    );

    if (this.currentSession) {
      this.context.workspaceState.update(
        SessionService.SESSION_ID_KEY,
        this.currentSession.id,
      );
    }

    this.context.workspaceState.update(
      SessionService.MODE_KEY,
      this.currentMode,
    );
  }
}
