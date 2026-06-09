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

test("canonicalizeMessagesForRender strips evt_ assistant messages when a non-evt assistant exists", () => {
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
    /return hasNonEvtAssistant[\s\S]*canonical\.filter[\s\S]*!isAssistantMessageForCanonical\(m\)[\s\S]*!\(typeof m\?\.info\?\.id === "string" && m\.info\.id\.startsWith\("evt_"\)\)[\s\S]*: canonical/,
    "when a non-evt assistant is present all evt_ assistant messages must be stripped from the canonical array",
  );
});

// ── visibleMessages render guard in ChatShell ───────────────────────

test("ChatShell visibleMessages guards evt_ removal with non-evt presence check", () => {
  assert.match(
    chatShellSource,
    /hasNonEvtAssistant[\s\S]*sliced\.slice[\s\S]*\.some[\s\S]*!\(typeof [^\n]*\?\.info\?\.id === "string"[^\n]*\.info\.id\.startsWith\("evt_"\)\)/,
    "visibleMessages must check whether any non-evt assistant exists in the current turn before stripping evt_ entries",
  );

  assert.match(
    chatShellSource,
    /if \(!hasNonEvtAssistant\)[\s\S]*return sliced/,
    "when only evt_ assistant messages exist they must be preserved as the visible content",
  );

  assert.match(
    chatShellSource,
    /return sliced\.filter[\s\S]*!\(typeof [^\n]*\?\.info\?\.id === "string"[^\n]*\.info\.id\.startsWith\("evt_"\)\)/,
    "when a non-evt assistant is present all evt_ entries must be stripped from visible messages",
  );
});
