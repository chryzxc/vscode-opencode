/**
 * Session Service - Session Management and Persistence
 *
 * Manages chat sessions with persistence and server synchronization.
 * This service implements a "best of both worlds" strategy by combining
 * server-side session data with local caching for offline access.
 *
 * **Architecture Overview:**
 * - Creates and deletes sessions via the OpenCode server
 * - Maintains local cache of session history
 * - Merges server and local data to prevent data loss
 * - Persists messages to workspace storage for offline access
 * - Manages current session state
 *
 * **Merge Strategy (Server + Local):**
 * The service combines data from two sources:
 * 1. **Server Sessions**: Sessions stored on the OpenCode server
 * 2. **Local History**: Sessions cached in VSCode workspace state
 *
 * **Merge Algorithm:**
 * ```
 * 1. Fetch sessions from server via API
 * 2. Load sessions from local workspace state
 * 3. Create a map using session ID as key
 * 4. Add all local sessions to map
 * 5. Add all server sessions to map (overwrites local if same ID)
 * 6. Convert map to array and sort by creation time (newest first)
 * ```
 *
 * **Conflict Resolution:**
 * - Same ID exists locally and server → Server version wins
 * - Only local exists → Kept (offline/local-only session)
 * - Only server exists → Added (new session from another device)
 *
 * **Persistence Layer:**
 * Uses VSCode's `workspaceState` for storage:
 * - `opencode.sessions`: Array of session metadata
 * - `opencode.session.messages.{id}`: Messages per session
 * - `opencode.currentSessionId`: Active session ID
 *
 * **State Initialization:**
 * - Loads persisted state asynchronously in constructor
 * - `getCurrentSession()` waits for initialization before returning
 * - Falls back to local-only session if server unavailable
 *
 *
 * @module SessionService
 * @see OpencodeServerManager for server client access
 * @see ChatViewProvider for session consumption
 */

import * as vscode from "vscode";
import { OpencodeServerManager } from "./OpencodeServerManager";
import type { Session } from "@opencode-ai/sdk";
import { createLogger } from "../utils/Logger";

const log = createLogger("SessionService");
const MAX_CACHED_MESSAGES_PER_SESSION = 200;
const MAX_CACHED_SESSION_BYTES = 4 * 1024 * 1024;
const MAX_PERSISTED_STRING_LENGTH = 120_000;
const MAX_PERSISTED_ARRAY_LENGTH = 256;
const MAX_PERSISTED_OBJECT_KEYS = 200;
const MAX_PERSISTED_DEPTH = 8;

function isDataUrl(value: string): boolean {
  return /^data:[^;]+;base64,/i.test(value);
}

function formatApproxBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}

function redactDataUrl(value: string): string {
  const commaIndex = value.indexOf(",");
  const header = commaIndex >= 0 ? value.slice(0, commaIndex) : "data:;base64";
  const base64 = commaIndex >= 0 ? value.slice(commaIndex + 1) : "";
  const approxBytes = Math.floor((base64.length * 3) / 4);
  return `[omitted data URL ${header}; ~${formatApproxBytes(approxBytes)}]`;
}

function truncateString(value: string): string {
  if (isDataUrl(value)) {
    return redactDataUrl(value);
  }

  if (value.length <= MAX_PERSISTED_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_PERSISTED_STRING_LENGTH)}...[truncated ${value.length - MAX_PERSISTED_STRING_LENGTH} chars]`;
}

function sanitizeForPersistence(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (value == null) return value;

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value === "string" ? truncateString(value) : value;
  }

  if (depth >= MAX_PERSISTED_DEPTH) {
    return "[omitted: max depth reached]";
  }

  if (Array.isArray(value)) {
    const limited = value.slice(0, MAX_PERSISTED_ARRAY_LENGTH);
    const sanitized = limited.map((item) =>
      sanitizeForPersistence(item, depth + 1, seen),
    );
    if (value.length > limited.length) {
      sanitized.push(`[omitted ${value.length - limited.length} items]`);
    }
    return sanitized;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) {
      return "[omitted: circular reference]";
    }
    seen.add(obj);

    const result: Record<string, unknown> = {};
    const entries = Object.entries(obj).slice(0, MAX_PERSISTED_OBJECT_KEYS);
    for (const [key, nested] of entries) {
      result[key] = sanitizeForPersistence(nested, depth + 1, seen);
    }
    if (Object.keys(obj).length > entries.length) {
      result.__truncatedKeys = Object.keys(obj).length - entries.length;
    }
    return result;
  }

  return String(value);
}

function estimateSerializedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function compactMessageForPersistence(message: unknown): unknown {
  if (!message || typeof message !== "object") {
    return sanitizeForPersistence(message);
  }

  const rec = message as Record<string, unknown>;
  const compact: Record<string, unknown> = {};

  if (typeof rec.role === "string") compact.role = rec.role;
  if (typeof rec.content === "string") compact.content = truncateString(rec.content);
  if (typeof rec.text === "string") compact.text = truncateString(rec.text);
  if (rec.time) compact.time = sanitizeForPersistence(rec.time);
  if (rec.info) compact.info = sanitizeForPersistence(rec.info);

  if (Array.isArray(rec.parts)) {
    compact.parts = (rec.parts as unknown[])
      .slice(0, 16)
      .map((part) => sanitizeForPersistence(part));
  }

  if (Array.isArray(rec.edits)) {
    compact.edits = (rec.edits as unknown[]).slice(0, 32).map((edit) => {
      const editRec =
        edit && typeof edit === "object"
          ? (edit as Record<string, unknown>)
          : null;
      if (editRec?.file && typeof editRec.file === "string") {
        return { file: editRec.file };
      }
      return sanitizeForPersistence(edit);
    });
  }

  if (Array.isArray(rec.images)) {
    compact.images = (rec.images as unknown[]).map((img) =>
      typeof img === "string" ? redactDataUrl(img) : sanitizeForPersistence(img),
    );
  }

  if (Object.keys(compact).length === 0) {
    return sanitizeForPersistence(message);
  }

  return compact;
}

function normalizeSessionId(id: unknown): string | null {
  if (typeof id !== "string") {
    return null;
  }

  const normalized = id.trim();
  return normalized.length > 0 ? normalized : null;
}

function getSessionCreatedTime(session: Session | null | undefined): number {
  const created = session?.time?.created;
  return typeof created === "number" && Number.isFinite(created) ? created : 0;
}

function mergeSessionRecords(existing: Session, incoming: Session): Session {
  const existingCreated = getSessionCreatedTime(existing);
  const incomingCreated = getSessionCreatedTime(incoming);
  const preferred = incomingCreated >= existingCreated ? incoming : existing;
  const fallback = preferred === incoming ? existing : incoming;

  return {
    ...fallback,
    ...preferred,
    id: preferred.id || fallback.id,
    title: preferred.title || fallback.title,
    time: preferred.time ?? fallback.time,
  };
}

function getMessageCreatedTime(message: unknown): number {
  if (!message || typeof message !== "object") {
    return 0;
  }

  const rec = message as Record<string, unknown>;
  const messageTime = rec.time;
  if (messageTime && typeof messageTime === "object") {
    const created = (messageTime as Record<string, unknown>).created;
    if (typeof created === "number" && Number.isFinite(created)) {
      return created;
    }
  }

  const info = rec.info;
  if (info && typeof info === "object") {
    const infoTime = (info as Record<string, unknown>).time;
    if (infoTime && typeof infoTime === "object") {
      const created = (infoTime as Record<string, unknown>).created;
      if (typeof created === "number" && Number.isFinite(created)) {
        return created;
      }
    }
  }

  return 0;
}

function getMessageSignature(message: unknown): string {
  if (!message || typeof message !== "object") {
    return `primitive:${String(message)}`;
  }

  const rec = message as Record<string, unknown>;
  const info = rec.info;
  if (info && typeof info === "object") {
    const infoId = (info as Record<string, unknown>).id;
    if (typeof infoId === "string" && infoId.length > 0) {
      return `id:${infoId}`;
    }
  }

  const rootId = rec.id;
  if (typeof rootId === "string" && rootId.length > 0) {
    return `id:${rootId}`;
  }

  const role = typeof rec.role === "string" ? rec.role : "";
  const content =
    typeof rec.content === "string" ? rec.content.slice(0, 200) : "";
  const text = typeof rec.text === "string" ? rec.text.slice(0, 200) : "";
  const created = getMessageCreatedTime(message);
  return `fallback:${role}|${created}|${content}|${text}`;
}

function mergeConversationMessages(messageGroups: unknown[][]): unknown[] {
  const flattened: Array<{ message: unknown; created: number; order: number }> =
    [];
  let order = 0;

  for (const group of messageGroups) {
    for (const message of group) {
      flattened.push({
        message,
        created: getMessageCreatedTime(message),
        order: order++,
      });
    }
  }

  flattened.sort((a, b) =>
    a.created === b.created ? a.order - b.order : a.created - b.created,
  );

  const merged: unknown[] = [];
  const seen = new Set<string>();
  for (const item of flattened) {
    const signature = getMessageSignature(item.message);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    merged.push(item.message);
  }

  return merged;
}

function hasSessionAliasConflicts(
  aliasesByCanonicalId: Map<string, string[]>,
): boolean {
  for (const [canonicalId, aliases] of aliasesByCanonicalId.entries()) {
    if (aliases.some((alias) => alias !== canonicalId)) {
      return true;
    }
  }
  return false;
}

function coalesceSessionsById(sessions: Session[]): {
  sessions: Session[];
  aliasesByCanonicalId: Map<string, string[]>;
  hadChanges: boolean;
} {
  const byCanonicalId = new Map<string, Session>();
  const aliasSets = new Map<string, Set<string>>();
  let hadChanges = false;

  for (const session of sessions) {
    const rawId = typeof session?.id === "string" ? session.id : "";
    const canonicalId = normalizeSessionId(rawId);
    if (!canonicalId) {
      hadChanges = true;
      continue;
    }

    const aliases = aliasSets.get(canonicalId) ?? new Set<string>();
    aliases.add(canonicalId);
    if (rawId) {
      aliases.add(rawId);
    }
    aliasSets.set(canonicalId, aliases);

    const normalizedSession =
      canonicalId === rawId ? session : { ...session, id: canonicalId };
    if (canonicalId !== rawId) {
      hadChanges = true;
    }

    const existing = byCanonicalId.get(canonicalId);
    if (!existing) {
      byCanonicalId.set(canonicalId, normalizedSession);
      continue;
    }

    byCanonicalId.set(
      canonicalId,
      mergeSessionRecords(existing, normalizedSession),
    );
    hadChanges = true;
  }

  const dedupedSessions = Array.from(byCanonicalId.values()).sort((a, b) => {
    return getSessionCreatedTime(b) - getSessionCreatedTime(a);
  });

  if (dedupedSessions.length !== sessions.length) {
    hadChanges = true;
  }

  const aliasesByCanonicalId = new Map<string, string[]>();
  for (const [canonicalId, aliasSet] of aliasSets.entries()) {
    aliasesByCanonicalId.set(canonicalId, Array.from(aliasSet));
  }

  return {
    sessions: dedupedSessions,
    aliasesByCanonicalId,
    hadChanges,
  };
}

/**
 * Manages chat sessions with persistence and server synchronization.
 *
 * This service provides:
 * - Session CRUD operations (create, read, update, delete)
 * - Message persistence with server fallback
 * - Server-local merge strategy for data resilience
 * - State restoration across VSCode restarts
 *
 * **Usage Pattern:**
 * ```typescript
 * const service = new SessionService(context, serverManager);
 *
 * // Get or create current session (auto-creates if needed)
 * const session = await service.getCurrentSession();
 *
 * // List all sessions (merged from server + local)
 * const sessions = await service.listSessions();
 *
 * // Switch to a different session
 * await service.switchSession(otherSessionId);
 *
 * // Switch to a different session
 * await service.switchSession(otherSessionId);
 * ```
 *
 * **Persistence Configuration:**
 * Session persistence can be disabled via settings:
 * ```json
 * {
 *   "opencode.persistSessions": false
 * }
 * ```
 *
 * **Thread Safety:**
 * This class is not thread-safe. All methods should be called from the
 * main VSCode extension host thread.
 *
 * **Storage Keys:**
 * All keys use the "opencode." prefix to avoid collisions with other extensions.
 * Message keys use dynamic suffix based on session ID.
 */
export class SessionService {
  /** Currently active session (null if none selected) */
  private currentSession: Session | null = null;

  /** In-memory cache of session history (merged from server + local) */
  private sessionHistory: Session[] = [];

  /** Promise that resolves when initialization completes */
  private initializationPromise: Promise<void> | null = null;

  // ============================================================================
  // PERSISTENCE KEYS
  // ============================================================================
  // These keys are used for VSCode workspaceState storage.
  // All keys use "opencode." prefix to avoid collisions.

  /** Key for storing session list array */
  private static readonly SESSIONS_KEY = "opencode.sessions";

  /** Prefix for storing messages per session (appended with session ID) */
  private static readonly MESSAGES_PREFIX = "opencode.session.messages.";

  /** Key for storing current session ID */
  private static readonly SESSION_ID_KEY = "opencode.currentSessionId";

  /**
   * Fallback ID for messages without a session.
   *
   * Used when messages need to be stored but no session context exists.
   * This is rare and typically indicates an edge case during initialization.
   */
  public static readonly MESSAGE_FALLBACK_ID = "opencode.fallback";

  /**
   * Creates a new session service instance.
   *
   * **Initialization Behavior:**
   * - Constructor starts asynchronous state loading
   * - `getCurrentSession()` waits for initialization before returning
   * - This prevents race conditions during extension startup
   *
   * **State Loading:**
   * - Loads session history from workspace state
   * - Restores current session ID
   * - Tries to reconnect to server for current session
   *
   * **Lazy Initialization:**
   * Server connection is NOT established in constructor.
   * It's established on-demand when methods call `ensureRunning()`.
   *
   * @param context - VSCode extension context for workspace storage access
   * @param serverManager - Server manager for creating server client
   */
  constructor(
    private context: vscode.ExtensionContext,
    private serverManager: OpencodeServerManager,
  ) {
    // Start loading persisted state asynchronously
    // This ensures state is ready before we need it
    this.initializationPromise = this.loadPersistedState();
  }

  /**
   * Creates a new session on the server.
   *
   * **Creation Flow:**
   * 1. Ensures server is running
   * 2. Calls server API to create session with provided title
   * 3. Updates current session reference
   * 4. Adds to local history (if not duplicate)
   * 5. Persists state to workspace storage
   *
   * **Title Generation:**
   * - If title provided: Uses provided title
   * - If no title: Generates timestamp-based title
   * - Format: "Session HH:MM:SS" based on local time
   *
   * **Error Handling:**
   * - Throws if server returns error response
   * - Extracts error message from response (handles multiple formats)
   * - Logs detailed error for debugging
   *
   * **Duplicate Handling:**
   * If session with same ID already exists in history, doesn't add duplicate.
   * This can happen if server returns session we already know about.
   *
   * @param title - Optional title for the session (auto-generated if omitted)
   * @returns Promise resolving to the created session
   * @throws {Error} If server fails to create session
   *
   * @example
   * ```typescript
   * const session = await service.createNewSession("My Planning Session");
   * console.log('Created session:', session.id);
   * ```
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
      log.error("Failed to create session", {
        status: response.response.status,
        error: response.error,
      });
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
    const exists = this.sessionHistory.some((s) => s.id === session.id);
    if (!exists) {
      this.sessionHistory.unshift(session);
    }

    log.sessionEvent("create", session.id, {
      title: session.title,
      isNewSession: !exists,
    });

    this.persistState();
    return session;
  }

  /**
   * Gets the current active session, creating one if needed.
   *
   * This is the primary method for accessing the current session.
   * It implements the "ensure exists" pattern for convenience.
   *
   * **Behavior:**
   * 1. Waits for initialization to complete (if still loading)
   * 2. Returns current session if exists
   * 3. Creates new session if none exists
   *
   * **Initialization Wait:**
   * The constructor loads state asynchronously. This method waits
   * for that to complete before checking for a current session.
   * This prevents returning a stale session during startup.
   *
   * **Auto-Creation:**
   * If no current session exists (first launch or all deleted),
   * automatically creates a new session. This provides a better
   * user experience than requiring manual session creation.
   *
   * @returns Promise resolving to the current (or newly created) session
   *
   * @example
   * ```typescript
   * // Always returns a valid session
   * const session = await service.getCurrentSession();
   * await service.sendMessage(session.id, "Hello!");
   * ```
   *
   * @see createNewSession for session creation logic
   * @see initializationPromise for async initialization
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
   * Lists all sessions with server-local merge strategy.
   *
   * This is a key method that implements the merge algorithm for combining
   * server and local session data. This ensures no data loss when working
   * offline or across multiple devices.
   *
   * **Merge Algorithm:**
   * ```
   * Step 1: Fetch sessions from server via API
   * Step 2: Load sessions from local workspace state
   * Step 3: Create a map using session ID as key
   * Step 4: Add all local sessions to map
   * Step 5: Add all server sessions to map (overwrites local if same ID)
   * Step 6: Convert map to array and sort by creation time (newest first)
   * Step 7: Update in-memory cache and persist
   * ```
   *
   * **Conflict Resolution:**
   * - Same ID exists locally and server → Server version wins (most recent)
   * - Only local exists → Kept (offline/local-only session)
   * - Only server exists → Added (new session from another device)
   *
   * **Sorting:**
   * Sessions are sorted by creation time (descending) so newest
   * sessions appear first in the UI.
   *
   * **Error Handling:**
   * - If server fetch fails: Falls back to local-only sessions
   * - Errors are logged but don't throw (graceful degradation)
   * - Returns whatever data is available
   *
   * **Data Flow:**
   * Server → Merge with Local → Sort → Update Cache → Persist → Return
   *
   * @returns Promise resolving to sorted array of all sessions (server + local)
   *
   * @example
   * ```typescript
   * const sessions = await service.listSessions();
   * // Returns merged list from server + local storage
   * console.log(`Found ${sessions.length} sessions`);
   * ```
   *
   * @see switchSession for loading a specific session
   * @see persistState for how data is saved
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
        localSessions.forEach((s) => {
          mergedMap.set(s.id, s);
        });
        serverSessions.forEach((s) => {
          mergedMap.set(s.id, s);
        });

        const mergedSessions = Array.from(mergedMap.values());
        const normalized = coalesceSessionsById(mergedSessions);
        if (hasSessionAliasConflicts(normalized.aliasesByCanonicalId)) {
          await this.mergeMessagesForSessionAliases(
            normalized.aliasesByCanonicalId,
          );
        }

        this.sessionHistory = normalized.sessions;

        this.persistState();
      }
    } catch (error) {
      console.error(
        "[SessionService] Failed to fetch sessions from server:",
        error,
      );
      // Fallback to local history
      const normalizedLocal = coalesceSessionsById(this.sessionHistory);
      if (hasSessionAliasConflicts(normalizedLocal.aliasesByCanonicalId)) {
        await this.mergeMessagesForSessionAliases(
          normalizedLocal.aliasesByCanonicalId,
        );
      }
      if (normalizedLocal.hadChanges) {
        this.sessionHistory = normalizedLocal.sessions;
        this.persistState();
      }
    }

    return this.sessionHistory;
  }

  /**
   * Switches to a different session by ID.
   *
   * Fetches the session from the server and sets it as the current session.
   * This is used when the user selects a different session from the history.
   *
   * **Behavior:**
   * 1. Fetches session from server by ID
   * 2. Updates current session reference
   * 3. Persists current session ID to workspace state
   *
   * **Error Handling:**
   * - Throws if session not found on server
   * - Use try-catch when calling this method
   *
   * @param sessionId - The ID of the session to switch to
   * @returns Promise resolving to the loaded session
   * @throws {Error} If session not found on server
   *
   * @example
   * ```typescript
   * try {
   *   const session = await service.switchSession('session-123');
   *   console.log('Switched to:', session.title);
   * } catch (e) {
   *   console.error('Session not found');
   * }
   * ```
   */
  async switchSession(sessionId: string): Promise<Session> {
    try {
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
    } catch (error) {
      const localSession = this.sessionHistory.find((s) => s.id === sessionId);
      if (!localSession) {
        throw error;
      }

      this.currentSession = localSession;
      this.persistState();
      return localSession;
    }
  }

  /**
   * Deletes a session from the server and local cache.
   *
   * **Behavior:**
   * 1. Calls server API to delete session
   * 2. Clears current session reference if deleting active session
   * 3. Removes session from local history
   * 4. Persists updated state
   *
   * **Note:**
   * Cached local messages are also removed from workspace storage
   * to prevent orphaned data from consuming disk space.
   *
   * **State Update:**
   * If deleting the current session, `currentSession` becomes null.
   * Next call to `getCurrentSession()` will create a new session.
   *
   * @param sessionId - The ID of the session to delete
   * @returns Promise that resolves when deletion is complete
   *
   * @example
   * ```typescript
   * await service.deleteSession('session-123');
   * // Session is now deleted from server and local cache
   * ```
   */
  async deleteSession(sessionId: string): Promise<void> {
    try {
      const client = await this.serverManager.ensureRunning();
      await client.session.delete({
        path: { id: sessionId },
      });
    } catch (error) {
      // Log but continue with local cleanup even if server deletion fails
      // This can happen if the session was already deleted on the server
      console.warn(
        `[SessionService] Server delete failed for session ${sessionId}, continuing with local cleanup:`,
        error,
      );
    }

    if (this.currentSession?.id === sessionId) {
      this.currentSession = null;
    }

    this.sessionHistory = this.sessionHistory.filter((s) => s.id !== sessionId);
    await this.context.workspaceState.update(
      `${SessionService.MESSAGES_PREFIX}${sessionId}`,
      undefined,
    );
    this.persistState();
  }

  /**
   * Renames a session by updating its title.
   *
   * **Behavior:**
   * 1. Calls server API to update session title
   * 2. Updates the session in local history
   * 3. Updates current session reference if renaming active session
   * 4. Persists updated state to workspace storage
   *
   * **Error Handling:**
   * - Throws if server returns error response
   * - Updates local state even if server update fails (optimistic update)
   *
   * @param sessionId - The ID of the session to rename
   * @param newTitle - The new title for the session
   * @returns Promise resolving to the updated session
   * @throws {Error} If server fails to update session
   *
   * @example
   * ```typescript
   * const session = await service.renameSession('session-123', 'My New Title');
   * console.log('Renamed session:', session.title);
   * ```
   */
  async renameSession(sessionId: string, newTitle: string): Promise<Session> {
    try {
      const client = await this.serverManager.ensureRunning();
      const response = await client.session.update({
        path: { id: sessionId },
        body: { title: newTitle },
      });

      if (!response.data) {
        const errorDetails = JSON.stringify(response.error || {}, null, 2);
        log.error("Failed to rename session", {
          sessionId,
          newTitle,
          status: response.response.status,
          error: response.error,
        });
        const em = (response.error || {}) as {
          message?: string;
          errors?: Array<{ message?: string }>;
        };
        const msg =
          em?.message ||
          (Array.isArray(em?.errors) ? em.errors[0]?.message : undefined) ||
          "Unknown error";
        throw new Error(`Failed to rename session: ${msg}`);
      }

      const updatedSession = response.data;

      // Update in session history
      const index = this.sessionHistory.findIndex((s) => s.id === sessionId);
      if (index !== -1) {
        this.sessionHistory[index] = updatedSession;
      }

      // Update current session if it's the one being renamed
      if (this.currentSession?.id === sessionId) {
        this.currentSession = updatedSession;
      }

      log.sessionEvent("rename", sessionId, {
        newTitle: updatedSession.title,
      });

      this.persistState();
      return updatedSession;
    } catch (error) {
      // If server update fails, still update local state (optimistic update)
      log.warn(`Server rename failed for session ${sessionId}, updating local state only:`, error);

      const localSession = this.sessionHistory.find((s) => s.id === sessionId);
      if (localSession) {
        localSession.title = newTitle;

        if (this.currentSession?.id === sessionId) {
          this.currentSession.title = newTitle;
        }

        this.persistState();
        return localSession;
      }

      throw error;
    }
  }

  /**
   * Gets messages for a session, with server fallback to local storage.
   *
   * **Retrieval Strategy:**
   * 1. Try fetching from server first (most up-to-date)
   * 2. If server succeeds: Map to flat format, persist locally, return
   * 3. If server fails: Fall back to local storage
   * 4. Return whatever data is available
   *
   * **Message Format Mapping:**
   * Server returns nested format: `{ info: {...}, parts: [...] }`
   * We flatten it: `{ ...info, parts: [...] }`
   * This makes it easier to work with in the UI.
   *
   * **Offline Support:**
   * If server is unreachable, returns cached local messages.
   * This allows viewing chat history without network connection.
   *
   * **Local Storage:**
   * Messages are cached to workspace state for offline access.
   * Key format: `opencode.session.messages.{sessionId}`
   *
   * @param sessionId - The ID of the session to fetch messages for
   * @returns Promise resolving to array of messages (server or cached)
   *
   * @example
   * ```typescript
   * const messages = await service.getMessages('session-123');
   * console.log(`Found ${messages.length} messages`);
   * ```
   *
   * @see saveSessionMessages for persistence
   * @see loadSessionMessages for loading cached messages
   */
  async getMessages(sessionId: string): Promise<unknown[]> {
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
        // Keep the nested info structure from server for proper type compatibility
        // Server returns: { info: {...}, parts: [...] } which matches Message interface
        await this.saveSessionMessages(sessionId, response.data);
        return response.data;
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
   * Saves messages for a specific session to local workspace storage.
   *
   * **Storage Key Format:**
   * `opencode.session.messages.{sessionId}`
   *
   * **Usage:**
   * Called automatically after fetching messages from server.
   * Can also be called manually to cache new messages.
   *
   * **Persistence:**
   * Stored in VSCode workspaceState, which persists across
   * VSCode restarts but is specific to the workspace.
   *
   * @param sessionId - The ID of the session
   * @param messages - Array of messages to persist
   *
   * @example
   * ```typescript
   * await service.saveSessionMessages('session-123', messages);
   * // Messages are now cached locally
   * ```
   *
   * @see loadSessionMessages for retrieval
   */
  async saveSessionMessages(
    sessionId: string,
    messages: unknown[],
  ): Promise<void> {
    let wasCompacted = false;
    let persisted = messages.map((message) => sanitizeForPersistence(message));

    if (persisted.length > MAX_CACHED_MESSAGES_PER_SESSION) {
      wasCompacted = true;
      persisted = persisted.slice(-MAX_CACHED_MESSAGES_PER_SESSION);
    }

    let estimatedSize = estimateSerializedBytes(persisted);
    if (estimatedSize > MAX_CACHED_SESSION_BYTES) {
      // Keep recent messages first when trimming for storage pressure.
      while (
        persisted.length > 1 &&
        estimatedSize > MAX_CACHED_SESSION_BYTES
      ) {
        wasCompacted = true;
        const trimCount = Math.max(1, Math.ceil(persisted.length * 0.1));
        persisted = persisted.slice(trimCount);
        estimatedSize = estimateSerializedBytes(persisted);
      }
    }

    if (estimatedSize > MAX_CACHED_SESSION_BYTES) {
      wasCompacted = true;
      persisted = persisted.map((message) => compactMessageForPersistence(message));
      estimatedSize = estimateSerializedBytes(persisted);
    }

    if (estimatedSize > MAX_CACHED_SESSION_BYTES) {
      while (
        persisted.length > 1 &&
        estimatedSize > MAX_CACHED_SESSION_BYTES
      ) {
        wasCompacted = true;
        persisted = persisted.slice(1);
        estimatedSize = estimateSerializedBytes(persisted);
      }
    }

    if (wasCompacted) {
      console.warn(
        `[SessionService] Cached messages for ${sessionId} were compacted to ${persisted.length} items (${Math.round(estimatedSize / 1024)}KB)`,
      );
    }

    await this.context.workspaceState.update(
      `${SessionService.MESSAGES_PREFIX}${sessionId}`,
      persisted,
    );
  }

  /**
   * Loads messages for a specific session from local storage.
   *
   * **Fallback Behavior:**
   * Returns empty array if no messages are cached.
   * This is used by `getMessages()` when server is unavailable.
   *
   * **Storage Key Format:**
   * `opencode.session.messages.{sessionId}`
   *
   * @param sessionId - The ID of the session to load messages for
   * @returns Promise resolving to array of cached messages (empty if none)
   *
   * @example
   * ```typescript
   * const messages = await service.loadSessionMessages('session-123');
   * console.log(`Found ${messages.length} cached messages`);
   * ```
   *
   * @see saveSessionMessages for persistence
   * @see getMessages for server-fetching with fallback
   */
  async loadSessionMessages(sessionId: string): Promise<unknown[]> {
    const value = this.context.workspaceState.get<unknown[]>(
      `${SessionService.MESSAGES_PREFIX}${sessionId}`,
    );
    return Array.isArray(value) ? value : [];
  }

  /**
   * Appends a new message to the local message history for a session.
   *
   * **Use Case:**
   * Called when a new message is sent or received.
   * Adds the message to the existing cached messages.
   *
   * **Performance:**
   * Loads all messages, appends one, saves all back.
   * Not optimal for large histories, but sufficient for typical usage.
   *
   * **Note:**
   * This only updates local cache. Server has its own storage.
   * The local cache is used for offline access and quick loading.
   *
   * @param sessionId - The ID of the session
   * @param message - The message object to append
   *
   * @example
   * ```typescript
   * await service.appendMessage('session-123', {
   *   role: 'user',
   *   content: 'Hello!'
   * });
   * ```
   */
  async appendMessage(sessionId: string, message: unknown): Promise<void> {
    const messages = await this.loadSessionMessages(sessionId);
    messages.push(message);
    await this.saveSessionMessages(sessionId, messages);
  }

  private async mergeMessagesForSessionAliases(
    aliasesByCanonicalId: Map<string, string[]>,
  ): Promise<void> {
    for (const [canonicalId, aliases] of aliasesByCanonicalId.entries()) {
      const normalizedCanonicalId = normalizeSessionId(canonicalId);
      if (!normalizedCanonicalId) {
        continue;
      }

      const uniqueAliases = Array.from(
        new Set(
          aliases.filter(
            (alias): alias is string =>
              typeof alias === "string" && alias.length > 0,
          ),
        ),
      );

      if (!uniqueAliases.includes(normalizedCanonicalId)) {
        uniqueAliases.push(normalizedCanonicalId);
      }

      if (uniqueAliases.every((alias) => alias === normalizedCanonicalId)) {
        continue;
      }

      const messageGroups: unknown[][] = [];
      for (const alias of uniqueAliases) {
        const cached = await this.loadSessionMessages(alias);
        if (cached.length > 0) {
          messageGroups.push(cached);
        }
      }

      if (messageGroups.length > 0) {
        const merged = mergeConversationMessages(messageGroups);
        await this.saveSessionMessages(normalizedCanonicalId, merged);
      }

      for (const alias of uniqueAliases) {
        if (alias === normalizedCanonicalId) {
          continue;
        }
        await this.context.workspaceState.update(
          `${SessionService.MESSAGES_PREFIX}${alias}`,
          undefined,
        );
      }
    }
  }

  /**
   * Loads persisted state from workspace storage.
   *
   * This method is called asynchronously in the constructor to restore
   * the extension state from the previous VSCode session.
   *
   ** What Gets Restored:**
   * - Session history list
   * - Current session ID
   * - Selected model
   *
   * **Configuration Check:**
   * If `opencode.persistSessions` is false, returns immediately
   * without loading anything (fresh start).
   *
   * **Session Restoration:**
   * If a current session ID was saved, tries to reconnect to it
   * on the server. If the session no longer exists on the server,
   * falls back to the local stub from history.
   *
   * **Initialization Pattern:**
   * This runs asynchronously in the constructor. Other methods
   * wait for `initializationPromise` before accessing state.
   *
   * @private
   *
   * @see persistState for the corresponding save method
   */
  private async loadPersistedState(): Promise<void> {
    const config = vscode.workspace.getConfiguration("opencode");
    if (!config.get("persistSessions", true)) {
      return;
    }

    // Load and normalize session list
    const persistedSessions = this.context.workspaceState.get<Session[]>(
      SessionService.SESSIONS_KEY,
      [],
    );
    const normalizedSessions = coalesceSessionsById(persistedSessions);
    this.sessionHistory = normalizedSessions.sessions;

    if (hasSessionAliasConflicts(normalizedSessions.aliasesByCanonicalId)) {
      await this.mergeMessagesForSessionAliases(
        normalizedSessions.aliasesByCanonicalId,
      );
    }

    if (normalizedSessions.hadChanges) {
      this.persistState();
    }

    const persistedSessionId = this.context.workspaceState.get<string>(
      SessionService.SESSION_ID_KEY,
    );
    const sessionId = normalizeSessionId(persistedSessionId);

    if (sessionId && persistedSessionId !== sessionId) {
      await this.context.workspaceState.update(
        SessionService.SESSION_ID_KEY,
        sessionId,
      );
    }

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
   * Persists current state to workspace storage.
   *
   * This method is called automatically whenever state changes to ensure
   * data survives VSCode restarts.
   *
   ** What Gets Persisted:**
   * - Session history list (all sessions)
   * - Current session ID (for restoration on restart)
   * - Selected model
   *
   * **Configuration Check:**
   * If `opencode.persistSessions` is false, returns immediately
   * without saving (state is not persisted).
   *
   * **Storage Locations:**
   * - `opencode.sessions`: Session history array
   * - `opencode.currentSessionId`: Active session ID
   *
   * **When Called:**
   * - After creating a new session
   * - After switching sessions
   * - After deleting a session
   * - After listing sessions from server
   *
   * **Storage Scope:**
   * Uses VSCode's `workspaceState` which is specific to each
   * workspace. Different workspaces have separate session histories.
   *
   * @private
   *
   * @see loadPersistedState for the corresponding load method
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
  }
}
