import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sessionService = await readFile("src/services/SessionService.ts", "utf8");
const provider = await readFile("src/providers/ChatViewProvider.ts", "utf8");

test("session history uses the SDK without a blocking storage migration or fallback", () => {
  assert.doesNotMatch(sessionService, /\.migratePrefixes\(/);
  assert.match(sessionService, /client\.session\.list\(\)/);
  assert.match(sessionService, /client\.session\.messages\(/);
  const getMessages = sessionService.match(
    /async getMessages[\s\S]*?async getLatestContextInputTokens/,
  )?.[0] ?? "";
  assert.doesNotMatch(getMessages, /loadSessionMessages|saveSessionMessages|localMessages/);
});

test("hydration does not restore extension-owned subagent projections", () => {
  assert.doesNotMatch(provider, /restorePersistedSubagentProjection/);
  assert.doesNotMatch(provider, /getWorkspaceFileCache|subagentProjectionWrites/);
});
