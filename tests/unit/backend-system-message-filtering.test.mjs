import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFunctionBody,
  joinFromRoot,
  readSource,
} from "./helpers/source-utils.mjs";

const chatViewProviderSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

test("backend ChatViewProvider filters internal system reminder messages from history", () => {
  const isInternalBody = extractFunctionBody(
    chatViewProviderSource,
    "private isInternalSystemReminderMessage(message: any): boolean",
  );

  // Test that all internal system reminder patterns are detected
  assert.match(
    isInternalBody,
    /const\s+normalized\s*=\s*text\.toLowerCase\(\)/,
    "isInternalSystemReminderMessage should normalize text to lowercase",
  );
  assert.match(
    isInternalBody,
    /const\s+trimmed\s*=\s*text\.trim\(\)/,
    "isInternalSystemReminderMessage should trim whitespace from text",
  );
  assert.match(
    isInternalBody,
    /normalized\.includes\("<system-reminder>"\)/,
    "isInternalSystemReminderMessage should recognize <system-reminder> payloads",
  );
  assert.match(
    isInternalBody,
    /normalized\.includes\("<auto-slash-command>"\)/,
    "isInternalSystemReminderMessage should recognize <auto-slash-command> payloads",
  );
  assert.match(
    isInternalBody,
    /normalized\.includes\("<!-- omo_internal_initiator -->"\)/,
    "isInternalSystemReminderMessage should recognize the internal initiator marker",
  );
  assert.match(
    isInternalBody,
    /hasBracketPrefix/,
    "isInternalSystemReminderMessage should use bracket prefix pattern to detect [analyze-mode] and similar messages",
  );
  assert.match(
    isInternalBody,
    /const\s+bracketPattern/,
    "isInternalSystemReminderMessage should define bracket pattern",
  );
  assert.match(
    isInternalBody,
    /hasBracketPrefix/,
    "isInternalSystemReminderMessage should use bracket prefix detection",
  );
  assert.match(
    isInternalBody,
    /bracketPattern\.test/,
    "isInternalSystemReminderMessage should test text against bracket pattern",
  );
  assert.match(
    isInternalBody,
    /normalized\.includes\("\[search-model\]"\)\s*&&[\s\S]*normalized\.includes\("maximize search effort"\)/,
    "isInternalSystemReminderMessage should recognize search-model reminder payloads",
  );
});

test("backend ChatViewProvider logs debug information for message processing", () => {
  const processHistoryBody = extractFunctionBody(
    chatViewProviderSource,
    "private processHistoryMessages(",
  );

  assert.match(
    processHistoryBody,
    /this\.logger\.info\(['"]\[DEBUG\]\s+processHistoryMessages input:/,
    "processHistoryMessages should log input messages with DEBUG prefix",
  );
  assert.match(
    processHistoryBody,
    /this\.logger\.info\(['"]\[DEBUG\]\s+processHistoryMessages output:/,
    "processHistoryMessages should log output messages with DEBUG prefix",
  );
});

test("backend ChatViewProvider does not filter internal system reminders from renderable history", () => {
  const hasRenderableBody = extractFunctionBody(
    chatViewProviderSource,
    "private hasRenderableHistoryPayload(message: any): boolean",
  );

  assert.match(
    hasRenderableBody,
    /\/\/\s*Don't filter out system reminder messages/,
    "hasRenderableHistoryPayload should have comment explaining system reminders are not filtered",
  );
  assert.match(
    hasRenderableBody,
    /\/\/\s*Don't filter out system reminder messages/,
    "hasRenderableHistoryPayload should have comment explaining system reminders are not filtered",
  );
});
