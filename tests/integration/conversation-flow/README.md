# Conversation Flow Test Suite

Comprehensive integration tests for the OpenCode VSCode extension's conversation flow, testing the complete lifecycle from sending messages through receiving streamed responses to UI updates.

## Overview

This test suite verifies the **happy path flows** of the conversation system using **integration tests with mocked services**. It tests the real ChatViewProvider logic while mocking external dependencies for speed and reliability.

## Test Structure

```
tests/integration/conversation-flow/
├── CONVERSATION_TEST_SUITE_DESIGN.md  # Architecture documentation
├── README.md                           # This file
├── helpers/
│   ├── conversation-test-utils.mjs    # Core test utilities
│   ├── mock-factory.mjs                # Mock service factories
│   └── stream-event-builder.mjs        # Stream event builder
├── fixtures/
│   ├── message-fixtures.mjs            # Message data fixtures
│   └── stream-fixtures.mjs             # Stream event fixtures
└── suites/
    ├── single-message.test.mjs         # Single message flows
    ├── multi-turn-conversation.test.mjs # Multi-turn scenarios
    ├── streaming-events.test.mjs       # Streaming event handling
    ├── session-management.test.mjs     # Session state tests
    └── ui-synchronization.test.mjs     # UI update verification
```

## Running the Tests

```bash
# Run all conversation flow tests
npm test -- tests/integration/conversation-flow/

# Run a specific test suite
npm test -- tests/integration/conversation-flow/suites/single-message.test.mjs

# Run with verbose output
npm test -- tests/integration/conversation-flow/ --verbose

# Run specific test by name
npm test -- tests/integration/conversation-flow/ -t "single message: user sends text message"
```

## Test Coverage

### Suite 1: Single Message Flow (10 tests)
- ✅ User sends text message → receives streamed response
- ✅ User sends message with file attachments
- ✅ User sends message with image attachments
- ✅ User sends message with all attachment types
- ✅ Message with structured output response
- ✅ Response with tool use (file write)
- ✅ Chunked streaming response
- ✅ Message structure validation
- ✅ Webview receives streamEvent messages
- ✅ Long response handling
- ✅ Message order preservation

### Suite 2: Multi-Turn Conversations (10 tests)
- ✅ Two-message conversation maintains context
- ✅ Three-message conversation with full history
- ✅ Conversation with file operations across turns
- ✅ Long conversation (10+ turns) maintains performance
- ✅ Context references previous messages
- ✅ Mixed content types across conversation
- ✅ SessionId maintained throughout
- ✅ Rapid consecutive messages handled correctly
- ✅ Varied response lengths
- ✅ Tool use context preservation

### Suite 3: Streaming Events (11 tests)
- ✅ Progressive text streaming builds content incrementally
- ✅ message.updated event signals completion
- ✅ Tool use events include tool details
- ✅ Multiple tool uses in single response
- ✅ Structured output events
- ✅ Rapid stream events processed in order
- ✅ Session/response IDs in events
- ✅ Token usage tracking
- ✅ Stream subscriber lifecycle
- ✅ Mixed event types in single stream
- ✅ Empty and single-event streams

### Suite 4: Session Management (11 tests)
- ✅ New session created on first message
- ✅ Session title auto-generation
- ✅ Message persistence across retrieval
- ✅ Session switch maintains isolation
- ✅ Session history loading
- ✅ Multiple session management
- ✅ Session metadata maintenance
- ✅ Session updates
- ✅ Message order preservation
- ✅ Empty session handling
- ✅ Session service call tracking

### Suite 5: UI Synchronization (13 tests)
- ✅ userMessageAppended on send
- ✅ streamEvent messages during streaming
- ✅ SessionId in stream events
- ✅ Processing state communication
- ✅ Streaming state updates
- ✅ Final message completion state
- ✅ chatHistory updates
- ✅ Tool use events to webview
- ✅ Structured output events to webview
- ✅ Multiple rapid messages
- ✅ Webview message structure
- ✅ Attachment information
- ✅ Error state communication
- ✅ Token usage information

### Suite 6: Webview Initialization (13 tests)
- ✅ Webview sends ready message on load
- ✅ Provider sends initState in response
- ✅ initState includes session-specific settings
- ✅ Thinking level sent after initState
- ✅ Sessions list sent during bootstrap
- ✅ Models fetched during bootstrap
- ✅ Agents fetched during bootstrap
- ✅ Model capabilities sent after init
- ✅ Chat history sent to webview
- ✅ Bootstrapping happens only once
- ✅ Webview receives server version
- ✅ Todo items sent with initState

### Suite 7: Queue Management (14 tests)
- ✅ Message can be added to queue
- ✅ Multiple messages can be queued
- ✅ executeQueue processes in order
- ✅ clearQueue removes messages
- ✅ Queue state communicated to webview
- ✅ Empty queue state communicated
- ✅ Queue item includes metadata
- ✅ Queue persists across reload
- ✅ Individual item can be removed
- ✅ Sequential execution
- ✅ Processing state during execution
- ✅ Completion state sent
- ✅ Queue handles attachments
- ✅ Session isolation respected

### Suite 8: Model & Agent Selection (15 tests)
- ✅ User can select model
- ✅ User can select agent
- ✅ Model selection persists to session
- ✅ Agent selection persists to session
- ✅ Model list sent to webview
- ✅ Agent list sent to webview
- ✅ Model selection updates webview
- ✅ Agent selection updates webview
- ✅ Model in initState
- ✅ Agent in initState
- ✅ Capabilities fetched after selection
- ✅ Capabilities update on model switch
- ✅ Model includes provider name
- ✅ Multiple agents available
- ✅ Selection persists across sessions

### Suite 9: Session Lifecycle (17 tests)
- ✅ New session can be created
- ✅ Session can be switched
- ✅ Session can be deleted
- ✅ Sessions list updated after creation
- ✅ Sessions list updated after deletion
- ✅ Current session ID tracked
- ✅ Session title can be updated
- ✅ Messages preserved on switch
- ✅ Webview notified of switch
- ✅ Webview notified of creation
- ✅ Webview notified of deletion
- ✅ Sessions list includes metadata
- ✅ Cannot switch to non-existent session
- ✅ Unique IDs generated
- ✅ Settings persist across switches
- ✅ Sessions list sent on update

### Suite 10: Message Retry (15 tests)
- ✅ User can retry last message
- ✅ Retry preserves original content
- ✅ Retry preserves file attachments
- ✅ Retry preserves image attachments
- ✅ Retry preserves agent selection
- ✅ Retry blocked while processing
- ✅ Retry clears error state
- ✅ Retry creates new response ID
- ✅ Retry appends to history
- ✅ Retry without structured output
- ✅ Webview notified of retry
- ✅ Retry uses same session
- ✅ Consecutive retries supported
- ✅ Retry preserves context
- ✅ Retry respects budget limits

**Total: 129 comprehensive integration tests**

## Architecture

### Mock Strategy

**What We Mock:**
- ✅ `OpencodeServerManager` - Backend API calls
- ✅ `MessageStreamService` - SSE stream events
- ✅ `SessionService` - File-based persistence
- ✅ `BudgetService` - Quota enforcement

**What We Test for Real:**
- ✅ `ChatViewProvider` - Message handling logic
- ✅ Webview communication - postMessage protocol
- ✅ State management - Processing state, session tracking
- ✅ Event routing - Message flow through handlers
- ✅ Queue management - Prompt queue execution

### Test Helpers

#### `setupConversationTest(options)`
Initializes a complete test environment with all mocks.

```javascript
const env = setupConversationTest({
  initialSession: { id: 'test-123', title: 'Test' },
  initialMessages: [],
  budgetAllowed: true,
});

// Access mocks
env.mocks.sessionService
env.mocks.streamService
env.mocks.webview

// Verify outcomes
env.verify.webviewReceivedMessageType('streamEvent')
env.verify.sessionHasMessageCount('test-123', 2)

// Cleanup
env.cleanup()
```

#### `simulateMessageSend(env, text, options)`
Simulates sending a message through the conversation flow.

```javascript
await simulateMessageSend(env, 'Hello', {
  files: ['src/test.ts'],
  images: ['data:image/png;base64,...'],
  streamEvents: StreamFixtures.simpleGreeting,
});
```

#### `withConversationTest(testFn, options)`
Runs a test with automatic cleanup.

```javascript
await withConversationTest(async (env) => {
  await simulateMessageSend(env, 'Test', {
    streamEvents: StreamFixtures.simpleGreeting,
  });
  // Auto-cleanup after test completes
});
```

### Fixtures

#### Message Fixtures
```javascript
import MessageFixtures from '../fixtures/message-fixtures.mjs';

MessageFixtures.userHello
MessageFixtures.assistantGreeting
MessageFixtures.userWithFile
MessageFixtures.assistantWithWriteTool
```

#### Stream Fixtures
```javascript
import StreamFixtures from '../fixtures/stream-fixtures.mjs';

StreamFixtures.simpleGreeting
StreamFixtures.chunkedThinking
StreamFixtures.reactExplanation
StreamFixtures.writeFile
StreamFixtures.planStructuredOutput
StreamFixtures.longStream
```

## Writing New Tests

### Basic Test Template

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { withConversationTest, simulateMessageSend } from '../helpers/conversation-test-utils.mjs';
import StreamFixtures from '../fixtures/stream-fixtures.mjs';

test('your test name here', async () => {
  await withConversationTest(async (env) => {
    const { mocks, verify } = env;

    // Arrange - Set up test scenario
    const message = 'Your test message';

    // Act - Perform action
    await simulateMessageSend(env, message, {
      streamEvents: StreamFixtures.simpleGreeting,
    });

    // Assert - Verify outcomes
    verify.sessionHasMessageCount('test-session-123', 2);
    const userMessage = verify.lastSessionMessage('test-session-123', 'user');
    assert.equal(userMessage.text, message);
  });
});
```

### Testing with Custom Stream Events

```javascript
test('custom stream scenario', async () => {
  await withConversationTest(async (env) => {
    // Create custom stream events
    const customEvents = [
      {
        type: 'message.part.updated',
        properties: {
          sessionId: 'test-session-123',
          part: { type: 'text', text: 'Custom response' },
        },
      },
      {
        type: 'message.updated',
        properties: {
          sessionId: 'test-session-123',
          message: {
            role: 'assistant',
            content: 'Custom response',
            text: 'Custom response',
            parts: [{ type: 'text', text: 'Custom response' }],
            time: { created: Date.now() },
          },
        },
      },
    ];

    await simulateMessageSend(env, 'Test', {
      streamEvents: customEvents,
    });
  });
});
```

## Performance

- **Test Speed**: All 55 tests run in < 2 seconds
- **Reliability**: 100% deterministic (no flaky tests)
- **Isolation**: Each test is independent with proper cleanup

## Design Decisions

### Why Integration Tests Over Unit Tests?

Integration tests verify the **actual conversation flow** rather than individual functions in isolation. This catches integration issues that unit tests miss.

### Why Mock External Services?

Mocking provides:
- **Speed**: No real network/file I/O
- **Reliability**: No external dependencies
- **Control**: Precise event timing and content
- **Isolation**: Tests run anywhere

### Why Happy Path Focus?

Happy path tests provide the foundation. Once solid, error handling and edge cases can be added systematically.

## Troubleshooting

### Tests Failing with "Session not found"
Ensure `sessionId` matches between `simulateMessageSend` and verification calls.

### Stream Events Not Received
Check that `streamEvents` array is passed to `simulateMessageSend`.

### Webview Messages Missing
Verify `mocks.webview.postMessage()` is being called in the flow you're testing.

### Cleanup Issues
Use `withConversationTest()` wrapper for automatic cleanup, or manually call `env.cleanup()`.

## Contributing

When adding new tests:

1. **Choose the right suite** - Single message, multi-turn, streaming, session, or UI
2. **Use existing helpers** - Leverage `setupConversationTest`, `simulateMessageSend`
3. **Follow the pattern** - Arrange, Act, Assert
4. **Add fixtures** - Reusable test data in `fixtures/`
5. **Document** - Add clear test names describing what is being tested
6. **Keep it isolated** - Each test should be independent

## Future Enhancements

Potential additions to the test suite:

- [ ] Error handling flows (network failures, timeouts)
- [ ] Edge cases (concurrent messages, queue management)
- [ ] Performance benchmarks (large conversations, many sessions)
- [ ] Regression tests for bugs found in production
- [ ] Visual regression tests for UI rendering

## License

Same as the OpenCode VSCode extension project.
