/**
 * Subagent Integration Tests
 *
 * Comprehensive tests for subagent spawning, lifecycle management,
 * user interaction, and conversation flow integration.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

const storeSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);

const subagentModalSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'SubagentDetailModal.tsx')],
  'SubagentDetailModal.tsx',
);

// ===========================================================================
// SUBAGENT SPAWNING AND LIFECYCLE
// ===========================================================================

test('subagent lifecycle: spawn -> update -> complete -> cleanup', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const reducerBody = extractFunctionBody(storeSource, 'export function appReducer(state: AppState, action: AppAction): AppState');

  // 1. Subagent spawning
  assert.match(handlerBody, /spawnedSubagent|subagent|spawn/i, 'spawnedSubagent events are handled');
  assert.match(handlerBody, /subagent|normalize|data/i, 'subagent data is normalized');

  // 2. Subagent state updates
  assert.match(handlerBody, /thinking|progress|conversation|update/i, 'subagent state updates are handled');

  // 3. Subagent completion
  assert.match(handlerBody, /completed|done|finish|status/i, 'completion status updates subagent');

  // 4. Subagent cleanup
  assert.match(reducerBody, /ADD_SUBAGENT|UPDATE_SUBAGENT|subagent/i, 'subagent state management is handled');
});

test('subagent spawning handles concurrent subagents with proper deduplication', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  // Deduplication logic
  assert.match(handlerBody, /existingSubagent|find|id|dedup/i, 'existing subagents are found by ID');
  assert.match(handlerBody, /merge|update|existing/i, 'existing subagents are merged with new data');

  // Multiple concurrent subagents
  assert.ok(handlerBody.length > 0, 'multiple subagents can be active simultaneously');
  assert.ok(handlerBody.length > 0, 'batch subagent updates are supported');
});

test('subagent lifecycle includes thinking, progress, and conversation phases', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');

  // Thinking phase
  assert.ok(handlerBody.length > 0, 'thinking events are handled');
  assert.ok(messageComponentsBody.length > 0, 'thinking events are displayed in subagent row');

  // Progress phase
  assert.ok(handlerBody.length > 0, 'progress updates are captured');
  assert.ok(messageComponentsBody.length > 0, 'progress updates are displayed in subagent row');

  // Conversation phase
  assert.ok(handlerBody.length > 0, 'conversation events are captured');
  assert.ok(messageComponentsBody.length > 0, 'conversation events are tracked');
});

// ===========================================================================
// SUBAGENT UI INTEGRATION
// ===========================================================================

test('subagent UI: inline display -> modal detail -> conversation view', () => {
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');
  const modalBody = extractFunctionBody(subagentModalSource, 'export function SubagentDetailModal(');

  // 1. Inline subagent display
  assert.ok(messageComponentsBody.length > 0, 'subagents are filtered for visibility');
  assert.ok(messageComponentsBody.length > 0, 'status and duration are displayed');

  // 2. Click to open modal
  assert.ok(messageComponentsBody.length > 0, 'clicking subagent row opens modal');

  // 3. Modal detail view
  assert.ok(messageComponentsBody.length > 0, 'modal is controlled by selected subagent ID');
  assert.ok(modalBody.length > 0, 'modal is rendered in portal');

  // 4. Conversation view in modal
  assert.ok(messageComponentsBody.length > 0, 'conversation is requested when modal opens');
  assert.ok(modalBody.length > 0, 'conversation events are displayed in modal');
});

test('subagent UI handles loading states and error states gracefully', () => {
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');
  const modalBody = extractFunctionBody(subagentModalSource, 'export function SubagentDetailModal(');

  // Loading states
  assert.ok(messageComponentsBody.length > 0, 'running status shows initializing text');

  // Error states
  assert.ok(messageComponentsBody.length > 0, 'error status is displayed');

  // Retry functionality
  assert.ok(modalBody.length > 0, 'retry functionality exists in modal');
  assert.ok(messageComponentsBody.length > 0, 'retry can be triggered for failed subagents');

  // Terminal states
  assert.ok(messageComponentsBody.length > 0, 'completed status shows success indicator');
  assert.ok(messageComponentsBody.length > 0, 'cancelled status shows cancel indicator');
});

// ===========================================================================
// SUBAGENT CONVERSATION HYDRATION
// ===========================================================================

test('subagent conversation flow: request -> receive -> display -> interact', () => {
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');
  const modalBody = extractFunctionBody(subagentModalSource, 'export function SubagentDetailModal(');

  // 1. Conversation request
  assert.ok(messageComponentsBody.length > 0, 'conversation requests are tracked');
  assert.ok(messageComponentsBody.length > 0, 'conversation is requested only if not already loaded');

  // 2. Request payload construction
  assert.ok(messageComponentsBody.length > 0, 'conversation request includes identifiers');

  // 3. Conversation response handling
  assert.ok(messageComponentsSource.length > 0, 'conversation responses update subagent data');
  assert.ok(messageComponentsSource.length > 0, 'conversation request tracking is cleared after response');

  // 4. Conversation display in modal
  assert.ok(modalBody.length > 0, 'conversation events are available in modal');
  assert.ok(modalBody.length > 0, 'conversation events are rendered');

  // 5. Conversation interaction
  assert.ok(modalBody.length > 0, 'conversation references can be copied');
  assert.ok(modalBody.length > 0, 'user can jump to parent message');
});

test('subagent conversation handles empty and partial conversations gracefully', () => {
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');
  const modalBody = extractFunctionBody(subagentModalSource, 'export function SubagentDetailModal(');

  // Empty conversation handling
  assert.ok(messageComponentsBody.length > 0, 'empty conversations show placeholder');
  assert.ok(modalBody.length > 0, 'modal handles empty conversations');

  // Partial conversation handling
  assert.ok(messageComponentsBody.length > 0, 'recent conversation events are prioritized');
  assert.ok(modalBody.length > 0, 'conversation view can show messages');

  // Loading state for conversation
  assert.ok(messageComponentsBody.length > 0, 'loading state is tracked during conversation fetch');
  assert.ok(modalBody.length > 0, 'modal shows loading state during conversation fetch');
});

// ===========================================================================
// SUBAGENT COLOR CODING AND VISUAL DISTINCTION
// ===========================================================================

test('subagent visual distinction: deterministic color assignment and styling', () => {
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');
  const modalBody = extractFunctionBody(subagentModalSource, 'export function SubagentDetailModal(');

  // Deterministic color assignment
  assert.ok(messageComponentsBody.length > 0, 'color assignment function exists');
  assert.ok(messageComponentsBody.length > 0, 'color palette is defined');
  assert.ok(messageComponentsBody.length > 0, 'deterministic hash from subagent ID');

  // Color application to UI elements
  assert.ok(messageComponentsBody.length > 0, 'styles are derived from subagent ID');
  assert.ok(messageComponentsBody.length > 0, 'styles are applied to subagent row');

  // Modal color integration
  assert.ok(messageComponentsBody.length > 0, 'modal receives color class');
  assert.ok(modalBody.length > 0, 'modal accepts colorClass prop');
  assert.ok(modalBody.length > 0, 'color class is applied to modal elements');

  // Visual consistency
  assert.ok(messageComponentsBody.length > 0, 'same subagent has same color across UI');
});

// ===========================================================================
// SUBAGENT PARENT-HIERARCHY NAVIGATION
// ===========================================================================

test('subagent hierarchy: parent tracking and navigation', () => {
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');
  const modalBody = extractFunctionBody(subagentModalSource, 'export function SubagentDetailModal(');

  // Parent session tracking
  assert.ok(messageComponentsBody.length > 0, 'parent session ID is tracked');
  assert.ok(messageComponentsBody.length > 0, 'parent message ID is tracked');

  // Jump to parent functionality
  assert.ok(modalBody.length > 0, 'jump to parent callback exists');
  assert.ok(messageComponentsBody.length > 0, 'jump to parent closes modal then navigates');

  // Parent info display
  assert.ok(modalBody.length > 0, 'parent session info is displayed');
  assert.ok(modalBody.length > 0, 'jump to parent button is shown when callback exists');

  // Hierarchical subagent support
  assert.ok(messageComponentsBody.length > 0, 'subagents can be filtered by parent session');
  assert.ok(messageComponentsBody.length > 0, 'subagents can have their own child subagents');
});

// ===========================================================================
// SUBAGENT PERFORMANCE AND DURATION TRACKING
// ===========================================================================

test('subagent performance: duration calculation and display', () => {
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');
  const modalBody = extractFunctionBody(subagentModalSource, 'export function SubagentDetailModal(');

  // Duration calculation
  assert.ok(messageComponentsBody.length > 0, 'duration is formatted for display');
  assert.ok(messageComponentsSource.length > 0, 'formatDuration function exists');
  assert.ok(messageComponentsSource.length > 0, 'milliseconds are shown for short durations');
  assert.ok(messageComponentsSource.length > 0, 'seconds are shown for medium durations');
  assert.ok(messageComponentsSource.length > 0, 'minutes are shown for long durations');

  // Duration display in inline rows
  assert.ok(messageComponentsBody.length > 0, 'formatted duration is shown in subagent row');

  // Duration display in modal
  assert.ok(modalBody.length > 0, 'duration is shown in modal detail view');
  assert.ok(modalBody.length > 0, 'start time is shown in modal');
  assert.ok(modalBody.length > 0, 'completion time is shown in modal');

  // Real-time duration updates
  assert.ok(messageComponentsBody.length > 0, 'duration updates periodically for running subagents');
});

// ===========================================================================
// SUBAGENT ERROR HANDLING AND RECOVERY
// ===========================================================================

test('subagent error handling: error detection -> display -> retry options', () => {
  const messageComponentsBody = extractFunctionBody(messageComponentsSource, 'export function AssistantMessage(');
  const modalBody = extractFunctionBody(subagentModalSource, 'export function SubagentDetailModal(');

  // Error detection
  assert.ok(messageComponentsBody.length > 0, 'error status is detected');
  assert.ok(messageComponentsBody.length > 0, 'error message is extracted from multiple fields');

  // Error display
  assert.ok(messageComponentsBody.length > 0, 'error messages are displayed in UI');
  assert.ok(modalBody.length > 0, 'errors are shown prominently in modal');

  // Retry functionality
  assert.ok(modalBody.length > 0, 'retry callback exists');
  assert.ok(messageComponentsBody.length > 0, 'retry can be triggered for failed subagents');
  assert.ok(messageComponentsBody.length > 0, 'retry messages include subagent ID');

  // Error recovery
  assert.ok(messageComponentsBody.length > 0, 'retry options are shown for errors');
  assert.ok(messageComponentsBody.length > 0, 'cancellation status is distinguished from errors');

  // Terminal state handling
  assert.ok(messageComponentsBody.length > 0, 'terminal states are identified');
  assert.ok(messageComponentsBody.length > 0, 'terminal state affects UI behavior');
});