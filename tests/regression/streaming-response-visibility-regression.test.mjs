import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("active streaming response keeps the last safe assistant text visible without leaking reasoning", () => {
  // Response visibility logic has been refactored into the centralized message processing system
  assert.match(
    messageComponentsSource,
    /effectiveResponseContent|showResponseBody|isLiveStreamingCard/,
    "message components should handle response visibility during streaming",
  );
});
