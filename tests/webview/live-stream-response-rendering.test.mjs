import test from "node:test";
import assert from "node:assert/strict";

import { joinFromRoot, readSource } from "../helpers/source-utils.mjs";

const messageSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "MessageComponents.tsx")],
  "MessageComponents.tsx",
);
const shellSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "ChatShell.tsx")],
  "ChatShell.tsx",
);
const handlerSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "messageHandler.ts")],
  "messageHandler.ts",
);
const streamingCardSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "streamingCardVisibility.ts")],
  "streaming card visibility",
);

test("renderable stream text paints immediately and centralized transcript takes over after completion", () => {
  assert.match(
    messageSource,
    /!cardMessage[\s\S]*streaming\?\.hasRenderableContent === true[\s\S]*return \[streaming\.content\]/,
    "the live response card should render only explicitly safe streamed text",
  );
  assert.match(
    streamingCardSource,
    /hasTranscriptAssistantForCurrentTurn && !streaming\.isActive/,
    "an assistant transcript placeholder must not hide the active live stream",
  );
  assert.match(
    shellSource,
    /hasLiveAssistantTurn[\s\S]*?!isAiResponseBlockFinished/,
    "the loading ticker must stay visible throughout the live assistant turn alongside Stop, regardless of streaming content arrival",
  );
  assert.doesNotMatch(
    shellSource,
    /hasRenderableStreamingContent/,
    "stream content must not gate the loading ticker — hasRenderableStreamingContent was removed in favor of hasLiveAssistantTurn",
  );
});

test("raw text delta envelopes update the live response before final hydration", () => {
  assert.match(
    handlerSource,
    /const isRawDeltaTextField =[\s\S]*?deltaField === "text"[\s\S]*?deltaField === "content"/,
  );
  assert.match(
    handlerSource,
    /partType === "message" \|\|[\s\S]*?isRawDeltaTextField/,
    "text deltas without part.type must be accepted by the streaming content path",
  );
  assert.match(
    handlerSource,
    /renderable:[\s\S]*?isRawDeltaTextField/,
    "a raw text delta must dismiss the loading bubble by becoming renderable",
  );
  assert.match(
    handlerSource,
    /eventType === "message\.part\.delta" \|\| rawUpdatedDelta\.trim\(\)\.length > 0/,
    "the handler must recognize deltas after the SDK adapter rewrites their event type",
  );
  assert.match(
    handlerSource,
    /!isRawDeltaTextField[\s\S]*?!isRawDeltaReasoningField[\s\S]*?isDeltaOnlyUpdatedTextSnapshot/,
    "adapted text deltas must not be misclassified as reasoning snapshots",
  );
});

test("wrapped SDK stream events pass the visible-turn admission condition", () => {
  const admissionSection = handlerSource.slice(
    handlerSource.indexOf("const streamEventCanStartVisibleAssistantTurn"),
    handlerSource.indexOf("/** Route all ephemeral SDK UI events"),
  );
  assert.match(
    admissionSection,
    /const eventType = getCentralizedEventType\(payload\)/,
    "the admission condition must unwrap sync transport envelopes before deciding whether a live assistant card can start",
  );
  assert.match(
    admissionSection,
    /getCentralizedEventPart\(payload\)/,
    "the admission condition must inspect the nested SDK part used by the renderer",
  );
});

test("sync-wrapped assistant parts can bootstrap the live response", () => {
  const bootstrapGateStart = handlerSource.indexOf(
    "const streamEventCanStartVisibleAssistantTurn",
  );
  const routerStart = handlerSource.indexOf("/** Route all ephemeral SDK UI events");
  const bootstrapGate = handlerSource.slice(bootstrapGateStart, routerStart);

  assert.match(
    bootstrapGate,
    /const eventType = getCentralizedEventType\(payload\)/,
    "the pre-render gate must unwrap sync transport envelopes before classifying the event",
  );
  assert.match(
    bootstrapGate,
    /getCentralizedEventPart\(payload\)/,
    "the pre-render gate must inspect the nested SDK part used by the live renderer",
  );
});

test("continuous stream batches remain urgent enough to paint", () => {
  assert.match(handlerSource, /case "streamEventBatch":[\s\S]*?processBatchEvents\(\);/);
  assert.doesNotMatch(
    handlerSource,
    /case "streamEventBatch":[\s\S]*?startTransition\(processBatchEvents\)/,
    "continuous token batches must not be starved as interruptible transitions",
  );
  assert.doesNotMatch(
    handlerSource,
    /startTransition\(processStreamEvent\)/,
    "single active-stream events must paint without transition starvation",
  );
});

test("an active transcript placeholder does not suppress live event rendering", () => {
  assert.match(
    streamingCardSource,
    /hasMatchingAssistantTurnInTranscript\s*&&\s*!streaming\.isActive/,
    "matching transcript IDs may suppress the live card only after streaming completes",
  );
});
