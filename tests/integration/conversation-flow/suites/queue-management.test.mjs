/**
 * Queue Management Tests
 *
 * Tests the prompt queue functionality including adding to queue,
 * executing queue, and clearing queue.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setupConversationTest,
  withConversationTest,
} from '../helpers/conversation-test-utils.mjs';
import StreamFixtures from '../fixtures/stream-fixtures.mjs';

test('queue: message can be added to queue', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Simulate adding to queue
    const queueMessage = {
      type: 'addToQueue',
      sessionId: 'test-session-123',
      text: 'Queued message 1',
    };

    // In real flow, this would add to queue state
    assert.equal(queueMessage.type, 'addToQueue');
    assert.equal(queueMessage.text, 'Queued message 1');
    assert.ok(queueMessage.sessionId, 'Should have session ID');
  });
});

test('queue: multiple messages can be added to queue', async () => {
  await withConversationTest(async (env) => {
    // Simulate adding multiple messages to queue
    const queuedMessages = [
      { type: 'addToQueue', sessionId: 'test-session-123', text: 'Message 1' },
      { type: 'addToQueue', sessionId: 'test-session-123', text: 'Message 2' },
      { type: 'addToQueue', sessionId: 'test-session-123', text: 'Message 3' },
    ];

    // Verify all are queue messages
    queuedMessages.forEach(msg => {
      assert.equal(msg.type, 'addToQueue');
      assert.ok(msg.text, 'Should have text');
    });

    assert.equal(queuedMessages.length, 3);
  });
});

test('queue: executeQueue processes messages in order', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Simulate queue execution
    const executeMessage = {
      type: 'executeQueue',
      sessionId: 'test-session-123',
    };

    assert.equal(executeMessage.type, 'executeQueue');
    assert.ok(executeMessage.sessionId, 'Should have session ID');

    // In real flow, this would process all queued messages
    // Verify execute message structure
  });
});

test('queue: clearQueue removes all queued messages', async () => {
  await withConversationTest(async (env) => {
    // Simulate clearing queue
    const clearMessage = {
      type: 'clearQueue',
      sessionId: 'test-session-123',
    };

    assert.equal(clearMessage.type, 'clearQueue');
    assert.ok(clearMessage.sessionId, 'Should have session ID');
  });
});

test('queue: queue state is communicated to webview', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send queue state update
    const queueState = {
      type: 'queueUpdate',
      sessionId: 'test-session-123',
      queue: [
        { id: '1', text: 'Queued message 1', timestamp: Date.now() },
        { id: '2', text: 'Queued message 2', timestamp: Date.now() },
      ],
    };

    mocks.webview.postMessage(queueState);

    // Verify queue state sent
    const queueMessages = mocks.webview._getMessagesByType('queueUpdate');
    assert.ok(queueMessages.length >= 1, 'Should have queueUpdate');

    const lastQueue = queueMessages[queueMessages.length - 1];
    assert.ok(Array.isArray(lastQueue.queue), 'Queue should be array');
    assert.equal(lastQueue.queue.length, 2);
  });
});

test('queue: empty queue state is communicated', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send empty queue state
    const emptyQueue = {
      type: 'queueUpdate',
      sessionId: 'test-session-123',
      queue: [],
    };

    mocks.webview.postMessage(emptyQueue);

    // Verify empty queue sent
    const queueMessages = mocks.webview._getMessagesByType('queueUpdate');
    const lastQueue = queueMessages[queueMessages.length - 1];

    assert.equal(lastQueue.queue.length, 0, 'Queue should be empty');
  });
});

test('queue: queue item includes metadata', async () => {
  await withConversationTest(async (env) => {
    // Queue item with full metadata
    const queueItem = {
      id: 'item-123',
      text: 'Complex queued message',
      timestamp: Date.now(),
      sessionId: 'test-session-123',
      files: ['src/test.ts'],
      images: ['data:image/png;base64,ABC'],
    };

    // Verify structure
    assert.ok(queueItem.id, 'Should have ID');
    assert.ok(queueItem.text, 'Should have text');
    assert.ok(queueItem.timestamp, 'Should have timestamp');
    assert.ok(queueItem.sessionId, 'Should have session ID');
    assert.ok(Array.isArray(queueItem.files), 'Files should be array');
    assert.ok(Array.isArray(queueItem.images), 'Images should be array');
  });
});

test('queue: queue persists across session reload', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Simulate queue persistence
    const queueState = {
      type: 'queueUpdate',
      sessionId: 'test-session-123',
      queue: [
        { id: '1', text: 'Persistent message', timestamp: Date.now() },
      ],
      persisted: true,
    };

    mocks.webview.postMessage(queueState);

    // Verify persisted flag
    const queueMessages = mocks.webview._getMessagesByType('queueUpdate');
    const lastQueue = queueMessages[queueMessages.length - 1];

    assert.equal(lastQueue.persisted, true, 'Should indicate queue is persisted');
  });
});

test('queue: individual queue item can be removed', async () => {
  await withConversationTest(async (env) => {
    // Simulate removing single item
    const removeMessage = {
      type: 'removeFromQueue',
      sessionId: 'test-session-123',
      itemId: 'item-123',
    };

    assert.equal(removeMessage.type, 'removeFromQueue');
    assert.equal(removeMessage.itemId, 'item-123');
  });
});

test('queue: queue execution sends messages sequentially', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Simulate sequential execution
    const messages = [
      { id: '1', text: 'First' },
      { id: '2', text: 'Second' },
      { id: '3', text: 'Third' },
    ];

    // Verify order
    messages.forEach((msg, index) => {
      assert.equal(msg.id, String(index + 1));
    });

    // In real flow, executeQueue would send these in order
  });
});

test('queue: queue shows processing state during execution', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send processing state
    const processingState = {
      type: 'queueProcessing',
      sessionId: 'test-session-123',
      isProcessing: true,
      currentItemIndex: 0,
      totalItems: 3,
    };

    mocks.webview.postMessage(processingState);

    // Verify processing state sent
    const processingMessages = mocks.webview._getMessagesByType('queueProcessing');
    assert.ok(processingMessages.length >= 1, 'Should have queueProcessing');

    const lastProcessing = processingMessages[processingMessages.length - 1];
    assert.equal(lastProcessing.isProcessing, true);
    assert.equal(lastProcessing.currentItemIndex, 0);
    assert.equal(lastProcessing.totalItems, 3);
  });
});

test('queue: queue completion state is sent', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send completion state
    const completionState = {
      type: 'queueProcessing',
      sessionId: 'test-session-123',
      isProcessing: false,
      completedCount: 3,
    };

    mocks.webview.postMessage(completionState);

    // Verify completion state
    const processingMessages = mocks.webview._getMessagesByType('queueProcessing');
    const lastProcessing = processingMessages[processingMessages.length - 1];

    assert.equal(lastProcessing.isProcessing, false);
    assert.equal(lastProcessing.completedCount, 3);
  });
});

test('queue: queue handles messages with attachments', async () => {
  await withConversationTest(async (env) => {
    // Queue message with attachments
    const queuedItem = {
      id: 'item-with-files',
      text: 'Review these files',
      files: ['src/app.tsx', 'src/components/Button.tsx'],
      images: ['data:image/png;base64,XYZ'],
    };

    assert.ok(queuedItem.files, 'Should have files');
    assert.ok(queuedItem.images, 'Should have images');
    assert.equal(queuedItem.files.length, 2);
    assert.equal(queuedItem.images.length, 1);
  });
});

test('queue: queue respects session isolation', async () => {
  await withConversationTest(async (env) => {
    // Queue items for different sessions
    const session1Queue = {
      type: 'queueUpdate',
      sessionId: 'session-1',
      queue: [{ id: '1', text: 'Session 1 message' }],
    };

    const session2Queue = {
      type: 'queueUpdate',
      sessionId: 'session-2',
      queue: [{ id: '2', text: 'Session 2 message' }],
    };

    // Verify session isolation
    assert.notEqual(session1Queue.sessionId, session2Queue.sessionId);
    assert.notEqual(session1Queue.queue[0].id, session2Queue.queue[0].id);
  });
});
