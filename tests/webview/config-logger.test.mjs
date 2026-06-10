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

test("webview config exposes a showBrowserConsole flag to control all console output", () => {
  assert.match(
    configSource,
    /showBrowserConsole\s*:\s*(true|false)/,
    "config should expose a showBrowserConsole flag",
  );
});

test("webview logger uses a local showLogger boolean (set at runtime from VS Code setting)", () => {
  assert.match(
    webviewLoggerSource,
    /private showLogger: boolean = true/,
    "webview logger should have a local showLogger field defaulting to true",
  );
  assert.ok(
    webviewLoggerSource.includes("this.showLogger"),
    "webview logger should reference this.showLogger in shouldLog",
  );
});

test("message handler passes showLogger from initState to logger.setShowLogger", () => {
  assert.match(
    messageHandlerSource,
    /logger\.setShowLogger\(/,
    "message handler should call logger.setShowLogger with the value from initState",
  );
});
