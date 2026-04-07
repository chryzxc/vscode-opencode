import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readAllSources, readSource } from '../helpers/source-utils.mjs';

const chatProviderSource = readAllSources([joinFromRoot('src', 'providers', 'ChatViewProvider.ts'), joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts'), joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts'), joinFromRoot('src', 'providers', 'chat', 'PlanManager.ts'), joinFromRoot('src', 'providers', 'chat', 'SubagentPersistence.ts'), joinFromRoot('src', 'providers', 'chat', 'CompactionManager.ts'), joinFromRoot('src', 'providers', 'chat', 'DiagnosticsLogger.ts'), joinFromRoot('src', 'providers', 'chat', 'QueueManager.ts'), joinFromRoot('src', 'providers', 'chat', 'StreamEventHandler.ts'), joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts'), joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts')],
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
    /(const promptId = `q-\$\{Date\.now\(\)\}-\$\{this\.queueItemSequence\}`|id:\s*(promptId|`q-\$\{Date\.now\(\)\}-\$\{this\.queueItemSequence\}`))/,
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


test('ChatViewProvider send-now dispatch bypasses queue persistence', () => {
  assert.match(
    chatProviderSource,
    /if \((mode|effectiveMode) === "send-now"\)[\s\S]*?await this\.handleSendMessage\(/,
    'send-now should execute handleSendMessage directly',
  );
  assert.match(
    chatProviderSource,
    /if \((mode|effectiveMode) === "send-now"\)[\s\S]*?return;[\s\S]*?this\.queueManager\.(enqueuePrompt|schedulePromptDispatch)\(/,
    'queueManager should only be called after the send-now early return path',
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
