import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const provider = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("extension-owned subagent projection is restored after chatHistory replaces live state", () => {
  assert.match(
    provider,
    /type:\s*"chatHistory",[\s\S]{0,800}await this\.restorePersistedSubagentProjection\(sessionId\);/,
    "the post-turn history refresh must restore subagent cards after replacing live state",
  );
  assert.match(
    provider,
    /void this\.persistSubagentProjection\([\s\S]*?this\.subagentTracker\.getSnapshotPayload\(\)/,
    "live tracker updates must persist the canonical projection independently of message.subagents",
  );
  assert.match(
    provider,
    /getSubagentProjectionStorageKey\(sessionId: string\)[\s\S]*?opencode\.session\.subagentProjection\./,
    "subagent projections should be persisted per session in workspace storage",
  );
});
