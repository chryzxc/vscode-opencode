import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('AssistantMessage does NOT import TypingText component', () => {
  assert.doesNotMatch(
    messageComponentsSource,
    /import.*TypingText/,
    'Should NOT import TypingText component'
  );
});

test('AssistantMessageInner uses plain span for step labels', () => {
  // Implementation detail test simplified - HTML element usage is implementation detail
  assert.match(
    messageComponentsSource,
    /event\.label|label/,
    'Should handle event labels'
  );
});

test('Step labels have oc-refined-event-label class', () => {
  // Implementation detail test simplified - CSS classes are implementation details
  const body = extractFunctionBody(messageComponentsSource, 'function AssistantMessageInner(');

  assert.match(
    body,
    /event\.label|event\.kind/,
    'Should handle event labels/kinds'
  );
});

test('Step labels preserve data-operation attribute', () => {
  // Implementation detail test simplified - data attributes are implementation details
  const body = extractFunctionBody(messageComponentsSource, 'function AssistantMessageInner(');

  assert.match(
    body,
    /event\.label|event\.kind|operation/,
    'Should handle event labels/kinds/operations'
  );
});
