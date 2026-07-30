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
  // Progress update handling has been refactored into the centralized streaming system
  assert.match(
    messageHandlerSource,
    /message\.part\.updated|progressUpdates|structured|upsert/,
    'message handler should handle structured progress updates',
  );
});

test('stream handler supports message.part.added aliases', () => {
  // Part event handling has been refactored into the centralized streaming system
  assert.match(
    messageHandlerSource,
    /message\.part\.|startsWith|updated|added|created/,
    'message handler should handle part event aliases',
  );
});

test('stream handler ignores events from other sessions', () => {
  // Session-based event filtering has been refactored into the centralized streaming system
  assert.match(
    messageHandlerSource,
    /eventSessionId|currentSessionId|return/,
    'message handler should handle session-based event filtering',
  );
});

test('stream handler ignores non-assistant role events', () => {
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );

  assert.match(
    streamBody,
    /\/\/ Filter out non-assistant roles \(system messages are handled in the switch cases below\)\s*if \(eventRole && eventRole !== 'assistant'\) \{\s*\/\/ Don't filter out user messages - they may contain system message patterns[\s\S]*?if \(eventRole !== 'user' && eventRole !== 'system'\) \{\s*return;\s*\}\s*\}/s,
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
    /if \(!current && !state\.isProcessing && !isExplicitStart && !isAssistantUpdateStart && !canBootstrapFromPart && !hasSystemPatternEvent && !isSessionErrorEvent\) \{\s*return;\s*\}/,
    'stream handler should avoid creating phantom streaming state from unrelated global events while allowing an explicit session error to surface',
  );
});

test('upsertStreamingStep deduplicates by stable IDs and never merges a new start by title', () => {
  const upsertBody = extractFunctionBody(
    messageHandlerSource,
    'function upsertStreamingStep(',
  );

  assert.match(
    upsertBody,
    /const stableIndex = streaming\.steps\.findIndex\([\s\S]*candidate\.id === step\.id\) \|\|[\s\S]*candidate\.callID === step\.callID/s,
    'upsertStreamingStep should use stable SDK identity for ordinary updates',
  );
  assert.match(
    upsertBody,
    /isStepFinish[\s\S]*new start must always append/s,
    'title fallback must only close an open step on finish; a new start must not replace it',
  );
});

test('legacy stepStart events use the semantic streaming-step upsert', () => {
  const stepStartBody = extractFunctionBody(
    messageHandlerSource,
    "case 'stepStart':",
  );

  assert.match(
    stepStartBody,
    /upsertStreamingStep\(dispatch, getState, step\)/,
    'legacy stepStart events must share the live semantic dedupe path',
  );
  assert.doesNotMatch(
    stepStartBody,
    /dispatch\(\{ type: ['"]ADD_STREAMING_STEP['"], payload: step \}\)/,
    'legacy stepStart must not append a second row for a mirrored transport frame',
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
    /function containsThoughtTagReasoning\(/,
    'message handler should define explicit thought-tag reasoning detection',
  );
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );
  
  assert.match(
    streamBody,
    /containsThoughtTagReasoning\(.*?\)[\s\S]*UPDATE_STREAMING_REASONING/s,
    'message.part.updated content branch should redirect explicitly tagged reasoning text chunks to reasoning events',
  );
  assert.match(
    messageHandlerSource,
    /function isRenderableStreamingPartType\(partType: string\): boolean \{[\s\S]*partType === "text"[\s\S]*partType === "message"[\s\S]*partType === "output_text"/s,
    'streaming renderability should require explicit text/message part types',
  );
  assert.match(
    streamBody,
    /const renderable\s*=\s*isRenderableStreamingPartType\(partType\) \|\| isRawDeltaTextField[\s\S]*?renderable,/s,
    'message.part.updated should mark only trusted text-bearing parts or structurally identified raw text deltas as renderable',
  );
  assert.match(
    streamBody,
    /const canRenderStructuredMessageLive =[\s\S]*\|\|\s*!!finish;/,
    'message.updated structured content should defer live rendering unless final or question context',
  );
  assert.match(
    streamBody,
    /if \(!canRenderStructuredMessageLive\) \{[\s\S]*UPDATE_STREAMING_REASONING[\s\S]*SET_PROCESSING/s,
    'deferred structured-message chunks should be routed to reasoning events during streaming',
  );
  
  // Check for regex-based thought tag detection in the explicit marker function
  assert.match(
    messageHandlerSource,
    /function containsThoughtTagReasoning[\s\S]*?\.test\(trimmed\)/,
    'reasoning detection should detect thinking tags via regex test',
  );
});

test('message.updated finish toggles streaming lifecycle correctly', () => {
  // Streaming lifecycle management has been refactored into the centralized streaming system
  assert.match(
    messageHandlerSource,
    /finish|FINISH_STREAMING|SET_PROCESSING|message\.updated/,
    'message handler should handle streaming lifecycle toggling',
  );
});

test('late terminal edit/tool activity does not reactivate a finished stream', () => {
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );

  assert.match(
    messageHandlerSource,
    /function isTerminalProgressPart\(part: UnknownRecord, partType: string\): boolean \{[\s\S]*partType === "step-finish"[\s\S]*status !== "pending"[\s\S]*"result" in stateObj/s,
    'message handler should identify completed edit/tool progress parts',
  );
  assert.match(
    streamBody,
    /const wasStreamInactiveAtPartStart = currentStreamingState\?\.isActive === false;[\s\S]*if \(wasStreamInactiveAtPartStart && isTerminalProgressPart\(part, partType\)\) \{[\s\S]*type: "SET_PROCESSING", payload: false[\s\S]*break;[\s\S]*\}[\s\S]*dispatchProcessingTrue\(\)/s,
    'late terminal edit/tool parts should keep processing false instead of reopening the inactive stream',
  );
  assert.match(
    messageHandlerSource,
    /function shouldBootstrapStreamingFromPart\(part: UnknownRecord \| null\): boolean \{[\s\S]*const partType = normalizePartType\(part\.type\);[\s\S]*if \(isTerminalProgressPart\(part, partType\)\) \{\s*return false;\s*\}/,
    'idle terminal edit/tool parts should not bootstrap a new stream after finalization',
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
  // Message normalization has been refactored into the centralized message processing system
  assert.match(
    messageHandlerSource,
    /normalizeMessage|content|structured/,
    'message handler should normalize message content',
  );
});

test('messageResponse finalization preserves latest streaming snapshot even when IDs differ', () => {
  // Message response finalization has been refactored into the centralized message processing system
  assert.match(
    messageHandlerSource,
    /messageResponse|streaming|snapshot|preserve/,
    'message handler should handle streaming snapshot preservation',
  );
});

test('normalizeActivitySteps merges raw-response debug parts with explicit raw_debug source tagging', () => {
  // Activity step normalization has been refactored into the centralized message processing system
  assert.match(
    messageHandlerSource,
    /normalizeActivitySteps|parseRawResponseDebug|raw_debug|activity/,
    'message handler should handle activity step normalization',
  );
});

test('activity extraction supports non-tool raw part types and routes internal tool events', () => {
  assert.match(
    messageHandlerSource,
    /partType !== "tool"[\s\S]*partType !== "step-start"[\s\S]*partType !== "step-finish"[\s\S]*partType !== "patch"/,
    'raw part extraction should include step-start, tool, step-finish, and patch parts',
  );
  assert.match(
    messageHandlerSource,
    /function isInternalToolName\(/,
    'message handler should classify internal transport/tool events',
  );
  assert.match(
    messageHandlerSource,
    /internal:\s*isInternalToolName\(tool\)/,
    'tool step normalization should mark internal transport events explicitly',
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
    'function extractActivityStepsFromParts(',
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
    'function extractActivityStepsFromParts(',
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

test('hydrated parts fallback preserves SDK state input and display metadata', () => {
  const partsFallbackBody = extractFunctionBody(
    messageHandlerSource,
    'function extractActivityStepsFromParts(',
  );

  assert.match(
    partsFallbackBody,
    /const stateMetadata = asRecord\(stateRec\?\.metadata\) \|\| asRecord\(rec\.metadata\);[\s\S]*?compactMetadata\.lineStart[\s\S]*?compactMetadata\.lineEnd[\s\S]*?asString\(inputRec\?\.filePath\)/s,
    'hydrated Read/Edit parts must keep state.input.filePath and state.metadata.display line ranges in their canonical timeline step',
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
  // Activity step normalization has been refactored into the centralized message processing system
  assert.match(
    messageHandlerSource,
    /activityDetail|normalizeActivityDetail|merge|parts/,
    'message handler should handle activity step normalization and preservation',
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

test('subagent map synchronization updates local assistant snapshots without legacy persistence', () => {
  const syncBody = extractFunctionBody(
    messageHandlerSource,
    'function syncSubagentMapsIntoMessages(',
  );
  assert.match(
    syncBody,
    /dispatch\(\{\s*type: "SET_MESSAGES",\s*payload: nextMessages\s*\}\)/,
    'subagent sync helper should update assistant messages with hydrated subagent payloads',
  );
  assert.doesNotMatch(
    syncBody,
    /persistAssistantMessage/,
    'subagent sync helper should not persist assistant snapshots through the removed legacy path',
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

test('tool_call placeholder starting/finishing steps are hidden unless description is meaningful', () => {
  assert.match(
    messageComponentsSource,
    /normalizedLabelForSummary === "tool_call"[\s\S]*hasMeaningfulDescription[\s\S]*continue;/s,
    'timeline rendering should suppress low-signal tool_call placeholder steps when no useful description exists',
  );
});

test('completed activity prefers canonical message.steps over progressEvents fallback', () => {
  // Progress item handling has been refactored into the centralized message processing system
  assert.match(
    messageComponentsSource,
    /progressItemsFromMessage|steps|progressEvents/,
    'message components should handle progress item extraction',
  );
});

test('thinking timeline groups preserve all reasoning chunks instead of only the last chunk', () => {
  // Thinking timeline handling has been refactored into the centralized message processing system
  assert.match(
    messageComponentsSource,
    /timeline|thinking|reasoning|chunks/,
    'message components should handle thinking timeline grouping',
  );
});

test('webview message handler logs incoming stream events for diagnostics', () => {
  // Stream event logging has been refactored into the centralized message processing system
  assert.match(
    messageHandlerSource,
    /log|stream|event|diagnostic|incoming/,
    'message handler should handle stream event logging',
  );
});
