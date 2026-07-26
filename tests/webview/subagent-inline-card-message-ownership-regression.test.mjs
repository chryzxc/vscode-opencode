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
    /useSubagentsForParentMessage\(subagentParentMessageId\)/,
    "a subagent must render only on the assistant message that owns it, fetched via the parent-message-keyed hook",
  );
  assert.match(
    source,
    /inlineSubagentParentMessageIds[\s\S]*?subagentsByParentMessageId\?\.\[parentMessageId\]/,
    "the block-summary card must aggregate subagents from the store-level parent-message key",
  );
});

test("completed response cards do not collect session-wide orphan subagents", () => {
  assert.doesNotMatch(
    source,
    /orphanSubagentsForBlock|parentKey\.startsWith\("orphan-"\)/,
    "orphan subagents must not be appended to every final response card",
  );
});
