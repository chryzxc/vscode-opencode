/**
 * Interactive Flag Lifecycle Unit Tests
 *
 * Tests the lifecycle of the awaitingInteractiveAnswer flag to ensure
 * it's not cleared prematurely in schedulePromptDispatch.
 *
 * This is part of fixing bugs where:
 * 1. Popover briefly reappears after submitting answers
 * 2. "Headers Timeout Error" appears after subsequent answer submissions
 */

import test from "node:test";
import assert from "node:assert/strict";
import { extractFunctionBody, joinFromRoot, readAllSources } from "../../helpers/source-utils.mjs";

const chatProviderSource = readAllSources(
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
  "ChatViewProvider.ts"
);

test('flag lifecycle: awaitingInteractiveAnswer stays true during message dispatch', () => {
  // Extract schedulePromptDispatch method
  const dispatchBody = extractFunctionBody(
    chatProviderSource,
    'private async schedulePromptDispatch('
  );

  assert.ok(dispatchBody, 'schedulePromptDispatch method should exist');

  // The flag should NOT be set to false in schedulePromptDispatch
  // It should only be cleared when streaming actually starts
  assert.doesNotMatch(
    dispatchBody,
    /this\.awaitingInteractiveAnswer\s*=\s*false/,
    'awaitingInteractiveAnswer should NOT be cleared in schedulePromptDispatch'
  );
});

test('flag lifecycle: awaitingInteractiveAnswer is set when question arrives', () => {
  // Find where flag is set to true in stream event handler
  const flagSetTrue = chatProviderSource.match(
    /hasBlockingInteractiveInStreamPayload[\s\S]{0,500}this\.awaitingInteractiveAnswer\s*=\s*true/
  );

  assert.ok(
    flagSetTrue,
    'Should set awaitingInteractiveAnswer to true when blocking interactive event arrives'
  );

  assert.match(
    flagSetTrue[0],
    /this\.awaitingInteractiveAnswer\s*=\s*true/,
    'Should set flag to true'
  );

  assert.match(
    flagSetTrue[0],
    /hasBlockingInteractiveInStreamPayload/,
    'Should be in the context of hasBlockingInteractiveInStreamPayload check'
  );
});
