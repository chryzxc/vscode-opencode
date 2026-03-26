import test from 'node:test';
import assert from 'node:assert/strict';

import { joinFromRoot, readSource } from './helpers/source-utils.mjs';

const chatProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

const chatQueueServiceSource = readSource(
  [joinFromRoot('src', 'services', 'ChatQueueService.ts')],
  'ChatQueueService.ts',
);

test('ChatQueueService uses session-scoped queue model with stable queued item metadata', () => {
  assert.match(
    chatQueueServiceSource,
    /private queueBySessionId = new Map<string, QueuedPrompt\[\]>\(\);/,
    'Service should store queues by session ID'
  );
  assert.match(
    chatQueueServiceSource,
    /id:\s*`q-\$\{Date\.now\(\)\}-\$\{this\.queueItemSequence\}`[\s\S]*?sessionId: payload\.sessionId,[\s\S]*?createdAt:\s*Date\.now\(\)/,
    'Queued prompt metadata should include id, sessionId, and createdAt'
  );
  assert.match(
    chatQueueServiceSource,
    /this\.observer\?\.sendQueueUpdate\(sessionId, (nextQueue|queue)\)/,
    'queueUpdate should be sent to the observer'
  );
});

test('ChatViewProvider routes prompt actions through ChatQueueService', () => {
  assert.match(
    chatProviderSource,
    /case "sendMessage":[\s\S]*?this\.chatQueueService\.enqueue/,
    'sendMessage should route to ChatQueueService'
  );
  assert.match(
    chatProviderSource,
    /case "addToQueue":[\s\S]*?this\.chatQueueService\.enqueue/,
    'addToQueue should route to ChatQueueService'
  );
  assert.match(
    chatProviderSource,
    /case "steerMessage":[\s\S]*?this\.chatQueueService\.enqueue/,
    'steerMessage should route to ChatQueueService'
  );
  assert.match(
    chatProviderSource,
    /case "sendQueuedItemNow":[\s\S]*?this\.chatQueueService\.take/,
    'sendQueuedItemNow should dispatch queued item through service'
  );
  assert.match(
    chatProviderSource,
    /case "steerQueuedItem":[\s\S]*?this\.chatQueueService\.take/,
    'steerQueuedItem should dispatch queued item through service'
  );
});

test('ChatQueueService execution logic correctly manages state', () => {
  assert.match(
    chatQueueServiceSource,
    /async execute\(sessionId: string\): Promise<void> \{[\s\S]*?this\.executingQueueSessionIds\.add\(sessionId\)/,
    'execute should track executing session IDs'
  );
  assert.match(
    chatQueueServiceSource,
    /async execute\(sessionId: string\): Promise<void> \{[\s\S]*?this\.observer\?\.onQueueExecutionStarted\(sessionId\)/,
    'execute should notify observer when starting'
  );
  assert.match(
    chatQueueServiceSource,
    /async execute\(sessionId: string\): Promise<void> \{[\s\S]*?await this\.observer\?\.dispatchPrompt/,
    'execute should dispatch prompts to the observer'
  );
  assert.match(
    chatQueueServiceSource,
    /async execute\(sessionId: string\): Promise<void> \{[\s\S]*?finally \{[\s\S]*?this\.executingQueueSessionIds\.delete\(sessionId\)/,
    'execute should clean up execution state in finally block'
  );
  
  assert.doesNotMatch(
    chatQueueServiceSource,
    /async execute\(sessionId: string\): Promise<void> \{[\s\S]*?setTimeout/,
    'queue execution should not use fixed wait delays between items'
  );
});
