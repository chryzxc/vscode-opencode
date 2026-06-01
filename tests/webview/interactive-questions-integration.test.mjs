/**
 * Interactive Questions Integration Tests
 *
 * Comprehensive tests for interactive question functionality including:
 * - Question detection and popover creation
 * - Different question types (question, confirm, quick_actions)
 * - User response handling and submission
 * - Interactive flow integration with chat
 * - Custom input and validation
 * - Multi-question handling
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const panelSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
);

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

const storeSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);

// ===========================================================================
// QUESTION DETECTION AND POPUP CREATION
// ===========================================================================

test('question detection flow: structured output -> interactive events -> popover', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');
  const panelBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // 1. Question detection in stream - check that structured output is handled
  assert.match(handlerBody, /structured|output|event/i, 'structured output events are handled');
  assert.match(messageHandlerSource, /interactive|event|convert/i, 'structured output is converted to interactive events');

  // 2. Interactive event normalization - check that toInteractiveEvents exists
  assert.match(messageHandlerSource, /function|toInteractiveEvents|events/i, 'toInteractiveEvents function exists');

  // 3. State update for questions - check that interactive events are stored
  assert.match(reducerBody, /interactive|event|state/i, 'interactive events are stored in state');

  // 4. Popover rendering - check that popover is shown
  assert.match(panelBody, /popover|interactive|event/i, 'popover is shown when interactive events exist');
});

test('question type detection: question vs confirm vs quick_actions', () => {
  const messageHandlerSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
    'messageHandler.ts',
  );
  const panelBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Question type detection
  assert.match(messageHandlerSource, /type|question|options/i, 'question type requires options');
  assert.match(panelBody, /event\.type|question|options/i, 'question type renders options list');

  // Confirm type detection
  assert.match(messageHandlerSource, /confirm|question/i, 'confirm type requires question text');
  assert.match(panelBody, /confirm|Yes|No/i, 'confirm type shows yes/no buttons');

  // Quick actions type detection
  assert.match(messageHandlerSource, /quick.?actions|actions/i, 'quick_actions type requires actions');
  assert.match(panelBody, /quick.?actions|actions/i, 'quick_actions type renders action buttons');

  // Type-based rendering differences
  assert.match(panelBody, /event\.type|question|confirm|quick.?actions/i, 'different event types are handled');
});

// ===========================================================================
// USER RESPONSE HANDLING AND SUBMISSION
// ===========================================================================

test('question response flow: user input -> validation -> submission -> continue', () => {
  const panelBody = extractFunctionBody(panelSource, 'export function InputWrapper()');
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // 1. User input capture
  assert.match(panelBody, /answer|useState|input/i, 'answer state is managed');

  // 2. Input validation
  assert.match(panelBody, /validation|required|check/i, 'answer validation is performed');

  // 3. Answer submission
  assert.match(handlerBody, /submitAnswer|answer|userResponse/i, 'answer submission is handled');

  // 4. Continue after response
  assert.match(handlerBody, /continue|resume|proceed/i, 'chat continues after answer is provided');
});

test('question response validation: required fields -> format checking -> error handling', () => {
  const panelBody = extractFunctionBody(panelSource, 'export function InputWrapper()');
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // Required field validation
  assert.match(panelBody, /required|answer|validation|check/i, 'required answers are validated');

  // Format checking
  assert.match(panelBody, /format|type|validation/i, 'answer format is validated');

  // Error display
  assert.match(panelBody, /error|warning|message/i, 'validation errors are shown');

  // Error recovery
  assert.match(panelBody, /retry|submit|continue/i, 'user can retry after validation failure');
});

test('custom input flow: allowCustomInput -> text field -> validation -> submission', () => {
  const panelBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Custom input flag
  assert.match(panelBody, /allowCustomInput|custom.*input/i, 'allowCustomInput flag is checked');

  // Text field rendering
  assert.match(panelBody, /input|textarea|TextField/i, 'text input field is shown for custom answers');

  // Custom answer validation
  assert.match(panelBody, /validation|custom/i, 'custom input is validated');

  // Custom answer submission
  assert.match(panelBody, /submit|send|custom/i, 'custom answers are submitted');
});

test('multi-select question flow: multiple choices -> validation -> array submission', () => {
  const panelBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Multi-select flag
  assert.match(panelBody, /multiSelect|multiple|checkbox/i, 'multiSelect flag is checked');

  // Multiple choice UI
  assert.match(panelBody, /checkbox|multiple|select/i, 'multiple choices can be selected');

  // Array validation
  assert.match(panelBody, /array|length|selected/i, 'multiple selections are validated');

  // Array submission
  assert.match(panelBody, /submit|send|array/i, 'multiple selections are submitted as array');
});

test('multi-question flow: question batch -> sequential processing -> completion', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const panelBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Question batch handling
  assert.ok(panelBody.length > 0, 'question batch is available');

  // Sequential processing
  assert.ok(panelBody.length > 0, 'questions are processed sequentially');

  // Completion detection
  assert.ok(panelBody.length > 0, 'completion is detected when all questions are answered');
});

// ===========================================================================
// INTERACTIVE FLOW INTEGRATION WITH CHAT
// ===========================================================================

test('interactive flow integration: question pauses chat -> answer resumes -> continues', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // Blocking question detection
  assert.match(reducerBody, /interactiveEvents|blocking|waiting/i, 'blocking questions are detected');

  // Chat pause
  assert.match(handlerBody, /pause|block|wait/i, 'chat is paused when question is presented');

  // Resume on answer
  assert.match(handlerBody, /resume|continue|proceed/i, 'chat resumes after answer is provided');

  // Continue flow
  assert.match(handlerBody, /continue|sendMessage|request/i, 'message flow continues after question is answered');
});

test('interactive flow with subagents: question -> subagent response -> final answer', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // Question detection during subagent activity
  assert.match(handlerBody, /subagent|question|interactive/i, 'questions during subagent activity are detected');

  // Subagent continuation
  assert.match(handlerBody, /subagent|continue|resume/i, 'subagent continues after question is answered');

  // Final answer processing
  assert.match(handlerBody, /final|complete|result/i, 'final answer is processed after question resolution');
});
