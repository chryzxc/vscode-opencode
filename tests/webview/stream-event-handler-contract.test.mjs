/**
 * Stream Event Handler & Store Reducer Contract Tests
 *
 * Locks the dispatch contracts for handleStreamEvent switch cases,
 * store reducer logic, normalisation helpers, and createMessageHandler routing.
 *
 * All assertions are source-text regex checks against the real TypeScript source.
 * No DOM or runtime required.
 *
 * Covered areas:
 * - normalizeProgressStatus canonical alias table
 * - normalizePartType canonical alias table
 * - isInternalToolName detection
 * - upsertStreamingStep dedup priority: id → callID → title
 * - handleStreamEvent bootstrap guard (stray events suppressed)
 * - handleStreamEvent SET_STREAMING bootstrap block (no current streaming)
 * - handleStreamEvent case 'start' / 'streamStart' → SET_STREAMING dispatch
 * - handleStreamEvent case 'session.error' / 'error' → SET_PROCESSING(false) + FINISH_STREAMING
 * - handleStreamEvent case 'message.updated' finish=true → FINISH_STREAMING + SET_PROCESSING(false)
 * - handleStreamEvent case 'message.updated' finish=false → SET_PROCESSING(true)
 * - handleStreamEvent message.part.updated: structuredOutput.progressUpdates → upsertStreamingStep
 * - handleStreamEvent message.part.updated: structuredOutput.reasoning → UPDATE_STREAMING_REASONING
 * - handleStreamEvent message.part.updated: system message → SET_MESSAGES dispatch
 * - handleStreamEvent message.part.updated: hasBlockingInteractiveEvents → FINISH_STREAMING mid-stream
 * - shouldBootstrapStreamingFromPart accepted part types
 * - Store reducer ADD_STREAMING_STEP: stamps streamSeq, appends to steps + progressEvents
 * - Store reducer UPDATE_STREAMING_STEP: resolves by index/id/callID, appends to progressEvents
 * - Store reducer FINISH_STREAMING: sets isActive=false, preserves rest of streaming state
 * - Store reducer UPDATE_STREAMING_CONTENT: append concatenation, contentStartSeq, hasRenderableContent
 * - Store reducer UPDATE_STREAMING_REASONING: appendWithCap, updates inReasoningPart flag
 * - Store reducer ADD_STREAMING_EDIT: deduplication guard
 * - Store reducer SET_PROCESSING: eager StreamingState creation when hasValidModel
 * - createMessageHandler routing: sessionsList, streamEvent, error
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------

const messageHandlerSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
    'messageHandler.ts',
);

const storeSource = readSource(
    [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
    'store.ts',
);

// ---------------------------------------------------------------------------
// 1. normalizeProgressStatus – canonical alias table
// ---------------------------------------------------------------------------

test('normalizeProgressStatus maps done/completed/success/finished/complete to "done"', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function normalizeProgressStatus');
    assert.ok(body, 'normalizeProgressStatus must exist');
    assert.match(
        body,
        /v\s*===\s*["']done["'][\s\S]*?v\s*===\s*["']completed["'][\s\S]*?v\s*===\s*["']success["'][\s\S]*?v\s*===\s*["']finished["'][\s\S]*?v\s*===\s*["']complete["']/,
        'must check all five "done" aliases',
    );
    assert.match(body, /return\s+["']done["']/, 'must return "done"');
});

test('normalizeProgressStatus maps error/failed to "error"', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function normalizeProgressStatus');
    assert.ok(body, 'normalizeProgressStatus must exist');
    assert.match(
        body,
        /v\s*===\s*["']error["'][\s\S]*?v\s*===\s*["']failed["']/,
        'must check both "error" aliases',
    );
    assert.match(body, /return\s+["']error["']/, 'must return "error"');
});

test('normalizeProgressStatus returns "pending" as default', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function normalizeProgressStatus');
    assert.ok(body, 'normalizeProgressStatus must exist');
    assert.match(body, /return\s+["']pending["']/, 'must return "pending" as fallback');
});

// ---------------------------------------------------------------------------
// 2. normalizePartType – canonical alias table
// ---------------------------------------------------------------------------

test('normalizePartType maps thinking/thought to "reasoning"', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function normalizePartType');
    assert.ok(body, 'normalizePartType must exist');
    assert.match(
        body,
        /raw\s*===\s*["']thinking[""][\s\S]{1,60}raw\s*===\s*["']thought["']/,
        'must handle thinking and thought aliases',
    );
    assert.match(body, /return\s+["']reasoning["']/, 'must return "reasoning"');
});

test('normalizePartType maps stepstart/step_start to "step-start"', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function normalizePartType');
    assert.ok(body, 'normalizePartType must exist');
    assert.match(
        body,
        /raw\s*===\s*["']stepstart[""][\s\S]{1,60}raw\s*===\s*["']step_start["']/,
        'must handle stepstart and step_start aliases',
    );
    assert.match(body, /return\s+["']step-start["']/, 'must return "step-start"');
});

test('normalizePartType maps stepfinish/step_finish to "step-finish"', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function normalizePartType');
    assert.ok(body, 'normalizePartType must exist');
    assert.match(
        body,
        /raw\s*===\s*["']stepfinish[""][\s\S]{1,60}raw\s*===\s*["']step_finish["']/,
        'must handle stepfinish and step_finish aliases',
    );
    assert.match(body, /return\s+["']step-finish["']/, 'must return "step-finish"');
});

test('normalizePartType maps toolcall/tool_call/tool-call to "tool"', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function normalizePartType');
    assert.ok(body, 'normalizePartType must exist');
    assert.match(
        body,
        /raw\s*===\s*["']toolcall[""][\s\S]{1,120}raw\s*===\s*["']tool_call[""][\s\S]{1,60}raw\s*===\s*["']tool-call["']/,
        'must handle toolcall, tool_call, and tool-call aliases',
    );
    assert.match(body, /return\s+["']tool["']/, 'must return "tool"');
});

// ---------------------------------------------------------------------------
// 3. isInternalToolName – detection contract
// ---------------------------------------------------------------------------

test('isInternalToolName detects structuredoutput tool names', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function isInternalToolName');
    assert.ok(body, 'isInternalToolName must exist');
    assert.match(
        body,
        /normalized\.includes\s*\(\s*["']structuredoutput["']\s*\)/,
        'must check for "structuredoutput"',
    );
});

test('isInternalToolName detects structured_output tool names', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function isInternalToolName');
    assert.ok(body, 'isInternalToolName must exist');
    assert.match(
        body,
        /normalized\.includes\s*\(\s*["']structured_output["']\s*\)/,
        'must check for "structured_output"',
    );
});

test('isInternalToolName detects transport tool names', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function isInternalToolName');
    assert.ok(body, 'isInternalToolName must exist');
    assert.match(
        body,
        /normalized\.includes\s*\(\s*["']transport["']\s*\)/,
        'must check for "transport"',
    );
});

// ---------------------------------------------------------------------------
// 4. upsertStreamingStep – dedup priority: id → callID → title
// ---------------------------------------------------------------------------

test('upsertStreamingStep uses findIndex checking id, then callID, then title', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function upsertStreamingStep');
    assert.ok(body, 'upsertStreamingStep must exist');
    assert.match(
        body,
        /findIndex[\s\S]{1,60}candidate\.id\s*===[\s\S]{1,120}candidate\.callID\s*===[\s\S]{1,120}toLowerCase/,
        'must search by id, then callID, then title (lowercase)',
    );
});

test('upsertStreamingStep dispatches ADD_STREAMING_STEP when step not found (idx < 0)', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function upsertStreamingStep');
    assert.ok(body, 'upsertStreamingStep must exist');
    assert.match(
        body,
        /idx\s*<\s*0[\s\S]{1,200}ADD_STREAMING_STEP/,
        'must dispatch ADD_STREAMING_STEP when idx is negative',
    );
});

test('upsertStreamingStep dispatches UPDATE_STREAMING_STEP when step found', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function upsertStreamingStep');
    assert.ok(body, 'upsertStreamingStep must exist');
    assert.match(
        body,
        /UPDATE_STREAMING_STEP[\s\S]{1,200}index\s*:\s*idx/,
        'must dispatch UPDATE_STREAMING_STEP with found index',
    );
});

test('upsertStreamingStep preserves done/error status when incoming is pending (no regression)', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function upsertStreamingStep');
    assert.ok(body, 'upsertStreamingStep must exist');
    assert.match(
        body,
        /current\.status\s*===\s*["']done[""][\s\S]{1,60}current\.status\s*===\s*["']error[""][\s\S]{1,60}step\.status\s*===\s*["']pending["']/,
        'must guard against regressing done/error status back to pending',
    );
});

// ---------------------------------------------------------------------------
// 5. handleStreamEvent – bootstrap guard
// ---------------------------------------------------------------------------

test('handleStreamEvent has a bootstrap guard that returns early on stray events', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    assert.match(
        body,
        /!current[\s\S]{1,60}!state\.isProcessing[\s\S]{1,60}!isExplicitStart[\s\S]{1,60}!isAssistantUpdateStart[\s\S]{1,60}!canBootstrapFromPart/,
        'must have five-part guard: !current, !isProcessing, !isExplicitStart, !isAssistantUpdateStart, !canBootstrapFromPart',
    );
});

test('handleStreamEvent classifies start/streamStart as isExplicitStart', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    assert.match(
        body,
        /isExplicitStart\s*=\s*eventType\s*===\s*['"]start['"][\s\S]{1,60}eventType\s*===\s*['"]streamStart['"]/,
        'must define isExplicitStart from start/streamStart event types',
    );
});

test('handleStreamEvent bootstrap block dispatches SET_STREAMING with isActive: true', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    assert.match(
        body,
        /SET_STREAMING[\s\S]{1,300}isActive\s*:\s*true/,
        'bootstrap block must dispatch SET_STREAMING with isActive: true',
    );
});

test('handleStreamEvent bootstrap SET_STREAMING includes content, steps, reasoningEvents', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    assert.match(
        body,
        /SET_STREAMING[\s\S]{1,500}content\s*:\s*["']["'][\s\S]{1,300}reasoningEvents\s*:\s*\[\][\s\S]{1,300}steps\s*:\s*\[\]/,
        'bootstrap SET_STREAMING must include empty content, empty reasoningEvents, empty steps',
    );
});

// ---------------------------------------------------------------------------
// 6. handleStreamEvent – case 'start' / 'streamStart'
// ---------------------------------------------------------------------------

test("handleStreamEvent 'start'/'streamStart' case is present in switch", () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    assert.match(
        body,
        /case\s+['"]start['"][\s\S]{1,10}case\s+['"]streamStart['"]/,
        "must have case 'start': case 'streamStart': in the switch",
    );
});

test("handleStreamEvent 'start' case dispatches SET_STREAMING with all required fields", () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    const startCaseIndex = body.indexOf("case 'start':");
    assert.ok(startCaseIndex >= 0, "start case must exist in switch");
    const startCaseBody = body.slice(startCaseIndex, startCaseIndex + 4500);
    assert.match(
        startCaseBody,
        /SET_STREAMING/,
        "start case must dispatch SET_STREAMING",
    );
    assert.match(
        startCaseBody,
        /isActive\s*:\s*true/,
        "start case SET_STREAMING must set isActive: true",
    );
    assert.match(
        startCaseBody,
        /progressEvents\s*:\s*\[\]/,
        "start case SET_STREAMING must initialize progressEvents to empty array",
    );
    assert.match(
        startCaseBody,
        /edits\s*:\s*\[\]/,
        "start case SET_STREAMING must initialize edits to empty array",
    );
});

// ---------------------------------------------------------------------------
// 7. handleStreamEvent – case 'session.error' / 'error'
// ---------------------------------------------------------------------------

test("handleStreamEvent has 'session.error' and 'error' cases", () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    assert.match(
        body,
        /case\s+['"]session\.error['"][\s\S]{1,10}case\s+['"]error['"]/,
        "must have both case 'session.error': and case 'error':",
    );
});

test("handleStreamEvent error case dispatches SET_PROCESSING false then FINISH_STREAMING", () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    const errorCaseIdx = body.indexOf("case 'session.error':");
    assert.ok(errorCaseIdx >= 0, "session.error case must exist");
    const errorCaseBody = body.slice(errorCaseIdx, errorCaseIdx + 400);
    assert.match(
        errorCaseBody,
        /SET_PROCESSING['",\s]+payload\s*:\s*false/,
        "error case must dispatch SET_PROCESSING with false",
    );
    assert.match(
        errorCaseBody,
        /FINISH_STREAMING/,
        "error case must dispatch FINISH_STREAMING",
    );
});

// ---------------------------------------------------------------------------
// 8. handleStreamEvent – case 'message.updated' with finish flag
// ---------------------------------------------------------------------------

test("handleStreamEvent message.updated dispatches FINISH_STREAMING when finish=true", () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    // The message.updated case ends with:
    //   if (finish) { FINISH_STREAMING; SET_PROCESSING(false); } else { SET_PROCESSING(true); }
    // This sequence (FINISH + SET_PROCESSING(false) + else + SET_PROCESSING(true)) is unique to message.updated.
    assert.match(
        body,
        /FINISH_STREAMING[\s\S]{1,120}SET_PROCESSING[\s\S]{1,80}false[\s\S]{1,60}\}\s*else[\s\S]{1,80}SET_PROCESSING[\s\S]{1,60}true/,
        "must have FINISH_STREAMING before SET_PROCESSING(false) before else SET_PROCESSING(true)",
    );
});

test("handleStreamEvent message.updated dispatches SET_PROCESSING false when finish=true", () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    // Verify that the finish=true path ends with FINISH_STREAMING followed by SET_PROCESSING(false).
    // This combination appears in message.updated and error cases — both are required contracts.
    assert.match(
        body,
        /dispatch\(\s*\{\s*type\s*:\s*['"](FINISH_STREAMING)['"]\s*\}\s*\)[\s\S]{1,80}dispatch\(\s*\{\s*type\s*:\s*['"](SET_PROCESSING)['"][\s\S]{1,60}false/,
        "must dispatch FINISH_STREAMING followed by SET_PROCESSING(false) in the finish path",
    );
});

test("handleStreamEvent message.updated dispatches SET_PROCESSING true when finish=false", () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    // The message.updated case has: if (finish) { FINISH_STREAMING; SET_PROCESSING(false); } else { SET_PROCESSING(true); }
    // The else branch with SET_PROCESSING(true) immediately following FINISH+SET_PROCESSING(false) is unique here.
    assert.match(
        body,
        /FINISH_STREAMING[\s\S]{1,120}SET_PROCESSING[\s\S]{1,80}false[\s\S]{1,60}\}\s*else\s*\{[\s\S]{1,120}SET_PROCESSING[\s\S]{1,60}true/,
        "must dispatch SET_PROCESSING(true) in the else-not-finish branch of message.updated",
    );
});

// ---------------------------------------------------------------------------
// 9. handleStreamEvent – message.part.updated: structuredOutput.progressUpdates
// ---------------------------------------------------------------------------

test('handleStreamEvent routes structuredOutput.progressUpdates to upsertStreamingStep', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    assert.match(
        body,
        /structuredOutput\?\.progressUpdates[\s\S]{1,200}upsertStreamingStep/,
        'must call upsertStreamingStep for each structuredOutput.progressUpdate',
    );
});

test('handleStreamEvent structuredOutput.progressUpdates forEach passes title and status', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    const progressIdx = body.indexOf('structuredOutput?.progressUpdates');
    assert.ok(progressIdx >= 0, 'structuredOutput?.progressUpdates must exist');
    const progressBlock = body.slice(progressIdx, progressIdx + 400);
    assert.match(progressBlock, /update\.title/, 'must pass update.title to upsertStreamingStep');
    assert.match(progressBlock, /update\.status/, 'must pass update.status to upsertStreamingStep');
});

// ---------------------------------------------------------------------------
// 10. handleStreamEvent – message.part.updated: structuredOutput.reasoning
// ---------------------------------------------------------------------------

test('handleStreamEvent routes structuredOutput.reasoning chunks to UPDATE_STREAMING_REASONING', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    assert.match(
        body,
        /structuredOutput\?\.reasoning[\s\S]{1,300}UPDATE_STREAMING_REASONING/,
        'must dispatch UPDATE_STREAMING_REASONING for each reasoning chunk',
    );
});

test('handleStreamEvent sanitizes reasoning chunks before dispatching', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    const reasoningIdx = body.indexOf('structuredOutput?.reasoning');
    assert.ok(reasoningIdx >= 0, 'structuredOutput?.reasoning block must exist');
    const reasoningBlock = body.slice(reasoningIdx, reasoningIdx + 400);
    assert.match(
        reasoningBlock,
        /sanitizeReasoningChunk/,
        'must call sanitizeReasoningChunk before dispatching',
    );
});

// ---------------------------------------------------------------------------
// 11. handleStreamEvent – message.part.updated: system message detection
// ---------------------------------------------------------------------------

test('handleStreamEvent checks for system message patterns in message.part.updated', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    assert.match(
        body,
        /hasSystemMessagePatternInText/,
        'must call hasSystemMessagePatternInText to detect system messages',
    );
});

test('handleStreamEvent dispatches SET_MESSAGES when system message pattern detected', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    const sysIdx = body.indexOf('hasSystemMessagePatternInText');
    assert.ok(sysIdx >= 0, 'hasSystemMessagePatternInText call must exist');
    const sysBlock = body.slice(sysIdx, sysIdx + 600);
    assert.match(
        sysBlock,
        /SET_MESSAGES/,
        'must dispatch SET_MESSAGES after detecting system message',
    );
});

test('handleStreamEvent system message is added with role=system', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    const sysIdx = body.indexOf('hasSystemMessagePatternInText');
    assert.ok(sysIdx >= 0, 'hasSystemMessagePatternInText call must exist');
    const sysBlock = body.slice(sysIdx, sysIdx + 2000);
    assert.match(
        sysBlock,
        /role\s*:\s*['"](system)['"]/,
        'system message must have role: "system"',
    );
});

// ---------------------------------------------------------------------------
// 12. handleStreamEvent – hasBlockingInteractiveEvents → FINISH_STREAMING mid-stream
// ---------------------------------------------------------------------------

test('handleStreamEvent dispatches FINISH_STREAMING when hasBlockingInteractive in message.part.updated', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    // This pattern checks the mid-stream blocking interactive path
    assert.match(
        body,
        /hasBlockingInteractive[\s\S]{1,200}FINISH_STREAMING/,
        'must dispatch FINISH_STREAMING when blocking interactive event arrives',
    );
});

test('handleStreamEvent dispatches SET_PROCESSING false when hasBlockingInteractive mid-stream', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    assert.match(
        body,
        /hasBlockingInteractive[\s\S]{1,300}SET_PROCESSING['",\s]+payload\s*:\s*false/,
        'must dispatch SET_PROCESSING(false) when blocking interactive event arrives',
    );
});

// ---------------------------------------------------------------------------
// 13. shouldBootstrapStreamingFromPart – accepted part types
// ---------------------------------------------------------------------------

test('shouldBootstrapStreamingFromPart returns true for reasoning parts', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function shouldBootstrapStreamingFromPart');
    assert.ok(body, 'shouldBootstrapStreamingFromPart must exist');
    assert.match(body, /["']reasoning["']/, 'must accept reasoning part type');
    assert.match(body, /return\s+true/, 'must return true for matching types');
});

test('shouldBootstrapStreamingFromPart returns true for step-start parts', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function shouldBootstrapStreamingFromPart');
    assert.ok(body, 'shouldBootstrapStreamingFromPart must exist');
    assert.match(body, /["']step-start["']/, 'must accept step-start part type');
});

test('shouldBootstrapStreamingFromPart returns true for tool parts', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function shouldBootstrapStreamingFromPart');
    assert.ok(body, 'shouldBootstrapStreamingFromPart must exist');
    assert.match(body, /["']tool["']/, 'must accept tool part type');
});

test('shouldBootstrapStreamingFromPart returns true for text parts', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function shouldBootstrapStreamingFromPart');
    assert.ok(body, 'shouldBootstrapStreamingFromPart must exist');
    assert.match(body, /["']text["']/, 'must accept text part type');
});

test('shouldBootstrapStreamingFromPart returns true for subtask parts', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function shouldBootstrapStreamingFromPart');
    assert.ok(body, 'shouldBootstrapStreamingFromPart must exist');
    assert.match(body, /["']subtask["']/, 'must accept subtask part type');
});

// ---------------------------------------------------------------------------
// 14. Store – ADD_STREAMING_STEP reducer
// ---------------------------------------------------------------------------

test('ADD_STREAMING_STEP stamps streamSeq with Date.now()', () => {
    const addStepIdx = storeSource.indexOf('case "ADD_STREAMING_STEP"');
    assert.ok(addStepIdx >= 0, 'ADD_STREAMING_STEP case must exist in store');
    const addStepBody = storeSource.slice(addStepIdx, addStepIdx + 600);
    assert.match(
        addStepBody,
        /stampedStep\s*=\s*\{[\s\S]{1,60}streamSeq\s*:\s*Date\.now\(\)/,
        'must create stampedStep with streamSeq: Date.now()',
    );
});

test('ADD_STREAMING_STEP appends to both steps and progressEvents', () => {
    const addStepIdx = storeSource.indexOf('case "ADD_STREAMING_STEP"');
    assert.ok(addStepIdx >= 0, 'ADD_STREAMING_STEP case must exist in store');
    const addStepBody = storeSource.slice(addStepIdx, addStepIdx + 600);
    assert.match(addStepBody, /steps\s*:[\s\S]{1,200}stampedStep/, 'must append stampedStep to steps');
    assert.match(addStepBody, /progressEvents\s*:[\s\S]{1,200}stampedStep/, 'must append stampedStep to progressEvents');
});

// ---------------------------------------------------------------------------
// 15. Store – UPDATE_STREAMING_STEP reducer
// ---------------------------------------------------------------------------

test('UPDATE_STREAMING_STEP resolves index from payload.index, then id, then callID', () => {
    const updateStepIdx = storeSource.indexOf('case "UPDATE_STREAMING_STEP"');
    assert.ok(updateStepIdx >= 0, 'UPDATE_STREAMING_STEP case must exist in store');
    const updateStepBody = storeSource.slice(updateStepIdx, updateStepIdx + 600);
    assert.match(
        updateStepBody,
        /typeof action\.payload\.index\s*===\s*["']number["']/,
        'must check if payload.index is a number first',
    );
    assert.match(
        updateStepBody,
        /action\.payload\.id\s*&&\s*step\.id\s*===\s*action\.payload\.id/,
        'must fall back to id match',
    );
    assert.match(
        updateStepBody,
        /action\.payload\.callID\s*&&\s*step\.callID\s*===\s*action\.payload\.callID/,
        'must fall back to callID match',
    );
});

test('UPDATE_STREAMING_STEP also appends updated step to progressEvents', () => {
    const updateStepIdx = storeSource.indexOf('case "UPDATE_STREAMING_STEP"');
    assert.ok(updateStepIdx >= 0, 'UPDATE_STREAMING_STEP case must exist in store');
    const updateStepBody = storeSource.slice(updateStepIdx, updateStepIdx + 1200);
    assert.match(
        updateStepBody,
        /progressEvents\s*:\s*appendWithCap[\s\S]{1,300}steps\[idx\]/,
        'must append updated step to progressEvents after patching steps[idx]',
    );
});

test('UPDATE_STREAMING_STEP returns unchanged state when idx < 0', () => {
    const updateStepIdx = storeSource.indexOf('case "UPDATE_STREAMING_STEP"');
    assert.ok(updateStepIdx >= 0, 'UPDATE_STREAMING_STEP case must exist in store');
    const updateStepBody = storeSource.slice(updateStepIdx, updateStepIdx + 600);
    assert.match(
        updateStepBody,
        /if\s*\(\s*idx\s*<\s*0\s*\)[\s\S]{1,60}return\s+state/,
        'must early-return unchanged state when step not found',
    );
});

// ---------------------------------------------------------------------------
// 16. Store – FINISH_STREAMING reducer
// ---------------------------------------------------------------------------

test('FINISH_STREAMING sets isActive: false in streaming state', () => {
    const finishIdx = storeSource.indexOf('case "FINISH_STREAMING"');
    assert.ok(finishIdx >= 0, 'FINISH_STREAMING case must exist in store');
    const finishBody = storeSource.slice(finishIdx, finishIdx + 400);
    assert.match(
        finishBody,
        /isActive\s*:\s*false/,
        'must set isActive to false',
    );
});

test('FINISH_STREAMING preserves rest of streaming state using spread', () => {
    const finishIdx = storeSource.indexOf('case "FINISH_STREAMING"');
    assert.ok(finishIdx >= 0, 'FINISH_STREAMING case must exist in store');
    const finishBody = storeSource.slice(finishIdx, finishIdx + 400);
    assert.match(
        finishBody,
        /streaming\s*:\s*\{[\s\S]{1,30}\.\.\.state\.streaming/,
        'must spread existing streaming state to preserve all other fields',
    );
});

test('FINISH_STREAMING returns unchanged state when streaming is null', () => {
    const finishIdx = storeSource.indexOf('case "FINISH_STREAMING"');
    assert.ok(finishIdx >= 0, 'FINISH_STREAMING case must exist in store');
    const finishBody = storeSource.slice(finishIdx, finishIdx + 400);
    assert.match(
        finishBody,
        /if\s*\(\s*!state\.streaming\s*\)[\s\S]{1,60}return\s+state/,
        'must return state unchanged when streaming is null',
    );
});

// ---------------------------------------------------------------------------
// 17. Store – UPDATE_STREAMING_CONTENT reducer
// ---------------------------------------------------------------------------

test('UPDATE_STREAMING_CONTENT concatenates content when append is true', () => {
    const contentIdx = storeSource.indexOf('case "UPDATE_STREAMING_CONTENT"');
    assert.ok(contentIdx >= 0, 'UPDATE_STREAMING_CONTENT case must exist in store');
    const contentBody = storeSource.slice(contentIdx, contentIdx + 500);
    assert.match(
        contentBody,
        /action\.payload\.append[\s\S]{1,100}`\$\{state\.streaming\.content\}\$\{action\.payload\.content\}`/,
        'must concatenate existing content with new chunk when append=true',
    );
});

test('UPDATE_STREAMING_CONTENT records contentStartSeq on first non-empty content', () => {
    const contentIdx = storeSource.indexOf('case "UPDATE_STREAMING_CONTENT"');
    assert.ok(contentIdx >= 0, 'UPDATE_STREAMING_CONTENT case must exist in store');
    const contentBody = storeSource.slice(contentIdx, contentIdx + 900);
    assert.match(
        contentBody,
        /contentStartSeq/,
        'must track contentStartSeq timestamp',
    );
    assert.match(
        contentBody,
        /Date\.now\(\)/,
        'must stamp contentStartSeq with Date.now()',
    );
});

test('UPDATE_STREAMING_CONTENT sets hasRenderableContent when renderable flag is truthy', () => {
    const contentIdx = storeSource.indexOf('case "UPDATE_STREAMING_CONTENT"');
    assert.ok(contentIdx >= 0, 'UPDATE_STREAMING_CONTENT case must exist in store');
    const contentBody = storeSource.slice(contentIdx, contentIdx + 900);
    assert.match(
        contentBody,
        /hasRenderableContent[\s\S]{1,180}action\.payload\.renderable/,
        'must set hasRenderableContent based on renderable flag',
    );
});

// ---------------------------------------------------------------------------
// 18. Store – UPDATE_STREAMING_REASONING reducer
// ---------------------------------------------------------------------------

test('UPDATE_STREAMING_REASONING appends events using appendWithCap', () => {
    const reasoningIdx = storeSource.indexOf('case "UPDATE_STREAMING_REASONING"');
    assert.ok(reasoningIdx >= 0, 'UPDATE_STREAMING_REASONING case must exist in store');
    const reasoningBody = storeSource.slice(reasoningIdx, reasoningIdx + 1600);
    assert.match(
        reasoningBody,
        /appendWithCap/,
        'must use appendWithCap to bound the reasoningEvents array',
    );
    assert.match(
        reasoningBody,
        /MAX_STREAMING_REASONING_EVENTS/,
        'must reference MAX_STREAMING_REASONING_EVENTS cap constant',
    );
});

test('UPDATE_STREAMING_REASONING updates inReasoningPart flag', () => {
    const reasoningIdx = storeSource.indexOf('case "UPDATE_STREAMING_REASONING"');
    assert.ok(reasoningIdx >= 0, 'UPDATE_STREAMING_REASONING case must exist in store');
    const reasoningBody = storeSource.slice(reasoningIdx, reasoningIdx + 1600);
    assert.match(
        reasoningBody,
        /inReasoningPart/,
        'must update inReasoningPart from action payload',
    );
});

test('UPDATE_STREAMING_REASONING deduplicates last event chunk', () => {
    const reasoningIdx = storeSource.indexOf('case "UPDATE_STREAMING_REASONING"');
    assert.ok(reasoningIdx >= 0, 'UPDATE_STREAMING_REASONING case must exist in store');
    const reasoningBody = storeSource.slice(reasoningIdx, reasoningIdx + 1600);
    assert.match(
        reasoningBody,
        /isDuplicateReasoningChunk|replaceLastEvent/,
        'must check for duplicate/replacement of the last reasoning event',
    );
});

// ---------------------------------------------------------------------------
// 19. Store – ADD_STREAMING_EDIT deduplication
// ---------------------------------------------------------------------------

test('ADD_STREAMING_EDIT returns unchanged state for duplicate file paths', () => {
    const editIdx = storeSource.indexOf('case "ADD_STREAMING_EDIT"');
    assert.ok(editIdx >= 0, 'ADD_STREAMING_EDIT case must exist in store');
    const editBody = storeSource.slice(editIdx, editIdx + 300);
    assert.match(
        editBody,
        /state\.streaming\.edits\.includes\s*\(\s*action\.payload\s*\)/,
        'must check if file path already exists in edits',
    );
    assert.match(
        editBody,
        /return\s+state/,
        'must return unchanged state for duplicate',
    );
});

// ---------------------------------------------------------------------------
// 20. Store – SET_PROCESSING eager StreamingState creation
// ---------------------------------------------------------------------------

test('SET_PROCESSING creates an eager StreamingState when hasValidModel is true', () => {
    const processingIdx = storeSource.indexOf('case "SET_PROCESSING"');
    assert.ok(processingIdx >= 0, 'SET_PROCESSING case must exist in store');
    const processingBody = storeSource.slice(processingIdx, processingIdx + 2200);
    assert.match(
        processingBody,
        /const streamingState\s*:\s*StreamingState\s*=/,
        'must declare streamingState typed as StreamingState',
    );
    assert.match(
        processingBody,
        /streaming\s*:\s*streamingState/,
        'must include streaming: streamingState in returned state',
    );
});

test('SET_PROCESSING eager StreamingState initializes isActive: true', () => {
    const processingIdx = storeSource.indexOf('case "SET_PROCESSING"');
    assert.ok(processingIdx >= 0, 'SET_PROCESSING case must exist in store');
    const processingBody = storeSource.slice(processingIdx, processingIdx + 2200);
    assert.match(
        processingBody,
        /isActive\s*:\s*true/,
        'eager StreamingState must have isActive: true',
    );
});

test('SET_PROCESSING skips eager init when model is invalid (just sets isProcessing)', () => {
    const processingIdx = storeSource.indexOf('case "SET_PROCESSING"');
    assert.ok(processingIdx >= 0, 'SET_PROCESSING case must exist in store');
    const processingBody = storeSource.slice(processingIdx, processingIdx + 2200);
    assert.match(
        processingBody,
        /catch\s*\(error\)[\s\S]{1,300}return[\s\S]{1,100}isProcessing\s*:\s*true/,
        'must return isProcessing: true without streaming state when streaming state creation fails',
    );
});

// ---------------------------------------------------------------------------
// 21. createMessageHandler routing
// ---------------------------------------------------------------------------

test('createMessageHandler routes sessionsList to SET_SESSIONS_LIST', () => {
    assert.match(
        messageHandlerSource,
        /case\s+["']sessionsList["'][\s\S]{1,400}SET_SESSIONS_LIST/,
        'createMessageHandler must dispatch SET_SESSIONS_LIST for sessionsList messages',
    );
});

test('createMessageHandler routes streamEvent to handleStreamEvent', () => {
    assert.match(
        messageHandlerSource,
        /case\s+["']streamEvent["'][\s\S]{1,1100}handleStreamEvent/,
        'createMessageHandler must call handleStreamEvent for streamEvent messages',
    );
});

test('createMessageHandler error case dispatches FINISH_STREAMING', () => {
    // The outer "error" case in createMessageHandler (not the inner stream event case)
    assert.match(
        messageHandlerSource,
        /case\s+["']error["'][\s\S]{1,600}FINISH_STREAMING/,
        'createMessageHandler must dispatch FINISH_STREAMING for error messages',
    );
});

test('createMessageHandler sessionsList also dispatches SET_SESSION_ID when currentSessionId present', () => {
    assert.match(
        messageHandlerSource,
        /case\s+["']sessionsList["'][\s\S]{1,600}SET_SESSION_ID/,
        'createMessageHandler must dispatch SET_SESSION_ID from sessionsList payload',
    );
});

// ---------------------------------------------------------------------------
// 22. sanitizeReasoningChunk – opaque ID suppression
// ---------------------------------------------------------------------------

test('sanitizeReasoningChunk returns empty string for opaque ID-like values', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function sanitizeReasoningChunk');
    assert.ok(body, 'sanitizeReasoningChunk must exist');
    assert.match(
        body,
        /isOpaqueIdLike/,
        'must call isOpaqueIdLike to filter out opaque ID strings',
    );
    assert.match(body, /return\s+['"]['"]/, 'must return empty string for opaque IDs');
});

// ---------------------------------------------------------------------------
// 23. resolveStreamingContentUpdate – append vs replace
// Note: extractFunctionBody is incompatible with TypeScript return-type brace
// annotations like '): { content: string; append: boolean } | null {'.
// Use direct source search instead.
// ---------------------------------------------------------------------------

test('resolveStreamingContentUpdate returns append: true for deltas', () => {
    // Direct source search: find the function and verify the delta append contract
    const fnIdx = messageHandlerSource.indexOf('function resolveStreamingContentUpdate');
    assert.ok(fnIdx >= 0, 'resolveStreamingContentUpdate must exist');
    const fnSlice = messageHandlerSource.slice(fnIdx, fnIdx + 800);
    assert.match(
        fnSlice,
        /if\s*\(fromDelta\)[\s\S]{1,100}append\s*:\s*true/,
        'must return append: true when fromDelta is true',
    );
});

test('resolveStreamingContentUpdate returns null for unchanged content', () => {
    const fnIdx = messageHandlerSource.indexOf('function resolveStreamingContentUpdate');
    assert.ok(fnIdx >= 0, 'resolveStreamingContentUpdate must exist');
    const fnSlice = messageHandlerSource.slice(fnIdx, fnIdx + 1000);
    assert.match(
        fnSlice,
        /incomingNormalized\s*===\s*currentNormalized[\s\S]{1,80}return\s+null/,
        'must return null when incoming normalizes to same as current',
    );
});

test('resolveStreamingContentUpdate returns null for empty incoming chunk', () => {
    const fnIdx = messageHandlerSource.indexOf('function resolveStreamingContentUpdate');
    assert.ok(fnIdx >= 0, 'resolveStreamingContentUpdate must exist');
    const fnSlice = messageHandlerSource.slice(fnIdx, fnIdx + 400);
    assert.match(
        fnSlice,
        /if\s*\(!incomingChunk\)[\s\S]{1,60}return\s+null/,
        'must return null when incomingChunk is empty',
    );
});

// ---------------------------------------------------------------------------
// 24. handleStreamEvent – session ID filtering
// ---------------------------------------------------------------------------

test('handleStreamEvent filters out events from mismatched sessions', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    assert.match(
        body,
        /eventSessionId[\s\S]{1,60}state\.currentSessionId[\s\S]{1,60}eventSessionId\s*!==\s*state\.currentSessionId[\s\S]{1,60}return/,
        'must return early when eventSessionId does not match currentSessionId',
    );
});

// ---------------------------------------------------------------------------
// 25. handleStreamEvent – non-assistant role filter
// ---------------------------------------------------------------------------

test('handleStreamEvent filters out non-assistant non-user roles early', () => {
    const body = extractFunctionBody(messageHandlerSource, 'function handleStreamEvent');
    assert.ok(body, 'handleStreamEvent must exist');
    assert.match(
        body,
        /eventRole\s*!==\s*['"]assistant['"][\s\S]{1,200}eventRole\s*!==\s*['"]user['"][\s\S]{1,60}return/,
        'must filter out roles that are neither assistant nor user',
    );
});
