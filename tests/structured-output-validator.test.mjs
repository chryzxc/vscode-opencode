import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from './helpers/source-utils.mjs';

const validatorSource = readSource(
  [joinFromRoot('src', 'shared', 'structuredOutputValidator.ts')],
  'structuredOutputValidator.ts',
);

test('structured output validator enforces responseType specific requirements', () => {
  assert.match(validatorSource, /implementation_plan requires plan\.content string/, 'validator should enforce plan.content for implementation_plan');
  assert.match(validatorSource, /subagents responseType requires subagents array/, 'validator should enforce subagents array for subagents responseType');
  assert.match(validatorSource, /interactive responseType requires interactiveEvents array/, 'validator should enforce interactiveEvents array for interactive responseType');
  assert.match(validatorSource, /progress_update responseType requires progressUpdates array/, 'validator should enforce progressUpdates array for progress_update responseType');
});

test('structured output validator recognizes subagentsDelta contract', () => {
  assert.match(validatorSource, /subagentsDelta requires items array/, 'validator should enforce subagentsDelta items array');
});
