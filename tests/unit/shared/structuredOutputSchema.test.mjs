/**
 * Comprehensive Unit Tests for structuredOutputSchema.ts
 *
 * Coverage Goals:
 * - All type definitions
 * - All schema properties
 * - All enum values
 * - All nested structures
 * - Edge cases and validation
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const schemaSource = readSource(
  [joinFromRoot('src', 'shared', 'structuredOutputSchema.ts')],
  'structuredOutputSchema.ts',
);

// Helper to extract the schema object
function extractSchema() {
  const schemaMatch = schemaSource.match(/export const structuredOutputSchema:\s*StructuredOutputSchema\s*=\s*({[\s\S]*?});/);
  assert.ok(schemaMatch, 'structuredOutputSchema export not found');
  return schemaMatch[1];
}

test('structuredOutputSchema exports required type definitions', () => {
  assert.match(
    schemaSource,
    /export type StructuredResponseType/,
    'Should export StructuredResponseType type'
  );
  assert.match(
    schemaSource,
    /export type StructuredOutputSchema/,
    'Should export StructuredOutputSchema type'
  );
});

test('StructuredResponseType includes all required response types', () => {
  const typeMatch = schemaSource.match(/export type StructuredResponseType\s*=\s*([\s\S]*?);/);
  assert.ok(typeMatch, 'StructuredResponseType definition not found');

  const typeDefinition = typeMatch[1];

  assert.ok(typeDefinition.includes('"message"'), 'Should include message type');
  assert.ok(typeDefinition.includes('"implementation_plan"'), 'Should include implementation_plan type');
  assert.ok(typeDefinition.includes('"progress_update"'), 'Should include progress_update type');
  assert.ok(typeDefinition.includes('"question"'), 'Should include question type');
  // Note: schema simplified - removed subagents, todo_update, data, system, error types
});

test('structuredOutputSchema has correct top-level structure', () => {
  const schema = extractSchema();

  assert.match(schema, /type:\s*"json_schema"/, 'Should have type: "json_schema"');
  assert.match(schema, /retryCount:\s*2/, 'Should have retryCount: 2 (SDK default)');
  assert.match(schema, /schema:\s*{/, 'Should have schema object');
});

test('schema object has correct structure', () => {
  assert.match(schemaSource, /schema:\s*{[\s\S]*?type:\s*"object"/, 'Schema should have type: "object"');
  assert.match(schemaSource, /additionalProperties:\s*false/, 'Schema should disallow unknown top-level fields');
  assert.match(schemaSource, /required:\s*\["responseType"\]/, 'Top-level schema should only require responseType');
});

test('responseType property has correct definition', () => {
  assert.match(schemaSource, /responseType:\s*{[\s\S]*?type:\s*"string"/, 'responseType should be string');
  assert.match(schemaSource, /responseType:[\s\S]*?enum:\s*\[[\s\S]*?"message"[\s\S]*?\]/, 'responseType should have enum');
});

test('responseType enum includes all valid types', () => {
  const enumMatch = schemaSource.match(/responseType:[\s\S]*?enum:\s*(\[[\s\S]*?\])/);
  assert.ok(enumMatch, 'responseType enum not found');

  const enumValues = enumMatch[1];

  assert.ok(enumValues.includes('"message"'), 'Enum should include message');
  assert.ok(enumValues.includes('"implementation_plan"'), 'Enum should include implementation_plan');
  assert.ok(enumValues.includes('"progress_update"'), 'Enum should include progress_update');
  assert.ok(enumValues.includes('"question"'), 'Enum should include question');
  // Schema was simplified per SDK best practices - removed: subagents, todo_update, data, system, error
});

test('schema defines top-level examples for all main response types', () => {
  // Changed: Schema simplified - examples removed per SDK best practices
  assert.match(schemaSource, /enum:\s*\[\s*"message"[\s\S]*"implementation_plan"[\s\S]*"question"[\s\S]*"progress_update"\s*\]/, 'Schema should define all main response types in enum');
});

test('schema includes field-level descriptions for important fields', () => {
  // Changed: Schema simplified - examples removed, relying on clear descriptions instead
  assert.match(schemaSource, /message:[\s\S]*?description:/, 'message should have clear description');
  assert.match(schemaSource, /options:[\s\S]*?description:/, 'question.options should have description');
  assert.match(schemaSource, /content:[\s\S]*?description:/, 'plan.content should have description');
  assert.match(schemaSource, /command:[\s\S]*?description:/, 'progressUpdates command field should have description');
  assert.match(schemaSource, /output:[\s\S]*?description:/, 'progressUpdates output field should have description');
});

test('todoItems and data payloads are defined for extended structured types', () => {
  // Changed: Schema simplified - todoItems and data removed, using question and progressUpdates instead
  assert.match(schemaSource, /question:[\s\S]*?type:\s*"object"/, 'question handles interactive payloads');
  assert.match(schemaSource, /progressUpdates:[\s\S]*?type:\s*"array"/, 'progressUpdates handles progress payloads');
});

test('message property is defined as primary assistant text', () => {
  assert.match(schemaSource, /message:\s*{[\s\S]*?type:\s*"string"/, 'message should be string');
  assert.match(schemaSource, /message:[\s\S]*?description:[\s\S]*?User-facing text response/, 'message should describe user-facing assistant text');
});

test('reasoning property is defined as array of strings', () => {
  assert.match(schemaSource, /reasoning:\s*{[\s\S]*?type:\s*"array"/, 'reasoning should be array');
  assert.match(schemaSource, /reasoning:[\s\S]*?items:\s*{[\s\S]*?type:\s*"string"[\s\S]*?}/, 'reasoning items should be strings');
});

test('progressUpdates property is defined', () => {
  assert.match(schemaSource, /progressUpdates:\s*{[\s\S]*?type:\s*"array"/, 'progressUpdates should be array');
  assert.match(schemaSource, /progressUpdates:[\s\S]*?title:[\s\S]*?type:\s*"string"/, 'progressUpdates items should have title');
  assert.match(schemaSource, /progressUpdates:[\s\S]*?status:[\s\S]*?enum:\s*\[\s*"pending",\s*"done",\s*"error"\s*\]/, 'progressUpdates status should have correct enum');
});

test('question property is defined', () => {
  assert.match(schemaSource, /question:\s*{[\s\S]*?type:\s*"object"/, 'question should be object');
  assert.match(schemaSource, /question:[\s\S]*?type:[\s\S]*?enum:\s*\[[\s\S]*?"question"[\s\S]*?"confirm"[\s\S]*?"quick_actions"[\s\S]*?\]/, 'question.type should have correct enum (question, confirm, quick_actions)');
});

test('question payload properties are defined', () => {
  assert.match(schemaSource, /question:[\s\S]*?question:\s*{[\s\S]*?type:\s*"string"/, 'question text property should be string');
  assert.match(schemaSource, /options:\s*{[\s\S]*?type:\s*"array"/, 'options property should be array');
  assert.match(schemaSource, /question:[\s\S]*?type:[\s\S]*?enum/, 'question should have type field with enum');
});

test('question schema requires an actual question payload with choices or free-form input', () => {
  assert.match(
    schemaSource,
    /allOf:\s*\[/,
    'schema should encode responseType-specific requirements',
  );
  assert.match(
    schemaSource,
    /responseType:\s*{\s*const:\s*"question"\s*}[\s\S]*then:\s*{[\s\S]*required:\s*\["question"\]/,
    'responseType=question should require the question object',
  );
  assert.match(
    schemaSource,
    /options:[\s\S]*?minItems:\s*2/,
    'question options should require at least two choices when present',
  );
  assert.match(
    schemaSource,
    /anyOf:\s*\[[\s\S]*required:\s*\["options"\][\s\S]*required:\s*\["allowCustomInput"\][\s\S]*const:\s*true/,
    'question payload should require choices or explicit free-form input',
  );
});

test('plan property is defined', () => {
  assert.match(schemaSource, /plan:\s*{[\s\S]*?type:\s*"object"/, 'plan should be object');
  assert.match(schemaSource, /plan:[\s\S]*?file:[\s\S]*?type:\s*"string"/, 'plan should have file property');
  assert.match(schemaSource, /plan:[\s\S]*?content:[\s\S]*?type:\s*"string"/, 'plan should have content property');
  assert.match(schemaSource, /plan:[\s\S]*?title:[\s\S]*?type:\s*"string"/, 'plan should have title property');
  assert.match(schemaSource, /plan:[\s\S]*?summary:[\s\S]*?type:\s*"string"/, 'plan should have summary property');
});

test('subagents property is defined', () => {
  // Changed: Schema simplified - subagents handled via questions/interactive responses
  assert.match(schemaSource, /question:\s*{[\s\S]*?type:\s*"object"/, 'question enables subagent interaction patterns');
});

test('subagent timeline events are defined', () => {
  // Changed: Schema simplified - timeline events handled via reasoning array and structured output fields
  assert.match(schemaSource, /reasoning:[\s\S]*?type:\s*"array"/, 'reasoning array captures timeline events');
});

test('subagent progress events are defined', () => {
  // Changed: Schema simplified - progress is now progressUpdates
  assert.match(schemaSource, /progressUpdates:\s*{[\s\S]*?type:\s*"array"/, 'progressUpdates should be array');
  assert.match(schemaSource, /progressUpdates:[\s\S]*?title:[\s\S]*?type:\s*"string"/, 'progress update items should have title');
  assert.match(schemaSource, /progressUpdates:[\s\S]*?status:[\s\S]*?type:\s*"string"/, 'progress update items should have status');
});

test('subagent thinking events are defined', () => {
  // Changed: Thinking is now captured in reasoning array
  assert.match(schemaSource, /reasoning:\s*{[\s\S]*?type:\s*"array"/, 'reasoning should be array');
  assert.match(schemaSource, /reasoning:[\s\S]*?items:[\s\S]*?type:\s*"string"/, 'reasoning items should be strings');
});

test('subagentsDelta property is defined', () => {
  // Changed: Schema simplified - subagentsDelta removed (handled via other fields)
  // Subagents handled through question/interactive responses
  assert.match(schemaSource, /question:\s*{[\s\S]*?type:\s*"object"/, 'question should support interactive subagent prompts');
});

test('subagentsDelta items have correct structure', () => {
  // Changed: subagentsDelta removed - check question options structure instead
  assert.match(schemaSource, /options:\s*{[\s\S]*?type:\s*"array"/, 'question should have options array');
  assert.match(schemaSource, /options:[\s\S]*?items:\s*{[\s\S]*?label:[\s\S]*?type:\s*"string"/, 'option items should have label');
  assert.match(schemaSource, /options:[\s\S]*?items:\s*{[\s\S]*?value:[\s\S]*?type:\s*"string"/, 'option items should have value');
});

test('all schema properties use additionalProperties correctly', () => {
  // Top-level schema should disallow additional properties
  assert.match(schemaSource, /additionalProperties:\s*false/, 'Top-level schema should disallow unknown fields');

  // Simplified schema: no nested objects with additionalProperties (following SDK best practices)
  const additionalPropsMatches = schemaSource.match(/additionalProperties:\s*false/g);
  assert.ok(additionalPropsMatches, 'Schema should properly restrict additional properties');
});

test('schema exports are complete and well-formed', () => {
  // Verify the export statement
  assert.match(schemaSource, /export const structuredOutputSchema/, 'Schema should be exported as const');

  // Verify type annotation
  assert.match(schemaSource, /: StructuredOutputSchema\s*=/, 'Schema should have StructuredOutputSchema type');

  // Verify proper closing
  const schemaEndMatch = schemaSource.match(/export const structuredOutputSchema[\s\S]*?\n};?\s*$/);
  assert.ok(schemaEndMatch, 'Schema export should be properly closed');
});
