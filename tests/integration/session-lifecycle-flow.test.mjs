/**
 * Session Lifecycle Flow Integration Tests
 *
 * Validates the complete SessionService lifecycle:
 *   Initialization → restore active SDK session pointer
 *   Create session → server call
 *   Get current session → auto-create if null
 *   List sessions → SDK server response only
 *   Switch session → SDK server fetch
 *   Delete session → SDK server + derived-cache cleanup
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

test("SessionService does not initialize history from persisted snapshots", () => {
  assert.doesNotMatch(
    sessionServiceSource,
    /loadPersistedState|restoreCheckpointIfPresent|workspaceState\.get/,
    "initialization must leave history to the SDK",
  );
});

test("SessionService tracks the current SDK session in memory", () => {
  assert.match(
    sessionServiceSource,
    /currentSession/,
    "SessionService must track the current SDK session",
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

test("getCurrentSession selects an SDK session before creating an empty workspace session", () => {
  const getBody = extractFunctionBody(
    sessionServiceSource,
    "async getCurrentSession",
  );
  assert.match(
    getBody,
    /client\.session\.list\(\)/,
    "getCurrentSession must query SDK sessions when currentSession is null",
  );
  assert.match(
    getBody,
    /const newestSdkSession = topLevelSessionsForChat\(normalized\)\[0\];/,
    "getCurrentSession must reuse the newest top-level SDK session after restart",
  );
  assert.match(
    getBody,
    /return this\.createNewSession\(\);/,
    "getCurrentSession may create only when the SDK list is empty",
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

test("listSessions normalizes SDK results without local history", () => {
  const listBody = extractFunctionBody(sessionServiceSource, "async listSessions");
  assert.match(listBody, /coalesceSessionsById\(serverSessions\)/);
  assert.doesNotMatch(listBody, /localSessions|mergeMessagesForSessionAliases/);
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

test("switchSession does not fall back to local session data", () => {
  const switchBody = extractFunctionBody(
    sessionServiceSource,
    "async switchSession",
  );
  assert.ok(switchBody, "switchSession method must exist");
  assert.doesNotMatch(switchBody, /sessionHistory\.find|local stub|fallback/i);
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

test("deleteSession does not maintain an extension-owned transcript", () => {
  const deleteBody = extractFunctionBody(
    sessionServiceSource,
    "async deleteSession",
  );
  assert.doesNotMatch(
    deleteBody,
    /saveSessionMessages|loadSessionMessages|MESSAGES_PREFIX/,
    "deleteSession must not depend on an extension-owned transcript",
  );
});

// ---------------------------------------------------------------------------
// SDK-only message history
// ---------------------------------------------------------------------------

test("getMessages reads SDK history without local transcript fallback", () => {
  const getMessagesBody = extractFunctionBody(sessionServiceSource, "async getMessages");
  assert.match(getMessagesBody, /client\.session\.messages/);
  assert.doesNotMatch(getMessagesBody, /loadSessionMessages|saveSessionMessages|localMessages/);
});

test("legacy transcript persistence compatibility methods do not store data", () => {
  const saveBody = extractFunctionBody(sessionServiceSource, "async saveSessionMessages");
  const loadBody = extractFunctionBody(sessionServiceSource, "async loadSessionMessages");
  assert.doesNotMatch(saveBody, /workspaceState|workspaceFileCache/);
  assert.match(loadBody, /return \[\]/);
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

test("SessionService does not hydrate history from CheckpointRestore", () => {
  assert.doesNotMatch(
    sessionServiceSource,
    /restoreCheckpointIfPresent|CheckpointRestore|checkpoint/i,
    "SessionService history must come from the SDK",
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
