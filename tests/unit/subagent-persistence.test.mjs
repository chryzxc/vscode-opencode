import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'SubagentPersistence.ts')],
  'SubagentPersistence.ts',
);

test('SubagentPersistence derives per-session snapshot keys and normalizes payload maps', () => {
  const keyBody = extractFunctionBody(
    source,
    'getSubagentSnapshotStorageKey(sessionId: string): string {',
  );
  const normalizeBody = extractFunctionBody(
    source,
    'normalizeSubagentPayload(',
  );

  assert.match(
    source,
    /private static readonly SUBAGENT_SNAPSHOT_PREFIX\s*=\s*"opencode\.session\.subagents\.";/,
    'SubagentPersistence should define a dedicated storage prefix for persisted subagent snapshots',
  );
  assert.match(
    keyBody,
    /return `\$\{SubagentPersistence\.SUBAGENT_SNAPSHOT_PREFIX\}\$\{sessionId\}`;/,
    'getSubagentSnapshotStorageKey should append the session ID to the snapshot prefix',
  );
  assert.match(
    normalizeBody,
    /const rec = this\.asRecord\(payload\) \|\| \{\};/,
    'normalizeSubagentPayload should treat unknown payloads as records',
  );
  assert.match(
    normalizeBody,
    /const summariesByParentMessageId =\s*this\.asRecord\(rec\.summariesByParentMessageId\) \|\| \{\};/,
    'normalizeSubagentPayload should normalize summariesByParentMessageId through asRecord',
  );
  assert.match(
    normalizeBody,
    /const detailsById = this\.asRecord\(rec\.detailsById\) \|\| \{\};/,
    'normalizeSubagentPayload should normalize detailsById through asRecord',
  );
  assert.match(
    normalizeBody,
    /return \{[\s\S]*summariesByParentMessageId:[\s\S]*detailsById:[\s\S]*\};/,
    'normalizeSubagentPayload should return a typed payload containing summary and detail maps',
  );
});

test('SubagentPersistence merges summaries and detail records across payload updates', () => {
  const mergeBody = extractFunctionBody(
    source,
    'mergeSubagentPayloads(',
  );

  assert.match(
    mergeBody,
    /const parentMessageIds = new Set<string>\(\[[\s\S]*Object\.keys\(existingSummaries\),[\s\S]*Object\.keys\(incomingSummaries\),[\s\S]*\]\);/,
    'mergeSubagentPayloads should merge summary keys from both existing and incoming payloads',
  );
  assert.match(
    mergeBody,
    /const merged = this\.mergeSubagentEntries\([\s\S]*existingSummaries\[parentMessageId\][\s\S]*incomingSummaries\[parentMessageId\]/,
    'mergeSubagentPayloads should delegate summary entry merging to mergeSubagentEntries',
  );
  assert.match(
    mergeBody,
    /if \(merged\.length > 0\) \{[\s\S]*mergedSummaries\[parentMessageId\] = merged;/,
    'mergeSubagentPayloads should keep only non-empty merged summary arrays',
  );
  assert.match(
    mergeBody,
    /const detailIds = new Set<string>\(\[[\s\S]*Object\.keys\(existingDetails\),[\s\S]*Object\.keys\(incomingDetails\),[\s\S]*\]\);/,
    'mergeSubagentPayloads should merge detail IDs from both payload snapshots',
  );
  assert.match(
    mergeBody,
    /mergedDetails\[detailId\] = \{[\s\S]*\.\.\.prev,[\s\S]*\.\.\.next,[\s\S]*id: this\.firstNonEmptyString\(next\.id, prev\.id, detailId\) \|\| detailId,[\s\S]*\};/,
    'mergeSubagentPayloads should prefer newer detail fields while preserving a stable id fallback chain',
  );
});

test('SubagentPersistence loads, saves, clears, and incrementally persists snapshot state', () => {
  const loadBody = extractFunctionBody(
    source,
    'async loadPersistedSubagentSnapshot(',
  );
  const saveBody = extractFunctionBody(
    source,
    'async savePersistedSubagentSnapshot(',
  );
  const clearBody = extractFunctionBody(
    source,
    'async clearPersistedSubagentSnapshot(',
  );
  const persistBody = extractFunctionBody(
    source,
    'async persistSubagentLiveState(',
  );

  assert.match(
    loadBody,
    /const raw = this\.workspaceState\.get<unknown>\([\s\S]*this\.getSubagentSnapshotStorageKey\(sessionId\)/,
    'loadPersistedSubagentSnapshot should read persisted state from workspaceState using the session key',
  );
  assert.match(
    loadBody,
    /const normalized = this\.normalizeSubagentPayload\(raw\);[\s\S]*Object\.keys\(normalized\.summariesByParentMessageId \|\| \{\}\)\.length > 0 \|\|[\s\S]*Object\.keys\(normalized\.detailsById \|\| \{\}\)\.length > 0/,
    'loadPersistedSubagentSnapshot should return null when normalized payloads contain no entries',
  );
  assert.match(
    saveBody,
    /await this\.workspaceState\.update\([\s\S]*this\.getSubagentSnapshotStorageKey\(sessionId\),[\s\S]*payload,[\s\S]*\);/,
    'savePersistedSubagentSnapshot should persist payloads with workspaceState.update',
  );
  assert.match(
    clearBody,
    /await this\.workspaceState\.update\([\s\S]*this\.getSubagentSnapshotStorageKey\(sessionId\),[\s\S]*undefined,[\s\S]*\);/,
    'clearPersistedSubagentSnapshot should clear persisted state by writing undefined',
  );
  assert.match(
    persistBody,
    /const existing = await this\.loadPersistedSubagentSnapshot\(sessionId\);[\s\S]*const merged = existing[\s\S]*\? this\.mergeSubagentPayloads\(existing, payload\)[\s\S]*: payload;/,
    'persistSubagentLiveState should merge incoming payloads with existing persisted state when present',
  );
  assert.match(
    persistBody,
    /await this\.savePersistedSubagentSnapshot\(sessionId, merged\);[\s\S]*return merged;/,
    'persistSubagentLiveState should save and return the merged snapshot payload',
  );
});

test('SubagentPersistence builds message-derived payloads with normalized summaries and detail arrays', () => {
  const buildBody = extractFunctionBody(
    source,
    'buildSubagentPayloadFromMessage(',
  );

  assert.match(
    buildBody,
    /const message = this\.asRecord\(messageRaw\);[\s\S]*if \(!message\) \{[\s\S]*return null;/,
    'buildSubagentPayloadFromMessage should ignore non-record message payloads',
  );
  assert.match(
    buildBody,
    /const messageId = this\.firstNonEmptyString\([\s\S]*info\?\.id,[\s\S]*message\.id,[\s\S]*message\.messageID,[\s\S]*\);/,
    'buildSubagentPayloadFromMessage should resolve message IDs from info.id, id, or messageID',
  );
  assert.match(
    buildBody,
    /const subagentsRaw = Array\.isArray\(message\.subagents\)[\s\S]*if \(!messageId \|\| subagentsRaw\.length === 0\) \{[\s\S]*return null;/,
    'buildSubagentPayloadFromMessage should require both a message id and subagent array before building snapshots',
  );
  assert.match(
    buildBody,
    /status: this\.normalizeSubagentStatus\(subagent\.status\),[\s\S]*latestActivity:[\s\S]*this\.firstNonEmptyString\([\s\S]*subagent\.latestActivity,[\s\S]*subagent\.description,[\s\S]*\) \|\| "Subagent update",/,
    'buildSubagentPayloadFromMessage should normalize status and derive latestActivity with a description fallback',
  );
  assert.match(
    buildBody,
    /if \(!Array\.isArray\(normalized\.references\)\) \{[\s\S]*normalized\.references = \[\];[\s\S]*if \(!Array\.isArray\(normalized\.progressEvents\)\) \{[\s\S]*normalized\.progressEvents = \[\];[\s\S]*if \(!Array\.isArray\(normalized\.timelineEvents\)\) \{[\s\S]*normalized\.timelineEvents = \[\];/,
    'buildSubagentPayloadFromMessage should normalize missing references and event arrays to empty arrays',
  );
  assert.match(
    buildBody,
    /return \{[\s\S]*summariesByParentMessageId: \{[\s\S]*\[messageId\]: summaries[\s\S]*\} as SubagentUpdatePayload\["summariesByParentMessageId"\],[\s\S]*detailsById: detailsById as SubagentUpdatePayload\["detailsById"\],[\s\S]*\};/,
    'buildSubagentPayloadFromMessage should return summary and detail maps keyed by parent message id and subagent id',
  );
  assert.doesNotMatch(
    buildBody,
    /detailsById: \{\}/,
    'buildSubagentPayloadFromMessage should not return an always-empty details map when summaries were collected',
  );
});

test('SubagentPersistence syncs tracker state with persisted snapshots and cached session messages', () => {
  const updateSnapshotBody = extractFunctionBody(
    source,
    'async persistSubagentUpdateSnapshot(',
  );
  const syncBody = extractFunctionBody(
    source,
    'async syncSubagentSnapshotForSession(',
  );

  assert.match(
    updateSnapshotBody,
    /const summariesMap = this\.asRecord\(payload\.summariesByParentMessageId\) \|\| \{\};[\s\S]*const parentMessageIds = Object\.keys\(summariesMap\)\.filter\(Boolean\);/,
    'persistSubagentUpdateSnapshot should derive parent message ids from the summaries map',
  );
  assert.match(
    updateSnapshotBody,
    /const sessionId =\s*this\.resolveSubagentPayloadSessionId\(payload\) \|\| currentSessionId;/,
    'persistSubagentUpdateSnapshot should prefer the session id resolved from the payload over the current session fallback',
  );
  assert.match(
    updateSnapshotBody,
    /const normalizedPayload = this\.normalizeSubagentPayload\(payload\);[\s\S]*await this\.persistSubagentLiveState\(sessionId, normalizedPayload\);/,
    'persistSubagentUpdateSnapshot should normalize and persist live subagent state before mutating cached messages',
  );
  assert.match(
    updateSnapshotBody,
    /const incomingSubagents = this\.hydrateSubagentsFromPayload\([\s\S]*const mergedSubagents = this\.mergeSubagentEntries\([\s\S]*subagents: mergedSubagents,/,
    'persistSubagentUpdateSnapshot should hydrate incoming subagents into cached messages and merge them with existing cards',
  );
  assert.match(
    updateSnapshotBody,
    /if \(!hasChanges\) \{[\s\S]*return;[\s\S]*await sessionService\.saveSessionMessages\(sessionId, nextMessages\);/,
    'persistSubagentUpdateSnapshot should avoid rewriting cached history unless one of the messages actually changed',
  );
  assert.match(
    syncBody,
    /this\.subagentTracker\.resetForSession\(sessionId\);[\s\S]*this\.subagentTracker\.seedFromMessages\(messages\);[\s\S]*const trackerSnapshot = this\.subagentTracker\.getSnapshotPayload\(\);/,
    'syncSubagentSnapshotForSession should rebuild tracker state from the current session message history',
  );
  assert.match(
    syncBody,
    /const persistedSnapshot =\s*await this\.loadPersistedSubagentSnapshot\(sessionId\);[\s\S]*const mergedSnapshot = persistedSnapshot[\s\S]*\? this\.mergeSubagentPayloads\(persistedSnapshot, trackerSnapshot\)[\s\S]*: trackerSnapshot;/,
    'syncSubagentSnapshotForSession should merge persisted live state with a fresh tracker snapshot',
  );
  assert.match(
    syncBody,
    /await this\.savePersistedSubagentSnapshot\(sessionId, mergedSnapshot\);[\s\S]*return mergedSnapshot;/,
    'syncSubagentSnapshotForSession should persist and return the merged snapshot payload',
  );
});
