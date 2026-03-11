import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const extensionSource = readSource(
  [joinFromRoot('src', 'extension.ts')],
  'extension.ts',
);
const chatViewProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
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
});

test('webview stream debug output is feature-flagged off by default', () => {
  assert.match(
    messageHandlerSource,
    /const\s+STREAM_DEBUG_ENABLED[\s\S]*__OPENCODE_STREAM_DEBUG__/,
    'message handler should use a dedicated stream debug feature flag',
  );
  assert.match(
    messageHandlerSource,
    /function\s+streamDebug\(\.\.\.args:\s*unknown\[\]\):\s*void/,
    'message handler should centralize stream debug logging through streamDebug',
  );
  assert.match(
    messageHandlerSource,
    /streamDebug\("\[OpenCode\]\[stream\] message\.part\.updated chunk"/,
    'chunk-level stream logs should route through streamDebug',
  );
  assert.match(
    messageHandlerSource,
    /streamDebug\("\[OpenCode\]\[webview\] streamEvent received"/,
    'stream-event logs should route through streamDebug',
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
    /appendWithCap\(\s*state\.streaming\.reasoningEvents,[\s\S]*MAX_STREAMING_REASONING_EVENTS/,
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
