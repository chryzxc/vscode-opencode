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
  // Verify logic for generating chips from configured provider IDs returned by the SDK.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  assert.match(dropdownBody, /const\s+subscribedProviders\s*=\s*useMemo\(/, 'subscribedProviders should be memoized');
  assert.match(dropdownBody, /configuredProviders/, 'should read configuredProviders from app state');
  assert.match(dropdownBody, /if\s*\(!configuredProviders\s*\|\|\s*configuredProviders\.length\s*===\s*0\)\s*\{\s*return\s*\[\]/, 'should hide provider chips when no configured providers are available');
  assert.match(dropdownBody, /const\s+configuredProviderIds\s*=\s*new\s+Set\(\s*configuredProviders\.map\(\(id\)\s*=>\s*id\.toLowerCase\(\)\)\s*\)/, 'should normalize configured provider IDs from the SDK');
  assert.match(dropdownBody, /configuredProviderIds\.has\(providerId\)/, 'should use exact providerID matching against configured providers');
  assert.match(dropdownBody, /result\s*=\s*\[\s*["']OpenCode Free["'],\s*\.\.\.providers\s*\]/, 'should always prepend OpenCode Free chip');
  assert.match(dropdownBody, /self\.indexOf\(name\)\s*===\s*index/, 'should deduplicate provider chips');
  assert.match(dropdownBody, /\[availableModels,\s*configuredProviders\]/, 'subscribedProviders should react to availableModels and configuredProviders changes');
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
  assert.match(dropdownBody, /["']bg-oc-bg-soft oc-text-secondary hover:bg-oc-panel-soft hover:text-oc-text["']/, 'inactive chips should have subtle background');
});

test('model dropdown provides feedback when no models match filters', () => {
  // Verify empty state display within the popover.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  assert.match(dropdownBody, /grouped\.size\s*===\s*0\s*&&\s*\(/, 'empty state should render when grouped map is empty');
  assert.match(dropdownBody, /No models found/, 'empty state should show descriptive text');
});

test('model dropdown filters tabs by resolved providerName rather than legacy quota aliases', () => {
  // The current dropdown builds tabs from configured provider IDs plus available model provider names.
  // Filtering must continue to match against the visible providerName exposed by the model payload.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  assert.match(
    dropdownBody,
    /const\s+providerName\s*=\s*model\.providerName\s*\?\?\s*model\.providerID;/,
    'tab filtering should resolve the provider name from each model'
  );
  assert.match(
    dropdownBody,
    /providerName\.toLowerCase\(\)\s*===\s*selectedTab\.toLowerCase\(\)/,
    'tab filtering should match the selected tab against the resolved provider name'
  );
});

test('model dropdown suppresses only the exact opencode provider while preserving providers like OpenCode Go', () => {
  // Regression: SDK-backed configured providers can include OpenCode Go and similar names.
  // The dropdown must keep those tabs visible and only suppress the raw free-tier "opencode" provider ID.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  assert.match(
    dropdownBody,
    /return\s+providerId\s*!==\s*["']opencode["']/,
    'should exclude only the exact "opencode" provider ID'
  );
  assert.doesNotMatch(
    dropdownBody,
    /providerId\.includes\(["']opencode["']\)/,
    'should not exclude providers by substring match because that would hide OpenCode Go'
  );
});

test('model dropdown displays full model and agent names without truncation', () => {
  // FIX: Remove max-w constraints to show full provider/model names in chips.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  // Model chip: should render label in a flex container with truncate
  assert.match(
    dropdownBody,
    /<div[^>]*className="[^"]*flex items-center[^"]*"[^>]*>\s*<span[^>]*className="truncate"[^>]*>\{label\}<\/span>\s*<\/div>/,
    'model chip label should be in flex container with truncate for responsive display'
  );
});

test('agent dropdown displays full agent names without truncation', () => {
  // FIX: Remove max-w constraints to show full agent names in chips.
  const agentBody = extractFunctionBody(panelSource, 'export function AgentDropdown()');

  // Agent chip: should render label in a flex container with truncate
  assert.match(
    agentBody,
    /<div[^>]*className="[^"]*flex items-center[^"]*"[^>]*>\s*<span[^>]*className="truncate"[^>]*>\{label\}<\/span>\s*<\/div>/,
    'agent chip label should be in flex container with truncate for responsive display'
  );
});

test('model dropdown sorts models by provider and then by name', () => {
  // Verify sorting logic presence in the grouping memo.
  const dropdownBody = extractFunctionBody(panelSource, 'export function ModelDropdown()');

  assert.match(dropdownBody, /\.sort\(\(a,\s*b\)\s*=>\s*\{/, 'grouping memo should include sorting logic');
  assert.match(dropdownBody, /a\.providerName\s*\?\?\s*a\.providerID/, 'should compare provider names/IDs');
  assert.match(dropdownBody, /a\.name\.localeCompare\(b\.name\)/, 'should compare model names using localeCompare');
  assert.match(dropdownBody, /pA\.localeCompare\(pB\)/, 'should compare provider names using localeCompare');
});
