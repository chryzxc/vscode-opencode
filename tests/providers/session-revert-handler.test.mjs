/**
 * Regression: handleUndoMessageChanges must extract revertState from the
 * server response and forward it to the webview so the revert banner can
 * be shown with the correct message/part identifiers.
 *
 * Bug: Previously, after a successful `client.session.revert` call, the
 * provider reloaded the session but never communicated the revert metadata
 * (messageID, partID, snapshot, diff) back to the webview. The user clicked
 * "Undo", the session reloaded, but no "Changes reverted — Restore" banner
 * appeared because the webview had no revertState to render.
 *
 * Fix: handleUndoMessageChanges now reads `result.data.revert`, builds a
 * revertState object {messageID, partID?, snapshot?, diff?}, and posts
 * {type:"revertStateUpdate", revertState} to the webview before reloading.
 *
 * The ThrowOnError=false pattern is also critical: HTTP errors land in
 * `result.error`, NOT in the catch block, so the handler must check
 * `result.error` explicitly before accessing `result.data`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readSource, joinFromRoot, extractFunctionBody } from "../helpers/source-utils.mjs";

const providerSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

function extractHandleUndoMessageChanges(source) {
  return extractFunctionBody(
    source,
    "private async handleUndoMessageChanges(",
  );
}

test("handleUndoMessageChanges calls client.session.revert with sessionID and messageID", () => {
  const body = extractHandleUndoMessageChanges(providerSource);
  assert.ok(body.length > 0, "handleUndoMessageChanges must exist");

  assert.match(
    body,
    /client\.session\.revert\(\{[\s\S]*?sessionID:\s*targetSessionId,[\s\S]*?messageID:\s*targetMessageId/s,
    "must call client.session.revert with both sessionID and messageID",
  );
});

test("handleUndoMessageChanges checks result.error before accessing result.data (ThrowOnError=false)", () => {
  const body = extractHandleUndoMessageChanges(providerSource);

  // The SDK defaults to ThrowOnError=false, so HTTP errors land in result.error
  // not in the catch block. The handler MUST check result.error first.
  assert.match(
    body,
    /revertResult as unknown as \{ error\?: unknown \}/,
    "must cast revertResult to check for error field",
  );

  assert.match(
    body,
    /if \(revertError\)/,
    "must branch on revertError presence before reading data",
  );

  assert.match(
    body,
    /showErrorMessage\([\s\S]*?Failed to undo changes:/s,
    "must show error message to user when server returns error",
  );
});

test("handleUndoMessageChanges extracts revertState from result.data.revert", () => {
  const body = extractHandleUndoMessageChanges(providerSource);

  // The server returns { data: { revert: { messageID, partID, snapshot, diff } } }
  assert.match(
    body,
    /\)\?\.data/,
    "must access revertResult.data for the response payload",
  );

  assert.match(
    body,
    /\?\.revert\s*\?\?\s*undefined/,
    "must read the revert field from session data",
  );

  assert.match(
    body,
    /revertField && typeof revertField === "object"/,
    "must validate revert field is an object before using it",
  );
});

test("handleUndoMessageChanges builds revertState with messageID fallback to targetMessageId", () => {
  const body = extractHandleUndoMessageChanges(providerSource);

  assert.match(
    body,
    /const revertState = revertRecord/,
    "must build revertState only when revertRecord exists",
  );

  assert.match(
    body,
    /messageID:\s*optionalStr\("messageID"\)\s*\?\?\s*targetMessageId/,
    "revertState.messageID must fall back to targetMessageId when server omits it",
  );

  assert.match(
    body,
    /partID:\s*optionalStr\("partID"\)/,
    "revertState must include optional partID",
  );

  assert.match(
    body,
    /snapshot:\s*optionalStr\("snapshot"\)/,
    "revertState must include optional snapshot",
  );

  assert.match(
    body,
    /diff:\s*optionalStr\("diff"\)/,
    "revertState must include optional diff",
  );
});

test("handleUndoMessageChanges posts revertStateUpdate to webview before reloading", () => {
  const body = extractHandleUndoMessageChanges(providerSource);

  assert.match(
    body,
    /postMessage\(\{[\s\S]*?type:\s*"revertStateUpdate"[\s\S]*?revertState[\s\S]*?\}\)/s,
    "must post revertStateUpdate message with revertState to webview",
  );

  // The postMessage MUST come BEFORE handleLoadSession so the banner is shown
  // immediately, not after the session reload finishes.
  const postMessageIndex = body.indexOf('type: "revertStateUpdate"');
  const loadSessionIndex = body.indexOf("handleLoadSession(");
  assert.ok(
    postMessageIndex > -1 && loadSessionIndex > postMessageIndex,
    "revertStateUpdate postMessage must occur before handleLoadSession reload",
  );
}

test("handleUndoMessageChanges reloads session and sessions list after revert", () => {
  const body = extractHandleUndoMessageChanges(providerSource);

  assert.match(
    body,
    /await this\.handleLoadSession\(targetSessionId\)/,
    "must reload the session after revert",
  );

  assert.match(
    body,
    /await this\.handleGetSessions\(\)/,
    "must refresh sessions list after revert",
  );
});

test("handleUndoMessageChanges shows warning when missing message or session identifier", () => {
  const body = extractHandleUndoMessageChanges(providerSource);

  assert.match(
    body,
    /if \(!targetMessageId \|\| !targetSessionId\)/,
    "must guard against missing message or session identifiers",
  );

  assert.match(
    body,
    /showWarningMessage\([\s\S]*?Unable to undo changes: missing message or session identifier/s,
    "must show warning message when identifiers are missing",
  );
});
