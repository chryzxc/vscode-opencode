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
import { joinFromRoot, readSource } from './helpers/source-utils.mjs';

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
  // Verify rendering of added lines
  assert.match(
    messageComponentsSource,
    /event\.diffStats\.added\s*>\s*0\s*&&\s*\([\s\S]*?\s*<span.*>\+{event\.diffStats\.added}<\/span>[\s\S]*?\)/,
    'Should render +N for added lines'
  );

  // Verify rendering of deleted lines
  assert.match(
    messageComponentsSource,
    /event\.diffStats\.deleted\s*>\s*0\s*&&\s*\([\s\S]*?\s*<span.*>-{event\.diffStats\.deleted}<\/span>[\s\S]*?\)/,
    'Should render -M for deleted lines'
  );

  assert.match(
    messageComponentsSource,
    /text-oc-green.*event\.diffStats\.added/,
    'Added lines should use green text'
  );

  assert.match(
    messageComponentsSource,
    /text-oc-red.*event\.diffStats\.deleted/,
    'Deleted lines should use red text'
  );
});

test('SubagentProgressPopover component is declared and uses Radix UI', () => {
  assert.match(
    messageComponentsSource,
    /export\s+function\s+SubagentProgressPopover/,
    'SubagentProgressPopover should be declared'
  );

  assert.match(
    messageComponentsSource,
    /import\s+\*\s+as\s+Popover\s+from\s+["']@radix-ui\/react-popover["']/,
    'Should import Radix UI Popover'
  );

  assert.match(messageComponentsSource, /<Popover\.Root>/, 'Should use Popover.Root');
  assert.match(messageComponentsSource, /<Popover\.Trigger/, 'Should use Popover.Trigger');
  assert.match(messageComponentsSource, /<Popover\.Content/, 'Should use Popover.Content');
});

test('AssistantMessage utilizes SubagentProgressPopover for agent rendering', () => {
  assert.match(
    messageComponentsSource,
    /<SubagentProgressPopover[\s\S]*?subagent=\{subagent\}[\s\S]*?subagentDetail=\{subagentDetailsById\?\.\[subagent\.id\]\}/,
    'AssistantMessage should use SubagentProgressPopover with subagent and detail props'
  );

  assert.match(
    messageComponentsSource,
    /subagent\.latestActivity\s*\|\|\s*["']Initializing\.\.\.["']/,
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
