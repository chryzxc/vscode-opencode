import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const chatProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

test('ChatViewProvider uses session-scoped queue model with stable queued item metadata', () => {
  assert.match(
    chatProviderSource,
    /private queueBySessionId = new Map<string, QueuedPrompt\[\]>\(\);/,
    'Provider should store queues by session ID'
  );
  assert.match(
    chatProviderSource,
    /id:\s*`q-\$\{Date\.now\(\)\}-\$\{this\.queueItemSequence\}`/,
    'Queued prompt metadata should include stable sequential ID'
  );
  assert.match(
    chatProviderSource,
    /this\.sendQueueUpdate\(sessionId\)/,
    'queueUpdate should be sent to the webview'
  );
});

test('ChatViewProvider routes prompt actions through internal queue handlers', () => {
  assert.match(
    chatProviderSource,
    /case "sendMessage":[\s\S]*?this\.schedulePromptDispatch\("send-now"/,
    'sendMessage should route to prompt dispatch'
  );
  assert.match(
    chatProviderSource,
    /case "addToQueue":[\s\S]*?this\.schedulePromptDispatch\("queue"/,
    'addToQueue should route to prompt dispatch'
  );
  assert.match(
    chatProviderSource,
    /case "steerMessage":[\s\S]*?this\.schedulePromptDispatch\("steer"/,
    'steerMessage should route to prompt dispatch'
  );
  assert.match(
    chatProviderSource,
    /case "sendQueuedItemNow":[\s\S]*?this\.handleDispatchQueuedItem/,
    'sendQueuedItemNow should dispatch queued item'
  );
  assert.match(
    chatProviderSource,
    /case "steerQueuedItem":[\s\S]*?this\.handleDispatchQueuedItem/,
    'steerQueuedItem should dispatch queued item'
  );
});

test('ChatViewProvider queue execution logic correctly manages state', () => {
  assert.match(
    chatProviderSource,
    /async handleExecuteQueue\(.*?\): Promise<void> \{[\s\S]*?this\.executingQueueSessionIds\.add\(sessionId\)/,
    'handleExecuteQueue should track executing session IDs'
  );
  assert.match(
    chatProviderSource,
    /type: "queueExecutionStarted"/,
    'handleExecuteQueue should notify webview via queueExecutionStarted event'
  );
  assert.match(
    chatProviderSource,
    /async handleExecuteQueue\(.*?\): Promise<void> \{[\s\S]*?finally \{[\s\S]*?this\.executingQueueSessionIds\.delete\(sessionId\)/,
    'handleExecuteQueue should clean up execution state in finally block'
  );
  
  assert.doesNotMatch(
    chatProviderSource,
    /async handleExecuteQueue\(.*?\): Promise<void> \{[\s\S]*?setTimeout/,
    'queue execution should not use fixed wait delays between items'
  );
});
