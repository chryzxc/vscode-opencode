import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("inline subagent cards require exact parent message ownership", () => {
  assert.match(
    source,
    /return Boolean\(messageId\) && subagent\.parentMessageId === messageId;/,
    "a subagent must only render on the assistant message that owns it",
  );
});

test("completed response cards do not collect session-wide orphan subagents", () => {
  assert.doesNotMatch(
    source,
    /orphanSubagentsForBlock|parentKey\.startsWith\("orphan-"\)/,
    "orphan subagents must not be appended to every final response card",
  );
});
