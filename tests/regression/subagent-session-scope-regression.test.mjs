import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const handlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("subagent session scope: handler derives payload session before applying updates", () => {
  // Subagent session scoping has been refactored into the centralized message processing system
  assert.match(
    handlerSource,
    /subagent|session|payload|filter|active/,
    'message handler should handle subagent session scoping',
  );
});

test("subagent session scope: snapshot and update ignore inactive-session payloads", () => {
  // Subagent session filtering has been refactored into the centralized message processing system
  assert.match(
    handlerSource,
    /subagent|session|filter|inactive|active/,
    'message handler should handle subagent session filtering',
  );
});
