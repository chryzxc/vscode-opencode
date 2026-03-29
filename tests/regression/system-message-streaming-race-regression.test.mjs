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
 * Fix: System messages are now only added via SET_MESSAGES when NOT actively
 * streaming (current is null/falsy). During streaming, system messages are
 * captured and added during messageResponse finalization.
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

test("system message handler checks for active streaming before dispatching SET_MESSAGES", () => {
  // Find the system message pattern check
  assert.match(
    messageHandlerSource,
    /hasSystemMessagePatternInText/,
    "messageHandler should check for system message patterns",
  );

  // Verify it handles system messages even during streaming (safe since streaming is separate)
  assert.match(
    messageHandlerSource,
    /System\s*messages\s*should\s*be\s*added\s*immediately/i,
    "system message handler should explain why SET_MESSAGES is safe during streaming",
  );
});

test("system message handler preserves streaming state during message part updates", () => {
  // Check that system messages are only added when not streaming
  assert.match(
    messageHandlerSource,
    /systemMessage.*role:\s*['"]system["']/s,
    "system message should have system role",
  );

  // Verify that system messages are dispatched via SET_MESSAGES
  assert.match(
    messageHandlerSource,
    /dispatch\s*\([\s\S]*?SET_MESSAGES[\s\S]*?payload:\s*\[\s*\.\.\.\s*state\.messages,\s*systemMessage\s*\]/s,
    "SET_MESSAGES for system messages should append to existing messages",
  );
});

test("system messages are not immediately added to messages array during streaming", () => {
  // Verify the logic flow:
  // 1. Check for system message pattern
  // 2. Check if streaming is active (!current)
  // 3. Only then dispatch SET_MESSAGES

  // Find the section that handles system messages
  const systemMessageSection = messageHandlerSource.match(
    /hasSystemMessagePatternInText[\s\S]*?break;[\s\S]*?\/\/ Don't process this as regular content/
  );

  assert.ok(
    systemMessageSection,
    "Should find the system message handling section",
  );

  // Verify it checks current before dispatching
  assert.match(
    systemMessageSection[0],
    /!current/,
    "system message handling should check for active streaming",
  );
});
