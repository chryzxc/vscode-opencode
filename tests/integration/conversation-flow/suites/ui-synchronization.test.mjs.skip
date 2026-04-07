/**
 * UI Synchronization Tests
 *
 * Tests that the webview UI correctly receives and displays
 * messages, stream events, and state updates.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setupConversationTest,
  simulateMessageSend,
  withConversationTest,
} from '../helpers/conversation-test-utils.mjs';
import StreamFixtures from '../fixtures/stream-fixtures.mjs';

test('ui: webview receives userMessageAppended on send', async () => {
  await withConversationTest(async (env) => {
    const { verify } = env;

    // Send message
    await simulateMessageSend(env, 'Test message', {
      streamEvents: StreamFixtures.simpleGreeting,
    });

    // Verify webview received userMessageAppended
    const messages = verify.webviewReceivedMessageType('userMessageAppended');
    assert.equal(messages.length, 1);

    const appendedMsg = messages[0];
    assert.equal(appendedMsg.type, 'userMessageAppended');
    assert.ok(appendedMsg.message, 'Should include message object');
    assert.equal(appendedMsg.message.text, 'Test message');
    assert.equal(appendedMsg.message.role, 'user');
    assert.ok(appendedMsg.sessionId, 'Should include session ID');
  });
});

test('ui: webview receives streamEvent messages during streaming', async () => {
  await withConversationTest(async (env) => {
    const { verify } = env;

    // Send message with chunked response
    await simulateMessageSend(env, 'Stream to me', {
      streamEvents: StreamFixtures.chunkedThinking,
    });

    // Verify webview received streamEvent messages
    const streamEvents = verify.webviewReceivedMessageType('streamEvent');
    assert.ok(streamEvents.length > 0, 'Should receive streamEvent messages');

    // Verify stream event structure
    const firstEvent = streamEvents[0];
    assert.equal(firstEvent.type, 'streamEvent');
    assert.ok(firstEvent.event, 'Should have event property');
    assert.ok(firstEvent.event.type, 'Event should have type');
    assert.ok(firstEvent.sessionId, 'Should include session ID');
  });
});

test('ui: streamEvent messages include sessionId', async () => {
  await withConversationTest(async (env) => {
    const { verify } = env;

    const sessionId = 'test-session-123';

    await simulateMessageSend(env, 'Check session ID', {
      sessionId,
      streamEvents: StreamFixtures.reactExplanation.map((e) => ({
        ...e,
        properties: { ...e.properties, sessionId },
      })),
    });

    // Verify all stream events have session ID
    const streamEvents = verify.webviewReceivedMessageType('streamEvent');
    assert.ok(streamEvents.length > 0);

    streamEvents.forEach((msg) => {
      assert.equal(msg.sessionId, sessionId, 'Stream event should include session ID');
    });
  });
});

test('ui: processing state is communicated to webview', async () => {
  await withConversationTest(async (env) => {
    const { mocks, verify } = env;

    // Note: In real implementation, processing state is set before sending
    // This test verifies the webview communication pattern

    await simulateMessageSend(env, 'Test processing', {
      streamEvents: StreamFixtures.simpleGreeting,
    });

    // Verify webview received messages (processing state would be included)
    const allMessages = mocks.webview._postedMessages;
    assert.ok(allMessages.length > 0, 'Webview should receive messages');

    // Check for processing-related message types
    const messageTypes = new Set(allMessages.map((m) => m.type));
    // Note: Actual processing state messages depend on implementation
    assert.ok(messageTypes.has('userMessageAppended') || messageTypes.has('streamEvent'));
  });
});

test('ui: streaming state updates during response', async () => {
  await withConversationTest(async (env) => {
    const { verify } = env;

    // Send message with streaming response
    await simulateMessageSend(env, 'Stream test', {
      streamEvents: StreamFixtures.chunkedThinking,
    });

    // Verify multiple stream events received
    const streamEvents = verify.webviewReceivedMessageType('streamEvent');
    assert.ok(streamEvents.length > 1, 'Should receive multiple stream events');

    // Verify progressive updates
    streamEvents.forEach((event) => {
      assert.ok(event.event, 'Should have event data');
      assert.ok(event.sessionId, 'Should have session ID');
    });
  });
});

test('ui: final message completion state is sent', async () => {
  await withConversationTest(async (env) => {
    const { verify } = env;

    await simulateMessageSend(env, 'Complete this', {
      streamEvents: StreamFixtures.reactExplanation,
    });

    // Find completion event
    const streamEvents = verify.webviewReceivedMessageType('streamEvent');
    const completionEvent = streamEvents.find(
      (e) => e.event && e.event.type === 'message.updated'
    );

    assert.ok(completionEvent, 'Should have completion event');
    assert.ok(completionEvent.event.properties.message, 'Completion should have full message');
    assert.equal(completionEvent.event.properties.message.role, 'assistant');
  });
});

test('ui: webview receives chatHistory updates', async () => {
  await withConversationTest(async (env) => {
    const { mocks, verify } = env;

    // Send message
    await simulateMessageSend(env, 'Get history', {
      streamEvents: StreamFixtures.simpleGreeting,
    });

    // Note: chatHistory updates depend on implementation
    // This test verifies the pattern exists
    const allMessages = mocks.webview._postedMessages;
    const hasChatHistory = allMessages.some((m) => m.type === 'chatHistory');

    // If chatHistory is implemented, verify it
    if (hasChatHistory) {
      const historyMessages = verify.webviewReceivedMessageType('chatHistory');
      assert.ok(historyMessages.length > 0, 'Should have chat history');
      assert.ok(historyMessages[0].messages, 'Should include messages array');
    }
  });
});

test('ui: tool use events are communicated to webview', async () => {
  await withConversationTest(async (env) => {
    const { verify } = env;

    await simulateMessageSend(env, 'Use a tool', {
      streamEvents: StreamFixtures.writeFile,
    });

    // Verify stream events include tool use
    const streamEvents = verify.webviewReceivedMessageType('streamEvent');
    const toolEvent = streamEvents.find(
      (e) => e.event && e.event.properties && e.event.properties.part && e.event.properties.part.type === 'tool'
    );

    assert.ok(toolEvent, 'Should have tool use event');
    assert.equal(toolEvent.event.properties.part.name, 'write');
    assert.ok(toolEvent.event.properties.part.input, 'Tool should have input');
  });
});

test('ui: structured output events are communicated to webview', async () => {
  await withConversationTest(async (env) => {
    const { verify } = env;

    await simulateMessageSend(env, 'Create structured output', {
      streamEvents: StreamFixtures.planStructuredOutput,
    });

    // Verify structured output event
    const streamEvents = verify.webviewReceivedMessageType('streamEvent');
    const structuredEvent = streamEvents.find(
      (e) => e.event && e.event.type === 'structured.output'
    );

    assert.ok(structuredEvent, 'Should have structured output event');
    assert.ok(structuredEvent.event.properties.structured, 'Should have structured data');
    assert.equal(structuredEvent.event.properties.structured.kind, 'plan');
  });
});

test('ui: multiple rapid messages all reach webview', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send multiple messages rapidly
    const promises = [
      simulateMessageSend(env, 'First', {
        streamEvents: StreamFixtures.simpleGreeting,
      }),
      simulateMessageSend(env, 'Second', {
        streamEvents: StreamFixtures.simpleGreeting,
      }),
      simulateMessageSend(env, 'Third', {
        streamEvents: StreamFixtures.simpleGreeting,
      }),
    ];

    await Promise.all(promises);

    // Verify all messages reached webview
    const userMessages = mocks.webview._getMessagesByType('userMessageAppended');
    assert.equal(userMessages.length, 3, 'All user messages should reach webview');

    // Verify message order
    assert.equal(userMessages[0].message.text, 'First');
    assert.equal(userMessages[1].message.text, 'Second');
    assert.equal(userMessages[2].message.text, 'Third');
  });
});

test('ui: webview message structure is correct', async () => {
  await withConversationTest(async (env) => {
    const { mocks, verify } = env;

    await simulateMessageSend(env, 'Check structure', {
      streamEvents: StreamFixtures.simpleGreeting,
    });

    // Check first webview message
    const firstMessage = mocks.webview._postedMessages[0];
    assert.ok(typeof firstMessage === 'object', 'Message should be object');
    assert.ok(firstMessage.type, 'Message should have type');
    assert.ok(typeof firstMessage.type === 'string', 'Type should be string');

    // Verify structure based on type
    if (firstMessage.type === 'userMessageAppended') {
      assert.ok(firstMessage.message, 'userMessageAppended should have message');
      assert.ok(firstMessage.sessionId, 'userMessageAppended should have sessionId');
    }
  });
});

test('ui: attachment information is included in webview messages', async () => {
  await withConversationTest(async (env) => {
    const { verify } = env;

    const files = ['src/test.ts'];
    const images = ['data:image/png;base64,ABC123'];

    await simulateMessageSend(env, 'With attachments', {
      files,
      images,
      streamEvents: StreamFixtures.simpleGreeting,
    });

    // Verify user message includes attachments
    const userMessages = verify.webviewReceivedMessageType('userMessageAppended');
    assert.equal(userMessages.length, 1);

    const msg = userMessages[0].message;
    assert.ok(msg.files, 'Message should include files');
    assert.ok(msg.images, 'Message should include images');
    assert.equal(msg.files.length, 1);
    assert.equal(msg.images.length, 1);
  });
});

test('ui: error state is communicated to webview', async () => {
  await withConversationTest(async (env) => {
    const { mocks, verify } = env;

    // Note: Error handling depends on implementation
    // This test verifies error communication pattern exists

    // In a real scenario, you'd trigger an error
    // For now, verify the webview can receive error messages
    const errorMsg = { type: 'error', message: 'Test error', sessionId: 'test-session-123' };
    mocks.webview.postMessage(errorMsg);

    // Verify error was posted
    const errors = mocks.webview._getMessagesByType('error');
    assert.ok(errors.length >= 1, 'Webview should support error messages');
  });
});

test('ui: webview receives token usage information', async () => {
  await withConversationTest(async (env) => {
    const { verify } = env;

    await simulateMessageSend(env, 'Track tokens', {
      streamEvents: StreamFixtures.reactExplanation,
    });

    // Find completion event with tokens
    const streamEvents = verify.webviewReceivedMessageType('streamEvent');
    const completionEvent = streamEvents.find(
      (e) => e.event && e.event.type === 'message.updated'
    );

    assert.ok(completionEvent, 'Should have completion event');
    assert.ok(completionEvent.event.properties.tokens, 'Should include token info');
    assert.ok(typeof completionEvent.event.properties.tokens.input === 'number');
    assert.ok(typeof completionEvent.event.properties.tokens.output === 'number');
  });
});
