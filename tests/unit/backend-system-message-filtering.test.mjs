import test from "node:test";
import assert from "node:assert/strict";

import { extractFunctionBody, joinFromRoot, readAllSources } from '../helpers/source-utils.mjs';

const chatViewProviderSource = readAllSources(
  [
    joinFromRoot("src", "providers", "ChatViewProvider.ts"),
    joinFromRoot("src", "providers", "chat", "DiagnosticsLogger.ts"),
    joinFromRoot("src", "providers", "chat", "StructuredOutputProcessor.ts"),
    joinFromRoot("src", "providers", "chat", "PlanManager.ts"),
    joinFromRoot("src", "providers", "chat", "SubagentPersistence.ts"),
    joinFromRoot("src", "providers", "chat", "CompactionManager.ts"),
    joinFromRoot("src", "providers", "chat", "HistoryProcessor.ts"),
    joinFromRoot("src", "providers", "chat", "ModelAndAgentManager.ts"),
    joinFromRoot("src", "providers", "chat", "QueueManager.ts"),
    joinFromRoot("src", "providers", "chat", "SessionHandler.ts"),
    joinFromRoot("src", "providers", "chat", "StreamEventHandler.ts"),
    joinFromRoot("src", "providers", "chat", "types.ts")
  ],
  "ChatViewProvider.ts",
);

test("backend ChatViewProvider filters internal system reminder messages from history", () => {
  const isInternalBody = extractFunctionBody(chatViewProviderSource, 'isInternalSystemReminderMessage(');

  // Test that all internal system reminder patterns are detected
  assert.match(
    isInternalBody,
    /const\s+lower\s*=\s*trimmed\.toLowerCase\(\)/,
    "isInternalSystemReminderMessage should normalize text to lowercase",
  );
  assert.match(
    isInternalBody,
    /lower\.includes\("<system-reminder>"\)/,
    "isInternalSystemReminderMessage should recognize <system-reminder> payloads",
  );
  assert.match(
    isInternalBody,
    /lower\.includes\("<auto-slash-command>"\)/,
    "isInternalSystemReminderMessage should recognize <auto-slash-command> payloads",
  );
  assert.match(
    isInternalBody,
    /lower\.includes\("<!-- omo_internal_initiator -->"\)/,
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
    /bracketPattern\.test/,
    "isInternalSystemReminderMessage should test text against bracket pattern",
  );
  assert.match(
    isInternalBody,
    /lower\.includes\("\[search-model\]"\)\s*&&[\s\S]*lower\.includes\("maximize search effort"\)/,
    "isInternalSystemReminderMessage should recognize search-model reminder payloads",
  );
});

test("backend ChatViewProvider logs debug information for message processing", () => {
  const processHistoryBody = extractFunctionBody(
    chatViewProviderSource,
    'async processHistoryMessages(messages: any[], sessionId: string): Promise<any[]> {',
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
  const hasRenderableBody = extractFunctionBody(chatViewProviderSource, 'hasRenderableHistoryPayload(');

  assert.match(
    hasRenderableBody,
    /\/\/\s*Don't filter out system reminder messages/,
    "hasRenderableHistoryPayload should have comment explaining system reminders are not filtered",
  );
});
