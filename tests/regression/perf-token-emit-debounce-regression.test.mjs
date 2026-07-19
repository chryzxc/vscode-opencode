import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

/**
 * Regression target: GeminiTokenUsageTracker.recordUsage() called
 * `this.emit("usageUpdated", this.getAllUsage())` on every token-bearing
 * stream event. getAllUsage() sorts ALL model entries on every call.
 *
 * During active streaming with frequent token updates, this triggered:
 *   - a full Object.values() + sort() on every token event
 *   - synchronous EventEmitter fan-out to every listener
 *
 * Contract: recordUsage must NOT synchronously emit a freshly-sorted array.
 * It must either (a) debounce the emit through a short timer, (b) emit a
 * lightweight "dirty" signal and let consumers read on demand, or
 * (c) remove the emit entirely if no consumers exist.
 *
 * This test stays implementation-agnostic: it only forbids the synchronous
 * sort+emit pattern in recordUsage.
 */

const geminiTrackerSource = readSource(
  [joinFromRoot("src", "services", "GeminiTokenUsageTracker.ts")],
  "GeminiTokenUsageTracker.ts",
);

test("recordUsage does not synchronously sort and emit on every token event", () => {
  const recordUsageBody = extractFunctionBody(
    geminiTrackerSource,
    "public recordUsage(",
  );
  assert.ok(recordUsageBody.length > 0, "recordUsage body should be extractable");

  assert.doesNotMatch(
    recordUsageBody,
    /this\.emit\(\s*["']usageUpdated["']\s*,\s*this\.getAllUsage\(\)\s*\)/,
    "recordUsage must not synchronously emit a freshly-sorted array on every token event (causes per-event sort + listener fan-out)",
  );

  assert.doesNotMatch(
    recordUsageBody,
    /this\.emit\(\s*["']usageUpdated["']\s*,\s*Object\.values\(/,
    "recordUsage must not synchronously emit Object.values() of currentUsage on every token event",
  );
});

test("GeminiTokenUsageTracker batches or defers usageUpdated emissions", () => {
  // After the fix, the emit must move out of the recordUsage hot path.
  // Acceptable shapes:
  //   - a dedicated debounce helper (scheduleUsageEmit / emitTimer / usageEmitHandle)
  //   - a "dirty" flag that a separate timer drains
  //   - removal of the emit entirely
  const hasBatchPattern = /scheduleUsageEmit|emitTimer|usageEmit|usageEmitHandle|scheduleUsageUpdated|emitUsage.*setTimeout|scheduleEmit/.test(
    geminiTrackerSource,
  );
  const hasNoEmit = !/\bon\(["']usageUpdated["']\)|emit\(["']usageUpdated["']/.test(
    geminiTrackerSource,
  );
  assert.ok(
    hasBatchPattern || hasNoEmit,
    "GeminiTokenUsageTracker must either batch usageUpdated emissions through a debounce helper or remove the emit entirely",
  );
});

test("sort/reduce work in getAllUsage and getGrandTotal is not on the recordUsage hot path", () => {
  // Defensive contract: even if a future change adds a new caller that
  // synchronously invokes getAllUsage, that path must not live inside
  // recordUsage. Re-assert by scanning recordUsage for sort/reduce calls
  // AND for getAllUsage calls (which itself calls .sort).
  const recordUsageBody = extractFunctionBody(
    geminiTrackerSource,
    "public recordUsage(",
  );
  assert.doesNotMatch(
    recordUsageBody,
    /\.sort\(/,
    "recordUsage must not call .sort() directly (sort belongs to read-side getAllUsage, not write-side recordUsage)",
  );
  assert.doesNotMatch(
    recordUsageBody,
    /this\.getAllUsage\(/,
    "recordUsage must not invoke getAllUsage() (which internally sorts) — sort work belongs to read-side consumers, not the write-side hot path",
  );
});
