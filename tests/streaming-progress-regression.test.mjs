import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
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
