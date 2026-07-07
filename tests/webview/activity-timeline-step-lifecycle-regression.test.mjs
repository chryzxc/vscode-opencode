import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("activity timeline no longer suppresses step-start and step-finish rows", () => {
  assert.doesNotMatch(
    messageComponentsSource,
    /normalizedLabel === "step-start" \|\| normalizedLabel === "step-finish"/,
    "step lifecycle rows should not be dropped from the activity timeline renderer",
  );
});
