import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);

test("ChatShell routes large transcript rendering through a memoized transcript component", () => {
  assert.match(
    chatShellSource,
    /const MemoizedConversationTranscript = memo\(function ConversationTranscript\(/,
    "chat shell should isolate transcript rendering behind a memoized component so scroll-only state changes do not rebuild the full conversation tree",
  );
  assert.match(
    chatShellSource,
    /<MemoizedConversationTranscript[\s\S]*visibleConversationEntries=\{visibleConversationEntries\}/,
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
    /<MemoizedConversationTranscript[\s\S]*scrollViewport=\{scrollRenderViewport\}/,
    "chat shell should pass scroll viewport metrics into the transcript virtualizer",
  );
});
