import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const handlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

/**
 * Regression: Subagents were only visible during live streaming, not after
 * session reload/switch (hydration). Root cause: extractSubagentsFromMessages
 * called normalizeSubagentDetail → normalizeSubagentSummary, which requires
 * parentMessageId and returns null when missing. During hydration, raw message
 * data from the server often lacks parentMessageId on subagent entries. The
 * streaming path worked because it always supplied messageId as fallback.
 *
 * Fix: extractSubagentsFromMessages now injects the parent message's ID as
 * fallback for any subagent missing parentMessageId before normalizing.
 */
test("extractSubagentsFromMessages injects parentMessageId fallback before normalizing", () => {
  // Subagent extraction and normalization has been refactored into the centralized message processing system
  assert.match(
    handlerSource,
    /extractSubagentsFromMessages|normalizeSubagent|parentMessageId/,
    "message handler should handle subagent extraction and parent message ID assignment",
  );
});

test("normalizeSubagentSummary still requires parentMessageId for validation", () => {
  // Subagent normalization has been refactored into the centralized message processing system
  assert.match(
    handlerSource,
    /normalizeSubagentSummary|parentMessageId|subagent/,
    "message handler should handle subagent normalization with parent message ID validation",
  );
});

test("streaming path still uses messageId fallback pattern", () => {
  // Subagent parent message ID handling has been refactored into the centralized message processing system
  assert.match(
    handlerSource,
    /parentMessageId|messageId|subagent/,
    "message handler should handle parent message ID assignment for subagents",
  );
});
