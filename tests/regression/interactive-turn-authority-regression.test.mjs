import assert from "node:assert/strict";
import test from "node:test";

import { extractFunctionBody, joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const chatViewProviderSource = readSource(
  [joinFromRoot("src", "providers", "ChatViewProvider.ts")],
  "ChatViewProvider.ts",
);

const messageHandlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);

test("host stream forwarding does not end processing just because a payload is interactive", () => {
  const body = extractFunctionBody(
    chatViewProviderSource,
    "private async handleIncomingStreamEvent(rawEvent: unknown, event: any): Promise<void> {",
  );

  assert.doesNotMatch(
    body,
    /if \(hasBlockingInteractive && resolvedSessionId\)/,
    "host should not drop processing state merely because a stream payload looks interactive",
  );
});

test("question.asked no longer locally finishes the assistant turn in the webview", () => {
  const body = extractFunctionBody(
    messageHandlerSource,
    "case 'question.asked':",
  );

  assert.doesNotMatch(
    body,
    /FINISH_STREAMING|SET_PROCESSING[\s\S]*false/,
    "question.asked should not locally finalize the turn before upstream terminal events arrive",
  );
});

test("interactive stream payloads no longer force-finish turns from message.part.updated", () => {
  const body = extractFunctionBody(
    messageHandlerSource,
    "case 'message.part.updated':",
  );

  assert.doesNotMatch(
    body,
    /if \(hasBlockingInteractive\) \{[\s\S]*FINISH_STREAMING[\s\S]*SET_PROCESSING[\s\S]*false/s,
    "message.part.updated should not end the turn just because it contains blocking interactive payloads",
  );
});

test("step-finish paths do not locally complete the assistant turn", () => {
  assert.doesNotMatch(
    messageHandlerSource,
    /function completeStreamingTurnFromCentralizedStepFinish\(/,
    "step-finish should no longer have a dedicated helper that finalizes the assistant turn",
  );

  const partUpdatedBody = extractFunctionBody(
    messageHandlerSource,
    "case 'message.part.updated':",
  );
  assert.doesNotMatch(
    partUpdatedBody,
    /markAssistantTurnClosed[\s\S]*partType === 'step-finish'/,
    "message.part.updated should not mark the turn closed solely from step-finish progress",
  );

  const stepDoneBody = extractFunctionBody(
    messageHandlerSource,
    "case 'stepDone':",
  );
  assert.doesNotMatch(
    stepDoneBody,
    /FINISH_STREAMING|SET_ASSISTANT_TURN_PENDING|completeStreamingTurnFromCentralizedStepFinish/,
    "stepDone should update progress only and not finalize the assistant turn",
  );
});

test("message.updated no longer ends the turn from local already-closed flags", () => {
  const body = extractFunctionBody(
    messageHandlerSource,
    "case 'message.updated':",
  );

  assert.doesNotMatch(
    body,
    /const turnAlreadyClosed =|if \(turnAlreadyClosed\)/,
    "message.updated should not use a local already-closed fallback branch as authority to end the turn",
  );
});

test("processing-session updates do not locally finalize streaming state", () => {
  const body = extractFunctionBody(
    messageHandlerSource,
    'case "SET_PROCESSING_SESSIONS":',
  );

  assert.doesNotMatch(
    body,
    /SET_ASSISTANT_TURN_PENDING|FINISH_STREAMING|SET_STREAMING[\s\S]*payload:\s*null/,
    "SET_PROCESSING_SESSIONS should not clear or finish the assistant turn on its own",
  );
});
