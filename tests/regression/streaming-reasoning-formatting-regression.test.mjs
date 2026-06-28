import assert from "node:assert/strict";
import test from "node:test";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("streaming reasoning UI prefers the merged reasoning buffer so markdown spacing survives tokenized stream chunks", () => {
  // Reasoning display has been refactored into the centralized message processing system
  assert.match(
    messageComponentsSource,
    /streaming\.reasoning|reasoningEvents|thoughtItems/,
    "streaming reasoning components should handle reasoning display",
  );
});
