import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const diffStatsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'DiffStats.tsx')],
  'DiffStats.tsx',
);

test('DiffStats exports the stats component with the expected props', () => {
  assert.match(
    diffStatsSource,
    /export function DiffStats\(\s*\{[\s\S]*added,\s*deleted,[\s\S]*className = '',[\s\S]*showIcons = false,[\s\S]*iconSize = 'md'[\s\S]*\}: DiffStatsProps\)/,
    'DiffStats should export the component with the expected props signature and defaults',
  );
  assert.match(
    diffStatsSource,
    /interface DiffStatsProps \{[\s\S]*added: number;[\s\S]*deleted: number;[\s\S]*className\?: string;[\s\S]*showIcons\?: boolean;[\s\S]*iconSize\?: 'sm' \| 'md';[\s\S]*\}/,
    'DiffStatsProps should define added, deleted, className, showIcons, and iconSize',
  );
});

test('DiffStats preserves empty-state and icon sizing logic', () => {
  assert.match(
    diffStatsSource,
    /if \(added === 0 && deleted === 0\) \{[\s\S]*return null;/,
    'DiffStats should return null when there are no additions or deletions',
  );
  assert.match(
    diffStatsSource,
    /const iconSizeClass = iconSize === 'sm' \? 'h-2\.5 w-2\.5' : 'h-3 w-3';/,
    'DiffStats should compute the icon size class from iconSize',
  );
});

test('DiffStats renders additions and deletions with theme colors', () => {
  assert.match(
    diffStatsSource,
    /added > 0 && \(/,
    'DiffStats should conditionally render additions only when added is positive',
  );
  assert.match(
    diffStatsSource,
    /deleted > 0 && \(/,
    'DiffStats should conditionally render deletions only when deleted is positive',
  );
  assert.match(
    diffStatsSource,
    /style=\{\s*\{ color: 'var\(--oc-green\)' \}\s*\}/,
    'DiffStats should color additions using the green theme variable',
  );
  assert.match(
    diffStatsSource,
    /style=\{\s*\{ color: 'var\(--oc-red\)' \}\s*\}/,
    'DiffStats should color deletions using the red theme variable',
  );
});
