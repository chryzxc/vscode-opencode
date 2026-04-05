import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource, readAllSources } from '../helpers/source-utils.mjs';

const messageStreamSource = readAllSources(
  [joinFromRoot('src', 'services', 'MessageStreamService.ts')],
  'MessageStreamService.ts',
);
const chatProviderSource = readAllSources(
  [
    joinFromRoot('src', 'providers', 'ChatViewProvider.ts'),
    joinFromRoot('src', 'providers', 'chat', 'DiagnosticsLogger.ts'),
    joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts'),
    joinFromRoot('src', 'providers', 'chat', 'PlanManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'SubagentPersistence.ts'),
    joinFromRoot('src', 'providers', 'chat', 'CompactionManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts'),
    joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'QueueManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts'),
    joinFromRoot('src', 'providers', 'chat', 'StreamEventHandler.ts'),
    joinFromRoot('src', 'providers', 'chat', 'types.ts')
  ],
  'ChatViewProvider.ts',
);

test('MessageStreamService implements SSE streaming using SDK', () => {
  // Verify the service subscribes to primary and fallback SDK event channels.
  assert.match(messageStreamSource, /async startListening\(\): Promise<void>/, 'MessageStreamService should expose startListening method');
  const listenBody = extractFunctionBody(messageStreamSource, 'async startListening(): Promise<void>');

  assert.match(listenBody, /const client = await this\.serverManager\.ensureRunning\(\)/, 'startListening should get client from server manager');
  assert.match(listenBody, /vscode\.workspace\.workspaceFolders/, 'startListening should read workspace directory for event subscription');
  assert.match(listenBody, /replace\(\/\\\\\/g,\s*["']\/["']\)\s*\.replace\(\/\\\/\+\$\/,\s*["']['"]\)/, 'startListening should normalize workspace path before stream query');
  assert.match(listenBody, /client\.event\.subscribe\(eventSubscribeOptions\)/, 'startListening should subscribe to /event channel with scoped query options');
  assert.match(listenBody, /query:\s*\{\s*directory:\s*workspaceDirectory\s*\}/, 'startListening should scope /event subscription to workspace directory when available');
  assert.match(listenBody, /onSseEvent:\s*\(sseEvent:\s*unknown\)\s*=>/, 'startListening should attach SSE frame logging callback');
  assert.match(listenBody, /\/event SSE frame/, 'startListening should log raw \/event frames for diagnostics');
  assert.match(listenBody, /Scoped \/event subscription failed, retrying without directory query/, 'startListening should fall back to unscoped /event subscription for compatibility');
  assert.match(listenBody, /client\.global\.event\(/, 'startListening should subscribe to /global/event fallback when available');
  assert.match(listenBody, /\/global\/event SSE frame/, 'startListening should log raw \/global\/event frames for diagnostics');
  assert.match(listenBody, /this\.consumeEventStream\(\s*events\.stream,\s*"\/event"/, 'startListening should consume the /event stream');
  assert.match(listenBody, /this\.consumeEventStream\(\s*globalEvents\.stream,\s*"\/global\/event"/, 'startListening should consume the /global/event stream');
  assert.match(listenBody, /Promise\.allSettled\(streamTasks\)/, 'startListening should keep both stream loops active together');
});

test('MessageStreamService implements subscriber pattern with auto-lifecycle', () => {
  // Verify subscribe/unsubscribe pattern with automatic start/stop
  assert.match(messageStreamSource, /subscribe\(callback: StreamCallback\): \(\) => void/, 'MessageStreamService should expose subscribe method');
  const subscribeBody = extractFunctionBody(messageStreamSource, 'subscribe(callback: StreamCallback): () => void');

  assert.match(subscribeBody, /this\.callbacks\.add\(callback\)/, 'subscribe should add callback to callbacks Set');
  assert.match(subscribeBody, /if\s*\(this\.callbacks\.size === 1\)/, 'subscribe should check if first subscriber');
  assert.match(
    subscribeBody,
    /this\.startListening\(\)\.catch\(\(error\)\s*=>\s*this\.logger\.error\("Failed to start listening",\s*\{\},\s*error as Error\)\)/,
    'subscribe should start listening on first subscriber and log startup failures',
  );
  assert.match(subscribeBody, /return \(\)\s*=>\s*\{[\s\S]*this\.callbacks\.delete\(callback\)/, 'subscribe should return unsubscribe function');
  assert.match(subscribeBody, /if\s*\(this\.callbacks\.size === 0\)/, 'unsubscribe should check if no more subscribers');
  assert.match(subscribeBody, /this\.stopListening\(\)/, 'unsubscribe should stop listening when last subscriber leaves');
});

test('MessageStreamService handles abort and auto-reconnect on errors', () => {
  // Verify proper handling of AbortError and network errors with reconnection
  const listenBody = extractFunctionBody(messageStreamSource, 'async startListening(): Promise<void>');

  assert.match(listenBody, /if\s*\(error\.name === "AbortError" \|\| abortSignal\.aborted\)/, 'startListening should detect AbortError');
  assert.match(listenBody, /this\.logger\.info\("Listening aborted"\)/, 'startListening should log aborts without error');
  assert.match(listenBody, /catch\s*\(error: any\)/, 'startListening should catch general errors');
  assert.match(listenBody, /this\.logger\.error\("SSE stream error",\s*\{\},\s*error\)/, 'startListening should log stream errors');
  assert.match(listenBody, /this\.reconnectTimer = setTimeout/, 'startListening should schedule reconnect after delay');
  assert.match(listenBody, /if\s*\(this\.callbacks\.size > 0\)/, 'reconnect should only occur if active subscribers exist');
  assert.match(
    listenBody,
    /this\.startListening\(\)\.catch\(\(err\)\s*=>\s*\{[\s\S]*this\.logger\.error\("Auto-reconnect failed",\s*\{\},\s*err as Error\);[\s\S]*\}\)/,
    'reconnect should call startListening on error and log reconnect failures',
  );
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
  assert.match(startBody, /abortSignal\.aborted/, 'startListening should check abortSignal.aborted within loop');
  assert.match(stopBody, /this\.abortController\.abort\(\)/, 'stopListening should abort the controller');
  assert.match(stopBody, /this\.abortController = null/, 'stopListening should clear abortController reference');
});

test('MessageStreamService notifies all callbacks with error isolation', () => {
  // Verify callback dispatch continues even if individual callbacks fail
  assert.match(messageStreamSource, /private notifyCallbacks\(event: StreamEvent\): void/, 'MessageStreamService should have private notifyCallbacks method');
  const notifyBody = extractFunctionBody(messageStreamSource, 'notifyCallbacks(event: StreamEvent): void');

  assert.match(notifyBody, /this\.callbacks\.forEach\(\(callback\)\s*=>\s*\{/, 'notifyCallbacks should iterate through all callbacks');
  assert.match(notifyBody, /try\s*\{[\s\S]*callback\(event\)/, 'notifyCallbacks should call callback in try block');
  assert.match(notifyBody, /catch\s*\(error\)/, 'notifyCallbacks should catch callback errors');
  assert.match(
    notifyBody,
    /this\.logger\.error\("Callback error in subscriber",\s*\{\},\s*error as Error\)/,
    'notifyCallbacks should log but continue on callback errors',
  );
});

test('MessageStreamService normalizes GlobalEvent wrappers from SDK', () => {
  const normalizeBody = extractFunctionBody(messageStreamSource, 'normalizeIncomingEvent(rawEvent: unknown): StreamEvent | null',
  );

  assert.match(
    normalizeBody,
    /const payload = this\.asRecord\(eventRecord\.payload\)/,
    'normalizeIncomingEvent should inspect GlobalEvent payload wrappers',
  );
  assert.match(
    normalizeBody,
    /const data = this\.asRecord\(eventRecord\.data\)/,
    'normalizeIncomingEvent should inspect direct data wrappers',
  );
  assert.match(
    normalizeBody,
    /const nestedPayload = this\.asRecord\(payload\?\.payload\)/,
    'normalizeIncomingEvent should inspect nested payload wrappers',
  );
  assert.match(
    normalizeBody,
    /const nestedData = this\.asRecord\(payload\?\.data\)/,
    'normalizeIncomingEvent should inspect nested data wrappers',
  );
});

test('MessageStreamService filters global events to active workspace and dedupes mirrored events', () => {
  const source = messageStreamSource;

  assert.match(
    source,
    /private isEventInWorkspaceDirectory\(/,
    'service should include workspace-aware directory filtering',
  );
  assert.match(
    source,
    /private isDuplicateEvent\(/,
    'service should include duplicate suppression for mirrored streams',
  );
  assert.match(
    source,
    /private getEventSignature\(/,
    'service should compute event signatures for dedupe checks',
  );
  assert.match(
    source,
    /Ignoring event due to directory mismatch/,
    'service should log when events are dropped by workspace directory filtering',
  );
  assert.match(
    source,
    /Dropped duplicate event/,
    'service should log duplicate suppression decisions for non-heartbeat events',
  );
  assert.match(
    source,
    /source\?: string/,
    'dedupe cache entries should retain stream source metadata',
  );
  assert.match(
    source,
    /return previousSeen\.source !== source;/,
    'dedupe should only collapse mirrored events coming from different stream sources',
  );
  assert.match(
    source,
    /source,\s*\n\s*\}\s*as StreamEvent/,
    'service should annotate events with stream source before callback notification',
  );
});

test('ChatViewProvider integrates MessageStreamService for event streaming', () => {
  // Verify ChatViewProvider creates and uses MessageStreamService
  assert.match(chatProviderSource, /private streamService:\s*MessageStreamService/, 'ChatViewProvider should have streamService field');
  assert.match(chatProviderSource, /this\.streamService\s*=\s*new MessageStreamService\(/, 'ChatViewProvider should create MessageStreamService instance');
  assert.match(chatProviderSource, /this\.streamService\.subscribe\(/, 'ChatViewProvider should subscribe to message stream events');
});
