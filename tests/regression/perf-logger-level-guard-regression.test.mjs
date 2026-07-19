import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

/**
 * Regression target: `Logger.log()` unconditionally sanitized the context
 * object via `createPlainObjectSnapshot` (3 deep traversals: structuredClone
 * + JSON.stringify + JSON.parse) BEFORE the level check inside `output()`
 * dropped the entry. Every `logger.debug(...)` call on the stream hot path
 * paid full sanitization cost even when the configured level was `info`.
 *
 * With 79 logger.debug sites in providers and 15 in services — many gated
 * only by `shouldVerboseStreamDebug()` around the call, not around the
 * context object construction — this was the dominant remaining per-event
 * CPU cost after Fix 1.1.
 *
 * Contract: the level check must run BEFORE `sanitizeConsoleValue` does
 * any work. Filtered calls must not pay the sanitization cost.
 */

const loggerSource = readSource(
  [joinFromRoot("src", "utils", "Logger.ts")],
  "Logger.ts",
);

test("Logger.log checks level before sanitizing context", () => {
  const logBody = extractFunctionBody(loggerSource, "private log(");
  assert.ok(logBody.length > 0, "private log() body should be extractable");

  // Match the actual call (not the word in comments) so the assertion is
  // robust against perf-rationale comments that mention the helper by name.
  const sanitizeCallIdx = logBody.indexOf("this.sanitizeConsoleValue(");
  assert.ok(sanitizeCallIdx > -1, "log() should still call this.sanitizeConsoleValue(...) somewhere");

  const levelGateTokens = ["minLevel", "parseLogLevel", "wouldEmit", "shouldLog", "isLevelEnabled", "wouldOutput"];
  const gateIdx = levelGateTokens
    .map((tok) => logBody.indexOf(tok))
    .filter((idx) => idx > -1)
    .sort((a, b) => a - b)[0];

  assert.ok(
    gateIdx !== undefined && gateIdx > -1,
    "log() must perform a level gate (minLevel / parseLogLevel / wouldEmit / shouldLog) so filtered calls can short-circuit before sanitization",
  );

  assert.ok(
    gateIdx < sanitizeCallIdx,
    `level gate must appear BEFORE this.sanitizeConsoleValue(...) call (gate at ${gateIdx}, sanitize at ${sanitizeCallIdx})`,
  );
});

test("Logger exposes a level-guard helper usable before building context", () => {
  // After the fix, callers that build expensive context objects should be
  // able to ask the logger "would this level emit?" before constructing the
  // context. This is a defensive contract: the helper must exist so the
  // hot-path callers can short-circuit context construction entirely.
  assert.match(
    loggerSource,
    /(public|private)\s+(shouldLog|isLevelEnabled|wouldEmit|wouldOutput|isEnabledFor)\s*\(/,
    "Logger should expose a level-gate helper for hot-path callers",
  );
});
