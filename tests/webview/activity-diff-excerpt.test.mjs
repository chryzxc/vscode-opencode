import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const activityDiffExcerptSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "components", "ActivityDiffExcerpt.tsx")],
  "ActivityDiffExcerpt.tsx",
);

test("ActivityDiffExcerpt parses hunk headers for line-number gutters", () => {
  assert.match(
    activityDiffExcerptSource,
    /function parseHunkHeader\(header: string\): \{ oldStart: number; newStart: number \}/,
    "ActivityDiffExcerpt should parse hunk headers for old/new line numbers",
  );
  assert.match(
    activityDiffExcerptSource,
    /function computeLineNumbers\(/,
    "ActivityDiffExcerpt should compute per-line gutter numbers for excerpts",
  );
});

test("ActivityDiffExcerpt renders unified diff rows with sign gutter and copy action", () => {
  assert.match(
    activityDiffExcerptSource,
    /isAdded\s*\?\s*"\+"\s*:\s*isRemoved\s*\?\s*"-"/,
    "ActivityDiffExcerpt should render +/- sign states in the sign gutter",
  );
  assert.match(
    activityDiffExcerptSource,
    /isHeader\s*\?\s*"\."\s*:\s*" "/,
    "ActivityDiffExcerpt should render sign gutter (+/-/header marker)",
  );
  assert.match(
    activityDiffExcerptSource,
    /navigator\.clipboard\.writeText\(/,
    "ActivityDiffExcerpt should support copying individual diff lines",
  );
  assert.match(
    activityDiffExcerptSource,
    /oldNum \?\? ""[\s\S]*newNum \?\? ""/s,
    "ActivityDiffExcerpt should render old/new line number columns",
  );
});
