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

test("webview config exposes a showLogger flag to control logger output", () => {
  assert.match(
    configSource,
    /showLogger\s*:\s*(true|false)/,
    "config should expose a showLogger flag",
  );
});

test("webview config exposes a showBrowserConsole flag to control all console output", () => {
  assert.match(
    configSource,
    /showBrowserConsole\s*:\s*(true|false)/,
    "config should expose a showBrowserConsole flag",
  );
});

test("webview logger respects the showLogger config flag", () => {
  assert.match(
    webviewLoggerSource,
    /config\.debug\.showLogger/,
    "webview logger should consult config.debug.showLogger",
  );
});

// message handler uses the central WebviewLogger singleton which respects showLogger internally
