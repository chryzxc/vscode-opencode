import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const sessionService = readSource(
  [joinFromRoot("src", "services", "SessionService.ts")],
  "SessionService.ts",
);
const recovery = readSource(
  [joinFromRoot("src", "services", "subagents", "SubagentProjectionRecovery.ts")],
  "SubagentProjectionRecovery.ts",
);
const provider = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);
const card = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);

test("persisted live subagents become cancelled during extension-host recovery", () => {
  assert.match(sessionService, /cancelStaleSubagentsAfterExtensionRestart/);
  assert.match(sessionService, /recoverSubagentProjectionAfterRestart/);
  assert.match(recovery, /status !== "pending" && status !== "running" && status !== "orphaned"/);
  assert.match(recovery, /status: "cancelled"/);
  assert.match(provider, /cancelStaleSubagentsAfterExtensionRestart\(sessionId\)/);
});

test("cancelled is terminal in the inline subagent card", () => {
  assert.match(card, /detailStatus === "cancelled"/);
  assert.match(card, /subagent\.status === "cancelled"/);
});
