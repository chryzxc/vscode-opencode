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
  const body = extractFunctionBody(messageComponentsSource, 'function AssistantMessageInner(');

  assert.match(
    body,
    /<StepIndicator/,
    'Should use StepIndicator component'
  );
});

test('AssistantMessage wraps command content in TerminalBlock', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function AssistantMessageInner(');

  assert.match(
    body,
    /activityDetail\.command.*<TerminalBlock|<TerminalBlock.*activityDetail\.command/,
    'Should render TerminalBlock for commands'
  );
});

test('AssistantMessage wraps step content in ExpandableStep', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function AssistantMessageInner(');

  assert.match(
    body,
    /<ExpandableStep/,
    'Should use ExpandableStep component'
  );
});
