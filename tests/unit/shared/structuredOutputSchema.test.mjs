/**
 * Structured output schema contract tests.
 *
 * These tests intentionally verify the reduced schema shape:
 * - message
 * - implementation_plan
 * - question
 *
 * Legacy progress/reasoning/file-change fields are intentionally absent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const schemaSource = readSource(
  [joinFromRoot('src', 'shared', 'structuredOutputSchema.ts')],
  'structuredOutputSchema.ts',
);

function extractSchema() {
  const schemaMatch = schemaSource.match(
    /export const structuredOutputSchema:\s*StructuredOutputSchema\s*=\s*({[\s\S]*?});/,
  );
  assert.ok(schemaMatch, 'structuredOutputSchema export not found');
  return schemaMatch[1];
}

test('structuredOutputSchema exports the current contract types', () => {
  assert.match(schemaSource, /export type StructuredResponseType/, 'Should export StructuredResponseType');
  assert.match(schemaSource, /export type StructuredOutputSchema/, 'Should export StructuredOutputSchema');
  assert.match(schemaSource, /text:\s*{[\s\S]*?type:\s*"string"/, 'Should include text field');
  assert.match(schemaSource, /"implementation_plan"/, 'Should include implementation_plan responseType');
  assert.match(schemaSource, /"question"/, 'Should include question responseType');
  assert.doesNotMatch(schemaSource, /"progress_update"/, 'Should not include progress_update responseType');
});

test('structuredOutputSchema has the expected top-level shape', () => {
  const schema = extractSchema();
  assert.match(schema, /type:\s*"json_schema"/, 'Should declare json_schema type');
  assert.match(schema, /retryCount:\s*2/, 'Should use SDK retry default');
  assert.match(schema, /schema:\s*{/, 'Should include schema object');
  assert.match(schema, /additionalProperties:\s*false/, 'Should reject unknown top-level fields');
  assert.match(schema, /required:\s*\["type"\]/, 'Should require type only');
});

test('type enum is reduced to the supported values', () => {
  const enumMatch = schemaSource.match(/type:\s*{\s*[\s\S]*?enum:\s*(\[[\s\S]*?\])/);
  assert.ok(enumMatch, 'type enum not found');
  const enumValues = enumMatch[1];

  assert.ok(enumValues.includes('"message"'), 'Enum should include message');
  assert.ok(enumValues.includes('"implementation_plan"'), 'Enum should include implementation_plan');
  assert.ok(enumValues.includes('"question"'), 'Enum should include question');
  assert.doesNotMatch(enumValues, /progress_update/, 'Enum should not include progress_update');
});

test('schema defines the supported payload fields', () => {
  assert.match(schemaSource, /text:\s*{[\s\S]*?type:\s*"string"/, 'text should be a string field');
  assert.match(schemaSource, /plan:\s*{[\s\S]*?type:\s*"object"/, 'plan should be an object field');
  assert.match(schemaSource, /question:\s*{[\s\S]*?type:\s*"object"/, 'question should be an object field');
  assert.doesNotMatch(schemaSource, /reasoning:\s*{/, 'reasoning field should be removed');
  assert.doesNotMatch(schemaSource, /progressUpdates:\s*{/, 'progressUpdates field should be removed');
  assert.doesNotMatch(schemaSource, /fileChanges:\s*{/, 'fileChanges field should be removed');
});

test('question payload is still fully described', () => {
  assert.match(schemaSource, /question:[\s\S]*?question:\s*{[\s\S]*?type:\s*"string"/, 'question text should exist');
  assert.match(schemaSource, /question:[\s\S]*?options:\s*{[\s\S]*?type:\s*"array"/, 'question options should exist');
  assert.match(schemaSource, /question:[\s\S]*?type:[\s\S]*?enum:\s*\[[\s\S]*?"question"[\s\S]*?"confirm"[\s\S]*?"quick_actions"[\s\S]*?\]/, 'question.type enum should be preserved');
});

test('schema exports remain well-formed', () => {
  assert.match(schemaSource, /export const structuredOutputSchema/, 'Schema should export a const');
  assert.match(schemaSource, /: StructuredOutputSchema\s*=/, 'Schema should be typed');
  const schemaEndMatch = schemaSource.match(/export const structuredOutputSchema[\s\S]*?\n};?\s*$/);
  assert.ok(schemaEndMatch, 'Schema export should be properly closed');
});
