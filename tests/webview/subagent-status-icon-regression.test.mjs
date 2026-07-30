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

test("inline subagent rows contain long activity text", () => {
  const rowStart = source.indexOf('className={cn(\n                    "oc-subagent-row');
  const rowSource = source.slice(rowStart, rowStart + 5000);

  assert.match(
    rowSource,
    /oc-subagent-row w-full min-w-0 max-w-full overflow-hidden/,
    "the row must not widen its scroll container",
  );
  assert.match(
    rowSource,
    /min-h-\[12px\] min-w-0 max-w-full overflow-hidden[\s\S]*?className=\"block min-w-0 max-w-full truncate\"/,
    "the activity ticker must shrink and clip within the row",
  );
});
