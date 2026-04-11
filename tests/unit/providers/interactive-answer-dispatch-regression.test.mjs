import test from "node:test";
import assert from "node:assert/strict";

import {
  extractFunctionBody,
  joinFromRoot,
  readAllSources,
} from "../../helpers/source-utils.mjs";

const providerSource = readAllSources(
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
    joinFromRoot("src", "providers", "chat", "types.ts"),
  ],
  "ChatViewProvider.ts",
);

test("interactive answer dispatch does not short-circuit while processing", () => {
  const interactiveDispatchBody = extractFunctionBody(
    providerSource,
    "private async dispatchInteractiveResponse(",
  );

  assert.ok(
    interactiveDispatchBody,
    "dispatchInteractiveResponse method should exist",
  );
  assert.match(
    interactiveDispatchBody,
    /await this\.handleSendMessage\(/,
    "interactive answers should use the direct normal-message send path",
  );
  assert.doesNotMatch(
    interactiveDispatchBody,
    /if \(this\.processingSessionIds\.has\(sessionId\)\) \{[\s\S]*await this\.handleStopRequest\(sessionId\);/s,
    "interactive dispatch should not abort active requests for interactive-wait turns",
  );
});

test("send-now while processing still stops current request and drains queued input", () => {
  const scheduleDispatchBody = extractFunctionBody(
    providerSource,
    "private async schedulePromptDispatch(",
  );

  assert.ok(
    scheduleDispatchBody,
    "schedulePromptDispatch method should exist",
  );
  assert.match(
    scheduleDispatchBody,
    /if \(this\.isProcessingRequest\)[\s\S]*if \(payload\.avoidAbortIfProcessing\) \{[\s\S]*return;[\s\S]*await this\.handleStopRequest\(sessionId\);/s,
    "processing send path should stop active request when avoidAbortIfProcessing is false",
  );
  assert.match(
    scheduleDispatchBody,
    /mode === "send-now"[\s\S]*payload\.forceSendNow[\s\S]*this\.processingSessionIds\.has\(sessionId\)[\s\S]*handleStopRequest\(sessionId,\s*\{[\s\S]*suppressWebviewNotification:\s*true[\s\S]*skipQueueDrain:\s*true/s,
    "interactive force-send path should silently stop the waiting request before direct send",
  );
});
