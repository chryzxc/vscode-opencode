import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('AssistantMessage imports TypingText component', () => {
  assert.match(
    messageComponentsSource,
    /TypingText/,
    'Should import TypingText component'
  );
});

test('AssistantMessageInner uses TypingText for step labels', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function AssistantMessageInner(');

  assert.match(
    body,
    /<TypingText/,
    'Should use TypingText component for step labels'
  );
});

test('TypingText isTyping prop is controlled by step status', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function AssistantMessageInner(');

  assert.match(
    body,
    /isTyping.*event\.status|event\.status.*isTyping/,
    'Should tie isTyping to step status'
  );
});
