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

const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
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
    /const showAssistantResponseHeader =\s*isBlockHeaderAnchor && \(hasPrimaryResponseBody \|\| blockSize > 1\);/,
    "assistant response header should render once for its designated response-block anchor",
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
  assert.match(
    chatShellSource,
    /const isBlockHeaderAnchor =\s*blockSize <= 1 \|\| \(isBlockExpanded \? isFirstInBlock : isLastInBlock\);/,
    "collapsed blocks should place the header on their visible summary card, while expanded blocks place it on the first card",
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
