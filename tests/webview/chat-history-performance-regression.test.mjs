import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);
const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("ChatShell routes large transcript rendering through a memoized transcript component", () => {
  assert.match(
    chatShellSource,
    /const MemoizedConversationTranscript = memo\(function ConversationTranscript\(/,
    "chat shell should isolate transcript rendering behind a memoized component so scroll-only state changes do not rebuild the full conversation tree",
  );
  assert.match(
    chatShellSource,
    /<MemoizedConversationTranscript[\s\S]*visibleConversationEntries=\{(?:deferredVisibleConversationEntries|visibleConversationEntries)\}/,
    "chat shell should render centralized conversation entries through the memoized transcript component",
  );
  assert.match(
    chatShellSource,
    /contentVisibility:\s*"auto"/,
    "transcript entries should opt into browser-side offscreen rendering for long conversations",
  );
});

test("ChatShell bounds bootstrap cache persistence for large centralized transcripts", () => {
  assert.match(
    chatShellSource,
    /const WEBVIEW_BOOTSTRAP_MAX_EVENT_PAYLOADS = \d+;/,
    "chat shell should define a hard cap for cached centralized event payloads",
  );
  assert.match(
    chatShellSource,
    /function buildWebviewBootstrapSnapshot\(/,
    "chat shell should route bootstrap persistence through a dedicated snapshot helper",
  );
  assert.match(
    chatShellSource,
    /const currentSessionPayloads =[\s\S]*rawSdkEventPayloadsBySessionId:[\s\S]*\[currentSessionId\]: currentSessionPayloads\.slice\(-WEBVIEW_BOOTSTRAP_MAX_EVENT_PAYLOADS\)/s,
    "bootstrap snapshot should persist only the active session and only its most recent centralized payloads",
  );
});

test("ChatShell virtualizes very large conversation lists", () => {
  assert.match(
    chatShellSource,
    /const VIRTUALIZED_TRANSCRIPT_MIN_ENTRIES = \d+;/,
    "chat shell should define a threshold for activating transcript windowing",
  );
  assert.match(
    chatShellSource,
    /function buildVirtualizedConversationWindow\(/,
    "chat shell should compute a bounded transcript window for large conversations",
  );
  assert.match(
    chatShellSource,
    /const VIRTUALIZED_TRANSCRIPT_FALLBACK_VIEWPORT_PX = \d+;/,
    "chat shell should virtualize before the first measured scroll viewport is available",
  );
  assert.doesNotMatch(
    chatShellSource,
    /viewportHeight <= 0/,
    "large transcripts should not render the full list just because the first viewport measurement is pending",
  );
  assert.match(
    chatShellSource,
    /topPaddingHeight/,
    "virtualized transcript window should expose top spacer height",
  );
  assert.match(
    chatShellSource,
    /bottomPaddingHeight/,
    "virtualized transcript window should expose bottom spacer height",
  );
  assert.match(
    chatShellSource,
    /const transcriptScrollViewport =[\s\S]*deferredVisibleConversationEntries\.length >= VIRTUALIZED_TRANSCRIPT_MIN_ENTRIES[\s\S]*\? scrollRenderViewport[\s\S]*: STATIC_TRANSCRIPT_VIEWPORT/,
    "chat shell should avoid invalidating non-virtualized transcripts on every scroll frame",
  );
  assert.match(
    chatShellSource,
    /<MemoizedConversationTranscript[\s\S]*scrollViewport=\{transcriptScrollViewport\}/,
    "chat shell should pass the stabilized viewport into the transcript virtualizer",
  );
});

test("ChatShell isolates the transcript from token-by-token streaming objects", () => {
  assert.doesNotMatch(
    chatShellSource,
    /<MemoizedConversationTranscript[^>]*streaming=\{state\.streaming\}/s,
    "the memoized transcript should not receive the mutable streaming object",
  );
  assert.match(
    chatShellSource,
    /<MemoizedConversationTranscript[^>]*streamingAgent=\{(?:deferredStreamingAgent|state\.streaming\?\.agent)\}[^>]*isStreamingActive=\{Boolean\(state\.streaming\?\.isActive\)\}/s,
    "the transcript should receive only stable streaming scalars it actually consumes",
  );
  assert.match(
    chatShellSource,
    /if \(!streamViewport\.isFollowing && state\.streaming\?\.isActive\) \{[\s\S]*return;/,
    "centralized transcript projection should pause while the user scrolls through an active stream",
  );
  assert.doesNotMatch(
    chatShellSource,
    /streamingPresentationRef/,
    "the live response card must not freeze an old streaming snapshot while centralized events continue arriving",
  );
  assert.match(
    chatShellSource,
    /const presentedStreaming = state\.streaming;/,
    "the live response card should receive the current stream state on every accepted event",
  );
});

test("stream events do not echo raw payloads back across the webview IPC boundary", () => {
  assert.doesNotMatch(
    messageHandlerSource,
    /vscode\.postMessage\(\{\s*type: ["']persistRawSdkEventPayload["']/,
    "the extension host already persists stream events before forwarding them to the webview",
  );
});
