import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const streamingComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "StreamingComponents.tsx")],
  "StreamingComponents.tsx",
);

test("streaming card does not show an empty active shell before current-turn payload arrives", () => {
  assert.match(
    streamingComponentsSource,
    /function shouldShowStreamingCard/,
    "StreamingCard visibility should be centralized in a testable guard",
  );
  assert.match(
    streamingComponentsSource,
    /streaming\.hasRenderableContent\s*===\s*true[\s\S]*streaming\.content\.trim\(\)\.length\s*>\s*0/,
    "assistant text should be visible only after explicit renderable content arrives",
  );
  assert.doesNotMatch(
    streamingComponentsSource,
    /if\s*\(\s*streaming\.isActive\s*\)\s*\{\s*return\s+true;\s*\}/,
    "an active streaming flag alone must not render a response card with stale previous content",
  );
});
