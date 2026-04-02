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

test('structured output supports explicit subagents response type and extraction', () => {
  const schemaSource = readSource(
    [joinFromRoot('src', 'shared', 'structuredOutputSchema.ts')],
    'structuredOutputSchema.ts',
  );
  assert.match(schemaSource, /"subagents"/, 'schema should allow subagents responseType');
  assert.match(providerSource, /subagentsRaw\s*=\s*sanitizedCanonicalRec\.subagents\s*\?\?\s*\(rec\.spawnedSubagents/, 'provider should normalize subagents from structured output payload');
  assert.match(providerSource, /subagentsDelta/, 'provider should normalize subagentsDelta payloads');
  assert.match(providerSource, /Spawned \$\{subagentCount\} subagent/, 'provider should emit compact summary text for subagents');
  assert.match(handlerSource, /subagentsRaw\s*=\s*sanitizedRec\.subagents\s*\?\?\s*\(rec\.spawnedSubagents/, 'frontend handler should normalize structured subagents payload');
  assert.match(handlerSource, /rec\.subagentsDelta\s*\?\?\s*rec\.subagents_delta/, 'frontend handler should normalize subagentsDelta payload');
  assert.match(handlerSource, /normalizeSubagentProgressEvents/, 'frontend handler should normalize structured subagent progress events');
  assert.match(handlerSource, /normalizeSubagentThinkingEvents/, 'frontend handler should normalize structured subagent thinking events');
  assert.match(handlerSource, /normalizeSubagentTimelineEvents/, 'frontend handler should normalize structured subagent timeline events');
  assert.match(handlerSource, /UPSERT_SUBAGENT_SUMMARIES/, 'handler should push structured subagents into subagent summary store');
  assert.match(handlerSource, /structuredOutput\.subagentsDelta\.parentMessageId\s*\|\|\s*messageId/, 'handler should fall back to current messageId for subagent delta updates');
  assert.match(handlerSource, /subagentsDelta/, 'handler should support subagentsDelta payloads');
});
