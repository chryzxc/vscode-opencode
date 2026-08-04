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
    /!cardMessage[\s\S]*streaming\?\.hasRenderableContent === true[\s\S]*return liveChunks\.length > 0 \? liveChunks : \[streaming\.content\]/,
    "the live response card should render only explicitly safe streamed text, preferring individual chunks and falling back to whole content",
  );
  assert.match(
    streamingCardSource,
    /hasMatchingAssistantTurnInTranscript &&[\s\S]*?!streaming\.isActive &&[\s\S]*?hasTranscriptAssistantForCurrentTurn[\s\S]*?return false;/,
    "only the matching transcript turn may hide an inactive live stream after a rendered transcript response takes ownership",
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
    /suppressLiveAssistantPresentation=\{suppressTranscriptLiveAssistantBlock\}/,
    "an assistant block already represented by the live card must be suppressed",
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
    /function CompactionInProgressNotice\(\)[\s\S]*?role="status"[\s\S]*?>Compacting<\//,
    "the maintenance state should present a concise compaction status",
  );
  assert.match(
    shellSource,
    /const shouldKeepSeparateStreamingCard\s*=\s*[\s\S]*?shouldRenderSeparateStreamingCard &&[\s\S]*?!hasLiveAssistantAlreadyInTranscript[\s\S]*?!hasTranscriptAssistantForCurrentTurn[\s\S]*?const shouldKeepSeparateStreamingCardForContentOwnership\s*=\s*shouldKeepSeparateStreamingCard && !liveResponseContentAlreadyRendered/s,
    "a current-turn transcript or matching response content must prevent a second live card",
  );
  assert.match(
    shellSource,
    /const isSuppressedLiveBlock\s*=\s*suppressLiveAssistantPresentation[\s\S]*?messageNode = isSuppressedLiveBlock \? null/s,
    "a live assistant response already represented in the transcript must also stay hidden during compaction",
  );
});

test("transcript ownership is declared after its deferred source and before handoff reads it", () => {
  const deferredEntriesIndex = shellSource.indexOf("const deferredVisibleConversationEntries");
  const ownershipIndex = shellSource.indexOf("const hasTranscriptAssistantForCurrentTurn = useMemo");
  const handoffReadIndex = shellSource.indexOf("hasTranscriptAssistantForCurrentTurn,\n    subagentsByParentMessageId");
  assert.ok(deferredEntriesIndex >= 0, "ChatShell must define the deferred transcript entries");
  assert.ok(ownershipIndex >= 0, "ChatShell must define transcript ownership");
  assert.ok(handoffReadIndex >= 0, "the live-card handoff must read transcript ownership");
  assert.ok(
    deferredEntriesIndex < ownershipIndex && ownershipIndex < handoffReadIndex,
    "the deferred transcript must initialize before ownership, and ownership before the handoff can read it",
  );
});

test("conversation transcript receives transcript ownership as an explicit prop", () => {
  assert.match(
    shellSource,
    /type ConversationTranscriptProps = \{[\s\S]*?hasTranscriptAssistantForCurrentTurn: boolean;/,
    "the transcript component must declare ownership as a required prop",
  );
  assert.match(
    shellSource,
    /const MemoizedConversationTranscript = memo\(function ConversationTranscript\(\{[\s\S]*?hasTranscriptAssistantForCurrentTurn,[\s\S]*?\}\)/,
    "the transcript component must destructure the ownership prop locally",
  );
  assert.match(
    shellSource,
    /<MemoizedConversationTranscript[\s\S]*?hasTranscriptAssistantForCurrentTurn=\{hasTranscriptAssistantForCurrentTurn\}/,
    "ChatShell must pass ownership explicitly to the transcript component",
  );
});

test("retry status uses a compact accessible inline status treatment", () => {
  assert.match(
    messageSource,
    /oc-live-session-status[\s\S]*?role="status"[\s\S]*?aria-live="polite"/s,
    "retry status should remain discoverable to assistive technology while using the refined inline treatment",
  );
  assert.match(
    messageSource,
    /oc-live-session-status__countdown[\s\S]*?liveStatusCountdown/s,
    "retry countdown should remain a distinct scannable value",
  );
});

test("dismissed live status notifications stay dismissed across retry heartbeats", () => {
  const toastSource = readSource(
    [joinFromRoot("webview", "shared", "src", "chat", "ToastOverlay.tsx")],
    "ToastOverlay.tsx",
  );
  assert.match(
    toastSource,
    /function toastDismissalKey\([\s\S]*?session\.status[\s\S]*?notification\.message/s,
    "session status dismissal must use semantic status data rather than the changing transport key",
  );
  assert.match(
    toastSource,
    /dismissedToastKeysRef[\s\S]*?nextToasts = notifications\.filter\([\s\S]*?dismissedToastKeysRef/s,
    "dismissed notifications must be filtered before new heartbeat frames are queued",
  );
});

test("compaction divider exposes a clear toggle affordance", () => {
  assert.match(
    shellSource,
    /oc-compaction-divider-action[\s\S]*?ChevronDown[\s\S]*?ChevronUp/s,
    "the compaction boundary should show directional expand/collapse affordances",
  );
  assert.match(
    shellSource,
    /oc-compaction-divider-card-button[\s\S]*?aria-pressed=\{!collapsed\}/s,
    "the compaction boundary must retain its accessible toggle state",
  );
  assert.match(
    shellSource,
    /oc-compaction-divider-line[\s\S]*?<svg[\s\S]*?<path d="M0 9 C/s,
    "the compaction boundary should use a subtle curved divider instead of rigid straight rules",
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

test("assistant phase changes retain activity but reset response-card ownership", () => {
  assert.match(
    handlerSource,
    /if \(shouldStartFreshAssistantTurn\) \{[\s\S]*?\.\.\.currentStreamingSnapshot,[\s\S]*?messageId,[\s\S]*?isActive: true,/s,
    "a later SDK assistant envelope must retain the active turn while adopting its own message identity",
  );
  assert.match(
    handlerSource,
    /messageId,[\s\S]*?content: "",[\s\S]*?reasoning: "",[\s\S]*?responseChunks: \[\]/s,
    "a later assistant message must not inherit the previous phase response body or response chunks",
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

test("the shell does not leak loading text into the composer", () => {
  assert.doesNotMatch(
    shellSource,
    /ThinkingBubble|keepLoadingIndicatorSpace|shouldRenderLoadingIndicatorReserve/,
    "loading presentation must stay in the activity timeline, not the composer flow",
  );
});

test("the live response card owns the AI loading text until its response finishes", () => {
  assert.match(
    messageSource,
    /const shouldShowLiveLoadingText\s*=\s*isCurrentCardLiveAssistantTurn[\s\S]*?!isParentResponseFinished[\s\S]*?!isAborted[\s\S]*?!hideLoadingText/,
    "the loading ticker should follow canonical live-card ownership rather than only local stream activity",
  );
  assert.match(
    messageSource,
    /shouldShowLiveLoadingText[\s\S]*?data-assistant-section="live-loading-text"[\s\S]*?<AIStatusTicker \/>/,
    "the loading ticker must be rendered inside the active assistant activity section",
  );
  assert.match(
    messageSource,
    /\|\|\s*shouldShowLiveLoadingText\)\s*&&/,
    "a live turn without activity rows must still mount the loading text",
  );
  assert.doesNotMatch(
    messageSource,
    /\{isLiveStream && !isParentResponseFinished && !isAborted \?/,
    "completed or aborted response cards must not keep the live loading ticker",
  );
});

test("the live loading text follows the response card", () => {
  const responseSectionIndex = messageSource.lastIndexOf(
    'data-assistant-section="response"',
  );
  const loadingTextIndex = messageSource.indexOf(
    'data-assistant-section="live-loading-text"',
  );
  assert.ok(responseSectionIndex >= 0, "the assistant response section must render");
  assert.ok(loadingTextIndex > responseSectionIndex, "the loading text must render below the latest response card");
});

test("active assistant cards do not use intrinsic virtualization height", () => {
  assert.match(
    messageSource,
    /style=\{streaming \|\| isStreamingActive \? undefined : DEFERRED_CHAT_CARD_STYLE\}/,
    "the live timeline must remain mounted instead of showing a large intrinsic-size placeholder",
  );
});

test("an active transcript placeholder does not suppress live event rendering", () => {
  assert.match(
    streamingCardSource,
    /hasMatchingAssistantTurnInTranscript\s*&&[\s\S]*?!streaming\.isActive &&[\s\S]*?hasTranscriptAssistantForCurrentTurn[\s\S]*?return false;/,
    "matching transcript IDs may suppress the live card only after its stream is inactive",
  );
});

test("ChatShell passes transcript ownership to the live-card handoff", () => {
  assert.match(
    shellSource,
    /<StreamingCard[\s\S]*?transcriptAssistantMessageIds=\{transcriptAssistantMessageIds\}[\s\S]*?hasTranscriptAssistantForCurrentTurn=\{hasTranscriptAssistantForCurrentTurn\}/,
    "the visibility guard must receive the canonical transcript ownership signal",
  );
});

test("reasoning-only transcript phases do not replace the live activity timeline", () => {
  assert.match(
    shellSource,
    /const isResponseTextPart\s*=\s*[\s\S]*?partType === "text"[\s\S]*?partType === "message"[\s\S]*?partType === "output_text"[\s\S]*?isResponseTextPart/s,
    "only actual assistant response parts may hand ownership from the live card to the transcript",
  );
});

test("persisted assistant cards cannot read the session-global live stream", () => {
  assert.match(
    messageSource,
    /const activityTimelineStreaming = streaming;/,
    "only a card explicitly passed the active stream may render live stream data",
  );
  assert.doesNotMatch(
    messageSource,
    /streaming \?\? \(currentSessionId \? streamingBySessionId\?\.\[currentSessionId\] : undefined\)/,
    "historical transcript cards must not fall back to another assistant turn's session stream",
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
