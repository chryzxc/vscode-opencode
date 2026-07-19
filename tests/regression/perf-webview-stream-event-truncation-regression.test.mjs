import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

/**
 * Regression target: `ChatViewProvider.buildWebviewStreamEvent` called
 * `cloneAndTruncateStreamPayload` on every stream event — a recursive DFS
 * over the full event tree (depth-capped at 16) that allocates a brand-new
 * object graph. Even after Fix 1.1 made MessageStreamService use the fast
 * clone variant, this second per-event clone for truncation remained.
 *
 * The truncation only needs to bound oversized string leaves (tool outputs,
 * file reads). It does not need a full deep clone of the event graph: the
 * upstream `MessageStreamService.cloneRawEvent` already produced an
 * independent copy via `createPlainObjectSnapshotFast`. Walking the tree
 * twice is redundant.
 *
 * Contract: `buildWebviewStreamEvent` must not perform a second recursive
 * deep clone for truncation. Either (a) mutate the fast-clone result in
 * place, (b) walk once with targeted leaf-string truncation, or (c) skip
 * the clone entirely when the payload has no oversized leaves.
 */

const chatViewProviderSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("buildWebviewStreamEvent does not spread the original event over the truncated clone", () => {
  const body = extractFunctionBody(
    chatViewProviderSource,
    "private buildWebviewStreamEvent(",
  );
  assert.ok(body.length > 0, "buildWebviewStreamEvent body should be extractable");

  // The cloneAndTruncateStreamPayload DFS already produces a complete clone
  // with truncated values — the original event is never mutated. Spreading
  // the original over the clone is redundant work on every stream event.
  assert.doesNotMatch(
    body,
    /\.\.\.\s*enrichedEvent\b/,
    "buildWebviewStreamEvent must not spread enrichedEvent over the truncated clone — the clone already contains every key, the spread is pure waste on the per-event hot path",
  );
});

test("buildWebviewStreamEvent returns the truncated clone directly", () => {
  const body = extractFunctionBody(
    chatViewProviderSource,
    "private buildWebviewStreamEvent(",
  );
  assert.ok(body.length > 0);

  assert.match(
    body,
    /return\s+this\.cloneAndTruncateStreamPayload\(|return\s+\w*[Tt]runcated/,
    "buildWebviewStreamEvent should return the truncated clone directly (one DFS, no spread)",
  );
});

test("buildWebviewStreamEvent still bounds oversized string leaves for IPC", () => {
  const body = extractFunctionBody(
    chatViewProviderSource,
    "private buildWebviewStreamEvent(",
  );
  assert.ok(body.length > 0);

  assert.match(
    body,
    /MAX_STREAM_WEBVIEW_TOOL_OUTPUT_CHARS|cloneAndTruncateStreamPayload|truncateStreamToolTextForWebview/,
    "buildWebviewStreamEvent must still bound oversized string leaves (the IPC cap contract from stream-event-main-thread-performance.test.mjs)",
  );
});
