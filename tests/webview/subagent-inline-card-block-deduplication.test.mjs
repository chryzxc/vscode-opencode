import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("a contiguous assistant response block renders one shared subagent panel", () => {
  assert.match(
    source,
    /const shouldRenderSubagentsInlineCard = !message \|\| isLastInBlock !== false;/,
    "the live card or final visible response card must own the subagent panel",
  );
  assert.match(
    source,
    /\{shouldRenderSubagentsInlineCard && \(\s*<SubagentsInlineCard/s,
    "SubagentsInlineCard must be gated by the response-block ownership rule",
  );
});

test("the live card falls back to current-session subagent data when its stream phase id advances", () => {
  assert.match(
    source,
    /const liveSessionSubagents = useMemo\([\s\S]*?subagent\?\.parentSessionId === currentSessionId/,
    "the live card should retain current-session subagents across a tool-to-text phase id change",
  );
  assert.match(
    source,
    /!message && formattedSubagents\.length === 0[\s\S]*?liveSessionSubagents/,
    "the session fallback must be limited to the message-less streaming card",
  );
});
