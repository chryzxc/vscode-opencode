import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from './helpers/source-utils.mjs';

const chatShellSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ChatShell.tsx')],
  'ChatShell.tsx',
);
const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);
const messageSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('chat shell does not mount subagents panel in right rail anymore', () => {
  assert.doesNotMatch(chatShellSource, /<SubagentsPanel\s*\/>/, 'SubagentsPanel should be completely removed from right rail');
});

test('assistant messages render spawned agents section', () => {
  assert.match(messageSource, /subagents\.length > 0/, 'assistant card should check for spawned agents');
  assert.match(messageSource, /toggleSubagentDetails\(/, 'assistant subagent rows should be able to toggle details inline');
});

test('subagents inline list shows row details and timeline drilldown', () => {
  assert.match(messageSource, /formatDurationMs\(subagent\.durationMs\)/, 'subagent rows should include elapsed time');
  assert.match(messageSource, /subagent\.providerID && subagent\.modelID/, 'subagent rows should include provider/model fields');
  assert.match(messageSource, /subagent\.latestActivity/, 'subagent rows should include latest activity');
  assert.match(messageSource, /Timeline \(\{.*timelineEvents\.length\}\)/, 'subagent inline details should include timeline events');
});
