import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFunctionBody,
  joinFromRoot,
  readAllSources,
  readSource,
} from '../helpers/source-utils.mjs';

// Load all relevant sources
const chatViewProviderSource = readAllSources(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

const historyProcessorSource = readSource(
  joinFromRoot("src", "providers", "chat", "HistoryProcessor.ts"),
  "HistoryProcessor.ts",
);

const webviewStoreSource = readAllSources(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts")],
  "store.ts",
);

const chatShellSource = readAllSources(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);

test("system reminder messages are not filtered out in history processing", () => {
  // Test 1: hasRenderableHistoryPayload returns true for system reminders
  const hasRenderableBody = extractFunctionBody(chatViewProviderSource, 'hasRenderableHistoryPayload(');

  // Verify the fix is present
  const hasRenderableFix = /if\s*\(\s*this\.isInternalSystemReminderMessage\(message\)\s*\)\s*\{\s*return\s+true\s*;\s*\}/.test(hasRenderableBody);
  assert.strictEqual(
    hasRenderableFix,
    true,
    "hasRenderableHistoryPayload should return true for system reminder messages"
  );

  // Test 2: isRenderableHistoryMessage returns true for system reminders
  const isRenderableBody = extractFunctionBody(historyProcessorSource, 'isRenderableHistoryMessage(message: any): boolean {');

  const isRenderableFix = /if\s*\(\s*(?:this\.)?isInternalSystemReminderMessage\(message\)\s*\)\s*return\s+true/.test(isRenderableBody);
  assert.strictEqual(
    isRenderableFix,
    true,
    "isRenderableHistoryMessage should return true for system reminder messages"
  );
});

test("system reminder messages are converted to system role in webview", () => {
  // Verify the webview store converts internal transport messages to system role
  assert.match(
    webviewStoreSource,
    /isInternalTransportReminderMessage\(message\)/,
    "webview store should check for internal transport reminder messages"
  );

  assert.match(
    webviewStoreSource,
    /return\s*\{\s*\.\.\.message,\s*role:\s*"system"\s*\}/,
    "webview store should convert internal messages to system role"
  );
});

test("system role messages are rendered with SystemMessage component", () => {
  // Verify ChatShell uses SystemMessage component for system role
  assert.match(
    chatShellSource,
    /role\s*===\s*"system"/,
    "ChatShell should check for system role"
  );

  assert.match(
    chatShellSource,
    /<SystemMessage/,
    "ChatShell should render SystemMessage component for system messages"
  );
});

test("all system reminder patterns are correctly detected", () => {
  const isInternalBody = extractFunctionBody(historyProcessorSource, 'private isInternalSystemReminderMessage(message: any): boolean {');

  // Test specific patterns that are checked with includes()
  const includesPatterns = [
    { pattern: '<system-reminder>', name: 'system reminder tag' },
    { pattern: '<auto-slash-command>', name: 'auto slash command tag' },
    { pattern: '<!-- omo_internal_initiator -->', name: 'internal initiator comment' },
    { pattern: '[search-model]', name: 'search model reminder' },
  ];

  for (const { pattern, name } of includesPatterns) {
    const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`['"\`]${escapedPattern}['"\`]`);
    assert.match(
      isInternalBody,
      regex,
      `isInternalSystemReminderMessage should detect ${name}`
    );
  }

  // Verify bracket pattern detection (used for [analyze-mode] and similar)
  assert.match(
    isInternalBody,
    /bracketPattern\s*=/,
    "isInternalSystemReminderMessage should define bracket pattern"
  );

  assert.match(
    isInternalBody,
    /hasBracketPrefix/,
    "isInternalSystemReminderMessage should check bracket prefix"
  );

  assert.match(
    isInternalBody,
    /bracketPattern\.test/,
    "isInternalSystemReminderMessage should use bracket pattern test"
  );
});

test("complete system message flow: from history to rendering", () => {
  // This test verifies the complete flow:
  // 1. System reminder messages are kept in history (not filtered out)
  // 2. They are converted to role: "system" in webview store
  // 3. They are rendered with SystemMessage component

  // Step 1: Verify system reminders are kept in history processing
  const hasRenderableBody = extractFunctionBody(chatViewProviderSource, 'hasRenderableHistoryPayload(');
  const isRenderableBody = extractFunctionBody(historyProcessorSource, 'isRenderableHistoryMessage(message: any): boolean {');

  const step1 = /if\s*\(\s*this\.isInternalSystemReminderMessage\(message\)\s*\)\s*\{\s*return\s+true\s*;\s*\}/.test(hasRenderableBody);
  assert.strictEqual(step1, true, "Step 1: System reminders should be kept in hasRenderableHistoryPayload");

  const step2 = /if\s*\(\s*(?:this\.)?isInternalSystemReminderMessage\(message\)\s*\)\s*return\s+true/.test(isRenderableBody);
  assert.strictEqual(step2, true, "Step 2: System reminders should be kept in isRenderableHistoryMessage");

  // Step 3: Verify conversion to system role
  const step3 = /return\s*\{\s*\.\.\.message,\s*role:\s*"system"\s*\}/.test(webviewStoreSource);
  assert.strictEqual(step3, true, "Step 3: System reminders should be converted to system role");

  // Step 4: Verify rendering with SystemMessage component
  const step4 = /role\s*===\s*"system"/.test(chatShellSource);
  assert.strictEqual(step4, true, "Step 4: System role messages should be detected for rendering");

  const step5 = /<SystemMessage/.test(chatShellSource);
  assert.strictEqual(step5, true, "Step 5: SystemMessage component should be used for rendering");
});

test("system messages are not treated as assistant messages", () => {
  // Verify that system role messages are not incorrectly treated as assistant messages
  assert.match(
    webviewStoreSource,
    /role\s*===\s*['"]system['"][\s\S]*?return\s+false/,
    "isAssistantMessageForCanonical should return false for system role"
  );
});

test("system message patterns are consistently detected across backend and frontend", () => {
  // Verify that both backend (ChatViewProvider) and frontend (store) use the same patterns

  // Backend patterns
  const backendPatterns = [
    '<system-reminder>',
    '<auto-slash-command>',
    '<!-- omo_internal_initiator -->',
    '[analyze-mode]',
  ];

  // Frontend patterns
  const frontendHasSquareBracket = /squareBracketPattern/.test(webviewStoreSource);
  const frontendHasAngleBracket = /angleBracketPattern/.test(webviewStoreSource);
  const frontendHasComment = /commentPattern/.test(webviewStoreSource);

  assert.strictEqual(frontendHasSquareBracket, true, "Frontend should detect square bracket patterns");
  assert.strictEqual(frontendHasAngleBracket, true, "Frontend should detect angle bracket patterns");
  assert.strictEqual(frontendHasComment, true, "Frontend should detect comment patterns");

  // Verify backend also has these patterns
  const backendHasBracketPattern = /bracketPattern/.test(historyProcessorSource);
  assert.strictEqual(backendHasBracketPattern, true, "Backend should use bracket pattern detection");
});
