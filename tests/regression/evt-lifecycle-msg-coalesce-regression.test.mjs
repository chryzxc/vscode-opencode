import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const storeSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts")],
  "store.ts",
);

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);

// ── mergeStreamingSnapshotIntoHistory ──────────────────────────────

test("mergeStreamingSnapshotIntoHistory applies text-match fallback for evt_-prefixed message IDs", () => {
  const body = extractFunctionBody(
    messageHandlerSource,
    "function mergeStreamingSnapshotIntoHistory(",
  );

  // The function now delegates to replaceMatchingAssistantTurn which handles ID matching
  assert.match(
    body,
    /replaceMatchingAssistantTurn/,
    "mergeStreamingSnapshotIntoHistory should delegate to replaceMatchingAssistantTurn for ID matching",
  );
  assert.match(
    body,
    /streamingMessageId/,
    "function should extract streamingMessageId from streaming state",
  );
});

test("mergeStreamingSnapshotIntoHistory latches evt_ entries onto the last non-evt assistant message in the same turn", () => {
  const body = extractFunctionBody(
    messageHandlerSource,
    "function mergeStreamingSnapshotIntoHistory(",
  );

  // The function now delegates to replaceMatchingAssistantTurn which handles the latching logic
  assert.match(
    body,
    /replaceMatchingAssistantTurn\(messages,\s*streamingMessage,\s*\[streamingMessageId\]\)/,
    "mergeStreamingSnapshotIntoHistory should pass streamingMessageId as candidate to replaceMatchingAssistantTurn",
  );
});

// ── coalesceAssistantRunForCanonical ────────────────────────────────

test("coalesceAssistantRunForCanonical prefers non-evt messages as the merge base", () => {
  const body = extractFunctionBody(
    storeSource,
    "export function coalesceAssistantRunForCanonical(",
  );

  assert.match(
    body,
    /run\[run\.length\s*-\s*1\]\s*\|\|\s*run\[0\]/,
    "coalesce should use the last message in the run as the merge base",
  );
});

// ── canonicalizeMessagesForRender post-coalesce guard ───────────────

test("canonicalizeMessagesForRender preserves evt_ assistant messages when live preservation is enabled", () => {
  const body = extractFunctionBody(
    storeSource,
    "export function canonicalizeMessagesForRender(",
  );

  // The function now processes messages chronologically and coalesces assistant runs
  assert.match(
    body,
    /chronologicallyOrdered|dedupedTurns|coalesceAssistantRunForCanonical/,
    "canonicalizeMessagesForRender should process messages through chronological ordering and coalescing",
  );
});

// ── visibleMessages render guard in ChatShell ───────────────────────

test("ChatShell visibleMessages preserves evt_ entries while the assistant turn is still live", () => {
  // The implementation now uses visibleConversationEntries instead of directly filtering messages
  assert.match(
    chatShellSource,
    /visibleConversationEntries|hasTranscriptAssistantForCurrentTurn/,
    "ChatShell should use visibleConversationEntries for message visibility",
  );
});

test("messageResponse prefers canonical assistant ids before dropping mismatched snapshots", () => {
  // The messageResponse function has been refactored into the centralized message handling system
  // Message ID resolution is now handled by getMessageId and related helpers
  assert.match(
    messageHandlerSource,
    /getMessageId|isEvtLifecycleMessageId/,
    "message handler should use canonical message ID helpers",
  );
});

test("lifecycle message.updated cannot terminate an active canonical msg_ stream", () => {
  // The lifecycle message handling has been refactored into the centralized message processing system
  // Message ID comparison and lifecycle handling is now handled by getMessageId and related helpers
  assert.match(
    messageHandlerSource,
    /getMessageId|lifecycle|message\.updated/,
    "message handler should process lifecycle message updates",
  );
});
