import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

/**
 * Regression target: `SubagentTracker` used the call shape
 *
 *   detail.conversationEvents = clampEvents(
 *     [...detail.conversationEvents, normalizedEvent],
 *     MAX_CONVERSATION_EVENTS,
 *   );
 *
 * The `[...array, item]` spread allocates a brand-new array on every
 * append — even when the array is well under the cap, which is the common
 * case during streaming. With MAX_CONVERSATION_EVENTS=400 and events
 * arriving at 30-60/sec, this is hundreds of array allocations per second
 * per active subagent, plus GC pressure.
 *
 * Contract: append sites must not use `[...array, item]` spread before
 * clampEvents. The append must happen in place (push), and clampEvents
 * must trim only when over cap.
 */

const subagentTrackerSource = readSource(
  [joinFromRoot("src", "services", "SubagentTracker.ts")],
  "SubagentTracker.ts",
);

test("clampEvents call sites do not spread the array before append", () => {
  // Forbidden pattern: clampEvents([ ...array, item ], max)
  // The spread allocates per-call even when no clamp is needed.
  assert.doesNotMatch(
    subagentTrackerSource,
    /clampEvents\(\s*\[\s*\.\.\.[A-Za-z_.]+,\s*[A-Za-z_.]+\s*\]/,
    "clampEvents must not be called with `[...array, item]` spread — that allocates per-append even when under cap",
  );
});

test("SubagentTracker exposes an in-place append helper that bounds the array", () => {
  // After the fix, an in-place append helper should exist (e.g.
  // appendClamped, pushClamped, pushBounded) that pushes then trims only
  // if length exceeds the cap.
  assert.match(
    subagentTrackerSource,
    /function\s+(appendClamped|pushClamped|pushBounded|appendBounded)\s*[<(]/,
    "SubagentTracker should expose an in-place bounded-append helper so per-event appends don't allocate a new array",
  );
});

test("clampEvents remains a pure slice helper for overflow cases", () => {
  // The existing clampEvents function should remain available for the
  // post-push overflow trim (and for any external caller that needs a
  // pure slice). We're not removing clampEvents — we're removing the
  // spread before it.
  assert.match(
    subagentTrackerSource,
    /function\s+clampEvents\s*<[^>]*>\s*\(/,
    "clampEvents should still be declared as a generic helper",
  );
  const clampBody = subagentTrackerSource.match(/function\s+clampEvents[^{]*\{([\s\S]*?)\n\}/);
  assert.ok(clampBody, "clampEvents body should be extractable");
  assert.match(
    clampBody[1],
    /\.slice\(/,
    "clampEvents should still use .slice() for overflow trimming",
  );
});
