import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const handlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("a completed task-tool envelope does not replace a different streaming message", () => {
  assert.match(
    handlerSource,
    /replaceMatchingAssistantTurn\([\s\S]*?\.\.\.\(shouldDropMismatchedSnapshot\s*\? \[\]\s*:\s*\[streamingMessageId, snapshotMessageId\]\)/,
    "mismatched streaming IDs must not be candidates for replacing a completed SDK message",
  );
  assert.doesNotMatch(
    handlerSource,
    /replaceMatchingAssistantTurn\(currentMessages, sanitized, \[\s*finalMessageId,\s*responseMessageId,\s*streamingMessageId/,
    "the unconditional mixed-ID replacement path must not return",
  );
});

test("a distinct task-tool envelope does not finalize the active streaming card", () => {
  assert.match(
    handlerSource,
    /const snapshotStreaming = shouldDropMismatchedSnapshot\s*\? null\s*:\s*currentStreaming \?\? latestStreamingSnapshot/,
    "a mismatched task-tool result must not absorb the active stream's activity",
  );
  assert.match(
    handlerSource,
    /!shouldDropMismatchedSnapshot &&\s*\(hasOwnResponsePayload \|\| interactiveEventsInResponse\.length > 0\)/,
    "a mismatched task-tool result must not clear the unrelated active stream",
  );
});
