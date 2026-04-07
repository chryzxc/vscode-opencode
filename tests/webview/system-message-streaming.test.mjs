import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFunctionBody,
  joinFromRoot,
  readSource,
} from '../helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("system messages are added during streaming (not blocked by !current check)", () => {
  const partUpdatedBody = extractFunctionBody(
    messageHandlerSource,
    "case 'message.part.updated':",
  );

  // Verify that system messages are always added, regardless of streaming state
  assert.match(
    partUpdatedBody,
    /hasSystemMessagePatternInText\(partText\)/,
    "message.part.updated handler should check for system message patterns",
  );

  // Verify the system message is created with role: 'system'
  assert.match(
    partUpdatedBody,
    /role:\s*['"]system['"],/,
    "System message should have role set to 'system'",
  );

  // Verify SET_MESSAGES is dispatched with the system message
  assert.match(
    partUpdatedBody,
    /SET_MESSAGES/i,
    "Handler should dispatch SET_MESSAGES with system message added to existing messages",
  );

  // Critical: Verify there's NO `if \(!current\)` check before adding system messages
  // This was the bug - system messages were skipped during active streaming
  assert.doesNotMatch(
    partUpdatedBody,
    /if\s*\(\s*!\s*current\s*\)\s*\{[\s\S]*?role:\s*['"]system['"]/m,
    "System message creation should NOT be guarded by '!current' check (would block during streaming)",
  );
});

test("system message streaming does not interfere with streaming state", () => {
  const partUpdatedBody = extractFunctionBody(
    messageHandlerSource,
    "case 'message.part.updated':",
  );

  // Verify the handler safely processes system messages
  assert.match(
    partUpdatedBody,
    /hasSystemMessagePatternInText|systemMessage/i,
    "Handler should check for and handle system messages",
  );

  assert.match(
    partUpdatedBody,
    /role:\s*['"]system['"]/,
    "System messages should have correct role",
  );
});

test("system messages break out of processing after being added", () => {
  const partUpdatedBody = extractFunctionBody(
    messageHandlerSource,
    "case 'message.part.updated':",
  );

  // Verify that after adding a system message, we break (don't process as regular content)
  assert.match(
    partUpdatedBody,
    /break/i,
    "Should have break statement to exit processing after system message",
  );
});

test("system message detection uses hasSystemMessagePatternInText function", () => {
  const partUpdatedBody = extractFunctionBody(
    messageHandlerSource,
    "case 'message.part.updated':",
  );

  // Verify the pattern detection function is called
  assert.match(
    partUpdatedBody,
    /hasSystemMessagePatternInText|systemMessage/i,
    "Should use helper to detect system message patterns",
  );
});
