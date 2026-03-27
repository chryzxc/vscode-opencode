import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

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
  assert.match(dropdownBody, /key\s*===\s*["']openai["']\)\s*return\s*["']OpenAI["']/, 'should normalize OpenAI provider name exactly');
  assert.match(dropdownBody, /key\s*===\s*["']zai["']\)\s*return\s*["']Z\.ai["']/, 'should normalize Z.ai provider name exactly');
  assert.match(dropdownBody, /key\.includes\("opencode"\)\)\s*return\s*null/, 'should ignore raw opencode platform in mapped providers');
  assert.match(dropdownBody, /result\s*=\s*\[\s*["']OpenCode Free["'],\s*\.\.\.providers\s*\]/, 'should always prepend OpenCode Free chip');
  assert.match(dropdownBody, /self\.indexOf\(name\)\s*===\s*index/, 'should deduplicate provider chips');
  assert.match(dropdownBody, /\[quotaData\]/, 'subscribedProviders should react to quotaData change');
});

test('model dropdown groups and filters models based on selected tab', () => {
  // Verify filtering logic integrated into the grouping memo.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  assert.match(dropdownBody, /if\s*\(selectedTab\s*!==\s*"All"\)/, 'grouping memo should check if a specific tab is selected');
  assert.match(dropdownBody, /if\s*\(selectedTab\s*===\s*["']OpenCode Free["']\)\s*\{[\s\S]*return\s*model\.providerID\s*===\s*["']opencode["']/, 'should filter specifically for opencode models when tab is selected');
  assert.match(dropdownBody, /providerName\.toLowerCase\(\)\s*===\s*selectedTab\.toLowerCase\(\)/, 'should use exact match for provider tab filtering');
  assert.match(dropdownBody, /\[availableModels,\s*modelSearchQuery,\s*selectedTab\]/, 'grouping memo should react to tab changes');
});

test('model dropdown renders filter chips when subscriptions are present', () => {
  // Verify conditional rendering of the chip bar.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  assert.match(dropdownBody, /subscribedProviders\.length\s*>\s*0/, 'chip bar should render only if providers exist');
  assert.match(dropdownBody, /\[\s*["']All["'],\s*\.\.\.\s*subscribedProviders\s*\]\s*\.map\(/, 'should render All chip plus subscription chips');
  assert.match(dropdownBody, /onClick=\{\(\)\s*=>\s*setSelectedTab\(tab\)\}/, 'chip click should update selectedTab');
});

test('model dropdown shows active state on selected filter chip', () => {
  // Verify styling based on tab state.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  assert.match(dropdownBody, /selectedTab\s*===\s*tab[\s\S]*\?[\s\S]*["']bg-oc-accent text-white["']/, 'selected chip should have accent background');
  assert.match(dropdownBody, /["']bg-oc-bg-soft text-oc-text-muted[\s\S]*hover:bg-oc-panel-soft["']/, 'inactive chips should have subtle background');
});

test('model dropdown provides feedback when no models match filters', () => {
  // Verify empty state display within the popover.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  assert.match(dropdownBody, /grouped\.size\s*===\s*0\s*&&\s*\(/, 'empty state should render when grouped map is empty');
  assert.match(dropdownBody, /No models found/, 'empty state should show descriptive text');
});

test('model dropdown normalizes both google and google-gemini-cli platforms to Google', () => {
  // FIX: Both "google" and "google-gemini-cli" platforms should map to a single "Google" tab.
  // This prevents duplicate tabs and ensures models appear under the correct provider.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  // Verify that both google platforms are explicitly mapped to "Google"
  assert.match(
    dropdownBody,
    /if\s*\(\s*key\s*===\s*["']google["']\s*\|\|\s*key\s*===\s*["']google-gemini-cli["']\s*\)\s*return\s*["']Google["']/,
    'both "google" and "google-gemini-cli" should be normalized to "Google"'
  );
});

test('model dropdown displays full model and agent names without truncation', () => {
  // FIX: Remove max-w constraints to show full provider/model names in chips.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  // Model chip: should not have truncate or max-w classes on the label span
  assert.match(
    dropdownBody,
    /<span[^>]*className="opacity-60">Model<\/span>\s*<span[^>]*>\{label\}<\/span>/,
    'model chip label should not have truncate or max-width constraints'
  );

  // Verify the label span specifically does NOT have truncate or max-w classes
  const modelLabelMatch = dropdownBody.match(
    /<span[^>]*className="opacity-60">Model<\/span>\s*<span[^>]*>\{label\}<\/span>/
  );
  assert(modelLabelMatch, 'model label structure should be present');
  const labelSpan = modelLabelMatch[0];
  assert(!labelSpan.includes('truncate'), 'model label should not have truncate class');
  assert(!labelSpan.includes('max-w-'), 'model label should not have max-width constraint');
});

test('agent dropdown displays full agent names without truncation', () => {
  // FIX: Remove max-w constraints to show full agent names in chips.
  const agentBody = extractFunctionBody(panelSource, 'export function AgentDropdown()');

  // Agent chip: should not have truncate or max-w classes on the label span
  assert.match(
    agentBody,
    /<span[^>]*className="opacity-60">Agent<\/span>\s*<span[^>]*>\{label\}<\/span>/,
    'agent chip label should not have truncate or max-width constraints'
  );

  // Verify the label span specifically does NOT have truncate or max-w classes
  const agentLabelMatch = agentBody.match(
    /<span[^>]*className="opacity-60">Agent<\/span>\s*<span[^>]*>\{label\}<\/span>/
  );
  assert(agentLabelMatch, 'agent label structure should be present');
  const labelSpan = agentLabelMatch[0];
  assert(!labelSpan.includes('truncate'), 'agent label should not have truncate class');
  assert(!labelSpan.includes('max-w-'), 'agent label should not have max-width constraint');
});

test('model dropdown sorts models by provider and then by name', () => {
  // Verify sorting logic presence in the grouping memo.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  assert.match(dropdownBody, /\.sort\(\(a,\s*b\)\s*=>\s*\{/, 'grouping memo should include sorting logic');
  assert.match(dropdownBody, /a\.providerName\s*\?\?\s*a\.providerID/, 'should compare provider names/IDs');
  assert.match(dropdownBody, /a\.name\.localeCompare\(b\.name\)/, 'should compare model names using localeCompare');
  assert.match(dropdownBody, /pA\.localeCompare\(pB\)/, 'should compare provider names using localeCompare');
});
