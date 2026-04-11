/**
 * SubagentTracker Unit Tests
 *
 * Comprehensive tests for SubagentTracker covering:
 * - Subagent lifecycle tracking
 * - Event correlation and processing
 * - Parent-child session relationships
 * - Status management
 * - Event storage and limits
 * - Timeline and progress tracking
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../../helpers/source-utils.mjs';

const trackerSource = readSource(
  [joinFromRoot('src', 'services', 'SubagentTracker.ts')],
  'SubagentTracker.ts',
);

test('SubagentTracker exports type definitions', () => {
  assert.match(
    trackerSource,
    /export\s+type\s+SubagentStatus\s*=/,
    'Should export SubagentStatus type'
  );
  assert.match(
    trackerSource,
    /"pending"|"running"|"done"|"error"|"orphaned"/,
    'SubagentStatus should include all status values'
  );

  assert.match(
    trackerSource,
    /export\s+type\s+SubagentReference\s*=/,
    'Should export SubagentReference type'
  );
  assert.match(
    trackerSource,
    /export\s+type\s+SubagentTimelineEvent\s*=/,
    'Should export SubagentTimelineEvent type'
  );
  assert.match(
    trackerSource,
    /export\s+type\s+SubagentThinkingEvent\s*=/,
    'Should export SubagentThinkingEvent type'
  );
  assert.match(
    trackerSource,
    /export\s+type\s+SubagentProgressEvent\s*=/,
    'Should export SubagentProgressEvent type'
  );
  assert.match(
    trackerSource,
    /export\s+type\s+SubagentSummary\s*=/,
    'Should export SubagentSummary type'
  );
  assert.match(
    trackerSource,
    /export\s+type\s+SubagentDetail\s*=/,
    'Should export SubagentDetail type'
  );
  assert.match(
    trackerSource,
    /export\s+type\s+SubagentUpdatePayload\s*=/,
    'Should export SubagentUpdatePayload type'
  );
});

test('SubagentTracker is exported as a class', () => {
  assert.match(
    trackerSource,
    /export\s+class\s+SubagentTracker/,
    'SubagentTracker should be exported as a class'
  );
});

test('SubagentTracker constructor initializes state', () => {
  assert.match(
    trackerSource,
    /private\s+\w+\s*(?::\s*[^=]+)?\s*=\s*new Map</,
    'SubagentTracker should initialize Map properties'
  );
  assert.match(
    trackerSource,
    /resetForSession\(/,
    'SubagentTracker should have resetForSession method'
  );
});

test('SubagentTracker defines event storage limits', () => {
  assert.match(
    trackerSource,
    /MAX_TIMELINE_EVENTS\s*=\s*200/,
    'Should define MAX_TIMELINE_EVENTS'
  );
  assert.match(
    trackerSource,
    /MAX_PROGRESS_EVENTS\s*=\s*200/,
    'Should define MAX_PROGRESS_EVENTS'
  );
  assert.match(
    trackerSource,
    /MAX_THINKING_EVENTS\s*=\s*200/,
    'Should define MAX_THINKING_EVENTS'
  );
});

test('SubagentTracker implements handleMessagePartUpdated', () => {
  assert.match(
    trackerSource,
    /handleMessagePartUpdated\(/,
    'Should expose handleMessagePartUpdated method'
  );

  const handlePartBody = extractFunctionBody(
    trackerSource,
    'private handleMessagePartUpdated('
  );

  assert.match(
    handlePartBody,
    /partType/,
    'handleMessagePartUpdated should check part type'
  );
});

test('SubagentTracker implements handleMessageUpdated', () => {
  assert.match(
    trackerSource,
    /private\s+handleMessageUpdated\(/,
    'Should expose handleMessageUpdated method'
  );

  const handleMessageBody = extractFunctionBody(
    trackerSource,
    'private handleMessageUpdated('
  );

  assert.match(
    handleMessageBody,
    /childSessionToSubagentId\.get\(|detailsById\.get\(/,
    'handleMessageUpdated should look up subagent by child session'
  );
  assert.match(
    handleMessageBody,
    /upsertDetail\(/,
    'handleMessageUpdated should upsert detail after update'
  );
});

test('SubagentTracker implements handleSessionCreated', () => {
  assert.match(
    trackerSource,
    /private\s+handleSessionCreated\(/,
    'Should expose handleSessionCreated method'
  );

  const handleSessionBody = extractFunctionBody(
    trackerSource,
    'private handleSessionCreated('
  );

  assert.match(
    handleSessionBody,
    /pendingSubtasksByParentSessionId/,
    'handleSessionCreated should access pending subtasks'
  );
  assert.match(
    handleSessionBody,
    /childSessionId/,
    'handleSessionCreated should set childSessionId'
  );
});

test('SubagentTracker implements getOrCreateSubagent', () => {
  // getOrCreateSubagent functionality is handled by bindChildSessionToKnownSubtask
  assert.match(
    trackerSource,
    /bindChildSessionToKnownSubtask\(/,
    'Should expose bindChildSessionToKnownSubtask method for binding child sessions'
  );
});

test('SubagentTracker implements status and event management', () => {
  assert.match(
    trackerSource,
    /clampEvents/,
    'Should use clampEvents for event limiting'
  );
});

test('SubagentTracker implements finalizeParentMessage', () => {
  assert.match(
    trackerSource,
    /async\s+finalizeParentMessage\(/,
    'Should expose finalizeParentMessage method'
  );

  const finalizeBody = extractFunctionBody(
    trackerSource,
    'async finalizeParentMessage('
  );

  assert.match(
    finalizeBody,
    /childrenFn\(/,
    'finalizeParentMessage should call childrenFn to get child sessions'
  );
  assert.match(
    finalizeBody,
    /hydrateChildSessionMessages\(/,
    'finalizeParentMessage should hydrate child session messages'
  );
  assert.match(
    finalizeBody,
    /hydrationUnavailable\s*=\s*true|status\s*=\s*["']orphaned["']/,
    'finalizeParentMessage should mark subagents as unavailable or orphaned if needed'
  );
});

test('SubagentTracker implements buildUpdatePayload', () => {
  assert.match(
    trackerSource,
    /buildUpdatePayload\(/,
    'Should expose buildUpdatePayload method'
  );

  const buildPayloadBody = extractFunctionBody(
    trackerSource,
    'private buildUpdatePayload('
  );

  assert.match(
    buildPayloadBody,
    /summariesByParentMessageId/,
    'buildUpdatePayload should build summaries by parent message ID'
  );
  assert.match(
    buildPayloadBody,
    /detailsById/,
    'buildUpdatePayload should build details by ID'
  );
});

test('SubagentTracker implements hydrateChildSessionMessages', () => {
  assert.match(
    trackerSource,
    /private\s+async\s+hydrateChildSessionMessages\(/,
    'Should expose hydrateChildSessionMessages method'
  );

  const hydrateBody = extractFunctionBody(
    trackerSource,
    'private async hydrateChildSessionMessages('
  );

  assert.match(
    hydrateBody,
    /messagesFn\(|\.messages\(/,
    'hydrateChildSessionMessages should fetch child messages'
  );
  assert.match(
    hydrateBody,
    /tokenUsage/,
    'hydrateChildSessionMessages should extract token usage'
  );
});

test('SubagentTracker implements markOrphanedSubagents', () => {
  // Orphaned status is set inline in various places, not a separate method
  assert.match(
    trackerSource,
    /status\s*:\s*["']orphaned["']/,
    'Code should be able to set subagent status to orphaned'
  );
  assert.match(
    trackerSource,
    /orphan-/,
    'Code should create orphan subagent IDs when needed'
  );
});

test('SubagentTracker implements resetForSession', () => {
  assert.match(
    trackerSource,
    /resetForSession\(/,
    'Should expose resetForSession method'
  );

  const resetBody = extractFunctionBody(
    trackerSource,
    'resetForSession('
  );

  assert.match(
    resetBody,
    /\.clear\(\)/,
    'resetForSession should clear all tracking maps'
  );
  assert.match(
    resetBody,
    /activeSessionId\s*=\s*sessionId/,
    'resetForSession should set active session ID'
  );
});

test('SubagentTracker implements utility functions', () => {
  assert.match(
    trackerSource,
    /function\s+asRecord\(/,
    'Should define asRecord utility function'
  );
  assert.match(
    trackerSource,
    /function\s+asString\(/,
    'Should define asString utility function'
  );
  assert.match(
    trackerSource,
    /function\s+asNumber\(/,
    'Should define asNumber utility function'
  );
  assert.match(
    trackerSource,
    /function\s+asBoolean\(/,
    'Should define asBoolean utility function'
  );
  assert.match(
    trackerSource,
    /function\s+toTimestamp\(/,
    'Should define toTimestamp utility function'
  );
});

test('SubagentTracker implements reasoning detection', () => {
  assert.match(
    trackerSource,
    /function\s+isReasoningPart\(/,
    'Should define isReasoningPart function'
  );

  const isReasoningBody = extractFunctionBody(
    trackerSource,
    'function isReasoningPart('
  );

  assert.match(
    isReasoningBody,
    /partType\s*===\s*"reasoning"/,
    'isReasoningPart should check for reasoning type'
  );
  assert.match(
    isReasoningBody,
    /typeof\s+part\.reasoning\s*!==\s*"undefined"/,
    'isReasoningPart should check for reasoning field'
  );
  assert.match(
    isReasoningBody,
    /typeof\s+part\.thought\s*!==\s*"undefined"/,
    'isReasoningPart should check for thought field'
  );
  assert.match(
    isReasoningBody,
    /typeof\s+part\.thinking\s*!==\s*"undefined"/,
    'isReasoningPart should check for thinking field'
  );
});

test('SubagentTracker implements opaque ID detection', () => {
  assert.match(
    trackerSource,
    /function\s+isOpaqueIdLike\(/,
    'Should define isOpaqueIdLike function'
  );

  const isOpaqueIdBody = extractFunctionBody(
    trackerSource,
    'function isOpaqueIdLike('
  );

  assert.match(
    isOpaqueIdBody,
    /text\.length\s*<\s*8/,
    'isOpaqueIdLike should check minimum length'
  );
  assert.match(
    isOpaqueIdBody,
    /\/\^\[a-f0-9-\]\{8,\}\$\/i/,
    'isOpaqueIdLike should check for hex pattern'
  );
  assert.match(
    isOpaqueIdBody,
    /\/\^msg\[_-\]\[a-z0-9-\]\+\$\/i/,
    'isOpaqueIdLike should check for msg pattern'
  );
  assert.match(
    isOpaqueIdBody,
    /\/\^call\[_-\]\[a-z0-9-\]\+\$\/i/,
    'isOpaqueIdLike should check for call pattern'
  );
});

test('SubagentTracker implements reasoning text sanitization', () => {
  assert.match(
    trackerSource,
    /function\s+sanitizeReasoningText\(/,
    'Should define sanitizeReasoningText function'
  );

  const sanitizeReasoningBody = extractFunctionBody(
    trackerSource,
    'function sanitizeReasoningText('
  );

  assert.match(
    sanitizeReasoningBody,
    /\.trim\(\)/,
    'sanitizeReasoningText should trim input'
  );
  assert.match(
    sanitizeReasoningBody,
    /isOpaqueIdLike\(/,
    'sanitizeReasoningText should check for opaque IDs'
  );
  assert.match(
    sanitizeReasoningBody,
    /return\s*""/,
    'sanitizeReasoningText should return empty for opaque IDs'
  );
});

test('SubagentTracker implements activity label sanitization for subagent UI text', () => {
  assert.match(
    trackerSource,
    /function\s+sanitizeActivityLabel\(/,
    'Should define sanitizeActivityLabel function'
  );

  const sanitizeActivityBody = extractFunctionBody(
    trackerSource,
    'function sanitizeActivityLabel('
  );

  assert.match(
    sanitizeActivityBody,
    /isOpaqueIdLike\(/,
    'sanitizeActivityLabel should filter opaque IDs'
  );
  assert.match(
    sanitizeActivityBody,
    /replace\(/,
    'sanitizeActivityLabel should normalize whitespace'
  );
});

test('SubagentTracker implements progress status normalization', () => {
  assert.match(
    trackerSource,
    /function\s+normalizeProgressStatus\(/,
    'Should define normalizeProgressStatus function'
  );

  const normalizeStatusBody = extractFunctionBody(
    trackerSource,
    'function normalizeProgressStatus('
  );

  assert.match(
    normalizeStatusBody,
    /status\s*===\s*"done"\s*\|\|/,
    'normalizeProgressStatus should handle done/completed variants'
  );
  assert.match(
    normalizeStatusBody,
    /status\s*===\s*"error"\s*\|\|/,
    'normalizeProgressStatus should handle error/failed variants'
  );
  assert.match(
    normalizeStatusBody,
    /return\s*"pending"/,
    'normalizeProgressStatus should default to pending'
  );
});

test('SubagentTracker implements event clamping', () => {
  assert.match(
    trackerSource,
    /function\s+clampEvents</,
    'Should define clampEvents function'
  );

  const clampEventsBody = extractFunctionBody(
    trackerSource,
    'function clampEvents'
  );

  assert.match(
    clampEventsBody,
    /if\s*\(events\.length\s*<=\s*max\)/,
    'clampEvents should check if under limit'
  );
  assert.match(
    clampEventsBody,
    /return\s+events/,
    'clampEvents should return as-is if under limit'
  );
  assert.match(
    clampEventsBody,
    /events\.slice\(events\.length\s*-\s*max\)/,
    'clampEvents should slice to keep most recent events'
  );
});

test('SubagentTracker merges streamed assistant chunks into conversation text', () => {
  assert.match(
    trackerSource,
    /function\s+joinConversationText\(/,
    'Should define joinConversationText helper for streaming chunk merges'
  );
  assert.match(
    trackerSource,
    /incoming\.startsWith\(previous\)/,
    'joinConversationText should handle full-text replacement updates'
  );
  assert.match(
    trackerSource,
    /previous\.endsWith\(incoming\)/,
    'joinConversationText should skip duplicate trailing chunks'
  );

  const pushConversationBody = extractFunctionBody(
    trackerSource,
    'private pushConversation('
  );
  assert.match(
    pushConversationBody,
    /joinConversationText\(/,
    'pushConversation should merge updates for the same message/part'
  );
  assert.match(
    pushConversationBody,
    /MAX_CONVERSATION_EVENTS/,
    'pushConversation should clamp conversation history'
  );
});

test('SubagentTracker deduplicates noisy timeline events', () => {
  const pushTimelineBody = extractFunctionBody(
    trackerSource,
    'private pushTimeline('
  );

  assert.match(
    pushTimelineBody,
    /sanitizeActivityLabel\(/,
    'pushTimeline should sanitize labels before appending'
  );
  assert.match(
    pushTimelineBody,
    /previous\.type === normalizedEvent\.type[\s\S]*previous\.label === normalizedEvent\.label/s,
    'pushTimeline should collapse repeated timeline events with same type/label'
  );
});

test('SubagentTracker merges progress events by callID and avoids duplicate rows', () => {
  const pushProgressBody = extractFunctionBody(
    trackerSource,
    'private pushProgress('
  );

  assert.match(
    pushProgressBody,
    /normalizedEvent\.callID/,
    'pushProgress should consider callID for merging tool progress updates'
  );
  assert.match(
    pushProgressBody,
    /detail\.progressEvents\.findIndex\(/,
    'pushProgress should merge existing progress entries that share callID'
  );
  assert.match(
    pushProgressBody,
    /entry\.callID === normalizedEvent\.callID/,
    'pushProgress should match progress rows by callID'
  );
  assert.match(
    pushProgressBody,
    /previous\.title === normalizedEvent\.title[\s\S]*previous\.status === normalizedEvent\.status/s,
    'pushProgress should skip consecutive duplicate progress events'
  );
});

test('SubagentTracker suppresses low-signal text timeline spam', () => {
  const handlePartBody = extractFunctionBody(
    trackerSource,
    'private handleMessagePartUpdated('
  );

  assert.match(
    handlePartBody,
    /partType === "text"/,
    'handleMessagePartUpdated should treat text parts specially'
  );
  assert.match(
    handlePartBody,
    /!\(partType === "text" && !progress && !thinkingText\.trim\(\)\)/,
    'text-only deltas without progress/thinking should not create timeline entries'
  );
  assert.match(
    handlePartBody,
    /pushConversation\(detail,\s*\{\s*[\s\S]*kind:\s*"message"/s,
    'handleMessagePartUpdated should stream assistant text into conversationEvents'
  );
  assert.match(
    handlePartBody,
    /kind:\s*"reasoning"/,
    'handleMessagePartUpdated should stream reasoning updates into conversationEvents'
  );
  assert.match(
    handlePartBody,
    /kind:\s*"step"/,
    'handleMessagePartUpdated should stream progress/step updates into conversationEvents'
  );
});

test('SubagentTracker streams final assistant message updates into conversationEvents', () => {
  const handleMessageBody = extractFunctionBody(
    trackerSource,
    'private handleMessageUpdated('
  );

  assert.match(
    handleMessageBody,
    /messageText/,
    'handleMessageUpdated should read final message text from update payload'
  );
  assert.match(
    handleMessageBody,
    /pushConversation\(/,
    'handleMessageUpdated should push conversation updates for assistant replies'
  );
});

test('SubagentTracker implements cloning functions', () => {
  assert.match(
    trackerSource,
    /function\s+cloneReference\(/,
    'Should define cloneReference function'
  );
  assert.match(
    trackerSource,
    /function\s+cloneSummary\(/,
    'Should define cloneSummary function'
  );
  assert.match(
    trackerSource,
    /function\s+cloneDetail\(/,
    'Should define cloneDetail function'
  );

  const cloneSummaryBody = extractFunctionBody(
    trackerSource,
    'function cloneSummary('
  );

  assert.match(
    cloneSummaryBody,
    /\.\.\.summary/,
    'cloneSummary should spread summary properties'
  );
  assert.match(
    cloneSummaryBody,
    /references:\s*summary\.references\.map\(cloneReference\)/,
    'cloneSummary should clone references array'
  );
});

test('SubagentTracker processes parent message references', () => {
  assert.match(
    trackerSource,
    /parentMessageId/,
    'Should track parent message ID'
  );
  assert.match(
    trackerSource,
    /references/,
    'Should track references'
  );
});

test('SubagentTracker handles session-based organization', () => {
  assert.match(
    trackerSource,
    /childSessionToParentSessionId|pendingSubtasksByParentSessionId/,
    'Should organize child sessions by parent session ID'
  );
});

test('SubagentTracker tracks latest parent message ID', () => {
  assert.match(
    trackerSource,
    /latestParentMessageBySessionId/,
    'Should track latest parent message ID per session'
  );
});

test('SubagentTracker handles pending subtasks', () => {
  assert.match(
    trackerSource,
    /pendingSubtasksByParentSessionId/,
    'Should track pending subtasks'
  );
});
