import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const jsonFormEditorSource = readSource(
  [
    joinFromRoot('webview', 'shared', 'src', 'chat', 'components', 'fields', 'JsonFormEditor.tsx'),
    joinFromRoot('webview', 'shared', 'src', 'chat', 'JsonFormEditor.tsx'),
  ],
  'JsonFormEditor.tsx',
);

test('JsonFormEditor exports the recursive editor props contract', () => {
  assert.match(
    jsonFormEditorSource,
    /interface JsonFormEditorProps \{[\s\S]*value: unknown;[\s\S]*path: string\[\];[\s\S]*onChange: \(path: string\[\], newValue: unknown\) => void;[\s\S]*parentType\?: 'object' \| 'array';[\s\S]*index\?: number;[\s\S]*availableModels\?: Model\[\];[\s\S]*\}/,
    'JsonFormEditor should define the recursive editor props interface',
  );
  assert.match(
    jsonFormEditorSource,
    /export function JsonFormEditor\(\{[\s\S]*value,[\s\S]*path,[\s\S]*onChange,[\s\S]*parentType,[\s\S]*index,[\s\S]*availableModels[\s\S]*\}: JsonFormEditorProps\)/,
    'JsonFormEditor should destructure all props from the interface',
  );
});

test('JsonFormEditor expands the root path by default', () => {
  assert.match(
    jsonFormEditorSource,
    /const \[isExpanded, setIsExpanded\] = useState\(path\.length === 0\);/,
    'JsonFormEditor should open the root node by default',
  );
});

test('JsonFormEditor dispatches by value type', () => {
  assert.match(
    jsonFormEditorSource,
    /if \(type === 'string' \|\| type === 'number' \|\| type === 'boolean' \|\| type === 'null'\) \{[\s\S]*?<PrimitiveField[\s\S]*?\/>[\s\S]*?if \(type === 'object'\) \{[\s\S]*?<ObjectField[\s\S]*?\/>[\s\S]*?if \(type === 'array'\) \{[\s\S]*?<ArrayField[\s\S]*?\/>/,
    'JsonFormEditor should route primitive, object, and array values to the correct field component',
  );
});

test('JsonFormEditor warns on large configs using JSON.stringify length', () => {
  assert.match(
    jsonFormEditorSource,
    /JSON\.stringify\(value\)/,
    'JsonFormEditor should serialize value to check size',
  );
  assert.match(
    jsonFormEditorSource,
    /\.length > 100_000/,
    'JsonFormEditor should compare serialized length against 100KB threshold',
  );
});

test('JsonFormEditor logs large config warnings through logger.warn', () => {
  assert.match(
    jsonFormEditorSource,
    /logger\.warn\('Large config detected, performance may be impacted'/,
    'JsonFormEditor should log a warning when the serialized config is too large',
  );
});

test('JsonFormEditor forwards depth into child field components', () => {
  assert.match(
    jsonFormEditorSource,
    /depth=\{path\.length\}/,
    'JsonFormEditor should pass the current path depth to nested fields',
  );
});
