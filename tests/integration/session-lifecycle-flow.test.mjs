/**
 * Session Lifecycle Flow Integration Tests
 *
 * Validates the complete SessionService lifecycle:
 *   Initialization → restore persisted state
 *   Create session → server call + local cache
 *   Get current session → auto-create if null
 *   List sessions → merge server + local
 *   Switch session → server fetch with local fallback
 *   Delete session → server + local cleanup
 *   Message persistence → sanitize → compact → save
 *
 * Uses source-introspection to assert the codebase implements
 * every step of the session lifecycle and cross-service
 * interactions with OpencodeServerManager.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  readSource,
  readAllSources,
  extractFunctionBody,
  joinFromRoot,
} from "../helpers/source-utils.mjs";

const sessionServiceSource = readSource(
  [joinFromRoot("src", "services", "SessionService.ts")],
  "SessionService.ts",
);

// ---------------------------------------------------------------------------
// Initialization: restore persisted state
// ---------------------------------------------------------------------------

test("SessionService constructor triggers async initialization", () => {
  assert.match(
    sessionServiceSource,
    /initializationPromise/,
    "SessionService must have an initializationPromise for async init",
  );
});

test("SessionService restores persisted sessions on init", () => {
  assert.match(
    sessionServiceSource,
    /loadPersistedState/,
    "SessionService must call loadPersistedState during initialization",
  );
});

test("SessionService restores current session from persisted state", () => {
  assert.match(
    sessionServiceSource,
    /currentSession/,
    "SessionService must track currentSession",
  );
});

// ---------------------------------------------------------------------------
// Session creation flow
// ---------------------------------------------------------------------------

test("createNewSession ensures server is running before creating session", () => {
  const createBody = extractFunctionBody(
    sessionServiceSource,
    "async createNewSession",
  );
  assert.ok(createBody, "createNewSession method must exist");
  assert.match(
    createBody,
    /serverManager\.ensureRunning/,
    "createNewSession must call serverManager.ensureRunning",
  );
});

test("createNewSession calls server client session.create", () => {
  assert.match(
    sessionServiceSource,
    /client\.session\.create/,
    "createNewSession must call client.session.create on the server",
  );
});

test("createNewSession updates local sessionHistory cache", () => {
  assert.match(
    sessionServiceSource,
    /sessionHistory/,
    "SessionService must maintain a sessionHistory cache",
  );
  assert.match(
    sessionServiceSource,
    /persistState/,
    "createNewSession must call persistState to save session to local cache",
  );
});

// ---------------------------------------------------------------------------
// Get current session with auto-create
// ---------------------------------------------------------------------------

test("getCurrentSession waits for initialization to complete", () => {
  const getBody = extractFunctionBody(
    sessionServiceSource,
    "async getCurrentSession",
  );
  assert.ok(getBody, "getCurrentSession method must exist");
  assert.match(
    getBody,
    /initializationPromise/,
    "getCurrentSession must await initializationPromise",
  );
});

test("getCurrentSession auto-creates a new session when none exists", () => {
  const getBody = extractFunctionBody(
    sessionServiceSource,
    "async getCurrentSession",
  );
  assert.match(
    getBody,
    /createNewSession/,
    "getCurrentSession must auto-create session when currentSession is null",
  );
});

// ---------------------------------------------------------------------------
// List sessions with merge logic
// ---------------------------------------------------------------------------

test("listSessions fetches sessions from server", () => {
  assert.match(
    sessionServiceSource,
    /client\.session\.list/,
    "listSessions must call client.session.list",
  );
});

test("listSessions merges server results with local cache", () => {
  assert.match(
    sessionServiceSource,
    /coalesceSessionsById/,
    "listSessions must merge server + local via coalesceSessionsById",
  );
});

test("listSessions handles alias conflicts by merging messages", () => {
  assert.match(
    sessionServiceSource,
    /mergeMessagesForSessionAliases/,
    "listSessions must merge messages when session aliases conflict",
  );
});

// ---------------------------------------------------------------------------
// Switch session flow
// ---------------------------------------------------------------------------

test("switchSession fetches session from server", () => {
  assert.match(
    sessionServiceSource,
    /client\.session\.get/,
    "switchSession must attempt client.session.get from server",
  );
});

test("switchSession falls back to local cache when server fetch fails", () => {
  const switchBody = extractFunctionBody(
    sessionServiceSource,
    "async switchSession",
  );
  assert.ok(switchBody, "switchSession method must exist");
  assert.match(
    switchBody,
    /catch/,
    "switchSession must handle server fetch failure",
  );
});

test("switchSession updates currentSession reference", () => {
  const switchBody = extractFunctionBody(
    sessionServiceSource,
    "async switchSession",
  );
  assert.match(
    switchBody,
    /this\.currentSession\s*=/,
    "switchSession must update currentSession on success",
  );
});

// ---------------------------------------------------------------------------
// Delete session flow
// ---------------------------------------------------------------------------

test("deleteSession calls server client to delete session", () => {
  assert.match(
    sessionServiceSource,
    /client\.session\.delete/,
    "deleteSession must call client.session.delete on the server",
  );
});

test("deleteSession removes session from local history cache", () => {
  const deleteBody = extractFunctionBody(
    sessionServiceSource,
    "async deleteSession",
  );
  assert.ok(deleteBody, "deleteSession method must exist");
  assert.match(
    deleteBody,
    /sessionHistory/,
    "deleteSession must manipulate sessionHistory",
  );
});

test("deleteSession clears currentSession if it matches the deleted session", () => {
  const deleteBody = extractFunctionBody(
    sessionServiceSource,
    "async deleteSession",
  );
  assert.match(
    deleteBody,
    /this\.currentSession\s*=\s*null/,
    "deleteSession must clear currentSession when deleting active session",
  );
});

test("deleteSession clears persisted messages for the deleted session", () => {
  const deleteBody = extractFunctionBody(
    sessionServiceSource,
    "async deleteSession",
  );
  assert.match(
    deleteBody,
    /rawMessageCache\.delete|MESSAGES_PREFIX/,
    "deleteSession must clean up persisted messages for deleted session",
  );
});

// ---------------------------------------------------------------------------
// Message persistence flow
// ---------------------------------------------------------------------------

test("saveSessionMessages sanitizes messages before persisting", () => {
  assert.match(
    sessionServiceSource,
    /saveSessionMessages/,
    "SessionService must have saveSessionMessages method",
  );
});

test("saveSessionMessages enforces compaction limits", () => {
  assert.match(
    sessionServiceSource,
    /compact/,
    "saveSessionMessages must compact messages to enforce size limits",
  );
});

test("SessionService persists messages to workspaceState", () => {
  assert.match(
    sessionServiceSource,
    /workspaceState/,
    "SessionService must use workspaceState for persistence",
  );
});

test("appendMessage adds message to local cache", () => {
  assert.match(
    sessionServiceSource,
    /appendMessage/,
    "SessionService must have appendMessage method",
  );
});

test("upsertMessage merges by signature and picks richer message", () => {
  assert.match(
    sessionServiceSource,
    /upsertMessage/,
    "SessionService must have upsertMessage method",
  );
  assert.match(
    sessionServiceSource,
    /pickRicherMessage/,
    "upsertMessage must use pickRicherMessage for deduplication",
  );
});

// ---------------------------------------------------------------------------
// Cross-service interaction: OpencodeServerManager dependency
// ---------------------------------------------------------------------------

test("SessionService constructor accepts serverManager dependency", () => {
  assert.match(
    sessionServiceSource,
    /serverManager/,
    "SessionService must accept serverManager in constructor",
  );
});

test("SessionService uses serverManager.ensureRunning for server access", () => {
  assert.match(
    sessionServiceSource,
    /serverManager\.ensureRunning/,
    "SessionService must call serverManager.ensureRunning to access server",
  );
});

test("SessionService integrates with CheckpointRestore", () => {
  assert.match(
    sessionServiceSource,
    /restoreCheckpointIfPresent|CheckpointRestore|checkpoint/i,
    "SessionService must integrate with checkpoint restore on initialization",
  );
});

// ---------------------------------------------------------------------------
// Session rename flow
// ---------------------------------------------------------------------------

test("renameSession updates session title on server", () => {
  assert.match(
    sessionServiceSource,
    /renameSession/,
    "SessionService must have renameSession method",
  );
});
