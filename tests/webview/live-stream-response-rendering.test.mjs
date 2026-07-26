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
const storeSource = readSource(
  [joinFromRoot("webview", "shared", "src", "chat", "lib", "store.ts")],
  "store.ts",
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
    /hasMatchingAssistantTurnInTranscript && !streaming\.isActive/,
    "only the matching transcript turn may hide a completed live stream",
  );
  assert.match(
    shellSource,
    /hasLiveAssistantTurn[\s\S]*?!isAiResponseBlockFinished/,
    "the loading ticker must stay visible throughout the live assistant turn alongside Stop, regardless of streaming content arrival",
  );
  assert.match(
    shellSource,
    /const showExtendedLoading\s*=\s*!state\.isCompacting\s*&&\s*\(hasLiveAssistantTurn \|\| showAiResponseLoading\);/,
    "the ticker must remain hidden while compaction owns the live-response surface",
  );
  assert.doesNotMatch(
    shellSource,
    /hasRenderableStreamingContent/,
    "stream content must not gate the loading ticker — hasRenderableStreamingContent was removed in favor of hasLiveAssistantTurn",
  );
});

test("active compaction owns the live-response surface without stopping stream processing", () => {
  assert.match(
    shellSource,
    /\{!state\.isCompacting \? \(/,
    "the live activity card must not render while compaction is in progress",
  );
  assert.match(
    shellSource,
    /suppressLiveAssistantPresentation=\{state\.isCompacting\}/,
    "an assistant block already created by the live stream must receive the same compaction gate",
  );
  assert.match(
    shellSource,
    /const isSuppressedLiveBlock\s*=\s*suppressLiveAssistantPresentation[\s\S]*?messageNode = isSuppressedLiveBlock \? null/s,
    "compaction must hide the in-transcript live assistant block, not just the separate streaming card",
  );
  assert.match(
    shellSource,
    /state\.isCompacting \? <CompactionInProgressNotice \/> : null/,
    "compaction must present a dedicated, visible maintenance status",
  );
  assert.match(
    shellSource,
    /function CompactionInProgressNotice\(\)[\s\S]*?role="status"[\s\S]*?Live activity resumes automatically\./,
    "the maintenance state should explain the temporary timeline pause accessibly",
  );
  assert.match(
    shellSource,
    /suppressLiveAssistantPresentation=\{state\.isCompacting\}/,
    "the transcript must receive the same compaction presentation gate",
  );
  assert.match(
    shellSource,
    /const isSuppressedLiveBlock\s*=\s*suppressLiveAssistantPresentation[\s\S]*?messageNode = isSuppressedLiveBlock \? null/s,
    "a live assistant response already represented in the transcript must also stay hidden during compaction",
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
    /const isDeltaForKnownReasoningPart =[\s\S]*?const isDeltaForActiveReasoningPart =[\s\S]*?const isReasoning =/,
    "reasoning routing must use the typed part or established part identity, not the shape of ordinary text token snapshots",
  );
});

test("a text-labeled delta stays in reasoning when its SDK part was already typed as reasoning", () => {
  assert.match(
    handlerSource,
    /knownReasoningPartIDs\?\.has\(reasoningPartID\)[\s\S]*?currentStreamingState\?\.reasoningPartIDs\?\.includes\(reasoningPartID\)/s,
    "reasoning ownership must be retained on StreamingState instead of relying only on one handler instance",
  );
  assert.match(
    handlerSource,
    /case 'contentDelta':[\s\S]*?const isKnownReasoningPart = Boolean\([\s\S]*?streamingState\?\.reasoningPartIDs\?\.includes\(reasoningPartID\)[\s\S]*?isKnownReasoningPart/s,
    "legacy contentDelta envelopes must also respect established reasoning part ownership",
  );
  assert.match(
    storeSource,
    /existingReasoningPartIDs[\s\S]*?reasoningPartIDs[\s\S]*?\.slice\(-32\)/s,
    "the retained reasoning IDs must be bounded for a long live stream",
  );
});

test("assistant phase changes retain the already visible live response", () => {
  assert.match(
    handlerSource,
    /if \(shouldStartFreshAssistantTurn\) \{[\s\S]*?\.\.\.currentStreamingSnapshot,[\s\S]*?messageId,[\s\S]*?isActive: true,/s,
    "a later SDK assistant envelope must retain the active response snapshot instead of blanking it",
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

test("stable live SDK events use the same activity projection source as hydration", () => {
  assert.match(
    handlerSource,
    /getCentralizedDebugPayloadDisposition\(payload\) === "persist"[\s\S]*?type: "APPEND_SDK_EVENT_PAYLOAD"/s,
    "every stable accepted SDK event must enter the active live tape so new activity part types render before rehydration",
  );
  assert.match(
    storeSource,
    /next\.length > 200 \? next\.slice\(next\.length - 200\) : next/s,
    "the bounded live tape must roll forward rather than stop accepting later activity events",
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

test("a terminal assistant block stays locked despite late streaming events", () => {
  assert.match(
    shellSource,
    /const hasNewLiveTurnBeforeAssistantIdentity\s*=[\s\S]*?Boolean\(state\.streaming\?\.isActive\)[\s\S]*?state\.assistantTurnPending[\s\S]*?visiblePendingUserMessages\.length > 0;/s,
    "a newly active turn must unlock the previous assistant block before its message identity arrives",
  );
  assert.match(
    shellSource,
    /hasTerminalAssistantBlock[\s\S]*?!hasStartedNewAssistantTurn[\s\S]*?!hasNewLiveTurnBeforeAssistantIdentity/s,
    "a completed assistant block remains terminal unless a distinct current turn is active",
  );
});

test("stream admission reconstructs the terminal lock from hydrated assistant history", () => {
  assert.match(
    handlerSource,
    /const hasRenderedTerminalAssistantBlock = \(state: AppState\): boolean => \{[\s\S]*?finish === "stop"/s,
    "a completed SDK message must provide a terminal latch even after handler recreation",
  );
  assert.match(
    handlerSource,
    /isActiveSessionTerminalTranscript[\s\S]*?rejected-terminal-transcript[\s\S]*?FINISH_STREAMING/s,
    "late events after a completed response must be rejected before they can reactivate loading",
  );
});

test("the message-less streaming card rerenders for each active SSE update", () => {
  assert.match(
    messageSource,
    /const prevWasStreaming = prevProps\.message[\s\S]*?Boolean\(prevProps\.streaming\?\.isActive\)[\s\S]*?const nextIsStreaming = nextProps\.message[\s\S]*?Boolean\(nextProps\.streaming\?\.isActive\)/,
    "React.memo must recognize the dedicated message-less streaming card as live",
  );
});
