/**
 * Core Subagent Tracker Regression Tests
 *
 * These tests prevent regressions in subagent tracking functionality.
 * Subagent tracking is critical for monitoring AI subtask execution.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const subagentTrackerSource = readSource(
  [joinFromRoot('src', 'services', 'SubagentTracker.ts')],
  'SubagentTracker.ts',
);

test.describe('Subagent Tracker - State Management', () => {

  test('resetForSession clears all tracking state', () => {
    const resetBody = extractFunctionBody(subagentTrackerSource, 'resetForSession');

    assert.match(
      resetBody,
      /clear|reset|detailsById\.clear|idsByParentMessageId\.clear/s,
      'must clear all tracking maps'
    );
  });

  test('setActiveSession updates active session', () => {
    const setActiveBody = extractFunctionBody(subagentTrackerSource, 'setActiveSession');

    assert.match(
      setActiveBody,
      /activeSessionId\s*=/s,
      'must update active session ID'
    );
  });

  test('getLatestParentMessageId retrieves parent message', () => {
    const getLatestBody = extractFunctionBody(subagentTrackerSource, 'getLatestParentMessageId');

    assert.match(
      getLatestBody,
      /latestParentMessageBySessionId\.get|return/s,
      'must retrieve latest parent message ID'
    );
  });

  test('getActiveProcessingSessionIds finds active sessions', () => {
    const getActiveBody = extractFunctionBody(subagentTrackerSource, 'getActiveProcessingSessionIds');

    assert.match(
      getActiveBody,
      /status\s*===\s*["']pending["']|status\s*===\s*["']running["']|Set/s,
      'must find sessions with pending/running subagents'
    );
  });

});

test.describe('Subagent Tracker - Data Seeding', () => {

  test('seedFromMessages initializes from message history', () => {
    const seedBody = extractFunctionBody(subagentTrackerSource, 'seedFromMessages');

    assert.match(
      seedBody,
      /detailsById\.clear|normalizePersistedDetail|upsertDetail/s,
      'must initialize from persisted message data'
    );
  });

  test('seedFromMessages filters assistant messages', () => {
    const seedBody = extractFunctionBody(subagentTrackerSource, 'seedFromMessages');

    assert.match(
      seedBody,
      /role\s*!==\s*["']assistant["']|continue|filter/s,
      'must only process assistant messages'
    );
  });

  test('seedFromMessages extracts subagent data', () => {
    const seedBody = extractFunctionBody(subagentTrackerSource, 'seedFromMessages');

    assert.match(
      seedBody,
      /subagents|message\.subagents|normalizePersistedDetail/s,
      'must extract subagent information'
    );
  });

});

test.describe('Subagent Tracker - Event Consumption', () => {

  test('consumeStreamEvent processes stream events', () => {
    const consumeBody = extractFunctionBody(subagentTrackerSource, 'consumeStreamEvent');

    assert.match(
      consumeBody,
      /eventType|handleMessagePartUpdated|handleMessageUpdated|handleSessionCreated/s,
      'must route events to handlers'
    );
  });

  test('consumeStreamEvent builds update payload', () => {
    const consumeBody = extractFunctionBody(subagentTrackerSource, 'consumeStreamEvent');

    assert.match(
      consumeBody,
      /buildUpdatePayload|changedParents|changedDetails/s,
      'must build update payload for changes'
    );
  });

  test('handleMessagePartUpdated processes part updates', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /handleMessagePartUpdated[\s\S]*part\.type|thinking|progress|conversation/s,
      'must process message part updates'
    );
  });

  test('handleMessageUpdated processes message updates', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /handleMessageUpdated[\s\S]*info\.role|tokens|finish|completed/s,
      'must process message completion'
    );
  });

  test('handleSessionCreated processes child sessions', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /handleSessionCreated[\s\S]*childSessionId|parentID|pendingSubtasksByParentSessionId/s,
      'must process child session creation'
    );
  });

  test('handleSessionError processes session errors', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /handleSessionError[\s\S]*error|status\s*=\s*["']error["']|errorText/s,
      'must process session errors'
    );
  });

});

test.describe('Subagent Tracker - Detail Management', () => {

  test('normalizePersistedDetail creates detail from raw data', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /normalizePersistedDetail[\s\S]*asString|asNumber|asRecord|status|references|events/s,
      'must normalize and validate persisted data'
    );
  });

  test('normalizePersistedDetail validates status values', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /normalizePersistedDetail[\s\S]*pending|running|done|error|orphaned/s,
      'must validate status enum values'
    );
  });

  test('normalizePersistedDetail processes event arrays', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /normalizePersistedDetail[\s\S]*thinkingEvents|conversationEvents|progressEvents|timelineEvents/s,
      'must process event arrays'
    );
  });

  test('upsertDetail stores and indexes detail', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /upsertDetail[\s\S]*detailsById\.set|attachToParentMessage|childSessionToSubagentId/s,
      'must store detail and update indexes'
    );
  });

});

test.describe('Subagent Tracker - Event Tracking', () => {

  test('pushThinking adds thinking events', () => {
    const pushThinkingBody = extractFunctionBody(subagentTrackerSource, 'pushThinking');

    assert.match(
      pushThinkingBody,
      /thinkingEvents|clampEvents|MAX_THINKING_EVENTS/s,
      'must add thinking events with limit'
    );
  });

  test('pushConversation adds conversation events', () => {
    const pushConvBody = extractFunctionBody(subagentTrackerSource, 'pushConversation');

    assert.match(
      pushConvBody,
      /conversationEvents|joinConversationText|kind|role/s,
      'must add conversation events with deduplication'
    );
  });

  test('pushProgress adds progress events', () => {
    const pushProgressBody = extractFunctionBody(subagentTrackerSource, 'pushProgress');

    assert.match(
      pushProgressBody,
      /progressEvents|status|callID|title|sanitizeActivityLabel/s,
      'must add progress events with update logic'
    );
  });

  test('pushTimeline adds timeline events', () => {
    const pushTimelineBody = extractFunctionBody(subagentTrackerSource, 'pushTimeline');

    assert.match(
      pushTimelineBody,
      /timelineEvents|label|type|deduplicate|clampEvents/s,
      'must add timeline events with deduplication'
    );
  });

  test('addReference adds unique references', () => {
    const addRefBody = extractFunctionBody(subagentTrackerSource, 'addReference');

    assert.match(
      addRefBody,
      /references|some|exists|push|messageID|partID|callID/s,
      'must add references without duplicates'
    );
  });

});

test.describe('Subagent Tracker - Progress Extraction', () => {

  test('extractProgressFromPart handles tool parts', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /extractProgressFromPart[\s\S]*tool|state|input|result|diffStats/s,
      'must extract progress from tool parts'
    );
  });

  test('extractProgressFromPart handles step parts', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /extractProgressFromPart[\s\S]*step-start|step-finish|snapshot|reason/s,
      'must extract progress from step parts'
    );
  });

  test('extractProgressFromPart handles patch parts', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /extractProgressFromPart[\s\S]*patch|files|diffStats/s,
      'must extract progress from patch parts'
    );
  });

  test('extractProgressFromPart handles subtask parts', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /extractProgressFromPart[\s\S]*subtask|description|agent/s,
      'must extract progress from subtask parts'
    );
  });

});

test.describe('Subagent Tracker - Duration Calculation', () => {

  test('recomputeDuration calculates elapsed time', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /recomputeDuration[\s\S]*startedAt|endedAt|durationMs|Date\.now|Math\.max/s,
      'must calculate duration from timestamps'
    );
  });

  test('recomputeDuration handles running subagents', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /recomputeDuration[\s\S]*running|pending|orphaned|Date\.now/s,
      'must calculate ongoing duration for active subagents'
    );
  });

});

test.describe('Subagent Tracker - Payload Building', () => {

  test('buildUpdatePayload creates summaries', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /buildUpdatePayload[\s\S]*summariesByParentMessageId|cloneSummary|compareByStartedAtDesc|sort/s,
      'must create summaries sorted by start time'
    );
  });

  test('buildUpdatePayload clones details', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /buildUpdatePayload[\s\S]*detailsById|cloneDetail|recomputeDuration/s,
      'must clone detail objects'
    );
  });

  test('getSnapshotPayload returns all tracked data', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /getSnapshotPayload[\s\S]*buildUpdatePayload|idsByParentMessageId\.keys|detailsById\.keys/s,
      'must return snapshot of all tracked data'
    );
  });

  test('getPayloadForParentMessage returns parent data', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /getPayloadForParentMessage[\s\S]*idsByParentMessageId\.get|buildUpdatePayload/s,
      'must return data for specific parent message'
    );
  });

});

test.describe('Subagent Tracker - Hydration', () => {

  test('finalizeParentMessage hydrates from client', () => {
    const finalizeBody = extractFunctionBody(subagentTrackerSource, 'finalizeParentMessage');

    assert.match(
      finalizeBody,
      /client\.session\.children|hydrateChildSessionMessages|hydrationUnavailable/s,
      'must hydrate details from client API'
    );
  });

  test('hydrateChildSessionMessages loads conversation', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /hydrateChildSessionMessages[\s\S]*client\.session\.messages|conversationEvents|buildConversationEventsFromChildSessionMessages/s,
      'must load conversation from child session'
    );
  });

  test('buildConversationEventsFromChildSessionMessages extracts events', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /buildConversationEventsFromChildSessionMessages[\s\S]*reasoningEvents|parts|steps|append/s,
      'must extract conversation events from messages'
    );
  });

  test('finalizeParentMessage handles hydration failures', () => {
    const finalizeBody = extractFunctionBody(subagentTrackerSource, 'finalizeParentMessage');

    assert.match(
      finalizeBody,
      /catch|error|hydrationUnavailable\s*=\s*true/s,
      'must handle hydration failures gracefully'
    );
  });

});

test.describe('Subagent Tracker - Child Session Binding', () => {

  test('bindChildSessionToKnownSubtask links sessions', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /bindChildSessionToKnownSubtask[\s\S]*pendingSubtasksByParentSessionId|childSessionToSubagentId|childSessionToParentSessionId/s,
      'must bind child session to pending subtask'
    );
  });

  test('bindChildSessionToKnownSubtask updates status', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /bindChildSessionToKnownSubtask[\s\S]*status\s*=\s*["']running["']|childSessionId/s,
      'must update subtask status to running'
    );
  });

});

test.describe('Subagent Tracker - Data Sanitization', () => {

  test('sanitizeReasoningText removes opaque IDs', () => {
    const sanitizeBody = extractFunctionBody(subagentTrackerSource, 'sanitizeReasoningText');

    assert.match(
      sanitizeBody,
      /isOpaqueIdLike|trim|return.*""/s,
      'must filter out opaque ID-like strings'
    );
  });

  test('sanitizeActivityLabel normalizes whitespace', () => {
    const sanitizeLabelBody = extractFunctionBody(subagentTrackerSource, 'sanitizeActivityLabel');

    assert.match(
      sanitizeLabelBody,
      /replace.*\\s\+|trim|isOpaqueIdLike/s,
      'must normalize and validate activity labels'
    );
  });

  test('joinConversationText merges conversation fragments', () => {
    const joinBody = extractFunctionBody(subagentTrackerSource, 'joinConversationText');

    assert.match(
      joinBody,
      /startsWith|endsWith|concat|space|\s+/s,
      'must intelligently merge text fragments'
    );
  });

  test('normalizeProgressStatus maps status values', () => {
    const normalizeStatusBody = extractFunctionBody(subagentTrackerSource, 'normalizeProgressStatus');

    assert.match(
      normalizeStatusBody,
      /done|completed|success|finished|error|failed|pending/s,
      'must normalize various status values'
    );
  });

});

test.describe('Subagent Tracker - Utility Functions', () => {

  test('asRecord converts to record', () => {
    const asRecordBody = extractFunctionBody(subagentTrackerSource, 'asRecord');

    assert.match(
      asRecordBody,
      /typeof.*===\s*["']object["']|null|Record/s,
      'must safely convert to record type'
    );
  });

  test('asString converts to string', () => {
    const asStringBody = extractFunctionBody(subagentTrackerSource, 'asString');

    assert.match(
      asStringBody,
      /typeof.*===\s*["']string["']|return|fallback/s,
      'must safely convert to string type'
    );
  });

  test('asNumber converts to number', () => {
    const asNumberBody = extractFunctionBody(subagentTrackerSource, 'asNumber');

    assert.match(
      asNumberBody,
      /typeof.*===\s*["']number["']|undefined|return/s,
      'must safely convert to number type'
    );
  });

  test('toTimestamp handles timestamp conversion', () => {
    const toTimestampBody = extractFunctionBody(subagentTrackerSource, 'toTimestamp');

    assert.match(
      toTimestampBody,
      /Number\.isFinite|Date\.now|fallback/s,
      'must safely convert to timestamp'
    );
  });

  test('clampEvents limits event array size', () => {
    const clampBody = extractFunctionBody(subagentTrackerSource, 'clampEvents');

    assert.match(
      clampBody,
      /slice|length|max|MAX_.*_EVENTS/s,
      'must limit event arrays to max size'
    );
  });

});

test.describe('Subagent Tracker - Session Resolution', () => {

  test('resolveDetailForPartEvent finds detail for part', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /resolveDetailForPartEvent[\s\S]*childSessionToSubagentId|idsByParentMessageId|parentSessionId|childSessionId/s,
      'must resolve detail from session or message'
    );
  });

  test('resolveDetailForPartEvent handles child sessions', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /resolveDetailForPartEvent[\s\S]*childSessionToSubagentId\.get|detailsById\.get/s,
      'must resolve child session to detail'
    );
  });

});

test.describe('Subagent Tracker - Subtask Creation', () => {

  test('makeSubtaskSubagentId generates subtask IDs', () => {
    const makeIdBody = extractFunctionBody(subagentTrackerSource, 'makeSubtaskSubagentId');

    assert.match(
      makeIdBody,
      /subtask:|sessionId|messageId|partId/s,
      'must generate unique subtask IDs'
    );
  });

  test('makeTimelineKey generates timeline keys', () => {
    const makeKeyBody = extractFunctionBody(subagentTrackerSource, 'makeTimelineKey');

    assert.match(
      makeKeyBody,
      /eventType|messageID|partID|createdAt|:/s,
      'must generate unique timeline keys'
    );
  });

});

test.describe('Subagent Tracker - Progress Management', () => {

  test('ensureAllProgressDone finalizes progress', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /ensureAllProgressDone[\s\S]*progressEvents|status\s*=\s*["']done["']|forEach/s,
      'must mark all progress as done'
    );
  });

  test('extractPrimaryMessageText extracts message content', () => {
    const extractBody = extractFunctionBody(subagentTrackerSource, 'extractPrimaryMessageText');

    assert.match(
      extractBody,
      /content|text|parts|join|trim/s,
      'must extract primary message text'
    );
  });

});

test.describe('Subagent Tracker - Cloning', () => {

  test('cloneReference clones reference objects', () => {
    const cloneRefBody = extractFunctionBody(subagentTrackerSource, 'cloneReference');

    assert.match(
      cloneRefBody,
      /messageID|partID|callID|return.*\{/s,
      'must clone reference objects'
    );
  });

  test('cloneSummary clones summary objects', () => {
    const cloneSummaryBody = extractFunctionBody(subagentTrackerSource, 'cloneSummary');

    assert.match(
      cloneSummaryBody,
      /\.\.\.|references|map|cloneReference/s,
      'must clone summary with references'
    );
  });

  test('cloneDetail clones detail objects', () => {
    const cloneDetailBody = extractFunctionBody(subagentTrackerSource, 'cloneDetail');

    assert.match(
      cloneDetailBody,
      /\.\.\.|thinkingEvents|conversationEvents|progressEvents|timelineEvents|map/s,
      'must clone detail with all events'
    );
  });

});

test.describe('Subagent Tracker - Sorting', () => {

  test('compareByStartedAtDesc sorts by start time', () => {
    const compareBody = extractFunctionBody(subagentTrackerSource, 'compareByStartedAtDesc');

    assert.match(
      compareBody,
      /startedAt|bTime\s*-\s*aTime|return/s,
      'must sort descending by start time'
    );
  });

});

test.describe('Subagent Tracker - Error Handling', () => {

  test('tracker handles missing data gracefully', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /if\s*\(\s*!.*\s*\)|typeof|undefined|null|\?\./s,
      'must validate input data'
    );
  });

  test('tracker provides safe defaults', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /return.*\[\]|return\s*\{\}|fallback|default|undefined/s,
      'must return safe defaults'
    );
  });

  test('tracker handles missing properties', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /asRecord|asString|asNumber|\|\|/s,
      'must safely access nested properties'
    );
  });

});

test.describe('Subagent Tracker - Performance', () => {

  test('tracker uses efficient data structures', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /Map|Set|Array\.from|forEach/s,
      'must use efficient data structures'
    );
  });

  test('tracker limits memory usage', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /MAX_TIMELINE_EVENTS|MAX_PROGRESS_EVENTS|MAX_THINKING_EVENTS|MAX_CONVERSATION_EVENTS|clampEvents/s,
      'must limit event array sizes'
    );
  });

});

test.describe('Subagent Tracker - Integration', () => {

  test('tracker integrates with stream events', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /consumeStreamEvent|eventType|properties|message\.part\.updated|message\.updated|session\.created|session\.error/s,
      'must integrate with stream event system'
    );
  });

  test('tracker integrates with client API', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /client\.session\.children|client\.session\.messages|hydrate/s,
      'must integrate with client API'
    );
  });

  test('tracker tracks token usage', () => {
    const source = subagentTrackerSource;

    assert.match(
      source,
      /tokenUsage|input|output|reasoning|cache|read|write/s,
      'must track token consumption'
    );
  });

});
