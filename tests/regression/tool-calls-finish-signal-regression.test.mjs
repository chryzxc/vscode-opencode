/**
 * Regression test: finish detection in message.updated supports fallback terminal status signals
 *
 * The finish detection in the message.updated handler uses
 * info.finish is the primary signal, but some providers only emit terminal
 * status fields on message/properties records. We must detect those too.
 *
 * Historical note: Previous attempts to add hasTerminalFinishSignal,
 * hasCompletedTimestamp, and debounced timers for tool-calls finish
 * signals caused content flickering/reset during streaming. The simple
 * asBoolean approach is kept as the baseline.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

const storeSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);

function getMsgUpdatedSection() {
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );
  assert.ok(streamBody, 'handleStreamEvent function should exist');
  const match = streamBody.match(
    /case\s+['"]message\.updated['"]:\s*\{[\s\S]*?break;\s*\}\s*case\s+/,
  );
  assert.ok(match, 'message.updated case section should exist');
  return match[0];
}

function getStartSection() {
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );
  assert.ok(streamBody, 'handleStreamEvent function should exist');
  const match = streamBody.match(
    /case\s+['"]start['"]:\s*\n\s*case\s+['"]streamStart['"]:\s*\{[\s\S]*?break;\s*\}\s*case\s+/,
  );
  assert.ok(match, 'start/streamStart case section should exist');
  return match[0];
}

// ---------------------------------------------------------------------------
// 1. message.updated finish detection uses dedicated resolver
// ---------------------------------------------------------------------------

test('message.updated uses dedicated finish resolver for robust completion detection', () => {
  const section = getMsgUpdatedSection();

  assert.match(
    section,
    /const\s+finish\s*=\s*resolveMessageUpdatedFinishSignal\(payload,\s*properties\)/,
    'finish should resolve from info.finish plus fallback status fields',
  );
});

test('message.updated finish resolver inspects terminal status candidates', () => {
  assert.match(
    messageHandlerSource,
    /function\s+resolveMessageUpdatedFinishSignal\([\s\S]*statusCandidates[\s\S]*payload\.status[\s\S]*properties\?\.status[\s\S]*properties\?\.part\)\?\.status/s,
    'resolver should inspect payload/properties status fields for terminal completion',
  );
});

test('message.updated dispatches FINISH_STREAMING when finish is true', () => {
  const section = getMsgUpdatedSection();

  assert.match(
    section,
    /if\s*\(finish\)\s*\{[\s\S]*dispatch\(\s*\{\s*type:\s*['"]FINISH_STREAMING['"]\s*\}\s*\)[\s\S]*dispatch\(\s*\{\s*type:\s*['"]SET_PROCESSING['"],\s*payload:\s*false\s*\}\s*\)/,
    'finish=true should dispatch FINISH_STREAMING + SET_PROCESSING false',
  );

  assert.match(
    section,
    /\}\s*else\s*\{[\s\S]*dispatch\(\s*\{\s*type:\s*['"]SET_PROCESSING['"],\s*payload:\s*true\s*\}\s*\)/,
    'finish=false should dispatch SET_PROCESSING true',
  );
});

test('message.updated has no debounce timer references', () => {
  const section = getMsgUpdatedSection();

  assert.doesNotMatch(
    section,
    /debouncedFinishTimer/,
    'message.updated must not reference debouncedFinishTimer',
  );
  assert.doesNotMatch(
    section,
    /hasCompletedTimestamp/,
    'message.updated must not reference hasCompletedTimestamp',
  );
  assert.doesNotMatch(
    section,
    /isToolCallsFinish/,
    'message.updated must not reference isToolCallsFinish',
  );
});

// ---------------------------------------------------------------------------
// 2. start/streamStart dispatches SET_STREAMING with empty state
// ---------------------------------------------------------------------------

test('start/streamStart dispatches SET_STREAMING with empty content', () => {
  const section = getStartSection();

  assert.match(section, /type:\s*["']SET_STREAMING["']/, 'should dispatch SET_STREAMING');
  assert.match(section, /content:\s*["']["']\s*,/, 'should reset content to empty');
  assert.match(section, /steps:\s*\[\]\s*,/, 'should reset steps to empty array');
  assert.match(section, /isActive:\s*true/, 'should set isActive to true');
});

test('start/streamStart has no debounce timer references', () => {
  const section = getStartSection();

  assert.doesNotMatch(
    section,
    /debouncedFinishTimer/,
    'start/streamStart must not reference debouncedFinishTimer',
  );
});

// ---------------------------------------------------------------------------
// 3. SSE finish/done event dispatches FINISH_STREAMING
// ---------------------------------------------------------------------------

test('SSE finish/done event dispatches FINISH_STREAMING', () => {
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );
  assert.ok(streamBody, 'handleStreamEvent function should exist');

  assert.match(
    streamBody,
    /case\s+['"]finish['"]:\s*\n\s*case\s+['"]done['"]:\s*\{[\s\S]*?dispatch\s*\(\s*\{\s*type:\s*['"]FINISH_STREAMING['"]/,
    'SSE finish/done should dispatch FINISH_STREAMING',
  );
  assert.match(
    streamBody,
    /case\s+['"]finish['"]:\s*\n\s*case\s+['"]done['"]:\s*\{[\s\S]*?dispatch\s*\(\s*\{\s*type:\s*['"]SET_PROCESSING['"],\s*payload:\s*false/,
    'SSE finish/done should dispatch SET_PROCESSING false',
  );
});

test('SSE finish/done has no debounce timer references', () => {
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );
  assert.ok(streamBody, 'handleStreamEvent function should exist');

  const finishDoneSection = streamBody.match(
    /case\s+['"]finish['"]:\s*\n\s*case\s+['"]done['"]:\s*\{[\s\S]*?break;\s*\}/,
  );
  assert.ok(finishDoneSection, 'finish/done case section should exist');

  assert.doesNotMatch(
    finishDoneSection[0],
    /debouncedFinishTimer/,
    'finish/done case must not reference debouncedFinishTimer',
  );
});

// ---------------------------------------------------------------------------
// 4. No module-level debounce timer variable exists
// ---------------------------------------------------------------------------

test('no module-level debounce timer variable', () => {
  assert.doesNotMatch(
    messageHandlerSource,
    /let\s+debouncedFinishTimer/,
    'debouncedFinishTimer should not exist as module-level variable',
  );
});

// ---------------------------------------------------------------------------
// 5. FINISH_STREAMING preserves streaming content (only sets isActive=false)
// ---------------------------------------------------------------------------

test('FINISH_STREAMING preserves streaming content and sets isActive to false', () => {
  assert.match(
    storeSource,
    /case\s+["']FINISH_STREAMING["']:\s*\{[\s\S]*if\s*\(!state\.streaming\)\s*\{[\s\S]*return\s+state;[\s\S]*\}[\s\S]*const\s+streaming\s*=\s*\{[\s\S]*\.\.\.state\.streaming,[\s\S]*isActive:\s*false,/s,
    'FINISH_STREAMING should preserve content and only set isActive=false',
  );
});

// ---------------------------------------------------------------------------
// 6. SET_STREAMING replaces entire state (why mid-stream reset is destructive)
// ---------------------------------------------------------------------------

test('SET_STREAMING replaces the entire streaming state object', () => {
  assert.match(
    storeSource,
    /case\s+["']SET_STREAMING["']:\s*\{[\s\S]*const\s+streaming\s*=\s*action\.payload\s*\?[\s\S]*\.\.\.action\.payload,/s,
    'SET_STREAMING replaces streaming state with the payload',
  );
});

// ---------------------------------------------------------------------------
// 7. step-finish parts update steps without FINISH_STREAMING
// ---------------------------------------------------------------------------

test('step-finish part updates streaming step status without FINISH_STREAMING', () => {
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );
  assert.ok(streamBody, 'handleStreamEvent function should exist');

  const stepFinishMatch = streamBody.match(
    /partType\s*===\s*['"]step-finish['"][\s\S]*?upsertStreamingStep\s*\(\s*dispatch\s*,\s*getState\s*,[\s\S]*?status:\s*["']done["']/,
  );
  assert.ok(stepFinishMatch, 'step-finish should call upsertStreamingStep with status "done"');

  const stepFinishBlock = streamBody.match(
    /if\s*\(\s*partType\s*===\s*['"]step-finish['"][^}]*\{[\s\S]*?\n\s*\}/,
  );
  assert.ok(stepFinishBlock, 'step-finish handling block should exist');

  assert.doesNotMatch(
    stepFinishBlock[0],
    /FINISH_STREAMING/,
    'step-finish part handling must NOT dispatch FINISH_STREAMING',
  );
});

// ---------------------------------------------------------------------------
// 8. isAssistantMessageFinalized includes "tool-calls" for presentation
// ---------------------------------------------------------------------------

test('isAssistantMessageFinalized includes "tool-calls" for presentation', () => {
  const fnBody = extractFunctionBody(
    messageHandlerSource,
    'function isAssistantMessageFinalized(',
  );
  assert.ok(fnBody, 'isAssistantMessageFinalized function should exist');

  const completedCheck = fnBody.match(
    /completedAt\s*=\s*[\s\S]*?asOptionalNumber\s*\(\s*infoTime\s*\?\s*\.completed\s*\)/,
  );
  assert.ok(completedCheck, 'should check infoTime?.completed via asOptionalNumber');

  const finishCheck = fnBody.match(/finish\s*===\s*["']tool-calls["']/);
  assert.ok(finishCheck, 'should include "tool-calls" as valid finish for presentation');
});

// ---------------------------------------------------------------------------
// 9. Error event always dispatches FINISH_STREAMING
// ---------------------------------------------------------------------------

test('error event dispatches FINISH_STREAMING unconditionally', () => {
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );
  assert.ok(streamBody, 'handleStreamEvent function should exist');

  const errorSection = streamBody.match(
    /case\s+['"]session\.error['"]:\s*\n\s*case\s+['"]error['"]:\s*\{[\s\S]*?break;\s*\}/,
  );
  assert.ok(errorSection, 'session.error/error case should exist');

  const dispatchOrder = errorSection[0].match(
    /dispatch\s*\(\s*\{\s*type:\s*['"]SET_PROCESSING['"],\s*payload:\s*false\s*\}\s*\)[\s\S]*?dispatch\s*\(\s*\{\s*type:\s*['"]FINISH_STREAMING['"]\s*\}\s*\)/,
  );
  assert.ok(dispatchOrder, 'error case must dispatch SET_PROCESSING(false) then FINISH_STREAMING');
});
