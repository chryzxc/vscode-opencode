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
  assert.match(
    handlerSource,
    /function extractSubagentsFromMessages[\s\S]*?message\.subagents\s*\.map\(\(entry\)\s*=>\s*\{[\s\S]*?const rec = asRecord\(entry\);[\s\S]*?if \(rec && !asString\(rec\.parentMessageId\)\) \{[\s\S]*?rec\.parentMessageId = messageId;[\s\S]*?\}[\s\S]*?return normalizeSubagentDetail/,
    "extractSubagentsFromMessages should inject parentMessageId from message ID when missing on subagent entry",
  );
});

test("normalizeSubagentSummary still requires parentMessageId for validation", () => {
  assert.match(
    handlerSource,
    /function normalizeSubagentSummary[\s\S]*?if \(!id \|\| !parentSessionId \|\| !parentMessageId\)/,
    "normalizeSubagentSummary should continue to validate parentMessageId — the fix ensures it is always present",
  );
});

test("streaming path still uses messageId fallback pattern", () => {
  assert.match(
    handlerSource,
    /parentMessageId:\s*subagent\.parentMessageId\s*\|\|\s*messageId/,
    "streaming path should still use messageId fallback for parentMessageId",
  );
});
