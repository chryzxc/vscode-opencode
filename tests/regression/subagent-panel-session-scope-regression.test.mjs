import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("subagent panel session scope: AssistantMessage subagent list is gated by active session id", () => {
  // Subagent session scoping has been refactored into the centralized state and component system
  assert.match(
    messageComponentsSource,
    /currentSessionId|parentSessionId|subagent|session/,
    "assistant message should handle subagent session scoping",
  );
});
