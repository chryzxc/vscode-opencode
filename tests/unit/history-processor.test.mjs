import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, extractFunctionBody } from '../helpers/source-utils.mjs';

const source = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts')],
  'HistoryProcessor.ts',
);

function body(signature) {
  return extractFunctionBody(source, signature);
}

test('HistoryProcessor normalizes plan-proceed messages and applies structured output branches', () => {
  assert.match(source, /export class HistoryProcessor/, 'should export the history processor class');
  assert.match(source, /private normalizePlanProceedUserMessage\(message: any\): any \{/, 'should define plan-proceed normalization');
  assert.match(source, /private applyStructuredOutputToMessage\(/, 'should define structured-output application');

  const normalizePlanProceedBody = body('normalizePlanProceedUserMessage(message: any)');
  assert.match(normalizePlanProceedBody, /if \(!this\.planManager\) return message;/, 'should no-op plan-proceed normalization without a plan manager');
  assert.match(
    normalizePlanProceedBody,
    /return this\.planManager\.normalizePlanProceedUserMessage\(message\);/,
    'should delegate plan-proceed normalization to the plan manager when available',
  );

  const applyStructuredBody = body('applyStructuredOutputToMessage(');
  assert.match(
    applyStructuredBody,
    /const messageInfoError = message\?\.info\?\.error \?\? message\?\.error;[\s\S]*messageInfoError\?\.name === "MessageAbortedError"[\s\S]*return \{ \.\.\.message, aborted: true \};/,
    'should convert MessageAbortedError payloads into aborted messages early',
  );
  assert.match(
    applyStructuredBody,
    /const role = this\.firstNonEmptyString\([\s\S]*message\?\.info\?\.role,[\s\S]*message\?\.role,[\s\S]*\)\?\.toLowerCase\(\);/,
    'should normalize the message role from info or top-level fields',
  );
  assert.match(
    applyStructuredBody,
    /const isAssistantLikeRole =[\s\S]*role === "assistant"[\s\S]*this\.firstNonEmptyString\([\s\S]*message\?\.info\?\.modelID,[\s\S]*message\?\.modelID,[\s\S]*message\?\.info\?\.providerID,[\s\S]*message\?\.providerID,[\s\S]*\)/,
    'should detect assistant-like messages even when only model or provider metadata exists',
  );
  assert.match(
    applyStructuredBody,
    /if \(role === "system"\) \{[\s\S]*responseType: "system"[\s\S]*structuredOutput: \{[\s\S]*responseType: "system"[\s\S]*\}/,
    'should assign a default system structured output to system messages',
  );
  assert.match(
    applyStructuredBody,
    /const structured = this\.structuredOutputProcessor\.extractStructuredOutput\(message\);/,
    'should extract structured output before deciding on a fallback',
  );
  assert.match(
    applyStructuredBody,
    /if \(!structured\) \{[\s\S]*const bodyText = this\.extractMessageBodyText\(message\);[\s\S]*structuredOutput: \{[\s\S]*responseType: "message",[\s\S]*message: bodyText,[\s\S]*\},[\s\S]*content: bodyText,[\s\S]*\}/,
    'should synthesize a message structured output for assistant-like text-only history entries',
  );
  assert.match(
    applyStructuredBody,
    /const structuredApplied = this\.structuredOutputProcessor\.applyStructuredOutputToMessage\([\s\S]*message,[\s\S]*structured[\s\S]*\)/,
    'should delegate final structured-output application to StructuredOutputProcessor',
  );
});

test('HistoryProcessor persists and reapplies session message overrides through workspace state', () => {
  assert.match(source, /getMessageOverrideStorageKey\(messageId: string\): string \{/, 'should define message override storage-key derivation');
  assert.match(source, /async loadSessionMessageOverrides\(sessionId: string\): Promise<Record<string, any>> \{/, 'should define session override loading');
  assert.match(source, /async persistSessionMessageOverride\(/, 'should define session override persistence');
  assert.match(source, /async clearSessionMessageOverrides\(sessionId: string\): Promise<void> \{/, 'should define session override clearing');
  assert.match(source, /async applySessionMessageOverrides\(/, 'should define session override reapplication');

  const keyBody = body('getMessageOverrideStorageKey(messageId: string)');
  assert.match(keyBody, /return `opencode\.messageOverride\.\$\{messageId\}`;/, 'should namespace per-message override storage keys');

  const loadBody = body('loadSessionMessageOverrides(sessionId: string)');
  assert.match(loadBody, /const key = `opencode\.session\.messageOverrides\.\$\{sessionId\}`;/, 'should namespace overrides by session id');
  assert.match(loadBody, /const raw = this\.workspaceState\.get<Record<string, any>>\(key\);/, 'should read session overrides from workspaceState');
  assert.match(loadBody, /return raw \|\| \{\};/, 'should default missing session overrides to an empty object');

  const persistBody = body('persistSessionMessageOverride(');
  assert.match(persistBody, /const overrides = await this\.loadSessionMessageOverrides\(sessionId\);/, 'should load existing session overrides before persisting');
  assert.match(persistBody, /const messageId = this\.extractHistoryMessageId\(override\);/, 'should key overrides by canonical history message id');
  assert.match(persistBody, /overrides\[messageId\] = override;/, 'should overwrite or create the override entry for that message id');
  assert.match(persistBody, /await this\.workspaceState\.update\(key, overrides\);/, 'should persist the updated session override map');

  const clearBody = body('clearSessionMessageOverrides(sessionId: string)');
  assert.match(clearBody, /await this\.workspaceState\.update\(key, undefined\);/, 'should clear session overrides by writing undefined');

  const applyOverridesBody = body('applySessionMessageOverrides(');
  assert.match(applyOverridesBody, /const overrides = await this\.loadSessionMessageOverrides\(sessionId\);/, 'should load overrides before applying them');
  assert.match(applyOverridesBody, /if \(Object\.keys\(overrides\)\.length === 0\) \{[\s\S]*return messages;/, 'should return the original messages when no overrides exist');
  assert.match(
    applyOverridesBody,
    /overrides\[messageId\][\s\S]*\.\.\.override/,
    'should merge stored overrides back onto messages by ID',
  );
});

test('HistoryProcessor processes history through normalize, structured, filter, dedupe, and coalesce stages', () => {
  assert.match(source, /async processHistoryMessages\(rawMessages: any\[\], sessionId: string\): Promise<any\[]> \{/, 'should define the main history-processing pipeline');
  assert.match(source, /private orderHistoryMessagesChronologically\(messages: any\[\]\): any\[] \{/, 'should define chronological ordering');

  const processBody = body('processHistoryMessages(rawMessages: any[], sessionId: string)');
  assert.match(processBody, /if \(!Array\.isArray\(rawMessages\) \|\| rawMessages\.length === 0\) \{[\s\S]*return \[\];/, 'should guard against empty or invalid history arrays');
  assert.match(
    processBody,
    /const processedMessages = await Promise\.all\([\s\S]*rawMessages\.map\(async \(rawMessage: any\) => \{[\s\S]*const normalizedMessage = this\.normalizePlanProceedUserMessage\(message\);[\s\S]*const structured = this\.applyStructuredOutputToMessage\(normalizedMessage, \{[\s\S]*allowSyntheticFallbackError: false,[\s\S]*\}\);[\s\S]*return await this\.enrichMessageWithPlan\(structured\);[\s\S]*\}\)[\s\S]*\);/,
    'should normalize plan-proceed messages, apply structured output, and enrich plans per message',
  );
  assert.match(processBody, /const processed = processedMessages\.filter\(\(message\) =>[\s\S]*this\.isRenderableHistoryMessage\(message\)[\s\S]*\);/, 'should filter out non-renderable history entries before ordering');
  assert.match(processBody, /const ordered = this\.orderHistoryMessagesChronologically\(processed\);/, 'should order history chronologically before deduplication');
  assert.match(processBody, /const dedupedUserMessages = this\.dedupeUserMessagesByContent\(ordered\);/, 'should dedupe user messages by normalized content first');
  assert.match(processBody, /const deduped = this\.dedupeMirrorHistoryMessages\(dedupedUserMessages\);/, 'should dedupe mirrored messages after user-content normalization');
  assert.match(processBody, /const mergedActivity = this\.mergeAdjacentAssistantActivityMessages\(deduped\);/, 'should merge adjacent assistant activity-only messages after dedupe');
  assert.match(processBody, /return this\.cleanupGarbledEventMessages\(merged\);/, 'should run cleanupGarbledEventMessages as the final pipeline step after mergeConsecutiveAssistantBursts');

  const orderBody = body('orderHistoryMessagesChronologically(messages: any[])');
  assert.match(orderBody, /const decorated = messages\.map\(\(message, index\) => \(\{[\s\S]*createdAt: this\.historyMessageCreatedAt\(message\),/, 'should decorate messages with timestamps before sorting');
  assert.match(
    orderBody,
    /role: this\.firstNonEmptyString\([\s\S]*message\?\.role,[\s\S]*message\?\.info\?\.role,[\s\S]*message\?\.sender,[\s\S]*\)\?\.toLowerCase\(\),/,
    'should derive role metadata for sort tiebreakers',
  );
  assert.match(orderBody, /return a\.createdAt - b\.createdAt;/, 'should sort by ascending timestamp when both timestamps are available');
  assert.match(orderBody, /if \(a\.role === "user" && b\.role === "assistant"\) \{[\s\S]*return -1;/, 'should keep user turns before assistant turns at identical timestamps');
  assert.match(orderBody, /if \(a\.role === "assistant" && b\.role === "user"\) \{[\s\S]*return 1;/, 'should keep assistant turns after user turns at identical timestamps');
  assert.match(orderBody, /return a\.index - b\.index;/, 'should fall back to original order when timestamps are ambiguous');
});

test('HistoryProcessor merges assistant activity and dedupes mirrored or repeated user messages', () => {
  assert.match(source, /public mergeAdjacentAssistantActivityMessages\(messages: any\[\]\): any\[] \{/, 'should define adjacent activity-message merging');
  assert.match(source, /public mergeConsecutiveAssistantBursts\(messages: any\[\]\): any\[] \{/, 'should define assistant burst coalescing');
  assert.match(source, /public dedupeMirrorHistoryMessages\(messages: any\[\]\): any\[] \{/, 'should define mirror deduplication');
  assert.match(source, /private dedupeUserMessagesByContent\(messages: any\[\]\): any\[] \{/, 'should define user-content deduplication');

  const mergeAdjacentBody = body('mergeAdjacentAssistantActivityMessages(messages: any[])');
  assert.match(mergeAdjacentBody, /if \(!this\.isActivityOnlyAssistantMessage\(message\)\) \{[\s\S]*result\.push\(message\);/, 'should only consider activity-only assistant messages for adjacent merging');
  assert.match(mergeAdjacentBody, /const lastId = this\.extractHistoryMessageId\(last\);/, 'should compare the previous merged message id');
  assert.match(mergeAdjacentBody, /const currentId = this\.extractHistoryMessageId\(message\);/, 'should compare the current message id');
  assert.match(
    mergeAdjacentBody,
    /lastId === currentId[\s\S]*const merged = this\.mergeMessageParts\(\[last, message\]\);[\s\S]*result\[result\.length - 1\] = merged;/,
    'should merge adjacent activity-only assistant messages that share the same id',
  );

  const mergeBurstsBody = body('mergeConsecutiveAssistantBursts(messages: any[])');
  assert.match(mergeBurstsBody, /let currentBurst: any\[\] = \[\];/, 'should accumulate assistant bursts in a working array');
  assert.match(mergeBurstsBody, /const isAssistant = role === "assistant";/, 'should gate burst merging on assistant-role messages');
  assert.match(mergeBurstsBody, /result\.push\(this\.coalesceAssistantBurst\(currentBurst\)\);/, 'should flush buffered assistant bursts through coalescing');
  assert.match(
    mergeBurstsBody,
    /if \([\s\S]*previous &&[\s\S]*!this\.shouldMergeAssistantBurstMessages\(previous, message\)[\s\S]*\) \{[\s\S]*result\.push\(this\.coalesceAssistantBurst\(currentBurst\)\);[\s\S]*currentBurst = \[\];/,
    'should break bursts when consecutive assistant messages should not merge',
  );

  const dedupeMirrorBody = body('dedupeMirrorHistoryMessages(messages: any[])');
  assert.match(dedupeMirrorBody, /const seen = new Set<string>\(\);/, 'should track seen mirror fingerprints in a Set');
  assert.match(dedupeMirrorBody, /const fingerprint = this\.historyMessageFingerprint\(message\);/, 'should fingerprint each message before deduping');
  assert.match(dedupeMirrorBody, /if \(seen\.has\(fingerprint\)\) \{[\s\S]*return false;/, 'should drop later messages that repeat an existing fingerprint');
  assert.match(dedupeMirrorBody, /seen\.add\(fingerprint\);/, 'should remember each accepted fingerprint');

  const dedupeUserBody = body('dedupeUserMessagesByContent(messages: any[])');
  assert.match(dedupeUserBody, /const seenUserContents = new Set<string>\(\);/, 'should track normalized user message bodies in a Set');
  assert.match(
    dedupeUserBody,
    /const role = this\.firstNonEmptyString\([\s\S]*message\?\.role,[\s\S]*message\?\.info\?\.role,[\s\S]*message\?\.sender,[\s\S]*\)\?\.toLowerCase\(\);/,
    'should normalize roles before deciding whether a message is dedupe-eligible',
  );
  assert.match(dedupeUserBody, /const content = this\.extractMessageBodyText\(message\);/, 'should dedupe based on extracted renderable body text');
  assert.match(dedupeUserBody, /const normalizedContent = content\.trim\(\);/, 'should normalize message text before checking for duplicates');
  assert.match(dedupeUserBody, /if \(seenUserContents\.has\(normalizedContent\)\) \{[\s\S]*Skipping duplicate user message/, 'should log and skip repeated user messages');
  assert.match(dedupeUserBody, /seenUserContents\.add\(normalizedContent\);/, 'should record accepted user content fingerprints');
});

test('HistoryProcessor fingerprints messages, extracts ids and timestamps, and detects assistant history advancement', () => {
  assert.match(source, /historyMessageFingerprint\(message: any\): string \| undefined \{/, 'should define history fingerprinting');
  assert.match(source, /extractHistoryMessageId\(message: any\): string \| undefined \{/, 'should define history message id extraction');
  assert.match(source, /private historyMessageCreatedAt\(message: any\): number \| undefined \{/, 'should define history timestamp extraction');
  assert.match(source, /public getLatestAssistantHistoryMarker\(messages: any\[\]\): \{/, 'should define assistant marker selection');
  assert.match(source, /public hasAssistantHistoryAdvanced\(/, 'should define history advancement checks');

  const fingerprintBody = body('historyMessageFingerprint(message: any)');
  assert.match(fingerprintBody, /const id = this\.extractHistoryMessageId\(message\);/, 'should include the canonical message id in the fingerprint when present');
  assert.match(fingerprintBody, /const role = this\.firstNonEmptyString\(message\?\.role, message\?\.sender\);/, 'should include role or sender in the fingerprint');
  assert.match(fingerprintBody, /const content = typeof rawContent === "string" \? rawContent\.slice\(0, 200\) : undefined;/, 'should limit raw content used for fingerprinting');
  assert.match(fingerprintBody, /if \(id\) parts\.push\(`id:\$\{id\}`\);/, 'should prefix ids in the fingerprint');
  assert.match(fingerprintBody, /if \(role\) parts\.push\(`role:\$\{role\}`\);/, 'should prefix roles in the fingerprint');
  assert.match(fingerprintBody, /if \(typeof content === "string" && content\) parts\.push\(`content:\$\{content\.slice\(0, 100\)\}`\);/, 'should keep only the leading content slice in the fingerprint');
  assert.match(fingerprintBody, /return parts\.join\("\|"\);/, 'should join fingerprint segments with pipes');

  const extractIdBody = body('extractHistoryMessageId(message: any)');
  assert.match(
    extractIdBody,
    /this\.firstNonEmptyString\([\s\S]*message\?\.id,[\s\S]*message\?\.messageId,[\s\S]*message\?\.info\?\.id,[\s\S]*\)/,
    'should extract history ids from top-level and info fields',
  );

  const createdAtBody = body('historyMessageCreatedAt(message: any)');
  assert.match(createdAtBody, /const info = this\.asRecord\(message\?\.info\);/, 'should inspect nested info metadata');
  assert.match(createdAtBody, /const infoTime = this\.asRecord\(info\?\.time\);/, 'should inspect nested info.time metadata');
  assert.match(
    createdAtBody,
    /const numericCandidates = \[[\s\S]*infoTime\?\.created,[\s\S]*time\?\.created,[\s\S]*info\?\.createdAt,[\s\S]*info\?\.timestamp,[\s\S]*message\?\.createdAt,[\s\S]*message\?\.timestamp,[\s\S]*\];/,
    'should check multiple numeric timestamp locations first',
  );
  assert.match(createdAtBody, /const parsed = new Date\(candidate\)\.getTime\(\);/, 'should parse string timestamps when numeric values are absent');
  assert.match(createdAtBody, /return undefined;/, 'should return undefined when no timestamp candidate is usable');

  const markerBody = body(`getLatestAssistantHistoryMarker(messages: any[]): {
    id?: string;
    fingerprint?: string;
    createdAt?: number;
    richness: number;
  }`);
  assert.match(
    markerBody,
    /if \(!Array\.isArray\(messages\) \|\| messages\.length === 0\) \{[\s\S]*richness: -1,[\s\S]*\}/,
    'should return an empty marker with richness -1 when there are no messages',
  );
  assert.match(markerBody, /if \(!this\.isAssistantHistoryMessage\(message\)\) continue;/, 'should ignore non-assistant history messages when computing the latest marker');
  assert.match(markerBody, /const richness = this\.historyMessageRichnessScore\(message\);/, 'should rank candidate assistant messages by richness');
  assert.match(markerBody, /if \(richness <= latestScore\) continue;/, 'should only replace the latest marker with richer assistant messages');
  assert.match(markerBody, /fingerprint: this\.historyMessageFingerprint\(latest\),/, 'should include a fingerprint in the returned assistant marker');

  const advancedBody = body('hasAssistantHistoryAdvanced(');
  assert.match(advancedBody, /const asMarker = \([\s\S]*=> \{/, 'should normalize arrays and marker objects through an asMarker helper');
  assert.match(advancedBody, /if \(Array\.isArray\(value\)\) \{[\s\S]*const marker = this\.getLatestAssistantHistoryMarker\(value\);/, 'should derive markers from raw message arrays');
  assert.match(advancedBody, /if \(!currentMarker\) \{[\s\S]*return false;/, 'should report no advancement when the current marker is missing');
  assert.match(advancedBody, /if \(!previousMarker\) \{[\s\S]*return true;/, 'should report advancement when only the current marker exists');
  assert.match(advancedBody, /currentMarker\.id !== previousMarker\.id/, 'should treat differing assistant ids as advancement');
  assert.match(advancedBody, /currentMarker\.fingerprint !== previousMarker\.fingerprint/, 'should treat differing assistant fingerprints as advancement');
  assert.match(advancedBody, /currentMarker\.createdAt > previousMarker\.createdAt \+ 1000/, 'should treat sufficiently newer assistant timestamps as advancement');
  assert.match(advancedBody, /return currentMarker\.richness > previousMarker\.richness \+ 12;/, 'should fall back to a richness threshold for advancement');
});

test('HistoryProcessor keeps timeout recovery and prompt orchestration out of this module', () => {
  assert.doesNotMatch(source, /\bgetTimeoutRecoveryPollDelays\(/, 'should not define timeout recovery polling delays in HistoryProcessor');
  assert.doesNotMatch(source, /\bpromptWithStructuredOutput\(/, 'should not define prompt orchestration in HistoryProcessor');
});

test('HistoryProcessor cleanupGarbledEventMessages filters evt_ prefixed assistant messages adjacent to clean content', () => {
  const cleanupBody = body('cleanupGarbledEventMessages(messages: any[])');
  assert.ok(cleanupBody.length > 0, 'should define cleanupGarbledEventMessages method');

  // Detects assistant messages with evt_ prefixed IDs
  assert.match(
    cleanupBody,
    /currentId\.startsWith\("evt_"\)/,
    'should detect event-prefixed message IDs for cleanup',
  );

  // Checks for garbled content (short body < 200 chars)
  assert.match(
    cleanupBody,
    /currentBody\.length < 200/,
    'should flag short event-message bodies as potentially garbled',
  );

  // Checks previous adjacent assistant message for good content
  assert.match(
    cleanupBody,
    /prevHasGoodContent/,
    'should check the previous adjacent assistant message for good content',
  );

  // Logs when skipping garbled messages
  assert.match(
    cleanupBody,
    /cleanupGarbledEventMessages SKIPPED/,
    'should log when a garbled event message is skipped',
  );

  // Preserves non-assistant messages unchanged
  assert.match(
    cleanupBody,
    /result\.push\(current\)/,
    'should push non-garbled messages to the result array unchanged',
  );

  // Checks next adjacent assistant message if previous doesn't exist
  assert.match(
    cleanupBody,
    /nextHasGoodContent/,
    'should fall back to checking the next adjacent assistant message',
  );

  // Only filters messages with short body text (not long legitimate responses)
  assert.match(
    cleanupBody,
    /isGarbled/,
    'should define the garbled detection condition for event messages',
  );

  // The function iterates through all messages and builds a result array
  assert.match(
    cleanupBody,
    /result\.push/,
    'should build a filtered result array',
  );
});

test('HistoryProcessor cleanupGarbledEventMessages is invoked from processHistoryMessages', () => {
  const processBody = body('processHistoryMessages(rawMessages: any[], sessionId: string)');
  assert.match(
    processBody,
    /return this\.cleanupGarbledEventMessages\(merged\);/,
    'should call cleanupGarbledEventMessages as the final pipeline step after mergeConsecutiveAssistantBursts',
  );
});
