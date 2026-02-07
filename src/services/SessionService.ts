import * as vscode from 'vscode';
import { OpencodeServerManager } from './OpencodeServerManager';
import type { Session } from '@opencode-ai/sdk';

export type SessionMode = 'plan' | 'build';

export class SessionService {
  private currentSession: Session | null = null;
  private currentMode: SessionMode = 'build';
  private sessionHistory: Session[] = [];

  constructor(
    private context: vscode.ExtensionContext,
    private serverManager: OpencodeServerManager
  ) {
    this.loadPersistedState();
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
      throw new Error('Failed to create session');
    }

    const session = response.data;
    this.currentSession = session;
    this.sessionHistory.unshift(session);
    this.persistState();

    return session;
  }

  /**
   * Gets the current active session, creating one if needed
   */
  async getCurrentSession(): Promise<Session> {
    if (this.currentSession) {
      return this.currentSession;
    }

    return this.createNewSession();
  }

  /**
   * Lists all sessions
   */
  async listSessions(): Promise<Session[]> {
    const client = await this.serverManager.ensureRunning();
    const response = await client.session.list();
    
    if (response.data) {
      this.sessionHistory = response.data;
      this.persistState();
    }

    return response.data || [];
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
      throw new Error('Session not found');
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
    this.currentMode = this.currentMode === 'plan' ? 'build' : 'plan';
    this.persistState();
    return this.currentMode;
  }

  /**
   * Loads persisted state from workspace storage
   */
  private loadPersistedState(): void {
    const config = vscode.workspace.getConfiguration('opencode');
    if (!config.get('persistSessions', true)) {
      return;
    }

    const sessionId = this.context.workspaceState.get<string>('currentSessionId');
    const mode = this.context.workspaceState.get<SessionMode>('currentMode', 'build');
    
    this.currentMode = mode;

    // NOTE: We'll fetch the actual session object when needed
    // to avoid stale data
    if (sessionId) {
      this.switchSession(sessionId).catch(() => {
        // Session may no longer exist, that's okay
        this.currentSession = null;
      });
    }
  }

  /**
   * Persists state to workspace storage
   */
  private persistState(): void {
    const config = vscode.workspace.getConfiguration('opencode');
    if (!config.get('persistSessions', true)) {
      return;
    }

    if (this.currentSession) {
      this.context.workspaceState.update('currentSessionId', this.currentSession.id);
    }
    
    this.context.workspaceState.update('currentMode', this.currentMode);
  }
}
