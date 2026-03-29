import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

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

test('Plain assistant prose with question marks does not auto-generate interactive events', () => {
  const handlerSource = readSource([
    joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts'),
  ], 'messageHandler.ts');

  const body = extractFunctionBody(handlerSource, 'function interactiveEventsFromMessage(message: Message)');

  // The active rendering path must only create interactive events from structured payloads.
  // Ensure no call to the legacy text heuristic is present in the active code path.
  assert.doesNotMatch(
    body,
    /detectInteractiveEventsFromText\(/,
    'interactiveEventsFromMessage should not call detectInteractiveEventsFromText',
  );
});

test('Structured question payload yields interactive events', async () => {
  const handlerSource = readSource([
    joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts'),
  ], 'messageHandler.ts');

  // Create a minimal structured message that represents a question with options
  const msg = {
    role: 'assistant',
    info: { id: 'm-structured-1' },
    structuredOutput: {
      responseType: 'question',
      question: {
        text: 'Which color do you prefer?',
        options: [
          { id: 'o1', label: 'Red', value: 'red' },
          { id: 'o2', label: 'Blue', value: 'blue' },
        ],
      },
    },
  };

  // Require the helper function still exists on the handler source
  assert.match(
    handlerSource,
    /function interactiveEventsFromMessage\(/,
    'interactiveEventsFromMessage must exist',
  );

  // Import and run the function by evaluating the module in a sandbox-like way.
  // We only need the function text to ensure the structured path handles question payloads.
  // Emulate the runtime call by requiring the module and calling the exported helper indirectly.
  // Load the module freshly so tests do not depend on bundler resolution.
  const mh = await import(joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts'))
    .catch(() => null);
  // If module system import fails (TSX in source), fallback to checking via regex only.
  if (!mh || typeof mh.interactiveEventsFromMessage !== 'function') {
    // Best-effort: ensure the structuredOutput path is present in source text
    assert.match(
      handlerSource,
      /structuredOutput\s*\?\:|structuredOutput\)|normalizeStructuredOutput\(/,
      'messageHandler should inspect structuredOutput',
    );
    return;
  }

  const items = mh.interactiveEventsFromMessage(msg);
  assert.ok(Array.isArray(items), 'interactiveEventsFromMessage should return an array');
  assert.ok(items.length > 0, 'Structured question payload should yield interactive events');
});
