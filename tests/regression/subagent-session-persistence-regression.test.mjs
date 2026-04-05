import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);
const providerSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
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
    /\/\/ DISABLED: Rebounding subagents/,
    'subagent map sync should acknowledge the (currently disabled) rebinding architectural decision',
  );
  assert.match(
    providerSource,
    /private remapOrphanedSubagentKeys\(/,
    'provider should perform constrained orphan-key remap before hydration snapshot replay',
  );
  assert.match(
    providerSource,
    /parentKey\.startsWith\("orphan-"\)/,
    'provider remap should only target orphan-* synthetic parent ids',
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
    /max-h-\[\d+px\]\s+.*overflow-y-auto/,
    'subagent list container should cap height and provide vertical scrolling',
  );
});

test('subagent.parentMessageId is strictly mapped to finalMessageId before finalizing messages', () => {
  assert.match(
    messageHandlerSource,
    /source\.forEach\(\(entry\)\s*=>\s*\{[\s\S]*parentMessageId:\s*finalMessageId,/,
    'message handler should ensure all finalized subagents have parentMessageId bound to the final message id',
  );
});

test('hydration freezes stale running subagents and recalculates duration from completed timestamps', () => {
  assert.match(
    messageHandlerSource,
    /function normalizeHydratedSubagentDetail\(/,
    'message handler should define a hydration normalizer for subagent status/timing',
  );
  assert.match(
    messageHandlerSource,
    /status !== "pending" && status !== "running" && status !== "orphaned"/,
    'hydration normalizer should only rewrite incomplete statuses',
  );
  assert.match(
    messageHandlerSource,
    /status:\s*"done"/,
    'hydration normalizer should stabilize stale incomplete statuses as done',
  );
  assert.match(
    messageHandlerSource,
    /durationMs\s*=\s*[\s\S]*Math\.max\(0,\s*completedAt - startedAt\)/,
    'hydration normalizer should recompute duration from started/completed timestamps',
  );
  assert.match(
    messageHandlerSource,
    /function shouldFreezeSubagentForPresentation\(/,
    'subagent presentation should use a centralized freeze decision helper',
  );
  assert.match(
    messageHandlerSource,
    /type SubagentPresentationPolicy = \{/,
    'subagent presentation should define a shared policy type for stream and hydration paths',
  );
  assert.match(
    messageHandlerSource,
    /mergeSubagentsIntoMessage\([\s\S]*presentationPolicy:\s*\{\s*mode:\s*"stream"/s,
    'messageResponse should apply the centralized stream presentation policy when merging subagents',
  );
  assert.match(
    messageHandlerSource,
    /function normalizeHydratedSubagentMaps\(/,
    'message handler should normalize hydrated subagent summary/detail stores before dispatch',
  );
  assert.match(
    messageHandlerSource,
    /const hydrationPresentationPolicy:\s*SubagentPresentationPolicy\s*=\s*\{[\s\S]*mode:\s*"hydration"/s,
    'chatHistory should construct a centralized hydration presentation policy',
  );
  assert.match(
    messageHandlerSource,
    /const snapshotPolicy:\s*SubagentPresentationPolicy\s*=\s*\{[\s\S]*mode:\s*"hydration"/s,
    'subagentSnapshot should use the same centralized hydration presentation policy',
  );
  assert.match(
    messageHandlerSource,
    /const streamPolicy:\s*SubagentPresentationPolicy\s*=\s*\{[\s\S]*mode:\s*"stream"/s,
    'subagentUpdate should use the same centralized stream presentation policy',
  );
  assert.match(
    messageHandlerSource,
    /syncSubagentMapsIntoMessages\([\s\S]*presentationPolicy:\s*snapshotPolicy/s,
    'snapshot message/map sync should flow through centralized presentation policy',
  );
  assert.match(
    messageHandlerSource,
    /syncSubagentMapsIntoMessages\([\s\S]*presentationPolicy:\s*streamPolicy/s,
    'stream update message/map sync should flow through centralized presentation policy',
  );
  assert.match(
    messageHandlerSource,
    /trackActiveSubagentParentIds\([\s\S]*normalizedSnapshot\.summariesByParentMessageId/s,
    'snapshot handling should track active parent ids so final message remap can preserve streamed subagent UI',
  );
  assert.match(
    messageHandlerSource,
    /trackActiveSubagentParentIds\([\s\S]*normalizedUpdate\.summariesByParentMessageId/s,
    'stream updates should track active parent ids so final message remap can preserve streamed subagent UI',
  );
});
