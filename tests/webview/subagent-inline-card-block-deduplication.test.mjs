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

test("the live card scopes phase-advance fallback to the active assistant turn", () => {
  assert.match(
    source,
    /const liveSessionSubagents = useMemo\([\s\S]*?messages[\s\S]*?assistantTurnMessageId[\s\S]*?parentMessageId/s,
    "the live card fallback must derive subagent ownership from the active assistant turn",
  );
  assert.match(
    source,
    /const liveSessionParentMessageIds = new Set<string>\(\[[\s\S]*?subagentParentMessageId[\s\S]*?assistantTurnMessageId[\s\S]*?\]\)/s,
    "phase changes must retain the live and active-turn assistant IDs",
  );
  assert.match(
    source,
    /const activeAssistantIds = new Set\([\s\S]*?messages \?\? \[\][\s\S]*?role[\s\S]*?assistantTurnMessageId/s,
    "phase changes must derive additional assistant IDs from the active turn",
  );
  assert.doesNotMatch(
    source,
    /Object\.values\(subagentsByParentMessageId \?\? \{\}\)\s*\.flat\(\)\s*\.filter\(\(subagent\) => subagent\?\.parentSessionId === currentSessionId\)/s,
    "the live card must not fall back to every subagent in the session",
  );
});
