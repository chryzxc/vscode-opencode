import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const messageComponents = readSource("../../webview/shared/src/chat/MessageComponents.tsx");
const modal = readSource("../../webview/shared/src/chat/SubagentDetailModal.tsx");

test("finished assistant responses cancel only their own lingering activity rows", () => {
  assert.match(
    messageComponents,
    /function finishedAssistantResponseMessageIds\(payloads: unknown\[\]\): Set<string>/,
  );
  assert.match(
    messageComponents,
    /finishedResponseMessageIds\.has\(id\)/,
    "completion must be joined to the rendered response through its message ID",
  );
  assert.match(
    messageComponents,
    /parentResponseFinished && \(event\.status === "pending" \|\| event\.status === "running"\)[\s\S]*\? "cancelled"/,
    "stale activity rows must stop presenting as running after their parent response finishes",
  );
});

test("subagent cards and detail modal inherit parent-response cancellation", () => {
  assert.match(messageComponents, /resolveSubagentStatus\(subagent, detail, parentResponseFinished\)/);
  assert.match(messageComponents, /parentResponseFinished=\{isParentResponseFinished\}/);
  assert.match(modal, /parentResponseFinished && \(status === "running" \|\| status === "pending"\)/);
  assert.match(modal, /return "cancelled"/);
});
