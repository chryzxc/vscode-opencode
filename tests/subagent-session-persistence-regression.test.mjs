import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);
const sessionServiceSource = readSource(
  [joinFromRoot('src', 'services', 'SessionService.ts')],
  'SessionService.ts',
);
const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('subagent snapshot hydration rebinds orphaned streaming parent IDs to hydrated assistant messages', () => {
  assert.match(
    messageHandlerSource,
    /function findLatestAssistantMessageIdForSession\(/,
    'message handler should define helper for resolving fallback assistant message id by session',
  );

  const syncBody = extractFunctionBody(
    messageHandlerSource,
    'function syncSubagentMapsIntoMessages(',
  );
  assert.match(
    syncBody,
    /findLatestAssistantMessageIdForSession\(\s*state\.messages,\s*fallbackSessionId,\s*targetSessionId,\s*\)/s,
    'subagent map sync should rebind orphaned parent ids using latest assistant message in the same session',
  );
  assert.match(
    syncBody,
    /effectiveSummariesByParentMessageId\[reboundParentMessageId\]\s*=\s*mergeSubagentSummaries\(/,
    'subagent map sync should merge rebound summaries under the hydrated message id key',
  );
});

test('session history merge waits for persisted-state initialization', () => {
  const listBody = extractFunctionBody(
    sessionServiceSource,
    'async listSessions(): Promise<Session[]>',
  );
  assert.match(
    listBody,
    /if\s*\(this\.initializationPromise\)\s*\{[\s\S]*await\s+this\.initializationPromise;[\s\S]*\}/,
    'listSessions should wait for persisted local state before merging with server sessions',
  );
});

test('spawned subagent list container is scrollable', () => {
  assert.match(
    messageComponentsSource,
    /max-h-\[320px\]\s+space-y-1\.5\s+overflow-y-auto\s+pr-1/,
    'subagent list container should cap height and provide vertical scrolling',
  );
});
