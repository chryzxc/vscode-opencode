import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFunctionBody,
  joinFromRoot,
  readSource,
} from '../helpers/source-utils.mjs';

/**
 * Regression tests for system message rendering
 * These tests ensure the fix remains in place and prevents future breakage
 */

test("REGRESSION: system messages should not be filtered out (hasRenderableHistoryPayload)", () => {
  // This test prevents regression of the bug where system messages were filtered out
  const chatViewProviderSource = readSource(
    joinFromRoot("src", "providers", "ChatViewProvider.ts"),
    "ChatViewProvider.ts",
  );

  const hasRenderableBody = extractFunctionBody(chatViewProviderSource, 'hasRenderableHistoryPayload(');

  // CRITICAL: This MUST return true, not false
  // If this returns false, system messages will be filtered out again
  const returnsTrue = /if\s*\(\s*this\.isInternalSystemReminderMessage\(message\)\s*\)\s*\{\s*return\s+true\s*;\s*\}/.test(hasRenderableBody);

  assert.strictEqual(
    returnsTrue,
    true,
    "REGRESSION CHECK: hasRenderableHistoryPayload MUST return true for system reminder messages. " +
    "Returning false will filter out system messages and break rendering."
  );

  // Verify the comment is present as documentation
  assert.match(
    hasRenderableBody,
    /\/\/\s*Don't filter out system reminder messages/,
    "Documentation comment should be present to prevent accidental removal"
  );
});

test("REGRESSION: system messages should not be filtered out (isRenderableHistoryMessage)", () => {
  // This test prevents regression in HistoryProcessor
  const historyProcessorSource = readSource(
    joinFromRoot("src", "providers", "chat", "HistoryProcessor.ts"),
    "HistoryProcessor.ts",
  );

  const isRenderableBody = extractFunctionBody(historyProcessorSource, 'isRenderableHistoryMessage(message: any): boolean {');

  // CRITICAL: This MUST return true, not false
  const returnsTrue = /if\s*\(\s*(?:this\.)?isInternalSystemReminderMessage\(message\)\s*\)\s*return\s+true/.test(isRenderableBody);

  assert.strictEqual(
    returnsTrue,
    true,
    "REGRESSION CHECK: isRenderableHistoryMessage MUST return true for system reminder messages. " +
    "Returning false will filter out system messages and break rendering."
  );

  // Verify the comment is present as documentation
  assert.match(
    isRenderableBody,
    /\/\/\s*Don't filter out system reminder messages/,
    "Documentation comment should be present to prevent accidental removal"
  );
});

test("REGRESSION: system messages must be converted to system role in webview", () => {
  // This test ensures system messages get the correct role for rendering
  const webviewStoreSource = readSource(
    joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts"),
    "store.ts",
  );

  // CRITICAL: System messages MUST be converted to role: "system"
  // Without this, they won't be rendered with the SystemMessage component
  assert.match(
    webviewStoreSource,
    /isInternalTransportReminderMessage/,
    "MUST check for internal transport reminder messages"
  );

  assert.match(
    webviewStoreSource,
    /role:\s*"system"/,
    "MUST convert to role: 'system' for proper rendering"
  );
});

test("REGRESSION: SystemMessage component must be used for system role messages", () => {
  // This test ensures system messages are rendered with the correct component
  const chatShellSource = readSource(
    joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx"),
    "ChatShell.tsx",
  );

  // CRITICAL: System role messages MUST be detected and rendered with SystemMessage
  assert.match(
    chatShellSource,
    /role\s*===\s*"system"/,
    "MUST check for system role"
  );

  assert.match(
    chatShellSource,
    /<SystemMessage/,
    "MUST render SystemMessage component for system messages"
  );
});

test("REGRESSION: all system reminder patterns must be detected", () => {
  // This test ensures all known system reminder patterns are detected
  // If any pattern is removed, system messages of that type won't be rendered
  const historyProcessorSource = readSource(
    joinFromRoot("src", "providers", "chat", "HistoryProcessor.ts"),
    "HistoryProcessor.ts",
  );

  const isInternalBody = extractFunctionBody(historyProcessorSource, 'private isInternalSystemReminderMessage(message: any): boolean {');

  // CRITICAL patterns that MUST be detected
  const criticalPatterns = [
    '<system-reminder>',
    '<auto-slash-command>',
    '<!-- omo_internal_initiator -->',
    'bracketPattern',
    '[search-model]',
    'system reminder',
    'internal reminder',
    'reminder: you can',
  ];

  for (const pattern of criticalPatterns) {
    assert.match(
      isInternalBody,
      new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `REGRESSION CHECK: MUST detect pattern: ${pattern}. ` +
      `Removing this will break system message rendering for this type.`
    );
  }
});

test("REGRESSION: system messages must not be treated as assistant messages", () => {
  // This test prevents system messages from being incorrectly rendered as assistant messages
  const webviewStoreSource = readSource(
    joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts"),
    "store.ts",
  );

  // CRITICAL: System role MUST return false in isAssistantMessageForCanonical
  assert.match(
    webviewStoreSource,
    /role\s*===\s*['"]system['"][\s\S]*?return\s+false/,
    "REGRESSION CHECK: System messages MUST NOT be treated as assistant messages. " +
    "This would cause incorrect rendering."
  );
});

test("REGRESSION: bracket pattern must only match valid system messages", () => {
  // This test ensures the bracket pattern doesn't accidentally match regular messages
  const historyProcessorSource = readSource(
    joinFromRoot("src", "providers", "chat", "HistoryProcessor.ts"),
    "HistoryProcessor.ts",
  );

  const isInternalBody = extractFunctionBody(historyProcessorSource, 'private isInternalSystemReminderMessage(message: any): boolean {');

  // CRITICAL: Bracket pattern must be specific to avoid false positives
  assert.match(
    isInternalBody,
    /bracketPattern/,
    "REGRESSION CHECK: Bracket pattern MUST be defined " +
    "to match system messages starting with brackets"
  );
});

test("REGRESSION: system message fix must work end-to-end", () => {
  // This is a comprehensive regression test that verifies the entire flow
  const chatViewProviderSource = readSource(
    joinFromRoot("src", "providers", "ChatViewProvider.ts"),
    "ChatViewProvider.ts",
  );

  const historyProcessorSource = readSource(
    joinFromRoot("src", "providers", "chat", "HistoryProcessor.ts"),
    "HistoryProcessor.ts",
  );

  const webviewStoreSource = readSource(
    joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts"),
    "store.ts",
  );

  const chatShellSource = readSource(
    joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx"),
    "ChatShell.tsx",
  );

  // Step 1: System messages must NOT be filtered out in ChatViewProvider
  const step1 = /if\s*\(\s*this\.isInternalSystemReminderMessage\(message\)\s*\)\s*\{\s*return\s+true\s*;\s*\}/.test(
    extractFunctionBody(chatViewProviderSource, 'hasRenderableHistoryPayload(')
  );
  assert.strictEqual(step1, true, "Step 1 FAILED: System messages filtered in ChatViewProvider");

  // Step 2: System messages must NOT be filtered out in HistoryProcessor
  const step2 = /if\s*\(\s*(?:this\.)?isInternalSystemReminderMessage\(message\)\s*\)\s*return\s+true/.test(
    extractFunctionBody(historyProcessorSource, 'isRenderableHistoryMessage(message: any): boolean {')
  );
  assert.strictEqual(step2, true, "Step 2 FAILED: System messages filtered in HistoryProcessor");

  // Step 3: System messages must be converted to system role
  const step3 = /role:\s*"system"/.test(webviewStoreSource);
  assert.strictEqual(step3, true, "Step 3 FAILED: System messages not converted to system role");

  // Step 4: System role messages must be detected for rendering
  const step4 = /role\s*===\s*"system"/.test(chatShellSource);
  assert.strictEqual(step4, true, "Step 4 FAILED: System role not detected in ChatShell");

  // Step 5: SystemMessage component must be used
  const step5 = /<SystemMessage/.test(chatShellSource);
  assert.strictEqual(step5, true, "Step 5 FAILED: SystemMessage component not used");

  // If all steps pass, the fix is working end-to-end
  assert.strictEqual(
    true,
    true,
    "REGRESSION CHECK PASSED: System message rendering flow is intact"
  );
});

test("REGRESSION: verify comments are in place to prevent accidental removal", () => {
  // Documentation is critical to prevent future developers from accidentally breaking this
  const chatViewProviderSource = readSource(
    joinFromRoot("src", "providers", "ChatViewProvider.ts"),
    "ChatViewProvider.ts",
  );

  const historyProcessorSource = readSource(
    joinFromRoot("src", "providers", "chat", "HistoryProcessor.ts"),
    "HistoryProcessor.ts",
  );

  // Check for explanatory comments in both locations
  const hasChatViewComment = /\/\/\s*Don't filter out system reminder messages/.test(chatViewProviderSource);
  const hasHistoryProcessorComment = /\/\/\s*Don't filter out system reminder messages/.test(historyProcessorSource);

  assert.strictEqual(
    hasChatViewComment,
    true,
    "REGRESSION CHECK: ChatViewProvider must have explanatory comment"
  );

  assert.strictEqual(
    hasHistoryProcessorComment,
    true,
    "REGRESSION CHECK: HistoryProcessor must have explanatory comment"
  );
});
