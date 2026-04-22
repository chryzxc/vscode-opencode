import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('src', 'utils', 'getNonce.ts')],
  'getNonce.ts',
);

test('getNonce: exports a single function', () => {
  assert.match(source, /export\s+function\s+getNonce\(\):\s*string/, 'should export getNonce returning string');
});

test('getNonce: uses alphanumeric character set', () => {
  assert.match(
    source,
    /ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/,
    'should use full alphanumeric charset',
  );
});

test('getNonce: generates 32-character nonce', () => {
  assert.match(source, /i\s*<\s*32/, 'should iterate 32 times');
});

test('getNonce: uses Math.random for character selection', () => {
  assert.match(source, /Math\.random\(\)/, 'should use Math.random');
  assert.match(source, /possible\.charAt/, 'should select from charset using charAt');
});

test('getNonce: builds result via string concatenation', () => {
  assert.match(source, /text\s*\+=/, 'should concatenate characters to result string');
  assert.match(source, /return\s+text/, 'should return the built string');
});
