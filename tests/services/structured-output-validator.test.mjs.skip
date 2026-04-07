import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const validatorSource = readSource(
  [joinFromRoot('src', 'shared', 'structuredOutputValidator.ts')],
  'structuredOutputValidator.ts',
);
const webviewValidatorWrapperSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'structuredOutputValidator.ts')],
  'webview structuredOutputValidator.ts',
);
const generatedWebviewValidatorSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'generated', 'structuredOutputValidator.ts')],
  'generated webview structuredOutputValidator.ts',
);
const schemaSource = readSource(
  [joinFromRoot('src', 'shared', 'structuredOutputSchema.ts')],
  'structuredOutputSchema.ts',
);
const generatedWebviewSchemaSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'generated', 'structuredOutputSchema.ts')],
  'generated webview structuredOutputSchema.ts',
);

test('structured output validator enforces responseType specific requirements', () => {
  assert.match(
    validatorSource,
    /implementation_plan requires plan\.file or plan\.content string/,
    'validator should enforce plan.file or plan.content for implementation_plan',
  );
  assert.match(
    validatorSource,
    /plan\.file must be a full markdown filepath/,
    'validator should require full filepath for implementation_plan plan.file',
  );
  assert.match(
    validatorSource,
    /plan\.intro must be a string when provided/,
    'validator should validate implementation_plan plan.intro type when present',
  );
  assert.match(validatorSource, /subagents responseType requires subagents array/, 'validator should enforce subagents array for subagents responseType');
  assert.match(validatorSource, /question responseType requires question object or interactiveEvents/, 'validator should enforce question payload contract for question responseType');
  assert.match(validatorSource, /question requires question text/, 'validator should require question payload to include question text');
  assert.match(validatorSource, /question interactive payload requires at least two options/, 'validator should require question payload to include explicit choices');
  assert.match(validatorSource, /question responseType requires choices: provide at least two options/, 'validator should enforce choices for responseType question');
  assert.match(validatorSource, /interactiveEvents must be an array/, 'validator should validate interactiveEvents compatibility shape');
  assert.match(validatorSource, /progress_update responseType requires progressUpdates array/, 'validator should enforce progressUpdates array for progress_update responseType');
  assert.match(validatorSource, /todo_update responseType requires todoItems array/, 'validator should enforce todoItems array for todo_update responseType');
  assert.match(validatorSource, /data responseType requires data object/, 'validator should enforce data object for data responseType');
});

test('structured output validator recognizes subagentsDelta contract', () => {
  assert.match(validatorSource, /subagentsDelta requires items array/, 'validator should enforce subagentsDelta items array');
});

test('structured output sanitizer lifts top-level question options in development payloads', () => {
  assert.match(
    validatorSource,
    /typeof value\.options !== "undefined"/,
    'sanitizer should read top-level options when normalizing question string payloads',
  );
  assert.match(
    validatorSource,
    /typeof value\.choices !== "undefined"/,
    'sanitizer should read top-level choices as a fallback option source',
  );
  assert.match(
    validatorSource,
    /value\.actions/,
    'sanitizer should read top-level actions as a fallback option source',
  );
  assert.match(
    generatedWebviewValidatorSource,
    /typeof value\.options !== "undefined"/,
    'generated webview sanitizer should mirror top-level option lifting behavior',
  );
});

test('structured output validator rejects unrelated payload families for implementation plans', () => {
  assert.match(
    validatorSource,
    /implementation_plan responseType must not include data payload/,
    'validator should reject data payloads on implementation_plan responses',
  );
  assert.match(
    generatedWebviewValidatorSource,
    /implementation_plan responseType must not include error payload/,
    'generated webview validator should reject error payloads on implementation_plan responses',
  );
});

test('structured output schema encodes implementation_plan exclusivity for data/error', () => {
  assert.match(
    schemaSource,
    /allOf:\s*\[/,
    'source schema should include conditional contract rules',
  );
  assert.match(
    schemaSource,
    /responseType:\s*\{\s*const:\s*"implementation_plan"\s*\}/,
    'source schema should scope exclusivity rule to implementation_plan',
  );
  assert.match(
    generatedWebviewSchemaSource,
    /anyOf:\s*\[\s*\{\s*required:\s*\["data"\]\s*\},\s*\{\s*required:\s*\["error"\]\s*\}\s*\]/,
    'generated webview schema should carry the same implementation_plan exclusivity rule',
  );
});

test('structured output validator enforces message payload requirement', () => {
  assert.match(
    validatorSource,
    /message responseType requires message string/,
    'validator should require an explicit user-facing message for message responseType',
  );
  assert.match(
    validatorSource,
    /Unsupported top-level fields:/,
    'validator should reject unknown top-level fields to keep schema strict',
  );
});

test('webview validator stays aligned with interactive + subagentsDelta contracts', () => {
  assert.match(
    webviewValidatorWrapperSource,
    /from "\.\/generated\/structuredOutputValidator"/,
    'webview validator wrapper should source implementation from generated shared contract',
  );
  assert.match(generatedWebviewValidatorSource, /"message"/, 'generated webview validator should allow interactive message type');
  assert.match(generatedWebviewValidatorSource, /subagentsDelta requires items array/, 'generated webview validator should enforce subagentsDelta items array');
});
