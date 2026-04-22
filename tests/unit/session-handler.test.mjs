import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts')],
  'SessionHandler.ts',
);

test('handleGetSessions versions requests, filters to top-level sessions, and deduplicates payloads by fingerprint', () => {
  const body = extractFunctionBody(
    source,
    'async handleGetSessions(): Promise<void> {',
  );

  assert.match(body, /this\.sessionsListRequestVersion \+= 1;/, 'handleGetSessions should increment a request version counter');
  assert.match(body, /const currentVersion = this\.sessionsListRequestVersion;/, 'handleGetSessions should capture the active request version');
  assert.match(body, /const sessionIds = new Set\([\s\S]*session\.id\.trim\(\)[\s\S]*\);/, 'handleGetSessions should build a normalized set of known session ids');
  assert.match(body, /const topLevelSessions = sessions\.filter\([\s\S]*session\.parentSessionId[\s\S]*session\.parentID[\s\S]*return !sessionIds\.has\(parentSessionId\);[\s\S]*\);/, 'handleGetSessions should filter out child sessions unless their parent is missing or self-referential');
  assert.match(body, /const fingerprint = JSON\.stringify\(sessionsPayload\);[\s\S]*if \(fingerprint === this\.lastSessionsPayloadFingerprint\) \{[\s\S]*return;/, 'handleGetSessions should suppress duplicate session payloads');
  assert.match(body, /if \(currentVersion !== this\.sessionsListRequestVersion\) \{[\s\S]*return;/, 'handleGetSessions should ignore stale responses from older requests');
  assert.match(body, /this\.postMessage\(\{[\s\S]*type: "sessionsList",[\s\S]*sessions: sessionsPayload,[\s\S]*\}\);/, 'handleGetSessions should post the normalized sessions list to the webview');
});

test('processing session updates are emitted as sessionsListUpdate messages', () => {
  const body = extractFunctionBody(
    source,
    'sendProcessingSessionsUpdate(): void {',
  );

  assert.match(body, /this\.postMessage\(\{[\s\S]*type: "sessionsListUpdate",[\s\S]*processingSessionIds: Array\.from\(this\.processingSessionIds\),[\s\S]*\}\);/, 'sendProcessingSessionsUpdate should publish the current processing session id set');
});

test('handleLoadSession guards reentry, restores session state, and posts chatHistory before updating current session', () => {
  const body = extractFunctionBody(
    source,
    'async handleLoadSession(message: { sessionId: string }): Promise<void> {',
  );

  assert.match(body, /if \(this\.processingSessionIds\.has\(sessionId\)\) \{[\s\S]*this\.logger\.warn\("Session already loading", \{ sessionId \}\);[\s\S]*return;/, 'handleLoadSession should guard against duplicate concurrent loads');
  assert.match(body, /this\.processingSessionIds\.add\(sessionId\);[\s\S]*this\.sendProcessingSessionsUpdate\(\);/, 'handleLoadSession should mark the session as processing before work starts');
  assert.match(body, /await this\.sessionService\.switchSession\(sessionId\);/, 'handleLoadSession should switch the backing SessionService first');
  assert.match(body, /const rawMessages = await this\.sessionService\.loadSessionMessages\(sessionId\);/, 'handleLoadSession should load persisted session messages');
  assert.match(body, /await this\.historyProcessor\.processHistoryMessages\(rawMessages, sessionId\)/, 'handleLoadSession should process loaded history through HistoryProcessor');
  assert.match(body, /await this\.subagentPersistence\.syncSubagentSnapshotForSession\(sessionId, messages\);/, 'handleLoadSession should hydrate persisted subagent state');
  assert.match(body, /await this\.compactionManager\.sendPersistedCompactionViewState\(sessionId\);/, 'handleLoadSession should restore compaction view state');
  assert.match(body, /await this\.modelAndAgentManager\.applySessionSettings\(sessionId\);/, 'handleLoadSession should restore session-scoped model and agent settings');
  assert.match(body, /this\.postMessage\(\{[\s\S]*type: "chatHistory",[\s\S]*sessionId,[\s\S]*messages,[\s\S]*\}\);[\s\S]*this\.setCurrentSessionId\(sessionId\);/, 'handleLoadSession should post chatHistory before mutating the current session id');
  assert.match(body, /finally \{[\s\S]*this\.processingSessionIds\.delete\(sessionId\);[\s\S]*this\.sendProcessingSessionsUpdate\(\);[\s\S]*\}/, 'handleLoadSession should always clear processing state and notify the webview');
  assert.doesNotMatch(body, /type:\s*"initState"/, 'handleLoadSession should not emit initState from this load path');
});

test('handleDeleteSession clears persisted state, unsets the active session, and refreshes the session list', () => {
  const body = extractFunctionBody(
    source,
    'async handleDeleteSession(sessionId: string): Promise<void> {',
  );

  assert.match(body, /await this\.sessionService\.deleteSession\(sessionId\);/, 'handleDeleteSession should delegate deletion to SessionService');
  assert.match(body, /await this\.subagentPersistence\.clearPersistedSubagentSnapshot\(sessionId\);/, 'handleDeleteSession should clear persisted subagent snapshots');
  assert.match(body, /await this\.compactionManager\.clearPersistedCompactionViewState\(sessionId\);/, 'handleDeleteSession should clear persisted compaction state');
  assert.match(body, /if \(currentSessionId === sessionId\) \{[\s\S]*this\.setCurrentSessionId\(undefined\);[\s\S]*\}/, 'handleDeleteSession should unset the active session when deleting it');
  assert.match(body, /await this\.handleGetSessions\(\);/, 'handleDeleteSession should refresh the session list after cleanup');
});

test('handleRenameSession delegates rename and refreshes the rendered session list', () => {
  const body = extractFunctionBody(
    source,
    'async handleRenameSession(sessionId: string, newTitle: string): Promise<void> {',
  );

  assert.match(body, /if \(!sessionId \|\| !newTitle\) \{[\s\S]*return;/, 'handleRenameSession should bail out on missing input');
  assert.match(body, /await this\.sessionService\.renameSession\(sessionId, newTitle\);/, 'handleRenameSession should delegate the rename operation to SessionService');
  assert.match(body, /await this\.handleGetSessions\(\);/, 'handleRenameSession should refresh the sessions list after renaming');
  assert.doesNotMatch(body, /this\.setCurrentSessionId\(/, 'handleRenameSession should not change the active session id while renaming');
});
