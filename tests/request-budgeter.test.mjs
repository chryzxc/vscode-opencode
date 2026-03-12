import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from './helpers/source-utils.mjs';

const budgeterSource = readSource(
  [joinFromRoot('src', 'services', 'RequestBudgeter.ts')],
  'RequestBudgeter.ts',
);

test('RequestBudgeter implements configuration management', () => {
  // Verify configuration types and default values
  assert.match(budgeterSource, /export interface BudgetConfig/, 'RequestBudgeter should define BudgetConfig interface');
  assert.match(budgeterSource, /enabled:\s*boolean/, 'BudgetConfig should have enabled field');
  assert.match(budgeterSource, /planId:\s*string/, 'BudgetConfig should have planId field');
  assert.match(budgeterSource, /dailySafetyMargin:\s*number\s*\|\s*null/, 'BudgetConfig should have dailySafetyMargin field');
  assert.match(budgeterSource, /enforceLimit:\s*boolean/, 'BudgetConfig should have enforceLimit field');
  assert.match(budgeterSource, /warnThreshold:\s*number/, 'BudgetConfig should have warnThreshold field');

  // Verify default plans are defined
  assert.match(budgeterSource, /export const DEFAULT_PLANS/, 'RequestBudgeter should export DEFAULT_PLANS');
  assert.match(budgeterSource, /free:[\s\S]*monthlyQuota:\s*50/, 'Should define free plan with 50 requests');
  assert.match(budgeterSource, /pro:[\s\S]*monthlyQuota:\s*300/, 'Should define pro plan with 300 requests');
  assert.match(budgeterSource, /['"]pro\+['"]:[\s\S]*monthlyQuota:\s*1500/, 'Should define pro+ plan with 1500 requests');
});

test('RequestBudgeter implements configuration persistence', () => {
  // Verify loadConfig method
  assert.match(budgeterSource, /public\s+loadConfig\(\):\s*void/, 'RequestBudgeter should expose loadConfig method');
  const loadBody = extractFunctionBody(budgeterSource, 'public loadConfig(): void');
  assert.match(loadBody, /readJsonFile<BudgetConfig>\(CONFIG_PATH\)/, 'loadConfig should read from CONFIG_PATH');
  assert.match(loadBody, /this\.config\s*=\s*\{\s*\.\.\.this\.config,\s*\.\.\.saved\s*\}/, 'loadConfig should merge saved config with defaults');

  // Verify saveConfig method
  assert.match(budgeterSource, /public\s+saveConfig\(\):\s*void/, 'RequestBudgeter should expose saveConfig method');
  const saveBody = extractFunctionBody(budgeterSource, 'public saveConfig(): void');
  assert.match(saveBody, /writeJsonFile\(CONFIG_PATH,\s*this\.config\)/, 'saveConfig should write to CONFIG_PATH');

  // Verify updateConfig method
  assert.match(budgeterSource, /public\s+updateConfig\(updates:\s*Partial<BudgetConfig>\):\s*void/, 'RequestBudgeter should expose updateConfig method');
  const updateBody = extractFunctionBody(budgeterSource, 'public updateConfig(');
  assert.match(updateBody, /this\.config\s*=\s*\{\s*\.\.\.this\.config,\s*\.\.\.updates\s*\}/, 'updateConfig should merge updates');
  assert.match(updateBody, /this\.saveConfig\(\)/, 'updateConfig should persist changes');
});

test('RequestBudgeter implements plan management', () => {
  // Verify setPlan method
  assert.match(budgeterSource, /public\s+setPlan\(planId:\s*string\):\s*void/, 'RequestBudgeter should expose setPlan method');
  const setPlanBody = extractFunctionBody(budgeterSource, 'public setPlan(planId: string): void');
  assert.match(setPlanBody, /if\s*\(!DEFAULT_PLANS\[planId\]\)/, 'setPlan should validate plan exists');
  assert.match(setPlanBody, /throw\s+new\s+Error\([\s\S]*Unknown plan:/, 'setPlan should throw for invalid plan');
  assert.match(setPlanBody, /this\.config\.planId\s*=\s*planId/, 'setPlan should update config.planId');
  assert.match(setPlanBody, /this\.saveConfig\(\)/, 'setPlan should persist changes');

  // Verify getPlan method
  assert.match(budgeterSource, /public\s+getPlan\(\):\s*SubscriptionPlan/, 'RequestBudgeter should expose getPlan method');
  const getPlanBody = extractFunctionBody(budgeterSource, 'public getPlan(): SubscriptionPlan');
  assert.match(getPlanBody, /return\s+DEFAULT_PLANS\[this\.config\.planId\]\s*\|\|/, 'getPlan should look up plan from DEFAULT_PLANS');
});

test('RequestBudgeter implements usage tracking', () => {
  // Verify recordRequest method
  assert.match(budgeterSource, /public\s+recordRequest\(\):\s*void/, 'RequestBudgeter should expose recordRequest method');
  const recordBody = extractFunctionBody(budgeterSource, 'public recordRequest(): void');
  assert.match(recordBody, /if\s*\(!this\.config\.enabled\)/, 'recordRequest should check if enabled');
  assert.match(recordBody, /return;/, 'recordRequest should return early when disabled');
  assert.match(recordBody, /this\.usage\[today\]\s*=\s*\(this\.usage\[today\]\s*\|\|\s*0\)\s*\+\s*1/, 'recordRequest should increment usage for today');
  assert.match(recordBody, /this\.saveUsage\(\)/, 'recordRequest should persist changes');

  // Verify getUsageForDate method
  assert.match(budgeterSource, /public\s+getUsageForDate\(date:\s*string\):\s*number/, 'RequestBudgeter should expose getUsageForDate method');
  assert.match(budgeterSource, /return\s+this\.usage\[date\]\s*\|\|\s*0/, 'getUsageForDate should return usage or 0');

  // Verify getTotalUsageThisMonth method
  assert.match(budgeterSource, /public\s+getTotalUsageThisMonth\(\):\s*number/, 'RequestBudgeter should expose getTotalUsageThisMonth method');
  const totalBody = extractFunctionBody(budgeterSource, 'public getTotalUsageThisMonth(): number');
  assert.match(totalBody, /const\s+daysInMonth\s*=\s*getDaysInMonth\(today\)/, 'getTotalUsageThisMonth should get days in month');
  assert.match(totalBody, /for\s*\(\s*let\s+day\s*=\s*1;/, 'getTotalUsageThisMonth should iterate through all days');
});

test('RequestBudgeter implements budget status calculations', () => {
  // Verify getBudgetStatus method
  assert.match(budgeterSource, /public\s+getBudgetStatus\(\):\s*BudgetStatus/, 'RequestBudgeter should expose getBudgetStatus method');
  const statusBody = extractFunctionBody(budgeterSource, 'public getBudgetStatus(): BudgetStatus');

  // Verify it checks if enabled
  assert.match(statusBody, /if\s*\(!this\.config\.enabled\)\s*\{[\s\S]*throw\s+new\s+Error\([\s\S]*Budgeter is disabled/, 'getBudgetStatus should throw if disabled');

  // Verify date calculations
  assert.match(statusBody, /const\s+dayOfMonth\s*=\s*getDayOfMonth\(today\)/, 'getBudgetStatus should get day of month');
  assert.match(statusBody, /const\s+daysInMonth\s*=\s*getDaysInMonth\(today\)/, 'getBudgetStatus should get days in month');
  assert.match(statusBody, /const\s+daysRemaining\s*=\s*daysInMonth\s*-\s*dayOfMonth\s*\+\s*1/, 'getBudgetStatus should calculate days remaining');

  // Verify daily allowance calculation
  assert.match(statusBody, /const\s+recommendedDailyLimit\s*=\s*Math\.ceil\(monthlyQuota\s*\/\s*daysInMonth\)/, 'getBudgetStatus should calculate recommended daily limit');
  assert.match(statusBody, /const\s+dailyAllowance\s*=/, 'getBudgetStatus should calculate daily allowance');

  // Verify warning level determination
  assert.match(statusBody, /let\s+warningLevel:\s*["']ok["']\s*\|\s*["']warning["']\s*\|\s*["']critical["']\s*=\s*["']ok["']/, 'getBudgetStatus should initialize warning level');
  assert.match(statusBody, /if\s*\(usagePercent\s*>=\s*1\)[\s\S]*warningLevel\s*=\s*["']critical["']/, 'getBudgetStatus should set critical when exceeded');
});

test('RequestBudgeter implements request enforcement', () => {
  // Verify canMakeRequest method
  assert.match(budgeterSource, /public\s+canMakeRequest\(\):\s*\{\s*allowed:\s*boolean;\s*reason\?:\s*string\s*\}/, 'RequestBudgeter should expose canMakeRequest method');
  const canMakeBody = extractFunctionBody(budgeterSource, 'public canMakeRequest(): { allowed: boolean');

  // Verify early returns - match against the body content
  assert.match(canMakeBody, /if\s*\(!this\.config\.enabled\)/, 'canMakeRequest should check if enabled');
  assert.match(canMakeBody, /return\s*\{\s*allowed:\s*true\s*\}/, 'canMakeRequest should allow when disabled');
  assert.match(canMakeBody, /if\s*\(!this\.config\.enforceLimit\)/, 'canMakeRequest should check enforceLimit');

  // Verify daily budget check
  assert.match(canMakeBody, /if\s*\(daily\.isExceeded\)\s*\{[\s\S]*return\s*\{[\s\S]*allowed:\s*false/, 'canMakeRequest should block when daily exceeded');
  assert.match(canMakeBody, /Daily budget exceeded/, 'canMakeRequest should mention daily budget in reason');

  // Verify monthly quota check
  assert.match(canMakeBody, /if\s*\(status\.projectedMonthlyUsage\s*>=\s*plan\.monthlyQuota\s*\*\s*0\.95\)/, 'canMakeRequest should check 95% of monthly quota');
  assert.match(canMakeBody, /Monthly quota nearly exhausted/, 'canMakeRequest should mention monthly quota in reason');
});

test('RequestBudgeter implements recommendations and advice', () => {
  // Verify getOptimalDailyLimit method
  assert.match(budgeterSource, /public\s+getOptimalDailyLimit\(\):\s*number/, 'RequestBudgeter should expose getOptimalDailyLimit method');
  const optimalBody = extractFunctionBody(budgeterSource, 'public getOptimalDailyLimit(): number');
  assert.match(optimalBody, /const\s+remainingQuota\s*=\s*Math\.max\(/, 'getOptimalDailyLimit should calculate remaining quota');
  assert.match(optimalBody, /plan\.monthlyQuota\s*-\s*this\.getTotalUsageThisMonth\(\)/, 'getOptimalDailyLimit should subtract usage from quota');
  assert.match(optimalBody, /return\s+Math\.ceil\(remainingQuota\s*\/\s*daysRemaining\)/, 'getOptimalDailyLimit should divide by days remaining');

  // Verify getAdvice method
  assert.match(budgeterSource, /public\s+getAdvice\(\):\s*string\[\]/, 'RequestBudgeter should expose getAdvice method');
  const adviceBody = extractFunctionBody(budgeterSource, 'public getAdvice(): string[]');
  assert.match(adviceBody, /if\s*\(!status\.onTrack\)/, 'getAdvice should check if on track');
  assert.match(adviceBody, /if\s*\(status\.projectedMonthlyUsage\s*>\s*status\.monthlyQuota\)/, 'getAdvice should check projected vs actual');
  assert.match(adviceBody, /if\s*\(optimalDaily\s*<\s*currentDaily/, 'getAdvice should compare optimal vs current daily');
  assert.match(adviceBody, /You['']re on track/, 'getAdvice should provide positive feedback when on track');
});

test('RequestBudgeter implements baseline management', () => {
  // Verify setBaselineForDate method
  assert.match(budgeterSource, /public\s+setBaselineForDate\(date:\s*string,\s*totalUsed:\s*number\):\s*void/, 'RequestBudgeter should expose setBaselineForDate method');
  const baselineBody = extractFunctionBody(budgeterSource, 'public setBaselineForDate(');
  assert.match(baselineBody, /this\.baselines\[date\]\s*=\s*totalUsed/, 'setBaselineForDate should store baseline');
  assert.match(baselineBody, /this\.saveUsage\(\)/, 'setBaselineForDate should persist');

  // Verify getBaselineForDate method
  assert.match(budgeterSource, /public\s+getBaselineForDate\(date:\s*string\):\s*number\s*\|\s*null/, 'RequestBudgeter should expose getBaselineForDate method');
});

test('RequestBudgeter implements reset and clear operations', () => {
  // Verify clearUsage method
  assert.match(budgeterSource, /public\s+clearUsage\(\):\s*void/, 'RequestBudgeter should expose clearUsage method');
  const clearBody = extractFunctionBody(budgeterSource, 'public clearUsage(): void');
  assert.match(clearBody, /this\.usage\s*=\s*\{\}/, 'clearUsage should reset usage object');
  assert.match(clearBody, /this\.saveUsage\(\)/, 'clearUsage should persist');

  // Verify clearUsageForDate method
  assert.match(budgeterSource, /public\s+clearUsageForDate\(date:\s*string\):\s*void/, 'RequestBudgeter should expose clearUsageForDate method');
  const clearDateBody = extractFunctionBody(budgeterSource, 'public clearUsageForDate(');
  assert.match(clearDateBody, /delete\s+this\.usage\[date\]/, 'clearUsageForDate should delete usage for date');

  // Verify resetConfig method
  assert.match(budgeterSource, /public\s+resetConfig\(\):\s*void/, 'RequestBudgeter should expose resetConfig method');
  const resetBody = extractFunctionBody(budgeterSource, 'public resetConfig(): void');
  assert.match(resetBody, /enabled:\s*true/, 'resetConfig should reset enabled to true');
  assert.match(resetBody, /planId:\s*["']pro["']/, 'resetConfig should reset planId to pro');
  assert.match(resetBody, /enforceLimit:\s*false/, 'resetConfig should reset enforceLimit to false');
});

test('RequestBudgeter implements usage statistics', () => {
  // Verify getUsageStats method signature
  assert.match(budgeterSource, /public\s+getUsageStats\(\):/, 'RequestBudgeter should expose getUsageStats method');

  // Verify getUsageStats method implementation
  const statsBody = extractFunctionBody(budgeterSource, 'public getUsageStats(): {');
  assert.match(statsBody, /const\s+status\s*=\s*this\.getBudgetStatus\(\)/, 'getUsageStats should call getBudgetStatus');
  assert.match(statsBody, /const\s+plan\s*=\s*this\.getPlan\(\)/, 'getUsageStats should call getPlan');
  assert.match(statsBody, /totalUsed:\s*totalUsed,/, 'getUsageStats should return totalUsed');
  assert.match(statsBody, /totalRemaining:\s*Math\.max\(0,\s*plan\.monthlyQuota\s*-\s*totalUsed\)/, 'getUsageStats should calculate totalRemaining');
  assert.match(statsBody, /usedToday:\s*status\.currentDailyBudget\?\.used\s*\?\?\s*0,/, 'getUsageStats should return usedToday');
});

test('RequestBudgeter implements persistence layer', () => {
  // Verify helper functions exist
  assert.match(budgeterSource, /function\s+readJsonFile<T>[\s\S]*filePath:\s*string/, 'Should have readJsonFile helper');
  assert.match(budgeterSource, /function\s+writeJsonFile<T>[\s\S]*filePath:\s*string/, 'Should have writeJsonFile helper');

  // Verify loadUsage method
  assert.match(budgeterSource, /public\s+loadUsage\(\):\s*void/, 'RequestBudgeter should expose loadUsage method');
  const loadUsageBody = extractFunctionBody(budgeterSource, 'public loadUsage(): void');
  assert.match(loadUsageBody, /const\s+saved\s*=\s*readJsonFile<any>\(USAGE_PATH\)/, 'loadUsage should read from USAGE_PATH');
  assert.match(loadUsageBody, /this\.usage\s*=\s*saved\.usage/, 'loadUsage should load usage object');
  assert.match(loadUsageBody, /this\.baselines\s*=\s*saved\.baselines\s*\|\|\s*\{\}/, 'loadUsage should load baselines');

  // Verify saveUsage method
  assert.match(budgeterSource, /public\s+saveUsage\(\):\s*void/, 'RequestBudgeter should expose saveUsage method');
  const saveUsageBody = extractFunctionBody(budgeterSource, 'public saveUsage(): void');
  assert.match(saveUsageBody, /writeJsonFile\(USAGE_PATH,/i, 'saveUsage should persist to USAGE_PATH');
  assert.match(saveUsageBody, /usage:\s*this\.usage/, 'saveUsage should include usage in save data');
  assert.match(saveUsageBody, /baselines:\s*this\.baselines/, 'saveUsage should include baselines in save data');
});

test('RequestBudgeter implements date utility functions', () => {
  // Verify date helpers exist
  assert.match(budgeterSource, /function\s+getTodayDate\(\):\s*string/, 'Should have getTodayDate helper');
  assert.match(budgeterSource, /function\s+getDaysInMonth\(date:\s*Date\):\s*number/, 'Should have getDaysInMonth helper');
  assert.match(budgeterSource, /function\s+getDayOfMonth\(date:\s*Date\):\s*number/, 'Should have getDayOfMonth helper');

  // Verify getDaysInMonth implementation
  const daysInMonthBody = extractFunctionBody(budgeterSource, 'function getDaysInMonth(');
  assert.match(daysInMonthBody, /return\s+new\s+Date\(year,\s*month,\s*0\)\.getDate\(\)/, 'getDaysInMonth should use Date trick to get days in month');

  // Verify getDayOfMonth implementation
  assert.match(budgeterSource, /return\s+date\.getDate\(\)/, 'getDayOfMonth should return date.getDate()');
});

test('RequestBudgeter exports singleton instance', () => {
  // Verify singleton export
  assert.match(budgeterSource, /export\s+const\s+budgeter\s*=\s*new\s+RequestBudgeter\(\)/, 'RequestBudgeter should export singleton budgeter instance');
});

test('RequestBudgeter handles edge cases', () => {
  // Verify zero days remaining handling in getOptimalDailyLimit
  const optimalBody = extractFunctionBody(budgeterSource, 'public getOptimalDailyLimit(): number');
  assert.match(optimalBody, /if\s*\(daysRemaining\s*<=\s*0\)\s*\{[\s\S]*return\s+0/, 'getOptimalDailyLimit should return 0 when no days remaining');

  // Verify error handling for disabled budgeter
  const statusBody = extractFunctionBody(budgeterSource, 'public getBudgetStatus(): BudgetStatus');
  assert.match(statusBody, /throw\s+new\s+Error\([\s\S]*Budgeter is disabled/, 'getBudgetStatus should throw descriptive error when disabled');

  // Verify division by zero protection
  assert.match(statusBody, /const\s+usagePercent\s*=\s*dailyAllowance\s*>\s*0\s*\?\s*usedToday\s*\/\s*dailyAllowance\s*:\s*1/, 'getBudgetStatus should handle zero daily allowance');
});
