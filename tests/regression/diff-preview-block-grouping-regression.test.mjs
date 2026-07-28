/**
 * Regression tests for diff preview rendering in AI response blocks.
 *
 * Guards the following behaviours introduced to fix diff-preview-not-showing:
 *   1. parseCentralizedSessionDiffEvent handles both session.diff AND
 *      message.updated events (previously only session.diff).
 *   2. Sync-wrapped events (syncEvent.data.info.summary.diffs) are correctly
 *      parsed via getCentralizedEventInfo / getCentralizedEventType.
 *   3. diffByBlockKey groups session.diff entries by block key so each
 *      AI response block shows only its own file-change summary.
 *   4. Normalized-event richness scoring gives +5 weight to events carrying
 *      info.summary.diffs so they survive deduplication.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFunctionBody,
  joinFromRoot,
  readSource,
} from "../helpers/source-utils.mjs";

const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

const diffPreviewStepSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "components", "activity-steps", "DiffPreviewStep.tsx")],
  "DiffPreviewStep.tsx",
);

const activityDiffExcerptSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "components", "ActivityDiffExcerpt.tsx")],
  "ActivityDiffExcerpt.tsx",
);

test("diff preview keeps the complete patch instead of applying a fixed line cap", () => {
  assert.match(
    diffPreviewStepSource,
    /const excerptLines = diffLines\.filter\(\(line, index\) => index !== firstHunkIndex\)/,
    "the parser should retain context and all later hunks",
  );
  assert.doesNotMatch(
    diffPreviewStepSource,
    /slice\(0,\s*40\)/,
    "the parser must not truncate patches at 40 lines",
  );
});

test("diff excerpt resets line numbering for every hunk header", () => {
  assert.match(
    activityDiffExcerptSource,
    /if \(line\.startsWith\("@@"\)\)[\s\S]*?parseHunkHeader\(line\)[\s\S]*?oldN = oldStart[\s\S]*?newN = newStart/s,
    "each hunk header should reset old and new line counters",
  );
});

// ── parseCentralizedSessionDiffEvent ─────────────────────────────────

test("parseCentralizedSessionDiffEvent handles both session.diff and message.updated event types", () => {
  const fnBody = extractFunctionBody(
    chatShellSource,
    "function parseCentralizedSessionDiffEvent(",
  );

  // Must use getCentralizedEventType (not firstNonEmptyString(event.type))
  // so sync-wrapped events (type:"sync" → syncEvent.type:"message.updated") resolve.
  assert.match(
    fnBody,
    /getCentralizedEventType\(event\)/,
    "must use getCentralizedEventType for sync-wrapper support",
  );

  // session.diff branch
  assert.match(
    fnBody,
    /eventType\s*===\s*"session\.diff"/,
    "must handle session.diff event type",
  );

  // message.updated branch
  assert.match(
    fnBody,
    /eventType\s*===\s*"message\.updated"/,
    "must handle message.updated event type",
  );

  // Must use getCentralizedEventInfo (not properties.info) for sync support
  assert.match(
    fnBody,
    /getCentralizedEventInfo\(event\)/,
    "must use getCentralizedEventInfo for sync-wrapper info extraction",
  );

  // summary.diffs extraction
  assert.match(
    fnBody,
    /summary\?\.diffs/,
    "must extract diffs from info.summary.diffs",
  );
});

test("parseCentralizedSessionDiffEvent reads session/event ID from syncEvent.data for sync-wrapped payloads", () => {
  const fnBody = extractFunctionBody(
    chatShellSource,
    "function parseCentralizedSessionDiffEvent(",
  );

  // resolveSessionId must check syncData.sessionID / syncData.sessionId
  assert.match(
    fnBody,
    /syncData\?\.sessionID/,
    "must resolve sessionId from syncEvent.data.sessionID for sync-wrapped events",
  );

  // syncData.diff for session.diff branch
  assert.match(
    fnBody,
    /syncData\?\.diff/,
    "session.diff branch must check syncEvent.data.diff for sync-wrapped events",
  );
});

// ── diffByBlockKey ──────────────────────────────────────────────────

test("diffByBlockKey groups session.diff entries by the preceding user message ID", () => {
  assert.match(
    chatShellSource,
    /const diffByBlockKey\s*=\s*useMemo/,
    "chat shell must define diffByBlockKey memo",
  );

  // currentBlockKey tracks the preceding user message
  assert.match(
    chatShellSource,
    /let currentBlockKey\s*=\s*"initial"/,
    "must track current block key from preceding user message",
  );

  // Maps session.diff entries to block key
  assert.match(
    chatShellSource,
    /e\.kind\s*===\s*"session\.diff"/,
    "must check for session.diff entries",
  );

  // Merges files when multiple diffs exist for the same block
  assert.match(
    chatShellSource,
    /\.\.\.existing\.files,\s*\.\.\.diff\.files/,
    "must merge files when multiple diffs belong to the same block",
  );
});

test("ResponseMessage receives centralizedDiffEvent only for isLastInBlock cards with a matching block key", () => {
  assert.match(
    chatShellSource,
    /centralizedDiffEvent=\{[\s\S]*?isLastInBlock/,
    "must gate centralizedDiffEvent on isLastInBlock",
  );

  assert.match(
    chatShellSource,
    /diffByBlockKey\.get\(blockGroupKey\)/,
    "must look up diff by blockGroupKey",
  );
});

// ── hasCentralizedSessionDiffEntries ───────────────────────────────

test("hasVisibleCentralizedSessionDiffEntries detects visible session.diff entries", () => {
  assert.match(
    chatShellSource,
    /const hasVisibleCentralizedSessionDiffEntries\s*=\s*useMemo\(\s*\(\) => visibleConversationEntries\.some\(\(entry\) => entry\.kind === "session\.diff"\)/,
    "visible transcript diff detection should use normalized session.diff entries from the raw SDK tape",
  );
});

// ── Richness scoring ───────────────────────────────────────────────

test("normalizedCentralizedEventRichness gives +5 weight to events with summary.diffs", () => {
  const fnBody = extractFunctionBody(
    messageHandlerSource,
    "function normalizedCentralizedEventRichness(",
  );

  // Must check info.summary.diffs
  assert.match(
    fnBody,
    /info\.summary/,
    "must check info.summary for diff data",
  );

  assert.match(
    fnBody,
    /summary\?\.diffs/,
    "must extract summary.diffs array",
  );

  // +5 score boost so events with diffs survive dedup
  assert.match(
    fnBody,
    /score\s*\+=\s*5/,
    "must add +5 richness for events carrying file-change diffs",
  );
});

// ── Processing gate ────────────────────────────────────────────────
// Historically the host side ran every centralized event through a
// `shouldBypassProcessingGate` filter that could drop message.updated /
// session.diff events before they reached the webview. That gate (and its
// bypass list) was removed in the UI/walkthrough refactor — those events now
// reach the webview unconditionally. Guard that property by ensuring the gate
// is not silently re-introduced, which would risk dropping diff-bearing events.

test("extension does not gate message.updated or session.diff events before they reach the webview", () => {
  const providerSource = readSource(
    [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
    "ChatViewProvider.ts",
  );

  assert.doesNotMatch(
    providerSource,
    /shouldBypassProcessingGate/,
    "must not re-introduce a processing gate that could drop message.updated/session.diff events",
  );
});

// ── SSE-stream diff capture fallback ───────────────────────────────

test("extension captures info.summary.diffs from message.updated SSE events for changeSummary fallback", () => {
  const providerSource = readSource(
    [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
    "ChatViewProvider.ts",
  );

  // Must check info.summary.diffs from message.updated events
  assert.match(
    providerSource,
    /info\?\.summary\?\.diffs/,
    "must capture info.summary.diffs from message.updated events",
  );

  // Must store captured diffs in sessionDiffFromStream
  assert.match(
    providerSource,
    /sessionDiffFromStream\.set/,
    "must cache captured diffs in sessionDiffFromStream",
  );

  // Fallback changeSummary from cached diffs
  assert.match(
    providerSource,
    /sessionDiffFromStream\.get/,
    "must use cached diffs as changeSummary fallback",
  );
});
