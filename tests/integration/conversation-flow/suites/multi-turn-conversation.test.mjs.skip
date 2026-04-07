/**
 * Multi-Turn Conversation Tests
 *
 * Tests conversations spanning multiple message exchanges,
 * including context preservation and history management.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  setupConversationTest,
  simulateMessageSend,
  withConversationTest,
} from '../helpers/conversation-test-utils.mjs';
import StreamFixtures from '../fixtures/stream-fixtures.mjs';

test('multi-turn: two-message conversation maintains context', async () => {
  await withConversationTest(async (env) => {
    const { mocks, verify } = env;

    // First turn
    await simulateMessageSend(env, 'What is React?', {
      streamEvents: StreamFixtures.reactExplanation,
    });

    // Second turn (follow-up question)
    await simulateMessageSend(env, 'Can you give me an example?', {
      streamEvents: StreamFixtures.chunkedThinking,
    });

    // Verify both user messages persisted
    verify.sessionHasMessageCount('test-session-123', 4); // 2 user + 2 assistant

    // Verify conversation order
    const messages = await mocks.sessionService.getMessages('test-session-123');
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].text, 'What is React?');
    assert.equal(messages[1].role, 'assistant');
    assert.equal(messages[2].role, 'user');
    assert.equal(messages[2].text, 'Can you give me an example?');
    assert.equal(messages[3].role, 'assistant');
  });
});

test('multi-turn: three-message conversation with full history', async () => {
  await withConversationTest(async (env) => {
    const { mocks, verify } = env;

    // Turn 1
    await simulateMessageSend(env, 'Explain async/await', {
      streamEvents: StreamFixtures.simpleGreeting,
    });

    // Turn 2
    await simulateMessageSend(env, 'How about promises?', {
      streamEvents: StreamFixtures.chunkedThinking,
    });

    // Turn 3
    await simulateMessageSend(env, 'Show me code examples', {
      streamEvents: StreamFixtures.writeFile,
    });

    // Verify all messages persisted
    verify.sessionHasMessageCount('test-session-123', 6); // 3 user + 3 assistant

    // Verify complete conversation history
    const messages = await mocks.sessionService.getMessages('test-session-123');
    assert.equal(messages.length, 6);

    // Verify alternating pattern
    messages.forEach((msg, index) => {
      const expectedRole = index % 2 === 0 ? 'user' : 'assistant';
      assert.equal(msg.role, expectedRole, `Message ${index} should be ${expectedRole}`);
    });
  });
});

test('multi-turn: conversation with file operations across turns', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Turn 1: Create a file
    await simulateMessageSend(env, 'Create a Button component', {
      streamEvents: StreamFixtures.writeFile,
    });

    // Turn 2: Edit the file
    await simulateMessageSend(env, 'Add a onClick prop', {
      streamEvents: StreamFixtures.editFile,
    });

    // Verify both turns completed
    const messages = await mocks.sessionService.getMessages('test-session-123');
    assert.equal(messages.length, 4);

    // Verify tool uses in both assistant responses
    const firstAssistant = messages[1];
    const secondAssistant = messages[3];

    assert.ok(firstAssistant.parts.some(p => p.type === 'tool'), 'First response should have tool use');
    assert.ok(secondAssistant.parts.some(p => p.type === 'tool'), 'Second response should have tool use');
  });
});

test('multi-turn: long conversation maintains performance', async () => {
  await withConversationTest(async (env) => {
    const { mocks, verify } = env;

    const turnCount = 10;

    // Simulate 10-turn conversation
    for (let i = 0; i < turnCount; i++) {
      await simulateMessageSend(env, `Message ${i + 1}`, {
        streamEvents: StreamFixtures.simpleGreeting,
      });
    }

    // Verify all messages persisted
    verify.sessionHasMessageCount('test-session-123', turnCount * 2);

    // Verify conversation is retrievable
    const messages = await mocks.sessionService.getMessages('test-session-123');
    assert.equal(messages.length, turnCount * 2);

    // Spot check first and last
    assert.equal(messages[0].text, 'Message 1');
    assert.equal(messages[messages.length - 2].text, 'Message 10');
  });
});

test('multi-turn: context references previous messages', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Turn 1: Establish topic
    await simulateMessageSend(env, 'I am learning TypeScript', {
      streamEvents: createSimpleResponse('That is great! TypeScript is a powerful tool.'),
    });

    // Turn 2: Reference previous topic
    await simulateMessageSend(env, 'What are the benefits?', {
      streamEvents: createSimpleResponse('TypeScript offers type safety, better IDE support, and improved code quality.'),
    });

    // Turn 3: Continue thread
    await simulateMessageSend(env, 'How do I get started?', {
      streamEvents: createSimpleResponse('Start by installing it: npm install -D typescript'),
    });

    // Verify all context preserved
    const messages = await mocks.sessionService.getMessages('test-session-123');

    // Each user message references the learning context
    assert.ok(messages[0].text.includes('TypeScript'));
    assert.ok(messages[2].text.includes('benefits')); // References previous
    assert.ok(messages[4].text.includes('started')); // Continues thread
  });
});

test('multi-turn: mixed content types across conversation', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Turn 1: Text only
    await simulateMessageSend(env, 'Hello', {
      streamEvents: StreamFixtures.simpleGreeting,
    });

    // Turn 2: With files
    await simulateMessageSend(env, 'Review this', {
      files: ['src/App.tsx'],
      streamEvents: StreamFixtures.simpleGreeting,
    });

    // Turn 3: With images
    await simulateMessageSend(env, 'What is this?', {
      images: ['data:image/png;base64,ABC123'],
      streamEvents: StreamFixtures.simpleGreeting,
    });

    // Turn 4: Text only again
    await simulateMessageSend(env, 'Thanks', {
      streamEvents: StreamFixtures.simpleGreeting,
    });

    // Verify all messages persisted correctly
    const messages = await mocks.sessionService.getMessages('test-session-123');
    assert.equal(messages.length, 8);

    // Verify attachment variations
    assert.ok(!messages[0].files, 'First message should have no files');
    assert.ok(messages[2].files, 'Third message should have files');
    assert.ok(messages[4].images, 'Fifth message should have images');
    assert.ok(!messages[6].files && !messages[6].images, 'Last message should have no attachments');
  });
});

test('multi-turn: conversation maintains sessionId throughout', async () => {
  await withConversationTest(async (env) => {
    const { mocks, verify } = env;

    // Send multiple messages
    for (let i = 0; i < 5; i++) {
      await simulateMessageSend(env, `Turn ${i + 1}`, {
        streamEvents: StreamFixtures.simpleGreeting,
      });
    }

    // Verify all messages in same session
    const messages = await mocks.sessionService.getMessages('test-session-123');
    assert.equal(messages.length, 10);

    // Verify session service was called consistently
    const getCurrentSessionCalls = mocks.sessionService._callLog.filter(
      call => call.method === 'getCurrentSession'
    );
    assert.ok(getCurrentSessionCalls.length >= 5, 'Should call getCurrentSession for each message');
  });
});

test('multi-turn: rapid consecutive messages are handled correctly', async () => {
  await withConversationTest(async (env) => {
    const { verify } = env;

    // Send messages rapidly (without awaiting stream completion)
    const promises = [
      simulateMessageSend(env, 'First', {
        streamEvents: StreamFixtures.chunkedThinking,
      }),
      simulateMessageSend(env, 'Second', {
        streamEvents: StreamFixtures.chunkedThinking,
      }),
      simulateMessageSend(env, 'Third', {
        streamEvents: StreamFixtures.chunkedThinking,
      }),
    ];

    // Wait for all to complete
    await Promise.all(promises);

    // Verify all messages persisted
    verify.sessionHasMessageCount('test-session-123', 6); // 3 user + 3 assistant
  });
});

test('multi-turn: conversation with varied response lengths', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Short response
    await simulateMessageSend(env, 'Yes or no?', {
      streamEvents: createSimpleResponse('Yes'),
    });

    // Medium response
    await simulateMessageSend(env, 'Explain briefly', {
      streamEvents: StreamFixtures.reactExplanation,
    });

    // Long response
    await simulateMessageSend(env, 'Tell me more', {
      streamEvents: StreamFixtures.longStream,
    });

    // Verify all responses persisted
    const messages = await mocks.sessionService.getMessages('test-session-123');

    // Verify varied content lengths
    const firstResponse = messages[1].text;
    const secondResponse = messages[3].text;
    const thirdResponse = messages[5].text;

    assert.ok(firstResponse.length < secondResponse.length, 'First should be shorter than second');
    assert.ok(secondResponse.length < thirdResponse.length, 'Second should be shorter than third');
  });
});

test('multi-turn: conversation preserves tool use context', async () => {
  await withConversationTest(async (env) => {
    const { mocks } = env;

    // Turn 1: Create file
    await simulateMessageSend(env, 'Create utils.ts', {
      streamEvents: StreamFixtures.writeFile,
    });

    // Turn 2: Reference the created file
    await simulateMessageSend(env, 'Now add a function to utils.ts', {
      streamEvents: StreamFixtures.editFile,
    });

    // Turn 3: Ask about the file
    await simulateMessageSend(env, 'What functions are in utils.ts?', {
      streamEvents: createSimpleResponse('utils.ts contains the functions we added'),
    });

    // Verify conversation maintains file context
    const messages = await mocks.sessionService.getMessages('test-session-123');

    // First response created file
    const firstTool = messages[1].parts.find(p => p.type === 'tool');
    assert.equal(firstTool.name, 'write');
    assert.ok(firstTool.input.filepath.includes('utils.ts'));

    // User referenced the file in next message
    assert.ok(messages[2].text.includes('utils.ts'));
  });
});

// Helper function for simple responses
function createSimpleResponse(text) {
  return [
    {
      type: 'message.part.updated',
      properties: {
        part: { type: 'text', text },
      },
    },
    {
      type: 'message.updated',
      properties: {
        message: {
          role: 'assistant',
          content: text,
          text,
          parts: [{ type: 'text', text }],
          time: { created: Date.now() },
        },
      },
    },
  ];
}
