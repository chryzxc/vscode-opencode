/**
 * Regression test: tool-calls must NOT trigger immediate FINISH_STREAMING
 *
 * Bug (original): hasTerminalFinishSignal() matched "tool-calls" / "tool_calls"
 * as a terminal finish, causing FINISH_STREAMING to fire on every mid-stream
 * message.updated where the AI paused to invoke a tool. The next streamStart
 * then dispatched SET_STREAMING with empty state, wiping all accumulated
 * activity, reasoning, and progress — the user saw only a "loading" spinner.
 *
 * Bug (secondary): Removing "tool-calls" from hasTerminalFinishSignal caused
 * the TRUE final finish (where info.finish: "tool-calls" and no separate
 * "done"/"finish" SSE event follows) to go undetected — UI stuck on loading.
 *
 * Bug (tertiary): Using hasCompletedTimestamp in the immediate finish chain
 * also caused false positives because the server sets time.completed on
 * INTERMEDIATE tool-call messages too — same flickering as the original bug.
 *
 * Fix (final): hasTerminalFinishSignal excludes "tool-calls". For
 * info.finish === "tool-calls" + hasCompletedTimestamp, we use a DEBOUNCED
 * timer (1.5s) instead of immediate FINISH_STREAMING. If a new start/
 * streamStart arrives, the timer is cancelled (mid-stream tool call).
 * If no start arrives, the timer fires FINISH_STREAMING (true end).
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
// 1. hasTerminalFinishSignal must NOT match tool-calls variants
// ---------------------------------------------------------------------------

test('hasTerminalFinishSignal does not match "tool-calls"', () => {
  const fnBody = extractFunctionBody(
    messageHandlerSource,
    'function hasTerminalFinishSignal(',
  );
  assert.ok(fnBody, 'hasTerminalFinishSignal function should exist');

  const returnBlock = fnBody.match(/return\s*\(\s*[\s\S]*?\);/);
  assert.ok(returnBlock, 'hasTerminalFinishSignal should have a return statement');

  const returnBody = returnBlock[0];
  assert.doesNotMatch(
    returnBody,
    /tool.call/i,
    'hasTerminalFinishSignal must NOT match "tool-calls" or "tool_calls"',
  );
});

test('hasTerminalFinishSignal matches genuine terminal signals', () => {
  const fnBody = extractFunctionBody(
    messageHandlerSource,
    'function hasTerminalFinishSignal(',
  );
  assert.ok(fnBody, 'hasTerminalFinishSignal function should exist');

  const returnBlock = fnBody.match(/return\s*\(\s*[\s\S]*?\);/);
  assert.ok(returnBlock, 'hasTerminalFinishSignal should have a return statement');

  const returnBody = returnBlock[0];
  const expectedSignals = ['done', 'stop', 'error', 'finished', 'complete', 'completed'];
  for (const signal of expectedSignals) {
    assert.match(
      returnBody,
      new RegExp(`"${signal}"`),
      `hasTerminalFinishSignal must match terminal signal "${signal}"`,
    );
  }
});

test('hasTerminalFinishSignal returns true for boolean true', () => {
  const fnBody = extractFunctionBody(
    messageHandlerSource,
    'function hasTerminalFinishSignal(',
  );
  assert.ok(fnBody, 'hasTerminalFinishSignal function should exist');

  assert.match(
    fnBody,
    /if\s*\(\s*typeof\s+value\s*===\s*["']boolean["']\s*\)\s*\{\s*return\s+value;\s*\}/,
    'hasTerminalFinishSignal should return boolean values directly',
  );
});

test('hasTerminalFinishSignal handles falsy inputs correctly', () => {
  const fnBody = extractFunctionBody(
    messageHandlerSource,
    'function hasTerminalFinishSignal(',
  );
  assert.ok(fnBody, 'hasTerminalFinishSignal function should exist');

  assert.match(fnBody, /typeof\s+value\s*===\s*["']boolean["']/, 'should check typeof boolean');
  assert.match(fnBody, /\.toLowerCase\(\)/, 'should normalize to lowercase');
  assert.match(fnBody, /\.trim\(\)/, 'should trim whitespace');
  assert.match(fnBody, /if\s*\(\s*!normalized\s*\)\s*\{\s*return\s+false;\s*\}/, 'should return false for empty input');
});

test('hasTerminalFinishSignal does not match non-terminal signals', () => {
  const fnBody = extractFunctionBody(
    messageHandlerSource,
    'function hasTerminalFinishSignal(',
  );
  assert.ok(fnBody, 'hasTerminalFinishSignal function should exist');

  const returnBlock = fnBody.match(/return\s*\(\s*[\s\S]*?\);/);
  assert.ok(returnBlock, 'hasTerminalFinishSignal should have a return statement');

  const returnBody = returnBlock[0];
  const nonTerminalSignals = [
    'tool-calls', 'tool_calls', 'tool-call',
    'step-start', 'step-finish', 'step_start', 'step_finish',
    'thinking', 'thought', 'reasoning',
    'text', 'content', 'message',
    'pending', 'running', 'processing', 'streaming',
    'tool', 'patch', 'subtask', 'agent',
  ];

  for (const signal of nonTerminalSignals) {
    assert.doesNotMatch(
      returnBody,
      new RegExp(`"${signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i'),
      `hasTerminalFinishSignal must NOT match "${signal}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. message.updated finish detection architecture
// ---------------------------------------------------------------------------

test('message.updated computes immediateFinish via hasTerminalFinishSignal', () => {
  const section = getMsgUpdatedSection();

  assert.match(
    section,
    /const\s+immediateFinish\s*=\s*hasTerminalFinishSignal\(/,
    'should compute immediateFinish using hasTerminalFinishSignal',
  );
  assert.match(
    section,
    /info\s*\?\s*\(\s*info\s+as\s+UnknownRecord\s*\)\.finish/,
    'immediateFinish should check info.finish',
  );
  assert.match(
    section,
    /payload\.finish/,
    'immediateFinish should check payload.finish',
  );
});

test('finish variable equals immediateFinish only (not hasCompletedTimestamp)', () => {
  const section = getMsgUpdatedSection();

  assert.match(
    section,
    /const\s+finish\s*=\s*immediateFinish;/,
    'finish must equal immediateFinish only — hasCompletedTimestamp is NOT in the immediate chain',
  );
});

test('hasCompletedTimestamp is computed but used only for isToolCallsFinish debounce', () => {
  const section = getMsgUpdatedSection();

  assert.match(
    section,
    /hasCompletedTimestamp/,
    'hasCompletedTimestamp should be computed',
  );
  assert.match(
    section,
    /asRecord\s*\(\s*info\s*\??\s*\.time\s*\)/,
    'hasCompletedTimestamp should read from info?.time',
  );
  assert.match(
    section,
    /typeof\s+completed\s*===\s*["']number["']\s*&&\s*Number\.isFinite\s*\(\s*completed\s*\)\s*&&\s*completed\s*>\s*0/,
    'hasCompletedTimestamp must validate typeof number, isFinite, and > 0',
  );
});

test('isToolCallsFinish requires both "tool-calls" finish AND hasCompletedTimestamp', () => {
  const section = getMsgUpdatedSection();

  assert.match(
    section,
    /isToolCallsFinish/,
    'isToolCallsFinish should be computed',
  );
  assert.match(
    section,
    /infoFinishRaw\s*===\s*["']tool-calls["']\s*\|\|\s*infoFinishRaw\s*===\s*["']tool_calls["']/,
    'isToolCallsFinish should check for both "tool-calls" and "tool_calls"',
  );
  assert.match(
    section,
    /isToolCallsFinish\s*=\s*\([\s\S]*?hasCompletedTimestamp/,
    'isToolCallsFinish should require hasCompletedTimestamp',
  );
});

test('finish computation block contains no reference to payload.reason', () => {
  const section = getMsgUpdatedSection();

  const finishComputationBlock = section.match(
    /const\s+info\s*=[\s\S]*?if\s*\(finish\s+&&\s+structuredOutput\)/,
  );
  assert.ok(finishComputationBlock, 'finish computation region should exist');

  assert.doesNotMatch(
    finishComputationBlock[0],
    /\.reason\b/,
    'Finish computation must not reference .reason anywhere',
  );
});

// ---------------------------------------------------------------------------
// 3. Debounced finish: isToolCallsFinish uses setTimeout, not immediate dispatch
// ---------------------------------------------------------------------------

test('message.updated dispatches FINISH_STREAMING immediately only for genuine terminal signals', () => {
  const section = getMsgUpdatedSection();

  assert.match(
    section,
    /if\s*\(finish\)\s*\{\s*dispatch\(\s*\{\s*type:\s*['"]FINISH_STREAMING['"]\s*\}\s*\);\s*dispatch\(\s*\{\s*type:\s*['"]SET_PROCESSING['"],\s*payload:\s*false\s*\}\s*\);/,
    'immediate FINISH_STREAMING only when finish (=immediateFinish) is true',
  );
});

test('isToolCallsFinish triggers a debounced timer instead of immediate FINISH_STREAMING', () => {
  const section = getMsgUpdatedSection();

  assert.match(
    section,
    /else\s+if\s*\(isToolCallsFinish\)\s*\{/,
    'isToolCallsFinish should have its own else-if branch',
  );
  assert.match(
    section,
    /debouncedFinishTimer\s*=\s*setTimeout\(/,
    'isToolCallsFinish should use setTimeout for deferred finish',
  );
  assert.match(
    section,
    /FINISH_STREAMING/,
    'debounced timer callback should dispatch FINISH_STREAMING',
  );
});

test('debounced finish timer is cancelled when genuine finish arrives', () => {
  const section = getMsgUpdatedSection();

  // In the immediate finish branch, timer should be cleared
  assert.match(
    section,
    /if\s*\(finish\)\s*\{[\s\S]*?clearTimeout\s*\(\s*debouncedFinishTimer\s*\)/,
    'immediate finish branch should clear the debounce timer',
  );
});

test('debounce timer checks isProcessing/isActive before finishing', () => {
  const section = getMsgUpdatedSection();

  assert.match(
    section,
    /debouncedFinishTimer\s*=\s*setTimeout[\s\S]*?if\s*\(\s*currentState\.isProcessing\s*\|\|\s*currentState\.streaming\?\.isActive\s*\)/,
    'timer callback should verify processing is still active before finishing',
  );
});

// ---------------------------------------------------------------------------
// 4. start/streamStart cancels the debounce timer
// ---------------------------------------------------------------------------

test('start/streamStart cancels the debounced finish timer', () => {
  const section = getStartSection();

  assert.match(
    section,
    /if\s*\(\s*debouncedFinishTimer\s*\)\s*\{\s*clearTimeout\s*\(\s*debouncedFinishTimer\s*\);\s*debouncedFinishTimer\s*=\s*null;\s*\}/,
    'start/streamStart should cancel debouncedFinishTimer',
  );
});

test('start/streamStart dispatches SET_STREAMING with empty content', () => {
  const section = getStartSection();

  assert.match(section, /type:\s*["']SET_STREAMING["']/, 'should dispatch SET_STREAMING');
  assert.match(section, /content:\s*["']["']\s*,/, 'should reset content to empty');
  assert.match(section, /reasoning:\s*["']["']\s*,/, 'should reset reasoning to empty');
  assert.match(section, /steps:\s*\[\]\s*,/, 'should reset steps to empty array');
  assert.match(section, /isActive:\s*true/, 'should set isActive to true');
});

// ---------------------------------------------------------------------------
// 5. SSE finish/done event cancels debounce and dispatches FINISH_STREAMING
// ---------------------------------------------------------------------------

test('SSE finish/done event cancels debounce timer and dispatches FINISH_STREAMING', () => {
  const streamBody = extractFunctionBody(
    messageHandlerSource,
    'function handleStreamEvent(',
  );
  assert.ok(streamBody, 'handleStreamEvent function should exist');

  assert.match(
    streamBody,
    /case\s+['"]finish['"]:\s*\n\s*case\s+['"]done['"]:\s*\{[\s\S]*?clearTimeout\s*\(\s*debouncedFinishTimer\s*\)/,
    'SSE finish/done should cancel debounce timer',
  );
  assert.match(
    streamBody,
    /case\s+['"]finish['"]:\s*\n\s*case\s+['"]done['"]:\s*\{[\s\S]*?dispatch\s*\(\s*\{\s*type:\s*['"]FINISH_STREAMING['"]/,
    'SSE finish/done should dispatch FINISH_STREAMING',
  );
});

// ---------------------------------------------------------------------------
// 6. Debounce timer is module-level
// ---------------------------------------------------------------------------

test('debouncedFinishTimer is declared at module level', () => {
  assert.match(
    messageHandlerSource,
    /let\s+debouncedFinishTimer\s*:\s*ReturnType<typeof setTimeout>\s*\|\s*null\s*=\s*null\s*;/,
    'debouncedFinishTimer should be module-level variable',
  );
});

// ---------------------------------------------------------------------------
// 7. FINISH_STREAMING preserves streaming content (only sets isActive=false)
// ---------------------------------------------------------------------------

test('FINISH_STREAMING preserves streaming content and sets isActive to false', () => {
  assert.match(
    storeSource,
    /case\s+["']FINISH_STREAMING["']:\s*\{\s*if\s*\(!state\.streaming\)\s*\{\s*return\s+state;\s*\}\s*return\s*\{\s*\.\.\.state,\s*streaming:\s*\{\s*\.\.\.state\.streaming,\s*isActive:\s*false,/s,
    'FINISH_STREAMING should preserve content and only set isActive=false',
  );
});

// ---------------------------------------------------------------------------
// 8. SET_STREAMING replaces entire state (why false finish is catastrophic)
// ---------------------------------------------------------------------------

test('SET_STREAMING replaces the entire streaming state object', () => {
  assert.match(
    storeSource,
    /case\s+["']SET_STREAMING["']:\s*return\s+action\.payload\s*\?\s*\{\s*\.\.\.state,\s*streaming:\s*\{\s*\.\.\.action\.payload/s,
    'SET_STREAMING replaces streaming state with the payload',
  );
});

// ---------------------------------------------------------------------------
// 9. step-finish parts update steps without FINISH_STREAMING
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
// 10. isAssistantMessageFinalized still includes "tool-calls" for presentation
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
// 11. Error event always dispatches FINISH_STREAMING
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
