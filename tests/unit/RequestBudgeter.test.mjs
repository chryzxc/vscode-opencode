/**
 * RequestBudgeter Unit Tests
 *
 * Tests for RequestBudgeter service:
 * - Configuration management
 * - Usage tracking
 * - Budget calculations
 * - Request enforcement
 * - Recommendations
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extractFunctionBody, joinFromRoot, readSource } from '../helpers/source-utils.mjs';

const budgeterSource = readSource(
  [joinFromRoot('src', 'services', 'RequestBudgeter.ts')],
  'RequestBudgeter.ts',
);

test('RequestBudgeter is exported as a class', () => {
  assert.match(
    budgeterSource,
    /export\s+class\s+RequestBudgeter/,
    'RequestBudgeter should be exported as a class'
  );
});

test('RequestBudgeter exports singleton instance', () => {
  assert.match(
    budgeterSource,
    /export\s+const\s+budgeter\s*=\s*new\s+RequestBudgeter\(\)/,
    'Should export singleton budgeter instance'
  );
});

test('RequestBudgeter has DEFAULT_PLANS configuration', () => {
  assert.match(
    budgeterSource,
    /export\s+const\s+DEFAULT_PLANS/,
    'Should export DEFAULT_PLANS'
  );
  assert.match(
    budgeterSource,
    /free:.*monthlyQuota:\s*50/,
    'Should have free plan with 50 quota'
  );
  assert.match(
    budgeterSource,
    /pro:.*monthlyQuota:\s*300/,
    'Should have pro plan with 300 quota'
  );
  assert.match(
    budgeterSource,
    /['"]pro\+['"]:/,
    'Should have pro+ plan'
  );
  assert.match(
    budgeterSource,
    /['"]pro\+['"]:.*monthlyQuota:\s*1500/,
    'Should have pro+ plan with 1500 quota'
  );
});

test('RequestBudgeter constructor initializes config', () => {
  const constructorBody = extractFunctionBody(
    budgeterSource,
    'constructor(config?: Partial<BudgetConfig>)'
  );

  assert.match(
    constructorBody,
    /this\.config\s*=\s*\{/,
    'Constructor should initialize config'
  );
  assert.match(
    constructorBody,
    /enabled:\s*true/,
    'Default enabled should be true'
  );
  assert.match(
    constructorBody,
    /planId:\s*["']pro["']/,
    'Default planId should be pro'
  );
  assert.match(
    constructorBody,
    /enforceLimit:\s*false/,
    'Default enforceLimit should be false'
  );
  assert.match(
    constructorBody,
    /warnThreshold:\s*0\.8/,
    'Default warnThreshold should be 0.8'
  );
});

test('RequestBudgeter constructor initializes usage tracking', () => {
  const constructorBody = extractFunctionBody(
    budgeterSource,
    'constructor(config?: Partial<BudgetConfig>)'
  );

  assert.match(
    constructorBody,
    /this\.usage\s*=\s*\{\}/,
    'Constructor should initialize usage object'
  );
  assert.match(
    constructorBody,
    /this\.baselines\s*=\s*\{\}/,
    'Constructor should initialize baselines object'
  );
});

test('RequestBudgeter constructor calls loadConfig and loadUsage', () => {
  const constructorBody = extractFunctionBody(
    budgeterSource,
    'constructor(config?: Partial<BudgetConfig>)'
  );

  assert.match(
    constructorBody,
    /this\.loadConfig\(\)/,
    'Constructor should call loadConfig'
  );
  assert.match(
    constructorBody,
    /this\.loadUsage\(\)/,
    'Constructor should call loadUsage'
  );
});

test('RequestBudgeter.loadConfig reads from config file', () => {
  const loadConfigBody = extractFunctionBody(
    budgeterSource,
    'public loadConfig(): void'
  );

  assert.match(
    loadConfigBody,
    /readJsonFile/,
    'loadConfig should read JSON file'
  );
  assert.match(
    loadConfigBody,
    /this\.config\s*=\s*\{\s*\.\.\.this\.config,\s*\.\.\.saved\s*\}/,
    'loadConfig should merge saved config'
  );
});

test('RequestBudgeter.saveConfig writes to config file', () => {
  const saveConfigBody = extractFunctionBody(
    budgeterSource,
    'public saveConfig(): void'
  );

  assert.match(
    saveConfigBody,
    /writeJsonFile/,
    'saveConfig should write JSON file'
  );
  assert.match(
    saveConfigBody,
    /this\.config/,
    'saveConfig should write config'
  );
});

test('RequestBudgeter.getConfig returns config copy', () => {
  const getConfigBody = extractFunctionBody(
    budgeterSource,
    'public getConfig(): BudgetConfig'
  );

  assert.match(
    getConfigBody,
    /return\s*\{\s*\.\.\.this\.config\s*\}/,
    'getConfig should return config copy'
  );
});

test('RequestBudgeter.updateConfig merges and saves', () => {
  const updateConfigBody = extractFunctionBody(
    budgeterSource,
    'public updateConfig(updates: Partial<BudgetConfig>): void'
  );

  assert.match(
    updateConfigBody,
    /this\.config\s*=\s*\{\s*\.\.\.this\.config,\s*\.\.\.updates\s*\}/,
    'updateConfig should merge updates'
  );
  assert.match(
    updateConfigBody,
    /this\.saveConfig\(\)/,
    'updateConfig should save config'
  );
});

test('RequestBudgeter.setPlan validates plan exists', () => {
  const setPlanBody = extractFunctionBody(
    budgeterSource,
    'public setPlan(planId: string): void'
  );

  assert.match(
    setPlanBody,
    /DEFAULT_PLANS\[planId\]/,
    'setPlan should check if plan exists'
  );
  assert.match(
    setPlanBody,
    /throw\s+new\s+Error/,
    'setPlan should throw for unknown plan'
  );
  assert.match(
    setPlanBody,
    /Available:/,
    'Error should list available plans'
  );
});

test('RequestBudgeter.setPlan updates config and saves', () => {
  const setPlanBody = extractFunctionBody(
    budgeterSource,
    'public setPlan(planId: string): void'
  );

  assert.match(
    setPlanBody,
    /this\.config\.planId\s*=\s*planId/,
    'setPlan should update planId'
  );
  assert.match(
    setPlanBody,
    /this\.saveConfig\(\)/,
    'setPlan should save config'
  );
});

test('RequestBudgeter.getPlan returns plan from DEFAULT_PLANS', () => {
  const getPlanBody = extractFunctionBody(
    budgeterSource,
    'public getPlan(): SubscriptionPlan'
  );

  assert.match(
    getPlanBody,
    /DEFAULT_PLANS\[this\.config\.planId\]/,
    'getPlan should return plan from config'
  );
  assert.match(
    getPlanBody,
    /\|\|/,
    'getPlan should fallback to pro plan'
  );
});

test('RequestBudgeter.loadUsage reads usage and baselines', () => {
  const loadUsageBody = extractFunctionBody(
    budgeterSource,
    'public loadUsage(): void'
  );

  assert.match(
    loadUsageBody,
    /readJsonFile/,
    'loadUsage should read JSON file'
  );
  assert.match(
    loadUsageBody,
    /saved\.usage/,
    'loadUsage should load usage'
  );
  assert.match(
    loadUsageBody,
    /saved\.baselines/,
    'loadUsage should load baselines'
  );
});

test('RequestBudgeter.saveUsage writes usage and baselines', () => {
  const saveUsageBody = extractFunctionBody(
    budgeterSource,
    'public saveUsage(): void'
  );

  assert.match(
    saveUsageBody,
    /writeJsonFile/,
    'saveUsage should write JSON file'
  );
  assert.match(
    saveUsageBody,
    /usage:\s*this\.usage/,
    'saveUsage should include usage'
  );
  assert.match(
    saveUsageBody,
    /baselines:\s*this\.baselines/,
    'saveUsage should include baselines'
  );
});

test('RequestBudgeter.recordRequest increments today\'s usage', () => {
  const recordRequestBody = extractFunctionBody(
    budgeterSource,
    'public recordRequest(): void'
  );

  assert.match(
    recordRequestBody,
    /if\s*\(!this\.config\.enabled\)/,
    'recordRequest should check if enabled'
  );
  assert.match(
    recordRequestBody,
    /getTodayDate\(\)/,
    'recordRequest should get today\'s date'
  );
  assert.match(
    recordRequestBody,
    /this\.usage\[today\]\s*=\s*\(this\.usage\[today\]\s*\|\|\s*0\)\s*\+\s*1/,
    'recordRequest should increment usage'
  );
  assert.match(
    recordRequestBody,
    /this\.saveUsage\(\)/,
    'recordRequest should save usage'
  );
});

test('RequestBudgeter.getUsageForDate returns usage or zero', () => {
  const getUsageBody = extractFunctionBody(
    budgeterSource,
    'public getUsageForDate(date: string): number'
  );

  assert.match(
    getUsageBody,
    /return\s+this\.usage\[date\]\s*\|\|\s*0/,
    'getUsageForDate should return usage or 0'
  );
});

test('RequestBudgeter.getBaselineForDate returns baseline or null', () => {
  const getBaselineBody = extractFunctionBody(
    budgeterSource,
    'public getBaselineForDate(date: string): number | null'
  );

  assert.match(
    getBaselineBody,
    /this\.baselines\[date\]\s*!==\s*undefined/,
    'getBaselineForDate should check if baseline exists'
  );
  assert.match(
    getBaselineBody,
    /\?\s*this\.baselines\[date\]\s*:\s*null/,
    'getBaselineForDate should return baseline or null'
  );
});

test('RequestBudgeter.setBaselineForDate sets baseline and saves', () => {
  const setBaselineBody = extractFunctionBody(
    budgeterSource,
    'public setBaselineForDate(date: string, totalUsed: number): void'
  );

  assert.match(
    setBaselineBody,
    /this\.baselines\[date\]\s*=\s*totalUsed/,
    'setBaselineForDate should set baseline'
  );
  assert.match(
    setBaselineBody,
    /this\.saveUsage\(\)/,
    'setBaselineForDate should save usage'
  );
});

test('RequestBudgeter.getTotalUsageThisMonth sums all days', () => {
  const getTotalBody = extractFunctionBody(
    budgeterSource,
    'public getTotalUsageThisMonth(): number'
  );

  assert.match(
    getTotalBody,
    /getDaysInMonth/,
    'getTotalUsageThisMonth should get days in month'
  );
  assert.match(
    getTotalBody,
    /for\s*\(/,
    'getTotalUsageThisMonth should loop through days'
  );
  assert.match(
    getTotalBody,
    /total\s*\+=/,
    'getTotalUsageThisMonth should accumulate usage'
  );
  assert.match(
    getTotalBody,
    /this\.usage\[dateStr\]\s*\|\|\s*0/,
    'getTotalUsageThisMonth should handle missing days'
  );
});

test('RequestBudgeter.getBudgetStatus calculates daily allowance', () => {
  const getBudgetStatusBody = extractFunctionBody(
    budgeterSource,
    'public getBudgetStatus(): BudgetStatus'
  );

  assert.match(
    getBudgetStatusBody,
    /Math\.ceil\(monthlyQuota\s*\/\s*daysInMonth\)/,
    'getBudgetStatus should calculate recommended daily limit'
  );
  assert.match(
    getBudgetStatusBody,
    /recommendedDailyLimit/,
    'getBudgetStatus should use recommended limit'
  );
  assert.match(
    getBudgetStatusBody,
    /this\.config\.dailySafetyMargin/,
    'getBudgetStatus should check safety margin'
  );
});

test('RequestBudgeter.getBudgetStatus calculates remaining today', () => {
  const getBudgetStatusBody = extractFunctionBody(
    budgeterSource,
    'public getBudgetStatus(): BudgetStatus'
  );

  assert.match(
    getBudgetStatusBody,
    /remainingToday\s*=\s*Math\.max\(0,\s*dailyAllowance\s*-\s*usedToday\)/,
    'getBudgetStatus should calculate remaining'
  );
});

test('RequestBudgeter.getBudgetStatus projects monthly usage', () => {
  const getBudgetStatusBody = extractFunctionBody(
    budgeterSource,
    'public getBudgetStatus(): BudgetStatus'
  );

  assert.match(
    getBudgetStatusBody,
    /projectedMonthlyUsage\s*=\s*totalUsedSoFar\s*\+\s*usedToday\s*\*\s*daysRemaining/,
    'getBudgetStatus should project monthly usage'
  );
});

test('RequestBudgeter.getBudgetStatus checks if on track', () => {
  const getBudgetStatusBody = extractFunctionBody(
    budgeterSource,
    'public getBudgetStatus(): BudgetStatus'
  );

  assert.match(
    getBudgetStatusBody,
    /expectedUsageByNow/,
    'getBudgetStatus should calculate expected usage'
  );
  assert.match(
    getBudgetStatusBody,
    /onTrack\s*=\s*totalUsedSoFar\s*<=\s*expectedUsageByNow/,
    'getBudgetStatus should check if on track'
  );
});

test('RequestBudgeter.getBudgetStatus determines warning level', () => {
  const getBudgetStatusBody = extractFunctionBody(
    budgeterSource,
    'public getBudgetStatus(): BudgetStatus'
  );

  assert.match(
    getBudgetStatusBody,
    /usagePercent\s*=\s*dailyAllowance\s*>\s*0/,
    'getBudgetStatus should calculate usage percent'
  );
  assert.match(
    getBudgetStatusBody,
    /usagePercent\s*>=\s*1/,
    'getBudgetStatus should check critical level'
  );
  assert.match(
    getBudgetStatusBody,
    /usagePercent\s*>=\s*this\.config\.warnThreshold/,
    'getBudgetStatus should check warning level'
  );
  assert.match(
    getBudgetStatusBody,
    /warningLevel/,
    'getBudgetStatus should set warning level'
  );
});

test('RequestBudgeter.canMakeRequest checks enabled', () => {
  const canMakeBody = extractFunctionBody(
    budgeterSource,
    'public canMakeRequest(): { allowed: boolean; reason?: string }'
  );

  assert.match(
    canMakeBody,
    /if\s*\(!this\.config\.enabled\)/,
    'canMakeRequest should check if enabled'
  );
  assert.match(
    canMakeBody,
    /return\s*\{\s*allowed:\s*true\s*\}/,
    'canMakeRequest should allow when disabled'
  );
});

test('RequestBudgeter.canMakeRequest checks enforceLimit', () => {
  const canMakeBody = extractFunctionBody(
    budgeterSource,
    'public canMakeRequest(): { allowed: boolean; reason?: string }'
  );

  assert.match(
    canMakeBody,
    /if\s*\(!this\.config\.enforceLimit\)/,
    'canMakeRequest should check enforceLimit'
  );
});

test('RequestBudgeter.canMakeRequest checks daily budget exceeded', () => {
  const canMakeBody = extractFunctionBody(
    budgeterSource,
    'public canMakeRequest(): { allowed: boolean; reason?: string }'
  );

  assert.match(
    canMakeBody,
    /getBudgetStatus\(\)/,
    'canMakeRequest should get budget status'
  );
  assert.match(
    canMakeBody,
    /daily\.isExceeded/,
    'canMakeRequest should check if exceeded'
  );
  assert.match(
    canMakeBody,
    /Daily budget exceeded/,
    'canMakeRequest should show exceeded message'
  );
});

test('RequestBudgeter.canMakeRequest checks monthly quota nearly exhausted', () => {
  const canMakeBody = extractFunctionBody(
    budgeterSource,
    'public canMakeRequest(): { allowed: boolean; reason?: string }'
  );

  assert.match(
    canMakeBody,
    /status\.projectedMonthlyUsage\s*>=\s*plan\.monthlyQuota\s*\*\s*0\.95/,
    'canMakeRequest should check 95% threshold'
  );
  assert.match(
    canMakeBody,
    /Monthly quota nearly exhausted/,
    'canMakeRequest should warn about monthly quota'
  );
});

test('RequestBudgeter.getRecommendedDailyLimit returns status value', () => {
  const getRecommendedBody = extractFunctionBody(
    budgeterSource,
    'public getRecommendedDailyLimit(): number'
  );

  assert.match(
    getRecommendedBody,
    /getBudgetStatus\(\)/,
    'getRecommendedDailyLimit should get status'
  );
  assert.match(
    getRecommendedBody,
    /return\s+status\.recommendedDailyLimit/,
    'getRecommendedDailyLimit should return recommended limit'
  );
});

test('RequestBudgeter.getUsageStats returns usage summary', () => {
  assert.match(
    budgeterSource,
    /getUsageStats\(\)/,
    'getUsageStats method should exist'
  );
  assert.match(
    budgeterSource,
    /getBudgetStatus\(\)/,
    'getUsageStats should get status'
  );
  assert.match(
    budgeterSource,
    /getPlan\(\)/,
    'getUsageStats should get plan'
  );
  assert.match(
    budgeterSource,
    /getTotalUsageThisMonth\(\)/,
    'getUsageStats should get total usage'
  );
  assert.match(
    budgeterSource,
    /totalRemaining:\s*Math\.max\(0/,
    'getUsageStats should calculate remaining'
  );
});

test('RequestBudgeter.getOptimalDailyLimit calculates based on remaining', () => {
  const getOptimalBody = extractFunctionBody(
    budgeterSource,
    'public getOptimalDailyLimit(): number'
  );

  assert.match(
    getOptimalBody,
    /remainingQuota\s*=\s*Math\.max/,
    'getOptimalDailyLimit should calculate remaining quota'
  );
  assert.match(
    getOptimalBody,
    /daysRemaining\s*<=\s*0/,
    'getOptimalDailyLimit should check if month ended'
  );
  assert.match(
    getOptimalBody,
    /return\s+0/,
    'getOptimalDailyLimit should return 0 if month ended'
  );
  assert.match(
    getOptimalBody,
    /Math\.ceil\(remainingQuota\s*\/\s*daysRemaining\)/,
    'getOptimalDailyLimit should calculate optimal limit'
  );
});

test('RequestBudgeter.getAdvice provides warning when off track', () => {
  const getAdviceBody = extractFunctionBody(
    budgeterSource,
    'public getAdvice(): string[]'
  );

  assert.match(
    getAdviceBody,
    /if\s*\(!status\.onTrack\)/,
    'getAdvice should check if on track'
  );
  assert.match(
    getAdviceBody,
    /using requests faster than planned/,
    'getAdvice should warn about usage rate'
  );
});

test('RequestBudgeter.getAdvice projects when quota will run out', () => {
  const getAdviceBody = extractFunctionBody(
    budgeterSource,
    'public getAdvice(): string[]'
  );

  assert.match(
    getAdviceBody,
    /if\s*\(status\.projectedMonthlyUsage\s*>\s*plan\.monthlyQuota\)/,
    'getAdvice should check if exceeding quota'
  );
  assert.match(
    getAdviceBody,
    /run out\s+\$\{status\.daysRemaining\}\s+days early/,
    'getAdvice should show days early'
  );
});

test('RequestBudgeter.getAdvice suggests reducing daily limit', () => {
  const getAdviceBody = extractFunctionBody(
    budgeterSource,
    'public getAdvice(): string[]'
  );

  assert.match(
    getAdviceBody,
    /getOptimalDailyLimit\(\)/,
    'getAdvice should get optimal limit'
  );
  assert.match(
    getAdviceBody,
    /Consider reducing to/,
    'getAdvice should suggest reduction'
  );
});

test('RequestBudgeter.getAdvice provides positive feedback when on track', () => {
  const getAdviceBody = extractFunctionBody(
    budgeterSource,
    'public getAdvice(): string[]'
  );

  assert.match(
    getAdviceBody,
    /if\s*\(advice\.length\s*===\s*0\)/,
    'getAdvice should check if no warnings'
  );
  assert.match(
    getAdviceBody,
    /You're on track/,
    'getAdvice should provide positive feedback'
  );
});

test('RequestBudgeter.clearUsage resets usage tracking', () => {
  const clearUsageBody = extractFunctionBody(
    budgeterSource,
    'public clearUsage(): void'
  );

  assert.match(
    clearUsageBody,
    /this\.usage\s*=\s*\{\}/,
    'clearUsage should reset usage'
  );
  assert.match(
    clearUsageBody,
    /this\.saveUsage\(\)/,
    'clearUsage should save usage'
  );
});

test('RequestBudgeter.clearUsageForDate removes specific date', () => {
  const clearDateBody = extractFunctionBody(
    budgeterSource,
    'public clearUsageForDate(date: string): void'
  );

  assert.match(
    clearDateBody,
    /delete\s+this\.usage\[date\]/,
    'clearUsageForDate should delete date'
  );
  assert.match(
    clearDateBody,
    /this\.saveUsage\(\)/,
    'clearUsageForDate should save usage'
  );
});

test('RequestBudgeter.resetConfig resets to defaults', () => {
  const resetConfigBody = extractFunctionBody(
    budgeterSource,
    'public resetConfig(): void'
  );

  assert.match(
    resetConfigBody,
    /this\.config\s*=\s*\{/,
    'resetConfig should reset config'
  );
  assert.match(
    resetConfigBody,
    /enabled:\s*true/,
    'resetConfig should set enabled true'
  );
  assert.match(
    resetConfigBody,
    /planId:\s*["']pro["']/,
    'resetConfig should set plan to pro'
  );
  assert.match(
    resetConfigBody,
    /enforceLimit:\s*false/,
    'resetConfig should set enforceLimit false'
  );
  assert.match(
    resetConfigBody,
    /warnThreshold:\s*0\.8/,
    'resetConfig should set warnThreshold 0.8'
  );
  assert.match(
    resetConfigBody,
    /this\.saveConfig\(\)/,
    'resetConfig should save config'
  );
});

test('RequestBudgeter defines config file paths', () => {
  assert.match(
    budgeterSource,
    /CONFIG_PATH\s*=\s*path\.join/,
    'Should define CONFIG_PATH'
  );
  assert.match(
    budgeterSource,
    /budget-config\.json/,
    'Config file should be named budget-config.json'
  );
});

test('RequestBudgeter defines usage file paths', () => {
  assert.match(
    budgeterSource,
    /USAGE_PATH\s*=\s*path\.join/,
    'Should define USAGE_PATH'
  );
  assert.match(
    budgeterSource,
    /budget-usage\.json/,
    'Usage file should be named budget-usage.json'
  );
});

test('RequestBudgeter uses os.homedir for config directory', () => {
  assert.match(
    budgeterSource,
    /os\.homedir\(\)/,
    'Should use home directory'
  );
  assert.match(
    budgeterSource,
    /\.config/,
    'Should use .config directory'
  );
  assert.match(
    budgeterSource,
    /opencode/,
    'Should use opencode subdirectory'
  );
});

test('RequestBudgeter has helper functions', () => {
  assert.match(
    budgeterSource,
    /function\s+readJsonFile/,
    'Should have readJsonFile helper'
  );
  assert.match(
    budgeterSource,
    /function\s+writeJsonFile/,
    'Should have writeJsonFile helper'
  );
  assert.match(
    budgeterSource,
    /function\s+getTodayDate/,
    'Should have getTodayDate helper'
  );
  assert.match(
    budgeterSource,
    /function\s+getDaysInMonth/,
    'Should have getDaysInMonth helper'
  );
  assert.match(
    budgeterSource,
    /function\s+getDayOfMonth/,
    'Should have getDayOfMonth helper'
  );
});

test('RequestBudgeter.readJsonFile handles missing files', () => {
  const readJsonBody = extractFunctionBody(
    budgeterSource,
    'function readJsonFile<T>(filePath: string): T | null'
  );

  assert.match(
    readJsonBody,
    /fs\.existsSync\(filePath\)/,
    'readJsonFile should check if file exists'
  );
  assert.match(
    readJsonBody,
    /return\s+null/,
    'readJsonFile should return null for missing files'
  );
});

test('RequestBudgeter.readJsonFile handles parse errors', () => {
  const readJsonBody = extractFunctionBody(
    budgeterSource,
    'function readJsonFile<T>(filePath: string): T | null'
  );

  assert.match(
    readJsonBody,
    /catch/,
    'readJsonFile should catch errors'
  );
  assert.match(
    readJsonBody,
    /return\s+null/,
    'readJsonFile should return null on error'
  );
});

test('RequestBudgeter.writeJsonFile creates directory if needed', () => {
  const writeJsonBody = extractFunctionBody(
    budgeterSource,
    'function writeJsonFile<T>(filePath: string, data: T): void'
  );

  assert.match(
    writeJsonBody,
    /path\.dirname/,
    'writeJsonFile should get directory'
  );
  assert.match(
    writeJsonBody,
    /fs\.existsSync\(dir\)/,
    'writeJsonFile should check if directory exists'
  );
  assert.match(
    writeJsonBody,
    /fs\.mkdirSync\(dir,\s*\{\s*recursive:\s*true\s*\}\)/,
    'writeJsonFile should create directory recursively'
  );
});

test('RequestBudgeter.writeJsonFile handles write errors', () => {
  const writeJsonBody = extractFunctionBody(
    budgeterSource,
    'function writeJsonFile<T>(filePath: string, data: T): void'
  );

  assert.match(
    writeJsonBody,
    /catch/,
    'writeJsonFile should catch errors'
  );
  assert.match(
    writeJsonBody,
    /logger\.error/,
    'writeJsonFile should log errors'
  );
});

test('RequestBudgeter.getTodayDate returns YYYY-MM-DD format', () => {
  const getTodayBody = extractFunctionBody(
    budgeterSource,
    'function getTodayDate(): string'
  );

  assert.match(
    getTodayBody,
    /new\s+Date\(\)\.toISOString\(\)\.split\(['"]T['"]\)\[0\]/,
    'getTodayDate should return YYYY-MM-DD format'
  );
});

test('RequestBudgeter.getDaysInMonth calculates days in month', () => {
  const getDaysBody = extractFunctionBody(
    budgeterSource,
    'function getDaysInMonth(date: Date): number'
  );

  assert.match(
    getDaysBody,
    /new\s+Date\(year,\s*month,\s*0\)\.getDate\(\)/,
    'getDaysInMonth should calculate correctly'
  );
});

test('RequestBudgeter.getDayOfMonth returns day of month', () => {
  const getDayBody = extractFunctionBody(
    budgeterSource,
    'function getDayOfMonth(date: Date): number'
  );

  assert.match(
    getDayBody,
    /return\s+date\.getDate\(\)/,
    'getDayOfMonth should return day of month'
  );
});
