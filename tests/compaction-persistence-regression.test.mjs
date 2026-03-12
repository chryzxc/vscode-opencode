import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractFunctionBody,
  joinFromRoot,
  readSource,
} from './helpers/source-utils.mjs';

const storeSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);
const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);
const providerSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);
const shellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ChatShell.tsx')],
  'ChatShell.tsx',
);

test('store keeps compaction state when SET_SESSION_ID receives the same session id', () => {
  const reducerBody = extractFunctionBody(
    storeSource,
    'export function appReducer(state: AppState, action: AppAction): AppState',
  );

  assert.match(
    reducerBody,
    /case "SET_SESSION_ID":[\s\S]*if \(newId === state\.currentSessionId\) \{\s*return state;\s*\}/,
    'SET_SESSION_ID should early-return for identical IDs to avoid wiping persisted compaction UI state',
  );
});

test('store defines compaction divider reconciliation by message-id anchors and compacted timestamp', () => {
  assert.match(
    storeSource,
    /function resolveCompactionDividerIndex\(/,
    'store should define compaction divider reconciliation helper',
  );

  const resolverBody = extractFunctionBody(
    storeSource,
    'function resolveCompactionDividerIndex(',
  );

  assert.match(
    resolverBody,
    /compactionDividerAfterMessageId[\s\S]*findIndex[\s\S]*getMessageId\(message\) === compactionDividerAfterMessageId/s,
    'reconciliation should prefer divider-after message anchor when available',
  );
  assert.match(
    resolverBody,
    /compactionDividerBeforeMessageId[\s\S]*findIndex[\s\S]*getMessageId\(message\) === compactionDividerBeforeMessageId/s,
    'reconciliation should fall back to divider-before message anchor',
  );
  assert.match(
    resolverBody,
    /lastCompactedAt[\s\S]*createdAt >= compactedAt/s,
    'reconciliation should fall back to compacted timestamp when ids drift',
  );
});

test('SET_MESSAGES re-resolves compaction divider + anchors after history hydration', () => {
  const reducerBody = extractFunctionBody(
    storeSource,
    'export function appReducer(state: AppState, action: AppAction): AppState',
  );

  assert.match(
    reducerBody,
    /case "SET_MESSAGES":[\s\S]*resolveCompactionDividerIndex\(/,
    'SET_MESSAGES should recompute compaction divider from persisted anchors/timestamp',
  );
  assert.match(
    reducerBody,
    /case "SET_MESSAGES":[\s\S]*resolveCompactionDividerAnchors\(/,
    'SET_MESSAGES should refresh before\/after divider anchors for the current message list',
  );
});

test('compaction status reducer payload supports before/after message anchors', () => {
  assert.match(
    storeSource,
    /type: "SET_COMPACTION_STATUS"[\s\S]*compactionDividerBeforeMessageId\?: string;[\s\S]*compactionDividerAfterMessageId\?: string;/s,
    'SET_COMPACTION_STATUS payload should include divider anchor ids',
  );
  assert.match(
    storeSource,
    /type: "SET_COMPACTION_VIEW_STATE"[\s\S]*compactionDividerBeforeMessageId\?: string;[\s\S]*compactionDividerAfterMessageId\?: string;/s,
    'SET_COMPACTION_VIEW_STATE payload should include divider anchor ids',
  );
});

test('message handler parses compaction divider anchors and republishes reconciled state', () => {
  const createHandlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  assert.match(
    createHandlerBody,
    /case "compactionStatus"[\s\S]*compactionDividerBeforeMessageId: asOptionalString\([\s\S]*compactionDividerAfterMessageId: asOptionalString\(/s,
    'compactionStatus handler should parse divider anchors from provider payload',
  );
  assert.match(
    createHandlerBody,
    /normalizedStatus === "done"[\s\S]*vscode\.postMessage\(\{[\s\S]*type: "setCompactionViewState"[\s\S]*compactionDividerBeforeMessageId[\s\S]*compactionDividerAfterMessageId/s,
    'on compaction done, handler should persist reconciled divider anchors back to provider',
  );
});

test('provider compaction view state contract persists divider message anchors', () => {
  assert.match(
    providerSource,
    /type PersistedCompactionViewState = \{[\s\S]*compactionDividerBeforeMessageId\?: string;[\s\S]*compactionDividerAfterMessageId\?: string;[\s\S]*\}/s,
    'provider persisted compaction state should include divider anchor ids',
  );
  assert.match(
    providerSource,
    /normalizeCompactionViewState[\s\S]*compactionDividerBeforeMessageId[\s\S]*compactionDividerAfterMessageId/s,
    'provider normalization should retain divider anchor ids from workspace state',
  );
  assert.match(
    providerSource,
    /handleSetCompactionViewState[\s\S]*message\.compactionDividerBeforeMessageId[\s\S]*message\.compactionDividerAfterMessageId/s,
    'provider should accept divider anchors from webview setCompactionViewState updates',
  );
});

test('provider derives divider anchors when compacting and emits them in done status', () => {
  assert.match(
    providerSource,
    /resolveSessionCompactionDividerState\(/,
    'provider should define divider anchor resolver for session compaction',
  );
  assert.match(
    providerSource,
    /handleCompactSession[\s\S]*resolveSessionCompactionDividerState\(/,
    'compaction flow should resolve divider state before summarize call',
  );
  assert.match(
    providerSource,
    /postCompactionStatus\(\{[\s\S]*status: "done"[\s\S]*compactionDividerBeforeMessageId[\s\S]*compactionDividerAfterMessageId/s,
    'provider done status should include divider anchor ids for webview reconciliation',
  );
});

test('chat shell persists divider anchors when toggling compacted messages', () => {
  assert.match(
    shellSource,
    /type: "setCompactionViewState"[\s\S]*compactionDividerBeforeMessageId[\s\S]*compactionDividerAfterMessageId/s,
    'chat shell toggle should persist divider anchors instead of index-only state',
  );
});

test('compaction completion always clears stale in-progress UI state in message handler', () => {
  const createHandlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  assert.match(
    createHandlerBody,
    /asBoolean\(data\.processing,\s*false\)[\s\S]*type !== "compactionStatus"[\s\S]*type !== "compactionViewState"/s,
    'processing bootstrap should ignore compaction lifecycle messages',
  );
  assert.match(
    createHandlerBody,
    /case "compactionStatus"[\s\S]*if \(normalizedStatus !== "running"\) \{[\s\S]*SET_STEERING[\s\S]*SET_PROCESSING[\s\S]*FINISH_STREAMING[\s\S]*SET_STREAMING/s,
    'compaction done/error should hard-clear steering/processing/streaming state',
  );
});
