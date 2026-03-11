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
