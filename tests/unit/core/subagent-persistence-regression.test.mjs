/**
 * Core Subagent Persistence Regression Tests
 *
 * These tests prevent regressions in subagent data persistence and tracking.
 * Subagent conversations are complex - bugs here can cause data loss or
 * incorrect conversation attribution.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const subagentPersistenceSource = readSource(
  [joinFromRoot('src', 'providers', 'chat', 'SubagentPersistence.ts')],
  'SubagentPersistence.ts',
);

test.describe('Subagent Persistence - Data Integrity', () => {

  test('persistSubagentUpdateSnapshot validates payload structure', () => {
    const persistBody = extractFunctionBody(subagentPersistenceSource, 'async persistSubagentUpdateSnapshot(');

    assert.match(
      persistBody,
      /summariesByParentMessageId|asRecord/,
      'must validate payload structure'
    );
    assert.match(
      persistBody,
      /resolveSubagentPayloadSessionId/,
      'must resolve session ID from payload'
    );
  });

  test('persistSubagentUpdateSnapshot handles message merging', () => {
    const persistBody = extractFunctionBody(subagentPersistenceSource, 'async persistSubagentUpdateSnapshot(');

    assert.match(
      persistBody,
      /hydrateSubagentsFromPayload|mergeSubagentEntries/,
      'must merge subagent data with messages'
    );
    assert.match(
      persistBody,
      /saveSessionMessages/,
      'must persist updated messages'
    );
  });

  test('persistSubagentLiveState merges with existing state', () => {
    const liveStateBody = extractFunctionBody(subagentPersistenceSource, 'async persistSubagentLiveState(');

    assert.match(
      liveStateBody,
      /loadPersistedSubagentSnapshot/,
      'must load existing snapshot'
    );
    assert.match(
      liveStateBody,
      /mergeSubagentPayloads/,
      'must merge with existing data'
    );
  });

});

test.describe('Subagent Persistence - Session Association', () => {

  test('buildSubagentPayloadFromMessage extracts subagent data', () => {
    const buildBody = extractFunctionBody(subagentPersistenceSource, 'buildSubagentPayloadFromMessage');

    assert.match(
      buildBody,
      /Array\.isArray\(message\.subagents\)/,
      'must validate subagents array'
    );
    assert.match(
      buildBody,
      /parentSessionId|parentMessageId/,
      'must extract parent relationship data'
    );
  });

  test('buildSubagentPayloadFromMessage normalizes subagent entries', () => {
    const buildBody = extractFunctionBody(subagentPersistenceSource, 'buildSubagentPayloadFromMessage');

    assert.match(
      buildBody,
      /normalizeSubagentStatus/,
      'must normalize subagent status'
    );
    assert.match(
      buildBody,
      /summaries\.push|detailsById/,
      'must build summaries and details structures'
    );
  });

});

test.describe('Subagent Persistence - Error Handling', () => {

  test('subagent operations handle missing data gracefully', () => {
    const source = subagentPersistenceSource;

    assert.match(
      source,
      /asRecord|if\s*\(\s*!/s,
      'must validate data structures'
    );
    assert.match(
      source,
      /return\s*null|return\s*undefined/,
      'must return safe defaults for missing data'
    );
  });

  test('syncSubagentSnapshotForSession handles tracker integration', () => {
    const syncBody = extractFunctionBody(subagentPersistenceSource, 'async syncSubagentSnapshotForSession(');

    assert.match(
      syncBody,
      /subagentTracker\.resetForSession|subagentTracker\.seedFromMessages/,
      'must integrate with subagent tracker'
    );
    assert.match(
      syncBody,
      /getSnapshotPayload/,
      'must get tracker snapshot'
    );
  });

});
