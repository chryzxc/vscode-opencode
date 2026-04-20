/**
 * Conversation Test Utilities - Core helpers for conversation flow testing
 *
 * Provides high-level utilities for setting up and running conversation
 * flow tests with minimal boilerplate.
 */

import assert from 'node:assert/strict';
import {
  createMockServerManager,
  createMockStreamService,
  createMockSessionService,
  createMockBudgetService,
  createMockWebview,
  createMockContext,
} from './mock-factory.mjs';

/**
 * Sets up a complete conversation test environment
 *
 * Creates all necessary mocks and prepares them for testing.
 * Note: This creates mocks but doesn't instantiate ChatViewProvider
 * (which requires complex VSCode setup). Tests can use the mocks
 * directly or extend this for their needs.
 *
 * @param {Object} options - Configuration options
 * @returns {Object} Test environment with all mocks
 */
export function setupConversationTest(options = {}) {
  const {
    initialSession = { id: 'test-session-123', title: 'Test Session' },
    initialMessages = [],
    budgetAllowed = true,
  } = options;

  // Create all mocks
  const mockServerManager = createMockServerManager();
  const mockStreamService = createMockStreamService();
  const mockSessionService = createMockSessionService({
    initialSession,
    initialMessages,
  });
  const mockBudgetService = createMockBudgetService({
    allowed: budgetAllowed,
  });
  const mockWebview = createMockWebview();
  const mockContext = createMockContext();

  return {
    mocks: {
      serverManager: mockServerManager,
      streamService: mockStreamService,
      sessionService: mockSessionService,
      budgetService: mockBudgetService,
      webview: mockWebview,
      context: mockContext,
    },

    // Test helpers
    cleanup: () => {
      mockSessionService._reset();
      mockWebview._reset();
      mockStreamService._clearSubscribers();
    },

    // Verification helpers
    verify: {
      // Verify webview received a specific message type (returns array, may be empty)
      webviewReceivedMessageType: (messageType) => {
        const messages = mockWebview._getMessagesByType(messageType);
        return messages; // Return array as-is, let tests decide if empty is acceptable
      },

      // Verify webview received at least one message of a specific type (with assertion)
      webviewReceivedMessageTypeOrFail: (messageType) => {
        const messages = mockWebview._getMessagesByType(messageType);
        assert.ok(messages.length > 0, `Expected webview to receive ${messageType} message`);
        return messages;
      },

      // Verify webview received specific message count
      webviewReceivedMessageCount: (messageType, expectedCount) => {
        const count = mockWebview._getMessagesByType(messageType).length;
        assert.equal(count, expectedCount, `Expected ${expectedCount} ${messageType} messages, got ${count}`);
      },

      // Verify session has specific message count
      sessionHasMessageCount: (sessionId, expectedCount) => {
        const count = mockSessionService._getMessageCount(sessionId);
        assert.equal(count, expectedCount, `Expected session to have ${expectedCount} messages, got ${count}`);
      },

      // Get user message(s) from session (user message is always first after a single send)
      getUserMessage: async (sessionId) => {
        const messages = await mockSessionService.getMessages(sessionId);
        return messages.find(m => m.role === 'user');
      },

      // Verify last message in session
      lastSessionMessage: (sessionId, role) => {
        const message = mockSessionService._getLastMessage(sessionId);
        assert.ok(message, 'Expected session to have messages');
        if (role) {
          assert.equal(message.role, role, `Expected last message to be ${role}`);
        }
        return message;
      },

      // Verify stream service subscriber count
      streamSubscriberCount: (expectedCount) => {
        const count = mockStreamService._getSubscriberCount();
        assert.equal(count, expectedCount, `Expected ${expectedCount} stream subscribers, got ${count}`);
      },

      // Verify session service was called
      sessionServiceCalled: (methodName) => {
        const calls = mockSessionService._callLog.filter(call => call.method === methodName);
        assert.ok(calls.length > 0, `Expected SessionService.${methodName} to be called`);
        return calls;
      },
    },
  };
}

/**
 * Simulates a message send flow through mocked services
 *
 * This helper simulates what happens when ChatViewProvider.handleSendMessage
 * is called, by invoking the mock services in the correct order.
 *
 * @param {Object} env - Test environment from setupConversationTest
 * @param {string} messageText - Message text to send
 * @param {Object} options - Send options
 */
export async function simulateMessageSend(env, messageText, options = {}) {
  const {
    sessionId = 'test-session-123',
    files = [],
    contexts = [],
    images = [],
    streamEvents = [],
  } = options;

  const { mocks } = env;

  // Simulate session retrieval
  const session = await mocks.sessionService.getCurrentSession();

  // Simulate budget check
  const budgetCheck = mocks.budgetService.canMakeRequest();
  if (!budgetCheck.allowed) {
    throw new Error(`Budget check failed: ${budgetCheck.reason}`);
  }

  // Simulate user message persistence
  const userMessage = {
    role: 'user',
    content: messageText,
    text: messageText,
    parts: [{ type: 'text', text: messageText }],
    ...(files.length > 0 ? { files } : {}),
    ...(images.length > 0 ? { images } : {}),
    time: { created: Date.now() },
  };

  await mocks.sessionService.appendMessage(session.id, userMessage);

  // Simulate webview notification of user message
  mocks.webview.postMessage({
    type: 'userMessageAppended',
    message: userMessage,
    sessionId: session.id,
  });

  // Simulate server send (would normally call OpencodeServerManager)
  // In real flow, this triggers streaming

  // If stream events provided, simulate them
  if (streamEvents.length > 0) {
    await simulateStreamEvents(env, streamEvents, { sessionId: session.id });

    // Extract assistant message from completion event and persist in session
    const completionEvent = streamEvents.find(e => e.type === 'message.updated');
    if (completionEvent && completionEvent.properties && completionEvent.properties.message) {
      const assistantMessage = completionEvent.properties.message;
      await mocks.sessionService.appendMessage(session.id, assistantMessage);
    }
  }

  return {
    sessionId: session.id,
    userMessage,
  };
}

/**
 * Simulates streaming events from the server
 *
 * @param {Object} env - Test environment from setupConversationTest
 * @param {Array} events - Stream events to emit
 * @param {Object} options - Options
 */
export async function simulateStreamEvents(env, events, options = {}) {
  const { delay = 0, sessionId = 'test-session-123' } = options;
  const { mocks } = env;

  for (const event of events) {
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Emit event to all stream subscribers
    mocks.streamService._emit(event);

    // Also post to webview as streamEvent (simulates ChatViewProvider forwarding)
    mocks.webview.postMessage({
      type: 'streamEvent',
      event,
      sessionId,
    });
  }
}

/**
 * Creates a realistic assistant message for testing
 *
 * @param {string} text - Message text
 * @param {Object} metadata - Additional metadata
 * @returns {Object} Assistant message
 */
export function createAssistantMessage(text, metadata = {}) {
  return {
    role: 'assistant',
    content: text,
    text: text,
    parts: [
      { type: 'text', text: text },
    ],
    time: { created: Date.now() },
    ...metadata,
  };
}

/**
 * Creates a realistic user message for testing
 *
 * @param {string} text - Message text
 * @param {Object} metadata - Additional metadata
 * @returns {Object} User message
 */
export function createUserMessage(text, metadata = {}) {
  return {
    role: 'user',
    content: text,
    text: text,
    parts: [
      { type: 'text', text: text },
    ],
    time: { created: Date.now() },
    ...metadata,
  };
}

/**
 * Asserts that a message matches expected structure
 *
 * @param {Object} message - Message to check
 * @param {Object} expected - Expected properties
 */
export function assertMessageStructure(message, expected) {
  assert.ok(message, 'Message should exist');
  assert.ok(typeof message === 'object', 'Message should be an object');

  if (expected.role) {
    assert.equal(message.role, expected.role, `Message role should be ${expected.role}`);
  }

  if (expected.hasContent) {
    assert.ok(message.content || message.text, 'Message should have content');
  }

  if (expected.hasParts) {
    assert.ok(Array.isArray(message.parts), 'Message should have parts array');
    assert.ok(message.parts.length > 0, 'Message should have at least one part');
  }

  if (expected.hasTime) {
    assert.ok(message.time, 'Message should have timestamp');
    assert.ok(typeof message.time.created === 'number', 'Message timestamp should be a number');
  }
}

/**
 * Waits for a condition to be true (with timeout)
 *
 * @param {Function} condition - Function that returns true when condition met
 * @param {Object} options - Options
 * @param {number} options.timeout - Timeout in ms (default: 1000)
 * @param {number} options.interval - Check interval in ms (default: 10)
 */
export async function waitFor(condition, options = {}) {
  const {
    timeout = 1000,
    interval = 10,
  } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Creates a spy function that tracks calls
 *
 * @returns {Function} Spy function
 */
export function createSpy() {
  const spy = (...args) => {
    spy._calls.push(args);
    spy._callCount++;
  };

  spy._calls = [];
  spy._callCount = 0;

  spy.wasCalled = () => spy._callCount > 0;
  spy.wasCalledWith = (...args) => {
    return spy._calls.some(call => {
      return call.length === args.length && call.every((arg, i) => arg === args[i]);
    });
  };
  spy.callCount = () => spy._callCount;
  spy.lastCall = () => spy._calls[spy._calls.length - 1];
  spy.reset = () => {
    spy._calls = [];
    spy._callCount = 0;
  };

  return spy;
}

/**
 * Convenience function to run a test with automatic cleanup
 *
 * @param {Function} testFn - Test function
 * @param {Object} options - Setup options
 */
export async function withConversationTest(testFn, options = {}) {
  const env = setupConversationTest(options);

  try {
    await testFn(env);
  } finally {
    env.cleanup();
  }
}

/**
 * Creates a realistic streaming response for common scenarios
 */
export const StreamingResponses = {
  // Simple text response
  simpleText: (text) => [
    { type: 'message.part.updated', properties: { part: { type: 'text', text } } },
    { type: 'message.updated', properties: { message: { role: 'assistant', content: text, text, parts: [{ type: 'text', text }] } } },
  ],

  // Response with file write
  fileWrite: (text, filepath, content) => [
    { type: 'message.part.updated', properties: { part: { type: 'text', text } } },
    { type: 'message.part.updated', properties: { part: { type: 'tool', name: 'write', input: { filepath, content }, state: { status: 'done' } } } },
    { type: 'message.updated', properties: { message: { role: 'assistant', content: text, text, parts: [{ type: 'text', text }, { type: 'tool', name: 'write' }] } } },
  ],

  // Chunked streaming response
  chunked: (chunks) => {
    const events = [];
    let fullText = '';
    chunks.forEach(chunk => {
      fullText += chunk;
      events.push({ type: 'message.part.updated', properties: { part: { type: 'text', text: fullText } } });
    });
    events.push({ type: 'message.updated', properties: { message: { role: 'assistant', content: fullText, text: fullText, parts: [{ type: 'text', text: fullText }] } } });
    return events;
  },
};
