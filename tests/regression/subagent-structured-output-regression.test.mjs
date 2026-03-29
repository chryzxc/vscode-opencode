import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const handlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

const providerSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

test('structured subagents delta updates are merged into UI state', () => {
  assert.match(handlerSource, /subagentsDelta/, 'message handler should parse subagentsDelta payload');
  assert.match(handlerSource, /UPSERT_SUBAGENT_SUMMARIES/, 'subagentsDelta should upsert summary store');
  assert.match(handlerSource, /UPSERT_SUBAGENT_DETAIL/, 'subagentsDelta should upsert detail store');
  assert.match(
    handlerSource,
    /interactiveEvents\.length === 0[\s\S]*subagents\.length === 0[\s\S]*!subagentsDelta/,
    'normalizeStructuredOutput should not drop subagentsDelta-only payloads',
  );
});

test('subagent structured output falls back to compact summary text', () => {
  assert.match(providerSource, /subagentCount/, 'provider should compute subagent summary counts');
  assert.match(providerSource, /Spawned \$\{subagentCount\} subagent/, 'provider should emit compact summary text');
});
