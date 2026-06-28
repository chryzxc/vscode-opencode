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
  // Subagent delta update handling has been refactored into the centralized message processing system
  assert.match(
    handlerSource,
    /subagentsDelta|mergeSubagent|UPSERT_SUBAGENT/,
    'message handler should handle subagent delta updates',
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
