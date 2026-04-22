import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const configEditorSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'ConfigEditor.tsx')],
  'ConfigEditor.tsx',
);

test('ConfigEditor exports the editor component and props contract', () => {
  assert.match(
    configEditorSource,
    /export function ConfigEditor\(\{ file, activeTab, onTabChange, onContentChange \}: ConfigEditorProps\)/,
    'ConfigEditor should export the component with the expected props signature',
  );
  assert.match(
    configEditorSource,
    /interface ConfigEditorProps \{[\s\S]*activeTab: 'gui' \| 'json' \| 'advanced';[\s\S]*\}/,
    'ConfigEditorProps should include the activeTab union of gui, json, and advanced',
  );
});

test('ConfigEditor defines config parsing and type guard helpers', () => {
  assert.match(
    configEditorSource,
    /function tryParseConfigContent\(content: string\): \{ ok: true; value: unknown \} \| \{ ok: false; error: string \}/,
    'ConfigEditor should define a tryParseConfigContent helper with success and error results',
  );
  assert.match(
    configEditorSource,
    /function isPlainRecord\(value: unknown\): value is Record<string, unknown>/,
    'ConfigEditor should define an isPlainRecord type guard',
  );
  assert.match(
    configEditorSource,
    /function isConfigPrimitive\(value: unknown\): value is string \| number \| boolean \| null/,
    'ConfigEditor should define an isConfigPrimitive type guard for primitive config values',
  );
});

test('ConfigEditor includes config update and formatting helpers', () => {
  assert.match(
    configEditorSource,
    /function updateAt\(obj: unknown, path: string\[\], value: unknown\): unknown/,
    'ConfigEditor should define the immutable updateAt helper',
  );
  assert.match(
    configEditorSource,
    /function formatConfigContent\(obj: unknown\): string/,
    'ConfigEditor should define a formatConfigContent helper',
  );
});

test('ConfigEditor keeps the internal tab editors intact', () => {
  assert.match(
    configEditorSource,
    /function GuiEditor\(/,
    'ConfigEditor should include the GuiEditor internal component',
  );
  assert.match(
    configEditorSource,
    /function AdvancedFormEditor\(/,
    'ConfigEditor should include the AdvancedFormEditor internal component',
  );
  assert.match(
    configEditorSource,
    /function JsonEditor\(/,
    'ConfigEditor should include the JsonEditor internal component',
  );
  assert.match(
    configEditorSource,
    /<Textarea[\s\S]*\/?>/,
    'ConfigEditor should render the JSON editor with a Textarea',
  );
});
