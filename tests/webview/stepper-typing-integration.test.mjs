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
  const body = extractFunctionBody(messageComponentsSource, 'function AssistantMessageInner(');

  assert.doesNotMatch(
    body,
    /<TypingText/,
    'Should NOT use TypingText component for step labels'
  );

  assert.match(
    body,
    /<span[^>]*event\.label/,
    'Should use plain span element for step labels'
  );
});

test('Step labels have oc-refined-event-label class', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function AssistantMessageInner(');

  assert.match(
    body,
    /oc-refined-event-label/,
    'Should preserve the oc-refined-event-label styling class'
  );
});

test('Step labels preserve data-operation attribute', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function AssistantMessageInner(');

  assert.match(
    body,
    /data-operation.*event\.label\.toLowerCase\(\)|event\.label\.toLowerCase\(\).*data-operation/,
    'Should preserve the data-operation attribute for testing'
  );
});
