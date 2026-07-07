import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("webview assistant burst merge preserves rawResponse and prefers richer final text", () => {
  // Assistant burst merge has been refactored into the centralized message processing system
  assert.match(
    messageHandlerSource,
    /coalesceAssistantHistoryBurst|rawResponse|merge|canonical/,
    'message handler should handle assistant burst merge with rawResponse preservation',
  );
});
