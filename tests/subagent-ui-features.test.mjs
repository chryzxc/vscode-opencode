import test from 'node:test';
import assert from 'node:assert/strict';
import { joinFromRoot, readSource } from './helpers/source-utils.mjs';

const messageSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('subagent inline expansion logic uses toggleSubagentDetails', () => {
  assert.match(messageSource, /const\s+toggleSubagentDetails\s*=\s*\(subagentId:\s*string\)\s*=>/, 'Should have toggleSubagentDetails function');
  assert.match(messageSource, /setExpandedSubagentId\s*\(\s*\(prev\)\s*=>\s*\{[\s\S]*?prev\s*===\s*subagentId\s*\?\s*null\s*:\s*subagentId[\s\S]*?\}\s*\)/, 'Should use local state for expansion');
  assert.match(messageSource, /onClick={\(\)\s*=>\s*toggleSubagentDetails\(subagent\.id\)}/, 'Should call toggleSubagentDetails on click');
});

test('token usage tooltips are descriptive', () => {
  assert.match(messageSource, /title="Tokens in system prompt \+ conversation history \+ your message"/, 'Should have descriptive tooltip for prompt tokens');
  assert.match(messageSource, /title="Tokens generated in this reply"/, 'Should have descriptive tooltip for response tokens');
  assert.match(messageSource, /title="Tokens retrieved from prompt cache"/, 'Should have descriptive tooltip for cache read');
  assert.match(messageSource, /title="New tokens written to prompt cache"/, 'Should have descriptive tooltip for cache write');
});

test('diffStats are rendered in progress events', () => {
  assert.match(messageSource, /event\.diffStats\s*&&\s*\(event\.diffStats\.added\s*>\s*0\s*\|\|\s*event\.diffStats\.deleted\s*>\s*0\)/, 'Should check for diffStats');
  assert.match(messageSource, /text-oc-green">\s*\+{event\.diffStats\.added}\s*<\/span>/, 'Should render added lines');
  assert.match(messageSource, /text-oc-red">\s*-{event\.diffStats\.deleted}\s*<\/span>/, 'Should render deleted lines');
});

test('AssistantMessage component types subagent data to SubagentDetail', () => {
  assert.match(messageSource, /const\s+detailData\s*=\s*\(subagentDetailsById\[selected\.id\]\s+as\s+SubagentDetail\s*\|\s*undefined\)\s*\|\|/, 'Should normalize selected detailData to SubagentDetail shape');
  assert.match(messageSource, /detailData\.childSessionId/, 'Should use typed detailData childSessionId');
  assert.match(messageSource, /detailData\.thinkingEvents\?\.length/, 'Should use typed detailData thinkingEvents');
  assert.match(messageSource, /detailData\.progressEvents\?\.length/, 'Should use typed detailData progressEvents');
  assert.match(messageSource, /detailData\.timelineEvents\?\.length/, 'Should use typed detailData timelineEvents');
});

test('SubagentProgressPopover is integrated into the subagent item loop', () => {
  assert.match(messageSource, /<SubagentProgressPopover/, 'AssistantMessage should use SubagentProgressPopover');
  assert.match(messageSource, /subagentDetail=\{subagentDetailsById\?\.\[subagent\.id\]\}/, 'Should pass subagent detail to the popover');
  
  // Verify popover component structure
  assert.match(messageSource, /export\s+function\s+SubagentProgressPopover/, 'SubagentProgressPopover should be an exported component');
  assert.match(messageSource, /<Popover\.Root>/, 'Popover should use Radix Popover.Root');
  assert.match(messageSource, /Latest activity/, 'Popover should show "Latest activity" header');
  assert.match(messageSource, /Recent Steps/, 'Popover should show "Recent Steps" header');
});

test('subagent color differentiation is applied deterministically', () => {
  assert.match(messageSource, /function\s+getSubagentColor/, 'Should have getSubagentColor helper');
  assert.match(messageSource, /const\s+statusClass\s*=\s*getSubagentColor\(subagent\.id\)/, 'Should derive deterministic subagent status color once per row');
  assert.match(messageSource, /colorClass=\{statusClass\}/, 'Should pass derived subagent color to the popover');
  assert.match(messageSource, /cn\("truncate text-oc-xs font-semibold",\s*getSubagentColor\(selected\.id\)\)/, 'Should apply deterministic color to selected detail header');
});

test('subagent sessions are filtered out of History Sidebar', () => {
  assert.match(panelSource, /sessionsList\.filter\(\(?s\)?\s*=>\s*!s\.parentSessionId\)/, 'Should filter sessionsList by !parentSessionId');
});
