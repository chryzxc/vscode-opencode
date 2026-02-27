import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const messageStreamSource = readSource(
  [joinFromRoot('src', 'services', 'MessageStreamService.ts')],
  'MessageStreamService.ts',
);
const chatProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

test('MessageStreamService implements SSE streaming with fetch-based approach', () => {
  // Verify the service uses fetch API instead of EventSource for custom headers support
  assert.match(messageStreamSource, /async startListening\(\): Promise<void>/, 'MessageStreamService should expose startListening method');
  assert.match(messageStreamSource, /const response = await fetch\(eventUrl/, 'startListening should use fetch API for SSE connection');
  assert.match(messageStreamSource, /headers:\s*\{[\s\S]*Accept:\s*"text\/event-stream"/, 'fetch should set Accept header for event-stream');
});

test('MessageStreamService parses SSE protocol with buffer management', () => {
  // Verify SSE protocol parsing: data: prefix extraction and JSON parsing
  const listenBody = extractFunctionBody(messageStreamSource, 'async startListening(): Promise<void>');

  assert.match(listenBody, /const decoder = new TextDecoder\(\)/, 'startListening should use TextDecoder for binary stream decoding');
  assert.match(listenBody, /let buffer = ""/, 'startListening should maintain buffer for incomplete chunks');
  assert.match(listenBody, /buffer \+= decoder\.decode\(value,\s*\{\s*stream:\s*true\s*\}\)/, 'startListening should append decoded chunks to buffer');
  assert.match(listenBody, /const lines = buffer\.split\("\\n"\)/, 'startListening should split buffer by newlines');
  assert.match(listenBody, /buffer = lines\.pop\(\)/, 'startListening should keep last incomplete line in buffer');
  assert.match(listenBody, /if\s*\(line\.startsWith\("data: "\)\)/, 'startListening should check for data: prefix');
  assert.match(listenBody, /const data = JSON\.parse\(line\.substring\(6\)\)/, 'startListening should parse JSON after data: prefix');
  assert.match(listenBody, /this\.notifyCallbacks\(data\)/, 'startListening should dispatch parsed events to callbacks');
});

test('MessageStreamService implements buffer overflow protection', () => {
  // Verify protection against unbounded buffer growth from malformed SSE
  const listenBody = extractFunctionBody(messageStreamSource, 'async startListening(): Promise<void>');

  assert.match(listenBody, /if\s*\(buffer\.length > 1_000_000\)/, 'startListening should check buffer size exceeds 1MB');
  assert.match(listenBody, /buffer = buffer\.slice\(-500_000\)/, 'startListening should trim buffer to 500KB when oversized');
  assert.match(listenBody, /oversizedBufferWarned/, 'startListening should track warning state to avoid duplicate logs');
  assert.match(listenBody, /console\.warn\(\s*"\[MessageStreamService\] SSE buffer exceeded 1MB/, 'startListening should warn about oversized buffer');
});

test('MessageStreamService implements subscriber pattern with auto-lifecycle', () => {
  // Verify subscribe/unsubscribe pattern with automatic start/stop
  assert.match(messageStreamSource, /subscribe\(callback: StreamCallback\): \(\) => void/, 'MessageStreamService should expose subscribe method');
  const subscribeBody = extractFunctionBody(messageStreamSource, 'subscribe(callback: StreamCallback): () => void');

  assert.match(subscribeBody, /this\.callbacks\.add\(callback\)/, 'subscribe should add callback to callbacks Set');
  assert.match(subscribeBody, /if\s*\(this\.callbacks\.size === 1\)/, 'subscribe should check if first subscriber');
  assert.match(subscribeBody, /this\.startListening\(\)\.catch\(console\.error\)/, 'subscribe should start listening on first subscriber');
  assert.match(subscribeBody, /return \(\)\s*=>\s*\{[\s\S]*this\.callbacks\.delete\(callback\)/, 'subscribe should return unsubscribe function');
  assert.match(subscribeBody, /if\s*\(this\.callbacks\.size === 0\)/, 'unsubscribe should check if no more subscribers');
  assert.match(subscribeBody, /this\.stopListening\(\)/, 'unsubscribe should stop listening when last subscriber leaves');
});

test('MessageStreamService handles abort and auto-reconnect on errors', () => {
  // Verify proper handling of AbortError and network errors with reconnection
  const listenBody = extractFunctionBody(messageStreamSource, 'async startListening(): Promise<void>');

  assert.match(listenBody, /if\s*\(error\.name === "AbortError"\)/, 'startListening should detect AbortError');
  assert.match(listenBody, /console\.log\("\[MessageStreamService\] Listening aborted"\)/, 'startListening should log aborts without error');
  assert.match(listenBody, /catch\s*\(error: any\)/, 'startListening should catch general errors');
  assert.match(listenBody, /console\.error\("\[MessageStreamService\] SSE stream error:"/, 'startListening should log stream errors');
  assert.match(listenBody, /this\.reconnectTimer = setTimeout/, 'startListening should schedule reconnect after delay');
  assert.match(listenBody, /if\s*\(this\.callbacks\.size > 0\)/, 'reconnect should only occur if active subscribers exist');
  assert.match(listenBody, /this\.startListening\(\)\.catch\(console\.error\)/, 'reconnect should call startListening on error');
  assert.match(listenBody, /5000/, 'reconnect should use 5 second delay');
});

test('MessageStreamService cleans up resources properly on dispose', () => {
  // Verify dispose stops connection and clears all state
  assert.match(messageStreamSource, /dispose\(\): void/, 'MessageStreamService should expose dispose method');
  const disposeBody = extractFunctionBody(messageStreamSource, 'dispose(): void');

  assert.match(disposeBody, /this\.stopListening\(\)/, 'dispose should stop the SSE connection');
  assert.match(disposeBody, /this\.callbacks\.clear\(\)/, 'dispose should clear all subscriber callbacks');
});

test('MessageStreamService uses AbortController for proper cancellation', () => {
  // Verify AbortController usage for clean shutdown
  assert.match(messageStreamSource, /private abortController: AbortController \| null = null/, 'MessageStreamService should have abortController field');
  const startBody = extractFunctionBody(messageStreamSource, 'async startListening(): Promise<void>');
  const stopBody = extractFunctionBody(messageStreamSource, 'stopListening(): void');

  assert.match(startBody, /this\.abortController = new AbortController\(\)/, 'startListening should create new AbortController');
  assert.match(startBody, /signal:\s*this\.abortController\.signal/, 'fetch should use AbortController signal');
  assert.match(stopBody, /this\.abortController\.abort\(\)/, 'stopListening should abort the fetch request');
  assert.match(stopBody, /this\.abortController = null/, 'stopListening should clear abortController reference');
});

test('MessageStreamService notifies all callbacks with error isolation', () => {
  // Verify callback dispatch continues even if individual callbacks fail
  assert.match(messageStreamSource, /private notifyCallbacks\(event: StreamEvent\): void/, 'MessageStreamService should have private notifyCallbacks method');
  const notifyBody = extractFunctionBody(messageStreamSource, 'private notifyCallbacks(event: StreamEvent): void');

  assert.match(notifyBody, /this\.callbacks\.forEach\(\(callback\)\s*=>\s*\{/, 'notifyCallbacks should iterate through all callbacks');
  assert.match(notifyBody, /try\s*\{[\s\S]*callback\(event\)/, 'notifyCallbacks should call callback in try block');
  assert.match(notifyBody, /catch\s*\(error\)/, 'notifyCallbacks should catch callback errors');
  assert.match(notifyBody, /console\.error\("Callback error:"/, 'notifyCallbacks should log but continue on error');
});

test('ChatViewProvider integrates MessageStreamService for event streaming', () => {
  // Verify ChatViewProvider creates and uses MessageStreamService
  assert.match(chatProviderSource, /private streamService:\s*MessageStreamService/, 'ChatViewProvider should have streamService field');
  assert.match(chatProviderSource, /this\.streamService\s*=\s*new MessageStreamService\(/, 'ChatViewProvider should create MessageStreamService instance');
  assert.match(chatProviderSource, /this\.streamService\.subscribe\(/, 'ChatViewProvider should subscribe to message stream events');
});
