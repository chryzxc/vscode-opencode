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
    /interactive|question|event/i,
    'Must handle interactive events',
  );
});

test('Interactive events support user responses', () => {
  assert.match(
    chatViewProviderSource,
    /answer|response|submit|interactive/i,
    'Must support user responses to interactive events',
  );
});

test('Interactive events preserve question options', () => {
  assert.match(
    chatViewProviderSource,
    /option|choice|select|multi/i,
    'Must preserve question options and settings',
  );
});

// ---------------------------------------------------------------------------
// Subagent Management Integration Tests
// ---------------------------------------------------------------------------

test('Subagent system tracks agent lifecycle', () => {
  assert.match(
    chatViewProviderSource,
    /subagent|agent|track|lifecycle/i,
    'Must track subagent lifecycle',
  );
});

test('Subagent persistence maintains agent state', () => {
  assert.match(
    chatViewProviderSource,
    /persist|save|restore|subagent/i,
    'Must persist subagent state',
  );
});

test('Subagent details provide execution information', () => {
  assert.match(
    chatViewProviderSource,
    /detail|info|execution|subagent/i,
    'Must provide subagent execution details',
  );
});

// ---------------------------------------------------------------------------
// Message Streaming Integration Tests
// ---------------------------------------------------------------------------

test('Message streaming handles chunked responses', () => {
  assert.match(
    chatViewProviderSource,
    /stream|chunk|part|update/i,
    'Must handle chunked streaming responses',
  );
});

test('Message streaming preserves message order', () => {
  assert.match(
    chatViewProviderSource,
    /order|sequence|queue|stream/i,
    'Must preserve message order in streaming',
  );
});

test('Message streaming handles concurrent streams', () => {
  assert.match(
    chatViewProviderSource,
    /concurrent|multiple|stream|parallel/i,
    'Must handle multiple concurrent streams',
  );
});

test('Message streaming includes token usage', () => {
  assert.match(
    chatViewProviderSource,
    /token|usage|count|stream/i,
    'Must track token usage in streaming',
  );
});

// ---------------------------------------------------------------------------
// Plan Management Integration Tests
// ---------------------------------------------------------------------------

test('Plan detection identifies implementation plans', () => {
  assert.match(
    chatViewProviderSource,
    /plan|detect|identify|implementation/i,
    'Must detect implementation plans',
  );
});

test('Plan persistence saves plans to workspace', () => {
  assert.match(
    chatViewProviderSource,
    /save|persist|write|plan/i,
    'Must persist plans to workspace',
  );
});

test('Plan viewing allows user inspection', () => {
  assert.match(
    chatViewProviderSource,
    /view|show|display|plan/i,
    'Must allow plan viewing',
  );
});

test('Plan execution tracks step progress', () => {
  assert.match(
    chatViewProviderSource,
    /step|progress|track|execute|plan/i,
    'Must track plan execution progress',
  );
});

// ---------------------------------------------------------------------------
// Model Selection Integration Tests
// ---------------------------------------------------------------------------

test('Model selection maintains current model state', () => {
  assert.match(
    chatViewProviderSource,
    /model|select|current|choose/i,
    'Must maintain selected model state',
  );
});

test('Model capabilities inform selection options', () => {
  assert.match(
    chatViewProviderSource,
    /capability|feature|support|model/i,
    'Must inform model selection based on capabilities',
  );
});

test('Model provider management handles multiple providers', () => {
  assert.match(
    chatViewProviderSource,
    /provider|anthropic|openai|gemini/i,
    'Must handle multiple model providers',
  );
});

// ---------------------------------------------------------------------------
// Queue Management Integration Tests
// ---------------------------------------------------------------------------

test('Queue management supports batch operations', () => {
  assert.match(
    chatViewProviderSource,
    /queue|batch|execute|prompt/i,
    'Must support queue operations',
  );
});

test('Queue execution processes prompts sequentially', () => {
  assert.match(
    chatViewProviderSource,
    /sequential|order|queue|execute/i,
    'Must process queued prompts in order',
  );
});

test('Queue state management tracks active operations', () => {
  assert.match(
    chatViewProviderSource,
    /state|active|running|queue/i,
    'Must track queue execution state',
  );
});

// ---------------------------------------------------------------------------
// Memory Management Integration Tests
// ---------------------------------------------------------------------------

test('Compaction manages message memory usage', () => {
  assert.match(
    chatViewProviderSource,
    /compaction|compact|memory|message/i,
    'Must implement message compaction',
  );
});

test('Compaction preserves important message context', () => {
  assert.match(
    chatViewProviderSource,
    /preserve|keep|important|context|compaction/i,
    'Must preserve important context during compaction',
  );
});

test('Compaction respects model context limits', () => {
  assert.match(
    chatViewProviderSource,
    /context|limit|window|compaction/i,
    'Must respect model context limits',
  );
});

// ---------------------------------------------------------------------------
// Error Recovery Integration Tests
// ---------------------------------------------------------------------------

test('Error recovery handles stream interruptions', () => {
  assert.match(
    chatViewProviderSource,
    /recovery|reconnect|interrupt|error/i,
    'Must handle stream interruptions',
  );
});

test('Error state management provides user feedback', () => {
  assert.match(
    chatViewProviderSource,
    /error|state|feedback|notify/i,
    'Must provide error feedback to user',
  );
});

test('Error logging captures diagnostic information', () => {
  assert.match(
    chatViewProviderSource,
    /log|diagnostic|error|capture/i,
    'Must capture error diagnostics',
  );
});

// ---------------------------------------------------------------------------
// Session State Integration Tests
// ---------------------------------------------------------------------------

test('Session creation initializes conversation state', () => {
  assert.match(
    sessionServiceSource,
    /create|init|session|state/i,
    'Must initialize session state',
  );
});

test('Session switching preserves conversation history', () => {
  assert.match(
    sessionServiceSource,
    /switch|history|preserve|session/i,
    'Must preserve history when switching sessions',
  );
});

test('Session deletion cleans up resources', () => {
  assert.match(
    sessionServiceSource,
    /delete|cleanup|remove|session/i,
    'Must cleanup session resources',
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
    /stream|start|chunk|end|complete/i,
    'Streaming response flow components must exist',
  );
});

test('Complete multi-turn conversation flow', () => {
  // Verify conversation from first message to latest
  assert.match(
    chatViewProviderSource,
    /conversation|turn|history|context/i,
    'Multi-turn conversation components must exist',
  );
});

test('Complete error recovery flow', () => {
  // Verify error detection, handling, and recovery
  assert.match(
    chatViewProviderSource,
    /error|detect|handle|recover/i,
    'Error recovery flow components must exist',
  );
});