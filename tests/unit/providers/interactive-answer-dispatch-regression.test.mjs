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

test("interactive force-send while processing does not abort the waiting question turn", () => {
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
    /mode === "send-now"[\s\S]*payload\.forceSendNow[\s\S]*!payload\.avoidAbortIfProcessing[\s\S]*getEffectiveProcessingSessionIds\(\)\.includes\(sessionId\)[\s\S]*handleStopRequest\(sessionId,\s*\{[\s\S]*suppressWebviewNotification:\s*true[\s\S]*skipQueueDrain:\s*true[\s\S]*recentlyAbortedSessionIds\.add\(sessionId\)/s,
    "force-send should only abort active work when the caller did not request abort suppression",
  );
  assert.match(
    scheduleDispatchBody,
    /if \(this\.isProcessingRequest\)[\s\S]*if \(payload\.avoidAbortIfProcessing\) \{[\s\S]*return;[\s\S]*await this\.handleStopRequest\(sessionId\);/s,
    "queued/steer processing path should still avoid aborting when avoidAbortIfProcessing is true",
  );
});
