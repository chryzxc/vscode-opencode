import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("pending TodoWrite activities do not render a nested loading component", () => {
  const todoWriteStep = messageComponentsSource.match(
    /function TodoWriteStep\([\s\S]*?\n\}/,
  )?.[0];

  assert.ok(todoWriteStep, "TodoWrite activity renderer should exist");
  assert.doesNotMatch(
    todoWriteStep,
    /Generating checklist|AIStatusTicker/,
    "the TodoWrite activity row is its own pending indicator and must not add a nested loading state",
  );
});
