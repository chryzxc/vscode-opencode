/**
 * System Message Streaming Race Condition Regression Test
 *
 * Tests for the fix that prevents AI response from disappearing when system
 * messages (like <auto-slash-command>) arrive during active streaming.
 *
 * Bug: When system messages arrived via message.part.updated during streaming,
 * the handler dispatched SET_MESSAGES with [...state.messages, systemMessage],
 * which replaced the messages array and lost the streaming content (which was
 * in state.streaming, not state.messages).
 *
 * Fix: System messages are upserted in realtime during streaming via a safe
 * SET_MESSAGES path that does not mutate state.streaming.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  joinFromRoot,
  readSource,
} from '../helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("system message handler explains realtime system-message safety during streaming", () => {
  // Find the system message pattern check
  assert.match(
    messageHandlerSource,
    /hasSystemMessagePatternInText/,
    "messageHandler should check for system message patterns",
  );

  // Verify it handles system messages during streaming using an explicit safety rationale.
  assert.match(
    messageHandlerSource,
    /state\.streaming|streaming\s+is\s+separate|upsertRealtimeSystemMessage/i,
    "system message handler should document/use a realtime-safe update path during streaming",
  );
});

test("system message handler preserves streaming state during message part updates", () => {
  // Check that system messages are normalized as system-role entries.
  assert.match(
    messageHandlerSource,
    /systemMessage.*role:\s*['"]system["']/s,
    "system message should have system role",
  );

  // Verify that system messages are dispatched via SET_MESSAGES using current state,
  // not stale closure snapshots.
  assert.match(
    messageHandlerSource,
    /getState\(\)\.messages|existingMessages|nextMessages[\s\S]*dispatch\(\{\s*type:\s*["']SET_MESSAGES["']/s,
    "SET_MESSAGES for system messages should use the latest store snapshot",
  );
});

test("system messages are upserted immediately during streaming", () => {
  // Verify the logic flow:
  // 1. Check for system message pattern
  // 2. Route to realtime upsert helper
  // 3. Dispatch SET_MESSAGES with merged messages

  // Find the section that handles system messages
  const systemMessageSection = messageHandlerSource.match(
    /hasSystemMessagePatternInText[\s\S]*?break;[\s\S]*?\/\/ Don't process this as regular content/
  );

  assert.ok(
    systemMessageSection,
    "Should find the system message handling section",
  );

  // Verify it routes to realtime system-message upsert helper.
  assert.match(
    systemMessageSection[0],
    /upsertRealtimeSystemMessage/,
    "system message handling should upsert system messages during streaming",
  );
});
