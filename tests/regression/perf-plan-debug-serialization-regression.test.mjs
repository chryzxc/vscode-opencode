import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

/**
 * Regression target: ChatViewProvider had two `JSON.stringify` calls
 * inside `log.debug(...)` sites on the plan-update path:
 *
 *   log.debug('Plan object set on next', {
 *     ...
 *     fullPlanObject: next.plan ? JSON.stringify(next.plan, null, 2) : 'undefined'
 *   });
 *   const serialized = JSON.stringify(next);
 *   log.debug('Message serialization successful', { ... });
 *
 * Each plan-bearing event paid two full-message stringifications, which
 * were then sanitized AGAIN inside the logger. During plan generation
 * (which streams many plan-update events) this is a major cost.
 *
 * Contract: the per-event plan-update path must not do inline
 * `JSON.stringify(next)` / `JSON.stringify(next.plan, ...)` for debug
 * logging. Either drop the debug sites, or gate them behind a cheap
 * debug-flag check that runs before the stringify.
 */

const chatViewProviderSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("plan-update debug log sites do not stringify the entire next object inline", () => {
  // Find the plan-object debug log block and assert it doesn't stringify
  // the whole message object.
  const debugIdx = chatViewProviderSource.indexOf("'Plan object set on next'");
  assert.notEqual(debugIdx, -1, "expected to find the plan-object debug log site");

  // Window around the debug log call — generous to capture the surrounding
  // block but bounded so we don't accidentally match unrelated stringify.
  const window = chatViewProviderSource.slice(debugIdx, debugIdx + 1200);

  assert.doesNotMatch(
    window,
    /JSON\.stringify\(\s*next\s*[,)]/,
    "plan-update debug log must not JSON.stringify(next) inline — too expensive on per-event plan updates",
  );
  assert.doesNotMatch(
    window,
    /JSON\.stringify\(\s*next\.plan\b/,
    "plan-update debug log must not JSON.stringify(next.plan) inline — too expensive on per-event plan updates",
  );
});

test("any remaining plan-object debug stringify is gated behind a cheap debug-flag check", () => {
  // If the implementation keeps the stringify but gates it, the gate must
  // appear in the file. Acceptable gates: process.env check, dedicated
  // plan-debug flag, or a logger.isLevelEnabled-style helper.
  // Skip this assertion if no plan-object stringify exists at all.
  const hasPlanStringify = /JSON\.stringify\(\s*next\.plan\b/.test(chatViewProviderSource);
  if (!hasPlanStringify) {
    return;
  }

  // Find the plan-object debug block; verify a gate precedes it within 600 chars.
  const debugIdx = chatViewProviderSource.indexOf("'Plan object set on next'");
  const preceding = chatViewProviderSource.slice(Math.max(0, debugIdx - 600), debugIdx);
  assert.match(
    preceding,
    /process\.env\.|OPENCODE_DEBUG_PLANS|isPlanDebug|planDebugEnabled|shouldVerbosePlanDebug|isLevelEnabled|wouldEmit/,
    "plan-object stringify must be gated by a cheap debug-flag check that runs before the stringify runs",
  );
});
