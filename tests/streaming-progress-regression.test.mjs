import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);
const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);
const panelComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'PanelComponents.tsx')],
  'PanelComponents.tsx',
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
    /isPartUpdateEvent[\s\S]*message\.part\.added[\s\S]*message\.part\.created/s,
    'should treat message.part.added/created as streaming part updates',
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
    /if \(eventRole && eventRole !== 'assistant'\) \{\s*return;\s*\}/,
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
    /step\.id && candidate\.id === step\.id/,
    'should match existing steps by step id',
  );
  assert.match(
    upsertBody,
    /step\.callID && candidate\.callID === step\.callID/,
    'should match existing steps by callID',
  );
  assert.match(
    upsertBody,
    /candidate\.title\.trim\(\)\.toLowerCase\(\)\s*===\s*titleKey/,
    'should match existing steps by normalized title',
  );
});

test('part type normalization supports SDK naming variants', () => {
  const normalizeBody = extractFunctionBody(
    messageHandlerSource,
    'function normalizePartType(value: unknown): string',
  );

  assert.match(normalizeBody, /step_start/, 'should normalize step_start');
  assert.match(normalizeBody, /stepfinish|step_finish/, 'should normalize step finish aliases');
  assert.match(normalizeBody, /tool_call|tool-call/, 'should normalize tool call aliases');
});

test('rich string extraction preserves spacing for tokenized array chunks', () => {
  assert.match(
    messageHandlerSource,
    /function joinRichStringSegments\(/,
    'message handler should define a spacing-aware segment join helper',
  );

  const richBody = extractFunctionBody(
    messageHandlerSource,
    'function asRichString(value: unknown): string',
  );

  assert.match(
    richBody,
    /joinRichStringSegments\(value\.map\(\(item\) => asRichString\(item\)\)\)/,
    'asRichString should use spacing-aware joining for array payloads',
  );
  assert.doesNotMatch(
    richBody,
    /\.join\(''\)/,
    'asRichString should not concatenate token arrays without spacing',
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
  assert.match(
    streamBody,
    /eventType === 'contentDelta'[\s\S]*eventType === 'text-delta'[\s\S]*!!asString\(payload\.delta\)/s,
    'content branch should treat text-delta and delta payloads as append-style updates',
  );
  assert.match(
    streamBody,
    /structuredKind === "message"[\s\S]*resolveStreamingContentUpdate\(/s,
    'structured message fallback should use the same merge resolver',
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
    /looksLikeReasoningTrace\(textChunk,\s*streamingState\?\.content \|\| ""\)[\s\S]*UPDATE_STREAMING_REASONING/s,
    'message.part.updated content branch should redirect reasoning-like text chunks to reasoning events',
  );
  assert.match(
    streamBody,
    /looksLikeReasoningTrace\(cleanedChunk,\s*streamingState\?\.content \|\| ""\)[\s\S]*UPDATE_STREAMING_REASONING/s,
    'content/text alias branch should redirect reasoning-like chunks to reasoning events',
  );
  assert.match(
    streamBody,
    /structuredKind === "message"[\s\S]*looksLikeReasoningTrace\(structuredText,\s*streamingState\?\.content \|\| ""\)[\s\S]*UPDATE_STREAMING_REASONING/s,
    'structured message fallback should reclassify reasoning-like text into reasoning lane',
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
  assert.match(
    streamBody,
    /const structuredMessage\s*=\s*structuredOutput\.assistantMessage\s*\|\|\s*structuredOutput\.message/,
    'message.updated finish should extract message from structured output',
  );
  assert.match(
    streamBody,
    /if \(structuredMessage\) \{[\s\S]*looksLikeReasoningTrace\([\s\S]*UPDATE_STREAMING_REASONING/s,
    'message.updated finish should route reasoning-like structured message payloads into reasoning events',
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

test('messageResponse finalization preserves latest streaming snapshot even when IDs differ', () => {
  const createHandlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );

  assert.match(
    createHandlerBody,
    /const streaming = currentStreaming \?\? latestStreamingSnapshot;/,
    'messageResponse should always fall back to latest streaming snapshot for normalization',
  );
  assert.match(
    createHandlerBody,
    /messageResponse id mismatch; preserving latest streaming snapshot/,
    'messageResponse should emit a debug breadcrumb when response and snapshot IDs differ',
  );
  assert.doesNotMatch(
    createHandlerBody,
    /snapshotMatchesResponse/,
    'messageResponse should not drop snapshots solely because IDs differ',
  );
});

test('messageResponse remaps subagent parent message ids when stream and final ids differ', () => {
  assert.match(
    messageHandlerSource,
    /function remapSubagentsToFinalMessageId\(/,
    'message handler should define subagent id remapping helper for stream/final id mismatches',
  );

  const createHandlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  assert.match(
    createHandlerBody,
    /const streamingMessageId =\s*currentStreaming\?\.messageId \|\| snapshotMessageId;/,
    'messageResponse should compute source subagent key from streaming/snapshot message id',
  );
  assert.match(
    createHandlerBody,
    /remapSubagentsToFinalMessageId\(\s*dispatch,\s*getState,\s*streamingMessageId,\s*finalMessageId,\s*\)/s,
    'messageResponse should rebind subagent summaries/details to the finalized assistant message id',
  );
  assert.match(
    createHandlerBody,
    /vscode\.postMessage\(\{\s*type:\s*"persistAssistantMessage",\s*sessionId,\s*message:\s*sanitized,\s*\}\)/s,
    'messageResponse should request extension-side persistence of the merged assistant message snapshot',
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
  assert.doesNotMatch(
    messageHandlerSource,
    /pickBestContentCandidate\([\s\S]*typeof message\.content === "string" \? message\.content : ""/s,
    'normalizeMessage should not re-introduce raw message.content fallback after splitting mixed reasoning',
  );
});

test('stream-final merge falls back to token overlap when final payload is condensed', () => {
  const preferBody = extractFunctionBody(
    messageHandlerSource,
    'function shouldPreferStreamingContent(',
  );
  assert.match(
    preferBody,
    /if \(splitMixedReasoningFromContent\(streamingContent\)\)\s*\{\s*return false;\s*\}/,
    'shouldPreferStreamingContent should reject mixed response+reasoning stream snapshots',
  );
  assert.match(
    preferBody,
    /const finalTokens = comparableTokens\(finalNorm\);/,
    'shouldPreferStreamingContent should tokenize final content for overlap checks',
  );
  assert.match(
    preferBody,
    /const overlapRatio = matchedFinalTokens \/ finalTokens\.length;/,
    'shouldPreferStreamingContent should compute overlap ratio between final and stream content',
  );
  assert.match(
    preferBody,
    /overlapRatio >= 0\.65/,
    'shouldPreferStreamingContent should keep richer stream content when overlap remains high',
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
    /const hasTextLike =[\s\S]*partType === "text"/s,
    'partsWithStreamingContent should only replace the first text-like part content',
  );
  assert.match(
    partsBody,
    /return \[\s*\{\s*type: "text",\s*text: streamingContent,\s*\} as MessagePart,\s*\.\.\.parts,\s*\];/s,
    'partsWithStreamingContent should prepend a text part when no text-like part exists',
  );
});

test('subagent updates bind active streaming card to parent message id', () => {
  const helperBody = extractFunctionBody(
    messageHandlerSource,
    'function bindStreamingToParentMessageIdFromSubagents(',
  );
  assert.match(
    helperBody,
    /!streaming \|\| !streaming\.isActive \|\| streaming\.messageId/,
    'should only bind while streaming is active and missing message id',
  );
  assert.match(
    helperBody,
    /type:\s*"SET_STREAMING"[\s\S]*messageId:\s*parentMessageIds\[0\]/s,
    'should set streaming.messageId from subagent parent message id',
  );

  const createHandlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  assert.match(
    createHandlerBody,
    /case "subagentUpdate"[\s\S]*bindStreamingToParentMessageIdFromSubagents/s,
    'subagentUpdate should bind streaming parent message id',
  );
  assert.match(
    createHandlerBody,
    /case "subagentSnapshot"[\s\S]*bindStreamingToParentMessageIdFromSubagents/s,
    'subagentSnapshot should bind streaming parent message id',
  );
});

test('default stream handler branch applies structured fallback updates', () => {
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );

  assert.match(
    streamBody,
    /default:\s*\{[\s\S]*structuredKind === "thinking"[\s\S]*UPDATE_STREAMING_REASONING/s,
    'default branch should apply structured thinking updates',
  );
  assert.match(
    streamBody,
    /default:\s*\{[\s\S]*structuredKind === "message"[\s\S]*UPDATE_STREAMING_CONTENT/s,
    'default branch should apply structured message updates',
  );
  assert.match(
    streamBody,
    /default:\s*\{[\s\S]*structuredKind === "progress"[\s\S]*upsertStreamingStep/s,
    'default branch should apply structured progress updates',
  );
  assert.match(
    streamBody,
    /default:\s*\{[\s\S]*if \(consumed\) \{[\s\S]*type:\s*"SET_PROCESSING", payload: true[\s\S]*\}/s,
    'default branch should only keep processing active when it consumed structured fallback data',
  );
});

test('empty subagentSnapshot does not clobber cards restored from chatHistory messages', () => {
  const createHandlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  assert.match(
    createHandlerBody,
    /case "subagentSnapshot"[\s\S]*const hasSnapshotSubagents =[\s\S]*extractSubagentsFromMessages\(getState\(\)\.messages\)/s,
    'subagentSnapshot handler should rebuild from loaded messages when snapshot payload is empty',
  );
  assert.match(
    createHandlerBody,
    /case "subagentSnapshot"[\s\S]*if \(!hasSnapshotSubagents\)[\s\S]*UPSERT_SUBAGENT_SUMMARIES[\s\S]*UPSERT_SUBAGENT_DETAIL[\s\S]*break;/s,
    'subagentSnapshot handler should avoid clearing restored subagent cards on empty payloads',
  );
  assert.match(
    createHandlerBody,
    /case "subagentSnapshot"[\s\S]*syncSubagentMapsIntoMessages\([\s\S]*"replace"[\s\S]*\);/s,
    'subagentSnapshot handler should synchronize subagent maps back into message snapshots',
  );
  assert.match(
    createHandlerBody,
    /case "subagentUpdate"[\s\S]*syncSubagentMapsIntoMessages\([\s\S]*"merge"[\s\S]*\);/s,
    'subagentUpdate handler should synchronize incremental subagent state into message snapshots',
  );
});

test('subagent map synchronization persists updated assistant message snapshots', () => {
  assert.match(
    messageHandlerSource,
    /function syncSubagentMapsIntoMessages\(/,
    'message handler should define helper for syncing subagent maps into message snapshots',
  );
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
  assert.match(
    syncBody,
    /deriveSessionIdFromMessage\(message,\s*(fallbackSessionId|currentSessionId)\)/,
    'subagent sync helper should derive target session id from message payload to avoid cross-session persistence drift',
  );
});

test('subagent map synchronization rebinds orphaned parent message ids from streaming snapshots', () => {
  assert.match(
    messageHandlerSource,
    /function getMessageId\(/,
    'message handler should expose helper to normalize message ids across info.id and message.id',
  );
  assert.match(
    messageHandlerSource,
    /function findLatestAssistantMessageIdForSession\(/,
    'message handler should expose helper for selecting a fallback assistant message id per session',
  );

  const syncBody = extractFunctionBody(
    messageHandlerSource,
    'function syncSubagentMapsIntoMessages(',
  );
  assert.match(
    syncBody,
    /if \(messageIds\.has\(parentMessageId\)\) \{\s*continue;\s*\}/,
    'subagent sync should skip rebinding when parent message id already matches a hydrated message',
  );
  assert.match(
    syncBody,
    /findLatestAssistantMessageIdForSession\(\s*state\.messages,\s*fallbackSessionId,\s*targetSessionId,\s*\)/s,
    'subagent sync should rebind orphaned groups to the latest assistant message in the target session',
  );
  assert.match(
    syncBody,
    /effectiveSummariesByParentMessageId\[reboundParentMessageId\]\s*=\s*mergeSubagentSummaries\(/,
    'subagent sync should merge rebound summaries under the resolved hydrated parent message id',
  );
  assert.match(
    syncBody,
    /allDetailsById\[summary\.id\]\s*=\s*\{[\s\S]*parentMessageId:\s*reboundParentMessageId/s,
    'subagent sync should realign detail.parentMessageId to the rebound hydrated message id',
  );
});

test('chatHistory message guard keeps assistant entries that only carry structured UI fields', () => {
  const isMessageBody = extractFunctionBody(
    messageHandlerSource,
    'function isMessage(value: unknown): value is Message',
  );
  assert.match(
    isMessageBody,
    /Array\.isArray\(rec\.subagents\)/,
    'isMessage should accept messages that only carry subagents payload for persisted UI rendering',
  );
  assert.match(
    isMessageBody,
    /typeof asRecord\(rec\.info\)\?\.role === 'string'/,
    'isMessage should accept nested info.role-only assistant records from persisted history',
  );
});

test('messageResponse hydrates missing subagents from streaming store state before persisting', () => {
  assert.match(
    messageHandlerSource,
    /function collectHydratedSubagentsFromState\(/,
    'message handler should collect subagent details from state maps',
  );
  assert.match(
    messageHandlerSource,
    /function mergeSubagentsIntoMessage\(/,
    'message handler should merge hydrated subagent details into final message payload',
  );
  const createHandlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  assert.match(
    createHandlerBody,
    /case "messageResponse"[\s\S]*collectHydratedSubagentsFromState\(\s*getState\(\),\s*\[provisionalFinalMessageId,\s*streamingMessageId\],\s*\)/s,
    'messageResponse should hydrate subagents from either final message id or streaming message id',
  );
  assert.match(
    createHandlerBody,
    /case "messageResponse"[\s\S]*if \([\s\S]*!asString\(asRecord\(sanitized\.info\)\?\.id\)[\s\S]*!asString\(sanitized\.id\)[\s\S]*streamingMessageId[\s\S]*\)[\s\S]*id: streamingMessageId/s,
    'messageResponse should backfill top-level message id from streaming id when provider omits final id',
  );
  assert.match(
    createHandlerBody,
    /case "messageResponse"[\s\S]*const sessionId = deriveSessionIdFromMessage\(\s*sanitized,\s*getState\(\)\.currentSessionId,\s*\)/s,
    'messageResponse persistence should derive session id from message metadata/subagent parent session id',
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

test('active task panel filters placeholder starting/finishing steps', () => {
  assert.match(
    panelComponentsSource,
    /title === "starting step" \|\| title === "finishing step"/,
    'Active Task progress list should hide placeholder starting/finishing rows',
  );
});

test('progress updates render extended details on a wrapped line under the title', () => {
  // Timeline implementation has evolved - check for displayEvents rendering
  assert.match(
    messageComponentsSource,
    /buildDisplayEvents/,
    'assistant timeline should build display events from timeline blocks',
  );
  assert.match(
    messageComponentsSource,
    /timelineBlocks|TimelineBlock/,
    'assistant timeline should use timeline blocks',
  );
});

test('assistant message resolves subagent parent key from info.id, message.id, or streaming.messageId', () => {
  assert.match(
    messageComponentsSource,
    /const messageId = info\?\.id \|\| message\?\.id \|\| streaming\?\.messageId;/,
    'assistant message should keep subagent card visible after streaming by falling back to top-level message.id',
  );
});

test('thinking timeline groups preserve all reasoning chunks instead of only the last chunk', () => {
  // Timeline implementation has evolved - check for block aggregation
  assert.match(
    messageComponentsSource,
    /buildMessageTimeline|buildStreamingTimeline/,
    'assistant timeline should build timeline from thought items',
  );
  assert.match(
    messageComponentsSource,
    /thoughtItemsFromMessage|thoughtItemsFromStreaming/,
    'assistant timeline should extract thought items from messages',
  );
});

test('thinking stepper renders a one-line latest-thought ticker with fade transition', () => {
  // ThinkingStepperItem component has been removed/replaced
  // Check for thinking event rendering instead
  assert.match(
    messageComponentsSource,
    /kind === "thinking"/,
    'assistant timeline should render thinking events',
  );
});

test('streaming content uses a compact one-line ticker with fade transitions', () => {
  // StreamingTextTicker has been replaced - check for streaming card
  assert.match(
    messageComponentsSource,
    /StreamingCard|isLiveStreamingCard/,
    'assistant should render streaming cards differently from completed messages',
  );
  assert.match(
    messageComponentsSource,
    /const isLiveStreamingCard = !message && !!streaming/,
    'assistant should distinguish between streaming and completed messages',
  );
});

test('normalizeMessage persists reasoning-like stream-only content as reasoning events', () => {
  assert.match(
    messageHandlerSource,
    /const streamingReasoningLeak = sanitizeReasoningChunk\(/,
    'normalizeMessage should inspect streaming content for leaked reasoning traces',
  );
  assert.match(
    messageHandlerSource,
    /\(looksLikeReasoningTrace\(streamingReasoningLeak,\s*""\)\s*\|\|\s*!!streamingMixed\)/,
    'normalizeMessage should classify leaked stream content with reasoning heuristic',
  );
  assert.match(
    messageHandlerSource,
    /mergedReasoningEvents\.push\(\{\s*text:\s*streamingReasoningLeak,\s*createdAt:\s*Date\.now\(\),\s*\}\)/s,
    'normalizeMessage should persist stream-only reasoning content into reasoningEvents on finalize',
  );
});

test('webview message handler logs incoming stream events for diagnostics', () => {
  const createHandlerBody = extractFunctionBody(
    messageHandlerSource,
    'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)',
  );
  assert.match(
    createHandlerBody,
    /\[OpenCode\]\[webview\] streamEvent received/,
    'webview handler should log every incoming streamEvent',
  );
});
