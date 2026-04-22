import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const primitiveFieldSource = readSource(
  [
    joinFromRoot('webview', 'shared', 'src', 'chat', 'components', 'fields', 'PrimitiveField.tsx'),
    joinFromRoot('webview', 'shared', 'src', 'chat', 'PrimitiveField.tsx'),
  ],
  'PrimitiveField.tsx',
);

test('PrimitiveField exports the expected primitive editor props contract', () => {
  assert.match(
    primitiveFieldSource,
    /interface PrimitiveFieldProps \{[\s\S]*value: string \| number \| boolean \| null;[\s\S]*type: 'string' \| 'number' \| 'boolean' \| 'null';[\s\S]*fieldKey\?: string;[\s\S]*availableModels\?: Model\[\];[\s\S]*\}/,
    'PrimitiveField should accept primitive values, a type discriminator, and optional model metadata',
  );
});

test('PrimitiveField converts values through the type-switch handler', () => {
  assert.match(
    primitiveFieldSource,
    /switch \(newType\) \{[\s\S]*?case 'string':[\s\S]*?case 'number':[\s\S]*?case 'boolean':[\s\S]*?case 'null':[\s\S]*?default:/,
    'handleTypeChange should cover string, number, boolean, and null conversions',
  );
});

test('PrimitiveField detects model fields by key name', () => {
  assert.match(
    primitiveFieldSource,
    /\/model\/i\.test\(fieldKey\)/,
    'PrimitiveField should detect model-like keys with a case-insensitive regex',
  );
});

test('PrimitiveField renders a boolean switch control', () => {
  assert.match(
    primitiveFieldSource,
    /if \(type === 'boolean'\) \{[\s\S]*?<Switch[\s\S]*?onCheckedChange=\{\(checked\) => handleChange\(checked\)\}/,
    'PrimitiveField should render a Switch for boolean values',
  );
});

test('PrimitiveField renders a null badge', () => {
  assert.match(
    primitiveFieldSource,
    /<Badge[\s\S]*?>\s*null\s*<\//,
    'PrimitiveField should label null values with a null badge',
  );
});

test('PrimitiveField exposes the model select placeholder', () => {
  assert.match(
    primitiveFieldSource,
    /Select a model\.\.\./,
    'PrimitiveField should show the model-select placeholder text',
  );
});

test('PrimitiveField parses numeric conversion with Number(value)', () => {
  assert.match(
    primitiveFieldSource,
    /const num = Number\(value\);/,
    'PrimitiveField should use Number(value) during type conversion',
  );
});

test('PrimitiveField exposes short type select options', () => {
  assert.match(
    primitiveFieldSource,
    /<option value="string">str<\/option>[\s\S]*?<option value="number">num<\/option>[\s\S]*?<option value="boolean">bool<\/option>[\s\S]*?<option value="null">null<\/option>/,
    'PrimitiveField should render str, num, bool, and null type options',
  );
});
