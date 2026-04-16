/**
 * Streaming State Preservation Regression Test
 *
 * Tests for the fix that prevents AI response content from disappearing when
 * quick input popovers (interactive events) are shown.
 *
 * Bug: The messageResponse handler always cleared the streaming state after
 * processing ANY messageResponse, even for system messages or other non-streaming
 * messages. This caused the streaming content to be lost when interactive events
 * appeared.
 *
 * Fix: Modified messageResponse handler to only clear streaming state if the
 * messageResponse being processed actually matches the current streaming message ID.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  joinFromRoot,
  readSource,
} from '../helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("messageResponse handler preserves streaming state for non-matching messages", () => {
  // Check that finalMessageId is declared
  assert.match(
    messageHandlerSource,
    /let\s+finalMessageId/,
    "messageResponse should declare finalMessageId",
  );

  // Check that streamingMessageId is declared
  assert.match(
    messageHandlerSource,
    /let\s+streamingMessageId/,
    "messageResponse should declare streamingMessageId",
  );

  // Check that streamingMessageId is captured
  assert.match(
    messageHandlerSource,
    /streamingMessageId\s*=/,
    "messageResponse should assign streamingMessageId",
  );
});

test("messageResponse handler only clears streaming state for matching message IDs", () => {
  // Check for the comment explaining the fix
  assert.match(
    messageHandlerSource,
    /Only clear streaming state if this messageResponse matches/,
    "messageResponse should have a comment explaining the streaming state preservation logic",
  );

  // Check for the matching logic
  assert.match(
    messageHandlerSource,
    /isMatchingStreamingMessage/,
    "messageResponse should check if the messageResponse matches the current streaming message ID",
  );

  // Check that latestStreamingSnapshot is only cleared conditionally
  assert.match(
    messageHandlerSource,
    /if\s*\(\s*isMatchingStreamingMessage/,
    "messageResponse should only clear latestStreamingSnapshot conditionally",
  );

  // Ensure streaming teardown actions are also scoped to the same guard.
  assert.match(
    messageHandlerSource,
    /if\s*\(\s*isMatchingStreamingMessage\s*\|\|\s*!currentStreaming\s*\)\s*\{[\s\S]*SET_STREAMING[\s\S]*SET_PROCESSING/s,
    "messageResponse should only clear streaming/processing inside the guarded block",
  );

  const messageResponseBlockMatch = messageHandlerSource.match(
    /case\s+"messageResponse"\s*:\s*\{[\s\S]*?break;\s*\}/,
  );
  assert.ok(messageResponseBlockMatch, "messageResponse case block should exist");
  const messageResponseBlock = messageResponseBlockMatch[0];
  assert.doesNotMatch(
    messageResponseBlock,
    /dispatch\(\{\s*type:\s*"SET_STREAMING",\s*payload:\s*null\s*\}\);\s*break;/,
    "messageResponse should not unconditionally clear streaming outside the guarded branch",
  );
});

test("messageResponse handler prevents clearing streaming state for system messages", () => {
  // The fix ensures that when a system message (like <auto-slash-command>) arrives
  // via messageResponse, it doesn't clear the streaming state for the actual AI response

  // Check that the logic compares message IDs
  assert.match(
    messageHandlerSource,
    /streamingMessageId\s*===\s*finalMessageId/,
    "isMatchingStreamingMessage should compare streaming and final message IDs",
  );

  // Verify that streaming state is not cleared if the message doesn't match
  assert.match(
    messageHandlerSource,
    /isMatchingStreamingMessage\s*\|\|\s*!currentStreaming/,
    "messageResponse should preserve streaming state when message IDs don't match",
  );
});

test("messageResponse handler captures streaming state before dispatching SET_MESSAGES", () => {
  // Check that currentStreaming is captured
  assert.match(
    messageHandlerSource,
    /const\s+currentStreaming/,
    "messageResponse should capture current streaming state",
  );

  // Check that snapshotStreaming is derived
  assert.match(
    messageHandlerSource,
    /snapshotStreaming/,
    "messageResponse should use snapshotStreaming",
  );

  // Check that latestStreamingSnapshot is referenced
  assert.match(
    messageHandlerSource,
    /latestStreamingSnapshot/,
    "messageResponse should reference latestStreamingSnapshot",
  );
});

test("chatHistory handler should not clear rendered messages during active-session processing updates", () => {
  assert.match(
    messageHandlerSource,
    /const isActiveSessionHydrationDuringProcessing =[\s\S]*currentState\.messages\.length > 0[\s\S]*currentState\.streaming/s,
    "chatHistory should detect active in-flight hydration updates for the current session",
  );
  assert.match(
    messageHandlerSource,
    /const shouldPreserveRenderedTimeline =[\s\S]*isActiveSessionHydrationDuringProcessing[\s\S]*hasPendingInteractiveInActiveSession[\s\S]*isAmbiguousSessionHydrationWithRenderedTimeline/s,
    "chatHistory should compute a preserve guard that covers active processing, interactive pauses, and ambiguous same-session hydration",
  );
  assert.match(
    messageHandlerSource,
    /if \(!shouldPreserveRenderedTimeline\) \{[\s\S]*SET_STREAMING[\s\S]*SET_PROCESSING/s,
    "chatHistory should only reset stream/loading state when hydration is safe to apply",
  );
  assert.match(
    messageHandlerSource,
    /if \(!shouldPreserveRenderedTimeline\) \{[\s\S]*SET_MESSAGES[\s\S]*\} else \{[\s\S]*stabilizedHydratedMessages = currentState\.messages;/s,
    "chatHistory should preserve currently rendered messages instead of replacing with stale snapshots mid-stream",
  );
  assert.doesNotMatch(
    messageHandlerSource,
    /case\s+"chatHistory"[\s\S]*dispatch\(\{\s*type:\s*"CLEAR_MESSAGES"\s*\}\)/s,
    "chatHistory should not hard-clear message list and cause render flicker",
  );
});

test("duplicate stream start events should not reset populated assistant streaming state", () => {
  assert.match(
    messageHandlerSource,
    /function hasVisibleStreamingPayload\(/,
    "message handler should define a visibility guard for populated streaming state",
  );
  assert.match(
    messageHandlerSource,
    /case 'start':[\s\S]*case 'streamStart':[\s\S]*duplicateStartForActiveStream[\s\S]*hasVisibleStreamingPayload\(latestStreaming\)[\s\S]*SET_STREAMING[\s\S]*\.\.\.latestStreaming/s,
    "start/streamStart should preserve existing populated stream snapshot instead of resetting to empty content",
  );
});
