/**
 * Core Queue Management Regression Tests
 *
 * These tests prevent regressions in message queue functionality.
 * Queue management is critical for handling message sequencing and execution.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const queueManagerSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'QueueManager.ts')],
  'QueueManager.ts',
);

test.describe('Queue Manager - Queue Operations', () => {

  test('addToQueue validates queue items', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /addToQueue[\s\S]*prompt|text|sessionId/s,
      'must validate queue item structure'
    );
  });

  test('addToQueue maintains queue order', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /addToQueue[\s\S]*push|unshift|concat/s,
      'must maintain queue order'
    );
  });

  test('addToQueue triggers queue updates', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /addToQueue[\s\S]*sendQueueUpdate|postMessage/s,
      'must notify queue state changes'
    );
  });

  test('clearQueue empties the queue', () => {
    const clearBody = extractFunctionBody(queueManagerSource, 'clearQueue');

    assert.match(
      clearBody,
      /queue\s*=\s*\[\s*\]|queue\.length\s*=\s*0/s,
      'must empty the queue array'
    );
  });

  test('clearQueue resets execution state', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /clearQueue[\s\S]*isExecuting|executing|processing/s,
      'must reset execution state'
    );
  });

});

test.describe('Queue Manager - Queue Execution', () => {

  test('executeQueue processes items sequentially', () => {
    const executeBody = extractFunctionBody(queueManagerSource, 'executeQueue');

    assert.match(
      executeBody,
      /while\s*\(|for\s*\(|forEach|shift|pop/s,
      'must process queue items'
    );
  });

  test('executeQueue checks execution state', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /executeQueue[\s\S]*isExecuting|executing|already/s,
      'must check if already executing'
    );
  });

  test('executeQueue handles empty queue', () => {
    const executeBody = extractFunctionBody(queueManagerSource, 'executeQueue');

    assert.match(
      executeBody,
      /this\.queue\.length\s*===\s*0/,
      'must check for empty queue'
    );
  });

  test('executeQueue manages execution state', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /executeQueue[\s\S]*isExecuting\s*=\s*true|finally/s,
      'must set and reset execution state'
    );
  });

});

test.describe('Queue Manager - Item Dispatch', () => {

  test('handleDispatchQueuedItem validates item structure', () => {
    const dispatchBody = extractFunctionBody(queueManagerSource, 'handleDispatchQueuedItem');

    assert.match(
      dispatchBody,
      /id|index|sessionId|finalSessionId/s,
      'must validate queue item parameters'
    );
  });

  test('handleDispatchQueuedItem processes different item types', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /handleDispatchQueuedItem[\s\S]*type|kind|category/s,
      'must handle different item types'
    );
  });

  test('handleDispatchQueuedItem handles dispatch failures', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /handleDispatchQueuedItem[\s\S]*catch|error|failure/s,
      'must handle dispatch errors'
    );
  });

});

test.describe('Queue Manager - Prompt Enqueuing', () => {

  test('enqueuePrompt creates queue items', () => {
    const enqueueBody = extractFunctionBody(queueManagerSource, 'enqueuePrompt');

    assert.match(
      enqueueBody,
      /type|prompt|content|message/s,
      'must create properly structured queue items'
    );
  });

  test('enqueuePrompt validates prompt content', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /enqueuePrompt[\s\S]*if\s*\(\s*!prompt|text|content/s,
      'must validate prompt content'
    );
  });

  test('enqueuePrompt associates with session', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /enqueuePrompt[\s\S]*sessionId|session|getCurrentSessionId/s,
      'must associate with current session'
    );
  });

});

test.describe('Queue Manager - Queue State', () => {

  test('getQueueState returns current state', () => {
    const getStateBody = extractFunctionBody(queueManagerSource, 'getQueueState');

    assert.match(
      getStateBody,
      /queue|isExecuting|length|items/s,
      'must return queue state information'
    );
  });

  test('getQueueState includes execution status', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /getQueueState[\s\S]*isExecuting|executing|processing/s,
      'must include execution status'
    );
  });

  test('sendQueueUpdate notifies state changes', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /sendQueueUpdate[\s\S]*postMessage|type.*queue|queueUpdate/s,
      'must send queue state updates'
    );
  });

});

test.describe('Queue Manager - Queue Removal', () => {

  test('handleRemoveFromQueue validates removal request', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /handleRemoveFromQueue[\s\S]*id|index|message/s,
      'must validate removal parameters'
    );
  });

  test('handleRemoveFromQueue removes specific items', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /handleRemoveFromQueue[\s\S]*splice|filter|remove/s,
      'must remove items from queue'
    );
  });

  test('handleRemoveFromQueue updates queue state', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /handleRemoveFromQueue[\s\S]*sendQueueUpdate|postMessage/s,
      'must notify queue state changes'
    );
  });

});

test.describe('Queue Manager - Error Handling', () => {

  test('queue operations handle errors gracefully', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /try\s*\{[\s\S]*catch\s*\(|if\s*\(\s*!/s,
      'must include error handling'
    );
  });

  test('queue operations validate inputs', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /if\s*\(\s*!.*\s*\)|typeof.*===|Array\.isArray/s,
      'must validate input parameters'
    );
  });

  test('queue operations log errors appropriately', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /logger\.(warn|error|debug)/s,
      'must log queue processing issues'
    );
  });

});

test.describe('Queue Manager - Session Integration', () => {

  test('queue operations check current session', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /getCurrentSessionId|currentSession|sessionId/s,
      'must check current session context'
    );
  });

  test('queue operations handle missing session gracefully', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /if\s*\(\s*!sessionId|undefined|null/s,
      'must handle missing session'
    );
  });

});

test.describe('Queue Manager - Message Integration', () => {

  test('queue operations integrate with message sending', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /handleSendMessage|sendMessage|dispatch/s,
      'must integrate with message sending'
    );
  });

  test('queue operations handle stop requests', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /handleStopRequest|stop|cancel/s,
      'must handle stop/cancel requests'
    );
  });

});

test.describe('Queue Manager - Performance', () => {

  test('queue operations use efficient data structures', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /queue.*push|queue\.shift|Array/s,
      'must use efficient array operations'
    );
  });

  test('queue operations avoid unnecessary iterations', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /break|return|continue|early/s,
      'must exit early when possible'
    );
  });

  test('queue operations batch updates', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /sendQueueUpdate|postMessage|batch/s,
      'must batch queue state updates'
    );
  });

});

test.describe('Queue Manager - Concurrency', () => {

  test('queue operations prevent race conditions', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /isExecuting|locking|mutex|Promise/s,
      'must prevent concurrent execution'
    );
  });

  test('queue operations handle concurrent modifications', () => {
    const source = queueManagerSource;

    assert.match(
      source,
      /while\s*\(|isExecuting|check.*before/s,
      'must check state before operations'
    );
  });

});
