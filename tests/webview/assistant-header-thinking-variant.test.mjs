import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("assistant header renders thinking variant beside agent/model metadata", () => {
  assert.match(
    messageComponentsSource,
    /function getThinkingVariant\(/,
    "MessageComponents should expose helper to resolve thinking variant from streaming/message payloads",
  );
  assert.match(
    messageComponentsSource,
    /think \{thinkingVariant\}/,
    "assistant header should render thinking variant label",
  );
});

test("streaming and normalized messages persist thinking variant metadata", () => {
  assert.match(
    messageHandlerSource,
    /variant:\s*state\.thinkingLevel/,
    "streaming bootstrap should stamp current thinking level into streaming metadata",
  );
  assert.match(
    messageHandlerSource,
    /variant:\s*streaming\.variant/,
    "buildStreamingMessage should persist thinking variant into final message info",
  );
  assert.match(
    messageHandlerSource,
    /asString\(streaming\?\.variant\)/,
    "normalizeMessage should retain thinking variant from streaming state when final payload omits it",
  );
});

