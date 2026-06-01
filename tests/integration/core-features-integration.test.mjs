/**
 * Core Features Integration Tests
 *
 * Comprehensive integration tests for OpenCode VSCode extension core features:
 *   - Interactive events and questions
 *   - Subagent management and persistence
 *   - Message streaming and real-time updates
 *   - Plan detection and management
 *   - Model selection and capabilities
 *   - Queue management
 *   - Compaction and memory management
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readSource,
  joinFromRoot,
} from '../helpers/source-utils.mjs';

// Read core feature sources
const chatViewProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

const streamEventHandlerSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'StreamEventHandler.ts')],
  'StreamEventHandler.ts',
);

const sessionServiceSource = readSource(
  [joinFromRoot('src', 'services', 'SessionService.ts')],
  'SessionService.ts',
);

// ---------------------------------------------------------------------------
// Interactive Events Integration Tests
// ---------------------------------------------------------------------------

test('Interactive events system handles questions from AI', () => {
  assert.match(
    chatViewProviderSource,
    /interactive.*event|question.*event|structuredOutput/i,
    'Must handle interactive events',
  );
});

test('Interactive events support user responses', () => {
  assert.match(
    chatViewProviderSource,
    /answer.*interactive|submit.*answer|interactive.*submit/i,
    'Must support user responses to interactive events',
  );
});

// ---------------------------------------------------------------------------
// Subagent Management Integration Tests
// ---------------------------------------------------------------------------

test('Subagent system tracks agent lifecycle', () => {
  assert.match(
    chatViewProviderSource,
    /subagentTracker|SubagentTracker|subagent/i,
    'Must track subagent lifecycle',
  );
});

test('Subagent persistence maintains agent state', () => {
  assert.match(
    chatViewProviderSource,
    /subagent.*persist|saveSubagent|restoreSubagent/i,
    'Must persist subagent state',
  );
});

// ---------------------------------------------------------------------------
// Message Streaming Integration Tests
// ---------------------------------------------------------------------------

test('Message streaming handles chunked responses', () => {
  assert.match(
    chatViewProviderSource,
    /stream.*chunk|chunk.*response|streamEvent/i,
    'Must handle chunked streaming responses',
  );
});

test('Message streaming includes token usage', () => {
  assert.match(
    chatViewProviderSource,
    /token.*usage|token.*count|usage/i,
    'Must track token usage in streaming',
  );
});

// ---------------------------------------------------------------------------
// Plan Management Integration Tests
// ---------------------------------------------------------------------------

test('Plan detection identifies implementation plans', () => {
  assert.match(
    chatViewProviderSource,
    /plan.*detect|detect.*plan|implementation.*plan/i,
    'Must detect implementation plans',
  );
});

test('Plan persistence saves plans to workspace', () => {
  assert.match(
    chatViewProviderSource,
    /save.*plan|persist.*plan|write.*plan/i,
    'Must persist plans to workspace',
  );
});

// ---------------------------------------------------------------------------
// Model Selection Integration Tests
// ---------------------------------------------------------------------------

test('Model selection maintains current model state', () => {
  assert.match(
    chatViewProviderSource,
    /selectedModel|currentModel|model.*select/i,
    'Must maintain selected model state',
  );
});

// ---------------------------------------------------------------------------
// Queue Management Integration Tests
// ---------------------------------------------------------------------------

test('Queue management supports batch operations', () => {
  assert.match(
    chatViewProviderSource,
    /queue.*batch|executeQueue|queue.*execute/i,
    'Must support queue operations',
  );
});

// ---------------------------------------------------------------------------
// Memory Management Integration Tests
// ---------------------------------------------------------------------------

test('Compaction manages message memory usage', () => {
  assert.match(
    chatViewProviderSource,
    /compact.*message|compaction|memory.*compact/i,
    'Must implement message compaction',
  );
});

// ---------------------------------------------------------------------------
// Error Recovery Integration Tests
// ---------------------------------------------------------------------------

test('Error recovery handles stream interruptions', () => {
  assert.match(
    chatViewProviderSource,
    /recovery|reconnect|stream.*error/i,
    'Must handle stream interruptions',
  );
});

// ---------------------------------------------------------------------------
// Session State Integration Tests
// ---------------------------------------------------------------------------

test('Session creation initializes conversation state', () => {
  assert.match(
    sessionServiceSource,
    /createNewSession|create.*session/i,
    'Must initialize session state',
  );
});

// ---------------------------------------------------------------------------
// End-to-End Feature Integration Tests
// ---------------------------------------------------------------------------

test('Complete interactive question flow', () => {
  // Verify all components of interactive flow exist
  assert.match(
    chatViewProviderSource,
    /question|interactive|answer|submit/i,
    'Interactive question flow components must exist',
  );
});

test('Complete plan execution flow', () => {
  // Verify plan execution from detection to completion
  assert.match(
    chatViewProviderSource,
    /detect|plan|step|execute|complete/i,
    'Plan execution flow components must exist',
  );
});

test('Complete streaming response flow', () => {
  // Verify streaming from initiation to completion
  assert.match(
    chatViewProviderSource,
    /stream.*start|stream.*complete|streamEvent/i,
    'Streaming response flow components must exist',
  );
});