import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('model dropdown manages tab selection state', () => {
  // Verify state initialization and reset logic.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  assert.match(dropdownBody, /const\s+\[selectedTab,\s*setSelectedTab\]\s*=\s*useState\("All"\)/, 'model dropdown should initialize selectedTab state to "All"');
  assert.match(dropdownBody, /if\s*\(!modelDropdownOpen\)\s*\{[\s\S]*setSelectedTab\("All"\)/, 'model dropdown should reset tab to "All" when opening/closing');
});

test('model dropdown derives subscribed providers from quota platforms', () => {
  // Verify logic for generating chips from subscription data.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  assert.match(dropdownBody, /const\s+subscribedProviders\s*=\s*useMemo\(/, 'subscribedProviders should be memoized');
  assert.match(dropdownBody, /key\s*===\s*["["']]openai["["']]\)\s*return\s*["["']]OpenAI["["']]/, 'should normalize OpenAI provider name exactly');
  assert.match(dropdownBody, /key\s*===\s*["["']]zai["["']]\)\s*return\s*["["']]Z\.ai["["']]/, 'should normalize Z.ai provider name exactly');
  assert.match(dropdownBody, /key\.includes\("opencode"\)\)\s*return\s*null/, 'should ignore raw opencode platform in mapped providers');
  assert.match(dropdownBody, /result\s*=\s*\[\s*["["']]OpenCode Free["["']],\s*\.\.\.providers\s*\]/, 'should always prepend OpenCode Free chip');
  assert.match(dropdownBody, /self\.indexOf\(name\)\s*===\s*index/, 'should deduplicate provider chips');
  assert.match(dropdownBody, /\[quotaData\]/, 'subscribedProviders should react to quotaData change');
});

test('model dropdown groups and filters models based on selected tab', () => {
  // Verify filtering logic integrated into the grouping memo.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  assert.match(dropdownBody, /if\s*\(selectedTab\s*!==\s*"All"\)/, 'grouping memo should check if a specific tab is selected');
  assert.match(dropdownBody, /if\s*\(selectedTab\s*===\s*["["']]OpenCode Free["["']]\)\s*\{[\s\S]*return\s*model\.providerID\s*===\s*["["']]opencode["["']]/, 'should filter specifically for opencode models when tab is selected');
  assert.match(dropdownBody, /providerName\.toLowerCase\(\)\s*===\s*selectedTab\.toLowerCase\(\)/, 'should use exact match for provider tab filtering');
  assert.match(dropdownBody, /\[availableModels,\s*modelSearchQuery,\s*selectedTab\]/, 'grouping memo should react to tab changes');
});

test('model dropdown renders filter chips when subscriptions are present', () => {
  // Verify conditional rendering of the chip bar.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  assert.match(dropdownBody, /subscribedProviders\.length\s*>\s*0/, 'chip bar should render only if providers exist');
  assert.match(dropdownBody, /\[\s*["["']]All["["']],\s*\.\.\.\s*subscribedProviders\s*\]\s*\.map\(/, 'should render All chip plus subscription chips');
  assert.match(dropdownBody, /onClick=\{\(\)\s*=>\s*setSelectedTab\(tab\)\}/, 'chip click should update selectedTab');
});

test('model dropdown shows active state on selected filter chip', () => {
  // Verify styling based on tab state.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  assert.match(dropdownBody, /selectedTab\s*===\s*tab[\s\S]*\?[\s\S]*["["']]bg-oc-accent text-white["["']]/, 'selected chip should have accent background');
  assert.match(dropdownBody, /["["']]bg-oc-bg-soft text-oc-text-muted[\s\S]*hover:bg-oc-panel-soft["["']]/, 'inactive chips should have subtle background');
});

test('model dropdown provides feedback when no models match filters', () => {
  // Verify empty state display within the popover.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  assert.match(dropdownBody, /grouped\.size\s*===\s*0\s*&&\s*\(/, 'empty state should render when grouped map is empty');
  assert.match(dropdownBody, /No models found/, 'empty state should show descriptive text');
});
