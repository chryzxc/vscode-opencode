import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

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
});
