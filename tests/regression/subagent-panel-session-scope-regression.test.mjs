import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("subagent panel session scope: AssistantMessage subagent list is gated by active session id", () => {
  assert.match(
    messageComponentsSource,
    /const activeSessionId = state\.currentSessionId;/,
    "assistant message should derive active session id before rendering subagents",
  );
  assert.match(
    messageComponentsSource,
    /return subagent\.parentSessionId === activeSessionId;/,
    "assistant message should only render subagents whose parentSessionId matches the active session",
  );
  assert.match(
    messageComponentsSource,
    /const activeScopedStore = scopedStore\.filter\(isInActiveSession\);/,
    "fallback scoped store rendering should keep active-session filtering",
  );
  assert.match(
    messageComponentsSource,
    /const activeMessageSubagents = messageSubagents\.filter\(isInActiveSession\);/,
    "message-attached fallback subagents should keep active-session filtering",
  );
});
