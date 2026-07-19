import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

/**
 * Regression target: SubagentTracker used `while (...pending.shift())` loops
 * to find a binding candidate. Each `shift()` is O(q) on the underlying
 * array (it reallocates and reindexes), and the loop is O(q) iterations,
 * so worst-case total work is O(q²). When many subtasks bind near-
 * simultaneously (e.g. parallel subagent spawns) this manifests as a
 * noticeable hitch.
 *
 * Contract: pending-subtask drain loops must not use `.shift()`. They must
 * use index-based iteration that processes entries in place, then clears
 * the array in O(1) via `.length = 0` (or equivalent).
 */

const subagentTrackerSource = readSource(
  [joinFromRoot("src", "services", "SubagentTracker.ts")],
  "SubagentTracker.ts",
);

test("pending-subtask drain loops do not use .shift()", () => {
  // Strip line comments so perf-rationale comments mentioning the old
  // pattern don't trip the assertion.
  const stripped = subagentTrackerSource.replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(
    stripped,
    /pending\.shift\(\)/,
    "SubagentTracker must not use pending.shift() — it is O(n) per call and compounds to O(n²) inside drain loops",
  );
});

test("pending drain loops use index-based iteration", () => {
  // After the fix, drain loops iterate by index. Look for the two known
  // drain sites (each iterates pending[] by index and truncates in place).
  const stripped = subagentTrackerSource.replace(/\/\/[^\n]*/g, "");
  const drainPattern = /pending\.length\b/g;
  let match;
  let drainCount = 0;
  while ((match = drainPattern.exec(stripped)) !== null) {
    drainCount += 1;
  }
  // Pending is referenced in many places (sets, gets, length reads). What
  // we actually care about is that there's at least one for-loop iteration
  // pattern combined with an in-place truncation.
  assert.match(
    stripped,
    /for\s*\(\s*(let|const)\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*pending\.length/,
    "pending drain must use index-based for-loop iteration (not shift/while)",
  );
  assert.match(
    stripped,
    /pending\.length\s*=\s*\w+|pending\.splice\(/,
    "pending drain must truncate in place via pending.length = N or pending.splice",
  );
  // Sanity: pending.length references should still exist (the loop reads them).
  assert.ok(drainCount >= 2, "expected at least 2 pending.length references in drain paths");
});
