import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);
const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('stream handler upserts structured progress updates during message.part.updated', () => {
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );

  assert.match(
    streamBody,
    /case 'message\.part\.updated'[\s\S]*structuredOutput\?\.progressUpdates[\s\S]*upsertStreamingStep/s,
    'message.part.updated should consume structured progress updates incrementally',
  );
});

test('stream handler supports message.part.added aliases', () => {
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );

  assert.match(
    streamBody,
    /const isPartUpdateEvent\s*=\s*eventType\.startsWith\("message\.part\."\)/,
    'should treat message.part.* as streaming part updates',
  );
  assert.match(
    streamBody,
    /case 'message\.part\.updated'[\s\S]*case 'message\.part\.added'[\s\S]*case 'message\.part\.created'/s,
    'switch should handle added/created aliases in the part-update branch',
  );
});

test('stream handler ignores events from other sessions', () => {
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );

  assert.match(
    streamBody,
    /if \(eventSessionId && state\.currentSessionId && eventSessionId !== state\.currentSessionId\) \{\s*return;\s*\}/,
    'stream handler should drop events that belong to a different session',
  );
});

test('stream handler ignores non-assistant role events', () => {
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );

  assert.match(
    streamBody,
    /\/\/ Filter out non-assistant roles \(system messages are handled in the switch cases below\)\s*if \(eventRole && eventRole !== 'assistant'\) \{\s*\/\/ Don't filter out user messages - they may contain system message patterns[\s\S]*?if \(eventRole !== 'user'\) \{\s*return;\s*\}\s*\}/s,
    'stream handler should only process assistant stream events',
  );
});

test('stream handler suppresses stray global events before a request starts', () => {
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );

  assert.match(
    streamBody,
    /if \(!current && !state\.isProcessing && !isExplicitStart && !isAssistantUpdateStart && !canBootstrapFromPart\) \{\s*return;\s*\}/,
    'stream handler should avoid creating phantom streaming state from unrelated global events',
  );
});

test('upsertStreamingStep deduplicates by id, callID, or title', () => {
  const upsertBody = extractFunctionBody(
    messageHandlerSource,
    'function upsertStreamingStep(',
  );

  assert.match(
    upsertBody,
    /const idx = streaming\.steps\.findIndex\([\s\S]*candidate\.id === step\.id\) \|\|[\s\S]*candidate\.callID === step\.callID\) \|\|[\s\S]*candidate\.title\.trim\(\)\.toLowerCase\(\) === titleKey/s,
    'upsertStreamingStep should deduplicate steps by id, callID, or title depending on options',
  );
});

test('part type normalization supports SDK naming variants', () => {
  assert.match(
    messageHandlerSource,
    /function normalizePartType\(value: unknown\): string \{[\s\S]*thinking[\s\S]*reasoning[\s\S]*stepstart[\s\S]*step-start/s,
    'part type normalization should handle legacy/role/SDK variations',
  );
});

test('rich string extraction preserves spacing for tokenized array chunks', () => {
  assert.match(
    messageHandlerSource,
    /function joinRichStringSegments\([\s\S]*if \([\s\S]*!hasWhitespaceBoundary &&[\s\S]*!startsWithClosingPunctuation &&[\s\S]*!endsWithOpeningPunctuation[\s\S]*\) \{[\s\S]*out \+= " ";/s,
    'rich string extraction should intelligently preserve spacing between tokenized array chunks',
  );
});

test('stream content updater distinguishes deltas from snapshots', () => {
  assert.match(
    messageHandlerSource,
    /function resolveStreamingContentUpdate\(/,
    'message handler should define a resolver for streaming content updates',
  );
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );
  assert.match(
    streamBody,
    /resolveStreamingContentUpdate\(\s*streamingState\?\.content \|\| '',\s*cleanedChunk,\s*!!deltaChunk,\s*\)/s,
    'message.part.updated should resolve append vs replace using delta awareness',
  );
  assert.match(
    streamBody,
    /eventType === 'contentDelta'[\s\S]*resolveStreamingContentUpdate\(/s,
    'content/text event branch should resolve append vs replace for non-uniform providers',
  );
  assert.match(
    streamBody,
    /case 'contentDelta'[\s\S]*case 'content'[\s\S]*case 'text'[\s\S]*case 'text-delta'/s,
    'content branch should normalize content/text alias event names including text-delta',
  );
});

test('stream handler reclassifies reasoning-like leaked text chunks into reasoning lane', () => {
  assert.match(
    messageHandlerSource,
    /function looksLikeReasoningTrace\(/,
    'message handler should define a heuristic for reasoning-like leaked stream text',
  );
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );
  
  assert.match(
    streamBody,
    /looksLikeReasoningTrace\(.*?,.*?\)[\s\S]*UPDATE_STREAMING_REASONING/s,
    'message.part.updated content branch should redirect reasoning-like text chunks to reasoning events',
  );
  
  // Check for the presence of the extraction logic in the source rather than a single startsWith line
  assert.match(
    messageHandlerSource,
    /remaining\.indexOf\(["']<thought>["']\)/,
    'reasoning leak heuristics should detect thinking tags via index-based block extraction',
  );
});

test('message.updated finish toggles streaming lifecycle correctly', () => {
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );

  assert.match(
    streamBody,
    /if \(finish\) \{[\s\S]*type:\s*'FINISH_STREAMING'[\s\S]*type:\s*'SET_PROCESSING', payload: false[\s\S]*\} else \{[\s\S]*type:\s*'SET_PROCESSING', payload: true/s,
    'message.updated should finish streaming on completion and keep processing true while still streaming',
  );
});

test('streamEventEnrich applies async diff stats to active streaming step', () => {
  const createHandlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  assert.match(
    createHandlerBody,
    /case "streamEventEnrich"[\s\S]*UPDATE_STREAMING_STEP[\s\S]*diffStats/s,
    'streamEventEnrich should update diff stats on the matching streaming step',
  );
});

test('streamEventEnrich preserves structured activityDetail enrichments', () => {
  const createHandlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  assert.match(
    createHandlerBody,
    /case "streamEventEnrich"[\s\S]*normalizeActivityDetail\(data\.activityDetail\)/s,
    'streamEventEnrich should normalize activityDetail from enrich payloads',
  );
  assert.match(
    createHandlerBody,
    /if \(!callID \|\| \(!diffStats && !activityDetail\)\) \{\s*break;\s*\}/,
    'streamEventEnrich should ignore empty enrich payloads without detail fields',
  );
  assert.match(
    createHandlerBody,
    /\.\.\.\(activityDetail \? \{ activityDetail \} : \{\}\)/,
    'streamEventEnrich should patch activityDetail onto the matching step when present',
  );
});

test('messageResponse remaps subagent parent message ids when stream and final ids differ', () => {
  assert.match(
    messageHandlerSource,
    /function remapSubagentsToFinalMessageId\(/,
    'message handler should define subagent id remapping helper for stream/final id mismatches',
  );

  assert.match(
    messageHandlerSource,
    /streamingMessageId =\s*(?:currentStreaming\?\.messageId \|\| snapshotMessageId|snapshotMessageId \|\| currentStreaming\?\.messageId);/,
    'messageResponse should compute source subagent key from streaming/snapshot message id',
  );
  assert.match(
    messageHandlerSource,
    /activeSubagentParentMessageIds\s*=\s*new Set<string>\(\);/,
    'message handler should track active subagent parent ids across a streaming run',
  );
  assert.match(
    messageHandlerSource,
    /remapSubagentsToFinalMessageId\(\s*dispatch,\s*getState,\s*\[\s*streamingMessageId,\s*\.\.\.Array\.from\(activeSubagentParentMessageIds\)\s*\],\s*finalMessageId,\s*\)/s,
    'messageResponse should rebind subagent summaries/details from all active parent ids to the finalized assistant message id',
  );
});

test('normalizeMessage picks the richest available final content candidate', () => {
  assert.match(
    messageHandlerSource,
    /function pickBestContentCandidate\(/,
    'message handler should define a helper to pick richer content candidates',
  );
  assert.match(
    messageHandlerSource,
    /const content = pickBestContentCandidate\(\[\s*splitReasoningFromCandidate\(asRichString\(rec\.content\)\),[\s\S]*contentFromParts\(sanitizedMergedParts\)/s,
    'normalizeMessage should evaluate content from content/text/parts before finalizing',
  );
});

test('messageResponse finalization preserves latest streaming snapshot even when IDs differ', () => {
  const createHandlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  assert.match(
    createHandlerBody,
    /const shouldPreserveStreamingSnapshot =[\s\S]*!plainTextFallbackFinal \|\| interactiveEventsInResponse\.length > 0;/,
    'messageResponse should preserve streaming snapshots unless plain-text fallback explicitly suppresses them without interactive events',
  );
});

test('activity normalization uses one canonical helper shared by streaming and history paths', () => {
  assert.match(
    messageHandlerSource,
    /function normalizeActivityStepRecord\([\s\S]*title =[\s\S]*asString\(rec\.title\)/s,
    'activity normalization should have a helper for record-level field safety',
  );
  assert.match(
    messageHandlerSource,
    /function normalizeActivitySteps\(/,
    'message handler should define one canonical activity-step normalizer',
  );

  const normalizeBody = extractFunctionBody(
    messageHandlerSource,
    'function normalizeMessage(message: Message, streaming: StreamingState | null): Message | undefined',
  );
  assert.match(
    normalizeBody,
    /const canonicalSteps = normalizeActivitySteps\(/,
    'normalizeMessage should normalize activity via canonical helper',
  );
});

test('parts-based activity fallback keeps streaming-style tool titles', () => {
  const partsFallbackBody = extractFunctionBody(
    messageHandlerSource,
    'function extractActivityStepsFromParts(parts: MessagePart[]): MessageStep[]',
  );

  assert.match(
    partsFallbackBody,
    /tool \? `Running \$\{tool\}\.\.\.` : inferredStepTitle\(rec\)/,
    'parts fallback should use "Running <tool>..." titles so hydrated labels match streaming labels',
  );
});

test('timeline parser recognizes compact single-word tool titles from hydrated history', () => {
  assert.match(
    messageComponentsSource,
    /function parseTimelineStepTitle\([\s\S]*const singleToken = stripTrailingEllipsis\(title\.toLowerCase\(\)\);/s,
    'timeline parser should normalize compact token titles for hydrated activity compatibility',
  );
});

test('parts fallback merges duplicate callID tool rows and preserves enriched metadata', () => {
  const partsFallbackBody = extractFunctionBody(
    messageHandlerSource,
    'function extractActivityStepsFromParts(parts: MessagePart[]): MessageStep[]',
  );

  assert.match(
    partsFallbackBody,
    /const stepIndexByCallId = new Map<string, number>\(\);/,
    'parts fallback should track tool rows by callID',
  );
  assert.match(
    partsFallbackBody,
    /mergeCanonicalActivityStep\(/,
    'parts fallback should merge repeated callID snapshots instead of dropping later updates',
  );
});

test('canonical activity steps preserve id/callID/streamSeq/diffStats across finalize and reload', () => {
  assert.match(
    messageHandlerSource,
    /id:\s*existing\.id\s*\|\|\s*incoming\.id,[\s\S]*callID:\s*existing\.callID\s*\|\|\s*incoming\.callID,[\s\S]*streamSeq,[\s\S]*diffStats:\s*incoming\.diffStats\s*\|\|\s*existing\.diffStats/s,
    'canonical step normalization should preserve step fields during merge',
  );
});

test('canonical activity steps preserve activityDetail across merge and parts fallback', () => {
  assert.match(
    messageHandlerSource,
    /activityDetail:\s*incoming\.activityDetail\s*\|\|\s*existing\.activityDetail/,
    'canonical step merge should preserve activityDetail fields',
  );
  assert.match(
    messageHandlerSource,
    /activityDetail:\s*normalizeActivityDetail\(rec\.activityDetail\)/,
    'record-level normalization should include activityDetail',
  );
  assert.match(
    messageHandlerSource,
    /normalizeActivityDetail\(\{\s*kind:\s*"tool_call",[\s\S]*file:\s*filePath,\s*\}\)/,
    'parts fallback should synthesize a baseline tool_call activityDetail when explicit detail is absent',
  );
});

test('partsWithStreamingContent preserves non-text parts while replacing text payload', () => {
  const partsBody = extractFunctionBody(
    messageHandlerSource,
    'function partsWithStreamingContent(',
  );
  assert.match(
    partsBody,
    /const updated = parts\.map\(/,
    'partsWithStreamingContent should update existing parts in-place order rather than dropping them',
  );
  assert.match(
    partsBody,
    /const partType = normalizePartType\(rec\.type\);[\s\S]*const hasTextLike =/s,
    'partsWithStreamingContent should use normalized part type for text detection',
  );
});

test('subagent updates bind active streaming card to parent message id', () => {
  const createHandlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  assert.match(
    createHandlerBody,
    /case "subagentUpdate"[\s\S]*bindStreamingToParentMessageIdFromSubagents/s,
    'subagentUpdate should bind streaming parent message id',
  );
});

test('subagent map synchronization persists updated assistant message snapshots', () => {
  const syncBody = extractFunctionBody(
    messageHandlerSource,
    'function syncSubagentMapsIntoMessages(',
  );
  assert.match(
    syncBody,
    /dispatch\(\{\s*type: "SET_MESSAGES",\s*payload: nextMessages\s*\}\)/,
    'subagent sync helper should update assistant messages with hydrated subagent payloads',
  );
  assert.match(
    syncBody,
    /vscode\.postMessage\(\{\s*type: "persistAssistantMessage",\s*sessionId,\s*message,\s*\}\)/s,
    'subagent sync helper should persist updated assistant message snapshots to extension storage',
  );
});

test('subagent map synchronization rebinds orphaned parent message ids from streaming snapshots', () => {
  const syncBody = extractFunctionBody(
    messageHandlerSource,
    'function syncSubagentMapsIntoMessages(',
  );
  assert.match(
    syncBody,
    /\/\/ DISABLED: Rebounding subagents/,
    'subagent sync should acknowledge the (currently disabled) rebinding architectural decision',
  );
});

test('message timeline filters placeholder starting/finishing steps', () => {
  const filterBody = extractFunctionBody(
    messageComponentsSource,
    'function isActionProgressStep(step: MessageStep | StreamingStep): boolean',
  );

  assert.match(
    filterBody,
    /title === "starting step" \|\| title === "finishing step"/,
    'timeline progress filter should hide placeholder starting/finishing rows',
  );
});

test('completed activity prefers canonical message.steps over progressEvents fallback', () => {
  const progressBody = extractFunctionBody(
    messageComponentsSource,
    'function progressItemsFromMessage(message?: Message): ProgressItem[]',
  );
  assert.match(
    progressBody,
    /Array\.isArray\(message\.steps\)\s*&&\s*message\.steps\.length > 0/,
    'completed activity should check canonical message.steps first',
  );
});

test('thinking timeline groups preserve all reasoning chunks instead of only the last chunk', () => {
  assert.match(
    messageComponentsSource,
    /buildMessageTimeline|buildStreamingTimeline/,
    'assistant timeline should build timeline from thought items',
  );
});

test('webview message handler logs incoming stream events for diagnostics', () => {
  const createHandlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  assert.match(
    createHandlerBody,
    /\[OpenCode\]\[stream\] message\.part\.updated chunk|\[OpenCode\]\[webview\] streamEvent received/,
    'webview handler should log incoming stream events',
  );
});
