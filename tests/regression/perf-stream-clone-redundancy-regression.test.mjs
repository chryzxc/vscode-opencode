import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

/**
 * Regression target: every SSE event was being deep-cloned up to 5 times
 * before reaching the webview:
 *   1. MessageStreamService.cloneRawEvent -> createPlainObjectSnapshot
 *        - structuredClone(value)        // pass 1
 *        - JSON.parse(JSON.stringify())  // pass 2 + pass 3
 *   2. ChatViewProvider.buildWebviewStreamEvent -> cloneAndTruncateStreamPayload
 *        // pass 4 (recursive)
 *   3. webview.postMessage structured-clone across IPC
 *        // pass 5
 *
 * The JSON round-trip inside createPlainObjectSnapshot is defensive
 * overkill for SDK SSE payloads (already JSON-serializable). Removing
 * it from the stream hot path eliminates ~2 of the 5 traversals.
 *
 * Contract: a fast variant must exist that returns structuredClone(value)
 * on the happy path; MessageStreamService must use it for raw-event
 * cloning. Fallbacks (JSON/manual) are allowed for the failure case.
 */

const snapshotSource = readSource(
  [joinFromRoot("src", "shared", "createPlainObjectSnapshot.ts")],
  "createPlainObjectSnapshot.ts",
);
const messageStreamServiceSource = readSource(
  [joinFromRoot("src", "services", "MessageStreamService.ts")],
  "MessageStreamService.ts",
);

test("createPlainObjectSnapshotFast happy path returns structuredClone(value) directly", () => {
  assert.match(
    snapshotSource,
    /export function createPlainObjectSnapshotFast\b/,
    "a fast clone variant should be exported for hot-path callers that do not need plain-JSON-safe output",
  );

  const fastBody = extractFunctionBody(
    snapshotSource,
    "export function createPlainObjectSnapshotFast<T>(",
  );
  assert.ok(fastBody.length > 0, "fast variant body should be extractable");

  assert.match(
    fastBody,
    /return structuredClone\(value\)/,
    "fast variant happy path must `return structuredClone(value)` directly (no JSON round-trip on the happy path)",
  );

  assert.match(
    fastBody,
    /catch|snapshotUnknown|JSON\.parse/,
    "fast variant must keep a fallback for the structuredClone-throws case (catch / snapshotUnknown / JSON.parse)",
  );
});

test("MessageStreamService uses the fast clone variant on the stream hot path", () => {
  assert.match(
    messageStreamServiceSource,
    /createPlainObjectSnapshotFast/,
    "MessageStreamService should import and use the fast clone variant",
  );

  const cloneRawEventBody = extractFunctionBody(
    messageStreamServiceSource,
    "private cloneRawEvent<T>(",
  );
  assert.ok(cloneRawEventBody.length > 0, "cloneRawEvent body should be extractable");
  assert.match(
    cloneRawEventBody,
    /createPlainObjectSnapshotFast/,
    "cloneRawEvent must delegate to createPlainObjectSnapshotFast",
  );
  assert.doesNotMatch(
    cloneRawEventBody,
    /\bcreatePlainObjectSnapshot\b(?!Fast)/,
    "cloneRawEvent must not call the slow createPlainObjectSnapshot variant",
  );
});
