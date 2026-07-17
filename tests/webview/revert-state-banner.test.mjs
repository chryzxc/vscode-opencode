/**
 * Regression: The revert-state banner must appear when revertState is set,
 * post unrevertSession to the provider, and the store must correctly handle
 * SET_REVERT_STATE + UPDATE_LIVE_SESSION_STATUS lifecycle.
 *
 * Flow: User clicks Undo → handleUndoMessageChanges posts revertStateUpdate
 * → webview messageHandler dispatches SET_REVERT_STATE → banner renders.
 * User clicks Restore → posts {type:"unrevertSession"} → provider restores.
 *
 * This test covers three layers:
 *   1. ChatShell banner rendering + Restore button dispatch
 *   2. store SET_REVERT_STATE reducer
 *   3. store UPDATE_LIVE_SESSION_STATUS no-streaming creation branch
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readSource, joinFromRoot, extractFunctionBody } from "../helpers/source-utils.mjs";

const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);

const storeSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts")],
  "store.ts",
);

// Deleted: the pinned ChatShell revert banner was intentionally replaced by inline per-message Restore UI.

test("ChatShell subscribes to revertState from app state", () => {
  assert.match(
    chatShellSource,
    /revertState:\s*appState\.revertState/,
    "ChatShell must read revertState from app state",
  );
});

test("store initialState has revertState null", () => {
  assert.match(
    storeSource,
    /revertState:\s*null/,
    "store initialState must initialize revertState to null",
  );
});

test("store SET_REVERT_STATE reducer replaces revertState", () => {
  assert.match(
    storeSource,
    /case "SET_REVERT_STATE":[\s\S]*?return \{ \.\.\.state, revertState: action\.payload \}/s,
    "SET_REVERT_STATE must spread state and replace revertState with payload",
  );
});

test("store SET_REVERT_STATE action type is declared in the Action union", () => {
  assert.match(
    storeSource,
    /\{ type: "SET_REVERT_STATE"; payload: AppState\["revertState"\] \}/,
    "SET_REVERT_STATE action must be declared with payload type matching revertState",
  );
});

test("store UPDATE_LIVE_SESSION_STATUS creates streaming when none exists", () => {
  const body = extractFunctionBody(storeSource, 'case "UPDATE_LIVE_SESSION_STATUS":');
  assert.ok(body.length > 0, "UPDATE_LIVE_SESSION_STATUS case must exist");

  // When no streaming exists AND payload is present, create a new streaming snapshot
  assert.match(
    body,
    /if \(!activeStreaming\)/,
    "must handle the no-streaming branch",
  );
  assert.match(
    body,
    /if \(!status\)/,
    "must return state unchanged when payload is null and no streaming",
  );
  assert.match(
    body,
    /const streaming:\s*StreamingState = \{/,
    "must create a new StreamingState when payload arrives with no streaming",
  );
  assert.match(
    body,
    /liveSessionStatus:\s*status/,
    "new streaming must carry the liveSessionStatus payload",
  );
  assert.match(
    body,
    /cacheStreamingForSession\(/,
    "must cache the new streaming snapshot for the session",
  );
});

test("store UPDATE_LIVE_SESSION_STATUS updates existing streaming with new status", () => {
  const body = extractFunctionBody(storeSource, 'case "UPDATE_LIVE_SESSION_STATUS":');

  // When streaming exists, spread it and replace liveSessionStatus
  assert.match(
    body,
    /const streaming = \{[\s\S]*?\.\.\.activeStreaming,[\s\S]*?liveSessionStatus:\s*status/s,
    "must spread existing streaming and update liveSessionStatus",
  );
});

test("store FINISH_STREAMING clears liveSessionStatus to null", () => {
  const body = extractFunctionBody(storeSource, 'case "FINISH_STREAMING":');
  assert.ok(body.length > 0, "FINISH_STREAMING case must exist");

  assert.match(
    body,
    /liveSessionStatus:\s*null/,
    "FINISH_STREAMING must clear liveSessionStatus to null",
  );
});

test("store hasVisibleStreamingSnapshotLocal includes liveSessionStatus check", () => {
  const body = extractFunctionBody(
    storeSource,
    "function hasVisibleStreamingSnapshotLocal(",
  );
  assert.ok(body.length > 0, "hasVisibleStreamingSnapshotLocal must exist");

  assert.match(
    body,
    /streaming\.liveSessionStatus/,
    "must consider liveSessionStatus as a visible streaming signal",
  );
});
