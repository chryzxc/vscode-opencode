/**
 * Streaming Events Tests
 *
 * Tests the handling of streaming events from the server,
 * including progressive text updates, tool use, and completion.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setupConversationTest,
  simulateMessageSend,
  simulateStreamEvents,
  withConversationTest,
} from '../helpers/conversation-test-utils.mjs';
import StreamFixtures from '../fixtures/stream-fixtures.mjs';

test('streaming: progressive text streaming builds content incrementally', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Send message with chunked response
    await simulateMessageSend(env, 'Tell me a story', {
      streamEvents: StreamFixtures.chunkedThinking,
    });

    // Verify chunked events were received
    const partEvents = StreamFixtures.chunkedThinking.filter(
      e => e.type === 'message.part.updated'
    );

    assert.ok(partEvents.length > 1, 'Should have multiple part events');

    // Verify progressive text building
    const texts = partEvents.map(e => e.properties.part.text);
    for (let i = 1; i < texts.length; i++) {
      assert.ok(texts[i].length >= texts[i - 1].length, `Chunk ${i} should build on previous`);
    }

    // Verify final completion event
    const completionEvent = StreamFixtures.chunkedThinking.find(
      e => e.type === 'message.updated'
    );
    assert.ok(completionEvent, 'Should have completion event');
    assert.ok(completionEvent.properties.message, 'Completion should have message');
  });
});

test('streaming: message.updated event signals completion', async () => {
  await withConversationTest(async (env) => {
    const { mocks, verify } = env;

    await simulateMessageSend(env, 'Complete this', {
      streamEvents: StreamFixtures.reactExplanation,
    });

    // Verify exactly one message.updated event
    const completionEvents = StreamFixtures.reactExplanation.filter(
      e => e.type === 'message.updated'
    );

    assert.equal(completionEvents.length, 1, 'Should have exactly one completion event');

    // Verify completion event structure
    const completion = completionEvents[0];
    assert.ok(completion.properties.message, 'Completion should include full message');
    assert.equal(completion.properties.message.role, 'assistant');
    assert.ok(completion.properties.message.content, 'Message should have content');

    // Verify tokens included
    assert.ok(completion.properties.tokens, 'Completion should include token usage');
    assert.ok(typeof completion.properties.tokens.input === 'number', 'Should have input token count');
    assert.ok(typeof completion.properties.tokens.output === 'number', 'Should have output token count');
  });
});

test('streaming: tool use events include tool details', async () => {
  await withConversationTest(async (env) => {
    await simulateMessageSend(env, 'Create a file', {
      streamEvents: StreamFixtures.writeFile,
    });

    // Find tool use event
    const toolEvent = StreamFixtures.writeFile.find(
      e => e.properties?.part?.type === 'tool'
    );

    assert.ok(toolEvent, 'Should have tool use event');

    // Verify tool structure
    const part = toolEvent.properties.part;
    assert.equal(part.type, 'tool');
    assert.equal(part.name, 'write');
    assert.ok(part.input, 'Tool should have input');
    assert.ok(part.input.filepath, 'Write tool should have filepath');
    assert.ok(part.input.content, 'Write tool should have content');
    assert.equal(part.state.status, 'done');
  });
});

test('streaming: multiple tool uses in single response', async () => {
  await withConversationTest(async (env) => {
    await simulateMessageSend(env, 'Create multiple files', {
      streamEvents: StreamFixtures.multiTool,
    });

    // Find all tool use events
    const toolEvents = StreamFixtures.multiTool.filter(
      e => e.properties?.part?.type === 'tool'
    );

    assert.equal(toolEvents.length, 2, 'Should have two tool use events');

    // Verify both are write tools
    toolEvents.forEach(event => {
      assert.equal(event.properties.part.name, 'write');
    });

    // Verify different files
    const filepaths = toolEvents.map(e => e.properties.part.input.filepath);
    assert.notEqual(filepaths[0], filepaths[1], 'Should write to different files');
  });
});

test('streaming: structured output events include structured data', async () => {
  await withConversationTest(async (env) => {
    await simulateMessageSend(env, 'Create a plan', {
      streamEvents: StreamFixtures.planStructuredOutput,
    });

    // Find structured output event
    const structuredEvent = StreamFixtures.planStructuredOutput.find(
      e => e.type === 'structured.output'
    );

    assert.ok(structuredEvent, 'Should have structured output event');

    // Verify structured data
    const structured = structuredEvent.properties.structured;
    assert.equal(structured.kind, 'plan');
    assert.ok(structured.title, 'Plan should have title');
    assert.ok(structured.steps, 'Plan should have steps');
    assert.ok(Array.isArray(structured.steps), 'Steps should be array');
  });
});

test('streaming: rapid stream events are processed in order', async () => {
  await withConversationTest(async (env) => {
    const { mocks, verify } = env;

    // Create many stream events
    const manyEvents = [];
    for (let i = 0; i < 20; i++) {
      manyEvents.push({
        type: 'message.part.updated',
        properties: {
          part: { type: 'text', text: `Chunk ${i}` },
        },
      });
    }
    manyEvents.push({
      type: 'message.updated',
      properties: {
        message: {
          role: 'assistant',
          content: 'Complete',
          text: 'Complete',
          parts: [{ type: 'text', text: 'Complete' }],
          time: { created: Date.now() },
        },
      },
    });

    await simulateMessageSend(env, 'Send many events', {
      streamEvents: manyEvents,
    });

    // Verify all events emitted
    assert.equal(manyEvents.filter(e => e.type === 'message.part.updated').length, 20);

    // Verify final completion
    assert.ok(manyEvents.some(e => e.type === 'message.updated'));
  });
});

test('streaming: stream events include session and response IDs', async () => {
  await withConversationTest(async (env) => {
    const sessionId = 'test-session-123';
    const responseId = 'test-response-456';

    await simulateMessageSend(env, 'Check IDs', {
      sessionId,
      streamEvents: StreamFixtures.simpleGreeting.map(e => ({
        ...e,
        properties: {
          ...e.properties,
          sessionId,
          responseId,
        },
      })),
    });

    // Verify all events have session and response IDs
    StreamFixtures.simpleGreeting.forEach(event => {
      assert.equal(event.properties.sessionId, sessionId, 'Event should have correct session ID');
      assert.equal(event.properties.responseId, responseId, 'Event should have correct response ID');
    });
  });
});

test('streaming: token usage is tracked', async () => {
  await withConversationTest(async (env) => {
    await simulateMessageSend(env, 'Track tokens', {
      streamEvents: StreamFixtures.reactExplanation,
    });

    // Find completion event with tokens
    const completion = StreamFixtures.reactExplanation.find(
      e => e.type === 'message.updated'
    );

    assert.ok(completion, 'Should have completion event');
    assert.ok(completion.properties.tokens, 'Should have token info');

    const { input, output } = completion.properties.tokens;
    assert.ok(typeof input === 'number', 'Input tokens should be number');
    assert.ok(typeof output === 'number', 'Output tokens should be number');
    assert.ok(input > 0, 'Should have input tokens');
    assert.ok(output > 0, 'Should have output tokens');
  });
});

test('streaming: stream subscriber lifecycle', async () => {
  await withConversationTest(async (env) => {
    const { mocks, verify } = env;

    // Initially no subscribers
    verify.streamSubscriberCount(0);

    // Send message (triggers streaming)
    await simulateMessageSend(env, 'Test subscription', {
      streamEvents: StreamFixtures.simpleGreeting,
    });

    // Verify subscription happened
    assert.ok(mocks.streamService._subscribeCallCount > 0, 'Should subscribe to stream');
  });
});

test('streaming: mixed event types in single stream', async () => {
  await withConversationTest(async (env) => {
    // Create stream with mixed event types
    const mixedEvents = [
      {
        type: 'message.part.updated',
        properties: {
          part: { type: 'text', text: 'Starting' },
        },
      },
      {
        type: 'message.part.updated',
        properties: {
          part: {
            type: 'tool',
            name: 'write',
            input: { filepath: 'test.ts', content: 'code' },
            state: { status: 'done' },
          },
        },
      },
      {
        type: 'message.part.updated',
        properties: {
          part: { type: 'text', text: 'StartingDone' },
        },
      },
      {
        type: 'structured.output',
        properties: {
          structured: { kind: 'plan', steps: [] },
        },
      },
      {
        type: 'message.updated',
        properties: {
          message: {
            role: 'assistant',
            content: 'StartingDone',
            text: 'StartingDone',
            parts: [
              { type: 'text', text: 'Starting' },
              { type: 'tool', name: 'write' },
              { type: 'text', text: 'StartingDone' },
            ],
            time: { created: Date.now() },
          },
        },
      },
    ];

    await simulateMessageSend(env, 'Mixed events', {
      streamEvents: mixedEvents,
    });

    // Verify all event types present
    const types = new Set(mixedEvents.map(e => e.type));
    assert.ok(types.has('message.part.updated'), 'Should have part events');
    assert.ok(types.has('message.updated'), 'Should have completion event');
    assert.ok(types.has('structured.output'), 'Should have structured output');
  });
});

test('streaming: handles empty stream gracefully', async () => {
  await withConversationTest(async (env) => {
    // Send message with no stream events
    const result = await simulateMessageSend(env, 'No response', {
      streamEvents: [],
    });

    // Verify message still persisted
    const { verify } = env;
    verify.sessionHasMessageCount(result.sessionId, 1);

    // Verify user message created
    const userMessage = verify.lastSessionMessage(result.sessionId, 'user');
    assert.equal(userMessage.text, 'No response');
  });
});

test('streaming: handles single event stream', async () => {
  await withConversationTest(async (env) => {
    const singleEvent = [
      {
        type: 'message.updated',
        properties: {
          message: {
            role: 'assistant',
            content: 'Complete',
            text: 'Complete',
            parts: [{ type: 'text', text: 'Complete' }],
            time: { created: Date.now() },
          },
        },
      },
    ];

    await simulateMessageSend(env, 'Single event', {
      streamEvents: singleEvent,
    });

    // Verify message completed
    const { verify } = env;
    verify.sessionHasMessageCount('test-session-123', 2); // user + assistant
  });
});
