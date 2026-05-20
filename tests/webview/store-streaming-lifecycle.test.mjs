import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const storeSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);
const typesSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'types.ts')],
  'types.ts',
);

test('StreamingState includes the core streaming lifecycle fields', () => {
  assert.match(
    typesSource,
    /export interface StreamingState \{[\s\S]*messageId: string \| null;[\s\S]*content: string;[\s\S]*reasoning: string;[\s\S]*isActive: boolean;/,
    'StreamingState should carry messageId, content, reasoning, and isActive',
  );
});

test('streaming action types exist for content and reasoning updates', () => {
  assert.match(storeSource, /type: "SET_STREAMING"; payload: StreamingState \| null/, 'SET_STREAMING action should exist');
  assert.match(storeSource, /type: "UPDATE_STREAMING_CONTENT"; payload: StreamingContentPayload/, 'UPDATE_STREAMING_CONTENT action should exist');
  assert.match(storeSource, /type: "UPDATE_STREAMING_REASONING"; payload: StreamingReasoningPayload/, 'UPDATE_STREAMING_REASONING action should exist');
});

test('streaming step actions exist for tool progress updates', () => {
  assert.match(storeSource, /type: "ADD_STREAMING_STEP"; payload: StreamingStep/, 'ADD_STREAMING_STEP action should exist');
  assert.match(storeSource, /type: "UPDATE_STREAMING_STEP"; payload: StreamingStepUpdatePayload/, 'UPDATE_STREAMING_STEP action should exist');
  assert.match(storeSource, /type: "FINISH_STREAMING";/, 'FINISH_STREAMING action should exist');
});

test('global processing state action exists', () => {
  assert.match(storeSource, /type: "SET_PROCESSING"; payload: boolean/, 'SET_PROCESSING action should exist');
});

test('SET_STREAMING initializes streaming arrays and renderability defaults', () => {
  assert.match(
    storeSource,
    /case "SET_STREAMING":\s*\{[\s\S]*const streaming = action\.payload[\s\S]*hasRenderableContent: action\.payload\.hasRenderableContent \?\? false,[\s\S]*reasoningEvents: action\.payload\.reasoningEvents \?\? \[\],[\s\S]*progressEvents: action\.payload\.progressEvents \?\? \[\]/,
    'SET_STREAMING should normalize renderability and event arrays when bootstrapping state',
  );
});

test('SET_STREAMING stores the payload as the active streaming state', () => {
  assert.match(
    storeSource,
    /case "SET_STREAMING":\s*\{[\s\S]*const streaming = action\.payload[\s\S]*\.\.\.action\.payload[\s\S]*streamingBySessionId:\s*cacheStreamingForSession/,
    'SET_STREAMING should preserve the server-provided streaming payload',
  );
});

test('content updates append text and preserve content sequencing', () => {
  assert.match(
    storeSource,
    /case "UPDATE_STREAMING_CONTENT": \{/,
    'content updates should append or replace streaming text',
  );
  assert.match(
    storeSource,
    /action\.payload\.append[\s\S]*state\.streaming\.content[\s\S]*action\.payload\.content;/,
    'content updates should stamp first non-empty content arrival',
  );
  assert.match(
    storeSource,
    /const contentStartSeq =/,
    'content updates should track when first non-empty content arrives',
  );
});

test('reasoning updates merge reasoning text and events', () => {
  assert.match(
    storeSource,
    /case "UPDATE_STREAMING_REASONING": \{[\s\S]*const merged = mergeStreamingReasoning\(/,
    'reasoning updates should merge incoming reasoning chunks',
  );
  assert.match(
    storeSource,
    /reasoningEvents = appendWithCap\(/,
    'reasoning updates should cap the rolling reasoning event list',
  );
});

test('streaming step updates patch existing steps by id or callID', () => {
  assert.match(
    storeSource,
    /case "UPDATE_STREAMING_STEP": \{[\s\S]*action\.payload\.callID[\s\S]*step\.callID === action\.payload\.callID/s,
    'step updates should locate entries by id or callID',
  );
  assert.match(
    storeSource,
    /steps\[idx\] = \{ \.\.\.steps\[idx\], \.\.\.action\.payload\.patch \}/,
    'step updates should merge the partial patch into the existing step',
  );
});

test('FINISH_STREAMING keeps final content but ends activity', () => {
  assert.match(
    storeSource,
    /case "FINISH_STREAMING": \{[\s\S]*isActive: false,[\s\S]*usage: action\.payload\?\.usage \?\? state\.streaming\.usage/s,
    'FINISH_STREAMING should preserve final usage while marking streaming inactive',
  );
});

test('streaming lifecycle includes processing and content routing helpers', () => {
  assert.match(
    storeSource,
    /type StreamingContentPayload = \{[\s\S]*append\?: boolean;[\s\S]*renderable\?: boolean;/,
    'content payload type should support append and renderability',
  );
  assert.match(
    storeSource,
    /type StreamingReasoningPayload = \{ reasoning: string; append\?: boolean; inThoughtBlock\?: boolean; inReasoningPart\?: boolean \};/,
    'reasoning payload type should support append and reasoning-part flags',
  );
});
