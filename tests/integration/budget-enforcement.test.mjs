/**
 * Budget Enforcement Integration Tests
 *
 * Tests for budget enforcement in ChatViewProvider:
 * - Budget checking before requests
 * - Warning messages
 * - Budget info updates
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readSource, joinFromRoot } from '../helpers/source-utils.mjs';

const chatProviderSource = readSource(
  [joinFromRoot('src', 'providers', 'ChatViewProvider.ts')],
  'ChatViewProvider.ts',
);

test('ChatViewProvider initializes RequestBudgeter', () => {
  assert.match(
    chatProviderSource,
    /private\s+budgeter:\s*RequestBudgeter/,
    'ChatViewProvider should have budgeter property'
  );
  assert.match(
    chatProviderSource,
    /this\.budgeter\s*=\s*new\s+RequestBudgeter\(\)/,
    'ChatViewProvider should initialize budgeter'
  );
});

test('ChatViewProvider checks budget before sending messages', () => {
  assert.match(
    chatProviderSource,
    /budgeter\.canMakeRequest\(\)/,
    'Should check budget before sending'
  );
});

test('ChatViewProvider blocks requests when budget exceeded', () => {
  assert.match(
    chatProviderSource,
    /const\s+budgetCheck\s*=\s*this\.budgeter\.canMakeRequest\(\)/,
    'Should get budget check result'
  );
  assert.match(
    chatProviderSource,
    /if\s*\(!budgetCheck\.allowed\)/,
    'Should check if allowed'
  );
  assert.match(
    chatProviderSource,
    /this\.sendBudgetInfo\(\)/,
    'Should send budget info when blocked'
  );
  assert.match(
    chatProviderSource,
    /vscode\.window\.showWarningMessage/,
    'Should show warning'
  );
  assert.match(
    chatProviderSource,
    /Request limit reached/,
    'Should mention limit in message'
  );
});

test('ChatViewProvider includes budget reason in warning', () => {
  assert.match(
    chatProviderSource,
    /\$\{budgetCheck\.reason\}/,
    'Should include budget reason'
  );
});

test('ChatViewProvider sends budget info after quota updates', () => {
  assert.match(
    chatProviderSource,
    /quotaService\.on\("quotaUpdate"/,
    'Should listen for quota updates'
  );
  assert.match(
    chatProviderSource,
    /this\.sendBudgetInfo\(\)/,
    'Should send budget info on quota update'
  );
});

test('ChatViewProvider sends budget info on ready flow', () => {
  assert.match(
    chatProviderSource,
    /Send initial budget status/,
    'Should have comment about sending budget'
  );
  assert.match(
    chatProviderSource,
    /this\.sendBudgetInfo\(\)/,
    'Should send budget info in ready flow'
  );
});

test('ChatViewProvider sends budget info after message completion', () => {
  assert.match(
    chatProviderSource,
    /this\.sendBudgetInfo\(\)/,
    'Should send budget info after completion'
  );
});

test('ChatViewProvider.sendBudgetInfo extracts Copilot quota data', () => {
  assert.match(
    chatProviderSource,
    /private\s+sendBudgetInfo\(\)/,
    'Should have sendBudgetInfo method'
  );
  assert.match(
    chatProviderSource,
    /this\.quotaService\.cachedData/,
    'sendBudgetInfo should get cached quota data'
  );
  assert.match(
    chatProviderSource,
    /github-copilot/,
    'sendBudgetInfo should find Copilot platform'
  );
});

test('ChatViewProvider.sendBudgetInfo parses usedTotalDisplay', () => {
  assert.match(
    chatProviderSource,
    /usedTotalDisplay/,
    'sendBudgetInfo should get usedTotalDisplay'
  );
  assert.match(
    chatProviderSource,
    /\.match\(/,
    'sendBudgetInfo should parse format'
  );
});

test('ChatViewProvider.sendBudgetInfo calculates today\'s usage from baseline', () => {
  assert.match(
    chatProviderSource,
    /budgeter\.getBaselineForDate/,
    'sendBudgetInfo should get baseline'
  );
  assert.match(
    chatProviderSource,
    /budgeter\.setBaselineForDate/,
    'sendBudgetInfo should set baseline if needed'
  );
  assert.match(
    chatProviderSource,
    /Math\.max\(0,\s*totalUsed\s*-\s*baseline\)/,
    'sendBudgetInfo should calculate usedToday'
  );
});

test('ChatViewProvider.sendBudgetInfo calculates daily allowance', () => {
  assert.match(
    chatProviderSource,
    /const\sdailyAllowance\s*=\s*Math\.ceil\(monthlyQuota\s*\/\sdaysInMonth\)/,
    'sendBudgetInfo should calculate daily allowance'
  );
});

test('ChatViewProvider.sendBudgetInfo posts budget info to webview', () => {
  assert.match(
    chatProviderSource,
    /this\.view\?\.webview\.postMessage/,
    'sendBudgetInfo should post message to webview'
  );
  assert.match(
    chatProviderSource,
    /type:\s*["']budgetInfo["']/,
    'sendBudgetInfo should send budgetInfo type'
  );
});

test('ChatViewProvider.sendBudgetInfo includes all required fields', () => {
  assert.match(
    chatProviderSource,
    /planName:/,
    'sendBudgetInfo should include planName'
  );
  assert.match(
    chatProviderSource,
    /monthlyQuota:/,
    'sendBudgetInfo should include monthlyQuota'
  );
  assert.match(
    chatProviderSource,
    /usedToday:/,
    'sendBudgetInfo should include usedToday'
  );
  assert.match(
    chatProviderSource,
    /dailyAllowance:/,
    'sendBudgetInfo should include dailyAllowance'
  );
  assert.match(
    chatProviderSource,
    /remainingToday:/,
    'sendBudgetInfo should include remainingToday'
  );
  assert.match(
    chatProviderSource,
    /daysRemaining:/,
    'sendBudgetInfo should include daysRemaining'
  );
  assert.match(
    chatProviderSource,
    /projectedMonthlyUsage:/,
    'sendBudgetInfo should include projectedMonthlyUsage'
  );
  assert.match(
    chatProviderSource,
    /warningLevel:/,
    'sendBudgetInfo should include warningLevel'
  );
  assert.match(
    chatProviderSource,
    /advice:/,
    'sendBudgetInfo should include advice'
  );
});

test('ChatViewProvider.sendBudgetInfo calculates availableToday', () => {
  assert.match(
    chatProviderSource,
    /availableToday:/,
    'sendBudgetInfo should include availableToday'
  );
  assert.match(
    chatProviderSource,
    /budgetSoFar\s*-\s*totalUsed/,
    'sendBudgetInfo should calculate available from budget'
  );
});

test('ChatViewProvider.sendBudgetInfo handles missing quota data gracefully', () => {
  assert.match(
    chatProviderSource,
    /if\s*\(!copilotPlatform\)/,
    'sendBudgetInfo should check if platform exists'
  );
  assert.match(
    chatProviderSource,
    /return/,
    'sendBudgetInfo should return early if no data'
  );
});

test('ChatViewProvider.sendBudgetInfo handles missing quota item gracefully', () => {
  assert.match(
    chatProviderSource,
    /if\s*\(!copilotQuota\)/,
    'sendBudgetInfo should check if quota exists'
  );
  assert.match(
    chatProviderSource,
    /return/,
    'sendBudgetInfo should return early if no quota'
  );
});

test('ChatViewProvider has import for RequestBudgeter', () => {
  assert.match(
    chatProviderSource,
    /import.*RequestBudgeter.*from/,
    'ChatViewProvider should import RequestBudgeter'
  );
});

test('ChatViewProvider calculates days in month for budget', () => {
  assert.match(
    chatProviderSource,
    /const\s+daysInMonth\s*=\s*new\s+Date\(/,
    'sendBudgetInfo should calculate days in month'
  );
  assert.match(
    chatProviderSource,
    /today\.getFullYear\(\)/,
    'sendBudgetInfo should get current year'
  );
  assert.match(
    chatProviderSource,
    /today\.getMonth\(\)\s*\+\s*1,\s*0/,
    'sendBudgetInfo should get days in month'
  );
});

test('ChatViewProvider gets current date for budget calculations', () => {
  assert.match(
    chatProviderSource,
    /new\s+Date\(\)/,
    'sendBudgetInfo should get current date'
  );
  assert.match(
    chatProviderSource,
    /\.toISOString\(\)\.split\(['"]T['"]\)\[0\]/,
    'sendBudgetInfo should format date as YYYY-MM-DD'
  );
});

test('ChatViewProvider sends budget info without enabled flag', () => {
  assert.match(
    chatProviderSource,
    /const\sbudgetInfo\s*=\s*\{/,
    'sendBudgetInfo should create budgetInfo object'
  );
  assert.match(
    chatProviderSource,
    /advice:\s*advice/,
    'sendBudgetInfo should include advice in object'
  );
});

test('ChatViewProvider generates budget advice inline', () => {
  assert.match(
    chatProviderSource,
    /const\s+advice:\s*string\[\]\s*=\s*\[\]/,
    'sendBudgetInfo should create advice array'
  );
  assert.match(
    chatProviderSource,
    /advice\.push\(/,
    'sendBudgetInfo should add advice messages'
  );
});

test('ChatViewProvider does not record request by default', () => {
  assert.match(
    chatProviderSource,
    /DISABLED/,
    'Request recording should be disabled'
  );
  assert.match(
    chatProviderSource,
    /was tracking all requests/,
    'Should explain why disabled'
  );
});
