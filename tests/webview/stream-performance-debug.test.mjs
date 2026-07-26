import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const providerSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);
const loggerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "logger.ts")],
  "logger.ts",
);
const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("stream-performance diagnostics are always available during investigation", () => {
  assert.doesNotMatch(providerSource, /isStreamPerformanceDebugEnabled/);
  assert.doesNotMatch(messageHandlerSource, /setStreamPerformanceDebug/);
  assert.doesNotMatch(loggerSource, /streamPerformanceDebug/);
});

test("performance logs are sampled and cover host, event batch, and scroll phases", () => {
  assert.match(loggerSource, /now - previous < 2_000/);
  assert.match(messageHandlerSource, /streamPerformance\("stream-event-batch"/);
  assert.match(providerSource, /logStreamPerformance\("provider-webview-event"/);
  assert.match(
    readSource([joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")], "ChatShell.tsx"),
    /streamPerformance\("scroll-input"/,
  );
});
