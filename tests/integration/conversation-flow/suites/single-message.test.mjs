/**
 * Single Message Flow Tests
 *
 * Tests the complete flow of sending a single message and receiving
 * a response via streaming events.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setupConversationTest,
  simulateMessageSend,
  simulateStreamEvents,
  assertMessageStructure,
  withConversationTest,
} from '../helpers/conversation-test-utils.mjs';
import StreamFixtures from '../fixtures/stream-fixtures.mjs';
import MessageFixtures from '../fixtures/message-fixtures.mjs';

test('single message: user sends text message and receives streamed response', async () => {
  await withConversationTest(async (env) => {
    const { mocks, verify } = env;

    // Simulate sending a message
    const result = await simulateMessageSend(env, 'Explain React hooks', {
      streamEvents: StreamFixtures.reactExplanation,
    });

    // Verify user message was persisted
    verify.sessionHasMessageCount(result.sessionId, 1);
    const userMessage = verify.lastSessionMessage(result.sessionId, 'user');
    assert.equal(userMessage.text, 'Explain React hooks');

    // Verify webview was notified of user message
    const userMessageNotices = verify.webviewReceivedMessageType('userMessageAppended');
    assert.equal(userMessageNotices.length, 1);
    assert.equal(userMessageNotices[0].message.text, 'Explain React hooks');

    // Verify streaming events were emitted
    const streamEvents = StreamFixtures.reactExplanation;
    assert.ok(streamEvents.length > 0, 'Should have stream events');

    // Verify session service calls
    const appendCalls = verify.sessionServiceCalled('appendMessage');
    assert.ok(appendCalls.length >= 1, 'Should append user message');
  });
});

test('single message: user sends message with file attachments', async () => {
  await withConversationTest(async (env) => {
    const { mocks, verify } = env;

    const files = ['src/components/Button.tsx', 'src/hooks/useAuth.ts'];

    // Simulate sending message with files
    const result = await simulateMessageSend(env, 'Review these files', {
      files,
      streamEvents: StreamFixtures.simpleGreeting,
    });

    // Verify message was persisted with files
    const userMessage = verify.lastSessionMessage(result.sessionId, 'user');
    assert.ok(userMessage.files, 'Message should include files');
    assert.equal(userMessage.files.length, 2);
    assert.deepEqual(userMessage.files, files);
  });
});

test('single message: user sends message with image attachments', async () => {
  await withConversationTest(async (env) => {
    const { verify } = env;

    const images = [
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    ];

    // Simulate sending message with images
    const result = await simulateMessageSend(env, 'What does this image show?', {
      images,
      streamEvents: StreamFixtures.simpleGreeting,
    });

    // Verify message was persisted with images
    const userMessage = verify.lastSessionMessage(result.sessionId, 'user');
    assert.ok(userMessage.images, 'Message should include images');
    assert.equal(userMessage.images.length, 1);
    assert.equal(userMessage.images[0], images[0]);
  });
});

test('single message: user sends message with all attachment types', async () => {
  await withConversationTest(async (env) => {
    const { verify } = env;

    const files = ['src/App.tsx'];
    const images = ['data:image/png;base64,ABC123'];

    // Simulate sending message with everything
    const result = await simulateMessageSend(env, 'Update this component', {
      files,
      images,
      streamEvents: StreamFixtures.writeFile,
    });

    // Verify all attachments present
    const userMessage = verify.lastSessionMessage(result.sessionId, 'user');
    assert.ok(userMessage.files, 'Should have files');
    assert.ok(userMessage.images, 'Should have images');
    assert.equal(userMessage.files.length, 1);
    assert.equal(userMessage.images.length, 1);
  });
});

test('single message: receives response with structured output', async () => {
  await withConversationTest(async (env) => {
    const { verify } = env;

    // Simulate message with structured output response
    await simulateMessageSend(env, 'Create a plan for this feature', {
      streamEvents: StreamFixtures.planStructuredOutput,
    });

    // Verify structured output event was in stream
    const structuredOutputEvents = StreamFixtures.planStructuredOutput.filter(
      e => e.type === 'structured.output'
    );
    assert.ok(structuredOutputEvents.length > 0, 'Should have structured output event');

    // Verify the structured data
    const structuredData = structuredOutputEvents[0].properties.structured;
    assert.equal(structuredData.kind, 'plan');
    assert.ok(structuredData.steps, 'Plan should have steps');
  });
});

test('single message: receives response with tool use (file write)', async () => {
  await withConversationTest(async (env) => {
    const { verify } = env;

    // Simulate message with file write tool
    await simulateMessageSend(env, 'Create a new component', {
      streamEvents: StreamFixtures.writeFile,
    });

    // Verify tool use event was in stream
    const toolEvents = StreamFixtures.writeFile.filter(
      e => e.properties?.part?.type === 'tool'
    );
    assert.ok(toolEvents.length > 0, 'Should have tool use event');

    // Verify tool details
    const toolPart = toolEvents[0].properties.part;
    assert.equal(toolPart.name, 'write');
    assert.ok(toolPart.input.filepath, 'Should have filepath');
    assert.ok(toolPart.input.content, 'Should have content');
    assert.equal(toolPart.state.status, 'done');
  });
});

test('single message: receives chunked streaming response', async () => {
  await withConversationTest(async (env) => {
    // Simulate message with chunked response
    await simulateMessageSend(env, 'Tell me a story', {
      streamEvents: StreamFixtures.chunkedThinking,
    });

    // Verify multiple streaming events
    const partEvents = StreamFixtures.chunkedThinking.filter(
      e => e.type === 'message.part.updated'
    );

    assert.ok(partEvents.length > 1, 'Should have multiple part events for chunked response');

    // Verify text built progressively
    let previousLength = 0;
    partEvents.forEach((event, index) => {
      const currentText = event.properties.part.text;
      assert.ok(currentText.length >= previousLength, `Chunk ${index} should be longer than previous`);
      previousLength = currentText.length;
    });
  });
});

test('single message: message structure is correct', async () => {
  await withConversationTest(async (env) => {
    const { verify } = env;

    await simulateMessageSend(env, 'Test message', {
      streamEvents: StreamFixtures.simpleGreeting,
    });

    // Verify user message structure
    const userMessage = verify.lastSessionMessage('test-session-123', 'user');
    assertMessageStructure(userMessage, {
      role: 'user',
      hasContent: true,
      hasParts: true,
      hasTime: true,
    });

    // Verify message parts
    assert.ok(Array.isArray(userMessage.parts), 'Should have parts array');
    assert.ok(userMessage.parts.length > 0, 'Should have at least one part');
    assert.equal(userMessage.parts[0].type, 'text', 'First part should be text');
  });
});

test('single message: webview receives streamEvent messages', async () => {
  await withConversationTest(async (env) => {
    const { verify } = env;

    await simulateMessageSend(env, 'Test streaming', {
      streamEvents: StreamFixtures.chunkedThinking,
    });

    // Verify webview received streamEvent messages
    const streamEvents = verify.webviewReceivedMessageType('streamEvent');
    assert.ok(streamEvents.length > 0, 'Webview should receive streamEvent messages');

    // Verify stream event structure
    const firstEvent = streamEvents[0];
    assert.ok(firstEvent.event, 'Should have event property');
    assert.ok(firstEvent.event.type, 'Event should have type');
  });
});

test('single message: handles long response without errors', async () => {
  await withConversationTest(async (env) => {
    const { verify } = env;

    // Simulate long response
    await simulateMessageSend(env, 'Generate a lot of text', {
      streamEvents: StreamFixtures.longStream,
    });

    // Verify all events processed
    const partEvents = StreamFixtures.longStream.filter(
      e => e.type === 'message.part.updated'
    );

    assert.ok(partEvents.length > 10, 'Should handle many streaming events');

    // Verify final message completion
    const completionEvents = StreamFixtures.longStream.filter(
      e => e.type === 'message.updated'
    );

    assert.equal(completionEvents.length, 1, 'Should have exactly one completion event');
  });
});

test('single message: preserves message order in session', async () => {
  await withConversationTest(async (env) => {
    const { mocks, verify } = env;

    // Send first message
    await simulateMessageSend(env, 'First message', {
      streamEvents: StreamFixtures.simpleGreeting,
    });

    // Send second message
    await simulateMessageSend(env, 'Second message', {
      streamEvents: StreamFixtures.simpleGreeting,
    });

    // Verify both messages in session
    verify.sessionHasMessageCount('test-session-123', 2);

    // Verify order (user, assistant, user, assistant)
    const messages = await mocks.sessionService.getMessages('test-session-123');
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].text, 'First message');
    assert.equal(messages[1].role, 'assistant');
    assert.equal(messages[2].role, 'user');
    assert.equal(messages[2].text, 'Second message');
    assert.equal(messages[3].role, 'assistant');
  });
});
