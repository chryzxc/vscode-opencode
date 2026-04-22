import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const compactDiffPreviewSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'components', 'CompactDiffPreview.tsx')],
  'CompactDiffPreview.tsx',
);

test('CompactDiffPreview exports the preview component and diff excerpt type', () => {
  assert.match(
    compactDiffPreviewSource,
    /export function CompactDiffPreview\(\{[\s\S]*excerpt,[\s\S]*maxLines = 5,[\s\S]*filePath,[\s\S]*\}: CompactDiffPreviewProps\)/,
    'CompactDiffPreview should export the component with the expected props signature',
  );
  assert.match(
    compactDiffPreviewSource,
    /type DiffExcerpt = \{[\s\S]*header\?: string;[\s\S]*lines\?: string\[\];[\s\S]*added\?: number;[\s\S]*deleted\?: number;[\s\S]*\};/,
    'CompactDiffPreview should define the DiffExcerpt type with header, lines, added, and deleted fields',
  );
});

test('CompactDiffPreview preserves excerpt guards and memoized processing', () => {
  assert.match(
    compactDiffPreviewSource,
    /if \(!excerpt\) \{[\s\S]*return null;/,
    'CompactDiffPreview should return null when excerpt is missing',
  );
  assert.match(
    compactDiffPreviewSource,
    /const processedLines = useMemo\(\(\) => \{[\s\S]*\}, \[excerpt\.lines, excerpt\.added, excerpt\.deleted, maxLines\]\);/,
    'CompactDiffPreview should memoize processed lines with the expected dependency list',
  );
});

test('CompactDiffPreview keeps line classification and preview affordances', () => {
  assert.match(
    compactDiffPreviewSource,
    /const isAdded = line\.startsWith\('\+'\) && !line\.startsWith\('\+\+\+'\);/,
    'CompactDiffPreview should detect added lines without matching diff headers',
  );
  assert.match(
    compactDiffPreviewSource,
    /const isRemoved = line\.startsWith\('-'\) && !line\.startsWith\('---'\);/,
    'CompactDiffPreview should detect removed lines without matching diff headers',
  );
  assert.match(
    compactDiffPreviewSource,
    /className="oc-compact-diff-preview mt-2"/,
    'CompactDiffPreview should use the oc-compact-diff-preview class name',
  );
  assert.match(
    compactDiffPreviewSource,
    /View diff/,
    'CompactDiffPreview should render a View diff affordance when filePath is present',
  );
});
