import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const AUTO_GENERATED_HEADER_PREFIX = '// AUTO-GENERATED FILE. DO NOT EDIT.';

const packageJson = JSON.parse(
  readSource([joinFromRoot('package.json')], 'package.json'),
);
const syncScriptSource = readSource(
  [joinFromRoot('scripts', 'sync-structured-output-contract.mjs')],
  'sync-structured-output-contract.mjs',
);
const sharedSchemaSource = readSource(
  [joinFromRoot('src', 'shared', 'structuredOutputSchema.ts')],
  'shared structuredOutputSchema.ts',
);
const sharedValidatorSource = readSource(
  [joinFromRoot('src', 'shared', 'structuredOutputValidator.ts')],
  'shared structuredOutputValidator.ts',
);
const generatedSchemaSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'generated', 'structuredOutputSchema.ts')],
  'generated structuredOutputSchema.ts',
);
const generatedValidatorSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'generated', 'structuredOutputValidator.ts')],
  'generated structuredOutputValidator.ts',
);

function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, '\n');
}

function stripGeneratedHeader(value, label) {
  const normalized = normalizeLineEndings(value);
  assert.ok(
    normalized.startsWith(AUTO_GENERATED_HEADER_PREFIX),
    `${label} should include generated header`,
  );
  const separatorIndex = normalized.indexOf('\n\n');
  assert.notEqual(separatorIndex, -1, `${label} should include header separator`);
  return normalized.slice(separatorIndex + 2);
}

test('structured output sync script supports drift check mode', () => {
  assert.match(
    syncScriptSource,
    /process\.argv\.includes\("--check"\)/,
    'sync script should support --check mode',
  );
  assert.match(
    syncScriptSource,
    /Out-of-sync files detected:/,
    'sync script should report which generated files are out of sync',
  );
  assert.equal(
    packageJson.scripts['structured-output:check'],
    'node scripts/sync-structured-output-contract.mjs --check',
    'package scripts should expose structured-output:check command',
  );
});

test('generated structured output schema matches shared source contract', () => {
  assert.equal(
    stripGeneratedHeader(generatedSchemaSource, 'generated structuredOutputSchema.ts'),
    normalizeLineEndings(sharedSchemaSource),
  );
});

test('generated structured output validator matches shared source contract', () => {
  assert.equal(
    stripGeneratedHeader(generatedValidatorSource, 'generated structuredOutputValidator.ts'),
    normalizeLineEndings(sharedValidatorSource),
  );
});
