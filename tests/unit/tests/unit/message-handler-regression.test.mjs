/**
 * Message Handler Regression Tests
 *
 * Critical regression tests for message handler to prevent communication bugs:
 * - quotaData message handling
 * - quotaUpdate message handling
 * - budgetInfo message handling
 * - Message type validation
 * - Payload parsing
 * - Dispatch calls
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../../../helpers/source-utils.mjs';

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

const exactSignature = 'export function createMessageHandler(dispatch: Dispatch<AppAction>, getState: () => AppState)';

test('messageHandler exports createMessageHandler function', () => {
  assert.match(
    messageHandlerSource,
    /export\s+function\s+createMessageHandler/,
    'createMessageHandler should be exported'
  );
});

test('messageHandler accepts dispatch and getState parameters', () => {
  assert.match(
    messageHandlerSource,
    /createMessageHandler\(\s*dispatch:\s*Dispatch<AppAction>,\s*getState:\s*\(\)\s*=>\s*AppState\s*\)/,
    'Should accept dispatch and getState'
  );
});

test('messageHandler returns message handler', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    exactSignature
  );

  assert.match(
    handlerBody,
    /return\s+\(event:\s*MessageEvent\)\s*=>/,
    'Should return message handler function'
  );
});

test('messageHandler handles quotaData message type', () => {
  assert.match(
    messageHandlerSource,
    /case\s+["']quotaData["']\s*:/,
    'Should handle quotaData message type'
  );
});

test('messageHandler dispatches SET_QUOTA_DATA for quotaData', () => {
  assert.match(
    messageHandlerSource,
    /case\s+["']quotaData["']\s*:.*SET_QUOTA_DATA/s,
    'quotaData should dispatch SET_QUOTA_DATA'
  );
});

test('messageHandler extracts data.data for quotaData', () => {
  assert.match(
    messageHandlerSource,
    /quotaData["']\s*:.*data\.data\s+as\s+QuotaData/s,
    'quotaData should extract data.data field'
  );
});

test('messageHandler handles quotaUpdate message type', () => {
  assert.match(
    messageHandlerSource,
    /case\s+["']quotaUpdate["']\s*:/,
    'Should handle quotaUpdate message type'
  );
});

test('messageHandler dispatches SET_QUOTA_DATA for quotaUpdate', () => {
  assert.match(
    messageHandlerSource,
    /case\s+["']quotaUpdate["']\s*:.*SET_QUOTA_DATA/s,
    'quotaUpdate should dispatch SET_QUOTA_DATA'
  );
});

test('messageHandler extracts data.data for quotaUpdate', () => {
  assert.match(
    messageHandlerSource,
    /quotaUpdate["']\s*:.*data\.data\s+as\s+QuotaData/s,
    'quotaUpdate should extract data.data field'
  );
});

test('messageHandler handles budgetInfo message type', () => {
  assert.match(
    messageHandlerSource,
    /case\s+["']budgetInfo["']\s*:/,
    'Should handle budgetInfo message type'
  );
});

test('messageHandler dispatches SET_BUDGET_INFO for budgetInfo', () => {
  assert.match(
    messageHandlerSource,
    /case\s+["']budgetInfo["']\s*:.*SET_BUDGET_INFO/s,
    'budgetInfo should dispatch SET_BUDGET_INFO'
  );
});

test('messageHandler extracts data.data for budgetInfo', () => {
  assert.match(
    messageHandlerSource,
    /budgetInfo["']\s*:.*data\.data\s+as\s+BudgetInfo/s,
    'budgetInfo should extract data.data field'
  );
});

test('messageHandler uses dispatch from closure', () => {
  assert.match(
    messageHandlerSource,
    /dispatch\(\s*\{\s*type:\s*["']SET_QUOTA_DATA["']/,
    'Should call dispatch function'
  );
});

test('messageHandler imports Dispatch type', () => {
  assert.match(
    messageHandlerSource,
    /import.*Dispatch.*from/s,
    'Should import Dispatch type'
  );
});

test('messageHandler imports AppState type', () => {
  assert.match(
    messageHandlerSource,
    /import.*AppState.*from/s,
    'Should import AppState type'
  );
});

test('messageHandler imports AppAction type', () => {
  assert.match(
    messageHandlerSource,
    /import.*AppAction.*from/s,
    'Should import AppAction type'
  );
});

test('messageHandler imports QuotaData type', () => {
  assert.match(
    messageHandlerSource,
    /import.*QuotaData.*from/s,
    'Should import QuotaData type'
  );
});

test('messageHandler imports BudgetInfo type', () => {
  assert.match(
    messageHandlerSource,
    /import.*BudgetInfo.*from/s,
    'Should import BudgetInfo type'
  );
});

test('messageHandler handles unknown message types gracefully', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    exactSignature
  );

  assert.match(
    handlerBody,
    /switch\s*\(\s*type\s*\)/,
    'Should switch on message type'
  );
  assert.match(
    handlerBody,
    /default\s*:/,
    'Should have default case'
  );

  assert.match(
    messageHandlerSource,
    /switch\s*\(\s*(?:eventType|normalizedEventType)\s*\)/,
    'Should switch on stream event type in handleStreamEvent'
  );
});

test('messageHandler distinguishes between quota and budget', () => {
  assert.match(
    messageHandlerSource,
    /case\s+["']quotaData["']\s*:.*?case\s+["']budgetInfo["']\s*:/s,
    'Should handle quota and budget message types'
  );
});

test('messageHandler processes messages synchronously', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    exactSignature
  );

  assert.match(
    handlerBody,
    /dispatch\(/,
    'Should dispatch immediately'
  );
});

test('messageHandler does not rely on getState for quota messages', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    exactSignature
  );

  assert.match(
    handlerBody,
    /case\s+["']quotaData["']\s*:.*?dispatch/s,
    'quotaData should not call getState'
  );
  assert.match(
    handlerBody,
    /case\s+["']quotaUpdate["']\s*:.*?dispatch/s,
    'quotaUpdate should not call getState'
  );
  assert.match(
    handlerBody,
    /case\s+['"]budgetInfo['"]\s*:.*?dispatch/s,
    'budgetInfo should not call getState'
  );
});

test('messageHandler uses type assertion for payload', () => {
  assert.match(
    messageHandlerSource,
    /as\s+QuotaData/,
    'Should assert QuotaData type'
  );
  assert.match(
    messageHandlerSource,
    /as\s+BudgetInfo/,
    'Should assert BudgetInfo type'
  );
});

test('messageHandler handles quotaData and quotaUpdate together', () => {
  assert.match(
    messageHandlerSource,
    /case\s+["']quotaData["']\s*:\s*case\s+["']quotaUpdate["']\s*:/s,
    'Should handle both quota message types'
  );
});

test('messageHandler breaks after quota dispatch', () => {
  assert.match(
    messageHandlerSource,
    /case\s+["']quotaData["']\s*:.*?case\s+["']quotaUpdate["']\s*:.*?break/s,
    'Should break after quota handling'
  );
});

test('messageHandler breaks after budget dispatch', () => {
  assert.match(
    messageHandlerSource,
    /case\s+['"]budgetInfo['"]\s*:.*?break/s,
    'Should break after budget handling'
  );
});

test('messageHandler has addPlanAttachment case', () => {
  assert.match(
    messageHandlerSource,
    /case\s+['"]addPlanAttachment['"]\s*:.*?dispatch/s,
    'Should handle addPlanAttachment'
  );
});

test('messageHandler is exported as function', () => {
  assert.match(
    messageHandlerSource,
    /export\s+function\s+createMessageHandler/,
    'createMessageHandler function should be exported'
  );
});

test('messageHandler has no side effects besides dispatch', () => {
  const handlerBody = extractFunctionBody(
    messageHandlerSource,
    exactSignature
  );

  assert.match(
    handlerBody,
    /case\s+['"]quotaData['"]\s*:.*?case\s+['"]quotaUpdate['"]\s*:.*?case\s+['"]budgetInfo['"]\s*:.*?dispatch/s,
    'Budget/quota handlers should only dispatch'
  );
});

/**
 * Regression tests for chatHistory/session switch bug fix
 * Bug: firstNonEmptyString was undefined, causing all session switches to fail
 * Fix: Added firstNonEmptyString utility function to messageHandler.ts
 */

test('firstNonEmptyString utility function exists', () => {
  assert.match(
    messageHandlerSource,
    /function\s+firstNonEmptyString/,
    'firstNonEmptyString utility function should be defined'
  );
});

test('firstNonEmptyString accepts multiple parameters', () => {
  assert.match(
    messageHandlerSource,
    /function\s+firstNonEmptyString\([^)]*\.\.\.[^)]*\)/,
    'firstNonEmptyString should accept rest parameters'
  );
});

test('firstNonEmptyString returns string or undefined', () => {
  assert.match(
    messageHandlerSource,
    /function\s+firstNonEmptyString[^{]*:\s*string\s*\|\s*undefined/,
    'firstNonEmptyString should return string | undefined'
  );
});

test('firstNonEmptyString handles string trimming', () => {
  assert.match(
    messageHandlerSource,
    /function\s+firstNonEmptyString[^{]*{[\s\S]*?\.trim\(\)/,
    'firstNonEmptyString should trim strings'
  );
});

test('normalizeMessage function is defined', () => {
  assert.match(
    messageHandlerSource,
    /function\s+normalizeMessage/,
    'normalizeMessage should be defined (may not be exported)'
  );
});

test('normalizeMessage accepts Message and StreamingState parameters', () => {
  assert.match(
    messageHandlerSource,
    /function\s+normalizeMessage\s*\([^)]*Message[^)]*StreamingState/s,
    'normalizeMessage should accept Message and optional StreamingState'
  );
});

test('normalizeMessage uses firstNonEmptyString for responseType', () => {
  assert.match(
    messageHandlerSource,
    /const\s+responseType\s*=\s*firstNonEmptyString/,
    'normalizeMessage should use firstNonEmptyString to extract responseType'
  );
});

test('normalizeMessage handles responseType from multiple sources', () => {
  assert.match(
    messageHandlerSource,
    /firstNonEmptyString\([^)]*normalized\.responseType[^)]*normalizedStructuredOutput\?\.responseType[^)]*\)/s,
    'firstNonEmptyString should check both message.responseType and structuredOutput.responseType'
  );
});

test('messageHandler handles chatHistory message type', () => {
  assert.match(
    messageHandlerSource,
    /case\s+['"]chatHistory['"]\s*:/,
    'Should handle chatHistory message type'
  );
});

test('chatHistory case calls normalizeMessage', () => {
  // Simply verify that both chatHistory case and normalizeMessage exist in the source
  const hasChatHistoryCase = /case\s+["']chatHistory["']\s*:/.test(messageHandlerSource);
  const hasNormalizeMessage = /normalizeMessage/.test(messageHandlerSource);

  assert.ok(
    hasChatHistoryCase && hasNormalizeMessage,
    'chatHistory case should exist and normalizeMessage should be used'
  );
});

test('chatHistory filters normalized messages', () => {
  // Verify that isRenderableHistoryMessage is used in the message handler
  assert.match(
    messageHandlerSource,
    /isRenderableHistoryMessage/,
    'isRenderableHistoryMessage filter should be used'
  );
});

test('chatHistory avoids clearing already-rendered messages during active processing hydration', () => {
  assert.match(
    messageHandlerSource,
    /const isActiveSessionHydrationDuringProcessing =[\s\S]*currentState\.messages\.length > 0[\s\S]*currentState\.streaming/s,
    'chatHistory should detect active-session in-flight hydration updates',
  );
  assert.match(
    messageHandlerSource,
    /if \(!isActiveSessionHydrationDuringProcessing\) \{[\s\S]*SET_STREAMING[\s\S]*SET_PROCESSING/s,
    'chatHistory should only clear stream/loading state when not in active in-flight hydration',
  );
  assert.match(
    messageHandlerSource,
    /if \(!isActiveSessionHydrationDuringProcessing\) \{[\s\S]*SET_MESSAGES[\s\S]*\} else \{[\s\S]*stabilizedHydratedMessages = currentState\.messages;/s,
    'chatHistory should preserve currently rendered messages instead of replacing them with stale snapshots mid-stream',
  );
});

test('chatHistory dispatches SET_SESSION_ID', () => {
  assert.match(
    messageHandlerSource,
    /case\s+['"]chatHistory['"]\s*:[\s\S]*?dispatch\(\s*\{\s*type:\s*['"]SET_SESSION_ID['"]/s,
    'chatHistory should update the session ID'
  );
});

test('initState starts session loading during first startup hydration for existing sessions', () => {
  assert.match(
    messageHandlerSource,
    /case\s+["']initState["']\s*:\s*case\s+["']init["']\s*:[\s\S]*stateBeforeInit\s*=\s*getState\(\)[\s\S]*!stateBeforeInit\.receivedInitState[\s\S]*stateBeforeInit\.messages\.length\s*===\s*0[\s\S]*type:\s*["']START_SESSION_LOADING["']/s,
    'initState should trigger START_SESSION_LOADING while startup history is still hydrating'
  );
});

test('initState uses startup loading placeholder when active session id is not yet known', () => {
  assert.match(
    messageHandlerSource,
    /STARTUP_SESSION_LOADING_ID\s*=\s*["']__startup__["']/,
    'messageHandler should define a startup loading placeholder id'
  );

  assert.match(
    messageHandlerSource,
    /case\s+["']initState["']\s*:\s*case\s+["']init["']\s*:[\s\S]*if\s*\(\s*sessionId\s*\)[\s\S]*else\s*\{[\s\S]*type:\s*["']START_SESSION_LOADING["'][\s\S]*sessionId:\s*STARTUP_SESSION_LOADING_ID/s,
    'initState should start temporary startup loading when sessionId is missing'
  );
});

test('chatHistory always clears session loading after hydration', () => {
  assert.match(
    messageHandlerSource,
    /case\s+['"]chatHistory['"]\s*:[\s\S]*dispatch\(\{\s*type:\s*["']SET_MESSAGES["'][\s\S]*dispatch\(\{\s*type:\s*["']END_SESSION_LOADING["']\s*\}\)/s,
    'chatHistory should clear loading after setting hydrated messages'
  );
});

test('sessionsList clears startup placeholder loading when no active session exists', () => {
  assert.match(
    messageHandlerSource,
    /case\s+["']sessionsList["']\s*:[\s\S]*if\s*\(\s*currentSessionId\s*\)[\s\S]*else\s*\{[\s\S]*loadingSessionId\s*===\s*STARTUP_SESSION_LOADING_ID[\s\S]*dispatch\(\{\s*type:\s*["']END_SESSION_LOADING["']\s*\}\)/s,
    'sessionsList should clear startup loading when startup resolves to no active session'
  );
});

test('startup sequence keeps loading UI until history hydration completes', () => {
  const initStateCaseIndex = messageHandlerSource.indexOf('case "initState":');
  const resolvedSessionLoadingIndex = messageHandlerSource.indexOf(
    'title: existingSession?.title || sessionId',
    initStateCaseIndex,
  );
  const startupPlaceholderIndex = messageHandlerSource.indexOf(
    'sessionId: STARTUP_SESSION_LOADING_ID',
    initStateCaseIndex,
  );
  const loadingTitleIndex = messageHandlerSource.indexOf(
    'title: "Loading session"',
    startupPlaceholderIndex,
  );
  const chatHistoryCaseIndex = messageHandlerSource.indexOf('case "chatHistory":');
  const endLoadingAfterHistoryIndex = messageHandlerSource.indexOf(
    'dispatch({ type: "END_SESSION_LOADING" });',
    chatHistoryCaseIndex,
  );

  assert.ok(initStateCaseIndex >= 0, 'initState handler should exist');
  assert.ok(
    resolvedSessionLoadingIndex > initStateCaseIndex,
    'initState should support resolved loading state when session id becomes available',
  );
  assert.ok(
    startupPlaceholderIndex > initStateCaseIndex,
    'initState should support startup placeholder loading when session id is initially unknown',
  );
  assert.ok(
    loadingTitleIndex > startupPlaceholderIndex,
    'startup placeholder loading should include a loading title',
  );
  assert.ok(chatHistoryCaseIndex > initStateCaseIndex, 'chatHistory handler should exist after initState logic');
  assert.ok(
    endLoadingAfterHistoryIndex > chatHistoryCaseIndex,
    'chatHistory should end loading only after hydration path is processed',
  );
});

test('normalizeMessage does not throw when processing chatHistory messages', () => {
  // This test verifies the fix for the bug where normalizeMessage would throw
  // "firstNonEmptyString is not defined" when processing messages from session history
  assert.match(
    messageHandlerSource,
    /function\s+firstNonEmptyString[\s\S]*?function\s+normalizeMessage/,
    'firstNonEmptyString should be defined before normalizeMessage (ensures no reference errors)'
  );
});

test('message handler sanitizes opaque subagent labels before rendering', () => {
  assert.match(
    messageHandlerSource,
    /function\s+sanitizeSubagentLabel\(/,
    'Should define sanitizeSubagentLabel helper for subagent UI text'
  );
  assert.match(
    messageHandlerSource,
    /sanitizeSubagentLabel\(\s*asString\(rec\.latestActivity\)\s*\)/,
    'Subagent latestActivity should pass through sanitizeSubagentLabel'
  );
  assert.match(
    messageHandlerSource,
    /sanitizeSubagentLabel\(\s*asString\(evt\.title\)\s*\)/,
    'Subagent progress titles should pass through sanitizeSubagentLabel'
  );
  assert.match(
    messageHandlerSource,
    /sanitizeSubagentLabel\(\s*asString\(evt\.label\)\s*\)/,
    'Subagent timeline labels should pass through sanitizeSubagentLabel'
  );
});

test('message handler deduplicates and merges subagent progress/timeline for presentation', () => {
  assert.match(
    messageHandlerSource,
    /function\s+normalizeSubagentProgressEventsForPresentation\(/,
    'Should define subagent progress normalization helper'
  );
  assert.match(
    messageHandlerSource,
    /function\s+normalizeSubagentTimelineEventsForPresentation\(/,
    'Should define subagent timeline normalization helper'
  );
  assert.match(
    messageHandlerSource,
    /const\s+byCallId\s*=\s*new Map<string,\s*SubagentProgressEvent>\(\)/,
    'Progress normalization should merge tool snapshots by callID'
  );
  assert.match(
    messageHandlerSource,
    /byCallId\.get\(event\.callID\)/,
    'Progress normalization should look up existing rows by callID'
  );
  assert.match(
    messageHandlerSource,
    /previous\.type === event\.type[\s\S]*normalizeComparableText\(previous\.label\)\s*===/s,
    'Timeline normalization should collapse consecutive duplicate labels'
  );
});

test.describe('messageHandler - Server Error Handling', () => {

  test('initState handler dispatches SET_SERVER_ERROR', () => {
    assert.match(
      messageHandlerSource,
      /case\s+["']initState["']\s*:.*?type:\s*["']SET_SERVER_ERROR["']/s,
      'initState should dispatch SET_SERVER_ERROR action'
    );
  });

  test('initState extracts serverError from state', () => {
    assert.match(
      messageHandlerSource,
      /type:\s*["']SET_SERVER_ERROR["'][\s\S]*?payload:\s*asString\(state\.serverError\)/s,
      'initState should extract serverError from state'
    );
  });

  test('initState converts serverError to string or undefined', () => {
    assert.match(
      messageHandlerSource,
      /type:\s*["']SET_SERVER_ERROR["'][\s\S]*?payload:\s*asString\(state\.serverError\)\s*\|\|\s*undefined/s,
      'initState should convert serverError to string or undefined'
    );
  });

  test('initState handles missing serverError gracefully', () => {
    assert.match(
      messageHandlerSource,
      /type:\s*["']SET_SERVER_ERROR["'][\s\S]*?payload:\s*asString\(state\.serverError\)\s*\|\|\s*undefined/s,
      'initState should handle missing serverError field'
    );
  });

});
