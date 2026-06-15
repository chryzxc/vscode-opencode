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

  assert.match(
    body,
    /const shouldTryTextMatch[\s\S]*!streamingMessageId[\s\S]*streamingMessageId\.startsWith\("evt_"\)/,
    "shouldTryTextMatch must expand the text-match path to cover evt_-prefixed IDs",
  );
});

test("mergeStreamingSnapshotIntoHistory latches evt_ entries onto the last non-evt assistant message in the same turn", () => {
  const body = extractFunctionBody(
    messageHandlerSource,
    "function mergeStreamingSnapshotIntoHistory(",
  );

  assert.match(
    body,
    /const isNonEvtCandidate[\s\S]*!candidateId\.startsWith\("evt_"\)[\s\S]*candidateIds\.unshift\(candidateId\)/,
    "non-evt candidates should be prepended to candidateIds so replaceMatchingAssistantTurn latches onto them before falling back to text match",
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
    /findLastIndex[\s\S]*!\(typeof m\?\.info\?\.id === "string" && m\.info\.id\.startsWith\("evt_"\)\)/,
    "coalesce should search for the last non-evt message and use it as the merge base",
  );

  assert.match(
    body,
    /preferredIdx >= 0 \? run\[preferredIdx\] : run\[run\.length - 1\]/,
    "when both evt_ and non-evt messages exist in the same run the non-evt entry must win as base",
  );
});

// ── canonicalizeMessagesForRender post-coalesce guard ───────────────

test("canonicalizeMessagesForRender preserves evt_ assistant messages when live preservation is enabled", () => {
  const body = extractFunctionBody(
    storeSource,
    "export function canonicalizeMessagesForRender(",
  );

  assert.match(
    body,
    /const hasNonEvtAssistant = canonical\.some[\s\S]*!\(typeof m\?\.info\?\.id === "string" && m\.info\.id\.startsWith\("evt_"\)\)/,
    "canonicalizeMessagesForRender must detect whether a non-evt assistant is present after coalescing",
  );

  assert.match(
    body,
    /return hasNonEvtAssistant && !options\?\.preserveEvtAssistantMessages[\s\S]*canonical\.filter[\s\S]*: canonical/,
    "canonicalizeMessagesForRender should keep evt_ assistant messages available when live preservation is enabled",
  );
});

// ── visibleMessages render guard in ChatShell ───────────────────────

test("ChatShell visibleMessages preserves evt_ entries while the assistant turn is still live", () => {
  assert.match(
    chatShellSource,
    /const hasEvtPrefix =[\s\S]*startsWith\("evt_"\)[\s\S]*const hasNonEvtAssistant = sliced\.slice[\s\S]*!hasEvtPrefix\(m\)/,
    "visibleMessages must check whether any non-evt assistant exists in the current turn before stripping evt_ entries",
  );

  assert.match(
    chatShellSource,
    /const shouldPreserveEvtAssistants =[\s\S]*state\.streaming\?\.isActive \|\| state\.assistantTurnPending/,
    "visibleMessages should preserve evt_ assistants while the turn is still active",
  );

  assert.match(
    chatShellSource,
    /if \(!hasNonEvtAssistant \|\| shouldPreserveEvtAssistants\)[\s\S]*return sliced[\s\S]*return sliced\.filter\(\(m\) => !hasEvtPrefix\(m\)\);/s,
    "evt_ entries should remain visible during live turns and only be stripped after the turn settles",
  );
});

test("messageResponse prefers canonical assistant ids before dropping mismatched snapshots", () => {
  assert.match(
    messageHandlerSource,
    /const responseMessageId = getMessageId\(msg\);/,
    "messageResponse should prefer the canonical helper instead of trusting a top-level evt_ id",
  );
  assert.match(
    messageHandlerSource,
    /const responseIsEvtLifecycle = isEvtLifecycleMessageId\([\s\S]*const snapshotIsCanonicalAssistant =[\s\S]*const shouldDropMismatchedSnapshot =[\s\S]*!\(responseIsEvtLifecycle && snapshotIsCanonicalAssistant\);/s,
    "messageResponse should preserve a canonical msg_ snapshot when the final payload only carries an evt_ lifecycle id",
  );
});

test("lifecycle message.updated cannot terminate an active canonical msg_ stream", () => {
  assert.match(
    messageHandlerSource,
    /const shouldTreatLifecycleUpdateAsTerminal =[\s\S]*!finish[\s\S]*\(!currentStreamingMessageId \|\|[\s\S]*currentStreamingIsEvtLifecycle[\s\S]*currentStreamingMessageId === messageId\)/s,
    "evt_ lifecycle updates should only finish streaming when the active snapshot is still evt_-owned or matches the same message id",
  );
});
