import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

/**
 * Regression target: `ChatViewProvider.buildWebviewStreamEvent` always
 * invokes `cloneAndTruncateStreamPayload` (a full recursive DFS) on every
 * stream event, even when no oversized string leaves are present. For
 * typical token-stream events (text deltas of a few hundred chars), the
 * DFS is pure overhead — the upstream `MessageStreamService.cloneRawEvent`
 * already produced an independent copy via `createPlainObjectSnapshotFast`.
 *
 * Contract: buildWebviewStreamEvent must short-circuit when no string
 * leaves exceed `MAX_STREAM_WEBVIEW_TOOL_OUTPUT_CHARS`. The fast path
 * returns the input directly. The slow path (full DFS) still runs when
 * an oversized leaf is detected.
 */

const chatViewProviderSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("buildWebviewStreamEvent exposes a fast path that skips the full DFS", () => {
  const body = extractFunctionBody(
    chatViewProviderSource,
    "private buildWebviewStreamEvent(",
  );
  assert.ok(body.length > 0, "buildWebviewStreamEvent body should be extractable");

  // Acceptable signals: a helper that pre-checks oversized leaves, OR an
  // explicit guard before invoking cloneAndTruncateStreamPayload.
  assert.match(
    body,
    /hasOversizedStringLeaf|hasOversizedLeaf|needsTruncation|requiresTruncation|anyLeafOversized|hasOversizedToolOutput/,
    "buildWebviewStreamEvent must expose a fast-path pre-check that detects whether any string leaf exceeds the IPC cap",
  );
});

test("buildWebviewStreamEvent returns the input directly on the fast path", () => {
  const body = extractFunctionBody(
    chatViewProviderSource,
    "private buildWebviewStreamEvent(",
  );
  assert.ok(body.length > 0);

  // The fast path must return the input directly (the upstream
  // cloneRawEvent already produced an independent copy). Look for an
  // early-return path before the recursive DFS.
  assert.match(
    body,
    /return\s+enrichedEvent/,
    "fast path must return the enrichedEvent directly (upstream already cloned)",
  );
});

test("buildWebviewStreamEvent still falls through to cloneAndTruncateStreamPayload when oversized leaves exist", () => {
  // The existing IPC cap contract must still hold when there are oversized
  // leaves. This guards against an over-aggressive fast path that skips
  // truncation entirely.
  const body = extractFunctionBody(
    chatViewProviderSource,
    "private buildWebviewStreamEvent(",
  );
  assert.match(
    body,
    /cloneAndTruncateStreamPayload/,
    "buildWebviewStreamEvent must still invoke cloneAndTruncateStreamPayload when oversized leaves are present",
  );
});
