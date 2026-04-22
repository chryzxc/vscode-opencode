import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'jsonUtils.ts')],
  'jsonUtils.ts',
);

test('jsonUtils exports updateAt function for immutable nested updates', () => {
  assert.match(
    source,
    /export\s+function\s+updateAt\s*\(\s*obj\s*:\s*unknown\s*,\s*path\s*:\s*string\s*\[\s*\]\s*,\s*value\s*:\s*unknown\s*\)\s*:\s*unknown/,
    'jsonUtils should export updateAt(obj, path, value): unknown',
  );
});

test('jsonUtils updateAt handles root-level replacement', () => {
  assert.match(
    source,
    /if\s*\(\s*path\.length\s*===\s*0\s*\)/,
    'updateAt should short-circuit when path is empty',
  );
});

test('jsonUtils updateAt creates nested objects immutably', () => {
  assert.match(
    source,
    /\{\s*\.\.\.\s*record\s*,\s*\[key\]\s*:\s*newValue\s*\}/,
    'updateAt should spread existing record and set new key immutably',
  );
});

test('jsonUtils exports getValueType function for type classification', () => {
  assert.match(
    source,
    /export\s+function\s+getValueType\s*\(\s*value\s*:\s*unknown\s*\)/,
    'jsonUtils should export getValueType(value)',
  );
  assert.match(
    source,
    /return\s+['"]string['"]|['"]number['"]|['"]boolean['"]|['"]null['"]|['"]object['"]|['"]array['"]/,
    'getValueType should classify primitives and containers',
  );
});

test('jsonUtils getValueType handles arrays separately from objects', () => {
  assert.match(
    source,
    /Array\.isArray\s*\(\s*value\s*\)/,
    'getValueType should use Array.isArray to distinguish arrays from objects',
  );
});

test('jsonUtils exports detectCycles function using WeakSet', () => {
  assert.match(
    source,
    /export\s+function\s+detectCycles\s*\(\s*obj\s*:\s*unknown\s*\)\s*:\s*boolean/,
    'jsonUtils should export detectCycles(obj): boolean',
  );
  assert.match(
    source,
    /WeakSet/,
    'detectCycles should use WeakSet for visited tracking',
  );
});

test('jsonUtils detectCycles performs depth-first traversal', () => {
  assert.match(
    source,
    /for\s*\(\s*(?:const|let|var)\s+\w+\s+of\s+Object\.values\s*\(/,
    'detectCycles should iterate over object values for DFS traversal',
  );
  assert.match(
    source,
    /seen\.(?:has|add)\s*\(/,
    'detectCycles should check and add to WeakSet',
  );
});
