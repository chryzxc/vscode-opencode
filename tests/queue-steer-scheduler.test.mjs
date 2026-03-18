import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

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
    /private createQueuedPrompt\([\s\S]*?id:\s*`q-\$\{Date\.now\(\)\}-\$\{this\.queueItemSequence\}`[\s\S]*?sessionId,[\s\S]*?createdAt:\s*Date\.now\(\)/,
    'Queued prompt metadata should include id, sessionId, and createdAt'
  );
  assert.match(
    chatProviderSource,
    /type:\s*"queueUpdate"[\s\S]*sessionId:\s*targetSessionId[\s\S]*queue:\s*this\.getSessionQueue\(targetSessionId\)/,
    'queueUpdate payload should be scoped to a specific session'
  );
});

test('ChatViewProvider routes prompt actions through the scheduler entrypoint', () => {
  assert.match(
    chatProviderSource,
    /case "sendMessage":[\s\S]*?schedulePromptDispatch\("send-now"/,
    'sendMessage should route to scheduler in send-now mode'
  );
  assert.match(
    chatProviderSource,
    /case "addToQueue":[\s\S]*?schedulePromptDispatch\("queue"/,
    'addToQueue should route to scheduler in queue mode'
  );
  assert.match(
    chatProviderSource,
    /case "steerMessage":[\s\S]*?schedulePromptDispatch\("steer"/,
    'steerMessage should route to scheduler in steer mode'
  );
  assert.match(
    chatProviderSource,
    /case "sendQueuedItemNow":[\s\S]*?handleDispatchQueuedItem\(\s*"send-now"/,
    'sendQueuedItemNow should dispatch queued item through scheduler path'
  );
  assert.match(
    chatProviderSource,
    /case "steerQueuedItem":[\s\S]*?handleDispatchQueuedItem\(\s*"steer"/,
    'steerQueuedItem should dispatch queued item through scheduler path'
  );
});

test('scheduler converts send-now to steer while processing and auto-drains without fixed delay', () => {
  const scheduleBody = extractFunctionBody(
    chatProviderSource,
    'private async schedulePromptDispatch('
  );
  assert.match(
    scheduleBody,
    /mode === "send-now" && this\.isProcessingRequestForSession\(sessionId\)/,
    'send-now should convert to steer only when the target session is processing'
  );
  assert.match(
    scheduleBody,
    /if \(this\.isProcessingRequestForSession\(sessionId\)\)\s*\{[\s\S]*handleStopRequest\(sessionId\)/,
    'steer path should stop active request only for the target session'
  );
  assert.match(
    scheduleBody,
    /else if \(this\.isProcessingRequest\)\s*\{[\s\S]*handleStopRequest\(activeSessionId\)/,
    'scheduler should stop a different active session before dispatching another session'
  );
  assert.match(
    scheduleBody,
    /await this\.handleExecuteQueue\(sessionId\)/,
    'scheduler should trigger immediate queue execution when idle'
  );

  const executeBody = extractFunctionBody(
    chatProviderSource,
    'private async handleExecuteQueue('
  );
  assert.doesNotMatch(
    executeBody,
    /setTimeout/,
    'queue execution should not use fixed wait delays between items'
  );
});
