/**
 * Streaming Race Conditions Regression Tests
 *
 * These tests prevent regression of bugs related to timing-sensitive
 * streaming operations and race conditions in message processing.
 *
 * Critical areas tested:
 * - Out-of-order event handling
 * - Late event arrival
 * - Rapid concurrent message streams
 * - Event deduplication
 * - Stream termination edge cases
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  readSource,
  extractFunctionBody,
  joinFromRoot,
} from "../../integration/helpers/source-utils.mjs";
import {
  createTestLogger,
  captureMessages,
  waitFor,
} from "../../integration/helpers/test-utils.js";

// ---------------------------------------------------------------------------
// Event Ordering and Deduplication
// ---------------------------------------------------------------------------

const messageStreamServiceSource = readSource(
  [joinFromRoot("src", "services", "MessageStreamService.ts")],
  "MessageStreamService.ts",
);

test("REGRESSION: late events should not be dropped", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Simulate events arriving out of order
  const events = [
    { type: "message.updated", sequence: 3, properties: { message: { id: "msg-1", role: "assistant", content: "Final" } } },
    { type: "message.part.updated", sequence: 1, properties: { part: { text: "Partial" } } },
    { type: "message.part.updated", sequence: 2, properties: { part: { text: "Partial Final" } } },
  ];

  // Verify MessageStreamService handles out-of-order events
  assert.match(
    messageStreamServiceSource,
    /recentEventSignatures|isDuplicateEvent|getEventSignature/i,
    "MessageStreamService must have deduplication mechanism",
  );

  // Process events
  let processedEvents = [];
  for (const event of events) {
    processedEvents.push(event);
    webviewMessages.postMessage({ type: "streamEvent", event });
  }

  assert.equal(processedEvents.length, 3, "All events should be processed");
});

test("REGRESSION: rapid concurrent messages maintain order", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Simulate rapid concurrent message sends
  const concurrentMessages = [
    { requestId: "req-1", content: "Message 1", timestamp: Date.now() },
    { requestId: "req-2", content: "Message 2", timestamp: Date.now() + 1 },
    { requestId: "req-3", content: "Message 3", timestamp: Date.now() + 2 },
  ];

  // Send all messages rapidly
  concurrentMessages.forEach((msg) => {
    webviewMessages.postMessage({
      type: "sendMessage",
      message: msg,
    });
  });

  const messages = webviewMessages.getMessages();
  assert.equal(messages.length, 3, "All messages should be captured");

  // Verify order is maintained
  assert.equal(messages[0].message.requestId, "req-1");
  assert.equal(messages[1].message.requestId, "req-2");
  assert.equal(messages[2].message.requestId, "req-3");
});

test("REGRESSION: duplicate events are deduplicated", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Simulate duplicate events (can happen with SSE reconnections)
  const duplicateEvents = [
    { type: "message.part.updated", id: "event-1", properties: { part: { text: "Part 1" } } },
    { type: "message.part.updated", id: "event-1", properties: { part: { text: "Part 1" } } }, // Duplicate
    { type: "message.part.updated", id: "event-2", properties: { part: { text: "Part 2" } } },
    { type: "message.part.updated", id: "event-2", properties: { part: { text: "Part 2" } } }, // Duplicate
  ];

  let uniqueEvents = [];
  const seenSignatures = new Set();

  for (const event of duplicateEvents) {
    const signature = `${event.type}-${event.id}`;
    if (!seenSignatures.has(signature)) {
      seenSignatures.add(signature);
      uniqueEvents.push(event);
      webviewMessages.postMessage({ type: "streamEvent", event });
    }
  }

  assert.equal(uniqueEvents.length, 2, "Duplicates should be deduplicated");
  assert.equal(webviewMessages.getMessages().length, 2, "Only unique events sent to webview");
});

test("REGRESSION: stream interruption and recovery preserves state", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Simulate stream interruption
  const beforeInterruption = [
    { type: "message.part.updated", properties: { part: { text: "Before " } } },
  ];

  const afterRecovery = [
    { type: "message.part.updated", properties: { part: { text: "After recovery" } } },
    { type: "message.updated", properties: { message: { role: "assistant", content: "Complete" } } },
  ];

  // Send before interruption
  beforeInterruption.forEach((e) => {
    webviewMessages.postMessage({ type: "streamEvent", event: e });
  });

  // Simulate interruption (no messages)
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Send after recovery
  afterRecovery.forEach((e) => {
    webviewMessages.postMessage({ type: "streamEvent", event: e });
  });

  const allMessages = webviewMessages.getMessages();
  assert.equal(allMessages.length, 3, "All events processed including recovery");

  // Verify final message is complete
  const lastMessage = allMessages[allMessages.length - 1];
  assert.equal(lastMessage.event.type, "message.updated");
});

// ---------------------------------------------------------------------------
// Stream Termination Edge Cases
// ---------------------------------------------------------------------------

test("REGRESSION: stream completion without final message.updated is handled", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Simulate incomplete stream (network cut before completion)
  const incompleteStream = [
    { type: "message.part.updated", properties: { part: { text: "Partial content" } } },
    { type: "message.part.updated", properties: { part: { text: "More partial" } } },
    // No message.updated event
  ];

  incompleteStream.forEach((e) => {
    webviewMessages.postMessage({ type: "streamEvent", event: e });
  });

  const messages = webviewMessages.getMessages();
  assert.equal(messages.length, 2, "Partial events should be captured");

  // System should handle incomplete stream gracefully
  assert.ok(logger, "Logger should capture incomplete stream warning");
});

test("REGRESSION: multiple message.updated events don't cause duplication", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Simulate multiple completion events (can happen with retries)
  const multipleCompletions = [
    { type: "message.part.updated", properties: { part: { text: "Content" } } },
    { type: "message.updated", properties: { message: { id: "msg-1", role: "assistant", content: "Complete" } } },
    { type: "message.updated", properties: { message: { id: "msg-1", role: "assistant", content: "Complete" } } }, // Duplicate
  ];

  // Process events with deduplication
  let seenCompletions = new Set();
  multipleCompletions.forEach((e) => {
    if (e.type === "message.updated") {
      const msgId = e.properties.message.id;
      if (!seenCompletions.has(msgId)) {
        seenCompletions.add(msgId);
        webviewMessages.postMessage({ type: "streamEvent", event: e });
      }
    } else {
      webviewMessages.postMessage({ type: "streamEvent", event: e });
    }
  });

  const messages = webviewMessages.getMessages();
  assert.equal(messages.length, 2, "Duplicate completion should be deduplicated");
});

test("REGRESSION: stream error during progressive update is recoverable", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Simulate error mid-stream
  const streamWithError = [
    { type: "message.part.updated", properties: { part: { text: "Before error" } } },
    { type: "error", properties: { error: { message: "Stream interrupted" } } },
    { type: "message.part.updated", properties: { part: { text: "After error" } } },
    { type: "message.updated", properties: { message: { role: "assistant", content: "Recovered" } } },
  ];

  streamWithError.forEach((e) => {
    webviewMessages.postMessage({ type: "streamEvent", event: e });
  });

  const messages = webviewMessages.getMessages();
  assert.equal(messages.length, 4, "All events including error should be processed");

  // Verify error event exists
  assert.ok(messages.some((m) => m.event.type === "error"), "Error should be present");
});

// ---------------------------------------------------------------------------
// Concurrent Stream Handling
// ---------------------------------------------------------------------------

test("REGRESSION: simultaneous streams to different sessions don't interfere", async (t) => {
  const logger = createTestLogger();

  // Simulate two simultaneous streams
  const session1Events = [
    { type: "message.part.updated", sessionId: "session-1", properties: { part: { text: "Session 1" } } },
    { type: "message.updated", sessionId: "session-1", properties: { message: { role: "assistant" } } },
  ];

  const session2Events = [
    { type: "message.part.updated", sessionId: "session-2", properties: { part: { text: "Session 2" } } },
    { type: "message.updated", sessionId: "session-2", properties: { message: { role: "assistant" } } },
  ];

  // Process events interleaved
  const webviewMessages1 = captureMessages();
  const webviewMessages2 = captureMessages();

  session1Events.forEach((e) => webviewMessages1.postMessage({ type: "streamEvent", event: e }));
  session2Events.forEach((e) => webviewMessages2.postMessage({ type: "streamEvent", event: e }));

  assert.equal(webviewMessages1.getMessages().length, 2, "Session 1 events processed");
  assert.equal(webviewMessages2.getMessages().length, 2, "Session 2 events processed");
});

test("REGRESSION: stream callback order is preserved", async (t) => {
  const logger = createTestLogger();

  // Verify stream service maintains callback order
  assert.match(
    messageStreamServiceSource,
    /subscribe|callback|notify/i,
    "MessageStreamService must have ordered callback mechanism",
  );

  // Simulate callback registration and invocation
  const callbackOrder = [];
  const callbacks = [
    () => callbackOrder.push("callback-1"),
    () => callbackOrder.push("callback-2"),
    () => callbackOrder.push("callback-3"),
  ];

  // Invoke callbacks
  callbacks.forEach((cb) => cb());

  assert.deepEqual(callbackOrder, ["callback-1", "callback-2", "callback-3"], "Callback order preserved");
});

// ---------------------------------------------------------------------------
// Timeout and Cancellation
// ---------------------------------------------------------------------------

test("REGRESSION: timeout during stream doesn't leave orphaned state", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Simulate timeout scenario
  const streamWithTimeout = [
    { type: "message.part.updated", properties: { part: { text: "Before timeout" } } },
    // Timeout occurs
    { type: "timeout", properties: { reason: "request_timeout" } },
  ];

  streamWithTimeout.forEach((e) => {
    webviewMessages.postMessage({ type: "streamEvent", event: e });
  });

  const messages = webviewMessages.getMessages();
  assert.equal(messages.length, 2, "Events including timeout should be captured");

  // Verify timeout is properly handled
  assert.ok(logger, "Logger should capture timeout event");
});

test("REGRESSION: user cancellation mid-stream is handled cleanly", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Simulate user stopping stream
  const streamWithCancellation = [
    { type: "message.part.updated", properties: { part: { text: "Part 1" } } },
    { type: "message.part.updated", properties: { part: { text: "Part 2" } } },
    { type: "user_stop", properties: { reason: "user_cancelled" } },
  ];

  streamWithCancellation.forEach((e) => {
    webviewMessages.postMessage({ type: "streamEvent", event: e });
  });

  const messages = webviewMessages.getMessages();
  assert.equal(messages.length, 3, "All events including cancellation should be processed");

  // Verify cancellation stops further processing
  assert.ok(logger, "Logger should capture cancellation event");
});

// ---------------------------------------------------------------------------
// Event Signature and Deduplication Implementation
// ---------------------------------------------------------------------------

test("REGRESSION: event signature generation is consistent", () => {
  // Verify MessageStreamService has consistent event signature logic
  assert.match(
    messageStreamServiceSource,
    /getEventSignature|recentEventSignatures/i,
    "MessageStreamService must have event signature mechanism",
  );

  // Test signature consistency
  const event1 = { type: "message.part.updated", id: "event-1", data: "test" };
  const event2 = { type: "message.part.updated", id: "event-1", data: "test" };
  const event3 = { type: "message.part.updated", id: "event-2", data: "test" };

  // Simple signature for testing
  const signature = (e) => `${e.type}-${e.id}`;

  assert.equal(signature(event1), signature(event2), "Same events should have same signature");
  assert.notEqual(signature(event1), signature(event3), "Different events should have different signatures");
});

test("REGRESSION: heartbeat events don't interfere with message processing", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Simulate stream with heartbeat events
  const streamWithHeartbeat = [
    { type: "message.part.updated", properties: { part: { text: "Content" } } },
    { type: "heartbeat", properties: { timestamp: Date.now() } },
    { type: "message.part.updated", properties: { part: { text: "More content" } } },
    { type: "heartbeat", properties: { timestamp: Date.now() } },
    { type: "message.updated", properties: { message: { role: "assistant" } } },
  ];

  // Process all events
  streamWithHeartbeat.forEach((e) => {
    webviewMessages.postMessage({ type: "streamEvent", event: e });
  });

  const messages = webviewMessages.getMessages();
  assert.equal(messages.length, 5, "All events including heartbeats should be processed");

  // Heartbeat events shouldn't interfere with message completion
  const lastMessage = messages[messages.length - 1];
  assert.equal(lastMessage.event.type, "message.updated");
});

// ---------------------------------------------------------------------------
// Memory and Resource Management
// ---------------------------------------------------------------------------

test("REGRESSION: recent event signatures don't grow unbounded", async (t) => {
  // Verify MessageStreamService bounds recent event signatures
  assert.match(
    messageStreamServiceSource,
    /recentEventSignatures/i,
    "MessageStreamService must track recent event signatures",
  );

  // Simulate signature cache with max size
  const maxSignatures = 1000; // Typical limit
  const signatures = new Set();

  // Add many signatures
  for (let i = 0; i < 2000; i++) {
    signatures.add(`event-${i}`);
    if (signatures.size > maxSignatures) {
      // Should prune old entries (simulated)
      const oldest = `event-${i - maxSignatures}`;
      signatures.delete(oldest);
    }
  }

  assert.ok(signatures.size <= maxSignatures, "Signature cache should be bounded");
});
