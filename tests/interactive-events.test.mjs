import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

test('InputWrapper uses Stepper UI state for interactive questions', () => {
  const body = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Verify navigation state
  assert.match(
    body,
    /const\s+\[currentInteractiveIndex,\s*setCurrentInteractiveIndex\]\s*=\s*useState\(0\)/,
    'InputWrapper should have currentInteractiveIndex state for stepper',
  );

  // Verify custom answer state
  assert.match(
    body,
    /const\s+\[isCustomMode,\s*setIsCustomMode\]\s*=\s*useState\(false\)/,
    'InputWrapper should have isCustomMode state for custom answers',
  );

  // Verify state reset logic
  assert.match(
    body,
    /setCurrentInteractiveIndex\(0\)/,
    'InputWrapper should reset interactive index when events change',
  );
  assert.match(
    body,
    /setIsCustomMode\(false\)/,
    'InputWrapper should reset custom mode when events change',
  );
});

test('InputWrapper renders Stepper navigation controls', () => {
  const body = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Verify "Previous" button logic
  assert.match(
    body,
    /disabled=\{currentInteractiveIndex\s*===\s*0\}/,
    'Previous button should be disabled at the first question',
  );

  // Verify "Next" button logic
  assert.match(
    body,
    /disabled=\{[\s\n]*currentInteractiveIndex\s*===\s*displayInteractiveEvents(?:\.length)?\s*-\s*1[\s\n]*\}/,
    'Next button should be disabled at the last question',
  );

  // Verify navigation icons
  assert.match(body, /<ArrowLeft/, 'Should render ArrowLeft for previous');
  assert.match(body, /<ArrowRight/, 'Should render ArrowRight for next');
});

test('InputWrapper integrates MarkdownRenderer and Capitalization', () => {
  const body = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Verify Markdown usage
  assert.match(
    body,
    /<MarkdownRenderer\s+content=\{/,
    'Interactive questions should use MarkdownRenderer for content',
  );

  // Verify choice capitalization
  assert.match(
    body,
    /\{capitalizeFirst\(\s*option\.(?:label|text)\s*\)\}/,
    'Option labels should be capitalized using capitalizeFirst helper',
  );
});

test('InputWrapper supports Custom Answer mode', () => {
  const body = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Verify Custom Answer button
  assert.match(
    body,
    /Custom Answer\.\.\./,
    'Should have a "Custom Answer..." button for interactive questions',
  );

  // Verify input field in custom mode
  assert.match(
    body,
    /placeholder="Type your answer\.\.\."/,
    'Should show a text input when in custom mode',
  );

  // Verify submission in custom mode
  assert.match(
    body,
    /submitInteractiveResponse\(\s*customValue/,
    'Submitting in custom mode should send the customValue',
  );
});

test('InputWrapper batches interactive responses', () => {
  const body = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Verify pendingAnswers state
  assert.match(
    body,
    /const\s+\[pendingAnswers,\s*setPendingAnswers\]\s*=\s*useState/,
    'InputWrapper should have pendingAnswers state',
  );

  // Verify batch submission logic
  assert.match(
    body,
    /type:\s*['"]batchInteractiveResponse['"]/,
    'InputWrapper should send batchInteractiveResponse type',
  );

  // Verify auto-advance logic
  assert.match(
    body,
    /currentInteractiveIndex\s*<\s*displayInteractiveEvents\.length\s*-\s*1/,
    'Should check if more questions remain before submitting batch',
  );
});
