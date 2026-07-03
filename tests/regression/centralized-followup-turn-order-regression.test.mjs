import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);

test("centralized transcript projection preserves raw-order for non-user entries while still pairing user turns with assistant siblings", () => {
  const body = extractFunctionBody(
    chatShellSource,
    "function buildCentralizedTranscriptProjection(",
  );

  assert.match(
    body,
    /const entriesByRawOrder = \[\.\.\.renderMessageEntries\]\.sort\(\(left, right\) => \{[\s\S]*left\.rawOrder - right\.rawOrder[\s\S]*left\.index - right\.index[\s\S]*\}\);/s,
    "projection should iterate render entries in centralized raw order",
  );
  assert.match(
    body,
    /for \(const entry of entriesByRawOrder\) \{[\s\S]*if \(entry\.role !== "user"\) \{[\s\S]*pushMessageEntry\(entry\);[\s\S]*continue;[\s\S]*\}[\s\S]*pushMessageEntry\(entry\);[\s\S]*assistantEntriesByUserPrimaryId/s,
    "projection should keep earlier non-user entries in-place instead of appending them after all user turns",
  );
  assert.doesNotMatch(
    body,
    /const remainingEntries = renderMessageEntries[\s\S]*for \(const entry of remainingEntries\) \{[\s\S]*pushMessageEntry\(entry\);/s,
    "projection should not append leftover entries after all user turns, which can move later follow-ups into the middle",
  );
});
