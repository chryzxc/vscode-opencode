import test from "node:test";
import assert from "node:assert/strict";
import { extractFunctionBody, joinFromRoot, readAllSources, readSource } from '../helpers/source-utils.mjs';

// Load ChatViewProvider source to test the fix
const chatViewProviderSource = readAllSources(
  [
    joinFromRoot("src", "providers", "ChatViewProvider.ts"),
    joinFromRoot("src", "providers", "chat", "HistoryProcessor.ts"),
  ],
  "ChatViewProvider.ts",
);

// Load HistoryProcessor separately for specific tests
const historyProcessorSource = readSource(
  joinFromRoot("src", "providers", "chat", "HistoryProcessor.ts"),
  "HistoryProcessor.ts",
);

test("system message rendering fix: hasRenderableHistoryPayload returns true for system reminder messages", () => {
  const hasRenderableBody = extractFunctionBody(chatViewProviderSource, 'hasRenderableHistoryPayload(');

  // Verify the comment explaining the fix is present
  assert.match(
    hasRenderableBody,
    /\/\/\s*Don't filter out system reminder messages - they will be converted to system role/,
    "hasRenderableHistoryPayload should have comment explaining system reminders are kept",
  );

  // Verify the fix: return true (not false) for system reminder messages
  assert.match(
    hasRenderableBody,
    /if\s*\(\s*this\.isInternalSystemReminderMessage\(message\)\s*\)\s*\{\s*return\s+true\s*;\s*\}/,
    "hasRenderableHistoryPayload should return true for system reminder messages (not false)",
  );
});

test("system message rendering fix: isRenderableHistoryMessage returns true for system reminder messages", () => {
  const isRenderableBody = extractFunctionBody(historyProcessorSource, 'isRenderableHistoryMessage(message: any): boolean {');

  // Verify the comment explaining the fix is present
  assert.match(
    isRenderableBody,
    /\/\/\s*Don't filter out system reminder messages - they will be converted to system role/,
    "isRenderableHistoryMessage should have comment explaining system reminders are kept",
  );

  // Verify the fix: return true (not false) for system reminder messages
  assert.match(
    isRenderableBody,
    /if\s*\(\s*(?:this\.)?isInternalSystemReminderMessage\(message\)\s*\)\s*return\s+true/,
    "isRenderableHistoryMessage should return true for system reminder messages (not false)",
  );
});

test("system message rendering fix: system reminder messages are converted to system role in webview store", () => {
  const webviewStoreSource = readAllSources(
    [joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts")],
    "store.ts",
  );

  // Verify that canonicalizeMessagesForRender converts internal transport messages to system role
  assert.match(
    webviewStoreSource,
    /isInternalTransportReminderMessage/,
    "webview store should check for internal transport reminder messages",
  );

  assert.match(
    webviewStoreSource,
    /role:\s*"system"/,
    "webview store should convert internal messages to system role",
  );
});

test("system message rendering fix: SystemMessage component exists and is used in ChatShell", () => {
  const chatShellSource = readAllSources(
    [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
    "ChatShell.tsx",
  );

  // Verify SystemMessage component is imported
  assert.match(
    chatShellSource,
    /SystemMessage/,
    "ChatShell should import SystemMessage component",
  );

  // Verify SystemMessage component is used for system role messages
  assert.match(
    chatShellSource,
    /role\s*===\s*"system"\s*\|\|\s*msg\.responseType\s*===\s*"system"/,
    "ChatShell should render SystemMessage for system role or responseType",
  );
});

test("system message rendering fix: verify all system reminder patterns are detected", () => {
  const isInternalBody = extractFunctionBody(chatViewProviderSource, 'isInternalSystemReminderMessage(');

  // Test that all internal system reminder patterns are detected
  assert.match(
    isInternalBody,
    /lower\.includes\("<system-reminder>"\)/,
    "should recognize <system-reminder> payloads",
  );

  assert.match(
    isInternalBody,
    /lower\.includes\("<auto-slash-command>"\)/,
    "should recognize <auto-slash-command> payloads",
  );

  assert.match(
    isInternalBody,
    /lower\.includes\("<!-- omo_internal_initiator -->"\)/,
    "should recognize the internal initiator marker",
  );

  assert.match(
    isInternalBody,
    /bracketPattern\.test/,
    "should use bracket pattern to detect [analyze-mode] and similar messages",
  );

  assert.match(
    isInternalBody,
    /lower\.includes\("\[search-model\]"\)/,
    "should recognize search-model reminder payloads",
  );
});

test("system message rendering fix: integration test - system messages flow through the pipeline", () => {
  // This test verifies the complete flow:
  // 1. System reminder messages are NOT filtered out (hasRenderableHistoryPayload returns true)
  // 2. They are marked as renderable (isRenderableHistoryMessage returns true)
  // 3. They are converted to role: "system" in the webview store
  // 4. They are rendered with the SystemMessage component

  const hasRenderableBody = extractFunctionBody(chatViewProviderSource, 'hasRenderableHistoryPayload(');
  const isRenderableBody = extractFunctionBody(historyProcessorSource, 'isRenderableHistoryMessage(message: any): boolean {');

  // Step 1: Verify system reminders are kept in hasRenderableHistoryPayload
  const step1 = /if\s*\(\s*this\.isInternalSystemReminderMessage\(message\)\s*\)\s*\{\s*return\s+true\s*;\s*\}/.test(hasRenderableBody);
  assert.strictEqual(step1, true, "Step 1: System reminders should be kept (return true)");

  // Step 2: Verify system reminders are kept in isRenderableHistoryMessage
  const step2 = /if\s*\(\s*(?:this\.)?isInternalSystemReminderMessage\(message\)\s*\)\s*return\s+true/.test(isRenderableBody);
  assert.strictEqual(step2, true, "Step 2: System reminders should be marked as renderable (return true)");

  // Step 3 & 4: Already verified in previous tests
});
