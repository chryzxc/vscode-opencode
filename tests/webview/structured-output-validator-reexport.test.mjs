import test from 'node:test';
import assert from 'node:assert/strict';
import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'structuredOutputValidator.ts')],
  'structuredOutputValidator.ts',
);

test('structuredOutputValidator re-exports sanitizeStructuredOutput', () => {
  assert.match(
    source,
    /export\s*\{[^}]*(?:sanitizeStructuredOutput)[^}]*\}\s*from/,
    'should re-export sanitizeStructuredOutput from generated validator',
  );
});

test('structuredOutputValidator re-exports validateStructuredOutput', () => {
  assert.match(
    source,
    /export\s*\{[^}]*(?:validateStructuredOutput)[^}]*\}\s*from/,
    'should re-export validateStructuredOutput from generated validator',
  );
});

test('structuredOutputValidator re-exports StructuredOutputValidationResult', () => {
  assert.match(
    source,
    /export\s*(?:type\s*)?\{[^}]*(?:StructuredOutputValidationResult)[^}]*\}\s*from/,
    'should re-export StructuredOutputValidationResult type',
  );
});

test('structuredOutputValidator imports from generated directory', () => {
  assert.match(
    source,
    /from\s+['"]\.\/generated\/structuredOutputValidator['"]/,
    'should import from ./generated/structuredOutputValidator',
  );
});
