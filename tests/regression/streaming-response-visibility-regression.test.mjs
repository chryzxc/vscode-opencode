import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("active streaming response keeps the last safe assistant text visible without leaking reasoning", () => {
  assert.match(
    messageComponentsSource,
    /const rawContent = getMessageContent\(message, streaming\);[\s\S]*const stickyStreamingContentRef = useRef<[\s\S]*const content =[\s\S]*stickyStreamingContentRef\.current\.content[\s\S]*rawContent;/s,
    "message component should retain the last safe streaming response body when live content is temporarily suppressed",
  );

  assert.match(
    messageComponentsSource,
    /if \(streaming\.isActive && hasReasoningEvents\) \{\s*return '';\s*\}/,
    "streaming response should still suppress raw content whenever reasoning events are active",
  );

  assert.match(
    messageComponentsSource,
    /if \(streaming\.isActive && hasPendingStreamingSteps\(streaming\)\) \{\s*return '';\s*\}/,
    "streaming response should still suppress raw content while pending steps are active",
  );

  assert.doesNotMatch(
    messageComponentsSource,
    /trimmedContent\.length === 0 &&\s*\(hasReasoningEvents \|\| hasPendingStreamingSteps\(streaming\)\)/,
    "the old direct-hide logic should be replaced by sticky safe-content fallback",
  );
});
