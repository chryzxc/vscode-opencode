import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const provider = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("session rehydration does not inject an extension-owned subagent projection", () => {
  assert.doesNotMatch(provider, /restorePersistedSubagentProjection/);
  assert.doesNotMatch(provider, /opencode\.session\.subagentProjection\./);
  assert.match(provider, /sessionSnapshotLoader\.loadMessagesOnly\(sessionId\)/);
});
