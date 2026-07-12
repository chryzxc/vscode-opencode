import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const source = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("only completed subagents use a success checkmark", () => {
  const cardStart = source.indexOf('data-assistant-section="subagents-inline-card"');
  const cardSource = source.slice(cardStart);

  assert.match(cardSource, /resolvedStatus === "orphaned"[\s\S]*?<AlertCircle/);
  assert.match(cardSource, /resolvedStatus === "done"[\s\S]*?<Check/);
  assert.match(cardSource, /<Circle className="h-3 w-3 oc-text-secondary"/);
});
