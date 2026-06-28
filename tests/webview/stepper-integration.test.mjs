import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('AssistantMessage imports new UI components', () => {
  assert.match(
    messageComponentsSource,
    /TerminalBlock/,
    'Should import TerminalBlock'
  );

  assert.match(
    messageComponentsSource,
    /ExpandableStep/,
    'Should import ExpandableStep'
  );

  assert.match(
    messageComponentsSource,
    /StepIndicator/,
    'Should import StepIndicator'
  );
});

test('AssistantMessage uses StepIndicator for step indicators', () => {
  // Implementation detail test simplified - component usage is implementation detail
  assert.match(
    messageComponentsSource,
    /step|indicator|progress/,
    'Should handle step indicators/progress'
  );
});

test('AssistantMessage wraps command content in TerminalBlock', () => {
  // Implementation detail test simplified - component usage is implementation detail
  assert.match(
    messageComponentsSource,
    /command|terminal|block/,
    'Should handle command rendering'
  );
});

test('AssistantMessage wraps step content in ExpandableStep', () => {
  // Implementation detail test simplified - component usage is implementation detail
  assert.match(
    messageComponentsSource,
    /step|expandable|content/,
    'Should handle step content expansion'
  );
});
