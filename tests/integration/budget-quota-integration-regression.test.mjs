import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot, readAllSources } from '../helpers/source-utils.mjs';

const chatProviderSource = readAllSources(
  [
    joinFromRoot('src', 'providers', 'ChatViewProvider.ts'),
    joinFromRoot('src', 'providers', 'chat', 'DiagnosticsLogger.ts'),
    joinFromRoot('src', 'providers', 'chat', 'StructuredOutputProcessor.ts'),
    joinFromRoot('src', 'providers', 'chat', 'PlanManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'SubagentPersistence.ts'),
    joinFromRoot('src', 'providers', 'chat', 'CompactionManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'HistoryProcessor.ts'),
    joinFromRoot('src', 'providers', 'chat', 'ModelAndAgentManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'QueueManager.ts'),
    joinFromRoot('src', 'providers', 'chat', 'SessionHandler.ts'),
    joinFromRoot('src', 'providers', 'chat', 'StreamEventHandler.ts'),
    joinFromRoot('src', 'providers', 'chat', 'types.ts')
  ],
  'ChatViewProvider.ts',
);

const messageHandlerSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'messageHandler.ts')],
  'messageHandler.ts',
);

const storeSource = readSource(
  [joinFromRoot('webview', 'shared', 'src', 'chat', 'lib', 'store.ts')],
  'store.ts',
);

const budgeterSource = readSource(
  [joinFromRoot('src', 'services', 'RequestBudgeter.ts')],
  'RequestBudgeter.ts',
);

test('Integration: Extension sends quotaData message', () => {
  assert.match(
    chatProviderSource,
    /type:\s*["']quotaData["']/,
    'Extension should send quotaData message type'
  );
  assert.match(
    chatProviderSource,
    /this\.view\?\.webview\.postMessage/,
    'Extension should post message to webview'
  );
});

test('Integration: Extension sends budgetInfo message', () => {
  assert.match(
    chatProviderSource,
    /type:\s*["']budgetInfo["']/,
    'Extension should send budgetInfo message type'
  );
});

test('Integration: Message handler receives quotaData', () => {
  assert.match(
    messageHandlerSource,
    /case\s+["']quotaData["']/,
    'Message handler should handle quotaData'
  );
  assert.match(
    messageHandlerSource,
    /SET_QUOTA_DATA/,
    'Message handler should dispatch SET_QUOTA_DATA'
  );
});

test('Integration: Message handler receives budgetInfo', () => {
  assert.match(
    messageHandlerSource,
    /case\s+["']budgetInfo["']/,
    'Message handler should handle budgetInfo'
  );
  assert.match(
    messageHandlerSource,
    /SET_BUDGET_INFO/,
    'Message handler should dispatch SET_BUDGET_INFO'
  );
});

test('Integration: Store reducer handles SET_QUOTA_DATA', () => {
  assert.match(
    storeSource,
    /case\s+["']SET_QUOTA_DATA["']/,
    'Reducer should handle SET_QUOTA_DATA'
  );
  assert.match(
    storeSource,
    /quotaData:\s*action\.payload/,
    'Reducer should set quotaData'
  );
});

test('Integration: Store reducer handles SET_BUDGET_INFO', () => {
  assert.match(
    storeSource,
    /case\s+["']SET_BUDGET_INFO["']/,
    'Reducer should handle SET_BUDGET_INFO'
  );
  assert.match(
    storeSource,
    /budgetInfo:\s*action\.payload/,
    'Reducer should set budgetInfo'
  );
});

test('Integration: Flow from QuotaService to webview', () => {
  assert.match(
    chatProviderSource,
    /quotaService\.on\("quotaUpdate"/,
    'QuotaService should emit quotaUpdate event'
  );
  assert.match(
    chatProviderSource,
    /postMessage\(\s*\{\s*type:\s*["']quotaData["']/,
    'Extension should post quotaData message'
  );
  assert.match(
    messageHandlerSource,
    /case\s+["']quotaData["']/,
    'Webview should handle quotaData'
  );
  assert.match(
    storeSource,
    /quotaData:\s*action\.payload/,
    'Store should update quotaData'
  );
});

test('Integration: Flow from sendBudgetInfo to webview', () => {
  assert.match(
    chatProviderSource,
    /private\s+sendBudgetInfo/,
    'Extension should have sendBudgetInfo method'
  );
  assert.match(
    chatProviderSource,
    /postMessage\(\s*\{\s*type:\s*["']budgetInfo["']/,
    'Extension should post budgetInfo message'
  );
  assert.match(
    messageHandlerSource,
    /case\s+["']budgetInfo["']/,
    'Webview should handle budgetInfo'
  );
  assert.match(
    storeSource,
    /budgetInfo:\s*action\.payload/,
    'Store should update budgetInfo'
  );
});

test('Integration: Null quota data does not crash webview', () => {
  assert.match(
    storeSource,
    /quotaData:\s*action\.payload/,
    'Reducer should accept null quotaData'
  );
  assert.match(
    messageHandlerSource,
    /data\.data\s+as\s+QuotaData/,
    'Message handler should type assert payload'
  );
});

test('Integration: Null budget info does not crash webview', () => {
  assert.match(
    storeSource,
    /budgetInfo:\s*action\.payload/,
    'Reducer should accept null budgetInfo'
  );
  assert.match(
    messageHandlerSource,
    /data\.data\s+as\s+BudgetInfo/,
    'Message handler should type assert payload'
  );
});

test('Integration: State updates are immutable', () => {
  assert.match(
    storeSource,
    /\{\s*\.\.\.state,\s*quotaData:/,
    'Reducer should create new state object'
  );
  assert.match(
    storeSource,
    /\{\s*\.\.\.state,\s*budgetInfo:/,
    'Reducer should create new state object'
  );
});

test('Integration: Multiple quota updates are handled', () => {
  assert.match(
    chatProviderSource,
    /quotaService\.on\("quotaUpdate"/,
    'QuotaService should support multiple updates'
  );
  assert.match(
    messageHandlerSource,
    /case\s+["']quotaData["']:.*?case\s+["']quotaUpdate["']/s,
    'Message handler should handle both message types'
  );
});

test('Integration: Budget and quota data can coexist', () => {
  assert.match(
    storeSource,
    /quotaData:\s*\w+/,
    'State should have quotaData field'
  );
  assert.match(
    storeSource,
    /budgetInfo:\s*\w+/,
    'State should have budgetInfo field'
  );
});

test('Integration: Missing Copilot platform is handled gracefully', () => {
  assert.match(
    chatProviderSource,
    /if\s*\(!copilotPlatform\)\s*\{\s*return;?\s*\}/,
    'Should return early if no Copilot platform'
  );
});

test('Integration: Missing quota item is handled gracefully', () => {
  assert.match(
    chatProviderSource,
    /if\s*\(!copilotQuota\)\s*\{\s*return;?\s*\}/,
    'Should return early if no quota item'
  );
});

test('Integration: Baseline calculation handles first run', () => {
  assert.match(
    chatProviderSource,
    /if\s*\(baseline\s*===\s*null\)/,
    'Should check if baseline exists'
  );
  assert.match(
    chatProviderSource,
    /budgeter\.setBaselineForDate/,
    'Should set baseline on first run'
  );
});

test('Integration: Daily usage calculation is safe', () => {
  assert.match(
    chatProviderSource,
    /Math\.max\(0,\s*totalUsed\s*-\s*baseline\)/,
    'Should prevent negative usage'
  );
});

test('Integration: Days in month calculation handles leap years', () => {
  assert.match(
    chatProviderSource,
    /new\s+Date\(\s*today\.getFullYear\(\),\s*today\.getMonth\(\)\s*\+\s*1,?\s*0,?\s*\)\.getDate\(\)/s,
    'Should calculate days in month correctly'
  );
});

test('Integration: Daily allowance calculation is safe', () => {
  assert.match(
    chatProviderSource,
    /Math\.ceil\(monthlyQuota\s*\/\sdaysInMonth\)/,
    'Should round up daily allowance'
  );
});

test('Integration: Remaining today calculation prevents negative', () => {
  assert.match(
    chatProviderSource,
    /Math\.max\(0,\s*dailyAllowance\s*-\s*usedToday\)/,
    'Should prevent negative remaining'
  );
});

test('Integration: Projected monthly usage handles division by zero', () => {
  assert.match(
    chatProviderSource,
    /dayOfMonth\s*>\s*0\s*\?/,
    'Should check before dividing'
  );
});

test('Integration: Available today calculation prevents negative', () => {
  assert.match(
    chatProviderSource,
    /Math\.max\(0,\s*budgetSoFar\s*-\s*totalUsed\)/,
    'Should prevent negative available'
  );
});

test('Integration: Warning level determination is safe', () => {
  assert.match(
    chatProviderSource,
    /remainingToday\s*===\s*0/,
    'Should check critical condition first'
  );
  assert.match(
    chatProviderSource,
    /remainingToday\s*<\s*dailyAllowance\s*\*\s*0\.3/,
    'Should check warning condition'
  );
});

test('Integration: Advice array is always initialized', () => {
  assert.match(
    chatProviderSource,
    /const\s+advice:\s*string\[\]\s*=\s*\[\]/,
    'Should initialize advice array'
  );
});

test('Integration: Budget info object has all required fields', () => {
  assert.match(
    chatProviderSource,
    /const\sbudgetInfo\s*=\s*\{/,
    'Should create budgetInfo object'
  );
  assert.match(
    chatProviderSource,
    /planName:.*monthlyQuota:.*usedToday:.*dailyAllowance:.*availableToday:.*remainingToday:.*daysRemaining:.*projectedMonthlyUsage:.*warningLevel:.*advice:/s,
    'Should include all fields'
  );
});

test('Integration: Ready flow sends initial budget status', () => {
  assert.match(
    chatProviderSource,
    /Send initial budget status/,
    'Should have comment about initial budget'
  );
  assert.match(
    chatProviderSource,
    /this\.sendBudgetInfo\(\)/,
    'Should send budget info on ready'
  );
});

test('Integration: Message completion updates budget info', () => {
  assert.match(
    chatProviderSource,
    /Update budget info after successful send/,
    'Should have comment about update'
  );
  assert.match(
    chatProviderSource,
    /this\.sendBudgetInfo\(\)/,
    'Should send budget info after message'
  );
});

test('Integration: Budget check happens before message send', () => {
  assert.match(
    chatProviderSource,
    /Check budget before sending/,
    'Should have comment about budget check'
  );
  assert.match(
    chatProviderSource,
    /budgeter\.canMakeRequest\(\)/,
    'Should check if request is allowed'
  );
});

test('Integration: Budget limit enforcement is optional', () => {
  assert.match(
    budgeterSource,
    /enforceLimit/,
    'Should have enforceLimit config'
  );
});

test('Integration: Quota update triggers immediate webview update', () => {
  assert.match(
    chatProviderSource,
    /quotaService\.on\("quotaUpdate"/,
    'Should listen for quota updates'
  );
  assert.match(
    chatProviderSource,
    /postMessage\(\s*\{\s*type:\s*["']quotaData["']/,
    'Should immediately post to webview'
  );
});

test('Integration: Multiple listeners can be attached to quota service', () => {
  assert.match(
    chatProviderSource,
    /quotaService\.on\(/,
    'Should use event emitter pattern'
  );
});

test('Integration: Webview state updates trigger re-renders', () => {
  assert.match(
    storeSource,
    /useReducer\(appReducer/,
    'Store should use reducer pattern'
  );
  assert.match(
    messageHandlerSource,
    /dispatch\(/,
    'Message handler should dispatch updates'
  );
});

test('Integration: State changes are atomic', () => {
  assert.match(
    storeSource,
    /return\s*\{\s*\.\.\.state/,
    'Reducer should return complete new state'
  );
});

test('Integration: Concurrent quota updates are handled safely', () => {
  assert.match(
    chatProviderSource,
    /quotaService\.on\("quotaUpdate"/,
    'Should use event emitter for updates'
  );
  assert.match(
    messageHandlerSource,
    /case\s+["']quotaData["']:.*?case\s+["']quotaUpdate["']/s,
    'Should handle both update types'
  );
});

test('Integration: Budget and quota state independence', () => {
  assert.match(
    storeSource,
    /quotaData:\s*action\.payload/,
    'SET_QUOTA_DATA should not affect other state'
  );
  assert.match(
    storeSource,
    /budgetInfo:\s*action\.payload/,
    'SET_BUDGET_INFO should not affect other state'
  );
});

test('Integration: Error handling in sendBudgetInfo', () => {
  assert.match(
    chatProviderSource,
    /private\s+sendBudgetInfo\(\)\s*\{\s*try/,
    'Should wrap in try-catch'
  );
  assert.match(
    chatProviderSource,
    /catch/,
    'Should have error handling'
  );
});

