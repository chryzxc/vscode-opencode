/**
 * Comprehensive Unit Tests for structuredOutputValidator.ts
 *
 * Coverage Goals:
 * - All validation functions (validateStructuredOutput, sanitizeStructuredOutput)
 * - All response type validations
 * - All field type validations
 * - All error conditions
 * - Edge cases (null, undefined, empty, invalid types)
 * - Helper function (isNonEmptyString)
 *
 * Note: These tests perform source code inspection to verify validation logic
 * since the validator is compiled into a bundled artifact.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const validatorSource = readSource(
  [joinFromRoot('src', 'shared', 'structuredOutputValidator.ts')],
  'structuredOutputValidator.ts',
);

// Helper to extract function body
function extractFunctionBody(signature) {
  const fnStart = validatorSource.indexOf(signature);
  assert.notEqual(fnStart, -1, `${signature} definition not found`);

  let signatureEnd = fnStart + signature.length;
  if (signature.includes('(') && !signature.includes(')')) {
    let parenDepth = 0;
    const signatureParenPos = signature.indexOf('(');
    for (let i = fnStart + signatureParenPos; i < validatorSource.length; i++) {
      if (validatorSource[i] === '(') parenDepth++;
      if (validatorSource[i] === ')') {
        parenDepth--;
        if (parenDepth === 0) {
          signatureEnd = i + 1;
          break;
        }
      }
    }
  }

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

test('validator exports correct types', () => {
  assert.match(
    validatorSource,
    /export type StructuredOutputValidationResult/,
    'Should export StructuredOutputValidationResult type'
  );
  assert.match(
    validatorSource,
    /export function validateStructuredOutput/,
    'Should export validateStructuredOutput function'
  );
  assert.match(
    validatorSource,
    /export function sanitizeStructuredOutput/,
    'Should export sanitizeStructuredOutput function'
  );
});

test('StructuredOutputValidationResult type has correct structure', () => {
  const typeMatch = validatorSource.match(/export type StructuredOutputValidationResult\s*=\s*{([\s\S]*?)};/);
  assert.ok(typeMatch, 'StructuredOutputValidationResult type not found');

  const typeDef = typeMatch[1];
  assert.match(typeDef, /valid:\s*boolean/, 'Should have valid boolean property');
  assert.match(typeDef, /errors:\s*string\[\]/, 'Should have errors string array property');
});

test('isNonEmptyString helper function exists and is correct', () => {
  assert.match(
    validatorSource,
    /function isNonEmptyString\(value: unknown\): value is string/,
    'isNonEmptyString helper should exist'
  );

  const fnBody = extractFunctionBody('function isNonEmptyString(value: unknown): value is string');
  assert.match(fnBody, /typeof value === "string"/, 'Should check if value is string');
  assert.match(fnBody, /value\.trim\(\)\.length > 0/, 'Should check if trimmed string is not empty');
});

test('validateStructuredOutput checks for null/undefined/non-object input', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /if \(!value \|\| typeof value !== "object"\)/, 'Should check if value is null or not an object');
  assert.match(fnBody, /return { valid: false, errors: \["Structured output is not an object"\] }/, 'Should return error for non-object');
});

test('validateStructuredOutput validates responseType', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /typeof record\.responseType === "string"/, 'Should check responseType type');
  assert.match(fnBody, /record\.responseType\.trim\(\)\.length > 0/, 'Should check responseType is not empty');
  assert.match(fnBody, /if \(!RESPONSE_TYPES\.has\(record\.responseType\)\)/, 'Should validate responseType against allowed types');
  assert.match(fnBody, /Unsupported responseType:/, 'Should include responseType in error message');
});

test('validateStructuredOutput validates assistantMessage type', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /typeof record\.assistantMessage !== "undefined"/, 'Should check if assistantMessage is defined');
  assert.match(fnBody, /typeof record\.assistantMessage !== "string"/, 'Should check assistantMessage type');
  assert.match(fnBody, /assistantMessage must be a string/, 'Should include assistantMessage error message');
});

test('validateStructuredOutput validates message type', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /typeof record\.message !== "undefined"/, 'Should check if message is defined');
  assert.match(fnBody, /typeof record\.message !== "string"/, 'Should check message type');
  assert.match(fnBody, /message must be a string/, 'Should include message error message');
});

test('validateStructuredOutput validates reasoning array', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /typeof record\.reasoning !== "undefined" && !Array\.isArray\(record\.reasoning\)/, 'Should check reasoning is array');
  assert.match(fnBody, /reasoning must be an array of strings/, 'Should include reasoning array error');

  assert.match(fnBody, /Array\.isArray\(record\.reasoning\)/, 'Should check reasoning is array before validating items');
  assert.match(fnBody, /record\.reasoning\.some\(/, 'Should use some to check reasoning items');
  assert.match(fnBody, /typeof item !== "string" \|\| item\.trim\(\)\.length === 0/, 'Should validate each reasoning item');
  assert.match(fnBody, /reasoning must only contain non-empty strings/, 'Should include reasoning items error');

  assert.match(fnBody, /record\.reasoning\.length === 0/, 'Should check reasoning array is not empty');
  assert.match(fnBody, /reasoning must contain at least one item/, 'Should include reasoning empty array error');
});

test('validateStructuredOutput validates plan object', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /typeof record\.plan !== "undefined"/, 'Should check if plan is defined');
  assert.match(fnBody, /\(!record\.plan \|\| typeof record\.plan !== "object"\)/, 'Should check plan is object');
  assert.match(fnBody, /plan must be an object/, 'Should include plan error message');
});

test('validateStructuredOutput validates interactiveEvents array', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /Array\.isArray\(record\.interactiveEvents\)/, 'Should check interactiveEvents is array');
  assert.match(fnBody, /record\.interactiveEvents\.forEach\(\(event, index\) => {/, 'Should iterate over interactive events');

  assert.match(fnBody, /!event \|\| typeof event !== "object"/, 'Should check event is object');
  assert.match(fnBody, /interactiveEvents\[\${index}\] must be an object/, 'Should include event validation error with index');
});

test('validateStructuredOutput validates interactive event types', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /typeof eventRecord\.type === "string"/, 'Should check event type is string');
  assert.match(fnBody, /!VALID_INTERACTIVE_TYPES\.has\(eventRecord\.type\)/, 'Should validate event type against allowed types');
  assert.match(fnBody, /interactiveEvents\[\${index}\]\.type invalid:/, 'Should include invalid type error with index');
});

test('VALID_INTERACTIVE_TYPES constant includes all types', () => {
  assert.match(validatorSource, /const VALID_INTERACTIVE_TYPES = new Set\(\[/, 'VALID_INTERACTIVE_TYPES should be defined');
  assert.match(validatorSource, /"question",/, 'Should include question type');
  assert.match(validatorSource, /"confirm",/, 'Should include confirm type');
  assert.match(validatorSource, /"quick_actions",/, 'Should include quick_actions type');
  assert.match(validatorSource, /"message"/, 'Should include message type');
});

test('validateStructuredOutput validates question event properties', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /if \(eventRecord\.type === "question"\)/, 'Should check for question event type');
  assert.match(fnBody, /if \(!isNonEmptyString\(eventRecord\.question\)\)/, 'Should validate question text using isNonEmptyString');
  assert.match(fnBody, /question event requires question text/, 'Should include question text error');

  assert.match(fnBody, /const options = Array\.isArray\(eventRecord\.options\)\s*\?\s*eventRecord\.options\s*:\s*\[\]/, 'Should handle missing or invalid options');
  assert.match(fnBody, /options\.filter\(\(option\) => {/, 'Should filter options to find valid ones');

  assert.match(fnBody, /!option \|\| typeof option !== "object"/, 'Should check option is object');
  assert.match(fnBody, /isNonEmptyString\(optionRecord\.label\)\s*\|\|\s*isNonEmptyString\(optionRecord\.value\)/, 'Should check option has label or value');

  assert.match(fnBody, /if \(validOptionCount < 2\)/, 'Should check for at least 2 valid options');
  assert.match(fnBody, /question interactive event requires at least two options/, 'Should include options count error');
});

test('validateStructuredOutput validates subagents array', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /Array\.isArray\(record\.subagents\)/, 'Should check subagents is array');
  assert.match(fnBody, /record\.subagents\.forEach\(\(subagent, index\) => {/, 'Should iterate over subagents');

  assert.match(fnBody, /!subagent \|\| typeof subagent !== "object"/, 'Should check subagent is object');
  assert.match(fnBody, /subagents\[\${index}\] must be an object/, 'Should include subagent validation error with index');

  assert.match(fnBody, /typeof subagentRecord\.id !== "string"/, 'Should check subagent id type');
  assert.match(fnBody, /subagents\[\${index}\]\.id must be a string/, 'Should include id error message');

  assert.match(fnBody, /typeof subagentRecord\.name !== "undefined"/, 'Should check if subagent name is defined');
  assert.match(fnBody, /typeof subagentRecord\.name !== "string"/, 'Should check subagent name type');
  assert.match(fnBody, /subagents\[\${index}\]\.name must be a string/, 'Should include name error message');
});

test('validateStructuredOutput validates implementation_plan responseType', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /if \(record\.responseType === "implementation_plan"\)/, 'Should check for implementation_plan responseType');
  assert.match(fnBody, /const plan = record\.plan as Record<string, unknown> \| undefined;/, 'Should extract plan');
  assert.match(fnBody, /!plan \|\| typeof plan\.content !== "string"/, 'Should validate plan has content');
  assert.match(fnBody, /implementation_plan requires plan\.content string/, 'Should include implementation_plan error');
});

test('validateStructuredOutput validates subagents responseType', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /if \(record\.responseType === "subagents"\)/, 'Should check for subagents responseType');
  assert.match(fnBody, /!Array\.isArray\(record\.subagents\) \|\| record\.subagents\.length === 0/, 'Should validate subagents array exists and is not empty');
  assert.match(fnBody, /subagents responseType requires subagents array/, 'Should include subagents error');
});

test('validateStructuredOutput validates subagentsDelta structure', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /if \(typeof record\.subagentsDelta !== "undefined"\)/, 'Should check if subagentsDelta is defined');
  assert.match(fnBody, /const delta = record\.subagentsDelta as Record<string, unknown> \| undefined;/, 'Should extract delta');
  assert.match(fnBody, /!delta \|\| !Array\.isArray\(delta\.items\)/, 'Should validate delta has items array');
  assert.match(fnBody, /subagentsDelta requires items array/, 'Should include subagentsDelta error');
});

test('validateStructuredOutput validates interactive responseType', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /if \(record\.responseType === "interactive"\)/, 'Should check for interactive responseType');
  assert.match(fnBody, /!Array\.isArray\(record\.interactiveEvents\)/, 'Should validate interactiveEvents array exists');
  assert.match(fnBody, /interactive responseType requires interactiveEvents array/, 'Should include interactive error');
});

test('validateStructuredOutput validates question responseType', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /if \(record\.responseType === "question"\)/, 'Should check for question responseType');
  assert.match(fnBody, /!Array\.isArray\(record\.interactiveEvents\)/, 'Should validate interactiveEvents array exists');
  assert.match(fnBody, /question responseType requires interactiveEvents array/, 'Should include question array error');

  assert.match(fnBody, /const hasQuestionEvent = record\.interactiveEvents\.some\(/, 'Should check for question event in array');
  assert.match(fnBody, /eventRecord\.type === "question"/, 'Should check event type is question');
  assert.match(fnBody, /if \(!hasQuestionEvent\)/, 'Should validate question event exists');
  assert.match(fnBody, /question responseType requires at least one question interactive event/, 'Should include question event error');
});

test('validateStructuredOutput validates progress_update responseType', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /if \(record\.responseType === "progress_update"\)/, 'Should check for progress_update responseType');
  assert.match(fnBody, /!Array\.isArray\(record\.progressUpdates\)/, 'Should validate progressUpdates array exists');
  assert.match(fnBody, /progress_update responseType requires progressUpdates array/, 'Should include progress_update error');
});

test('validateStructuredOutput validates message responseType', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /if \(record\.responseType === "message"\)/, 'Should check for message responseType');

  assert.match(fnBody, /const assistantMessage =/, 'Should extract assistantMessage');
  assert.match(fnBody, /typeof record\.assistantMessage === "string" && record\.assistantMessage\.trim\(\)\.length > 0/, 'Should validate assistantMessage is non-empty string');

  assert.match(fnBody, /const legacyMessage =/, 'Should extract legacy message');
  assert.match(fnBody, /typeof record\.message === "string" && record\.message\.trim\(\)\.length > 0/, 'Should validate legacy message is non-empty string');

  assert.match(fnBody, /if \(!assistantMessage && !legacyMessage\)/, 'Should check at least one message exists');
  assert.match(fnBody, /message responseType requires assistantMessage or message string/, 'Should include message responseType error');
});

test('validateStructuredOutput returns validation result', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  assert.match(fnBody, /return { valid: errors\.length === 0, errors }/, 'Should return result with valid flag and errors array');
});

test('sanitizeStructuredOutput filters to top-level fields', () => {
  const fnBody = extractFunctionBody('export function sanitizeStructuredOutput(');

  assert.match(fnBody, /const sanitized: Record<string, unknown> = {}/, 'Should create empty object');
  assert.match(fnBody, /TOP_LEVEL_FIELDS\.forEach\(\(key\) => {/, 'Should iterate over top-level fields');
  assert.match(fnBody, /if \(typeof value\[key\] !== "undefined"\)/, 'Should check if key exists in value');
  assert.match(fnBody, /sanitized\[key\] = value\[key\]/, 'Should copy field to sanitized object');
  assert.match(fnBody, /return sanitized;/, 'Should return sanitized object');
});

test('TOP_LEVEL_FIELDS constant is derived from schema', () => {
  assert.match(
    validatorSource,
    /const TOP_LEVEL_FIELDS = Object\.keys\(\s*structuredOutputSchema\.schema\.properties \?\? {},\s*\)/,
    'TOP_LEVEL_FIELDS should be derived from schema properties'
  );
});

test('RESPONSE_TYPES constant is derived from schema', () => {
  assert.match(
    validatorSource,
    /const RESPONSE_TYPES = new Set\([\s\S]*?structuredOutputSchema\.schema\.properties[\s\S]*?responseType[\s\S]*?enum[\s\S]*?\?\? \[\][\s\S]*?\)/,
    'RESPONSE_TYPES should be derived from schema responseType enum'
  );
});

test('validator imports structuredOutputSchema', () => {
  assert.match(
    validatorSource,
    /import { structuredOutputSchema } from "\.\/structuredOutputSchema"/,
    'Should import structuredOutputSchema'
  );
});

test('validator handles all edge cases in validation', () => {
  const fnBody = extractFunctionBody('export function validateStructuredOutput(');

  // Empty string check
  assert.match(fnBody, /\.trim\(\)\.length > 0/, 'Should handle empty string edge case');

  // Null/undefined checks
  assert.match(fnBody, /!value \|\|/, 'Should handle null/undefined edge case');
  assert.match(fnBody, /typeof [a-zA-Z_$][a-zA-Z0-9_$\.]* !== "undefined"/, 'Should handle undefined property edge case');

  // Array empty checks
  assert.match(fnBody, /\.length === 0/, 'Should handle empty array edge case');

  // Type checks
  assert.match(fnBody, /typeof \w+ !== "object"/, 'Should handle type mismatch edge case');
  assert.match(fnBody, /!Array\.isArray\(/, 'Should handle non-array edge case');
});

test('validator provides detailed error messages with context', () => {
  // Errors should include field names
  assert.match(validatorSource, /assistantMessage must be a string/, 'Error should include field name');
  assert.match(validatorSource, /message must be a string/, 'Error should include field name');
  assert.match(validatorSource, /plan must be an object/, 'Error should include field name');

  // Errors should include array indices
  assert.match(validatorSource, /interactiveEvents\[\${index}\]/, 'Error should include array index');
  assert.match(validatorSource, /subagents\[\${index}\]/, 'Error should include array index');

  // Errors should include validation details
  assert.match(validatorSource, /Unsupported responseType: \${record\.responseType}/, 'Error should include invalid value');
  assert.match(validatorSource, /type invalid: \${eventRecord\.type}/, 'Error should include invalid type');
});

test('validator validates all nested properties', () => {
  // Options within question events
  assert.match(validatorSource, /optionRecord\.label/, 'Should validate option label');
  assert.match(validatorSource, /optionRecord\.value/, 'Should validate option value');

  // Subagent properties
  assert.match(validatorSource, /subagentRecord\.id/, 'Should validate subagent id');
  assert.match(validatorSource, /subagentRecord\.name/, 'Should validate subagent name');

  // Plan content
  assert.match(validatorSource, /plan\.content/, 'Should validate plan content');
});

test('validator handles all response type specific requirements', () => {
  // implementation_plan
  assert.match(validatorSource, /implementation_plan requires plan\.content string/, 'Should enforce implementation_plan requirements');

  // subagents
  assert.match(validatorSource, /subagents responseType requires subagents array/, 'Should enforce subagents requirements');

  // interactive
  assert.match(validatorSource, /interactive responseType requires interactiveEvents array/, 'Should enforce interactive requirements');

  // question
  assert.match(validatorSource, /question responseType requires interactiveEvents array/, 'Should enforce question array requirement');
  assert.match(validatorSource, /question responseType requires at least one question interactive event/, 'Should enforce question event requirement');

  // progress_update
  assert.match(validatorSource, /progress_update responseType requires progressUpdates array/, 'Should enforce progress_update requirements');

  // message
  assert.match(validatorSource, /message responseType requires assistantMessage or message string/, 'Should enforce message requirements');
});
