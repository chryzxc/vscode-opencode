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
    /thinking|variant|level/,
    "should handle thinking variant metadata",
  );
  assert.match(
    messageComponentsSource,
    /const assistantHeaderAgentLabel = firstNonEmptyString\(agentName\)\?\.trim\(\) \|\| "assistant";/,
    "assistant response header should keep a visible fallback agent label instead of disappearing when metadata is partially missing",
  );
  assert.match(
    messageComponentsSource,
    /const showAssistantResponseHeader = hasPrimaryResponseBody;/,
    "assistant response header should render for every visible AI response block that has a primary response body",
  );
  assert.match(
    messageComponentsSource,
    /if \(assistantHeaderAgentLabel\) \{[\s\S]*key: "agent",[\s\S]*text: assistantHeaderAgentLabel,/s,
    "assistant response header should always emit a visible leading agent segment using the fallback-aware label",
  );
  assert.match(
    messageComponentsSource,
    /modelName !== "assistant" &&[\s\S]*modelName !== assistantHeaderAgentLabel/s,
    "assistant response header should avoid duplicating the fallback assistant label as both agent and model",
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
