import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const guardSource = readFileSync(
  new URL("../../scripts/streaming-contract-check.mjs", import.meta.url),
  "utf8",
);

test("streaming guard protects live, hydrated, structured, and activity rendering contracts", () => {
  const requiredTests = [
    "tests/regression/streaming-progress-regression.test.mjs",
    "tests/regression/streaming-state-preservation-regression.test.mjs",
    "tests/webview/live-progress-merge-regression.test.mjs",
    "tests/webview/live-stream-response-rendering.test.mjs",
    "tests/webview/streaming-ui-invariants.test.mjs",
    "tests/webview/streaming-transcript-handoff-regression.test.mjs",
    "tests/webview/structured-output-hydration-regression.test.mjs",
    "tests/webview/rehydrated-activity-output-regression.test.mjs",
    "tests/webview/activity-timeline-redundant-content-regression.test.mjs",
    "tests/integration/chat-flow-streaming-regression.test.mjs",
    "tests/providers/question-reply-agent-and-custom-answer.test.mjs",
    "tests/regression/chat-css-regression.test.mjs",
    "tests/unit/activity-timeline-collapse.test.mjs",
    "tests/regression/streaming-contract-guard-regression.test.mjs",
  ];

  for (const testPath of requiredTests) {
    assert.match(
      guardSource,
      new RegExp(testPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `streaming guard must execute ${testPath}`,
    );
  }
});

test("streaming guard covers chat rendering source changes", () => {
  assert.match(
    guardSource,
    /"webview\/shared\/src\/chat\/"/,
    "chat rendering changes must activate the streaming contract guard",
  );
  assert.match(
    guardSource,
    /"tests\/webview\/activity-timeline-redundant-content-regression\.test\.mjs"/,
    "activity rendering test changes must activate the streaming contract guard",
  );
  assert.match(
    guardSource,
    /"tests\/integration\/chat-flow-streaming-regression\.test\.mjs"/,
    "chat-flow integration changes must activate the streaming contract guard",
  );
});
