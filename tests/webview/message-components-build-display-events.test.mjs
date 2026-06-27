import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFunctionBody, readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const messageComponentsSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'MessageComponents.tsx')],
  'MessageComponents.tsx',
);

test('buildDisplayEvents adds isImportant flag for error events', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function buildDisplayEvents(');
  assert.ok(body, 'buildDisplayEvents should exist');

  assert.match(
    body,
    /status\s*===\s*['"]error['"]/,
    'Should check for error status when determining importance'
  );
});

test('buildDisplayEvents adds isImportant flag for events with filePath', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function buildDisplayEvents(');

  assert.ok(
    body.includes('filePath') && body.includes('isImportant'),
    'Should check for filePath when determining importance'
  );
});

test('buildDisplayEvents adds isImportant flag for events with diffStats', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function buildDisplayEvents(');

  assert.ok(
    body.includes('diffStats') && body.includes('isImportant'),
    'Should check for diffStats when determining importance'
  );
});

test('buildDisplayEvents adds isImportant flag for events with viewDiffFile', () => {
  const body = extractFunctionBody(messageComponentsSource, 'function buildDisplayEvents(');

  assert.ok(
    body.includes('viewDiffFile') && body.includes('isImportant'),
    'Should check for viewDiffFile when determining importance'
  );
});

test('assistant turn cards scope centralized raw payloads strictly to the owning message', () => {
  assert.match(
    messageComponentsSource,
    /const\s+centralizedSessionId\s*=\s*[\s\S]*currentSessionId\s*\|\|[\s\S]*sessionID/,
    'MessageComponents should resolve a session-scoped raw payload key from the owning message'
  );

  assert.match(
    messageComponentsSource,
    /rawSdkEventPayloadsBySessionId\?\.\[centralizedSessionId\]/,
    'MessageComponents should read raw payloads from the owning session bucket'
  );

  assert.match(
    messageComponentsSource,
    /sdkPayloads\.length > 0 \? sdkPayloads : undefined/,
    'MessageComponents should keep empty payload lists scoped instead of falling back broadly'
  );
});

test('buildDisplayEvents uses the full assistant-turn message scope when rendering the timeline', () => {
  assert.match(
    messageComponentsSource,
    /function buildDisplayEvents\([\s\S]*messageScopeIds\?: Set<string>/,
    'buildDisplayEvents should accept a scoped assistant-turn message id set',
  );
  assert.match(
    messageComponentsSource,
    /buildDisplayEvents\([\s\S]*assistantTurnMessageIds[\s\S]*\)/,
    'AssistantResponseCardInner should pass the assistant-turn id set into buildDisplayEvents',
  );
  assert.match(
    messageComponentsSource,
    /isMessageInScope\(item\.messageID\)/,
    'buildDisplayEvents should decide visibility from the assistant-turn id scope rather than one id',
  );
});

test('rehydrated assistant turns can recover scope from syncEvent part envelopes', () => {
  assert.match(
    messageComponentsSource,
    /collectCentralizedTurnMessageIdCandidates\([\s\S]*syncEvent[\s\S]*data[\s\S]*part/,
    'MessageComponents should derive assistant-turn ids from sync-wrapped part envelopes',
  );
  assert.match(
    messageComponentsSource,
    /latestSyncWrappedAssistantMessageId[\s\S]*collectCentralizedTurnMessageIdCandidates/,
    'MessageComponents should fall back to the latest sync-wrapped message id when the hydrated assistant shell is missing',
  );
});

test('assistant activity timeline keeps the last non-empty hydrated tape across rerenders', () => {
  assert.match(
    messageComponentsSource,
    /stickyCentralizedRawSdkEventPayloadsRef/,
    'MessageComponents should latch the last hydrated payload tape for the current turn',
  );
  assert.match(
    messageComponentsSource,
    /effectiveCentralizedRawSdkEventPayloads/,
    'MessageComponents should render from the latched hydrated payload tape when the current snapshot is empty',
  );
});

test('assistant scopes stay turn-specific instead of inheriting every session payload', () => {
  assert.doesNotMatch(
    messageComponentsSource,
    /assistantScopeMessageIds[\s\S]*collectCentralizedTurnMessageIdCandidates\(sessionScopedRawSdkEventPayloads\)/,
    'assistantScopeMessageIds should not absorb every sync-wrapped assistant message in the session',
  );
});
