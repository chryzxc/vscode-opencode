import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('src', 'utils', 'LoggingSchema.ts')],
  'LoggingSchema.ts',
);

test('LoggingSchema: exports LoggingCategories as const object', () => {
  assert.match(source, /export\s+const\s+LoggingCategories\s*=\s*\{/, 'should export LoggingCategories');
  assert.match(source, /as\s+const/, 'should use as const for type safety');
});

test('LoggingSchema: defines all required category keys', () => {
  const categories = [
    'EXTENSION', 'CHAT_VIEW', 'SESSION_SERVICE', 'QUEUE_MANAGER',
    'MODEL_AGENT_MANAGER', 'PLAN_MANAGER', 'STREAM_HANDLER',
    'SERVER_MANAGER', 'UI_INTERACTION', 'FEATURE_FLOW',
  ];
  for (const cat of categories) {
    assert.match(source, new RegExp(`${cat}:`), `should define ${cat} category`);
  }
});

test('LoggingSchema: exports LogEventTypes as const object', () => {
  assert.match(source, /export\s+const\s+LogEventTypes\s*=\s*\{/, 'should export LogEventTypes');
  const events = ['FEATURE_START', 'FEATURE_END', 'STATE_CHANGE', 'UI_ACTION'];
  for (const evt of events) {
    assert.match(source, new RegExp(`${evt}:`), `should define ${evt} event type`);
  }
});

test('LoggingSchema: exports LogContext interface', () => {
  assert.match(source, /export\s+interface\s+LogContext/, 'should export LogContext interface');
  assert.match(source, /correlationId\?:\s*string/, 'LogContext should have optional correlationId');
  assert.match(source, /sessionId\?:\s*string/, 'LogContext should have optional sessionId');
  assert.match(source, /timestamp\?:\s*string/, 'LogContext should have optional timestamp');
});

test('LoggingSchema: exports FeatureFlowLog interface', () => {
  assert.match(source, /export\s+interface\s+FeatureFlowLog/, 'should export FeatureFlowLog interface');
  assert.match(source, /featureName:\s*string/, 'FeatureFlowLog should require featureName');
  assert.match(source, /correlationId:\s*string/, 'FeatureFlowLog should require correlationId');
  assert.match(source, /startTime:\s*number/, 'FeatureFlowLog should require startTime');
  assert.match(source, /steps:\s*Array\s*<\s*\{/, 'FeatureFlowLog should have steps array');
  assert.match(source, /stepName:\s*string/, 'step should have stepName');
  assert.match(source, /metadata\?:\s*Record<string,\s*unknown>/, 'FeatureFlowLog should have optional metadata');
});

test('LoggingSchema: exports StateChangeLog interface', () => {
  assert.match(source, /export\s+interface\s+StateChangeLog/, 'should export StateChangeLog interface');
  assert.match(source, /stateKey:\s*string/, 'StateChangeLog should require stateKey');
  assert.match(source, /oldValue:\s*unknown/, 'StateChangeLog should have oldValue');
  assert.match(source, /newValue:\s*unknown/, 'StateChangeLog should have newValue');
  assert.match(source, /correlationId\?:\s*string/, 'StateChangeLog should have optional correlationId');
});

test('LoggingSchema: exports UIInteractionLog interface', () => {
  assert.match(source, /export\s+interface\s+UIInteractionLog/, 'should export UIInteractionLog interface');
  assert.match(source, /component:\s*string/, 'UIInteractionLog should require component');
  assert.match(source, /action:\s*string/, 'UIInteractionLog should require action');
  assert.match(source, /element\?:\s*string/, 'UIInteractionLog should have optional element');
  assert.match(source, /payload\?:\s*Record<string,\s*unknown>/, 'UIInteractionLog should have optional payload');
});
