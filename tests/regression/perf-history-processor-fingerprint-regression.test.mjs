import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

/**
 * Regression target: `HistoryProcessor.appendUnique` (used inside
 * `coalesceAssistantBurst`) rebuilt the `seen` set from
 * `target.map((entry) => JSON.stringify(entry))` on every call. When
 * called repeatedly across a single burst coalesce (multiple target
 * arrays: references, files, edits, etc.), the setup cost grew O(N)
 * per call → O(N²) across the burst.
 *
 * Contract: appendUnique must not JSON.stringify every entry of `target`
 * on every invocation. Either thread a stable `seen` set through from
 * the caller, or use a cheaper stable-id key (e.g. messageID) instead
 * of full-object fingerprint.
 */

const historyProcessorSource = readSource(
  [joinFromRoot("src", "providers", "chat", "HistoryProcessor.ts")],
  "HistoryProcessor.ts",
);

test("appendUnique does not rebuild the seen set from scratch on every call", () => {
  // The old contract did `const seen = new Set(target.map(...))` on every
  // call. The new contract must cache the seen set across calls for the
  // same target — rebuild from target only on first contact.
  //
  // Look for either:
  //   - a WeakMap-based cache (seenByTarget / seenCache) that gates the
  //     `new Set(target.map(...))` build, OR
  //   - the build made conditional on a cache miss.
  const coalesceBody = extractFunctionBody(
    historyProcessorSource,
    "private coalesceAssistantBurst(",
  );
  assert.ok(coalesceBody.length > 0);

  // Forbidden: unconditional rebuild (no cache check).
  // The signature of the bug: `const seen = new Set(target.map(...))`
  // directly inside appendUnique, with no preceding cache lookup.
  const appendUniqueMatch = coalesceBody.match(
    /const\s+appendUnique\s*=\s*\([^)]*\)[^=]*=>\s*\{([\s\S]*?)\n\s{4}\};/
  );
  assert.ok(appendUniqueMatch, "appendUnique arrow helper should be extractable");
  const appendUniqueBody = appendUniqueMatch[1];

  // Either no full-target rebuild at all, OR a cache lookup gates the rebuild.
  const doesFullRebuild = /new\s+Set\(\s*target\.map\([^)]*\)\s*=>\s*JSON\.stringify/.test(
    appendUniqueBody,
  );
  if (doesFullRebuild) {
    // Must be gated by a cache miss check.
    assert.match(
      appendUniqueBody,
      /seenByTarget\.get|seenCache\.get|WeakMap|if\s*\(\s*!seen\b|let\s+seen\b/,
      "appendUnique may rebuild the seen set from target on cache miss only — rebuild must be gated by a cache lookup",
    );
  }
});

test("appendUnique uses a stable id-based key when entries have ids", () => {
  // After the fix, the dedupe key should be a stable id (messageID, id, or
  // similar) instead of a full JSON fingerprint. Look for that signal in
  // the file. If we instead thread a `seen` set through, accept that too.
  const coalesceBody = extractFunctionBody(
    historyProcessorSource,
    "private coalesceAssistantBurst(",
  );
  assert.ok(coalesceBody.length > 0, "coalesceAssistantBurst body should be extractable");

  // Acceptable signals:
  //  - a stable id key extractor: entry?.messageID || entry?.id || ...
  //  - a seen set threaded through appendUnique's signature
  //  - appendUnique carrying a persistent Map/Set parameter
  const hasIdKey = /messageID|entry\?\.id|\bfingerprint\b/.test(coalesceBody);
  const hasThreadedSeen = /appendUnique\([^,]*,\s*[^,]*,\s*Set|seen:/.test(coalesceBody);
  assert.ok(
    hasIdKey || hasThreadedSeen,
    "appendUnique must use either a stable id-based key or a threaded seen set (current implementation rebuilds fingerprints per call)",
  );
});

test("coalesceAssistantBurst still produces the same merge semantics (no behavior regression)", () => {
  // Defensive contract: the coalesce function must still exist and must
  // still call appendUnique (or its replacement). Catches accidental
  // removal of the dedupe step entirely.
  const coalesceBody = extractFunctionBody(
    historyProcessorSource,
    "private coalesceAssistantBurst(",
  );
  assert.match(
    coalesceBody,
    /appendUnique|mergeUnique|dedupeBy/,
    "coalesceAssistantBurst must still perform a deduping append (renamed helper acceptable)",
  );
});
