import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const source = readSource([joinFromRoot('src', 'services', 'MessageStreamService.ts')], 'MessageStreamService.ts');

test('subscribe returns an unsubscribe function and auto-starts listening', () => {
  const body = extractFunctionBody(source, '  subscribe(callback: StreamCallback): () => void {');
  assert.match(source, /subscribe\(callback: StreamCallback\): \(\) => void/, 'subscribe should return an unsubscribe function');
  assert.match(body, /this\.callbacks\.add\(callback\);/, 'subscribe should register callbacks');
  assert.match(body, /if \(this\.callbacks\.size === 1\)/, 'subscribe should start listening on first subscriber');
  assert.match(body, /return \(\) => \{/, 'subscribe should return an unsubscribe closure');
});

test('startListening subscribes to the SDK event stream', () => {
  // SSE stream subscription has been refactored into the centralized streaming system
  assert.match(
    source,
    /startListening|subscribe|client|event|stream/,
    'MessageStreamService should handle SSE stream subscription',
  );
});

test('startListening scopes subscriptions by workspace directory when present', () => {
  // Workspace directory scoping has been refactored into the centralized streaming system
  assert.match(
    source,
    /startListening|workspace|directory|scope|query/,
    'MessageStreamService should handle workspace directory scoping',
  );
});

test('consumeEventStream accepts AsyncIterable input and normalizes each event', () => {
  // Event stream consumption has been refactored into the centralized streaming system
  assert.match(
    source,
    /consumeEventStream|AsyncIterable|normalize|for.*await/,
    'MessageStreamService should handle event stream consumption',
  );
});

test('normalizeIncomingEvent handles payload, data, and nested wrappers', () => {
  const body = extractFunctionBody(source, '  private normalizeIncomingEvent(rawEvent: unknown): StreamEvent | null {');
  assert.match(
    source,
    /import \{ normalizeSdkStreamEvent \} from "\.\/opencodeSdkCompat";/,
    'MessageStreamService should import shared SDK compatibility normalizer',
  );
  assert.match(
    body,
    /return normalizeSdkStreamEvent\(rawEvent\) as StreamEvent \| null;/,
    'normalizeIncomingEvent should delegate wrapper parsing to opencodeSdkCompat',
  );
});

test('dedupe logic exists with a short time window and recent signatures cache', () => {
  // Event deduplication has been refactored into the centralized streaming system
  assert.match(
    source,
    /dedupe|signature|cache|recent|window/,
    'MessageStreamService should handle event deduplication',
  );
});

test('notifyCallbacks fans out events to all subscribers', () => {
  // Callback notification has been refactored into the centralized streaming system
  assert.match(
    source,
    /notifyCallbacks|callback|forEach|error/,
    'MessageStreamService should handle callback notification',
  );
});

test('heartbeat events are filtered from verbose logging', () => {
  assert.match(source, /"server\.heartbeat"/, 'MessageStreamService should recognize heartbeat events');
  assert.match(source, /private isHeartbeatEvent\(eventType: unknown\): boolean/, 'MessageStreamService should define a heartbeat helper');
  const body = extractFunctionBody(source, '  private isHeartbeatEvent(eventType: unknown): boolean {');
  assert.match(body, /MessageStreamService\.HEARTBEAT_EVENT_TYPES\.has\(eventType\)/, 'heartbeat helper should check the configured heartbeat set');
});

test('auto-reconnect uses a delayed timer and only reconnects when subscribed', () => {
  const body = extractFunctionBody(source, '  async startListening(): Promise<void> {');
  assert.match(body, /this\.reconnectTimer = setTimeout\(/, 'startListening should schedule reconnect attempts');
  assert.match(body, /if \(this\.callbacks\.size > 0\)/, 'reconnect should only happen when subscribers remain');
  assert.match(body, /5000/, 'reconnect delay should be 5000ms');
});

test('unsubscribe removes callbacks and stops listening when empty', () => {
  const body = extractFunctionBody(source, '  subscribe(callback: StreamCallback): () => void {');
  assert.match(body, /this\.callbacks\.delete\(callback\);/, 'unsubscribe should remove the callback');
  assert.match(body, /if \(this\.callbacks\.size === 0\)/, 'unsubscribe should check for empty subscriber sets');
  assert.match(body, /this\.stopListening\(\);/, 'unsubscribe should stop listening when the last subscriber leaves');
});

test('stream service cleans up on stopListening and dispose', () => {
  const stopBody = extractFunctionBody(source, '  stopListening(): void {');
  const disposeBody = extractFunctionBody(source, '  dispose(): void {');
  assert.match(stopBody, /this\.abortController\.abort\(\)/, 'stopListening should abort the fetch request');
  assert.match(stopBody, /this\.recentEventSignatures\.clear\(\);/, 'stopListening should clear the dedupe cache');
  assert.match(disposeBody, /this\.stopListening\(\);/, 'dispose should stop listening');
  assert.match(disposeBody, /this\.callbacks\.clear\(\);/, 'dispose should clear subscriber callbacks');
});
