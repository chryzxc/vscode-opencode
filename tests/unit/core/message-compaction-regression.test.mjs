/**
 * Core Message Compaction Regression Tests
 *
 * These tests prevent regressions in message compaction functionality.
 * Compaction is critical for performance - bugs here can cause memory issues
 * or incorrect conversation summarization.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const compactionManagerSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'CompactionManager.ts')],
  'CompactionManager.ts',
);

test.describe('Compaction Manager - State Management', () => {

  test('normalizeCompactionViewState validates state structure', () => {
    const normalizeBody = extractFunctionBody(compactionManagerSource, 'normalizeCompactionViewState');

    assert.match(
      normalizeBody,
      /asRecord|typeof.*===.*"number"|Number\.isFinite/,
      'must validate state structure'
    );
    assert.match(
      normalizeBody,
      /lastCompactedAt|baselineStats|compactionDividerIndex/,
      'must normalize state fields'
    );
  });

  test('normalizeCompactionBaselineStats validates stats', () => {
    const normalizeStatsBody = extractFunctionBody(compactionManagerSource, 'normalizeCompactionBaselineStats');

    assert.match(
      normalizeStatsBody,
      /typeof.*===.*"number"|Number\.isFinite/,
      'must validate stat values are finite numbers'
    );
    assert.match(
      normalizeStatsBody,
      /input|output|read|write|duration/,
      'must normalize baseline stat fields'
    );
  });

  test('compaction state persists correctly', () => {
    const source = compactionManagerSource;

    assert.match(
      source,
      /workspaceState\.update|getCompactionViewStateStorageKey/,
      'must persist state to workspace storage'
    );
    assert.match(
      source,
      /savePersistedCompactionViewState|loadPersistedCompactionViewState/,
      'must have save and load methods'
    );
  });

});

test.describe('Compaction Manager - Divider Resolution', () => {

  test('resolveSessionCompactionDividerState validates divider state', () => {
    const source = compactionManagerSource;

    assert.match(
      source,
      /resolveSessionCompactionDividerState[\s\S]*loadPersistedCompactionViewState/,
      'must load persisted state'
    );
    assert.match(
      source,
      /resolveSessionCompactionDividerState[\s\S]*compactionDividerIndex/,
      'must validate divider index'
    );
  });

  test('resolveSessionCompactionDividerState handles invalid state', () => {
    const source = compactionManagerSource;

    assert.match(
      source,
      /resolveSessionCompactionDividerState[\s\S]*if\s*\(\s*!state\s*\)/,
      'must handle missing or invalid state'
    );
    assert.match(
      source,
      /resolveSessionCompactionDividerState[\s\S]*return\s*\{\s*\}/,
      'must return empty object on error'
    );
  });

});

test.describe('Compaction Manager - Auto-Compaction', () => {

  test('maybeAutoCompact checks token threshold', () => {
    const autoCompactBody = extractFunctionBody(compactionManagerSource, 'async maybeAutoCompact(');

    assert.match(
      autoCompactBody,
      /responseData\?\.usage|totalTokens|inputTokens/,
      'must check token usage'
    );
    assert.match(
      autoCompactBody,
      /getSelectedModelContextLimit|threshold/,
      'must respect context limit threshold'
    );
  });

  test('maybeAutoCompact prevents duplicate compactions', () => {
    const autoCompactBody = extractFunctionBody(compactionManagerSource, 'async maybeAutoCompact(');

    assert.match(
      autoCompactBody,
      /compactingSessions\.has|Set/,
      'must track sessions being compacted'
    );
    assert.match(
      autoCompactBody,
      /return\s*;|if.*compactingSessions/,
      'must skip if already compacting'
    );
  });

  test('handleCompactSession manages compaction lifecycle', () => {
    const compactBody = extractFunctionBody(compactionManagerSource, 'async handleCompactSession(');

    assert.match(
      compactBody,
      /compactingSessions\.add|compactingSessions\.delete/,
      'must manage compaction state'
    );
    assert.match(
      compactBody,
      /try\s*\{[\s\S]*finally/,
      'must ensure cleanup in finally block'
    );
  });

});

test.describe('Compaction Manager - Error Handling', () => {

  test('compaction operations handle errors gracefully', () => {
    const source = compactionManagerSource;

    assert.match(
      source,
      /try\s*\{[\s\S]*catch\s*\(|logger\.error/,
      'must include error handling'
    );
    assert.match(
      source,
      /postCompactionStatus.*error|status.*error/,
      'must report errors to UI'
    );
  });

  test('compaction validates message data', () => {
    const source = compactionManagerSource;

    assert.match(
      source,
      /resolveSessionCompactionDividerState[\s\S]*processHistoryMessages/,
      'must process messages'
    );
    assert.match(
      source,
      /resolveSessionCompactionDividerState[\s\S]*Array\.isArray/,
      'must validate message array'
    );
  });

});
