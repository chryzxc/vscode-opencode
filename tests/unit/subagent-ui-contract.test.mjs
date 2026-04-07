import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readAllSources, readSource } from '../helpers/source-utils.mjs';

const chatShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ChatShell.tsx')],
  'ChatShell.tsx',
);
const messageSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);
const providerSource = readAllSources([joinFromRoot('src', 'providers', 'ChatViewProvider.ts'), joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts'), joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts'), joinFromRoot('src', 'providers', 'chat', 'PlanManager.ts'), joinFromRoot('src', 'providers', 'chat', 'SubagentPersistence.ts'), joinFromRoot('src', 'providers', 'chat', 'CompactionManager.ts'), joinFromRoot('src', 'providers', 'chat', 'DiagnosticsLogger.ts'), joinFromRoot('src', 'providers', 'chat', 'QueueManager.ts'), joinFromRoot('src', 'providers', 'chat', 'StreamEventHandler.ts'), joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts'), joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts')],
  'ChatViewProvider.ts',
);
const handlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

test('chat shell does not mount subagents panel in right rail anymore', () => {
  assert.doesNotMatch(chatShellSource, /<SubagentsPanel\s*\/>/, 'SubagentsPanel should be completely removed from right rail');
});

test('assistant messages render spawned agents section', () => {
  assert.match(messageSource, /subagents\.length > 0/, 'assistant card should check for spawned agents');
  assert.match(messageSource, /Spawned Subagents/, 'assistant card should show a dedicated spawned-subagents section title');
  assert.match(messageSource, /openSubagentModal\(/, 'assistant subagent rows should open modal details');
});

test('subagents inline list shows row details and timeline drilldown', () => {
  assert.match(messageSource, /formatDurationMs\(subagent\.durationMs\)/, 'subagent rows should include elapsed time');
  assert.match(messageSource, /providerLabel/, 'selected subagent detail should include provider/model fields');
  assert.match(messageSource, /subagent\.latestActivity/, 'subagent rows should include latest activity');
  const modalSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'SubagentDetailModal.tsx')],
    'SubagentDetailModal.tsx',
  );
  assert.match(
    modalSource,
    /Timeline \(\{detail\.timelineEvents\?\.length \|\| 0\}\)/,
    'subagent modal details should include timeline events'
  );
});

test('structured output supports subagents type and normalization', () => {
  const schemaSource = readSource(
    [joinFromRoot('src', 'shared', 'structuredOutputSchema.ts')],
    'structuredOutputSchema.ts',
  );
  assert.match(schemaSource, /subagent/i, 'schema should include subagent-related content');
  assert.match(providerSource, /subagent|normalize|sanitize/i, 'provider should normalize subagent payloads');
  assert.match(handlerSource, /subagent|delta|normalize/i, 'frontend handler should handle subagent data');
});
