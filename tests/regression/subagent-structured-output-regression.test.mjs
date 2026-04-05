import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource, readAllSources } from '../helpers/source-utils.mjs';

const handlerSource = readAllSources(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

const providerSource = readSource(
  [
    joinFromRoot('src', 'providers', 'ChatViewProvider.ts'),
    joinFromRoot('src', 'providers', 'chat', 'DiagnosticsLogger.ts'),
    joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts'),
    joinFromRoot('src', 'providers', 'chat', 'PlanManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'SubagentPersistence.ts'),
    joinFromRoot('src', 'providers', 'chat', 'CompactionManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts'),
    joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'QueueManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts'),
    joinFromRoot('src', 'providers', 'chat', 'StreamEventHandler.ts'),
    joinFromRoot('src', 'providers', 'chat', 'types.ts')
  ],
  'ChatViewProvider.ts',
);

test('structured subagents delta updates are merged into UI state', () => {
  assert.match(handlerSource, /subagentsDelta/, 'message handler should parse subagentsDelta payload');
  assert.match(handlerSource, /UPSERT_SUBAGENT_SUMMARIES/, 'subagentsDelta should upsert summary store');
  assert.match(handlerSource, /UPSERT_SUBAGENT_DETAIL/, 'subagentsDelta should upsert detail store');
  assert.match(
    handlerSource,
    /function\s+mergeSubagentSummaryPayload\(/,
    'subagent summary updates should merge with existing entries instead of replacing rendered rows',
  );
  assert.match(
    handlerSource,
    /function\s+mergeSubagentDetailPayload\(/,
    'subagent detail updates should merge with existing timeline/progress state',
  );
  assert.match(
    handlerSource,
    /interactiveEvents\.length === 0[\s\S]*subagents\.length === 0[\s\S]*!subagentsDelta/,
    'normalizeStructuredOutput should not drop subagentsDelta-only payloads',
  );
});

test('empty subagent snapshots do not clobber already-rendered subagent UI', () => {
  assert.match(
    handlerSource,
    /hasExistingRenderedSubagents[\s\S]*break;/,
    'snapshot handler should keep existing subagent cards when incoming snapshot has no normalized entries',
  );
});

test('subagent structured output falls back to compact summary text', () => {
  assert.match(providerSource, /subagentCount/, 'provider should compute subagent summary counts');
  assert.match(providerSource, /Spawned \$\{subagentCount\} subagent/, 'provider should emit compact summary text');
});
