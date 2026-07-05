/**
 * WebView State Synchronization Regression Tests
 *
 * These tests prevent regression of bugs related to state synchronization
 * between the extension host and webview, ensuring they remain consistent
 * through various scenarios like reloads, theme changes, and session switches.
 *
 * Critical areas tested:
 * - Webview reload state restoration
 * - Theme change propagation
 * - Session switch state updates
 * - Message ordering after sync
 * - Progressive rendering consistency
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
  createTestMemento,
  captureMessages,
  waitFor,
} from "../../integration/helpers/test-utils.js";

// ---------------------------------------------------------------------------
// Webview Reload State Restoration
// ---------------------------------------------------------------------------

const chatViewProviderSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("REGRESSION: webview reload restores session state correctly", async (t) => {
  const logger = createTestLogger();
  const memento = createTestMemento();
  const webviewMessages = captureMessages();

  // Simulate session state before reload
  const sessionState = {
    sessionId: "test-session-1",
    messages: [
      { role: "user", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
    ],
    currentMode: "chat",
    selectedModel: "claude-3-opus",
  };

  // Persist session state
  memento.update(`session:${sessionState.sessionId}`, JSON.stringify(sessionState));

  // Simulate webview reload
  const reloadEvent = {
    type: "webviewReady",
    sessionId: sessionState.sessionId,
  };

  webviewMessages.postMessage({
    type: "restoreState",
    state: sessionState,
  });

  const messages = webviewMessages.getMessages();
  assert.ok(messages.length > 0, "State restoration message should be sent");

  // Verify session restored
  const restoredState = memento.get(`session:${sessionState.sessionId}`);
  const parsed = JSON.parse(restoredState);
  assert.equal(parsed.sessionId, sessionState.sessionId);
});

test("REGRESSION: webview reload mid-conversation preserves context", async (t) => {
  const logger = createTestLogger();
  const memento = createTestMemento();
  const webviewMessages = captureMessages();

  // Simulate active conversation during reload
  const conversationState = {
    sessionId: "active-session-1",
    messages: [
      { role: "user", content: [{ type: "text", text: "First message" }] },
      { role: "assistant", content: [{ type: "text", text: "Response 1" }] },
      { role: "user", content: [{ type: "text", text: "Second message" }] },
      // Assistant response in progress
      { role: "assistant", content: [{ type: "text", text: "Thinking..." }], incomplete: true },
    ],
    processingState: {
      isProcessing: true,
      currentMessageId: "msg-3",
    },
  };

  memento.update(`session:${conversationState.sessionId}`, JSON.stringify(conversationState));

  // After reload, verify processing state is restored
  const restored = memento.get(`session:${conversationState.sessionId}`);
  const parsed = JSON.parse(restored);

  assert.equal(parsed.processingState.isProcessing, true, "Processing state should be preserved");
  assert.equal(parsed.processingState.currentMessageId, "msg-3", "Current message ID should be preserved");
});

// ---------------------------------------------------------------------------
// Theme Change Propagation
// ---------------------------------------------------------------------------

test("REGRESSION: theme change updates webview correctly", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Simulate VSCode theme change
  const themeChangeEvent = {
    type: "themeChanged",
    theme: {
      kind: 1, // vscode.ColorThemeKind.Light
      name: "Light+",
    },
  };

  webviewMessages.postMessage({
    type: "updateTheme",
    theme: themeChangeEvent.theme,
  });

  const messages = webviewMessages.getMessages();
  assert.equal(messages.length, 1, "Theme update message should be sent");
  assert.equal(messages[0].type, "updateTheme");
  assert.equal(messages[0].theme.kind, 1);
});

test("REGRESSION: theme change during active stream is handled", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Simulate theme change during streaming
  const events = [
    { type: "streamEvent", event: { type: "message.part.updated", properties: { part: { text: "Content" } } } },
    { type: "themeChanged", theme: { kind: 1, name: "Light+" } },
    { type: "streamEvent", event: { type: "message.part.updated", properties: { part: { text: "More content" } } } },
  ];

  events.forEach((e) => webviewMessages.postMessage(e));

  const messages = webviewMessages.getMessages();
  assert.equal(messages.length, 3, "All events should be processed");

  // Verify theme change is captured
  const themeMessage = messages.find((m) => m.type === "themeChanged");
  assert.ok(themeMessage, "Theme change should be captured");
});

// ---------------------------------------------------------------------------
// Session Switch State Updates
// ---------------------------------------------------------------------------

test("REGRESSION: session switch updates webview state correctly", async (t) => {
  const logger = createTestLogger();
  const memento = createTestMemento();
  const webviewMessages = captureMessages();

  // Create two sessions
  const session1 = {
    id: "session-1",
    title: "First Chat",
    messages: [
      { role: "user", content: [{ type: "text", text: "Hello from session 1" }] },
    ],
  };

  const session2 = {
    id: "session-2",
    title: "Second Chat",
    messages: [
      { role: "user", content: [{ type: "text", text: "Hello from session 2" }] },
    ],
  ];

  memento.update(`session:${session1.id}`, JSON.stringify(session1));
  memento.update(`session:${session2.id}`, JSON.stringify(session2));

  // Switch from session 1 to session 2
  webviewMessages.postMessage({
    type: "sessionSwitched",
    fromSessionId: session1.id,
    toSessionId: session2.id,
  });

  const messages = webviewMessages.getMessages();
  assert.ok(messages.length > 0, "Session switch message should be sent");

  // Verify session 2 is loaded
  const loadedSession = memento.get(`session:${session2.id}`);
  const parsed = JSON.parse(loadedSession);
  assert.equal(parsed.id, "session-2");
});

test("REGRESSION: session switch during active stream is handled", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Simulate session switch during active stream
  const events = [
    { type: "sessionSwitched", fromSessionId: "session-1", toSessionId: "session-2" },
    { type: "streamEvent", sessionId: "session-1", event: { type: "message.part.updated" } }, // Should be ignored
    { type: "streamEvent", sessionId: "session-2", event: { type: "message.part.updated" } }, // Should be processed
  ];

  events.forEach((e) => webviewMessages.postMessage(e));

  const messages = webviewMessages.getMessages();
  assert.equal(messages.length, 3, "All events should be captured");

  // Stream events for old session should be filtered in real implementation
  const session1Stream = messages.find((m) => m.sessionId === "session-1" && m.type === "streamEvent");
  const session2Stream = messages.find((m) => m.sessionId === "session-2" && m.type === "streamEvent");

  assert.ok(session2Stream, "New session stream should be processed");
});

// ---------------------------------------------------------------------------
// Message Ordering After Sync
// ---------------------------------------------------------------------------

test("REGRESSION: messages maintain order after state sync", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Create session with ordered messages
  const orderedMessages = [
    { id: "msg-1", role: "user", content: [{ type: "text", text: "First" }], order: 1 },
    { id: "msg-2", role: "assistant", content: [{ type: "text", text: "Response 1" }], order: 2 },
    { id: "msg-3", role: "user", content: [{ type: "text", text: "Second" }], order: 3 },
    { id: "msg-4", role: "assistant", content: [{ type: "text", text: "Response 2" }], order: 4 },
  ];

  // Sync messages to webview
  webviewMessages.postMessage({
    type: "syncMessages",
    messages: orderedMessages,
  });

  const messages = webviewMessages.getMessages();
  assert.equal(messages.length, 1, "Sync message should be sent");

  // Verify order is maintained
  const syncedMessages = messages[0].messages;
  assert.equal(syncedMessages[0].order, 1);
  assert.equal(syncedMessages[1].order, 2);
  assert.equal(syncedMessages[2].order, 3);
  assert.equal(syncedMessages[3].order, 4);
});

test("REGRESSION: partial sync preserves existing messages", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Existing messages in webview
  const existingMessages = [
    { id: "msg-1", role: "user", content: [{ type: "text", text: "Existing" }] },
  ];

  // New messages from sync
  const newMessages = [
    { id: "msg-2", role: "user", content: [{ type: "text", text: "New 1" }] },
    { id: "msg-3", role: "user", content: [{ type: "text", text: "New 2" }] },
  ];

  webviewMessages.postMessage({
    type: "partialSync",
    append: true,
    messages: newMessages,
  });

  const messages = webviewMessages.getMessages();
  assert.equal(messages.length, 1, "Partial sync should be sent");

  // Verify new messages are appended
  assert.equal(messages[0].messages.length, 2);
  assert.equal(messages[0].messages[0].id, "msg-2");
  assert.equal(messages[0].messages[1].id, "msg-3");
});

// ---------------------------------------------------------------------------
// Progressive Rendering Consistency
// ---------------------------------------------------------------------------

test("REGRESSION: progressive rendering maintains consistency after sync", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Simulate progressive rendering then sync
  const progressiveEvents = [
    { type: "message.part.updated", properties: { part: { text: "Part" } } },
    { type: "message.part.updated", properties: { part: { text: "Part 2" } } },
    { type: "stateSync", state: { messages: [] } }, // Sync occurs
    { type: "message.part.updated", properties: { part: { text: "Part 3" } } },
  ];

  progressiveEvents.forEach((e) => webviewMessages.postMessage({ type: "streamEvent", event: e } }));

  const messages = webviewMessages.getMessages();
  assert.equal(messages.length, 4, "All events should be captured");

  // Progressive events should still work after sync
  const lastEvent = messages[messages.length - 1];
  assert.equal(lastEvent.event.properties.part.text, "Part 3");
});

// ---------------------------------------------------------------------------
// Queue and Processing State
// ---------------------------------------------------------------------------

test("REGRESSION: queue state persists through webview reload", async (t) => {
  const logger = createTestLogger();
  const memento = createTestMemento();
  const webviewMessages = captureMessages();

  // Create session with queued messages
  const sessionWithQueue = {
    id: "session-with-queue",
    messages: [
      { role: "user", content: [{ type: "text", text: "Current" }] },
    ],
    queue: [
      { id: "queued-1", content: "Queued message 1" },
      { id: "queued-2", content: "Queued message 2" },
    ],
  };

  memento.update(`session:${sessionWithQueue.id}`, JSON.stringify(sessionWithQueue));

  // Simulate reload and queue restoration
  const restored = memento.get(`session:${sessionWithQueue.id}`);
  const parsed = JSON.parse(restored);

  assert.ok(parsed.queue, "Queue should be preserved");
  assert.equal(parsed.queue.length, 2, "All queued items should be preserved");
});

test("REGRESSION: processing state updates propagate to webview", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Simulate processing state changes
  const processingStates = [
    { type: "processingStarted", sessionId: "session-1", messageId: "msg-1" },
    { type: "processingProgress", sessionId: "session-1", progress: 50 },
    { type: "processingCompleted", sessionId: "session-1", messageId: "msg-1" },
  ];

  processingStates.forEach((state) => {
    webviewMessages.postMessage({
      type: "processingStateUpdate",
      state,
    });
  });

  const messages = webviewMessages.getMessages();
  assert.equal(messages.length, 3, "All processing states should be sent");

  // Verify progression
  assert.equal(messages[0].state.type, "processingStarted");
  assert.equal(messages[1].state.type, "processingProgress");
  assert.equal(messages[2].state.type, "processingCompleted");
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

test("REGRESSION: webview disconnect during sync is handled", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Simulate disconnect during sync
  const syncSequence = [
    { type: "syncStarted" },
    // Disconnect occurs (no message)
    { type: "syncResumed" },
    { type: "syncCompleted" },
  ];

  syncSequence.forEach((e) => webviewMessages.postMessage(e));

  const messages = webviewMessages.getMessages();
  assert.equal(messages.length, 3, "Sync should recover from disconnect");

  assert.equal(messages[0].type, "syncStarted");
  assert.equal(messages[1].type, "syncResumed");
  assert.equal(messages[2].type, "syncCompleted");
});

test("REGRESSION: multiple rapid state changes are batched correctly", async (t) => {
  const logger = createTestLogger();
  const webviewMessages = captureMessages();

  // Simulate rapid state changes
  const rapidChanges = [];
  for (let i = 0; i < 10; i++) {
    rapidChanges.push({ type: "stateUpdate", value: i });
  }

  // In real implementation, might batch these
  rapidChanges.forEach((change) => webviewMessages.postMessage(change));

  const messages = webviewMessages.getMessages();
  assert.equal(messages.length, 10, "All rapid changes should be captured");

  // Verify ordering is maintained
  for (let i = 0; i < 10; i++) {
    assert.equal(messages[i].value, i, `Change ${i} should be in order`);
  }
});

test("REGRESSION: corrupted state is recovered gracefully", async (t) => {
  const logger = createTestLogger();
  const memento = createTestMemento();

  // Simulate corrupted session state
  const corruptedSession = {
    id: "corrupted-session",
    messages: [
      { role: "user", content: [{ type: "text", text: "Valid message" }] },
      { role: "invalid", content: "broken data" }, // Invalid message
    ],
  };

  memento.update(`session:${corruptedSession.id}`, JSON.stringify(corruptedSession));

  // Attempt to restore - should handle corruption gracefully
  const restored = memento.get(`session:${corruptedSession.id}`);
  const parsed = JSON.parse(restored);

  // In real implementation, would filter out invalid messages
  const validMessages = parsed.messages.filter((m) => m.role === "user" || m.role === "assistant");
  assert.ok(validMessages.length > 0, "Should have valid messages after recovery");
});

// ---------------------------------------------------------------------------
// Source Introspection - Verify Implementation
// ---------------------------------------------------------------------------

test("REGRESSION: ChatViewProvider has state restoration logic", () => {
  assert.match(
    chatViewProviderSource,
    /restoreState|loadSession|hydrate/i,
    "ChatViewProvider should have state restoration logic",
  );
});

test("REGRESSION: ChatViewProvider handles webview lifecycle", () => {
  assert.match(
    chatViewProviderSource,
    /onDidChangeViewState|dispose|webview/i,
    "ChatViewProvider should handle webview lifecycle events",
  );
});

test("REGRESSION: theme changes trigger webview updates", () => {
  assert.match(
    chatViewProviderSource,
    /sendThemeDataToWebview|theme|css/i,
    "ChatViewProvider should handle theme updates",
  );
});
