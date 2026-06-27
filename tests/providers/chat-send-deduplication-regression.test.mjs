import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFunctionBody,
  joinFromRoot,
  readAllSources,
  readSource,
} from "../helpers/source-utils.mjs";

const source = readAllSources(
  [
    joinFromRoot("src", "providers", "ChatViewProvider.ts"),
    joinFromRoot("src", "providers", "chat", "HistoryProcessor.ts"),
    joinFromRoot("src", "providers", "chat", "StructuredOutputProcessor.ts"),
    joinFromRoot("src", "providers", "chat", "PlanManager.ts"),
    joinFromRoot("src", "providers", "chat", "SubagentPersistence.ts"),
    joinFromRoot("src", "providers", "chat", "CompactionManager.ts"),
    joinFromRoot("src", "providers", "chat", "DiagnosticsLogger.ts"),
    joinFromRoot("src", "providers", "chat", "QueueManager.ts"),
    joinFromRoot("src", "providers", "chat", "StreamEventHandler.ts"),
    joinFromRoot("src", "providers", "chat", "ModelAndAgentManager.ts"),
    joinFromRoot("src", "providers", "chat", "SessionHandler.ts"),
  ],
  "ChatViewProvider.ts",
);
const panelComponentsSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "PanelComponents.tsx")],
  "PanelComponents.tsx",
);

test("schedulePromptDispatch suppresses duplicate send-now payloads before they queue", () => {
  const body = extractFunctionBody(source, "  private async schedulePromptDispatch(");

  assert.match(
    source,
    /private recentPromptDispatch\?:/,
    "ChatViewProvider should track the last send-now prompt signature",
  );
  assert.match(
    body,
    /if \(mode === "send-now"\) \{[\s\S]*const dedupeWindowMs = 1500;[\s\S]*this\.recentPromptDispatch[\s\S]*Ignoring duplicate send-now prompt dispatch[\s\S]*return;[\s\S]*this\.recentPromptDispatch = \{/,
    "schedulePromptDispatch should ignore repeated send-now payloads inside a short dedupe window",
  );
  assert.match(
    source,
    /private readonly seenClientRequestIds = new Map<string, number>\(\);/,
    "ChatViewProvider should track durable client request ids across queue and direct dispatch",
  );
  assert.match(
    body,
    /const clientRequestId =[\s\S]*payload\.clientRequestId[\s\S]*if \(clientRequestId && this\.hasSeenClientRequest\(sessionId, clientRequestId\)\) \{[\s\S]*Ignoring duplicate client request dispatch[\s\S]*return;[\s\S]*if \(clientRequestId\) \{[\s\S]*this\.rememberClientRequest\(sessionId, clientRequestId\);/s,
    "schedulePromptDispatch should drop replayed sends that reuse the same client request id",
  );
  assert.match(
    body,
    /const prompt: QueuedPrompt = \{[\s\S]*clientRequestId: clientRequestId \|\| undefined,/s,
    "queued prompts should preserve the originating client request id",
  );
});

test("webview send actions include a stable client request id", () => {
  assert.match(
    panelComponentsSource,
    /const clientRequestId =[\s\S]*crypto\.randomUUID[\s\S]*vscode\.postMessage\(\{[\s\S]*type: "sendMessage",[\s\S]*clientRequestId,/s,
    "direct webview sends should include a client request id",
  );
  assert.match(
    panelComponentsSource,
    /vscode\.postMessage\(\{[\s\S]*type: "addToQueue",[\s\S]*clientRequestId,/s,
    "queued webview sends should preserve the same client request id contract",
  );
});
