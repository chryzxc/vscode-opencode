import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const trackerSource = readSource(
  [joinFromRoot('src', 'services', 'SubagentTracker.ts')],
  'SubagentTracker.ts',
);
const chatProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

test('subagent tracker correlates subtask parts with child sessions', () => {
  assert.match(trackerSource, /partType === "subtask"/, 'tracker should detect subtask parts');
  assert.match(trackerSource, /handleSessionCreated\(/, 'tracker should handle session.created events');
  assert.match(trackerSource, /pendingSubtasksByParentSessionId/, 'tracker should keep pending subtask correlation state');
});

test('subagent tracker hydrates from session.children and child session messages', () => {
  const finalizeBody = extractFunctionBody(
    trackerSource,
    'async finalizeParentMessage(',
  );

  assert.match(finalizeBody, /childrenFn/, 'finalize flow should call session.children for hydration');
  assert.match(finalizeBody, /hydrateChildSessionMessages/, 'finalize flow should hydrate child session message metadata');
});

test('chat provider emits subagent update/snapshot payloads', () => {
  assert.match(chatProviderSource, /new SubagentTracker\(/, 'provider should create a subagent tracker');
  assert.match(chatProviderSource, /type:\s*"subagentUpdate"/, 'provider should post incremental subagent updates');
  assert.match(chatProviderSource, /type:\s*"subagentSnapshot"/, 'provider should post subagent snapshots on session load/ready');
  assert.match(chatProviderSource, /finalizeParentMessage\(/, 'provider should finalize/hydrate subagents before persisting assistant messages');
  assert.match(chatProviderSource, /persistSubagentUpdateSnapshot\(/, 'provider should persist subagent deltas while streaming so cards survive reloads/session switches');
  assert.match(chatProviderSource, /getLatestParentMessageId\(/, 'provider should fall back to tracker parent message id when final response omits id');
  assert.match(chatProviderSource, /persistSubagentLiveState\(/, 'provider should persist a live subagent sidecar state independent of raw message history');
  assert.match(chatProviderSource, /loadPersistedSubagentSnapshot\(/, 'provider should restore persisted subagent live state when reloading a session');
  assert.match(chatProviderSource, /buildSubagentPayloadFromMessage\(/, 'provider should extract subagent cards from assistant snapshots for sidecar persistence');
});

test('subagent live sidecar snapshot is keyed per session and restored on load', () => {
  assert.match(
    chatProviderSource,
    /SUBAGENT_SNAPSHOT_PREFIX\s*=\s*"opencode\.session\.subagents\."/,
    'provider should define a dedicated workspaceState prefix for per-session subagent sidecar snapshots',
  );

  const keyBody = extractFunctionBody(
    chatProviderSource,
    'private getSubagentSnapshotStorageKey(sessionId: string): string',
  );
  assert.match(
    keyBody,
    /SUBAGENT_SNAPSHOT_PREFIX\}\$\{sessionId\}/,
    'sidecar storage key helper should append the session id to the dedicated prefix',
  );

  const syncBody = extractFunctionBody(
    chatProviderSource,
    'private async syncSubagentSnapshotForSession(',
  );
  assert.match(
    syncBody,
    /loadPersistedSubagentSnapshot\(sessionId\)/,
    'session snapshot sync should load persisted subagent sidecar state',
  );
  assert.match(
    syncBody,
    /mergeSubagentPayloads\(persistedSnapshot,\s*trackerSnapshot\)/,
    'session snapshot sync should merge persisted sidecar state with tracker-derived snapshot',
  );
  assert.match(
    syncBody,
    /savePersistedSubagentSnapshot\(sessionId,\s*mergedSnapshot\)/,
    'session snapshot sync should write back merged sidecar state for future reloads',
  );
});

test('subagent live sidecar persists on stream updates and assistant snapshot saves', () => {
  const persistUpdateBody = extractFunctionBody(
    chatProviderSource,
    'private async persistSubagentUpdateSnapshot(payload: {',
  );
  assert.match(
    persistUpdateBody,
    /const normalizedPayload = this\.normalizeSubagentPayload\(payload\);/,
    'stream-update persistence should normalize subagent payload before storing sidecar state',
  );
  assert.match(
    persistUpdateBody,
    /await this\.persistSubagentLiveState\(sessionId,\s*normalizedPayload\);/,
    'stream-update persistence should write normalized live state into sidecar storage',
  );

  const receiveBody = extractFunctionBody(
    chatProviderSource,
    'case "persistAssistantMessage":',
  );
  assert.match(
    receiveBody,
    /buildSubagentPayloadFromMessage\(\s*message\.message,\s*sessionId,\s*\)/,
    'persistAssistantMessage should derive subagent sidecar payload from assistant message snapshots',
  );
  assert.match(
    receiveBody,
    /persistSubagentLiveState\(\s*sessionId\s*,\s*snapshotFromMessage\s*,?\s*\)/,
    'persistAssistantMessage should persist derived subagent snapshot into live sidecar storage',
  );

  const sendBody = extractFunctionBody(
    chatProviderSource,
    'private async handleSendMessage(',
  );
  assert.match(
    sendBody,
    /await this\.persistSubagentLiveState\(\s*session\.id\s*,\s*snapshotFromFinalMessage\s*,?\s*\)/,
    'final assistant response flow should persist derived sidecar snapshot for reload/session-switch durability',
  );
});

test('subagent live sidecar cleanup runs on session create/delete transitions', () => {
  const createCaseBody = extractFunctionBody(
    chatProviderSource,
    'case "newSession":',
  );
  assert.match(
    createCaseBody,
    /clearPersistedSubagentSnapshot\(createdSession\.id\)/,
    'new session flow should clear stale sidecar state for the newly created session',
  );

  const deleteBody = extractFunctionBody(
    chatProviderSource,
    'private async handleDeleteSession(sessionId: string): Promise<void>',
  );
  assert.match(
    deleteBody,
    /await this\.clearPersistedSubagentSnapshot\(\s*sessionId\s*,?\s*\);/,
    'delete session flow should remove persisted subagent sidecar snapshot for that session id',
  );
});
