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
  assert.ok(typeDefinition.includes('"subagents"'), 'Should include subagents type');
  assert.ok(typeDefinition.includes('"question"'), 'Should include question type');
  assert.ok(typeDefinition.includes('"interactive"'), 'Should include interactive type');
  assert.ok(typeDefinition.includes('"error"'), 'Should include error type');
});

test('structuredOutputSchema has correct top-level structure', () => {
  const schema = extractSchema();

  assert.match(schema, /type:\s*"json_schema"/, 'Should have type: "json_schema"');
  assert.match(schema, /retryCount:\s*2/, 'Should have retryCount: 2');
  assert.match(schema, /schema:\s*{/, 'Should have schema object');
});

test('schema object has correct structure', () => {
  assert.match(schemaSource, /schema:\s*{[\s\S]*?type:\s*"object"/, 'Schema should have type: "object"');
  assert.match(schemaSource, /additionalProperties:\s*true/, 'Schema should have additionalProperties: true');
  assert.match(schemaSource, /required:\s*\[[\s\S]*?"responseType"[\s\S]*?\]/, 'Schema should require responseType');
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
  assert.ok(enumValues.includes('"subagents"'), 'Enum should include subagents');
  assert.ok(enumValues.includes('"question"'), 'Enum should include question');
  assert.ok(enumValues.includes('"interactive"'), 'Enum should include interactive');
  assert.ok(enumValues.includes('"error"'), 'Enum should include error');
});

test('assistantMessage property is defined', () => {
  assert.match(schemaSource, /assistantMessage:\s*{[\s\S]*?type:\s*"string"/, 'assistantMessage should be string');
  assert.match(schemaSource, /assistantMessage:[\s\S]*?description:[\s\S]*?"Primary user-facing/, 'assistantMessage should have description');
});

test('message property is defined as legacy alias', () => {
  assert.match(schemaSource, /message:\s*{[\s\S]*?type:\s*"string"/, 'message should be string');
  assert.match(schemaSource, /message:[\s\S]*?Legacy alias for assistantMessage/, 'message should indicate it is legacy');
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

test('interactiveEvents property is defined', () => {
  assert.match(schemaSource, /interactiveEvents:\s*{[\s\S]*?type:\s*"array"/, 'interactiveEvents should be array');
  assert.match(schemaSource, /interactiveEvents:[\s\S]*?type:[\s\S]*?enum:\s*\[[\s\S]*?"question"[\s\S]*?"confirm"[\s\S]*?"quick_actions"[\s\S]*?"message"[\s\S]*?\]/, 'interactiveEvents type should have correct enum');
});

test('interactiveEvents question event properties are defined', () => {
  assert.match(schemaSource, /question:\s*{[\s\S]*?type:\s*"string"/, 'question property should be string');
  assert.match(schemaSource, /options:\s*{[\s\S]*?type:\s*"array"/, 'options property should be array');
  assert.match(schemaSource, /multiSelect:\s*{[\s\S]*?type:\s*"boolean"/, 'multiSelect should be boolean');
  assert.match(schemaSource, /allowCustomInput:\s*{[\s\S]*?type:\s*"boolean"/, 'allowCustomInput should be boolean');
});

test('plan property is defined', () => {
  assert.match(schemaSource, /plan:\s*{[\s\S]*?type:\s*"object"/, 'plan should be object');
  assert.match(schemaSource, /plan:[\s\S]*?file:[\s\S]*?type:\s*"string"/, 'plan should have file property');
  assert.match(schemaSource, /plan:[\s\S]*?content:[\s\S]*?type:\s*"string"/, 'plan should have content property');
  assert.match(schemaSource, /plan:[\s\S]*?title:[\s\S]*?type:\s*"string"/, 'plan should have title property');
  assert.match(schemaSource, /plan:[\s\S]*?summary:[\s\S]*?type:\s*"string"/, 'plan should have summary property');
});

test('subagents property is defined', () => {
  assert.match(schemaSource, /subagents:\s*{[\s\S]*?type:\s*"array"/, 'subagents should be array');
  assert.match(schemaSource, /subagents:[\s\S]*?id:[\s\S]*?type:\s*"string"/, 'subagent items should have id');
  assert.match(schemaSource, /subagents:[\s\S]*?name:[\s\S]*?type:\s*"string"/, 'subagent items should have name');
  assert.match(schemaSource, /subagents:[\s\S]*?status:[\s\S]*?type:\s*"string"/, 'subagent items should have status');
  assert.match(schemaSource, /subagents:[\s\S]*?progress:[\s\S]*?type:\s*"number"/, 'subagent items should have progress');
});

test('subagent timeline events are defined', () => {
  assert.match(schemaSource, /timelineEvents:\s*{[\s\S]*?type:\s*"array"/, 'timelineEvents should be array');
  assert.match(schemaSource, /timelineEvents:[\s\S]*?key:[\s\S]*?type:\s*"string"/, 'timeline event items should have key');
  assert.match(schemaSource, /timelineEvents:[\s\S]*?type:[\s\S]*?type:\s*"string"/, 'timeline event items should have type');
  assert.match(schemaSource, /timelineEvents:[\s\S]*?createdAt:[\s\S]*?type:\s*"number"/, 'timeline event items should have createdAt');
});

test('subagent progress events are defined', () => {
  assert.match(schemaSource, /progressEvents:\s*{[\s\S]*?type:\s*"array"/, 'progressEvents should be array');
  assert.match(schemaSource, /progressEvents:[\s\S]*?title:[\s\S]*?type:\s*"string"/, 'progress event items should have title');
  assert.match(schemaSource, /progressEvents:[\s\S]*?status:[\s\S]*?type:\s*"string"/, 'progress event items should have status');
  assert.match(schemaSource, /progressEvents:[\s\S]*?meta:[\s\S]*?type:\s*"string"/, 'progress event items should have meta');
  assert.match(schemaSource, /progressEvents:[\s\S]*?filePath:[\s\S]*?type:\s*"string"/, 'progress event items should have filePath');
});

test('subagent thinking events are defined', () => {
  assert.match(schemaSource, /thinkingEvents:\s*{[\s\S]*?type:\s*"array"/, 'thinkingEvents should be array');
  assert.match(schemaSource, /thinkingEvents:[\s\S]*?id:[\s\S]*?type:\s*"string"/, 'thinking event items should have id');
  assert.match(schemaSource, /thinkingEvents:[\s\S]*?text:[\s\S]*?type:\s*"string"/, 'thinking event items should have text');
  assert.match(schemaSource, /thinkingEvents:[\s\S]*?createdAt:[\s\S]*?type:\s*"number"/, 'thinking event items should have createdAt');
});

test('subagentsDelta property is defined', () => {
  assert.match(schemaSource, /subagentsDelta:\s*{[\s\S]*?type:\s*"object"/, 'subagentsDelta should be object');
  assert.match(schemaSource, /subagentsDelta:[\s\S]*?parentMessageId:[\s\S]*?type:\s*"string"/, 'subagentsDelta should have parentMessageId');
  assert.match(schemaSource, /subagentsDelta:[\s\S]*?items:\s*{[\s\S]*?type:\s*"array"/, 'subagentsDelta should have items array');
});

test('subagentsDelta items have correct structure', () => {
  assert.match(schemaSource, /items:\s*{[\s\S]*?items:\s*{[\s\S]*?id:[\s\S]*?type:\s*"string"/, 'subagentsDelta items should have id');
  assert.match(schemaSource, /items:\s*{[\s\S]*?items:\s*{[\s\S]*?name:[\s\S]*?type:\s*"string"/, 'subagentsDelta items should have name');
  assert.match(schemaSource, /items:\s*{[\s\S]*?items:\s*{[\s\S]*?status:[\s\S]*?type:\s*"string"/, 'subagentsDelta items should have status');
  assert.match(schemaSource, /items:\s*{[\s\S]*?items:\s*{[\s\S]*?progress:[\s\S]*?type:\s*"number"/, 'subagentsDelta items should have progress');
});

test('all schema properties use additionalProperties correctly', () => {
  // Top-level schema should allow additional properties
  assert.match(schemaSource, /additionalProperties:\s*true,\s*required:/, 'Top-level schema should allow additional properties');

  // Nested objects should also allow additional properties
  const additionalPropsMatches = schemaSource.match(/additionalProperties:\s*true/g);
  assert.ok(additionalPropsMatches && additionalPropsMatches.length >= 8, 'Multiple nested objects should allow additional properties');
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
