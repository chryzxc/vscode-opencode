import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const handlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);
const source = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "subagents", "hydrationSource.ts")],
  "hydrationSource.ts",
);
const chatShellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);

test("chat-history subagent rendering derives from the raw SDK tape before legacy maps", () => {
  assert.match(source, /The raw SDK tape is authoritative/);
  assert.match(source, /const fromRaw = extractSubagentsFromCentralizedEvents/);
  assert.match(source, /return fromRaw/);
  assert.match(chatShellSource, /extractSubagentsFromCentralizedEvents\(messageEvents, messageId\)/);
});
