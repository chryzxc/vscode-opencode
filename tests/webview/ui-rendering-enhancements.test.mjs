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

test('AssistantMessage renders structured activityDetail chips and diff excerpt component', () => {
  assert.match(
    messageComponentsSource,
    /event\.activityDetail\.tool/,
    'Activity detail panel should render tool chip when provided'
  );
  assert.match(
    messageComponentsSource,
    /event\.activityDetail\.command/,
    'Activity detail panel should render command chip when provided'
  );
  assert.match(
    messageComponentsSource,
    /event\.activityDetail\.query/,
    'Activity detail panel should render query chip when provided'
  );
  assert.match(
    messageComponentsSource,
    /<ActivityDiffExcerpt\s+excerpt=\{event\.activityDetail\.diffExcerpt\}/,
    'Activity detail panel should render unified diff excerpts via ActivityDiffExcerpt'
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
    /formatDuration\(subagent\.durationMs\s*\?\?\s*\d+\)/,
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

test('AssistantMessage renders activity source badges and toggles internal rows into the same stepper', () => {
  assert.match(
    messageComponentsSource,
    /event\.source === "raw_debug"\s*\?\s*"raw"\s*:\s*event\.source/,
    'Activity rows should render compact provenance badges (stream/final/raw)',
  );
  assert.match(
    messageComponentsSource,
    /\bshowInternalActivity\b.*internalDisplayEvents/s,
    'Timeline should track internal activity events',
  );
  assert.match(
    messageComponentsSource,
    /viewState\.showInternalActivity/,
    'Timeline controls should reference showInternalActivity state',
  );
});

test('AssistantMessage renders unified stepper reasoning rows and raw-debug parse status', () => {
  assert.match(
    messageComponentsSource,
    /if \(block\.kind === "thinking"\)[\s\S]*kind:\s*"reasoning"/,
    'Display event builder should convert thinking blocks into reasoning rows for the unified stepper',
  );
  assert.match(
    messageComponentsSource,
    /event\.kind === "activity".*"uppercase"/,
    'Reasoning rows should keep a human label while activity labels remain uppercase',
  );
  assert.match(
    messageComponentsSource,
    /Raw Response.*Debug/,
    'Raw response panel should be displayed',
  );
  assert.match(
    messageComponentsSource,
    /hasRawResponseDebug/,
    'Raw response visibility should be controlled',
  );
});
