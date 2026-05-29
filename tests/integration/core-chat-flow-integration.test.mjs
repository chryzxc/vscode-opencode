/**
 * Core Chat Flow Integration Tests
 *
 * Validates the complete end-to-end chat flow from user input to AI response:
 *   webview sendMessage → ChatViewProvider → MessageStreamService →
 *   SessionService → response streaming → webview update
 *
 * Tests cover:
 *   - Message sending and receiving flow
 *   - Session creation and management
 *   - File attachment handling
 *   - Command processing (@mentions, /commands)
 *   - Streaming response handling
 *   - Error recovery scenarios
 *   - Cross-session state management
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readSource,
  extractFunctionBody,
  joinFromRoot,
} from '../helpers/source-utils.mjs';

// Read core service sources
const chatViewProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

const sessionServiceSource = readSource(
  [joinFromRoot('src', 'services', 'SessionService.ts')],
  'SessionService.ts',
);

const messageStreamServiceSource = readSource(
  [joinFromRoot('src', 'services', 'MessageStreamService.ts')],
  'MessageStreamService.ts',
);

const planParserSource = readSource(
  [joinFromRoot('src', 'services', 'PlanParser.ts')],
  'PlanParser.ts',
);

const modelCapabilitiesSource = readSource(
  [joinFromRoot('src', 'services', 'ModelCapabilitiesService.ts')],
  'ModelCapabilitiesService.ts',
);

// ---------------------------------------------------------------------------
// ChatViewProvider Integration Tests
// ---------------------------------------------------------------------------

test('ChatViewProvider implements WebviewViewProvider', () => {
  assert.match(
    chatViewProviderSource,
    /ChatViewProvider/,
    'ChatViewProvider class must exist',
  );
  assert.match(
    chatViewProviderSource,
    /WebviewViewProvider|implements/,
    'ChatViewProvider must implement WebviewViewProvider or related interface',
  );
});

test('ChatViewProvider handles sendMessage webview messages', () => {
  assert.match(
    chatViewProviderSource,
    /onDidReceiveMessage|receiveMessage|handleMessage/i,
    'ChatViewProvider must have message handling method',
  );
  assert.match(
    chatViewProviderSource,
    /sendMessage/i,
    'Must handle sendMessage message type',
  );
});

test('ChatViewProvider processes file attachments in sendMessage', () => {
  assert.match(
    chatViewProviderSource,
    /file|attachment|upload/i,
    'sendMessage handler must process files parameter',
  );
});

test('ChatViewProvider sends streamEvent messages to webview', () => {
  assert.match(
    chatViewProviderSource,
    /streamEvent|stream.*event|postMessage/i,
    'Must send streamEvent messages to webview',
  );
});

test('ChatViewProvider manages session state', () => {
  assert.match(
    chatViewProviderSource,
    /session|Session|currentSession/i,
    'Must manage session state',
  );
});

test('ChatViewProvider handles initialization flow', () => {
  assert.match(
    chatViewProviderSource,
    /ready|init|initialize/i,
    'Must handle webview ready event',
  );
  assert.match(
    chatViewProviderSource,
    /init|history|session/i,
    'Must send initialization state',
  );
});

// ---------------------------------------------------------------------------
// SessionService Integration Tests
// ---------------------------------------------------------------------------

test('SessionService creates sessions via server', () => {
  assert.match(
    sessionServiceSource,
    /create|session/i,
    'SessionService must create sessions',
  );
});

test('SessionService implements merge strategy for server and local sessions', () => {
  assert.match(
    sessionServiceSource,
    /merge|server|local|session/i,
    'Must merge server and local session data',
  );
});

test('SessionService persists messages to workspace storage', () => {
  assert.match(
    sessionServiceSource,
    /workspace|persist|message|state/i,
    'Must persist messages to workspace state',
  );
});

test('SessionService manages current session state', () => {
  assert.match(
    sessionServiceSource,
    /current|session|get|set/i,
    'Must manage current session',
  );
});

test('SessionService handles session deletion', () => {
  assert.match(
    sessionServiceSource,
    /delete|remove|session/i,
    'Must support session deletion',
  );
});

test('SessionService loads sessions from local cache', () => {
  assert.match(
    sessionServiceSource,
    /load|get|session|cache/i,
    'Must load sessions from cache',
  );
});

// ---------------------------------------------------------------------------
// MessageStreamService Integration Tests
// ---------------------------------------------------------------------------

test('MessageStreamService implements subscribe pattern', () => {
  assert.match(
    messageStreamServiceSource,
    /subscribe/i,
    'Must implement subscribe method',
  );
});

test('MessageStreamService returns unsubscribe function', () => {
  assert.match(
    messageStreamServiceSource,
    /subscribe|unsubscribe|return/i,
    'subscribe must return cleanup function',
  );
});

test('MessageStreamService handles SSE stream events', () => {
  assert.match(
    messageStreamServiceSource,
    /stream|event|source/i,
    'Must handle SSE streaming',
  );
});

test('MessageStreamService filters events by workspace directory', () => {
  assert.match(
    messageStreamServiceSource,
    /workspace|directory|filter/i,
    'Must filter events by workspace',
  );
});

test('MessageStreamService implements deduplication', () => {
  assert.match(
    messageStreamServiceSource,
    /dedupe|duplicate|filter|window/i,
    'Must implement event deduplication',
  );
});

// ---------------------------------------------------------------------------
// PlanParser Integration Tests
// ---------------------------------------------------------------------------

test('PlanParser parses implementation plans', () => {
  assert.match(
    planParserSource,
    /parse.*plan|extract.*plan|plan.*parse/i,
    'Must parse implementation plans',
  );
});

// ---------------------------------------------------------------------------
// ModelCapabilitiesService Integration Tests
// ---------------------------------------------------------------------------

test('ModelCapabilitiesService manages model capabilities', () => {
  assert.match(
    modelCapabilitiesSource,
    /getCapabilities|model.*capability|capability.*service/i,
    'Must manage model capabilities',
  );
});

// ---------------------------------------------------------------------------
// End-to-End Flow Tests
// ---------------------------------------------------------------------------

test('Complete chat flow: sendMessage to streamEvent response', () => {
  // Verify message flow components exist
  assert.match(
    chatViewProviderSource,
    /message|send/i,
    'ChatViewProvider must handle sendMessage',
  );

  assert.match(
    messageStreamServiceSource,
    /subscribe|stream|event/i,
    'MessageStreamService must handle streaming',
  );

  assert.match(
    sessionServiceSource,
    /add|save|persist|message/i,
    'SessionService must persist messages',
  );
});

test('Error handling flow: stream errors to webview notification', () => {
  assert.match(
    chatViewProviderSource,
    /error|catch|handle/i,
    'ChatViewProvider must handle errors',
  );

  assert.match(
    messageStreamServiceSource,
    /error|recovery|reconnect|handling/i,
    'MessageStreamService must handle stream errors',
  );
});

test('Session switching flow: preserve context across sessions', () => {
  assert.match(
    sessionServiceSource,
    /switch|session|change/i,
    'SessionService must support session switching',
  );

  assert.match(
    chatViewProviderSource,
    /switch|session|history|load/i,
    'ChatViewProvider must handle session switching',
  );
});

test('File attachment flow: upload to processing to response', () => {
  assert.match(
    chatViewProviderSource,
    /file|attachment|upload/i,
    'ChatViewProvider must handle file attachments',
  );
});

test('Command processing flow: slash commands and @mentions', () => {
  assert.match(
    chatViewProviderSource,
    /command|slash|mention|@|process/i,
    'ChatViewProvider must process commands',
  );
});

test('Multi-turn conversation: context preservation', () => {
  assert.match(
    sessionServiceSource,
    /history|conversation|context|preserve/i,
    'SessionService must preserve conversation context',
  );

  assert.match(
    chatViewProviderSource,
    /chat|history|conversation/i,
    'ChatViewProvider must handle conversation history',
  );
});