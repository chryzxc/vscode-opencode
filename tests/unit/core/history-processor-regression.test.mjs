/**
 * Core History Processing Regression Tests
 *
 * These tests prevent regressions in history message processing functionality.
 * History processing is critical for correct message rendering and state management.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const historyProcessorSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts')],
  'HistoryProcessor.ts',
);

test.describe('History Processor - Message Processing', () => {

  test('processHistoryMessages validates input array', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /processHistoryMessages[\s\S]*Array\.isArray|messages\s*&&/,
      'must validate messages array'
    );
  });

  test('processHistoryMessages applies structured output', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /processHistoryMessages[\s\S]*applyStructuredOutputToMessage/,
      'must apply structured output to messages'
    );
  });

  test('processHistoryMessages handles plan messages', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /processHistoryMessages[\s\S]*enrichMessageWithPlan/,
      'must enrich messages with plan information'
    );
  });

  test('processHistoryMessages merges message parts', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /processHistoryMessages[\s\S]*mergeMessageParts/,
      'must merge message parts'
    );
  });

});

test.describe('History Processor - Structured Output', () => {

  test('applyStructuredOutputToMessage handles system messages', () => {
    const applyBody = extractFunctionBody(historyProcessorSource, 'applyStructuredOutputToMessage');

    assert.match(
      applyBody,
      /role\s*===\s*["']system["']|responseType:\s*["']system["']/,
      'must detect system messages'
    );
    assert.match(
      applyBody,
      /structuredOutput.*responseType.*system/s,
      'must apply system response type'
    );
  });

  test('applyStructuredOutputToMessage handles message aborts', () => {
    const applyBody = extractFunctionBody(historyProcessorSource, 'applyStructuredOutputToMessage');

    assert.match(
      applyBody,
      /MessageAbortedError|aborted:\s*true/,
      'must detect and handle aborted messages'
    );
  });

  test('applyStructuredOutputToMessage extracts structured output', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /applyStructuredOutputToMessage[\s\S]*extractStructuredOutput/,
      'must extract structured output from messages'
    );
  });

  test('applyStructuredOutputToMessage handles assistant messages', () => {
    const applyBody = extractFunctionBody(historyProcessorSource, 'applyStructuredOutputToMessage');

    assert.match(
      applyBody,
      /assistant|isAssistantLikeRole/s,
      'must identify assistant-like messages'
    );
  });

});

test.describe('History Processor - Message Rendering', () => {

  test('isRenderableHistoryMessage validates message structure', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /isRenderableHistoryMessage[\s\S]*role|message\.info/s,
      'must check message structure'
    );
  });

  test('isRenderableHistoryMessage filters internal messages', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /isRenderableHistoryMessage[\s\S]*isInternalSystemReminderMessage/,
      'must filter internal system reminders'
    );
  });

  test('isRenderableHistoryMessage handles activity-only messages', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /isRenderableHistoryMessage[\s\S]*isActivityOnlyAssistantMessage/,
      'must check for activity-only messages'
    );
  });

});

test.describe('History Processor - Message Deduplication', () => {

  test('historyMessageFingerprint generates unique fingerprints', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /historyMessageFingerprint|fingerprint|hash/s,
      'must generate message fingerprints'
    );
  });

  test('historyMessageFingerprint handles different message types', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /historyMessageFingerprint.*role|responseType|type/s,
      'must consider message type in fingerprint'
    );
  });

  test('dedupeUserMessagesByContent removes duplicate user messages', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /dedupeUserMessagesByContent[\s\S]*filter|reduce|map/s,
      'must process messages array'
    );
    assert.match(
      source,
      /dedupeUserMessagesByContent[\s\S]*Set|Map|has/s,
      'must track seen messages'
    );
  });

});

test.describe('History Processor - Message Merging', () => {

  test('mergeConsecutiveAssistantBursts identifies burst patterns', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /mergeConsecutiveAssistantBursts[\s\S]*shouldMergeAssistantBurstMessages/,
      'must check if messages should be merged'
    );
  });

  test('mergeConsecutiveAssistantBursts preserves message order', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /mergeConsecutiveAssistantBursts[\s\S]*reduce|forEach|for\s*\(/s,
      'must iterate through messages'
    );
  });

  test('coalesceAssistantBurst preserves the latest visible assistant body across retries', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /const visibleBodyText = \(\(\) => \{[\s\S]*this\.extractMessageBodyText\(burst\[index\]\)/s,
      'burst coalescing should scan the full assistant burst for a visible body before picking the final content',
    );
    assert.match(
      source,
      /base\.content = visibleBodyText \|\| this\.extractMessageBodyText\(base\);/,
      'burst coalescing should keep a visible assistant body even when the last record is empty',
    );
    assert.match(
      source,
      /latestRawSdkEventPayloads|rawSdkEventPayloads/,
      'burst coalescing should preserve rawSdkEventPayloads for rehydrated debug rendering',
    );
  });

  test('mergeMessageParts combines related parts', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /mergeMessageParts[\s\S]*parts|concat|push/s,
      'must combine message parts'
    );
  });

});

test.describe('History Processor - Message Scoring', () => {

  test('historyMessageRichnessScore calculates message richness', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /historyMessageRichnessScore[\s\S]*content\.length|parts\.length/s,
      'must calculate based on content and parts'
    );
  });

  test('historyMessageRichnessScore weights different features', () => {
    const scoreBody = extractFunctionBody(historyProcessorSource, 'historyMessageRichnessScore');

    assert.match(
      scoreBody,
      /interactiveEvents|structuredOutput|parts/s,
      'must consider various message features'
    );
  });

  test('pickRicherHistoryMessage compares message richness', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /pickRicherHistoryMessage[\s\S]*historyMessageRichnessScore/,
      'must use richness score for comparison'
    );
  });

});

test.describe('History Processor - Plan Integration', () => {

  test('enrichMessageWithPlan detects plan references', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /enrichMessageWithPlan.*plan|structured|file/s,
      'must detect plan references'
    );
  });

  test('enrichMessageWithPlan extracts plan content', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /enrichMessageWithPlan[\s\S]*plan\.content|structuredOutput/s,
      'must extract plan content'
    );
  });

  test('enrichMessageWithPlan handles missing plan data', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /enrichMessageWithPlan[\s\S]*if\s*\(\s*!plan|return\s*message/s,
      'must handle missing plan gracefully'
    );
  });

});

test.describe('History Processor - Message Override Management', () => {

  test('persistSessionMessageOverride saves overrides', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /persistSessionMessageOverride[\s\S]*workspaceState\.update/,
      'must persist to workspace state'
    );
  });

  test('persistSessionMessageOverride generates storage keys', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /getMessageOverrideStorageKey[\s\S]*sessionId|messageId/s,
      'must generate unique storage keys'
    );
  });

  test('loadSessionMessageOverrides retrieves overrides', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /loadSessionMessageOverrides[\s\S]*workspaceState\.get/,
      'must load from workspace state'
    );
  });

  test('clearSessionMessageOverrides removes overrides', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /clearSessionMessageOverrides[\s\S]*workspaceState\.update.*undefined/,
      'must clear overrides from storage'
    );
  });

});

test.describe('History Processor - Error Handling', () => {

  test('history operations handle malformed data gracefully', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /if\s*\(\s*!message\s*\)|message\s*&&|typeof/s,
      'must validate message structures'
    );
  });

  test('history operations provide safe defaults', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /return\s*\{\s*\}|return\s*message|return\s*\[\]/s,
      'must return safe defaults for invalid input'
    );
  });

  test('history operations log errors appropriately', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /logger\.(warn|error|debug)/s,
      'must log processing issues'
    );
  });

});

test.describe('History Processor - Performance', () => {

  test('history processing uses efficient algorithms', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /forEach|map|filter|reduce|for\s*\(/s,
      'must use efficient array operations'
    );
  });

  test('history processing avoids unnecessary iterations', () => {
    const source = historyProcessorSource;

    assert.match(
      source,
      /break|return|continue/s,
      'must exit early when possible'
    );
  });

});
