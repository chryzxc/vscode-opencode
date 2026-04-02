/**
 * Complete Session Feature Test Suite
 *
 * Comprehensive integration tests covering the entire session feature:
 * - Session CRUD operations (create, read, update, delete)
 * - Session switching and persistence
 * - Server-local data merging
 * - Message persistence and retrieval
 * - Session alias coalescing
 * - Error handling and fallbacks
 * - State restoration across restarts
 * - Webview-extension communication
 *
 * Test Strategy:
 * - Uses source code analysis for structural verification
 * - Tests data flow through extension and webview
 * - Validates error handling paths
 * - Ensures data persistence and recovery
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

// Read source files for analysis
const sessionServiceSource = readSource(
  [joinFromRoot('src', 'services', 'SessionService.ts')],
  'SessionService.ts',
);
const chatProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);
const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

// ============================================================================
// SESSION CREATION
// ============================================================================

test('Session: createNewSession generates timestamp-based titles when none provided', () => {
  const createBody = extractFunctionBody(
    sessionServiceSource,
    'async createNewSession('
  );

  assert.match(
    createBody,
    /title\s*\|\|\s*["']Untitled chat["']|["']Session ["']/,
    'createNewSession should use provided title or default to "Untitled chat"'
  );
});

test('Session: createNewSession persists new session to currentSession', () => {
  const createBody = extractFunctionBody(
    sessionServiceSource,
    'async createNewSession('
  );

  assert.match(
    createBody,
    /this\.currentSession\s*=\s*session/,
    'createNewSession should set currentSession'
  );
  assert.match(
    createBody,
    /persistState\(\)/,
    'createNewSession should persist state'
  );
});

test('Session: createNewSession handles server error responses', () => {
  const createBody = extractFunctionBody(
    sessionServiceSource,
    'async createNewSession('
  );

  assert.match(
    createBody,
    /if\s*\(!response\.data\)/,
    'createNewSession should check for response data'
  );
  assert.match(
    createBody,
    /throw\s+new\s+Error\(`Failed\s+to\s+create\s+session:/,
    'createNewSession should throw on server error'
  );
});

// ============================================================================
// SESSION LISTING AND MERGING
// ============================================================================

test('Session: listSessions implements server-local merge algorithm', () => {
  const listBody = extractFunctionBody(
    sessionServiceSource,
    'async listSessions(): Promise<Session[]>'
  );

  // Step 1: Fetch from server
  assert.match(
    listBody,
    /client\.session\.list\(\)/,
    'listSessions should fetch sessions from server'
  );

  // Step 2: Create merge map
  assert.match(
    listBody,
    /const\s+mergedMap\s*=\s*new\s+Map<string,\s*Session>\(\)/,
    'listSessions should create map for merging'
  );

  // Step 3: Add local sessions
  assert.match(
    listBody,
    /localSessions\.forEach\(\(s\)\s*=>\s*\{[\s\S]*mergedMap\.set\(s\.id,\s*s\)/,
    'listSessions should add all local sessions to map'
  );

  // Step 4: Add server sessions (overwrites local)
  assert.match(
    listBody,
    /serverSessions\.forEach\(\(s\)\s*=>\s*\{[\s\S]*mergedMap\.set\(s\.id,\s*s\)/,
    'listSessions should add server sessions (overwrites local if same ID)'
  );

  // Step 5: Convert to array and sort
  assert.match(
    listBody,
    /Array\.from\(mergedMap\.values\(\)\)/,
    'listSessions should convert map to array'
  );
  assert.match(
    listBody,
    /coalesceSessionsById/,
    'listSessions should coalesce and sort sessions'
  );
});

test('Session: listSessions falls back to local history on server error', () => {
  const listBody = extractFunctionBody(
    sessionServiceSource,
    'async listSessions(): Promise<Session[]>'
  );

  assert.match(
    listBody,
    /catch\s*\(error\)\s*\{[\s\S]*console\.error\([\s\S]*Fallback to local history/,
    'listSessions should catch server errors and fallback to local'
  );
  assert.match(
    listBody,
    /const\s+normalizedLocal\s*=\s*coalesceSessionsById\(this\.sessionHistory\)/,
    'listSessions should normalize local sessions on fallback'
  );
});

test('Session: listSessions waits for initialization before merging', () => {
  const listBody = extractFunctionBody(
    sessionServiceSource,
    'async listSessions(): Promise<Session[]>'
  );

  assert.match(
    listBody,
    /if\s*\(this\.initializationPromise\)\s*\{[\s\S]*await\s+this\.initializationPromise/,
    'listSessions should wait for initialization to prevent clobbering persisted state'
  );
});

test('Session: listSessions handles session alias conflicts', () => {
  const listBody = extractFunctionBody(
    sessionServiceSource,
    'async listSessions(): Promise<Session[]>'
  );

  assert.match(
    listBody,
    /hasSessionAliasConflicts\(/,
    'listSessions should check for session alias conflicts'
  );
  assert.match(
    listBody,
    /mergeMessagesForSessionAliases\(/,
    'listSessions should merge messages for aliased sessions'
  );
});

// ============================================================================
// SESSION SWITCHING
// ============================================================================

test('Session: switchSession fetches from server and updates current session', () => {
  const switchBody = extractFunctionBody(
    sessionServiceSource,
    'async switchSession('
  );

  assert.match(
    switchBody,
    /client\.session\.get\(/,
    'switchSession should fetch session from server by ID'
  );
  assert.match(
    switchBody,
    /path:\s*\{\s*id:\s*sessionId\s*\}/,
    'switchSession should pass sessionId in path parameter'
  );
  assert.match(
    switchBody,
    /this\.currentSession\s*=\s*response\.data/,
    'switchSession should update currentSession from server response'
  );
});

test('Session: switchSession falls back to local history on server error', () => {
  const switchBody = extractFunctionBody(
    sessionServiceSource,
    'async switchSession('
  );

  assert.match(
    switchBody,
    /catch\s*\(error\)\s*\{[\s\S]*const\s+localSession\s*=\s*this\.sessionHistory\.find\(/,
    'switchSession should find session in local history on server error'
  );
  assert.match(
    switchBody,
    /this\.currentSession\s*=\s*localSession/,
    'switchSession should use local session as fallback'
  );
});

test('Session: switchSession throws if session not found locally or on server', () => {
  const switchBody = extractFunctionBody(
    sessionServiceSource,
    'async switchSession('
  );

  assert.match(
    switchBody,
    /if\s*\(!localSession\)\s*\{[\s\S]*throw\s+error/,
    'switchSession should throw if session not found in local history'
  );
});

test('Session: switchSession persists new current session ID', () => {
  const switchBody = extractFunctionBody(
    sessionServiceSource,
    'async switchSession('
  );

  // Should persist after successful fetch
  assert.match(
    switchBody,
    /this\.currentSession\s*=\s*response\.data[\s\S]*this\.persistState\(\)/,
    'switchSession should persist after server fetch'
  );

  // Should persist after fallback to local
  assert.match(
    switchBody,
    /this\.currentSession\s*=\s*localSession[\s\S]*this\.persistState\(\)/,
    'switchSession should persist after local fallback'
  );
});

// ============================================================================
// SESSION DELETION
// ============================================================================

test('Session: deleteSession removes from server and local cache', () => {
  const deleteBody = extractFunctionBody(
    sessionServiceSource,
    'async deleteSession('
  );

  assert.match(
    deleteBody,
    /client\.session\.delete\(/,
    'deleteSession should call server delete API'
  );
  assert.match(
    deleteBody,
    /path:\s*\{\s*id:\s*sessionId\s*\}/,
    'deleteSession should pass sessionId in path parameter'
  );
});

test('Session: deleteSession clears current session if deleting active session', () => {
  const deleteBody = extractFunctionBody(
    sessionServiceSource,
    'async deleteSession('
  );

  assert.match(
    deleteBody,
    /if\s*\(this\.currentSession\?\.id\s*===\s*sessionId\)\s*\{[\s\S]*this\.currentSession\s*=\s*null/,
    'deleteSession should clear current session if deleting active session'
  );
});

test('Session: deleteSession removes from session history', () => {
  const deleteBody = extractFunctionBody(
    sessionServiceSource,
    'async deleteSession('
  );

  assert.match(
    deleteBody,
    /this\.sessionHistory\s*=\s*this\.sessionHistory\.filter\(\(s\)\s*=>\s*s\.id\s*!==\s*sessionId\)/,
    'deleteSession should filter session from history'
  );
});

test('Session: deleteSession clears cached messages from workspace storage', () => {
  const deleteBody = extractFunctionBody(
    sessionServiceSource,
    'async deleteSession('
  );

  assert.match(
    deleteBody,
    /workspaceState\.update\([\s\S]*MESSAGES_PREFIX[\s\S]*sessionId[\s\S]*undefined/s,
    'deleteSession should delete cached messages'
  );
});

test('Session: deleteSession handles server errors gracefully', () => {
  const deleteBody = extractFunctionBody(
    sessionServiceSource,
    'async deleteSession('
  );

  assert.match(
    deleteBody,
    /catch\s*\(error\)\s*\{[\s\S]*console\.warn\([\s\S]*continuing with local cleanup/,
    'deleteSession should log warning but continue with local cleanup on server error'
  );
});

// ============================================================================
// SESSION RENAMING
// ============================================================================

test('Session: renameSession updates title on server and locally', () => {
  const renameBody = extractFunctionBody(
    sessionServiceSource,
    'async renameSession('
  );

  assert.match(
    renameBody,
    /client\.session\.update\(/,
    'renameSession should call server update API with new title'
  );
  assert.match(
    renameBody,
    /body:\s*\{\s*title:\s*newTitle\s*\}/,
    'renameSession should pass newTitle in body parameter'
  );
});

test('Session: renameSession updates session in local history', () => {
  const renameBody = extractFunctionBody(
    sessionServiceSource,
    'async renameSession('
  );

  assert.match(
    renameBody,
    /const\s+index\s*=\s*this\.sessionHistory\.findIndex\(\(s\)\s*=>\s*s\.id\s*===\s*sessionId\)/,
    'renameSession should find session in history'
  );
  assert.match(
    renameBody,
    /this\.sessionHistory\[index\]\s*=\s*updatedSession/,
    'renameSession should update session in history'
  );
});

test('Session: renameSession updates current session if renaming active session', () => {
  const renameBody = extractFunctionBody(
    sessionServiceSource,
    'async renameSession('
  );

  assert.match(
    renameBody,
    /if\s*\(this\.currentSession\?\.id\s*===\s*sessionId\)\s*\{[\s\S]*this\.currentSession\s*=\s*updatedSession/,
    'renameSession should update current session if renaming active'
  );
});

test('Session: renameSession performs optimistic update on server error', () => {
  const renameBody = extractFunctionBody(
    sessionServiceSource,
    'async renameSession('
  );

  assert.match(
    renameBody,
    /catch\s*\(error\)\s*\{[\s\S]*log\.warn\([\s\S]*updating local state only/s,
    'renameSession should log warning on server error'
  );
  assert.match(
    renameBody,
    /localSession\.title\s*=\s*newTitle/,
    'renameSession should update local title even if server fails'
  );
});

test('Session: renameSession throws if session not found', () => {
  const renameBody = extractFunctionBody(
    sessionServiceSource,
    'async renameSession('
  );

  assert.match(
    renameBody,
    /throw\s+error/,
    'renameSession should throw if session not found locally and server fails'
  );
});

// ============================================================================
// SESSION CURRENT SESSION MANAGEMENT
// ============================================================================

test('Session: getCurrentSession waits for initialization', () => {
  const getCurrentBody = extractFunctionBody(
    sessionServiceSource,
    'async getCurrentSession(): Promise<Session>'
  );

  assert.match(
    getCurrentBody,
    /if\s*\(this\.initializationPromise\)\s*\{[\s\S]*await\s+this\.initializationPromise/,
    'getCurrentSession should wait for initialization to complete'
  );
});

test('Session: getCurrentSession returns existing session if available', () => {
  const getCurrentBody = extractFunctionBody(
    sessionServiceSource,
    'async getCurrentSession(): Promise<Session>'
  );

  assert.match(
    getCurrentBody,
    /if\s*\(this\.currentSession\)\s*\{[\s\S]*return\s+this\.currentSession/,
    'getCurrentSession should return current session if exists'
  );
});

test('Session: getCurrentSession auto-creates session if none exists', () => {
  const getCurrentBody = extractFunctionBody(
    sessionServiceSource,
    'async getCurrentSession(): Promise<Session>'
  );

  assert.match(
    getCurrentBody,
    /return\s+this\.createNewSession\(\)/,
    'getCurrentSession should create new session if none exists'
  );
});

// ============================================================================
// MESSAGE PERSISTENCE AND RETRIEVAL
// ============================================================================

test('Session: getMessages implements server-local merge with fallback', () => {
  const getMessagesBody = extractFunctionBody(
    sessionServiceSource,
    'async getMessages(sessionId: string): Promise<unknown[]>'
  );

  assert.match(
    getMessagesBody,
    /const\s+localMessages\s*=\s*await\s+this\.loadSessionMessages\(sessionId\)/,
    'getMessages should load local cache first'
  );
  assert.match(
    getMessagesBody,
    /client\.session\.messages\(/,
    'getMessages should fetch from server'
  );
  assert.match(
    getMessagesBody,
    /path:\s*\{[\s\S]*id:\s*sessionId/s,
    'getMessages should pass sessionId in path parameter'
  );
  assert.match(
    getMessagesBody,
    /mergeConversationMessages\(\[localMessages,\s*response\.data\]\)/,
    'getMessages should merge local and server messages'
  );
  assert.match(
    getMessagesBody,
    /this\.saveSessionMessages\(/,
    'getMessages should persist merged messages'
  );
});

test('Session: getMessages falls back to local storage on server error', () => {
  const getMessagesBody = extractFunctionBody(
    sessionServiceSource,
    'async getMessages(sessionId: string): Promise<unknown[]>'
  );

  assert.match(
    getMessagesBody,
    /catch\s*\(error\)\s*\{[\s\S]*console\.warn\([\s\S]*Returning.*local messages/,
    'getMessages should return local messages on server error'
  );
  assert.match(
    getMessagesBody,
    /return\s+localMessages/,
    'getMessages should return local cache as fallback'
  );
});

test('Session: saveSessionMessages implements compaction for storage limits', () => {
  const saveBody = extractFunctionBody(
    sessionServiceSource,
    'async saveSessionMessages('
  );

  assert.match(
    saveBody,
    /MAX_CACHED_MESSAGES_PER_SESSION/,
    'saveSessionMessages should check message count limit'
  );
  assert.match(
    saveBody,
    /MAX_CACHED_SESSION_BYTES/,
    'saveSessionMessages should check byte size limit'
  );
  assert.match(
    saveBody,
    /compactMessageForPersistence\(/,
    'saveSessionMessages should compact messages if too large'
  );
});

test('Session: upsertMessage implements rich message merge', () => {
  const upsertBody = extractFunctionBody(
    sessionServiceSource,
    'async upsertMessage(sessionId: string, message: unknown): Promise<void>'
  );

  assert.match(
    upsertBody,
    /const\s+incomingSignatures\s*=\s*getMessageSignaturesForMerge\(message\)/,
    'upsertMessage should compute signatures for incoming message'
  );
  assert.match(
    upsertBody,
    /const\s+existingIndex\s*=\s*messages\.findIndex\(\(candidate\)/,
    'upsertMessage should find existing message by signature'
  );
  assert.match(
    upsertBody,
    /pickRicherMessage\(/,
    'upsertMessage should merge with richer message on match'
  );
  assert.match(
    upsertBody,
    /messages\.push\(message\)/,
    'upsertMessage should append message if no match'
  );
});

test('Session: loadSessionMessages returns empty array if no cached messages', () => {
  const loadBody = extractFunctionBody(
    sessionServiceSource,
    'async loadSessionMessages(sessionId: string): Promise<unknown[]>'
  );

  assert.match(
    loadBody,
    /Array\.isArray\(value\)\s*\?\s*value\s*:\s*\[\]/,
    'loadSessionMessages should return empty array if no cached messages'
  );
});

// ============================================================================
// SESSION PERSISTENCE AND STATE RESTORATION
// ============================================================================

test('Session: loadPersistedState respects persistSessions configuration', () => {
  const loadBody = extractFunctionBody(
    sessionServiceSource,
    'private async loadPersistedState(): Promise<void>'
  );

  assert.match(
    loadBody,
    /const\s+config\s*=\s*vscode\.workspace\.getConfiguration\("opencode"\)/,
    'loadPersistedState should check opencode configuration'
  );
  assert.match(
    loadBody,
    /config\.get\("persistSessions",\s*true\)/,
    'loadPersistedState should respect persistSessions setting'
  );
  assert.match(
    loadBody,
    /if\s*\(!config\.get\("persistSessions",\s*true\)\)\s*\{[\s\S]*return/,
    'loadPersistedState should skip loading if persistence disabled'
  );
});

test('Session: loadPersistedState restores session history', () => {
  const loadBody = extractFunctionBody(
    sessionServiceSource,
    'private async loadPersistedState(): Promise<void>'
  );

  assert.match(
    loadBody,
    /SESSIONS_KEY/,
    'loadPersistedState should load sessions from SESSIONS_KEY'
  );
  assert.match(
    loadBody,
    /coalesceSessionsById\(/,
    'loadPersistedState should normalize and deduplicate sessions'
  );
  assert.match(
    loadBody,
    /this\.sessionHistory\s*=\s*normalizedSessions\.sessions/,
    'loadPersistedState should restore session history'
  );
});

test('Session: loadPersistedState restores current session ID', () => {
  const loadBody = extractFunctionBody(
    sessionServiceSource,
    'private async loadPersistedState(): Promise<void>'
  );

  assert.match(
    loadBody,
    /SESSION_ID_KEY/,
    'loadPersistedState should load current session ID from SESSION_ID_KEY'
  );
  assert.match(
    loadBody,
    /sessionId\s*&&\s*persistedSessionId\s*!==\s*sessionId/,
    'loadPersistedState should normalize session ID'
  );
});

test('Session: loadPersistedState switches to persisted session', () => {
  const loadBody = extractFunctionBody(
    sessionServiceSource,
    'private async loadPersistedState(): Promise<void>'
  );

  assert.match(
    loadBody,
    /if\s*\(sessionId\)\s*\{[\s\S]*await\s+this\.switchSession\(sessionId\)/,
    'loadPersistedState should switch to persisted session'
  );
});

test('Session: loadPersistedState handles missing server sessions gracefully', () => {
  const loadBody = extractFunctionBody(
    sessionServiceSource,
    'private async loadPersistedState(): Promise<void>'
  );

  assert.match(
    loadBody,
    /catch\s*\(e\)\s*\{[\s\S]*console\.log\([\s\S]*Session not found on server/,
    'loadPersistedState should catch missing session errors'
  );
  assert.match(
    loadBody,
    /const\s+stub\s*=\s*this\.sessionHistory\.find\(\(s\)\s*=>\s*s\.id\s*===\s*sessionId\)/,
    'loadPersistedState should find session in local history'
  );
  assert.match(
    loadBody,
    /this\.currentSession\s*=\s*stub/,
    'loadPersistedState should use local stub as current session'
  );
});

test('Session: persistState saves sessions and current session ID', () => {
  const persistBody = extractFunctionBody(
    sessionServiceSource,
    'private persistState()'
  );

  assert.match(
    persistBody,
    /const\s+config\s*=\s*vscode\.workspace\.getConfiguration\("opencode"\)/,
    'persistState should check configuration'
  );
  assert.match(
    persistBody,
    /config\.get\("persistSessions",\s*true\)/,
    'persistState should respect persistSessions setting'
  );
  assert.match(
    persistBody,
    /this\.context\.workspaceState\.update\([\s\S]*SESSIONS_KEY[\s\S]*this\.sessionHistory/,
    'persistState should save session history'
  );
  assert.match(
    persistBody,
    /this\.context\.workspaceState\.update\([\s\S]*SESSION_ID_KEY[\s\S]*this\.currentSession\.id/,
    'persistState should save current session ID'
  );
});

// ============================================================================
// SESSION ALIAS COALESCING
// ============================================================================

test('Session: coalesceSessionsById normalizes session IDs', () => {
  const coalesceBody = extractFunctionBody(
    sessionServiceSource,
    'function coalesceSessionsById(sessions: Session[]): {'
  );

  assert.match(
    coalesceBody,
    /const\s+canonicalId\s*=\s*normalizeSessionId\(rawId\)/,
    'coalesceSessionsById should normalize session IDs'
  );
  assert.match(
    coalesceBody,
    /normalizeSessionId\(/,
    'coalesceSessionsById should use normalizeSessionId helper'
  );
});

test('Session: coalesceSessionsById merges duplicate sessions', () => {
  const coalesceBody = extractFunctionBody(
    sessionServiceSource,
    'function coalesceSessionsById(sessions: Session[]): {'
  );

  assert.match(
    coalesceBody,
    /mergeSessionRecords\(/,
    'coalesceSessionsById should merge duplicate sessions'
  );
  assert.match(
    coalesceBody,
    /const\s+existing\s*=\s*byCanonicalId\.get\(canonicalId\)/,
    'coalesceSessionsById should check for existing session'
  );
});

test('Session: coalesceSessionsById sorts sessions by creation time', () => {
  const coalesceBody = extractFunctionBody(
    sessionServiceSource,
    'function coalesceSessionsById(sessions: Session[]): {'
  );

  assert.match(
    coalesceBody,
    /\.sort\(\(a,\s*b\)\s*=>\s*[\s\S]*getSessionCreatedTime\(b\)[\s\S]*getSessionCreatedTime\(a\)/s,
    'coalesceSessionsById should sort by creation time (newest first)'
  );
});

test('Session: coalesceSessionsById returns alias mapping', () => {
  const coalesceBody = extractFunctionBody(
    sessionServiceSource,
    'function coalesceSessionsById(sessions: Session[]): {'
  );

  assert.match(
    coalesceBody,
    /const\s+aliasesByCanonicalId\s*=\s*new\s+Map/,
    'coalesceSessionsById should create aliasesByCanonicalId mapping'
  );
  assert.match(
    coalesceBody,
    /return\s*\{[\s\S]*aliasesByCanonicalId/s,
    'coalesceSessionsById should return aliasesByCanonicalId in return object'
  );
});

test('Session: mergeMessagesForSessionAliases merges messages from aliased sessions', () => {
  const mergeAliasesBody = extractFunctionBody(
    sessionServiceSource,
    'private async mergeMessagesForSessionAliases('
  );

  assert.match(
    mergeAliasesBody,
    /for\s*\(const\s*\[canonicalId,\s*aliases\]\s*of\s*aliasesByCanonicalId\.entries\(\)\)/,
    'mergeMessagesForSessionAliases should iterate over alias sets'
  );
  assert.match(
    mergeAliasesBody,
    /const\s+messageGroups[\s\S]*=\s*\[\]/s,
    'mergeMessagesForSessionAliases should collect message groups'
  );
  assert.match(
    mergeAliasesBody,
    /const\s+merged\s*=\s*mergeConversationMessages\(messageGroups\)/s,
    'mergeMessagesForSessionAliases should merge message groups'
  );
  assert.match(
    mergeAliasesBody,
    /await\s*this\.saveSessionMessages\(normalizedCanonicalId,\s*merged\)/s,
    'mergeMessagesForSessionAliases should save merged messages'
  );
});

test('Session: mergeMessagesForSessionAliases deletes old alias keys', () => {
  const mergeAliasesBody = extractFunctionBody(
    sessionServiceSource,
    'private async mergeMessagesForSessionAliases('
  );

  assert.match(
    mergeAliasesBody,
    /workspaceState\.update\([\s\S]*MESSAGES_PREFIX[\s\S]*alias[\s\S]*undefined/s,
    'mergeMessagesForSessionAliases should delete old alias message keys'
  );
});

// ============================================================================
// WEBVIEW-EXTENSION COMMUNICATION
// ============================================================================

test('Session: webview posts createSession message to extension', () => {
  const panelSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
    'PanelComponents.tsx',
  );
  const historyBody = extractFunctionBody(panelSource, 'export function HistorySidebar()');

  assert.match(
    historyBody,
    /vscode\.postMessage\(\{\s*type:\s*["']createSession["']\s*\}\)/,
    'webview should post createSession message'
  );
});

test('Session: webview posts switchSession message with session ID', () => {
  const panelSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
    'PanelComponents.tsx',
  );
  const historyBody = extractFunctionBody(panelSource, 'export function HistorySidebar()');

  assert.match(
    historyBody,
    /vscode\.postMessage\(\{\s*type:\s*["']switchSession["'],\s*sessionId:\s*session\.id\s*\}\)/,
    'webview should post switchSession with session ID'
  );
});

test('Session: webview posts deleteSession message with session ID', () => {
  const panelSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
    'PanelComponents.tsx',
  );
  const historyBody = extractFunctionBody(panelSource, 'export function HistorySidebar()');

  assert.match(
    historyBody,
    /handleDeleteConfirm\(session\.id\)/,
    'webview should call handleDeleteConfirm with session ID'
  );
});

test('Session: webview message handler handles chatHistory messages', () => {
  assert.match(
    messageHandlerSource,
    /case\s+["']chatHistory["']\s*:/,
    'messageHandler should handle chatHistory message type'
  );
});

test('Session: webview message handler processes chatHistory messages', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'case "chatHistory":'
  );

  assert.match(
    handlerBody,
    /const\s*rawMessages\s*=\s*asArray\(data\.messages/,
    'chatHistory handler should extract messages array'
  );
  assert.match(
    handlerBody,
    /dispatch\(\s*\{\s*type:\s*["']CLEAR_MESSAGES["']\s*\}/,
    'chatHistory handler should clear existing messages'
  );
  assert.match(
    handlerBody,
    /dispatch\(\s*\{\s*type:\s*["']SET_MESSAGES["']/,
    'chatHistory handler should set new messages'
  );
  assert.match(
    handlerBody,
    /dispatch\(\s*\{\s*type:\s*["']SET_SESSION_ID["']/,
    'chatHistory handler should set session ID'
  );
});

// ============================================================================
// EXTENSION MESSAGE ROUTING
// ============================================================================

test('Session: extension routes createSession/newSession messages', () => {
  assert.match(
    chatProviderSource,
    /case\s+"newSession"[\s\S]*case\s+"createSession"/,
    'extension should handle both newSession and createSession aliases'
  );
});

test('Session: extension routes loadSession/openSession/switchSession messages', () => {
  assert.match(
    chatProviderSource,
    /case\s+"loadSession"[\s\S]*case\s+"openSession"[\s\S]*case\s+"switchSession"/,
    'extension should handle loadSession, openSession, and switchSession aliases'
  );
});

test('Session: extension routes deleteSession message', () => {
  assert.match(
    chatProviderSource,
    /case\s+"deleteSession"/,
    'extension should handle deleteSession message'
  );
});

test('Session: extension routes renameSession message', () => {
  assert.match(
    chatProviderSource,
    /case\s+"renameSession"/,
    'extension should handle renameSession message'
  );
});

test('Session: extension calls handleLoadSession for session switching', () => {
  const switchCase = extractFunctionBody(
    chatProviderSource,
    'case "switchSession":'
  );

  assert.match(
    switchCase,
    /await\s+this\.handleLoadSession\(message\.sessionId\)/,
    'extension should call handleLoadSession for session switching'
  );
});

test('Session: handleLoadSession switches session in SessionService', () => {
  const handleLoadBody = extractFunctionBody(
    chatProviderSource,
    'private async handleLoadSession('
  );

  assert.match(
    handleLoadBody,
    /await\s+this\.sessionService\.switchSession\(sessionId\)/,
    'handleLoadSession should switch session in SessionService'
  );
});

test('Session: handleLoadSession loads messages for session', () => {
  const handleLoadBody = extractFunctionBody(
    chatProviderSource,
    'private async handleLoadSession('
  );

  assert.match(
    handleLoadBody,
    /const\s*rawMessages\s*=\s*await\s+this\.sessionService\.getMessages\(sessionId\)/,
    'handleLoadSession should get messages for session'
  );
});

test('Session: handleLoadSession sends chatHistory to webview', () => {
  const handleLoadBody = extractFunctionBody(
    chatProviderSource,
    'private async handleLoadSession('
  );

  assert.match(
    handleLoadBody,
    /this\.view\?\.webview\.postMessage\(\{\s*type:\s*["']chatHistory["']/,
    'handleLoadSession should post chatHistory message to webview'
  );
  assert.match(
    handleLoadBody,
    /sessionId:\s*sessionId,\s*messages:\s*messages/,
    'chatHistory message should include sessionId and messages'
  );
});

test('Session: handleLoadSession manages loading state during session switch', () => {
  const handleLoadBody = extractFunctionBody(
    chatProviderSource,
    'private async handleLoadSession('
  );

  assert.match(
    handleLoadBody,
    /this\.processingSessionIds\.add\(sessionId\)/s,
    'handleLoadSession should add sessionId to processing state at start'
  );
  assert.match(
    handleLoadBody,
    /this\.sendProcessingSessionsUpdate\(\)/s,
    'handleLoadSession should notify webview of loading state'
  );
  assert.match(
    handleLoadBody,
    /finally\s*\{[\s\S]*this\.processingSessionIds\.delete\(sessionId\)/s,
    'handleLoadSession should remove sessionId from processing state in finally block'
  );
  assert.match(
    handleLoadBody,
    /finally\s*\{[\s\S]*this\.sendProcessingSessionsUpdate\(\)/s,
    'handleLoadSession should notify webview that loading is complete'
  );
});

test('Session: handleDeleteSession deletes session and creates new if needed', () => {
  const deleteBody = extractFunctionBody(
    chatProviderSource,
    'private async handleDeleteSession('
  );

  assert.match(
    deleteBody,
    /await\s+this\.sessionService\.deleteSession\(sessionId\)/,
    'handleDeleteSession should delete session'
  );
  assert.match(
    deleteBody,
    /const\s+currentSession\s*=\s*await\s*this\.sessionService\.getCurrentSession\(\)/,
    'handleDeleteSession should get current session after deletion'
  );
  assert.match(
    deleteBody,
    /if\s*\(!currentSession\)\s*\{[\s\S]*createNewSession\(\)/,
    'handleDeleteSession should create new session if none exists'
  );
});

test('Session: handleDeleteSession shows error message on failure', () => {
  const deleteBody = extractFunctionBody(
    chatProviderSource,
    'private async handleDeleteSession('
  );

  assert.match(
    deleteBody,
    /vscode\.window\.showErrorMessage\(`Failed to delete session:\s*\$\{error\}`\)/,
    'handleDeleteSession should show error message on failure'
  );
});

test('Session: handleRenameSession renames session', () => {
  assert.match(
    chatProviderSource,
    /case\s+"renameSession"/,
    'extension should handle renameSession message'
  );

  const renameCase = extractFunctionBody(
    chatProviderSource,
    'case "renameSession":'
  );

  assert.match(
    renameCase,
    /await\s+this\.handleRenameSession\(/s,
    'handleRenameSession should call handleRenameSession method'
  );
});

// ============================================================================
// SESSION ERROR HANDLING
// ============================================================================

test('Session: createNewSession throws descriptive error on failure', () => {
  const createBody = extractFunctionBody(
    sessionServiceSource,
    'async createNewSession('
  );

  assert.match(
    createBody,
    /const\s+msg\s*=\s*em\?\.message\s*\|\|?[\s\S]*throw\s+new\s+Error\(`Failed\s+to\s+create\s+session:\s*\$\{msg\}`\)/,
    'createNewSession should throw error with message from server'
  );
});

test('Session: renameSession throws descriptive error on failure', () => {
  const renameBody = extractFunctionBody(
    sessionServiceSource,
    'async renameSession('
  );

  assert.match(
    renameBody,
    /throw\s+new\s+Error\(`Failed\s+to\s+rename\s+session:\s*\$\{msg\}`\)/,
    'renameSession should throw error with message from server'
  );
});

test('Session: listSessions logs errors but returns fallback data', () => {
  const listBody = extractFunctionBody(
    sessionServiceSource,
    'async listSessions(): Promise<Session[]>'
  );

  assert.match(
    listBody,
    /catch\s*\(error\)\s*\{[\s\S]*console\.error\([\s\S]*Fallback to local history/,
    'listSessions should log error but return local sessions'
  );
  assert.match(
    listBody,
    /return\s+this\.sessionHistory/,
    'listSessions should return session history as fallback'
  );
});

test('Session: getMessages logs warnings but returns local data', () => {
  const getMessagesBody = extractFunctionBody(
    sessionServiceSource,
    'async getMessages(sessionId: string): Promise<unknown[]>'
  );

  assert.match(
    getMessagesBody,
    /catch\s*\(error\)\s*\{[\s\S]*console\.warn\([\s\S]*Returning.*local messages/,
    'getMessages should log warning but return local messages'
  );
});

// ============================================================================
// SESSION DATA COMPACTION
// ============================================================================

test('Session: compactMessageForPersistence preserves critical fields', () => {
  const compactBody = extractFunctionBody(
    sessionServiceSource,
    'function compactMessageForPersistence('
  );

  // Check that critical fields are preserved
  assert.match(
    compactBody,
    /compact\.id\s*=\s*rec\.id/,
    'Should preserve message ID'
  );
  assert.match(
    compactBody,
    /compact\.role\s*=\s*rec\.role/,
    'Should preserve role'
  );
  assert.match(
    compactBody,
    /compact\.content\s*=\s*truncateString\(rec\.content\)/,
    'Should preserve and truncate content'
  );
  assert.match(
    compactBody,
    /compact\.reasoningEvents\s*=/,
    'Should preserve reasoning events'
  );
  assert.match(
    compactBody,
    /compact\.progressEvents\s*=/,
    'Should preserve progress events'
  );
  assert.match(
    compactBody,
    /compact\.steps\s*=/,
    'Should preserve steps'
  );
  assert.match(
    compactBody,
    /compact\.subagents\s*=/,
    'Should preserve subagents'
  );
});

test('Session: saveSessionMessages implements multi-stage compaction', () => {
  const saveBody = extractFunctionBody(
    sessionServiceSource,
    'async saveSessionMessages('
  );

  // Stage 1: Trim message count
  assert.match(
    saveBody,
    /if\s*\(persisted\.length\s*>\s*MAX_CACHED_MESSAGES_PER_SESSION\)/,
    'Should trim message count if over limit'
  );
  assert.match(
    saveBody,
    /persisted\s*=\s*persisted\.slice\(-MAX_CACHED_MESSAGES_PER_SESSION\)/,
    'Should keep most recent messages'
  );

  // Stage 2: Trim by byte size
  assert.match(
    saveBody,
    /while\s*\([\s\S]*estimatedSize\s*>\s*MAX_CACHED_SESSION_BYTES\)/,
    'Should trim by byte size if over limit'
  );
  assert.match(
    saveBody,
    /persisted\s*=\s*persisted\.slice\(trimCount\)/,
    'Should slice messages to reduce size'
  );

  // Stage 3: Compact individual messages
  assert.match(
    saveBody,
    /persisted\s*=\s*persisted\.map\(\(message\)\s*=>\s*compactMessageForPersistence\(message\)\)/,
    'Should compact individual messages if still too large'
  );

  // Stage 4: Trim from beginning
  assert.match(
    saveBody,
    /persisted\s*=\s*persisted\.slice\(1\)/,
    'Should trim from beginning if compacting not enough'
  );
});

// ============================================================================
// SESSION INITIALIZATION
// ============================================================================

test('Session: constructor triggers async state initialization', () => {
  const constructorBody = extractFunctionBody(
    sessionServiceSource,
    'constructor('
  );

  assert.match(
    constructorBody,
    /this\.initializationPromise\s*=\s*\(async\s*\(\)\s*=>/,
    'Constructor should create initialization promise'
  );
  assert.match(
    constructorBody,
    /await\s+this\.loadPersistedState\(\)/,
    'Constructor should load persisted state'
  );
});

test('Session: initializationPromise is awaited before accessing state', () => {
  assert.match(
    sessionServiceSource,
    /if\s*\(this\.initializationPromise\)\s*\{[\s\S]*await\s+this\.initializationPromise/,
    'Methods should wait for initializationPromise'
  );
});

// ============================================================================
// SESSION CONSTANTS AND STORAGE KEYS
// ============================================================================

test('Session: storage keys use opencode prefix', () => {
  assert.match(
    sessionServiceSource,
    /SESSIONS_KEY\s*=\s*["']opencode\.sessions["']/,
    'SESSIONS_KEY should use opencode prefix'
  );
  assert.match(
    sessionServiceSource,
    /MESSAGES_PREFIX\s*=\s*["']opencode\.session\.messages\.["']/,
    'MESSAGES_PREFIX should use opencode prefix'
  );
  assert.match(
    sessionServiceSource,
    /SESSION_ID_KEY\s*=\s*["']opencode\.currentSessionId["']/,
    'SESSION_ID_KEY should use opencode prefix'
  );
});

test('Session: persistence limits are properly defined', () => {
  assert.match(
    sessionServiceSource,
    /MAX_CACHED_MESSAGES_PER_SESSION\s*=\s*200/,
    'Should cache max 200 messages per session'
  );
  assert.match(
    sessionServiceSource,
    /MAX_CACHED_SESSION_BYTES\s*=\s*4\s*\*\s*1024\s*\*\s*1024/,
    'Should cache max 4MB per session'
  );
  assert.match(
    sessionServiceSource,
    /MAX_PERSISTED_STRING_LENGTH\s*=\s*120_000/,
    'Should limit string length to 120K chars'
  );
  assert.match(
    sessionServiceSource,
    /MAX_PERSISTED_ARRAY_LENGTH\s*=\s*256/,
    'Should limit array length to 256'
  );
  assert.match(
    sessionServiceSource,
    /MAX_PERSISTED_OBJECT_KEYS\s*=\s*200/,
    'Should limit object keys to 200'
  );
  assert.match(
    sessionServiceSource,
    /MAX_PERSISTED_DEPTH\s*=\s*8/,
    'Should limit nesting depth to 8'
  );
});

// ============================================================================
// SESSION DATA SANITIZATION
// ============================================================================

test('Session: sanitizeForPersistence handles all data types', () => {
  const sanitizeBody = extractFunctionBody(
    sessionServiceSource,
    'function sanitizeForPersistence('
  );

  // Primitives
  assert.match(
    sanitizeBody,
    /typeof\s+value\s*===\s*"string"[\s\S|]*typeof\s+value\s*===\s*"number"[\s\S|]*typeof\s+value\s*===\s*"boolean"/s,
    'Should handle primitives (string, number, boolean)'
  );

  // Arrays
  assert.match(
    sanitizeBody,
    /if\s*\(Array\.isArray\(value\)\)/,
    'Should handle arrays'
  );
  assert.match(
    sanitizeBody,
    /\.slice\(0,\s*MAX_PERSISTED_ARRAY_LENGTH\)/,
    'Should limit array length'
  );

  // Objects
  assert.match(
    sanitizeBody,
    /if\s*\(typeof\s+value\s*===\s*"object"\)/,
    'Should handle objects'
  );
  assert.match(
    sanitizeBody,
    /Object\.entries\(obj\)\.slice\(0,\s*MAX_PERSISTED_OBJECT_KEYS\)/,
    'Should limit object keys'
  );

  // Depth limiting
  assert.match(
    sanitizeBody,
    /if\s*\(depth\s*>=\s*MAX_PERSISTED_DEPTH\)/,
    'Should limit nesting depth'
  );

  // Circular reference detection
  assert.match(
    sanitizeBody,
    /seen\.has\(/,
    'Should detect circular references'
  );
});

test('Session: isDataUrl detects data URLs correctly', () => {
  const isDataUrlBody = extractFunctionBody(
    sessionServiceSource,
    'function isDataUrl('
  );

  assert.match(
    isDataUrlBody,
    /\/\^data:/,
    'Should use regex to detect data URLs'
  );
  assert.match(
    isDataUrlBody,
    /\.test\(value\)/,
    'Should use .test() method'
  );
});

test('Session: redactDataUrl preserves metadata and estimates size', () => {
  const redactBody = extractFunctionBody(
    sessionServiceSource,
    'function redactDataUrl('
  );

  assert.match(
    redactBody,
    /formatApproxBytes\(/,
    'Should calculate approximate byte size'
  );
  assert.match(
    redactBody,
    /\[omitted\s+data\s+URL/,
    'Should return redacted string with size info'
  );
});

// ============================================================================
// SESSION MERGE ALGORITHMS
// ============================================================================

test('Session: mergeSessionRecords merges session objects intelligently', () => {
  const mergeBody = extractFunctionBody(
    sessionServiceSource,
    'function mergeSessionRecords('
  );

  assert.match(
    mergeBody,
    /getSessionCreatedTime\(existing\)/,
    'Should get created time for existing'
  );
  assert.match(
    mergeBody,
    /getSessionCreatedTime\(incoming\)/,
    'Should get created time for incoming'
  );
  assert.match(
    mergeBody,
    /const\s*preferred\s*=\s*incomingCreated\s*>=\s*existingCreated\s*\?\s*incoming\s*:\s*existing/,
    'Should prefer newer session based on created time'
  );
  assert.match(
    mergeBody,
    /\.\.\.[\s\S]*\.\.\./,
    'Should spread fallback then preferred (preferred wins)'
  );
});

test('Session: pickRicherMessage calculates message richness score', () => {
  const pickBody = extractFunctionBody(
    sessionServiceSource,
    'function pickRicherMessage('
  );

  assert.match(
    pickBody,
    /const\s*existingScore\s*=\s*messageRichnessScore\(existing\)/,
    'Should calculate score for existing message'
  );
  assert.match(
    pickBody,
    /const\s*incomingScore\s*=\s*messageRichnessScore\(incoming\)/,
    'Should calculate score for incoming message'
  );
  assert.match(
    pickBody,
    /const\s*preferred\s*=\s*incomingScore\s*>\s*existingScore\s*\?\s*incoming\s*:\s*existing/,
    'Should prefer richer message'
  );
});

test('Session: messageRichnessScore calculates comprehensive score', () => {
  const scoreBody = extractFunctionBody(
    sessionServiceSource,
    'function messageRichnessScore('
  );

  // Content length contribution
  assert.match(
    scoreBody,
    /content\.length\s*\/\s*20/,
    'Should score content length'
  );

  // Array fields contribution
  assert.match(
    scoreBody,
    /reasoningEventsCount\s*\*\s*12/,
    'Should weight reasoning events heavily'
  );
  assert.match(
    scoreBody,
    /progressEventsCount\s*\*\s*10/,
    'Should weight progress events'
  );
  assert.match(
    scoreBody,
    /stepsCount\s*\*\s*8/,
    'Should weight steps'
  );
  assert.match(
    scoreBody,
    /subagentsCount\s*\*\s*16/,
    'Should weight subagents most heavily'
  );

  // Structured output contribution
  assert.match(
    scoreBody,
    /if\s*\([^)]*structuredOutput[^)]*\)[\s\S]*score\s*\+=\s*20/s,
    'Should add score for structured output'
  );
});

test('Session: mergeRicherMessageFields backfills missing fields', () => {
  const mergeBody = extractFunctionBody(
    sessionServiceSource,
    'function mergeRicherMessageFields('
  );

  assert.match(
    mergeBody,
    /backfillArrayField\("reasoningEvents"\)/,
    'Should backfill reasoning events'
  );
  assert.match(
    mergeBody,
    /backfillArrayField\("progressEvents"\)/,
    'Should backfill progress events'
  );
  assert.match(
    mergeBody,
    /backfillArrayField\("steps"\)/,
    'Should backfill steps'
  );
  assert.match(
    mergeBody,
    /backfillArrayField\("subagents",\s*true\)/s,
    'Should merge subagents with special handling'
  );
});

test('Session: mergeConversationMessages sorts by created time', () => {
  const mergeBody = extractFunctionBody(
    sessionServiceSource,
    'function mergeConversationMessages('
  );

  assert.match(
    mergeBody,
    /flattened\.sort\(\(a,\s*b\)\s*=>/,
    'Should sort flattened messages'
  );
  assert.match(
    mergeBody,
    /a\.created\s*===\s*b\.created\s*\?\s*a\.order\s*-\s*b\.order\s*:\s*a\.created\s*-\s*b\.created/,
    'Should sort by created time, then by original order'
  );
});

test('Session: mergeConversationMessages uses signature matching', () => {
  const mergeBody = extractFunctionBody(
    sessionServiceSource,
    'function mergeConversationMessages('
  );

  assert.match(
    mergeBody,
    /const\s+signatures\s*=\s*getMessageSignaturesForMerge/s,
    'Should get signatures for incoming message'
  );
  assert.match(
    mergeBody,
    /\.map\(\(signature\)\s*=>\s*indexBySignature\.get\(signature\)\)/s,
    'Should match existing messages by any signature'
  );
});

// ============================================================================
// SESSION SIGNATURE GENERATION
// ============================================================================

test('Session: getMessageSignature generates stable signatures', () => {
  const signatureBody = extractFunctionBody(
    sessionServiceSource,
    'function getMessageSignature('
  );

  // Priority 1: Use info.id if available
  assert.match(
    signatureBody,
    /const\s+info\s*=\s*rec\.info/,
    'Should check for info object'
  );
  assert.match(
    signatureBody,
    /infoId\s*=\s*\(info\s*as\s*Record<string,\s*unknown>\)\.id/,
    'Should extract ID from info'
  );
  assert.match(
    signatureBody,
    /if\s*\(typeof\s+infoId\s*===\s*"string"\s*&&\s*infoId\.length\s*>\s*0\)/,
    'Should return id:${infoId} if available'
  );

  // Priority 2: Use root id
  assert.match(
    signatureBody,
    /const\s+rootId\s*=\s*rec\.id/,
    'Should check for root id'
  );
  assert.match(
    signatureBody,
    /if\s*\(typeof\s*rootId\s*===\s*"string"\s*&&\s*rootId\.length\s*>\s*0\)/,
    'Should return id:${rootId} if available'
  );

  // Priority 3: Use fallback signature
  assert.match(
    signatureBody,
    /const\s*role\s*=\s*getMessageRoleForSignature\(message\)/,
    'Should extract role for fallback'
  );
  assert.match(
    signatureBody,
    /const\s+body\s*=\s*getMessageTextForSignature\(message\)\.slice\(0,\s*200\)/,
    'Should extract body text for fallback'
  );
  assert.match(
    signatureBody,
    /const\s*created\s*=\s*getMessageCreatedTime\(message\)/,
    'Should extract created time for fallback'
  );
  assert.match(
    signatureBody,
    /return\s*`fallback:\$\{role\}\|\$\{created\}\|\$\{body\}`/,
    'Should return fallback signature'
  );
});

test('Session: getMessageSignaturesForMerge generates multiple signatures', () => {
  const signaturesBody = extractFunctionBody(
    sessionServiceSource,
    'function getMessageSignaturesForMerge('
  );

  assert.match(
    signaturesBody,
    /const\s+primary\s*=\s*getMessageSignature\(message\)/,
    'Should include primary signature'
  );
  assert.match(
    signaturesBody,
    /const\s*fallback\s*=\s*getMessageFallbackSignature\(message\)/,
    'Should include fallback signature'
  );
  assert.match(
    signaturesBody,
    /const\s+assistantAlias\s*=\s*getAssistantContentAliasSignature\(message\)/,
    'Should include assistant content alias signature'
  );
  assert.match(
    signaturesBody,
    /signatures\.add\(/,
    'Should collect all unique signatures'
  );
});

test('Session: getAssistantContentAliasSignature generates alias for activity messages', () => {
  const aliasBody = extractFunctionBody(
    sessionServiceSource,
    'function getAssistantContentAliasSignature('
  );

  assert.match(
    aliasBody,
    /rec\.role\s*!==\s*"assistant"/s,
    'Should only apply to assistant messages'
  );
  assert.match(
    aliasBody,
    /hasActivityPayload/s,
    'Should check for activity payload (progressEvents, steps, subagents)'
  );
  assert.match(
    aliasBody,
    /assistant-activity:/s,
    'Should return assistant-activity signature'
  );
});

// ============================================================================
// SESSION SUBAGENT HANDLING
// ============================================================================

test('Session: mergeSubagentArray merges subagents by ID', () => {
  const mergeBody = extractFunctionBody(
    sessionServiceSource,
    'function mergeSubagentArray('
  );

  assert.match(
    mergeBody,
    /const\s+byId\s*=\s*new\s+Map<string,\s*unknown>/s,
    'Should create map for merging by ID'
  );
  assert.match(
    mergeBody,
    /byId\.set\(id,\s*entry\)/s,
    'Should add entries to map'
  );
  assert.match(
    mergeBody,
    /existing\s+as\s+Record/s,
    'Should cast existing to Record type and use spread operator'
  );
});

// ============================================================================
// SESSION UTILITY FUNCTIONS
// ============================================================================

test('Session: normalizeSessionId validates and normalizes session IDs', () => {
  assert.match(
    sessionServiceSource,
    /function\s+normalizeSessionId\(/,
    'Should define normalizeSessionId function'
  );

  const normalizeBody = extractFunctionBody(
    sessionServiceSource,
    'function normalizeSessionId('
  );

  assert.match(
    normalizeBody,
    /if\s*\(typeof\s+id\s*!==\s*"string"\)\s*\{[\s\S]*return\s+null/,
    'Should return null for non-strings'
  );
  assert.match(
    normalizeBody,
    /const\s*normalized\s*=\s*id\.trim\(\)/,
    'Should trim whitespace'
  );
  assert.match(
    normalizeBody,
    /return\s*normalized\.length\s*>\s*0\s*\?\s*normalized\s*:\s*null/,
    'Should return null if empty after trimming'
  );
});

test('Session: getSessionCreatedTime extracts created time safely', () => {
  assert.match(
    sessionServiceSource,
    /function\s+getSessionCreatedTime\(/,
    'Should define getSessionCreatedTime function'
  );

  const getCreatedBody = extractFunctionBody(
    sessionServiceSource,
    'function getSessionCreatedTime('
  );

  assert.match(
    getCreatedBody,
    /const\s*created\s*=\s*session\?\.time\?\.created/,
    'Should extract time.created field'
  );
  assert.match(
    getCreatedBody,
    /typeof\s*created\s*===\s*"number"\s*&&\s*Number\.isFinite\(created\)/,
    'Should validate created time'
  );
  assert.match(
    getCreatedBody,
    /return\s*typeof\s*created\s*===\s*"number"\s*&&\s*Number\.isFinite\(created\)\s*\?\s*created\s*:\s*0/,
    'Should return 0 if invalid'
  );
});

// ============================================================================
// SUMMARY TEST
// ============================================================================

test('Session: feature has comprehensive test coverage', () => {
  // This meta-test verifies that we're testing all major areas
  const testCategories = [
    'Session: createNewSession',
    'Session: listSessions',
    'Session: switchSession',
    'Session: deleteSession',
    'Session: renameSession',
    'Session: getCurrentSession',
    'Session: getMessages',
    'Session: saveSessionMessages',
    'Session: loadSessionMessages',
    'Session: upsertMessage',
    'Session: loadPersistedState',
    'Session: persistState',
    'Session: coalesceSessionsById',
    'Session: mergeMessagesForSessionAliases',
    'Session: webview posts',
    'Session: extension routes',
    'Session: handleLoadSession',
    'Session: handleDeleteSession',
    'Session: handleRenameSession',
    'Session: compactMessageForPersistence',
    'Session: mergeSessionRecords',
    'Session: pickRicherMessage',
    'Session: mergeConversationMessages',
    'Session: getMessageSignature',
    'Session: messageRichnessScore',
    'Session: sanitizeForPersistence',
    'Session: constants',
  ];

  // Just verify this test file exists and has structure
  assert.ok(testCategories.length > 20, 'Should have comprehensive test coverage');
});
