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

test('chat shell mounts subagents panel in desktop right rail', () => {
  assert.match(chatShellSource, /<SubagentsPanel\s*\/>/, 'right panel should mount SubagentsPanel');
  assert.match(chatShellSource, /<ActiveTaskPanel\s*\/>[\s\S]*<SubagentsPanel\s*\/>[\s\S]*<QuotaMonitor\s*\/>/, 'SubagentsPanel should be rendered between ActiveTaskPanel and QuotaMonitor');
});

test('assistant messages render spawned agents section', () => {
  assert.match(messageSource, /Spawned Agents \(\{subagents\.length\}\)/, 'assistant card should show Spawned Agents section');
  assert.match(messageSource, /openSubagentDetails\(/, 'assistant subagent rows should open details');
  assert.match(messageSource, /jumpToMessage\(/, 'assistant subagent rows should support message jump');
});

test('subagents panel shows balanced row details and timeline drilldown', () => {
  assert.match(panelSource, /export function SubagentsPanel\(/, 'SubagentsPanel component should be implemented');
  assert.match(panelSource, /formatDurationMs\(subagent\.durationMs\)/, 'subagent rows should include elapsed time');
  assert.match(panelSource, /subagent\.providerID && subagent\.modelID/, 'subagent rows should include provider\/model fields');
  assert.match(panelSource, /subagent\.latestActivity/, 'subagent rows should include latest activity');
  assert.match(panelSource, /Timeline \(\{selectedDetail\.timelineEvents\.length\}\)/, 'subagent details should include timeline events');
});
