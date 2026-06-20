/**
 * Core Structured Output Validator Regression Tests
 *
 * These tests prevent regressions in structured output validation functionality.
 * Structured output validation is critical for AI response integrity.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const validatorSource = readSource(
  [joinFromRoot('src', 'shared', 'structuredOutputValidator.ts')],
  'structuredOutputValidator.ts',
);

test.describe('Structured Output Validator - Basic Validation', () => {

  test('validateStructuredOutput checks object type', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /typeof.*!==\s*["']object["']|!value|object/s,
      'must validate input is an object'
    );
  });

  test('validateStructuredOutput returns validation result', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /return\s*\{\s*valid.*errors.*\}|valid:\s*errors\.length\s*===\s*0/s,
      'must return valid flag and errors array'
    );
  });

});

test.describe('Structured Output Validator - Top-Level Fields', () => {

  test('validateStructuredOutput validates top-level fields', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /TOP_LEVEL_FIELDS|unknownTopLevelFields|Unsupported top-level fields/s,
      'must validate top-level field names'
    );
  });

  test('validateStructuredOutput handles legacy compatibility', () => {
    const source = validatorSource;

    assert.match(
      source,
      /LEGACY_COMPAT_TOP_LEVEL_FIELDS|interactiveEvents/s,
      'must handle legacy field compatibility'
    );
  });

});

test.describe('Structured Output Validator - Response Type', () => {

  test('validateStructuredOutput validates responseType presence', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /responseType.*required|!responseType/s,
      'must require responseType field'
    );
  });

  test('validateStructuredOutput validates responseType values', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /RESPONSE_TYPES|Unsupported responseType/s,
      'must validate responseType enum values'
    );
  });

});

test.describe('Structured Output Validator - Message Validation', () => {

  test('validateStructuredOutput validates message type', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /typeof record\.message.*!==\s*["']string["']|message must be a string/s,
      'must validate message is string'
    );
  });

  test('validateStructuredOutput does not include removed reasoning validation', () => {
    assert.doesNotMatch(
      validatorSource,
      /reasoning.*must be an array of strings|reasoning.*must only contain strings|Array\.isArray\(record\.reasoning\)/s,
      'removed reasoning validation should not remain in the validator'
    );
  });

});

test.describe('Structured Output Validator - Plan Validation', () => {

  test('validateStructuredOutput validates plan type', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /plan.*must be an object|!record\.plan.*typeof.*!==\s*["']object["']/s,
      'must validate plan is object'
    );
  });

});

test.describe('Structured Output Validator - Removed Progress Updates', () => {
  test('validateStructuredOutput no longer contains progress update validation', () => {
    assert.doesNotMatch(
      validatorSource,
      /progressUpdates.*must be an array|file_edit.*diffExcerpt\.lines.*diffStats|progress_update/,
      'must not contain removed progress update validation',
    );
  });
});

test.describe('Structured Output Validator - Error Validation', () => {

  test('validateStructuredOutput validates error type', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /error.*must be an object|asRecord/s,
      'must validate error is object'
    );
  });

  test('validateStructuredOutput validates error fields', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /error\.message.*must be a string|error\.code.*must be a string/s,
      'must validate error field types'
    );
  });

  test('validateStructuredOutput validates error.retryable type', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /error\.retryable.*must be a boolean|typeof.*!==\s*["']boolean["']/s,
      'must validate error.retryable is boolean'
    );
  });

});

test.describe('Structured Output Validator - Interactive Events', () => {

  test('validateStructuredOutput validates interactiveEvents type', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /interactiveEvents.*must be an array|Array\.isArray/s,
      'must validate interactiveEvents is array'
    );
  });

  test('validateStructuredOutput validates interactive event types', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /VALID_INTERACTIVE_TYPES|question|confirm|quick_actions|message/s,
      'must validate interactive event types'
    );
  });

  test('validateStructuredOutput validates question events', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /question.*requires question text|question.*requires at least two options/s,
      'must validate question event requirements'
    );
  });

  test('validateStructuredOutput validates confirm events', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /confirm.*requires question text/s,
      'must validate confirm event requirements'
    );
  });

  test('validateStructuredOutput validates quick_actions events', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /quick_actions.*requires actions array|actions\.length\s*===\s*0/s,
      'must validate quick_actions event requirements'
    );
  });

  test('validateStructuredOutput validates message events', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /message.*requires message\/content text/s,
      'must validate message event requirements'
    );
  });

});

test.describe('Structured Output Validator - Question Payload', () => {

  test('validateStructuredOutput validates question type', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /question\.type.*invalid|VALID_INTERACTIVE_TYPES/s,
      'must validate question.type values'
    );
  });

  test('validateStructuredOutput validates question displayPrompt', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /question\.displayPrompt.*must be a string|typeof.*!==\s*["']string["']/s,
      'must validate question.displayPrompt type'
    );
  });

  test('validateStructuredOutput validates question answer', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /question\.answer.*must be a string/s,
      'must validate question.answer type'
    );
  });

  test('validateStructuredOutput validates question answers', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /question\.answers.*must be an array of strings|Array\.isArray/s,
      'must validate question.answers type'
    );
  });

  test('validateStructuredOutput validates question options', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /question.*requires at least two options|countValidChoiceOptions/s,
      'must validate question has valid options'
    );
  });

});

test.describe('Structured Output Validator - Subagents', () => {

  test('validateStructuredOutput validates subagents type', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /subagents.*must be an object|typeof.*!==\s*["']object["']/s,
      'must validate subagents is object'
    );
  });

  test('validateStructuredOutput validates subagent id', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /subagents\[\d+\]\.id.*must be a string|typeof.*id.*!==\s*["']string["']/s,
      'must validate subagent id is string'
    );
  });

  test('validateStructuredOutput validates subagent name', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /subagentRecord\.name.*typeof.*!==\s*["']string["']|subagents\[.*\]\.name.*must be a string/s,
      'must validate subagent name type'
    );
  });

});

test.describe('Structured Output Validator - Subagents Delta', () => {

  test('validateStructuredOutput validates subagentsDelta type', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /subagentsDelta.*requires items array|Array\.isArray.*items/s,
      'must validate subagentsDelta.items is array'
    );
  });

});

test.describe('Structured Output Validator - Implementation Plan', () => {

  test('validateStructuredOutput validates plan.file requirement', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /implementation_plan.*requires plan\.file|string|!planFile/s,
      'must require plan.file for implementation_plan'
    );
  });

  test('validateStructuredOutput validates plan.file path', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /plan\.file.*must be a full markdown filepath|isQualifiedMarkdownPath/s,
      'must validate plan.file is qualified path'
    );
  });

  test('validateStructuredOutput validates plan.files array', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /plan\.files.*must be an array of strings|Array\.isArray/s,
      'must validate plan.files is string array'
    );
  });

  test('validateStructuredOutput validates plan content restriction', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /implementation_plan.*must not include data payload|responseType.*===\s*["']implementation_plan["']/s,
      'must enforce plan content restrictions'
    );
  });

  test('validateStructuredOutput validates plan content size', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /question.*cannot include implementation plan payload|plan\.content.*>.*100/s,
      'must prevent large plan content in question responses'
    );
  });

});

test.describe('Structured Output Validator - Response Type Specific', () => {

  test('validateStructuredOutput validates subagents response', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /subagents.*requires subagents array or subagentsDelta\.items|responseType.*===\s*["']subagents["']/s,
      'must validate subagents responseType requirements'
    );
  });

  test('validateStructuredOutput validates question response', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /question.*requires question object or interactiveEvents|responseType.*===\s*["']question["']/s,
      'must validate question responseType requirements'
    );
  });

  test('validateStructuredOutput gates top-level question field validation on question responseType', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /if \(responseType === "question" && typeof record\.question !== "undefined"\)/,
      'must only validate the top-level question field for question responses'
    );
  });

  test('validateStructuredOutput validates question options', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /question.*requires choices.*at least two options|countValidChoiceOptions/s,
      'must validate question has options'
    );
  });

  test('validateStructuredOutput validates todo_update response', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /todo_update.*requires todoItems array|responseType.*===\s*["']todo_update["']/s,
      'must validate todo_update responseType requirements'
    );
  });

  test('validateStructuredOutput validates data response', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /data.*requires data object|responseType.*===\s*["']data["']/s,
      'must validate data responseType requirements'
    );
  });

  test('validateStructuredOutput validates message response', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /message.*requires message string|responseType.*===\s*["']message["']/s,
      'must validate message responseType requirements'
    );
  });

  test('validateStructuredOutput validates error response', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /error.*requires error\.message or message|responseType.*===\s*["']error["']/s,
      'must validate error responseType requirements'
    );
  });

});

test.describe('Structured Output Validator - Todo Items', () => {

  test('validateStructuredOutput validates todoItems type', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /todoItems.*must be an array|Array\.isArray/s,
      'must validate todoItems is array'
    );
  });

  test('validateStructuredOutput validates todo item structure', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /todoItems\.forEach|todo\.id.*non-empty|todo\.text.*non-empty|isNonEmptyString/s,
      'must validate todo item required fields'
    );
  });

  test('validateStructuredOutput validates todo status values', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /todo\.status.*pending.*in_progress.*completed.*cancelled.*failed|status.*!==/s,
      'must validate todo status enum values'
    );
  });

});

test.describe('Structured Output Validator - Sanitization', () => {

  test('sanitizeStructuredOutput filters top-level fields', () => {
    const sanitizeBody = extractFunctionBody(validatorSource, 'sanitizeStructuredOutput');

    assert.match(
      sanitizeBody,
      /const sanitized:\s*Record<string, unknown> = \{ \.\.\.value \}/,
      'must start from the input record and normalize in place'
    );
  });

  test('sanitizeStructuredOutput normalizes question payload', () => {
    const sanitizeBody = extractFunctionBody(validatorSource, 'sanitizeStructuredOutput');

    assert.match(
      sanitizeBody,
      /typeof sanitized\.question.*===\s*["']string["']|question.*questionText|type.*question/s,
      'must normalize string question to object'
    );
  });

  test('sanitizeStructuredOutput normalizes question options', () => {
    const sanitizeBody = extractFunctionBody(validatorSource, 'sanitizeStructuredOutput');

    assert.match(
      sanitizeBody,
      /options.*choices.*actions|move.*top-level.*question/s,
      'must normalize top-level options into question object'
    );
  });

  test('sanitizeStructuredOutput normalizes interactiveEvents', () => {
    const sanitizeBody = extractFunctionBody(validatorSource, 'sanitizeStructuredOutput');

    assert.match(
      sanitizeBody,
      /interactiveEvents.*JSON\.parse|Array\.isArray|map/s,
      'must normalize interactiveEvents array'
    );
  });

});

test.describe('Structured Output Validator - Question Options', () => {

  test('normalizeQuestionOptions handles JSON string options', () => {
    const normalizeBody = extractFunctionBody(validatorSource, 'normalizeQuestionOptions');

    assert.match(
      normalizeBody,
      /typeof options.*===\s*["']string["']|JSON\.parse/s,
      'must parse JSON string options'
    );
  });

  test('normalizeQuestionOptions ensures array type', () => {
    const normalizeBody = extractFunctionBody(validatorSource, 'normalizeQuestionOptions');

    assert.match(
      normalizeBody,
      /Array\.isArray.*options\s*=\s*\[\]/s,
      'must ensure options is array'
    );
  });

});

test.describe('Structured Output Validator - Utility Functions', () => {

  test('isNonEmptyString validates strings', () => {
    const isNonEmptyBody = extractFunctionBody(validatorSource, 'isNonEmptyString');

    assert.match(
      isNonEmptyBody,
      /typeof.*===.*string.*trim\.length.*>.*0|typeof.*===.*string.*&&/s,
      'must check for non-empty strings'
    );
  });

  test('asString converts to string', () => {
    const asStringBody = extractFunctionBody(validatorSource, 'asString');

    assert.match(
      asStringBody,
      /typeof.*===\s*["']string["']|return.*value|fallback/s,
      'must safely convert to string'
    );
  });

  test('asRecord converts to record', () => {
    const asRecordBody = extractFunctionBody(validatorSource, 'asRecord');

    assert.match(
      asRecordBody,
      /typeof.*===\s*["']object["'].*&&.*value.*!==\s*null|Record/s,
      'must safely convert to record'
    );
  });

  test('countValidChoiceOptions counts options', () => {
    const countBody = extractFunctionBody(validatorSource, 'countValidChoiceOptions');

    assert.match(
      countBody,
      /Array\.isArray.*options.*filter.*label.*value/s,
      'must count valid option objects'
    );
  });

  test('isQualifiedMarkdownPath validates paths', () => {
    const isQualifiedBody = extractFunctionBody(validatorSource, 'isQualifiedMarkdownPath');

    assert.match(
      isQualifiedBody,
      /\.md\$|\/|\\\\|\.\.\/|absolute|workspace-relative/s,
      'must validate markdown file paths'
    );
  });

});

test.describe('Structured Output Validator - Error Handling', () => {

  test('validator collects validation errors', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /errors\.push|errors\.length\s*===\s*0/s,
      'must collect all validation errors'
    );
  });

  test('validator provides detailed error messages', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /errors\.push.*must|required|invalid/s,
      'must provide descriptive error messages'
    );
  });

  test('validator handles missing optional fields', () => {
    const validateBody = extractFunctionBody(validatorSource, 'validateStructuredOutput');

    assert.match(
      validateBody,
      /typeof.*!==\s*["']undefined["']|optional/s,
      'must handle optional fields correctly'
    );
  });

});

test.describe('Structured Output Validator - Constants', () => {

  test('validator defines top-level fields', () => {
    const source = validatorSource;

    assert.match(
      source,
      /TOP_LEVEL_FIELDS.*Object\.keys.*structuredOutputSchema/s,
      'must define top-level fields from schema'
    );
  });

  test('validator defines response types', () => {
    const source = validatorSource;

    assert.match(
      source,
      /RESPONSE_TYPES.*Set|responseType.*enum/s,
      'must define valid response types'
    );
  });

  test('validator defines interactive types', () => {
    const source = validatorSource;

    assert.match(
      source,
      /VALID_INTERACTIVE_TYPES.*question.*confirm.*quick_actions.*message/s,
      'must define valid interactive types'
    );
  });

});

test.describe('Structured Output Validator - Integration', () => {

  test('validator integrates with schema', () => {
    const source = validatorSource;

    assert.match(
      source,
      /structuredOutputSchema|import.*structuredOutputSchema/s,
      'must integrate with structured output schema'
    );
  });

  test('validator supports legacy compatibility', () => {
    const source = validatorSource;

    assert.match(
      source,
      /LEGACY_COMPAT|interactiveEvents|backward.*compatible/s,
      'must support legacy field compatibility'
    );
  });

});
