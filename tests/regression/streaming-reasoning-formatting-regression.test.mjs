import assert from "node:assert/strict";
import test from "node:test";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("streaming reasoning UI prefers the merged reasoning buffer so markdown spacing survives tokenized stream chunks", () => {
  const body = extractFunctionBody(
    messageComponentsSource,
    "function thoughtItemsFromStreaming(",
  );
  assert.ok(body, "thoughtItemsFromStreaming must exist");
  assert.match(
    body,
    /const mergedReasoning = \(streaming\.reasoning \|\| ""\)\.trim\(\);[\s\S]*if \(mergedReasoning\.length > 0\)[\s\S]*stream-merged-reasoning[\s\S]*text:\s*mergedReasoning[\s\S]*streaming\.reasoningEvents/s,
    "live reasoning timeline should use the assembled streaming.reasoning text before falling back to per-event chunks",
  );
});
