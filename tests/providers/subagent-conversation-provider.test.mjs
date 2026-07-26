import test from "node:test";
import assert from "node:assert/strict";
import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const providerSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

const sessionHandlerSource = readSource(
  [joinFromRoot("src", "providers", "chat", "SessionHandler.ts")],
  "SessionHandler.ts",
);

test("provider handles getSubagentConversation command from webview", () => {
  assert.match(
    providerSource,
    /case\s+"getSubagentConversation"/,
    "ChatViewProvider should handle getSubagentConversation message type",
  );
  assert.match(
    providerSource,
    /handleGetSubagentConversation\(/,
    "ChatViewProvider should route command to handleGetSubagentConversation",
  );
});

test("provider hydrates subagent conversation from child session messages using history pipeline", () => {
  assert.match(
    providerSource,
    /private\s+async\s+handleGetSubagentConversation\(/,
    "ChatViewProvider should define handleGetSubagentConversation",
  );
  assert.match(
    providerSource,
    /sessionSnapshotLoader\.loadMessagesOnly\(childSessionId\)/,
    "Subagent conversation hydration should fetch child session messages via the snapshot loader",
  );
  assert.match(
    providerSource,
    /adaptSdkMessages\(sdkMessages\)/,
    "Subagent hydration should reuse adaptSdkMessages as the single source of truth for SDK message processing",
  );
  assert.match(
    providerSource,
    /buildAssistantConversationEvents\(/,
    "Provider should normalize assistant conversation events",
  );
  assert.match(
    providerSource,
    /type:\s*"subagentUpdate"/,
    "Provider should deliver hydrated conversation through subagentUpdate",
  );
  assert.match(
    providerSource,
    /conversationEvents/,
    "Subagent update payload should include conversationEvents",
  );
});

test("provider conversation event builder filters to assistant role only", () => {
  assert.match(
    providerSource,
    /private\s+buildAssistantConversationEvents\(/,
    "ChatViewProvider should define assistant conversation builder",
  );
  assert.match(
    providerSource,
    /if\s*\(\(role\s*\|\|\s*""\)\.toLowerCase\(\)\s*!==\s*"assistant"\)\s*\{\s*continue;\s*\}/,
    "Conversation builder must skip non-assistant roles",
  );
  assert.match(
    providerSource,
    /append\("assistant",\s*"message"/,
    "Conversation builder should append assistant message entries",
  );
});

test("sessions payload is top-level scoped and includes parentSessionId metadata", () => {
  assert.match(
    providerSource,
    /const\s+topLevelSessions\s*=\s*sessions\.filter\(/,
    "ChatViewProvider handleGetSessions should compute top-level sessions",
  );
  assert.match(
    providerSource,
    /Child sessions are detail-only subagent transcripts[\s\S]*?return false;/s,
    "Top-level filtering should always exclude child sessions, even orphaned ones",
  );
  assert.match(
    providerSource,
    /parentSessionId:\s*this\.firstNonEmptyString\(/,
    "Sessions payload should include parentSessionId for webview filtering and metadata",
  );
  assert.match(
    sessionHandlerSource,
    /const\s+topLevelSessions\s*=\s*sessions\.filter\(/,
    "SessionHandler should mirror top-level filtering behavior",
  );
});

