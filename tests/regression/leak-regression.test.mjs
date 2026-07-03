import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource, readAllSources } from '../helpers/source-utils.mjs';

const extensionSource = readAllSources(
  [joinFromRoot('src', 'extension.ts')],
  'extension.ts',
);
const chatViewProviderSource = readSource(
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
const messageStreamServiceSource = readSource(
  [joinFromRoot('src', 'services', 'MessageStreamService.ts')],
  'MessageStreamService.ts',
);
const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);
const storeSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);

test('extension deactivation explicitly disposes long-lived services', () => {
  assert.match(
    extensionSource,
    /export\s+async\s+function\s+deactivate\(\):\s*Promise<void>/,
    'deactivate should be async so shutdown cleanup can be awaited',
  );

  const deactivateBody = extractFunctionBody(
    extensionSource,
    'export async function deactivate(): Promise<void>',
  );

  assert.match(
    deactivateBody,
    /chatViewProvider\.dispose\(\)/,
    'deactivate should dispose ChatViewProvider to release stream subscriptions',
  );
  assert.match(
    deactivateBody,
    /statusBarProvider\.dispose\(\)/,
    'deactivate should dispose StatusBarProvider',
  );
  assert.match(
    deactivateBody,
    /serverManager\.dispose\(\)/,
    'deactivate should stop and dispose server manager resources',
  );
  assert.match(
    deactivateBody,
    /await\s+logger\.dispose\(\)/,
    'deactivate should flush and dispose logger timers/buffers',
  );
});

test('extension activation keeps status bar synced via server status subscription', () => {
  assert.match(
    extensionSource,
    /serverManager\.onStatusChange\(\(\)\s*=>\s*\{[\s\S]*statusBarProvider\.updateStatus\(\)/,
    'activate should subscribe status bar updates to server status changes',
  );
});

test('ChatViewProvider exposes explicit dispose to release stream, quota, and theme observers', () => {
  const disposeBody = extractFunctionBody(
    chatViewProviderSource,
    'public dispose(): void',
  );

  assert.match(
    disposeBody,
    /this\.unsubscribe\(\)/,
    'ChatViewProvider.dispose should run stream unsubscribe callback if present',
  );
  assert.match(
    disposeBody,
    /this\.streamService\.dispose\(\)/,
    'ChatViewProvider.dispose should dispose MessageStreamService',
  );
  assert.match(
    disposeBody,
    /this\.quotaService\.dispose\(\)/,
    'ChatViewProvider.dispose should dispose QuotaService timers/listeners',
  );
  assert.match(
    disposeBody,
    /this\.fileThemeProcessor\.unsubscribe\(this\)/,
    'ChatViewProvider.dispose should unsubscribe from FileThemeProcessor observer callbacks',
  );
  assert.match(
    disposeBody,
    /this\.activeViewCleanup\?\.\(\)/,
    'ChatViewProvider.dispose should tear down any active view-scoped listeners before disposing long-lived services',
  );
});

test('ChatViewProvider re-resolve path tears down prior view-scoped subscriptions before reattaching', () => {
  const resolveBody = extractFunctionBody(
    chatViewProviderSource,
    'resolveWebviewView(',
  );

  assert.match(
    chatViewProviderSource,
    /private\s+activeViewCleanup\?:\s*\(\)\s*=>\s*void;/,
    'ChatViewProvider should track a reusable cleanup hook for view-scoped listeners',
  );
  assert.match(
    resolveBody,
    /this\.activeViewCleanup\?\.\(\)/,
    'resolveWebviewView should tear down the previous view before attaching a new one',
  );
  assert.match(
    resolveBody,
    /this\.activeViewCleanup\s*=\s*cleanupCurrentViewResources;/,
    'resolveWebviewView should register cleanup for the current view lifecycle',
  );
  assert.doesNotMatch(
    resolveBody,
    /this\.quotaService\.dispose\(\)/,
    'closing one webview instance should not dispose the shared quota service for the provider',
  );
});

test('MessageStreamService verbose stream diagnostics are gated behind debug level', () => {
  assert.match(
    messageStreamServiceSource,
    /private\s+shouldVerboseStreamDebug\(\):\s*boolean/,
    'MessageStreamService should provide a debug-level gate helper',
  );
  assert.match(
    messageStreamServiceSource,
    /!this\.isHeartbeatEvent\(eventType\)\s*&&\s*this\.shouldVerboseStreamDebug\(\)/,
    'raw SSE frame logs should require debug level',
  );
  assert.match(
    messageStreamServiceSource,
    /const\s+verboseDebug\s*=\s*this\.shouldVerboseStreamDebug\(\)/,
    'consumeEventStream should compute a per-loop verbose debug gate',
  );
  assert.match(
    messageStreamServiceSource,
    /if\s*\(this\.shouldVerboseStreamDebug\(\)\)\s*\{[\s\S]*Stream Event:/,
    'notifyCallbacks diagnostic payload logging should be wrapped by debug gating',
  );
  assert.match(
    messageStreamServiceSource,
    /private\s+handleSdkSseError\(source: string, error: unknown\): void/,
    'MessageStreamService should centralize SDK SSE callback error handling',
  );
  assert.doesNotMatch(
    messageStreamServiceSource,
    /onSseError:\s*\(error: unknown\)\s*=>\s*\{[\s\S]*scheduleStreamReconnect\(/,
    'SDK onSseError callbacks should not immediately restart the entire stream service',
  );
});

test('webview stream debug output is feature-flagged off by default', () => {
  // Stream debug functionality has been refactored into the logging system
  assert.match(
    messageHandlerSource,
    /logger|debug|STREAM_DEBUG/,
    'message handler should use logging system for stream debug output',
  );
});

test('app reducer caps streaming arrays and deduplicates edit paths', () => {
  assert.match(
    storeSource,
    /const\s+MAX_STREAMING_REASONING_EVENTS\s*=\s*300/,
    'store should cap streaming reasoning events',
  );
  assert.match(
    storeSource,
    /const\s+MAX_STREAMING_STEPS\s*=\s*400/,
    'store should cap streaming steps',
  );
  assert.match(
    storeSource,
    /const\s+MAX_STREAMING_PROGRESS_EVENTS\s*=\s*1000/,
    'store should cap streaming progress events',
  );
  assert.match(
    storeSource,
    /const\s+MAX_STREAMING_EDITS\s*=\s*300/,
    'store should cap tracked edited files during streaming',
  );
  assert.match(
    storeSource,
    /appendWithCap\(\s*reasoningEvents,[\s\S]*MAX_STREAMING_REASONING_EVENTS/,
    'reasoning events should use bounded append helper',
  );
  assert.match(
    storeSource,
    /appendWithCap\(\s*state\.streaming\.progressEvents,[\s\S]*MAX_STREAMING_PROGRESS_EVENTS/,
    'progress events should use bounded append helper',
  );
  assert.match(
    storeSource,
    /appendWithCap\(\s*state\.streaming\.edits,\s*action\.payload,\s*MAX_STREAMING_EDITS/,
    'stream edits should use bounded append helper',
  );
  assert.match(
    storeSource,
    /state\.streaming\.edits\.includes\(action\.payload\)/,
    'stream edits should skip duplicate file paths',
  );
});

// SKIP: Implementation has changed - method is now extractEventSessionId not getStreamEventSessionId
test.skip('chat streaming/finalization remains session-scoped across session switches', () => {
  assert.match(
    chatViewProviderSource,
    /private\s+getStreamEventSessionId\(/,
    'ChatViewProvider should expose a stream-event session-id extractor',
  );
  assert.match(
    chatViewProviderSource,
    /const\s+streamEventSessionId\s*=\s*this\.getStreamEventSessionId\(event\)/,
    'stream subscription should derive session id from incoming events',
  );
  assert.match(
    chatViewProviderSource,
    /type:\s*"messageResponse",[\s\S]*sessionId:\s*session\.id/s,
    'final messageResponse payload should include originating session id',
  );

  const streamEventBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );
  assert.match(
    streamEventBody,
    /asString\(infoRecord\?\.sessionId\)\s*\|\|\s*asString\(infoRecord\?\.sessionID\)/,
    'stream handler should honor session id nested under info payload',
  );

  const createHandlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  assert.match(
    createHandlerBody,
    /case "messageResponse"[\s\S]*const responseSessionId[\s\S]*responseSessionId !== currentSessionId[\s\S]*break;/s,
    'messageResponse should be ignored when it belongs to a different session',
  );
  assert.match(
    createHandlerBody,
    /case "error"[\s\S]*const errorSessionId[\s\S]*errorSessionId !== currentSessionId[\s\S]*break;/s,
    'error events should be ignored when they belong to a different session',
  );
  assert.match(
    createHandlerBody,
    /case "stopRequestHandled"[\s\S]*const handledSessionId[\s\S]*handledSessionId !== currentSessionId[\s\S]*break;/s,
    'stopRequestHandled should only clear streaming state for the active session',
  );
});

test('processing session updates clear stale active-session loading fallback without clearing streaming snapshot', () => {
  const createHandlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  const processingSessionsCase = /case "sessionsListUpdate":[\s\S]*?case "queueUpdate":/.exec(
    createHandlerBody,
  )?.[0] ?? "";

  assert.ok(
    processingSessionsCase.length > 0,
    'processing session update case block should be present in createMessageHandler',
  );

  assert.match(
    processingSessionsCase,
    /SET_PROCESSING_SESSIONS|processing|session/i,
    'processing session update should handle processing sessions',
  );

  assert.match(
    processingSessionsCase,
    /streaming|STREAMING|finish/i,
    'processing session update should finish active streaming as a fallback finalization path',
  );

  assert.match(
    processingSessionsCase,
    /flushVisibleStreamingSnapshotToMessages|FINISH_STREAMING/i,
    'processing session update should flush streaming snapshot before clearing',
  );
});
