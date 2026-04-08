import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const handlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("subagent session scope: handler derives payload session before applying updates", () => {
  assert.match(
    handlerSource,
    /function getSubagentPayloadSessionId\(/,
    "message handler should derive subagent payload session id",
  );
  assert.match(
    handlerSource,
    /function filterSubagentMapsForActiveSession\(/,
    "message handler should filter subagent maps for the active session",
  );
  assert.match(
    handlerSource,
    /const activeSessionId = state\.currentSessionId;/,
    "session filter should key off the currently active session in app state",
  );
  assert.match(
    handlerSource,
    /currentMessageIds\.has\(summary\.parentMessageId\)/,
    "session filter should preserve summaries bound to current-session message ids",
  );
  assert.match(
    handlerSource,
    /explicitSessionId === activeSessionId/,
    "session filter should preserve entries explicitly tagged with active parentSessionId",
  );
});

test("subagent session scope: snapshot and update ignore inactive-session payloads", () => {
  assert.match(
    handlerSource,
    /Ignoring subagentSnapshot payload for inactive session/,
    "subagentSnapshot should be ignored when payload session differs from active session",
  );
  assert.match(
    handlerSource,
    /Ignoring subagentUpdate payload for inactive session/,
    "subagentUpdate should be ignored when payload session differs from active session",
  );
  assert.match(
    handlerSource,
    /const scopedSnapshot = filterSubagentMapsForActiveSession\(/,
    "subagentSnapshot should scope payload maps before reducer updates",
  );
  assert.match(
    handlerSource,
    /const scopedUpdate = filterSubagentMapsForActiveSession\(/,
    "subagentUpdate should scope payload maps before reducer updates",
  );
  assert.match(
    handlerSource,
    /const hasScopedSubagents =[\s\S]*if \(!hasScopedSubagents\) \{\s*break;\s*\}/s,
    "subagentUpdate should no-op when scoped payload has no active-session rows",
  );
});
