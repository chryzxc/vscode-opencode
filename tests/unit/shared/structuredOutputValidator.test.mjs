/**
 * Structured output validator source contract tests.
 *
 * The validator should only enforce the reduced schema surface:
 * message, implementation_plan, question, and the shared legacy
 * interactiveEvents compatibility path.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const validatorSource = readSource(
  [joinFromRoot('src', 'shared', 'structuredOutputValidator.ts')],
  'structuredOutputValidator.ts',
);

function extractFunctionBody(signature) {
  const fnStart = validatorSource.indexOf(signature);
  assert.notEqual(fnStart, -1, `${signature} definition not found`);

  let signatureEnd = fnStart + signature.length;
  const braceStart = validatorSource.indexOf('{', signatureEnd);
  assert.notEqual(braceStart, -1, `${signature} body start not found`);

  let depth = 0;
  for (let i = braceStart; i < validatorSource.length; i += 1) {
    const ch = validatorSource[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return validatorSource.slice(braceStart + 1, i);
      }
    }
  }

  throw new Error(`${signature} body end not found`);
}

test('validator exports the expected helpers', () => {
  assert.match(validatorSource, /export type StructuredOutputValidationResult/, 'Should export result type');
  assert.match(validatorSource, /export function validateStructuredOutput/, 'Should export validator');
  assert.match(validatorSource, /export function sanitizeStructuredOutput/, 'Should export sanitizer');
});

test('validateStructuredOutput handles basic object validation', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');
  assert.match(fnBody, /if \(!value \|\| typeof value !== "object"\)/, 'Should reject non-objects');
  assert.match(fnBody, /type is required and must be a string/, 'Should require type');
  assert.match(fnBody, /Unsupported type:/, 'Should validate type enum');
});

test('validateStructuredOutput validates the supported fields', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');
  assert.match(fnBody, /text must be a string/, 'Should validate text');
  assert.match(fnBody, /plan must be an object/, 'Should validate plan');
  assert.match(fnBody, /question responseType requires question object or interactiveEvents/, 'Should validate question payloads');
  assert.match(fnBody, /interactiveEvents must be an array/, 'Should keep legacy interactiveEvents compatibility');
});

test('validator no longer contains removed structured output branches', () => {
  assert.doesNotMatch(validatorSource, /progress_update/, 'progress_update branch should be removed');
  assert.doesNotMatch(validatorSource, /progressUpdates/, 'progressUpdates field should be removed');
  assert.doesNotMatch(validatorSource, /reasoning must be an array of strings/, 'reasoning validation should be removed');
  assert.doesNotMatch(validatorSource, /fileChanges/, 'fileChanges validation should be removed');
});

test('validator still preserves implementation_plan and question support', () => {
  assert.match(validatorSource, /implementation_plan requires plan\.file string/, 'Should still enforce implementation_plan');
  assert.match(validatorSource, /question requires question text/, 'Should still enforce question payloads');
});

test('TOP_LEVEL_FIELDS and RESPONSE_TYPES are driven by the schema', () => {
  assert.match(
    validatorSource,
    /const TOP_LEVEL_FIELDS = Object\.keys\(\s*structuredOutputSchema\.schema\.properties \?\? {},\s*\)/,
    'TOP_LEVEL_FIELDS should be schema-derived',
  );
  assert.match(
    validatorSource,
    /const RESPONSE_TYPES = new Set\([\s\S]*?type[\s\S]*?enum[\s\S]*?\?\? \[\][\s\S]*?\)/,
    'RESPONSE_TYPES should be schema-derived from type',
  );
});
