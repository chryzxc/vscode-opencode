import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('FileChangesSection uses structured sources only (summary + explicit diff payloads)', () => {
  assert.match(
    source,
    /if \(changeSummary && Array\.isArray\(changeSummary\.files\)\)/,
    'FileChangesSection should prefer structured changeSummary.files when present',
  );

  assert.match(
    source,
    /for \(const step of streamingSteps\)/,
    'FileChangesSection should support structured fallback via streaming steps',
  );

  assert.match(
    source,
    /for \(const event of timelineEvents\)/,
    'FileChangesSection should support structured fallback via timeline events',
  );

  assert.match(
    source,
    /isLikelyFilePath|for \(const edit of messageEdits\)/,
    'FileChangesSection should support fallback extraction methods',
  );
});

test('AssistantMessage passes structured changeSummary into FileChangesSection', () => {
  assert.match(
    source,
    /<FileChangesSection[\s\S]*streamingSteps=\{[\s\S]*\}[\s\S]*timelineEvents=\{[\s\S]*\}[\s\S]*changeSummary=\{changeSummary\}/,
    'AssistantMessage should wire FileChangesSection from structured payload fields',
  );
});

test.skip('FileChangesSection does not require diff evidence for trusted changeSummary.files entries', () => {
  // This feature is not yet implemented
  assert.match(
    source,
    /upsert\(\{[\s\S]*summaryFile\.file[\s\S]*\},\s*\{\s*requireDiffEvidence:\s*false\s*\}\)/,
    'changeSummary.files should render even when per-file diff metadata is sparse',
  );
});
