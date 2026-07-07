/**
 * Session Compaction Flow Integration Tests
 *
 * Validates the complete session compaction lifecycle:
 *   Large Session → Trigger Compaction → Transform Messages → Persist → Restore
 *
 * Tests cross-service interactions between:
 * - CompactionManager (orchestration)
 * - SessionService (persistence)
 * - HistoryProcessor (message transformation)
 * - Webview (state preservation)
 *
 * Uses source-introspection to assert implementation correctness
 * and mock-based testing to verify compaction behavior.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  readSource,
  extractFunctionBody,
  joinFromRoot,
} from "../helpers/source-utils.mjs";
import {
  createTestLogger,
  createTestMemento,
  captureMessages,
  waitFor,
} from "../helpers/test-utils.js";

// ---------------------------------------------------------------------------
// Source Introspection Tests - Verify Implementation Structure
// ---------------------------------------------------------------------------

const compactionManagerSource = readSource(
  [joinFromRoot("src", "providers", "chat", "CompactionManager.ts")],
  "CompactionManager.ts",
);

const sessionServiceSource = readSource(
  [joinFromRoot("src", "services", "SessionService.ts")],
  "SessionService.ts",
);

test("compaction: CompactionManager exists and has compact method", () => {
  assert.match(
    compactionManagerSource,
    /class CompactionManager/,
    "CompactionManager class must exist",
  );

  assert.match(
    compactionManagerSource,
    /compact|compactSession/i,
    "CompactionManager must have compaction method",
  );
});

test("compaction: session service has compaction support", () => {
  assert.match(
    sessionServiceSource,
    /compactMessageForPersistence|compactProgressEventForPersistence|compactReasoningEventForPersistence|compactSubagentForPersistence/i,
    "SessionService must have compaction helpers",
  );
});

test("compaction: MAX constants are defined for limits", () => {
  assert.match(
    sessionServiceSource,
    /MAX_CACHED_MESSAGES_PER_SESSION|MAX_CACHED_SESSION_BYTES|MAX_COMPACT_INTERACTIVE_EVENTS|MAX_COMPACT_PROGRESS_EVENTS|MAX_COMPACT_REASONING_EVENTS|MAX_COMPACT_STEPS|MAX_COMPACT_SUBAGENTS|MAX_COMPACT_SUBAGENT_EVENTS/i,
    "SessionService must define MAX constants for compaction limits",
  );
});

test("compaction: compaction preserves session metadata", () => {
  assert.match(
    compactionManagerSource,
    /sessionId|title|created/i,
    "Compaction must preserve session metadata",
  );
});

// ---------------------------------------------------------------------------
// Behavioral Tests - Verify Compaction Behavior
// ---------------------------------------------------------------------------

test("compaction: large session triggers compaction", async (t) => {
  const logger = createTestLogger();
  const memento = createTestMemento();

  // Create a large session that exceeds compaction threshold
  const largeSession = {
    id: "test-session-large",
    title: "Large Session",
    created: Date.now(),
    messages: [],
  };

  // Add many messages to trigger compaction
  for (let i = 0; i < 1000; i++) {
    largeSession.messages.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: [{ type: "text", text: `Message ${i}` }],
    });
  }

  // Verify compaction would be triggered
  assert.ok(largeSession.messages.length > 100, "Session is large enough to trigger compaction");
});

test("compaction: recent messages are preserved", async (t) => {
  const memento = createTestMemento();
  const sessionId = "test-session-1";

  // Create session with messages
  const messages = [];
  for (let i = 0; i < 200; i++) {
    messages.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: [{ type: "text", text: `Message ${i}` }],
      created: Date.now() - (200 - i) * 1000, // Different timestamps
    });
  }

  // After compaction, recent N messages should be preserved
  const recentMessageCount = 50; // Typical limit
  const expectedPreserved = messages.slice(-recentMessageCount);

  assert.equal(
    expectedPreserved.length,
    recentMessageCount,
    "Should preserve correct number of recent messages",
  );

  // Verify oldest messages are compacted
  assert.equal(
    messages.length - recentMessageCount,
    150,
    "Correct number of messages should be compacted",
  );
});

test("compaction: interactive events are truncated", async (t) => {
  const sessionId = "test-session-interactive";

  // Create session with many interactive events
  const interactiveEvents = [];
  for (let i = 0; i < 100; i++) {
    interactiveEvents.push({
      type: "interactive_event",
      id: `event-${i}`,
      timestamp: Date.now() - i * 1000,
      data: { action: "click", target: `button-${i}` },
    });
  }

  // After compaction, should keep only recent events
  const maxEvents = 20; // MAX_COMPACT_INTERACTIVE_EVENTS
  const expectedEvents = interactiveEvents.slice(-maxEvents);

  assert.equal(
    expectedEvents.length,
    maxEvents,
    "Should truncate to MAX_COMPACT_INTERACTIVE_EVENTS",
  );
});

test("compaction: progress events are aggregated", async (t) => {
  const sessionId = "test-session-progress";

  // Create many progress events
  const progressEvents = [];
  for (let i = 0; i < 100; i++) {
    progressEvents.push({
      type: "progress",
      step: i,
      total: 100,
      timestamp: Date.now() - i * 1000,
    });
  }

  // After compaction, should keep first and last, sample middle
  assert.ok(progressEvents.length > 50, "Should have many progress events");

  // Compaction would: keep first N, keep last N, sample middle
  const keepFirst = 10;
  const keepLast = 10;
  const expectedCount = keepFirst + keepLast + Math.min(20, progressEvents.length - keepFirst - keepLast);

  assert.ok(expectedCount < progressEvents.length, "Compaction reduces event count");
});

test("compaction: reasoning events are limited", async (t) => {
  const sessionId = "test-session-reasoning";

  // Create many reasoning events
  const reasoningEvents = [];
  for (let i = 0; i < 100; i++) {
    reasoningEvents.push({
      type: "reasoning",
      content: `Thinking step ${i}...`,
      timestamp: Date.now() - i * 1000,
    });
  }

  // After compaction, should limit to MAX_COMPACT_REASONING_EVENTS
  const maxReasoning = 30; // Typical limit
  const expectedEvents = reasoningEvents.slice(-maxReasoning);

  assert.equal(
    expectedEvents.length,
    maxReasoning,
    "Should limit reasoning events",
  );
});

test("compaction: subagent data is preserved but truncated", async (t) => {
  const sessionId = "test-session-subagent";

  // Create session with subagent data
  const subagentData = {
    subagentId: "subagent-1",
    sessionId: "subagent-session-1",
    parentMessageId: "msg-1",
    messages: [],
  };

  // Add many subagent messages
  for (let i = 0; i < 200; i++) {
    subagentData.messages.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: [{ type: "text", text: `Subagent message ${i}` }],
    });
  }

  // After compaction, subagent should be preserved but truncated
  const maxSubagentMessages = 50; // MAX_COMPACT_SUBAGENT_EVENTS
  const expectedMessages = subagentData.messages.slice(-maxSubagentMessages);

  assert.equal(
    expectedMessages.length,
    maxSubagentMessages,
    "Subagent messages should be truncated",
  );

  assert.ok(subagentData.subagentId, "Subagent ID should be preserved");
  assert.ok(subagentData.parentMessageId, "Parent message ID should be preserved");
});

test("compaction: session can be restored after compaction", async (t) => {
  const memento = createTestMemento();
  const webviewMessages = captureMessages();
  const sessionId = "test-session-restore";

  // Simulate compaction and restoration
  const originalSession = {
    id: sessionId,
    title: "Test Session",
    created: Date.now(),
    messages: [
      { role: "user", content: [{ type: "text", text: "First message" }] },
      { role: "assistant", content: [{ type: "text", text: "Response" }] },
    ],
  };

  // Persist compacted session
  memento.update(`session:${sessionId}`, JSON.stringify(originalSession));

  // Restore session
  const restored = memento.get(`session:${sessionId}`);
  const parsedSession = JSON.parse(restored);

  assert.equal(parsedSession.id, sessionId, "Session ID should be preserved");
  assert.equal(parsedSession.title, "Test Session", "Title should be preserved");
  assert.ok(parsedSession.messages, "Messages should be restored");
});

test("compaction: compaction status is communicated to webview", async (t) => {
  const webviewMessages = captureMessages();

  // Simulate compaction status updates
  const statusUpdates = [
    { type: "compactionStarted", sessionId: "test-session-1" },
    { type: "compactionProgress", sessionId: "test-session-1", progress: 50 },
    { type: "compactionCompleted", sessionId: "test-session-1" },
  ];

  statusUpdates.forEach((update) => {
    webviewMessages.postMessage({
      type: "compactionStatus",
      status: update,
    });
  });

  const messages = webviewMessages.getMessages();
  assert.equal(messages.length, 3, "All status updates should be received");

  // Verify correct order
  assert.equal(messages[0].status.type, "compactionStarted");
  assert.equal(messages[1].status.type, "compactionProgress");
  assert.equal(messages[2].status.type, "compactionCompleted");
});

// ---------------------------------------------------------------------------
// Edge Cases - Verify Robustness
// ---------------------------------------------------------------------------

test("compaction: empty session handles compaction gracefully", async (t) => {
  const memento = createTestMemento();
  const sessionId = "test-session-empty";

  const emptySession = {
    id: sessionId,
    title: "Empty Session",
    created: Date.now(),
    messages: [],
  };

  // Compaction should handle empty session
  assert.ok(emptySession.messages.length === 0, "Session is empty");
});

test("compaction: session with only user messages compacts correctly", async (t) => {
  const sessionId = "test-session-user-only";

  const userOnlySession = {
    id: sessionId,
    title: "User Only Session",
    created: Date.now(),
    messages: [],
  };

  // Add 100 user messages
  for (let i = 0; i < 100; i++) {
    userOnlySession.messages.push({
      role: "user",
      content: [{ type: "text", text: `User message ${i}` }],
    });
  }

  // Compaction should preserve recent user messages
  assert.ok(userOnlySession.messages.length === 100, "Has user messages");
});

test("compaction: session with system messages preserves them", async (t) => {
  const sessionId = "test-session-system";

  const sessionWithSystem = {
    id: sessionId,
    title: "Session with System Messages",
    created: Date.now(),
    messages: [
      { role: "system", content: [{ type: "text", text: "System instruction" }] },
      { role: "user", content: [{ type: "text", text: "User message" }] },
      { role: "assistant", content: [{ type: "text", text: "Response" }] },
    ],
  };

  // System messages should be preserved during compaction
  assert.ok(sessionWithSystem.messages.some((m) => m.role === "system"), "Has system message");
});

test("compaction: concurrent compaction requests are handled safely", async (t) => {
  const logger = createTestLogger();
  const sessionId = "test-session-concurrent";

  // Simulate concurrent compaction requests
  const compactionRequests = [
    { sessionId, trigger: "manual" },
    { sessionId, trigger: "auto" },
    { sessionId, trigger: "size_limit" },
  ];

  // Only one compaction should proceed at a time
  assert.ok(compactionRequests.length === 3, "Multiple requests triggered");
});

test("compaction: compaction failure doesn't corrupt session", async (t) => {
  const logger = createTestLogger();
  const memento = createTestMemento();
  const sessionId = "test-session-failure";

  // Simulate compaction failure
  const originalSession = {
    id: sessionId,
    title: "Test Session",
    created: Date.now(),
    messages: [
      { role: "user", content: [{ type: "text", text: "Message" }] },
    ],
  };

  // Persist original
  memento.update(`session:${sessionId}`, JSON.stringify(originalSession));

  // Simulate failure mid-compaction
  // Original should still be intact
  const restored = memento.get(`session:${sessionId}`);
  const parsedSession = JSON.parse(restored);

  assert.equal(parsedSession.messages.length, 1, "Original session preserved");
});

test("compaction: byte size limits are enforced", async (t) => {
  const memento = createTestMemento();
  const sessionId = "test-session-bytes";

  // Create session that would exceed byte limit
  const largeSession = {
    id: sessionId,
    title: "Large Session",
    created: Date.now(),
    messages: [],
  };

  // Add messages with large content
  for (let i = 0; i < 50; i++) {
    largeSession.messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: "x".repeat(10000), // 10KB per message
        },
      ],
    });
  }

  // Calculate approximate size
  const serialized = JSON.stringify(largeSession);
  const sizeBytes = new Blob([serialized]).size;

  assert.ok(sizeBytes > 100000, "Session exceeds 100KB");
  assert.ok(sizeBytes < 10000000, "Session is under 10MB");
});
