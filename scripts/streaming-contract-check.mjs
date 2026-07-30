#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const mandatoryTests = [
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

const relevantPrefixes = [
  "scripts/streaming-contract-check.mjs",
  "webview/shared/src/chat/",
  "src/providers/chat/",
  "src/services/MessageStreamService.ts",
  "tests/regression/streaming-",
  "tests/webview/live-",
  "tests/webview/streaming-",
  "tests/webview/structured-output-",
  "tests/webview/rehydrated-activity-output-regression.test.mjs",
  "tests/webview/activity-timeline-redundant-content-regression.test.mjs",
  "tests/integration/chat-flow-streaming-regression.test.mjs",
  "tests/regression/streaming-contract-guard-regression.test.mjs",
  "tests/providers/question-reply-agent-and-custom-answer.test.mjs",
  "tests/regression/chat-css-regression.test.mjs",
  "tests/unit/activity-timeline-collapse.test.mjs",
  "skills/streaming-ui-debugger/",
];

function changedFilesFromWorktree() {
  const result = spawnSync("git", ["diff", "--name-only", "HEAD"], {
    encoding: "utf8",
  });
  return result.status === 0
    ? result.stdout
        .split(/\r?\n/)
        .map((file) => file.trim())
        .filter(Boolean)
    : [];
}

const changedFiles = (process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : changedFilesFromWorktree()
).map((file) => file.replace(/\\/g, "/"));
const isRelevant = changedFiles.some((file) =>
  relevantPrefixes.some((prefix) => file === prefix || file.startsWith(prefix)),
);

if (!isRelevant) {
  process.exit(0);
}

console.log("Streaming UI contract guard: running mandatory regression suite");
const result = spawnSync(process.execPath, ["--test", ...mandatoryTests], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
