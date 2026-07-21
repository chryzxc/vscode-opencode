import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const provider = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("live subagent updates render without projection persistence", () => {
  assert.match(
    provider,
    /type:\s*"subagentUpdate",[\s\S]*?\.\.\.subagentUpdate/,
    "live SDK events must still be sent to the webview",
  );
  assert.doesNotMatch(
    provider,
    /persistSubagentProjection|scheduleSubagentProjectionPersist|subagentProjectionDebounceTimers/,
    "subagent stream events must not serialize extension-owned history",
  );
});
