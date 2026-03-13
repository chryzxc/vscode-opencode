import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from './helpers/source-utils.mjs';

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

test('structured output validator enforces responseType specific requirements', () => {
  assert.match(validatorSource, /implementation_plan requires plan\.content string/, 'validator should enforce plan.content for implementation_plan');
  assert.match(validatorSource, /subagents responseType requires subagents array/, 'validator should enforce subagents array for subagents responseType');
  assert.match(validatorSource, /interactive responseType requires interactiveEvents array/, 'validator should enforce interactiveEvents array for interactive responseType');
  assert.match(validatorSource, /question responseType requires interactiveEvents array/, 'validator should enforce interactiveEvents array for question responseType');
  assert.match(validatorSource, /question responseType requires at least one question interactive event/, 'validator should require question responseType to include a question event');
  assert.match(validatorSource, /question event requires question text/, 'validator should require question events to include question text');
  assert.match(validatorSource, /question interactive event requires at least two options/, 'validator should require question events to include at least two options');
  assert.match(validatorSource, /progress_update responseType requires progressUpdates array/, 'validator should enforce progressUpdates array for progress_update responseType');
});

test('structured output validator recognizes subagentsDelta contract', () => {
  assert.match(validatorSource, /subagentsDelta requires items array/, 'validator should enforce subagentsDelta items array');
});

test('structured output validator enforces assistantMessage typing and message payload requirement', () => {
  assert.match(
    validatorSource,
    /assistantMessage must be a string/,
    'validator should validate assistantMessage string type',
  );
  assert.match(
    validatorSource,
    /message responseType requires assistantMessage or message string/,
    'validator should require an explicit user-facing message for message responseType',
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
