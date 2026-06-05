import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const configSource = readSource(
  [joinFromRoot("webview", "shared", "src", "config.ts")],
  "config.ts",
);

const webviewLoggerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "logger.ts")],
  "logger.ts",
);

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("webview config exposes a debug flag to disable logs", () => {
  assert.match(
    configSource,
    /disableLogs\s*:\s*false/,
    "config should expose a disableLogs flag with logging enabled by default",
  );
});

test("webview logger respects the disableLogs config flag", () => {
  assert.match(
    webviewLoggerSource,
    /config\.debug\.disableLogs/,
    "webview logger should consult config.debug.disableLogs",
  );
});

test("message handler logger respects the disableLogs config flag", () => {
  assert.match(
    messageHandlerSource,
    /config\.debug\.disableLogs/,
    "message handler logger should consult config.debug.disableLogs",
  );
});
