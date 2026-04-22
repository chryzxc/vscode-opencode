import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const arrayFieldSource = readSource(
  [
    joinFromRoot('webview', 'shared', 'src', 'chat', 'components', 'fields', 'ArrayField.tsx'),
    joinFromRoot('webview', 'shared', 'src', 'chat', 'ArrayField.tsx'),
  ],
  'ArrayField.tsx',
);

test('ArrayField exports the expected recursive props contract', () => {
  assert.match(
    arrayFieldSource,
    /export function ArrayField\(\{\s*value,\s*path,\s*onChange,\s*depth,\s*availableModels\s*\}: ArrayFieldProps\)/,
    'ArrayField should export with value, path, onChange, depth, and availableModels props',
  );
});

test('ArrayField adds items using the current array length path', () => {
  assert.match(
    arrayFieldSource,
    /onChange\(\[\.\.\.path,\s*String\(value\.length\)\],\s*''\);/,
    'handleAddItem should append a new empty item at the next numeric path',
  );
});

test('ArrayField removes items through filtered array updates', () => {
  assert.match(
    arrayFieldSource,
    /const newArray = value\.filter\(\(_, i\) => i !== index\);[\s\S]*?onChange\(path,\s*newArray\);/,
    'handleRemoveItem should filter the array and send the new array back',
  );
});

test('ArrayField moves items up or down by direction', () => {
  assert.match(
    arrayFieldSource,
    /handleMoveItem = \(index: number, direction: 'up' \| 'down'\) =>/,
    'handleMoveItem should accept an up/down direction flag',
  );
});

test('ArrayField recursively renders JsonFormEditor for each entry', () => {
  assert.match(
    arrayFieldSource,
    /<JsonFormEditor[\s\S]*?value=\{item\}[\s\S]*?path=\{\[\.\.\.path, String\(index\)\]\}[\s\S]*?availableModels=\{availableModels\}/,
    'ArrayField should render JsonFormEditor for every array item',
  );
});

test('ArrayField shows the empty-state copy for empty arrays', () => {
  assert.match(
    arrayFieldSource,
    /No items - click \+ to add/,
    'ArrayField should display the empty array helper text',
  );
});
