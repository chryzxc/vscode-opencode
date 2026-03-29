/**
 * UI Rendering Enhancements Tests
 * 
 * Verifies rendering of:
 * - Diff stats (+N/-M) in progress steps
 * - Subagent progress popover (Radix UI)
 * - Raw data schema updates
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('ProgressItem type includes diffStats field', () => {
  assert.match(
    messageComponentsSource,
    /type\s+ProgressItem\s*=\s*\{[\s\S]*?diffStats\?\s*:\s*{\s*added\s*:\s*number\s*;\s*deleted\s*:\s*number\s*}/,
    'ProgressItem type should include optional diffStats field'
  );
});

test('progressItemsFromSteps extracts diffStats from steps', () => {
  assert.match(
    messageComponentsSource,
    /diffStats\s*:\s*["']diffStats["']\s+in\s+step\s+\?\s*\(step\.diffStats\s+as\s+\{\s*added\s*:\s*number\s*;\s*deleted\s*:\s*number\s*\}\)\s*:\s*undefined/,
    'Should extract diffStats from step using "in" guard'
  );
});

test('AssistantMessage renders diff stats when present', () => {
  assert.match(
    messageComponentsSource,
    /event\.diffStats\s*&&\s*\(event\.diffStats\.added\s*>\s*0\s*\|\|\s*event\.diffStats\.deleted\s*>\s*0\)/,
    'Should gate diff badges behind event.diffStats presence'
  );

  assert.match(
    messageComponentsSource,
    /\+\{event\.diffStats\.added\}/,
    'Should render +N for added lines'
  );

  assert.match(
    messageComponentsSource,
    /-\{event\.diffStats\.deleted\}/,
    'Should render -M for deleted lines'
  );

  assert.match(
    messageComponentsSource,
    /text-oc-green[\s\S]*event\.diffStats\.added/,
    'Added lines should use green text'
  );

  assert.match(
    messageComponentsSource,
    /text-oc-red[\s\S]*event\.diffStats\.deleted/,
    'Deleted lines should use red text'
  );
});

test('AssistantMessage falls back to message edits diff stats for edit steps', () => {
  assert.match(
    messageComponentsSource,
    /const\s+fallbackEdit\s*=\s*Array\.isArray\(message\?\.edits\)/,
    'Should resolve a fallback edit record from message.edits'
  );
  assert.match(
    messageComponentsSource,
    /const\s+fallbackDiffStats\s*=/,
    'Should create fallback diff stats from edit record'
  );
  assert.match(
    messageComponentsSource,
    /const\s+diffStats\s*=\s*event\.diffStats\s*\|\|\s*fallbackDiffStats/,
    'Should use fallback diff stats when step diff stats are missing'
  );
  assert.match(
    messageComponentsSource,
    /diffStats\.added\s*>\s*0/,
    'Should render fallback +N added count'
  );
  assert.match(
    messageComponentsSource,
    /diffStats\.deleted\s*>\s*0/,
    'Should render fallback -M deleted count'
  );
});

test('Subagent detail rendering uses inline rows and modal (not popovers)', () => {
  assert.doesNotMatch(
    messageComponentsSource,
    /SubagentProgressPopover/,
    'Legacy SubagentProgressPopover should no longer be used'
  );
  assert.doesNotMatch(
    messageComponentsSource,
    /@radix-ui\/react-popover/,
    'Subagent rendering should no longer depend on Radix Popover'
  );
  assert.match(
    messageComponentsSource,
    /import\s+\{\s*SubagentDetailModal\s*\}\s+from\s+["']\.\/SubagentDetailModal["']/,
    'AssistantMessage should import SubagentDetailModal'
  );
  assert.match(
    messageComponentsSource,
    /<SubagentDetailModal[\s\S]*detail=\{detailData\}/,
    'AssistantMessage should render SubagentDetailModal with normalized detail data'
  );
});

test('AssistantMessage subagent rows render activity and open detail modal', () => {
  assert.match(
    messageComponentsSource,
    /Spawned Subagents/,
    'AssistantMessage should render a spawned-subagents section'
  );
  assert.match(
    messageComponentsSource,
    /onClick=\{\(\)\s*=>\s*openSubagentModal\(subagent\.id\)\}/,
    'Subagent rows should open the detail modal'
  );
  assert.match(
    messageComponentsSource,
    /formatDurationMs\(subagent\.durationMs\)/,
    'Subagent rows should render per-agent duration'
  );

  assert.match(
    messageComponentsSource,
    /subagent\.latestActivity\s*\|\|[\s\S]*statusText\s*\|\|\s*["']Initializing\.\.\.["']/,
    'Should show activity or Initializing fallback'
  );
});

test('Raw data rendering handles typed edits', () => {
  assert.match(
    messageComponentsSource,
    /edits\s*:\s*message\.edits\?\.map\(\(file\s*:\s*\{\s*file\s*:\s*string\s*\}\)\s*=>\s*file\.file\)/,
    'Raw data edits mapping should use explicit typing'
  );
});
