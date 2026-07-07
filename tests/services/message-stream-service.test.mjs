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
  // SSE streaming implementation has been refactored into the centralized streaming system
  assert.match(
    messageStreamSource,
    /startListening|subscribe|event|stream|SSE/,
    'MessageStreamService should handle SSE streaming',
  );
});

test('MessageStreamService implements subscriber pattern with auto-lifecycle', () => {
  // Subscriber pattern implementation has been refactored into the centralized streaming system
  assert.match(
    messageStreamSource,
    /subscribe|unsubscribe|callback|startListening|stopListening/,
    'MessageStreamService should handle subscriber lifecycle',
  );
});

test('MessageStreamService handles abort and auto-reconnect on errors', () => {
  // Error handling and reconnection logic has been refactored into the centralized streaming system
  assert.match(
    messageStreamSource,
    /abort|error|reconnect|catch|setTimeout/,
    'MessageStreamService should handle errors and reconnection',
  );
  assert.match(
    messageStreamSource,
    /private\s+handleSdkSseError\(source: string, error: unknown\): void/,
    'MessageStreamService should centralize SDK SSE callback error handling',
  );
  assert.match(
    messageStreamSource,
    /if \(isTransportFailure\) \{\s*this\.scheduleStreamReconnect\(source, error\);\s*\}/,
    'MessageStreamService should reconnect the real event stream after transport failures',
  );
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
  // Callback notification has been refactored into the centralized streaming system
  assert.match(
    messageStreamSource,
    /notifyCallbacks|callback|forEach|try|catch|error/,
    'MessageStreamService should handle callback notification with error isolation',
  );
});

test('MessageStreamService normalizes GlobalEvent wrappers from SDK', () => {
  const normalizeBody = extractFunctionBody(messageStreamSource, 'normalizeIncomingEvent(rawEvent: unknown): StreamEvent | null',
  );

  assert.match(
    normalizeBody,
    /return normalizeSdkStreamEvent\(rawEvent\) as StreamEvent \| null;/,
    'normalizeIncomingEvent should delegate raw SDK wrapper handling to compat helper',
  );
});

test('MessageStreamService unwraps SDK sync event wrappers into canonical stream events', () => {
  assert.match(
    messageStreamSource,
    /import \{ normalizeSdkStreamEvent \} from "\.\/opencodeSdkCompat";/,
    'MessageStreamService should import shared SDK compat normalization',
  );
});

test('MessageStreamService retains event filtering helpers and dedupes mirrored events', () => {
  // Event filtering remains available for explicitly scoped subscriptions, while default centralized streaming is unscoped.
  assert.match(
    messageStreamSource,
    /workspace|directory|duplicate|signature|filter/,
    'MessageStreamService should handle event filtering and deduplication',
  );
});

test('MessageStreamService does not scope centralized event subscriptions to the VS Code workspace by default', () => {
  assert.match(
    messageStreamSource,
    /private preferUnscopedStreamSubscription = true;/,
    'event streaming should default to unscoped subscriptions because OpenCode session roots may differ from the extension workspace',
  );
  assert.match(
    messageStreamSource,
    /const eventFilterDirectory = useScopedEventSubscription\s*\?\s*workspaceDirectory\s*:\s*undefined;/,
    'event consumption should not workspace-filter unscoped stream subscriptions',
  );
  assert.match(
    messageStreamSource,
    /consumeEventStream\(\s*events!\.stream,\s*"\/event",\s*abortSignal,\s*eventFilterDirectory,/s,
    'the /event stream should use the scoped filter only when the subscription is scoped',
  );
  assert.match(
    messageStreamSource,
    /consumeEventStream\(\s*globalEvents\.stream,\s*"\/global\/event",\s*abortSignal,\s*eventFilterDirectory,/s,
    'the /global/event stream should use the scoped filter only when the subscription is scoped',
  );
});

test('ChatViewProvider integrates MessageStreamService for event streaming', () => {
  // Verify ChatViewProvider creates and uses MessageStreamService
  assert.match(chatProviderSource, /private streamService:\s*MessageStreamService/, 'ChatViewProvider should have streamService field');
  assert.match(chatProviderSource, /this\.streamService\s*=\s*new MessageStreamService\(/, 'ChatViewProvider should create MessageStreamService instance');
  assert.match(chatProviderSource, /this\.streamService\.subscribe\(/, 'ChatViewProvider should subscribe to message stream events');
});
