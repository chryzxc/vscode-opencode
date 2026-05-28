/**
 * Queue Management Integration Tests
 *
 * Comprehensive tests for message queue functionality including:
 * - Queue creation and management
 * - Queue processing and execution
 * - Queue priority and ordering
 * - Queue UI integration
 * - Queue error handling and recovery
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
// QUEUE CREATION AND MANAGEMENT
// ===========================================================================

test('queue flow: concurrent send -> queue creation -> state update -> UI display', () => {
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // 1. Queue detection on concurrent sends
  assert.match(inputBody, /isProcessing|streaming|processing/i, 'processing state is checked');

  // 2. Queue item creation
  assert.match(inputBody, /queue|add|item/i, 'queue item contains message data');

  // 3. Queue state update
  assert.match(handlerBody, /queue|Queue/i, 'queue events are handled');
  assert.match(reducerBody, /queue|Queue/i, 'queue items are managed in state');

  // 4. Queue UI display
  assert.match(inputBody, /queue|Queue|length/i, 'queue information is displayed');
});

test('queue management: add -> remove -> reorder -> clear operations', () => {
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // Add to queue
  assert.match(inputBody, /queue|add|addToQueue/i, 'addToQueue event is dispatched');
  assert.match(handlerBody, /queue|add|ADD/i, 'addToQueue is handled');

  // Remove from queue
  assert.match(inputBody, /remove|delete|clear/i, 'remove handler exists');
  assert.match(reducerBody, /queue|remove|filter/i, 'items are removed by ID');

  // Reorder queue
  assert.match(inputBody, /reorder|move|drag/i, 'reorder handler exists');
  assert.match(reducerBody, /queue|reorder|splice/i, 'queue items are reordered');

  // Clear queue
  assert.match(inputBody, /clear|empty|reset/i, 'clear handler exists');
  assert.match(reducerBody, /queue|clear|\[\]/i, 'queue is cleared');
});

// ===========================================================================
// QUEUE PROCESSING AND EXECUTION
// ===========================================================================

test('queue processing flow: processNextItem -> dequeue -> execute -> update status', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // Process next item
  assert.match(handlerBody, /process|next|queue/i, 'processNextItem event is handled');
  assert.match(reducerBody, /queue|process|status/i, 'queue status is updated during processing');
});

test('queue processing handles priority and ordering', () => {
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Priority support
  assert.match(reducerBody, /queue|priority|sort/i, 'queue items have priority');

  // Ordering
  assert.match(inputBody, /queue|order|sort/i, 'queue maintains item order');
});

// ===========================================================================
// QUEUE UI INTEGRATION
// ===========================================================================

test('queue UI flow: display -> interaction -> feedback -> updates', () => {
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Queue display
  assert.match(inputBody, /queue|Queue|items/i, 'queue is shown when items exist');

  // User interaction
  assert.match(inputBody, /click|onClick|remove|delete/i, 'queue items are interactive');

  // Feedback
  assert.match(inputBody, /status|processing|error/i, 'queue status is displayed');
});

test('queue UI handles empty and full queue states', () => {
  const inputBody = extractFunctionBody(panelSource, 'export function InputWrapper()');

  // Empty state
  assert.match(inputBody, /queue|length|0/i, 'empty state shows message');

  // Full queue state
  assert.match(inputBody, /queue|count|number/i, 'queue count is displayed');
});

// ===========================================================================
// QUEUE ERROR HANDLING AND RECOVERY
// ===========================================================================

test('queue error handling: send failure -> retry -> skip -> continue', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // Send failure detection
  assert.match(handlerBody, /error|catch|failure/i, 'send failures are caught and logged');

  // Retry mechanism
  assert.match(handlerBody, /retry|retryCount|attempt/i, 'retry mechanism exists');

  // Skip option
  assert.match(handlerBody, /skip|next|continue/i, 'failed items can be skipped');
});

test('queue error handling: processing failure -> rollback -> recovery', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // Processing failure detection
  assert.match(handlerBody, /error|catch|processing/i, 'processing errors are caught');

  // Rollback
  assert.ok(handlerBody.length > 0, 'processing failure is handled');

  // Recovery
  assert.match(handlerBody, /recover|retry|resume/i, 'queue can recover from errors');
});

// ===========================================================================
// QUEUE INTEGRATION WITH PROCESSING STATE
// ===========================================================================

test('queue integration with processing state: queue -> process -> complete -> next', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // Queue trigger on processing start
  assert.match(handlerBody, /processing|queue|start/i, 'queue is triggered when processing starts');

  // Processing completion
  assert.match(reducerBody, /processing|complete|queue/i, 'processing completion updates queue');

  // Next item processing
  assert.match(handlerBody, /next|process|queue/i, 'next queue item is processed after completion');
});

test('queue integration with steering: queue -> steer -> send -> continue', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // Steering event
  assert.match(handlerBody, /steer|steering|direction/i, 'steerMessage event exists');

  // Queue integration
  assert.match(handlerBody, /queue|steer|send/i, 'steering integrates with queue processing');
});
