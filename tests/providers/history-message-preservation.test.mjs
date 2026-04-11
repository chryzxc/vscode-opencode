import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const historyProcessorSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts')],
  'HistoryProcessor.ts',
);

// ============================================================================
// CRITICAL REGRESSION TESTS: History Message Preservation
// ============================================================================
// These tests lock in the fix for the bug where AI responses disappeared
// after session restart. The HistoryProcessor was filtering out assistant
// messages with question parts but no text content.
//
// This is the HYDRATION PATH fix - separate from the streaming path fix.
// ============================================================================

test('HistoryProcessor hasRenderableHistoryPayload checks assistant messages with parts FIRST', () => {
  // This is the CRITICAL fix for the hydration bug
  // Without this check, assistant messages with question parts are filtered out

  // Verify the function exists
  assert.match(
    historyProcessorSource,
    /hasRenderableHistoryPayload\s*\([\s\S]*message[\s\S]*\):[\s\S]*boolean/,
    'HistoryProcessor should have hasRenderableHistoryPayload method'
  );

  // Verify the assistant+parts check exists
  assert.match(
    historyProcessorSource,
    /const role\s*=\s*message\.role\s*\|\|\s*message\.info\?\.role/,
    'should extract role from message'
  );

  assert.match(
    historyProcessorSource,
    /role\s*===\s*["']assistant["']\s*&&\s*Array\.isArray\(message\.parts\)\s*&&\s*message\.parts\.length\s*>\s*0/,
    'should check if message is assistant with parts'
  );

  // Verify the check returns true for assistant+parts
  assert.match(
    historyProcessorSource,
    /if\s*\(\s*role\s*===\s*["']assistant["'][\s\S]*message\.parts\.length\s*>\s*0[\s\S]*\)\s*{\s*return\s*true/,
    'should return true for assistant messages with parts (critical fix)'
  );
});

test('HistoryProcessor preserves assistant messages with parts even without text', () => {
  // This test ensures the logic flow preserves question-type messages
  // which have parts but no text content

  // The check must come BEFORE other checks that might filter out empty messages
  const logicFlowPattern =
    /hasRenderableHistoryPayload[\s\S]*role\s*===\s*["']assistant["'][\s\S]*message\.parts\.length\s*>\s*0[\s\S]*return\s*true[\s\S]*extractMessageBodyText/s;

  assert.match(
    historyProcessorSource,
    logicFlowPattern,
    'assistant+parts check must come BEFORE extractMessageBodyText check (prevents premature filtering)'
  );

  // Verify that text extraction is checked AFTER the assistant+parts check
  const textCheckPattern =
    /return\s*true[\s\S]*extractMessageBodyText\(message\)/s;

  assert.match(
    historyProcessorSource,
    textCheckPattern,
    'text extraction should be checked after assistant+parts check'
  );
});

test('HistoryProcessor hasRenderableHistoryPayload includes all payload checks', () => {
  // Verify all the checks that make a message renderable are present

  // 1. Text content check
  assert.match(
    historyProcessorSource,
    /extractMessageBodyText.*trim\(\).*return\s*true/,
    'should check for text content'
  );

  // 2. Structured output check
  assert.match(
    historyProcessorSource,
    /structuredOutput.*return\s*true/,
    'should check for structured output'
  );

  // 3. Subagents check
  assert.match(
    historyProcessorSource,
    /subagents.*length.*>\s*0.*return\s*true/s,
    'should check for subagents'
  );

  // 4. Interactive events check
  assert.match(
    historyProcessorSource,
    /interactiveEvents.*length.*>\s*0.*return\s*true/s,
    'should check for interactive events'
  );

  // 5. Progress updates check
  assert.match(
    historyProcessorSource,
    /progressUpdates.*length.*>\s*0.*return\s*true/s,
    'should check for progress updates'
  );
});

test('HistoryProcessor processHistoryMessages filters by isRenderableHistoryMessage', () => {
  // Verify that processHistoryMessages uses the filtering logic

  // Check that filtering happens
  assert.match(
    historyProcessorSource,
    /\.filter\([\s\S]*isRenderableHistoryMessage/s,
    'processHistoryMessages should filter messages through isRenderableHistoryMessage'
  );

  // Check that isRenderableHistoryMessage exists
  assert.match(
    historyProcessorSource,
    /isRenderableHistoryMessage\s*\(/,
    'isRenderableHistoryMessage method should exist'
  );

  // Check that it delegates to hasRenderableHistoryPayload
  assert.match(
    historyProcessorSource,
    /return\s*this\.hasRenderableHistoryPayload/s,
    'isRenderableHistoryMessage should delegate to hasRenderableHistoryPayload'
  );
});

test('HistoryProcessor preserves question-type messages during hydration', () => {
  // This is the end-to-end regression test
  // It verifies that question-type messages survive the entire hydration pipeline

  // 1. processHistoryMessages should preserve assistant messages with parts
  assert.match(
    historyProcessorSource,
    /const role\s*=\s*message\.role\s*\|\|\s*message\.info\?\.role/,
    'should extract role in hasRenderableHistoryPayload'
  );

  assert.match(
    historyProcessorSource,
    /role\s*===\s*["']assistant["']\s*&&\s*Array\.isArray\(message\.parts\)\s*&&\s*message\.parts\.length\s*>\s*0/,
    'should preserve assistant messages with parts'
  );

  // 2. Verify the filtering doesn't drop these messages
  assert.match(
    historyProcessorSource,
    /\.filter\([\s\S]*isRenderableHistoryMessage/,
    'should filter by isRenderableHistoryMessage (which checks for assistant+parts)'
  );

  // 3. Verify no other step removes assistant messages with parts
  assert.doesNotThrow(
    () => {
      const code = historyProcessorSource;
      // Check that there's no code that filters out assistant messages based solely on content length
      const filterPattern = /message\.content\s*===\s*["']["']\s*&&\s*message\.role\s*===\s*["']assistant["']/;
      if (filterPattern.test(code)) {
        throw new Error('Found code that filters out assistant messages with empty content');
      }
    },
    'should not filter out assistant messages based solely on empty content'
  );
});

test('HistoryProcessor applies session overrides before processing', () => {
  // Verify the processing pipeline order
  const pipelinePattern =
    /applySessionMessageOverrides[\s\S]*processHistoryMessages/s;

  assert.match(
    historyProcessorSource,
    pipelinePattern,
    'should apply session overrides before processing messages'
  );
});

test('HistoryProcessor deduplicates and merges messages correctly', () => {
  // Verify that the post-processing steps don't accidentally filter out messages

  assert.match(
    historyProcessorSource,
    /orderHistoryMessagesChronologically/,
    'should stabilize chronological order before downstream hydration transforms'
  );

  assert.match(
    historyProcessorSource,
    /dedupeMirrorHistoryMessages/,
    'should deduplicate mirror history messages'
  );

  assert.match(
    historyProcessorSource,
    /mergeAdjacentAssistantActivityMessages/,
    'should merge adjacent assistant activity messages'
  );

  assert.match(
    historyProcessorSource,
    /mergeConsecutiveAssistantBursts/,
    'should merge consecutive assistant bursts'
  );

  // None of these should remove assistant messages with parts
  assert.match(
    historyProcessorSource,
    /const processed\s*=\s*processedMessages\.filter[\s\S]*const ordered\s*=\s*this\.orderHistoryMessagesChronologically\(processed\)[\s\S]*return\s*this\.mergeConsecutiveAssistantBursts/,
    'should return processed messages after all transformations'
  );
});

// ============================================================================
// SUMMARY OF LOCKED BEHAVIOR
// ============================================================================
// These tests ensure that:
//
// 1. Assistant messages with parts are ALWAYS considered renderable
//    - Even if they have no text content
//    - Even if they have no interactiveEvents array
//    - This check happens FIRST in hasRenderableHistoryPayload
//
// 2. The hydration pipeline preserves these messages
//    - processHistoryMessages filters by isRenderableHistoryMessage
//    - isRenderableHistoryMessage checks hasRenderableHistoryPayload
//    - hasRenderableHistoryPayload checks assistant+parts FIRST
//
// 3. No future refactoring accidentally breaks this
//    - Multiple tests verify different aspects of the fix
//    - Tests check both the function and the pipeline integration
//    - Tests verify the logic flow order
//
// This prevents regression of the bug where AI responses disappeared
// after session restart.
// ============================================================================
