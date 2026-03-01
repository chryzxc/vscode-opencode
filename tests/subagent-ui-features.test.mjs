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
  assert.match(messageSource, /setExpandedSubagentId\(\s*prev\s*=>\s*prev\s*===\s*subagentId\s*\?\s*null\s*:\s*subagentId\s*\)/, 'Should use local state for expansion');
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
  assert.match(messageSource, /as SubagentDetail\)\.childSessionId/, 'Should cast detailData to SubagentDetail for childSessionId');
  assert.match(messageSource, /as SubagentDetail\)\.thinkingEvents/, 'Should cast detailData to SubagentDetail for thinkingEvents');
  assert.match(messageSource, /as SubagentDetail\)\.progressEvents/, 'Should cast detailData to SubagentDetail for progressEvents');
  assert.match(messageSource, /as SubagentDetail\)\.timelineEvents/, 'Should cast detailData to SubagentDetail for timelineEvents');
});

test('SubagentProgressPopover is integrated into the subagent item loop', () => {
  assert.match(messageSource, /<SubagentProgressPopover/, 'AssistantMessage should use SubagentProgressPopover');
  assert.match(messageSource, /subagentDetail=\{subagentDetailsById\?\.\[subagent\.id\]\}/, 'Should pass subagent detail to the popover');
  
  // Verify popover component structure
  assert.match(messageSource, /export\s+function\s+SubagentProgressPopover/, 'SubagentProgressPopover should be an exported component');
  assert.match(messageSource, /<Popover\.Root>/, 'Popover should use Radix Popover.Root');
  assert.match(messageSource, /Latest activity/, 'Popover should show "Latest activity" header');
  assert.match(messageSource, /Progress/, 'Popover should show "Progress" header');
});

test('subagent color differentiation is applied deterministically', () => {
  assert.match(messageSource, /function\s+getSubagentColor/, 'Should have getSubagentColor helper');
  assert.match(messageSource, /colorClass=\{getSubagentColor\(subagent\.id\)\}/, 'Should pass subagent color to the popover');
  assert.match(messageSource, /className=\{cn\(".*",\s*getSubagentColor\(subagent\.id\)\)\}/, 'Should apply color via getSubagentColor to icon and text');
});

test('subagent sessions are filtered out of History Sidebar', () => {
  assert.match(panelSource, /sessionsList\.filter\(s\s*=>\s*!s\.parentSessionId\)/, 'Should filter sessionsList by !parentSessionId');
});

