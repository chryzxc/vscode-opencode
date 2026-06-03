import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

const handleStreamEventBody = extractFunctionBody(source, 'function handleStreamEvent(');
const normalizeMessageBody = extractFunctionBody(
  source,
  'function normalizeMessage(message: Message, streaming: StreamingState | null): Message | undefined {',
);
const normalizeStructuredOutputBody = extractFunctionBody(
  source,
  'function normalizeStructuredOutput(value: unknown): StructuredOutput | undefined {',
);
const toInteractiveEventsBody = extractFunctionBody(
  source,
  'function toInteractiveEvents(structured?: StructuredOutput): InteractiveEvent[] {',
);
const upsertStreamingStepBody = extractFunctionBody(
  source,
  'function upsertStreamingStep(',
);
const createMessageHandlerBody = extractFunctionBody(
  source,
  'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState) {',
);

test('message handler source exposes the expected factory, helpers, and normalizers', () => {
  assert.match(
    source,
    /export function createMessageHandler\(dispatch: Dispatch<AppAction>, getState: \(\) => AppState\)/,
    'createMessageHandler factory should be exported',
  );
  assert.match(source, /function handleStreamEvent\(/, 'handleStreamEvent should exist');
  assert.match(source, /function normalizeMessage\(/, 'normalizeMessage should exist');
  assert.match(source, /function normalizeStructuredOutput\(/, 'normalizeStructuredOutput should exist');
  assert.match(source, /function toInteractiveEvents\(/, 'toInteractiveEvents should exist');
  assert.match(source, /function upsertStreamingStep\(/, 'upsertStreamingStep should exist');
  assert.match(source, /function asRecord\(/, 'asRecord helper should exist');
  assert.match(source, /function asString\(/, 'asString helper should exist');
  assert.match(source, /function asNumber\(/, 'asNumber helper should exist');
  assert.match(source, /function asBoolean\(/, 'asBoolean helper should exist');
  assert.match(source, /function joinRichStringSegments\(/, 'joinRichStringSegments helper should exist');
});

test('chat history hydration restores context usage from latest assistant tokens', () => {
  assert.match(
    source,
    /function findLatestContextInputTokens\(messages: Message\[\]\)/,
    'message handler should derive context usage from hydrated message tokens',
  );
  assert.match(
    source,
    /function calculateContextUsagePct\([\s\S]*contextLimit[\s\S]*inputTokens \/ contextLimit/,
    'context usage should divide latest input tokens by the matched model context limit',
  );
  assert.match(
    createMessageHandlerBody,
    /case "chatHistory":[\s\S]*RESET_SESSION_STATS[\s\S]*dispatchContextUsageFromMessages\(dispatch, getState\(\), canonicalMessages\)/,
    'chatHistory should restore the sticky-header context percentage after resetting session stats',
  );
  assert.match(
    createMessageHandlerBody,
    /case "modelsList":[\s\S]*SET_MODELS_LIST[\s\S]*dispatchContextUsageFromMessages\(dispatch, getState\(\), getState\(\)\.messages\)/,
    'modelsList should recalculate context usage when model context limits arrive after history',
  );
});

test('handleStreamEvent routes lifecycle and streaming dispatch patterns', () => {
  assert.match(handleStreamEventBody, /case 'message\.part\.updated':/, 'part update case should exist');
  assert.match(handleStreamEventBody, /case 'message\.updated':/, 'message.updated case should exist');
  assert.match(handleStreamEventBody, /case 'session\.error':[\s\S]*case 'error':/, 'error cases should exist');
  assert.match(handleStreamEventBody, /case 'start':[\s\S]*case 'streamStart':/, 'start cases should exist');
  assert.match(handleStreamEventBody, /type: "SET_STREAMING"/, 'stream start path should dispatch SET_STREAMING');
  assert.match(handleStreamEventBody, /type: "UPDATE_STREAMING_CONTENT"/, 'part updates should dispatch UPDATE_STREAMING_CONTENT');
  assert.match(handleStreamEventBody, /type: "UPDATE_STREAMING_REASONING"/, 'reasoning updates should dispatch UPDATE_STREAMING_REASONING');
  assert.match(handleStreamEventBody, /type: "ADD_STREAMING_STEP"|upsertStreamingStep\(/, 'stream steps should be upserted');
  assert.match(handleStreamEventBody, /type: "FINISH_STREAMING"/, 'terminal paths should dispatch FINISH_STREAMING');
  assert.match(handleStreamEventBody, /type: 'SET_PROCESSING'|type: "SET_PROCESSING"/, 'stream handler should manage processing state');
  assert.match(
    handleStreamEventBody,
    /rawReasoningLike[\s\S]*UPDATE_STREAMING_REASONING[\s\S]*break;/,
    'reasoning leak detection should divert leaked reasoning into reasoning state',
  );
  assert.match(
    source,
    /function looksLikeReasoningPlanningText\(/,
    'message handler should define a planning-style reasoning detector for SDK text-only reasoning chunks',
  );
  assert.match(
    handleStreamEventBody,
    /hasSystemMessagePatternInText\(partText\)[\s\S]*upsertRealtimeSystemMessage\(partText\)/,
    'system-message parts should be routed into realtime system-message upsert path',
  );
  assert.match(
    handleStreamEventBody,
    /Keep realtime system banners separate from the active assistant snapshot[\s\S]*const existingMessages = stateNow\.messages \|\| \[\];/,
    'system-message upserts should avoid duplicating the live streaming snapshot in history',
  );
});

test('handleStreamEvent ingests structured output, interactive events, subagents, and todos', () => {
  assert.match(
    handleStreamEventBody,
    /structuredOutput|normalize|payload|info/i,
    'handleStreamEvent should normalize structured output from payload, properties, and info records',
  );
  assert.match(
    handleStreamEventBody,
    /progressUpdates|upsertStreamingStep|streaming|step/i,
    'structured progress updates should become streaming steps',
  );
  assert.match(
    handleStreamEventBody,
    /const interactiveEvents = toInteractiveEvents\(structuredOutput\);[\s\S]*type: "SET_INTERACTIVE_EVENTS"/,
    'structured interactive events should be dispatched into reducer state',
  );
  assert.match(
    handleStreamEventBody,
    /maybeInjectStreamingInteractiveContext\([\s\S]*interactiveEvents/,
    'interactive event ingestion should synthesize assistant-bubble context when needed',
  );
  assert.match(
    handleStreamEventBody,
    /applyStructuredSubagentPayload\(dispatch, getState, structuredOutput, messageId\)/,
    'structured subagent payloads should be delegated to applyStructuredSubagentPayload',
  );
  assert.match(
    source,
    /function applyStructuredSubagentPayload\([\s\S]*structuredOutput\.subagentsDelta[\s\S]*UPSERT_SUBAGENT_SUMMARIES[\s\S]*UPSERT_SUBAGENT_DETAIL/s,
    'subagentsDelta payloads should upsert summaries/details inside applyStructuredSubagentPayload',
  );
  assert.match(
    handleStreamEventBody,
    /structuredOutput\.responseType === '__legacy_disabled_todo_update'[\s\S]*normalizeTodoRecord\([\s\S]*ingestNormalizedTodo\(/,
    'todo_update structured payloads should normalize and ingest todo items',
  );
  assert.match(
    source,
    /function normalizeTodoRecord\([\s\S]*allowedStatuses = new Set\([\s\S]*'pending'[\s\S]*'in_progress'[\s\S]*'completed'[\s\S]*'cancelled'[\s\S]*'failed'/,
    'normalizeTodoRecord should validate canonical todo statuses',
  );
  assert.match(
    source,
    /function ingestNormalizedTodo\([\s\S]*type: 'UPDATE_TODO_ITEM'[\s\S]*type: 'ADD_TODO_ITEM'/,
    'ingestNormalizedTodo should choose UPDATE_TODO_ITEM or ADD_TODO_ITEM based on existing IDs',
  );
});

test('normalizeStructuredOutput validates and sanitizes generated-schema payloads', () => {
  assert.match(
    normalizeStructuredOutputBody,
    /const sanitizedRec = sanitizeStructuredOutput\(rec\);[\s\S]*const validation = validateStructuredOutput\(sanitizedRec\);[\s\S]*if \(!validation\.valid\)[\s\S]*return undefined;/,
    'normalizeStructuredOutput should validate incoming payloads and reject invalid ones',
  );
  assert.match(normalizeStructuredOutputBody, /const sanitizedRec = sanitizeStructuredOutput\(rec\);/, 'normalizeStructuredOutput should sanitize incoming payloads before validation');
  assert.match(
    normalizeStructuredOutputBody,
    /responseType[\s\S]*rawResponseType\.toLowerCase\(\) === "interactive"[\s\S]*\? "question"/,
    'interactive responseType should normalize to question',
  );
  assert.match(
    normalizeStructuredOutputBody,
    /const normalizedPlan = planRec[\s\S]*file:[\s\S]*content:[\s\S]*summary:/,
    'plan payloads should preserve file/content/summary fields',
  );
  assert.match(
    normalizeStructuredOutputBody,
    /const cleanedReasoning = reasoning[\s\S]*stripAssistantEchoFromReasoning/,
    'reasoning should be cleaned to avoid assistant echo leakage',
  );
  assert.match(
    normalizeStructuredOutputBody,
    /normalizeInteractiveEvent[\s\S]*typeRaw === 'confirm'[\s\S]*typeRaw === 'quick_actions'[\s\S]*typeRaw === 'question'[\s\S]*typeRaw === 'message'/,
    'normalizeStructuredOutput should normalize confirm, quick_actions, question, and message interactive events',
  );
  assert.match(
    normalizeStructuredOutputBody,
    /interactiveEvents.length === 0 && isInteractiveResponseType[\s\S]*type: 'question'/,
    'question responseType should synthesize a fallback interactive question when needed',
  );
  assert.doesNotMatch(
    normalizeStructuredOutputBody,
    /return\s+rec\s+as\s+StructuredOutput/,
    'normalizeStructuredOutput should not bypass validation with a raw cast',
  );
});

test('toInteractiveEvents maps structured events and question fallback into UI events', () => {
  assert.match(
    toInteractiveEventsBody,
    /event\.type === 'confirm'[\s\S]*type: 'confirm'/,
    'confirm events should map into confirm interactive events',
  );
  assert.match(
    toInteractiveEventsBody,
    /event\.type === 'quick_actions'[\s\S]*type: 'quick_actions'/,
    'quick_actions events should map into quick action interactive events',
  );
  assert.match(
    toInteractiveEventsBody,
    /event\.type === 'question'[\s\S]*options\.length < 2[\s\S]*return undefined;[\s\S]*type: 'question'/,
    'question events should require sufficient options and map into question events',
  );
  assert.match(
    toInteractiveEventsBody,
    /event\.type === 'message'[\s\S]*type: 'message'/,
    'message events should map into dismissible message events',
  );
  assert.match(
    toInteractiveEventsBody,
    /if \(mapped\.length === 0 && responseType === 'question' && questionObj\)[\s\S]*qType === 'confirm'[\s\S]*qType === 'quick_actions'[\s\S]*qType === 'message'[\s\S]*options\.length >= 2/,
    'question object fallback should synthesize confirm, quick_actions, message, or question events',
  );
  assert.doesNotMatch(
    toInteractiveEventsBody,
    /detectInteractiveEventsFromText/,
    'toInteractiveEvents should rely on structured payloads instead of plain-text heuristics',
  );
});

test('normalizeMessage blends streaming snapshots with final messages and structured output', () => {
  assert.match(
    normalizeMessageBody,
    /const normalizedStructuredOutput = resolveStructuredOutputFromMessageRecord\(rec\);/,
    'normalizeMessage should normalize structured output before content selection',
  );
  assert.match(
    normalizeMessageBody,
    /const preferStreamingContent = shouldPreferStreamingContent\([\s\S]*const shouldUseStreamingContent =[\s\S]*content: shouldUseStreamingContent \? streamingContent : content \|\| message\.content/,
    'normalizeMessage should prefer richer streaming content when appropriate',
  );
  assert.match(
    normalizeMessageBody,
    /parts: shouldUseStreamingContent[\s\S]*partsWithStreamingContent\(/,
    'normalizeMessage should merge streaming content back into parts when streaming wins',
  );
  assert.match(
    normalizeMessageBody,
    /hasStreamingReasoningSignal[\s\S]*looksLikeReasoningPlanningText\(textLike\)/,
    'normalizeMessage should detach planning-style leaked reasoning parts when streaming reasoning evidence exists',
  );
  assert.match(
    normalizeMessageBody,
    /if \(normalizedStructuredOutput\)[\s\S]*structuredOutput = normalizedStructuredOutput[\s\S]*toInteractiveEvents\(/,
    'normalizeMessage should preserve normalized structuredOutput and hydrate interactive events from it',
  );
  assert.match(
    normalizeMessageBody,
    /hasPlanAttachment[\s\S]*normalized\.responseType = "implementation_plan"/,
    'plan attachments should force implementation_plan response type',
  );
  assert.match(
    normalizeMessageBody,
    /responseType === "implementation_plan"[\s\S]*normalized\.content = introFromPlan \|\| summaryFromPlan;/,
    'implementation plans should fall back to intro or summary when body content is absent',
  );
  assert.match(
    normalizeMessageBody,
    /allEvents\.length > 0[\s\S]*normalized\.interactiveEvents = allEvents;[\s\S]*normalized\.responseType = "question"/,
    'tool-question and structured interactive events should mark final messages as question responses',
  );
  assert.doesNotMatch(
    normalizeMessageBody,
    /return\s+rec\s+as\s+Message/,
    'normalizeMessage should not short-circuit by returning the raw record directly',
  );
});

test('upsertStreamingStep uses stable dedupe keys and preserves terminal statuses', () => {
  assert.match(
    upsertStreamingStepBody,
    /findIndex\([\s\S]*step\.id && candidate\.id === step\.id[\s\S]*step\.callID && candidate\.callID === step\.callID[\s\S]*candidate\.title\.trim\(\)\.toLowerCase\(\) === titleKey/,
    'upsertStreamingStep should match by id, then callID, then title key',
  );
  assert.match(
    upsertStreamingStepBody,
    /idx < 0[\s\S]*type: "ADD_STREAMING_STEP"/,
    'upsertStreamingStep should add steps when no prior entry exists',
  );
  assert.match(
    upsertStreamingStepBody,
    /current\.status === "done" \|\| current\.status === "error"[\s\S]*step\.status === "pending"[\s\S]*nextStatus = current\.status/,
    'upsertStreamingStep should preserve terminal statuses when a stale pending update arrives',
  );
  assert.match(
    upsertStreamingStepBody,
    /type: "UPDATE_STREAMING_STEP"[\s\S]*patch: \{[\s\S]*status: nextStatus \|\| current\.status/,
    'upsertStreamingStep should patch the existing step when a match is found',
  );
});

test('createMessageHandler routes stream events and persists assistant messages through vscode.postMessage', () => {
  assert.match(
    createMessageHandlerBody,
    /case "streamEvent":[\s\S]*const payload = asRecord\(data\.event\) \?\? data;[\s\S]*handleStreamEvent\(dispatch, getState, payload, terminalErrorReached\);/,
    'createMessageHandler should forward streamEvent messages to handleStreamEvent',
  );
  assert.match(
    createMessageHandlerBody,
    /case "sessionsList":[\s\S]*type: "SET_SESSIONS_LIST"/,
    'createMessageHandler should route sessionsList updates into reducer state',
  );
  assert.match(
    createMessageHandlerBody,
    /interactiveEventsInResponse\.length > 0/,
    'createMessageHandler should preserve streaming state based on interactive response payloads',
  );
  assert.match(
    createMessageHandlerBody,
    /const isLikelyInteractiveAnswerSubmissionMessage = \(message: Message\): boolean => \{/,
    'createMessageHandler should define interactive answer submission detection',
  );
  assert.match(
    createMessageHandlerBody,
    /question\\s\+\\d\+\\s\*:[\s\S]*answer\\s\*:/,
    'interactive answer detection should require Question N and Answer markers',
  );
  assert.match(
    source,
    /vscode\.postMessage\(\{[\s\S]*type: "persistAssistantMessage"[\s\S]*sessionId,[\s\S]*message:/,
    'assistant snapshots and finalized messages should be persisted back to the extension host',
  );
  assert.doesNotMatch(
    createMessageHandlerBody,
    /Math\.random\(/,
    'message handler factory should not rely on Math.random for message persistence flow',
  );
});
